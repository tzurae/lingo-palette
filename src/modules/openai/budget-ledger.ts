import { z } from 'zod';

export const OPENAI_BUDGET_SETTINGS_STORAGE_KEY = 'openAiBudgetSettings';
export const OPENAI_BUDGET_LEDGER_STORAGE_KEY = 'openAiBudgetLedger';

export const DEFAULT_DAILY_BUDGET: DailyBudget = {
  tokenLimit: 100_000,
  estimatedCostUsdLimit: 1,
};

const dailyBudgetSchema = z.object({
  tokenLimit: z.number().int().nonnegative(),
  estimatedCostUsdLimit: z.number().nonnegative(),
});
const usageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  estimatedCostUsd: z.number().nonnegative().nullable(),
});
const reservationSchema = z.object({
  id: z.string().min(1),
  activeDate: z.string(),
  tokens: z.number().int().positive(),
  estimatedCostUsd: z.number().positive().nullable(),
  ownerId: z.string().min(1).optional(),
});
const ledgerUsageSchema = usageSchema.extend({
  knownEstimatedCostUsd: z.number().nonnegative().optional(),
});
const ledgerSchema = z.object({
  activeDate: z.string(),
  used: ledgerUsageSchema,
  reservations: z.record(z.string(), reservationSchema),
});

export type DailyBudget = z.infer<typeof dailyBudgetSchema>;
export type ProviderUsage = z.infer<typeof usageSchema>;
export type BudgetReservation = z.infer<typeof reservationSchema>;
type LedgerUsage = ProviderUsage & { knownEstimatedCostUsd: number };
type Ledger = {
  activeDate: string;
  used: LedgerUsage;
  reservations: Record<string, BudgetReservation>;
};

export type BudgetStorageArea = {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};

export type BudgetSnapshot = {
  settings: DailyBudget;
  activeDate: string;
  nextLocalReset: string;
  used: ProviderUsage;
  reserved: { tokens: number; estimatedCostUsd: number };
};

type ReserveResult =
  | { status: 'reserved'; reservation: BudgetReservation }
  | {
      status: 'blocked';
      kind: 'provider-disabled' | 'token-budget' | 'estimated-cost-budget';
    };

const emptyUsage = (): LedgerUsage => ({
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
  estimatedCostUsd: 0,
  knownEstimatedCostUsd: 0,
});

export function validateDailyBudget(value: unknown): DailyBudget {
  const parsed = dailyBudgetSchema.parse(value);
  if (
    parsed.tokenLimit !== 0 &&
    (parsed.tokenLimit < 10_000 || parsed.tokenLimit > 2_000_000)
  ) {
    throw new Error('每日 provider token 上限必須是 0 或 10,000–2,000,000。');
  }
  if (
    parsed.estimatedCostUsdLimit !== 0 &&
    (parsed.estimatedCostUsdLimit < 0.1 ||
      parsed.estimatedCostUsdLimit > 20)
  ) {
    throw new Error('每日 estimated-cost 上限必須是 US$0、US$0.10–20.00。');
  }
  return parsed;
}

export function createBudgetLedger(
  storage: BudgetStorageArea,
  dependencies: {
    now?: () => Date;
    id?: () => string;
    ownerId?: string;
  } = {},
): {
  configure(settings: DailyBudget): Promise<BudgetSnapshot>;
  snapshot(): Promise<BudgetSnapshot>;
  reserve(request: {
    tokens: number;
    estimatedCostUsd: number | null;
  }): Promise<ReserveResult>;
  reconcile(
    reservation: BudgetReservation,
    usage: ProviderUsage,
  ): Promise<void>;
  release(reservation: BudgetReservation): Promise<void>;
} {
  const now = dependencies.now ?? (() => new Date());
  const id = dependencies.id ?? (() => crypto.randomUUID());
  const ownerId = dependencies.ownerId ?? crypto.randomUUID();
  let pending = Promise.resolve();

  const serialized = async <T>(operation: () => Promise<T>): Promise<T> => {
    const previous = pending;
    const completion = Promise.withResolvers<void>();
    pending = completion.promise;
    await previous;
    try {
      return await operation();
    } finally {
      completion.resolve();
    }
  };

  const load = async (): Promise<{
    settings: DailyBudget;
    ledger: Ledger;
  }> => {
    const stored = await storage.get(OPENAI_BUDGET_SETTINGS_STORAGE_KEY);
    const ledgerStored = await storage.get(OPENAI_BUDGET_LEDGER_STORAGE_KEY);
    const settings =
      stored[OPENAI_BUDGET_SETTINGS_STORAGE_KEY] === undefined
        ? DEFAULT_DAILY_BUDGET
        : validateDailyBudget(stored[OPENAI_BUDGET_SETTINGS_STORAGE_KEY]);
    const today = localDate(now());
    const parsedLedger = ledgerSchema.safeParse(
      ledgerStored[OPENAI_BUDGET_LEDGER_STORAGE_KEY],
    );
    let ledger: Ledger = parsedLedger.success
      ? {
          ...parsedLedger.data,
          used: {
            ...parsedLedger.data.used,
            knownEstimatedCostUsd:
              parsedLedger.data.used.knownEstimatedCostUsd ??
              parsedLedger.data.used.estimatedCostUsd ??
              0,
          },
        }
      : { activeDate: today, used: emptyUsage(), reservations: {} };
    let changed = !parsedLedger.success;
    for (const [reservationId, reservation] of Object.entries(
      ledger.reservations,
    )) {
      if (reservation.ownerId !== ownerId) {
        delete ledger.reservations[reservationId];
        changed = true;
      }
    }
    if (today > ledger.activeDate) {
      ledger = {
        activeDate: today,
        used: emptyUsage(),
        reservations: ledger.reservations,
      };
      changed = true;
    }
    if (changed) {
      await storage.set({ [OPENAI_BUDGET_LEDGER_STORAGE_KEY]: ledger });
    }
    return { settings, ledger };
  };

  const toSnapshot = (
    settings: DailyBudget,
    ledger: Ledger,
  ): BudgetSnapshot => {
    const reservations = Object.values(ledger.reservations);
    const { knownEstimatedCostUsd: _knownEstimatedCostUsd, ...used } =
      ledger.used;
    const year = Number(ledger.activeDate.slice(0, 4));
    const month = Number(ledger.activeDate.slice(5, 7));
    const day = Number(ledger.activeDate.slice(8, 10));
    const nextReset = new Date(year, month - 1, day + 1);
    return {
      settings,
      activeDate: ledger.activeDate,
      nextLocalReset: nextReset.toISOString(),
      used,
      reserved: {
        tokens: reservations.reduce((sum, item) => sum + item.tokens, 0),
        estimatedCostUsd: roundCost(
          reservations.reduce(
            (sum, item) => sum + (item.estimatedCostUsd ?? 0),
            0,
          ),
        ),
      },
    };
  };

  return {
    async configure(settings) {
      return serialized(async () => {
        const validated = validateDailyBudget(settings);
        await storage.set({ [OPENAI_BUDGET_SETTINGS_STORAGE_KEY]: validated });
        const { ledger } = await load();
        return toSnapshot(validated, ledger);
      });
    },

    async snapshot() {
      return serialized(async () => {
        const { settings, ledger } = await load();
        return toSnapshot(settings, ledger);
      });
    },

    async reserve(request) {
      return serialized(async () => {
        if (!Number.isInteger(request.tokens) || request.tokens <= 0) {
          throw new Error('Budget reservation tokens must be a positive integer.');
        }
        if (
          request.estimatedCostUsd !== null &&
          (!Number.isFinite(request.estimatedCostUsd) ||
            request.estimatedCostUsd <= 0)
        ) {
          throw new Error('Budget reservation cost must be positive or null.');
        }
        const { settings, ledger } = await load();
        if (
          settings.tokenLimit === 0 ||
          settings.estimatedCostUsdLimit === 0
        ) {
          return { status: 'blocked', kind: 'provider-disabled' } as const;
        }
        const snapshot = toSnapshot(settings, ledger);
        if (
          ledger.used.totalTokens + snapshot.reserved.tokens + request.tokens >
          settings.tokenLimit
        ) {
          return { status: 'blocked', kind: 'token-budget' } as const;
        }
        if (
          request.estimatedCostUsd !== null &&
          ledger.used.knownEstimatedCostUsd +
            snapshot.reserved.estimatedCostUsd +
            request.estimatedCostUsd >
            settings.estimatedCostUsdLimit
        ) {
          return {
            status: 'blocked',
            kind: 'estimated-cost-budget',
          } as const;
        }
        const reservation: BudgetReservation = {
          id: id(),
          activeDate: ledger.activeDate,
          tokens: request.tokens,
          estimatedCostUsd: request.estimatedCostUsd,
          ownerId,
        };
        ledger.reservations[reservation.id] = reservation;
        await storage.set({ [OPENAI_BUDGET_LEDGER_STORAGE_KEY]: ledger });
        return { status: 'reserved', reservation } as const;
      });
    },

    async reconcile(reservation, usage) {
      await serialized(async () => {
        const parsedUsage = usageSchema.parse(usage);
        const { ledger } = await load();
        if (ledger.reservations[reservation.id] === undefined) return;
        delete ledger.reservations[reservation.id];
        ledger.used = {
          inputTokens: ledger.used.inputTokens + parsedUsage.inputTokens,
          cachedInputTokens:
            ledger.used.cachedInputTokens + parsedUsage.cachedInputTokens,
          outputTokens: ledger.used.outputTokens + parsedUsage.outputTokens,
          reasoningTokens:
            ledger.used.reasoningTokens + parsedUsage.reasoningTokens,
          totalTokens: ledger.used.totalTokens + parsedUsage.totalTokens,
          estimatedCostUsd:
            ledger.used.estimatedCostUsd === null ||
            parsedUsage.estimatedCostUsd === null
              ? null
              : roundCost(
                  ledger.used.estimatedCostUsd +
                    parsedUsage.estimatedCostUsd,
                ),
          knownEstimatedCostUsd: roundCost(
            ledger.used.knownEstimatedCostUsd +
              (parsedUsage.estimatedCostUsd ?? 0),
          ),
        };
        await storage.set({ [OPENAI_BUDGET_LEDGER_STORAGE_KEY]: ledger });
      });
    },

    async release(reservation) {
      await serialized(async () => {
        const { ledger } = await load();
        if (ledger.reservations[reservation.id] === undefined) return;
        delete ledger.reservations[reservation.id];
        await storage.set({ [OPENAI_BUDGET_LEDGER_STORAGE_KEY]: ledger });
      });
    },
  };
}

function localDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function roundCost(value: number): number {
  return Math.round(value * 1_000_000_000_000) / 1_000_000_000_000;
}

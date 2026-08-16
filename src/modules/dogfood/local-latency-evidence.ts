import { z } from 'zod';

const operatingSystemSchema = z.enum(['windows', 'macos']);
const inputMethodSchema = z.enum(['pointer', 'keyboard']);
const readingSurfaceSchema = z.enum(['top-level', 'same-origin-embedded']);
const localLatencyEvidenceSchema = z
  .object({
    schemaVersion: z.literal(1),
    candidateCommit: z.string().regex(/^[0-9a-f]{40}$/),
    samples: z
      .array(
        z
          .object({
            id: z.string().min(1),
            measuredAt: z.iso.datetime(),
            os: operatingSystemSchema,
            input: inputMethodSchema,
            surface: readingSurfaceSchema,
            latencyMs: z.number().nonnegative().finite(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export type LocalLatencyEvidenceResult = {
  passed: boolean;
  candidateCommit?: string;
  findings: readonly {
    code:
      | 'invalid-evidence'
      | 'duplicate-sample'
      | 'insufficient-sample-coverage'
      | 'missing-group'
      | 'budget-exceeded';
    message: string;
    path: string;
  }[];
  groups: readonly {
    os: z.infer<typeof operatingSystemSchema>;
    input: z.infer<typeof inputMethodSchema>;
    surface: z.infer<typeof readingSurfaceSchema>;
    sampleCount: number;
    p95Ms: number;
    maxMs: number;
  }[];
};

export function verifyLocalLatencyEvidence(
  value: unknown,
  expectedSelectionCount: number,
): LocalLatencyEvidenceResult {
  const parsed = localLatencyEvidenceSchema.safeParse(value);
  if (!parsed.success) {
    return {
      passed: false,
      findings: [
        {
          code: 'invalid-evidence',
          message:
            parsed.error.issues[0]?.message ??
            'Local latency evidence has an unknown schema error.',
          path: parsed.error.issues[0]?.path.join('.') ?? '',
        },
      ],
      groups: [],
    };
  }

  const findings: LocalLatencyEvidenceResult['findings'][number][] = [];
  if (parsed.data.samples.length < expectedSelectionCount) {
    findings.push({
      code: 'insufficient-sample-coverage',
      message: `Local latency evidence contains ${parsed.data.samples.length} sample(s), but dogfood recorded ${expectedSelectionCount} Selection event(s).`,
      path: 'samples',
    });
  }
  const samplesByGroup = new Map<string, number[]>();
  const sampleIds = new Set<string>();
  for (const [index, sample] of parsed.data.samples.entries()) {
    if (sampleIds.has(sample.id)) {
      findings.push({
        code: 'duplicate-sample',
        message: `Local latency sample ${sample.id} is duplicated.`,
        path: `samples.${index}.id`,
      });
      continue;
    }
    sampleIds.add(sample.id);
    const key = `${sample.os}/${sample.input}/${sample.surface}`;
    const values = samplesByGroup.get(key);
    if (values === undefined) samplesByGroup.set(key, [sample.latencyMs]);
    else values.push(sample.latencyMs);
  }

  const groups: LocalLatencyEvidenceResult['groups'][number][] = [];
  for (const os of operatingSystemSchema.options) {
    for (const input of inputMethodSchema.options) {
      for (const surface of readingSurfaceSchema.options) {
        const key = `${os}/${input}/${surface}`;
        const values = samplesByGroup.get(key);
        if (values === undefined || values.length === 0) {
          findings.push({
            code: 'missing-group',
            message: `Missing local latency samples for ${key}.`,
            path: 'samples',
          });
          continue;
        }
        const sorted = values.toSorted((left, right) => left - right);
        const p95Ms = sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0;
        const maxMs = sorted.at(-1) ?? 0;
        groups.push({
          os,
          input,
          surface,
          sampleCount: sorted.length,
          p95Ms,
          maxMs,
        });
        if (p95Ms > 100 || maxMs > 250) {
          findings.push({
            code: 'budget-exceeded',
            message: `${key} local latency measured p95 ${p95Ms} ms and max ${maxMs} ms; limits are 100 ms p95 and 250 ms max.`,
            path: 'samples',
          });
        }
      }
    }
  }

  return {
    passed: findings.length === 0,
    candidateCommit: parsed.data.candidateCommit,
    findings,
    groups,
  };
}

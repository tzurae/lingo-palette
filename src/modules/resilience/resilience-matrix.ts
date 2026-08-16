import { z } from 'zod';

export const RESILIENCE_PLAN_VERSION = '2026-08-16';

export const RESILIENCE_RISK_AREAS = [
  'offline-continuity',
  'provider-failure',
  'worker-interruption',
  'evidence-pack-safety',
  'backup-recovery',
  'configuration-integrity',
  'release-package',
] as const;

const riskAreaSchema = z.enum(RESILIENCE_RISK_AREAS);
const vitestEvidenceSchema = z
  .object({
    kind: z.literal('vitest'),
    id: z.string().min(1),
    source: z.string().min(1),
    testName: z.string().min(1),
  })
  .strict();
const packageEvidenceSchema = z
  .object({
    kind: z.literal('package-inspection'),
    id: z.string().min(1),
    source: z.literal('built Chrome MV3 release archive'),
  })
  .strict();
const evidenceExpectationSchema = z.discriminatedUnion('kind', [
  vitestEvidenceSchema,
  packageEvidenceSchema,
]);
const matrixRowSchema = z
  .object({
    id: z.string().min(1),
    riskArea: riskAreaSchema,
    setup: z.string().min(1),
    injectedFault: z.string().min(1),
    observableLearnerState: z.string().min(1),
    persistedAftermath: z.string().min(1),
    budgetEffect: z.string().min(1),
    recoveryAction: z.string().min(1),
    evidence: z.array(evidenceExpectationSchema).min(1),
  })
  .strict();
const evidenceResultSchema = z.discriminatedUnion('kind', [
  vitestEvidenceSchema.extend({
    status: z.enum(['passed', 'failed']),
    artifact: z.string().min(1),
  }),
  packageEvidenceSchema.extend({
    status: z.enum(['passed', 'failed']),
    artifact: z.string().min(1),
  }),
]);
const evidenceRowSchema = matrixRowSchema.extend({
  outcome: z.enum(['passed', 'failed']),
  evidence: z.array(evidenceResultSchema),
});
const resilienceEvidenceSchema = z
  .object({
    schemaVersion: z.literal(1),
    planVersion: z.string().min(1),
    runId: z.string().min(1),
    extensionCommit: z.string().min(1),
    recordedAt: z.iso.datetime(),
    rows: z.array(evidenceRowSchema),
  })
  .strict();

export type ResilienceRiskArea = (typeof RESILIENCE_RISK_AREAS)[number];
export type ResilienceEvidenceExpectation = z.infer<
  typeof evidenceExpectationSchema
>;
export type ResilienceMatrixRow = z.infer<typeof matrixRowSchema>;
export type ResilienceEvidence = z.infer<typeof resilienceEvidenceSchema>;
export type ResilienceFinding = {
  code:
    | 'invalid-evidence'
    | 'plan-version-mismatch'
    | 'missing-row'
    | 'unexpected-row'
    | 'duplicate-row'
    | 'row-metadata-mismatch'
    | 'row-failed'
    | 'missing-evidence'
    | 'evidence-failed';
  path: string;
  message: string;
};

function regression(
  id: string,
  source: string,
  testName: string,
): ResilienceEvidenceExpectation {
  return { kind: 'vitest', id, source, testName };
}

function packageInspection(id: string): ResilienceEvidenceExpectation {
  return {
    kind: 'package-inspection',
    id,
    source: 'built Chrome MV3 release archive',
  };
}

function row(value: ResilienceMatrixRow): ResilienceMatrixRow {
  return matrixRowSchema.parse(value);
}

const quickHintTests = 'src/modules/openai/quick-hint-executor.test.ts';
const responseTests = 'src/modules/openai/openai-responses.test.ts';
const budgetTests = 'src/modules/openai/budget-ledger.test.ts';
const readingFlowTests = 'src/reading-flow.test.ts';
const evidenceLifecycleTests =
  'src/modules/evidence/evidence-pack-lifecycle.test.ts';
const portabilityTests = 'src/modules/portability/portable-backup.test.ts';

export const RESILIENCE_MATRIX: readonly ResilienceMatrixRow[] = [
  row({
    id: 'offline-local-learning-state',
    riskArea: 'offline-continuity',
    setup: 'Create Recent and Saved learning data, Settings, Review Items, and schedules, then restart offline.',
    injectedFault: 'Disable provider connectivity and replace the extension service worker.',
    observableLearnerState: 'Recent, Saved, Settings, and approved Review work remain readable and actionable.',
    persistedAftermath: 'All local learning records and schedules retain their exact identifiers and values.',
    budgetEffect: 'No provider reservation or usage is created by local reads.',
    recoveryAction: 'None for local state; reconnect only for uncached provider Actions.',
    evidence: [
      regression(
        'offline-local-learning-state-e2e',
        readingFlowTests,
        'records layered evidence, resumes an objective Review Session offline, and advances its schedule',
      ),
      regression(
        'offline-settings-storage',
        'src/modules/openai/configuration-store.test.ts',
        'persists the exact active model separately from the device-local key',
      ),
    ],
  }),
  row({
    id: 'offline-cached-assistance',
    riskArea: 'offline-continuity',
    setup: 'Persist an assistance result under its exact request identity, then go offline.',
    injectedFault: 'Request the same Quick Hint while provider connectivity is unavailable.',
    observableLearnerState: 'The cached result is returned with cache provenance and no outage masking.',
    persistedAftermath: 'The cache entry remains intact and no substitute entry is written.',
    budgetEffect: 'Zero tokens and zero estimated cost are reserved or charged.',
    recoveryAction: 'None; reconnect only when a different uncached request is needed.',
    evidence: [
      regression(
        'offline-quick-hint-cache',
        quickHintTests,
        'returns a cache hit offline before provider availability or budget',
      ),
    ],
  }),
  row({
    id: 'offline-cached-audio',
    riskArea: 'offline-continuity',
    setup: 'Persist pronunciation audio for an exact text, variety, voice, and model identity.',
    injectedFault: 'Request the same pronunciation after connectivity is removed.',
    observableLearnerState: 'Exact cached audio remains playable offline.',
    persistedAftermath: 'The audio cache survives a new cache/worker instance without key drift.',
    budgetEffect: 'No speech reservation or provider usage occurs.',
    recoveryAction: 'None for the cached pronunciation; reconnect for a cache miss.',
    evidence: [
      regression(
        'offline-pronunciation-cache',
        'src/modules/pronunciation/pronunciation-executor.test.ts',
        'uses an exact text/variety/voice/model cache hit offline without budget',
      ),
      regression(
        'speech-cache-restart',
        'src/modules/pronunciation/speech-cache.test.ts',
        'recovers exact audio locally across cache instances',
      ),
    ],
  }),
  row({
    id: 'offline-approved-review',
    riskArea: 'offline-continuity',
    setup: 'Prepare approved receptive and productive Review Items and opt into their schedules.',
    injectedFault: 'Restart the browser offline before continuing both review dimensions.',
    observableLearnerState: 'The Learner can complete due approved Review Items without provider access.',
    persistedAftermath: 'Review Evidence and dimension schedules advance independently and durably.',
    budgetEffect: 'The offline Review Session consumes no provider budget.',
    recoveryAction: 'Reconnect only to prepare or revalidate new Review Items.',
    evidence: [
      regression(
        'offline-review-e2e',
        readingFlowTests,
        'reviews receptive and productive dimensions across an offline restart with opt-in scheduling',
      ),
    ],
  }),
  row({
    id: 'offline-local-pronunciation',
    riskArea: 'offline-continuity',
    setup: 'Expose a local browser voice with the exact normalized language-variety tag.',
    injectedFault: 'Remove provider connectivity before pronunciation playback.',
    observableLearnerState: 'Local pronunciation remains available without silently choosing a mismatched variety.',
    persistedAftermath: 'No remote speech cache or configuration is altered.',
    budgetEffect: 'Local speech uses zero provider tokens and cost.',
    recoveryAction: 'Choose an available exact local voice or reconnect for configured remote speech.',
    evidence: [
      regression(
        'local-voice-selection',
        'src/modules/pronunciation/playback.test.ts',
        'selects only a local voice with the exact normalized variety tag',
      ),
    ],
  }),
  row({
    id: 'offline-active-evidence-pack',
    riskArea: 'offline-continuity',
    setup: 'Install and activate a verified Evidence Pack, then persist its active pointer.',
    injectedFault: 'Restart offline with the package host unavailable.',
    observableLearnerState: 'The active or bundled known-good Evidence Pack remains usable.',
    persistedAftermath: 'The active pointer and installed payload identity survive suspension.',
    budgetEffect: 'Loading installed evidence consumes no provider budget.',
    recoveryAction: 'Retry refresh later; no refresh is required for current offline evidence.',
    evidence: [
      regression(
        'offline-evidence-pack-e2e',
        readingFlowTests,
        'installs a signed Evidence Pack and recovers the active pack after an offline browser restart',
      ),
    ],
  }),
  row({
    id: 'offline-uncached-provider-action',
    riskArea: 'offline-continuity',
    setup: 'Start offline with no cache entry for the requested assistance identity.',
    injectedFault: 'Invoke an uncached provider Action.',
    observableLearnerState: 'A specific recoverable offline state appears; no stale or fabricated answer is shown.',
    persistedAftermath: 'Learning data and cache remain unchanged.',
    budgetEffect: 'No reservation is made and no usage is charged.',
    recoveryAction: 'Reconnect and explicitly retry the same Action.',
    evidence: [
      regression(
        'offline-cache-miss',
        quickHintTests,
        'fails offline on a cache miss without reserving or calling the provider',
      ),
    ],
  }),

  ...([
    ['provider-authentication', 'authentication', 'invalid or revoked API key', 'Correct the device-local API key, then explicitly retry.'],
    ['provider-permission', 'permission', 'provider or project permission denial', 'Grant the required provider permission, then explicitly retry.'],
    ['provider-quota', 'provider-quota', 'provider quota exhaustion', 'Increase provider quota or wait for provider recovery, then retry.'],
    ['provider-credit', 'provider-credit', 'provider credit exhaustion', 'Restore provider credit, then explicitly retry.'],
    ['provider-spend-limit', 'spend-limit', 'provider hard spend limit', 'Raise the provider limit or wait for reset, then retry.'],
  ] as const).map(([id, failureKind, fault, recoveryAction]) =>
    row({
      id,
      riskArea: 'provider-failure',
      setup: 'Use an uncached request with a valid local configuration and available local budget.',
      injectedFault: `Return a terminal ${fault}.`,
      observableLearnerState: `Show the specific ${failureKind} failure without fallback or automatic retry.`,
      persistedAftermath: 'Selection, configuration, cache, and learner state remain unchanged.',
      budgetEffect: 'One attempt at most; release unused reservation or reconcile any reported usage.',
      recoveryAction,
      evidence: [
        regression(
          `${id}-no-retry`,
          quickHintTests,
          `does not retry terminal ${failureKind} failures`,
        ),
        regression(
          `${id}-learner-state`,
          readingFlowTests,
          'surfaces every terminal provider failure without retry and blocks locally at zero',
        ),
      ],
    }),
  ),
  row({
    id: 'local-token-limit',
    riskArea: 'provider-failure',
    setup: 'Configure a daily token ceiling below the next bounded reservation.',
    injectedFault: 'Reserve an Action that would cross the local token limit.',
    observableLearnerState: 'Show a local-budget block before provider work.',
    persistedAftermath: 'The ledger remains within its hard limit and learner state is unchanged.',
    budgetEffect: 'No provider call, retry, or usage charge occurs.',
    recoveryAction: 'Wait for the local reset or deliberately raise the token limit.',
    evidence: [
      regression(
        'local-token-hard-limit',
        budgetTests,
        'resets at local midnight but never reopens a day after clock rollback',
      ),
    ],
  }),
  row({
    id: 'local-cost-limit',
    riskArea: 'provider-failure',
    setup: 'Configure an estimated-cost ceiling below the next known-price reservation.',
    injectedFault: 'Reserve an Action that would cross the local estimated-cost limit.',
    observableLearnerState: 'Show a local-budget block before provider work.',
    persistedAftermath: 'The ledger remains within its cost limit and learner state is unchanged.',
    budgetEffect: 'No provider call, retry, or usage charge occurs.',
    recoveryAction: 'Wait for the local reset or deliberately raise the cost limit.',
    evidence: [
      regression(
        'local-cost-hard-limit',
        budgetTests,
        'preserves known-price cost enforcement after unpriced custom-model usage',
      ),
    ],
  }),
  row({
    id: 'temporary-429',
    riskArea: 'provider-failure',
    setup: 'Use an uncached foreground request with budget for three bounded attempts.',
    injectedFault: 'Return temporary 429 responses with Retry-After before a successful third attempt.',
    observableLearnerState: 'Expose retry waiting and eventual success without changing the answer contract.',
    persistedAftermath: 'Only the successful result is cached; failed attempts do not become answers.',
    budgetEffect: 'Each attempt reserves separately; unused failures release and reported usage reconciles.',
    recoveryAction: 'Automatic retry is bounded to two retries; after exhaustion the Learner retries explicitly.',
    evidence: [
      regression(
        'temporary-429-retry',
        quickHintTests,
        'retries eligible foreground failures at most twice and honors Retry-After',
      ),
      regression(
        'temporary-429-ui',
        readingFlowTests,
        'shows retry waiting, retry exhaustion, and a later successful third attempt',
      ),
    ],
  }),
  row({
    id: 'provider-connection-failure',
    riskArea: 'provider-failure',
    setup: 'Receive a response whose body connection terminates before valid completion.',
    injectedFault: 'Throw a connection TypeError while reading the response body.',
    observableLearnerState: 'Show a retryable connection failure rather than malformed content.',
    persistedAftermath: 'No partial result is cached or applied.',
    budgetEffect: 'The bounded attempt is released unless provider usage was reported.',
    recoveryAction: 'Retry within the foreground cap, then require explicit retry.',
    evidence: [
      regression(
        'provider-connection-classification',
        responseTests,
        'classifies a response-body connection failure as retryable',
      ),
      regression(
        'provider-connection-retry-policy',
        quickHintTests,
        'uses bounded jittered backoff when Retry-After is absent',
      ),
    ],
  }),
  row({
    id: 'provider-timeout',
    riskArea: 'provider-failure',
    setup: 'Begin an uncached provider response within a cancellable foreground Action.',
    injectedFault: 'Time out while reading the response body.',
    observableLearnerState: 'Show a retryable timeout without a partial answer.',
    persistedAftermath: 'No partial provider output is cached or written to learning state.',
    budgetEffect: 'Release unused reservation or reconcile provider-reported usage.',
    recoveryAction: 'Retry within the bounded policy, then require explicit retry.',
    evidence: [
      regression(
        'provider-timeout-classification',
        responseTests,
        'classifies a timeout while reading the response body as retryable',
      ),
      regression(
        'provider-timeout-retry-policy',
        quickHintTests,
        'uses bounded jittered backoff when Retry-After is absent',
      ),
    ],
  }),
  row({
    id: 'provider-5xx',
    riskArea: 'provider-failure',
    setup: 'Use an uncached foreground Action with no Retry-After response header.',
    injectedFault: 'Return a temporary provider 5xx failure.',
    observableLearnerState: 'Show bounded retry waiting, then success or an explicit exhausted state.',
    persistedAftermath: 'No failed response becomes a cached answer.',
    budgetEffect: 'Reserve per attempt and release unused reservations.',
    recoveryAction: 'Use bounded jittered backoff; require Learner action after exhaustion.',
    evidence: [
      regression(
        'provider-5xx-backoff',
        quickHintTests,
        'uses bounded jittered backoff when Retry-After is absent',
      ),
    ],
  }),
  row({
    id: 'provider-cancellation',
    riskArea: 'provider-failure',
    setup: 'Begin an uncached provider Action and retain its AbortSignal and reservation.',
    injectedFault: 'The Learner cancels before provider completion.',
    observableLearnerState: 'The in-flight UI closes or returns to an explicit idle state while Selection is preserved.',
    persistedAftermath: 'No partial result or cache entry is written.',
    budgetEffect: 'The unused reservation is released; reported usage would be reconciled.',
    recoveryAction: 'Start a new explicit Action when desired.',
    evidence: [
      regression(
        'provider-cancellation-budget',
        quickHintTests,
        'cancels provider work and releases an unused reservation',
      ),
      regression(
        'provider-cancellation-e2e',
        readingFlowTests,
        'cancels active provider work, preserves Selection, and releases its reservation',
      ),
    ],
  }),

  row({
    id: 'worker-reservation-reconciliation',
    riskArea: 'worker-interruption',
    setup: 'Persist an in-flight budget reservation owned by the current service-worker instance.',
    injectedFault: 'Replace the service worker before it can reconcile or release the reservation.',
    observableLearnerState: 'The next worker starts normally without phantom in-flight work.',
    persistedAftermath: 'The orphan reservation is conservatively charged and removed.',
    budgetEffect: 'Reserved upper bounds remain charged; the crash never reopens spend capacity.',
    recoveryAction: 'No manual cleanup; the replacement worker sweeps the orphan.',
    evidence: [
      regression(
        'worker-reservation-sweep',
        budgetTests,
        'sweeps reservations left by a replaced service worker',
      ),
    ],
  }),
  row({
    id: 'worker-retry-waiting',
    riskArea: 'worker-interruption',
    setup: 'Persist a request between transient attempts with retry timing visible.',
    injectedFault: 'Replace the service worker during retry waiting.',
    observableLearnerState: 'The Action becomes explicit retryable state rather than silently resuming duplicate work.',
    persistedAftermath: 'Selection and request identity remain inspectable; no hidden completion is recorded.',
    budgetEffect: 'No waiting interval consumes a reservation; prior attempts remain reconciled.',
    recoveryAction: 'The Learner explicitly retries after restart.',
    evidence: [
      regression(
        'worker-retry-state',
        'src/modules/reading-flow/deep-dive-state.test.ts',
        'turns service-worker-interrupted work into an explicit retry state',
      ),
      regression(
        'worker-retry-waiting-ui',
        readingFlowTests,
        'shows retry waiting, retry exhaustion, and a later successful third attempt',
      ),
    ],
  }),
  row({
    id: 'worker-background-generation',
    riskArea: 'worker-interruption',
    setup: 'Persist an active Review preparation attempt in the background queue.',
    injectedFault: 'Replace the service worker during candidate generation or evaluation.',
    observableLearnerState: 'Reading remains unblocked and the queue exposes resumable work.',
    persistedAftermath: 'The interrupted attempt is recovered without adding an unchecked Review Item.',
    budgetEffect: 'The attempt stays within background caps and orphan reservations are reconciled.',
    recoveryAction: 'The replacement worker resumes the persisted queue.',
    evidence: [
      regression(
        'worker-background-generation-recovery',
        'src/modules/review/review-preparation-queue.test.ts',
        'recovers an interrupted persisted attempt after service-worker restart',
      ),
    ],
  }),
  row({
    id: 'worker-background-revalidation',
    riskArea: 'worker-interruption',
    setup: 'Activate a new Evidence Pack with a persisted, cursor-based revalidation sweep.',
    injectedFault: 'Replace the service worker between bounded revalidation batches.',
    observableLearnerState: 'Pending items stay excluded while approved provenance remains inspectable.',
    persistedAftermath: 'The sweep resumes from its durable cursor without rewriting approval pins.',
    budgetEffect: 'Each resumed batch remains within the background budget share.',
    recoveryAction: 'The next worker resumes the pending sweep automatically.',
    evidence: [
      regression(
        'worker-revalidation-resume',
        evidenceLifecycleTests,
        'resumes bounded revalidation batches after restart without rewriting approved provenance',
      ),
    ],
  }),
  row({
    id: 'worker-import-staging-write',
    riskArea: 'worker-interruption',
    setup: 'Validate an untrusted backup before writing its durable staged candidate.',
    injectedFault: 'Interrupt the storage write that would persist the staged import.',
    observableLearnerState: 'The current profile remains unchanged and no confirmable partial stage appears.',
    persistedAftermath: 'All current records retain their pre-import values.',
    budgetEffect: 'Import uses no provider budget.',
    recoveryAction: 'Select the backup and stage it again.',
    evidence: [
      regression(
        'worker-import-staging-write',
        portabilityTests,
        'leaves learner state unchanged when writing the validated stage is interrupted',
      ),
    ],
  }),
  row({
    id: 'worker-import-commit',
    riskArea: 'worker-interruption',
    setup: 'Persist a validated import stage and begin its atomic profile commit.',
    injectedFault: 'Fail the atomic storage write during commit.',
    observableLearnerState: 'The profile remains entirely pre-import and the staged report remains retryable.',
    persistedAftermath: 'No mixed old/new graph is observable; the same stage remains available.',
    budgetEffect: 'Import uses no provider budget.',
    recoveryAction: 'Retry the same staged commit after storage recovers.',
    evidence: [
      regression(
        'worker-import-commit',
        portabilityTests,
        'leaves all current state unchanged when the atomic commit write fails and can retry the same stage',
      ),
    ],
  }),
  row({
    id: 'worker-pack-staging-activation',
    riskArea: 'worker-interruption',
    setup: 'Retain an active known-good Evidence Pack while staging and activating a candidate.',
    injectedFault: 'Interrupt every lifecycle phase from manifest download through atomic activation.',
    observableLearnerState: 'Current evidence stays usable; an invalid or partial candidate never becomes active.',
    persistedAftermath: 'The active pointer remains at the known-good pack and partial staging is discarded.',
    budgetEffect: 'Evidence Pack lifecycle uses no provider budget.',
    recoveryAction: 'Retry inspection/activation; roll back explicitly if a completed update is unsuitable.',
    evidence: [
      regression(
        'worker-pack-lifecycle-phases',
        evidenceLifecycleTests,
        'preserves the active known-good pack across every staging and activation interruption',
      ),
    ],
  }),

  row({
    id: 'pack-invalid-signature',
    riskArea: 'evidence-pack-safety',
    setup: 'Retain an active known-good pack and fetch a supported candidate manifest.',
    injectedFault: 'Omit the detached signature or provide one that does not verify against the packaged public key.',
    observableLearnerState: 'Candidate inspection fails closed and the current pack remains usable.',
    persistedAftermath: 'No candidate files or active pointer are committed.',
    budgetEffect: 'Pack validation consumes no provider budget.',
    recoveryAction: 'Retry only after the publisher supplies a correctly signed release.',
    evidence: [
      regression(
        'pack-invalid-signature',
        evidenceLifecycleTests,
        'rejects an invalid manifest signature without staging a candidate',
      ),
      regression(
        'pack-missing-signature-preserves-known-good',
        evidenceLifecycleTests,
        'preserves the active known-good pack across every staging and activation interruption',
      ),
    ],
  }),
  row({
    id: 'pack-hash-mismatch',
    riskArea: 'evidence-pack-safety',
    setup: 'Verify a signed manifest whose file inventory declares trusted hashes.',
    injectedFault: 'Change payload bytes without changing the signed file inventory.',
    observableLearnerState: 'Inspection reports integrity-invalid and keeps the prior pack.',
    persistedAftermath: 'No corrupted file is staged or activated.',
    budgetEffect: 'Pack validation consumes no provider budget.',
    recoveryAction: 'Fetch a publisher-corrected release and inspect again.',
    evidence: [
      regression(
        'pack-hash-mismatch',
        evidenceLifecycleTests,
        'rejects a file whose bytes do not match the signed inventory',
      ),
    ],
  }),
  row({
    id: 'pack-schema-provenance-mismatch',
    riskArea: 'evidence-pack-safety',
    setup: 'Retain pinned source identities and a known-good active pack.',
    injectedFault: 'Use a signed manifest with an unsupported schema or changed source provenance.',
    observableLearnerState: 'Inspection rejects the candidate rather than accepting signed behavioral drift.',
    persistedAftermath: 'The active pack and approval provenance remain unchanged.',
    budgetEffect: 'No provider budget is consumed.',
    recoveryAction: 'Install an extension update for a new trusted contract or use a conforming pack.',
    evidence: [
      regression(
        'pack-provenance-mismatch',
        evidenceLifecycleTests,
        'rejects a signed manifest that changes a pinned source',
      ),
      regression(
        'pack-schema-preserves-known-good',
        evidenceLifecycleTests,
        'preserves the active known-good pack across every staging and activation interruption',
      ),
    ],
  }),
  row({
    id: 'pack-size-or-quota-failure',
    riskArea: 'evidence-pack-safety',
    setup: 'Retain a known-good active pack with bounded download and installed-size limits.',
    injectedFault: 'Declare, stream, or install bytes above the compressed/installed/quota cap.',
    observableLearnerState: 'Inspection fails locally before activation and the current pack remains available.',
    persistedAftermath: 'No oversized candidate or active pointer is committed.',
    budgetEffect: 'No provider budget is consumed.',
    recoveryAction: 'Free storage or use a conforming bounded release, then retry.',
    evidence: [
      regression(
        'pack-manifest-size-cap',
        evidenceLifecycleTests,
        'rejects a signed manifest above the compressedSizeBytes cap',
      ),
      regression(
        'pack-stream-size-cap',
        'src/modules/evidence/evidence-pack-browser-adapters.test.ts',
        'rejects declared and streamed downloads that cross the caller cap',
      ),
      regression(
        'pack-storage-quota-failure',
        'src/modules/evidence/evidence-pack-browser-adapters.test.ts',
        'recovers the active pointer after suspension and preserves it when a commit fails',
      ),
    ],
  }),
  row({
    id: 'pack-activation-failure',
    riskArea: 'evidence-pack-safety',
    setup: 'Stage a fully validated candidate beside an active known-good pack.',
    injectedFault: 'Fail the final atomic active-version storage switch.',
    observableLearnerState: 'The prior Evidence Pack remains active and inspectable.',
    persistedAftermath: 'No half-active candidate or mismatched pointer is visible.',
    budgetEffect: 'Activation consumes no provider budget.',
    recoveryAction: 'Retry confirmation after storage recovers.',
    evidence: [
      regression(
        'pack-activation-failure',
        evidenceLifecycleTests,
        'preserves the active known-good pack across every staging and activation interruption',
      ),
    ],
  }),
  row({
    id: 'pack-rollback',
    riskArea: 'evidence-pack-safety',
    setup: 'Activate a verified update while retaining the previous installed version as rollback.',
    injectedFault: 'The Learner elects to roll back the completed update.',
    observableLearnerState: 'The prior known-good pack becomes active again.',
    persistedAftermath: 'Active and rollback pointers swap atomically and revalidation is queued.',
    budgetEffect: 'Rollback itself consumes no provider budget.',
    recoveryAction: 'Use the new active pack or explicitly roll forward again.',
    evidence: [
      regression(
        'pack-rollback',
        evidenceLifecycleTests,
        'stages a signed supported release, activates only after confirmation, and rolls back',
      ),
      regression(
        'pack-rollback-provenance',
        'src/modules/review/review-generation-harness.test.ts',
        'requires revalidation when any approval pin changes',
      ),
    ],
  }),

  row({
    id: 'backup-fresh-profile',
    riskArea: 'backup-recovery',
    setup: 'Create a fresh profile with its own API key and installed/bundled Evidence Pack.',
    injectedFault: 'Stage and commit a complete portable backup while offline.',
    observableLearnerState: 'The import preview is reviewable and the restored graph is available after commit.',
    persistedAftermath: 'Portable records restore atomically while the target API key and Evidence Pack remain local.',
    budgetEffect: 'Backup import consumes no provider budget and does not import usage reservations.',
    recoveryAction: 'Use the Import Report; retry the unchanged stage only if commit fails.',
    evidence: [
      regression(
        'backup-fresh-profile',
        portabilityTests,
        'stages then atomically restores a fresh profile without replacing its API key or Evidence Pack',
      ),
      regression(
        'backup-fresh-profile-e2e',
        readingFlowTests,
        'exports and transactionally restores portable state from Settings while offline without replacing device credentials',
      ),
    ],
  }),
  row({
    id: 'backup-divergent-profile',
    riskArea: 'backup-recovery',
    setup: 'Create local records whose IDs collide with divergent records in a valid backup graph.',
    injectedFault: 'Stage and commit the divergent backup, then import the identical backup again.',
    observableLearnerState: 'The report exposes preserved collisions and stable re-identified imported records.',
    persistedAftermath: 'Both graphs survive with internal references preserved; identical re-import is idempotent.',
    budgetEffect: 'Import consumes no provider budget.',
    recoveryAction: 'Acknowledge preserved collisions or keep both records after reviewing provenance.',
    evidence: [
      regression(
        'backup-divergent-profile',
        portabilityTests,
        'preserves a divergent imported graph with new IDs and imports the same backup idempotently',
      ),
    ],
  }),
  row({
    id: 'backup-invalid-or-oversized',
    riskArea: 'backup-recovery',
    setup: 'Retain a populated target profile before selecting untrusted import bytes.',
    injectedFault: 'Provide malformed, future-version, duplicate-ID, oversized, or quota-exceeding input.',
    observableLearnerState: 'Validation rejects the backup before confirmation with a specific local error.',
    persistedAftermath: 'Every current profile record remains unchanged and no stage is committed.',
    budgetEffect: 'Validation consumes no provider budget.',
    recoveryAction: 'Select a valid bounded versioned backup and stage again.',
    evidence: [
      regression(
        'backup-invalid-input',
        portabilityTests,
        'rejects malformed, future, duplicate, oversized, and quota-exceeding inputs without changing learner state',
      ),
    ],
  }),

  row({
    id: 'configuration-provider',
    riskArea: 'configuration-integrity',
    setup: 'Use the configured OpenAI provider with an uncached request and available local budget.',
    injectedFault: 'Return any terminal provider-side failure.',
    observableLearnerState: 'The exact OpenAI failure is shown; no alternate provider or answer is selected.',
    persistedAftermath: 'Provider configuration, Selection, cache, and learner state remain unchanged.',
    budgetEffect: 'One attempt at most; unused reservation releases and reported usage reconciles.',
    recoveryAction: 'Correct the provider-side fault and explicitly retry the same provider contract.',
    evidence: [
      regression(
        'configuration-provider-no-fallback',
        readingFlowTests,
        'surfaces every terminal provider failure without retry and blocks locally at zero',
      ),
    ],
  }),

  row({
    id: 'configuration-model-effort',
    riskArea: 'configuration-integrity',
    setup: 'Persist an exact model and per-workload reasoning efforts.',
    injectedFault: 'Return a capability or Structured Outputs failure.',
    observableLearnerState: 'The configured model and effort stay visible; no silent fallback occurs.',
    persistedAftermath: 'Configuration remains byte-for-byte unchanged.',
    budgetEffect: 'Any reported failed-attempt usage is reconciled under the attempted configuration.',
    recoveryAction: 'The Learner explicitly chooses and validates a different model/effort if desired.',
    evidence: [
      regression(
        'configuration-model-effort-no-drift',
        responseTests,
        'reports a later Structured Outputs incompatibility without changing model or effort',
      ),
    ],
  }),
  row({
    id: 'configuration-answer-source',
    riskArea: 'configuration-integrity',
    setup: 'Use an uncached request that requires provider completion.',
    injectedFault: 'Return a terminal provider failure.',
    observableLearnerState: 'No cache/provider provenance is fabricated and no alternate answer source is selected.',
    persistedAftermath: 'No failed result is cached or applied to learning state.',
    budgetEffect: 'Unused reservation releases or reported usage reconciles.',
    recoveryAction: 'Correct the reported fault and explicitly retry the same source contract.',
    evidence: [
      regression(
        'configuration-answer-source-no-fallback',
        quickHintTests,
        'does not retry terminal malformed-request failures',
      ),
    ],
  }),
  row({
    id: 'configuration-pricing',
    riskArea: 'configuration-integrity',
    setup: 'Select either a packaged known-price model or an unknown custom model.',
    injectedFault: 'Encounter a failure or usage report while price metadata differs by model.',
    observableLearnerState: 'Known prices remain exact; unknown prices remain explicitly unknown.',
    persistedAftermath: 'No failure or retry mutates the packaged pricing catalog.',
    budgetEffect: 'Unknown-price work remains token-limited without fabricated dollar precision.',
    recoveryAction: 'Choose a catalog model for cost enforcement or retain the explicit token-only custom limit.',
    evidence: [
      regression(
        'configuration-pricing-no-fabrication',
        'src/modules/openai/pricing.test.ts',
        'does not fabricate an estimate for an unknown custom model',
      ),
      regression(
        'configuration-pricing-budget',
        budgetTests,
        'keeps an unknown-price custom model token-limited without fabricating cost',
      ),
    ],
  }),
  row({
    id: 'configuration-budget-policy',
    riskArea: 'configuration-integrity',
    setup: 'Persist local token/cost limits and the 30% background share.',
    injectedFault: 'Fail, retry, restart, or enqueue background work.',
    observableLearnerState: 'The same hard limits and foreground capacity remain in force.',
    persistedAftermath: 'Ledger dates only advance and reservations/usages remain accountable.',
    budgetEffect: 'No failure silently raises limits or bypasses the background cap.',
    recoveryAction: 'Wait for reset or deliberately change Settings.',
    evidence: [
      regression(
        'configuration-budget-background-cap',
        budgetTests,
        'caps background reservations at 30% while preserving foreground capacity',
      ),
    ],
  }),
  row({
    id: 'configuration-voice',
    riskArea: 'configuration-integrity',
    setup: 'Persist an exact pronunciation text, language variety, voice, and model cache identity.',
    injectedFault: 'Go offline or fail later pronunciation generation.',
    observableLearnerState: 'Only the exact configured voice identity can hit cache; no silent voice substitution occurs.',
    persistedAftermath: 'Voice configuration and unrelated cached audio remain unchanged.',
    budgetEffect: 'Exact cache hits cost zero; failed remote attempts follow normal reconciliation.',
    recoveryAction: 'Choose a different voice explicitly or reconnect and retry.',
    evidence: [
      regression(
        'configuration-voice-cache-identity',
        'src/modules/pronunciation/pronunciation-executor.test.ts',
        'uses an exact text/variety/voice/model cache hit offline without budget',
      ),
    ],
  }),
  row({
    id: 'configuration-evidence-version',
    riskArea: 'configuration-integrity',
    setup: 'Approve Review Items pinned to a verified Evidence Pack version.',
    injectedFault: 'Activate, fail, or roll back a different Evidence Pack version.',
    observableLearnerState: 'Items with stale pins remain inspectable but excluded until revalidated.',
    persistedAftermath: 'Approval provenance is never rewritten in place; revalidation state is durable.',
    budgetEffect: 'Revalidation remains background-budgeted; pack switching itself costs zero.',
    recoveryAction: 'Complete revalidation or roll back to the prior known-good pack.',
    evidence: [
      regression(
        'configuration-evidence-version-pin',
        'src/modules/review/review-generation-harness.test.ts',
        'requires revalidation when any approval pin changes',
      ),
    ],
  }),

  ...([
    ['release-no-remote-logic', 'no-remote-executable-logic', 'No executable JavaScript, HTML, or extension CSP can load remote executable logic.'],
    ['release-narrow-host-permissions', 'required-host-permissions-are-narrow', 'Required host permissions are limited to the OpenAI API and pinned Evidence Pack origin.'],
    ['release-pack-refresh-no-downloads', 'pack-refresh-does-not-use-downloads', 'The background Evidence Pack refresh path does not invoke the downloads permission.'],
    ['release-no-api-key', 'no-packaged-api-key', 'No API key-shaped credential is embedded in packaged files.'],
    ['release-no-signing-private-key', 'no-signing-private-key', 'No Evidence Pack signing private key or private-key PEM is packaged.'],
    ['release-third-party-notices', 'third-party-notices-complete', 'Production runtime dependencies and bundled evidence sources have inspectable notices.'],
  ] as const).map(([id, checkId, observableLearnerState]) =>
    row({
      id,
      riskArea: 'release-package',
      setup: 'Build the production Chrome MV3 release archive from the current commit.',
      injectedFault: `Inspect the archive for policy violation: ${checkId}.`,
      observableLearnerState,
      persistedAftermath: 'Inspection is read-only; no learner or extension state changes.',
      budgetEffect: 'Package inspection consumes no provider budget.',
      recoveryAction: 'Fail the release gate, remove the violating artifact or permission at source, rebuild, and rerun inspection.',
      evidence: [packageInspection(checkId)],
    }),
  ),
];

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function verifyResilienceEvidence(value: unknown): {
  passed: boolean;
  findings: ResilienceFinding[];
} {
  const parsed = resilienceEvidenceSchema.safeParse(value);
  if (!parsed.success) {
    return {
      passed: false,
      findings: [
        {
          code: 'invalid-evidence',
          path: 'evidence',
          message: parsed.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; '),
        },
      ],
    };
  }

  const findings: ResilienceFinding[] = [];
  if (parsed.data.planVersion !== RESILIENCE_PLAN_VERSION) {
    findings.push({
      code: 'plan-version-mismatch',
      path: 'planVersion',
      message: `Expected ${RESILIENCE_PLAN_VERSION}; received ${parsed.data.planVersion}.`,
    });
  }

  const rowsById = new Map<string, ResilienceEvidence['rows']>();
  for (const result of parsed.data.rows) {
    const matches = rowsById.get(result.id) ?? [];
    matches.push(result);
    rowsById.set(result.id, matches);
  }

  for (const expected of RESILIENCE_MATRIX) {
    const matches = rowsById.get(expected.id) ?? [];
    if (matches.length === 0) {
      findings.push({
        code: 'missing-row',
        path: `rows.${expected.id}`,
        message: `Missing resilience result ${expected.id}.`,
      });
      continue;
    }
    if (matches.length > 1) {
      findings.push({
        code: 'duplicate-row',
        path: `rows.${expected.id}`,
        message: `Resilience result ${expected.id} appears ${matches.length} times.`,
      });
      continue;
    }

    const actual = matches[0];
    if (actual === undefined) continue;
    const expectedMetadata = { ...expected, evidence: undefined };
    const actualMetadata = { ...actual, outcome: undefined, evidence: undefined };
    if (!sameValue(actualMetadata, expectedMetadata)) {
      findings.push({
        code: 'row-metadata-mismatch',
        path: `rows.${expected.id}`,
        message: `Recorded metadata for ${expected.id} differs from the maintained matrix.`,
      });
    }
    if (actual.outcome !== 'passed') {
      findings.push({
        code: 'row-failed',
        path: `rows.${expected.id}.outcome`,
        message: `Resilience result ${expected.id} did not pass.`,
      });
    }
    for (const expectedEvidence of expected.evidence) {
      const actualEvidence = actual.evidence.find(
        (candidate) =>
          candidate.kind === expectedEvidence.kind &&
          candidate.id === expectedEvidence.id,
      );
      if (actualEvidence === undefined) {
        findings.push({
          code: 'missing-evidence',
          path: `rows.${expected.id}.evidence.${expectedEvidence.id}`,
          message: `Missing linked evidence ${expectedEvidence.id}.`,
        });
      } else if (
        actualEvidence.status !== 'passed' ||
        !sameValue(
          { ...actualEvidence, status: undefined, artifact: undefined },
          expectedEvidence,
        )
      ) {
        findings.push({
          code: 'evidence-failed',
          path: `rows.${expected.id}.evidence.${expectedEvidence.id}`,
          message: `Linked evidence ${expectedEvidence.id} failed or drifted.`,
        });
      }
    }
  }

  const expectedIds = new Set(RESILIENCE_MATRIX.map((candidate) => candidate.id));
  for (const actual of parsed.data.rows) {
    if (!expectedIds.has(actual.id)) {
      findings.push({
        code: 'unexpected-row',
        path: `rows.${actual.id}`,
        message: `Unexpected resilience result ${actual.id}.`,
      });
    }
  }

  return { passed: findings.length === 0, findings };
}

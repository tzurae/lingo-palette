import { z } from 'zod';
import type { DogfoodActivityEvent } from './activity-store.ts';
import { parseDogfoodActivitySnapshot } from './activity-store.ts';

export type DogfoodActivityFinding = {
  code:
    | 'invalid-activity'
    | 'duplicate-event-conflict'
    | 'activity-span'
    | 'selection-count'
    | 'enabled-site-domain-count'
    | 'learning-item-count'
    | 'review-session-count'
    | 'review-session-day-count'
    | 'pronunciation-count'
    | 'multi-sentence-pronunciation-count'
    | 'pronunciation-variety'
    | 'backup-recovery';
  message: string;
  path: string;
};

export type DogfoodActivityResult = {
  passed: boolean;
  findings: DogfoodActivityFinding[];
  summary: {
    calendarSpanDays: number;
    selectionCount: number;
    enabledSiteDomainCount: number;
    savedLearningItemCount: number;
    completedReviewSessionCount: number;
    reviewSessionDayCount: number;
    pronunciationPlaybackCount: number;
    multiSentencePlaybackCount: number;
    pronunciationVarieties: ('en-GB' | 'en-US')[];
    successfulBackupSequenceCount: number;
  };
};

type CollectedEvent = {
  runId: string;
  event: DogfoodActivityEvent;
};

export function evaluateDogfoodActivity(
  values: readonly unknown[],
): DogfoodActivityResult {
  const findings: DogfoodActivityFinding[] = [];
  const eventsByKey = new Map<string, CollectedEvent>();

  for (const [snapshotIndex, value] of values.entries()) {
    try {
      const snapshot = parseDogfoodActivitySnapshot(value);
      for (const [eventIndex, event] of snapshot.events.entries()) {
        const key = `${snapshot.runId}\u0000${event.id}`;
        const existing = eventsByKey.get(key);
        if (existing === undefined) {
          eventsByKey.set(key, { runId: snapshot.runId, event });
          continue;
        }
        if (JSON.stringify(existing.event) !== JSON.stringify(event)) {
          findings.push({
            code: 'duplicate-event-conflict',
            message: `Run ${snapshot.runId} contains divergent copies of event ${event.id}.`,
            path: `activity.${snapshotIndex}.events.${eventIndex}`,
          });
        }
      }
    } catch (error) {
      findings.push({
        code: 'invalid-activity',
        message:
          error instanceof Error
            ? error.message
            : 'Dogfood activity is not valid evidence.',
        path: `activity.${snapshotIndex}`,
      });
    }
  }

  const events = Array.from(eventsByKey.values(), ({ event }) => event);
  const localDates = events.map((event) => event.localDate).toSorted();
  const calendarSpanDays =
    localDates.length === 0
      ? 0
      : calendarDayDistance(localDates[0]!, localDates.at(-1)!) + 1;
  const selections = events.filter((event) => event.kind === 'selection');
  const enabledSiteDomains = new Set(
    selections.map((event) => new URL(event.origin).hostname),
  );
  const savedLearningItems = new Set(
    events
      .filter((event) => event.kind === 'learning-item-saved')
      .map((event) => event.learningItemId),
  );
  const reviewSessions = events.filter(
    (event) => event.kind === 'review-session-completed',
  );
  const completedReviewSessionIds = new Set(
    reviewSessions.map((event) => event.reviewSessionId),
  );
  const reviewSessionDays = new Set(
    reviewSessions.map((event) => event.localDate),
  );
  const playbacks = events.filter(
    (event) => event.kind === 'pronunciation-playback-completed',
  );
  const multiSentencePlaybacks = playbacks.filter(
    (event) => event.sentenceCount >= 2,
  );
  const pronunciationVarieties = Array.from(
    new Set(playbacks.map((event) => event.variety)),
  ).toSorted();
  const successfulBackupSequenceCount = countBackupSequences(events);

  requireThreshold(
    calendarSpanDays >= 14,
    'activity-span',
    `Dogfood spans ${calendarSpanDays} calendar days; at least 14 are required.`,
    'activity',
    findings,
  );
  requireThreshold(
    selections.length >= 100,
    'selection-count',
    `Dogfood contains ${selections.length} Selections; at least 100 are required.`,
    'activity.events',
    findings,
  );
  requireThreshold(
    enabledSiteDomains.size >= 10,
    'enabled-site-domain-count',
    `Selections span ${enabledSiteDomains.size} Enabled Site domains; at least 10 are required.`,
    'activity.events',
    findings,
  );
  requireThreshold(
    savedLearningItems.size >= 30,
    'learning-item-count',
    `Dogfood contains ${savedLearningItems.size} saved Learning Items; at least 30 are required.`,
    'activity.events',
    findings,
  );
  requireThreshold(
    completedReviewSessionIds.size >= 5,
    'review-session-count',
    `Dogfood contains ${completedReviewSessionIds.size} completed Review Sessions; at least 5 are required.`,
    'activity.events',
    findings,
  );
  requireThreshold(
    reviewSessionDays.size >= 3,
    'review-session-day-count',
    `Review Sessions span ${reviewSessionDays.size} days; at least 3 are required.`,
    'activity.events',
    findings,
  );
  requireThreshold(
    playbacks.length >= 20,
    'pronunciation-count',
    `Dogfood contains ${playbacks.length} completed Pronunciation Playbacks; at least 20 are required.`,
    'activity.events',
    findings,
  );
  requireThreshold(
    multiSentencePlaybacks.length >= 5,
    'multi-sentence-pronunciation-count',
    `Dogfood contains ${multiSentencePlaybacks.length} multi-sentence Pronunciation Playbacks; at least 5 are required.`,
    'activity.events',
    findings,
  );
  requireThreshold(
    pronunciationVarieties.includes('en-US') &&
      pronunciationVarieties.includes('en-GB'),
    'pronunciation-variety',
    'Pronunciation evidence must include both US and UK varieties.',
    'activity.events',
    findings,
  );
  requireThreshold(
    successfulBackupSequenceCount >= 1,
    'backup-recovery',
    'Dogfood must include an export followed by a committed import.',
    'activity.events',
    findings,
  );

  return {
    passed: findings.length === 0,
    findings,
    summary: {
      calendarSpanDays,
      selectionCount: selections.length,
      enabledSiteDomainCount: enabledSiteDomains.size,
      savedLearningItemCount: savedLearningItems.size,
      completedReviewSessionCount: completedReviewSessionIds.size,
      reviewSessionDayCount: reviewSessionDays.size,
      pronunciationPlaybackCount: playbacks.length,
      multiSentencePlaybackCount: multiSentencePlaybacks.length,
      pronunciationVarieties,
      successfulBackupSequenceCount,
    },
  };
}

function countBackupSequences(events: readonly DogfoodActivityEvent[]): number {
  const exports = events
    .filter((event) => event.kind === 'portable-backup-exported')
    .map((event) => event.occurredAt)
    .toSorted();
  return events.filter(
    (event) =>
      event.kind === 'portable-backup-imported' &&
      exports.some((exportedAt) => exportedAt < event.occurredAt),
  ).length;
}

function calendarDayDistance(start: string, end: string): number {
  const millisecondsPerDay = 24 * 60 * 60 * 1_000;
  return Math.floor(
    (Date.parse(`${end}T00:00:00.000Z`) -
      Date.parse(`${start}T00:00:00.000Z`)) /
      millisecondsPerDay,
  );
}

function requireThreshold(
  condition: boolean,
  code: DogfoodActivityFinding['code'],
  message: string,
  path: string,
  findings: DogfoodActivityFinding[],
): void {
  if (condition) return;
  findings.push({ code, message, path });
}

const defectCategorySchema = z.enum([
  'invalid-rule',
  'hidden-valid-alternative',
  'unsafe-distractor',
  'data-loss',
  'api-key-disclosure',
  'api-key-synchronization',
  'hard-budget-overrun',
  'invalid-evidence-pack-activation',
  'destructive-import',
  'remote-logic',
  'provenance',
]);
const inspectionChecksSchema = z
  .object({
    answerRuleExact: z.boolean(),
    validAlternativesComplete: z.boolean(),
    distractorsSafe: z.boolean(),
    evidenceExcerptVerified: z.boolean(),
    provenanceVerified: z.boolean(),
    sourceAttributionsVerified: z.boolean(),
    inspectionReadable: z.boolean(),
  })
  .strict();
const inspectionBaseSchema = z.object({
  reviewItemId: z.string().min(1),
  inspectedAt: z.iso.datetime(),
  sourceItemPath: z.string().min(1),
  checks: inspectionChecksSchema,
});
const inspectionSchema = z.discriminatedUnion('outcome', [
  inspectionBaseSchema
    .extend({
      outcome: z.literal('passed'),
    })
    .strict(),
  inspectionBaseSchema
    .extend({
      outcome: z.literal('defect'),
      defectCategory: defectCategorySchema,
      defectId: z.string().min(1),
    })
    .strict(),
]);
const defectSchema = z.discriminatedUnion('status', [
  z
    .object({
      id: z.string().min(1),
      category: defectCategorySchema,
      status: z.literal('open'),
      issue: z.string().min(1),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1),
      category: defectCategorySchema,
      status: z.literal('resolved'),
      issue: z.string().min(1),
      regressionCase: z.string().min(1),
    })
    .strict(),
]);
const coreFlowAttestationSchema = z.object({
  completedAt: z.iso.datetime(),
  outcome: z.enum(['passed', 'failed']),
  configuredCommandEntered: z.boolean(),
  coreFlowCompleted: z.boolean(),
  evidenceLinks: z.array(z.string().min(1)).min(1),
});
const accessibilitySchema = coreFlowAttestationSchema
  .extend({
    os: z.enum(['windows', 'macos']),
    assistiveTechnology: z.enum(['nvda', 'voiceover']),
  })
  .strict();
const evidenceSummaryKindSchema = z.enum([
  'usage-log',
  'supported-surface-matrix',
  'resilience-matrix',
  'approved-item-inspection',
  'defect-regressions',
  'license-provenance',
]);
const dogfoodExitAttestationsSchema = z
  .object({
    schemaVersion: z.literal(1),
    candidateCommit: z.string().regex(/^[0-9a-f]{40}$/),
    recordedAt: z.iso.datetime(),
    reviewer: z.string().min(1),
    keyboardOnly: coreFlowAttestationSchema.strict(),
    freshProfileRecovery: z
      .object({
        exportEventId: z.string().min(1),
        importEventId: z.string().min(1),
        freshProfile: z.boolean(),
        outcome: z.enum(['passed', 'failed']),
        evidenceLinks: z.array(z.string().min(1)).min(1),
      })
      .strict(),
    approvedReviewAudit: z
      .object({
        sourceArtifact: z.string().min(1),
        inventoryDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
        latestApprovedItemIds: z.array(z.string().min(1)).length(50),
        inspections: z.array(inspectionSchema).length(50),
      })
      .strict(),
    defects: z.array(defectSchema),
    accessibility: z.array(accessibilitySchema),
    latency: z
      .object({
        localUiArtifact: z.string().min(1),
        providerArtifact: z.string().min(1),
        separated: z.boolean(),
      })
      .strict(),
    licenseProvenanceReview: z
      .object({
        completedAt: z.iso.datetime(),
        outcome: z.enum(['passed', 'failed']),
        evidenceLinks: z.array(z.string().min(1)).min(1),
      })
      .strict(),
    evidenceSummaryLinks: z.array(
      z
        .object({
          kind: evidenceSummaryKindSchema,
          artifact: z.string().min(1),
        })
        .strict(),
    ),
    publicRelease: z
      .object({
        chromeWebStoreBlocked: z.boolean(),
        blocker: z.literal('backend-proxy-and-public-release-contract'),
      })
      .strict(),
  })
  .strict();

export type DogfoodExitAttestations = z.infer<
  typeof dogfoodExitAttestationsSchema
>;
export type DogfoodExitGateId =
  | 'dogfood-activity'
  | 'fresh-profile-recovery'
  | 'supported-reading-surface'
  | 'integrated-resilience'
  | 'approved-review-quality'
  | 'critical-defects'
  | 'accessibility-and-latency'
  | 'release-evidence-summary'
  | 'public-release-block';
export type DogfoodExitGateFinding = {
  code: string;
  message: string;
  path: string;
};
export type DogfoodExitGateResult = {
  passed: boolean;
  gates: {
    id: DogfoodExitGateId;
    status: 'passed' | 'failed';
    findings: DogfoodExitGateFinding[];
  }[];
  activity: DogfoodActivityResult['summary'];
  evidenceSummaryLinks: {
    kind: z.infer<typeof evidenceSummaryKindSchema>;
    artifact: string;
  }[];
};

type ExternalGateResult = {
  passed: boolean;
  message?: string;
  findings: readonly unknown[];
};

export function evaluateDogfoodExitGate(input: {
  candidateCommit: string;
  activity: readonly unknown[];
  smoke: ExternalGateResult & {
    summary: { supportedPageCount: number };
  };
  resilience: ExternalGateResult;
  localLatency: ExternalGateResult;
  evidenceArtifacts: {
    passed: boolean;
    message?: string;
  };
  approvedReviewArtifact: {
    passed: boolean;
    message?: string;
    latestItems?: readonly {
      id: string;
      sourceItemPath: string;
    }[];
  };
  attestations: unknown;
}): DogfoodExitGateResult {
  const activity = evaluateDogfoodActivity(input.activity);
  const parsedAttestations = dogfoodExitAttestationsSchema.safeParse(
    input.attestations,
  );
  const invalidAttestations: DogfoodExitGateFinding[] =
    parsedAttestations.success
      ? parsedAttestations.data.candidateCommit === input.candidateCommit
        ? []
        : [
            {
              code: 'attestation-candidate-mismatch',
              message: `Attestations target ${parsedAttestations.data.candidateCommit}, not candidate ${input.candidateCommit}.`,
              path: 'attestations.candidateCommit',
            },
          ]
      : [
          {
            code: 'invalid-attestations',
            message: `Attestations failed schema validation with ${parsedAttestations.error.issues.length} finding(s); first: ${parsedAttestations.error.issues[0]?.message ?? 'unknown schema error'}.`,
            path: `attestations.${parsedAttestations.error.issues[0]?.path.join('.') ?? ''}`,
          },
        ];
  const attestations = parsedAttestations.success
    ? parsedAttestations.data
    : null;
  const gates: DogfoodExitGateResult['gates'] = [];

  gates.push(
    gate(
      'dogfood-activity',
      activity.findings.map((finding) => ({ ...finding })),
    ),
  );

  const recoveryFindings = [...invalidAttestations];
  if (attestations !== null) {
    const recovery = attestations.freshProfileRecovery;
    const events = collectParsedEvents(input.activity);
    const exported = events.find(
      (event) =>
        event.kind === 'portable-backup-exported' &&
        event.id === recovery.exportEventId,
    );
    const imported = events.find(
      (event) =>
        event.kind === 'portable-backup-imported' &&
        event.id === recovery.importEventId,
    );
    if (
      !recovery.freshProfile ||
      recovery.outcome !== 'passed' ||
      exported === undefined ||
      imported === undefined ||
      exported.occurredAt >= imported.occurredAt
    ) {
      recoveryFindings.push({
        code: 'fresh-profile-recovery-incomplete',
        message:
          'Recovery must link a successful export to a later import in a verified fresh profile.',
        path: 'attestations.freshProfileRecovery',
      });
    }
  }
  gates.push(gate('fresh-profile-recovery', recoveryFindings));

  const smokeFindings: DogfoodExitGateFinding[] = [];
  if (!input.smoke.passed || input.smoke.summary.supportedPageCount < 20) {
    smokeFindings.push({
      code: 'supported-reading-surface-incomplete',
      message:
        input.smoke.message ??
        'The complete 20-page Supported Reading Surface and accessibility matrix must pass.',
      path: 'smoke',
    });
  }
  gates.push(gate('supported-reading-surface', smokeFindings));

  gates.push(
    gate(
      'integrated-resilience',
      input.resilience.passed
        ? []
        : [
            {
              code: 'integrated-resilience-incomplete',
              message:
                input.resilience.message ??
                'The complete integrated resilience matrix must pass with no unresolved blocker.',
              path: 'resilience',
            },
          ],
    ),
  );

  const reviewFindings = [...invalidAttestations];
  if (!input.approvedReviewArtifact.passed) {
    reviewFindings.push({
      code: 'approved-review-source-invalid',
      message:
        input.approvedReviewArtifact.message ??
        'The approved Review Item source artifact is missing or its SHA-256 digest does not match.',
      path: 'attestations.approvedReviewAudit.sourceArtifact',
    });
  }
  if (attestations !== null) {
    const audit = attestations.approvedReviewAudit;
    const latestIds = new Set(audit.latestApprovedItemIds);
    const inspectionIds = new Set(
      audit.inspections.map((inspection) => inspection.reviewItemId),
    );
    const inspectionPaths = new Set(
      audit.inspections.map((inspection) => inspection.sourceItemPath),
    );
    const inspectionsById = new Map(
      audit.inspections.map((inspection) => [
        inspection.reviewItemId,
        inspection,
      ]),
    );
    const expectedLatestItems =
      input.approvedReviewArtifact.latestItems ?? [];
    const sourceInventoryMatches =
      expectedLatestItems.length === 50 &&
      audit.latestApprovedItemIds.every(
        (id, index) => expectedLatestItems[index]?.id === id,
      ) &&
      expectedLatestItems.every(
        ({ id, sourceItemPath }) =>
          inspectionsById.get(id)?.sourceItemPath === sourceItemPath,
      );
    const incompleteInspection = audit.inspections.some((inspection) =>
      Object.values(inspection.checks).some((complete) => !complete),
    );
    const defectsById = new Map(
      attestations.defects.map((defect) => [defect.id, defect]),
    );
    const unresolvedInspection = audit.inspections.some((inspection) => {
      if (inspection.outcome === 'passed') return false;
      const defect = defectsById.get(inspection.defectId);
      return defect?.status !== 'resolved';
    });
    if (
      latestIds.size !== 50 ||
      inspectionIds.size !== 50 ||
      inspectionPaths.size !== 50 ||
      !sourceInventoryMatches ||
      Array.from(latestIds).some((id) => !inspectionIds.has(id)) ||
      incompleteInspection ||
      unresolvedInspection
    ) {
      reviewFindings.push({
        code: 'approved-review-audit-incomplete',
        message:
          'All latest 50 approved Review Items require unique, complete, source-linked inspection and every discovered defect must be resolved.',
        path: 'attestations.approvedReviewAudit',
      });
    }
  }
  gates.push(gate('approved-review-quality', reviewFindings));

  const defectFindings = [...invalidAttestations];
  if (
    attestations !== null &&
    attestations.defects.some((defect) => defect.status !== 'resolved')
  ) {
    defectFindings.push({
      code: 'unresolved-critical-defect',
      message:
        'Data, credential, budget, Evidence Pack, import, remote-logic, provenance, and linguistic defects must all be resolved.',
      path: 'attestations.defects',
    });
  }
  gates.push(gate('critical-defects', defectFindings));

  const accessibilityFindings = [...invalidAttestations];
  if (!input.localLatency.passed) {
    accessibilityFindings.push({
      code: 'local-latency-evidence-invalid',
      message:
        input.localLatency.message ??
        'Local anchored-surface latency evidence is missing, incomplete, or over budget.',
      path: 'attestations.latency.localUiArtifact',
    });
  }
  if (attestations !== null) {
    const windows = attestations.accessibility.find(
      (entry) =>
        entry.os === 'windows' && entry.assistiveTechnology === 'nvda',
    );
    const macos = attestations.accessibility.find(
      (entry) =>
        entry.os === 'macos' && entry.assistiveTechnology === 'voiceover',
    );
    if (
      !completeCoreFlow(attestations.keyboardOnly) ||
      !completeCoreFlow(windows) ||
      !completeCoreFlow(macos) ||
      !attestations.latency.separated ||
      attestations.latency.localUiArtifact ===
        attestations.latency.providerArtifact
    ) {
      accessibilityFindings.push({
        code: 'accessibility-or-latency-incomplete',
        message:
          'Keyboard command, manual NVDA, manual VoiceOver, and separately reported local/provider latency evidence must pass.',
        path: 'attestations.accessibility',
      });
    }
  }
  gates.push(
    gate('accessibility-and-latency', accessibilityFindings),
  );

  const summaryFindings = [...invalidAttestations];
  if (!input.evidenceArtifacts.passed) {
    summaryFindings.push({
      code: 'release-evidence-artifact-invalid',
      message:
        input.evidenceArtifacts.message ??
        'One or more release evidence links are missing or exceed the pack limit.',
      path: 'attestations.evidenceSummaryLinks',
    });
  }
  if (attestations !== null) {
    const linkedKinds = new Set(
      attestations.evidenceSummaryLinks.map((link) => link.kind),
    );
    const missingKinds = evidenceSummaryKindSchema.options.filter(
      (kind) => !linkedKinds.has(kind),
    );
    if (
      missingKinds.length > 0 ||
      attestations.licenseProvenanceReview.outcome !== 'passed'
    ) {
      summaryFindings.push({
        code: 'release-evidence-summary-incomplete',
        message: `Release evidence summary is incomplete${
          missingKinds.length === 0 ? '' : `; missing ${missingKinds.join(', ')}`
        }.`,
        path: 'attestations.evidenceSummaryLinks',
      });
    }
  }
  gates.push(gate('release-evidence-summary', summaryFindings));

  const publicReleaseFindings = [...invalidAttestations];
  if (
    attestations !== null &&
    !attestations.publicRelease.chromeWebStoreBlocked
  ) {
    publicReleaseFindings.push({
      code: 'public-release-not-blocked',
      message:
        'Chrome Web Store publication must remain blocked on the separate backend-proxy and public-release contract.',
      path: 'attestations.publicRelease',
    });
  }
  gates.push(gate('public-release-block', publicReleaseFindings));

  return {
    passed: gates.every((candidate) => candidate.status === 'passed'),
    gates,
    activity: activity.summary,
    evidenceSummaryLinks: attestations?.evidenceSummaryLinks ?? [],
  };
}

export function parseDogfoodExitAttestations(
  value: unknown,
): DogfoodExitAttestations {
  return dogfoodExitAttestationsSchema.parse(value);
}

function gate(
  id: DogfoodExitGateId,
  findings: DogfoodExitGateFinding[],
): DogfoodExitGateResult['gates'][number] {
  return {
    id,
    status: findings.length === 0 ? 'passed' : 'failed',
    findings,
  };
}

function collectParsedEvents(values: readonly unknown[]): DogfoodActivityEvent[] {
  const events: DogfoodActivityEvent[] = [];
  for (const value of values) {
    try {
      events.push(...parseDogfoodActivitySnapshot(value).events);
    } catch {
      continue;
    }
  }
  return events;
}

function completeCoreFlow(
  run:
    | DogfoodExitAttestations['keyboardOnly']
    | DogfoodExitAttestations['accessibility'][number]
    | undefined,
): boolean {
  return (
    run?.outcome === 'passed' &&
    run.configuredCommandEntered &&
    run.coreFlowCompleted
  );
}

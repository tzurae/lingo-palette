import { describe, expect, it } from 'vitest';
import type {
  DogfoodActivityEvent,
  DogfoodActivityInput,
  DogfoodActivitySnapshot,
} from './activity-store';
import {
  evaluateDogfoodActivity,
  evaluateDogfoodExitGate,
} from './exit-gate';

function event(
  id: string,
  localDate: string,
  activity: DogfoodActivityInput,
): DogfoodActivityEvent {
  return {
    version: 1,
    id,
    occurredAt: `${localDate}T12:00:00.000Z`,
    localDate,
    ...activity,
  } as DogfoodActivityEvent;
}

function thresholdActivity(): DogfoodActivitySnapshot {
  const events: DogfoodActivityEvent[] = [];
  for (let index = 0; index < 100; index += 1) {
    events.push(
      event(`selection-${index}`, index === 99 ? '2026-08-24' : '2026-08-11', {
        kind: 'selection',
        origin: `https://site-${index % 10}.example`,
      }),
    );
  }
  for (let index = 0; index < 30; index += 1) {
    events.push(
      event(`learning-${index}`, '2026-08-12', {
        kind: 'learning-item-saved',
        learningItemId: `learning-${index}`,
        origin: `https://site-${index % 10}.example`,
      }),
    );
  }
  for (let index = 0; index < 5; index += 1) {
    events.push(
      event(
        `review-${index}`,
        ['2026-08-11', '2026-08-17', '2026-08-24'][index % 3]!,
        {
          kind: 'review-session-completed',
          reviewSessionId: `session-${index}`,
        },
      ),
    );
  }
  for (let index = 0; index < 20; index += 1) {
    events.push(
      event(`playback-${index}`, '2026-08-18', {
        kind: 'pronunciation-playback-completed',
        origin: 'https://site-0.example',
        variety: index % 2 === 0 ? 'en-US' : 'en-GB',
        sentenceCount: index < 5 ? 2 : 1,
      }),
    );
  }
  events.push(
    event('backup-export', '2026-08-23', {
      kind: 'portable-backup-exported',
      backupFilename: 'lingo-palette-backup-2026-08-23.json',
    }),
    event('backup-import', '2026-08-24', {
      kind: 'portable-backup-imported',
      importReportId: 'report-1',
    }),
  );
  return {
    version: 1,
    runId: 'run-1',
    enabled: true,
    startedAt: '2026-08-11T08:00:00.000Z',
    startedLocalDate: '2026-08-11',
    events,
  };
}

describe('dogfood exit gate', () => {
  it('passes exactly at every documented activity threshold', () => {
    expect(evaluateDogfoodActivity([thresholdActivity()])).toEqual({
      passed: true,
      findings: [],
      summary: {
        calendarSpanDays: 14,
        selectionCount: 100,
        enabledSiteDomainCount: 10,
        savedLearningItemCount: 30,
        completedReviewSessionCount: 5,
        reviewSessionDayCount: 3,
        pronunciationPlaybackCount: 20,
        multiSentencePlaybackCount: 5,
        pronunciationVarieties: ['en-GB', 'en-US'],
        successfulBackupSequenceCount: 1,
      },
    });
  });

  it('passes only a complete auditable release evidence bundle', () => {
    const latestApprovedItemIds = Array.from(
      { length: 50 },
      (_, index) => `review-item-${index}`,
    );
    const input = {
      candidateCommit: 'a'.repeat(40),
      activity: [thresholdActivity()],
      smoke: {
        passed: true,
        findings: [],
        summary: { supportedPageCount: 20 },
      },
      resilience: { passed: true, findings: [] },
      localLatency: { passed: true, findings: [] },
      evidenceArtifacts: { passed: true },
      approvedReviewArtifact: {
        passed: true,
        latestItems: latestApprovedItemIds.map((id, index) => ({
          id,
          sourceItemPath: `records.${index}`,
        })),
      },
      attestations: {
        schemaVersion: 1,
        candidateCommit: 'a'.repeat(40),
        recordedAt: '2026-08-24T18:00:00.000Z',
        reviewer: 'Learner',
        keyboardOnly: {
          completedAt: '2026-08-23T09:00:00.000Z',
          outcome: 'passed',
          configuredCommandEntered: true,
          coreFlowCompleted: true,
          evidenceLinks: ['artifacts/keyboard-core-flow.webm'],
        },
        freshProfileRecovery: {
          exportEventId: 'backup-export',
          importEventId: 'backup-import',
          freshProfile: true,
          outcome: 'passed',
          evidenceLinks: ['artifacts/fresh-profile-recovery.png'],
        },
        approvedReviewAudit: {
          sourceArtifact: 'artifacts/approved-review-items.json',
          inventoryDigest:
            'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          latestApprovedItemIds,
          inspections: latestApprovedItemIds.map((reviewItemId, index) => ({
            reviewItemId,
            inspectedAt: '2026-08-24T16:00:00.000Z',
            sourceItemPath: `records.${index}`,
            checks: {
              answerRuleExact: true,
              validAlternativesComplete: true,
              distractorsSafe: true,
              evidenceExcerptVerified: true,
              provenanceVerified: true,
              sourceAttributionsVerified: true,
              inspectionReadable: true,
            },
            outcome: 'passed' as const,
          })),
        },
        defects: [],
        accessibility: [
          {
            os: 'windows',
            assistiveTechnology: 'nvda',
            completedAt: '2026-08-23T10:00:00.000Z',
            outcome: 'passed',
            configuredCommandEntered: true,
            coreFlowCompleted: true,
            evidenceLinks: ['artifacts/nvda-core-flow.webm'],
          },
          {
            os: 'macos',
            assistiveTechnology: 'voiceover',
            completedAt: '2026-08-23T11:00:00.000Z',
            outcome: 'passed',
            configuredCommandEntered: true,
            coreFlowCompleted: true,
            evidenceLinks: ['artifacts/voiceover-core-flow.webm'],
          },
        ],
        latency: {
          localUiArtifact: 'artifacts/local-ui-latency.json',
          providerArtifact: 'artifacts/provider-latency.json',
          separated: true,
        },
        licenseProvenanceReview: {
          completedAt: '2026-08-24T17:00:00.000Z',
          outcome: 'passed',
          evidenceLinks: ['public/THIRD_PARTY_NOTICES.txt'],
        },
        evidenceSummaryLinks: [
          { kind: 'usage-log', artifact: 'artifacts/dogfood-activity.json' },
          {
            kind: 'supported-surface-matrix',
            artifact: 'artifacts/supported-pages.json',
          },
          {
            kind: 'resilience-matrix',
            artifact: 'artifacts/resilience-evidence.json',
          },
          {
            kind: 'approved-item-inspection',
            artifact: 'artifacts/approved-review-items.json',
          },
          {
            kind: 'defect-regressions',
            artifact: 'artifacts/defects.json',
          },
          {
            kind: 'license-provenance',
            artifact: 'public/THIRD_PARTY_NOTICES.txt',
          },
        ],
        publicRelease: {
          chromeWebStoreBlocked: true,
          blocker: 'backend-proxy-and-public-release-contract',
        },
      },
    };
    const result = evaluateDogfoodExitGate(input);

    expect(result.passed).toBe(true);
    expect(result.gates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'dogfood-activity', status: 'passed' }),
        expect.objectContaining({ id: 'fresh-profile-recovery', status: 'passed' }),
        expect.objectContaining({ id: 'supported-reading-surface', status: 'passed' }),
        expect.objectContaining({ id: 'integrated-resilience', status: 'passed' }),
        expect.objectContaining({ id: 'approved-review-quality', status: 'passed' }),
        expect.objectContaining({ id: 'critical-defects', status: 'passed' }),
        expect.objectContaining({ id: 'accessibility-and-latency', status: 'passed' }),
        expect.objectContaining({ id: 'release-evidence-summary', status: 'passed' }),
        expect.objectContaining({ id: 'public-release-block', status: 'passed' }),
      ]),
    );
    const wrongInventory = evaluateDogfoodExitGate({
      ...input,
      approvedReviewArtifact: {
        passed: true,
        latestItems: input.approvedReviewArtifact.latestItems.map(
          (item, index) =>
            index === 0 ? { ...item, id: 'not-the-latest-item' } : item,
        ),
      },
    });
    expect(
      wrongInventory.gates.find(
        (gate) => gate.id === 'approved-review-quality',
      ),
    ).toMatchObject({
      status: 'failed',
      findings: [
        expect.objectContaining({
          code: 'approved-review-audit-incomplete',
        }),
      ],
    });
    const overBudgetLatency = evaluateDogfoodExitGate({
      ...input,
      localLatency: {
        passed: false,
        message: 'windows/pointer/top-level exceeds 100 ms p95.',
        findings: [{ code: 'budget-exceeded' }],
      },
    });
    expect(
      overBudgetLatency.gates.find(
        (gate) => gate.id === 'accessibility-and-latency',
      ),
    ).toMatchObject({
      status: 'failed',
      findings: [
        expect.objectContaining({
          code: 'local-latency-evidence-invalid',
        }),
      ],
    });
    const combinedLatencyArtifact = evaluateDogfoodExitGate({
      ...input,
      attestations: {
        ...input.attestations,
        latency: {
          localUiArtifact: 'artifacts/combined-latency.json',
          providerArtifact: 'artifacts/combined-latency.json',
          separated: true,
        },
      },
    });
    expect(
      combinedLatencyArtifact.gates.find(
        (gate) => gate.id === 'accessibility-and-latency',
      ),
    ).toMatchObject({
      status: 'failed',
      findings: [
        expect.objectContaining({
          code: 'accessibility-or-latency-incomplete',
        }),
      ],
    });
  });

  it('fails closed when real usage, matrices, or attestations are missing', () => {
    const result = evaluateDogfoodExitGate({
      candidateCommit: 'a'.repeat(40),
      activity: [],
      smoke: {
        passed: false,
        findings: [{ code: 'missing-accessibility-run' }],
        summary: { supportedPageCount: 20 },
      },
      resilience: {
        passed: false,
        findings: [{ code: 'missing-row' }],
      },
      localLatency: {
        passed: false,
        findings: [{ code: 'missing-group' }],
      },
      evidenceArtifacts: {
        passed: false,
        message: 'Release evidence artifact is missing.',
      },
      approvedReviewArtifact: {
        passed: false,
        message: 'Approved Review Item source artifact is missing.',
      },
      attestations: {},
    });

    expect(result.passed).toBe(false);
    expect(result.gates).toHaveLength(9);
    expect(result.gates.every((gate) => gate.status === 'failed')).toBe(true);
    expect(
      result.gates.find((gate) => gate.id === 'dogfood-activity')?.findings,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'activity-span' }),
        expect.objectContaining({ code: 'selection-count' }),
        expect.objectContaining({ code: 'backup-recovery' }),
      ]),
    );
    expect(
      result.gates.find((gate) => gate.id === 'fresh-profile-recovery')
        ?.findings,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid-attestations' }),
      ]),
    );
  });
});

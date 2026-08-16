import { describe, expect, it } from 'vitest';
import { renderDogfoodReleaseReport } from './release-report';

describe('dogfood release report', () => {
  it('renders a fail-closed review surface without injecting evidence text', () => {
    const html = renderDogfoodReleaseReport({
      generatedAt: '2026-08-16T12:00:00.000Z',
      candidateCommit: 'pending',
      result: {
        passed: false,
        activity: {
          calendarSpanDays: 0,
          selectionCount: 0,
          enabledSiteDomainCount: 0,
          savedLearningItemCount: 0,
          completedReviewSessionCount: 0,
          reviewSessionDayCount: 0,
          pronunciationPlaybackCount: 0,
          multiSentencePlaybackCount: 0,
          pronunciationVarieties: [],
          successfulBackupSequenceCount: 0,
        },
        gates: [
          {
            id: 'dogfood-activity',
            status: 'failed',
            findings: [
              {
                code: 'selection-count',
                message: '<script>unsafe evidence</script>',
                path: 'activity.events',
              },
            ],
          },
        ],
        evidenceSummaryLinks: [
          {
            kind: 'usage-log',
            artifact: 'artifacts/dogfood-activity.json',
          },
          {
            kind: 'license-provenance',
            artifact: 'javascript:alert(1)',
          },
        ],
      },
    });

    expect(html).toContain('尚未通過');
    expect(html).toContain('&lt;script&gt;unsafe evidence&lt;/script&gt;');
    expect(html).not.toContain('<script>unsafe evidence</script>');
    expect(html).toContain(
      'href="artifacts/dogfood-activity.json"',
    );
    expect(html).not.toContain('href="javascript:alert(1)"');
  });
});

import type {
  DogfoodExitGateId,
  DogfoodExitGateResult,
} from './exit-gate.ts';

const gateLabels: Record<DogfoodExitGateId, string> = {
  'dogfood-activity': '14 日真實 Reading Flow 活動',
  'fresh-profile-recovery': 'Fresh-profile export → import 復原',
  'supported-reading-surface': 'Supported Reading Surface 與 accessibility matrix',
  'integrated-resilience': 'Integrated resilience matrix',
  'approved-review-quality': 'Latest 50 approved Review Items',
  'critical-defects': 'Critical 與 linguistic defects',
  'accessibility-and-latency': 'Manual accessibility 與 latency 分離',
  'release-evidence-summary': 'Release evidence summary 與 provenance',
  'public-release-block': 'Chrome Web Store publication block',
};

export function renderDogfoodReleaseReport(input: {
  generatedAt: string;
  candidateCommit: string;
  result: DogfoodExitGateResult;
}): string {
  const { result } = input;
  const { activity } = result;
  const cards = [
    ['日曆跨度', activity.calendarSpanDays, 14],
    ['Selections', activity.selectionCount, 100],
    ['Enabled Site domains', activity.enabledSiteDomainCount, 10],
    ['Saved Learning Items', activity.savedLearningItemCount, 30],
    ['Review Sessions', activity.completedReviewSessionCount, 5],
    ['Review days', activity.reviewSessionDayCount, 3],
    ['Pronunciation Playbacks', activity.pronunciationPlaybackCount, 20],
    ['Multi-sentence Playbacks', activity.multiSentencePlaybackCount, 5],
    ['Export → import', activity.successfulBackupSequenceCount, 1],
  ] as const;
  const cardMarkup = cards
    .map(([label, actual, target]) => {
      const complete = actual >= target;
      return `<article class="metric ${complete ? 'passed' : 'pending'}"><strong>${escapeHtml(label)}</strong><span>${actual.toLocaleString('en-US')} / ${target.toLocaleString('en-US')}</span></article>`;
    })
    .join('');
  const gateMarkup = result.gates
    .map((candidate) => {
      const findingMarkup =
        candidate.findings.length === 0
          ? '<span class="finding-none">沒有 finding</span>'
          : `<ul>${candidate.findings
              .map(
                (finding) =>
                  `<li><code>${escapeHtml(finding.code)}</code> ${escapeHtml(finding.message)} <small>${escapeHtml(finding.path)}</small></li>`,
              )
              .join('')}</ul>`;
      return `<tr><td>${escapeHtml(gateLabels[candidate.id])}</td><td><span class="status ${candidate.status}">${candidate.status === 'passed' ? '通過' : '未通過'}</span></td><td>${findingMarkup}</td></tr>`;
    })
    .join('');
  const evidenceLinkMarkup =
    result.evidenceSummaryLinks.length === 0
      ? '<p class="finding-none">尚未提供完整 release evidence links。</p>'
      : `<ul class="evidence-links">${result.evidenceSummaryLinks
          .map(({ kind, artifact }) => {
            const label = `<code>${escapeHtml(kind)}</code>`;
            return `<li>${label}：${renderArtifactReference(artifact)}</li>`;
          })
          .join('')}</ul>`;
  const overall = result.passed ? '已通過' : '尚未通過';

  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lingo Palette unpacked dogfood exit gate</title>
<style>
:root { color-scheme: light; font-family: Inter, "Noto Sans TC", system-ui, sans-serif; color: #18231d; background: #edf3ee; }
body { margin: 0; }
main { width: min(1180px, calc(100% - 32px)); margin: 32px auto 64px; }
header { padding: 28px; border-radius: 18px; background: #18392a; color: #f7fbf8; box-shadow: 0 14px 35px #18392a2b; }
h1 { margin: 0 0 12px; font-size: clamp(1.7rem, 4vw, 2.6rem); }
header p { margin: 5px 0; color: #d7e6dc; }
.overall { display: inline-block; margin-top: 16px; padding: 8px 13px; border-radius: 999px; font-weight: 800; background: ${result.passed ? '#bfe6cb' : '#ffd3cd'}; color: ${result.passed ? '#123f23' : '#742114'}; }
section { margin-top: 24px; padding: 24px; border: 1px solid #cedbd1; border-radius: 16px; background: #fff; }
h2 { margin-top: 0; }
.metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; }
.metric { display: grid; gap: 10px; padding: 16px; border-radius: 12px; border: 1px solid; }
.metric span { font-size: 1.45rem; font-variant-numeric: tabular-nums; }
.metric.passed { background: #edf9f0; border-color: #8bc79a; }
.metric.pending { background: #fff4f1; border-color: #e9a69b; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 13px 12px; border-bottom: 1px solid #dfe7e1; text-align: left; vertical-align: top; }
th { color: #455b4b; font-size: .86rem; text-transform: uppercase; letter-spacing: .04em; }
.status { display: inline-block; padding: 4px 8px; border-radius: 999px; white-space: nowrap; font-weight: 700; }
.status.passed { color: #19542b; background: #d9f1df; }
.status.failed { color: #7a2418; background: #ffe0db; }
ul { margin: 0; padding-left: 20px; }
li + li { margin-top: 7px; }
code { color: #6c261b; }
small { display: block; color: #607066; margin-top: 3px; }
.finding-none { color: #386246; }
.evidence-links code { color: #234d34; }
.evidence-links a { color: #155f38; overflow-wrap: anywhere; }
.notice { border-left: 5px solid #b96a22; background: #fff8e9; }
@media (max-width: 760px) { main { width: min(100% - 20px, 1180px); margin-top: 10px; } section, header { padding: 18px; } table, tbody, tr, td { display: block; } thead { display: none; } td { border: 0; padding: 8px 0; } tr { display: block; padding: 12px 0; border-bottom: 1px solid #dfe7e1; } }
</style>
</head>
<body>
<main>
<header>
<h1>Unpacked dogfood exit gate</h1>
<p>Candidate commit：${escapeHtml(input.candidateCommit)}</p>
<p>Report generated：${escapeHtml(input.generatedAt)}</p>
<span class="overall">${overall}</span>
</header>
<section>
<h2>真實使用門檻</h2>
<div class="metrics">${cardMarkup}</div>
<p>Pronunciation varieties：${escapeHtml(activity.pronunciationVarieties.join(', ') || '尚無')}</p>
</section>
<section>
<h2>逐 gate evidence</h2>
<table><thead><tr><th>Gate</th><th>狀態</th><th>Findings</th></tr></thead><tbody>${gateMarkup}</tbody></table>
</section>
<section>
<h2>Release evidence links</h2>
${evidenceLinkMarkup}
</section>
<section class="notice">
<h2>Public release 仍然封鎖</h2>
<p>本報告只判定 unpacked dogfood。Chrome Web Store publication 仍依 First Release Contract 封鎖於獨立的 backend-proxy 與 public-release contract；不得把本 gate 的 pass 當成 store publication 核准。</p>
</section>
</main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case "'":
        return '&#39;';
      default:
        return '&quot;';
    }
  });
}

function renderArtifactReference(value: string): string {
  const escaped = escapeHtml(value);
  return isSafeArtifactHref(value)
    ? `<a href="${escaped}">${escaped}</a>`
    : `<code>${escaped}</code>`;
}

function isSafeArtifactHref(value: string): boolean {
  if (/^https:\/\//i.test(value)) return true;
  return !/^(?:[a-z][a-z0-9+.-]*:|[/\\])/i.test(value);
}

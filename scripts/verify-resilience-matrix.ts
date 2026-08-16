import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { unzipSync } from 'fflate';
import { buildResilienceEvidence } from '../src/modules/resilience/resilience-evidence.ts';
import { verifyResilienceEvidence } from '../src/modules/resilience/resilience-matrix.ts';
import { inspectReleasePackage } from '../src/modules/resilience/release-package.ts';

const executeFile = promisify(execFile);
const resultsDirectory = resolve('.resilience-results');
const vitestArtifact = resolve(resultsDirectory, 'vitest.json');
const packageArtifact = resolve(resultsDirectory, 'package-inspection.json');
const evidenceArtifact = resolve(resultsDirectory, 'resilience-evidence.json');
const reportArtifact = resolve(resultsDirectory, 'resilience-matrix.html');

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function currentCommit(): Promise<string> {
  if (process.env.GITHUB_SHA !== undefined && process.env.GITHUB_SHA.length > 0) {
    return process.env.GITHUB_SHA;
  }
  const { stdout } = await executeFile('git', ['rev-parse', 'HEAD'], {
    cwd: resolve('.'),
    windowsHide: true,
  });
  return stdout.trim();
}

async function chromeReleaseArchive(): Promise<{
  path: string;
  entries: Record<string, Uint8Array>;
}> {
  const outputDirectory = resolve('.output');
  const names = await readdir(outputDirectory);
  const archiveName = names
    .filter((name) => name.endsWith('-chrome.zip'))
    .sort()
    .at(-1);
  if (archiveName === undefined) {
    throw new Error('Expected a Chrome release archive in .output.');
  }
  const path = resolve(outputDirectory, archiveName);
  return {
    path,
    entries: unzipSync(new Uint8Array(await readFile(path))),
  };
}

function renderReport(
  evidence: ReturnType<typeof buildResilienceEvidence>,
  packagePath: string,
): string {
  const passed = evidence.rows.filter((row) => row.outcome === 'passed').length;
  const riskAreas = new Map<string, { passed: number; total: number }>();
  for (const row of evidence.rows) {
    const counts = riskAreas.get(row.riskArea) ?? { passed: 0, total: 0 };
    counts.total += 1;
    if (row.outcome === 'passed') counts.passed += 1;
    riskAreas.set(row.riskArea, counts);
  }
  const cards = Array.from(riskAreas, ([riskArea, counts]) => `
    <article class="card">
      <span>${escapeHtml(riskArea)}</span>
      <strong>${counts.passed}/${counts.total}</strong>
    </article>`).join('');
  const rows = evidence.rows.map((row) => `
    <tr>
      <td><span class="status ${row.outcome}">${row.outcome}</span><code>${escapeHtml(row.id)}</code></td>
      <td>${escapeHtml(row.setup)}</td>
      <td>${escapeHtml(row.injectedFault)}</td>
      <td>${escapeHtml(row.observableLearnerState)}</td>
      <td>${escapeHtml(row.persistedAftermath)}</td>
      <td>${escapeHtml(row.budgetEffect)}</td>
      <td>${escapeHtml(row.recoveryAction)}</td>
      <td>${row.evidence.map((item) => `<div class="evidence"><b>${escapeHtml(item.status)}</b> ${escapeHtml(item.id)}</div>`).join('')}</td>
    </tr>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lingo Palette resilience matrix</title>
<style>
  :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #17202a; background: #f4f7fb; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px; }
  header { background: linear-gradient(135deg, #173b57, #246b73); color: white; border-radius: 18px; padding: 28px 32px; box-shadow: 0 16px 40px #173b5722; }
  h1 { margin: 0 0 8px; font-size: 30px; }
  header p { margin: 4px 0; color: #e6f4f1; }
  .summary { display: grid; grid-template-columns: repeat(4, minmax(180px, 1fr)); gap: 12px; margin: 18px 0; }
  .card { background: white; border: 1px solid #dbe4ec; border-radius: 12px; padding: 15px; display: flex; justify-content: space-between; gap: 12px; box-shadow: 0 6px 18px #173b570d; }
  .card span { color: #526474; }
  .card strong { color: #146c43; }
  .meta { background: #e9f4f0; border-left: 4px solid #2f8f6b; padding: 12px 16px; margin-bottom: 18px; }
  .table-wrap { overflow-x: auto; background: white; border: 1px solid #dbe4ec; border-radius: 14px; }
  table { border-collapse: collapse; min-width: 2200px; width: 100%; font-size: 12px; line-height: 1.45; }
  th { position: sticky; top: 0; background: #edf3f7; color: #344a5c; text-align: left; padding: 11px; border-bottom: 1px solid #cbd8e2; }
  td { vertical-align: top; padding: 11px; border-bottom: 1px solid #e6edf2; max-width: 290px; }
  tr:hover td { background: #f7fbfd; }
  code { display: block; margin-top: 7px; color: #40566a; font-size: 11px; }
  .status { display: inline-block; border-radius: 999px; padding: 2px 8px; font-weight: 700; text-transform: uppercase; font-size: 10px; }
  .status.passed { color: #0c633d; background: #d9f4e7; }
  .status.failed { color: #9f2430; background: #ffe1e4; }
  .evidence { margin-bottom: 7px; overflow-wrap: anywhere; }
  .evidence b { color: #0c633d; text-transform: uppercase; font-size: 10px; }
</style>
</head>
<body>
<header>
  <h1>Integrated resilience &amp; recovery matrix</h1>
  <p>${passed}/${evidence.rows.length} rows passed · plan ${escapeHtml(evidence.planVersion)}</p>
  <p>Commit ${escapeHtml(evidence.extensionCommit)} · ${escapeHtml(evidence.recordedAt)}</p>
</header>
<section class="summary">${cards}</section>
<p class="meta"><b>Built archive:</b> ${escapeHtml(packagePath)}<br><b>Run:</b> ${escapeHtml(evidence.runId)}</p>
<div class="table-wrap">
<table>
  <thead><tr><th>Row</th><th>Setup</th><th>Injected / real fault</th><th>Observable Learner state</th><th>Persisted aftermath</th><th>Budget effect</th><th>Recovery action</th><th>Evidence</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
</div>
</body>
</html>`;
}

await mkdir(resultsDirectory, { recursive: true });
const [vitestReport, release, extensionCommit] = await Promise.all([
  readFile(vitestArtifact, 'utf8').then((text) => JSON.parse(text) as unknown),
  chromeReleaseArchive(),
  currentCommit(),
]);
const packageInspection = inspectReleasePackage(release.entries);
await writeFile(
  packageArtifact,
  `${JSON.stringify(packageInspection, null, 2)}\n`,
  'utf8',
);
const recordedAt = new Date().toISOString();
const evidence = buildResilienceEvidence({
  vitestReport,
  vitestArtifact: '.resilience-results/vitest.json',
  packageInspection,
  packageArtifact: '.resilience-results/package-inspection.json',
  runId: `resilience-${recordedAt.replaceAll(/[:.]/g, '-')}`,
  extensionCommit,
  recordedAt,
});
const verification = verifyResilienceEvidence(evidence);
await Promise.all([
  writeFile(evidenceArtifact, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8'),
  writeFile(reportArtifact, renderReport(evidence, release.path), 'utf8'),
]);
console.log(
  JSON.stringify(
    {
      passed: verification.passed,
      rowCount: evidence.rows.length,
      failedRows: evidence.rows
        .filter((row) => row.outcome === 'failed')
        .map((row) => row.id),
      packageChecks: packageInspection.checks,
      artifacts: {
        evidence: evidenceArtifact,
        report: reportArtifact,
      },
    },
    null,
    2,
  ),
);
if (!verification.passed) {
  console.error(JSON.stringify(verification.findings, null, 2));
  process.exitCode = 1;
}

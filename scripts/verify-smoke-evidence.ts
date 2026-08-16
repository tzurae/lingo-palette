import { readFile } from 'node:fs/promises';
import {
  evaluateAutomatedSmokeEvidence,
  evaluateSmokeEvidence,
  mergeSmokeEvidence,
} from '../src/modules/smoke/smoke-evidence.ts';

const arguments_ = process.argv.slice(2);
const automated = arguments_[0] === '--automated';
const evidencePaths = automated ? arguments_.slice(1) : arguments_;
if (evidencePaths.length === 0) {
  throw new Error(
    'Usage: pnpm smoke:verify [--automated] <smoke-evidence.json> [more-evidence.json ...]',
  );
}

const evidenceRecords = await Promise.all(
  evidencePaths.map(async (evidencePath) => {
    const source = await readFile(evidencePath, 'utf8');
    return JSON.parse(source) as unknown;
  }),
);
const evidence =
  evidenceRecords.length === 1
    ? evidenceRecords[0]
    : mergeSmokeEvidence(evidenceRecords);
const result = automated
  ? evaluateAutomatedSmokeEvidence(evidence)
  : evaluateSmokeEvidence(evidence);
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;

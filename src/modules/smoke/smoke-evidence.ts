import { z } from 'zod';

const operatingSystemSchema = z.enum(['windows', 'macos']);
const surfaceSchema = z.enum(['top-level', 'same-origin-embedded']);
const inputSchema = z.enum(['pointer', 'keyboard']);
const selectionKindSchema = z.enum([
  'word',
  'phrase',
  'sentence',
  'multi-sentence',
]);
const placementSchema = z.enum(['viewport-edge', 'after-scroll']);
const permissionStateSchema = z.enum(['enabled', 'excluded']);
const outcomeSchema = z.enum(['passed', 'failed', 'unsupported']);
export const SMOKE_FLOW_NAMES = [
  'quick-hint',
  'deep-dive-current',
  'recent',
  'saved',
  'pronunciation',
  'review-session',
  'backup-import',
  'evidence-pack-status',
] as const;
const flowSchema = z.enum(SMOKE_FLOW_NAMES);
export const SMOKE_ANNOUNCEMENT_STATES = [
  'working',
  'saved',
  'result-count',
  'retry',
  'offline',
  'playback',
  'budget',
  'import',
  'error',
] as const;
const announcementStateSchema = z.enum(SMOKE_ANNOUNCEMENT_STATES);
export const SMOKE_EXCLUDED_SURFACE_KINDS = [
  'cross-origin-embedded',
  'browser-page',
  'extension-page',
  'pdf-viewer',
  'local-file',
  'canvas-or-image-text',
  'form-or-editor',
] as const;
const excludedSurfaceKindSchema = z.enum(SMOKE_EXCLUDED_SURFACE_KINDS);
const accessibilityMethodSchema = z.enum([
  'keyboard-only',
  'visual-focus',
  'automated',
  'nvda',
  'voiceover',
]);

const auditFields = {
  expected: z.string().min(1),
  observed: z.string().min(1),
  defectLinks: z.array(z.url()),
};

const environmentSchema = z
  .object({
    id: z.string().min(1),
    os: operatingSystemSchema,
    osVersion: z.string().min(1),
    browserVersion: z.string().min(1),
    extensionCommit: z.string().regex(/^[0-9a-f]{40}$/),
  })
  .strict();

const pageCaseSchema = z
  .object({
    id: z.string().min(1),
    domain: z.string().regex(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/),
    path: z.string().startsWith('/'),
    surface: surfaceSchema,
    selectionKind: selectionKindSchema,
    input: inputSchema,
    placement: placementSchema,
    zoomPercent: z.union([z.literal(100), z.literal(200)]),
  })
  .strict();

const pageRunSchema = z
  .object({
    caseId: z.string().min(1),
    environmentId: z.string().min(1),
    permissionState: permissionStateSchema,
    ...auditFields,
    outcome: outcomeSchema,
    accessibilityMethods: z.array(accessibilityMethodSchema).min(1),
    latencyMs: z.number().nonnegative().finite(),
    focus: z
      .object({
        pointerSelectionPreserved: z.boolean(),
        escapeRestored: z.boolean(),
        nonModalNoTrap: z.boolean(),
      })
      .strict(),
  })
  .strict();

const excludedSurfaceRunSchema = z
  .object({
    environmentId: z.string().min(1),
    surfaceKind: excludedSurfaceKindSchema,
    permissionState: permissionStateSchema,
    ...auditFields,
    outcome: outcomeSchema,
    accessibilityMethods: z.array(accessibilityMethodSchema).min(1),
  })
  .strict();

const flowRunSchema = z
  .object({
    environmentId: z.string().min(1),
    flow: flowSchema,
    keyboardOnly: z.boolean(),
    visibleFocus: z.boolean(),
    nonColorCue: z.boolean(),
    ...auditFields,
  })
  .strict();

const announcementRunSchema = z
  .object({
    environmentId: z.string().min(1),
    state: announcementStateSchema,
    announced: z.boolean(),
    focusMoved: z.boolean(),
    ...auditFields,
  })
  .strict();

const accessibilityRunSchema = z
  .object({
    environmentId: z.string().min(1),
    reducedMotion: z.boolean(),
    highContrast: z.boolean(),
    assistiveTechnology: z.enum(['nvda', 'voiceover']),
    manualScreenReader: z.boolean(),
    configuredCommandEntered: z.boolean(),
    ...auditFields,
  })
  .strict();

const smokeEvidenceSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string().min(1),
    recordedAt: z.iso.datetime(),
    environments: z.array(environmentSchema).min(1),
    plan: z.array(pageCaseSchema).min(1),
    pageRuns: z.array(pageRunSchema),
    excludedSurfaceRuns: z.array(excludedSurfaceRunSchema),
    flowRuns: z.array(flowRunSchema),
    announcementRuns: z.array(announcementRunSchema),
    accessibilityRuns: z.array(accessibilityRunSchema),
  })
  .strict();

export type SmokeEvidence = z.infer<typeof smokeEvidenceSchema>;
export type SmokeEvidenceFinding = {
  code:
    | 'invalid-evidence'
    | 'incomplete-plan'
    | 'missing-environment'
    | 'missing-page-run'
    | 'failed-page-run'
    | 'missing-excluded-surface'
    | 'excluded-surface-supported'
    | 'missing-flow-run'
    | 'inoperable-flow'
    | 'missing-announcement-run'
    | 'inaccessible-announcement'
    | 'missing-accessibility-run'
    | 'incomplete-accessibility-run'
    | 'missing-latency-group'
    | 'latency-budget-exceeded'
    | 'missing-defect-link';
  message: string;
  path: string;
};

export type SmokeLatencyGroup = {
  os: z.infer<typeof operatingSystemSchema>;
  input: z.infer<typeof inputSchema>;
  surface: z.infer<typeof surfaceSchema>;
  sampleCount: number;
  p95Ms: number;
  maxMs: number;
};

export type SmokeEvidenceResult = {
  passed: boolean;
  findings: SmokeEvidenceFinding[];
  summary: {
    supportedPageCount: number;
    domainCount: number;
    environmentCount: number;
    pageRunCount: number;
    latencyGroups: SmokeLatencyGroup[];
  };
};

export function summarizeSmokeLatencyValues(
  values: readonly number[],
): Pick<SmokeLatencyGroup, 'sampleCount' | 'p95Ms' | 'maxMs'> {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    sampleCount: sorted.length,
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0,
    maxMs: sorted[sorted.length - 1] ?? 0,
  };
}

const requiredOperatingSystems = operatingSystemSchema.options;
const requiredSurfaces = surfaceSchema.options;
const requiredInputs = inputSchema.options;
const requiredSelectionKinds = selectionKindSchema.options;
const requiredPlacements = placementSchema.options;
const requiredZooms = [100, 200] as const;
const requiredFlows = flowSchema.options;
const requiredAnnouncementStates = announcementStateSchema.options;
const requiredExcludedSurfaces = excludedSurfaceKindSchema.options;


export function mergeSmokeEvidence(values: readonly unknown[]): SmokeEvidence {
  if (values.length === 0) {
    throw new Error('At least one smoke evidence record is required.');
  }
  const records = values.map((value) => smokeEvidenceSchema.parse(value));
  const first = records[0];
  if (first === undefined) {
    throw new Error('At least one smoke evidence record is required.');
  }
  const plan = JSON.stringify(first.plan);
  if (records.some((record) => JSON.stringify(record.plan) !== plan)) {
    throw new Error('Smoke evidence records use different maintained plans.');
  }

  return smokeEvidenceSchema.parse({
    schemaVersion: 1,
    runId: records.map((record) => record.runId).join('+'),
    recordedAt: records
      .map((record) => record.recordedAt)
      .sort()
      .at(-1),
    environments: records.flatMap((record) => record.environments),
    plan: first.plan,
    pageRuns: records.flatMap((record) => record.pageRuns),
    excludedSurfaceRuns: records.flatMap(
      (record) => record.excludedSurfaceRuns,
    ),
    flowRuns: records.flatMap((record) => record.flowRuns),
    announcementRuns: records.flatMap((record) => record.announcementRuns),
    accessibilityRuns: records.flatMap(
      (record) => record.accessibilityRuns,
    ),
  });
}
export function evaluateSmokeEvidence(value: unknown): SmokeEvidenceResult {
  return evaluateSmokeEvidenceForGate(value, true);
}

export function evaluateAutomatedSmokeEvidence(
  value: unknown,
): SmokeEvidenceResult {
  return evaluateSmokeEvidenceForGate(value, false);
}

function evaluateSmokeEvidenceForGate(
  value: unknown,
  requireCompleteEvidence: boolean,
): SmokeEvidenceResult {
  const parsed = smokeEvidenceSchema.safeParse(value);
  if (!parsed.success) {
    return {
      passed: false,
      findings: parsed.error.issues.map((issue) => ({
        code: 'invalid-evidence',
        message: issue.message,
        path: issue.path.join('.'),
      })),
      summary: emptySummary(),
    };
  }

  const evidence = parsed.data;
  const findings: SmokeEvidenceFinding[] = [];
  const environmentsById = uniqueById(
    evidence.environments,
    'environments',
    findings,
  );
  const casesById = uniqueById(evidence.plan, 'plan', findings);
  evaluatePlan(evidence, casesById, findings);

  if (requireCompleteEvidence) {
    for (const os of requiredOperatingSystems) {
      if (!evidence.environments.some((environment) => environment.os === os)) {
        findings.push({
          code: 'missing-environment',
          message: `Smoke evidence is missing the ${os} environment.`,
          path: 'environments',
        });
      }
    }
  }

  evaluatePageRuns(evidence, environmentsById, casesById, findings);
  evaluateExcludedSurfaces(evidence, environmentsById, findings);
  evaluateFlows(evidence, environmentsById, findings);
  evaluateAnnouncements(evidence, environmentsById, findings);
  evaluateAccessibility(
    evidence,
    environmentsById,
    findings,
    requireCompleteEvidence,
  );
  const latencyGroups = evaluateLatency(
    evidence,
    environmentsById,
    findings,
    requireCompleteEvidence,
  );

  return {
    passed: findings.length === 0,
    findings,
    summary: {
      supportedPageCount: casesById.size,
      domainCount: new Set(evidence.plan.map((pageCase) => pageCase.domain)).size,
      environmentCount: environmentsById.size,
      pageRunCount: evidence.pageRuns.length,
      latencyGroups,
    },
  };
}

function evaluatePlan(
  evidence: SmokeEvidence,
  casesById: ReadonlyMap<string, SmokeEvidence['plan'][number]>,
  findings: SmokeEvidenceFinding[],
): void {
  requirePlanCoverage(
    casesById.size >= 20,
    'The maintained smoke plan must contain at least 20 unique pages.',
    findings,
  );
  requirePlanCoverage(
    new Set(evidence.plan.map((pageCase) => pageCase.domain)).size >= 10,
    'The maintained smoke plan must contain at least 10 domains.',
    findings,
  );
  for (const surface of requiredSurfaces) {
    requirePlanCoverage(
      evidence.plan.some((pageCase) => pageCase.surface === surface),
      `The maintained smoke plan must cover ${surface}.`,
      findings,
    );
  }
  for (const selectionKind of requiredSelectionKinds) {
    requirePlanCoverage(
      evidence.plan.some((pageCase) => pageCase.selectionKind === selectionKind),
      `The maintained smoke plan must cover ${selectionKind} Selection.`,
      findings,
    );
  }
  for (const input of requiredInputs) {
    requirePlanCoverage(
      evidence.plan.some((pageCase) => pageCase.input === input),
      `The maintained smoke plan must cover ${input} Selection.`,
      findings,
    );
  }
  for (const placement of requiredPlacements) {
    requirePlanCoverage(
      evidence.plan.some((pageCase) => pageCase.placement === placement),
      `The maintained smoke plan must cover ${placement}.`,
      findings,
    );
  }
  for (const zoomPercent of requiredZooms) {
    requirePlanCoverage(
      evidence.plan.some((pageCase) => pageCase.zoomPercent === zoomPercent),
      `The maintained smoke plan must cover ${zoomPercent}% zoom.`,
      findings,
    );
  }
}

function requirePlanCoverage(
  condition: boolean,
  message: string,
  findings: SmokeEvidenceFinding[],
): void {
  if (condition) return;
  findings.push({ code: 'incomplete-plan', message, path: 'plan' });
}

function evaluatePageRuns(
  evidence: SmokeEvidence,
  environmentsById: ReadonlyMap<string, SmokeEvidence['environments'][number]>,
  casesById: ReadonlyMap<string, SmokeEvidence['plan'][number]>,
  findings: SmokeEvidenceFinding[],
): void {
  const pageRunsByKey = new Map<string, SmokeEvidence['pageRuns'][number]>();
  for (const [index, run] of evidence.pageRuns.entries()) {
    const key = `${run.environmentId}\u0000${run.caseId}`;
    if (pageRunsByKey.has(key)) {
      findings.push({
        code: 'invalid-evidence',
        message: `Duplicate page run for ${run.environmentId}/${run.caseId}.`,
        path: `pageRuns.${index}`,
      });
      continue;
    }
    pageRunsByKey.set(key, run);
    if (!environmentsById.has(run.environmentId) || !casesById.has(run.caseId)) {
      findings.push({
        code: 'invalid-evidence',
        message: 'Page run references an unknown environment or page case.',
        path: `pageRuns.${index}`,
      });
    }
    if (
      run.outcome !== 'passed' ||
      run.permissionState !== 'enabled' ||
      !run.focus.pointerSelectionPreserved ||
      !run.focus.escapeRestored ||
      !run.focus.nonModalNoTrap
    ) {
      findings.push({
        code: 'failed-page-run',
        message: `Supported page run ${run.caseId} did not pass focus, permission, and outcome checks.`,
        path: `pageRuns.${index}`,
      });
    }
    requireDefectLink(run.outcome, run.defectLinks, `pageRuns.${index}`, findings);
  }

  for (const environmentId of environmentsById.keys()) {
    for (const caseId of casesById.keys()) {
      if (pageRunsByKey.has(`${environmentId}\u0000${caseId}`)) continue;
      findings.push({
        code: 'missing-page-run',
        message: `Missing page run for ${environmentId}/${caseId}.`,
        path: 'pageRuns',
      });
    }
  }
}

function evaluateExcludedSurfaces(
  evidence: SmokeEvidence,
  environmentsById: ReadonlyMap<string, SmokeEvidence['environments'][number]>,
  findings: SmokeEvidenceFinding[],
): void {
  const seen = new Set<string>();
  for (const [index, run] of evidence.excludedSurfaceRuns.entries()) {
    const key = `${run.environmentId}\u0000${run.surfaceKind}`;
    if (seen.has(key) || !environmentsById.has(run.environmentId)) {
      findings.push({
        code: 'invalid-evidence',
        message: 'Excluded-surface run is duplicated or references an unknown environment.',
        path: `excludedSurfaceRuns.${index}`,
      });
      continue;
    }
    seen.add(key);
    if (run.outcome !== 'unsupported' || run.permissionState !== 'excluded') {
      findings.push({
        code: 'excluded-surface-supported',
        message: `${run.surfaceKind} must be reported as unsupported and excluded.`,
        path: `excludedSurfaceRuns.${index}`,
      });
    }
    requireDefectLink(
      run.outcome,
      run.defectLinks,
      `excludedSurfaceRuns.${index}`,
      findings,
    );
  }
  for (const environmentId of environmentsById.keys()) {
    for (const surfaceKind of requiredExcludedSurfaces) {
      if (seen.has(`${environmentId}\u0000${surfaceKind}`)) continue;
      findings.push({
        code: 'missing-excluded-surface',
        message: `Missing ${surfaceKind} evidence for ${environmentId}.`,
        path: 'excludedSurfaceRuns',
      });
    }
  }
}

function evaluateFlows(
  evidence: SmokeEvidence,
  environmentsById: ReadonlyMap<string, SmokeEvidence['environments'][number]>,
  findings: SmokeEvidenceFinding[],
): void {
  const seen = new Set<string>();
  for (const [index, run] of evidence.flowRuns.entries()) {
    const key = `${run.environmentId}\u0000${run.flow}`;
    if (seen.has(key) || !environmentsById.has(run.environmentId)) {
      findings.push({
        code: 'invalid-evidence',
        message: 'Flow run is duplicated or references an unknown environment.',
        path: `flowRuns.${index}`,
      });
      continue;
    }
    seen.add(key);
    if (!run.keyboardOnly || !run.visibleFocus || !run.nonColorCue) {
      findings.push({
        code: 'inoperable-flow',
        message: `${run.flow} failed keyboard, visible-focus, or non-color-cue checks.`,
        path: `flowRuns.${index}`,
      });
    }
  }
  for (const environmentId of environmentsById.keys()) {
    for (const flow of requiredFlows) {
      if (seen.has(`${environmentId}\u0000${flow}`)) continue;
      findings.push({
        code: 'missing-flow-run',
        message: `Missing ${flow} keyboard flow for ${environmentId}.`,
        path: 'flowRuns',
      });
    }
  }
}

function evaluateAnnouncements(
  evidence: SmokeEvidence,
  environmentsById: ReadonlyMap<string, SmokeEvidence['environments'][number]>,
  findings: SmokeEvidenceFinding[],
): void {
  const seen = new Set<string>();
  for (const [index, run] of evidence.announcementRuns.entries()) {
    const key = `${run.environmentId}\u0000${run.state}`;
    if (seen.has(key) || !environmentsById.has(run.environmentId)) {
      findings.push({
        code: 'invalid-evidence',
        message: 'Announcement run is duplicated or references an unknown environment.',
        path: `announcementRuns.${index}`,
      });
      continue;
    }
    seen.add(key);
    if (!run.announced || run.focusMoved) {
      findings.push({
        code: 'inaccessible-announcement',
        message: `${run.state} was not announced in place.`,
        path: `announcementRuns.${index}`,
      });
    }
  }
  for (const environmentId of environmentsById.keys()) {
    for (const state of requiredAnnouncementStates) {
      if (seen.has(`${environmentId}\u0000${state}`)) continue;
      findings.push({
        code: 'missing-announcement-run',
        message: `Missing ${state} announcement evidence for ${environmentId}.`,
        path: 'announcementRuns',
      });
    }
  }
}

function evaluateAccessibility(
  evidence: SmokeEvidence,
  environmentsById: ReadonlyMap<string, SmokeEvidence['environments'][number]>,
  findings: SmokeEvidenceFinding[],
  requireCompleteEvidence: boolean,
): void {
  const seen = new Set<string>();
  for (const [index, run] of evidence.accessibilityRuns.entries()) {
    const environment = environmentsById.get(run.environmentId);
    if (seen.has(run.environmentId) || environment === undefined) {
      findings.push({
        code: 'invalid-evidence',
        message: 'Accessibility run is duplicated or references an unknown environment.',
        path: `accessibilityRuns.${index}`,
      });
      continue;
    }
    seen.add(run.environmentId);
    const expectedAssistiveTechnology =
      environment.os === 'windows' ? 'nvda' : 'voiceover';
    const failedAutomatedChecks =
      !run.reducedMotion ||
      !run.highContrast ||
      run.assistiveTechnology !== expectedAssistiveTechnology;
    const missingManualChecks =
      requireCompleteEvidence &&
      (!run.manualScreenReader || !run.configuredCommandEntered);
    if (failedAutomatedChecks || missingManualChecks) {
      findings.push({
        code: 'incomplete-accessibility-run',
        message: requireCompleteEvidence
          ? `${environment.os} must pass reduced motion, high contrast, the configured browser command, and manual ${expectedAssistiveTechnology}.`
          : `${environment.os} must pass automated reduced-motion and high-contrast checks.`,
        path: `accessibilityRuns.${index}`,
      });
    }
  }
  for (const environmentId of environmentsById.keys()) {
    if (seen.has(environmentId)) continue;
    findings.push({
      code: 'missing-accessibility-run',
      message: `Missing accessibility evidence for ${environmentId}.`,
      path: 'accessibilityRuns',
    });
  }
}

function evaluateLatency(
  evidence: SmokeEvidence,
  environmentsById: ReadonlyMap<string, SmokeEvidence['environments'][number]>,
  findings: SmokeEvidenceFinding[],
  requireCompleteEvidence: boolean,
): SmokeLatencyGroup[] {
  const samples = new Map<string, number[]>();
  const casesById = new Map(evidence.plan.map((pageCase) => [pageCase.id, pageCase]));
  for (const run of evidence.pageRuns) {
    const environment = environmentsById.get(run.environmentId);
    const pageCase = casesById.get(run.caseId);
    if (environment === undefined || pageCase === undefined) continue;
    const key = `${environment.os}\u0000${pageCase.input}\u0000${pageCase.surface}`;
    const values = samples.get(key);
    if (values === undefined) samples.set(key, [run.latencyMs]);
    else values.push(run.latencyMs);
  }

  const groups: SmokeLatencyGroup[] = [];
  const operatingSystems = requireCompleteEvidence
    ? requiredOperatingSystems
    : Array.from(
        new Set(
          Array.from(environmentsById.values(), (environment) => environment.os),
        ),
      );
  for (const os of operatingSystems) {
    for (const input of requiredInputs) {
      for (const surface of requiredSurfaces) {
        const key = `${os}\u0000${input}\u0000${surface}`;
        const values = samples.get(key);
        if (values === undefined || values.length === 0) {
          findings.push({
            code: 'missing-latency-group',
            message: `Missing local latency samples for ${os}/${input}/${surface}.`,
            path: 'pageRuns',
          });
          continue;
        }
        const summary = summarizeSmokeLatencyValues(values);
        groups.push({ os, input, surface, ...summary });
        const { p95Ms, maxMs } = summary;
        if (p95Ms > 100 || maxMs > 250) {
          findings.push({
            code: 'latency-budget-exceeded',
            message: `${os}/${input}/${surface} measured p95 ${p95Ms} ms and max ${maxMs} ms.`,
            path: 'pageRuns',
          });
        }
      }
    }
  }
  return groups;
}

function requireDefectLink(
  outcome: z.infer<typeof outcomeSchema>,
  defectLinks: readonly string[],
  path: string,
  findings: SmokeEvidenceFinding[],
): void {
  if (outcome !== 'failed' || defectLinks.length > 0) return;
  findings.push({
    code: 'missing-defect-link',
    message: 'A failed smoke record must link its defect.',
    path,
  });
}

function uniqueById<T extends { id: string }>(
  records: readonly T[],
  path: string,
  findings: SmokeEvidenceFinding[],
): Map<string, T> {
  const byId = new Map<string, T>();
  for (const [index, record] of records.entries()) {
    if (byId.has(record.id)) {
      findings.push({
        code: 'invalid-evidence',
        message: `Duplicate ID ${record.id}.`,
        path: `${path}.${index}.id`,
      });
    } else {
      byId.set(record.id, record);
    }
  }
  return byId;
}

function emptySummary(): SmokeEvidenceResult['summary'] {
  return {
    supportedPageCount: 0,
    domainCount: 0,
    environmentCount: 0,
    pageRunCount: 0,
    latencyGroups: [],
  };
}

import { describe, expect, it } from 'vitest';
import {
  SMOKE_ANNOUNCEMENT_STATES,
  SMOKE_EXCLUDED_SURFACE_KINDS,
  SMOKE_FLOW_NAMES,
  evaluateAutomatedSmokeEvidence,
  evaluateSmokeEvidence,
  mergeSmokeEvidence,
  type SmokeEvidence,
} from './smoke-evidence';


function completeEvidence(): SmokeEvidence {
  const environments: SmokeEvidence['environments'] = [
    {
      id: 'windows-chrome-nvda',
      os: 'windows',
      osVersion: '11 24H2',
      browserVersion: 'Chrome 139.0.0.0',
      extensionCommit: '0123456789abcdef0123456789abcdef01234567',
    },
    {
      id: 'macos-chrome-voiceover',
      os: 'macos',
      osVersion: '15.6',
      browserVersion: 'Chrome 139.0.0.0',
      extensionCommit: '0123456789abcdef0123456789abcdef01234567',
    },
  ];
  const selectionKinds = ['word', 'phrase', 'sentence', 'multi-sentence'] as const;
  const inputs = ['pointer', 'keyboard'] as const;
  const placements = ['viewport-edge', 'after-scroll'] as const;
  const surfaces = ['top-level', 'same-origin-embedded'] as const;
  const cases: SmokeEvidence['plan'] = Array.from({ length: 20 }, (_, index) => ({
    id: `page-${String(index + 1).padStart(2, '0')}`,
    domain: `site-${String((index % 10) + 1).padStart(2, '0')}.lingo.test`,
    path: `/article-${Math.floor(index / 10) + 1}`,
    surface: surfaces[index % surfaces.length] ?? 'top-level',
    selectionKind:
      selectionKinds[index % selectionKinds.length] ?? 'word',
    input: inputs[Math.floor(index / 2) % inputs.length] ?? 'pointer',
    placement:
      placements[Math.floor(index / 8) % placements.length] ?? 'viewport-edge',
    zoomPercent: Math.floor(index / 4) % 2 === 0 ? 100 : 200,
  }));

  return {
    schemaVersion: 1,
    runId: 'first-release-smoke-2026-08-16',
    recordedAt: '2026-08-16T10:00:00.000Z',
    environments,
    plan: cases,
    pageRuns: environments.flatMap((environment) =>
      cases.map((pageCase, index) => ({
        caseId: pageCase.id,
        environmentId: environment.id,
        permissionState: 'enabled',
        expected: 'Anchored controls are visible without leaving Reading Flow.',
        observed: 'Anchored controls remained visible and operable.',
        outcome: 'passed',
        accessibilityMethods: ['keyboard-only', 'visual-focus'],
        defectLinks: [],
        latencyMs: 44 + (index % 5),
        focus: {
          pointerSelectionPreserved: true,
          escapeRestored: true,
          nonModalNoTrap: true,
        },
      })),
    ),
    excludedSurfaceRuns: environments.flatMap((environment) =>
      SMOKE_EXCLUDED_SURFACE_KINDS.map((surfaceKind) => ({
        environmentId: environment.id,
        surfaceKind,
        permissionState: 'excluded',
        expected: 'Reported as outside Supported Reading Surfaces.',
        observed: 'No Reading Flow controls were injected; smoke report marks unsupported.',
        outcome: 'unsupported',
        accessibilityMethods: ['keyboard-only'],
        defectLinks: [],
      })),
    ),
    flowRuns: environments.flatMap((environment) =>
      SMOKE_FLOW_NAMES.map((flow) => ({
        environmentId: environment.id,
        flow,
        keyboardOnly: true,
        visibleFocus: true,
        nonColorCue: true,
        expected: 'Flow is operable without a pointer.',
        observed: 'Flow completed with keyboard-visible state.',
        defectLinks: [],
      })),
    ),
    announcementRuns: environments.flatMap((environment) =>
      SMOKE_ANNOUNCEMENT_STATES.map((state) => ({
        environmentId: environment.id,
        state,
        announced: true,
        focusMoved: false,
        expected: 'State is announced without moving focus.',
        observed: 'Polite status announcement was exposed in place.',
        defectLinks: [],
      })),
    ),
    accessibilityRuns: [
      {
        environmentId: 'windows-chrome-nvda',
        reducedMotion: true,
        highContrast: true,
        assistiveTechnology: 'nvda',
        manualScreenReader: true,
        configuredCommandEntered: true,
        expected: 'Complete core flow passes manual NVDA smoke.',
        observed: 'NVDA announced names, roles, states, and status updates.',
        defectLinks: [],
      },
      {
        environmentId: 'macos-chrome-voiceover',
        reducedMotion: true,
        highContrast: true,
        assistiveTechnology: 'voiceover',
        manualScreenReader: true,
        configuredCommandEntered: true,
        expected: 'Complete core flow passes manual VoiceOver smoke.',
        observed: 'VoiceOver announced names, roles, states, and status updates.',
        defectLinks: [],
      },
    ],
  };
}

describe('supported-page smoke evidence gate', () => {
  it('passes a complete dual-OS, 20-page, auditable smoke record within latency limits', () => {
    const result = evaluateSmokeEvidence(completeEvidence());

    expect(result).toMatchObject({
      passed: true,
      findings: [],
      summary: {
        supportedPageCount: 20,
        domainCount: 10,
        environmentCount: 2,
        pageRunCount: 40,
      },
    });
    expect(result.summary.latencyGroups).toHaveLength(8);
    expect(result.summary.latencyGroups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          os: 'windows',
          input: 'pointer',
          surface: 'top-level',
          p95Ms: 48,
          maxMs: 48,
        }),
      ]),
    );
  });

  it('fails closed when an OS run is incomplete, accessibility is unverified, or latency exceeds the budget', () => {
    const evidence = completeEvidence();
    evidence.pageRuns = evidence.pageRuns.filter(
      (run) =>
        run.environmentId !== 'macos-chrome-voiceover' ||
        run.caseId !== 'page-20',
    );
    const firstPageRun = evidence.pageRuns[0];
    const windowsAccessibility = evidence.accessibilityRuns.find(
      (run) => run.environmentId === 'windows-chrome-nvda',
    );
    if (firstPageRun === undefined || windowsAccessibility === undefined) {
      throw new Error('Expected complete smoke evidence fixture.');
    }
    firstPageRun.latencyMs = 251;
    windowsAccessibility.manualScreenReader = false;

    const result = evaluateSmokeEvidence(evidence);

    expect(result.passed).toBe(false);
    expect(result.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        'missing-page-run',
        'incomplete-accessibility-run',
        'latency-budget-exceeded',
      ]),
    );
  });

  it('fails closed when the configured browser command was only simulated', () => {
    const evidence = completeEvidence();
    const windows = evidence.accessibilityRuns[0];
    if (windows === undefined) throw new Error('Missing Windows evidence.');
    evidence.accessibilityRuns[0] = {
      ...windows,
      configuredCommandEntered: false,
      observed:
        'The content-script focus event passed, but the browser command was not exercised.',
    };

    expect(
      evaluateSmokeEvidence(evidence).findings.map((finding) => finding.code),
    ).toContain('incomplete-accessibility-run');
  });

  it('merges independently captured Windows and macOS records before applying the gate', () => {

    const complete = completeEvidence();
    const records = complete.environments.map((environment) => ({
      ...complete,
      runId: `${complete.runId}-${environment.os}`,
      environments: [environment],
      pageRuns: complete.pageRuns.filter(
        (run) => run.environmentId === environment.id,
      ),
      excludedSurfaceRuns: complete.excludedSurfaceRuns.filter(
        (run) => run.environmentId === environment.id,
      ),
      flowRuns: complete.flowRuns.filter(
        (run) => run.environmentId === environment.id,
      ),
      announcementRuns: complete.announcementRuns.filter(
        (run) => run.environmentId === environment.id,
      ),
      accessibilityRuns: complete.accessibilityRuns.filter(
        (run) => run.environmentId === environment.id,
      ),
    }));

    const merged = mergeSmokeEvidence(records);

    expect(merged.environments).toHaveLength(2);
    expect(evaluateSmokeEvidence(merged).passed).toBe(true);
  });
  it('passes an OS-local automated artifact while preserving the manual final gate', () => {
    const complete = completeEvidence();
    const windowsEnvironment = complete.environments[0];
    if (windowsEnvironment === undefined) {
      throw new Error('Missing Windows environment.');
    }
    const windows = {
      ...complete,
      environments: [windowsEnvironment],
      pageRuns: complete.pageRuns.filter(
        (run) => run.environmentId === windowsEnvironment.id,
      ),
      excludedSurfaceRuns: complete.excludedSurfaceRuns.filter(
        (run) => run.environmentId === windowsEnvironment.id,
      ),
      flowRuns: complete.flowRuns.filter(
        (run) => run.environmentId === windowsEnvironment.id,
      ),
      announcementRuns: complete.announcementRuns.filter(
        (run) => run.environmentId === windowsEnvironment.id,
      ),
      accessibilityRuns: complete.accessibilityRuns
        .filter((run) => run.environmentId === windowsEnvironment.id)
        .map((run) => ({
          ...run,
          manualScreenReader: false,
          configuredCommandEntered: false,
        })),
    };

    expect(evaluateAutomatedSmokeEvidence(windows).passed).toBe(true);
    expect(evaluateSmokeEvidence(windows).passed).toBe(false);
  });
});

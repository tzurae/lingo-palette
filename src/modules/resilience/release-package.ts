export const RELEASE_PACKAGE_CHECK_IDS = [
  'no-remote-executable-logic',
  'required-host-permissions-are-narrow',
  'pack-refresh-does-not-use-downloads',
  'no-packaged-api-key',
  'no-signing-private-key',
  'third-party-notices-complete',
] as const;

export type ReleasePackageCheckId =
  (typeof RELEASE_PACKAGE_CHECK_IDS)[number];
export type ReleasePackageCheck = {
  id: ReleasePackageCheckId;
  status: 'passed' | 'failed';
  message: string;
};
export type ReleasePackageInspection = {
  schemaVersion: 1;
  checks: ReleasePackageCheck[];
};

type ExtensionManifest = {
  background?: { service_worker?: unknown };
  host_permissions?: unknown;
  content_security_policy?: unknown;
};

const decoder = new TextDecoder('utf-8', { fatal: true });
const executablePath = /\.(?:html?|m?js)$/i;
const inspectableTextPath = /\.(?:css|html?|json|m?js|txt)$/i;
const requiredHostPermissions = new Set([
  'https://api.openai.com/*',
  'https://tzurae.github.io/lingo-palette-evidence/*',
]);
const requiredNoticeFragments = [
  '@noble/ed25519 3.1.0',
  'react 19.2.8',
  'react-dom 19.2.8',
  'scheduler 0.27.0',
  'zod 4.4.3',
  'Open English WordNet 2025',
  'Leipzig Corpora Collection',
  'Permission is hereby granted, free of charge, to any person obtaining a copy',
] as const;

function check(
  id: ReleasePackageCheckId,
  failures: readonly string[],
  success: string,
): ReleasePackageCheck {
  return failures.length === 0
    ? { id, status: 'passed', message: success }
    : { id, status: 'failed', message: failures.join(' ') };
}

function decodeEntry(
  entries: Readonly<Record<string, Uint8Array>>,
  path: string,
): string | null {
  const bytes = entries[path];
  if (bytes === undefined) return null;
  try {
    return decoder.decode(bytes);
  } catch {
    return null;
  }
}

function parseManifest(
  entries: Readonly<Record<string, Uint8Array>>,
): ExtensionManifest | null {
  const text = decodeEntry(entries, 'manifest.json');
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null
      ? (value as ExtensionManifest)
      : null;
  } catch {
    return null;
  }
}

function inspectRemoteLogic(
  entries: Readonly<Record<string, Uint8Array>>,
  manifest: ExtensionManifest | null,
): ReleasePackageCheck {
  const failures: string[] = [];
  const remoteExecutionPatterns = [
    /<script\b[^>]*\bsrc\s*=\s*["'](?:https?:)?\/\//i,
    /\bimport\s*\(\s*["'`](?:https?:)?\/\//i,
    /\bfrom\s*["'`](?:https?:)?\/\//i,
    /\bimportScripts\s*\(\s*["'`](?:https?:)?\/\//i,
    /\bnew\s+(?:Shared)?Worker\s*\(\s*["'`](?:https?:)?\/\//i,
    /\b(?:register|addModule)\s*\(\s*["'`](?:https?:)?\/\//i,
    /\beval\s*\(/,
    /\bnew\s+Function\s*\(/,
  ] as const;
  for (const [path, bytes] of Object.entries(entries)) {
    if (!executablePath.test(path)) continue;
    let text: string;
    try {
      text = decoder.decode(bytes);
    } catch {
      failures.push(`${path} is not valid UTF-8 executable text.`);
      continue;
    }
    if (remoteExecutionPatterns.some((pattern) => pattern.test(text))) {
      failures.push(`${path} contains remote or dynamically evaluated logic.`);
    }
  }

  const extensionPages =
    typeof manifest?.content_security_policy === 'object' &&
    manifest.content_security_policy !== null &&
    'extension_pages' in manifest.content_security_policy
      ? manifest.content_security_policy.extension_pages
      : null;
  if (
    typeof extensionPages === 'string' &&
    /script-src[^;]*(?:https?:|\/\/|\*)/i.test(extensionPages)
  ) {
    failures.push('Extension CSP permits a remote script origin.');
  }

  return check(
    'no-remote-executable-logic',
    failures,
    'Executable entries are local-only and extension CSP permits no remote script origin.',
  );
}

function inspectRequiredHosts(
  manifest: ExtensionManifest | null,
): ReleasePackageCheck {
  const failures: string[] = [];
  if (manifest === null) {
    failures.push('manifest.json is missing or malformed.');
  } else if (!Array.isArray(manifest.host_permissions)) {
    failures.push('manifest host_permissions is missing or malformed.');
  } else {
    for (const permission of manifest.host_permissions) {
      if (
        typeof permission !== 'string' ||
        !requiredHostPermissions.has(permission)
      ) {
        failures.push(`Required host permission is not allowlisted: ${String(permission)}.`);
      }
    }
    for (const required of requiredHostPermissions) {
      if (!manifest.host_permissions.includes(required)) {
        failures.push(`Required host permission is missing: ${required}.`);
      }
    }
  }
  return check(
    'required-host-permissions-are-narrow',
    failures,
    'Required host permissions exactly match the OpenAI API and pinned Evidence Pack origins.',
  );
}

function inspectPackRefreshDownloads(
  entries: Readonly<Record<string, Uint8Array>>,
  manifest: ExtensionManifest | null,
): ReleasePackageCheck {
  const failures: string[] = [];
  const workerPath = manifest?.background?.service_worker;
  if (typeof workerPath !== 'string' || workerPath.length === 0) {
    failures.push('Background service worker path is missing or malformed.');
  } else {
    const normalizedPath = workerPath.replace(/^\//, '');
    const worker = decodeEntry(entries, normalizedPath);
    if (worker === null) {
      failures.push(`Background service worker ${normalizedPath} is missing or not UTF-8.`);
    } else if (/(?:chrome|browser)\.downloads\b|\.downloads\.download\b/.test(worker)) {
      failures.push('Background Evidence Pack path can invoke the downloads permission.');
    }
  }
  return check(
    'pack-refresh-does-not-use-downloads',
    failures,
    'Background package refresh has no downloads API access; downloads remain options export-only.',
  );
}

function inspectSecrets(
  entries: Readonly<Record<string, Uint8Array>>,
): [ReleasePackageCheck, ReleasePackageCheck] {
  const apiKeyFailures: string[] = [];
  const signingKeyFailures: string[] = [];
  const apiKeyPattern = /\bsk-(?:proj-|org-)?[A-Za-z0-9_-]{20,}\b/g;
  const privateKeyPattern =
    /-----BEGIN (?:ENCRYPTED |EC |RSA |OPENSSH )?PRIVATE KEY-----/;
  const signingSecretNamePattern =
    /EVIDENCE_PACK_(?:SIGNING_)?PRIVATE_KEY(?:_BASE64)?/;

  for (const [path, bytes] of Object.entries(entries)) {
    if (!inspectableTextPath.test(path)) continue;
    let text: string;
    try {
      text = decoder.decode(bytes);
    } catch {
      continue;
    }
    if (apiKeyPattern.test(text)) {
      apiKeyFailures.push(`${path} contains an API key-shaped value.`);
    }
    apiKeyPattern.lastIndex = 0;
    if (privateKeyPattern.test(text) || signingSecretNamePattern.test(text)) {
      signingKeyFailures.push(`${path} contains signing private-key material.`);
    }
  }

  return [
    check(
      'no-packaged-api-key',
      apiKeyFailures,
      'No API key-shaped credential is packaged.',
    ),
    check(
      'no-signing-private-key',
      signingKeyFailures,
      'No signing private key or signing-key secret is packaged.',
    ),
  ];
}

function inspectNotices(
  entries: Readonly<Record<string, Uint8Array>>,
): ReleasePackageCheck {
  const failures: string[] = [];
  const notices = decodeEntry(entries, 'THIRD_PARTY_NOTICES.txt');
  if (notices === null) {
    failures.push('THIRD_PARTY_NOTICES.txt is missing or not valid UTF-8.');
  } else {
    const missing = requiredNoticeFragments.filter(
      (fragment) => !notices.includes(fragment),
    );
    if (missing.length > 0) {
      failures.push(`Third-party notices omit: ${missing.join(', ')}.`);
    }
  }
  return check(
    'third-party-notices-complete',
    failures,
    'Runtime dependencies, bundled evidence sources, and applicable license text are listed.',
  );
}

export function inspectReleasePackage(
  entries: Readonly<Record<string, Uint8Array>>,
): ReleasePackageInspection {
  const manifest = parseManifest(entries);
  const [apiKeyCheck, signingKeyCheck] = inspectSecrets(entries);
  return {
    schemaVersion: 1,
    checks: [
      inspectRemoteLogic(entries, manifest),
      inspectRequiredHosts(manifest),
      inspectPackRefreshDownloads(entries, manifest),
      apiKeyCheck,
      signingKeyCheck,
      inspectNotices(entries),
    ],
  };
}

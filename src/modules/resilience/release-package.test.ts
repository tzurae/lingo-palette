import { strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { inspectReleasePackage } from './release-package';


function compliantPackage(
  overrides: Record<string, Uint8Array> = {},
): Record<string, Uint8Array> {
  return {
    'manifest.json': strToU8(
      JSON.stringify({
        manifest_version: 3,
        background: { service_worker: 'background.js' },
        permissions: ['downloads', 'storage'],
        host_permissions: [
          'https://api.openai.com/*',
          'https://tzurae.github.io/lingo-palette-evidence/*',
        ],
        optional_host_permissions: ['http://*/*', 'https://*/*'],
        content_security_policy: {
          extension_pages: "script-src 'self'; object-src 'self'",
        },
      }),
    ),
    'background.js': strToU8(
      "const evidenceOrigin='https://tzurae.github.io/lingo-palette-evidence/'; fetch(evidenceOrigin);",
    ),
    'chunks/options.js': strToU8(
      "chrome.downloads.download({url: URL.createObjectURL(new Blob(['backup']))});",
    ),
    'options.html': strToU8(
      '<script type="module" src="/chunks/options.js"></script>',
    ),
    'THIRD_PARTY_NOTICES.txt': strToU8(
      [
        '@noble/ed25519 3.1.0',
        'react 19.2.8',
        'react-dom 19.2.8',
        'scheduler 0.27.0',
        'zod 4.4.3',
        'Open English WordNet 2025',
        'Leipzig Corpora Collection',
        'Permission is hereby granted, free of charge, to any person obtaining a copy',
      ].join('\n'),
    ),
    ...overrides,
  };
}

describe('release package inspection', () => {
  it('passes a data-only least-privilege release with complete notices', () => {
    expect(inspectReleasePackage(compliantPackage())).toEqual({
      schemaVersion: 1,
      checks: [
        expect.objectContaining({
          id: 'no-remote-executable-logic',
          status: 'passed',
        }),
        expect.objectContaining({
          id: 'required-host-permissions-are-narrow',
          status: 'passed',
        }),
        expect.objectContaining({
          id: 'pack-refresh-does-not-use-downloads',
          status: 'passed',
        }),
        expect.objectContaining({
          id: 'no-packaged-api-key',
          status: 'passed',
        }),
        expect.objectContaining({
          id: 'no-signing-private-key',
          status: 'passed',
        }),
        expect.objectContaining({
          id: 'third-party-notices-complete',
          status: 'passed',
        }),
      ],
    });
  });

  it.each([
    {
      id: 'no-remote-executable-logic',
      entries: {
        'chunks/options.js': strToU8("import('https://example.test/plugin.js')"),
      },
    },
    {
      id: 'no-remote-executable-logic',
      entries: {
        'background.js': strToU8(
          "importScripts('https://cdn.example.test/worker.js')",
        ),
      },
    },
    {
      id: 'required-host-permissions-are-narrow',
      entries: {
        'manifest.json': strToU8(
          JSON.stringify({
            manifest_version: 3,
            background: { service_worker: 'background.js' },
            permissions: ['downloads'],
            host_permissions: ['https://*/*'],
          }),
        ),
      },
    },
    {
      id: 'required-host-permissions-are-narrow',
      entries: {
        'manifest.json': strToU8(
          JSON.stringify({
            manifest_version: 3,
            background: { service_worker: 'background.js' },
            permissions: ['downloads'],
            host_permissions: [
              'https://api.openai.com/*',
              'https://example.test/*',
            ],
          }),
        ),
      },
    },
    {
      id: 'pack-refresh-does-not-use-downloads',
      entries: {
        'background.js': strToU8(
          "chrome.downloads.download({url:'https://example.test/pack.zip'})",
        ),
      },
    },
    {
      id: 'no-packaged-api-key',
      entries: {
        'background.js': strToU8(
          "const key='sk-proj-abcdefghijklmnopqrstuvwxyz123456';",
        ),
      },
    },
    {
      id: 'no-signing-private-key',
      entries: {
        'background.js': strToU8(
          'const key=`-----BEGIN PRIVATE KEY-----\\nsecret\\n-----END PRIVATE KEY-----`;',
        ),
      },
    },
    {
      id: 'third-party-notices-complete',
      entries: { 'THIRD_PARTY_NOTICES.txt': strToU8('MIT') },
    },
  ] as const)('fails the $id release gate', ({ id, entries }) => {
    const report = inspectReleasePackage(compliantPackage(entries));
    expect(report.checks.find((check) => check.id === id)).toMatchObject({
      id,
      status: 'failed',
    });
  });
});

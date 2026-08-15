import oewnLicenseText from './licenses/OEWN-2025-LICENSE.md.txt?raw';
import wordNetLicenseText from './licenses/WNDB_License.txt?raw';

export type EvidencePackManifest = {
  id: string;
  schemaVersion: 1;
  version: string;
  language: 'en';
  minimumExtensionVersion: string;
  compression: 'gzip';
  compressedSizeBytes: number;
  installedSizeBytes: number;
  contentIdentitySha256: string;
  contentHashes: readonly {
    path: string;
    byteSize: number;
    sha256: string;
  }[];
  licenses: readonly {
    id: string;
    path: string;
    byteSize: number;
    sha256: string;
  }[];
  sources: readonly {
    id: string;
    version: string;
    asset: string;
    sha256: string;
    licenseIds: readonly string[];
  }[];
};

export type LicenseAndAttribution = {
  sourceId: string;
  sourceName: string;
  sourceVersion: string;
  attribution: string;
  licenseIdentifiers: readonly string[];
  licenseTextHashes: readonly {
    licenseIdentifier: string;
    sha256: string;
  }[];
  notice: string;
  licenseUrls: readonly string[];
  sourceUrl: string;
};

export type ContextualMeaningEvidence = {
  id: string;
  sourceId: string;
  sourceVersion: string;
  sourceSenseId: string;
  partOfSpeech: string;
  definition: string;
  members: readonly string[];
  examples: readonly string[];
  authority: 'primary-lexical' | 'supplemental';
};

export type EvidenceLicense = {
  id: string;
  text: string;
};

export type PinnedEnglishEvidencePack = {
  manifest: EvidencePackManifest;
  contextualMeanings: readonly ContextualMeaningEvidence[];
  licenses: readonly EvidenceLicense[];
  licenseAndAttribution: readonly LicenseAndAttribution[];
};

export const BUNDLED_ENGLISH_EVIDENCE_PACK = {
  manifest: {
    id: 'lingo-palette-en-contextual-meaning-minimal',
    schemaVersion: 1,
    version: '2025.1.0-minimal.1',
    language: 'en',
    minimumExtensionVersion: '0.0.0',
    compression: 'gzip',
    compressedSizeBytes: 7_519,
    installedSizeBytes: 23_003,
    contentIdentitySha256:
      'bdb3f16559eb0576ede76aab11caa853f7902beed2603662845d03281c3aec7f',
    contentHashes: [
      {
        path: 'contextual-meanings.json',
        byteSize: 349,
        sha256:
          'e31fd3bb1cbee8a4ab11bc83c6dcbec80356fe576f6ee4c78dcd0ef7110f6ad6',
      },
      {
        path: 'license-and-attribution.json',
        byteSize: 1_051,
        sha256:
          '3e8104d8cf265a153e341e384a9edab62a7cc4cc852e10bb1c0a7c83cd287bbe',
      },
      {
        path: 'licenses/OEWN-2025-LICENSE.md',
        byteSize: 19_863,
        sha256:
          '672cc8b5663e8dc74c4b07a9dcf477193853575b119908fd3dc0aeeb60a9dbbb',
      },
      {
        path: 'licenses/WNDB_License.txt',
        byteSize: 1_740,
        sha256:
          'df30ec18fbabcdaf031b79ea026d3e6b959010cffe6dd7be9ac137822175b904',
      },
    ],
    licenses: [
      {
        id: 'CC-BY-4.0',
        path: 'licenses/OEWN-2025-LICENSE.md',
        byteSize: 19_863,
        sha256:
          '672cc8b5663e8dc74c4b07a9dcf477193853575b119908fd3dc0aeeb60a9dbbb',
      },
      {
        id: 'Princeton-WordNet-3.1',
        path: 'licenses/WNDB_License.txt',
        byteSize: 1_740,
        sha256:
          'df30ec18fbabcdaf031b79ea026d3e6b959010cffe6dd7be9ac137822175b904',
      },
    ],
    sources: [
      {
        id: 'oewn',
        version: '2025',
        asset: 'english-wordnet-2025-json.zip',
        sha256:
          '7d749f6e2c39e6970e4997839dcf6e42fd281f3c2fae0171d2192bae8cfa4b51',
        licenseIds: ['CC-BY-4.0', 'Princeton-WordNet-3.1'],
      },
    ],
  },
  contextualMeanings: [
    {
      id: 'oewn-2025:02648898-v',
      sourceId: 'oewn',
      sourceVersion: '2025',
      sourceSenseId: 'oewn:02648898-v',
      partOfSpeech: 'verb',
      definition: 'hold back to a later time',
      members: [
        'postpone',
        'prorogue',
        'hold over',
        'put over',
        'table',
        'shelve',
        'set back',
        'defer',
        'remit',
        'put off',
      ],
      examples: ["let's postpone the exam"],
      authority: 'primary-lexical',
    },
  ],
  licenses: [
    { id: 'CC-BY-4.0', text: oewnLicenseText },
    { id: 'Princeton-WordNet-3.1', text: wordNetLicenseText },
  ],
  licenseAndAttribution: [
    {
      sourceId: 'oewn',
      sourceName: 'Open English WordNet',
      sourceVersion: '2025',
      attribution:
        'Open English WordNet 2025 © 2019-present Open English WordNet Team; based on WordNet 3.1 © 2011 Princeton University.',
      licenseIdentifiers: ['CC-BY-4.0', 'Princeton-WordNet-3.1'],
      licenseTextHashes: [
        {
          licenseIdentifier: 'CC-BY-4.0',
          sha256:
            '672cc8b5663e8dc74c4b07a9dcf477193853575b119908fd3dc0aeeb60a9dbbb',
        },
        {
          licenseIdentifier: 'Princeton-WordNet-3.1',
          sha256:
            'df30ec18fbabcdaf031b79ea026d3e6b959010cffe6dd7be9ac137822175b904',
        },
      ],
      licenseUrls: [
        'https://github.com/globalwordnet/english-wordnet/blob/2025-edition/LICENSE.md',
        'https://github.com/globalwordnet/english-wordnet/blob/2025-edition/WNDB_License.txt',
      ],
      sourceUrl:
        'https://github.com/globalwordnet/english-wordnet/tree/2025-edition',
      notice:
        'This resource is derived from Princeton WordNet under the WordNet License and further developed under the Creative Commons Attribution 4.0 International License. Attribution is required for both Princeton WordNet and the Open English WordNet team.',
    },
  ],
} as const satisfies PinnedEnglishEvidencePack;

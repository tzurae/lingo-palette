import oewnLicenseText from './licenses/OEWN-2025-LICENSE.md.txt?raw';
import wordNetLicenseText from './licenses/WNDB_License.txt?raw';
import { BUNDLED_EVIDENCE_PACK_VERSION } from './evidence-pack-catalog';

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

export type UsageFitEvidence = {
  id: string;
  sourceId: string;
  sourceVersion: string;
  sourceSenseId: string;
  partOfSpeech: string;
  morphology: string;
  contextQuote: string;
  fit: 'fits' | 'does-not-fit';
  attestation: string;
  authority: 'sense-context' | 'lexical-relation' | 'frequency';
};

export type GrammarPatternEvidence = {
  id: string;
  sourceId: string;
  sourceVersion: string;
  sourceSenseId: string;
  partOfSpeech: string;
  morphologies: readonly string[];
  pattern: string;
  attestation: string;
  authority:
    | 'source-recorded-frame'
    | 'source-recorded-usage-note'
    | 'pos-aware-corpus-attestation';
};

export type CollocationEvidence = {
  id: string;
  sourceId: string;
  sourceVersion: string;
  authority: 'corpus-collocation';
  targetExpression: string;
  collocate: string;
  partOfSpeech: string;
  targetMorphologies: readonly string[];
  window: { type: 'same-sentence' };
  rawCount: number;
  association: { metric: 'log-likelihood'; value: number };
  minimumRawCount: number;
  corpus: {
    name: string;
    language: 'en';
    sentenceCount: number;
    tokenCount: number;
    sourceUrl: string;
  };
};

export type ReviewAuthorityEvidence =
  | ContextualMeaningEvidence
  | UsageFitEvidence
  | GrammarPatternEvidence
  | CollocationEvidence;

export type EvidenceLicense = {
  id: string;
  text: string;
};

export type PinnedEnglishEvidencePack = {
  manifest: EvidencePackManifest;
  contextualMeanings: readonly ContextualMeaningEvidence[];
  usageFits: readonly UsageFitEvidence[];
  grammarPatterns: readonly GrammarPatternEvidence[];
  collocations: readonly CollocationEvidence[];
  licenses: readonly EvidenceLicense[];
  licenseAndAttribution: readonly LicenseAndAttribution[];
};

export const BUNDLED_ENGLISH_EVIDENCE_PACK = {
  manifest: {
    id: 'lingo-palette-en-contextual-meaning-minimal',
    schemaVersion: 1,
    version: BUNDLED_EVIDENCE_PACK_VERSION,
    language: 'en',
    minimumExtensionVersion: '0.0.0',
    compression: 'gzip',
    compressedSizeBytes: 7_972,
    installedSizeBytes: 24_894,
    contentIdentitySha256:
      'd0daa1c1d86c284338ba9cb47f21f957d58975f9cc1f170b4bc393c30a8a8fc1',
    contentHashes: [
      {
        path: 'contextual-meanings.json',
        byteSize: 349,
        sha256:
          'e31fd3bb1cbee8a4ab11bc83c6dcbec80356fe576f6ee4c78dcd0ef7110f6ad6',
      },
      {
        path: 'usage-fits.json',
        byteSize: 302,
        sha256:
          'a095d9707ebc87389a75a3bf3247da76ad3e4fca174df8ae3dac5f9babcd901e',
      },
      {
        path: 'grammar-patterns.json',
        byteSize: 322,
        sha256:
          '9f4b322e09aecf500741a90de5158139750f030e70cacac9bb1318f40779c660',
      },
      {
        path: 'collocations.json',
        byteSize: 557,
        sha256:
          'c2a8811769df42cf72c5b0ac78aef8d1d87faa80445974c7c76ad066d3ef5b36',
      },
      {
        path: 'license-and-attribution.json',
        byteSize: 1_761,
        sha256:
          'a9213b35b65f1f45a346e97e82bea3a7a4e388ef00677843b7043d846c4d3571',
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
      {
        id: 'leipzig-eng-news',
        version: '2023-100K',
        asset: 'eng_news_2023_100K.tar.gz',
        sha256:
          'b425663b43612a454461188e655a93701866b1597a28933e2a25d033e51410c56',
        licenseIds: ['CC-BY-4.0'],
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
  usageFits: [
    {
      id: 'oewn-2025:postpone%2:42:00::-example-1',
      sourceId: 'oewn',
      sourceVersion: '2025',
      sourceSenseId: 'oewn:02648898-v',
      partOfSpeech: 'verb',
      morphology: 'base-form:postpone',
      contextQuote: "let's postpone the exam",
      fit: 'fits',
      attestation: "let's postpone the exam",
      authority: 'sense-context',
    },
  ],
  grammarPatterns: [
    {
      id: 'oewn-2025:postpone%2:42:00::-vtai',
      sourceId: 'oewn',
      sourceVersion: '2025',
      sourceSenseId: 'oewn:02648898-v',
      partOfSpeech: 'verb',
      morphologies: [
        'base-form:postpone',
        'past-tense-of:postpone',
      ],
      pattern: 'Somebody postpones something',
      attestation: 'Somebody ----s something',
      authority: 'source-recorded-frame',
    },
  ],
  collocations: [
    {
      id: 'leipzig-eng-news-2023:decision-make',
      sourceId: 'leipzig-eng-news',
      sourceVersion: '2023-100K',
      authority: 'corpus-collocation',
      targetExpression: 'decision',
      collocate: 'make',
      partOfSpeech: 'noun',
      targetMorphologies: ['base-form:decision'],
      window: { type: 'same-sentence' },
      rawCount: 31,
      association: { metric: 'log-likelihood', value: 45.41 },
      minimumRawCount: 5,
      corpus: {
        name: 'Leipzig English News Corpus 2023',
        language: 'en',
        sentenceCount: 100_000,
        tokenCount: 2_218_395,
        sourceUrl: 'https://wortschatz.uni-leipzig.de/en/download/English',
      },
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
    {
      sourceId: 'leipzig-eng-news',
      sourceName: 'Leipzig Corpora Collection — English News Corpus',
      sourceVersion: '2023-100K',
      attribution:
        'Leipzig Corpora Collection: English News corpus based on material from 2023, Universität Leipzig.',
      licenseIdentifiers: ['CC-BY-4.0'],
      licenseTextHashes: [
        {
          licenseIdentifier: 'CC-BY-4.0',
          sha256:
            '672cc8b5663e8dc74c4b07a9dcf477193853575b119908fd3dc0aeeb60a9dbbb',
        },
      ],
      licenseUrls: ['https://creativecommons.org/licenses/by/4.0/'],
      sourceUrl:
        'https://wortschatz.uni-leipzig.de/en/download/English',
      notice:
        'The downloadable Leipzig corpus is licensed under CC BY 4.0. This bundled record contains derived same-sentence co-occurrence statistics, not corpus sentences.',
    },
  ],
} as const satisfies PinnedEnglishEvidencePack;

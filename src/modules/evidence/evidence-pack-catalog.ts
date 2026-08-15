export const EVIDENCE_PACK_ORIGIN =
  'https://tzurae.github.io/lingo-palette-evidence/';
export const MAX_EVIDENCE_PACK_COMPRESSED_BYTES = 100_000_000;
export const MAX_EVIDENCE_PACK_INSTALLED_BYTES = 300 * 1024 * 1024;
export const BUNDLED_EVIDENCE_PACK_VERSION = '2025.1.0-minimal.2';
export const PACKAGED_EVIDENCE_PUBLIC_KEY_BASE64 =
  'kHxypnWGN74KcpPe76teIZstjRqn4/ehc1oXWZXlJ1M=';

export const FIRST_ENGLISH_EVIDENCE_SOURCES = [
  {
    id: 'oewn',
    version: '2025',
    asset: 'english-wordnet-2025-json.zip',
    sourceUrl:
      'https://github.com/globalwordnet/english-wordnet/releases/download/2025-edition/english-wordnet-2025-json.zip',
    sha256: '7d749f6e2c39e6970e4997839dcf6e42fd281f3c2fae0171d2192bae8cfa4b51',
    hashAuthority: 'publisher',
    changes:
      'Redistributed as the publisher JSON files; no lexical content changes.',
  },
  {
    id: 'wordfreq',
    version: '3.1.1',
    asset: 'wordfreq-3.1.1-py3-none-any.whl',
    sourceUrl:
      'https://files.pythonhosted.org/packages/24/61/62835c475d69872d30689f284497853fe33fe1d6dd18f57346d13305861d/wordfreq-3.1.1-py3-none-any.whl',
    sha256: '4b1c6ecffc6198be3396d5cf871c4423ca71c907c231348d352dd54d62b97473',
    hashAuthority: 'publisher',
    changes:
      'Extracted the English cBpack data from the wheel and deterministically converted frequency bins to UTF-8 TSV Zipf rows; no tokens were added.',
  },
  {
    id: 'leipzig-eng-news',
    version: '2023-100K',
    asset: 'eng_news_2023_100K.tar.gz',
    sourceUrl:
      'https://downloads.wortschatz-leipzig.de/corpora/eng_news_2023_100K.tar.gz',
    sha256: '8e65ed5b9c96687d293374335c14dfb9db4c150877bcc208a21bcb2f86b43484',
    hashAuthority: 'locally-computed',
    changes:
      'Extracted the sentence, source, and metadata text files from the pinned corpus archive; no corpus text changes.',
  },
] as const;

export type SupportedEvidencePackRelease = Readonly<{
  language: 'en';
  version: string;
}>;

export const SUPPORTED_EVIDENCE_PACK_RELEASES = [
  { language: 'en', version: '2025.1.0' },
] as const satisfies readonly SupportedEvidencePackRelease[];

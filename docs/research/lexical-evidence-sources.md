# Lexical evidence sources for review generation

**Evidence cutoff:** 2026-08-09  
**Product context:** Lingo Palette is a local-first, open-source Chrome extension. Its Review Generation harness must gate LLM-generated English review items with evidence that is independent of the model.

## Scope and decision rule

This note evaluates sources for six distinct claims:

1. **definitions and sense boundaries**;
2. **grammar and complementation patterns**;
3. **collocations and phraseology**;
4. **examples and attestation**;
5. **register, variety, and domain**; and
6. **frequency and distribution**.

These claims need different evidence. An editorial lexicon can define a sense or label register, but it does not establish how frequent a construction is. A corpus can show repeated attestation, collocation strength, and distribution, but it does not authoritatively define a sense or turn a distributional tendency into a grammatical rule. A community dictionary or sentence collection can corroborate a claim, but its presence is not a guarantee of correctness.

**“Authoritative” therefore means authoritative for the claimed dimension, not infallible.** The gate must preserve the source, version/revision, sense or part of speech, metric or excerpt, license, and attribution behind every accepted claim. Absence from one source means **unknown**, not “incorrect English.”

## Summary matrix

| Source | Distribution class | Definitions / senses | Grammar patterns | Collocations | Examples | Register | Frequency | Runtime fit |
|---|---|---:|---:|---:|---:|---:|---:|---|
| [Open English WordNet](https://github.com/globalwordnet/english-wordnet) | Open redistributable data | **Strong** | Partial verb frames | No statistical evidence | Limited, not claimed as quotations | Weak | None | Excellent offline base |
| [English Wiktionary](https://en.wiktionary.org/) via [Wikimedia dumps](https://meta.wikimedia.org/wiki/Data_dumps) | Open, but page/content obligations must be retained | Broad but community-edited | Broad morphology; uneven patterns | Ad hoc only | Mixed examples and sourced quotations | Often labeled; uneven | None | Good pinned secondary source |
| [wordfreq](https://github.com/rspeer/wordfreq) | Redistributable package/data with multiple notices | None | None | None | None | None | **Strong general-purpose estimate** | Excellent offline scalar signal |
| [Leipzig Corpora Collection](https://wortschatz.uni-leipzig.de/en/download) downloads | Open downloadable corpora; website/service has different terms | No | Observational | **Strong co-occurrence evidence** | Corpus-attested sentences | Domain/source proxy | Strong within a chosen corpus | Good offline build input |
| [Tatoeba](https://tatoeba.org/en/downloads) | Open per-sentence text data | No | Corroborative only | No representative statistic | Broad, but community-authored | Community tags only | Invalid for frequency | Optional example pool |
| [Google Books Ngram](https://books.google.com/ngrams/info) | Freely reusable aggregate n-gram data | No | Limited n-gram/POS observation | Phrase trends only | No underlying examples | Corpus-selection proxy | **Strong diachronic book signal** | Offline/analysis supplement |
| [BNC XML Edition](https://www.natcorp.ox.ac.uk/corpus/index.xml?ID=intro) | Licensed corpus; not redistributable open data | No | **Strong observational evidence** | **Strong** | **Strong authentic evidence** | Genre/spoken-written proxy | Strong for its population | Editorial/analysis workflow only |
| [COCA](https://www.english-corpora.org/coca/help/download.asp) | Hosted proprietary corpus and separately sold downloads | No | **Strong observational evidence** | **Strong** | Strong KWIC evidence | Genre proxy | Strong contemporary US signal | No extension API; licensed workflow only |
| Commercial dictionary APIs | Hosted proprietary content | Often **strong** | Varies | Varies | Editorial examples | Often **strong** | Usually absent | Public terms generally conflict with local-first automated gating |

“Strong” describes evidential fit, not redistribution permission.

## Open and redistributable sources

### Open English WordNet (OEWN)

**Provenance and coverage.** OEWN is a community-maintained fork of Princeton WordNet. It groups lemmas into synsets and links them with relations including hypernymy, antonymy, and meronymy. The current documented core release is **2025**, with 135,969 words, 107,519 synsets, and 355,064 relations; the separate Plus edition adds manually validated proper nouns. Releases are downloadable as LMF/XML, JSON, RDF, and WNDB, and the project documents a hosted JSON API. [[Official repository, releases, scope, and API](https://github.com/globalwordnet/english-wordnet)]

**Rights.** The resource is derived from Princeton WordNet under the bundled WordNet License and is further developed under CC BY 4.0. Its license explicitly permits sharing and adaptation while requiring attribution to **both Princeton WordNet and the Open English WordNet team**. [[OEWN license](https://github.com/globalwordnet/english-wordnet/blob/master/LICENSE.md); [underlying WordNet license](https://github.com/globalwordnet/english-wordnet/blob/master/WNDB_License.txt)]

**What it can validate.** OEWN is the strongest open first source in this review for lemma/POS membership, enumerated senses and glosses, stable sense identifiers, and semantic relations. Sense-linked examples and verb frames can support a claim when present. Its manual-contribution policy explicitly refuses automatically generated additions that have not been manually validated, making its curation independent of Lingo Palette's LLM. [[Contribution statement](https://github.com/globalwordnet/english-wordnet#changes)]

**Limits.** OEWN is a lexical graph, not a balanced usage corpus. Its official documentation does not claim corpus frequency, statistical collocation strength, exhaustive register labels, current productivity, or that its example sentences are authentic quotations. A shared synset supports a close semantic relationship, but does not prove two words are interchangeable across syntax, register, connotation, or domain. OEWN also warns that its quality and veracity may differ from Princeton WordNet. No official OEWN CORS commitment or public API quota was located; the downloadable release is the reliable local-first route. [[OEWN scope and caveat](https://github.com/globalwordnet/english-wordnet)]

### English Wiktionary and Wiktextract

**Provenance and access.** English Wiktionary is continuously community-edited rather than a fixed publisher edition. Wikimedia supplies downloadable XML/SQL dumps, and the English site exposes the MediaWiki Action API at `https://en.wiktionary.org/w/api.php`. Wikimedia cautions that dumps are not backups, consistent, or complete. [[Wikimedia dump overview](https://meta.wikimedia.org/wiki/Data_dumps); [dump index](https://dumps.wikimedia.org/backup-index.html); [Action API documentation](https://www.mediawiki.org/wiki/API:Action_API)]

[Wiktextract](https://github.com/tatuylonen/wiktextract) is a maintained extractor that expands templates and Lua and emits JSONL fields for glosses, POS, forms, declension/conjugation, pronunciation, qualifiers/tags/topics, linkages, and examples or quotations with optional references. It is extraction infrastructure, **not an independent lexical authority**. Its code is MIT-licensed, but that code license does not relicense extracted Wiktionary content. The project describes English extraction as the most complete and labels the package alpha; parser and template changes remain a source of error. [[Wiktextract repository and field coverage](https://github.com/tatuylonen/wiktextract); [Wiktextract code license](https://github.com/tatuylonen/wiktextract/blob/master/LICENSE)]

**Rights and attribution.** Wikimedia's controlling terms generally make project text available under CC BY-SA 4.0 and GFDL, while warning that imported content can be available under only a compatible license or carry additional attribution requirements. Reusers may attribute through a hyperlink or URL to the page, a stable alternative copy with equivalent attribution, or a list of authors, and must identify modifications and preserve the applicable license/share-alike conditions. Page footer, history, and notices remain relevant; non-text media has separate licensing. [[Wikimedia Terms of Use §7](https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use/en#7._Licensing_of_Content)]

Pre-extracted [Kaikki/Wiktextract downloads](https://kaikki.org/dictionary/rawdata.html) are convenient, but the official raw-download page does not supply a separate license grant for the lexical output. Do not infer that Wiktextract's MIT license covers that data; retain Wikimedia content provenance and obligations.

**What it can validate.** A pinned entry can corroborate sense glosses, POS, morphology, pronunciation, usage qualifiers, semantic links, and usage notes. Wiktionary is especially useful where OEWN lacks inflectional or register information. Only an example explicitly represented as a quotation with a retained, independently checkable reference can support a claim of attested usage; editor-written examples support only community lexicographic judgment.

**Limits.** Wikimedia does not guarantee the truthfulness, accuracy, or reliability of user content. Sense coverage, ordering, labels, linkages, collocations, and examples are uneven. Entry presence, number of examples, and ordering are not frequency measures. A parsed missing field is not negative evidence because the source, dump, or parser may be incomplete. [[Wikimedia general disclaimer in the Terms of Use](https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use/en)]

**Browser implications.** MediaWiki officially supports unauthenticated cross-origin API requests with `origin=*`; they are processed logged-out. Browser JavaScript cannot set the normal `User-Agent`, so Wikimedia encourages `Api-User-Agent`, while automated clients remain subject to identification, throttling, and infrastructure-protection rules. [[MediaWiki cross-site requests](https://www.mediawiki.org/wiki/API:Cross-site_requests); [Wikimedia User-Agent Policy](https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy); [API Usage Guidelines](https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_API_Usage_Guidelines)]

### wordfreq

**Provenance and access.** `wordfreq` packages English frequency estimates from multiple domains: Wikipedia, subtitles, news, books, web text, Twitter, and Reddit. It combines sources by discarding each word's highest and lowest source estimate, averaging the rest, and rescaling. It offers compact and large offline wordlists and reports binned Zipf frequencies. The maintainer describes the data as a snapshot of language through about 2021 and says it is unlikely to be updated again. [[Official repository: method, sources, and sunset status](https://github.com/rspeer/wordfreq)]

**Rights.** The library code is Apache-licensed and its bundled data files are redistributable under CC BY-SA 4.0 with source-specific notices. The repository records additional attribution conditions for Google Books Ngrams, OpenSubtitles, SUBTLEX authors, and other inputs. It explicitly says a bare CSV export would not preserve the required attribution/license information. [[Official license and attribution section](https://github.com/rspeer/wordfreq#license)]

**What it can validate.** It is a useful compact prior for broad English word/form commonness and for detecting an LLM's implausible claim that a very rare form is common. Multiple source domains reduce dependence on one corpus.

**Limits.** It provides aggregate word/form estimates, not sense frequency, collocation, grammaticality, register, regional distribution, or current post-2021 usage. Binning avoids false precision but does not prove accuracy. A zero may reflect list cutoff or tokenization rather than nonexistence. It should not decide whether a sense or construction is valid.

### Leipzig Corpora Collection

**Provenance and access.** Leipzig offers versioned downloadable corpora by language, source type, year, and size. Download archives can contain sentence text, word frequencies, source metadata, tagged sentences, immediately adjacent co-occurrences, same-sentence co-occurrences, counts, and log-likelihood significance. [[Official downloads](https://wortschatz.uni-leipzig.de/en/download); [download-file format](https://wortschatz.uni-leipzig.de/documents/Format_Download_File-eng.pdf); [data provenance FAQ](https://www.wortschatz.uni-leipzig.de/en/faq-data)]

**Rights.** The official terms distinguish **downloadable text corpora under CC BY** from website/dictionary data and applications under more restrictive CC BY-NC/service conditions. Automated access is permitted through designated REST services rather than scraping. A product must record the exact selected corpus and retain its supplied attribution/source metadata; it must not assume that data obtained from the website or service inherits the download's CC BY terms. [[Official usage terms](https://www.wortschatz.uni-leipzig.de/en/usage)]

**What it can validate.** A chosen English corpus can supply raw frequency, adjacent or sentence-level co-occurrence, statistical association, POS-aware patterns when tagged files are present, and corpus-attested sentences. This is the strongest straightforward open build-time source here for rejecting unattested or statistically implausible collocations.

**Limits.** Many corpora are automatically collected from internet documents, then split into randomized sentences and stripped of original document order. Web duplication, automated processing, source quality, and corpus composition limit claims about population frequency and register. Domain/source metadata is a proxy, not an editorial register label. An observed sentence is evidence of attestation, not necessarily learner-appropriate, factually true, or error-free. No numeric REST quota or official browser CORS guarantee was located; downloads are safer than a runtime dependency.

### Tatoeba

**Provenance, rights, and access.** Tatoeba is a nonprofit community collection of sentences and translations. Weekly text exports are released under CC BY 2.0 FR, with a separate CC0 1.0 subset. CC BY reuse requires the sentence author's attribution; sentence ID, username, license, source URL, and modification state should travel with reused text. Audio has separate contributor-selected licenses. The official API is public, unauthenticated, read-only, and marks `/v1` endpoints stable, but publishes no numeric quota or explicit CORS guarantee. [[Downloads, formats, and licenses](https://tatoeba.org/en/downloads); [Terms of Use](https://tatoeba.org/en/terms_of_use); [official OpenAPI specification](https://api.dev.tatoeba.org/openapi.json)]

**What it can validate.** Tatoeba can supply openly reusable candidate examples and translations, especially when filtered to CC0, positive reviews, useful tags, and available contributor signals.

**Limits.** Tatoeba explicitly says it is community-run, does not exhaustively control content, does not verify contributors' skills, and does not professionally guarantee sentences or translations. Sentences are commonly authored or translated for the project, so they are not automatically authentic naturally occurring examples. Tags are community annotations, not editorial register judgments. The collection is not a representative corpus; its counts cannot establish English frequency or collocation strength. [[Editorial and accuracy limitations](https://tatoeba.org/en/terms_of_use#section-5)]

### Google Books Ngram Viewer data

**Provenance, rights, and access.** Google provides bulk n-gram downloads and states that Ngram Viewer graphs and data may be freely used for any purpose; acknowledgment and a link are appreciated. That permission covers aggregate n-gram data, not the underlying scanned books or full book excerpts. The live corpus changes as books are added and OCR/language detection improve, while legacy corpus versions remain queryable. [[Official documentation, datasets, limitations, and reuse statement](https://books.google.com/ngrams/info); [dataset index](https://books.google.com/ngrams/datasets)]

**What it can validate.** It is strong corroboration for diachronic book-frequency trends, fixed-phrase competition, and American/British/general-English book variants when the corpus identifier, date range, case handling, and smoothing are recorded.

**Limits.** It is aggregate book data, not contemporary conversational English. OCR error, publication and survival bias, changing corpus composition, and smoothing can distort results. It does not expose the underlying authentic examples, identify dictionary senses, or provide editorial register labels. There is no officially documented public time-series API or CORS contract; undocumented Viewer endpoints are not a product dependency.

## Licensed and hosted corpus sources

### British National Corpus (BNC XML Edition)

The BNC contains 100 million words representing a broad cross-section of late-20th-century British English: approximately 90% written and 10% spoken. No texts were added after the corpus was completed in 1994; the XML edition adds TEI metadata and POS annotation. It is excellent for normalized frequency, spoken/written and genre distribution, grammar frames, collocations, and authentic context, but is historical British evidence rather than a current-English monitor. [[Official introduction](https://www.natcorp.ox.ac.uk/corpus/index.xml?ID=intro); [XML edition record/download](https://ota.bodleian.ox.ac.uk/repository/xmlui/handle/20.500.12024/2554)]

The BNC is **not open redistributable data**. Its non-transferable license restricts distribution to the licensee or research group and prohibits third-party access. Publishing or commercially exploiting extracts is limited to applicable fair dealing; the public-server guidance warns against exposing more than brief citations. The license says there is no restriction on the licensee's results, but it separately protects corpus texts and extracts, so product rights for any derived dataset containing recoverable text or substantial corpus material must not be inferred without advice or permission. [[BNC User Licence](https://www.natcorp.ox.ac.uk/docs/licence.html); [public-access warning](https://www.natcorp.ox.ac.uk/XMLedition/index.xml?ID=licence)]

**Verdict:** strong evidence in a licensed editorial/research workflow; do not ship the corpus or its sentences in the extension under the standard license.

### COCA / English-Corpora.org

COCA's interface and separately sold data provide contemporary American English frequency by genre, collocates, n-grams, POS-aware patterns, and KWIC context. Official downloads include full text, word/genre frequency lists, collocate lists, and n-grams. These are excellent observations for contemporary US usage, not editor-approved definitions or register labels. [[COCA download products](https://www.english-corpora.org/coca/help/download.asp); [collocate help](https://www.english-corpora.org/help/collocates.asp)]

English-Corpora states that there is **no public corpus API**. Its license terms forbid bot accounts and unattended automated scraping; current web search and KWIC limits vary by account class. A web/site license is distinct from a purchased downloadable-data license, and the reviewed official pages do not grant redistribution of full text or snippets through an extension. [[Official FAQ](https://www.english-corpora.org/faq.asp); [automation terms](https://www.english-corpora.org/licenses-termsOfUse.asp); [current limits](https://www.english-corpora.org/limits.asp); [site-license versus full-text comparison](https://www.english-corpora.org/siteLicense-fulltext.asp)]

**Verdict:** manual research or separately negotiated offline/product license only; never scrape or browser-automate it for the harness.

### Sketch Engine

Sketch Engine is a proprietary analysis platform, not a corpus with one blanket provenance or license. Its Word Sketch, concordance, frequency, n-gram, grammatical-relation, and corpus-comparison tools can provide excellent evidence, but the authority and rights inherit from the selected corpus. User-built corpora can be downloaded; preloaded corpora require separate academic or commercial licensing, and generated-result downloads are capped unless negotiated. [[Terms of Use](https://www.sketchengine.eu/terms-of-use/); [account and download limitations](https://www.sketchengine.eu/guide/account-limitations/)]

The authenticated API is subject to a published fair-use policy of 100 requests/minute, 900/hour, and 2,000/day, with HTTP 429 after limits. No official browser CORS commitment was located. [[API documentation](https://www.sketchengine.eu/documentation/api-documentation/); [fair-use policy](https://www.sketchengine.eu/fair-use-policy/)]

**Verdict:** useful in a controlled licensed backend/editorial workflow, but neither an open runtime source nor permission to redistribute examples from its preloaded corpora.

## Commercial dictionary APIs

These services can offer stronger editorial definitions, sense boundaries, examples, labels, and synonym notes than open sources, but a paid/free API subscription is a content license—not a right to redistribute a dictionary or persist it offline.

### Oxford Dictionaries API — editorially strong, contractually incompatible

Oxford advertises current monolingual and bilingual data, definitions, pronunciations, etymology, grammatical data, translations, thesauri, and a Sentence Dictionary containing editorially curated and externally sourced examples; a sandbox provides 500 trial calls. [[Current Oxford Languages product page](https://languages.oup.com/products/oxford-dictionaries-api/)]

The public terms expressly prohibit using Oxford content in combination with any AI tool, including to prompt, train, fine-tune, **ground**, develop, or operate one. They prohibit persistent caching/storage except user-session formatted-display caching; offline storage requires a separate Enterprise agreement. They also forbid systematic copying and unauthorized resale/redistribution/sublicensing, require credentials to remain confidential, and impose changeable request limits. [[Oxford API terms](https://developer.oxforddictionaries.com/api-terms-and-conditions)]

**Verdict:** do not use for the LLM-connected harness under the self-service terms. A separately negotiated agreement would need to authorize both AI-grounded validation and local storage. No official CORS commitment was located.

### Merriam-Webster Dictionary API — strong learner coverage, free terms block automation

Merriam-Webster offers JSON APIs for its Collegiate Dictionary, Collegiate Thesaurus, Learner's Dictionary, and other references. Its JSON model supports numbered senses, examples, usage notes, synonym sections, grammatical/subject/status/regional/register labels, and thesaurus synonym, near-synonym, and antonym lists. A verbal illustration can be either an editor-created sentence or a sourced quotation, so it is not universally an authentic corpus example. [[Official API products](https://dictionaryapi.com/products/index); [JSON field documentation](https://dictionaryapi.com/products/json); [Learner's Dictionary coverage](https://dictionaryapi.com/products/api-learners-dictionary)]

The free license is limited to non-commercial applications, no more than two reference works, and 1,000 queries/day/reference work. It forbids automated or recorded queries unless Merriam-Webster approves them in writing. Commercial, advertising-supported, and higher-volume use requires contact and paid terms. All applications must display the Merriam-Webster logo. The reviewed terms do not grant persistent caching or redistribution, and no official CORS commitment was located. [[Terms of Service](https://dictionaryapi.com/info/terms-of-service); [FAQ](https://dictionaryapi.com/info/frequently-asked-questions); [branding guidelines](https://dictionaryapi.com/info/branding-guidelines)]

**Verdict:** not viable for automated review generation under the public free terms. It could become valuable for editorial definition/register/near-synonym checks only after written automation, storage, display, and redistribution terms are obtained.

### Cambridge Dictionary API — evaluation route, bespoke production license

Cambridge's current API page offers Advanced Learner's, American English, Business English, learner, and bilingual dictionaries and methods for entries, pronunciation, and thesaurus topics. Its public evaluation terms allow only 3,000 calls over 30 days, prohibit caching/recording/prefetching/storing content, and require a separate application-specific Development Key and executed Application Development Agreement for production. Cambridge says production fees vary by dataset and proposed use. [[API overview](https://dictionary-api.cambridge.org/api/about); [evaluation terms](https://dictionary-api.cambridge.org/api/terms-and-conditions); [licensing application](https://dictionary-api.cambridge.org/apply)]

**Verdict:** not a self-serve or BYO-key runtime source. Any production coverage, quota, caching, attribution, and redistribution rights are contract-specific and cannot be inferred from the evaluation API. No official CORS commitment was located.

### Lexicala — feature-rich, but standard terms prohibit local storage

Lexicala's official documentation describes REST access to K Dictionaries resources, with sense-level definitions, grammar and pronunciation, curated real-world examples, synonyms, and antonyms. Access is through a RapidAPI key; the documentation describes a small free testing allowance and custom packages. [[Lexicala documentation](https://api.lexicala.com/documentation/)]

The same terms prohibit local caching/storage and systematic downloading or redistribution. Offline use requires negotiating separate downloadable XML/JSON/JSON-LD data, and a standalone dictionary-entry presentation requires prior written consent. Exact feature coverage varies by selected English resource. No official CORS guarantee was located. [[Lexicala Terms of Use and FAQ](https://api.lexicala.com/documentation/#faq)]

**Verdict:** potentially valuable under a negotiated data license, but not compatible with a persistent local-first evidence store under standard API terms.

### Collins — excluded pending verifiable terms

The current publisher page advertises API access to definitions, translations, examples, phrases, and audio and displays call tiers. However, the current API-specific agreement governing caching, redistribution, attribution, automation, and key use was not available as verifiable official text in this review. No licensing permission is inferred from the marketing page or from older material. [[Current Collins API product page](https://www.collinsdictionary.com/collins-api)]

**Verdict:** do not shortlist or implement until Collins supplies the current agreement and explicitly authorizes the intended automated LLM-gating and extension storage/display model.

## Minimal first-version evidence stack

The recommendations in this section are product judgments rather than claims made by the source publishers.

1. **[Product inference] Bundle a version-pinned OEWN core release as the primary sense graph.** Use it for lemma, POS, sense, gloss, and semantic-relation gates. Store OEWN sense IDs on review items, include both required attributions, and treat an OEWN miss as “not established,” never “false.”
2. **[Product inference] Bundle `wordfreq` with its complete license and source notices as a compact general-frequency prior.** Use conservative bands rather than precise cutoffs, record the snapshot's through-2021 horizon, and never map frequency to a specific sense.
3. **[Product inference] Build a compact evidence index from one versioned Leipzig English corpus under that download's CC BY terms.** Retain corpus identity, year, source type, counts, association metric, and attribution. Use it for attestation, adjacent/sentence co-occurrence, and pattern evidence; do not expose source sentences unless the selected dataset's attribution and product handling are satisfied.
4. **[Product inference] Add a pinned English Wiktionary/Wiktextract snapshot only for gaps OEWN does not cover well: morphology, explicit usage labels/notes, and source-linked quotations.** Keep page/revision URLs, applicable license and author attribution, parser version, raw qualifier text, and modification state. Ship the extracted data as a separately identified licensed asset rather than implying that the extractor's MIT license controls it.
5. **[Product inference] Keep Tatoeba CC0 examples and Google Books Ngrams optional.** Tatoeba can enlarge a candidate-example pool but cannot approve an item by itself. Google Ngrams can adjudicate diachronic phrase comparisons but is unnecessary for the first synchronous gate.
6. **[Product inference] Exclude BNC, COCA, Sketch Engine, and all reviewed commercial dictionaries from first-version runtime dependencies.** They remain useful for manual benchmark-set construction or later separately licensed pipelines. Oxford's public AI prohibition is a hard exclusion, not merely a pricing concern.

## Gate policy by claim

- **[Product inference] Definition/sense:** accept only when the generated target meaning can be aligned to a versioned OEWN synset or a traceable Wiktionary sense. Store the exact sense evidence. If the item combines senses or has only lemma-level support, reject or send to manual review.
- **[Product inference] Grammar:** require matching POS/morphology plus either a source-recorded frame/usage note or repeated POS-aware corpus attestations. A corpus pattern establishes use, not a universal prescription.
- **[Product inference] Collocation:** require a documented corpus, window definition, raw count, and association statistic. Apply a minimum raw count before trusting high association scores, which can over-rank rare accidents. Never use an LLM's confidence score as evidence.
- **[Product inference] Example:** verify that target form, POS, sense, and construction agree with the lexical record and corpus pattern. Label source quotations separately from editor/community-created examples. Reusing a sentence requires its own attribution/license handling; generating a new sentence from an attested pattern does not make the source sentence redistributable.
- **[Product inference] Register/variety/domain:** require an explicit lexicographic label or usage note. Corpus genre/region distribution may corroborate or challenge that label but must be stored as a distributional proxy, not silently converted into “formal,” “informal,” “US,” or “UK.”
- **[Product inference] Frequency:** record source, variety/domain, time coverage, token/lemma choice, and scale. Use broad bands and multiple signals where a frequency claim affects pedagogy. Zero or absence is always inconclusive.
- **[Product inference] Near-synonym distinction:** a shared OEWN synset or thesaurus link proves relatedness, not interchangeability. Generate a contrast item only when there is explicit source evidence for the distinguishing dimension—sense restriction, grammar, collocation, register, connotation, or domain—and corpus evidence supports the proposed contexts. Otherwise abstain.

## Provenance and operational requirements

- **[Product inference] Evidence records should be immutable and inspectable:** source identifier, release/dump/revision and retrieval date, source locator, license/attribution payload, lemma/POS/sense IDs, claim dimension, metric or short evidence, corpus variety/genre/time, parser version, and decision.
- **[Product inference] Separate source tiers in code and UI:** open redistributed asset, open hosted API, licensed corpus, and proprietary API. Never let a hosted API response enter the offline evidence bundle unless its terms explicitly permit caching and redistribution.
- **[Product inference] Pin releases and rerun gates on upgrade.** OEWN, Wiktionary, corpus downloads, parser output, and live Ngram results can change. Existing accepted items should retain the evidence version that approved them.
- **[Product inference] Abstain on conflicts and missing dimensions.** Two weak sources do not become authoritative by agreement. A review item should not claim “common,” “formal,” “takes this preposition,” “authentic example,” or a fine synonym distinction unless the matching evidence dimension passes.
- **[Product inference] Prefer offline downloads for the extension.** Of the reviewed sources, only MediaWiki supplied explicit cross-origin browser instructions. Public URLs, browser demos, and API keys are not evidence of CORS support. Publisher credentials that must remain confidential must never be embedded as a shared extension secret.

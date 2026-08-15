# First Release Contract

The first release is an unpacked Chrome Desktop extension for the initial learner. It proves that selection-based assistance, local learning data, and evidence-gated review work together during real reading before Chrome Web Store publication.

## Required scenarios

The release must complete these flows end to end on Supported Reading Surfaces:

For this release, Supported Reading Surfaces are rendered text in ordinary `http://` and `https://` top-level documents and same-origin embedded documents. Cross-origin embedded documents, browser and extension pages, the built-in PDF viewer, local files, canvas or image text, and form or editor surfaces are excluded.

Website access uses optional host permissions. The Learner explicitly enables the current origin, after which Lingo Palette registers the Reading Flow for its top-level documents and same-origin frames. Settings lists Enabled Sites and supports revocation. The extension does not request install-time access to all websites, and page content cannot choose an origin.

The suggested keyboard entry command is `Ctrl+Shift+L` on Windows and Linux and `Command+Shift+L` on macOS. It is scoped to Chrome. Settings displays the actual Chrome binding and an unbound/conflict state with a route to `chrome://extensions/shortcuts`; it never assumes the suggestion was accepted. Escape, Tab, Enter, Space, and arrow keys remain interaction keys.

Quick Hint and Deep Dive accept a Selection of at most 4,000 Unicode code points and at most 2,000 code points of Reading Context on each side. Reading Context may stop early at a natural text boundary; the Selection itself is never truncated. An over-limit Selection remains available in the anchored surface, which reports the measured length and limit and requires the Learner to select less text before using those Actions. Pronunciation Playback applies its separate sentence-bounded queue contract.

OpenAI assistance payloads contain only the Selection, bounded Reading Context, Learning and Explanation Language, Action contract, and applicable Personal Instructions. They exclude page URL, page title, DOM, Enabled Site, and Lookup history. Lookup Records may locally retain a sanitized source URL with credentials and fragment removed and query removed by default.

The default assistance model is `gpt-5.4-mini-2026-03-17`; `gpt-5.4-nano-2026-03-17` is the curated lower-cost option. An advanced Custom OpenAI model ID is used exactly as entered. Unknown custom-model pricing disables estimated-cost budgeting for that model while retaining the hard token budget, and an incompatible model produces an explicit failure without fallback.

A Custom OpenAI model is changed through Test and activate. The Learner explicitly authorizes a minimal strict-schema Responses probe for every distinct configured effort; probes reserve foreground tokens and display usage. All probes must succeed before the active configuration switches atomically. Failure retains the prior configuration and reports the exact incompatibility without fallback.

Reasoning effort is configured separately by workload. Quick Hint defaults to `low`; Deep Dive defaults to `medium`; background Review Generation and evaluation default to `medium`. Curated models expose only documented supported values. A custom model uses the exact configured value and reports incompatibility rather than silently changing effort.

Personal Instructions accept at most 4,000 Unicode code points and apply only to Quick Hint and Deep Dive beneath their extension-owned purpose and schema. They never affect Learning, Review Generation or validation, Evidence Packs, budgets, retry, capability probes, or Pronunciation Playback. Settings rejects an over-limit value with its measured length and never truncates it.

Daily budgets reset at the Learner device's local midnight. The persisted budget date only advances, so moving the clock or time zone back cannot reopen an earlier day's allowance. Settings and usage surfaces show the active budget date and next local reset time.

Daily limits default to 100,000 total provider tokens and US$1.00 estimated cost. Learners may configure 10,000–2,000,000 tokens and US$0.10–20.00, or set zero to disable provider Actions. For known-price models both limits apply and either can block reservation. Provider-reported usage, including usage from failed attempts, is charged to the ledger.

Pronunciation Playback uses a browser-reported local voice only when `localService` is true and its normalized language tag exactly matches `en-US` or `en-GB`. Voice names, the default flag, and generic `en` tags do not establish variety. Without an exact match, the disclosed fallback uses `gpt-4o-mini-tts-2025-12-15` with voice `cedar`, explicit variety instructions, and chunks below both the 4,096-character and 2,000-token provider limits.

Known-price estimates use a catalog packaged with the extension, including each curated text and speech model rate and checked date. The interface calls the dollar boundary an estimated-cost limit, shows that date and an OpenAI Usage Dashboard link, and warns when stale. It neither disables Actions nor downloads behavior-changing price configuration; rate updates ship with the extension.

An Encounter is automatically joined to an existing Learning Item only when the normalized expression matches and both records are pinned to the same source sense ID in the same Evidence Pack version. Otherwise saving creates a separate Learning Item without interrupting the Reading Flow. Background classification may add a Merge Suggestion to Saved, where both contexts are shown with Merge, Keep separate, and later Undo; Encounter identity and provenance are never discarded.

Automatic sense pinning occurs only when Evidence Pack lookup by normalized expression, morphology, and part of speech leaves exactly one eligible sense. Zero or multiple candidates remain unpinned. A background model may explain a Merge Suggestion from the candidates but cannot authorize automatic merge by selecting one.

Each Learning Item has a Productive-use Intent toggle in Saved, defaulting off and never interrupting saving. Enabling it creates or resumes productive-use review; disabling it pauses future productive prompts without deleting Review Evidence or stage. Re-enabling preserves the stage and makes an overdue schedule immediately due.

1. Configure an OpenAI key, compatible model, effort, personal instructions, and hard daily budgets.
2. Select a word, phrase, sentence, and multi-sentence passage; show an unclipped anchored surface, produce Quick Hint, and open Deep Dive in Side Panel Current without replacing it on unrelated selections.
3. Play US and UK pronunciation for short and multi-sentence selections, using a local voice when available and the budgeted disclosed fallback otherwise.
4. Preserve Recent lookup records separately from Saved learning items; merge repeated same-sense encounters without destructive classification.
5. Generate, gate, and schedule review items by Knowledge Dimension, including usage-fit claims authorized by matching sense/context evidence and grammar-pattern claims authorized by source-recorded frames or usage notes, or repeated POS-aware corpus attestations. Approved Review Items and their resulting Review Evidence pin the exact dimension-specific source authority. Complete a Review Session of up to five approved due items with layered Review Judgments and no same-item repetition. A shortened session is available when only one to four unique Learning Items are due; not-yet-due items are never pulled forward to fill it.

6. Continue local, cached, and approved-review behavior offline; surface specific authentication, quota, budget, rate-limit, and provider failures without silent model fallback.
7. Export a versioned backup without API keys and import it transactionally into a fresh profile without overwriting divergent records.
8. Download, verify, activate, update, and roll back a data-only English Evidence Pack without exposing remote logic.

When more items are due, session selection ranks them by earliest `dueAt`, fewest demonstrated Review Evidence records for the measured Knowledge Dimension, lowest interval stage, earliest Learning Item creation, then stable Learning Item ID, Knowledge Dimension, and Review Item ID. “Thinnest evidence” means fewest demonstrated records; Encounters, partial judgments, and acceptable alternatives do not count. Only the highest-ranked item per Learning Item remains before taking the first five.

After covert recall, the Learner records Retrieval Fluency as Did not recall, Recalled with effort, or Recalled fluently. This remains self-assessed Review Evidence and is not represented as an objective Review Judgment.

Calibration is tracked per Knowledge Dimension. The first review is objective; after three self-assessed reviews, the next is objective. Objective items also capture Retrieval Fluency before revealing a paired Review Judgment. Two mismatches among the latest three gradable pairs switch that dimension to objective-only review; two consecutive non-mismatching pairs restore the three-to-one cadence. Unable-to-grade evidence affects neither transition.

Only an objectively scored demonstrated Review Judgment advances one interval stage. Objective acceptable-alternative and partial retreat one stage; not-demonstrated resets to one day; unable-to-grade changes neither stage nor due time. Self-assessed recalled-fluently keeps the stage and schedules its current interval from the attempt, recalled-with-effort retreats one stage, and did-not-recall resets to one day.

An objectively demonstrated review at 180 days enters a 365-day maintenance stage. Further demonstrated judgments or recalled-fluently self-assessments keep that interval. Acceptable-alternative, partial, or recalled-with-effort retreats from maintenance to 180 days; not-demonstrated or did-not-recall resets to one day. No schedule becomes permanent mastery.

The first English Evidence Pack contains Open English WordNet 2025 core JSON, the English subset of wordfreq 3.1.1, and Leipzig `eng_news_2023_100K`, each with separate provenance, license, notices, attribution, and source hashes. OEWN and wordfreq use their publisher-issued hashes; Leipzig records a locally computed acquisition hash explicitly identified as such. Wiktionary-derived data and hosted Wiktionary fallback are excluded until their extraction graph and contributor attribution are reproducible.

Evidence Packs are published from the packaged origin `https://tzurae.github.io/lingo-palette-evidence/`. Trusted extension code constructs paths only from supported language and version identifiers. CI rebuilds and verifies candidates; publication requires a detached signature produced with the Product Owner's offline private key, followed by repository-maintainer approval through the protected `evidence-pack-production` environment.

The Learner manages the pack in Settings. “Inspect and download” streams a bounded candidate into staging and discloses its installed size and license attributions; only a second explicit confirmation changes the active pointer. Every download, signature, compatibility, decompression, schema, file-integrity, staging, or activation failure leaves the prior known-good active pack unchanged. Settings restores the active and rollback pointers after browser restart and allows rollback only when a previous known-good version exists; rollback schedules affected Review Items for background-budgeted revalidation without rewriting their pinned provenance.

Backup import is limited to 25 MiB before parsing. Portable data comprises Lookup Records, Learning Items, Encounters, Learner Notes, merge state, approved Review Items, Review Evidence, schedules, and portable model, effort, Personal Instructions, budget, pronunciation, and interface preferences. API keys, authentication, current usage ledgers/reservations, caches, background jobs, and Evidence Pack binaries are excluded; only preferred pack-version metadata is portable.

The exported backup is inspectable versioned UTF-8 JSON. Before export, the interface warns that Selection text, Reading Context, Learner Notes, and review history may be sensitive and that the resulting file is not encrypted; the Learner chooses its destination and relies on operating-system storage protection.

Each Evidence Pack release includes `manifest.json` and a detached Ed25519 signature over its exact UTF-8 bytes. The verification public key ships with the extension; the Product Owner keeps the private key offline and signs after manual approval. Signature verification precedes manifest parsing and content validation. Key rotation requires an extension update and cannot be directed by downloaded data.

An Import Report shows added, identical-skipped, and divergent-reidentified counts before confirmation and persists after commit for collision inspection. Local and imported provenance are compared side by side; the first release provides a non-destructive Keep both acknowledgment only. Imported copies retain `importedFrom` and source-backup identity, and no field merge or variant deletion occurs.

Custom Action authoring, management, invocation, and free-form output are excluded from this release. Personal Instructions continue to tailor Quick Hint and Deep Dive without replacing their built-in contracts. Any existing unshipped Custom Action generation seam is removed rather than retained as an unreachable release-external capability.

Micro-review is excluded from this release. Re-encountering a Learning Item records an Encounter without presenting retrieval during the Reading Flow or advancing review; first-release Review Evidence comes from Learner-initiated Review Sessions.

## Dogfood exit gate

Use the unpacked extension for at least 14 calendar days and accumulate at least:

- 100 selections across 10 distinct supported domains;
- 30 saved learning items;
- 5 review sessions across at least 3 separate days;
- 20 pronunciation playbacks, including 5 multi-sentence selections and both US and UK varieties; and
- one export followed by a successful fresh-profile import.

The gate closes only when:

- the supported-page smoke set passes on 20 pages across at least 10 domains, including same-origin embedded documents, viewport-edge placement, scrolling, and zoom;
- every review-generation regression case passes, and the latest 50 approved review items contain no unresolved case that teaches an invalid rule, hides a valid alternative, or uses an unsafe distractor;
- there is no unresolved data-loss, API-key disclosure or synchronization, hard-budget overrun, invalid Evidence Pack activation, or destructive-import defect;
- the complete core flow works keyboard-only and passes manual NVDA on Windows and VoiceOver on macOS smoke checks;
- offline, invalid-key, exhausted-provider-quota, local-budget, 429, 5xx, canceled-request, and Evidence Pack rollback paths have each been exercised; and
- local anchored-surface latency, measured from the Selection-stabilizing pointer or keyboard event through the animation frame in which controls are visible, is at most 100 ms at p95 and never exceeds 250 ms across the dogfood samples; results are separated by operating system, input method, and top-level versus same-origin embedded document, while provider dispatch-to-first-byte and dispatch-to-final-result latency are reported separately.

Every linguistic defect discovered during dogfood must become a permanent regression case before the gate can reopen. A known defect may be fixed; it may not be waived by lowering the quality threshold.

## Public release gate

Chrome Web Store publication is a later release. It additionally requires store-compatible permission disclosures, a minimum Chrome version of at least 116 when programmatic Side Panel opening is used, privacy and data-use disclosures naming OpenAI as the recipient of learner-selected website text, bundled third-party license and attribution notices, public contribution and security-reporting policies, and completion of the unpacked dogfood gate. Publication remains blocked until browser-held BYOK is replaced by a Lingo Palette backend proxy. Backend identity, abuse prevention, billing, and operations require a separate public-release contract. Cloud accounts, synchronization, other browsers, mobile, unsupported reading surfaces, and pronunciation assessment remain outside this contract.

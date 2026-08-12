# First-release operational constraints

**Research cutoff:** 2026-08-09  
**Scope:** first Chrome Desktop Manifest V3 release of Lingo Palette: retry/offline behavior, accessibility, backup import, downloadable Evidence Pack activation, release gates, and Apache-2.0 governance.

This note separates official constraints from product choices. Every recommendation is marked **[Product inference]**. “Official constraint” does not mean that WCAG is automatically a legal requirement for this product, or that this note is legal advice.

## 1. OpenAI retries, offline behavior, keys, and usage

### Official constraints

- OpenAI distinguishes temporary failures from failures requiring user action. A temporary rate-limit `429` may include `Retry-After`; the client should wait at least that long, otherwise use exponential backoff with jitter, and bound attempts and total retry time. Unsuccessful requests still count toward per-minute limits. Quota, billing, credit-balance, and spend-limit failures do not become usable through retrying. [[OpenAI rate-limit guide](https://developers.openai.com/api/docs/guides/rate-limits#retrying-with-exponential-backoff); [OpenAI error-code guide](https://developers.openai.com/api/docs/guides/error-codes#api-errors)]
- OpenAI documents a brief wait and retry for `500` server failures and `503` overload failures. A connection error means the request did not reach or establish a secure connection to OpenAI; a timeout may be retried after a brief wait. Authentication and malformed-request errors instead require correcting the key or request. [[OpenAI error-code guide](https://developers.openai.com/api/docs/guides/error-codes)]
- Rate limits can be measured independently in requests and tokens, vary by model, and apply at organization and project level rather than per end user. Response headers may expose remaining request/token capacity and reset times. [[OpenAI rate-limit guide](https://developers.openai.com/api/docs/guides/rate-limits#how-do-these-rate-limits-work); [rate-limit headers](https://developers.openai.com/api/docs/guides/rate-limits#rate-limits-in-headers)]
- A Responses API result has a `usage` object with input-token, output-token, and total-token counts. The OpenAI Usage Dashboard is the account-level source for usage and spend, but only organization owners or users granted Usage Dashboard permission can access it. [[Responses API `usage`](https://developers.openai.com/api/reference/resources/responses/methods/create#responses_create-response-usage); [API Usage Dashboard](https://help.openai.com/en/articles/10478918-api-usage-dashboard)]
- OpenAI explicitly says never to deploy an API key in a client-side environment such as a browser, because it can be extracted and used for unauthorized requests and charges; OpenAI recommends routing requests through a backend. It also recommends monitoring usage and rotating a leaked key. [[OpenAI API-key safety](https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety)]

### First-release decision

- **[Product inference]** Classify failures before retrying: retry only connection/timeout, `500`, `503`, and temporary rate-limit `429` failures; honor `Retry-After`, otherwise use bounded exponential backoff with jitter. Stop immediately and show an actionable state for invalid/revoked key, malformed request, credit/quota/spend limit, or exhausted retry budget. Do not hide repeated failures behind an indefinite spinner.
- **[Product inference]** Keep selection, saved contexts, review, backup, and the last activated Evidence Pack usable without a network connection. Disable only the OpenAI-dependent action while offline or after a terminal API failure; preserve the user's pending text so they can explicitly try again.
- **[Product inference]** Treat direct browser-held BYOK as an explicit release risk, not a solved secret-storage design. Before release, either route OpenAI calls through a backend or record acceptance of the direct-BYOK divergence from OpenAI's browser-key guidance; do not claim that a key stored by the extension conforms to that guidance.
- **[Product inference]** Show per-response token counts as informational usage. Link users to OpenAI's Usage Dashboard for account-level usage/spend rather than presenting a local estimate as authoritative billing data.

## 2. Keyboard, focus, and assistive announcements

### Official constraints

- WCAG 2.2 SC 2.1.1 (Level A) requires all functionality to be operable through a keyboard interface without timed keystrokes, except genuinely path-dependent input. Pointer actions therefore need a keyboard-operable route. [[W3C/WAI Understanding SC 2.1.1](https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html)]
- SC 2.1.2 (Level A) requires focus that enters a component to be able to leave using only the keyboard; if departure needs something beyond standard keys, the user must be told how. [[W3C/WAI Understanding SC 2.1.2](https://www.w3.org/WAI/WCAG22/Understanding/no-keyboard-trap.html)]
- SC 2.4.3 (Level A) requires sequential focus order to preserve meaning and operability. SC 2.4.7 (Level AA) requires a visible keyboard-focus indicator, and SC 2.4.11 (Level AA) requires an author-created overlay not to hide a focused component completely. [[W3C/WAI focus order](https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html); [focus visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html); [focus not obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html)]
- SC 4.1.3 (Level AA) requires status messages—success/results, waiting/progress, or errors that do not change context—to be programmatically determinable so assistive technology can announce them without moving focus. WAI documents `role="status"` for ordinary status and `role="alert"` or a live region for errors/warnings. [[W3C/WAI Understanding SC 4.1.3](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)]
- For a genuinely modal dialog, WAI's ARIA Authoring Practices pattern places initial focus inside, cycles `Tab`/`Shift+Tab` within it, closes on `Escape`, returns focus to the invoker in the ordinary case, gives the dialog an accessible name, and marks it modal only when outside interaction is actually prevented. This APG pattern is guidance, distinct from the normative WCAG success criteria above. [[WAI-ARIA APG modal-dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)]

### First-release decision

- **[Product inference]** Make every selection-UI and Side Panel action reachable and operable by keyboard, including opening from a keyboard text selection, choosing an action, submitting, cancelling, retrying, saving, reviewing, importing, and exporting. Use native buttons/inputs where possible and preserve the browser/page's normal keyboard behavior.
- **[Product inference]** Treat a small selection affordance as non-modal unless interaction outside it is truly blocked. Do not trap focus in a non-modal affordance. If a workflow is implemented as modal, implement the complete WAI dialog behavior, including `Escape`, contained focus, a visible close action, and logical focus restoration.
- **[Product inference]** Keep focus visible and ensure injected UI does not cover the currently focused page element. On close, restore focus to the invoking extension control or the user's prior logical position; do not move focus merely to announce loading, completion, retry delay, offline state, or an error.
- **[Product inference]** Announce “working,” “saved,” result counts, retry timing, offline state, import outcome, and errors through a restrained status/live region. Prefer polite status for progress/success and reserve assertive alert behavior for an error that requires immediate attention.

## 3. Local persistence and backup-import safety

### Official constraints

- `chrome.storage` is asynchronous, stores JSON-serializable values, and persists despite clearing browser cache/history. `storage.local` has a 10 MB limit unless the extension requests `unlimitedStorage`; it is cleared when the extension is removed and is exposed to content scripts by default unless `setAccessLevel()` restricts it. [[Chrome `storage` concepts and `storage.local`](https://developer.chrome.com/docs/extensions/reference/api/storage#concepts-and-usage)]
- `storage.sync` is approximately 100 KB total and 8 KB per item; while offline, Chrome stores changes locally and resumes synchronization when online. `storage.session` is memory-backed and is cleared on disable, reload, update, and browser restart. [[Chrome storage areas](https://developer.chrome.com/docs/extensions/reference/api/storage#storage-areas)]
- Manifest V3 service workers normally terminate after 30 seconds of inactivity, when one event/API call exceeds five minutes, or when a `fetch()` response takes more than 30 seconds. Global variables disappear with the worker, so Chrome directs extensions to persist durable state. Chrome identifies IndexedDB as providing transactional storage primitives. [[Chrome extension service-worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle#idle-and-shutdown); [persist data rather than globals](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle#persist-data-rather-than-using-global-variables)]
- Chrome's network-security guidance states that `JSON.parse` does not evaluate attacker script and that `textContent` does not inject HTML; it warns against inserting fetched data with `innerHTML`. [[Chrome cross-origin request security guidance](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests#security-considerations)]

### First-release decision

- **[Product inference]** Store learning history and the active Evidence Pack in durable extension storage, never only in a service-worker global or `storage.session`. Keep small preferences in `storage.sync` only if they fit its quota; do not put the learning corpus or API key there.
- **[Product inference]** Restrict the storage area containing learning data and authentication material to trusted extension contexts with `setAccessLevel()`. Exclude the OpenAI key and other authentication material from backup exports.
- **[Product inference]** Make export the recovery path for uninstall loss. The backup must identify its format version and contain only the user's portable learning/settings data; disclose that uninstall removes `storage.local` data.
- **[Product inference]** Treat every imported backup as untrusted data: enforce a byte limit before parsing; parse only as JSON; reject unknown versions, unexpected keys, invalid types/ranges, duplicate identifiers, and quota overflow; render imported strings with text-safe APIs; and do not evaluate any imported field as code, HTML, selector, URL, or command.
- **[Product inference]** Validate the complete import into a staged snapshot before replacing current data. On any parse, validation, migration, or write failure, leave current data intact. Use a transactional store if the selected persistence API cannot provide the all-or-nothing activation required by the final backup format.

## 4. Downloading and activating a data-only Evidence Pack

### Official constraints

- The Chrome Web Store calls JavaScript and WebAssembly loaded from outside the extension package remotely hosted code; it expressly distinguishes inert data such as JSON from remotely hosted code. [[Chrome remote-hosted-code guidance](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code)]
- Manifest V3 nevertheless requires the extension's operational logic to be self-contained and discernible from submitted code. External data must not contain logic; prohibited examples include executing fetched strings or building an interpreter for complex commands fetched as “data.” Remote configuration and other remote resources are allowed only while the functionality's logic remains packaged in the extension. [[Chrome Web Store MV3 requirements](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements)]
- A service worker or extension page can fetch a cross-origin resource only with a matching host permission. Content-script fetches remain subject to the page origin's same-origin policy. Chrome recommends HTTPS, warns against allowing a content script to choose arbitrary privileged fetch URLs, and recommends safe text/JSON handling instead of `innerHTML`. [[Chrome cross-origin network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)]
- `chrome.downloads` is for creating a browser-visible file download and requires the `downloads` manifest permission. Fetching application data for internal activation uses the cross-origin/host-permission rules instead. [[Chrome `downloads` API](https://developer.chrome.com/docs/extensions/reference/api/downloads)]

### First-release decision

- **[Product inference]** Define the Evidence Pack as versioned declarative evidence records only. Keep schema interpretation, selection, scoring, migrations, and every behavior-changing rule in the packaged extension. Reject executable text, expressions, scripts, WebAssembly, templated commands, or a pack-defined instruction language.
- **[Product inference]** Fetch only from one fixed HTTPS origin in a trusted extension context using the narrowest host permission. Content scripts may request a named pack/version from the trusted context but must never supply an arbitrary URL.
- **[Product inference]** Download to staging; cap compressed and parsed size; verify the declared format/version and every record; then persist the validated snapshot and switch the active-version pointer. On network, validation, quota, or activation failure, retain the previous pack. Bundle a minimal known-good pack so first use and offline use do not depend on the remote host.
- **[Product inference]** Do not request the `downloads` permission merely to refresh internal Evidence Pack data. Use it only if the product separately promises a user-visible file download.

## 5. Chrome Web Store and release gates

### Official constraints

- A product that handles any user data must publish an accurate, current privacy policy that comprehensively discloses collection, use, sharing, and every recipient, and link it in the Chrome Web Store dashboard. Chrome defines handling to include local-only processing/storage, and website content and browsing activity are user data. [[Chrome Web Store privacy policy](https://developer.chrome.com/docs/webstore/program-policies/privacy); [user-data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq#does-an-extension-need-to-disclose-user-data-handling-if-the-data-is-only-processed-or-stored-locally-on-a-users-device)]
- User data may be collected, used, or transmitted only as necessary for the disclosed single purpose. Browsing activity may be collected only as required for a user-facing feature prominently described in the listing and UI; transfer to a third party is allowed only under the policy's enumerated purposes, including when necessary to provide or improve that single purpose. [[Chrome Web Store Limited Use policy](https://developer.chrome.com/docs/webstore/program-policies/limited-use)]
- A product collecting user data must handle it securely, transmit it using modern cryptography, and keep authentication information secure. [[Chrome Web Store handling requirements](https://developer.chrome.com/docs/webstore/program-policies/data-handling)]
- Extensions must request only the narrowest permissions needed for current features, including optional permissions. An update that adds permissions can prompt users to accept them or disable the extension. [[Chrome minimum-permission FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq#minimum-permission)]
- The Side Panel API requires Manifest V3, the `sidePanel` permission, and Chrome 114 or later. Programmatic `sidePanel.open()` is available from Chrome 116 and must follow a user interaction. [[Chrome Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)]
- Chrome checks for extension updates on startup and every few hours, but installs an update only when the extension is idle; an open side panel or other extension page can delay installation. Setting a higher `minimum_chrome_version` causes existing users on older Chrome versions to stop receiving later extension updates. [[Chrome extension update lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/extensions-update-lifecycle)]

### First-release gate

- **[Product inference]** **Privacy gate:** the listing, in-product disclosure, and privacy policy must state that selected website text is sent to OpenAI at the user's request, identify OpenAI as the recipient, explain local learning-data/key handling and deletion/export behavior, and describe Evidence Pack network access. Data declarations must match actual permissions and traffic.
- **[Product inference]** **Permission gate:** justify every required and host permission against a shipping feature. Scope OpenAI and Evidence Pack host access to exact HTTPS origins; do not request `downloads`, broad browsing, or future permissions without a current need.
- **[Product inference]** **Compatibility gate:** set the minimum Chrome version to 116 if selection UI uses `sidePanel.open()`; otherwise set it to the earliest version that supports every used API. Exercise upgrade with an open panel and with persisted pre-release data because rollout is neither simultaneous nor guaranteed while an extension remains active.
- **[Product inference]** **Resilience gate:** verify offline startup with the bundled/last-good pack, bounded retry categories, interrupted service-worker work, failed pack activation, quota exhaustion, and a failed backup import without loss of current data.
- **[Product inference]** **Accessibility gate:** complete keyboard-only and assistive-technology checks for injected selection UI, Side Panel, loading/error/status updates, import/export, focus restoration, and overlays against the cited WCAG 2.2 A/AA constraints.
- **[Product inference]** **Store-policy gate:** inspect the submitted built package—not only source—for remote code or a data interpreter. Reviewers must be able to determine all behavior from packaged code plus a clearly documented inert Evidence Pack schema.

## 6. Apache-2.0 licensing and governance

### Official constraints

- Apache License 2.0 grants recipients a perpetual, worldwide, non-exclusive, no-charge, royalty-free copyright license and a patent license limited to contributor patent claims necessarily infringed by their contributions. The patent grant terminates for a work when a licensee files specified patent litigation alleging that work or a contribution infringes. [[Apache License 2.0 §§2–3](https://www.apache.org/licenses/LICENSE-2.0.txt)]
- Redistribution requires a copy of the license, prominent change notices in modified files, retention of applicable copyright/patent/trademark/attribution notices, and preservation of applicable attributions from a distributed `NOTICE` file. `NOTICE` is informational and does not change the license. [[Apache License 2.0 §4](https://www.apache.org/licenses/LICENSE-2.0.txt)]
- Unless explicitly stated otherwise, a contribution intentionally submitted for inclusion is offered under Apache-2.0 without extra terms; a separate license agreement can govern instead. Apache-2.0 does not grant rights to a licensor's names or trademarks except customary origin description and reproduction of NOTICE content. [[Apache License 2.0 §§5–6](https://www.apache.org/licenses/LICENSE-2.0.txt)]
- The license disclaims warranties and limits contributor liability subject to applicable law. It does not require publishing modifications merely because they were made; redistribution remains subject to the license conditions. [[Apache License 2.0 §§7–8](https://www.apache.org/licenses/LICENSE-2.0.txt); [ASF licensing FAQ](https://www.apache.org/foundation/license-faq.html#Must-Contribute)]
- ASF says Apache-2.0 was designed for use by non-ASF projects. Its application guidance says to include a copy of the license, consider a NOTICE file, and optionally use the short source notation `SPDX-License-Identifier: Apache-2.0`. Third-party works in a distribution can carry separate license/notice obligations. [[ASF licensing FAQ: applying the license](https://www.apache.org/foundation/license-faq.html#Apply-My-Software); [scope and third-party works](https://www.apache.org/foundation/license-faq.html#Scope)]

### First-release decision

- **[Product inference]** Adopt unmodified Apache-2.0 for code and project-authored documentation; include the full `LICENSE` in the source repository and distributed extension, and use the SPDX identifier consistently. Add `NOTICE` only for real required attributions—do not use it to invent additional license conditions.
- **[Product inference]** State the inbound-contribution rule plainly: intentionally submitted contributions are Apache-2.0 unless the maintainers approve a separate written agreement. Require contributors to identify material they do not own rather than assuming a pull request can relicense third-party code or data.
- **[Product inference]** Apache-2.0 on the repository does not establish rights to third-party dictionaries, corpora, studies, examples, trademarks, or Evidence Pack records. Make provenance, source URL/version, license, required attribution, redistribution permission, and modification status mandatory per pack source; block release or pack activation when those rights are missing or incompatible.
- **[Product inference]** Publish a small governance rule naming who can approve extension releases, Evidence Pack releases, dependency/data-license changes, and security fixes. Require release approval to cover the privacy/permission declarations, built-package remote-code audit, third-party notices, and Evidence Pack provenance—not just source-code review.

## Consolidated first-release stop conditions

**[Product inference]** Do not ship the first public release while any of these remains unresolved:

1. direct browser BYOK has neither a backend resolution nor an explicitly accepted and disclosed risk;
2. API retry classes, terminal states, and offline behavior are indistinguishable to the user;
3. keyboard-only selection-to-result, focus restoration, or status/error announcement fails;
4. backup import can partially replace valid data, import authentication material, or exceed quota without preserving current data;
5. an Evidence Pack can supply logic, arrive from an arbitrary URL, or replace the last-good pack before complete validation;
6. Chrome Web Store privacy, recipient, Limited Use, secure-transmission, or minimum-permission declarations differ from shipped behavior; or
7. Apache-2.0 files, contribution terms, third-party notices, or Evidence Pack redistribution provenance are incomplete.

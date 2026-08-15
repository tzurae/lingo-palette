# Lingo Palette

Lingo Palette helps a learner understand and retain English encountered while reading non-native web content. Its initial learner is the product owner, while its language concepts remain applicable to future locales.

## Language

**Learner**:
The person using Lingo Palette to understand and retain a language encountered while reading.
_Avoid_: User, reader

**Learning Language**:
The language the learner is trying to understand and retain. The initial learning language is English.
_Avoid_: Target language, content language

**Explanation Language**:
The language used to explain material from the learning language. The initial explanation language is Traditional Chinese.
_Avoid_: Translation language

**Interface Language**:
The language used by the product interface. The initial interface language is Traditional Chinese.
_Avoid_: App language, display language

## Reading

**Reading Flow**:
The learner's ongoing effort to understand a web page without losing their place or train of thought.
_Avoid_: Browsing session

**Selection**:
The learning-language material the learner deliberately marks for understanding during the reading flow.
_Avoid_: Highlight, selected text

**Reading Context**:
The bounded surrounding language needed to interpret a selection as it is used on the current page.
_Avoid_: Page content, document

**Supported Reading Surface**:
A page or embedded page area within which Lingo Palette promises the complete selection-based Reading Flow.
_Avoid_: Any webpage, compatible page

**Enabled Site**:
A web origin on which the Learner has explicitly authorized Lingo Palette to provide Supported Reading Surfaces.
_Avoid_: Whitelisted domain, trusted website

**Lookup**:
An attempt to understand learning-language material encountered during the reading flow well enough to continue reading.
_Avoid_: Search, query, translation

**Quick Hint**:
A context-sensitive, simpler expression of selected learning-language material, short enough to absorb without interrupting the reading flow. It may be a simpler word, a brief paraphrase, or, only when needed for reliability, a short explanation-language cue.
_Avoid_: Synonym, definition, translation

## Assistance

**Action**:
A named form of assistance the learner deliberately requests for a selection.
_Avoid_: Menu type, function

**Custom Action**:
An action whose name and instructions are defined by the learner rather than by Lingo Palette.
_Avoid_: Custom prompt, custom menu

**Personal Instructions**:
The learner's preferences that tailor a built-in action without replacing its purpose or required result.
_Avoid_: Custom prompt, system prompt

**Pronunciation Playback**:
Audio rendering of a learner-chosen selection of any length in a chosen pronunciation variety, initially US or UK English. Long selections remain one playback experience even when rendered in sentence-bounded chunks.
_Avoid_: Word pronunciation, pronunciation practice, speech assessment

## Learning

**Lookup Record**:
A recoverable record of a completed lookup. It preserves what the learner encountered without committing it to future review.
_Avoid_: Learning item, review item

**Learning Item**:
A particular learning-language expression with one contextually distinct meaning that the learner deliberately retains for organization and future review. Repeated encounters with the same expression and meaning belong to the same learning item.
_Avoid_: Lookup record, saved word, flashcard

**Productive-use Intent**:
The Learner's current choice that a Learning Item should include review of active expression use in addition to receptive knowledge.
_Avoid_: Productive mastery, global review mode

**Encounter**:
One occasion on which the learner meets a learning item in a particular reading context.
_Avoid_: Duplicate learning item, lookup record

**Merge Suggestion**:
A reversible recommendation to associate a separately saved Encounter with an existing Learning Item when automatic classification lacks sufficient evidence.
_Avoid_: Duplicate warning, forced merge

**Learner Note**:
Content the learner deliberately attaches to a learning item for personal reference without asserting that it is validated language evidence.
_Avoid_: Review evidence, language fact

## Review

**Knowledge Dimension**:
One of five distinct aspects of knowing a learning item: contextual meaning, usage fit, grammar pattern, collocation, or productive use. Productive use is included only when the learner intends to use the expression actively.
_Avoid_: Mastery score, learning level

**Review Item**:
A grounded prompt, accepted answer set, and corrective explanation designed to elicit evidence about one knowledge dimension of a learning item.
_Avoid_: Question, quiz card, flashcard

**Review Evidence**:
An observed result from attempting a review item, identified by knowledge dimension and response method. Self-assessment and objectively scored responses are distinct kinds of review evidence.
_Avoid_: Mastery score, review result

**Retrieval Fluency**:
The Learner's behavior-anchored self-report after covert recall: did not recall, recalled with effort, or recalled fluently.
_Avoid_: Confidence score, Review Judgment

**Review Judgment**:
An interpretation of a response as demonstrated, an acceptable alternative, partial, not demonstrated, or unable to grade for the review item's knowledge dimension.
_Avoid_: Score, correct or incorrect

**Evidence Pack**:
A versioned, language-specific collection of licensed lexical and usage evidence used to validate review items independently of the generating model.
_Avoid_: Dictionary, model knowledge

**Review Source Authority**:
The dimension-specific Evidence Pack provenance that authorized an approved Review Item and remains pinned to the resulting Review Evidence. Usage fit requires matching sense/context evidence; grammar pattern requires a source-recorded frame or usage note, or repeated POS-aware corpus attestations.
_Avoid_: Model rationale, generic citation, cross-dimension evidence

**Review Session**:
A learner-initiated sequence of due review items, bounded so completing it does not require clearing the entire review queue.
_Avoid_: Daily test, due-item backlog

**Micro-review**:
An optional retrieval opportunity offered when the learner deliberately selects a learning item encountered again during the reading flow.
_Avoid_: Interruption, automatic quiz

## Portability

**Import Report**:
A persistent account of a backup import's additions, identical records skipped, and divergent records preserved for Learner inspection.
_Avoid_: Merge result, import log

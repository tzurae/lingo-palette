import type { ProviderUsage } from '../openai/budget-ledger';
import { MAXIMUM_PRONUNCIATION_CHUNK_CHARACTERS } from './limits';

export type PronunciationVariety = 'en-US' | 'en-GB';
export function pronunciationInstructions(
  variety: PronunciationVariety,
): string {
  const varietyName =
    variety === 'en-US'
      ? 'natural General American English'
      : 'natural standard British English';
  return `Speak the complete text in ${varietyName}. Preserve the wording exactly; do not add, omit, translate, or explain anything.`;
}
export function conservativeTokenCount(text: string): number {
  let bytes = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    bytes +=
      codePoint <= 0x7f
        ? 1
        : codePoint <= 0x7ff
          ? 2
          : codePoint <= 0xffff
            ? 3
            : 4;
  }
  return bytes;
}


const maximumChunkTokens = 1_999;

export function chunkSelection(
  text: string,
  countTokens: (value: string) => number,
): string[] {
  if (text.length === 0) return [];
  const chunks: string[] = [];
  const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
  let pending = '';
  for (const { segment } of segmenter.segment(text)) {
    const combined = `${pending}${segment}`;
    if (fitsChunk(combined, countTokens)) {
      pending = combined;
      continue;
    }
    if (pending.length > 0) chunks.push(pending);
    pending = '';
    if (fitsChunk(segment, countTokens)) {
      pending = segment;
      continue;
    }
    const pieces = splitOversizedSegment(segment, countTokens);
    chunks.push(...pieces.slice(0, -1));
    pending = pieces.at(-1) ?? '';
  }
  if (pending.length > 0) chunks.push(pending);
  return chunks;
}

function splitOversizedSegment(
  segment: string,
  countTokens: (value: string) => number,
): string[] {
  const chunks: string[] = [];
  let remaining = Array.from(segment);
  while (remaining.length > 0) {
    const whole = remaining.join('');
    if (fitsChunk(whole, countTokens)) {
      chunks.push(whole);
      break;
    }
    let low = 1;
    let high = Math.min(
      MAXIMUM_PRONUNCIATION_CHUNK_CHARACTERS,
      remaining.length,
    );
    let maximum = 0;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = remaining.slice(0, middle).join('');
      if (fitsChunk(candidate, countTokens)) {
        maximum = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    if (maximum === 0) {
      throw new Error('Selection contains a character that exceeds the token ceiling.');
    }
    let cut = maximum;
    for (let index = maximum - 1; index > 0; index -= 1) {
      if (/\s/u.test(remaining[index] ?? '')) {
        cut = index + 1;
        break;
      }
    }
    chunks.push(remaining.slice(0, cut).join(''));
    remaining = remaining.slice(cut);
  }
  return chunks;
}

function fitsChunk(
  text: string,
  countTokens: (value: string) => number,
): boolean {
  return (
    Array.from(text).length <=
      MAXIMUM_PRONUNCIATION_CHUNK_CHARACTERS &&
    countTokens(text) <= maximumChunkTokens
  );
}

export type LocalVoice = {
  id: string;
  lang: string;
  localService: boolean;
  name: string;
  default: boolean;
};
export type VoiceDiscovery = {
  getVoices(): LocalVoice[];
  waitForVoices(
    variety: PronunciationVariety,
    signal: AbortSignal,
  ): Promise<void>;
};
export type RemoteAudio = {
  audioBase64: string;
  mimeType: string;
  source: 'cache' | 'provider';
  usage?: ProviderUsage | null;
  attempts?: number;
};

export type PronunciationPlaybackState = {
  status:
    | 'idle'
    | 'discovering'
    | 'generating'
    | 'playing'
    | 'paused'
    | 'completed'
    | 'stopped'
    | 'failed';
  variety: PronunciationVariety | null;
  source: 'local' | 'remote' | null;
  aiGenerated: boolean;
  currentChunk: number;
  totalChunks: number;
  completedCharacters: number;
  totalCharacters: number;
  message: string;
  usage: ProviderUsage | null;
  attempts: number;
};

export type PronunciationPlaybackDependencies = {
  countTokens(text: string): number;
  voices: VoiceDiscovery;
  local: {
    play(
      text: string,
      voice: LocalVoice,
      signal: AbortSignal,
    ): Promise<void>;
    pause(): void;
    resume(): void;
    stop(): void;
  };
  remote: {
    load(
      request: {
        requestId: string;
        text: string;
        variety: PronunciationVariety;
      },
      signal: AbortSignal,
    ): Promise<RemoteAudio>;
    play(audio: RemoteAudio, signal: AbortSignal): Promise<void>;
    cancel(requestId: string): Promise<void>;
    pause(): void;
    resume(): void;
    stop(): void;
  };
  id(): string;
};
export type PronunciationPlayback = {
  reportProgress(requestId: string, message: string): void;
  start(text: string, variety: PronunciationVariety): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
  getState(): PronunciationPlaybackState;
  reset(): void;
  subscribe(
    listener: (state: PronunciationPlaybackState) => void,
  ): () => void;
};

function mergeProviderUsage(
  total: ProviderUsage | null,
  current: ProviderUsage | null,
): ProviderUsage | null {
  if (current === null) return total;
  if (total === null) return { ...current };
  return {
    inputTokens: total.inputTokens + current.inputTokens,
    cachedInputTokens: total.cachedInputTokens + current.cachedInputTokens,
    outputTokens: total.outputTokens + current.outputTokens,
    reasoningTokens: total.reasoningTokens + current.reasoningTokens,
    totalTokens: total.totalTokens + current.totalTokens,
    estimatedCostUsd:
      total.estimatedCostUsd === null || current.estimatedCostUsd === null
        ? null
        : total.estimatedCostUsd + current.estimatedCostUsd,
  };
}

function providerCompletionMessage(
  variety: PronunciationVariety,
  attempts: number,
  usage: ProviderUsage | null,
): string {
  if (usage === null) {
    return `AI 產生語音 Playback 已完成；voice cedar，variety ${variety}，provider usage 無法使用。`;
  }
  const cost =
    usage.estimatedCostUsd === null
      ? 'estimated cost 無法使用'
      : `估算 US$${usage.estimatedCostUsd.toFixed(6)}`;
  return `AI 產生語音 Playback 已完成；voice cedar，variety ${variety}，${attempts} 次 provider 嘗試，共 ${usage.totalTokens.toLocaleString('en-US')} tokens（input ${usage.inputTokens.toLocaleString('en-US')}，output ${usage.outputTokens.toLocaleString('en-US')}），${cost}。`;
}

function idlePlaybackState(): PronunciationPlaybackState {
  return {
    status: 'idle',
    variety: null,
    source: null,
    aiGenerated: false,
    currentChunk: 0,
    totalChunks: 0,
    completedCharacters: 0,
    totalCharacters: 0,
    message: '尚未開始 Pronunciation Playback。',
    usage: null,
    attempts: 0,
  };
}

export function createPronunciationPlayback(
  dependencies: PronunciationPlaybackDependencies,
): PronunciationPlayback {
  const listeners = new Set<(state: PronunciationPlaybackState) => void>();
  let state = idlePlaybackState();
  let activeController: AbortController | null = null;
  let activeRequestId: string | null = null;
  let runVersion = 0;
  let paused = false;
  let pausedFrom: PronunciationPlaybackState['status'] = 'playing';
  let resumeGate: PromiseWithResolvers<void> | null = null;

  const publish = (next: PronunciationPlaybackState): void => {
    state = next;
    for (const listener of listeners) listener({ ...state });
  };

  const update = (
    changes: Partial<PronunciationPlaybackState>,
  ): void => {
    publish({ ...state, ...changes });
  };

  const waitWhilePaused = async (signal: AbortSignal): Promise<void> => {
    while (paused) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      resumeGate ??= Promise.withResolvers<void>();
      await resumeGate.promise;
    }
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  };

  const cancelActive = (publishStopped: boolean): void => {
    runVersion += 1;
    const activeSource = activeController === null ? null : state.source;
    activeController?.abort();
    activeController = null;
    if (activeSource === 'local') dependencies.local.stop();
    if (activeSource === 'remote') dependencies.remote.stop();
    if (activeRequestId !== null) {
      void dependencies.remote.cancel(activeRequestId);
    }
    activeRequestId = null;
    paused = false;
    resumeGate?.resolve();
    resumeGate = null;
    if (publishStopped && state.status !== 'idle') {
      update({
        status: 'stopped',
        message: 'Pronunciation Playback 已停止；Selection 仍保留。',
      });
    }
  };

  return {
    async start(text, variety) {
      cancelActive(false);
      const version = runVersion;
      const controller = new AbortController();
      activeController = controller;
      const requestId = dependencies.id();
      activeRequestId = requestId;
      const instructions = pronunciationInstructions(variety);
      const chunks = chunkSelection(text, (chunk) =>
        dependencies.countTokens(`${instructions}\n${chunk}`),
      );
      const totalCharacters = Array.from(text).length;
      update({
        status: 'discovering',
        variety,
        source: null,
        aiGenerated: false,
        currentChunk: 0,
        totalChunks: chunks.length,
        completedCharacters: 0,
        totalCharacters,
        usage: null,
        attempts: 0,
        message: `正在尋找本機 ${variety} voice…`,
      });

      try {
        const voice = await discoverExactLocalVoice(
          dependencies.voices,
          variety,
          controller.signal,
        );
        const source = voice === null ? 'remote' : 'local';
        update({
          source,
          aiGenerated: source === 'remote',
          message:
            source === 'local'
              ? `已選用本機 ${variety} voice。`
              : `沒有可用的本機 ${variety} voice；將使用已揭露的 AI 產生語音。`,
        });

        let completedCharacters = 0;
        let remoteCacheOnly = true;
        let providerUsage: ProviderUsage | null = null;
        let providerAttempts = 0;
        for (let index = 0; index < chunks.length; index += 1) {
          const chunk = chunks[index];
          if (chunk === undefined) continue;
          await waitWhilePaused(controller.signal);
          if (voice !== null) {
            update({
              status: 'playing',
              currentChunk: index + 1,
              message: `正在使用本機 ${variety} voice 播放第 ${index + 1}/${chunks.length} 段。`,
            });
            await dependencies.local.play(chunk, voice, controller.signal);
          } else {
            update({
              status: 'generating',
              currentChunk: index + 1,
              message: `正在產生 AI 語音第 ${index + 1}/${chunks.length} 段；voice cedar，variety ${variety}。`,
            });
            const audio = await dependencies.remote.load(
              { requestId, text: chunk, variety },
              controller.signal,
            );
            if (audio.source !== 'cache') remoteCacheOnly = false;
            providerUsage = mergeProviderUsage(
              providerUsage,
              audio.usage ?? null,
            );
            providerAttempts += audio.attempts ?? 0;
            await waitWhilePaused(controller.signal);
            update({
              status: 'playing',
              usage: providerUsage,
              attempts: providerAttempts,
              message:
                audio.source === 'cache'
                  ? `正在播放本機快取的 AI 產生語音第 ${index + 1}/${chunks.length} 段；未使用 provider budget。`
                  : `正在播放 AI 產生語音第 ${index + 1}/${chunks.length} 段。`,
            });
            await dependencies.remote.play(audio, controller.signal);
          }
          completedCharacters += Array.from(chunk).length;
          update({ completedCharacters });
        }
        if (version !== runVersion || controller.signal.aborted) return;
        activeController = null;
        activeRequestId = null;
        update({
          status: 'completed',
          currentChunk: chunks.length,
          completedCharacters: totalCharacters,
          usage: providerUsage,
          attempts: providerAttempts,
          message:
            source === 'local'
              ? `本機 ${variety} Pronunciation Playback 已完成。`
              : remoteCacheOnly
                ? `本機快取的 AI 產生語音 Playback 已完成；voice cedar，variety ${variety}，未使用 provider budget。`
                : providerCompletionMessage(
                    variety,
                    providerAttempts,
                    providerUsage,
                  ),
        });
      } catch (error) {
        if (version !== runVersion || controller.signal.aborted) return;
        activeController = null;
        activeRequestId = null;
        update({
          status: 'failed',
          message:
            error instanceof Error
              ? error.message
              : 'Pronunciation Playback 無法完成。',
        });
      }
    },

    pause() {
      if (
        activeController === null ||
        state.status === 'paused' ||
        state.status === 'completed' ||
        state.status === 'failed'
      ) {
        return;
      }
      paused = true;
      pausedFrom = state.status;
      resumeGate ??= Promise.withResolvers<void>();
      if (state.source === 'local') dependencies.local.pause();
      if (state.source === 'remote') dependencies.remote.pause();
      update({
        status: 'paused',
        message: `Pronunciation Playback 已暫停於第 ${state.currentChunk}/${state.totalChunks} 段。`,
      });
    },

    resume() {
      if (!paused) return;
      paused = false;
      if (state.source === 'local') dependencies.local.resume();
      if (state.source === 'remote') dependencies.remote.resume();
      resumeGate?.resolve();
      resumeGate = null;
      update({
        status: pausedFrom,
        message: `Pronunciation Playback 已繼續第 ${state.currentChunk}/${state.totalChunks} 段。`,
      });
    },

    reportProgress(requestId, message) {
      if (
        requestId !== activeRequestId ||
        state.source !== 'remote' ||
        state.status !== 'generating'
      ) {
        return;
      }
      update({ message });
    },

    reset() {
      cancelActive(false);
      publish(idlePlaybackState());
    },

    stop() {
      cancelActive(true);
    },

    getState() {
      return { ...state };
    },

    subscribe(listener) {
      listeners.add(listener);
      listener({ ...state });
      return () => listeners.delete(listener);
    },
  };
}

export async function discoverExactLocalVoice(
  discovery: VoiceDiscovery,
  variety: PronunciationVariety,
  signal: AbortSignal,
): Promise<LocalVoice | null> {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const selected = selectExactLocalVoice(discovery.getVoices(), variety);
  if (selected !== null) return selected;
  await discovery.waitForVoices(variety, signal);
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  return selectExactLocalVoice(discovery.getVoices(), variety);
}

export function selectExactLocalVoice(
  voices: LocalVoice[],
  variety: PronunciationVariety,
): LocalVoice | null {
  return (
    voices.find(
      (voice) =>
        voice.localService && normalizeLanguageTag(voice.lang) === variety,
    ) ?? null
  );
}

function normalizeLanguageTag(value: string): string | null {
  try {
    return Intl.getCanonicalLocales(value)[0] ?? null;
  } catch {
    return null;
  }
}

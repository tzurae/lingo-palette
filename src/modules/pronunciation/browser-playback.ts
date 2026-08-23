import type { PronunciationAudioResponse } from '../reading-flow/messages';
import {
  conservativeTokenCount,
  createPronunciationPlayback,
  selectExactLocalVoice,
  type LocalVoice,
  type PronunciationPlayback,
  type VoiceDiscovery,
} from './playback';

export function createBrowserPronunciationPlayback(): PronunciationPlayback {
  let activeAudio: HTMLAudioElement | null = null;
  let activeAudioUrl: string | null = null;
  const voices = createBrowserVoiceDiscovery();

  return createPronunciationPlayback({
    countTokens: conservativeTokenCount,
    voices,
    local: {
      play(text, selectedVoice, signal) {
        return playWithSpeechSynthesis(text, selectedVoice, signal);
      },
      pause() {
        speechSynthesis.pause();
      },
      resume() {
        speechSynthesis.resume();
      },
      stop() {
        speechSynthesis.cancel();
      },
    },
    remote: {
      async load(request, signal) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const response = (await browser.runtime.sendMessage({
          type: 'pronunciation-audio',
          requestId: request.requestId,
          selection: {
            text: request.text,
            context: { before: '', after: '' },
          },
          variety: request.variety,
        })) as PronunciationAudioResponse;
        if (signal.aborted || response.status === 'cancelled') {
          throw new DOMException('Aborted', 'AbortError');
        }
        if (response.status === 'failed') throw new Error(response.message);
        return {
          ...response.audio,
          usage: response.usage,
          attempts: response.attempts,
        };
      },
      play(audio, signal) {
        if (signal.aborted) {
          return Promise.reject(new DOMException('Aborted', 'AbortError'));
        }
        if (import.meta.env.WXT_TEST_BROWSER === 'true') {
          return Promise.resolve();
        }
        const bytes = decodeBase64(audio.audioBase64);
        activeAudioUrl = URL.createObjectURL(
          new Blob([bytes], { type: audio.mimeType }),
        );
        activeAudio = new Audio(activeAudioUrl);
        const playing = activeAudio;
        const url = activeAudioUrl;
        const completion = Promise.withResolvers<void>();
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener('abort', aborted);
          playing.onended = null;
          playing.onerror = null;
          URL.revokeObjectURL(url);
          if (activeAudio === playing) {
            activeAudio = null;
            activeAudioUrl = null;
          }
          if (error === undefined) completion.resolve();
          else completion.reject(error);
        };
        const aborted = () => {
          playing.pause();
          playing.currentTime = 0;
          finish(new DOMException('Aborted', 'AbortError'));
        };
        playing.onended = () => finish();
        playing.onerror = () =>
          finish(new Error('瀏覽器無法播放已產生的 Pronunciation audio。'));
        signal.addEventListener('abort', aborted, { once: true });
        void playing.play().catch((error: unknown) => {
          finish(
            error instanceof Error
              ? error
              : new Error('瀏覽器無法開始 Pronunciation audio。'),
          );
        });
        return completion.promise;
      },
      async cancel(requestId) {
        await browser.runtime
          .sendMessage({
            type: 'cancel-pronunciation-audio',
            requestId,
          })
          .catch(() => undefined);
      },
      pause() {
        activeAudio?.pause();
      },
      resume() {
        void activeAudio?.play().catch(() => undefined);
      },
      stop() {
        activeAudio?.pause();
        if (activeAudio !== null) activeAudio.currentTime = 0;
      },
    },
    id: () => crypto.randomUUID(),
  });
}

function createBrowserVoiceDiscovery(): VoiceDiscovery {
  if (import.meta.env.WXT_TEST_BROWSER === 'true') {
    const genericVoice: LocalVoice = {
      id: 'generic-browser-test-voice',
      lang: 'en',
      localService: true,
      name: 'Generic browser test voice',
      default: true,
    };
    return {
      getVoices: () => [genericVoice],
      waitForVoices: async () => {},
    };
  }
  return {
    getVoices: browserLocalVoices,
    waitForVoices(variety, signal) {
      if (selectExactLocalVoice(browserLocalVoices(), variety) !== null) {
        return Promise.resolve();
      }
      const completion = Promise.withResolvers<void>();
      let timeout: number | null = null;
      const cleanup = () => {
        speechSynthesis.removeEventListener('voiceschanged', changed);
        signal.removeEventListener('abort', aborted);
        if (timeout !== null) window.clearTimeout(timeout);
      };
      const changed = () => {
        if (selectExactLocalVoice(browserLocalVoices(), variety) === null) return;
        cleanup();
        completion.resolve();
      };
      const aborted = () => {
        cleanup();
        completion.reject(new DOMException('Aborted', 'AbortError'));
      };
      speechSynthesis.addEventListener('voiceschanged', changed);
      signal.addEventListener('abort', aborted, { once: true });
      timeout = window.setTimeout(() => {
        cleanup();
        completion.resolve();
      }, 2_000);
      return completion.promise;
    },
  };
}

function browserLocalVoices(): LocalVoice[] {
  return speechSynthesis.getVoices().map((voice) => ({
    id: browserVoiceId(voice),
    lang: voice.lang,
    localService: voice.localService,
    name: voice.name,
    default: voice.default,
  }));
}

function playWithSpeechSynthesis(
  text: string,
  selectedVoice: LocalVoice,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  }
  const voice =
    speechSynthesis
      .getVoices()
      .find((candidate) => browserVoiceId(candidate) === selectedVoice.id) ??
    null;
  if (voice === null) {
    return Promise.reject(
      new Error(`本機 ${selectedVoice.lang} voice 已無法使用。`),
    );
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = voice;
  utterance.lang = selectedVoice.lang;
  const completion = Promise.withResolvers<void>();
  let settled = false;
  const finish = (error?: Error) => {
    if (settled) return;
    settled = true;
    signal.removeEventListener('abort', aborted);
    utterance.onend = null;
    utterance.onerror = null;
    if (error === undefined) completion.resolve();
    else completion.reject(error);
  };
  const aborted = () => {
    speechSynthesis.cancel();
    finish(new DOMException('Aborted', 'AbortError'));
  };
  utterance.onend = () => finish();
  utterance.onerror = (event) =>
    finish(new Error(`本機 Pronunciation Playback 失敗：${event.error}。`));
  signal.addEventListener('abort', aborted, { once: true });
  speechSynthesis.speak(utterance);
  return completion.promise;
}

function browserVoiceId(voice: SpeechSynthesisVoice): string {
  return voice.voiceURI.length > 0
    ? voice.voiceURI
    : `${voice.name}\u0000${voice.lang}`;
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

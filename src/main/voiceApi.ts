import type { ApiClient } from "./apiClient";

// how long the server may take to start answering, then to send each next piece of audio
const SPEECH_START_MS = 20_000;
const SPEECH_STALL_MS = 15_000;

/**
 * Speech in and out, through the server: it holds the user's OpenAI key, so the window
 * never sees it. Audio crosses IPC as plain bytes -- a recording up, spoken audio back.
 */
export class VoiceApi {
  constructor(private readonly api: ApiClient) {}

  /** A 16 kHz mono wav recording, as text. Empty when nothing was said. */
  async transcribe(wav: Uint8Array): Promise<string> {
    const response = await this.api.binary("/voice/transcriptions", wav, "application/json");
    const { text } = (await response.json()) as { text: string };
    return text;
  }

  /**
   * The text spoken, as raw 16-bit mono pcm at 24 kHz, handed to `chunk` piece by piece
   * as the server streams it. Waiting for the whole sentence first is what made every
   * one start late -- the first piece is playable a fraction of a second in.
   */
  async speak(text: string, chunk: (pcm: Uint8Array) => void): Promise<void> {
    // No deadline on the whole: a long sentence streams for longer than any fixed one,
    // and was cut off mid-word. What is timed is the wait for the server to answer, then
    // each wait for the next piece -- a stream that stalls is given up on, a slow one not.
    const controller = new AbortController();
    let timer = setTimeout(() => controller.abort(), SPEECH_START_MS);
    const waiting = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(), ms);
    };
    try {
      const response = await this.api.binary("/voice/speech", { text }, "audio/pcm", controller.signal);
      if (!response.body) {
        chunk(new Uint8Array(await response.arrayBuffer()));
        return;
      }
      const reader = response.body.getReader();
      for (;;) {
        waiting(SPEECH_STALL_MS);
        const { done, value } = await reader.read();
        if (done) return;
        if (value?.byteLength) chunk(value);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /** Readies the server's connection to OpenAI, so the first sentence does not wait on it. */
  async warm(): Promise<void> {
    await this.api.request("POST", "/voice/warm");
  }
}

import type { ApiClient } from "./apiClient";

/**
 * Speech in and out, through the server: it holds the user's OpenAI key, so the window
 * never sees it. Audio crosses IPC as plain bytes -- a recording up, a sentence back.
 */
export class VoiceApi {
  constructor(private readonly api: ApiClient) {}

  /** A 16 kHz mono wav recording, as text. Empty when nothing was said. */
  async transcribe(wav: Uint8Array): Promise<string> {
    const response = await this.api.binary("/voice/transcriptions", wav, "application/json");
    const { text } = (await response.json()) as { text: string };
    return text;
  }

  /** The text spoken, as raw 16-bit mono pcm at 24 kHz. */
  async speak(text: string): Promise<Uint8Array> {
    const response = await this.api.binary("/voice/speech", { text }, "audio/pcm");
    return new Uint8Array(await response.arrayBuffer());
  }
}

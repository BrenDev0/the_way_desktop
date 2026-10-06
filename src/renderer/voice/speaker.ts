import { SentenceSplitter } from "../../core/voice/sentences";
import { PLAYBACK_RATE, pcmToFloat } from "../../core/voice/wav";

/** Synthesises one sentence, handing over its audio piece by piece as it streams in. */
export type Synthesize = (text: string, chunk: (pcm: Uint8Array) => void) => Promise<void>;

/**
 * How far ahead of now audio starts when the queue has run dry. Pieces arrive over the
 * network a little unevenly; starting each run this much ahead lets the next piece join
 * on seamlessly instead of each one landing a few milliseconds late -- the crackle.
 */
const LEAD_SECONDS = 0.08;

// The server's words for a missing or refused OpenAI key (voice/use_cases.py).
const KEY_PROBLEM = /needs an OpenAI key|OpenAI key was rejected/i;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Speaks a reply while the model is still writing it. Each sentence is synthesised as soon
 * as it is complete, and its audio starts playing as soon as the first piece of it
 * arrives -- not once the whole sentence has been synthesised, which made every sentence
 * start late. Sentences are synthesised in order, each after the last has finished
 * arriving, so synthesis runs ahead of playback and they follow on without a gap.
 */
export class Speaker {
  private readonly splitter = new SentenceSplitter();
  private readonly context = new AudioContext({ sampleRate: PLAYBACK_RATE, latencyHint: "playback" });
  private readonly playing = new Set<AudioBufferSourceNode>();
  // sentences are synthesised one at a time, in order, each after the last
  private chain: Promise<void> = Promise.resolve();
  private startAt = 0;
  // a piece can end halfway through a 16-bit sample; its first byte waits for the next piece
  private carry: number | null = null;
  private stopped = false;
  // every sentence has been synthesised; the context closes once the last one has played
  private finished = false;

  constructor(
    private readonly synthesize: Synthesize,
    private readonly onSpeaking: (speaking: boolean) => void,
    private readonly onError: (error: unknown) => void,
  ) {
    void this.context.resume();
  }

  feed(text: string): void {
    const sentence = this.splitter.feed(text);
    if (sentence) this.say(sentence);
  }

  /** The reply is complete: say whatever is left of it, then let go of the speakers. */
  finish(): void {
    const rest = this.splitter.flush();
    if (rest) this.say(rest);
    this.chain = this.chain.then(() => {
      this.finished = true;
      if (!this.playing.size) this.close();
    });
  }

  /** Silence, now -- the user started talking over it, or turned voice off. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const source of this.playing) source.stop();
    this.playing.clear();
    this.onSpeaking(false);
    this.close();
  }

  private close(): void {
    if (this.context.state !== "closed") void this.context.close();
  }

  private say(sentence: string): void {
    this.chain = this.chain.then(async () => {
      let played = false;
      for (let attempt = 0; !this.stopped; attempt += 1) {
        // each sentence's audio starts on a sample boundary
        this.carry = null;
        try {
          await this.synthesize(sentence, (pcm) => {
            played = true;
            this.schedule(pcm);
          });
          return;
        } catch (error) {
          if (this.stopped) return;
          // a key problem fails every sentence after this one too: stop and say why
          if (KEY_PROBLEM.test(errorText(error))) {
            this.stop();
            this.onError(error);
            return;
          }
          // a hiccup (a timeout, a dropped connection): try once more if none of it has
          // been heard, else let it go -- silencing the rest of the reply over one sentence
          // was the voice stopping mid-bubble
          if (!played && attempt === 0) continue;
          this.onError(error);
          return;
        }
      }
    });
  }

  private schedule(piece: Uint8Array): void {
    if (this.stopped) return;
    const pcm = this.aligned(piece);
    const samples = pcmToFloat(pcm);
    if (!samples.length) return;

    const buffer = this.context.createBuffer(1, samples.length, PLAYBACK_RATE);
    buffer.copyToChannel(samples, 0);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);

    // ran dry (the first piece, or a sentence that took longer to come than the last took
    // to play): start a touch ahead, so the pieces behind this one join on without a gap
    const now = this.context.currentTime;
    if (this.startAt <= now) this.startAt = now + LEAD_SECONDS;
    source.start(this.startAt);
    this.startAt += buffer.duration;

    this.playing.add(source);
    this.onSpeaking(true);
    source.onended = () => {
      this.playing.delete(source);
      if (this.playing.size || this.stopped) return;
      this.onSpeaking(false);
      if (this.finished) this.close();
    };
  }

  /** The piece with any byte left over from the last one in front, and its own odd last
   *  byte held back -- so every sample is read from the two bytes that make it. */
  private aligned(piece: Uint8Array): Uint8Array {
    let bytes = piece;
    if (this.carry !== null) {
      bytes = new Uint8Array(piece.byteLength + 1);
      bytes[0] = this.carry;
      bytes.set(piece, 1);
      this.carry = null;
    }
    if (bytes.byteLength % 2) {
      this.carry = bytes[bytes.byteLength - 1];
      bytes = bytes.subarray(0, bytes.byteLength - 1);
    }
    return bytes;
  }
}

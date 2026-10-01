import { RECORD_RATE } from "./wav";

/** Audio kept from before the talk key went down. Opening a recording takes a moment, and
 *  people start talking the instant they press -- without this the first word is cut. */
export const PREROLL_SECONDS = 0.5;

/** Nothing bounds how long a key stays down, and an unbounded recording is an unbounded
 *  upload. Past this only the most recent part is kept: the end, where they were talking. */
export const MAX_RECORD_SECONDS = 120;

/** A press shorter than this is a slip of the finger, not a sentence. */
export const MIN_RECORD_SECONDS = 0.3;

/**
 * The microphone's samples, always flowing in while voice is on. Between recordings only
 * the last PREROLL_SECONDS are held; during one, everything is, from the preroll onward.
 */
export class CaptureBuffer {
  private chunks: Int16Array[] = [];
  private held = 0;
  private recording = false;
  // how much preroll there was when the key went down -- right after the microphone opens
  // there is less than a full one
  private prerollHeld = 0;

  constructor(
    private readonly rate = RECORD_RATE,
    private readonly prerollSeconds = PREROLL_SECONDS,
    private readonly maxSeconds = MAX_RECORD_SECONDS,
  ) {}

  get isRecording(): boolean {
    return this.recording;
  }

  push(chunk: Int16Array): void {
    this.chunks.push(chunk);
    this.held += chunk.length;
    this.trim(this.recording ? this.maxSeconds : this.prerollSeconds);
  }

  /** Starts a recording that already includes the preroll. */
  start(): void {
    this.recording = true;
    this.prerollHeld = this.held;
  }

  /** Ends the recording: its samples, or null when it was too short to be speech. The
   *  preroll is set aside for the next one either way. */
  stop(): Int16Array | null {
    const samples = this.recording ? this.drain() : null;
    this.recording = false;
    if (!samples) return null;
    return samples.length - this.prerollHeld >= MIN_RECORD_SECONDS * this.rate ? samples : null;
  }

  /** Throws the recording away. */
  cancel(): void {
    this.recording = false;
    this.chunks = [];
    this.held = 0;
  }

  private drain(): Int16Array {
    const out = new Int16Array(this.held);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    this.chunks = [];
    this.held = 0;
    return out;
  }

  /** Drops whole chunks from the front while what is left still covers `seconds`. */
  private trim(seconds: number): void {
    const keep = seconds * this.rate;
    while (this.chunks.length > 1 && this.held - this.chunks[0].length >= keep) {
      this.held -= this.chunks.shift()!.length;
    }
  }
}

import { SentenceSplitter } from "../../core/voice/sentences";
import { PLAYBACK_RATE, pcmToFloat } from "../../core/voice/wav";

/**
 * Speaks a reply while the model is still writing it. Each sentence is synthesised as soon
 * as it is complete and queued to start the moment the one before it ends, so synthesis
 * runs ahead of playback and there is no gap between sentences.
 */
export class Speaker {
  private readonly splitter = new SentenceSplitter();
  private readonly context = new AudioContext({ sampleRate: PLAYBACK_RATE });
  private readonly playing = new Set<AudioBufferSourceNode>();
  // sentences are synthesised one at a time, in order, each after the last
  private chain: Promise<void> = Promise.resolve();
  private startAt = 0;
  private stopped = false;
  // every sentence has been synthesised; the context closes once the last one has played
  private finished = false;

  constructor(
    private readonly synthesize: (text: string) => Promise<Uint8Array>,
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
      if (this.stopped) return;
      try {
        const pcm = await this.synthesize(sentence);
        if (!this.stopped) this.schedule(pcm);
      } catch (error) {
        // one failed sentence would only be followed by more; stop rather than skip ahead
        this.stop();
        this.onError(error);
      }
    });
  }

  private schedule(pcm: Uint8Array): void {
    const samples = pcmToFloat(pcm);
    if (!samples.length) return;

    const buffer = this.context.createBuffer(1, samples.length, PLAYBACK_RATE);
    buffer.copyToChannel(samples, 0);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);

    // a sentence that arrives after the last one finished starts now, not in the past
    this.startAt = Math.max(this.startAt, this.context.currentTime);
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
}

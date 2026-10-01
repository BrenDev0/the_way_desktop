import { CaptureBuffer } from "../../core/voice/capture";
import { RECORD_RATE, encodeWav, toInt16 } from "../../core/voice/wav";

/** Batches the render quantum's 128 frames into tenth-of-a-second chunks, so the window
 *  gets ten messages a second rather than a hundred and twenty-five. Inlined as a blob:
 *  a worklet has to be loaded from a URL, and this keeps it out of the bundler's way. */
const WORKLET = `
class Capture extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = new Float32Array(1600); this.filled = 0; }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    let read = 0;
    while (read < channel.length) {
      const take = Math.min(channel.length - read, this.buffer.length - this.filled);
      this.buffer.set(channel.subarray(read, read + take), this.filled);
      this.filled += take; read += take;
      if (this.filled === this.buffer.length) { this.port.postMessage(this.buffer.slice()); this.filled = 0; }
    }
    return true;
  }
}
registerProcessor("capture", Capture);
`;

/**
 * The microphone, held open for as long as voice is on. Opening it takes a few hundred
 * milliseconds, which is exactly the start of what someone says when they press the key
 * and talk at once -- so it is opened once, kept running, and the last half second is
 * always on hand to put in front of a recording.
 */
export class Microphone {
  private readonly buffer = new CaptureBuffer();

  private constructor(
    private readonly stream: MediaStream,
    private readonly context: AudioContext,
    private readonly node: AudioWorkletNode,
  ) {
    node.port.onmessage = (event: MessageEvent<Float32Array>) => this.buffer.push(toInt16(event.data));
  }

  static async open(): Promise<Microphone> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    // the context resamples the device's rate down to the 16 kHz the transcriber wants
    const context = new AudioContext({ sampleRate: RECORD_RATE });
    try {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
      try {
        await context.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      const node = new AudioWorkletNode(context, "capture");
      context.createMediaStreamSource(stream).connect(node);
      await context.resume();
      return new Microphone(stream, context, node);
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      void context.close();
      throw error;
    }
  }

  get recording(): boolean {
    return this.buffer.isRecording;
  }

  start(): void {
    this.buffer.start();
  }

  /** The recording as wav, or null when it was too short to be speech. */
  stop(): Uint8Array | null {
    const samples = this.buffer.stop();
    return samples ? encodeWav(samples) : null;
  }

  cancel(): void {
    this.buffer.cancel();
  }

  close(): void {
    this.node.port.onmessage = null;
    this.node.disconnect();
    this.stream.getTracks().forEach((track) => track.stop());
    void this.context.close();
  }
}

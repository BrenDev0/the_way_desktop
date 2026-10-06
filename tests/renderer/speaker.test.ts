import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Speaker, type Synthesize } from "../../src/renderer/voice/speaker";

/** Just enough Web Audio to see what was scheduled, when, and with which samples. */
class FakeContext {
  static last: FakeContext;
  currentTime = 0;
  state = "running";
  readonly started: { at: number; samples: Float32Array; duration: number }[] = [];
  destination = {};

  constructor() {
    FakeContext.last = this;
  }

  resume() { return Promise.resolve(); }
  close() { this.state = "closed"; return Promise.resolve(); }

  createBuffer(_channels: number, length: number, rate: number) {
    const samples = new Float32Array(length);
    return { duration: length / rate, copyToChannel: (from: Float32Array) => samples.set(from), samples };
  }

  createBufferSource() {
    const source = {
      buffer: null as null | { duration: number; samples: Float32Array },
      onended: null as null | (() => void),
      connect: () => {},
      stop: () => {},
      start: (at: number) => this.started.push({ at, samples: source.buffer!.samples, duration: source.buffer!.duration }),
    };
    return source;
  }
}

/** 16-bit little-endian pcm for these sample values. */
function pcm(...values: number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 2);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setInt16(index * 2, value, true));
  return bytes;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => vi.stubGlobal("AudioContext", FakeContext));
afterEach(() => vi.unstubAllGlobals());

describe("Speaker", () => {
  it("plays each piece as it arrives, before the sentence has finished synthesising", async () => {
    let more: () => void = () => {};
    const synthesize: Synthesize = (_text, chunk) => {
      chunk(pcm(1000, 2000));
      return new Promise<void>((resolve) => { more = () => { chunk(pcm(3000)); resolve(); }; });
    };
    const speaker = new Speaker(synthesize, () => {}, () => {});

    speaker.feed("Hola mundo. ");
    await settle();

    expect(FakeContext.last.started).toHaveLength(1);
    more();
    await settle();
    expect(FakeContext.last.started).toHaveLength(2);
  });

  it("joins the pieces end to end, starting a run a little ahead of now", async () => {
    const synthesize: Synthesize = async (_text, chunk) => {
      chunk(pcm(1, 2, 3, 4));
      chunk(pcm(5, 6));
    };
    new Speaker(synthesize, () => {}, () => {}).feed("Uno. ");
    await settle();

    const [first, second] = FakeContext.last.started;
    expect(first.at).toBeGreaterThan(0);
    expect(second.at).toBeCloseTo(first.at + first.duration);
  });

  it("keeps a sample split across two pieces whole", async () => {
    const whole = pcm(1000, -2000);
    const synthesize: Synthesize = async (_text, chunk) => {
      chunk(whole.subarray(0, 3));
      chunk(whole.subarray(3));
    };
    new Speaker(synthesize, () => {}, () => {}).feed("Dos. ");
    await settle();

    const played = FakeContext.last.started.flatMap((start) => Array.from(start.samples));
    expect(played).toEqual([1000 / 0x8000, -2000 / 0x8000]);
  });

  it("carries on with the next sentence when one fails partway, instead of going silent", async () => {
    const errors: unknown[] = [];
    const asked: string[] = [];
    const synthesize: Synthesize = async (text, chunk) => {
      asked.push(text);
      chunk(pcm(1));
      if (text.startsWith("Primera")) throw new Error("The operation was aborted due to timeout");
    };
    const speaker = new Speaker(synthesize, () => {}, (error) => errors.push(error));

    speaker.feed("Primera. Segunda. ");
    speaker.feed("Tercera. ");
    await settle();

    expect(asked).toEqual(["Primera. Segunda.", "Tercera."]);
    // told about, but the rest of the reply is still spoken
    expect(errors).toHaveLength(1);
    expect(FakeContext.last.started).toHaveLength(2);
  });

  it("tries a sentence again once when nothing of it was heard", async () => {
    let calls = 0;
    const synthesize: Synthesize = async (_text, chunk) => {
      calls += 1;
      if (calls === 1) throw new Error("The server could not be reached.");
      chunk(pcm(1));
    };
    const errors: unknown[] = [];
    new Speaker(synthesize, () => {}, (error) => errors.push(error)).feed("Hola. ");
    await settle();
    await settle();

    expect(calls).toBe(2);
    expect(FakeContext.last.started).toHaveLength(1);
    expect(errors).toHaveLength(0);
  });

  it("stops on a key problem, which every later sentence would hit too", async () => {
    let calls = 0;
    const synthesize: Synthesize = async () => {
      calls += 1;
      throw new Error("Your OpenAI key was rejected. Ask an owner or admin to issue a new one.");
    };
    const errors: unknown[] = [];
    const speaker = new Speaker(synthesize, () => {}, (error) => errors.push(error));

    speaker.feed("Uno. ");
    speaker.feed("Dos. ");
    await settle();
    await settle();

    expect(calls).toBe(1);
    expect(errors).toHaveLength(1);
  });

  it("speaks sentences in order, the next one synthesised only after the last arrived", async () => {
    const asked: string[] = [];
    const synthesize: Synthesize = async (text, chunk) => {
      asked.push(text);
      chunk(pcm(1));
    };
    const speaker = new Speaker(synthesize, () => {}, () => {});

    speaker.feed("Primera. Segunda. ");
    speaker.feed("Tercera. ");
    speaker.finish();
    await settle();

    expect(asked).toEqual(["Primera. Segunda.", "Tercera."]);
  });
});

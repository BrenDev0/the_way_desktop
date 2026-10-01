import { describe, expect, it } from "vitest";
import { CaptureBuffer } from "../../src/core/voice/capture";
import { SentenceSplitter, spoken } from "../../src/core/voice/sentences";
import { encodeWav, pcmToFloat, toInt16 } from "../../src/core/voice/wav";

describe("SentenceSplitter", () => {
  it("hands over each sentence once it is complete, in order", () => {
    const splitter = new SentenceSplitter();

    expect(splitter.feed("Hola, ya rev")).toBeNull();
    expect(splitter.feed("isé el archivo. Tiene tres ")).toBe("Hola, ya revisé el archivo.");
    expect(splitter.feed("secciones")).toBeNull();
    expect(splitter.flush()).toBe("Tiene tres secciones");
    expect(splitter.flush()).toBeNull();
  });

  it("does not end a sentence inside a number or a version", () => {
    const splitter = new SentenceSplitter();

    expect(splitter.feed("Subió un 3.5 por ciento en la v1.2")).toBeNull();
    expect(splitter.feed(" del sistema. Listo")).toBe("Subió un 3.5 por ciento en la v1.2 del sistema.");
  });
});

describe("spoken", () => {
  it("drops markup that would be read aloud as punctuation", () => {
    expect(spoken("**Listo.** Mira [el reporte](https://x.io/r) en `out.html`")).toBe("Listo. Mira el reporte en out.html");
    expect(spoken("- primero\n- segundo")).toBe("primero segundo");
  });
});

describe("CaptureBuffer", () => {
  const chunk = (n: number) => new Int16Array(n).fill(1);

  it("puts the half second before the press in front of the recording", () => {
    const buffer = new CaptureBuffer(100, 0.5, 120);
    for (let i = 0; i < 10; i += 1) buffer.push(chunk(10)); // a second of quiet before
    buffer.start();
    for (let i = 0; i < 5; i += 1) buffer.push(chunk(10)); // half a second of talking

    expect(buffer.stop()?.length).toBe(100);
  });

  it("drops a press too short to be speech", () => {
    const buffer = new CaptureBuffer(100, 0.5, 120);
    buffer.push(chunk(50));
    buffer.start();
    buffer.push(chunk(10));

    expect(buffer.stop()).toBeNull();
  });

  it("keeps only the most recent part of an overlong recording", () => {
    const buffer = new CaptureBuffer(100, 0.5, 2);
    buffer.start();
    for (let i = 0; i < 50; i += 1) buffer.push(chunk(10));

    expect(buffer.stop()?.length).toBe(200);
  });

  it("throws a cancelled recording away", () => {
    const buffer = new CaptureBuffer(100, 0.5, 120);
    buffer.start();
    buffer.push(chunk(100));
    buffer.cancel();

    expect(buffer.isRecording).toBe(false);
    expect(buffer.stop()).toBeNull();
  });
});

describe("wav", () => {
  it("wraps 16 kHz mono samples in a wav header", () => {
    const wav = encodeWav(new Int16Array([0, 1000, -1000]));
    const view = new DataView(wav.buffer);

    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint32(40, true)).toBe(6);
    expect(view.getInt16(46, true)).toBe(1000);
  });

  it("round-trips samples between floats and pcm", () => {
    const pcm = new Uint8Array(toInt16(new Float32Array([0, 0.5, -1])).buffer);

    expect(Array.from(pcmToFloat(pcm)).map((x) => Math.round(x * 100) / 100)).toEqual([0, 0.5, -1]);
  });
});

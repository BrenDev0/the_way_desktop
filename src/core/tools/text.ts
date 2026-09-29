import { ToolError } from "./contract";

const encoder = new TextEncoder();

/**
 * The text of a file, with every line ending turned into "\n".
 *
 * A run of carriage returns before a newline counts as one line ending. That is the
 * damage an earlier Windows round trip leaves behind -- each rewrite adding another "\r"
 * -- and reading it this way repairs the file on its next write instead of keeping the
 * phantom blank lines. Without the normalisation an edit whose old text uses "\n" never
 * matches a file stored with "\r\n".
 */
export function decodeText(data: Uint8Array, shownPath: string): string {
  let text: string;

  if (startsWith(data, [0xff, 0xfe]) || startsWith(data, [0xfe, 0xff])) {
    text = new TextDecoder(data[0] === 0xff ? "utf-16le" : "utf-16be").decode(data.subarray(2));
  } else if (data.subarray(0, 4096).includes(0)) {
    throw new ToolError(
      `'${shownPath}' looks like a binary file, not text (it contains null bytes). ` +
        "Reading it would produce garbage, so it was not decoded.",
    );
  } else {
    text = decodeFirst(data);
  }

  return text.replace(/\r+\n/g, "\n").replace(/\r/g, "\n");
}

/** UTF-8 first (without a BOM), then the Windows default a file may have been saved in. */
function decodeFirst(data: Uint8Array): string {
  const body = startsWith(data, [0xef, 0xbb, 0xbf]) ? data.subarray(3) : data;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    try {
      return new TextDecoder("windows-1252", { fatal: true }).decode(body);
    } catch {
      return new TextDecoder("latin1").decode(body);
    }
  }
}

/** Always "\n", never translated -- the other half of keeping line endings stable. */
export function encodeText(text: string): Uint8Array {
  return encoder.encode(text);
}

function startsWith(data: Uint8Array, prefix: number[]): boolean {
  return prefix.every((byte, index) => data[index] === byte);
}

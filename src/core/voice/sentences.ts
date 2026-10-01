/**
 * Cuts a reply into sentences as it streams in, so the first one can be spoken while the
 * model is still writing the rest.
 *
 * A terminator only ends a sentence when whitespace follows it -- that is what keeps "3.5"
 * and "v1.2" from being read as two. Only the end of the last match is trusted: the
 * pattern can start matching partway through the buffer, so taking the matches themselves
 * would reorder the reply.
 */
const SENTENCE_END = /[^.!?\n]*[.!?\n]+(?=\s)/g;

export class SentenceSplitter {
  private pending = "";

  /** Adds a piece of the reply; returns whatever it completed, ready to speak. */
  feed(text: string): string | null {
    this.pending += text;
    let cut = 0;
    for (const match of this.pending.matchAll(SENTENCE_END)) cut = match.index + match[0].length;
    if (!cut) return null;

    const ready = this.pending.slice(0, cut);
    this.pending = this.pending.slice(cut);
    return spoken(ready) || null;
  }

  /** The reply is over: whatever is left, even without a full stop. */
  flush(): string | null {
    const rest = spoken(this.pending);
    this.pending = "";
    return rest || null;
  }
}

/**
 * The text as it should be heard. The model is asked for plain sentences when voice is
 * on, but markup still slips through, and read aloud it comes out as "asterisk asterisk".
 */
export function spoken(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_`#>|~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

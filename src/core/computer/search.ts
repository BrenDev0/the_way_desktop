export function foldText(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

const FILLER = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from", "i", "in", "is", "it", "my", "of", "on", "or", "that", "the", "this", "to", "was", "with",
  "al", "con", "de", "del", "el", "en", "es", "la", "las", "lo", "los", "mi", "o", "para", "por", "que", "se", "su", "sus", "un", "una", "y",
]);

/** Filler words ("of", "the", "de", "la") are dropped, or a file never says all of them; a query of nothing else is kept as it is. */
function significant(words: string[]): string[] {
  const kept = words.filter((word) => !FILLER.has(word));
  return kept.length ? kept : words;
}

export function rawTermsOf(query: string): string[] {
  return significant(query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
}

export function termsOf(query: string): string[] {
  return significant(foldText(query).split(/[^\p{L}\p{N}]+/u).filter(Boolean));
}

export const TEXT_FILE = /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|html?|log|ya?ml|ini|cfg|toml|rst|sql|py|js|ts|tsx|jsx|css)$/i;

export function snippetOf(text: string, terms: string[], width = 200): { line: number; text: string } | null {
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const folded = foldText(lines[index]);
    if (!terms.some((term) => folded.includes(term))) continue;
    const trimmed = lines[index].trim();
    return { line: index + 1, text: trimmed.length > width ? `${trimmed.slice(0, width)} ...` : trimmed };
  }
  return null;
}

export function hasAllTerms(text: string, terms: string[]): boolean {
  const folded = foldText(text);
  return terms.every((term) => folded.includes(term));
}

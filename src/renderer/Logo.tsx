const GLYPHS: Record<string, string[]> = {
  T: ["█████", "  █  ", "  █  ", "  █  ", "  █  "],
  H: ["█   █", "█   █", "█████", "█   █", "█   █"],
  E: ["█████", "█    ", "████ ", "█    ", "█████"],
  W: ["█   █", "█   █", "█ █ █", "██ ██", "█   █"],
  A: [" ███ ", "█   █", "█████", "█   █", "█   █"],
  Y: ["█   █", " █ █ ", "  █  ", "  █  ", "  █  "],
};

const ROW_COLORS = ["#00ff00", "#00d700", "#00af00", "#008700", "#005f00"];
const GLYPH_WIDTH = 5;
const LETTER_GAP = 1;
const WORD_GAP = 3;
const PIXEL = 0.84;
const INSET = (1 - PIXEL) / 2;

export function Logo({ text = "THE WAY" }: { text?: string }) {
  const cells: { x: number; y: number }[] = [];
  let cursor = 0;

  for (const ch of text.toUpperCase()) {
    if (ch === " ") {
      cursor += WORD_GAP - LETTER_GAP;
      continue;
    }
    const glyph = GLYPHS[ch];
    if (!glyph) continue;
    glyph.forEach((line, y) => {
      [...line].forEach((c, x) => {
        if (c === "█") cells.push({ x: cursor + x, y });
      });
    });
    cursor += GLYPH_WIDTH + LETTER_GAP;
  }

  const width = cursor - LETTER_GAP;

  return (
    <svg
      className="logo"
      viewBox={`-0.5 -0.5 ${width + 1} ${ROW_COLORS.length + 1}`}
      role="img"
      aria-label={text}
      shapeRendering="crispEdges"
    >
      {cells.map(({ x, y }) => (
        <rect
          key={`${x}-${y}`}
          x={x + INSET}
          y={y + INSET}
          width={PIXEL}
          height={PIXEL}
          fill={ROW_COLORS[y]}
        />
      ))}
    </svg>
  );
}

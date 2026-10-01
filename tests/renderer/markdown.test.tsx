import { writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "../../src/renderer/views/chat/Markdown";

const REPLY = `## Resumen de ventas Q3

Las ventas **crecieron 18%** frente a Q2. Detalle en el [informe](https://example.com/informe) y en \`Borradores/q3.pdf\`.

| Región | Ingresos | Variación |
|:--|--:|--:|
| Norte | $412,300 | +21% |
| Sur | $301,700 | +25% |

1. Revisar el canal directo
2. Ampliar el equipo del Sur

- [x] Informe generado
- [ ] Enviar al cliente

> Nota: el mes de septiembre aún no cierra.

\`\`\`python
print("hola")
\`\`\`

<script>alert("x")</script><img src="https://tracker.example/p.gif" onerror="alert(1)">
[raro](javascript:alert(1))`;

describe("Markdown", () => {
  const html = renderToStaticMarkup(<Markdown text={REPLY} />);
  if (process.env.MARKDOWN_SNAPSHOT) writeFileSync(process.env.MARKDOWN_SNAPSHOT, html);

  it("renders headings, emphasis, tables, lists, tasks, quotes and code", () => {
    expect(html).toContain("<h2>Resumen de ventas Q3</h2>");
    expect(html).toContain("<strong>crecieron 18%</strong>");
    expect(html).toMatch(/<table>[\s\S]*<th style="text-align:left">Región<\/th>/);
    expect(html).toContain("<ol>");
    expect(html).toMatch(/<input type="checkbox"[^>]*disabled=""[^>]*checked=""/);
    expect(html).toContain("<blockquote>");
    expect(html).toContain('<code class="language-python">');
    expect(html).toContain("COPIAR");
  });

  it("never runs raw HTML and only links to the web or mail", () => {
    // shown as text, escaped -- there is no tag, and so nothing to run or fetch
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain('onerror="');
    expect(html).not.toContain("javascript:");
    expect(html).toContain('<span class="markdown__link markdown__link--inert">raro</span>');
    expect(html).toContain('href="https://example.com/informe"');
  });
});

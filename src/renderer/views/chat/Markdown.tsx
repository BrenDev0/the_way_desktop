import { memo, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * An assistant reply as formatted text: headings, lists, tables, code, quotes, links.
 *
 * Markdown only -- raw HTML in a reply is shown as text, never run. Links open in the
 * system browser (the window itself never navigates), and an image is offered as a link
 * rather than fetched: a reply must not make the app load whatever address it names.
 */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown selectable">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
});

const COMPONENTS: Components = {
  a: ({ href, children }) => <Link href={href}>{children}</Link>,
  img: ({ src, alt }) => (
    <Link href={typeof src === "string" ? src : undefined}>{`🖼 ${alt || "imagen"}`}</Link>
  ),
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  table: ({ children }) => (
    // a wide table scrolls on its own instead of pushing the bubble past the chat
    <div className="markdown__table">
      <table>{children}</table>
    </div>
  ),
  input: ({ checked }) => <input type="checkbox" checked={Boolean(checked)} readOnly disabled />,
};

function Link({ href, children }: { href?: string; children: ReactNode }) {
  const safe = href && /^(https?:|mailto:)/i.test(href) ? href : undefined;
  if (!safe) return <span className="markdown__link markdown__link--inert">{children}</span>;
  return (
    <a
      href={safe}
      className="markdown__link"
      title={safe}
      onClick={(event) => {
        event.preventDefault();
        void window.desktop.links.open(safe);
      }}
    >
      {children}
    </a>
  );
}

function CodeBlock({ children }: { children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="markdown__code">
      <button
        type="button"
        className="markdown__copy"
        onClick={(event) => {
          const code = event.currentTarget.parentElement?.querySelector("pre")?.textContent ?? "";
          void navigator.clipboard.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? "COPIADO ✓" : "COPIAR"}
      </button>
      <pre>{children}</pre>
    </div>
  );
}

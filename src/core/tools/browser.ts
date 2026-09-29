/**
 * The browser and WhatsApp tools, ported from the command-line assistant's Selenium
 * version. The page logic lives here as scripts run through BrowserPort; the adapter only
 * owns the window.
 */

import { count, text, ToolError, flag, type ToolArgs, type ToolRegistry } from "./contract";
import type { BrowserPort } from "./ports";

const MAX_TEXT = 6000;
const WHATSAPP_TIMEOUT = 60_000;
// WhatsApp filters the chat list as you type; this is how long that takes to settle.
const SEARCH_SETTLE = 2000;
// A conversation renders after its composer does, and keeps filling in after that.
const MESSAGES_TIMEOUT = 15_000;
const BUBBLE_SETTLE = 1500;
const POLL = 250;

// Read off a signed-in WhatsApp Web, tried in order so one stale selector degrades to the
// next instead of to a failure. Nothing keys off an English label: the search box is the
// one text input in the sidebar, whatever its aria-label says in the user's language.
export const WHATSAPP = {
  search: ['#side input[type="text"]', 'input[type="text"]'],
  rows: ["#pane-side [role='row']"],
  // only exists once a chat is open
  input: ['#main div[contenteditable="true"][data-tab="10"]', '#main [role="textbox"]', 'footer div[contenteditable="true"]'],
  send: ['button[data-tab="11"]', 'span[data-icon="send"]', "footer button[aria-label]"],
  qr: ["canvas[aria-label*='Scan']", "canvas[aria-label*='Escanea']", "div[data-ref]"],
  // every bubble carries "[time, date] Sender: " -- the timestamp and who wrote it
  messages: ["#main [data-pre-plain-text]"],
  invalid: "div[data-animate-modal-body='true']",
};

const SENDER = /^\[[^\]]*\]\s*(.+?):\s*$/;
const js = (value: unknown) => JSON.stringify(value);

interface Rect {
  x: number;
  y: number;
  /** Already clicked through the DOM because the element had no box to aim at. */
  clicked?: boolean;
}

export function browserTools(browser: BrowserPort): ToolRegistry {
  async function page(): Promise<string> {
    const { title, url } = await browser.evaluate<{ title: string; url: string }>(
      "({ title: document.title, url: location.href })",
    );
    const body = (await browser.text()).replace(/\n{3,}/g, "\n\n").trim();
    const shown = body.length <= MAX_TEXT ? body : `${body.slice(0, MAX_TEXT)}\n\n[page truncated at 6,000 characters]`;
    return `${title}\n${url}\n\n${shown}`;
  }

  /** The first selector that matches within the timeout, or null. */
  async function first(selectors: readonly string[], timeout: number): Promise<string | null> {
    const deadline = Date.now() + timeout;
    for (;;) {
      const found = await browser.evaluate<string | null>(
        `(${js(selectors)}).find((s) => document.querySelector(s)) ?? null`,
      );
      if (found || Date.now() >= deadline) return found;
      await browser.wait(POLL);
    }
  }

  async function present(selectors: readonly string[]): Promise<boolean> {
    return (await first(selectors, 0)) !== null;
  }

  /** Clicks an element the way a person would: scrolled into view, then at its centre. */
  async function clickRect(rect: Rect | null): Promise<boolean> {
    if (!rect) return false;
    if (!rect.clicked) await browser.clickAt(rect.x, rect.y);
    return true;
  }

  async function clickSelector(selector: string): Promise<boolean> {
    return clickRect(await browser.evaluate<Rect | null>(centreOf(`document.querySelector(${js(selector)})`)));
  }

  // --- the generic browser ---------------------------------------------------------

  async function openPage(args: ToolArgs) {
    await browser.open(text(args, "url"));
    return page();
  }

  async function clickElement(args: ToolArgs) {
    const label = text(args, "text");
    // Matched on the visible label rather than a selector: it is what the user confirms in
    // the approval, and what survives a class name changing.
    const clicked = await clickRect(await browser.evaluate<Rect | null>(clickableScript(label)));
    if (!clicked) return `Nothing on the page carries the text '${label}'.`;
    await browser.wait(500);
    const url = await browser.evaluate<string>("location.href");
    return `Clicked '${label}'. Now at ${url}`;
  }

  async function typeText(args: ToolArgs) {
    const value = text(args, "text");
    const enter = flag(args, "then_enter");
    await browser.type(value, enter);
    return `Typed ${value.length} characters${enter ? " and pressed enter" : ""}.`;
  }

  async function listTabs() {
    const tabs = await browser.tabs();
    if (tabs.length === 0) return "No browser is open yet. Call OpenBrowserPage to start one.";
    return `${tabs.length} tab(s) open:\n` + tabs.map((t, i) => `${i + 1}. ${t.title || "(untitled)"} -- ${t.url}`).join("\n");
  }

  async function switchTab(args: ToolArgs) {
    const match = text(args, "match");
    if (!(await browser.switchTo(match))) return `No open tab has '${match}' in its title or url. Call ListBrowserTabs.`;
    return `Switched.\n\n${await page()}`;
  }

  // --- WhatsApp --------------------------------------------------------------------

  /** WhatsApp Web, ready to use. Null when it is, otherwise the line to hand back. */
  async function openWhatsapp(): Promise<string | null> {
    if (!(await browser.switchTo("web.whatsapp.com"))) await browser.open("https://web.whatsapp.com");
    if (await first(WHATSAPP.search, WHATSAPP_TIMEOUT)) return null;
    if (await present(WHATSAPP.qr)) {
      return "WhatsApp Web is not signed in. A QR code is on screen in the browser window -- ask the user to scan it from their phone, then try again.";
    }
    return "WhatsApp Web did not finish loading within 60s, or it changed its markup and the desktop app's WhatsApp selectors need updating.";
  }

  /** Chat names matching a search, read in one script: the list is virtualised and rows
   *  are recycled as it filters, so reading them one at a time goes stale halfway. */
  async function searchChats(name: string): Promise<string[]> {
    const box = await first(WHATSAPP.search, 15_000);
    if (!box) return [];
    await browser.evaluate(`(() => { const el = document.querySelector(${js(box)}); el.focus(); el.select?.(); })()`);
    await browser.type(name, false);
    await browser.wait(SEARCH_SETTLE);

    for (const selector of WHATSAPP.rows) {
      const names = await browser.evaluate<string[]>(
        `[...document.querySelectorAll(${js(selector)})].map((row) => row.querySelector('span[title]')?.getAttribute('title')?.trim()).filter(Boolean)`,
      );
      const unique = [...new Set(names)];
      if (unique.length) return unique;
    }
    return [];
  }

  /** Clicks the chat named exactly this, then confirms the right one opened. Confirmed
   *  against the composer ("Escribir un mensaje para <name>" -- the name is in it in any
   *  language), because the list reorders while it filters and a click by position can
   *  land on a neighbour. */
  async function openChat(name: string): Promise<boolean> {
    const rect = await browser.evaluate<Rect | null>(
      centreOf(
        `[...document.querySelectorAll(${js(WHATSAPP.rows[0])})].map((row) => row.querySelector('span[title]')).find((t) => t && t.getAttribute('title').trim() === ${js(name)})`,
      ),
    );
    if (!(await clickRect(rect))) return false;

    const input = await first(WHATSAPP.input, 15_000);
    if (!input) return false;
    const label = await browser.evaluate<string>(`document.querySelector(${js(input)}).getAttribute('aria-label') ?? ''`);
    return label.toLowerCase().includes(name.toLowerCase());
  }

  async function findChat(args: ToolArgs) {
    const name = text(args, "name");
    const problem = await openWhatsapp();
    if (problem) return problem;

    const found = await searchChats(name);
    if (!found.length) {
      return `No WhatsApp chat matches '${name}'. The name has to be as it appears in the user's WhatsApp. If they are not a saved contact, ask the user for the phone number instead.`;
    }

    // Neither answer tells the model to check with the user first: the approval shows
    // them the resolved chat and the exact message, so asking beforehand is a second,
    // worse confirmation of the same thing.
    const { exact, partial } = rank(found, name);
    if (exact.length === 1) return `'${exact[0]}' is a chat by that exact name. Send to it directly.`;
    if (!exact.length && partial.length === 1) {
      return `No chat is named exactly '${name}'; the one close match is '${partial[0]}'. Send to that name.`;
    }

    const candidates = exact.length || partial.length ? [...exact, ...partial] : found;
    const note = exact.length || partial.length ? "" : `\nNone of these is named '${name}' -- they matched on message content, which WhatsApp searches too.`;
    return `${candidates.length} chat(s) match '${name}':\n${candidates.map((c) => `- ${c}`).join("\n")}${note}\n\nAsk the user which one, then pass that name exactly.`;
  }

  async function readChat(args: ToolArgs) {
    const name = text(args, "name");
    const limit = count(args, "limit", 15);
    const problem = await openWhatsapp();
    if (problem) return problem;

    const found = await searchChats(name);
    if (!found.length) return `No WhatsApp chat matches '${name}'. Call FindWhatsappChat to see what is there.`;

    const { exact, partial } = rank(found, name);
    const chosen = exact[0] ?? (partial.length === 1 ? partial[0] : null);
    if (!chosen) {
      return `'${name}' matches more than one chat: ${(partial.length ? partial : found).join(", ")}. Ask the user which one, then pass that name exactly.`;
    }
    if (!(await openChat(chosen))) return `Could not open the chat with '${chosen}', so nothing was read.`;

    const read = () => browser.evaluate<[string | null, string][]>(
      `[...document.querySelectorAll(${js(WHATSAPP.messages[0])})].map((n) => [n.getAttribute('data-pre-plain-text'), n.innerText])`,
    );
    let bubbles: [string | null, string][] = [];
    const deadline = Date.now() + MESSAGES_TIMEOUT;
    while (!bubbles.length && Date.now() < deadline) {
      bubbles = await read();
      if (!bubbles.length) await browser.wait(500);
    }
    // the first bubble to render is rarely the whole thread
    if (bubbles.length) {
      await browser.wait(BUBBLE_SETTLE);
      const more = await read();
      if (more.length > bubbles.length) bubbles = more;
    }
    if (!bubbles.length) {
      return `The chat with '${chosen}' is open but no messages could be read from it. WhatsApp Web may have changed its markup.`;
    }

    const lines = bubbles.slice(-limit).flatMap(([pre, body]) => {
      const who = SENDER.exec((pre ?? "").trim())?.[1] ?? chosen;
      const line = (body ?? "").split(/\s+/).join(" ").trim();
      return line ? [`${who}: ${line}`] : [];
    });
    if (!lines.length) return `The chat with '${chosen}' is open but the recent messages were empty.`;
    return `Last ${lines.length} message(s) with ${chosen}:\n${lines.join("\n")}`;
  }

  async function pressSend(message: string, recipient: string): Promise<string> {
    const button = await first(WHATSAPP.send, 5000);
    if (!(button && (await clickSelector(button)))) await browser.type("", true);

    const expected = message.slice(0, 40);
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if ((await browser.text()).includes(expected)) return `Sent to ${recipient}: ${message}`;
      await browser.wait(500);
    }
    return `Pressed send to ${recipient}, but the message did not appear in the conversation. Ask the user to check the window before sending again.`;
  }

  /** A number goes through WhatsApp's own send?phone= link: no clicking, so it cannot land
   *  on the wrong conversation. */
  async function sendToNumber(number: string, message: string): Promise<string> {
    const already = await browser.switchTo("web.whatsapp.com");
    await browser.open(`https://web.whatsapp.com/send?phone=${number}&text=${encodeURIComponent(message)}`);

    const input = await first(WHATSAPP.input, already ? 20_000 : WHATSAPP_TIMEOUT);
    if (!input) {
      if (await present(WHATSAPP.qr)) {
        return "WhatsApp Web is not signed in. A QR code is on screen in the browser window -- ask the user to scan it from their phone, then try again. The session is kept after that.";
      }
      const rejected = await browser.evaluate<string | null>(`document.querySelector(${js(WHATSAPP.invalid)})?.innerText?.trim() ?? null`);
      if (rejected) return `WhatsApp rejected the number ${number}: ${rejected}`;
      return "Could not find the WhatsApp message box within 60s. The page may still be loading, or WhatsApp Web changed its markup.";
    }
    return pressSend(message, number);
  }

  /** A name has to be picked out of the filtered list, so the opened chat is checked
   *  against it before a single character is typed: a message sent to the wrong person
   *  cannot be recalled. */
  async function sendToChat(name: string, message: string): Promise<string> {
    const problem = await openWhatsapp();
    if (problem) return problem;

    const found = await searchChats(name);
    if (!found.length) {
      return `No WhatsApp chat matches '${name}'. Nothing was sent. Call FindWhatsappChat to see what is there, or ask the user for a number.`;
    }

    const { exact, partial } = rank(found, name);
    if (!exact.length) {
      if (partial.length === 1) {
        return `No chat is named exactly '${name}'. The closest is '${partial[0]}' -- nothing was sent. Confirm that is the right person with the user, then send to that name.`;
      }
      return `'${name}' is not an exact chat name, so nothing was sent. Did you mean one of these? ${(partial.length ? partial : found).join(", ")}. Pass one of them exactly as written.`;
    }

    if (!(await openChat(exact[0]))) {
      return `Opened a chat while looking for '${exact[0]}' but it did not match, so nothing was sent. Ask the user to open the conversation themselves and try again.`;
    }

    const input = await first(WHATSAPP.input, 15_000);
    if (!(input && (await clickSelector(input)))) {
      return `The chat with '${exact[0]}' is open but its message box could not be found, so nothing was sent.`;
    }
    await browser.type(message, false);
    return pressSend(message, exact[0]);
  }

  async function sendMessage(args: ToolArgs) {
    const to = text(args, "to");
    const message = text(args, "message");
    if (looksLikeNumber(to)) return sendToNumber(digits(to), message);
    return sendToChat(to, message);
  }

  return {
    OpenBrowserPage: { run: openPage },
    ReadBrowserPage: { run: page },
    ClickBrowserElement: { run: clickElement, preview: async (args) => `click: ${text(args, "text")}` },
    TypeInBrowser: {
      run: typeText,
      preview: async (args) => `type: ${text(args, "text")}${flag(args, "then_enter") ? " (then enter)" : ""}`,
    },
    ListBrowserTabs: { run: listTabs },
    SwitchBrowserTab: { run: switchTab },
    CloseBrowser: {
      run: async () => {
        await browser.close();
        return "Browser closed. The signed-in session is kept for next time.";
      },
    },
    FindWhatsappChat: { run: findChat },
    ReadWhatsappChat: { run: readChat },
    SendWhatsappMessage: {
      run: sendMessage,
      preview: async (args) => `to ${text(args, "to")}\n\n${text(args, "message")}`,
    },
  };
}

/** Split matches into chats named exactly that, and the rest. WhatsApp searches message
 *  bodies too, so asking for one person returns every group that mentioned them -- a chat
 *  actually called what was asked for is not a candidate among those, it is the answer. */
export function rank(found: string[], name: string): { exact: string[]; partial: string[] } {
  const wanted = name.trim().toLowerCase();
  const exact = found.filter((row) => row.trim().toLowerCase() === wanted);
  const partial = found.filter((row) => row.trim().toLowerCase().includes(wanted) && !exact.includes(row));
  return { exact, partial };
}

export function looksLikeNumber(to: string): boolean {
  return !/[A-Za-z]/.test(to) && to.replace(/\D/g, "").length >= 8;
}

export function digits(number: string): string {
  const cleaned = number.replace(/\D/g, "");
  if (cleaned.length < 8) {
    throw new ToolError(
      `'${number}' is not a full phone number. WhatsApp needs it in international form with the country code and no symbols, for example 521234567890.`,
    );
  }
  return cleaned;
}

/** A script evaluating to the centre of an element (scrolled into view first), or null. */
function centreOf(elementExpression: string): string {
  return `(() => {
    const el = ${elementExpression};
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    // no box to aim at (hidden behind an overlay, zero-sized): the DOM click still lands
    if (!r.width || !r.height) { el.click(); return { x: -1, y: -1, clicked: true }; }
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`;
}

const ROLES = ["button", "link", "listitem", "row", "gridcell", "option", "menuitem", "tab"];

/** The innermost clickable element whose visible text contains the label -- innermost,
 *  because an ancestor also "contains" it, and clicking the whole list when one row was
 *  meant is how the wrong conversation gets opened. */
function clickableScript(label: string): string {
  const selector = ["button", "a", "[title]", ...ROLES.map((r) => `[role="${r}"]`)].join(",");
  return centreOf(`[...document.querySelectorAll(${js(selector)})]
    .filter((el) => (el.innerText || el.getAttribute("title") || "").replace(/\\s+/g, " ").includes(${js(label)}))
    .sort((a, b) => (a.innerText || "").length - (b.innerText || "").length)[0]`);
}

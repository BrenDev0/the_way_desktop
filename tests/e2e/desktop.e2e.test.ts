/**
 * The desktop side of the full round trip, against a real server. Skipped unless
 * THE_WAY_E2E_URL, THE_WAY_E2E_EMAIL and THE_WAY_E2E_PASSWORD are set. Uses the real core,
 * the real API client and the real file-system adapter -- only Electron's pieces (the
 * keychain token store, the window's approval dialog) are replaced.
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Conversation } from "../../src/core/api";
import { AuthService, type TokenStorePort } from "../../src/core/auth";
import type { ServerConnectionPort } from "../../src/core/connection";
import { TurnService } from "../../src/core/conversations/turnService";
import { desktopTools } from "../../src/core/tools";
import type { BrowserPort } from "../../src/core/tools/ports";
import { ToolRunner, type ApprovalDecision, type ApprovalRequest } from "../../src/core/tools/runner";
import { ApiClient } from "../../src/main/apiClient";
import { ConversationEvents } from "../../src/main/conversationEvents";
import { NodeFileSystem } from "../../src/main/nodeFileSystem";
import { ProjectsApi } from "../../src/main/projectsApi";

const url = process.env.THE_WAY_E2E_URL;
const email = process.env.THE_WAY_E2E_EMAIL ?? "";
const password = process.env.THE_WAY_E2E_PASSWORD ?? "";

class MemoryTokens implements TokenStorePort {
  token: string | null = null;
  async load() { return this.token; }
  async save(token: string) { this.token = token; }
  async clear() { this.token = null; }
}

class ScriptedApprovals {
  readonly asked: ApprovalRequest[] = [];
  decision: ApprovalDecision = { approved: false, feedback: "archive it instead of deleting" };
  async request(request: ApprovalRequest) {
    this.asked.push(request);
    return this.decision;
  }
}

describe.skipIf(!url)("desktop round trip against a real server", () => {
  let folder: string;
  const tokens = new MemoryTokens();
  const approvals = new ScriptedApprovals();
  const updates: Conversation["status"][] = [];
  let streamed = "";
  let turns: TurnService;
  let auth: AuthService;
  let runner: ToolRunner;
  let api: ApiClient;

  beforeAll(async () => {
    folder = await mkdtemp(join(tmpdir(), "the-way-e2e-"));
    await writeFile(join(folder, "notes.txt"), "buy milk\r\ncall Ana\r\n");

    const connection: ServerConnectionPort = {
      load: async () => ({ baseUrl: url!, locked: true }),
      connect: async () => ({ baseUrl: url!, status: "connected", message: "" }),
      check: async () => ({ baseUrl: url!, status: "connected", message: "" }),
    };
    api = new ApiClient(connection, tokens, () => {});
    runner = new ToolRunner(
      desktopTools({ files: new NodeFileSystem(async () => folder), browser: {} as BrowserPort, projects: new ProjectsApi(api) }),
      approvals,
    );
    turns = new TurnService(api, new ConversationEvents(api), runner, {
      update: (c) => updates.push(c.status),
      text: (_id, t) => { streamed += t; },
    });
    auth = new AuthService(api, tokens);
  });

  afterAll(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  it("signs in and keeps the token out of the caller's hands", async () => {
    const state = await auth.login(email, password, "E2E laptop");
    expect(state.user?.email).toBe(email);
    expect(JSON.stringify(state)).not.toContain(tokens.token!);
    expect((await auth.restore()).user?.email).toBe(email);
  });

  it("implements every desktop tool the server offers", async () => {
    const offered = await api.request<{ name: string }[]>("GET", "/desktop-tools");
    expect(runner.missingFrom(offered.map((tool) => tool.name))).toEqual([]);
  });

  it("pauses for a desktop tool, runs it here, and resumes with the real file", async () => {
    const conversation = await turns.create("E2E");
    const finished = await turns.send(conversation.id, "What is in notes.txt?");

    expect(finished.status).toBe("idle");
    expect(updates).toContain("awaiting_client");
    const messages = await turns.messages(conversation.id);
    const reply = messages[messages.length - 1];
    expect(reply.content).toBe("The notes say: buy milk\ncall Ana\n");
    // the reply arrived over the event stream as it was written, not only at the end
    expect(streamed).toContain("The notes say:");
  }, 60_000);

  it("asks before a destructive call, and a refusal reaches the model with its feedback", async () => {
    const conversation = await turns.create("E2E delete");
    const finished = await turns.send(conversation.id, "Please delete notes.txt");

    expect(finished.status).toBe("idle");
    expect(approvals.asked.map((a) => a.call.name)).toEqual(["DeleteFile"]);
    expect(await readFile(join(folder, "notes.txt"), "utf8")).toContain("buy milk");
    const messages = await turns.messages(conversation.id);
    expect(String(messages[messages.length - 1].content)).toContain("archive it instead of deleting");
  }, 60_000);

  it("signs out, and the token stops working", async () => {
    const before = tokens.token;
    await auth.logout();
    expect(tokens.token).toBeNull();
    tokens.token = before;
    await expect(api.request("GET", "/users/me")).rejects.toMatchObject({ status: 401 });
  });
});

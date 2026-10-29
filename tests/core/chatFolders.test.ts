import { describe, expect, it } from "vitest";
import { ApiError, type ChatFolder, type Conversation, type ConversationEventsPort, type HttpMethod, type ServerApiPort } from "../../src/core/api";
import { folderError } from "../../src/core/conversations/folders";
import { TurnService } from "../../src/core/conversations/turnService";
import { ToolRunner } from "../../src/core/tools/runner";
import { sectionsOf, visibleChats } from "../../src/renderer/views/chat/folders";

class Api implements ServerApiPort {
  readonly calls: { method: string; path: string; body?: unknown }[] = [];
  next: unknown = null;
  failWith: Error | null = null;

  async request<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
    this.calls.push({ method, path, body });
    if (this.failWith) throw this.failWith;
    return this.next as T;
  }
}

const noStream: ConversationEventsPort = { open: async function* () {} };

function turns(api: Api) {
  return new TurnService(api, noStream, new ToolRunner({}, { request: async () => ({ approved: true }) }), {
    update: () => {},
    text: () => {},
    message: () => {},
    activity: () => {},
  });
}

const folder = (id: string, name: string): ChatFolder => ({ id, name, createdAt: "" });

function chat(id: string, updatedAt: string, folderId?: string | null, title = id): Conversation {
  return {
    id, title, client: "desktop", status: "idle", folderId, pendingToolCalls: [],
    iterationsUsed: 0, totalTokens: 0, createdAt: "", updatedAt,
  };
}

describe("the folders the server keeps for a person's chats", () => {
  it("lists, creates, renames and removes them at the folder routes", async () => {
    const api = new Api();
    const service = turns(api);

    api.next = [folder("f1", "Acme")];
    expect(await service.folders()).toEqual([folder("f1", "Acme")]);
    api.next = folder("f2", "Beta");
    await service.createFolder("Beta");
    await service.renameFolder("f2", "Gamma");
    await service.removeFolder("f2");

    expect(api.calls).toEqual([
      { method: "GET", path: "/conversation-folders", body: undefined },
      { method: "POST", path: "/conversation-folders", body: { name: "Beta" } },
      { method: "PATCH", path: "/conversation-folders/f2", body: { name: "Gamma" } },
      { method: "DELETE", path: "/conversation-folders/f2", body: undefined },
    ]);
  });

  it("files a chat in a folder and takes it out with a null", async () => {
    const api = new Api();
    const service = turns(api);

    await service.move("c1", "f1");
    await service.move("c1", null);

    expect(api.calls.map(({ method, path, body }) => ({ method, path, body }))).toEqual([
      { method: "PATCH", path: "/conversations/c1/folder", body: { folderId: "f1" } },
      { method: "PATCH", path: "/conversations/c1/folder", body: { folderId: null } },
    ]);
  });

  it("says why a folder call failed in the person's words", async () => {
    const api = new Api();
    const service = turns(api);

    api.failWith = new ApiError(409, "folder_name_taken", "You already have a folder with that name");
    await expect(service.createFolder("Acme")).rejects.toThrow("Ya tienes una carpeta con ese nombre.");
    api.failWith = new ApiError(404, "conversation_folder_not_found", "Folder not found");
    await expect(service.move("c1", "gone")).rejects.toThrow("Esa carpeta ya no existe.");
    api.failWith = new ApiError(409, "conversation_folder_limit_reached", "limit");
    await expect(service.createFolder("Otra")).rejects.toThrow(/hasta 50 carpetas/);
  });

  it("leaves any other failure as it was", () => {
    const other = new Error("offline");

    expect(folderError(other)).toBe(other);
    expect(folderError(new ApiError(500, "something_else", "boom")).message).toBe("boom");
  });
});

describe("the conversation list with folders", () => {
  const folders = [folder("a", "Acme"), folder("b", "Beta")];
  const all = [
    chat("old-acme", "2026-10-01", "a"),
    chat("new-acme", "2026-10-20", "a"),
    chat("loose-1", "2026-10-10"),
    chat("loose-2", "2026-10-25", null),
    chat("orphan", "2026-10-05", "deleted-elsewhere"),
  ];
  const everything = () => true;

  it("shows each folder with its chats newest first, then the chats in none", () => {
    const sections = sectionsOf(all, folders, everything, false, new Set());

    expect(sections.map((s) => [s.folder?.name ?? null, s.chats.map((c) => c.id)])).toEqual([
      ["Acme", ["new-acme", "old-acme"]],
      ["Beta", []],
      [null, ["loose-2", "loose-1", "orphan"]], // a chat whose folder is unknown counts as in none
    ]);
  });

  it("keeps an empty folder, and counts the chats of one that is folded away", () => {
    const sections = sectionsOf(all, folders, everything, false, new Set(["a"]));

    expect(sections[0]).toMatchObject({ total: 2, folded: true, chats: [] });
    expect(sections[1]).toMatchObject({ total: 0, folded: false });
    expect(visibleChats(sections).map((c) => c.id)).toEqual(["loose-2", "loose-1", "orphan"]);
  });

  it("with no folders at all, is the plain list it always was", () => {
    const sections = sectionsOf(all, [], everything, false, new Set());

    expect(sections).toHaveLength(1);
    expect(sections[0].folder).toBeNull();
    expect(visibleChats(sections)).toHaveLength(5);
  });

  it("searching drops the folders with no match and opens the ones that match, even folded", () => {
    const sections = sectionsOf(all, folders, (c) => c.id.includes("acme"), true, new Set(["a"]));

    expect(sections.map((s) => [s.folder?.name ?? null, s.chats.map((c) => c.id)])).toEqual([["Acme", ["new-acme", "old-acme"]]]);
  });

  it("searching with nothing found leaves nothing to walk", () => {
    const sections = sectionsOf(all, folders, () => false, true, new Set());

    expect(visibleChats(sections)).toEqual([]);
  });
});

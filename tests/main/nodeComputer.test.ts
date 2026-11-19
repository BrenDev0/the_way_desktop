import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computerTools } from "../../src/core/tools/computer";
import { ComputerGrants } from "../../src/main/computerGrants";
import { NodeComputer } from "../../src/main/nodeComputer";
import type { SearchKind, SystemSearch } from "../../src/main/systemSearch";

let base: string;
let data: string;
let docs: string;
let outside: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "the-way-computer-"));
  data = join(base, "userdata");
  docs = join(base, "Documentos");
  outside = join(base, "outside");
  await mkdir(data);
  await mkdir(join(docs, "contratos"), { recursive: true });
  await mkdir(join(docs, ".ssh"), { recursive: true });
  await mkdir(outside);
  await writeFile(join(docs, "contratos", "acme.txt"), "contrato de acme");
  await writeFile(join(docs, ".env"), "SECRET=1");
  await writeFile(join(docs, ".ssh", "id_rsa"), "key");
  await writeFile(join(outside, "secret.txt"), "top secret");
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

async function computer(picks: (string | null)[] = [], system: SystemSearch | null = null) {
  const grants = new ComputerGrants(data);
  await grants.claim("ana");
  const queue = [...picks];
  const extracted: { name: string; text: string }[] = [];
  const access = new NodeComputer(
    grants,
    async () => queue.shift() ?? null,
    async (name, data) => {
      const text = new TextDecoder().decode(data);
      extracted.push({ name, text });
      return `extraído: ${text}`;
    },
    system,
  );
  return { grants, access, extracted, tools: computerTools(access) };
}

describe("ComputerGrants", () => {
  it("remembers a grant for the account that made it", async () => {
    const first = await computer();
    await first.grants.add(docs);

    const again = new ComputerGrants(data);
    await again.claim("ana");

    expect((await again.list()).map((g) => g.label)).toEqual(["Documentos"]);
  });

  it("starts another account with none", async () => {
    const first = await computer();
    await first.grants.add(docs);

    const next = new ComputerGrants(data);
    await next.claim("bob");

    expect(await next.list()).toEqual([]);
    const reread = new ComputerGrants(data);
    await reread.claim("bob");
    expect(await reread.list()).toEqual([]);
  });

  it("does not grant the same folder twice, and can take a grant back", async () => {
    const { grants } = await computer();
    const one = await grants.add(docs);
    const two = await grants.add(docs);

    expect(two.id).toBe(one.id);
    expect(await grants.list()).toHaveLength(1);
    expect(await grants.remove(one.id)).toEqual([]);
  });

  it("refuses a whole drive, a folder that is not there, and a folder of keys", async () => {
    const { grants } = await computer();

    await expect(grants.add(parse(docs).root)).rejects.toThrow(/whole drive/);
    await expect(grants.add(join(base, "nada"))).rejects.toThrow(/not available/);
    await expect(grants.add(join(docs, ".ssh"))).rejects.toThrow(/credentials or keys/);
  });
});

describe("NodeComputer", () => {
  it("grants the folder the user picks, and reads inside it", async () => {
    const { tools } = await computer([docs]);

    expect(await tools.RequestComputerAccess.run({ reason: "buscar" })).toContain("'Documentos'");
    expect(await tools.ReadComputerFile.run({ path: "Documentos/contratos/acme.txt" })).toBe("contrato de acme");
    expect(await tools.SearchComputer.run({ query: "acme" })).toBe("Documentos/contratos/acme.txt");
  });

  it("reports no grant when the user cancels the picker", async () => {
    const { tools, grants } = await computer([null]);

    expect(await tools.RequestComputerAccess.run({ reason: "buscar" })).toMatch(/did not pick a folder/);
    expect(await grants.list()).toEqual([]);
  });

  it("refuses a folder that was never granted", async () => {
    const { tools } = await computer([docs]);
    await tools.RequestComputerAccess.run({ reason: "buscar" });

    await expect(tools.ReadComputerFile.run({ path: "Otra/a.txt" })).rejects.toThrow(/not a folder the user has granted/);
  });

  it("refuses to climb out of the grant", async () => {
    const { tools } = await computer([docs]);
    await tools.RequestComputerAccess.run({ reason: "buscar" });

    await expect(tools.ReadComputerFile.run({ path: "Documentos/../outside/secret.txt" })).rejects.toThrow(/outside/);
    await expect(tools.ReadComputerFile.run({ path: join(outside, "secret.txt") })).rejects.toThrow();
  });

  it("refuses to follow a link out of the grant, and does not walk into it", async (context) => {
    const { tools } = await computer([docs]);
    await tools.RequestComputerAccess.run({ reason: "buscar" });
    try {
      await symlink(outside, join(docs, "escape"), "junction");
    } catch {
      context.skip();
    }

    await expect(tools.ReadComputerFile.run({ path: "Documentos/escape/secret.txt" })).rejects.toThrow(/outside/);
    expect(await tools.SearchComputer.run({ query: "secret" })).toMatch(/Nothing matches/);
  });

  it("never lists, searches or reads credentials and keys, even inside a grant", async () => {
    const { tools } = await computer([docs]);
    await tools.RequestComputerAccess.run({ reason: "buscar" });

    expect(await tools.ListComputerFolder.run({ path: "Documentos" })).toBe("contratos/");
    expect(await tools.SearchComputer.run({ query: "env" })).toMatch(/Nothing matches/);
    expect(await tools.SearchComputer.run({ query: "id_rsa" })).toMatch(/Nothing matches/);
    await expect(tools.ReadComputerFile.run({ path: "Documentos/.env" })).rejects.toThrow(/credentials or keys/);
    await expect(tools.ReadComputerFile.run({ path: "Documentos/.ssh/id_rsa" })).rejects.toThrow(/credentials or keys/);
  });

  it("reads a document through the extractor, with its own name and bytes", async () => {
    const { tools, extracted } = await computer([docs]);
    await tools.RequestComputerAccess.run({ reason: "buscar" });
    await writeFile(join(docs, "contratos", "acme.pdf"), "bytes del pdf");

    expect(await tools.ReadComputerFile.run({ path: "Documentos/contratos/acme.pdf" })).toBe("extraído: bytes del pdf");
    expect(extracted).toEqual([{ name: "acme.pdf", text: "bytes del pdf" }]);
  });

  it("never sends a document from a protected folder to the extractor", async () => {
    const { tools, extracted } = await computer([docs]);
    await tools.RequestComputerAccess.run({ reason: "buscar" });
    await writeFile(join(docs, ".ssh", "notas.pdf"), "x");

    await expect(tools.ReadComputerFile.run({ path: "Documentos/.ssh/notas.pdf" })).rejects.toThrow(/credentials or keys/);
    expect(extracted).toEqual([]);
  });

  it("has no way to write", async () => {
    const { access } = await computer();

    for (const name of ["writeBytes", "makeDirectory", "copy", "move", "remove"]) {
      expect(name in access, name).toBe(false);
    }
  });
});

describe("NodeComputer with the system index", () => {
  const answering = (paths: (string | null)[] | null) => {
    const asked: { root: string; terms: string[]; kind: SearchKind }[] = [];
    const system: SystemSearch = {
      search: async (root, terms, kind) => {
        asked.push({ root, terms, kind });
        return paths ? (paths as string[]) : null;
      },
    };
    return { system, asked };
  };

  it("turns what the index found into granted paths, with what each one is", async () => {
    const { system, asked } = answering([join(docs, "contratos", "acme.txt"), join(docs, "contratos")]);
    const { access } = await computer([docs], system);
    await access.choose("buscar");

    const found = await access.indexed("Documentos", ["acme"], "name");

    expect(found).toEqual([
      { path: "Documentos/contratos/acme.txt", isDirectory: false, size: 16 },
      { path: "Documentos/contratos", isDirectory: true, size: 0 },
    ]);
    expect(asked).toHaveLength(1);
    expect(asked[0].terms).toEqual(["acme"]);
    expect(asked[0].kind).toBe("name");
  });

  it("asks the index about the folder searched, not the whole grant", async () => {
    const { system, asked } = answering([]);
    const { access } = await computer([docs], system);
    await access.choose("buscar");

    await access.indexed("Documentos/contratos", ["acme"], "content");

    expect(asked[0].root.endsWith(join("Documentos", "contratos"))).toBe(true);
    expect(asked[0].kind).toBe("content");
  });

  it("drops what is outside the grant, what holds credentials, and what is gone", async () => {
    const { system } = answering([
      join(outside, "secret.txt"),
      join(docs, ".env"),
      join(docs, ".ssh", "id_rsa"),
      join(docs, "ya-no-existe.txt"),
      docs,
      join(docs, "contratos", "acme.txt"),
    ]);
    const { access } = await computer([docs], system);
    await access.choose("buscar");

    const found = await access.indexed("Documentos", ["x"], "name");

    expect(found?.map((entry) => entry.path)).toEqual(["Documentos/contratos/acme.txt"]);
  });

  it("drops a link that leads out of the grant", async (context) => {
    const { system } = answering([join(docs, "escape", "secret.txt")]);
    const { access } = await computer([docs], system);
    await access.choose("buscar");
    try {
      await symlink(outside, join(docs, "escape"), "junction");
    } catch {
      context.skip();
    }

    expect(await access.indexed("Documentos", ["secret"], "name")).toEqual([]);
  });

  it("answers null when there is no index, or it could not answer, so the caller walks instead", async () => {
    const none = await computer([docs], null);
    await none.access.choose("buscar");
    const broken = await computer([docs], answering(null).system);
    await broken.access.choose("buscar");

    expect(await none.access.indexed("Documentos", ["a"], "name")).toBeNull();
    expect(await broken.access.indexed("Documentos", ["a"], "name")).toBeNull();
  });

  it("refuses a folder that was not granted, and never asks the index about it", async () => {
    const { system, asked } = answering([]);
    const { access } = await computer([docs], system);
    await access.choose("buscar");

    await expect(access.indexed("Otra", ["a"], "name")).rejects.toThrow(/not a folder the user has granted/);
    expect(asked).toEqual([]);
  });

  it("does not ask the index about a protected folder", async () => {
    const { system, asked } = answering([]);
    const { access } = await computer([docs], system);
    await access.choose("buscar");

    expect(await access.indexed("Documentos/.ssh", ["a"], "name")).toEqual([]);
    expect(asked).toEqual([]);
  });
});

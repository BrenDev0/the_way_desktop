import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computerTools } from "../../src/core/tools/computer";
import { ComputerGrants } from "../../src/main/computerGrants";
import { NodeComputer } from "../../src/main/nodeComputer";

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

async function computer(picks: (string | null)[] = []) {
  const grants = new ComputerGrants(data);
  await grants.claim("ana");
  const queue = [...picks];
  const access = new NodeComputer(grants, async () => queue.shift() ?? null);
  return { grants, access, tools: computerTools(access) };
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

  it("has no way to write", async () => {
    const { access } = await computer();

    for (const name of ["writeBytes", "makeDirectory", "copy", "move", "remove"]) {
      expect(name in access, name).toBe(false);
    }
  });
});

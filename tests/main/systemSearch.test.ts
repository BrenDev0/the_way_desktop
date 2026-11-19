import { describe, expect, it } from "vitest";
import { macQuery, parsePaths, systemSearchFor, windowsCommand } from "../../src/main/systemSearch";

describe("the Mac index (Spotlight)", () => {
  it("asks for a name by every word, ignoring capitals and accents", () => {
    expect(macQuery(["contrato", "acme"], "name")).toBe('kMDItemFSName == "*contrato*"cd && kMDItemFSName == "*acme*"cd');
  });

  it("asks for contents with the words as they are", () => {
    expect(macQuery(["contrato", "acme"], "content")).toBe("contrato acme");
  });
});

describe("the Windows index (Windows Search)", () => {
  const decoded = () => Buffer.from(windowsCommand().args[3], "base64").toString("utf16le");

  it("runs a script given as an encoded command, with nothing typed into it", () => {
    const { file, args } = windowsCommand();

    expect(file).toBe("powershell.exe");
    expect(args.slice(0, 3)).toEqual(["-NoProfile", "-NonInteractive", "-EncodedCommand"]);
  });

  it("takes the folder, words and kind from the environment, so a name can never become code", () => {
    const script = decoded();

    for (const variable of ["THEWAY_SCOPE", "THEWAY_TERMS", "THEWAY_KIND"]) expect(script).toContain(`$env:${variable}`);
    expect(script).toContain("SystemIndex");
    expect(script).toContain("System.FileName LIKE");
    expect(script).toContain("CONTAINS(");
  });

  it("limits what it brings back", () => {
    expect(decoded()).toContain("SELECT TOP 500");
  });
});

describe("what an index answers", () => {
  it("is one path per line, whatever the line ending", () => {
    expect(parsePaths("/a/b.txt\r\n/a/c d.txt\n\n  /e.txt  \n")).toEqual(["/a/b.txt", "/a/c d.txt", "/e.txt"]);
    expect(parsePaths("")).toEqual([]);
  });

  it("exists for Windows and macOS only", () => {
    expect(systemSearchFor("win32")).not.toBeNull();
    expect(systemSearchFor("darwin")).not.toBeNull();
    expect(systemSearchFor("linux")).toBeNull();
  });

  it.skipIf(process.platform !== "win32")("runs the real Windows script: an answer, or none when the index is off", async () => {
    const answer = await systemSearchFor("win32")!.search(process.cwd(), ["zzzqqqxx"], "name");

    expect(answer === null || Array.isArray(answer)).toBe(true);
  });
});

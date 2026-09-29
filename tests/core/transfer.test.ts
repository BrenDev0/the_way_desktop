import { describe, expect, it } from "vitest";
import type { ProjectRef, ProjectsApiPort, RemoteFolder, RemoteTree } from "../../src/core/tools/ports";
import { transferTools } from "../../src/core/tools/transfer";
import { MemoryFileSystem } from "../support/memoryFileSystem";

class FakeProjects implements ProjectsApiPort {
  readonly state: RemoteTree = { folders: [], files: [] };
  readonly contents = new Map<string, Uint8Array>();
  private next = 0;

  async projects(): Promise<ProjectRef[]> {
    return [{ id: "p1", name: "Website" }];
  }
  async tree(): Promise<RemoteTree> {
    return { folders: [...this.state.folders], files: [...this.state.files] };
  }
  async createFolder(_projectId: string, name: string, parentId: string | null): Promise<RemoteFolder> {
    const folder = { id: `f${(this.next += 1)}`, name, parentId };
    this.state.folders.push(folder);
    return folder;
  }
  async upload(_projectId: string, folderId: string | null, name: string, data: Uint8Array): Promise<void> {
    const id = `file${(this.next += 1)}`;
    this.state.files.push({ id, folderId, name, sizeBytes: data.length, status: "ready" });
    this.contents.set(id, data);
  }
  async download(_projectId: string, fileId: string): Promise<Uint8Array> {
    return this.contents.get(fileId)!;
  }
  path(name: string): string {
    const file = this.state.files.find((f) => f.name === name)!;
    const parts = [file.name];
    let parent = file.folderId;
    while (parent) {
      const folder = this.state.folders.find((f) => f.id === parent)!;
      parts.unshift(folder.name);
      parent = folder.parentId;
    }
    return parts.join("/");
  }
}

describe("UploadToProject", () => {
  it("uploads a folder under its own name, skipping build folders", async () => {
    const fs = new MemoryFileSystem({ "site/index.html": "<h1>", "site/css/a.css": "a{}", "site/node_modules/x.js": "x" });
    const projects = new FakeProjects();

    const result = await transferTools(fs, projects).UploadToProject.run({ local_path: "site", project: "website", destination_path: "live" });

    expect(result).toContain("Uploaded 2 file(s) to Website/live");
    expect(projects.path("index.html")).toBe("live/site/index.html");
    expect(projects.path("a.css")).toBe("live/site/css/a.css");
  });

  it("never overwrites what is already in the project", async () => {
    const fs = new MemoryFileSystem({ "a.txt": "new" });
    const projects = new FakeProjects();
    await projects.upload("p1", null, "a.txt", new TextEncoder().encode("old"));

    const result = await transferTools(fs, projects).UploadToProject.run({ local_path: "a.txt", project: "Website" });

    expect(result).toContain("Skipped 1 already in the project");
    expect(projects.state.files).toHaveLength(1);
  });

  it("names the projects when the one asked for does not exist", async () => {
    const run = transferTools(new MemoryFileSystem({ "a.txt": "x" }), new FakeProjects()).UploadToProject.run;
    await expect(run({ local_path: "a.txt", project: "Nope" })).rejects.toThrow("The user's projects: Website.");
  });
});

describe("DownloadFromProject", () => {
  it("downloads a folder and refuses to overwrite local files", async () => {
    const projects = new FakeProjects();
    const docs = await projects.createFolder("p1", "docs", null);
    await projects.upload("p1", docs.id, "plan.md", new TextEncoder().encode("# Plan"));
    const fs = new MemoryFileSystem();
    const tools = transferTools(fs, projects);

    expect(await tools.DownloadFromProject.run({ project: "Website", path: "docs" })).toContain("Downloaded 1 file(s)");
    expect(fs.text("docs/plan.md")).toBe("# Plan");
    await expect(tools.DownloadFromProject.run({ project: "Website", path: "docs" })).rejects.toThrow(/overwrite=true/);
  });
});

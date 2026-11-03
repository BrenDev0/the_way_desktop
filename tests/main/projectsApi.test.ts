import { describe, expect, it } from "vitest";
import type { ServerApiPort } from "../../src/core/api";
import { ProjectsApi } from "../../src/main/projectsApi";

/** A server that answers the project list and remembers what was asked. */
function server() {
  const asked: string[] = [];
  const api = {
    request: async (_method: string, path: string) => {
      asked.push(path);
      return [{ id: "1", name: "Campaña", owner: "x" }];
    },
  } as unknown as ServerApiPort;
  return { projects: new ProjectsApi(api), asked };
}

describe("the project lists", () => {
  it("shows the person their own projects, without the agent's workspace", async () => {
    const { projects, asked } = server();

    expect(await projects.visibleProjects()).toEqual([{ id: "1", name: "Campaña" }]);
    expect(asked).toEqual(["/projects"]);
  });

  it("asks for the workspace too where a project is found by name", async () => {
    const { projects, asked } = server();

    await projects.projects();

    expect(asked).toEqual(["/projects?includeWorkspace=true"]);
  });
});

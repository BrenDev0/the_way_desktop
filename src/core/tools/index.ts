import { browserTools } from "./browser";
import type { ToolRegistry } from "./contract";
import { fileTools } from "./files";
import type { BrowserPort, FileSystemPort, ProjectsApiPort } from "./ports";
import { transferTools } from "./transfer";

export interface ToolDependencies {
  files: FileSystemPort;
  browser: BrowserPort;
  projects: ProjectsApiPort;
}

/** Every desktop tool this build implements, bound to the machine it runs on. */
export function desktopTools(dependencies: ToolDependencies): ToolRegistry {
  return {
    ...fileTools(dependencies.files),
    ...transferTools(dependencies.files, dependencies.projects),
    ...browserTools(dependencies.browser),
  };
}

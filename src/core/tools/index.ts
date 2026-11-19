import { browserTools } from "./browser";
import type { ToolRegistry } from "./contract";
import { commandTools } from "./command";
import { computerTools } from "./computer";
import { fileTools } from "./files";
import { gitTools } from "./git";
import type { BrowserPort, CommandPort, ComputerPort, FileSystemPort, GitPort, ProjectsApiPort } from "./ports";
import { transferTools } from "./transfer";

export interface ToolDependencies {
  files: FileSystemPort;
  browser: BrowserPort;
  projects: ProjectsApiPort;
  git: GitPort;
  command: CommandPort;
  computer: ComputerPort;
}

/** Every desktop tool this build implements, bound to the machine it runs on. */
export function desktopTools(dependencies: ToolDependencies): ToolRegistry {
  return {
    ...fileTools(dependencies.files),
    ...transferTools(dependencies.files, dependencies.projects),
    ...browserTools(dependencies.browser),
    ...gitTools(dependencies.git, dependencies.files),
    ...commandTools(dependencies.command),
    ...computerTools(dependencies.computer),
  };
}

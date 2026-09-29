/**
 * What the desktop tools need from the machine. The tools are plain logic over these
 * ports; the main process supplies the real adapters and tests supply in-memory ones.
 *
 * Every path handed to FileSystemPort is relative to the folder the user opened, using
 * "/" as the separator. The adapter owns the sandbox: it must refuse any path that
 * resolves outside that folder, including through a symlink.
 */

export interface FileInfo {
  exists: boolean;
  isDirectory: boolean;
  size: number;
}

export interface DirectoryEntry {
  name: string;
  isDirectory: boolean;
  size: number;
}

export interface WalkEntry {
  /** Relative to the open folder, "/"-separated. */
  path: string;
  isDirectory: boolean;
  size: number;
}

export interface FileSystemPort {
  /** Canonical relative form of a path ("" is the open folder); throws if it escapes. */
  normalize(path: string): string;
  stat(path: string): Promise<FileInfo>;
  readBytes(path: string): Promise<Uint8Array>;
  /** Writes exactly these bytes, creating missing parent folders. */
  writeBytes(path: string, data: Uint8Array): Promise<void>;
  list(path: string): Promise<DirectoryEntry[]>;
  /** Everything below a folder, skipping folders the callback rejects (and all under them). */
  walk(path: string, enter: (name: string) => boolean): AsyncIterable<WalkEntry>;
  makeDirectory(path: string): Promise<void>;
  /** Recursive for folders. The target must not exist. */
  copy(source: string, target: string): Promise<void>;
  move(source: string, target: string): Promise<void>;
  remove(path: string, recursive: boolean): Promise<void>;
}

export interface TabInfo {
  title: string;
  url: string;
}

/** The assistant's own browser window, with a persistent profile. */
export interface BrowserPort {
  open(url: string): Promise<void>;
  /** The page's visible text. */
  text(): Promise<string>;
  /** Runs a script in the page and returns its JSON-serialisable result. */
  evaluate<T>(script: string): Promise<T>;
  /** Types into the focused element, then optionally presses Enter. */
  type(text: string, pressEnter: boolean): Promise<void>;
  /** Clicks the centre of a point in page coordinates, as a real mouse would. */
  clickAt(x: number, y: number): Promise<void>;
  tabs(): Promise<TabInfo[]>;
  /** Switches to the first tab whose title or URL contains the text; false if none. */
  switchTo(match: string): Promise<boolean>;
  close(): Promise<void>;
  wait(milliseconds: number): Promise<void>;
}

export interface ProjectRef {
  id: string;
  name: string;
}

export interface RemoteFolder {
  id: string;
  parentId: string | null;
  name: string;
}

export interface RemoteFile {
  id: string;
  folderId: string | null;
  name: string;
  sizeBytes: number;
  status: "pending" | "ready";
}

export interface RemoteTree {
  folders: RemoteFolder[];
  files: RemoteFile[];
}

/** The user's projects on the server, for the upload and download tools. */
export interface ProjectsApiPort {
  projects(): Promise<ProjectRef[]>;
  tree(projectId: string): Promise<RemoteTree>;
  createFolder(projectId: string, name: string, parentId: string | null): Promise<RemoteFolder>;
  upload(
    projectId: string,
    folderId: string | null,
    name: string,
    data: Uint8Array,
    contentType: string,
  ): Promise<void>;
  download(projectId: string, fileId: string): Promise<Uint8Array>;
}

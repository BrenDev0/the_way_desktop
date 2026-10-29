/** Small things the files panel's views share. */

import type { CSSProperties } from "react";

/**
 * What a tree item needs for its glowing pipe (files.css): the depth it sits at. A row
 * at the top level hangs from nothing, so it gets none.
 */
export function pipe(depth: number): { className?: string; style?: CSSProperties } {
  return depth > 0 ? { className: "tree__item", style: { "--depth": depth } as CSSProperties } : {};
}

const IPC_ERROR = /^Error invoking remote method '[^']+':\s*(?:\w*Error:\s*)?/;
const GENERIC = "No se pudo completar la acción. Inténtalo de nuevo.";

/**
 * What a failed call to the app says to the person. Electron wraps a handler's error as
 * "Error invoking remote method 'x': Error: <message>", and the app's handlers only ever send
 * Spanish written for the person (core/userMessages). Anything that did not come that way -- a
 * bug in the window, a browser's own message -- is not for them, and is said generally.
 */
export function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : "";
  return IPC_ERROR.test(text) ? text.replace(IPC_ERROR, "") || GENERIC : GENERIC;
}

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function parentOf(path: string): string {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

export function nameOf(path: string): string {
  return path.split("/").pop() ?? path;
}

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export interface Notice {
  error: boolean;
  text: string;
}

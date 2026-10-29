import type { ChatFolder, Conversation } from "../../../core/api";

/** One block of the conversation list: a folder and its chats, or (folder null) the chats in no folder. */
export interface Section {
  folder: ChatFolder | null;
  /** What is on show: none while the folder is folded away. */
  chats: Conversation[];
  /** How many chats the folder has (or, searching, how many match), folded away or not. */
  total: number;
  folded: boolean;
}

function newestFirst(chats: Conversation[]): Conversation[] {
  return [...chats].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * The list as the picker shows it: the folders in the order given (the server sends them by
 * name), each with its chats newest first, then the chats in no folder. A chat whose folder is
 * not known (just deleted elsewhere) counts as in none.
 *
 * Searching, a folder with no match disappears and the others open, so nothing found is hidden.
 */
export function sectionsOf(
  conversations: Conversation[],
  folders: ChatFolder[],
  matches: (conversation: Conversation) => boolean,
  searching: boolean,
  foldedAway: ReadonlySet<string>,
): Section[] {
  const known = new Set(folders.map((folder) => folder.id));
  const sections: Section[] = [];

  for (const folder of folders) {
    const inside = newestFirst(conversations.filter((chat) => chat.folderId === folder.id && matches(chat)));
    if (searching && !inside.length) continue;
    const folded = !searching && foldedAway.has(folder.id);
    sections.push({ folder, chats: folded ? [] : inside, total: inside.length, folded });
  }

  const loose = newestFirst(conversations.filter((chat) => (!chat.folderId || !known.has(chat.folderId)) && matches(chat)));
  if (loose.length || !sections.length) sections.push({ folder: null, chats: loose, total: loose.length, folded: false });
  return sections;
}

/** The chats on show, in the order they are drawn: the one the arrow keys walk. */
export function visibleChats(sections: Section[]): Conversation[] {
  return sections.flatMap((section) => section.chats);
}

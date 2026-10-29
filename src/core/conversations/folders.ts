import { FriendlyError, friendly } from "../userMessages";

/** What a failed folder call says to the person, in their words (the table is in userMessages):
 *  the server's reason by its code, or by its kind when it is not one of ours. Never its own words. */
export function folderError(error: unknown): Error {
  return new FriendlyError(friendly(error));
}

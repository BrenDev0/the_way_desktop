import { systemPreferences } from "electron";

export async function microphoneAccess(): Promise<"granted" | "denied"> {
  if (process.platform !== "darwin") return "granted";
  const status = systemPreferences.getMediaAccessStatus("microphone");
  if (status === "granted") return "granted";
  if (status === "not-determined") return (await systemPreferences.askForMediaAccess("microphone")) ? "granted" : "denied";
  return "denied";
}

import { useEffect, useState } from "react";
import type { Appearance } from "../core/bridge";

/** The theme onto the page: theme.css keys everything off data-theme on <html>. */
export function applyAppearance(appearance: Appearance) {
  document.documentElement.dataset.theme = appearance.resolved;
}

/** Before the first paint, and on every change after -- from this window or the other. */
export async function followAppearance(): Promise<void> {
  window.desktop.appearance.onChange(applyAppearance);
  try {
    applyAppearance(await window.desktop.appearance.get());
  } catch {
    // dark, as theme.css is without data-theme
  }
}

/** The theme as a setting: what was picked, and a way to pick another. */
export function useAppearance() {
  const [appearance, setAppearance] = useState<Appearance | null>(null);
  useEffect(() => {
    void window.desktop.appearance.get().then(setAppearance).catch(() => {});
    return window.desktop.appearance.onChange(setAppearance);
  }, []);
  const choose = async (theme: Appearance["theme"]) => {
    const next = await window.desktop.appearance.set(theme);
    setAppearance(next);
    applyAppearance(next);
  };
  return { appearance, choose };
}

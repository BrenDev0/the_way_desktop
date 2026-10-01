import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { followAppearance } from "./appearance";
import { Dock } from "./dock/Dock";
import "@fontsource-variable/jetbrains-mono";
import "./theme.css";
import "./styles.css";

// One page, two windows: the app, and the task strip on the screen edge (#dock). Marked
// before the first paint, so the strip never flashes the app's opaque background.
const dock = window.location.hash === "#dock";
if (dock) document.documentElement.classList.add("dock-page");

// the theme first, so the page never paints in the other one
void followAppearance().then(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      {dock ? <Dock /> : <App />}
    </StrictMode>,
  );
});

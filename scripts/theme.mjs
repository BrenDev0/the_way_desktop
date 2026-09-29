// Keeps src/renderer/theme.css identical to the canonical tokens in the management panel.
//   node scripts/theme.mjs sync   copy ../front_end_the_way/src/app/theme.css here
//   node scripts/theme.mjs check  exit 1 if the copies differ
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../../front_end_the_way/src/app/theme.css", import.meta.url));
const target = fileURLToPath(new URL("../src/renderer/theme.css", import.meta.url));
const mode = process.argv[2];

if (!existsSync(source)) {
  console.error(`Canonical theme not found at ${source}. Clone front_end_the_way next to this repo.`);
  process.exit(1);
}

if (mode === "sync") {
  copyFileSync(source, target);
  console.log("theme.css synced from front_end_the_way.");
} else if (mode === "check") {
  if (!existsSync(target) || readFileSync(source, "utf8") !== readFileSync(target, "utf8")) {
    console.error("src/renderer/theme.css differs from front_end_the_way/src/app/theme.css. Run `npm run theme:sync`.");
    process.exit(1);
  }
  console.log("theme.css is in sync.");
} else {
  console.error("Usage: node scripts/theme.mjs <sync|check>");
  process.exit(1);
}

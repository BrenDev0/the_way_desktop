// Draws the app icon and writes every file the packagers want, into assets/:
//   icon.svg  the source       icon.png  1024px, for the window in dev and Linux
//   icon.ico  Windows (exe, installer, taskbar)       icon.icns  macOS
// Run with: npm run icon   (Electron renders the SVG, so no image tooling is needed)
//
// The mark is the logo's own W glyph (src/renderer/Logo.tsx), lit row by row in the same
// greens, on the app's background, with a magenta cursor: a prompt waiting for input.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const OUT = path.join(__dirname, "..", "assets");

const W = ["█   █", "█   █", "█ █ █", "██ ██", "█   █"];
const ROW_COLORS = ["#00ff00", "#00d700", "#00af00", "#008700", "#005f00"];
const BG = "#060a0e";
const PANEL = "#0c1319";
const BORDER = "#385545";
const MAGENTA = "#ff00ff";

// On a 32-unit grid a glyph cell is 4 units: at 16px it is 2 whole pixels, so the
// smallest sizes stay crisp. Small sizes get solid cells and no glow -- both would only blur.
function svg({ small }) {
  const cell = 4;
  const x0 = 6;
  const y0 = 4;
  const gap = small ? 0 : 0.5;
  const rects = [];
  W.forEach((line, y) =>
    [...line].forEach((c, x) => {
      if (c !== "█") return;
      rects.push(
        `<rect x="${x0 + x * cell + gap / 2}" y="${y0 + y * cell + gap / 2}" width="${cell - gap}" height="${cell - gap}" fill="${ROW_COLORS[y]}"/>`,
      );
    }),
  );
  const cursor = `<rect x="${x0 + 16 + gap / 2}" y="${y0 + 22 + gap / 2}" width="${cell - gap}" height="${2 - gap / 2}" fill="${MAGENTA}"${small ? "" : ' filter="url(#glowM)"'}/>`;
  const glow = small
    ? ""
    : `<filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="0.9" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
       <filter id="glowM" x="-50%" y="-100%" width="200%" height="300%"><feGaussianBlur stdDeviation="0.7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
  const scan = small
    ? ""
    : `<pattern id="scan" width="1" height="1" patternUnits="userSpaceOnUse"><rect width="1" height="0.5" fill="#000" opacity="0.18"/></pattern>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" shape-rendering="${small ? "crispEdges" : "geometricPrecision"}">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${PANEL}"/><stop offset="1" stop-color="${BG}"/></linearGradient>
    ${glow}${scan}
  </defs>
  <rect x="${small ? 0 : 0.5}" y="${small ? 0 : 0.5}" width="${small ? 32 : 31}" height="${small ? 32 : 31}" rx="${small ? 3 : 6}" fill="url(#tile)" stroke="${BORDER}" stroke-width="${small ? 0 : 0.6}"/>
  ${small ? "" : '<rect x="0.5" y="0.5" width="31" height="31" rx="6" fill="url(#scan)"/>'}
  <g${small ? "" : ' filter="url(#glow)"'}>${rects.join("")}</g>
  ${cursor}
</svg>`;
}

async function render(window, source, size) {
  const url = `data:image/svg+xml;base64,${Buffer.from(source).toString("base64")}`;
  const data = await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = ${size};
      const context = canvas.getContext("2d");
      context.imageSmoothingEnabled = ${size > 32};
      context.drawImage(image, 0, 0, ${size}, ${size});
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = reject;
    image.src = ${JSON.stringify(url)};
  })`);
  return Buffer.from(data.split(",")[1], "base64");
}

/** An .ico whose images are PNGs -- what Windows has read since Vista. */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map(({ png }) => png)]);
}

/** An .icns of PNG entries, one per type macOS asks for. */
function icns(bySize) {
  const types = [["icp4", 16], ["icp5", 32], ["icp6", 64], ["ic07", 128], ["ic08", 256], ["ic09", 512], ["ic10", 1024]];
  const chunks = types.map(([type, size]) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, "ascii");
    head.writeUInt32BE(bySize[size].length + 8, 4);
    return Buffer.concat([head, bySize[size]]);
  });
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(8);
  head.write("icns", 0, "ascii");
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const window = new BrowserWindow({ show: false });
  await window.loadURL("data:text/html,<html></html>");

  const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
  const bySize = {};
  for (const size of sizes) bySize[size] = await render(window, svg({ small: size <= 32 }), size);

  fs.writeFileSync(path.join(OUT, "icon.svg"), svg({ small: false }));
  fs.writeFileSync(path.join(OUT, "icon.png"), bySize[1024]);
  fs.writeFileSync(path.join(OUT, "icon.ico"), ico([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: bySize[size] }))));
  fs.writeFileSync(path.join(OUT, "icon.icns"), icns(bySize));
  console.log(`icon written to ${OUT}`);
  app.quit();
});

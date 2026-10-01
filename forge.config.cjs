module.exports = {
  packagerConfig: {
    asar: true,
    executableName: "the-way",
    // no extension: the packager picks icon.ico on Windows and icon.icns on macOS
    icon: "assets/icon",
    // the Start menu folder is named after the company: Electron's own otherwise ("GitHub, Inc.")
    win32metadata: { CompanyName: "THE WAY", ProductName: "THE WAY", FileDescription: "THE WAY" },
  },
  makers: [
    { name: "@electron-forge/maker-squirrel", platforms: ["win32"], config: {
        // installs to %LOCALAPPDATA%\the_way; the desktop and Start menu shortcuts are
        // made by the app itself on first run (src/main/squirrel.ts)
        name: "the_way",
        // the publisher Windows lists under the app in Installed apps
        authors: "Xplorers",
        description: "THE WAY",
        setupExe: "THE-WAY-Setup.exe",
        setupIcon: "assets/icon.ico",
      },
    },
    { name: "@electron-forge/maker-zip", platforms: ["darwin"], config: {} },
  ],
  plugins: [
    {
      name: "@electron-forge/plugin-vite",
      config: {
        build: [
          { entry: "src/main/main.ts", config: "vite.main.config.mjs" },
          { entry: "src/main/preload.ts", config: "vite.preload.config.mjs" },
        ],
        renderer: [{ name: "main_window", config: "vite.renderer.config.mjs" }],
      },
    },
  ],
};

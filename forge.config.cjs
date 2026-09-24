module.exports = {
  packagerConfig: {
    asar: true,
    executableName: "the-way",
  },
  makers: [
    { name: "@electron-forge/maker-squirrel", platforms: ["win32"], config: {} },
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

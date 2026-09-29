# THE WAY Desktop

Operator client for Windows and macOS. The first slice connects to the backend's public `GET /health` endpoint. Desktop authentication, conversations, and local tool execution are the next slices; this app does not bundle a server signing secret.

## Server URL

Every organization uses the same backend, so release builds have its URL compiled in from `THE_WAY_SERVER_URL` (environment variable or a local `.env`, see `.env.example`). The URL is not a secret; it fixes which server the build trusts. It lives in the main process: the renderer cannot change it, and connection calls ignore any other address. `npm run package` and `npm run make` fail unless it is set to a bare HTTPS origin.

In development the variable is optional. Without it the app shows the address field and saves the chosen server locally; with it (loopback HTTP allowed, e.g. `http://localhost:8000`) the app behaves like a release build.

## Architecture

- `src/core`: connection contract and application service; no Electron or HTTP imports.
- `src/main`: Electron composition root and adapters for HTTP and local settings.
- `src/renderer/infrastructure`: renderer adapter for the narrow preload bridge.
- `src/renderer`: React view and styles.
- `src/renderer/theme.css`: design tokens shared with the management panel. Do not edit here; change `front_end_the_way/src/app/theme.css` and run `npm run theme:sync` (`npm run theme:check` fails if the copies differ). This app uses the default "full" effect level.

The renderer never calls arbitrary IPC channels or accesses the filesystem. A connection is saved only after the server responds to `/health` with `{"status":"ok"}`. Production servers require HTTPS; loopback HTTP is allowed for development.

## Sign-in and the desktop tools

The app talks to the backend's desktop API (`/api/desktop/v1`) with a bearer token from `POST /auth/login`. The token lives only in the main process, encrypted with `safeStorage` in `<userData>/session.bin`; a 401 clears it and returns the window to the sign-in.

The agent runs on the server. When it needs this machine, the conversation pauses (`awaiting_client`) and `TurnService` (`src/core/conversations`) has `ToolRunner` (`src/core/tools/runner.ts`) settle every pending call — run it here, ask the user first when it needs approval, or answer that it is unknown — and posts the results back. The contract is `backend_the_way/docs/desktop-tools.md`.

- `src/core/tools/` — the 23 tools as plain logic over ports: `files.ts` (11 local file tools), `transfer.ts` (upload/download to projects), `browser.ts` (browser and WhatsApp). `contract.ts` lists the names; at start-up the app compares them with the server's `GET /desktop-tools` and warns about any it lacks.
- `src/main/nodeFileSystem.ts` — the disk, fenced to the folder the user chose (`<userData>/workspace.json`). Every path is resolved against it and its real location, symlinks followed, must stay inside.
- `src/main/electronBrowser.ts` — the assistant's own visible browser windows, with a persistent profile (`persist:assistant-browser`) so WhatsApp Web stays signed in.

## Layout and live activity

Signed out, the window is the sign-in (with the server address when the build does not fix one); signed in, it opens straight into the chat. The sidebar holds the conversation list (`src/renderer/state/conversations.ts` shares it with the workbench) and the account. The workbench has three columns: one file tree on the left with a LOCAL ⇄ REMOTO switch (remote shows every project at the top level, their folders below), the chat in the middle, and the tasks on the right. Below 1200 px wide the tasks column becomes an overlay, and below 1000 px the files column does too; both open from the chat bar.

The chat follows the conversation's event stream while a turn runs: reply text as it is written, messages and tool calls as they land. Background tasks keep publishing after the turn ends, so `src/core/tasks/taskMonitor.ts` keeps a conversation's stream open while it has a running task. It collects each task's tool calls (steps inside another tool nest under it), reconnects with `Last-Event-ID`, re-reads `GET /background-tasks` as a fallback, and raises a system notification when a task ends while the window is not focused.

## Files panel

Beside the chat, the operator manages their work locally first and uploads to a project on demand.

- **Local**: the open folder as a tree. The operator can create folders, rename (F2), drag entries to move them, delete (with confirmation) and show an entry in Explorer. Operations go through `src/core/workspace/localFiles.ts` over the same fenced `NodeFileSystem` the agent's file tools use. Names follow the server's project-name rules so anything made locally can be uploaded. A rename or move never replaces an existing entry.
- **Subir a proyecto**: uploads the selected file or folder, or the whole folder, with `uploadToProject` in `src/core/tools/transfer.ts`, the same code as the agent's `UploadToProject`. Files already in the project are skipped, never replaced.
- **Remoto**: every project on the server as one tree, projects at the top (+ PROYECTO creates one). The operator can download an entry into the folder selected on the Local side (the download stops rather than replace a local file), or delete it from the project.

Failures reach the window as the operator's message (`src/core/workspace/messages.ts`), not the agent's English.

## Develop

```sh
npm install
npm run dev
npm test          # core tools, runner, turn loop, sandbox
```

The end-to-end test (`tests/e2e`) runs the real core against a live backend and is skipped unless `THE_WAY_E2E_URL`, `THE_WAY_E2E_EMAIL` and `THE_WAY_E2E_PASSWORD` are set.

Run the `the_way` backend separately and enter its URL in the app (`http://localhost:8000` locally), or set `THE_WAY_SERVER_URL=http://localhost:8000` in `.env` to skip the address field.

## Package

```sh
THE_WAY_SERVER_URL=https://api.your-domain.com npm run make
```

`npm run make` produces a Windows package on Windows and a macOS package on macOS (`npm run package` builds the unpacked app only). Signing and notarization must be configured before distribution; they are what stop a modified copy from pointing at a different server.

# THE WAY Desktop

Operator client for Windows and macOS. The first slice connects to the backend's public `GET /health` endpoint and saves the selected server URL locally. Desktop authentication, conversations, and local tool execution are the next slices; this app does not bundle a server signing secret.

## Architecture

- `src/core`: connection contract and application service; no Electron or HTTP imports.
- `src/main`: Electron composition root and adapters for HTTP and local settings.
- `src/renderer/infrastructure`: renderer adapter for the narrow preload bridge.
- `src/renderer`: React view and styles.

The renderer never calls arbitrary IPC channels or accesses the filesystem. A connection is saved only after the server responds to `/health` with `{"status":"ok"}`. Production servers require HTTPS; loopback HTTP is allowed for development.

## Develop

```sh
npm install
npm run dev
```

Run the `the_way` backend separately and enter its URL in the app. For local development, use `http://localhost:8000`.

## Package

`npm run make` produces a Windows package on Windows and a macOS package on macOS. Signing and notarization must be configured before distribution.

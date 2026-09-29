# @peerbox/desktop

The desktop app: a Tauri shell (Rust) hosts a thin status window and system
tray, and spawns the sync engine as a Node sidecar process (`src/engine/`,
bundled by esbuild). The shell and engine talk over newline-delimited JSON on
stdin/stdout. Installed via `curl | sh` (see `install.sh`).

## Why a Node sidecar instead of Electron?

The engine is the Holepunch stack (hyperswarm, hypercore, autobase,
corestore) — pure Node, with a few native addons (rocksdb, udx,
fs-native-extensions). Electron bundled Chromium + Node for every install;
Tauri ships only a small Rust shell and reuses the OS webview. The engine
moves to a sidecar so the npm dependencies keep working unchanged: the shell
spawns a Node process, and all IPC happens over stdin/stdout JSON. The
packaged app bundles its own Node runtime (Tauri external binary), so users
don't need Node installed.

## Status

On first run, a setup window walks you through picking a sync folder and
creating a drive, then shows the recovery phrase once. On every run after
that, a small status window opens with a live status line and a **Quit
peerbox** button. A tray icon is also created where the desktop supports it.
Closing the window quits the app. Linking and pairing windows come next.

## Run

```sh
npm run desktop          # from the repo root (tauri dev)
# or
npm run start -w @peerbox/desktop
```

`tauri dev` builds the engine sidecar (esbuild) and starts Vite, then compiles
and runs the Rust shell. The shell hosts the engine in a sidecar, so **don't
run `npm run daemon` at the same time** — the two instances would contend for
the same sync folder.

No CLI step is needed to get started: if no drive exists yet, the app opens
the setup window instead of the status window.

## Package

```sh
npm run dist -w @peerbox/desktop            # installer for this OS
npm run dist -w @peerbox/desktop -- --dir   # no bundle, fast smoke test
```

`scripts/package.mjs` bundles the engine, stages the native addons (with
foreign-platform prebuilds pruned), stages a Node runtime as a Tauri external
binary, and runs `tauri build`. Artifacts land in
`src-tauri/target/release/bundle/`.

Requirements: Rust (stable) and the platform prerequisites from
https://v2.tauri.app/start/prerequisites/.

## Quit

Choose **Quit peerbox** from the tray menu or the window. The engine is
stopped cleanly (watcher, swarm, and stores are closed) before both processes
exit.

## Linux / GNOME notes

- GNOME Shell hides tray icons unless an **AppIndicator and KStatusNotifierItem
  Support** extension is enabled. KDE, XFCE, and Hyprland bars show the tray
  natively.
- The tray is created with the Rust `tray-icon` crate, which registers over
  the StatusNotifier protocol properly — unlike Electron's tray, it appears on
  GNOME with the standard AppIndicator extensions.

## Power events

The engine sidecar detects sleep/wake with a watchdog (a timer that should
fire every 15s but didn't means the machine slept) and tears the swarm down
and re-announces on wake. Detection happens on wake, not before sleep — the
observable behavior matches the old Electron power-monitor handling.

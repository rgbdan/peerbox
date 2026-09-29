# Developing peerbox

The repository is an npm workspace:

```
packages/core       sync engine (Holepunch stack) + headless daemon
packages/protocol   pairing, recovery phrase, conflict rules
apps/desktop        Tauri desktop app (Rust shell + Node engine sidecar)
apps/landing        website (static, GitHub Pages)
```

## Run the desktop app in dev mode

```sh
npm install
npm run desktop
```

The desktop app runs the sync engine as a Node sidecar. Don't run `npm run
daemon` at the same time, since both use the same data folder. To test
without touching your real drive, point it at a scratch config dir:

```sh
PEERBOX_CONFIG_DIR=/tmp/peerbox-test npm run desktop
```

`npm run dist -- --dir` skips the installers and is much faster, but the bare
`target/release/peerbox` it produces **can't be run directly**: a release
build looks for the engine in its bundle's resource dir and for a bundled
`node` next to the executable, so it exits with "failed to spawn engine
sidecar". Use `npm run desktop` or install a real bundle instead.

RPM output is disabled because Tauri's bundler hangs on it
(tauri-apps/tauri#11478). Fedora and openSUSE users can run the AppImage.

Pushing a `v*` tag builds the Linux installers on CI and attaches them to the
release.

## Other commands

```sh
npm run daemon -- status   # show setup state
npm run typecheck          # type-check the code
npm run reset              # wipe local identity/keys/config to re-test first-run setup
```

`npm run reset` deletes `~/.config/peerbox/` after confirming (pass `-y` to
skip the prompt) and respects `PEERBOX_CONFIG_DIR`.

What's stored locally (no peer information):

```
~/.config/peerbox/
  identity.json   # drive key and recovery phrase (keep this private)
  config.json     # which folder is synced
  data/           # sync state and file data
```

## Landing page

`apps/landing/` is a static site, published to GitHub Pages by
`.github/workflows/pages.yml`. Preview it locally:

```sh
python3 -m http.server -d apps/landing 8080   # http://localhost:8080
```

## Regenerating the icons

The logo is drawn by `apps/desktop/scripts/make-icon.mjs`. After changing it:

```sh
cd apps/desktop
node scripts/make-icon.mjs
npx tauri icon build-resources/icon.png
```

`docs/logo.svg` and `apps/landing/static/favicon.svg` are hand-kept SVG copies
of the same mark.

## Troubleshooting

- Engine debug output goes to the terminal when launched with
  `PEERBOX_DEBUG=1`.
- The storage engine's own logs are in `~/.config/peerbox/data/db/LOG*`.
- If the app reports store corruption ("Corruption: ... .sst: No such file or
  directory"), **copy `data/db/LOG*` somewhere first** since they're the only
  forensics, then `npm run reset` and re-pair. See PLAN.md for the one known
  incident.

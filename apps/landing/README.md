# peerbox landing

The project website: plain static HTML and CSS, no build step and no server.
All assets (CSS, fonts) are self-hosted, so visitors never contact a third party.

## Preview

```sh
python3 -m http.server -d apps/landing 8080   # http://localhost:8080
```

## Deploy

`.github/workflows/pages.yml` publishes this folder to GitHub Pages on every
push to `main` that touches it. One-time setup: in the repo's
**Settings → Pages**, set **Source** to **GitHub Actions**.

## Notes

- **Light is the default theme**; dark is opt-in via the nav toggle and
  persisted in `localStorage` under `peerbox-theme`. `prefers-color-scheme` is
  deliberately not consulted — light is the intended first impression.
  `theme.js` is loaded *synchronously* in `<head>` (not `defer`) so a stored
  dark choice lands before first paint; the usual inline-script trick is
  unavailable because the CSP has no `unsafe-inline`. For the same reason the
  toggle is hidden in CSS until `theme.js` adds `.js` to `<html>`, rather than
  via `<noscript><style>`.
- Themes are two token blocks in `style.css` (`:root` light, `[data-theme="dark"]`).
  Note the brand gold splits on light: `--color-accent` is *ink* (text, icons)
  and `--color-accent-fill` is the button background. They coincide on dark, but
  `#e0b458` is only 1.8:1 on a light ground, so light uses `#8a6410` for both.
  Every text/background pair in the markup clears WCAG AA in both themes; keep
  it that way when adding colours.
- Fonts are self-hosted woff2 (latin + latin-ext), fetched from Google Fonts
  once at build-authoring time — no runtime Google requests. Display face is
  **Archivo 600** (`--font-display`); body Instrument Sans, utility IBM Plex
  Mono. Archivo is shipped at 600 *only*, so the display rules take their weight
  from `--font-display-weight` rather than hardcoding 400 — asking for a weight
  that is not on disk makes the browser synthesise a faux-bold.

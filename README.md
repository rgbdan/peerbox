<p align="center">
  <img src="docs/logo.svg" width="112" height="112" alt="peerbox logo">
</p>

<h1 align="center">peerbox</h1>

<p align="center">
  <strong>Your files, on your devices. No one in between.</strong><br>
  Private, peer-to-peer folder sync. No cloud, no accounts, no servers.
</p>

---

peerbox keeps a folder in sync directly between your own computers. There's no
company server holding a copy of your files, no account to sign up for, and no
monthly storage bill. Your devices find each other and sync over an encrypted
peer-to-peer connection.

- **No cloud.** Files go straight from one of your machines to another.
- **No account.** A 12-word recovery phrase *is* your account. Write it down
  and you can restore your drive on any machine.
- **Encrypted end to end.** Connections between devices are encrypted, and
  nothing is ever sent to a third party.
- **Works everywhere.** Linux, macOS and Windows, plus a headless mode for a
  Raspberry Pi or home server that keeps your files available around the clock.
- **Lightweight.** A small native app with a tray icon, built with Tauri
  instead of a bundled browser.
- **Fully open source.** peerbox is GPL-licensed, and every library it depends
  on is open source too. See [Built on open source](#built-on-open-source).

## Getting started

1. Install peerbox on your first computer ([download](#download) or
   [build from source](#build-from-source)) and open it.
2. Pick the folder you want to sync. peerbox shows your **recovery phrase**.
   Write it down and keep it somewhere safe. It's the only way to recover your
   drive, and nobody (including us) can reset it for you.
3. Install peerbox on your second computer and link it: paste the pairing key
   shown on the first device, or enter your recovery phrase.

That's it. Anything you put in the folder shows up on your other devices
whenever they're online at the same time.

## Download

Builds for Mac and Linux are on the [releases page](https://github.com/rgbdan/peerbox/releases/latest).

### macOS (Apple Silicon)

Download [peerbox-macos-arm64.dmg](https://github.com/rgbdan/peerbox/releases/latest/download/peerbox-macos-arm64.dmg),
open it and drag **peerbox** into Applications. It needs an M1 or newer Mac;
Intel Macs aren't supported yet.

peerbox isn't signed with an Apple developer certificate yet, so macOS blocks
the first launch. To allow it once:

1. Open peerbox and click **Done** on the warning.
2. Go to **System Settings → Privacy & Security**, scroll down and click
   **Open Anyway** next to the peerbox message.
3. Confirm with your password. From then on it opens normally.

### Linux

```sh
# Debian / Ubuntu
curl -LO https://github.com/rgbdan/peerbox/releases/latest/download/peerbox-linux-amd64.deb
sudo apt install ./peerbox-linux-amd64.deb

# Any other distro
curl -LO https://github.com/rgbdan/peerbox/releases/latest/download/peerbox-linux-x86_64.AppImage
chmod +x peerbox-linux-x86_64.AppImage
./peerbox-linux-x86_64.AppImage
```

Then start **peerbox** from your app menu, or run `peerbox` in a terminal.

> **No tray icon on GNOME?** Ubuntu shows it out of the box. On other GNOME
> desktops (Debian, Fedora, …), install the AppIndicator extension, then log
> out and back in:
> ```sh
> sudo apt install gnome-shell-extension-appindicator
> gnome-extensions enable ubuntu-appindicators@ubuntu.com
> ```
> The tray is optional: the app window has the same controls.

### Windows

Windows builds aren't published yet; [build from source](#build-from-source).

## Build from source

Every platform needs:

- [Node.js](https://nodejs.org) 22 or newer (includes `npm`)
- [Rust](https://rustup.rs) (stable)
- [Git](https://git-scm.com)

plus the build tools for your OS below. Build on the machine you're installing on.

### Linux

Install the system libraries (Debian/Ubuntu shown; for other distros see
[Tauri's prerequisites](https://v2.tauri.app/start/prerequisites/#linux)):

```sh
sudo apt update
sudo apt install -y build-essential curl file pkg-config libssl-dev \
  libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
```

Build:

```sh
git clone https://github.com/rgbdan/peerbox.git peerbox
cd peerbox
npm install
npm run dist
```

This produces a `.deb` and an `.AppImage` in
`apps/desktop/src-tauri/target/release/bundle/`. Install one of them:

```sh
# Debian / Ubuntu
sudo dpkg -i apps/desktop/src-tauri/target/release/bundle/deb/*.deb

# Any other distro: run the AppImage directly
chmod +x apps/desktop/src-tauri/target/release/bundle/appimage/*.AppImage
./apps/desktop/src-tauri/target/release/bundle/appimage/*.AppImage
```

Then start **peerbox** from your app menu, or run `peerbox` in a terminal.

### macOS

Install Apple's command-line build tools:

```sh
xcode-select --install
```

Build:

```sh
git clone https://github.com/rgbdan/peerbox.git peerbox
cd peerbox
npm install
npm run dist
```

Open the `.dmg` in `apps/desktop/src-tauri/target/release/bundle/dmg/` and
drag **peerbox** into Applications. A build you made yourself isn't flagged as
downloaded, so it opens without the security warning.

### Windows

Install:

- [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/),
  with the **Desktop development with C++** workload selected
- WebView2, which is already included in Windows 10 (version 1803+) and 11

Then, in PowerShell:

```powershell
git clone https://github.com/rgbdan/peerbox.git peerbox
cd peerbox
npm install
npm run dist
```

Run the installer from
`apps\desktop\src-tauri\target\release\bundle\nsis\` (the file ending in
`-setup.exe`). Builds aren't signed yet, so if Windows SmartScreen appears,
click **More info → Run anyway**.

## Uninstall

Quit peerbox first, then remove it the usual way for your OS: `sudo apt
remove peerbox` on Debian/Ubuntu, delete the AppImage on other Linux distros,
drag it to the Trash on macOS, or use **Settings → Apps** on Windows.

Your synced folder is never touched. Your drive keys and settings stay in
`~/.config/peerbox/` so you can reinstall later. To remove those too, turn off
**Start on login** in the app first, then delete that folder (and on Linux,
`~/.config/autostart/peerbox.desktop`).

## Built on open source

peerbox is open source under the [GPL v3](#license), and so is everything it's
built on. No proprietary SDKs, no closed services, and no telemetry.

| Part | Built with |
| --- | --- |
| Peer-to-peer networking and sync | [Holepunch](https://holepunch.to) stack: [Hyperswarm](https://github.com/holepunchto/hyperswarm), [Hypercore](https://github.com/holepunchto/hypercore), [Autobase](https://github.com/holepunchto/autobase), [Hyperbee](https://github.com/holepunchto/hyperbee), [Hyperblobs](https://github.com/holepunchto/hyperblobs), [Corestore](https://github.com/holepunchto/corestore) |
| Desktop app | [Tauri](https://tauri.app) (Rust) with the system's own webview |
| Interface | [React](https://react.dev), [Vite](https://vite.dev) |
| Engine runtime | [Node.js](https://nodejs.org), TypeScript |
| Recovery phrase | [BIP-39](https://github.com/paulmillr/scure-bip39) wordlists (`@scure/bip39`) |
| Storage | [RocksDB](https://rocksdb.org) |
| Fonts | Inter, Space Grotesk, IBM Plex Mono (SIL Open Font License) |

Want to read or change the code? It's all in this repository; see
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) to get started.

## How it works

There's no server and no stored list of peers. Everything comes from the
**drive key**, which every device in a drive shares:

```
drive key  →  discovery key (32-byte topic)  →  DHT rendezvous
```

On start, each device derives a discovery key from the drive key and joins a
distributed hash table (DHT) on that topic. Any other online device with the
same drive key does the same, and the DHT introduces them. From then on they
talk directly, over an encrypted connection.

So a device syncs with **whoever holds the same drive key and is online**. The
recovery phrase can regenerate that key, which is why it's all you need to
restore a drive.

## Headless mode (servers, Raspberry Pi)

Runs without a window on an always-on machine. Needs Node.js and Git only, no Rust.

```sh
git clone https://github.com/rgbdan/peerbox.git peerbox
cd peerbox
npm install
npm run daemon -- create ~/Peerbox     # new drive: prints the recovery phrase
npm run daemon                          # run the sync engine
```

On another machine, join the same drive with either:

```sh
npm run daemon -- restore "your twelve word phrase here" ~/Peerbox
npm run daemon -- pair <baseKey> ~/Peerbox   # key from ~/.config/peerbox/identity.json
```

then run `npm run daemon` there too.

## License

peerbox is free software under the [GNU General Public License v3.0 or
later](LICENSE). You can use, study, change and share it. If you distribute a
modified version, it must stay under the GPL and come with its source code.

The peerbox name, logo and icon are not covered by the GPL. Forks you
distribute need their own name and icon; see [TRADEMARKS.md](TRADEMARKS.md).

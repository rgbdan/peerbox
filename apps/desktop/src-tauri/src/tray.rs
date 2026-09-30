// System-tray icon and menu (StatusNotifier, so GNOME + AppIndicator works).

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::AppHandle;

/// The tray's view of the world, kept in managed state and rebuilt on change.
#[derive(Clone, PartialEq)]
pub struct TrayView {
    pub status: String,
    pub peers: u32,
    pub sync_dir: String,
    /// A newer version found by "Check now".
    pub update: Option<String>,
}

impl TrayView {
    /// From the engine's getState reply, which doesn't carry `update`.
    pub fn from_state(value: &serde_json::Value, update: Option<String>) -> Self {
        Self {
            status: value["status"].as_str().unwrap_or("not-setup").to_string(),
            peers: value["peers"].as_u64().unwrap_or(0) as u32,
            sync_dir: value["syncDir"].as_str().unwrap_or("").to_string(),
            update,
        }
    }
}

pub fn status_label(status: &str) -> &'static str {
    match status {
        "idle" => "Idle",
        "syncing" => "Syncing",
        "waiting" => "Waiting for peers",
        "error" => "Error",
        _ => "Not set up",
    }
}

fn peers_label(peers: u32) -> String {
    match peers {
        0 => "No devices connected".to_string(),
        1 => "1 device connected".to_string(),
        n => format!("{n} devices connected"),
    }
}

fn tooltip(view: &TrayView) -> String {
    if view.status == "not-setup" {
        "peerbox — not set up".to_string()
    } else {
        format!(
            "peerbox — {} · {}",
            status_label(&view.status),
            peers_label(view.peers)
        )
    }
}

// Kept to the essentials; everything else lives in the window.
fn build_menu(app: &AppHandle, view: &TrayView) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::new(app)?;

    menu.append(&MenuItem::with_id(
        app,
        "title",
        format!("peerbox — {}", status_label(&view.status)),
        false,
        None::<&str>,
    )?)?;
    if let Some(version) = &view.update {
        menu.append(&MenuItem::with_id(
            app,
            "download-update",
            format!("Download peerbox v{version}…"),
            true,
            None::<&str>,
        )?)?;
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(app, "open-app", "Open peerbox", true, None::<&str>)?)?;
    if view.status != "not-setup" {
        menu.append(&MenuItem::with_id(app, "open-folder", "Open folder", true, None::<&str>)?)?;
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(app, "quit", "Quit peerbox", true, None::<&str>)?)?;

    Ok(menu)
}

pub fn rebuild_tray(
    app: &AppHandle,
    tray: &std::sync::Mutex<Option<TrayIcon<tauri::Wry>>>,
    last_rendered: &std::sync::Mutex<Option<TrayView>>,
    view: &TrayView,
) -> tauri::Result<()> {
    // Skip no-op rebuilds; repeated menu replacement makes macOS menus flaky.
    if *last_rendered.lock().unwrap() == Some(view.clone()) {
        return Ok(());
    }
    if let Some(tray) = tray.lock().unwrap().as_ref() {
        tray.set_menu(Some(build_menu(app, view)?))?;
        tray.set_tooltip(Some(tooltip(view)))?;
    }
    *last_rendered.lock().unwrap() = Some(view.clone());
    Ok(())
}

pub fn create_tray(app: &AppHandle, view: &TrayView) -> tauri::Result<TrayIcon<tauri::Wry>> {
    let icon = tauri::image::Image::from_bytes(include_bytes!("../../assets/tray.png"))?;

    // Only the macOS branch below reassigns this, so every other target sees
    // an unused `mut` — keep the `mut`, silence it off-macOS.
    #[cfg_attr(not(target_os = "macos"), allow(unused_mut))]
    let mut builder = TrayIconBuilder::with_id("peerbox-tray")
        .icon(icon)
        .tooltip(tooltip(view))
        .menu(&build_menu(app, view)?)
        // A left click shows the menu on every platform — the same behavior
        // Electron's tray had. "Open peerbox" in the menu raises the window.
        .show_menu_on_left_click(true);

    // The tray icon is a monochrome glyph; let macOS render it in the menu
    // bar style.
    #[cfg(target_os = "macos")]
    {
        builder = builder.icon_as_template(true);
    }

    builder.build(app)
}

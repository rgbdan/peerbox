// peerbox desktop shell (Tauri): a thin layer over the Node engine sidecar.
// Commands proxy to the engine; the tray mirrors its status events.

mod engine;
mod tray;

use engine::EngineClient;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::menu::MenuEvent;
use tauri::tray::TrayIcon;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_dialog::DialogExt;
use tray::{create_tray, rebuild_tray, TrayView};

/// Passed by the autostart entry so a login launch stays in the tray. Any
/// launch without it is one the user asked for, and shows the dashboard.
pub const HIDDEN_FLAG: &str = "--hidden";

pub fn launched_hidden<I: IntoIterator<Item = String>>(args: I) -> bool {
    args.into_iter().any(|arg| arg == HIDDEN_FLAG)
}

pub struct EngineState {
    client: EngineClient,
    tray: Mutex<Option<TrayIcon<tauri::Wry>>>,
    view: Mutex<TrayView>,
    rendered: Mutex<Option<TrayView>>,
}

/// Re-reads engine state into the tray.
fn refresh_tray(app: &AppHandle, state: &EngineState) {
    if let Ok(value) = state.client.call("getState", json!([])) {
        let view = TrayView::from_state(&value);
        *state.view.lock().unwrap() = view.clone();
        // Tray objects belong to the main thread; this runs on workers too.
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            let state = handle.state::<EngineState>();
            let _ = rebuild_tray(&handle, &state.tray, &state.rendered, &view);
        });
    }
}

/// Refreshes the tray and tells the window to refetch its state.
fn state_changed(app: &AppHandle, state: &EngineState) {
    refresh_tray(app, state);
    let _ = app.emit("app:state-changed", ());
}

fn emit_status(app: &AppHandle, status: &str, peers: u32, error: Option<&str>) {
    let _ = app.emit(
        "status",
        json!({
            "status": status,
            "label": tray::status_label(status),
            "peers": peers,
            "error": error,
        }),
    );
}

// ---------------------------------------------------------------------------
// Actions shared by commands and tray menu handlers.

/// Creates the window on first use rather than hiding it at startup: a window
/// created hidden and shown later gets dead titlebar buttons on GNOME Wayland.
fn focus_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    let built = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
        .title("peerbox")
        .inner_size(480.0, 620.0)
        .min_inner_size(380.0, 320.0)
        .resizable(true)
        .build();
    if let Err(err) = built {
        eprintln!("[peerbox] could not open the window: {err}");
    }
}

fn open_folder(state: &EngineState) -> Result<(), String> {
    let view = state.view.lock().unwrap().clone();
    if view.status == "not-setup" {
        return Ok(());
    }
    opener::open(view.sync_dir).map_err(|err| format!("failed to open folder: {err}"))
}

fn pick_folder(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("Choose sync folder")
        .blocking_pick_folder();
    Ok(picked.and_then(|path| path.into_path().ok()))
}

fn change_folder(app: &AppHandle, state: &EngineState) -> Result<(), String> {
    let Some(dir) = pick_folder(app)? else {
        return Ok(());
    };
    state
        .client
        .call("changeFolder", json!([dir.to_string_lossy()]))?;
    state_changed(app, state);
    Ok(())
}

/// `auto-launch` mkdirs non-recursively, so create `~/.config/autostart` first.
pub fn ensure_autostart_dir() -> std::io::Result<()> {
    #[cfg(target_os = "linux")]
    {
        // auto-launch resolves the dir through `dirs::home_dir()`, which reads
        // $HOME on Linux — match it exactly.
        if let Some(home) = std::env::var_os("HOME") {
            return std::fs::create_dir_all(
                PathBuf::from(home).join(".config").join("autostart"),
            );
        }
    }
    Ok(())
}

fn apply_autostart(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let autolaunch = app.autolaunch();
    if enabled {
        ensure_autostart_dir()
            .map_err(|err| format!("failed to create the autostart directory: {err}"))?;
        autolaunch.enable()
    } else {
        autolaunch.disable()
    }
    .map_err(|err| format!("failed to update autostart setting: {err}"))
}

fn set_autostart(app: &AppHandle, state: &EngineState, enabled: bool) -> Result<(), String> {
    apply_autostart(app, enabled)?;
    state_changed(app, state);
    Ok(())
}

/// Rewrites the autostart entry so one from an older build points at this
/// binary with HIDDEN_FLAG. Release only: dev must not replace it.
#[cfg(not(debug_assertions))]
fn refresh_autostart_entry(app: &AppHandle) {
    if app.autolaunch().is_enabled().unwrap_or(false) {
        if let Err(err) = app.autolaunch().enable() {
            eprintln!("[peerbox] could not refresh the autostart entry: {err}");
        }
    }
}

/// A sync tool is always-on, so setup opts in to start-on-login (best-effort).
/// No state-changed event: the setup screen still has to show the phrase.
fn finish_setup(app: &AppHandle, state: &EngineState) {
    if !app.autolaunch().is_enabled().unwrap_or(false) {
        if let Err(err) = apply_autostart(app, true) {
            eprintln!("[peerbox] could not enable autostart on first run: {err}");
        }
    }
    refresh_tray(app, state);
}

/// Hides the window at once, then stops the engine off the main thread: the
/// clean stop can take seconds, and blocking here freezes every window.
fn shutdown(app: &AppHandle) {
    for window in app.webview_windows().values() {
        let _ = window.hide();
    }
    let app = app.clone();
    std::thread::spawn(move || {
        app.state::<EngineState>().client.shutdown();
        app.exit(0);
    });
}

// ---------------------------------------------------------------------------
// Tauri commands (the renderer's window.peerbox surface).

#[tauri::command(async)]
fn get_state(app: AppHandle, state: State<'_, EngineState>) -> Result<Value, String> {
    let mut value = state.client.call("getState", json!([]))?;
    if value["view"] == "status" {
        let label = tray::status_label(value["status"].as_str().unwrap_or(""));
        value["label"] = json!(label);
        value["autostartEnabled"] = json!(app.autolaunch().is_enabled().unwrap_or(false));
    }
    Ok(value)
}

#[tauri::command(async)]
fn get_phrase(state: State<'_, EngineState>) -> Result<Value, String> {
    state.client.call("getPhrase", json!([]))
}

// Renamed so the commands don't shadow the helpers above.
#[tauri::command(rename = "open_folder")]
fn open_folder_cmd(state: State<'_, EngineState>) -> Result<(), String> {
    open_folder(&state)
}

#[tauri::command(async, rename = "change_folder")]
fn change_folder_cmd(app: AppHandle, state: State<'_, EngineState>) -> Result<(), String> {
    change_folder(&app, &state)
}

#[tauri::command(async, rename = "set_autostart")]
fn set_autostart_cmd(
    app: AppHandle,
    state: State<'_, EngineState>,
    enabled: bool,
) -> Result<(), String> {
    set_autostart(&app, &state, enabled)
}

#[tauri::command(async)]
fn list_devices(state: State<'_, EngineState>) -> Result<Value, String> {
    state.client.call("listDevices", json!([]))
}

#[tauri::command(async)]
fn retry(state: State<'_, EngineState>) -> Result<(), String> {
    state.client.call("retry", json!([])).map(drop)
}

#[tauri::command(async)]
fn revoke_device(state: State<'_, EngineState>, device_key: String) -> Result<(), String> {
    state.client.call("revokeDevice", json!([device_key])).map(drop)
}

#[tauri::command(async)]
fn choose_folder(app: AppHandle) -> Result<Option<String>, String> {
    pick_folder(&app).map(|path| path.map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command(async)]
fn create_drive(app: AppHandle, state: State<'_, EngineState>, sync_dir: String) -> Result<Value, String> {
    let result = state.client.call("create", json!([sync_dir]))?;
    finish_setup(&app, &state);
    Ok(result)
}

#[tauri::command(async)]
fn join_drive(
    app: AppHandle,
    state: State<'_, EngineState>,
    base_key: String,
    sync_dir: String,
) -> Result<(), String> {
    state.client.call("pair", json!([base_key, sync_dir]))?;
    finish_setup(&app, &state);
    Ok(())
}

#[tauri::command(async)]
fn restore_drive(
    app: AppHandle,
    state: State<'_, EngineState>,
    phrase: String,
    sync_dir: String,
) -> Result<(), String> {
    state.client.call("restore", json!([phrase, sync_dir]))?;
    finish_setup(&app, &state);
    Ok(())
}

#[tauri::command]
fn quit(app: AppHandle) {
    shutdown(&app);
}

// ---------------------------------------------------------------------------
// Setup and lifecycle.

fn sidecar_path(app: &AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        return Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist/engine/sidecar.cjs"));
    }
    Ok(app
        .path()
        .resource_dir()
        .map_err(|err| err.to_string())?
        .join("engine/sidecar.cjs"))
}

fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let client = EngineClient::spawn(&sidecar_path(app.handle())?)?;

    let view = match client.call("getState", json!([])) {
        Ok(value) => TrayView::from_state(&value),
        Err(err) => {
            client.shutdown();
            return Err(format!("engine failed to start: {err}").into());
        }
    };

    let handle = app.handle().clone();
    let tray_icon = create_tray(&handle, &view)?;

    app.manage(EngineState {
        client: client.clone(),
        tray: Mutex::new(Some(tray_icon)),
        view: Mutex::new(view),
        rendered: Mutex::new(None),
    });

    // Status events arrive on the reader thread: hop to the main thread, no RPC here.
    let status_handle = handle.clone();
    client.set_on_event(move |message| {
        let status = message
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("idle")
            .to_string();
        let peers = message.get("peers").and_then(Value::as_u64).unwrap_or(0) as u32;
        let error = message.get("error").and_then(Value::as_str).map(String::from);
        let handle = status_handle.clone();
        let _ = status_handle.run_on_main_thread(move || {
            let state = handle.state::<EngineState>();
            let view = {
                let mut view = state.view.lock().unwrap();
                view.status = status.clone();
                view.peers = peers;
                view.clone()
            };
            let _ = rebuild_tray(&handle, &state.tray, &state.rendered, &view);
            emit_status(&handle, &status, peers, error.as_deref());
        });
    });

    // The sidecar died without being asked to stop: nothing left to sync,
    // so log loudly and exit rather than linger as a hollow shell.
    client.set_on_exit(move || {
        eprintln!("[peerbox] engine sidecar exited unexpectedly — shutting down");
        std::process::exit(1);
    });

    #[cfg(not(debug_assertions))]
    refresh_autostart_entry(&handle);

    // Open the window unless autostarted; relaunching reopens it (single-instance).
    if !launched_hidden(std::env::args()) {
        focus_window(&handle);
    }

    Ok(())
}

fn handle_menu_event(app: &AppHandle, event: MenuEvent) {
    let state = app.state::<EngineState>();
    match event.id().as_ref() {
        "open-app" => focus_window(app),
        "open-folder" => {
            if let Err(err) = open_folder(&state) {
                eprintln!("[peerbox] open folder failed: {err}");
            }
        }
        "quit" => shutdown(app),
        _ => {}
    }
}

/// Single-instance guard: autostart makes double launches routine. The
/// duplicate exits; the running instance raises its window instead.
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![HIDDEN_FLAG]),
        ))
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // A duplicate autostart launch (session restore, a login race)
            // must not yank the window up; a launch the user made must.
            if !launched_hidden(argv) {
                focus_window(app);
            }
        }))
        .setup(setup)
        .invoke_handler(tauri::generate_handler![
            get_state,
            get_phrase,
            open_folder_cmd,
            change_folder_cmd,
            set_autostart_cmd,
            list_devices,
            retry,
            revoke_device,
            choose_folder,
            create_drive,
            join_drive,
            restore_drive,
            quit
        ])
        .on_menu_event(handle_menu_event)
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Closing quits: without a visible tray there'd be no other way out.
                api.prevent_close();
                shutdown(window.app_handle());
            }
        });

    builder
        .build(tauri::generate_context!())
        .expect("error while building peerbox")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                // Stop the engine cleanly on every exit path (Cmd+Q skips the
                // window close handler). Idempotent via EngineClient.
                if let Some(state) = app.try_state::<EngineState>() {
                    state.client.shutdown();
                }
            }
        });
}

// Client for the Node engine sidecar (protocol: src/engine/sidecar.ts).
// A reader thread dispatches replies and events; never `call` from the event
// callback, or the reply can't be read.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

const CALL_TIMEOUT: Duration = Duration::from_secs(600);
const STOP_TIMEOUT: Duration = Duration::from_secs(3);

type PendingMap = HashMap<u64, Sender<Value>>;
type EventCallback = Box<dyn Fn(Value) + Send + Sync>;
type ExitCallback = Box<dyn Fn() + Send + Sync>;

struct EngineInner {
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    pending: Mutex<PendingMap>,
    next_id: AtomicU64,
    stopped: AtomicBool,
    on_event: RwLock<Option<EventCallback>>,
    on_exit: RwLock<Option<ExitCallback>>,
}

#[derive(Clone)]
pub struct EngineClient {
    inner: Arc<EngineInner>,
}

impl EngineClient {
    /// Spawn the sidecar: system `node` in dev, the bundled `node` next to the
    /// executable in packaged builds. `version` is the app's, for the update check.
    pub fn spawn(sidecar_path: &Path, version: &str) -> Result<Self, String> {
        let program: PathBuf = if cfg!(debug_assertions) {
            PathBuf::from("node")
        } else {
            let exe_dir = std::env::current_exe()
                .ok()
                .and_then(|path| path.parent().map(Path::to_path_buf))
                .ok_or("cannot locate app executable directory")?;
            // Tauri bundles `binaries/node-<triple>` as plain `node`.
            exe_dir.join(if cfg!(windows) { "node.exe" } else { "node" })
        };
        let mut child = Command::new(program)
            .arg(sidecar_path)
            .current_dir(
                sidecar_path
                    .parent()
                    .expect("sidecar path has no parent"),
            )
            .env("PEERBOX_VERSION", version)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|err| format!("failed to spawn engine sidecar: {err}"))?;

        let stdin = child.stdin.take().ok_or("sidecar stdin unavailable")?;
        let stdout = child.stdout.take().ok_or("sidecar stdout unavailable")?;

        let client = Self {
            inner: Arc::new(EngineInner {
                child: Mutex::new(child),
                stdin: Mutex::new(stdin),
                pending: Mutex::new(HashMap::new()),
                next_id: AtomicU64::new(1),
                stopped: AtomicBool::new(false),
                on_event: RwLock::new(None),
                on_exit: RwLock::new(None),
            }),
        };

        let inner = Arc::clone(&client.inner);
        std::thread::Builder::new()
            .name("engine-sidecar".into())
            .spawn(move || {
                for line in BufReader::new(stdout).lines() {
                    let Ok(line) = line else { break };
                    let Ok(message) = serde_json::from_str::<Value>(&line) else {
                        continue;
                    };
                    if message.get("event").is_some() {
                        if let Some(callback) = inner.on_event.read().unwrap().as_ref() {
                            callback(message);
                        }
                        continue;
                    }
                    let Some(id) = message.get("id").and_then(Value::as_u64) else {
                        continue;
                    };
                    if let Some(reply) = inner.pending.lock().unwrap().remove(&id) {
                        let _ = reply.send(message);
                    }
                }
                // Sidecar died: drop waiting senders so in-flight calls fail now.
                inner.pending.lock().unwrap().clear();

                // Normal during shutdown (we close our end), a failure otherwise.
                if !inner.stopped.load(Ordering::SeqCst) {
                    if let Some(callback) = inner.on_exit.read().unwrap().as_ref() {
                        callback();
                    }
                }
            })
            .map_err(|err| format!("failed to start engine reader thread: {err}"))?;

        Ok(client)
    }

    /// Blocking RPC call. Must only run on the main thread or helper threads —
    /// never from the event callback.
    pub fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        self.call_with_timeout(method, params, CALL_TIMEOUT)
    }

    fn call_with_timeout(&self, method: &str, params: Value, timeout: Duration) -> Result<Value, String> {
        let id = self.inner.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = channel();
        self.inner.pending.lock().unwrap().insert(id, tx);

        let request = json!({ "id": id, "method": method, "params": params });
        let line = serde_json::to_string(&request).expect("request serializes");
        let written = {
            let mut stdin = self.inner.stdin.lock().unwrap();
            writeln!(stdin, "{line}").map_err(|err| format!("failed to write to engine: {err}"))
        };

        // Every exit path below has to drop this request's slot, or the map
        // grows a dead sender per failed call.
        let outcome = written.and_then(|()| {
            rx.recv_timeout(timeout).map_err(|err| match err {
                RecvTimeoutError::Timeout => format!("engine request '{method}' timed out"),
                RecvTimeoutError::Disconnected => {
                    format!("engine stopped before answering '{method}'")
                }
            })
        });
        self.inner.pending.lock().unwrap().remove(&id);
        let reply = outcome?;

        if reply.get("ok").and_then(Value::as_bool) == Some(true) {
            Ok(reply.get("result").cloned().unwrap_or(Value::Null))
        } else {
            Err(reply
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("engine error")
                .to_string())
        }
    }

    /// Ask the engine to stop cleanly (watcher, swarm, stores), then kill the
    /// process. Idempotent: shutdown races on app exit are expected.
    pub fn shutdown(&self) {
        if self.inner.stopped.swap(true, Ordering::SeqCst) {
            return;
        }
        let _ = self.call_with_timeout("stop", json!([]), STOP_TIMEOUT);
        if let Ok(mut child) = self.inner.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    /// Events from the sidecar: { "event": "status", "status", "peers", "error" }
    /// or { "event": "update", "state" }. Runs on the reader thread — no RPC
    /// calls allowed inside.
    pub fn set_on_event(&self, callback: impl Fn(Value) + Send + Sync + 'static) {
        *self.inner.on_event.write().unwrap() = Some(Box::new(callback));
    }

    /// Called from the reader thread when the sidecar dies unexpectedly.
    pub fn set_on_exit(&self, callback: impl Fn() + Send + Sync + 'static) {
        *self.inner.on_exit.write().unwrap() = Some(Box::new(callback));
    }
}

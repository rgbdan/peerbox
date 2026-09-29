// Round-trips autostart enable/is_enabled/disable against a scratch HOME
// (no ~/.config, like bare CI). One test only: it mutates HOME.

use auto_launch::AutoLaunchBuilder;
use peerbox_lib::ensure_autostart_dir;

#[test]
fn autostart_roundtrip() {
    let scratch = std::env::temp_dir().join(format!("peerbox-autostart-{}", std::process::id()));
    std::fs::remove_dir_all(&scratch).ok();
    std::fs::create_dir_all(&scratch).unwrap();
    std::env::set_var("HOME", &scratch);

    // A home with no `.config` at all is what auto-launch's non-recursive
    // mkdir trips over, so start from exactly that.
    let autostart_dir = scratch.join(".config").join("autostart");
    assert!(!autostart_dir.exists(), "scratch home should start bare");
    ensure_autostart_dir().unwrap();
    assert!(autostart_dir.is_dir(), "ensure_autostart_dir() should create the path");

    let current_exe = std::env::current_exe().unwrap();
    let auto = AutoLaunchBuilder::new()
        .set_app_name("peerbox-autostart-test")
        .set_app_path(&current_exe.to_string_lossy())
        .build()
        .unwrap();

    assert!(!auto.is_enabled().unwrap(), "test should start disabled");
    auto.enable().unwrap();
    assert!(auto.is_enabled().unwrap(), "enable() should persist");
    auto.disable().unwrap();
    assert!(!auto.is_enabled().unwrap(), "disable() should clean up");

    std::fs::remove_dir_all(&scratch).ok();
}

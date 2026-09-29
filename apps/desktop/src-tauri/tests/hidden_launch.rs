// Pins start-hidden: the flag is recognised and auto-launch writes it into the
// entry. Scratch HOME; one test only, like autostart.rs.

use auto_launch::AutoLaunchBuilder;
use peerbox_lib::{launched_hidden, HIDDEN_FLAG};

fn args(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| s.to_string()).collect()
}

#[test]
fn hidden_flag_round_trips_through_the_autostart_entry() {
    assert!(!launched_hidden(args(&["/usr/bin/peerbox"])), "a bare launch is visible");
    assert!(launched_hidden(args(&["/usr/bin/peerbox", HIDDEN_FLAG])), "the flag is recognised");
    assert!(
        !launched_hidden(args(&["/usr/bin/peerbox", "--hidden-extra"])),
        "a flag that merely starts the same must not match"
    );

    let scratch = std::env::temp_dir().join(format!("peerbox-hidden-{}", std::process::id()));
    std::fs::remove_dir_all(&scratch).ok();
    std::fs::create_dir_all(scratch.join(".config").join("autostart")).unwrap();
    std::env::set_var("HOME", &scratch);

    let exe = std::env::current_exe().unwrap();
    let auto = AutoLaunchBuilder::new()
        .set_app_name("peerbox-hidden-test")
        .set_app_path(&exe.to_string_lossy())
        .set_args(&[HIDDEN_FLAG])
        .build()
        .unwrap();
    auto.enable().unwrap();

    let entry = scratch
        .join(".config")
        .join("autostart")
        .join("peerbox-hidden-test.desktop");
    let exec = std::fs::read_to_string(&entry)
        .unwrap()
        .lines()
        .find(|line| line.starts_with("Exec="))
        .expect("entry has an Exec line")
        .to_string();

    assert!(exec.contains(HIDDEN_FLAG), "autostart Exec must carry the flag, got: {exec}");
    // The launch the entry produces is exactly what the shell must read as hidden.
    let launched: Vec<String> = exec["Exec=".len()..].split(' ').map(str::to_string).collect();
    assert!(launched_hidden(launched), "the entry's own command line reads as hidden");

    auto.disable().unwrap();
    std::fs::remove_dir_all(&scratch).ok();
}

//! Run only against the installed isolated acceptance AUMID, never the formal app.
//! cargo run --features fault-injection --example windows_notifications -- inspect
//! THINGARY_REMINDER_TEST_SECONDS=20 ... -- reconcile
//! Exit this process after reconcile; inspect reads system delivery history, then clear.
#[cfg(all(windows, feature = "fault-injection"))]
fn main() {
    let action = std::env::args().nth(1).unwrap_or_else(|| "inspect".into());
    let json = if action == "reconcile" {
        r#"[{"id":"thingary-windows-acceptance","date":"2099-01-01","title":"物谱隔离验收提醒","body":"这是虚构资料的系统计划通知。"}]"#
    } else {
        "[]"
    };
    match thingary_lib::reminders::windows_notification_acceptance(&action, json) {
        Ok(result) => println!("{result}"),
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}
#[cfg(not(all(windows, feature = "fault-injection")))]
fn main() {
    eprintln!("Windows notification acceptance requires Windows and fault-injection.");
    std::process::exit(1);
}

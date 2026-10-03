use std::{
    io::{Cursor, Read},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    time::{Duration, Instant},
};
use thingary_lib::{
    domain::{Error, Save},
    files::Attach,
    storage::Store,
    worker::Worker,
};
fn seed(s: &mut Store) -> String {
    s.save(
        &Save {
            request_id: uuid::Uuid::new_v4().to_string(),
            generation: s.generation(),
            asset_id: None,
            expected_revision: None,
            name: "虚构相机".into(),
            price_cents: Some("100000".into()),
            purchase_date: None,
        },
        "2026-09-24",
    )
    .unwrap()
    .id
}
#[test]
fn archive_has_snapshot_and_originals() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let id = seed(&mut s);
    let mut b = Cursor::new(Vec::new());
    image::RgbImage::new(8, 8)
        .write_to(&mut b, image::ImageFormat::Png)
        .unwrap();
    let image = s
        .attach(
            &Attach {
                request_id: uuid::Uuid::new_v4().to_string(),
                generation: s.generation(),
                asset_id: id,
                expected_revision: 1,
            },
            b.get_ref(),
        )
        .unwrap();
    let target = root.path().join("backup.thingary");
    let now = Instant::now();
    s.backup(Some(&target)).unwrap();
    println!("nonempty backup elapsed {:?}", now.elapsed());
    let mut zip = zip::ZipArchive::new(std::fs::File::open(&target).unwrap()).unwrap();
    let mut actual = Vec::new();
    zip.by_name(&format!("files/{}", image.file))
        .unwrap()
        .read_to_end(&mut actual)
        .unwrap();
    assert_eq!(actual, *b.get_ref());
    assert!(zip.by_name("data.sqlite").is_ok());
    assert!(s.backup(Some(&target)).is_err());
    assert!(s.backup(None).unwrap().is_none());
}
#[cfg(feature = "fault-injection")]
#[test]
fn cancelled_and_failed_backup_never_publish() {
    for point in [
        "backup.before_snapshot",
        "backup.after_snapshot",
        "backup.before_publish",
    ] {
        let root = tempfile::tempdir().unwrap();
        let mut s = Store::open(root.path()).unwrap();
        seed(&mut s);
        s.set_hook(move |p| {
            if p == point {
                Err(Error::new("INJECTED", "模拟备份失败"))
            } else {
                Ok(())
            }
        });
        let target = root.path().join("backup.thingary");
        assert!(s.backup(None).unwrap().is_none());
        assert!(s.backup(Some(&target)).is_err());
        assert!(!target.exists());
        assert_eq!(s.count().unwrap(), 1);
    }
}
#[cfg(feature = "fault-injection")]
#[test]
fn backup_pauses_queued_writes() {
    let root = tempfile::tempdir().unwrap();
    let w = Worker::start(root.path().join("data")).unwrap();
    w.switch_demo(false).unwrap();
    w.call(|s| Ok(seed(s))).unwrap();
    let (entered_tx, entered_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let release = Arc::new(Mutex::new(release_rx));
    w.call(move |s| {
        s.set_hook(move |p| {
            if p == "backup.after_snapshot" {
                entered_tx.send(()).unwrap();
                release.lock().unwrap().recv().unwrap();
            }
            Ok(())
        });
        Ok(())
    })
    .unwrap();
    let dest = root.path().join("backup.thingary");
    let wb = w.clone();
    let first = std::thread::spawn(move || wb.call(move |s| s.backup(Some(&dest))));
    entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    let done = Arc::new(AtomicBool::new(false));
    let flag = done.clone();
    let ws = w.clone();
    let second = std::thread::spawn(move || {
        ws.call(|s| Ok(seed(s))).unwrap();
        flag.store(true, Ordering::SeqCst);
    });
    std::thread::sleep(Duration::from_millis(30));
    assert!(!done.load(Ordering::SeqCst));
    release_tx.send(()).unwrap();
    first.join().unwrap().unwrap();
    second.join().unwrap();
    assert_eq!(w.call(|s| s.count()).unwrap(), 2);
}

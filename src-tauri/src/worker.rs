use crate::{
    domain::{Error, Result},
    storage::Store,
};
use std::{
    path::PathBuf,
    sync::mpsc::{self, SyncSender},
    thread,
};
type Job = Box<dyn FnOnce(&mut Store) + Send>;
#[derive(Clone)]
pub struct Worker {
    sender: SyncSender<Job>,
}
impl Worker {
    pub fn start(root: PathBuf) -> Result<Self> {
        let (tx, rx) = mpsc::sync_channel::<Job>(32);
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        thread::Builder::new()
            .name("possio-storage".into())
            .spawn(move || match Store::open(&root) {
                Ok(mut store) => {
                    let _ = ready_tx.send(Ok(()));
                    while let Ok(job) = rx.recv() {
                        job(&mut store);
                    }
                }
                Err(e) => {
                    let _ = ready_tx.send(Err(e));
                }
            })?;
        ready_rx
            .recv()
            .map_err(|_| Error::new("WORKER", "存储未能启动"))??;
        Ok(Self { sender: tx })
    }
    pub fn call<T: Send + 'static>(
        &self,
        f: impl FnOnce(&mut Store) -> Result<T> + Send + 'static,
    ) -> Result<T> {
        let (tx, rx) = mpsc::sync_channel(1);
        self.sender
            .send(Box::new(move |s| {
                let _ = tx.send(f(s));
            }))
            .map_err(|_| Error::new("WORKER", "存储服务已停止"))?;
        rx.recv()
            .map_err(|_| Error::new("WORKER", "未收到存储结果，请重试"))?
    }
}

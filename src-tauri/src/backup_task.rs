use crate::domain::{Error, Result};
use std::{
    io::{Read, Write},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

/// Cooperative cancellation shared by a single backup operation. Clones never
/// refer to a later operation, so delayed cancellation cannot stop a new task.
#[derive(Clone, Default)]
pub struct Cancellation(Arc<AtomicBool>);

impl Cancellation {
    pub fn cancel(&self) {
        self.0.store(true, Ordering::Release);
    }

    pub fn check(&self) -> Result<()> {
        if self.0.load(Ordering::Acquire) {
            Err(Error::new("CANCELLED", "备份任务已取消"))
        } else {
            Ok(())
        }
    }

    pub(crate) fn copy(&self, reader: &mut impl Read, writer: &mut impl Write) -> Result<u64> {
        let mut buffer = [0u8; 64 * 1024];
        let mut total = 0u64;
        loop {
            self.check()?;
            let n = match reader.read(&mut buffer) {
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                result => result?,
            };
            self.check()?;
            if n == 0 {
                return Ok(total);
            }
            writer.write_all(&buffer[..n])?;
            total += n as u64;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn running_stream_cancels_between_chunks_and_old_handles_are_isolated() {
        struct StopWriter {
            flag: Cancellation,
            bytes: usize,
        }
        impl Write for StopWriter {
            fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
                self.bytes += bytes.len();
                self.flag.cancel();
                Ok(bytes.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let flag = Cancellation::default();
        let later = Cancellation::default();
        let mut writer = StopWriter {
            flag: flag.clone(),
            bytes: 0,
        };
        let mut source = std::io::repeat(7).take(1024 * 1024);
        assert_eq!(
            flag.copy(&mut source, &mut writer).unwrap_err().code,
            "CANCELLED"
        );
        assert_eq!(writer.bytes, 64 * 1024);
        assert!(later.check().is_ok());
    }
}

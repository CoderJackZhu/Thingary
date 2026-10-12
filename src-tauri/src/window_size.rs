//! Device-only window preference. Never stored in, or restored with, a library.
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, LogicalSize, Manager};

#[derive(Clone, Copy, Serialize, Deserialize)]
struct Dimensions {
    width: f64,
    height: f64,
}

fn fit(saved: Option<Dimensions>, available: Dimensions) -> Dimensions {
    let valid = saved.filter(|s| {
        s.width.is_finite() && s.height.is_finite() && s.width >= 800.0 && s.height >= 600.0
    });
    let desired = valid.unwrap_or(Dimensions {
        width: 1600.0,
        height: 1000.0,
    });
    Dimensions {
        width: desired.width.min(available.width).max(1.0),
        height: desired.height.min(available.height).max(1.0),
    }
}

pub fn restore(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let Ok(Some(monitor)) = window.current_monitor() else {
        return;
    };
    let area = monitor
        .work_area()
        .size
        .to_logical::<f64>(monitor.scale_factor());
    // Leave space for the title bar and an edge around the window.
    let available = Dimensions {
        width: (area.width - 24.0).max(1.0),
        height: (area.height - 56.0).max(1.0),
    };
    let saved = app
        .path()
        .app_config_dir()
        .ok()
        .and_then(|dir| std::fs::read(dir.join("window-size.json")).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok());
    let size = fit(saved, available);
    let _ = window.set_min_size(Some(LogicalSize::new(
        800.0_f64.min(available.width),
        600.0_f64.min(available.height),
    )));
    let _ = window.set_size(LogicalSize::new(size.width, size.height));
    let _ = window.center();
}

pub fn save(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if window.is_fullscreen().unwrap_or(true)
        || window.is_maximized().unwrap_or(true)
        || window.is_minimized().unwrap_or(true)
    {
        return;
    }
    let (Ok(size), Ok(scale), Ok(dir)) = (
        window.inner_size(),
        window.scale_factor(),
        app.path().app_config_dir(),
    ) else {
        return;
    };
    let size = size.to_logical::<f64>(scale);
    let value = Dimensions {
        width: size.width,
        height: size.height,
    };
    if let Ok(bytes) = serde_json::to_vec(&value) {
        if std::fs::create_dir_all(&dir).is_ok() {
            let staging = dir.join("window-size.json.tmp");
            if std::fs::write(&staging, bytes).is_ok() {
                let _ = std::fs::rename(staging, dir.join("window-size.json"));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fits_small_displays_and_remembers_normal_sizes() {
        let small = Dimensions {
            width: 1200.0,
            height: 740.0,
        };
        let first = fit(None, small);
        assert_eq!((first.width, first.height), (1200.0, 740.0));
        let huge = fit(
            Some(Dimensions {
                width: 2200.0,
                height: 1400.0,
            }),
            small,
        );
        assert_eq!((huge.width, huge.height), (1200.0, 740.0));
        let saved = fit(
            Some(Dimensions {
                width: 1000.0,
                height: 700.0,
            }),
            small,
        );
        assert_eq!((saved.width, saved.height), (1000.0, 700.0));
        let corrupt = fit(
            Some(Dimensions {
                width: f64::NAN,
                height: 0.0,
            }),
            small,
        );
        assert_eq!((corrupt.width, corrupt.height), (1200.0, 740.0));
    }
}

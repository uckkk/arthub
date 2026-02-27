//! 截图与录屏：复用 FFmpeg，Windows 下 gdigrab + libx264 CRF

use crate::asset_manager;
use serde::Deserialize;
use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[derive(Debug, Clone, Deserialize)]
pub struct RecordRegion {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

pub struct ScreenCaptureState {
    pub record_process: Mutex<Option<Child>>,
}

impl ScreenCaptureState {
    pub fn new() -> Self {
        Self {
            record_process: Mutex::new(None),
        }
    }
}

fn get_ffmpeg_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let app_data = app.path_resolver().app_data_dir().ok_or("无法获取应用数据目录")?;
    asset_manager::ffmpeg::get_ffmpeg_path(&app_data).ok_or("未找到 FFmpeg，请在设置中安装或指定路径".to_string())
}

/// 开始录屏（仅 Windows，gdigrab + libx264 CRF）
#[tauri::command]
pub fn screen_record_start(
    app: AppHandle,
    output_path: String,
    region: Option<RecordRegion>,
    crf: Option<u32>,
) -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    return Err("录屏当前仅支持 Windows".to_string());

    #[cfg(target_os = "windows")]
    {
        let state = app.state::<ScreenCaptureState>();
        let mut guard = state.record_process.lock().map_err(|e: std::sync::PoisonError<_>| e.to_string())?;
        if guard.is_some() {
            return Err("已有录屏在进行中，请先停止".to_string());
        }

        let ffmpeg = get_ffmpeg_path(&app)?;
        let crf = crf.unwrap_or(22).min(51);
        let mut args: Vec<String> = vec![
            "-y".into(),
            "-f".into(), "gdigrab".into(),
            "-framerate".into(), "30".into(),
            "-draw_mouse".into(), "1".into(),
        ];
        if let Some(r) = &region {
            args.push("-offset_x".into());
            args.push(r.x.to_string());
            args.push("-offset_y".into());
            args.push(r.y.to_string());
            args.push("-video_size".into());
            args.push(format!("{}x{}", r.width, r.height));
        }
        let crf_s = crf.to_string();
        args.extend_from_slice(&["-i".into(), "desktop".into(), "-c:v".into(), "libx264".into(), "-crf".into(), crf_s, "-preset".into(), "fast".into(), output_path.clone()]);

        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let child = Command::new(&ffmpeg)
            .args(&args)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("启动录屏失败: {}", e))?;
        *guard = Some(child);
        Ok(())
    }
}

/// 停止录屏
#[tauri::command]
pub fn screen_record_stop(state: State<ScreenCaptureState>) -> Result<(), String> {
    let mut guard = state.record_process.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        Ok(())
    } else {
        Err("当前没有在进行的录屏".to_string())
    }
}

/// 是否正在录屏
#[tauri::command]
pub fn screen_record_is_recording(state: State<ScreenCaptureState>) -> bool {
    if let Ok(mut guard) = state.record_process.lock() {
        if let Some(ref mut child) = *guard {
            return child.try_wait().map(|s| s.is_none()).unwrap_or(true);
        }
    }
    false
}

/// 截图（仅 Windows，gdigrab 单帧）
#[tauri::command]
pub fn screen_screenshot(app: AppHandle, output_path: String, region: Option<RecordRegion>) -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    return Err("截图当前仅支持 Windows".to_string());

    #[cfg(target_os = "windows")]
    {
        let ffmpeg = get_ffmpeg_path(&app)?;
        let mut args = vec![
            "-y".into(),
            "-f".into(), "gdigrab".into(),
            "-framerate".into(), "1".into(),
            "-draw_mouse".into(), "1".into(),
        ];
        if let Some(r) = &region {
            args.push("-offset_x".into());
            args.push(r.x.to_string());
            args.push("-offset_y".into());
            args.push(r.y.to_string());
            args.push("-video_size".into());
            args.push(format!("{}x{}", r.width, r.height));
        }
        args.extend_from_slice(&["-i".into(), "desktop".into(), "-vframes".into(), "1".into(), output_path.clone()]);

        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let out = Command::new(&ffmpeg)
            .args(&args)
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("截图失败: {}", e))?;
        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr);
            return Err(format!("FFmpeg 截图错误: {}", stderr));
        }
        Ok(())
    }
}

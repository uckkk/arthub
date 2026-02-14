use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FfmpegStatus {
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadProgress {
    pub phase: String,       // "downloading", "extracting", "complete", "error"
    pub progress: f64,       // 0.0 - 1.0
    pub message: String,
}

/// Check if ffmpeg is available on the system
pub fn check_ffmpeg() -> FfmpegStatus {
    // First check in PATH
    if let Ok(output) = Command::new("ffmpeg").arg("-version").output() {
        if output.status.success() {
            let version_str = String::from_utf8_lossy(&output.stdout);
            let version = version_str.lines().next().unwrap_or("").to_string();
            return FfmpegStatus {
                installed: true,
                path: Some("ffmpeg".into()),
                version: Some(version),
            };
        }
    }

    // Check common locations on Windows
    #[cfg(target_os = "windows")]
    {
        let common_paths = [
            r"C:\ffmpeg\bin\ffmpeg.exe",
            r"C:\Program Files\ffmpeg\bin\ffmpeg.exe",
            r"C:\Program Files (x86)\ffmpeg\bin\ffmpeg.exe",
        ];

        for p in &common_paths {
            if Path::new(p).exists() {
                if let Ok(output) = Command::new(p).arg("-version").output() {
                    if output.status.success() {
                        let version_str = String::from_utf8_lossy(&output.stdout);
                        let version = version_str.lines().next().unwrap_or("").to_string();
                        return FfmpegStatus {
                            installed: true,
                            path: Some(p.to_string()),
                            version: Some(version),
                        };
                    }
                }
            }
        }
    }

    FfmpegStatus { installed: false, path: None, version: None }
}

/// Get the ffmpeg binary path (from app data dir for local install)
pub fn get_ffmpeg_path(app_data_dir: &Path) -> Option<PathBuf> {
    let local_path = app_data_dir.join("ffmpeg").join("ffmpeg.exe");
    if local_path.exists() {
        return Some(local_path);
    }

    // Check system PATH
    if Command::new("ffmpeg").arg("-version").output().map(|o| o.status.success()).unwrap_or(false) {
        return Some(PathBuf::from("ffmpeg"));
    }

    None
}

/// Download and install ffmpeg to app data dir (Windows)
/// Returns the path to the installed ffmpeg binary
#[cfg(target_os = "windows")]
pub async fn download_ffmpeg(
    app_data_dir: &Path,
    progress_sender: tokio::sync::mpsc::Sender<DownloadProgress>,
) -> Result<String, String> {
    use std::io::Write;

    let ffmpeg_dir = app_data_dir.join("ffmpeg");
    fs::create_dir_all(&ffmpeg_dir).map_err(|e| e.to_string())?;

    let target_path = ffmpeg_dir.join("ffmpeg.exe");

    // If already exists, just return
    if target_path.exists() {
        let _ = progress_sender.send(DownloadProgress {
            phase: "complete".into(), progress: 1.0,
            message: "FFmpeg 已存在".into(),
        }).await;
        return Ok(target_path.to_string_lossy().to_string());
    }

    // Download ffmpeg essentials build (smaller)
    let url = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";

    let _ = progress_sender.send(DownloadProgress {
        phase: "downloading".into(), progress: 0.0,
        message: "开始下载 FFmpeg...".into(),
    }).await;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client.get(url).send().await.map_err(|e| format!("下载失败: {}", e))?;
    let total_size = response.content_length().unwrap_or(0);

    let zip_path = ffmpeg_dir.join("ffmpeg_download.zip");
    let mut file = fs::File::create(&zip_path).map_err(|e| e.to_string())?;
    let mut downloaded: u64 = 0;

    let mut stream = response.bytes_stream();
    use futures_util::StreamExt;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("下载中断: {}", e))?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;

        if total_size > 0 {
            let progress = downloaded as f64 / total_size as f64;
            let _ = progress_sender.send(DownloadProgress {
                phase: "downloading".into(),
                progress,
                message: format!("下载中 {:.1}MB / {:.1}MB", downloaded as f64 / 1048576.0, total_size as f64 / 1048576.0),
            }).await;
        }
    }
    drop(file);

    // Extract ffmpeg.exe from the zip
    let _ = progress_sender.send(DownloadProgress {
        phase: "extracting".into(), progress: 0.8,
        message: "正在解压...".into(),
    }).await;

    let zip_file = fs::File::open(&zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(zip_file).map_err(|e| format!("解压失败: {}", e))?;

    let mut found = false;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();

        // Look for ffmpeg.exe in the archive
        if name.ends_with("ffmpeg.exe") && !name.contains("__MACOSX") {
            let mut out = fs::File::create(&target_path).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
            found = true;
        }
        // Also extract ffprobe.exe if found
        if name.ends_with("ffprobe.exe") && !name.contains("__MACOSX") {
            let probe_path = ffmpeg_dir.join("ffprobe.exe");
            let mut out = fs::File::create(&probe_path).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
        }
    }

    // Clean up zip
    fs::remove_file(&zip_path).ok();

    if !found {
        return Err("ZIP 中未找到 ffmpeg.exe".into());
    }

    let _ = progress_sender.send(DownloadProgress {
        phase: "complete".into(), progress: 1.0,
        message: "FFmpeg 安装完成".into(),
    }).await;

    Ok(target_path.to_string_lossy().to_string())
}

#[cfg(not(target_os = "windows"))]
pub async fn download_ffmpeg(
    _app_data_dir: &Path,
    progress_sender: tokio::sync::mpsc::Sender<DownloadProgress>,
) -> Result<String, String> {
    let _ = progress_sender.send(DownloadProgress {
        phase: "error".into(), progress: 0.0,
        message: "请使用系统包管理器安装 ffmpeg (apt/brew)".into(),
    }).await;
    Err("Non-Windows: use system package manager".into())
}

/// Extract a video thumbnail using ffmpeg
pub fn extract_video_thumbnail(
    ffmpeg_path: &Path,
    video_path: &Path,
    output_path: &Path,
    width: u32,
) -> Result<(), String> {
    let output = Command::new(ffmpeg_path)
        .args(&[
            "-y",
            "-i", &video_path.to_string_lossy(),
            "-vframes", "1",
            "-ss", "00:00:01",
            "-vf", &format!("scale={}:-1", width),
            "-q:v", "3",
            &output_path.to_string_lossy(),
        ])
        .output()
        .map_err(|e| format!("ffmpeg 执行失败: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg 错误: {}", stderr));
    }

    Ok(())
}

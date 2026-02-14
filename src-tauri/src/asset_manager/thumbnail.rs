use image::{GenericImageView, ImageFormat, RgbaImage};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::fs;

/// 可生成缩略图的图片格式（image crate 能解码的）
const DECODABLE_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "bmp", "webp", "tiff", "tif", "ico", "tga", "hdr", "exr",
];

/// PSD 格式
const PSD_EXTENSIONS: &[&str] = &["psd"];

/// 视频格式（需要 FFmpeg）
const VIDEO_EXTENSIONS: &[&str] = &[
    "mp4", "avi", "mov", "mkv", "wmv", "flv", "webm", "m4v", "mpg", "mpeg",
];

/// 音频格式
const AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "wav", "ogg", "flac", "aac", "wma", "m4a", "opus",
];

/// 3D 模型格式
const MODEL_3D_EXTENSIONS: &[&str] = &[
    "fbx", "obj", "gltf", "glb", "blend", "3ds", "dae", "stl",
];

/// Spine 动画格式
const SPINE_EXTENSIONS: &[&str] = &["spine", "skel", "atlas"];

/// 生成稳定的路径哈希作为缩略图文件名
fn path_hash(path: &str) -> String {
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

/// 缩略图生成结果
pub struct ThumbResult {
    pub thumb_path: String,
    pub width: u32,
    pub height: u32,
}

/// 检查是否可以为该扩展名生成缩略图
pub fn can_generate_thumbnail(ext: &str) -> bool {
    let e = ext.to_lowercase();
    let e = e.as_str();
    DECODABLE_EXTENSIONS.contains(&e) || PSD_EXTENSIONS.contains(&e)
}

/// 检查文件类型分类
pub fn get_file_category(ext: &str) -> &'static str {
    let e = ext.to_lowercase();
    let e = e.as_str();
    if DECODABLE_EXTENSIONS.contains(&e) || PSD_EXTENSIONS.contains(&e) { "image" }
    else if VIDEO_EXTENSIONS.contains(&e) { "video" }
    else if AUDIO_EXTENSIONS.contains(&e) { "audio" }
    else if MODEL_3D_EXTENSIONS.contains(&e) { "3d" }
    else if SPINE_EXTENSIONS.contains(&e) { "spine" }
    else { "other" }
}

/// 检查是否是视频格式（需要FFmpeg生成缩略图）
pub fn is_video(ext: &str) -> bool {
    VIDEO_EXTENSIONS.contains(&ext.to_lowercase().as_str())
}

/// 检查是否是音频格式
pub fn is_audio(ext: &str) -> bool {
    AUDIO_EXTENSIONS.contains(&ext.to_lowercase().as_str())
}

/// 检查是否是3D模型格式
pub fn is_3d_model(ext: &str) -> bool {
    MODEL_3D_EXTENSIONS.contains(&ext.to_lowercase().as_str())
}

/// 为指定图片生成缩略图
/// - small: 宽度 300px，保持比例，JPEG quality 85
/// 返回缩略图路径和原始图片尺寸
pub fn generate_thumbnail(
    input_path: &str,
    thumb_dir: &Path,
    max_width: u32,
) -> Result<ThumbResult, String> {
    let hash = path_hash(input_path);
    let thumb_filename = format!("{}.jpg", hash);
    let thumb_path = thumb_dir.join(&thumb_filename);

    // 如果缩略图已存在且源文件没变，直接返回
    if thumb_path.exists() {
        // 快速检查：获取原图尺寸（从已有缩略图推断不可靠，还是重新读取）
        // 但为了速度，如果缩略图存在就直接用
        // 原图尺寸通过 get_image_dimensions 单独获取
        match get_image_dimensions(input_path) {
            Some((w, h)) => {
                return Ok(ThumbResult {
                    thumb_path: thumb_path.to_string_lossy().to_string(),
                    width: w,
                    height: h,
                });
            }
            None => {
                // 无法读取尺寸，删除旧缩略图重新生成
                let _ = fs::remove_file(&thumb_path);
            }
        }
    }

    // 根据文件扩展名选择解码方式
    let ext = std::path::Path::new(input_path)
        .extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();

    let img = if PSD_EXTENSIONS.contains(&ext.as_str()) {
        generate_psd_image(input_path)?
    } else {
        image::open(input_path)
            .map_err(|e| format!("无法打开图片 {}: {}", input_path, e))?
    };

    let (orig_w, orig_h) = img.dimensions();

    // 如果原图已经很小，直接复制
    if orig_w <= max_width {
        // 保存为 JPEG（即使原图很小，统一格式方便前端处理）
        img.save_with_format(&thumb_path, ImageFormat::Jpeg)
            .map_err(|e| format!("保存缩略图失败: {}", e))?;
    } else {
        // 按比例缩放
        let ratio = max_width as f64 / orig_w as f64;
        let new_h = (orig_h as f64 * ratio) as u32;
        let thumb = img.resize_exact(max_width, new_h.max(1), image::imageops::FilterType::Lanczos3);
        thumb.save_with_format(&thumb_path, ImageFormat::Jpeg)
            .map_err(|e| format!("保存缩略图失败: {}", e))?;
    }

    Ok(ThumbResult {
        thumb_path: thumb_path.to_string_lossy().to_string(),
        width: orig_w,
        height: orig_h,
    })
}

/// 仅读取图片尺寸（不完全解码，更快）
pub fn get_image_dimensions(path: &str) -> Option<(u32, u32)> {
    image::image_dimensions(path).ok()
}

/// 清理文件夹对应的所有缩略图
pub fn cleanup_thumbnails(thumb_dir: &Path, file_paths: &[String]) {
    for path in file_paths {
        let hash = path_hash(path);
        let thumb_file = thumb_dir.join(format!("{}.jpg", hash));
        let _ = fs::remove_file(thumb_file);
    }
}

/// 获取缩略图路径（不生成）
pub fn get_thumb_path(thumb_dir: &Path, file_path: &str) -> PathBuf {
    let hash = path_hash(file_path);
    thumb_dir.join(format!("{}.jpg", hash))
}

/// 从PSD文件生成合成图像
fn generate_psd_image(input_path: &str) -> Result<image::DynamicImage, String> {
    let psd_bytes = fs::read(input_path)
        .map_err(|e| format!("读取PSD文件失败: {}", e))?;
    let psd = psd::Psd::from_bytes(&psd_bytes)
        .map_err(|e| format!("解析PSD文件失败: {:?}", e))?;

    let width = psd.width();
    let height = psd.height();
    let rgba_data = psd.rgba();

    let img_buf = RgbaImage::from_raw(width, height, rgba_data)
        .ok_or_else(|| "PSD RGBA数据长度不匹配".to_string())?;

    Ok(image::DynamicImage::ImageRgba8(img_buf))
}

/// 获取PSD文件尺寸（不完全解码）
pub fn get_psd_dimensions(input_path: &str) -> Option<(u32, u32)> {
    let bytes = fs::read(input_path).ok()?;
    let psd = psd::Psd::from_bytes(&bytes).ok()?;
    Some((psd.width(), psd.height()))
}

/// 为视频文件生成缩略图（需要FFmpeg路径）
pub fn generate_video_thumbnail(
    ffmpeg_path: &Path,
    video_path: &str,
    thumb_dir: &Path,
    max_width: u32,
) -> Result<ThumbResult, String> {
    let hash = path_hash(video_path);
    let thumb_filename = format!("{}.jpg", hash);
    let thumb_path = thumb_dir.join(&thumb_filename);

    if thumb_path.exists() {
        // 视频缩略图已存在，直接返回（无法快速获取视频尺寸）
        return Ok(ThumbResult {
            thumb_path: thumb_path.to_string_lossy().to_string(),
            width: 0,
            height: 0,
        });
    }

    // 用 FFmpeg 提取第1秒的帧
    let status = std::process::Command::new(ffmpeg_path)
        .args(&[
            "-y", "-i", video_path,
            "-ss", "1",
            "-vframes", "1",
            "-vf", &format!("scale={}:-1", max_width),
            &thumb_path.to_string_lossy(),
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map_err(|e| format!("执行FFmpeg失败: {}", e))?;

    if !status.success() {
        return Err("FFmpeg缩略图生成失败".to_string());
    }

    Ok(ThumbResult {
        thumb_path: thumb_path.to_string_lossy().to_string(),
        width: 0,
        height: 0,
    })
}

/// 通过 ffprobe 获取视频/音频尺寸和时长
pub fn get_media_info(ffprobe_path: &Path, media_path: &str) -> Option<(u32, u32, f64)> {
    let output = std::process::Command::new(ffprobe_path)
        .args(&[
            "-v", "quiet",
            "-print_format", "json",
            "-show_streams",
            "-show_format",
            media_path,
        ])
        .output()
        .ok()?;

    let json_str = String::from_utf8_lossy(&output.stdout);
    let parsed: serde_json::Value = serde_json::from_str(&json_str).ok()?;

    let mut width = 0u32;
    let mut height = 0u32;
    let mut duration = 0.0f64;

    // 从 streams 中提取视频尺寸
    if let Some(streams) = parsed["streams"].as_array() {
        for stream in streams {
            if stream["codec_type"].as_str() == Some("video") {
                width = stream["width"].as_u64().unwrap_or(0) as u32;
                height = stream["height"].as_u64().unwrap_or(0) as u32;
            }
        }
    }

    // 从 format 中提取时长
    if let Some(dur_str) = parsed["format"]["duration"].as_str() {
        duration = dur_str.parse().unwrap_or(0.0);
    }

    Some((width, height, duration))
}

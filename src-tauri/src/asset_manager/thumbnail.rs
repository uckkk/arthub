use image::{GenericImageView, ImageFormat};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::fs;

/// 可生成缩略图的图片格式（image crate 能解码的）
const DECODABLE_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "bmp", "webp", "tiff", "tif", "ico", "tga", "hdr", "exr",
];

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
    DECODABLE_EXTENSIONS.contains(&ext)
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

    // 打开并解码图片
    let img = image::open(input_path)
        .map_err(|e| format!("无法打开图片 {}: {}", input_path, e))?;

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

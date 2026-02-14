use std::path::Path;
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;

/// 支持的图片格式
pub const IMAGE_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "bmp", "webp", "tiff", "tif",
    "ico", "tga", "dds", "hdr", "exr", "svg",
];

/// 支持的视频格式（Phase 4）
pub const VIDEO_EXTENSIONS: &[&str] = &[
    "mp4", "mov", "avi", "mkv", "wmv", "webm", "flv",
];

/// 支持的专业格式（Phase 5）
pub const PRO_EXTENSIONS: &[&str] = &[
    "psd", "psb", "ai", "eps",        // Adobe
    "spine", "skel",                    // Spine
    "fbx", "obj", "gltf", "glb",      // 3D
];

/// 所有可管理的格式
pub fn all_supported_extensions() -> Vec<&'static str> {
    let mut exts = Vec::new();
    exts.extend_from_slice(IMAGE_EXTENSIONS);
    exts.extend_from_slice(VIDEO_EXTENSIONS);
    exts.extend_from_slice(PRO_EXTENSIONS);
    exts
}

/// 扫描结果
#[derive(Debug, Clone)]
pub struct ScannedFile {
    pub path: String,
    pub name: String,
    pub ext: String,
    pub size: u64,
    pub modified: u64,
}

/// 递归扫描目录，收集所有支持格式的文件
/// 支持本地路径和 UNC 路径 (\\\\server\\share)
pub fn scan_directory(dir_path: &str) -> Result<Vec<ScannedFile>, String> {
    let path = Path::new(dir_path);
    if !path.exists() {
        return Err(format!("目录不存在: {}", dir_path));
    }
    if !path.is_dir() {
        return Err(format!("不是目录: {}", dir_path));
    }

    let supported = all_supported_extensions();
    let mut files = Vec::new();

    for entry in WalkDir::new(path)
        .follow_links(true)
        .into_iter()
        .filter_entry(|e| {
            // 跳过隐藏目录和 .arthub 元数据目录
            let name = e.file_name().to_string_lossy();
            !name.starts_with('.') && name != "node_modules" && name != "__pycache__"
        })
    {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue, // 跳过无法访问的条目
        };

        if !entry.file_type().is_file() {
            continue;
        }

        let file_path = entry.path();
        let ext = match file_path.extension() {
            Some(e) => e.to_string_lossy().to_lowercase(),
            None => continue,
        };

        if !supported.contains(&ext.as_str()) {
            continue;
        }

        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };

        let modified = metadata.modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);

        let name = file_path.file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();

        files.push(ScannedFile {
            path: file_path.to_string_lossy().to_string(),
            name,
            ext,
            size: metadata.len(),
            modified,
        });
    }

    // 按文件名排序
    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    Ok(files)
}

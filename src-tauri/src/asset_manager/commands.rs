use tauri::{AppHandle, Manager};
use image::GenericImageView;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use crate::asset_manager::db::{self, AssetManagerState, AssetQueryParams, AssetQueryResult, FolderInfo, FolderStats, ScanProgress, TagInfo, AssetDetail, SmartFolder, AssetVersion};
use crate::asset_manager::scanner;
use crate::asset_manager::thumbnail;
use crate::asset_manager::team;
use crate::asset_manager::ffmpeg;
use crate::asset_manager::ai::{self, AiState};
use crate::asset_manager::share::{self, ShareState};

// ---- 初始化 ----

/// 获取所有文件夹
#[tauri::command]
pub fn asset_get_folders(
    state: tauri::State<'_, AssetManagerState>,
    space_type: Option<String>,
) -> Result<Vec<FolderInfo>, String> {
    let conn = state.db.lock().map_err(|e| format!("锁定数据库失败: {}", e))?;
    db::get_folders(&conn, space_type.as_deref())
}

/// 添加文件夹
#[tauri::command]
pub fn asset_add_folder(
    state: tauri::State<'_, AssetManagerState>,
    path: String,
    space_type: String,
) -> Result<FolderInfo, String> {
    // 提取文件夹名
    let name = std::path::Path::new(&path)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    let conn = state.db.lock().map_err(|e| format!("锁定数据库失败: {}", e))?;
    db::insert_folder(&conn, &path, &name, &space_type)
}

/// 移除文件夹
#[tauri::command]
pub fn asset_remove_folder(
    state: tauri::State<'_, AssetManagerState>,
    folder_id: i64,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| format!("锁定数据库失败: {}", e))?;

    // 获取文件夹下所有资产路径，用于清理缩略图
    let mut stmt = conn.prepare("SELECT file_path FROM assets WHERE folder_id = ?1")
        .map_err(|e| format!("查询失败: {}", e))?;
    let paths: Vec<String> = stmt.query_map(rusqlite::params![folder_id], |row| row.get(0))
        .map_err(|e| format!("查询失败: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    // 清理缩略图
    {
        let td = state.thumb_dir.lock().map_err(|e| e.to_string())?;
        thumbnail::cleanup_thumbnails(&td, &paths);
    }

    // 删除数据库记录
    db::remove_folder(&conn, folder_id)
}

/// 扫描文件夹（异步，发送进度事件）
#[tauri::command]
pub async fn asset_scan_folder(
    app: AppHandle,
    state: tauri::State<'_, AssetManagerState>,
    folder_id: i64,
) -> Result<u32, String> {
    // 1. 获取文件夹路径
    let (folder_path, thumb_dir) = {
        let conn = state.db.lock().map_err(|e| format!("锁定数据库失败: {}", e))?;
        let path: String = conn.query_row(
            "SELECT path FROM folders WHERE id = ?1",
            rusqlite::params![folder_id],
            |row| row.get(0),
        ).map_err(|e| format!("查询文件夹失败: {}", e))?;

        // 清空旧记录
        db::clear_folder_assets(&conn, folder_id)?;

        (path, state.thumb_dir.lock().map_err(|e| e.to_string())?.clone())
    };

    // 2. 扫描文件系统（在阻塞线程中执行）
    let app_clone = app.clone();
    let fid = folder_id;

    let files = tokio::task::spawn_blocking(move || {
        scanner::scan_directory(&folder_path)
    }).await.map_err(|e| format!("扫描线程失败: {}", e))??;

    let total = files.len() as u32;

    // 发送扫描开始事件
    let _ = app.emit_all("asset-scan-progress", ScanProgress {
        folder_id: fid,
        current: 0,
        total,
        file_name: String::new(),
        phase: "scanning".to_string(),
    });

    // 3. 逐个处理文件：生成缩略图 + 写入数据库
    let mut processed = 0u32;
    let batch_size = 20;
    let mut batch = Vec::with_capacity(batch_size);

    for file in &files {
        // 尝试生成缩略图
        let (thumb_path, width, height) = if thumbnail::can_generate_thumbnail(&file.ext) {
            match thumbnail::generate_thumbnail(&file.path, &thumb_dir, 300) {
                Ok(result) => (result.thumb_path, result.width, result.height),
                Err(e) => {
                    eprintln!("[AssetManager] 缩略图生成失败: {} -> {}", file.path, e);
                    (String::new(), 0, 0)
                }
            }
        } else {
            // 非图片格式（如视频、SVG 等）或暂不支持，不生成缩略图
            (String::new(), 0, 0)
        };

        batch.push((file, thumb_path, width, height));

        if batch.len() >= batch_size {
            // 批量写入数据库
            {
                let conn = state.db.lock().map_err(|e| format!("锁定数据库失败: {}", e))?;
                for (f, tp, w, h) in &batch {
                    let _ = db::upsert_asset(
                        &conn, fid, &f.path, &f.name, &f.ext,
                        f.size as i64, *w, *h, tp, f.modified as i64,
                    );
                }
            }
            processed += batch.len() as u32;
            batch.clear();

            // 发送进度
            let _ = app.emit_all("asset-scan-progress", ScanProgress {
                folder_id: fid,
                current: processed,
                total,
                file_name: file.name.clone(),
                phase: "thumbnails".to_string(),
            });
        }
    }

    // 处理剩余批次
    if !batch.is_empty() {
        let conn = state.db.lock().map_err(|e| format!("锁定数据库失败: {}", e))?;
        for (f, tp, w, h) in &batch {
            let _ = db::upsert_asset(
                &conn, fid, &f.path, &f.name, &f.ext,
                f.size as i64, *w, *h, tp, f.modified as i64,
            );
        }
        processed += batch.len() as u32;
    }

    // Auto-tag: create tags from parent folder names and assign to assets
    {
        let conn = state.db.lock().map_err(|e| format!("锁定数据库失败: {}", e))?;
        let folder_path_str: String = conn.query_row(
            "SELECT path FROM folders WHERE id = ?1", rusqlite::params![fid], |row| row.get(0),
        ).unwrap_or_default();

        // Get all assets in this folder
        let mut stmt = conn.prepare(
            "SELECT id, file_path FROM assets WHERE folder_id = ?1"
        ).unwrap();
        let asset_paths: Vec<(i64, String)> = stmt.query_map(rusqlite::params![fid], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        }).unwrap().filter_map(|r| r.ok()).collect();

        let base = std::path::Path::new(&folder_path_str);
        let mut tag_cache: std::collections::HashMap<String, i64> = std::collections::HashMap::new();

        for (asset_id, asset_path) in &asset_paths {
            let ap = std::path::Path::new(asset_path);
            if let Ok(rel) = ap.strip_prefix(base) {
                // Get parent folder name(s) relative to the scanned root
                if let Some(parent) = rel.parent() {
                    for component in parent.components() {
                        let folder_name = component.as_os_str().to_string_lossy().to_string();
                        if folder_name.is_empty() || folder_name == "." { continue; }
                        let tag_id = if let Some(&id) = tag_cache.get(&folder_name) {
                            id
                        } else {
                            let id = match db::create_tag(&conn, &folder_name, "#6b7280") {
                                Ok(tag_info) => tag_info.id,
                                Err(_) => {
                                    conn.query_row(
                                        "SELECT id FROM tags WHERE name = ?1 COLLATE NOCASE",
                                        rusqlite::params![folder_name], |row| row.get::<_, i64>(0),
                                    ).unwrap_or(0)
                                }
                            };
                            if id > 0 { tag_cache.insert(folder_name.clone(), id); }
                            id
                        };
                        if tag_id > 0 {
                            let _ = db::add_tag_to_asset(&conn, *asset_id, tag_id, "auto");
                        }
                    }
                }
            }
        }
    }

    // 发送完成事件
    let _ = app.emit_all("asset-scan-progress", ScanProgress {
        folder_id: fid,
        current: processed,
        total,
        file_name: String::new(),
        phase: "complete".to_string(),
    });

    Ok(processed)
}

/// 查询资产（分页 + 筛选）
#[tauri::command]
pub fn asset_query(
    state: tauri::State<'_, AssetManagerState>,
    params: AssetQueryParams,
) -> Result<AssetQueryResult, String> {
    let conn = state.db.lock().map_err(|e| format!("锁定数据库失败: {}", e))?;
    db::query_assets(&conn, &params)
}

/// 获取统计信息
#[tauri::command]
pub fn asset_get_stats(
    state: tauri::State<'_, AssetManagerState>,
) -> Result<FolderStats, String> {
    let conn = state.db.lock().map_err(|e| format!("锁定数据库失败: {}", e))?;
    db::get_stats(&conn)
}

// ============================================================
// Phase 2: Tags, Ratings, Notes, Smart Folders
// ============================================================

/// 获取所有标签
#[tauri::command]
pub fn asset_get_tags(
    state: tauri::State<'_, AssetManagerState>,
) -> Result<Vec<TagInfo>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::get_all_tags(&conn)
}

/// 创建标签
#[tauri::command]
pub fn asset_create_tag(
    state: tauri::State<'_, AssetManagerState>,
    name: String,
    color: String,
) -> Result<TagInfo, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::create_tag(&conn, &name, &color)
}

/// 更新标签
#[tauri::command]
pub fn asset_update_tag(
    state: tauri::State<'_, AssetManagerState>,
    tag_id: i64,
    name: String,
    color: String,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::update_tag(&conn, tag_id, &name, &color)
}

/// 删除标签
#[tauri::command]
pub fn asset_delete_tag(
    state: tauri::State<'_, AssetManagerState>,
    tag_id: i64,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::delete_tag(&conn, tag_id)
}

/// 给资产添加标签
#[tauri::command]
pub fn asset_add_tag(
    state: tauri::State<'_, AssetManagerState>,
    asset_id: i64,
    tag_id: i64,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::add_tag_to_asset(&conn, asset_id, tag_id, "")
}

/// 从资产移除标签
#[tauri::command]
pub fn asset_remove_tag(
    state: tauri::State<'_, AssetManagerState>,
    asset_id: i64,
    tag_id: i64,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::remove_tag_from_asset(&conn, asset_id, tag_id)
}

/// 批量添加标签
#[tauri::command]
pub fn asset_batch_add_tag(
    state: tauri::State<'_, AssetManagerState>,
    asset_ids: Vec<i64>,
    tag_id: i64,
) -> Result<u32, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::batch_add_tag(&conn, &asset_ids, tag_id, "")
}

/// 设置评分
#[tauri::command]
pub fn asset_set_rating(
    state: tauri::State<'_, AssetManagerState>,
    asset_id: i64,
    rating: i32,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::set_rating(&conn, asset_id, rating, "")
}

/// 设置备注
#[tauri::command]
pub fn asset_set_note(
    state: tauri::State<'_, AssetManagerState>,
    asset_id: i64,
    note: String,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::set_note(&conn, asset_id, &note, "")
}

/// 设置资产自定义路径
#[tauri::command]
pub fn asset_set_custom_paths(
    state: tauri::State<'_, AssetManagerState>,
    asset_id: i64,
    source_path: String,
    slice_path: String,
    effect_path: String,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::set_custom_paths(&conn, asset_id, &source_path, &slice_path, &effect_path)
}

/// 获取资产详情（含标签+评分+备注+自定义路径）
#[tauri::command]
pub fn asset_get_detail(
    state: tauri::State<'_, AssetManagerState>,
    asset_id: i64,
) -> Result<AssetDetail, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::get_asset_detail(&conn, asset_id)
}

/// 批量获取资产详情（减少 N+1 IPC 调用）
#[tauri::command]
pub fn asset_get_details_batch(
    state: tauri::State<'_, AssetManagerState>,
    asset_ids: Vec<i64>,
) -> Result<Vec<AssetDetail>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::get_asset_details_batch(&conn, &asset_ids)
}

/// 获取智能文件夹列表
#[tauri::command]
pub fn asset_get_smart_folders(
    state: tauri::State<'_, AssetManagerState>,
    space_type: Option<String>,
) -> Result<Vec<SmartFolder>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::get_smart_folders(&conn, space_type.as_deref())
}

/// 创建智能文件夹
#[tauri::command]
pub fn asset_create_smart_folder(
    state: tauri::State<'_, AssetManagerState>,
    name: String,
    conditions: String,
    space_type: String,
) -> Result<SmartFolder, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::create_smart_folder(&conn, &name, &conditions, &space_type)
}

/// 更新智能文件夹
#[tauri::command]
pub fn asset_update_smart_folder(
    state: tauri::State<'_, AssetManagerState>,
    id: i64,
    name: String,
    conditions: String,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::update_smart_folder(&conn, id, &name, &conditions)
}

/// 删除智能文件夹
#[tauri::command]
pub fn asset_delete_smart_folder(
    state: tauri::State<'_, AssetManagerState>,
    id: i64,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::delete_smart_folder(&conn, id)
}

// ============================================================
// Phase 2 补全: Favorites + Batch Operations
// ============================================================

/// 切换收藏状态，返回是否已收藏
#[tauri::command]
pub fn asset_toggle_favorite(
    state: tauri::State<'_, AssetManagerState>,
    asset_id: i64,
) -> Result<bool, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::toggle_favorite(&conn, asset_id, "")
}

/// 检查是否已收藏
#[tauri::command]
pub fn asset_is_favorite(
    state: tauri::State<'_, AssetManagerState>,
    asset_id: i64,
) -> Result<bool, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    Ok(db::is_favorite(&conn, asset_id))
}

/// 获取所有收藏的资产 ID
#[tauri::command]
pub fn asset_get_favorite_ids(
    state: tauri::State<'_, AssetManagerState>,
) -> Result<Vec<i64>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    Ok(db::get_favorite_ids(&conn))
}

/// 批量设置收藏
#[tauri::command]
pub fn asset_batch_favorite(
    state: tauri::State<'_, AssetManagerState>,
    asset_ids: Vec<i64>,
    favorite: bool,
) -> Result<u32, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::batch_toggle_favorite(&conn, &asset_ids, favorite, "")
}

/// 批量设置评分
#[tauri::command]
pub fn asset_batch_set_rating(
    state: tauri::State<'_, AssetManagerState>,
    asset_ids: Vec<i64>,
    rating: i32,
) -> Result<u32, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::batch_set_rating(&conn, &asset_ids, rating, "")
}

/// 批量删除资产（从数据库中删除记录+清理缩略图）
#[tauri::command]
pub fn asset_batch_delete(
    state: tauri::State<'_, AssetManagerState>,
    asset_ids: Vec<i64>,
) -> Result<u32, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    // 先获取文件路径用于清理缩略图
    let mut paths = Vec::new();
    for aid in &asset_ids {
        if let Ok(path) = conn.query_row(
            "SELECT file_path FROM assets WHERE id = ?1",
            rusqlite::params![aid],
            |row| row.get::<_, String>(0),
        ) {
            paths.push(path);
        }
    }

    // 清理缩略图
    {
        let td = state.thumb_dir.lock().map_err(|e| e.to_string())?;
        thumbnail::cleanup_thumbnails(&td, &paths);
    }

    // 删除数据库记录
    db::batch_delete_assets(&conn, &asset_ids)
}

/// 批量导出资产（复制文件到目标目录）
#[tauri::command]
pub fn asset_batch_export(
    state: tauri::State<'_, AssetManagerState>,
    asset_ids: Vec<i64>,
    target_dir: String,
) -> Result<u32, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let target = std::path::Path::new(&target_dir);

    if !target.exists() {
        std::fs::create_dir_all(target).map_err(|e| format!("创建目标目录失败: {}", e))?;
    }

    let mut count = 0u32;
    for aid in &asset_ids {
        if let Ok((file_path, file_name)) = conn.query_row(
            "SELECT file_path, file_name FROM assets WHERE id = ?1",
            rusqlite::params![aid],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        ) {
            let src = std::path::Path::new(&file_path);
            let mut dest = target.join(&file_name);

            // 避免文件名冲突
            if dest.exists() {
                let stem = std::path::Path::new(&file_name)
                    .file_stem().unwrap_or_default().to_string_lossy().to_string();
                let ext = std::path::Path::new(&file_name)
                    .extension().map(|e| e.to_string_lossy().to_string()).unwrap_or_default();
                let mut n = 1;
                loop {
                    let new_name = if ext.is_empty() {
                        format!("{}_{}", stem, n)
                    } else {
                        format!("{}_{}.{}", stem, n, ext)
                    };
                    dest = target.join(&new_name);
                    if !dest.exists() { break; }
                    n += 1;
                }
            }

            if std::fs::copy(src, &dest).is_ok() {
                count += 1;
            }
        }
    }
    Ok(count)
}

/// 批量重命名（文件系统 + 数据库）
#[tauri::command]
pub fn asset_batch_rename(
    state: tauri::State<'_, AssetManagerState>,
    renames: Vec<(i64, String)>,
) -> Result<u32, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut count = 0u32;
    for (aid, new_name) in &renames {
        let row = conn.query_row(
            "SELECT file_path, file_name FROM assets WHERE id = ?1",
            rusqlite::params![aid],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        );
        if let Ok((old_path, _old_name)) = row {
            let src = std::path::Path::new(&old_path);
            if let Some(parent) = src.parent() {
                let dest = parent.join(new_name);
                if dest.exists() && dest != src {
                    continue;
                }
                if std::fs::rename(src, &dest).is_ok() {
                    let new_path_str = dest.to_string_lossy().to_string();
                    let _ = conn.execute(
                        "UPDATE assets SET file_name = ?1, file_path = ?2 WHERE id = ?3",
                        rusqlite::params![new_name, new_path_str, aid],
                    );
                    count += 1;
                }
            }
        }
    }
    Ok(count)
}

// ============================================================
// Asset Version Management
// ============================================================

/// 获取资产的所有版本
#[tauri::command]
pub fn asset_get_versions(
    state: tauri::State<'_, AssetManagerState>,
    asset_id: i64,
) -> Result<Vec<AssetVersion>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::get_asset_versions(&conn, asset_id)
}

/// 添加资产版本（拖入新图时调用）
#[tauri::command]
pub fn asset_add_version(
    state: tauri::State<'_, AssetManagerState>,
    asset_id: i64,
    file_path: String,
    label: String,
) -> Result<AssetVersion, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    db::ensure_initial_version(&conn, asset_id)?;

    let path = std::path::Path::new(&file_path);
    let file_size = path.metadata().map(|m| m.len() as i64).unwrap_or(0);

    let (width, height) = if let Ok(img) = image::open(path) {
        let dims = img.dimensions();
        (dims.0, dims.1)
    } else {
        (0, 0)
    };

    let thumb_path = {
        let td = state.thumb_dir.lock().map_err(|e| e.to_string())?;
        match thumbnail::generate_thumbnail(&file_path, &td, 300) {
            Ok(result) => result.thumb_path,
            Err(_) => String::new(),
        }
    };

    let version = db::add_asset_version(&conn, asset_id, &file_path, file_size, width, height, &thumb_path, &label)?;

    conn.execute(
        "UPDATE assets SET file_path = ?1, file_size = ?2, width = ?3, height = ?4, thumb_path = ?5, modified_at = strftime('%s','now')
         WHERE id = ?6",
        rusqlite::params![file_path, file_size, width, height, thumb_path, asset_id],
    ).map_err(|e| format!("更新资产失败: {}", e))?;

    Ok(version)
}

/// 删除版本
#[tauri::command]
pub fn asset_delete_version(
    state: tauri::State<'_, AssetManagerState>,
    version_id: i64,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::delete_asset_version(&conn, version_id)
}

/// 重命名版本
#[tauri::command]
pub fn asset_rename_version(
    state: tauri::State<'_, AssetManagerState>,
    version_id: i64,
    label: String,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::rename_asset_version(&conn, version_id, &label)
}

/// 切换到指定版本（更新 assets 表的文件信息）
#[tauri::command]
pub fn asset_switch_version(
    state: tauri::State<'_, AssetManagerState>,
    asset_id: i64,
    version_id: i64,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let ver = conn.query_row(
        "SELECT file_path, file_size, width, height, thumb_path FROM asset_versions WHERE id = ?1 AND asset_id = ?2",
        rusqlite::params![version_id, asset_id],
        |row| Ok((
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, u32>(2).unwrap_or(0),
            row.get::<_, u32>(3).unwrap_or(0),
            row.get::<_, String>(4)?,
        )),
    ).map_err(|e| format!("版本不存在: {}", e))?;

    conn.execute(
        "UPDATE assets SET file_path = ?1, file_size = ?2, width = ?3, height = ?4, thumb_path = ?5, modified_at = strftime('%s','now')
         WHERE id = ?6",
        rusqlite::params![ver.0, ver.1, ver.2, ver.3, ver.4, asset_id],
    ).map_err(|e| format!("切换版本失败: {}", e))?;

    Ok(())
}

/// 后台颜色索引：提取未索引资产的主色（在阻塞线程中执行，避免阻塞 async 运行时）
#[tauri::command]
pub async fn asset_index_colors(
    state: tauri::State<'_, AssetManagerState>,
) -> Result<u32, String> {
    let pending = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::get_asset_ids_without_colors(&conn)?
    };
    let results: Vec<(i64, Vec<db::AssetColor>)> = tokio::task::spawn_blocking(move || {
        let mut out = Vec::new();
        for (asset_id, thumb_path) in pending {
            if thumb_path.is_empty() { continue; }
            if let Ok(colors) = extract_colors_from_image(&thumb_path) {
                let db_colors: Vec<db::AssetColor> = colors.into_iter().map(|c| db::AssetColor {
                    asset_id,
                    hex: c.hex,
                    ratio: c.ratio,
                    r: c.r,
                    g: c.g,
                    b: c.b,
                    h: c.h,
                    s: c.s,
                    l: c.l,
                }).collect();
                out.push((asset_id, db_colors));
            }
        }
        out
    })
    .await
    .map_err(|e| format!("颜色索引线程失败: {}", e))?;
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let count = db::batch_upsert_colors(&conn, &results)?;
    Ok(count)
}

struct ExtractedColor {
    hex: String, ratio: f64,
    r: i32, g: i32, b: i32,
    h: f64, s: f64, l: f64,
}

fn rgb_to_hsl(r: u8, g: u8, b: u8) -> (f64, f64, f64) {
    let r = r as f64 / 255.0;
    let g = g as f64 / 255.0;
    let b = b as f64 / 255.0;
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let l = (max + min) / 2.0;
    if (max - min).abs() < 1e-6 {
        return (0.0, 0.0, l);
    }
    let d = max - min;
    let s = if l > 0.5 { d / (2.0 - max - min) } else { d / (max + min) };
    let h = if (max - r).abs() < 1e-6 {
        ((g - b) / d + if g < b { 6.0 } else { 0.0 }) / 6.0
    } else if (max - g).abs() < 1e-6 {
        ((b - r) / d + 2.0) / 6.0
    } else {
        ((r - g) / d + 4.0) / 6.0
    };
    (h * 360.0, s, l)
}

fn extract_colors_from_image(path: &str) -> Result<Vec<ExtractedColor>, String> {
    let img = image::open(path).map_err(|e| e.to_string())?;
    let thumb = img.thumbnail(64, 64);
    let mut color_counts: std::collections::HashMap<(u8, u8, u8), u32> = std::collections::HashMap::new();
    let mut total = 0u32;
    for pixel in thumb.pixels() {
        let [r, g, b, a] = pixel.2.0;
        if a < 128 { continue; }
        let qr = (r / 32) * 32 + 16;
        let qg = (g / 32) * 32 + 16;
        let qb = (b / 32) * 32 + 16;
        *color_counts.entry((qr, qg, qb)).or_insert(0) += 1;
        total += 1;
    }
    if total == 0 { return Ok(vec![]); }
    let mut sorted: Vec<_> = color_counts.into_iter().collect();
    sorted.sort_by(|a, b| b.1.cmp(&a.1));
    let top = sorted.into_iter().take(6).map(|((r, g, b), cnt)| {
        let (h, s, l) = rgb_to_hsl(r, g, b);
        ExtractedColor {
            hex: format!("#{:02x}{:02x}{:02x}", r, g, b),
            ratio: cnt as f64 / total as f64,
            r: r as i32, g: g as i32, b: b as i32,
            h, s, l,
        }
    }).collect();
    Ok(top)
}

/// 按颜色搜索资产
#[tauri::command]
pub fn asset_search_by_color(
    state: tauri::State<'_, AssetManagerState>,
    h_min: f64,
    h_max: f64,
    s_min: f64,
    l_min: f64,
    l_max: f64,
) -> Result<Vec<i64>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::query_assets_by_color(&conn, h_min, h_max, s_min, l_min, l_max)
}

/// 后台 MD5 哈希计算（在阻塞线程中执行，避免长时间阻塞 async 运行时）
#[tauri::command]
pub async fn asset_index_hashes(
    state: tauri::State<'_, AssetManagerState>,
) -> Result<u32, String> {
    let pending = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::get_asset_ids_without_hash(&conn)?
    };
    let results: Vec<(i64, String)> = tokio::task::spawn_blocking(move || {
        let mut out = Vec::new();
        for (asset_id, file_path) in pending {
            if let Ok(md5) = compute_file_md5(&file_path) {
                out.push((asset_id, md5));
            }
        }
        out
    })
    .await
    .map_err(|e| format!("哈希索引线程失败: {}", e))?;
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let count = db::batch_upsert_hashes(&conn, &results)?;
    Ok(count)
}

fn compute_file_md5(path: &str) -> Result<String, String> {
    use std::io::Read;
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = md5::Context::new();
    let mut buf = [0u8; 8192];
    loop {
        let n = file.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 { break; }
        hasher.consume(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.compute()))
}

/// 查找重复文件
#[tauri::command]
pub fn asset_find_duplicates(
    state: tauri::State<'_, AssetManagerState>,
) -> Result<Vec<(String, Vec<i64>)>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::find_duplicate_md5(&conn)
}

/// 保存标注数据
#[tauri::command]
pub fn asset_save_annotation(
    state: tauri::State<'_, AssetManagerState>,
    asset_id: i64,
    data: String,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::save_annotation(&conn, asset_id, &data)
}

/// 获取标注数据
#[tauri::command]
pub fn asset_get_annotation(
    state: tauri::State<'_, AssetManagerState>,
    asset_id: i64,
) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::get_annotation(&conn, asset_id)
}

/// 获取当前操作系统用户名
#[tauri::command]
pub fn asset_get_os_username() -> String {
    whoami::username()
}

// ============================================================
// Phase 3: Team Collaboration Commands
// ============================================================

/// 获取文件锁状态
#[tauri::command]
pub fn team_check_lock(
    shared_root: String,
    file_path: String,
) -> team::LockStatus {
    team::check_lock(std::path::Path::new(&shared_root), &file_path)
}

/// 获取锁
#[tauri::command]
pub fn team_acquire_lock(
    shared_root: String,
    file_path: String,
    username: String,
    machine: String,
) -> Result<bool, String> {
    team::acquire_lock(std::path::Path::new(&shared_root), &file_path, &username, &machine)
}

/// 释放锁
#[tauri::command]
pub fn team_release_lock(
    shared_root: String,
    file_path: String,
    username: String,
) -> Result<bool, String> {
    team::release_lock(std::path::Path::new(&shared_root), &file_path, &username)
}

/// 刷新心跳
#[tauri::command]
pub fn team_refresh_heartbeat(
    shared_root: String,
    file_path: String,
    username: String,
) -> Result<bool, String> {
    team::refresh_heartbeat(std::path::Path::new(&shared_root), &file_path, &username)
}

/// 获取所有活跃锁
#[tauri::command]
pub fn team_get_all_locks(
    shared_root: String,
) -> Result<Vec<team::FileLock>, String> {
    team::get_all_locks(std::path::Path::new(&shared_root))
}

/// 获取文件版本历史
#[tauri::command]
pub fn team_get_history(
    shared_root: String,
    file_path: String,
) -> Result<Option<team::FileHistory>, String> {
    team::get_file_history(std::path::Path::new(&shared_root), &file_path)
}

/// 创建版本
#[tauri::command]
pub fn team_create_version(
    shared_root: String,
    file_path: String,
    actual_file_path: String,
    author: String,
    comment: String,
) -> Result<team::FileVersion, String> {
    team::create_version(
        std::path::Path::new(&shared_root),
        &file_path,
        std::path::Path::new(&actual_file_path),
        &author,
        &comment,
    )
}

/// 恢复版本
#[tauri::command]
pub fn team_restore_version(
    shared_root: String,
    file_path: String,
    version: u32,
    target_path: String,
) -> Result<(), String> {
    team::restore_version(
        std::path::Path::new(&shared_root),
        &file_path,
        version,
        std::path::Path::new(&target_path),
    )
}

/// 记录操作日志
#[tauri::command]
pub fn team_log_action(
    shared_root: String,
    username: String,
    machine: String,
    action: String,
    target_path: String,
    data: String,
) -> Result<(), String> {
    team::append_action(
        std::path::Path::new(&shared_root),
        &username,
        &machine,
        &action,
        &target_path,
        &data,
    )
}

/// 读取操作日志
#[tauri::command]
pub fn team_read_actions(
    shared_root: String,
    since_timestamp: u64,
) -> Result<Vec<team::ActionLog>, String> {
    team::read_actions_since(std::path::Path::new(&shared_root), since_timestamp)
}

/// 加载权限配置
#[tauri::command]
pub fn team_load_permissions(
    shared_root: String,
) -> Result<team::PermissionsConfig, String> {
    team::load_permissions(std::path::Path::new(&shared_root))
}

/// 设置用户权限
#[tauri::command]
pub fn team_set_permission(
    shared_root: String,
    username: String,
    role: String,
    project_path: Option<String>,
) -> Result<(), String> {
    team::set_user_permission(
        std::path::Path::new(&shared_root),
        &username,
        &role,
        project_path.as_deref(),
    )
}

/// 获取用户角色
#[tauri::command]
pub fn team_get_user_role(
    shared_root: String,
    username: String,
    project_path: Option<String>,
) -> Result<String, String> {
    let cfg = team::load_permissions(std::path::Path::new(&shared_root))?;
    Ok(team::get_user_role(&cfg, &username, project_path.as_deref()))
}

// ============================================================
// Phase 4: FFmpeg Commands
// ============================================================

/// 检查 FFmpeg 是否已安装（优先检查应用内安装目录，与 download 安装位置一致）
#[tauri::command]
pub fn ffmpeg_check(app: tauri::AppHandle) -> ffmpeg::FfmpegStatus {
    if let Some(app_data) = app.path_resolver().app_data_dir() {
        if let Some(ff_path) = ffmpeg::get_ffmpeg_path(&app_data) {
            if ff_path.exists() {
                let mut c = std::process::Command::new(&ff_path);
                c.arg("-version");
                #[cfg(target_os = "windows")]
                c.creation_flags(0x0800_0000);
                if let Ok(output) = c.output() {
                    if output.status.success() {
                        let version_str = String::from_utf8_lossy(&output.stdout);
                        let version = version_str.lines().next().unwrap_or("").to_string();
                        return ffmpeg::FfmpegStatus {
                            installed: true,
                            path: Some(ff_path.to_string_lossy().to_string()),
                            version: Some(version),
                        };
                    }
                }
            }
        }
    }
    ffmpeg::check_ffmpeg()
}

/// 下载安装 FFmpeg
#[tauri::command]
pub async fn ffmpeg_download(
    app: AppHandle,
) -> Result<String, String> {
    let app_data = app.path_resolver().app_data_dir()
        .ok_or_else(|| "无法获取应用数据目录".to_string())?;

    let (tx, mut rx) = tokio::sync::mpsc::channel(32);

    let app_clone2 = app.clone();
    // Spawn progress event forwarder
    tokio::spawn(async move {
        while let Some(progress) = rx.recv().await {
            let _ = app_clone2.emit_all("ffmpeg-download-progress", &progress);
        }
    });

    ffmpeg::download_ffmpeg(&app_data, tx).await
}

/// 提取视频缩略图
#[tauri::command]
pub fn ffmpeg_extract_thumbnail(
    app: AppHandle,
    video_path: String,
    output_path: String,
    width: u32,
) -> Result<(), String> {
    let app_data = app.path_resolver().app_data_dir()
        .ok_or_else(|| "无法获取应用数据目录".to_string())?;

    let ffmpeg_path = ffmpeg::get_ffmpeg_path(&app_data)
        .ok_or_else(|| "FFmpeg 未安装".to_string())?;

    ffmpeg::extract_video_thumbnail(
        &ffmpeg_path,
        std::path::Path::new(&video_path),
        std::path::Path::new(&output_path),
        width,
    )
}

// ============================================================
// AI Semantic Search Commands
// ============================================================

/// 检查 AI 模型状态
#[tauri::command]
pub fn ai_check_model(
    ai_state: tauri::State<'_, AiState>,
) -> Result<serde_json::Value, String> {
    let dir = ai_state.get_models_dir();
    let (vision, text, tokenizer) = ai::model_files_status(&dir);
    let loaded = ai_state.model.lock().map_err(|e| e.to_string())?.is_some();
    Ok(serde_json::json!({
        "vision_downloaded": vision,
        "text_downloaded": text,
        "tokenizer_downloaded": tokenizer,
        "all_ready": vision && text && tokenizer,
        "loaded": loaded,
        "models_dir": dir.to_string_lossy(),
    }))
}

/// 获取/设置 AI 模型目录
#[tauri::command]
pub fn ai_get_models_dir(
    ai_state: tauri::State<'_, AiState>,
) -> Result<serde_json::Value, String> {
    let dir = ai_state.get_models_dir();
    let default_dir = &ai_state.default_models_dir;
    Ok(serde_json::json!({
        "models_dir": dir.to_string_lossy(),
        "default_dir": default_dir.to_string_lossy(),
        "is_custom": dir != *default_dir,
    }))
}

#[tauri::command]
pub fn ai_set_models_dir(
    ai_state: tauri::State<'_, AiState>,
    path: String,
) -> Result<(), String> {
    let new_dir = std::path::PathBuf::from(&path);
    ai_state.set_models_dir(new_dir)
}

/// 下载 AI 模型（带进度事件）
#[tauri::command]
pub async fn ai_download_model(
    app: AppHandle,
    ai_state: tauri::State<'_, AiState>,
) -> Result<(), String> {
    let models_dir = ai_state.get_models_dir();
    let app_clone = app.clone();

    ai::download_all_models(&models_dir, |name, downloaded, total| {
        let _ = app_clone.emit_all("ai-download-progress", serde_json::json!({
            "file": name,
            "downloaded": downloaded,
            "total": total,
        }));
    }).await?;

    Ok(())
}

/// 加载 AI 模型到内存
#[tauri::command]
pub fn ai_load_model(
    ai_state: tauri::State<'_, AiState>,
) -> Result<(), String> {
    let dir = ai_state.get_models_dir();
    let model = ai::load_model(&dir)?;
    let mut lock = ai_state.model.lock().map_err(|e| e.to_string())?;
    *lock = Some(model);
    Ok(())
}

/// 后台索引：为未嵌入的图片生成 CLIP 向量
#[tauri::command]
pub async fn ai_index_embeddings(
    app: AppHandle,
    state: tauri::State<'_, AssetManagerState>,
    ai_state: tauri::State<'_, AiState>,
) -> Result<serde_json::Value, String> {
    fn ensure_model(ai_state: &AiState) -> Result<(), String> {
        let lock = ai_state.model.lock().map_err(|e| e.to_string())?;
        if lock.is_none() {
            drop(lock);
            let model = ai::load_model(&ai_state.get_models_dir())?;
            let mut lock = ai_state.model.lock().map_err(|e| e.to_string())?;
            *lock = Some(model);
            *ai_state.model_broken.lock().unwrap() = false;
        }
        Ok(())
    }

    {
        let broken = ai_state.model_broken.lock().map_err(|e| e.to_string())?;
        if *broken {
            return Err("AI 模型不可用，请重启应用后重试".to_string());
        }
    }

    ensure_model(&ai_state)?;

    let batch_size = 50u32;
    let assets: Vec<(i64, String)>;
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        assets = db::get_asset_ids_without_embedding_new_only(&conn, batch_size)?;
    }

    let total = assets.len();
    let mut indexed = 0u32;
    let mut failed = 0u32;
    let mut consecutive_failures = 0u32;
    let mut reload_attempts = 0u32;
    const MAX_RELOADS: u32 = 2;

    for (i, (asset_id, file_path)) in assets.iter().enumerate() {
        if !std::path::Path::new(file_path).exists() {
            let conn = state.db.lock().map_err(|e| e.to_string())?;
            let _ = db::mark_embedding_failed(&conn, *asset_id);
            failed += 1;
            continue;
        }
        
        let result = {
            let mut lock = ai_state.model.lock().map_err(|e| e.to_string())?;
            let model = lock.as_mut().ok_or("模型未加载")?;
            ai::embed_image(model, file_path)
        };

        match result {
            Ok(embedding) => {
                let bytes = ai::embedding_to_bytes(&embedding);
                let conn = state.db.lock().map_err(|e| e.to_string())?;
                db::upsert_embedding(&conn, *asset_id, &bytes, ai::get_model_version())?;
                indexed += 1;
                consecutive_failures = 0;
            }
            Err(_) => {
                let conn = state.db.lock().map_err(|e| e.to_string())?;
                let _ = db::mark_embedding_failed(&conn, *asset_id);
                failed += 1;
                consecutive_failures += 1;

                if consecutive_failures >= 3 {
                    reload_attempts += 1;
                    if reload_attempts > MAX_RELOADS {
                        *ai_state.model_broken.lock().unwrap() = true;
                        break;
                    }
                    {
                        let mut lock = ai_state.model.lock().map_err(|e| e.to_string())?;
                        *lock = None;
                    }
                    if ensure_model(&ai_state).is_err() {
                        *ai_state.model_broken.lock().unwrap() = true;
                        break;
                    }
                    consecutive_failures = 0;
                }
            }
        }

        if (i + 1) % 5 == 0 || i + 1 == total {
            let _ = app.emit_all("ai-index-progress", serde_json::json!({
                "current": i + 1,
                "total": total,
                "indexed": indexed,
                "failed": failed,
            }));
        }
    }

    // Return embedding stats
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let (total_indexed, total_images) = db::count_embeddings(&conn)?;

    Ok(serde_json::json!({
        "batch_indexed": indexed,
        "batch_failed": failed,
        "total_indexed": total_indexed,
        "total_images": total_images,
    }))
}

/// AI 语义搜索
#[tauri::command]
pub fn ai_semantic_search(
    state: tauri::State<'_, AssetManagerState>,
    ai_state: tauri::State<'_, AiState>,
    query: String,
    top_k: Option<usize>,
) -> Result<Vec<(i64, f32)>, String> {
    let mut lock = ai_state.model.lock().map_err(|e| e.to_string())?;
    let model = lock.as_mut().ok_or("AI 模型未加载，请先下载并加载模型")?;

    let text_embedding = ai::embed_text(model, &query)?;

    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let raw_embeddings = db::get_all_embeddings(&conn)?;

    let all_embeddings: Vec<(i64, Vec<f32>)> = raw_embeddings
        .iter()
        .map(|(id, bytes)| (*id, ai::bytes_to_embedding(bytes)))
        .collect();

    let k = top_k.unwrap_or(50);
    let results = ai::search_similar(&text_embedding, &all_embeddings, k);

    Ok(results)
}

/// 获取索引统计
#[tauri::command]
pub fn ai_embedding_stats(
    state: tauri::State<'_, AssetManagerState>,
) -> Result<serde_json::Value, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let (indexed, total) = db::count_embeddings(&conn)?;
    Ok(serde_json::json!({
        "indexed": indexed,
        "total": total,
        "progress": if total > 0 { indexed as f64 / total as f64 } else { 0.0 },
    }))
}

/// 检查路径是否可访问（用于验证网络路径）
#[tauri::command]
pub fn asset_check_path_accessible(path: String) -> Result<bool, String> {
    let p = std::path::Path::new(&path);
    Ok(p.exists() && p.is_dir())
}

// ============================================================
// Share Commands
// ============================================================

#[tauri::command]
pub fn share_create(
    state: tauri::State<'_, AssetManagerState>,
    _share_state: tauri::State<'_, ShareState>,
    folder_id: i64,
) -> Result<share::ShareInfo, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    share::create_share(&conn, folder_id, "")
}

#[tauri::command]
pub fn share_revoke(
    state: tauri::State<'_, AssetManagerState>,
    share_id: i64,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    share::revoke_share(&conn, share_id)
}

#[tauri::command]
pub fn share_list(
    state: tauri::State<'_, AssetManagerState>,
    folder_id: Option<i64>,
) -> Result<Vec<share::ShareInfo>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    share::get_shares(&conn, folder_id)
}

#[tauri::command]
pub fn share_start_server(
    state: tauri::State<'_, AssetManagerState>,
    share_state: tauri::State<'_, ShareState>,
) -> Result<share::ShareServerStatus, String> {
    let db_path = state.db_path.lock().map_err(|e| e.to_string())?.clone();
    let thumb_dir = state.thumb_dir.lock().map_err(|e| e.to_string())?.clone();
    share::start_server(&share_state, db_path, thumb_dir)
}

#[tauri::command]
pub fn share_stop_server(
    share_state: tauri::State<'_, ShareState>,
) -> Result<(), String> {
    share::stop_server(&share_state)
}

#[tauri::command]
pub fn share_server_status(
    share_state: tauri::State<'_, ShareState>,
) -> Result<share::ShareServerStatus, String> {
    Ok(share::get_server_status(&share_state))
}

/// 切换资产管理器存储路径（用户更改存储目录后调用，无需重启）
#[tauri::command]
pub fn asset_reconnect_storage(
    app: AppHandle,
    state: tauri::State<'_, AssetManagerState>,
    storage_dir: String,
) -> Result<(), String> {
    let base = if storage_dir.is_empty() {
        app.path_resolver().app_data_dir()
            .ok_or_else(|| "无法获取应用数据目录".to_string())?
    } else {
        PathBuf::from(&storage_dir)
    };

    let am_dir = base.join("asset_manager");
    let thumb_dir = am_dir.join("thumbnails");
    std::fs::create_dir_all(&thumb_dir)
        .map_err(|e| format!("创建目录失败: {}", e))?;
    let db_path = am_dir.join("assets.db");

    // 如果旧位置（AppData）有数据而新位置没有，自动迁移
    if let Some(app_data) = app.path_resolver().app_data_dir() {
        let old_db = app_data.join("asset_manager").join("assets.db");
        if old_db.exists() && !db_path.exists() && old_db != db_path {
            std::fs::copy(&old_db, &db_path).ok();
            let old_thumb = app_data.join("asset_manager").join("thumbnails");
            if old_thumb.exists() {
                crate::copy_dir_recursive(&old_thumb, &thumb_dir);
            }
        }
    }

    state.reconnect(db_path, thumb_dir)?;
    println!("Asset manager reconnected to: {:?}", am_dir);
    Ok(())
}

use tauri::{AppHandle, Manager};
use crate::asset_manager::db::{self, AssetManagerState, AssetQueryParams, AssetQueryResult, FolderInfo, FolderStats, ScanProgress, TagInfo, AssetDetail, SmartFolder};
use crate::asset_manager::scanner;
use crate::asset_manager::thumbnail;
use crate::asset_manager::team;
use crate::asset_manager::ffmpeg;

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
    thumbnail::cleanup_thumbnails(&state.thumb_dir, &paths);

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

        (path, state.thumb_dir.clone())
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
                Err(_) => (String::new(), 0, 0),
            }
        } else {
            // 非图片格式，暂时不生成缩略图
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

/// 获取资产详情（含标签+评分+备注）
#[tauri::command]
pub fn asset_get_detail(
    state: tauri::State<'_, AssetManagerState>,
    asset_id: i64,
) -> Result<AssetDetail, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::get_asset_detail(&conn, asset_id)
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
    thumbnail::cleanup_thumbnails(&state.thumb_dir, &paths);

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

/// 检查 FFmpeg 是否已安装
#[tauri::command]
pub fn ffmpeg_check() -> ffmpeg::FfmpegStatus {
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

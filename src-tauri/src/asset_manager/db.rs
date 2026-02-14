use rusqlite::{Connection, params};
use serde::{Serialize, Deserialize};
use std::path::PathBuf;
use std::sync::Mutex;

// ---- State ----

pub struct AssetManagerState {
    pub db: Mutex<Connection>,
    pub thumb_dir: PathBuf,
}

impl AssetManagerState {
    pub fn new(db_path: PathBuf, thumb_dir: PathBuf) -> Result<Self, String> {
        let conn = Connection::open(&db_path)
            .map_err(|e| format!("打开数据库失败: {}", e))?;

        // WAL 模式：允许并发读 + 串行写，性能更好
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             PRAGMA foreign_keys=ON;
             PRAGMA cache_size=-8000;"
        ).map_err(|e| format!("设置数据库参数失败: {}", e))?;

        init_tables(&conn)?;

        Ok(Self {
            db: Mutex::new(conn),
            thumb_dir,
        })
    }
}

// ---- Data Types ----

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderInfo {
    pub id: i64,
    pub path: String,
    pub name: String,
    pub space_type: String,
    pub asset_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetInfo {
    pub id: i64,
    pub folder_id: i64,
    pub file_path: String,
    pub file_name: String,
    pub file_ext: String,
    pub file_size: i64,
    pub width: u32,
    pub height: u32,
    pub thumb_path: String,
    pub modified_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AssetQueryParams {
    pub folder_id: Option<i64>,
    pub search: Option<String>,
    pub extensions: Option<Vec<String>>,
    pub min_width: Option<u32>,
    pub max_width: Option<u32>,
    pub sort_by: Option<String>,   // "name", "size", "modified", "width"
    pub sort_order: Option<String>, // "asc", "desc"
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AssetQueryResult {
    pub assets: Vec<AssetInfo>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScanProgress {
    pub folder_id: i64,
    pub current: u32,
    pub total: u32,
    pub file_name: String,
    pub phase: String, // "scanning", "thumbnails", "complete"
}

#[derive(Debug, Clone, Serialize)]
pub struct FolderStats {
    pub total_assets: i64,
    pub total_folders: i64,
    pub total_size: i64,
    pub format_counts: Vec<(String, i64)>,
}

// ---- Database Schema ----

fn init_tables(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS folders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            space_type TEXT NOT NULL DEFAULT 'personal',
            created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );

        CREATE TABLE IF NOT EXISTS assets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            folder_id INTEGER NOT NULL,
            file_path TEXT NOT NULL UNIQUE,
            file_name TEXT NOT NULL,
            file_ext TEXT NOT NULL,
            file_size INTEGER NOT NULL DEFAULT 0,
            width INTEGER NOT NULL DEFAULT 0,
            height INTEGER NOT NULL DEFAULT 0,
            thumb_path TEXT NOT NULL DEFAULT '',
            modified_at INTEGER NOT NULL DEFAULT 0,
            scanned_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
            FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_assets_folder ON assets(folder_id);
        CREATE INDEX IF NOT EXISTS idx_assets_ext ON assets(file_ext);
        CREATE INDEX IF NOT EXISTS idx_assets_name ON assets(file_name COLLATE NOCASE);
        CREATE INDEX IF NOT EXISTS idx_assets_size ON assets(file_size);
        CREATE INDEX IF NOT EXISTS idx_assets_modified ON assets(modified_at);

        -- 标签表
        CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE COLLATE NOCASE,
            color TEXT NOT NULL DEFAULT '#6b7280'
        );

        -- 资产-标签关联
        CREATE TABLE IF NOT EXISTS asset_tags (
            asset_id INTEGER NOT NULL,
            tag_id INTEGER NOT NULL,
            tagged_by TEXT NOT NULL DEFAULT '',
            tagged_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
            PRIMARY KEY (asset_id, tag_id),
            FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
            FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
        );

        -- 评分表
        CREATE TABLE IF NOT EXISTS asset_ratings (
            asset_id INTEGER PRIMARY KEY,
            rating INTEGER NOT NULL DEFAULT 0,
            rated_by TEXT NOT NULL DEFAULT '',
            rated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
            FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
        );

        -- 备注表
        CREATE TABLE IF NOT EXISTS asset_notes (
            asset_id INTEGER PRIMARY KEY,
            note TEXT NOT NULL DEFAULT '',
            updated_by TEXT NOT NULL DEFAULT '',
            updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
            FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
        );

        -- 智能文件夹
        CREATE TABLE IF NOT EXISTS smart_folders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            icon TEXT NOT NULL DEFAULT 'folder',
            conditions TEXT NOT NULL DEFAULT '{}',
            space_type TEXT NOT NULL DEFAULT 'personal',
            created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );

        CREATE INDEX IF NOT EXISTS idx_asset_tags_asset ON asset_tags(asset_id);
        CREATE INDEX IF NOT EXISTS idx_asset_tags_tag ON asset_tags(tag_id);"
    ).map_err(|e| format!("创建数据表失败: {}", e))?;

    Ok(())
}

// ---- CRUD Operations ----

pub fn insert_folder(conn: &Connection, path: &str, name: &str, space_type: &str) -> Result<FolderInfo, String> {
    conn.execute(
        "INSERT OR IGNORE INTO folders (path, name, space_type) VALUES (?1, ?2, ?3)",
        params![path, name, space_type],
    ).map_err(|e| format!("插入文件夹失败: {}", e))?;

    let folder = conn.query_row(
        "SELECT id, path, name, space_type, 
                (SELECT COUNT(*) FROM assets WHERE folder_id = folders.id) as cnt
         FROM folders WHERE path = ?1",
        params![path],
        |row| {
            Ok(FolderInfo {
                id: row.get(0)?,
                path: row.get(1)?,
                name: row.get(2)?,
                space_type: row.get(3)?,
                asset_count: row.get(4)?,
            })
        },
    ).map_err(|e| format!("查询文件夹失败: {}", e))?;

    Ok(folder)
}

pub fn remove_folder(conn: &Connection, folder_id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM assets WHERE folder_id = ?1", params![folder_id])
        .map_err(|e| format!("删除资产失败: {}", e))?;
    conn.execute("DELETE FROM folders WHERE id = ?1", params![folder_id])
        .map_err(|e| format!("删除文件夹失败: {}", e))?;
    Ok(())
}

pub fn get_folders(conn: &Connection, space_type: Option<&str>) -> Result<Vec<FolderInfo>, String> {
    let mut sql = String::from(
        "SELECT f.id, f.path, f.name, f.space_type,
                (SELECT COUNT(*) FROM assets WHERE folder_id = f.id) as cnt
         FROM folders f"
    );
    if let Some(st) = space_type {
        sql.push_str(&format!(" WHERE f.space_type = '{}'", st));
    }
    sql.push_str(" ORDER BY f.name");

    let mut stmt = conn.prepare(&sql).map_err(|e| format!("准备查询失败: {}", e))?;
    let folders = stmt.query_map([], |row| {
        Ok(FolderInfo {
            id: row.get(0)?,
            path: row.get(1)?,
            name: row.get(2)?,
            space_type: row.get(3)?,
            asset_count: row.get(4)?,
        })
    }).map_err(|e| format!("执行查询失败: {}", e))?
      .filter_map(|r| r.ok())
      .collect();

    Ok(folders)
}

pub fn upsert_asset(
    conn: &Connection,
    folder_id: i64,
    file_path: &str,
    file_name: &str,
    file_ext: &str,
    file_size: i64,
    width: u32,
    height: u32,
    thumb_path: &str,
    modified_at: i64,
) -> Result<i64, String> {
    conn.execute(
        "INSERT INTO assets (folder_id, file_path, file_name, file_ext, file_size, width, height, thumb_path, modified_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(file_path) DO UPDATE SET
            file_size = excluded.file_size,
            width = excluded.width,
            height = excluded.height,
            thumb_path = excluded.thumb_path,
            modified_at = excluded.modified_at,
            scanned_at = strftime('%s','now')",
        params![folder_id, file_path, file_name, file_ext, file_size, width, height, thumb_path, modified_at],
    ).map_err(|e| format!("插入资产失败: {}", e))?;

    let id = conn.last_insert_rowid();
    Ok(id)
}

pub fn query_assets(conn: &Connection, params: &AssetQueryParams) -> Result<AssetQueryResult, String> {
    let page = params.page.unwrap_or(1).max(1);
    let page_size = params.page_size.unwrap_or(100).clamp(1, 500);
    let offset = (page - 1) * page_size;

    let mut conditions = Vec::new();
    let mut bind_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(fid) = params.folder_id {
        conditions.push(format!("folder_id = ?{}", bind_values.len() + 1));
        bind_values.push(Box::new(fid));
    }

    if let Some(ref search) = params.search {
        if !search.is_empty() {
            conditions.push(format!("file_name LIKE ?{}", bind_values.len() + 1));
            bind_values.push(Box::new(format!("%{}%", search)));
        }
    }

    if let Some(ref exts) = params.extensions {
        if !exts.is_empty() {
            let placeholders: Vec<String> = exts.iter().enumerate().map(|(i, _)| {
                format!("?{}", bind_values.len() + i + 1)
            }).collect();
            conditions.push(format!("file_ext IN ({})", placeholders.join(",")));
            for ext in exts {
                bind_values.push(Box::new(ext.to_lowercase()));
            }
        }
    }

    if let Some(min_w) = params.min_width {
        conditions.push(format!("width >= ?{}", bind_values.len() + 1));
        bind_values.push(Box::new(min_w));
    }
    if let Some(max_w) = params.max_width {
        conditions.push(format!("width <= ?{}", bind_values.len() + 1));
        bind_values.push(Box::new(max_w));
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    let sort_col = match params.sort_by.as_deref() {
        Some("size") => "file_size",
        Some("modified") => "modified_at",
        Some("width") => "width",
        Some("ext") => "file_ext",
        _ => "file_name",
    };
    let sort_dir = match params.sort_order.as_deref() {
        Some("desc") => "DESC",
        _ => "ASC",
    };

    // Count total
    let count_sql = format!("SELECT COUNT(*) FROM assets {}", where_clause);
    let params_refs: Vec<&dyn rusqlite::types::ToSql> = bind_values.iter().map(|b| b.as_ref()).collect();

    let total: i64 = conn.query_row(&count_sql, params_refs.as_slice(), |row| row.get(0))
        .map_err(|e| format!("计数查询失败: {}", e))?;

    // Query assets
    let query_sql = format!(
        "SELECT id, folder_id, file_path, file_name, file_ext, file_size, width, height, thumb_path, modified_at
         FROM assets {}
         ORDER BY {} {}
         LIMIT ?{} OFFSET ?{}",
        where_clause, sort_col, sort_dir,
        bind_values.len() + 1, bind_values.len() + 2
    );

    bind_values.push(Box::new(page_size));
    bind_values.push(Box::new(offset));
    let params_refs2: Vec<&dyn rusqlite::types::ToSql> = bind_values.iter().map(|b| b.as_ref()).collect();

    let mut stmt = conn.prepare(&query_sql).map_err(|e| format!("准备查询失败: {}", e))?;
    let assets = stmt.query_map(params_refs2.as_slice(), |row| {
        Ok(AssetInfo {
            id: row.get(0)?,
            folder_id: row.get(1)?,
            file_path: row.get(2)?,
            file_name: row.get(3)?,
            file_ext: row.get(4)?,
            file_size: row.get(5)?,
            width: row.get::<_, u32>(6).unwrap_or(0),
            height: row.get::<_, u32>(7).unwrap_or(0),
            thumb_path: row.get(8)?,
            modified_at: row.get(9)?,
        })
    }).map_err(|e| format!("查询资产失败: {}", e))?
      .filter_map(|r| r.ok())
      .collect();

    Ok(AssetQueryResult {
        assets,
        total,
        page,
        page_size,
    })
}

pub fn get_stats(conn: &Connection) -> Result<FolderStats, String> {
    let total_assets: i64 = conn.query_row("SELECT COUNT(*) FROM assets", [], |row| row.get(0))
        .unwrap_or(0);
    let total_folders: i64 = conn.query_row("SELECT COUNT(*) FROM folders", [], |row| row.get(0))
        .unwrap_or(0);
    let total_size: i64 = conn.query_row("SELECT COALESCE(SUM(file_size),0) FROM assets", [], |row| row.get(0))
        .unwrap_or(0);

    let mut stmt = conn.prepare("SELECT file_ext, COUNT(*) as cnt FROM assets GROUP BY file_ext ORDER BY cnt DESC")
        .map_err(|e| format!("统计查询失败: {}", e))?;
    let format_counts: Vec<(String, i64)> = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    }).map_err(|e| format!("统计查询失败: {}", e))?
      .filter_map(|r| r.ok())
      .collect();

    Ok(FolderStats {
        total_assets,
        total_folders,
        total_size,
        format_counts,
    })
}

pub fn clear_folder_assets(conn: &Connection, folder_id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM assets WHERE folder_id = ?1", params![folder_id])
        .map_err(|e| format!("清空资产失败: {}", e))?;
    Ok(())
}

// ============================================================
// Phase 2: Tags, Ratings, Notes, Smart Folders
// ============================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagInfo {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub asset_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetDetail {
    pub asset: AssetInfo,
    pub tags: Vec<TagInfo>,
    pub rating: i32,
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmartFolder {
    pub id: i64,
    pub name: String,
    pub icon: String,
    pub conditions: String, // JSON string
    pub space_type: String,
}

// ---- Tag CRUD ----

pub fn create_tag(conn: &Connection, name: &str, color: &str) -> Result<TagInfo, String> {
    conn.execute(
        "INSERT OR IGNORE INTO tags (name, color) VALUES (?1, ?2)",
        params![name, color],
    ).map_err(|e| format!("创建标签失败: {}", e))?;

    conn.query_row(
        "SELECT id, name, color, (SELECT COUNT(*) FROM asset_tags WHERE tag_id = tags.id) FROM tags WHERE name = ?1 COLLATE NOCASE",
        params![name],
        |row| Ok(TagInfo { id: row.get(0)?, name: row.get(1)?, color: row.get(2)?, asset_count: row.get(3)? }),
    ).map_err(|e| format!("查询标签失败: {}", e))
}

pub fn update_tag(conn: &Connection, tag_id: i64, name: &str, color: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE tags SET name = ?1, color = ?2 WHERE id = ?3",
        params![name, color, tag_id],
    ).map_err(|e| format!("更新标签失败: {}", e))?;
    Ok(())
}

pub fn delete_tag(conn: &Connection, tag_id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM asset_tags WHERE tag_id = ?1", params![tag_id])
        .map_err(|e| format!("删除标签关联失败: {}", e))?;
    conn.execute("DELETE FROM tags WHERE id = ?1", params![tag_id])
        .map_err(|e| format!("删除标签失败: {}", e))?;
    Ok(())
}

pub fn get_all_tags(conn: &Connection) -> Result<Vec<TagInfo>, String> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.name, t.color, (SELECT COUNT(*) FROM asset_tags WHERE tag_id = t.id) as cnt
         FROM tags t ORDER BY cnt DESC, t.name"
    ).map_err(|e| e.to_string())?;

    let tags = stmt.query_map([], |row| {
        Ok(TagInfo { id: row.get(0)?, name: row.get(1)?, color: row.get(2)?, asset_count: row.get(3)? })
    }).map_err(|e| e.to_string())?
      .filter_map(|r| r.ok())
      .collect();
    Ok(tags)
}

pub fn add_tag_to_asset(conn: &Connection, asset_id: i64, tag_id: i64, user: &str) -> Result<(), String> {
    conn.execute(
        "INSERT OR IGNORE INTO asset_tags (asset_id, tag_id, tagged_by) VALUES (?1, ?2, ?3)",
        params![asset_id, tag_id, user],
    ).map_err(|e| format!("添加标签失败: {}", e))?;
    Ok(())
}

pub fn remove_tag_from_asset(conn: &Connection, asset_id: i64, tag_id: i64) -> Result<(), String> {
    conn.execute(
        "DELETE FROM asset_tags WHERE asset_id = ?1 AND tag_id = ?2",
        params![asset_id, tag_id],
    ).map_err(|e| format!("移除标签失败: {}", e))?;
    Ok(())
}

pub fn get_asset_tags(conn: &Connection, asset_id: i64) -> Result<Vec<TagInfo>, String> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.name, t.color, 0 FROM tags t
         JOIN asset_tags at ON t.id = at.tag_id WHERE at.asset_id = ?1 ORDER BY t.name"
    ).map_err(|e| e.to_string())?;

    let tags = stmt.query_map(params![asset_id], |row| {
        Ok(TagInfo { id: row.get(0)?, name: row.get(1)?, color: row.get(2)?, asset_count: row.get(3)? })
    }).map_err(|e| e.to_string())?
      .filter_map(|r| r.ok())
      .collect();
    Ok(tags)
}

pub fn batch_add_tag(conn: &Connection, asset_ids: &[i64], tag_id: i64, user: &str) -> Result<u32, String> {
    let mut count = 0u32;
    for aid in asset_ids {
        if conn.execute(
            "INSERT OR IGNORE INTO asset_tags (asset_id, tag_id, tagged_by) VALUES (?1, ?2, ?3)",
            params![aid, tag_id, user],
        ).is_ok() {
            count += 1;
        }
    }
    Ok(count)
}

// ---- Rating CRUD ----

pub fn set_rating(conn: &Connection, asset_id: i64, rating: i32, user: &str) -> Result<(), String> {
    if rating == 0 {
        conn.execute("DELETE FROM asset_ratings WHERE asset_id = ?1", params![asset_id])
            .map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "INSERT INTO asset_ratings (asset_id, rating, rated_by) VALUES (?1, ?2, ?3)
             ON CONFLICT(asset_id) DO UPDATE SET rating = excluded.rating, rated_by = excluded.rated_by, rated_at = strftime('%s','now')",
            params![asset_id, rating, user],
        ).map_err(|e| format!("设置评分失败: {}", e))?;
    }
    Ok(())
}

pub fn get_rating(conn: &Connection, asset_id: i64) -> i32 {
    conn.query_row(
        "SELECT rating FROM asset_ratings WHERE asset_id = ?1",
        params![asset_id],
        |row| row.get(0),
    ).unwrap_or(0)
}

// ---- Note CRUD ----

pub fn set_note(conn: &Connection, asset_id: i64, note: &str, user: &str) -> Result<(), String> {
    if note.is_empty() {
        conn.execute("DELETE FROM asset_notes WHERE asset_id = ?1", params![asset_id])
            .map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "INSERT INTO asset_notes (asset_id, note, updated_by) VALUES (?1, ?2, ?3)
             ON CONFLICT(asset_id) DO UPDATE SET note = excluded.note, updated_by = excluded.updated_by, updated_at = strftime('%s','now')",
            params![asset_id, note, user],
        ).map_err(|e| format!("设置备注失败: {}", e))?;
    }
    Ok(())
}

pub fn get_note(conn: &Connection, asset_id: i64) -> String {
    conn.query_row(
        "SELECT note FROM asset_notes WHERE asset_id = ?1",
        params![asset_id],
        |row| row.get(0),
    ).unwrap_or_default()
}

// ---- Asset Detail (tags + rating + note in one call) ----

pub fn get_asset_detail(conn: &Connection, asset_id: i64) -> Result<AssetDetail, String> {
    let asset = conn.query_row(
        "SELECT id, folder_id, file_path, file_name, file_ext, file_size, width, height, thumb_path, modified_at
         FROM assets WHERE id = ?1",
        params![asset_id],
        |row| Ok(AssetInfo {
            id: row.get(0)?, folder_id: row.get(1)?, file_path: row.get(2)?,
            file_name: row.get(3)?, file_ext: row.get(4)?, file_size: row.get(5)?,
            width: row.get::<_, u32>(6).unwrap_or(0), height: row.get::<_, u32>(7).unwrap_or(0),
            thumb_path: row.get(8)?, modified_at: row.get(9)?,
        }),
    ).map_err(|e| format!("查询资产失败: {}", e))?;

    let tags = get_asset_tags(conn, asset_id)?;
    let rating = get_rating(conn, asset_id);
    let note = get_note(conn, asset_id);

    Ok(AssetDetail { asset, tags, rating, note })
}

// ---- Smart Folder CRUD ----

pub fn create_smart_folder(conn: &Connection, name: &str, conditions: &str, space_type: &str) -> Result<SmartFolder, String> {
    conn.execute(
        "INSERT INTO smart_folders (name, conditions, space_type) VALUES (?1, ?2, ?3)",
        params![name, conditions, space_type],
    ).map_err(|e| format!("创建智能文件夹失败: {}", e))?;

    let id = conn.last_insert_rowid();
    Ok(SmartFolder { id, name: name.to_string(), icon: "folder".to_string(), conditions: conditions.to_string(), space_type: space_type.to_string() })
}

pub fn update_smart_folder(conn: &Connection, id: i64, name: &str, conditions: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE smart_folders SET name = ?1, conditions = ?2 WHERE id = ?3",
        params![name, conditions, id],
    ).map_err(|e| format!("更新智能文件夹失败: {}", e))?;
    Ok(())
}

pub fn delete_smart_folder(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM smart_folders WHERE id = ?1", params![id])
        .map_err(|e| format!("删除智能文件夹失败: {}", e))?;
    Ok(())
}

pub fn get_smart_folders(conn: &Connection, space_type: Option<&str>) -> Result<Vec<SmartFolder>, String> {
    let mut sql = String::from("SELECT id, name, icon, conditions, space_type FROM smart_folders");
    if let Some(st) = space_type {
        sql.push_str(&format!(" WHERE space_type = '{}'", st));
    }
    sql.push_str(" ORDER BY name");

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let folders = stmt.query_map([], |row| {
        Ok(SmartFolder {
            id: row.get(0)?, name: row.get(1)?, icon: row.get(2)?,
            conditions: row.get(3)?, space_type: row.get(4)?,
        })
    }).map_err(|e| e.to_string())?
      .filter_map(|r| r.ok())
      .collect();
    Ok(folders)
}

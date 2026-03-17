use rusqlite::{Connection, params};
use serde::{Serialize, Deserialize};
use std::sync::{Arc, Mutex};
use std::path::PathBuf;
use std::thread::JoinHandle;

// ---- Data Types ----

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShareInfo {
    pub id: i64,
    pub folder_id: i64,
    pub folder_name: String,
    pub token: String,
    pub created_by: String,
    pub created_at: i64,
    pub expires_at: Option<i64>,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShareServerStatus {
    pub running: bool,
    pub url: String,
    pub port: u16,
}

// ---- State ----

pub struct ShareState {
    pub server_handle: Mutex<Option<JoinHandle<()>>>,
    pub server_shutdown: Arc<Mutex<bool>>,
    pub port: Mutex<u16>,
    pub running: Mutex<bool>,
}

impl ShareState {
    pub fn new() -> Self {
        Self {
            server_handle: Mutex::new(None),
            server_shutdown: Arc::new(Mutex::new(false)),
            port: Mutex::new(18900),
            running: Mutex::new(false),
        }
    }
}

// ---- CRUD (operate on caller-provided Connection) ----

pub fn create_share(conn: &Connection, folder_id: i64, created_by: &str) -> Result<ShareInfo, String> {
    let token = generate_token();

    conn.query_row(
        "SELECT id FROM folders WHERE id = ?1",
        params![folder_id],
        |_| Ok(()),
    ).map_err(|_| "文件夹不存在".to_string())?;

    conn.execute(
        "INSERT INTO folder_shares (folder_id, token, created_by) VALUES (?1, ?2, ?3)",
        params![folder_id, token, created_by],
    ).map_err(|e| format!("创建分享失败: {}", e))?;

    let id = conn.last_insert_rowid();

    let folder_name: String = conn.query_row(
        "SELECT name FROM folders WHERE id = ?1",
        params![folder_id],
        |row| row.get(0),
    ).unwrap_or_default();

    let created_at: i64 = conn.query_row(
        "SELECT created_at FROM folder_shares WHERE id = ?1",
        params![id],
        |row| row.get(0),
    ).unwrap_or(0);

    Ok(ShareInfo {
        id,
        folder_id,
        folder_name,
        token,
        created_by: created_by.to_string(),
        created_at,
        expires_at: None,
        is_active: true,
    })
}

pub fn revoke_share(conn: &Connection, share_id: i64) -> Result<(), String> {
    conn.execute(
        "UPDATE folder_shares SET is_active = 0 WHERE id = ?1",
        params![share_id],
    ).map_err(|e| format!("撤销分享失败: {}", e))?;
    Ok(())
}

pub fn get_shares(conn: &Connection, folder_id: Option<i64>) -> Result<Vec<ShareInfo>, String> {
    let sql = if folder_id.is_some() {
        "SELECT fs.id, fs.folder_id, f.name, fs.token, fs.created_by, fs.created_at, fs.expires_at, fs.is_active
         FROM folder_shares fs JOIN folders f ON fs.folder_id = f.id
         WHERE fs.folder_id = ?1 AND fs.is_active = 1
         ORDER BY fs.created_at DESC"
    } else {
        "SELECT fs.id, fs.folder_id, f.name, fs.token, fs.created_by, fs.created_at, fs.expires_at, fs.is_active
         FROM folder_shares fs JOIN folders f ON fs.folder_id = f.id
         WHERE fs.is_active = 1
         ORDER BY fs.created_at DESC"
    };

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;

    let rows = if let Some(fid) = folder_id {
        stmt.query_map(params![fid], map_share_row)
    } else {
        stmt.query_map([], map_share_row)
    };

    let shares = rows
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(shares)
}

fn map_share_row(row: &rusqlite::Row) -> rusqlite::Result<ShareInfo> {
    Ok(ShareInfo {
        id: row.get(0)?,
        folder_id: row.get(1)?,
        folder_name: row.get(2)?,
        token: row.get(3)?,
        created_by: row.get(4)?,
        created_at: row.get(5)?,
        expires_at: row.get(6)?,
        is_active: row.get::<_, i64>(7)? != 0,
    })
}

fn get_share_by_token(conn: &Connection, token: &str) -> Result<ShareInfo, String> {
    conn.query_row(
        "SELECT fs.id, fs.folder_id, f.name, fs.token, fs.created_by, fs.created_at, fs.expires_at, fs.is_active
         FROM folder_shares fs JOIN folders f ON fs.folder_id = f.id
         WHERE fs.token = ?1 AND fs.is_active = 1",
        params![token],
        map_share_row,
    ).map_err(|_| "分享不存在或已失效".to_string())
}

fn generate_token() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ts = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    let rand_part: u64 = (ts as u64).wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
    format!("{:016x}{:016x}", ts as u64, rand_part)
}

fn open_readonly_connection(db_path: &std::path::Path) -> Result<Connection, String> {
    let conn = Connection::open_with_flags(
        db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ).map_err(|e| format!("打开数据库失败: {}", e))?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")
        .map_err(|e| format!("设置数据库参数失败: {}", e))?;
    Ok(conn)
}

// ---- HTTP Server ----

pub fn start_server(
    share_state: &ShareState,
    db_path: PathBuf,
    thumb_dir: PathBuf,
) -> Result<ShareServerStatus, String> {
    {
        let running = share_state.running.lock().map_err(|e| e.to_string())?;
        if *running {
            let port = *share_state.port.lock().map_err(|e| e.to_string())?;
            let url = format!("http://{}:{}", get_local_ip(), port);
            return Ok(ShareServerStatus { running: true, url, port });
        }
    }

    let mut port = 18900u16;
    let server = loop {
        match tiny_http::Server::http(format!("0.0.0.0:{}", port)) {
            Ok(s) => break s,
            Err(_) => {
                port += 1;
                if port > 18920 {
                    return Err("无法找到可用端口 (18900-18920)".to_string());
                }
            }
        }
    };

    *share_state.port.lock().map_err(|e| e.to_string())? = port;
    *share_state.running.lock().map_err(|e| e.to_string())? = true;

    let shutdown = share_state.server_shutdown.clone();
    *shutdown.lock().map_err(|e| e.to_string())? = false;

    let handle = std::thread::spawn(move || {
        run_server(server, db_path, thumb_dir, shutdown);
    });

    *share_state.server_handle.lock().map_err(|e| e.to_string())? = Some(handle);

    let local_ip = get_local_ip();
    let url = format!("http://{}:{}", local_ip, port);
    Ok(ShareServerStatus { running: true, url, port })
}

pub fn stop_server(share_state: &ShareState) -> Result<(), String> {
    {
        let mut shutdown = share_state.server_shutdown.lock().map_err(|e| e.to_string())?;
        *shutdown = true;
    }
    *share_state.running.lock().map_err(|e| e.to_string())? = false;

    let mut handle_lock = share_state.server_handle.lock().map_err(|e| e.to_string())?;
    if let Some(handle) = handle_lock.take() {
        let port = *share_state.port.lock().map_err(|e| e.to_string())?;
        let _ = std::net::TcpStream::connect(format!("127.0.0.1:{}", port));
        let _ = handle.join();
    }
    Ok(())
}

pub fn get_server_status(share_state: &ShareState) -> ShareServerStatus {
    let running = *share_state.running.lock().unwrap_or_else(|e| e.into_inner());
    let port = *share_state.port.lock().unwrap_or_else(|e| e.into_inner());
    let url = if running {
        format!("http://{}:{}", get_local_ip(), port)
    } else {
        String::new()
    };
    ShareServerStatus { running, url, port }
}

fn get_local_ip() -> String {
    local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .unwrap_or_else(|_| "127.0.0.1".to_string())
}

fn run_server(
    server: tiny_http::Server,
    db_path: PathBuf,
    _thumb_dir: PathBuf,
    shutdown: Arc<Mutex<bool>>,
) {
    let conn = match open_readonly_connection(&db_path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[ShareServer] 无法打开数据库: {}", e);
            return;
        }
    };

    loop {
        if *shutdown.lock().unwrap_or_else(|e| e.into_inner()) {
            break;
        }

        let request = match server.recv_timeout(std::time::Duration::from_millis(500)) {
            Ok(Some(req)) => req,
            Ok(None) => continue,
            Err(_) => break,
        };

        if *shutdown.lock().unwrap_or_else(|e| e.into_inner()) {
            break;
        }

        let url = request.url().to_string();
        let (path, _query) = if let Some(idx) = url.find('?') {
            (&url[..idx], &url[idx+1..])
        } else {
            (url.as_str(), "")
        };

        let segments: Vec<&str> = path.trim_start_matches('/').splitn(5, '/').collect();

        match segments.as_slice() {
            ["share", token] => {
                handle_share_page(&conn, request, token);
            }
            ["api", "share", token, action] => {
                handle_api_request(&conn, request, token, action, "", &url);
            }
            ["api", "share", token, action, extra] => {
                handle_api_request(&conn, request, token, action, extra, &url);
            }
            _ => {
                let resp = tiny_http::Response::from_string("404 Not Found")
                    .with_status_code(404);
                let _ = request.respond(resp);
            }
        }
    }
}

fn handle_share_page(
    conn: &Connection,
    request: tiny_http::Request,
    token: &str,
) {
    match get_share_by_token(conn, token) {
        Ok(share) => {
            let html = generate_viewer_html(&share.folder_name, token);
            let resp = tiny_http::Response::from_string(html)
                .with_header("Content-Type: text/html; charset=utf-8".parse::<tiny_http::Header>().unwrap());
            let _ = request.respond(resp);
        }
        Err(_) => {
            let html = r#"<!DOCTYPE html><html><head><meta charset="utf-8"><title>分享已失效</title></head>
            <body style="background:#0a0a0a;color:#888;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif">
            <div style="text-align:center"><h2 style="color:#ef4444">分享链接无效或已过期</h2><p>请联系分享者获取新的链接</p></div>
            </body></html>"#;
            let resp = tiny_http::Response::from_string(html)
                .with_status_code(404)
                .with_header("Content-Type: text/html; charset=utf-8".parse::<tiny_http::Header>().unwrap());
            let _ = request.respond(resp);
        }
    }
}

fn handle_api_request(
    conn: &Connection,
    request: tiny_http::Request,
    token: &str,
    action: &str,
    extra: &str,
    full_url: &str,
) {
    let share = match get_share_by_token(conn, token) {
        Ok(s) => s,
        Err(_) => {
            let resp = tiny_http::Response::from_string(r#"{"error":"分享不存在或已失效"}"#)
                .with_status_code(404)
                .with_header("Content-Type: application/json; charset=utf-8".parse::<tiny_http::Header>().unwrap());
            let _ = request.respond(resp);
            return;
        }
    };

    let folder_path: String = match conn.query_row(
        "SELECT path FROM folders WHERE id = ?1",
        params![share.folder_id],
        |row| row.get(0),
    ) {
        Ok(p) => p,
        Err(_) => {
            let resp = tiny_http::Response::from_string(r#"{"error":"文件夹不存在"}"#)
                .with_status_code(404)
                .with_header("Content-Type: application/json; charset=utf-8".parse::<tiny_http::Header>().unwrap());
            let _ = request.respond(resp);
            return;
        }
    };

    let cors: tiny_http::Header = "Access-Control-Allow-Origin: *".parse().unwrap();
    let json_ct: tiny_http::Header = "Content-Type: application/json; charset=utf-8".parse().unwrap();

    match action {
        "info" => {
            let asset_count: i64 = conn.query_row(
                "SELECT COUNT(*) FROM assets WHERE folder_id = ?1",
                params![share.folder_id],
                |row| row.get(0),
            ).unwrap_or(0);

            let json = serde_json::json!({
                "folder_name": share.folder_name,
                "asset_count": asset_count,
                "created_at": share.created_at,
                "folder_accessible": std::path::Path::new(&folder_path).exists(),
            });

            let resp = tiny_http::Response::from_string(json.to_string())
                .with_header(json_ct)
                .with_header(cors);
            let _ = request.respond(resp);
        }
        "assets" => {
            let query_string = full_url.find('?').map(|i| &full_url[i+1..]).unwrap_or("");
            let params = parse_query_params(query_string);
            let page: i64 = params.get("page").and_then(|v| v.parse().ok()).unwrap_or(1).max(1);
            let page_size: i64 = params.get("page_size").and_then(|v| v.parse().ok()).unwrap_or(50).clamp(1, 200);
            let offset = (page - 1) * page_size;

            let total: i64 = conn.query_row(
                "SELECT COUNT(*) FROM assets WHERE folder_id = ?1",
                params![share.folder_id],
                |row| row.get(0),
            ).unwrap_or(0);

            let mut stmt = conn.prepare(
                "SELECT id, file_name, file_ext, file_size, width, height, modified_at
                 FROM assets WHERE folder_id = ?1
                 ORDER BY file_name ASC
                 LIMIT ?2 OFFSET ?3"
            ).unwrap();

            let assets: Vec<serde_json::Value> = stmt.query_map(
                rusqlite::params![share.folder_id, page_size, offset],
                |row| {
                    let id: i64 = row.get(0)?;
                    Ok(serde_json::json!({
                        "id": id,
                        "file_name": row.get::<_, String>(1)?,
                        "file_ext": row.get::<_, String>(2)?,
                        "file_size": row.get::<_, i64>(3)?,
                        "width": row.get::<_, u32>(4).unwrap_or(0),
                        "height": row.get::<_, u32>(5).unwrap_or(0),
                        "modified_at": row.get::<_, i64>(6)?,
                        "thumb_url": format!("/api/share/{}/thumb/{}", token, id),
                        "file_url": format!("/api/share/{}/file/{}", token, id),
                    }))
                },
            ).unwrap().filter_map(|r| r.ok()).collect();

            let json = serde_json::json!({
                "assets": assets,
                "total": total,
                "page": page,
                "page_size": page_size,
            });

            let resp = tiny_http::Response::from_string(json.to_string())
                .with_header(json_ct)
                .with_header(cors);
            let _ = request.respond(resp);
        }
        "thumb" => {
            serve_file(conn, request, share.folder_id, extra, true);
        }
        "file" => {
            serve_file(conn, request, share.folder_id, extra, false);
        }
        _ => {
            let resp = tiny_http::Response::from_string(r#"{"error":"未知接口"}"#)
                .with_status_code(404)
                .with_header(json_ct)
                .with_header(cors);
            let _ = request.respond(resp);
        }
    }
}

fn serve_file(
    conn: &Connection,
    request: tiny_http::Request,
    folder_id: i64,
    asset_id_str: &str,
    is_thumb: bool,
) {
    let asset_id: i64 = match asset_id_str.parse() {
        Ok(id) => id,
        Err(_) => {
            let resp = tiny_http::Response::from_string("400 Bad Request").with_status_code(400);
            let _ = request.respond(resp);
            return;
        }
    };

    let (file_path, thumb_path): (String, String) = match conn.query_row(
        "SELECT file_path, thumb_path FROM assets WHERE id = ?1 AND folder_id = ?2",
        params![asset_id, folder_id],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
    ) {
        Ok(paths) => paths,
        Err(_) => {
            let resp = tiny_http::Response::from_string("404 Not Found").with_status_code(404);
            let _ = request.respond(resp);
            return;
        }
    };

    let target_path = if is_thumb && !thumb_path.is_empty() {
        thumb_path
    } else {
        file_path
    };

    let path = std::path::Path::new(&target_path);
    if !path.exists() {
        let resp = tiny_http::Response::from_string("404 File Not Found").with_status_code(404);
        let _ = request.respond(resp);
        return;
    }

    let file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => {
            let resp = tiny_http::Response::from_string("500 Cannot Read File").with_status_code(500);
            let _ = request.respond(resp);
            return;
        }
    };

    let content_type = match path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase().as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "tiff" | "tif" => "image/tiff",
        "ico" => "image/x-icon",
        "psd" => "application/octet-stream",
        "tga" => "image/x-tga",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "avi" => "video/x-msvideo",
        _ => "application/octet-stream",
    };

    let header_ct: tiny_http::Header = format!("Content-Type: {}", content_type).parse().unwrap();
    let header_cors: tiny_http::Header = "Access-Control-Allow-Origin: *".parse().unwrap();
    let header_cache: tiny_http::Header = "Cache-Control: public, max-age=3600".parse().unwrap();

    let resp = tiny_http::Response::from_file(file)
        .with_header(header_ct)
        .with_header(header_cors)
        .with_header(header_cache);

    let _ = request.respond(resp);
}

fn parse_query_params(qs: &str) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    for pair in qs.split('&') {
        if let Some(idx) = pair.find('=') {
            map.insert(pair[..idx].to_string(), pair[idx+1..].to_string());
        }
    }
    map
}

// ---- Embedded HTML Viewer ----

fn generate_viewer_html(folder_name: &str, token: &str) -> String {
    let escaped_name = folder_name.replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;");
    format!(r#"<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{name} - ArtHub 分享</title>
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{background:#0a0a0a;color:#e0e0e0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;min-height:100vh}}
.header{{background:#111;border-bottom:1px solid #222;padding:16px 24px;display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:100}}
.logo{{width:28px;height:28px;background:linear-gradient(135deg,#3b82f6,#8b5cf6);border-radius:6px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;color:#fff}}
.header h1{{font-size:16px;font-weight:600;flex:1}}
.header .info{{font-size:12px;color:#666}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;padding:20px 24px}}
.card{{background:#141414;border:1px solid #1a1a1a;border-radius:8px;overflow:hidden;cursor:pointer;transition:all .2s}}
.card:hover{{border-color:#333;transform:translateY(-2px);box-shadow:0 4px 12px rgba(0,0,0,.4)}}
.card img{{width:100%;aspect-ratio:1;object-fit:cover;background:#0d0d0d;display:block}}
.card .meta{{padding:8px 10px}}
.card .name{{font-size:11px;color:#ccc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}
.card .detail{{font-size:10px;color:#555;margin-top:3px;display:flex;gap:8px}}
.loading{{text-align:center;padding:60px;color:#555;font-size:14px}}
.empty{{text-align:center;padding:80px;color:#555}}
.empty svg{{margin-bottom:12px;opacity:.3}}
.lightbox{{position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:200;display:flex;align-items:center;justify-content:center;cursor:zoom-out}}
.lightbox img{{max-width:90vw;max-height:90vh;object-fit:contain;border-radius:4px}}
.lightbox .lb-info{{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#111;border:1px solid #222;border-radius:8px;padding:8px 16px;font-size:12px;color:#999;display:flex;gap:16px}}
.load-more{{text-align:center;padding:20px}}
.load-more button{{background:#1a1a1a;border:1px solid #333;color:#ccc;padding:8px 24px;border-radius:6px;cursor:pointer;font-size:13px}}
.load-more button:hover{{background:#222;border-color:#444}}
.offline{{background:#7f1d1d;color:#fca5a5;padding:12px 24px;text-align:center;font-size:13px}}
@media(max-width:640px){{.grid{{grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;padding:12px}}.header{{padding:12px 16px}}.header h1{{font-size:14px}}}}
</style>
</head>
<body>
<div class="header">
  <div class="logo">A</div>
  <h1 id="folderName">{name}</h1>
  <div class="info" id="assetCount"></div>
</div>
<div id="offlineBanner" class="offline" style="display:none">文件夹当前不可访问，显示的是缓存数据</div>
<div id="grid" class="grid"></div>
<div id="loadMore" class="load-more" style="display:none"><button onclick="loadMore()">加载更多</button></div>
<div id="loading" class="loading">加载中...</div>
<div id="empty" class="empty" style="display:none">
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>
  <p>此文件夹中没有资源</p>
</div>
<div id="lightbox" class="lightbox" style="display:none" onclick="closeLightbox()">
  <img id="lbImg" src="">
  <div class="lb-info" id="lbInfo"></div>
</div>
<script>
const TOKEN="{token}";
let page=1,pageSize=50,total=0,allAssets=[];
async function loadInfo(){{
  try{{
    const r=await fetch(`/api/share/${{TOKEN}}/info`);
    const d=await r.json();
    if(d.error)return;
    document.getElementById('folderName').textContent=d.folder_name;
    document.getElementById('assetCount').textContent=d.asset_count+' 个资源';
    if(!d.folder_accessible)document.getElementById('offlineBanner').style.display='block';
  }}catch(e){{console.error(e)}}
}}
async function loadAssets(){{
  try{{
    const r=await fetch(`/api/share/${{TOKEN}}/assets?page=${{page}}&page_size=${{pageSize}}`);
    const d=await r.json();
    if(d.error)return;
    total=d.total;
    allAssets=allAssets.concat(d.assets);
    renderGrid();
    document.getElementById('loading').style.display='none';
    if(allAssets.length<total)document.getElementById('loadMore').style.display='block';
    else document.getElementById('loadMore').style.display='none';
    if(total===0)document.getElementById('empty').style.display='block';
  }}catch(e){{
    document.getElementById('loading').textContent='加载失败，请检查网络连接';
    console.error(e);
  }}
}}
function loadMore(){{page++;loadAssets()}}
function renderGrid(){{
  const g=document.getElementById('grid');
  g.innerHTML='';
  allAssets.forEach((a,i)=>{{
    const c=document.createElement('div');
    c.className='card';
    c.onclick=()=>openLightbox(i);
    const sz=a.file_size>1048576?(a.file_size/1048576).toFixed(1)+'MB':(a.file_size/1024).toFixed(0)+'KB';
    const dim=a.width&&a.height?a.width+'×'+a.height:'';
    c.innerHTML=`<img src="${{a.thumb_url}}" alt="${{a.file_name}}" loading="lazy" onerror="this.style.display='none'">
      <div class="meta"><div class="name" title="${{a.file_name}}">${{a.file_name}}</div>
      <div class="detail"><span>${{a.file_ext.toUpperCase()}}</span><span>${{sz}}</span>${{dim?'<span>'+dim+'</span>':''}}</div></div>`;
    g.appendChild(c);
  }});
}}
function openLightbox(i){{
  const a=allAssets[i];
  document.getElementById('lbImg').src=a.file_url;
  const sz=a.file_size>1048576?(a.file_size/1048576).toFixed(1)+'MB':(a.file_size/1024).toFixed(0)+'KB';
  const dim=a.width&&a.height?a.width+'×'+a.height:'';
  document.getElementById('lbInfo').innerHTML=`<span>${{a.file_name}}</span><span>${{a.file_ext.toUpperCase()}}</span><span>${{sz}}</span>${{dim?'<span>'+dim+'</span>':''}}`;
  document.getElementById('lightbox').style.display='flex';
  document.body.style.overflow='hidden';
}}
function closeLightbox(){{
  document.getElementById('lightbox').style.display='none';
  document.body.style.overflow='';
}}
document.addEventListener('keydown',e=>{{if(e.key==='Escape')closeLightbox()}});
loadInfo();loadAssets();
</script>
</body>
</html>"#, name=escaped_name, token=token)
}

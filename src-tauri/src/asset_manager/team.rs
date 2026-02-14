use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const ARTHUB_DIR: &str = ".arthub";
const LOCKS_DIR: &str = "locks";
const VERSIONS_DIR: &str = "versions";
const USERS_DIR: &str = "users";
const PERMISSIONS_FILE: &str = "permissions.json";
const LOCK_TIMEOUT_SECS: u64 = 300;

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

fn ensure_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| format!("mkdir fail {}: {}", path.display(), e))
}

// ==== JSONL Action Logs ====

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionLog {
    pub timestamp: u64,
    pub user: String,
    pub machine: String,
    pub action: String,
    pub target_path: String,
    pub data: String,
}

fn user_log_path(root: &Path, user: &str) -> PathBuf {
    root.join(ARTHUB_DIR).join(USERS_DIR).join(user).join("actions.jsonl")
}

pub fn append_action(root: &Path, user: &str, machine: &str, action: &str, target: &str, data: &str) -> Result<(), String> {
    let p = user_log_path(root, user);
    ensure_dir(p.parent().unwrap())?;
    let entry = ActionLog {
        timestamp: now_secs(), user: user.into(), machine: machine.into(),
        action: action.into(), target_path: target.into(), data: data.into(),
    };
    let mut line = serde_json::to_string(&entry).map_err(|e| e.to_string())?;
    line.push('\n');
    let mut f = fs::OpenOptions::new().create(true).append(true).open(&p).map_err(|e| e.to_string())?;
    f.write_all(line.as_bytes()).map_err(|e| e.to_string())
}

pub fn read_actions_since(root: &Path, since: u64) -> Result<Vec<ActionLog>, String> {
    let dir = root.join(ARTHUB_DIR).join(USERS_DIR);
    if !dir.exists() { return Ok(vec![]); }
    let mut all = vec![];
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let lp = entry.path().join("actions.jsonl");
        if !lp.exists() { continue; }
        let f = fs::File::open(&lp).map_err(|e| e.to_string())?;
        for line in BufReader::new(f).lines().flatten() {
            let t = line.trim().to_string();
            if t.is_empty() { continue; }
            if let Ok(a) = serde_json::from_str::<ActionLog>(&t) {
                if a.timestamp >= since { all.push(a); }
            }
        }
    }
    all.sort_by_key(|a| a.timestamp);
    Ok(all)
}

// ==== File Locking ====

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileLock {
    pub file_path: String,
    pub locked_by: String,
    pub machine: String,
    pub locked_at: u64,
    pub heartbeat: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LockStatus {
    pub is_locked: bool,
    pub locked_by: Option<String>,
    pub machine: Option<String>,
    pub locked_at: Option<u64>,
    pub is_stale: bool,
}

fn lock_fp(root: &Path, fp: &str) -> PathBuf {
    let h = fp.bytes().fold(0u64, |a, b| a.wrapping_mul(31).wrapping_add(b as u64));
    root.join(ARTHUB_DIR).join(LOCKS_DIR).join(format!("{:016x}.lock", h))
}

pub fn acquire_lock(root: &Path, fp: &str, user: &str, machine: &str) -> Result<bool, String> {
    let lp = lock_fp(root, fp);
    ensure_dir(lp.parent().unwrap())?;
    if lp.exists() {
        if let Ok(ex) = serde_json::from_str::<FileLock>(&fs::read_to_string(&lp).unwrap_or_default()) {
            let now = now_secs();
            if now - ex.heartbeat < LOCK_TIMEOUT_SECS {
                if ex.locked_by == user && ex.machine == machine {
                    let r = FileLock { heartbeat: now, ..ex };
                    fs::write(&lp, serde_json::to_string_pretty(&r).unwrap()).ok();
                    return Ok(true);
                }
                return Ok(false);
            }
        }
    }
    let now = now_secs();
    let lock = FileLock { file_path: fp.into(), locked_by: user.into(), machine: machine.into(), locked_at: now, heartbeat: now };
    fs::write(&lp, serde_json::to_string_pretty(&lock).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(true)
}

pub fn release_lock(root: &Path, fp: &str, user: &str) -> Result<bool, String> {
    let lp = lock_fp(root, fp);
    if !lp.exists() { return Ok(true); }
    if let Ok(ex) = serde_json::from_str::<FileLock>(&fs::read_to_string(&lp).unwrap_or_default()) {
        if ex.locked_by != user { return Err("Cannot release others lock".into()); }
    }
    fs::remove_file(&lp).map_err(|e| e.to_string())?;
    Ok(true)
}

pub fn refresh_heartbeat(root: &Path, fp: &str, user: &str) -> Result<bool, String> {
    let lp = lock_fp(root, fp);
    if !lp.exists() { return Ok(false); }
    let c = fs::read_to_string(&lp).map_err(|e| e.to_string())?;
    if let Ok(mut lock) = serde_json::from_str::<FileLock>(&c) {
        if lock.locked_by == user {
            lock.heartbeat = now_secs();
            fs::write(&lp, serde_json::to_string_pretty(&lock).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            return Ok(true);
        }
    }
    Ok(false)
}

pub fn check_lock(root: &Path, fp: &str) -> LockStatus {
    let lp = lock_fp(root, fp);
    if !lp.exists() {
        return LockStatus { is_locked: false, locked_by: None, machine: None, locked_at: None, is_stale: false };
    }
    match serde_json::from_str::<FileLock>(&fs::read_to_string(&lp).unwrap_or_default()) {
        Ok(l) => {
            let stale = now_secs() - l.heartbeat >= LOCK_TIMEOUT_SECS;
            LockStatus { is_locked: !stale, locked_by: Some(l.locked_by), machine: Some(l.machine), locked_at: Some(l.locked_at), is_stale: stale }
        }
        Err(_) => LockStatus { is_locked: false, locked_by: None, machine: None, locked_at: None, is_stale: true },
    }
}

pub fn get_all_locks(root: &Path) -> Result<Vec<FileLock>, String> {
    let dir = root.join(ARTHUB_DIR).join(LOCKS_DIR);
    if !dir.exists() { return Ok(vec![]); }
    let now = now_secs();
    let mut locks = vec![];
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let p = entry.path();
        if p.extension().map_or(false, |e| e == "lock") {
            if let Ok(l) = serde_json::from_str::<FileLock>(&fs::read_to_string(&p).unwrap_or_default()) {
                if now - l.heartbeat < LOCK_TIMEOUT_SECS { locks.push(l); }
                else { fs::remove_file(&p).ok(); }
            }
        }
    }
    Ok(locks)
}

// ==== Version Control ====

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileVersion {
    pub version: u32,
    pub author: String,
    pub timestamp: u64,
    pub comment: String,
    pub snapshot_name: String,
    pub file_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileHistory {
    pub file_path: String,
    pub current_version: u32,
    pub versions: Vec<FileVersion>,
}

fn file_hash(fp: &str) -> String {
    format!("{:016x}", fp.bytes().fold(0u64, |a, b| a.wrapping_mul(31).wrapping_add(b as u64)))
}

fn ver_dir(root: &Path, fp: &str) -> PathBuf {
    root.join(ARTHUB_DIR).join(VERSIONS_DIR).join(file_hash(fp))
}

fn hist_path(root: &Path, fp: &str) -> PathBuf {
    ver_dir(root, fp).join("history.json")
}

pub fn get_file_history(root: &Path, fp: &str) -> Result<Option<FileHistory>, String> {
    let hp = hist_path(root, fp);
    if !hp.exists() { return Ok(None); }
    let c = fs::read_to_string(&hp).map_err(|e| e.to_string())?;
    Ok(Some(serde_json::from_str(&c).map_err(|e| e.to_string())?))
}

pub fn create_version(root: &Path, fp: &str, actual: &Path, author: &str, comment: &str) -> Result<FileVersion, String> {
    let vd = ver_dir(root, fp);
    ensure_dir(&vd)?;
    let mut hist = get_file_history(root, fp)?.unwrap_or(FileHistory {
        file_path: fp.into(), current_version: 0, versions: vec![],
    });
    let nv = hist.current_version + 1;
    let ext = Path::new(fp).extension().map_or("bin".into(), |e| e.to_string_lossy().to_string());
    let snap = format!("v{}_{}.{}", nv, now_secs(), ext);
    fs::copy(actual, vd.join(&snap)).map_err(|e| e.to_string())?;
    let sz = actual.metadata().map(|m| m.len()).unwrap_or(0);
    let v = FileVersion { version: nv, author: author.into(), timestamp: now_secs(), comment: comment.into(), snapshot_name: snap, file_size: sz };
    hist.versions.push(v.clone());
    hist.current_version = nv;
    fs::write(hist_path(root, fp), serde_json::to_string_pretty(&hist).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(v)
}

pub fn restore_version(root: &Path, fp: &str, ver: u32, target: &Path) -> Result<(), String> {
    let h = get_file_history(root, fp)?.ok_or("No history".to_string())?;
    let v = h.versions.iter().find(|v| v.version == ver).ok_or(format!("Version {} not found", ver))?;
    let snap = ver_dir(root, fp).join(&v.snapshot_name);
    if !snap.exists() { return Err("Snapshot missing".into()); }
    fs::copy(&snap, target).map_err(|e| e.to_string())?;
    Ok(())
}

// ==== Permissions ====

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Permission {
    pub user: String,
    pub role: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectPermission {
    pub project_path: String,
    pub permissions: Vec<Permission>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionsConfig {
    pub global: Vec<Permission>,
    pub projects: Vec<ProjectPermission>,
}

fn perm_path(root: &Path) -> PathBuf {
    root.join(ARTHUB_DIR).join(PERMISSIONS_FILE)
}

pub fn load_permissions(root: &Path) -> Result<PermissionsConfig, String> {
    let p = perm_path(root);
    if !p.exists() { return Ok(PermissionsConfig { global: vec![], projects: vec![] }); }
    let c = fs::read_to_string(&p).map_err(|e| e.to_string())?;
    serde_json::from_str(&c).map_err(|e| e.to_string())
}

pub fn save_permissions(root: &Path, cfg: &PermissionsConfig) -> Result<(), String> {
    let p = perm_path(root);
    ensure_dir(p.parent().unwrap())?;
    fs::write(&p, serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

pub fn get_user_role(cfg: &PermissionsConfig, user: &str, proj: Option<&str>) -> String {
    if let Some(pp) = proj {
        for p in &cfg.projects {
            if p.project_path == pp {
                for perm in &p.permissions {
                    if perm.user == user { return perm.role.clone(); }
                }
            }
        }
    }
    for perm in &cfg.global {
        if perm.user == user { return perm.role.clone(); }
    }
    "viewer".into()
}

pub fn set_user_permission(root: &Path, user: &str, role: &str, proj: Option<&str>) -> Result<(), String> {
    let mut cfg = load_permissions(root)?;
    if let Some(pp) = proj {
        if let Some(p) = cfg.projects.iter_mut().find(|p| p.project_path == pp) {
            if let Some(perm) = p.permissions.iter_mut().find(|p| p.user == user) {
                perm.role = role.into();
            } else {
                p.permissions.push(Permission { user: user.into(), role: role.into() });
            }
        } else {
            cfg.projects.push(ProjectPermission {
                project_path: pp.into(),
                permissions: vec![Permission { user: user.into(), role: role.into() }],
            });
        }
    } else {
        if let Some(perm) = cfg.global.iter_mut().find(|p| p.user == user) {
            perm.role = role.into();
        } else {
            cfg.global.push(Permission { user: user.into(), role: role.into() });
        }
    }
    save_permissions(root, &cfg)
}

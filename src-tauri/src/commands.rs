use crate::conn::{home_dir, list_local, preview_dir, Conn, SshClientHandler, SftpHandle};
use crate::sites::{Site, SiteStore};
use crate::transfer::{
    download_file, download_tree, upload_file, upload_tree, AbortMap, Progress,
};
use russh_sftp::client::SftpSession;
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

pub struct AppState {
    pub sessions: Mutex<HashMap<u32, Arc<Mutex<Conn>>>>,
    pub next_session: AtomicU32,
    pub aborts: AbortMap,
    pub sites: SiteStore,
}

impl AppState {
    pub fn new() -> Self {
        let data_dir = {
            if let Some(dir) = dirs_app_data() {
                dir
            } else {
                std::env::temp_dir().join("sile-data")
            }
        };
        Self {
            sessions: Mutex::new(HashMap::new()),
            next_session: AtomicU32::new(1),
            aborts: Arc::new(Mutex::new(HashMap::new())),
            sites: SiteStore::new(data_dir),
        }
    }
}

fn dirs_app_data() -> Option<std::path::PathBuf> {
    #[cfg(windows)]
    {
        std::env::var("APPDATA").ok().map(|d| Path::new(&d).join("sile"))
    }
    #[cfg(not(windows))]
    {
        std::env::var("XDG_CONFIG_HOME")
            .ok()
            .map(|d| Path::new(&d).join("sile"))
            .or_else(|| {
                std::env::var("HOME")
                    .ok()
                    .map(|h| Path::new(&h).join(".config/sile"))
            })
    }
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn site_list(state: tauri::State<'_, AppState>) -> Result<serde_json::Value, String> {
    let views = state.sites.list_views()?;
    serde_json::to_value(views).map_err(err)
}

#[tauri::command]
pub async fn site_save(state: tauri::State<'_, AppState>, site: Site) -> Result<(), String> {
    let mut s = site;
    if s.id.is_empty() {
        s.id = SiteStore::new_id();
    }
    state.sites.upsert(&s)
}

#[tauri::command]
pub async fn site_delete(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    state.sites.delete(&id)
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

pub use crate::conn::make_conn;

#[tauri::command]
pub async fn connect(
    state: tauri::State<'_, AppState>,
    site: Site,
    proxy: Option<crate::proxy::ProxyConfig>,
) -> Result<serde_json::Value, String> {
    let mut ftp_host_str = String::new();
    let conn = make_conn(&site, &proxy, &mut ftp_host_str).await?;
    let id = state.next_session.fetch_add(1, Ordering::SeqCst);
    state.sessions.lock().await.insert(id, Arc::new(Mutex::new(conn)));
    Ok(serde_json::json!({ "session_id": id }))
}

#[tauri::command]
pub async fn disconnect(state: tauri::State<'_, AppState>, session_id: u32) -> Result<(), String> {
    let removed = state.sessions.lock().await.remove(&session_id);
    if let Some(conn) = removed {
        let mut c = conn.lock().await;
        match &mut *c {
            Conn::Ftp(f) => {
                let _ = f.quit().await;
            }
            Conn::Ftps(f) => {
                let _ = f.quit().await;
            }
            Conn::Sftp(_) => {}
            Conn::Local => {}
        }
    }
    Ok(())
}

async fn session(
    state: &tauri::State<'_, AppState>,
    session_id: u32,
) -> Result<Arc<Mutex<Conn>>, String> {
    state
        .sessions
        .lock()
        .await
        .get(&session_id)
        .cloned()
        .ok_or_else(|| "not connected".to_string())
}// ---------------------------------------------------------------------------
// Remote FS commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn list_dir(
    state: tauri::State<'_, AppState>,
    session_id: u32,
    path: String,
) -> Result<serde_json::Value, String> {
    let conn = session(&state, session_id).await?;
    let mut c = conn.lock().await;
    let entries = c.list(&path).await?;
    serde_json::to_value(entries).map_err(err)
}

#[tauri::command]
pub async fn list_local_dir(path: String) -> Result<serde_json::Value, String> {
    let entries = list_local(Path::new(&path))?;
    serde_json::to_value(entries).map_err(err)
}

#[tauri::command]
pub async fn local_home() -> Result<String, String> {
    Ok(home_dir())
}

#[tauri::command]
pub async fn remote_home(session_id: u32) -> Result<String, String> {
    // frontend picks "/" for FTP and starts from site remote_start for SFTP
    let _ = session_id;
    Ok("/".to_string())
}

#[tauri::command]
pub async fn mkdir_remote(
    state: tauri::State<'_, AppState>,
    session_id: u32,
    path: String,
) -> Result<(), String> {
    let conn = session(&state, session_id).await?;
    let r = conn.lock().await.mkdir(&path).await;
    r
}

#[tauri::command]
pub async fn mkdir_local(path: String) -> Result<(), String> {
    tokio::fs::create_dir_all(&path).await.map_err(err)
}

#[tauri::command]
pub async fn remove_remote(
    state: tauri::State<'_, AppState>,
    session_id: u32,
    path: String,
    is_dir: bool,
) -> Result<(), String> {
    let conn = session(&state, session_id).await?;
    let mut c = conn.lock().await;
    if is_dir {
        c.remove_recursive(&path).await
    } else {
        c.remove_file(&path).await
    }
}

#[tauri::command]
pub async fn remove_local(path: String, is_dir: bool) -> Result<(), String> {
    if is_dir {
        tokio::fs::remove_dir_all(&path).await.map_err(err)
    } else {
        tokio::fs::remove_file(&path).await.map_err(err)
    }
}

#[tauri::command]
pub async fn rename_remote(
    state: tauri::State<'_, AppState>,
    session_id: u32,
    from: String,
    to: String,
) -> Result<(), String> {
    let conn = session(&state, session_id).await?;
    let r = conn.lock().await.rename(&from, &to).await;
    r
}

#[tauri::command]
pub async fn rename_local(from: String, to: String) -> Result<(), String> {
    tokio::fs::rename(&from, &to).await.map_err(err)
}

#[tauri::command]
pub async fn set_permissions(
    state: tauri::State<'_, AppState>,
    session_id: u32,
    path: String,
    mode: u32,
    recursive: bool,
) -> Result<(), String> {
    let conn = session(&state, session_id).await?;
    let r = conn
        .lock()
        .await
        .set_permissions(&path, mode, recursive)
        .await;
    r
}

#[tauri::command]
pub async fn read_text_remote(
    state: tauri::State<'_, AppState>,
    session_id: u32,
    path: String,
) -> Result<serde_json::Value, String> {
    let conn = session(&state, session_id).await?;
    let mut c = conn.lock().await;
    let r = c.read_text(&path).await?;
    Ok(serde_json::json!({ "content": r_text_content(&r), "truncated": r_text_truncated(&r) }))
}

fn r_text_content(r: &crate::conn::ReadResult) -> String {
    match r {
        crate::conn::ReadResult::Text { content, .. } => content.clone(),
    }
}
fn r_text_truncated(r: &crate::conn::ReadResult) -> bool {
    match r {
        crate::conn::ReadResult::Text { truncated, .. } => *truncated,
    }
}

#[tauri::command]
pub async fn write_text_remote(
    state: tauri::State<'_, AppState>,
    session_id: u32,
    path: String,
    content: String,
) -> Result<(), String> {
    let conn = session(&state, session_id).await?;
    let r = conn.lock().await.write_text(&path, &content).await;
    r
}

#[tauri::command]
pub async fn read_text_local(path: String) -> Result<serde_json::Value, String> {
    let md = tokio::fs::metadata(&path).await.map_err(err)?;
    let total = md.len() as usize;
    let take = total.min(4 * 1024 * 1024);
    use tokio::io::AsyncReadExt;
    let mut f = tokio::fs::File::open(&path).await.map_err(err)?;
    let mut buf = vec![0u8; take];
    f.read_exact(&mut buf).await.map_err(err)?;
    Ok(serde_json::json!({
        "content": String::from_utf8_lossy(&buf),
        "truncated": total > 4 * 1024 * 1024
    }))
}

#[tauri::command]
pub async fn write_text_local(path: String, content: String) -> Result<(), String> {
    tokio::fs::write(&path, content).await.map_err(err)
}

#[tauri::command]
pub async fn search_remote(
    state: tauri::State<'_, AppState>,
    session_id: u32,
    path: String,
    pattern: String,
    max_results: Option<u32>,
) -> Result<serde_json::Value, String> {
    let conn = session(&state, session_id).await?;
    let max = max_results.unwrap_or(500).min(5000) as usize;
    let mut c = conn.lock().await;
    let mut out = vec![];
    c.search_recursive(&path, &pattern, max, &mut out).await?;
    serde_json::to_value(out).map_err(err)
}

// ---------------------------------------------------------------------------
// Transfers
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
struct DownloadTask {
    session_id: u32,
    remote_path: String,
    local_path: String,
    is_dir: bool,
}

#[tauri::command]
pub async fn start_download(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    session_id: u32,
    remote_path: String,
    local_path: String,
    is_dir: bool,
    transfer_id: String,
) -> Result<(), String> {
    let conn = session(&state, session_id).await?;
    let abort = Arc::new(AtomicBool::new(false));
    state
        .aborts
        .lock()
        .await
        .insert(transfer_id.clone(), abort.clone());
    let app2 = app.clone();
    let abort2 = abort.clone();
    let tid = transfer_id.clone();
    tokio::spawn(async move {
        let result = if is_dir {
            download_tree(&conn, &remote_path, &local_path, &tid, &app2, &abort2).await
        } else {
            let mut prog = Progress::new(&tid, Some(&app2));
            let r = download_file(&conn, &remote_path, &local_path, 0, &mut prog, &abort2).await;
            match r {
                Ok(_) => Ok(()),
                Err(e) => Err(e),
            }
        };
        let (status, error) = match &result {
            Ok(_) => ("done", None),
            Err(e) if e == "__aborted" => ("aborted", None),
            Err(e) => ("error", Some(e.clone())),
        };
        let _ = app2.emit(
            "transfer-progress",
            crate::transfer::TransferEvent {
                id: tid.clone(),
                file_name: Path::new(&remote_path)
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string(),
                files_done: 1,
                files_total: 1,
                transferred: 0,
                total: 0,
                status: status.into(),
                error,
            },
        );
    });
    Ok(())
}

#[tauri::command]
pub async fn start_upload(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    session_id: u32,
    local_path: String,
    remote_path: String,
    is_dir: bool,
    transfer_id: String,
) -> Result<(), String> {
    let conn = session(&state, session_id).await?;
    let abort = Arc::new(AtomicBool::new(false));
    state
        .aborts
        .lock()
        .await
        .insert(transfer_id.clone(), abort.clone());
    let app2 = app.clone();
    let abort2 = abort.clone();
    let tid = transfer_id.clone();
    tokio::spawn(async move {
        let result = if is_dir {
            upload_tree(&conn, &local_path, &remote_path, &tid, &app2, &abort2).await
        } else {
            let mut prog = Progress::new(&tid, Some(&app2));
            upload_file(&conn, &local_path, &remote_path, 0, &mut prog, &abort2)
                .await
                .map(|_| ())
        };
        let (status, error) = match &result {
            Ok(_) => ("done", None),
            Err(e) if e == "__aborted" => ("aborted", None),
            Err(e) => ("error", Some(e.clone())),
        };
        let _ = app2.emit(
            "transfer-progress",
            crate::transfer::TransferEvent {
                id: tid.clone(),
                file_name: Path::new(&local_path)
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string(),
                files_done: 1,
                files_total: 1,
                transferred: 0,
                total: 0,
                status: status.into(),
                error,
            },
        );
    });
    Ok(())
}

#[tauri::command]
pub async fn start_copy_local(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    from: String,
    to: String,
    is_dir: bool,
    transfer_id: String,
) -> Result<(), String> {
    // local → local copy driven by the same transfer engine
    let conn = Arc::new(Mutex::new(Conn::Local));
    let abort = Arc::new(AtomicBool::new(false));
    state
        .aborts
        .lock()
        .await
        .insert(transfer_id.clone(), abort.clone());
    let app2 = app.clone();
    let abort2 = abort.clone();
    let tid = transfer_id.clone();
    tokio::spawn(async move {
        let result = if is_dir {
            crate::transfer::upload_tree(&conn, &from, &to, &tid, &app2, &abort2).await
        } else {
            // ensure parent exists
            if let Some(parent) = Path::new(&to).parent() {
                let _ = tokio::fs::create_dir_all(parent).await;
            }
            let mut prog = Progress::new(&tid, Some(&app2));
            crate::transfer::upload_file(&conn, &from, &to, 0, &mut prog, &abort2)
                .await
                .map(|_| ())
        };
        let (status, error) = match &result {
            Ok(_) => ("done", None),
            Err(e) if e == "__aborted" => ("aborted", None),
            Err(e) => ("error", Some(e.clone())),
        };
        let _ = app2.emit(
            "transfer-progress",
            crate::transfer::TransferEvent {
                id: tid,
                file_name: Path::new(&from)
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string(),
                files_done: 1,
                files_total: 1,
                transferred: 0,
                total: 0,
                status: status.into(),
                error,
            },
        );
    });
    Ok(())
}

#[tauri::command]
pub async fn site_get_password(state: tauri::State<'_, AppState>, id: String) -> Result<String, String> {
    Ok(state.sites.get_site(&id)?.password)
}

// ---------------------------------------------------------------------------
// Terminal (SSH shell over the SFTP session's connection)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn terminal_open(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    session_id: u32,
    term_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    let conn = session(&state, session_id).await?;
    crate::terminal::open_terminal(app, &conn, term_id, cols, rows).await
}

#[tauri::command]
pub async fn terminal_write(term_id: String, data: String) -> Result<(), String> {
    crate::terminal::terminal_write(&term_id, &data).await
}

#[tauri::command]
pub async fn terminal_resize(term_id: String, cols: u32, rows: u32) -> Result<(), String> {
    crate::terminal::terminal_resize(&term_id, cols, rows).await
}

#[tauri::command]
pub async fn terminal_close(term_id: String) -> Result<(), String> {
    crate::terminal::terminal_close(&term_id).await
}

#[tauri::command]
pub async fn abort_transfer(
    state: tauri::State<'_, AppState>,
    transfer_id: String,
) -> Result<(), String> {
    if let Some(flag) = state.aborts.lock().await.get(&transfer_id) {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn preview_prepare(path: String) -> Result<serde_json::Value, String> {
    // copy a local file into the preview dir and return its path for asset protocol
    let dir = preview_dir();
    let src = Path::new(&path);
    let name = src
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".to_string());
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dest = dir.join(format!("{}_{}", stamp, name));
    tokio::fs::copy(&path, &dest).await.map_err(err)?;
    Ok(serde_json::json!({ "path": dest.to_string_lossy() }))
}

#[tauri::command]
pub async fn preview_fetch_remote(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    session_id: u32,
    remote_path: String,
) -> Result<serde_json::Value, String> {
    // download a remote file into the preview dir so the asset protocol can serve it
    use crate::transfer::{download_file, Progress};
    let dir = preview_dir();
    let name = Path::new(&remote_path)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".to_string());
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dest = dir.join(format!("{}_{}", stamp, name));
    let conn = session(&state, session_id).await?;
    let abort = Arc::new(AtomicBool::new(false));
    let mut prog = Progress::new(&format!("preview-{}", stamp), Some(&app));
    download_file(&conn, &remote_path, &dest.to_string_lossy(), 0, &mut prog, &abort).await?;
    Ok(serde_json::json!({ "path": dest.to_string_lossy() }))
}

#[tauri::command]
pub async fn read_hex_remote(
    state: tauri::State<'_, AppState>,
    session_id: u32,
    path: String,
    limit: Option<u64>,
) -> Result<serde_json::Value, String> {
    let limit = limit.unwrap_or(4096).min(1 << 20) as usize;
    let conn = session(&state, session_id).await?;
    let mut c = conn.lock().await;
    let mut bytes: Vec<u8> = Vec::new();
    if matches!(&*c, Conn::Local) {
        use tokio::io::AsyncReadExt;
        let mut f = tokio::fs::File::open(&path).await.map_err(err)?;
        let mut buf = vec![0u8; limit];
        let n = f.read(&mut buf).await.map_err(err)?;
        buf.truncate(n);
        bytes = buf;
    } else if let Conn::Sftp(s) = &mut *c {
        use russh_sftp::protocol::OpenFlags;
        let mut f = s
            .sftp
            .open_with_flags(&path, OpenFlags::READ)
            .await
            .map_err(err)?;
        use tokio::io::AsyncReadExt;
        let mut buf = vec![0u8; limit];
        let n = if limit > 0 { f.read(&mut buf).await.map_err(err)? } else { 0 };
        buf.truncate(n);
        bytes = buf;
    } else if matches!(&*c, Conn::Ftp(_) | Conn::Ftps(_)) {
        macro_rules! ftp_hex {
            ($f:expr) => {{
                let mut ds = $f.retr_as_stream(&path).await.map_err(err)?;
                {
                    use async_std::io::ReadExt;
                    let mut buf = [0u8; 65536];
                    loop {
                        let n = ReadExt::read(&mut ds, &mut buf).await.map_err(err)?;
                        if n == 0 || bytes.len() >= limit {
                            break;
                        }
                        let take = n.min(limit - bytes.len());
                        bytes.extend_from_slice(&buf[..take]);
                    }
                }
                $f.finalize_retr_stream(ds).await.map_err(err)?;
            }};
        }
        match &mut *c {
            Conn::Ftp(f) => ftp_hex!(f),
            Conn::Ftps(f) => ftp_hex!(f),
            _ => {}
        }
    }
    Ok(serde_json::json!({ "bytes": bytes }))
}

#[tauri::command]
pub async fn read_hex_local(path: String, limit: Option<u64>) -> Result<serde_json::Value, String> {
    let limit = limit.unwrap_or(4096).min(1 << 20) as usize;
    use tokio::io::AsyncReadExt;
    let mut f = tokio::fs::File::open(&path).await.map_err(err)?;
    let mut buf = vec![0u8; limit];
    let n = f.read(&mut buf).await.map_err(err)?;
    buf.truncate(n);
    Ok(serde_json::json!({ "bytes": buf }))
}

#[tauri::command]
pub async fn dir_size_local(path: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let mut bytes = 0u64;
        let mut files = 0u32;
        for entry in walkdir::WalkDir::new(&path).follow_links(false) {
            let Ok(e) = entry else { continue };
            if e.file_type().is_file() {
                if let Ok(md) = e.metadata() {
                    bytes += md.len();
                    files += 1;
                }
            }
        }
        Ok(serde_json::json!({ "bytes": bytes, "files": files }))
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn dir_size_remote(
    state: tauri::State<'_, AppState>,
    session_id: u32,
    path: String,
) -> Result<serde_json::Value, String> {
    // Open a dedicated SFTP channel for the walk so the main connection
    // (used for browsing/transfers) is never blocked by size computation.
    enum Walk {
        Sftp(SftpSession),
        Local(String),
        Ftp,
    }
    let walk: Walk = {
        let conn = session(&state, session_id).await?;
        let c = conn.lock().await;
        match &*c {
            Conn::Sftp(s) => {
                let ch = s
                    .handle
                    .channel_open_session()
                    .await
                    .map_err(|e| format!("channel: {e}"))?;
                ch.request_subsystem(true, "sftp")
                    .await
                    .map_err(|e| format!("subsystem: {e}"))?;
                let sftp = SftpSession::new(ch.into_stream())
                    .await
                    .map_err(|e| format!("sftp: {e}"))?;
                Walk::Sftp(sftp)
            }
            Conn::Local => Walk::Local(path.clone()),
            Conn::Ftp(_) | Conn::Ftps(_) => Walk::Ftp,
        }
    };

    let mut bytes = 0u64;
    let mut files = 0u32;
    const MAX_ITEMS: usize = 50_000;
    let mut count = 0usize;

    match walk {
        Walk::Sftp(sftp) => {
            let mut stack = vec![path.clone()];
            'outer: while let Some(dir) = stack.pop() {
                let entries = match sftp.read_dir(&dir).await {
                    Ok(e) => e,
                    Err(_) => continue,
                };
                for entry in entries {
                    if count >= MAX_ITEMS {
                        break 'outer;
                    }
                    let name = entry.file_name();
                    if name == "." || name == ".." {
                        continue;
                    }
                    count += 1;
                    let md = entry.metadata();
                    if md.is_dir() {
                        stack.push(format!("{}/{}", dir.trim_end_matches('/'), name));
                    } else {
                        bytes += md.size.unwrap_or(0);
                        files += 1;
                    }
                }
            }
        }
        Walk::Local(root) => {
            return dir_size_local(root).await;
        }
        Walk::Ftp => {
            let conn = session(&state, session_id).await?;
            let mut c = conn.lock().await;
            let mut items: Vec<(String, bool, u64)> = Vec::new();
            c.walk_collect(&path, &mut items).await?;
            for (_, is_dir, size) in items {
                if !is_dir {
                    bytes += size;
                    files += 1;
                }
            }
        }
    }
    Ok(serde_json::json!({ "bytes": bytes, "files": files }))
}

#[tauri::command]
pub async fn file_checksum(path: String, algo: String) -> Result<String, String> {
    use tokio::io::AsyncReadExt;
    let mut f = tokio::fs::File::open(&path).await.map_err(err)?;
    let mut buf = vec![0u8; 256 * 1024];
    match algo.as_str() {
        "md5" => {
            use md5::Digest;
            let mut hasher = md5::Md5::new();
            loop {
                let n = f.read(&mut buf).await.map_err(err)?;
                if n == 0 {
                    break;
                }
                hasher.update(&buf[..n]);
            }
            Ok(hex::encode(hasher.finalize()))
        }
        "sha256" => {
            use sha2::Digest;
            let mut hasher = sha2::Sha256::new();
            loop {
                let n = f.read(&mut buf).await.map_err(err)?;
                if n == 0 {
                    break;
                }
                hasher.update(&buf[..n]);
            }
            Ok(hex::encode(hasher.finalize()))
        }
        a => Err(format!("unknown algo {a}")),
    }
}

#[tauri::command]
pub async fn remote_stat(
    state: tauri::State<'_, AppState>,
    session_id: u32,
    path: String,
) -> Result<serde_json::Value, String> {
    let conn = session(&state, session_id).await?;
    let mut c = conn.lock().await;
    let e = c.stat_entry(&path).await?;
    serde_json::to_value(e).map_err(err)
}

#[tauri::command]
pub async fn local_stat(path: String) -> Result<serde_json::Value, String> {
    let md = tokio::fs::metadata(&path).await.map_err(err)?;
    Ok(serde_json::json!({
        "name": Path::new(&path).file_name().unwrap_or_default().to_string_lossy(),
        "path": path,
        "is_dir": md.is_dir(),
        "size": if md.is_dir() { 0 } else { md.len() },
        "modified": md.modified().ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0),
        "permissions": null,
        "is_symlink": md.is_symlink(),
    }))
}

use crate::conn::{walk_local, Conn};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;

pub type AbortMap = Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>;

#[derive(Serialize, Clone, Debug)]
pub struct TransferEvent {
    pub id: String,
    pub file_name: String,
    pub files_done: u32,
    pub files_total: u32,
    pub transferred: u64,
    pub total: u64,
    pub status: String, // active | done | error | aborted
    pub error: Option<String>,
}

pub struct Progress {
    pub id: String,
    pub app: Option<AppHandle>,
    pub last_emit: std::time::Instant,
    pub transferred: AtomicU64,
}

impl Progress {
    pub fn new(id: &str, app: Option<&AppHandle>) -> Self {
        Self {
            id: id.to_string(),
            app: app.cloned(),
            last_emit: std::time::Instant::now(),
            transferred: AtomicU64::new(0),
        }
    }

    pub fn add(&mut self, n: u64) -> u64 {
        self.transferred.fetch_add(n, Ordering::Relaxed) + n
    }

    pub fn emit_throttled(
        &mut self,
        file_name: &str,
        files_done: u32,
        files_total: u32,
        total: u64,
    ) {
        let Some(app) = &self.app else { return };
        if self.last_emit.elapsed().as_millis() >= 120 {
            self.last_emit = std::time::Instant::now();
            let _ = app.emit(
                "transfer-progress",
                TransferEvent {
                    id: self.id.clone(),
                    file_name: file_name.to_string(),
                    files_done,
                    files_total,
                    transferred: self.transferred.load(Ordering::Relaxed),
                    total,
                    status: "active".into(),
                    error: None,
                },
            );
        }
    }
}

fn is_aborted(flag: &Arc<AtomicBool>) -> bool {
    flag.load(Ordering::Relaxed)
}

macro_rules! ftp_download_arm {
    ($ftp:expr, $remote_path:expr, $offset:expr, $local:expr, $total:expr, $prog:expr, $abort:expr) => {{
        let mut written: u64 = 0;
        if $offset > 0 {
            $ftp.resume_transfer($offset as usize)
                .await
                .map_err(|e| e.to_string())?;
            $prog.transferred.store($offset, Ordering::Relaxed);
            written += $offset;
        }
        let mut ds = $ftp
            .retr_as_stream($remote_path)
            .await
            .map_err(|e| e.to_string())?;
        let mut buf = [0u8; 64 * 1024];
        loop {
            if is_aborted($abort) {
                return Err("__aborted".into());
            }
            let n = async_std::io::ReadExt::read(&mut ds, &mut buf)
                .await
                .map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            $local.write_all(&buf[..n]).await.map_err(|e| e.to_string())?;
            written += $prog.add(n as u64);
            $prog.emit_throttled(
                &Path::new($remote_path)
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy(),
                1,
                1,
                $total,
            );
        }
        $ftp
            .finalize_retr_stream(ds)
            .await
            .map_err(|e| e.to_string())?;
        Ok::<u64, String>(written)
    }};
}

macro_rules! ftp_upload_arm {
    ($ftp:expr, $local_path:expr, $remote_path:expr, $offset:expr, $prog:expr, $abort:expr, $total:expr) => {{
        let mut src = tokio::fs::File::open($local_path)
            .await
            .map_err(|e| e.to_string())?;
        let mut written: u64 = 0;
        if $offset > 0 {
            use tokio::io::AsyncSeekExt;
            src.seek(std::io::SeekFrom::Start($offset))
                .await
                .map_err(|e| e.to_string())?;
            $prog.transferred.store($offset, Ordering::Relaxed);
            written += $offset;
        }
        let mut ds = if $offset > 0 {
            $ftp
                .append_with_stream($remote_path)
                .await
                .map_err(|e| e.to_string())?
        } else {
            $ftp.put_with_stream($remote_path)
                .await
                .map_err(|e| e.to_string())?
        };
        let mut buf = [0u8; 64 * 1024];
        loop {
            if is_aborted($abort) {
                return Err("__aborted".into());
            }
            let n = src.read(&mut buf).await.map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            async_std::io::WriteExt::write_all(&mut ds, &buf[..n])
                .await
                .map_err(|e| e.to_string())?;
            written += $prog.add(n as u64);
            $prog.emit_throttled(
                &Path::new($local_path)
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy(),
                1,
                1,
                $total,
            );
        }
        $ftp.finalize_put_stream(ds).await.map_err(|e| e.to_string())?;
        Ok::<u64, String>(written)
    }};
}

// ---------------------------------------------------------------------------
// File-level transfers
// ---------------------------------------------------------------------------

/// Download a single file from a remote connection to a local path.
pub async fn download_file(
    conn: &Arc<Mutex<Conn>>,
    remote_path: &str,
    local_path: &str,
    offset: u64,
    prog: &mut Progress,
    abort: &Arc<AtomicBool>,
) -> Result<u64, String> {
    let total = {
        let mut c = conn.lock().await;
        c.size(remote_path).await?
    };

    let mut local = if offset > 0 {
        tokio::fs::OpenOptions::new()
            .append(true)
            .create(true)
            .open(local_path)
            .await
            .map_err(|e| e.to_string())?
    } else {
        tokio::fs::File::create(local_path)
            .await
            .map_err(|e| e.to_string())?
    };

    let mut c = conn.lock().await;
    match &mut *c {
        Conn::Local => {
            let mut src = tokio::fs::File::open(remote_path)
                .await
                .map_err(|e| e.to_string())?;
            if offset > 0 {
                use tokio::io::AsyncSeekExt;
                src.seek(std::io::SeekFrom::Start(offset))
                    .await
                    .map_err(|e| e.to_string())?;
                prog.transferred.store(offset, Ordering::Relaxed);
            }
            let mut buf = vec![0u8; 64 * 1024];
            loop {
                if is_aborted(abort) {
                    return Err("__aborted".into());
                }
                let n = src.read(&mut buf).await.map_err(|e| e.to_string())?;
                if n == 0 {
                    break;
                }
                local.write_all(&buf[..n]).await.map_err(|e| e.to_string())?;
                let w = prog.add(n as u64);
                prog.emit_throttled(
                    &Path::new(remote_path)
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy(),
                    1,
                    1,
                    total,
                );
                let _ = w;
            }
        }
        Conn::Sftp(s) => {
            use russh_sftp::protocol::OpenFlags;
            let mut remote = s
                .sftp
                .open_with_flags(remote_path, OpenFlags::READ)
                .await
                .map_err(|e| e.to_string())?;
            if offset > 0 {
                use tokio::io::AsyncSeekExt;
                remote
                    .seek(std::io::SeekFrom::Start(offset))
                    .await
                    .map_err(|e| e.to_string())?;
                prog.transferred.store(offset, Ordering::Relaxed);
            }
            let mut buf = vec![0u8; 64 * 1024];
            loop {
                if is_aborted(abort) {
                    return Err("__aborted".into());
                }
                let n = remote.read(&mut buf).await.map_err(|e| e.to_string())?;
                if n == 0 {
                    break;
                }
                local.write_all(&buf[..n]).await.map_err(|e| e.to_string())?;
                prog.add(n as u64);
                prog.emit_throttled(
                    &Path::new(remote_path)
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy(),
                    1,
                    1,
                    total,
                );
            }
        }
        Conn::Ftp(f) => {
            let r = ftp_download_arm!(f, remote_path, offset, local, total, prog, abort)?;
            let _ = r;
        }
        Conn::Ftps(f) => {
            let r = ftp_download_arm!(f, remote_path, offset, local, total, prog, abort)?;
            let _ = r;
        }
    }
    local.flush().await.map_err(|e| e.to_string())?;
    Ok(prog.transferred.load(Ordering::Relaxed))
}

/// Upload a single local file to a remote connection.
pub async fn upload_file(
    conn: &Arc<Mutex<Conn>>,
    local_path: &str,
    remote_path: &str,
    offset: u64,
    prog: &mut Progress,
    abort: &Arc<AtomicBool>,
) -> Result<u64, String> {
    let total = tokio::fs::metadata(local_path)
        .await
        .map_err(|e| e.to_string())?
        .len();

    let mut c = conn.lock().await;
    let written = match &mut *c {
        Conn::Local => {
            let mut src = tokio::fs::OpenOptions::new()
                .read(true)
                .open(local_path)
                .await
                .map_err(|e| e.to_string())?;
            let mut dst = if offset > 0 {
                use tokio::io::AsyncSeekExt;
                let mut f = tokio::fs::OpenOptions::new()
                    .write(true)
                    .open(remote_path)
                    .await
                    .map_err(|e| e.to_string())?;
                f.seek(std::io::SeekFrom::Start(offset))
                    .await
                    .map_err(|e| e.to_string())?;
                f
            } else {
                tokio::fs::File::create(remote_path)
                    .await
                    .map_err(|e| e.to_string())?
            };
            if offset > 0 {
                use tokio::io::AsyncSeekExt;
                src.seek(std::io::SeekFrom::Start(offset))
                    .await
                    .map_err(|e| e.to_string())?;
                prog.transferred.store(offset, Ordering::Relaxed);
            }
            let mut buf = vec![0u8; 64 * 1024];
            loop {
                if is_aborted(abort) {
                    return Err("__aborted".into());
                }
                let n = src.read(&mut buf).await.map_err(|e| e.to_string())?;
                if n == 0 {
                    break;
                }
                dst.write_all(&buf[..n]).await.map_err(|e| e.to_string())?;
                prog.add(n as u64);
                prog.emit_throttled(
                    &Path::new(local_path)
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy(),
                    1,
                    1,
                    total,
                );
            }
            dst.flush().await.map_err(|e| e.to_string())?;
            prog.transferred.load(Ordering::Relaxed)
        }
        Conn::Sftp(s) => {
            use russh_sftp::protocol::OpenFlags;
            let mut remote = s
                .sftp
                .open_with_flags(
                    remote_path,
                    if offset > 0 {
                        OpenFlags::WRITE | OpenFlags::CREATE
                    } else {
                        OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::TRUNCATE
                    },
                )
                .await
                .map_err(|e| e.to_string())?;
            let mut src = tokio::fs::File::open(local_path)
                .await
                .map_err(|e| e.to_string())?;
            if offset > 0 {
                use tokio::io::AsyncSeekExt;
                remote
                    .seek(std::io::SeekFrom::Start(offset))
                    .await
                    .map_err(|e| e.to_string())?;
                src.seek(std::io::SeekFrom::Start(offset))
                    .await
                    .map_err(|e| e.to_string())?;
                prog.transferred.store(offset, Ordering::Relaxed);
            }
            let mut buf = vec![0u8; 64 * 1024];
            loop {
                if is_aborted(abort) {
                    return Err("__aborted".into());
                }
                let n = src.read(&mut buf).await.map_err(|e| e.to_string())?;
                if n == 0 {
                    break;
                }
                remote
                    .write_all(&buf[..n])
                    .await
                    .map_err(|e| e.to_string())?;
                prog.add(n as u64);
                prog.emit_throttled(
                    &Path::new(local_path)
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy(),
                    1,
                    1,
                    total,
                );
            }
            tokio::io::AsyncWriteExt::shutdown(&mut remote)
                .await
                .map_err(|e| e.to_string())?;
            prog.transferred.load(Ordering::Relaxed)
        }
        Conn::Ftp(f) => ftp_upload_arm!(f, local_path, remote_path, offset, prog, abort, total)?,
        Conn::Ftps(f) => ftp_upload_arm!(f, local_path, remote_path, offset, prog, abort, total)?,
    };
    Ok(written)
}

// ---------------------------------------------------------------------------
// Recursive transfers
// ---------------------------------------------------------------------------

fn path_rel(p: &str, root: &str) -> String {
    Path::new(p)
        .strip_prefix(root)
        .unwrap_or(Path::new(p))
        .to_string_lossy()
        .replace('\\', "/")
}

/// Recursively download a remote directory (or single file) into a local dir.
pub async fn download_tree(
    conn: &Arc<Mutex<Conn>>,
    remote_path: &str,
    local_dir: &str,
    id: &str,
    app: &AppHandle,
    abort: &Arc<AtomicBool>,
) -> Result<(), String> {
    let is_dir = {
        let mut c = conn.lock().await;
        c.stat_entry(remote_path).await?.map(|e| e.is_dir)
    };
    let name = Path::new(remote_path)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| remote_path.to_string());

    let items: Vec<(String, bool, u64)> = if is_dir == Some(true) {
        let mut c = conn.lock().await;
        let mut v = vec![];
        c.walk_collect(remote_path, &mut v).await?;
        v
    } else {
        let size = {
            let mut c = conn.lock().await;
            c.size(remote_path).await.unwrap_or(0)
        };
        vec![(remote_path.to_string(), false, size)]
    };

    let files_total = items.iter().filter(|(_, d, _)| !d).count() as u32;
    let bytes_total: u64 = items.iter().filter(|(_, d, _)| !d).map(|(_, _, s)| *s).sum();
    let mut files_done: u32 = 0;

    let base_local = if is_dir == Some(true) {
        PathBuf::from(local_dir).join(&name)
    } else {
        PathBuf::from(local_dir)
    };
    for (p, _, _) in items.iter().filter(|(_, d, _)| *d) {
        if is_aborted(abort) {
            return Err("__aborted".into());
        }
        let rel = path_rel(p, remote_path);
        let local = base_local.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR));
        let _ = tokio::fs::create_dir_all(&local).await;
    }

    for (p, _, size) in items.iter().filter(|(_, d, _)| !d) {
        if is_aborted(abort) {
            return Err("__aborted".into());
        }
        let rel = path_rel(p, remote_path);
        let local = base_local
            .join(rel.replace('/', std::path::MAIN_SEPARATOR_STR))
            .to_string_lossy()
            .to_string();
        if let Some(parent) = Path::new(&local).parent() {
            let _ = tokio::fs::create_dir_all(parent).await;
        }
        let mut prog = Progress::new(id, Some(app));
        let display = Path::new(p)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        match download_file(conn, p, &local, 0, &mut prog, abort).await {
            Ok(_) => {
                files_done += 1;
                let _ = app.emit(
                    "transfer-progress",
                    TransferEvent {
                        id: id.to_string(),
                        file_name: display,
                        files_done,
                        files_total,
                        transferred: *size,
                        total: bytes_total,
                        status: "active".into(),
                        error: None,
                    },
                );
            }
            Err(e) => {
                if e == "__aborted" {
                    return Err(e);
                }
                return Err(format!("{display}: {e}"));
            }
        }
    }
    Ok(())
}

/// Recursively upload a local directory (or single file) into a remote dir.
pub async fn upload_tree(
    conn: &Arc<Mutex<Conn>>,
    local_path: &str,
    remote_dir: &str,
    id: &str,
    app: &AppHandle,
    abort: &Arc<AtomicBool>,
) -> Result<(), String> {
    let src = PathBuf::from(local_path);
    let src_is_dir = src.is_dir();
    let name = src
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "upload".to_string());

    let items = walk_local(&src)?;

    let base_remote = if src_is_dir {
        format!("{}/{}", remote_dir.trim_end_matches('/'), name)
    } else {
        remote_dir.trim_end_matches('/').to_string()
    };
    if src_is_dir {
        let mut c = conn.lock().await;
        c.mkdir(&base_remote).await.ok(); // may already exist
    }
    for (p, _, _) in items.iter().filter(|(_, d, _)| *d) {
        if is_aborted(abort) {
            return Err("__aborted".into());
        }
        if Path::new(p) == Path::new(local_path) {
            continue;
        }
        let rel = path_rel(p, local_path);
        if rel.is_empty() {
            continue;
        }
        let mut c = conn.lock().await;
        c.mkdir(&format!("{}/{}", base_remote, rel)).await.ok();
    }

    let files_total = items
        .iter()
        .filter(|(p, d, _)| !d && (src_is_dir || Path::new(p) == Path::new(local_path)))
        .count() as u32;
    let bytes_total: u64 = items
        .iter()
        .filter(|(p, d, _)| !d && (src_is_dir || Path::new(p) == Path::new(local_path)))
        .map(|(_, _, s)| *s)
        .sum();
    let mut files_done: u32 = 0;

    for (p, _, _) in items.iter().filter(|(_, d, _)| !d) {
        if !src_is_dir && Path::new(p) != Path::new(local_path) {
            continue;
        }
        if is_aborted(abort) {
            return Err("__aborted".into());
        }
        let rel = path_rel(p, local_path);
        let remote = if rel.is_empty() {
            base_remote.clone()
        } else {
            format!("{}/{}", base_remote, rel)
        };
        let display = Path::new(p)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let mut prog = Progress::new(id, Some(app));
        match upload_file(conn, p, &remote, 0, &mut prog, abort).await {
            Ok(_) => {
                files_done += 1;
                let _ = app.emit(
                    "transfer-progress",
                    TransferEvent {
                        id: id.to_string(),
                        file_name: display,
                        files_done,
                        files_total,
                        transferred: prog.transferred.load(Ordering::Relaxed),
                        total: bytes_total,
                        status: "active".into(),
                        error: None,
                    },
                );
            }
            Err(e) => {
                if e == "__aborted" {
                    return Err(e);
                }
                return Err(format!("{display}: {e}"));
            }
        }
    }
    Ok(())
}

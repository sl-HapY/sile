use chrono::Datelike;
use russh::client::Handle;
use russh_sftp::client::SftpSession;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Arc;

#[derive(Serialize, Clone, Debug)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: i64, // epoch ms
    pub permissions: Option<String>,
    pub is_symlink: bool,
}

// ---------------------------------------------------------------------------
// SFTP client handler
// ---------------------------------------------------------------------------

pub struct SshClientHandler;

#[async_trait::async_trait]
impl russh::client::Handler for SshClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh::keys::key::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

pub struct SftpHandle {
    pub handle: Handle<SshClientHandler>,
    pub sftp: SftpSession,
}

// ---------------------------------------------------------------------------
// Connection abstraction
// ---------------------------------------------------------------------------

pub enum Conn {
    Ftp(suppaftp::AsyncFtpStream),
    Ftps(suppaftp::AsyncNativeTlsFtpStream),
    Sftp(SftpHandle),
    Local,
}

pub enum ReadResult {
    Text { content: String, truncated: bool },
}

const TEXT_READ_LIMIT: usize = 4 * 1024 * 1024;

pub fn split_name(path: &str) -> String {
    let p = path.trim_end_matches(['/', '\\']);
    if p.is_empty() {
        return path.to_string();
    }
    p.rsplit(['/', '\\'])
        .next()
        .unwrap_or(path)
        .to_string()
}

// --- FTP LIST output parsing (UNIX + Windows formats) ---

fn parse_month(m: &str) -> Option<u32> {
    match m.to_ascii_lowercase().as_str() {
        "jan" => Some(1),
        "feb" => Some(2),
        "mar" => Some(3),
        "apr" => Some(4),
        "may" => Some(5),
        "jun" => Some(6),
        "jul" => Some(7),
        "aug" => Some(8),
        "sep" => Some(9),
        "oct" => Some(10),
        "nov" => Some(11),
        "dec" => Some(12),
        _ => None,
    }
}

fn file_mtime_to_ms(dt: chrono::NaiveDateTime) -> i64 {
    use chrono::TimeZone;
    chrono::Local
        .from_local_datetime(&dt)
        .single()
        .map(|d| d.timestamp_millis())
        .unwrap_or(0)
}

/// Parses a single LIST line. Returns None for ".", ".." or unparsable lines.
fn parse_ftp_line(line: &str) -> Option<(String, bool, u64, i64, Option<String>, bool)> {
    let line = line.trim_end();
    if line.is_empty() {
        return None;
    }

    // UNIX style: drwxr-xr-x 1 owner group 4096 Oct 23 10:12 name
    let first = line.chars().next()?;
    if first == 'd' || first == '-' || first == 'l' || first == 'c' || first == 'b' {
        let toks: Vec<&str> = line.split_whitespace().collect();
        if toks.len() >= 9 {
            let perms = toks[0].to_string();
            let is_dir = first == 'd';
            let is_symlink = first == 'l';
            let mut month_idx = None;
            for (i, t) in toks.iter().enumerate().skip(1) {
                if parse_month(t).is_some() && i >= 5 {
                    month_idx = Some(i);
                    break;
                }
            }
            let mi = month_idx?;
            let size: u64 = if mi >= 1 {
                toks[mi - 1].parse().unwrap_or(0)
            } else {
                0
            };
            let month = parse_month(toks[mi])?;
            let day: u32 = toks.get(mi + 1)?.parse().ok()?;
            let third = *toks.get(mi + 2)?;
            let year: i32;
            let time: &str;
            if third.contains(':') {
                year = chrono::Local::now().year();
                time = third;
            } else {
                year = third.parse().ok()?;
                time = "00:00";
            }
            let (h, min) = time.split_once(':').unwrap_or((time, "0"));
            let dt = chrono::NaiveDate::from_ymd_opt(year, month, day)?
                .and_hms_opt(h.parse().ok()?, min.parse().ok()?, 0)?;
            let mtime = file_mtime_to_ms(dt);
            // name: everything after the 8th space (unix list has 8 fields before name)
            let name_raw = {
                let mut spaces = 0usize;
                let bytes = line.as_bytes();
                let mut pos = 0usize;
                for (i, b) in bytes.iter().enumerate() {
                    if *b == b' ' {
                        spaces += 1;
                        if spaces == 8 {
                            pos = i + 1;
                            break;
                        }
                    }
                }
                if pos > 0 {
                    line[pos..].trim().to_string()
                } else {
                    toks.last().unwrap().to_string()
                }
            };
            let name = name_raw.trim_end_matches('/').to_string();
            if name == "." || name == ".." {
                return None;
            }
            return Some((name, is_dir, size, mtime, Some(perms), is_symlink));
        }
        return None;
    }

    // Windows DOS style: 10-23-2026  10:12AM       <DIR>          folder
    let toks: Vec<&str> = line.split_whitespace().collect();
    if toks.len() >= 4 && toks[0].contains('-') && toks[1].contains(':') {
        let is_dir_marker = line.contains("<DIR>");
        let date_str = toks[0];
        let time_str = toks[1];
        let dparts: Vec<&str> = date_str.split('-').collect();
        let time_clean = time_str.trim_end_matches("AM").trim_end_matches("PM");
        let tparts: Vec<&str> = time_clean.split(':').collect();
        let mut mtime = 0i64;
        if dparts.len() == 3 && tparts.len() == 2 {
            let (year, month, day) = if dparts[2].len() == 4 {
                (
                    dparts[2].parse::<i32>().ok()?,
                    dparts[0].parse::<u32>().ok()?,
                    dparts[1].parse::<u32>().ok()?,
                )
            } else {
                (
                    2000 + dparts[2].parse::<i32>().ok()?,
                    dparts[0].parse::<u32>().ok()?,
                    dparts[1].parse::<u32>().ok()?,
                )
            };
            let pm = time_str.ends_with("PM");
            let mut h: u32 = tparts[0].parse().ok()?;
            if pm && h < 12 {
                h += 12;
            }
            let dt = chrono::NaiveDate::from_ymd_opt(year, month, day)?
                .and_hms_opt(h, tparts[1].parse().ok()?, 0)?;
            mtime = file_mtime_to_ms(dt);
        }
        let name = if is_dir_marker {
            line.split("<DIR>").nth(1).unwrap_or("").trim().to_string()
        } else if let Some(size_idx) = toks
            .iter()
            .position(|t| !t.is_empty() && t.chars().all(|c| c.is_ascii_digit()))
        {
            let pos = line
                .find(toks[size_idx])
                .map(|p| p + toks[size_idx].len())
                .unwrap_or(0);
            line[pos..].trim().to_string()
        } else {
            toks.last().unwrap().to_string()
        };
        if name.is_empty() {
            return None;
        }
        let size: u64 = if is_dir_marker {
            0
        } else {
            toks.iter()
                .rev()
                .find(|t| !t.is_empty() && t.chars().all(|c| c.is_ascii_digit()))
                .and_then(|t| t.parse().ok())
                .unwrap_or(0)
        };
        return Some((name, is_dir_marker, size, mtime, None, false));
    }

    None
}

fn sort_entries(out: &mut Vec<FileEntry>) {
    out.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
}

// ---------------------------------------------------------------------------

impl Conn {
    // ---------------- directory listing ----------------

    pub async fn list(&mut self, path: &str) -> Result<Vec<FileEntry>, String> {
        let base = path.trim_end_matches('/');
        match self {
            Conn::Ftp(f) => {
                let lines = if base.is_empty() || base == "/" {
                    f.list(None).await
                } else {
                    f.list(Some(base)).await
                }
                .map_err(|e| format!("LIST failed: {e}"))?;
                let mut out = vec![];
                for line in lines {
                    if let Some((name, is_dir, size, mtime, perms, sym)) = parse_ftp_line(&line) {
                        let full = if base.is_empty() {
                            format!("/{name}")
                        } else {
                            format!("{base}/{name}")
                        };
                        out.push(FileEntry {
                            name,
                            path: full,
                            is_dir,
                            size,
                            modified: mtime,
                            permissions: perms,
                            is_symlink: sym,
                        });
                    }
                }
                sort_entries(&mut out);
                Ok(out)
            }
            Conn::Ftps(f) => {
                let lines = if base.is_empty() || base == "/" {
                    f.list(None).await
                } else {
                    f.list(Some(base)).await
                }
                .map_err(|e| format!("LIST failed: {e}"))?;
                let mut out = vec![];
                for line in lines {
                    if let Some((name, is_dir, size, mtime, perms, sym)) = parse_ftp_line(&line) {
                        let full = if base.is_empty() {
                            format!("/{name}")
                        } else {
                            format!("{base}/{name}")
                        };
                        out.push(FileEntry {
                            name,
                            path: full,
                            is_dir,
                            size,
                            modified: mtime,
                            permissions: perms,
                            is_symlink: sym,
                        });
                    }
                }
                sort_entries(&mut out);
                Ok(out)
            }
            Conn::Sftp(s) => {
                // "/" trims down to "" — SFTP needs an absolute path
                let dir = if base.is_empty() { "/" } else { base };
                let entries = s
                    .sftp
                    .read_dir(dir)
                    .await
                    .map_err(|e| format!("LIST failed: {e}"))?;
                let mut out = vec![];
                for entry in entries {
                    let name = entry.file_name();
                    if name == "." || name == ".." {
                        continue;
                    }
                    let md = entry.metadata();
                    let full = if base.is_empty() {
                        format!("/{name}")
                    } else {
                        format!("{base}/{name}")
                    };
                    out.push(FileEntry {
                        name,
                        path: full,
                        is_dir: md.is_dir(),
                        size: md.size.unwrap_or(0),
                        modified: (md.mtime.unwrap_or(0) as i64) * 1000,
                        permissions: md.permissions.map(|p| format!("{p:o}")),
                        is_symlink: md.is_symlink(),
                    });
                }
                sort_entries(&mut out);
                Ok(out)
            }
            Conn::Local => list_local(Path::new(base)),
        }
    }

    pub async fn mkdir(&mut self, path: &str) -> Result<(), String> {
        match self {
            Conn::Ftp(f) => f.mkdir(path).await.map_err(|e| e.to_string()),
            Conn::Ftps(f) => f.mkdir(path).await.map_err(|e| e.to_string()),
            Conn::Sftp(s) => s.sftp.create_dir(path).await.map_err(|e| e.to_string()),
            Conn::Local => tokio::fs::create_dir_all(path)
                .await
                .map_err(|e| e.to_string()),
        }
    }

    pub async fn remove_file(&mut self, path: &str) -> Result<(), String> {
        match self {
            Conn::Ftp(f) => f.rm(path).await.map_err(|e| e.to_string()),
            Conn::Ftps(f) => f.rm(path).await.map_err(|e| e.to_string()),
            Conn::Sftp(s) => s.sftp.remove_file(path).await.map_err(|e| e.to_string()),
            Conn::Local => tokio::fs::remove_file(path).await.map_err(|e| e.to_string()),
        }
    }

    pub async fn remove_dir_empty(&mut self, path: &str) -> Result<(), String> {
        match self {
            Conn::Ftp(f) => f.rmdir(path).await.map_err(|e| e.to_string()),
            Conn::Ftps(f) => f.rmdir(path).await.map_err(|e| e.to_string()),
            Conn::Sftp(s) => s.sftp.remove_dir(path).await.map_err(|e| e.to_string()),
            Conn::Local => tokio::fs::remove_dir(path).await.map_err(|e| e.to_string()),
        }
    }

    pub async fn remove_recursive(&mut self, path: &str) -> Result<(), String> {
        if matches!(self, Conn::Local) {
            tokio::fs::remove_dir_all(path)
                .await
                .map_err(|e| e.to_string())?;
            return Ok(());
        }
        let entries = self.list(path).await?;
        for e in entries {
            if e.is_dir {
                Box::pin(self.remove_recursive(&e.path)).await?;
            } else {
                self.remove_file(&e.path).await?;
            }
        }
        self.remove_dir_empty(path).await
    }

    pub async fn rename(&mut self, from: &str, to: &str) -> Result<(), String> {
        match self {
            Conn::Ftp(f) => f.rename(from, to).await.map_err(|e| e.to_string()),
            Conn::Ftps(f) => f.rename(from, to).await.map_err(|e| e.to_string()),
            Conn::Sftp(s) => {
                // SFTP rename fails if target exists; remove it first when possible
                let _ = s.sftp.remove_file(to).await;
                let _ = s.sftp.remove_dir(to).await;
                s.sftp.rename(from, to).await.map_err(|e| e.to_string())
            }
            Conn::Local => tokio::fs::rename(from, to).await.map_err(|e| e.to_string()),
        }
    }

    pub async fn size(&mut self, path: &str) -> Result<u64, String> {
        match self {
            Conn::Ftp(f) => Ok(f.size(path).await.unwrap_or(0) as u64),
            Conn::Ftps(f) => Ok(f.size(path).await.unwrap_or(0) as u64),
            Conn::Sftp(s) => {
                let md = s.sftp.metadata(path).await.map_err(|e| e.to_string())?;
                Ok(md.size.unwrap_or(0))
            }
            Conn::Local => {
                let md = tokio::fs::metadata(path).await.map_err(|e| e.to_string())?;
                Ok(md.len())
            }
        }
    }

    pub async fn set_permissions(
        &mut self,
        path: &str,
        mode: u32,
        recursive: bool,
    ) -> Result<(), String> {
        match self {
            Conn::Sftp(s) => {
                use russh_sftp::protocol::FileAttributes;
                let attrs = FileAttributes {
                    size: None,
                    uid: None,
                    user: None,
                    gid: None,
                    group: None,
                    permissions: Some(mode),
                    atime: None,
                    mtime: None,
                };
                s.sftp
                    .set_metadata(path, attrs)
                    .await
                    .map_err(|e| e.to_string())?;
                if recursive {
                    let entries = self.list(path).await?;
                    for e in entries {
                        Box::pin(self.set_permissions(&e.path, mode, true)).await?;
                    }
                }
                Ok(())
            }
            _ => Err("Permissions are only supported over SFTP".into()),
        }
    }

    pub async fn walk_collect(
        &mut self,
        path: &str,
        out: &mut Vec<(String, bool, u64)>,
    ) -> Result<(), String> {
        let entries = self.list(path).await?;
        for e in entries {
            if e.is_dir {
                out.push((e.path.clone(), true, 0));
                Box::pin(self.walk_collect(&e.path, out)).await?;
            } else {
                out.push((e.path.clone(), false, e.size));
            }
        }
        Ok(())
    }

    pub async fn stat_entry(&mut self, path: &str) -> Result<Option<FileEntry>, String> {
        match self {
            Conn::Local => {
                let md = tokio::fs::metadata(path).await.ok();
                Ok(md.map(|md| FileEntry {
                    name: split_name(path),
                    path: path.to_string(),
                    is_dir: md.is_dir(),
                    size: md.len(),
                    modified: 0,
                    permissions: None,
                    is_symlink: md.is_symlink(),
                }))
            }
            Conn::Sftp(s) => {
                let md = s.sftp.metadata(path).await.ok();
                Ok(md.map(|md| FileEntry {
                    name: split_name(path),
                    path: path.to_string(),
                    is_dir: md.is_dir(),
                    size: md.size.unwrap_or(0),
                    modified: (md.mtime.unwrap_or(0) as i64) * 1000,
                    permissions: md.permissions.map(|p| format!("{p:o}")),
                    is_symlink: md.is_symlink(),
                }))
            }
            Conn::Ftp(f) => {
                let size = f.size(path).await.unwrap_or(0) as u64;
                Ok(Some(FileEntry {
                    name: split_name(path),
                    path: path.to_string(),
                    is_dir: false,
                    size,
                    modified: 0,
                    permissions: None,
                    is_symlink: false,
                }))
            }
            Conn::Ftps(f) => {
                let size = f.size(path).await.unwrap_or(0) as u64;
                Ok(Some(FileEntry {
                    name: split_name(path),
                    path: path.to_string(),
                    is_dir: false,
                    size,
                    modified: 0,
                    permissions: None,
                    is_symlink: false,
                }))
            }
        }
    }

    pub async fn search_recursive(
        &mut self,
        root: &str,
        needle: &str,
        max: usize,
        out: &mut Vec<String>,
    ) -> Result<(), String> {
        if out.len() >= max {
            return Ok(());
        }
        let entries = self.list(root).await?;
        for e in entries {
            if e.name.to_lowercase().contains(&needle.to_lowercase()) {
                out.push(e.path.clone());
                if out.len() >= max {
                    return Ok(());
                }
            }
            if e.is_dir {
                Box::pin(self.search_recursive(&e.path, needle, max, out)).await?;
                if out.len() >= max {
                    return Ok(());
                }
            }
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Connection factory (protocol + optional proxy)
// ---------------------------------------------------------------------------

pub async fn make_conn(
    site: &crate::sites::Site,
    proxy: &Option<crate::proxy::ProxyConfig>,
    ftp_host_str: &mut String,
) -> Result<Conn, String> {
    let host = site.host.trim().to_string();
    let port = if site.port == 0 {
        match site.protocol.as_str() {
            "sftp" => 22,
            _ => 21,
        }
    } else {
        site.port
    };
    let user = if site.username.is_empty() {
        "root".to_string()
    } else {
        site.username.clone()
    };

    let use_proxy = proxy.as_ref().map(|p| p.enabled()).unwrap_or(false);
    // For SFTP we can hand the proxied tokio stream to russh directly. FTP
    // libraries require an async-std stream, so FTP goes through a local
    // port-forwarder instead (data connections stay direct — works with
    // local proxies such as 127.0.0.1 and most SSH-tunnel setups).
    let ftp_forward_port: Option<u16> = if use_proxy && site.protocol != "sftp" {
        Some(
            crate::proxy::forward_via_proxy(proxy.as_ref().unwrap(), &host, port)
                .await
                .map_err(|e| format!("proxy: {e}"))?,
        )
    } else {
        None
    };
    let pre_stream = if use_proxy && site.protocol == "sftp" {
        Some(
            crate::proxy::connect_via(proxy.as_ref().unwrap(), &host, port)
                .await
                .map_err(|e| format!("proxy: {e}"))?,
        )
    } else {
        None
    };
    let ftp_host: &str = if ftp_forward_port.is_some() {
        ftp_host_str.push_str("127.0.0.1");
        &*ftp_host_str
    } else {
        &host
    };
    let ftp_port = ftp_forward_port.unwrap_or(port);

    match site.protocol.as_str() {
        "ftp" | "ftps" => {
            if site.protocol == "ftps" {
                let mut s = suppaftp::AsyncNativeTlsFtpStream::connect((ftp_host, ftp_port))
                    .await
                    .map_err(|e| e.to_string())?;
                s.login(&user, &site.password).await.map_err(|e| e.to_string())?;
                // TLS certificate verification is always enforced (secure by
                // default). Self-signed servers are rejected rather than
                // silently trusted.
                let tls = async_native_tls::TlsConnector::new();
                let mut s = s
                    .into_secure(suppaftp::AsyncNativeTlsConnector::from(tls), &host)
                    .await
                    .map_err(|e| e.to_string())?;
                s.transfer_type(suppaftp::types::FileType::Binary)
                    .await
                    .map_err(|e| e.to_string())?;
                Ok(Conn::Ftps(s))
            } else {
                let mut s = suppaftp::AsyncFtpStream::connect((ftp_host, ftp_port))
                    .await
                    .map_err(|e| e.to_string())?;
                s.login(&user, &site.password).await.map_err(|e| e.to_string())?;
                s.transfer_type(suppaftp::types::FileType::Binary)
                    .await
                    .map_err(|e| e.to_string())?;
                Ok(Conn::Ftp(s))
            }
        }
        "sftp" => {
            let config = Arc::new(russh::client::Config {
                inactivity_timeout: None,
                ..Default::default()
            });
            let mut handle = match pre_stream {
                Some(st) => {
                    russh::client::connect_stream(config, st, SshClientHandler)
                        .await
                        .map_err(|e| format!("SSH connect failed: {e}"))?
                }
                None => {
                    russh::client::connect(config, (host.as_str(), port), SshClientHandler)
                        .await
                        .map_err(|e| format!("SSH connect failed: {e}"))?
                }
            };
            let authed = handle
                .authenticate_password(&user, &site.password)
                .await
                .map_err(|e| format!("SSH auth failed: {e}"))?;
            if !authed {
                return Err("SSH authentication failed: wrong username or password".into());
            }
            let channel = handle
                .channel_open_session()
                .await
                .map_err(|e| format!("SSH channel failed: {e}"))?;
            channel
                .request_subsystem(true, "sftp")
                .await
                .map_err(|e| format!("SFTP subsystem failed: {e}"))?;
            let sftp = SftpSession::new(channel.into_stream())
                .await
                .map_err(|e| format!("SFTP init failed: {e}"))?;
            Ok(Conn::Sftp(SftpHandle { handle, sftp }))
        }
        p => Err(format!("Unknown protocol: {p}")),
    }
}

// ---------------------------------------------------------------------------
// Local filesystem helpers
// ---------------------------------------------------------------------------

pub fn list_local(path: &Path) -> Result<Vec<FileEntry>, String> {
    let mut out = vec![];
    let rd = std::fs::read_dir(path).map_err(|e| format!("{}: {e}", path.display()))?;
    for entry in rd.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let full = entry.path();
        let md = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let is_dir = md.is_dir();
        let modified = md
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        out.push(FileEntry {
            name,
            path: full.to_string_lossy().to_string(),
            is_dir,
            size: if is_dir { 0 } else { md.len() },
            modified,
            permissions: None,
            is_symlink: md.is_symlink(),
        });
    }
    sort_entries(&mut out);
    Ok(out)
}

pub fn walk_local(root: &Path) -> Result<Vec<(String, bool, u64)>, String> {
    let mut out = vec![];
    for entry in walkdir::WalkDir::new(root).follow_links(false) {
        let e = entry.map_err(|e| e.to_string())?;
        let p = e.path().to_string_lossy().to_string();
        if e.file_type().is_dir() {
            out.push((p, true, 0));
        } else {
            out.push((p, false, e.metadata().map(|m| m.len()).unwrap_or(0)));
        }
    }
    Ok(out)
}

pub fn home_dir() -> String {
    #[cfg(windows)]
    {
        std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\".to_string())
    }
    #[cfg(not(windows))]
    {
        std::env::var("HOME").unwrap_or_else(|_| "/".to_string())
    }
}

pub fn preview_dir() -> PathBuf {
    let d = std::env::temp_dir().join("sile-preview");
    let _ = std::fs::create_dir_all(&d);
    d
}

// ---------------------------------------------------------------------------
// Text read/write over any connection
// ---------------------------------------------------------------------------

macro_rules! ftp_write_text {
    ($ftp:expr, $path:expr, $content:expr) => {{
        let mut ds = $ftp
            .put_with_stream($path)
            .await
            .map_err(|e| e.to_string())?;
        let data = $content.as_bytes();
        let mut off = 0usize;
        while off < data.len() {
            let end = (off + 64 * 1024).min(data.len());
            async_std::io::WriteExt::write_all(&mut ds, &data[off..end])
                .await
                .map_err(|e| e.to_string())?;
            off = end;
        }
        if data.is_empty() {
            let _: () = async_std::io::WriteExt::flush(&mut ds)
                .await
                .map_err(|e| e.to_string())?;
        }
        $ftp.finalize_put_stream(ds).await.map_err(|e| e.to_string())
    }};
}

impl Conn {
    pub async fn read_text(&mut self, path: &str) -> Result<ReadResult, String> {
        let (bytes, truncated) = match self {
            Conn::Local => {
                let md = tokio::fs::metadata(path).await.map_err(|e| e.to_string())?;
                let total = md.len() as usize;
                let take = total.min(TEXT_READ_LIMIT);
                use tokio::io::AsyncReadExt;
                let mut f = tokio::fs::File::open(path).await.map_err(|e| e.to_string())?;
                let mut buf = vec![0u8; take];
                f.read_exact(&mut buf).await.map_err(|e| e.to_string())?;
                (buf, total > TEXT_READ_LIMIT)
            }
            Conn::Sftp(s) => {
                use russh_sftp::protocol::OpenFlags;
                let md = s.sftp.metadata(path).await.map_err(|e| e.to_string())?;
                let total = md.size.unwrap_or(0) as usize;
                let take = total.min(TEXT_READ_LIMIT);
                let mut f = s
                    .sftp
                    .open_with_flags(path, OpenFlags::READ)
                    .await
                    .map_err(|e| e.to_string())?;
                use tokio::io::AsyncReadExt;
                let mut buf = vec![0u8; take];
                if take > 0 {
                    f.read_exact(&mut buf).await.map_err(|e| e.to_string())?;
                }
                (buf, total > TEXT_READ_LIMIT)
            }
            Conn::Ftp(f) => {
                let total = f.size(path).await.unwrap_or(0) as u64;
                let mut ds = f.retr_as_stream(path).await.map_err(|e| e.to_string())?;
                let mut out: Vec<u8> = Vec::new();
                let mut buf = [0u8; 64 * 1024];
                loop {
                    let n = async_std::io::ReadExt::read(&mut ds, &mut buf)
                        .await
                        .map_err(|e| e.to_string())?;
                    if n == 0 {
                        break;
                    }
                    out.extend_from_slice(&buf[..n]);
                    if out.len() >= TEXT_READ_LIMIT {
                        break;
                    }
                }
                let truncated = out.len() >= TEXT_READ_LIMIT || (total as usize) > out.len();
                if truncated {
                    f.abort(ds).await.ok();
                } else {
                    f.finalize_retr_stream(ds).await.map_err(|e| e.to_string())?;
                }
                (out, truncated)
            }
            Conn::Ftps(f) => {
                let total = f.size(path).await.unwrap_or(0) as u64;
                let mut ds = f.retr_as_stream(path).await.map_err(|e| e.to_string())?;
                let mut out: Vec<u8> = Vec::new();
                let mut buf = [0u8; 64 * 1024];
                loop {
                    let n = async_std::io::ReadExt::read(&mut ds, &mut buf)
                        .await
                        .map_err(|e| e.to_string())?;
                    if n == 0 {
                        break;
                    }
                    out.extend_from_slice(&buf[..n]);
                    if out.len() >= TEXT_READ_LIMIT {
                        break;
                    }
                }
                let truncated = out.len() >= TEXT_READ_LIMIT || (total as usize) > out.len();
                if truncated {
                    f.abort(ds).await.ok();
                } else {
                    f.finalize_retr_stream(ds).await.map_err(|e| e.to_string())?;
                }
                (out, truncated)
            }
        };
        let content = String::from_utf8_lossy(&bytes).to_string();
        Ok(ReadResult::Text { content, truncated })
    }

    pub async fn write_text(&mut self, path: &str, content: &str) -> Result<(), String> {
        match self {
            Conn::Local => {
                tokio::fs::write(path, content)
                    .await
                    .map_err(|e| e.to_string())
            }
            Conn::Sftp(s) => {
                use russh_sftp::protocol::OpenFlags;
                let mut f = s
                    .sftp
                    .open_with_flags(
                        path,
                        OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::TRUNCATE,
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                use tokio::io::AsyncWriteExt;
                f.write_all(content.as_bytes())
                    .await
                    .map_err(|e| e.to_string())?;
                tokio::io::AsyncWriteExt::shutdown(&mut f)
                    .await
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
            Conn::Ftp(f) => match ftp_write_text!(f, path, content) {
                Ok(_) => Ok(()),
                Err(e) => Err(e.to_string()),
            },
            Conn::Ftps(f) => match ftp_write_text!(f, path, content) {
                Ok(_) => Ok(()),
                Err(e) => Err(e.to_string()),
            },
        }
    }
}

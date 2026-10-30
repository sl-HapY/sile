// Real end-to-end test of Sile's connection layer against a live server.
// Usage: PROBE_HOST=... PROBE_PORT=... PROBE_USER=... PROBE_PASS=... cargo run --example api_test
use sile::commands::AppState;
use sile::conn::Conn;
use sile::sites::Site;
use sile::proxy::ProxyConfig;
use std::sync::Arc;
use tokio::sync::Mutex;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let host = std::env::var("PROBE_HOST").unwrap_or_else(|_| "127.0.0.1".into());
    let port: u16 = std::env::var("PROBE_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(22);
    let user = std::env::var("PROBE_USER").unwrap_or_else(|_| "root".into());
    let pass = std::env::var("PROBE_PASS").unwrap_or_default();

    let site = Site {
        id: String::new(),
        name: "test".into(),
        protocol: "sftp".into(),
        host: host.clone(),
        port,
        username: user,
        password: pass,
        remote_start: "/".into(),
        local_start: String::new(),
        accept_invalid_certs: false,
        color: String::new(),
    };

    println!("[1] make_conn (no proxy) ...");
    let mut buf = String::new();
    let conn = Arc::new(Mutex::new(sile::commands::make_conn(&site, &None, &mut buf).await?));
    println!("[1] connected");

    {
        let mut c = conn.lock().await;
        println!("[2] list / ...");
        let entries = c.list("/").await?;
        println!("[2] / has {} entries", entries.len());
        assert!(entries.iter().any(|e| e.is_dir), "expected dirs in /");

        // mkdir / write / read / rename / delete round-trip in a unique dir
        let base = format!("/tmp/sile-e2e-{}", std::process::id());
        println!("[3] mkdir {base} ...");
        c.mkdir(&base).await?;
        let f = format!("{base}/hello.txt");
        c.write_text(&f, "hello from sile e2e").await?;
        let r = c.read_text(&f).await?;
        match &r {
            sile::conn::ReadResult::Text { content, .. } => {
                assert_eq!(content.trim(), "hello from sile e2e", "round-trip text mismatch");
            }
        }
        println!("[3] write+read OK");
        let renamed = format!("{base}/renamed.txt");
        c.rename(&f, &renamed).await?;
        let entries = c.list(&base).await?;
        assert!(entries.iter().any(|e| e.name == "renamed.txt"), "rename not visible");
        println!("[4] rename OK");
        // stat + size
        let st = c.stat_entry(&renamed).await?.expect("stat");
        assert!(st.size > 0);
        println!("[5] stat OK (size {})", st.size);
        // recursive delete
        c.remove_recursive(&base).await?;
        let entries = c.list("/tmp").await?;
        assert!(!entries.iter().any(|e| e.name.starts_with("sile-e2e-")), "cleanup failed");
        println!("[6] remove_recursive OK — all fs ops verified");
    }

    // download/upload engine (single file) through the real transfer functions
    {
        use sile::transfer::{download_file, upload_file, Progress};
        use std::sync::atomic::AtomicBool;
        let tmp = std::env::temp_dir().join("sile-e2e-upload.txt");
        std::fs::write(&tmp, "upload payload from e2e")?;
        let remote = "/tmp/sile-e2e-upload.txt";
        let abort = Arc::new(AtomicBool::new(false));

        let mut prog = Progress::new("e2e-up", None);
        upload_file(&conn, tmp.to_str().unwrap(), remote, 0, &mut prog, &abort).await?;
        println!("[7] upload_file OK ({} bytes sent)", prog.transferred.load(std::sync::atomic::Ordering::Relaxed));

        let local_out = std::env::temp_dir().join("sile-e2e-download.txt");
        let mut prog = Progress::new("e2e-down", None);
        download_file(&conn, remote, local_out.to_str().unwrap(), 0, &mut prog, &abort).await?;
        let back = std::fs::read_to_string(&local_out)?;
        assert_eq!(back, "upload payload from e2e", "downloaded bytes differ");
        println!("[8] download_file OK — round-trip bytes verified");

        // resume: partial file then offset download
        let partial = std::env::temp_dir().join("sile-e2e-partial.txt");
        std::fs::write(&partial, "upload ")?; // first 7 bytes
        let mut prog = Progress::new("e2e-resume", None);
        let stat = {
            let mut c = conn.lock().await;
            c.stat_entry(remote).await?.expect("stat")
        };
        download_file(&conn, remote, partial.to_str().unwrap(), 7, &mut prog, &abort).await?;
        let resumed = std::fs::read_to_string(&partial)?;
        assert_eq!(resumed, "upload payload from e2e", "resume produced wrong bytes");
        let _ = stat;
        println!("[9] resume download OK (offset 7 of {} bytes)", stat.size);

        // cleanup remote artifacts
        let mut c = conn.lock().await;
        c.remove_file(remote).await?;
        println!("[10] remote cleanup OK");
    }

    // disconnect cleanly
    {
        let mut c = conn.lock().await;
        if let Conn::Sftp(s) = &mut *c {
            let _ = s.sftp.close().await;
        }
    }
    println!("E2E OK");
    Ok(())
}

// silence unused warnings for helper types referenced above
#[allow(dead_code)]
fn _unused(_p: ProxyConfig) {}

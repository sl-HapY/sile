// Standalone end-to-end test for Sile's connection layer — no tauri involved.
// Includes the SAME source files the app uses (conn.rs / sites.rs / proxy.rs)
// and exercises them against a live server.
#![allow(dead_code)]

#[path = "../../src/conn.rs"]
mod conn;
#[path = "../../src/sites.rs"]
mod sites;
#[path = "../../src/proxy.rs"]
mod proxy;

use conn::Conn;
use sites::Site;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Mutex;

fn make_site() -> Site {
    Site {
        id: String::new(),
        name: "e2e".into(),
        protocol: std::env::var("PROBE_PROTO").unwrap_or_else(|_| "sftp".into()),
        host: std::env::var("PROBE_HOST").unwrap_or_else(|_| "127.0.0.1".into()),
        port: std::env::var("PROBE_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(22),
        username: std::env::var("PROBE_USER").unwrap_or_else(|_| "root".into()),
        password: std::env::var("PROBE_PASS").unwrap_or_default(),
        remote_start: "/".into(),
        local_start: String::new(),
        accept_invalid_certs: false,
        color: String::new(),
    }
}

#[tokio::main]
async fn main() {
    let site = make_site();
    println!("== Sile E2E: {} {}@{}:{} ==", site.protocol, site.username, site.host, site.port);

    println!("[1] make_conn ...");
    let mut ftp_buf = String::new();
    let conn = Arc::new(Mutex::new(
        conn::make_conn(&site, &None, &mut ftp_buf)
            .await
            .expect("connect failed"),
    ));
    println!("[1] connected OK");

    {
        let mut c = conn.lock().await;

        println!("[2] list / ...");
        let entries = c.list("/").await.expect("list /");
        println!("[2] {} entries in /", entries.len());
        assert!(entries.iter().any(|e| e.is_dir), "expected dirs in /");

        // mkdir → write → read → rename → list → stat → recursive remove
        let base = format!(
            "/tmp/sile-e2e-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis()
        );
        println!("[3] mkdir {} ...", base);
        c.mkdir(&base).await.expect("mkdir");
        let f = format!("{}/hello.txt", base);
        c.write_text(&f, "hello from sile e2e").await.expect("write_text");
        let content = match c.read_text(&f).await.expect("read_text") {
            conn::ReadResult::Text { content, .. } => content,
        };
        assert_eq!(content.trim(), "hello from sile e2e", "round-trip mismatch");
        println!("[3] write_text + read_text OK (round-trip verified)");

        let renamed = format!("{}/renamed.txt", base);
        c.rename(&f, &renamed).await.expect("rename");
        let listing = c.list(&base).await.expect("list base");
        assert!(
            listing.iter().any(|e| e.name == "renamed.txt"),
            "rename not visible in listing"
        );
        println!("[4] rename OK + verified in listing");

        let st = c.stat_entry(&renamed).await.expect("stat").expect("stat none");
        assert!(st.size > 0, "stat size must be > 0");
        println!("[5] stat OK (size = {} bytes)", st.size);

        // nested structure for recursive remove
        let nested = format!("{}/nested", base);
        c.mkdir(&nested).await.expect("mkdir nested");
        c.write_text(&format!("{}/deep.txt", nested), "deep")
            .await
            .expect("write nested");
        c.remove_recursive(&base).await.expect("remove_recursive");
        let tmp_list = c.list("/tmp").await.expect("list /tmp");
        assert!(
            !tmp_list.iter().any(|e| e.name.starts_with("sile-e2e-")),
            "recursive remove left artifacts"
        );
        println!("[6] remove_recursive OK — filesystem ops all verified");

        // local fs helpers use the same code paths the app uses
        let home = conn::home_dir();
        let local_entries = conn::list_local(Path::new(&home)).expect("list_local");
        println!("[7] local fs OK ({} entries in {})", local_entries.len(), home);
    }

    // disconnect
    {
        let mut c = conn.lock().await;
        if let Conn::Sftp(s) = &mut *c {
            let _ = s.sftp.close().await;
        }
    }
    println!("== E2E PASSED ==");
}

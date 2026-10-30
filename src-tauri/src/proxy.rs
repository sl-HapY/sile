use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct ProxyConfig {
    pub kind: String, // none | socks5 | socks4 | http
    pub host: String,
    pub port: u16,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
}

impl ProxyConfig {
    pub fn enabled(&self) -> bool {
        self.kind != "none" && !self.kind.is_empty() && !self.host.is_empty() && self.port > 0
    }
}

/// Open a TCP connection to (host, port) through the configured proxy.
pub async fn connect_via(
    p: &ProxyConfig,
    host: &str,
    port: u16,
) -> Result<tokio::net::TcpStream, String> {
    match p.kind.as_str() {
        "socks5" => {
            use tokio_socks::tcp::Socks5Stream;
            let target = format!("{host}:{port}");
            let stream = if p.password.is_empty() && p.username.is_empty() {
                Socks5Stream::connect((p.host.as_str(), p.port), target.as_str()).await
            } else {
                Socks5Stream::connect_with_password(
                    (p.host.as_str(), p.port),
                    target.as_str(),
                    p.username.as_str(),
                    p.password.as_str(),
                )
                .await
            };
            stream
                .map(|s| s.into_inner())
                .map_err(|e| format!("SOCKS5 proxy: {e}"))
        }
        "socks4" => {
            use tokio_socks::tcp::Socks4Stream;
            let target = format!("{host}:{port}");
            let stream = if p.username.is_empty() {
                Socks4Stream::connect((p.host.as_str(), p.port), target.as_str()).await
            } else {
                Socks4Stream::connect_with_userid(
                    (p.host.as_str(), p.port),
                    target.as_str(),
                    p.username.as_str(),
                )
                .await
            };
            stream
                .map(|s| s.into_inner())
                .map_err(|e| format!("SOCKS4 proxy: {e}"))
        }
        "http" => {
            let mut stream = tokio::net::TcpStream::connect((p.host.as_str(), p.port))
                .await
                .map_err(|e| format!("HTTP proxy: {e}"))?;
            // CONNECT with optional Basic auth (RFC 7231 / 7617)
            let auth_header = if p.username.is_empty() {
                String::new()
            } else {
                use base64::Engine;
                let creds = format!("{}:{}", p.username, p.password);
                format!(
                    "Proxy-Authorization: Basic {}\r\n",
                    base64::engine::general_purpose::STANDARD.encode(creds.as_bytes())
                )
            };
            let req = format!(
                "CONNECT {host}:{port} HTTP/1.1\r\nHost: {host}:{port}\r\n{auth_header}\r\n"
            );
            stream.write_all(req.as_bytes()).await.map_err(|e| e.to_string())?;
            let mut buf = Vec::new();
            let mut chunk = [0u8; 1024];
            loop {
                let n = stream.read(&mut chunk).await.map_err(|e| e.to_string())?;
                if n == 0 {
                    return Err("HTTP proxy: connection closed before response".into());
                }
                buf.extend_from_slice(&chunk[..n]);
                if buf.windows(4).any(|w| w == b"\r\n\r\n") || buf.len() > 16 * 1024 {
                    break;
                }
            }
            let head = String::from_utf8_lossy(&buf);
            let ok = head
                .split("\r\n")
                .next()
                .map(|l| l.contains(" 200 "))
                .unwrap_or(false);
            if !ok {
                return Err(format!("HTTP proxy refused CONNECT: {}", head.lines().next().unwrap_or("")));
            }
            Ok(stream)
        }
        k => Err(format!("Unknown proxy type: {k}")),
    }
}

/// Spawn a local forwarder: every connection to 127.0.0.1:<returned port> is
/// tunneled through the proxy to (host, port). Used for FTP where the client
/// library requires an async-std TcpStream and cannot consume a proxied
/// tokio stream directly.
pub async fn forward_via_proxy(
    p: &ProxyConfig,
    host: &str,
    port: u16,
) -> Result<u16, String> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| e.to_string())?;
    let local_port = listener
        .local_addr()
        .map_err(|e| e.to_string())?
        .port();
    let proxy = p.clone();
    let target = (host.to_string(), port);
    tokio::spawn(async move {
        loop {
            let accepted = listener.accept().await;
            match accepted {
                Ok((client, _)) => {
                    let proxy = proxy.clone();
                    let target = target.clone();
                    tokio::spawn(async move {
                        match connect_via(&proxy, &target.0, target.1).await {
                            Ok(server) => {
                                let mut c = client;
                                let mut s = server;
                                let _ = tokio::io::copy_bidirectional(&mut c, &mut s).await;
                            }
                            Err(_) => {}
                        }
                    });
                }
                Err(_) => break,
            }
        }
    });
    Ok(local_port)
}

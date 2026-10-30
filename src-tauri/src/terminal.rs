use crate::conn::Conn;
use russh::client::Msg;
use russh::{Channel, ChannelMsg};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, OnceLock};
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;
use tokio::sync::{mpsc, Mutex};

#[derive(Serialize, Clone)]
pub struct TermData {
    pub term_id: String,
    pub data: String,
}

#[derive(Serialize, Clone)]
pub struct TermExit {
    pub term_id: String,
}

enum TermCmd {
    Write(Vec<u8>),
    Resize(u32, u32),
    Close,
}

static TERM_CTRL: OnceLock<std::sync::Mutex<HashMap<String, mpsc::Sender<TermCmd>>>> =
    OnceLock::new();

fn term_ctrl() -> &'static std::sync::Mutex<HashMap<String, mpsc::Sender<TermCmd>>> {
    TERM_CTRL.get_or_init(|| std::sync::Mutex::new(HashMap::new()))
}

/// Open an interactive SSH shell (PTY) for an SFTP session.
pub async fn open_terminal(
    app: AppHandle,
    conn: &Arc<Mutex<Conn>>,
    term_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    if term_ctrl().lock().unwrap().contains_key(&term_id) {
        return Ok(()); // already open
    }

    let channel: Channel<Msg> = {
        let c = conn.lock().await;
        match &*c {
            Conn::Sftp(s) => {
                let channel = s
                    .handle
                    .channel_open_session()
                    .await
                    .map_err(|e| format!("channel: {e}"))?;
                channel
                    .request_pty(true, "xterm-256color", cols, rows, 0, 0, &[])
                    .await
                    .map_err(|e| format!("pty: {e}"))?;
                channel
                    .request_shell(true)
                    .await
                    .map_err(|e| format!("shell: {e}"))?;
                channel
            }
            _ => return Err("Terminal requires an SFTP (SSH) connection".into()),
        }
    };

    let (ctrl_tx, mut ctrl_rx) = mpsc::channel::<TermCmd>(64);
    term_ctrl()
        .lock()
        .unwrap()
        .insert(term_id.clone(), ctrl_tx);

    let mut writer = channel.make_writer();

    let app2 = app.clone();
    let tid = term_id.clone();
    tokio::spawn(async move {
        let mut channel = channel;
        loop {
            let cmd: Option<TermCmd> = tokio::select! {
                cmd = ctrl_rx.recv() => cmd,
                msg = channel.wait() => {
                    match msg {
                        Some(ChannelMsg::Data { ref data }) => {
                            let _ = app2.emit(
                                "term-data",
                                TermData {
                                    term_id: tid.clone(),
                                    data: String::from_utf8_lossy(data).to_string(),
                                },
                            );
                            continue;
                        }
                        Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                            let _ = app2.emit(
                                "term-data",
                                TermData {
                                    term_id: tid.clone(),
                                    data: String::from_utf8_lossy(data).to_string(),
                                },
                            );
                            continue;
                        }
                        Some(ChannelMsg::Close) | None => None,
                        _ => continue,
                    }
                }
            };
            match cmd {
                Some(TermCmd::Write(data)) => {
                    if writer.write_all(&data).await.is_err() {
                        break;
                    }
                    let _ = writer.flush().await;
                }
                Some(TermCmd::Resize(c, r)) => {
                    let _ = channel.window_change(c, r, 0, 0).await;
                }
                Some(TermCmd::Close) | None => {
                    let _ = channel.close().await;
                    break;
                }
            }
        }
        term_ctrl().lock().unwrap().remove(&tid);
        let _ = app2.emit("term-exit", TermExit { term_id: tid });
    });
    Ok(())
}

pub async fn terminal_write(term_id: &str, data: &str) -> Result<(), String> {
    let tx = term_ctrl().lock().unwrap().get(term_id).cloned();
    if let Some(tx) = tx {
        tx.send(TermCmd::Write(data.as_bytes().to_vec()))
            .await
            .map_err(|_| "terminal gone".into())
    } else {
        Err("terminal not open".into())
    }
}

pub async fn terminal_resize(term_id: &str, cols: u32, rows: u32) -> Result<(), String> {
    let tx = term_ctrl().lock().unwrap().get(term_id).cloned();
    if let Some(tx) = tx {
        tx.send(TermCmd::Resize(cols, rows))
            .await
            .map_err(|_| "terminal gone".into())
    } else {
        Err("terminal not open".into())
    }
}

pub async fn terminal_close(term_id: &str) -> Result<(), String> {
    let tx = term_ctrl().lock().unwrap().remove(term_id);
    if let Some(tx) = tx {
        let _ = tx.send(TermCmd::Close).await;
    }
    Ok(())
}

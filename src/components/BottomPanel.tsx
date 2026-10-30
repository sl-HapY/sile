import React, { useEffect, useState } from "react";
import {
  ArrowDownFromLine, ArrowUpFromLine, CheckCircle2, XCircle, PauseCircle,
  Play, Trash2, ChevronDown, ChevronUp, Terminal, ListTree,
} from "lucide-react";
import { fmtEta, fmtSize, fmtSpeed, useStore } from "../lib/store";
import { IconButton, LinearProgress } from "./m3";
import { TerminalView } from "./TerminalView";

type BottomTab = "queue" | "log" | "terminal";

export function BottomPanel({ height }: { height: number }) {
  const st = useStore();
  const [tab, setTab] = useState<BottomTab>("queue");
  const [collapsed, setCollapsed] = useState(false);

  // reset terminal when server changes
  useEffect(() => {
    setTab((t) => (t === "terminal" && !st.session ? "queue" : t));
  }, [st.session?.id]); // eslint-disable-line

  const items = Object.values(st.transfers).sort((a, b) => a.startedAt - b.startedAt);
  const active = items.filter((t) => t.status === "active" || t.status === "queued");
  const failed = items.filter((t) => t.status === "error");
  const totalSpeed = active.reduce((s, t) => s + t.speed, 0);

  if (collapsed) {
    return (
      <div className="bottom-panel" style={{ minHeight: 0 }}>
        <div className="bottom-tabs" style={{ minHeight: 34 }}>
          <button className={`btab ${tab === "queue" ? "active" : ""}`} onClick={() => { setCollapsed(false); setTab("queue"); }}>
            <ListTree size={15} />
            Transfers
          </button>
          <button className={`btab ${tab === "log" ? "active" : ""}`} onClick={() => { setCollapsed(false); setTab("log"); }}>
            <Terminal size={15} />
            Log
          </button>
          {st.session?.protocol === "sftp" && (
            <button className={`btab ${tab === "terminal" ? "active" : ""}`} onClick={() => { setCollapsed(false); setTab("terminal"); }}>
              <Terminal size={15} />
              Terminal
            </button>
          )}
          <div style={{ flex: 1 }} />
          {active.length > 0 && (
            <span style={{ fontSize: 11, color: "var(--primary)", fontWeight: 600, padding: "0 8px" }}>
              {active.length} active · {fmtSpeed(totalSpeed)}
            </span>
          )}
          <IconButton onClick={() => setCollapsed(false)} title="Expand panel">
            <ChevronUp size={16} />
          </IconButton>
        </div>
      </div>
    );
  }

  return (
    <div className="bottom-panel">
      <div className="bottom-tabs">
        <button className={`btab ${tab === "queue" ? "active" : ""}`} onClick={() => setTab("queue")}>
          <ListTree size={15} />
          Transfers
          {active.length > 0 && <span className="badge">{active.length}</span>}
          {failed.length > 0 && <span className="badge err">{failed.length}</span>}
        </button>
        <button className={`btab ${tab === "log" ? "active" : ""}`} onClick={() => setTab("log")}>
          <Terminal size={15} />
          Log
        </button>
        {st.session?.protocol === "sftp" && (
          <button className={`btab ${tab === "terminal" ? "active" : ""}`} onClick={() => setTab("terminal")}>
            <Terminal size={15} />
            Terminal
          </button>
        )}
        <div style={{ flex: 1 }} />
        {tab !== "terminal" && items.some((t) => t.status === "done" || t.status === "error" || t.status === "aborted") && (
          <IconButton onClick={st.clearFinished} title="Clear finished">
            <Trash2 size={15} />
          </IconButton>
        )}
        <IconButton onClick={() => setCollapsed(true)} title="Collapse">
          <ChevronDown size={16} />
        </IconButton>
      </div>

      {tab === "terminal" ? (
        <div className="bottom-body" style={{ height, padding: 0 }}>
          <TerminalView />
        </div>
      ) : tab === "queue" ? (
        <div className="bottom-body" style={{ height }}>
          {items.length === 0 && (
            <div className="empty-state" style={{ padding: 16 }}>
              <ListTree size={30} />
              <div>No transfers yet — drag files between the panes</div>
            </div>
          )}
          {items.map((t) => {
            const pct = t.total > 0 ? (t.transferred / t.total) * 100 : t.isDir ? (t.filesTotal > 0 ? (t.filesDone / t.filesTotal) * 100 : 0) : 0;
            const remaining = Math.max(0, (t.total || 0) - t.transferred);
            const eta = t.status === "active" ? fmtEta(remaining, t.speed) : "—";
            return (
              <div className="queue-row" key={t.id}>
                <div
                  className={`qdir ${t.status === "done" ? "st" : t.status === "error" ? "er" : t.dir}`}
                  title={t.dir === "down" ? "Download" : "Upload"}
                >
                  {t.status === "done" ? (
                    <CheckCircle2 size={14} />
                  ) : t.status === "error" ? (
                    <XCircle size={14} />
                  ) : t.dir === "down" ? (
                    <ArrowDownFromLine size={14} />
                  ) : (
                    <ArrowUpFromLine size={14} />
                  )}
                </div>
                <div className="qname" title={t.name}>
                  {t.name}
                  {t.isDir ? " /" : ""}
                </div>
                <div className="qpaths">
                  <span title={t.source}>{t.source}</span>
                  <span title={t.dest}>{t.dest}</span>
                </div>
                <div className="qprog">
                  <LinearProgress value={pct} indeterminate={t.status === "queued"} />
                  <div style={{ fontSize: 10, color: "var(--on-surface-variant)", textAlign: "right" }}>
                    {t.isDir
                      ? `${t.filesDone}/${t.filesTotal} files · ${Math.round(pct)}%`
                      : `${fmtSize(t.transferred)} / ${fmtSize(t.total)}`}
                  </div>
                </div>
                <div className="qmeta">
                  <span className={`status-chip ${t.status}`}>{t.status}</span>
                  <div style={{ marginTop: 3 }}>
                    {t.status === "active"
                      ? `${fmtSpeed(t.speed)} · ETA ${eta}`
                      : t.status === "error"
                      ? t.error?.slice(0, 60)
                      : ""}
                  </div>
                </div>
                <div className="qactions">
                  {t.status === "active" && (
                    <IconButton onClick={() => st.pauseTransfer(t.id)} title="Pause">
                      <PauseCircle size={16} />
                    </IconButton>
                  )}
                  {(t.status === "error" || t.status === "aborted") && (
                    <IconButton onClick={() => st.retryTransfer(t.id)} title="Retry">
                      <Play size={15} />
                    </IconButton>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bottom-body" style={{ height }}>
          <IconButton
            onClick={st.clearLogs}
            title="Clear log"
            style={{ position: "sticky", top: 0, float: "right" }}
          >
            <Trash2 size={14} />
          </IconButton>
          {st.logs.length === 0 && (
            <div className="empty-state" style={{ padding: 16 }}>
              <Terminal size={30} />
              <div>Connection and transfer logs appear here</div>
            </div>
          )}
          {st.logs.map((l, i) => (
            <div className={`log-line ${l.level}`} key={i}>
              <span className="lt">
                {new Date(l.t).toLocaleTimeString([], { hour12: false })}
              </span>
              {l.msg}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function StatusBar() {
  const st = useStore();
  const items = Object.values(st.transfers);
  const active = items.filter((t) => t.status === "active");
  const speed = active.reduce((s, t) => s + t.speed, 0);

  return (
    <div className="statusbar">
      <span className="sb-item">
        {st.session
          ? `${st.session.protocol.toUpperCase()} · ${st.session.host}`
          : "No connection"}
      </span>
      {st.session && (
        <span className="sb-item">remote: {st.remotePath}</span>
      )}
      <span className="sb-item">local: {st.localPath}</span>
      <div className="sb-right">
        {active.length > 0 && (
          <>
            <span className="sb-item speed">{fmtSpeed(speed)}</span>
            <span className="sb-item">{active.length} transferring</span>
          </>
        )}
        <span className="sb-item">{items.filter((t) => t.status === "done").length} done</span>
      </div>
    </div>
  );
}

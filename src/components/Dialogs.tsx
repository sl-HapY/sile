import React, { useEffect, useMemo, useState } from "react";
import {
  Search as SearchIcon, ShieldCheck, Hash, Copy as CopyIcon, RefreshCw,
  Settings2, Palette, Eye, FolderSync, Loader2, FileCode2, CheckCheck,
  AlertTriangle, Info,
} from "lucide-react";
import { api } from "../lib/api";
import { fmtSize, useStore, ACCENTS } from "../lib/store";
import type { FileEntry, SiteView } from "../lib/types";
import { Dialog, M3Button, Switch, Checkbox, TextField, IconButton, M3Select } from "./m3";
import { fileKind } from "../lib/store";
import { openFile, editFile, joinPath } from "../lib/actions";

// ---------------------------------------------------------------------------
// Generic input prompt dialog
// ---------------------------------------------------------------------------

export function PromptDialog() {
  const st = useStore();
  const payload = st.modal?.payload as
    | { title: string; label?: string; initial?: string; resolve: (v: string | null) => void }
    | undefined;
  const [val, setVal] = useState(payload?.initial ?? "");

  useEffect(() => {
    setVal(payload?.initial ?? "");
  }, [payload?.title]); // eslint-disable-line

  if (!payload) return null;
  const done = (v: string | null) => {
    st.closeModal();
    payload.resolve(v);
  };

  return (
    <Dialog
      icon={<FileCode2 size={19} />}
      title={payload.title}
      onClose={() => done(null)}
      actions={
        <>
          <M3Button variant="text" onClick={() => done(null)}>Cancel</M3Button>
          <M3Button onClick={() => done(val.trim() || null)} disabled={!val.trim()}>OK</M3Button>
        </>
      }
    >
      <TextField
        autoFocus
        label={payload.label}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && done(val.trim() || null)}
      />
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Confirm / alert dialogs
// ---------------------------------------------------------------------------

export function ConfirmDialog() {
  const st = useStore();
  const payload = st.modal?.payload as
    | { title: string; message: string; resolve: (v: boolean) => void }
    | undefined;
  if (!payload) return null;
  const done = (v: boolean) => {
    st.closeModal();
    payload.resolve(v);
  };

  return (
    <Dialog
      icon={<AlertTriangle size={19} />}
      title={payload.title}
      onClose={() => done(false)}
      actions={
        <>
          <M3Button variant="text" onClick={() => done(false)}>Cancel</M3Button>
          <M3Button variant="danger" onClick={() => done(true)}>Delete</M3Button>
        </>
      }
    >
      <div style={{ userSelect: "text" }}>{payload.message}</div>
    </Dialog>
  );
}

export function AlertDialog() {
  const st = useStore();
  const payload = st.modal?.payload as
    | { title: string; message: string; resolve: () => void }
    | undefined;
  if (!payload) return null;
  const done = () => {
    st.closeModal();
    payload.resolve();
  };

  return (
    <Dialog
      icon={<Info size={19} />}
      title={payload.title}
      onClose={done}
      actions={<M3Button onClick={done}>OK</M3Button>}
    >
      <div style={{ userSelect: "text" }}>{payload.message}</div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Remote search
// ---------------------------------------------------------------------------

export function SearchDialog() {
  const st = useStore();
  const [pattern, setPattern] = useState("");
  const [results, setResults] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const side = st.modal?.payload?.side as "local" | "remote";

  const run = async () => {
    if (!pattern.trim()) return;
    setBusy(true);
    setResults(null);
    try {
      if (side === "remote") {
        const r = await api.searchRemote(st.session!.id, st.remotePath, pattern.trim(), 500);
        setResults(r);
      } else {
        // local: quick recursive scan via list? use search_remote semantics only for remote;
        // local search walks via API list_local (non recursive) — do a JS walk
        const out: string[] = [];
        const walk = async (p: string, depth: number) => {
          if (out.length >= 500 || depth > 6) return;
          try {
            const list = await api.listLocal(p);
            for (const e of list) {
              if (e.name.toLowerCase().includes(pattern.trim().toLowerCase())) out.push(e.path);
              if (e.is_dir) await walk(e.path, depth + 1);
              if (out.length >= 500) return;
            }
          } catch {}
        };
        await walk(st.localPath, 0);
        setResults(out);
      }
    } catch (e: any) {
      st.toast(`Search failed: ${e}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const base = side === "remote" ? st.remotePath : st.localPath;

  return (
    <Dialog
      icon={<SearchIcon size={19} />}
      title={side === "remote" ? "Search on server" : "Search locally"}
      onClose={() => st.closeModal()}
      width={620}
    >
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <TextField
          autoFocus
          placeholder={`Search under ${base}`}
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
        />
        <M3Button onClick={run} disabled={busy || !pattern.trim()}>
          {busy ? <Loader2 size={15} className="spin" /> : <SearchIcon size={15} />}
          Search
        </M3Button>
      </div>
      <div style={{ maxHeight: 340, overflowY: "auto" }}>
        {results?.length === 0 && <div className="empty-state" style={{ padding: 24 }}>No matches</div>}
        {results?.map((p) => {
          const name = p.split(/[\\/]/).pop() || p;
          const isDir = !name.includes(".");
          return (
            <div
              key={p}
              className="search-hit"
              onDoubleClick={async () => {
                st.closeModal();
                if (side === "remote") {
                  if (isDir) st.setRemotePath(p);
                  else
                    openFile(
                      { name, path: p, is_dir: false, size: 0, modified: 0, permissions: null, is_symlink: false },
                      "remote"
                    );
                } else {
                  if (isDir) st.setLocalPath(p);
                  else
                    openFile(
                      { name, path: p, is_dir: false, size: 0, modified: 0, permissions: null, is_symlink: false },
                      "local"
                    );
                }
              }}
              onClick={() => st.toast("Double-click to open")}
            >
              <FileCode2 size={15} style={{ flexShrink: 0, color: "var(--primary)" }} />
              <div style={{ minWidth: 0 }}>
                <div className="hit-name">{name}{isDir ? "/" : ""}</div>
                <div className="hit-path">{p}</div>
              </div>
            </div>
          );
        })}
        {results === null && !busy && (
          <div className="empty-state" style={{ padding: 24 }}>
            Type a name to search recursively under the current folder
          </div>
        )}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Chmod dialog (SFTP)
// ---------------------------------------------------------------------------

export function ChmodDialog() {
  const st = useStore();
  const entry = st.modal?.payload?.entry as FileEntry | undefined;
  const [mode, setMode] = useState("644");
  const [recursive, setRecursive] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!entry) return null;

  const apply = async () => {
    const m = parseInt(mode, 8);
    if (isNaN(m)) {
      st.toast("Invalid octal mode", "error");
      return;
    }
    setBusy(true);
    try {
      await api.setPermissions(st.session!.id, entry.path, m, recursive);
      st.toast("Permissions updated", "success");
      st.refreshBoth();
      st.closeModal();
    } catch (e: any) {
      st.toast(`Failed: ${e}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const bits = [
    ["Owner", ["r", "w", "x"]],
    ["Group", ["r", "w", "x"]],
    ["Others", ["r", "w", "x"]],
  ];

  const digit = (cls: number) => parseInt(mode[cls] ?? "0", 8) || 0;
  const toggleBit = (cls: number, bit: number) => {
    const digits = [0, 1, 2].map((i) => digit(i));
    digits[cls] = digits[cls] ^ (1 << (2 - bit));
    setMode(digits.join(""));
  };

  return (
    <Dialog
      icon={<ShieldCheck size={19} />}
      title={`Permissions — ${entry.name}`}
      onClose={() => st.closeModal()}
      actions={
        <>
          <M3Button variant="text" onClick={() => st.closeModal()}>Cancel</M3Button>
          <M3Button onClick={apply} disabled={busy}>
            {busy ? <Loader2 size={14} className="spin" /> : <CheckCheck size={14} />} Apply
          </M3Button>
        </>
      }
    >
      <div style={{ display: "flex", gap: 24, marginBottom: 14 }}>
        {bits.map(([label, perms], cls) => (
          <div key={label as string}>
            <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 12.5 }}>{label}</div>
            {(perms as string[]).map((p, bit) => (
              <label key={p} style={{ display: "flex", gap: 7, alignItems: "center", padding: "3px 0", fontSize: 13 }}>
                <Checkbox
                  checked={(digit(cls) & (1 << (2 - bit))) !== 0}
                  onChange={() => toggleBit(cls, bit)}
                />
                {p}
              </label>
            ))}
          </div>
        ))}
        <div style={{ flex: 1 }}>
          <TextField
            label="Octal mode"
            value={mode}
            maxLength={3}
            onChange={(e) => setMode(e.target.value.replace(/[^0-7]/g, "").slice(0, 3))}
          />
          <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center" }}>
            <Switch checked={recursive} onChange={setRecursive} />
            <span style={{ fontSize: 12.5 }}>Apply recursively to contents</span>
          </div>
        </div>
      </div>
      <div style={{ fontSize: 12, color: "var(--on-surface-variant)" }}>{entry.path}</div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Checksum dialog (local files)
// ---------------------------------------------------------------------------

export function ChecksumDialog() {
  const st = useStore();
  const entry = st.modal?.payload?.entry as FileEntry | undefined;
  const [md5, setMd5] = useState<string | null>(null);
  const [sha, setSha] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (!entry) return null;

  const compute = async (algo: "md5" | "sha256") => {
    setBusy(algo);
    try {
      const r = await api.fileChecksum(entry.path, algo);
      (algo === "md5" ? setMd5 : setSha)(r);
    } catch (e: any) {
      st.toast(`Failed: ${e}`, "error");
    } finally {
      setBusy(null);
    }
  };

  const copy = (v: string) => {
    navigator.clipboard.writeText(v);
    st.toast("Copied to clipboard", "success");
  };

  return (
    <Dialog
      icon={<Hash size={19} />}
      title={`Checksum — ${entry.name}`}
      onClose={() => st.closeModal()}
      width={620}
    >
      <div style={{ fontSize: 12, color: "var(--on-surface-variant)", marginBottom: 14 }}>{entry.path}</div>
      {[
        ["MD5", md5, "md5"] as const,
        ["SHA-256", sha, "sha256"] as const,
      ].map(([label, val, algo]) => (
        <div key={algo} style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <strong style={{ width: 70, fontSize: 13 }}>{label}</strong>
            {val ? (
              <>
                <code style={{ flex: 1, fontSize: 11.5, userSelect: "text", wordBreak: "break-all", color: "var(--on-surface)" }}>{val}</code>
                <IconButton onClick={() => copy(val)} title="Copy">
                  <CopyIcon size={15} />
                </IconButton>
              </>
            ) : (
              <M3Button variant="tonal" onClick={() => compute(algo)} disabled={busy !== null}>
                {busy === algo ? <Loader2 size={14} className="spin" /> : <Hash size={14} />}
                Compute
              </M3Button>
            )}
          </div>
        </div>
      ))}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Folder compare & sync
// ---------------------------------------------------------------------------

interface CmpRow {
  name: string;
  isDir: boolean;
  local?: FileEntry;
  remote?: FileEntry;
  state: "only-local" | "only-remote" | "same" | "diff";
}

export function CompareDialog() {
  const st = useStore();
  const [rows, setRows] = useState<CmpRow[] | null>(null);
  const [busy, setBusy] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      setBusy(true);
      try {
        const [local, remote] = await Promise.all([
          api.listLocal(st.localPath),
          st.session ? api.list(st.session.id, st.remotePath) : Promise.resolve([]),
        ]);
        const map = new Map<string, CmpRow>();
        for (const l of local) {
          map.set(l.name.toLowerCase(), { name: l.name, isDir: l.is_dir, local: l, state: "only-local" });
        }
        for (const r of remote) {
          const k = r.name.toLowerCase();
          const row = map.get(k);
          if (row && row.local) {
            const same =
              row.local.is_dir === r.is_dir &&
              (row.local.is_dir || (row.local.size === r.size));
            row.remote = r;
            row.state = same ? "same" : "diff";
          } else {
            map.set(k, { name: r.name, isDir: r.is_dir, remote: r, state: "only-remote" });
          }
        }
        setRows([...map.values()].sort((a, b) => a.name.localeCompare(b.name)));
        setSelected(new Set(
          [...map.values()].filter((r) => r.state !== "same").map((r) => r.name)
        ));
      } catch (e: any) {
        st.toast(`Compare failed: ${e}`, "error");
      } finally {
        setBusy(false);
      }
    })();
  }, []); // eslint-disable-line

  const chip = (s: CmpRow["state"]) => {
    switch (s) {
      case "same": return <span className="status-chip done">same</span>;
      case "diff": return <span className="status-chip active">differ</span>;
      case "only-local": return <span className="status-chip queued">local only</span>;
      case "only-remote": return <span className="status-chip aborted">remote only</span>;
    }
  };

  const sync = async (dir: "up" | "down") => {
    if (!rows) return;
    const items = rows.filter(
      (r) => selected.has(r.name) && (dir === "up" ? r.local : r.remote)
    );
    if (items.length === 0) return;
    st.closeModal();
    const { transferItems } = await import("../lib/actions");
    if (dir === "up") {
      await transferItems("local", items.map((r) => r.local!));
    } else {
      await transferItems("remote", items.map((r) => r.remote!));
    }
  };

  return (
    <Dialog
      icon={<FolderSync size={19} />}
      title="Compare folders"
      onClose={() => st.closeModal()}
      width={720}
      actions={
        <>
          <M3Button variant="text" onClick={() => st.closeModal()}>Close</M3Button>
          <M3Button variant="outlined" onClick={() => sync("down")} disabled={!st.session || busy}>
            <RefreshCw size={14} style={{ transform: "rotate(180deg)" }} /> Download selected
          </M3Button>
          <M3Button onClick={() => sync("up")} disabled={!st.session || busy}>
            <RefreshCw size={14} /> Upload selected
          </M3Button>
        </>
      }
    >
      <div style={{ fontSize: 12, color: "var(--on-surface-variant)", marginBottom: 10 }}>
        Local <code>{st.localPath}</code> ⟷ Remote <code>{st.remotePath}</code>
      </div>
      {busy && (
        <div className="preview-loading" style={{ padding: 30 }}>
          <Loader2 size={28} className="spin" /> <div>Comparing...</div>
        </div>
      )}
      {rows && (
        <>
          <div className="cmp-row head">
            <span>Name</span><span>Local</span><span>Remote</span><span className="cstate">State</span>
          </div>
          <div style={{ maxHeight: 360, overflowY: "auto" }}>
            {rows.map((r) => (
              <div className="cmp-row" key={r.name}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
                  <Checkbox
                    checked={selected.has(r.name)}
                    onChange={(v) => {
                      setSelected((s) => {
                        const n = new Set(s);
                        if (v) n.add(r.name);
                        else n.delete(r.name);
                        return n;
                      });
                    }}
                  />
                  <span className="cname" title={r.name}>{r.isDir ? "📁 " : ""}{r.name}</span>
                </div>
                <span className="cval">{r.local ? (r.isDir ? "dir" : fmtSize(r.local.size)) : "—"}</span>
                <span className="cval">{r.remote ? (r.isDir ? "dir" : fmtSize(r.remote.size)) : "—"}</span>
                <span className="cstate">{chip(r.state)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const THEME_DESC: Record<string, string> = {};

export function SettingsDialog() {
  const st = useStore();
  const px = st.proxy;
  const updateProxy = (patch: Partial<typeof px>) =>
    st.setProxy({ ...px, ...patch });

  return (
    <Dialog
      icon={<Settings2 size={19} />}
      title="Settings"
      onClose={() => st.closeModal()}
      width={560}
      actions={<M3Button variant="text" onClick={() => st.closeModal()}>Done</M3Button>}
    >
      <div className="settings-section">
        <h4>Appearance</h4>
        <div className="setting-row">
          <div className="sdesc">
            <div className="stitle">Dark mode</div>
            <div className="ssub">Use the dark Material 3 color scheme</div>
          </div>
          <Switch checked={st.theme === "dark"} onChange={(v) => st.setTheme(v ? "dark" : "light")} />
        </div>
        <div className="setting-row">
          <div className="sdesc">
            <div className="stitle">Accent color</div>
            <div className="ssub">Dynamic Material 3 accent</div>
          </div>
          <div style={{ display: "flex", gap: 7 }}>
            {ACCENTS.map((a) => (
              <div
                key={a}
                className={`accent-dot ${st.accent === a ? "sel" : ""}`}
                style={{ background: a }}
                onClick={() => st.setAccent(a)}
              />
            ))}
          </div>
        </div>
        <div className="setting-row">
          <div className="sdesc">
            <div className="stitle">Default view</div>
            <div className="ssub">Details list or grid in file panes</div>
          </div>
          <M3Button variant="tonal" onClick={st.toggleViewMode}>
            {st.viewMode === "details" ? "Details" : "Grid"}
          </M3Button>
        </div>
      </div>
      <div className="settings-section">
        <h4>Connection proxy</h4>
        <div className="setting-row" style={{ alignItems: "flex-start" }}>
          <div className="sdesc" style={{ flex: 1 }}>
            <div className="stitle">Proxy type</div>
            <div className="ssub">
              Route all server connections (FTP, FTPS, SFTP) through a SOCKS or HTTP proxy.
              Applies to the next connection.
            </div>
          </div>
          <M3Select
            value={px.kind}
            options={[
              { value: "none", label: "No proxy" },
              { value: "socks5", label: "SOCKS5" },
              { value: "socks4", label: "SOCKS4" },
              { value: "http", label: "HTTP CONNECT" },
            ]}
            onChange={(v) => updateProxy({ kind: v as any })}
          />
        </div>
        {px.kind !== "none" && (
          <>
            <div className="form-row">
              <TextField
                label="Proxy host"
                placeholder="127.0.0.1"
                value={px.host}
                onChange={(e) => updateProxy({ host: e.target.value })}
              />
              <TextField
                label="Proxy port"
                placeholder="1080"
                value={px.port ? String(px.port) : ""}
                onChange={(e) =>
                  updateProxy({ port: parseInt(e.target.value.replace(/\D/g, "") || "0", 10) || 0 })
                }
              />
            </div>
            <div className="form-row">
              <TextField
                label="Username (optional)"
                value={px.username}
                onChange={(e) => updateProxy({ username: e.target.value })}
              />
              <TextField
                label="Password (optional)"
                type="password"
                value={px.password}
                onChange={(e) => updateProxy({ password: e.target.value })}
              />
            </div>
          </>
        )}
      </div>
      <div className="settings-section">
        <h4>About</h4>
        <div style={{ fontSize: 12.5, color: "var(--on-surface-variant)", lineHeight: 1.7 }}>
          <strong>Sile</strong> 1.0.0 — a modern file transfer client.<br />
          FTP · FTPS · SFTP with previews, media player and built-in code editor.<br />
          Built with Tauri 2 (Rust) + React + Material 3. Icons by Lucide.
        </div>
      </div>
    </Dialog>
  );
}

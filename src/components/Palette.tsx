import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Search, RefreshCw, Globe, Settings2, Sun, Moon, LogOut, UploadCloud,
  DownloadCloud, FolderPlus, ArrowUp, FolderSync,
  LayoutGrid, List, Keyboard,
} from "lucide-react";
import { useStore } from "../lib/store";
import { transferItems, parentPath, createEntry } from "../lib/actions";
import { api } from "../lib/api";

interface Cmd {
  id: string;
  label: string;
  icon: React.ReactNode;
  keywords?: string;
  shortcut?: string;
  run: () => void;
  enabled?: () => boolean;
}

export function Palette() {
  const st = useStore();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const cmds: Cmd[] = useMemo(() => {
    const c: Cmd[] = [
      { id: "refresh", label: "Refresh both panes", icon: <RefreshCw size={16} />, shortcut: "F5", run: () => st.refreshBoth() },
      { id: "sites", label: "Open Site Manager", icon: <Globe size={16} />, keywords: "connect server bookmark", run: () => st.openModal("sites") },
      { id: "connect-search", label: "Search files on server", icon: <Search size={16} />, keywords: "find", enabled: () => !!st.session, run: () => st.openModal("search", { side: "remote" }) },
      { id: "search-local", label: "Search files locally", icon: <Search size={16} />, keywords: "find", run: () => st.openModal("search", { side: "local" }) },
      { id: "compare", label: "Compare local and remote folders", icon: <FolderSync size={16} />, keywords: "sync diff", enabled: () => !!st.session, run: () => st.openModal("compare") },
      { id: "settings", label: "Open Settings", icon: <Settings2 size={16} />, run: () => st.openModal("settings") },
      { id: "theme", label: "Toggle dark / light theme", icon: st.theme === "light" ? <Moon size={16} /> : <Sun size={16} />, run: st.toggleTheme },
      { id: "view", label: "Toggle details / grid view", icon: st.viewMode === "details" ? <LayoutGrid size={16} /> : <List size={16} />, run: st.toggleViewMode },
      { id: "up-local", label: "Go up (local)", icon: <ArrowUp size={16} />, run: () => st.setLocalPath(parentPath(st.localPath, "local")) },
      { id: "up-remote", label: "Go up (remote)", icon: <ArrowUp size={16} />, enabled: () => !!st.session, run: () => st.setRemotePath(parentPath(st.remotePath, "remote")) },
      { id: "mkdir-local", label: "New folder (local)", icon: <FolderPlus size={16} />, run: () =>
          st.openModal("prompt", { title: "New folder (local)", label: "Folder name", onOk: (v: string) => createEntry("local", true, v) })
        },
      { id: "mkdir-remote", label: "New folder (remote)", icon: <FolderPlus size={16} />, enabled: () => !!st.session, run: () =>
          st.openModal("prompt", { title: "New folder (remote)", label: "Folder name", onOk: (v: string) => createEntry("remote", true, v) })
        },
      { id: "upload-sel", label: "Upload selected (local pane)", icon: <UploadCloud size={16} />, enabled: () => !!st.session && st.selLocal.size > 0, run: async () => {
          const items = (await api.listLocal(st.localPath)).filter((e) => st.selLocal.has(e.name));
          await transferItems("local", items);
        } },
      { id: "download-sel", label: "Download selected (remote pane)", icon: <DownloadCloud size={16} />, enabled: () => !!st.session && st.selRemote.size > 0, run: async () => {
          const items = (await api.list(st.session!.id, st.remotePath)).filter((e) => st.selRemote.has(e.name));
          await transferItems("remote", items);
        } },
      { id: "disconnect", label: "Disconnect from server", icon: <LogOut size={16} />, enabled: () => !!st.session, run: () => st.disconnect() },
    ];
    return c;
  }, [st.session, st.theme, st.viewMode, st.localPath, st.remotePath, st.selLocal, st.selRemote]); // eslint-disable-line

  const filtered = cmds.filter(
    (c) =>
      (c.enabled?.() ?? true) &&
      (q === "" ||
        c.label.toLowerCase().includes(q.toLowerCase()) ||
        c.keywords?.includes(q.toLowerCase()))
  );

  const runCommand = (c?: Cmd) => {
    if (!c) return;
    st.closeModal();
    c.run();
  };

  return (
    <div className="palette-scrim" onMouseDown={(e) => e.target === e.currentTarget && st.closeModal()}>
      <div className="palette">
        <div style={{ position: "relative" }}>
          <Search
            size={16}
            style={{ position: "absolute", left: 18, top: 18, color: "var(--outline)" }}
          />
          <input
            ref={inputRef}
            placeholder="Type a command..."
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(filtered.length - 1, s + 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
              if (e.key === "Enter") runCommand(filtered[sel]);
              if (e.key === "Escape") st.closeModal();
            }}
            style={{ paddingLeft: 42 }}
          />
        </div>
        <div className="pal-list">
          {filtered.length === 0 && (
            <div className="empty-state" style={{ padding: 18 }}>No matching commands</div>
          )}
          {filtered.map((c, i) => (
            <div
              key={c.id}
              className={`pal-item ${i === sel ? "sel" : ""}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => runCommand(c)}
            >
              {c.icon}
              {c.label}
              {c.shortcut && <span className="pk">{c.shortcut}</span>}
            </div>
          ))}
        </div>
        <div style={{ padding: "8px 16px", borderTop: "1px solid var(--divider)", fontSize: 10.5, color: "var(--on-surface-variant)", display: "flex", gap: 8 }}>
          <Keyboard size={13} /> ↑↓ navigate · Enter run · Esc close
        </div>
      </div>
    </div>
  );
}

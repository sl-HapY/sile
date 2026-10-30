import React, { useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { TitleBar } from "./components/TitleBar";
import { Toolbar } from "./components/Toolbar";
import { TabBar } from "./components/TabBar";
import { FilePane } from "./components/FilePane";
import { BottomPanel, StatusBar } from "./components/BottomPanel";
import { SiteManager, PasswordPrompt } from "./components/SiteManager";
import { PreviewView } from "./components/PreviewView";
import { EditorView } from "./components/EditorView";
import { Palette } from "./components/Palette";
import { SearchDialog, ChmodDialog, ChecksumDialog, CompareDialog, SettingsDialog, PromptDialog, ConfirmDialog, AlertDialog } from "./components/Dialogs";
import { DragLayer } from "./components/DragLayer";
import { ToastHost } from "./components/m3";
import { useStore } from "./lib/store";
import { transferItems } from "./lib/actions";

function ModalRouter() {
  const modal = useStore((s) => s.modal);
  if (!modal) return null;
  switch (modal.type) {
    case "sites": return <SiteManager />;
    case "password": return <PasswordPrompt />;
    case "search": return <SearchDialog />;
    case "chmod": return <ChmodDialog />;
    case "checksum": return <ChecksumDialog />;
    case "compare": return <CompareDialog />;
    case "settings": return <SettingsDialog />;
    case "prompt": return <PromptDialog />;
    case "confirm": return <ConfirmDialog />;
    case "alert": return <AlertDialog />;
    default: return null;
  }
}

export default function App() {
  const st = useStore();
  const activeTab = st.tabs.find((t) => t.id === st.activeTabId) ?? st.tabs[0];
  const title = st.session
    ? `${st.session.name} — Sile`
    : "Sile — File Transfer Client";

  // resizable layout (persisted)
  const [localW, setLocalW] = useState(() =>
    Math.min(85, Math.max(15, parseInt(localStorage.getItem("sile-split") || "50", 10)))
  );
  const [bottomH, setBottomH] = useState(() =>
    Math.min(560, Math.max(70, parseInt(localStorage.getItem("sile-bottom-h") || "168", 10)))
  );
  const dragV = useRef(false);
  const dragH = useRef(false);

  useEffect(() => localStorage.setItem("sile-split", String(localW)), [localW]);
  useEffect(() => localStorage.setItem("sile-bottom-h", String(bottomH)), [bottomH]);

  const onVMove = (e: React.PointerEvent) => {
    if (!dragV.current) return;
    setLocalW(Math.min(85, Math.max(15, (e.clientX / window.innerWidth) * 100)));
  };
  const onHMove = (e: React.PointerEvent) => {
    if (!dragH.current) return;
    const h = window.innerHeight - e.clientY - 26;
    setBottomH(Math.min(560, Math.max(70, h)));
  };

  // theme + accent application
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", st.theme);
  }, [st.theme]);
  useEffect(() => {
    document.documentElement.style.setProperty("--md-accent", st.accent);
  }, [st.accent]);

  // init: load sites + local home
  useEffect(() => {
    (async () => {
      st.loadSites();
      try {
        const { api } = await import("./lib/api");
        const home = await api.localHome();
        if (!useStore.getState().localPath) useStore.getState().setLocalPath(home);
      } catch {}
    })();
  }, []); // eslint-disable-line

  // OS drag & drop into panes
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      const wv = getCurrentWebview();
      const u = await wv.onDragDropEvent((ev) => {
        if (ev.payload.type === "drop") {
          const { paths, position } = ev.payload;
          handleExternalDrop(paths, position);
        }
      });
      unlisten = u as unknown as () => void;
    })();
    return () => unlisten?.();
  }, []); // eslint-disable-line

  // keyboard shortcuts
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        st.openModal("palette");
      } else if (e.key === "F5") {
        e.preventDefault();
        st.refreshBoth();
      } else if (e.key === "Escape") {
        // dialogs handle their own Escape
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [st]); // eslint-disable-line

  return (
    <div className="app">
      <TitleBar title={title} />
      <div className="accent-strip" />
      <Toolbar />
      <TabBar />
      <div className="app-main">
        {activeTab.kind === "browser" && (
          <>
            <div className="panes">
              <div className="pane-wrap" style={{ width: `${localW}%` }}>
                <FilePane side="local" />
              </div>
              <div
                className="splitter-v"
                onPointerDown={(e) => {
                  dragV.current = true;
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                }}
                onPointerMove={onVMove}
                onPointerUp={() => (dragV.current = false)}
              />
              <FilePane side="remote" />
            </div>
            <div
              className="splitter-h"
              onPointerDown={(e) => {
                dragH.current = true;
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              }}
              onPointerMove={onHMove}
              onPointerUp={() => (dragH.current = false)}
            />
          </>
        )}
        {activeTab.kind === "editor" && <EditorView tab={activeTab} />}
        {activeTab.kind === "preview" && <PreviewView tab={activeTab} />}
        <BottomPanel height={bottomH} />
      </div>
      <StatusBar />
      <DragLayer />
      <ModalRouter />
      {st.modal?.type === "palette" && <Palette />}
      <ToastHost toasts={st.toasts} />
    </div>
  );
}

/** Map an OS drag-drop to the pane under the cursor and start uploads/copies. */
async function handleExternalDrop(paths: string[], position: { x: number; y: number }) {
  const st = useStore.getState();
  const dpr = window.devicePixelRatio || 1;
  const x = position.x / dpr;
  const y = position.y / dpr;
  const el = document.elementFromPoint(x, y);
  const paneEl = el?.closest("[data-pane]") as HTMLElement | null;
  if (!paneEl) return;
  const side = paneEl.dataset.pane as "local" | "remote";

  // folder row under cursor?
  const rowEl = el?.closest("[data-droppath]") as HTMLElement | null;
  void rowEl;

  // build FileEntry list from dropped paths (stat each via backend)
  const { api } = await import("./lib/api");
  const items = [];
  for (const p of paths) {
    try {
      const s = await api.localStat(p);
      items.push(s);
    } catch {}
  }
  if (items.length === 0) return;

  if (side === "remote") {
    if (!st.session) {
      st.toast("Connect to a server first", "error");
      return;
    }
    await transferItems("local", items);
  } else {
    // copying within local disk: use the same transfer engine
    const targetDir = st.localPath;
    const { enqueue } = st;
    const { api: a } = await import("./lib/api");
    for (const item of items) {
      const dest = item.is_dir ? targetDir : targetDir + "\\" + item.name;
      const id = enqueue(item.name, "up", item.path, dest, item.is_dir);
      try {
        await a.startCopyLocal(item.path, dest, item.is_dir, id);
        st.patchTransfer(id, { status: "active" });
      } catch (e: any) {
        st.patchTransfer(id, { status: "error", error: String(e) });
      }
    }
  }
}

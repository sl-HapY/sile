import { create } from "zustand";
import type { FileEntry, LogEntry, PaneSide, SiteView, TransferDir, TransferItem } from "./types";
import { api, listenTransfer } from "./api";

export interface FileKindInfo {
  kind:
    | "dir"
    | "image"
    | "video"
    | "audio"
    | "pdf"
    | "code"
    | "text"
    | "markdown"
    | "archive"
    | "binary";
  ext: string;
}

const IMG = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "avif"];
const VID = ["mp4", "webm", "mkv", "avi", "mov", "m4v", "ogv"];
const AUD = ["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus", "wma"];
const CODE = [
  "js", "mjs", "cjs", "ts", "tsx", "jsx", "py", "rs", "go", "c", "h", "cpp",
  "hpp", "cc", "java", "kt", "swift", "rb", "php", "cs", "json", "yml", "yaml",
  "xml", "html", "htm", "css", "scss", "less", "sql", "sh", "bash", "bat",
  "ps1", "toml", "ini", "cfg", "conf", "vue", "svelte", "lua", "pl", "r",
  "dart", "gradle", "cmake", "env",
];
const MD = ["md", "markdown"];
const ARCH = ["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "iso", "jar"];

export function fileKind(name: string, isDir: boolean): FileKindInfo {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  const base = name.toLowerCase();
  if (isDir) return { kind: "dir", ext: "" };
  if (base === "dockerfile" || base === "makefile" || base === ".gitignore")
    return { kind: "code", ext };
  if (IMG.includes(ext)) return { kind: "image", ext };
  if (VID.includes(ext)) return { kind: "video", ext };
  if (AUD.includes(ext)) return { kind: "audio", ext };
  if (ext === "pdf") return { kind: "pdf", ext };
  if (MD.includes(ext)) return { kind: "markdown", ext };
  if (CODE.includes(ext)) return { kind: "code", ext };
  if (["txt", "log", "csv", "tsv", "srt", "nfo", "license", "readme"].includes(ext))
    return { kind: "text", ext };
  if (ARCH.includes(ext)) return { kind: "archive", ext };
  return { kind: "binary", ext };
}

export function fmtSize(n: number): string {
  if (n < 0) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function fmtDate(ms: number): string {
  if (!ms) return "—";
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return time;
  const thisYear = d.getFullYear() === now.getFullYear();
  const md = d.toLocaleDateString([], { month: "short", day: "numeric" });
  return thisYear ? `${md} ${time}` : d.toLocaleDateString();
}

export function fmtSpeed(bps: number): string {
  if (!bps || bps < 0) return "0 KB/s";
  return `${fmtSize(bps)}/s`;
}

export function fmtEta(remaining: number, bps: number): string {
  if (!bps || remaining <= 0) return "—";
  const s = Math.round(remaining / bps);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

export interface ProxySettings {
  kind: "none" | "socks5" | "socks4" | "http";
  host: string;
  port: number;
  username: string;
  password: string;
}

const defaultProxy = (): ProxySettings => ({
  kind: "none",
  host: "",
  port: 1080,
  username: "",
  password: "",
});

function loadProxy(): ProxySettings {
  try {
    const raw = localStorage.getItem("sile-proxy");
    if (raw) return { ...defaultProxy(), ...JSON.parse(raw) };
  } catch {}
  return defaultProxy();
}

let transferCounter = 0;
export const newTransferId = () =>
  `t${Date.now()}_${(transferCounter++).toString(36)}`;

const ACCENTS = [
  "#6750a4", "#00639b", "#00696e", "#146c2e", "#8f4c38",
  "#7d5260", "#4a4458", "#b3261e", "#7c5800", "#4b5f9e",
];

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

export interface EditorTabState {
  name: string;
  path: string;
  side: PaneSide;
  content: string;
  original: string;
  truncated: boolean;
}

export interface Tab {
  id: string;
  kind: "browser" | "editor" | "preview";
  title: string;
  // browser tab
  localPath?: string;
  remotePath?: string;
  // editor tab
  editor?: EditorTabState;
  // preview tab
  preview?: { entry: FileEntry; side: PaneSide };
}

let tabCounter = 0;
const newTabId = () => `tab_${Date.now()}_${(tabCounter++).toString(36)}`;

interface Modal {
  type: string;
  payload?: any;
}

interface SileState {
  // theme
  theme: "light" | "dark";
  accent: string;
  setTheme: (t: "light" | "dark") => void;
  toggleTheme: () => void;
  setAccent: (a: string) => void;

  viewMode: "details" | "grid";
  toggleViewMode: () => void;

  // connection
  session: { id: number; host: string; protocol: string; name: string } | null;
  connecting: boolean;
  connectError: string | null;
  connectSite: (site: Partial<SiteView> & { host: string; protocol: string }) => Promise<void>;
  disconnect: () => Promise<void>;

  sites: SiteView[];
  loadSites: () => Promise<void>;

  // proxy
  proxy: ProxySettings;
  setProxy: (p: ProxySettings) => void;

  // panes (mirrors of the ACTIVE browser tab)
  localPath: string;
  remotePath: string;
  setLocalPath: (p: string) => void;
  setRemotePath: (p: string) => void;
  localTick: number;
  remoteTick: number;
  refreshTick: number;
  refreshBoth: () => void;

  // tabs
  tabs: Tab[];
  activeTabId: string;
  openFolderTab: (remotePath?: string) => void;
  openPreviewTab: (entry: FileEntry, side: PaneSide) => void;
  openEditorTab: (ed: EditorTabState) => void;
  closeTab: (id: string, force?: boolean) => void;
  setActiveTab: (id: string) => void;
  updateEditorContent: (id: string, content: string) => void;
  markEditorSaved: (id: string) => void;

  // transfers
  transfers: Record<string, TransferItem>;
  enqueue: (name: string, dir: TransferDir, source: string, dest: string, isDir: boolean) => string;
  patchTransfer: (id: string, patch: Partial<TransferItem>) => void;
  onTransferEvent: (e: any) => void;
  clearFinished: () => void;
  retryTransfer: (id: string) => Promise<void>;
  pauseTransfer: (id: string) => Promise<void>;

  logs: LogEntry[];
  log: (level: LogEntry["level"], msg: string) => void;
  clearLogs: () => void;

  toasts: { id: number; msg: string; kind: string }[];
  toast: (msg: string, kind?: string) => void;

  modal: Modal | null;
  openModal: (type: string, payload?: any) => void;
  closeModal: () => void;

  selLocal: Set<string>;
  selRemote: Set<string>;
  setSelection: (side: "local" | "remote", sel: Set<string>) => void;
}

let toastId = 0;

function makeBrowserTab(localPath: string, remotePath: string): Tab {
  return {
    id: newTabId(),
    kind: "browser",
    title: "Files",
    localPath,
    remotePath,
  };
}

export const useStore = create<SileState>((set, get) => ({
  theme: (localStorage.getItem("sile-theme") as "light" | "dark") || "light",
  accent: localStorage.getItem("sile-accent") || ACCENTS[0],
  setTheme: (t) => {
    localStorage.setItem("sile-theme", t);
    set({ theme: t });
  },
  toggleTheme: () => get().setTheme(get().theme === "light" ? "dark" : "light"),
  setAccent: (a) => {
    localStorage.setItem("sile-accent", a);
    set({ accent: a });
  },

  viewMode: (localStorage.getItem("sile-view") as "details" | "grid") || "details",
  toggleViewMode: () => {
    const v = get().viewMode === "details" ? "grid" : "details";
    localStorage.setItem("sile-view", v);
    set({ viewMode: v });
  },

  session: null,
  connecting: false,
  connectError: null,
  connectSite: async (site) => {
    const s = get().session;
    if (s) {
      try {
        await api.disconnect(s.id);
      } catch {}
    }
    set({ connecting: true, connectError: null });
    get().log("info", `Connecting to ${site.protocol}://${site.host} ...`);
    try {
      const px = get().proxy;
      const proxyArg =
        px.kind !== "none" && px.host.trim()
          ? {
              kind: px.kind,
              host: px.host.trim(),
              port: px.port,
              username: px.username,
              password: px.password,
            }
          : undefined;
      const r = await api.connect(
        {
          id: (site as any).id || "",
          name: site.name || site.host,
          protocol: site.protocol as any,
          host: site.host,
          port: (site as any).port || 0,
          username: site.username || "root",
          password: (site as any).password || "",
          remote_start: site.remote_start || "/",
          local_start: site.local_start || "",
          accept_invalid_certs: false,
          color: site.color || "",
        },
        proxyArg
      );
      set({
        session: {
          id: r.session_id,
          host: site.host,
          protocol: site.protocol,
          name: site.name || site.host,
        },
        connecting: false,
        remotePath: site.remote_start || "/",
        refreshTick: get().refreshTick + 1,
      });
      // point every browser tab at the fresh server
      set((st) => ({
        tabs: st.tabs.map((t) =>
          t.kind === "browser" ? { ...t, remotePath: site.remote_start || "/" } : t
        ),
      }));
      get().log("success", `Connected to ${site.host}`);
      get().toast(`Connected to ${site.host}`, "success");
    } catch (e: any) {
      set({ connecting: false, connectError: String(e) });
      get().log("error", `Connection failed: ${e}`);
      get().toast(String(e), "error");
    }
  },
  disconnect: async () => {
    const s = get().session;
    if (s) {
      try {
        await api.disconnect(s.id);
      } catch {}
      set({ session: null, remotePath: "/" });
      set((st) => ({
        tabs: st.tabs.map((t) =>
          t.kind === "browser" ? { ...t, remotePath: "/" } : t
        ),
      }));
      get().log("info", "Disconnected");
    }
  },

  sites: [],
  loadSites: async () => {
    try {
      set({ sites: await api.siteList() });
    } catch (e) {
      get().log("error", `Failed to load sites: ${e}`);
    }
  },

  proxy: loadProxy(),
  setProxy: (p) => {
    localStorage.setItem("sile-proxy", JSON.stringify(p));
    set({ proxy: p });
  },

  localPath: "",
  remotePath: "/",
  localTick: 0,
  remoteTick: 0,
  setLocalPath: (p) =>
    set((st) => ({
      localPath: p,
      localTick: st.localTick + 1,
      refreshTick: st.refreshTick + 1,
      tabs: st.tabs.map((t) => (t.id === st.activeTabId && t.kind === "browser" ? { ...t, localPath: p } : t)),
    })),
  setRemotePath: (p) =>
    set((st) => ({
      remotePath: p,
      remoteTick: st.remoteTick + 1,
      refreshTick: st.refreshTick + 1,
      tabs: st.tabs.map((t) => (t.id === st.activeTabId && t.kind === "browser" ? { ...t, remotePath: p } : t)),
    })),
  refreshTick: 0,
  refreshBoth: () =>
    set((st) => ({
      refreshTick: st.refreshTick + 1,
      localTick: st.localTick + 1,
      remoteTick: st.remoteTick + 1,
    })),

  // --- tabs ---
  tabs: [makeBrowserTab("", "/")],
  activeTabId: "", // set below via initializer trick
  openFolderTab: (remotePath) => {
    const st = get();
    const active = st.tabs.find((t) => t.id === st.activeTabId);
    const tab = makeBrowserTab(
      active?.localPath ?? st.localPath,
      remotePath ?? (active?.remotePath ?? st.remotePath)
    );
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
  },
  openPreviewTab: (entry, side) => {
    const st = get();
    const existing = st.tabs.find(
      (t) => t.kind === "preview" && t.preview?.entry.path === entry.path && t.preview?.side === side
    );
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }
    const tab: Tab = {
      id: newTabId(),
      kind: "preview",
      title: entry.name,
      preview: { entry, side },
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
  },
  openEditorTab: (ed) => {
    const st = get();
    const existing = st.tabs.find((t) => t.kind === "editor" && t.editor?.path === ed.path);
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }
    const tab: Tab = {
      id: newTabId(),
      kind: "editor",
      title: ed.name,
      editor: ed,
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
  },
  closeTab: (id, force) => {
    const st = get();
    const tab = st.tabs.find((t) => t.id === id);
    if (!tab) return;
    if (
      !force &&
      tab.kind === "editor" &&
      tab.editor &&
      tab.editor.content !== tab.editor.original
    ) {
      // let the UI ask the user first (custom confirm dialog)
      import("./ui").then(({ confirmDialog }) =>
        confirmDialog(
          "Unsaved changes",
          `Discard unsaved changes to ${tab.title}?`
        ).then((ok) => ok && get().closeTab(id, true))
      );
      return;
    }
    const remaining = st.tabs.filter((t) => t.id !== id);
    if (remaining.length === 0) {
      const fresh = makeBrowserTab(st.localPath, st.session ? st.remotePath : "/");
      set({ tabs: [fresh], activeTabId: fresh.id });
      return;
    }
    const activeTabId = st.activeTabId === id ? remaining[remaining.length - 1].id : st.activeTabId;
    set({ tabs: remaining, activeTabId });
    // restore mirrors if switching to a browser tab
    const next = remaining.find((t) => t.id === activeTabId);
    if (next?.kind === "browser" && next.localPath !== undefined) {
      set({ localPath: next.localPath, remotePath: next.remotePath ?? "/", refreshTick: get().refreshTick + 1 });
    }
  },
  setActiveTab: (id) => {
    const st = get();
    if (id === st.activeTabId) return;
    const prev = st.tabs.find((t) => t.id === st.activeTabId);
    const next = st.tabs.find((t) => t.id === id);
    // save current mirrors into the browser tab we're leaving
    let tabs = st.tabs;
    if (prev?.kind === "browser") {
      tabs = tabs.map((t) =>
        t.id === prev.id ? { ...t, localPath: st.localPath, remotePath: st.remotePath } : t
      );
    }
    set({ tabs, activeTabId: id });
    if (next?.kind === "browser" && next.localPath !== undefined) {
      set({ localPath: next.localPath, remotePath: next.remotePath ?? "/", refreshTick: get().refreshTick + 1 });
    }
  },
  updateEditorContent: (id, content) =>
    set((st) => ({
      tabs: st.tabs.map((t) =>
        t.id === id && t.editor ? { ...t, editor: { ...t.editor, content } } : t
      ),
    })),
  markEditorSaved: (id) =>
    set((st) => ({
      tabs: st.tabs.map((t) =>
        t.id === id && t.editor ? { ...t, editor: { ...t.editor, original: t.editor.content } } : t
      ),
    })),

  transfers: {},
  enqueue: (name, dir, source, dest, isDir) => {
    const id = newTransferId();
    set((st) => ({
      transfers: {
        ...st.transfers,
        [id]: {
          id,
          name,
          dir,
          source,
          dest,
          isDir,
          transferred: 0,
          total: 0,
          filesDone: 0,
          filesTotal: 0,
          status: "queued",
          error: null,
          startedAt: Date.now(),
          endedAt: null,
          speed: 0,
          _lastBytes: 0,
          _lastTime: Date.now(),
        },
      },
    }));
    return id;
  },
  patchTransfer: (id, patch) =>
    set((st) => {
      const t = st.transfers[id];
      if (!t) return st;
      return { transfers: { ...st.transfers, [id]: { ...t, ...patch } } };
    }),
  onTransferEvent: (e) => {
    const st = get();
    const t = st.transfers[e.id];
    if (!t) return;
    const now = Date.now();
    const dt = (now - t._lastTime) / 1000;
    let speed = t.speed;
    if (e.status === "active" && dt > 0.25) {
      speed = Math.max(0, (e.transferred - t._lastBytes) / dt);
    }
    const patch: Partial<TransferItem> = {
      transferred: e.transferred,
      total: e.total || t.total,
      filesDone: e.files_done ?? t.filesDone,
      filesTotal: e.files_total ?? t.filesTotal,
      status: e.status,
      error: e.error,
      speed,
      _lastBytes: e.transferred,
      _lastTime: now,
    };
    if (e.status !== "active") {
      patch.endedAt = now;
      if (e.status === "done") st.log("success", `Transfer complete: ${t.name}`);
      else if (e.status === "error") st.log("error", `Transfer failed: ${t.name} — ${e.error}`);
    }
    st.patchTransfer(e.id, patch);
  },
  clearFinished: () =>
    set((st) => {
      const keep: Record<string, TransferItem> = {};
      for (const [id, t] of Object.entries(st.transfers)) {
        if (t.status === "active" || t.status === "queued") keep[id] = t;
      }
      return { transfers: keep };
    }),
  retryTransfer: async (id) => {
    const t = get().transfers[id];
    if (!t) return;
    const nid = get().enqueue(t.name, t.dir, t.source, t.dest, t.isDir);
    try {
      const sid = get().session?.id;
      if (!sid) throw new Error("not connected");
      if (t.dir === "down") await api.startDownload(sid, t.source, t.dest, t.isDir, nid);
      else await api.startUpload(sid, t.source, t.dest, t.isDir, nid);
      get().patchTransfer(nid, { status: "active" });
    } catch (e: any) {
      get().patchTransfer(nid, { status: "error", error: String(e) });
    }
  },
  pauseTransfer: async (id) => {
    const t = get().transfers[id];
    if (!t || t.status !== "active") return;
    await api.abortTransfer(id);
    get().patchTransfer(id, { status: "aborted" });
  },

  logs: [],
  log: (level, msg) =>
    set((st) => ({
      logs: [...st.logs.slice(-500), { t: Date.now(), level, msg }],
    })),
  clearLogs: () => set({ logs: [] }),

  toasts: [],
  toast: (msg, kind = "default") => {
    const id = ++toastId;
    set((st) => ({ toasts: [...st.toasts, { id, msg, kind }] }));
    setTimeout(() => {
      set((st) => ({ toasts: st.toasts.filter((t) => t.id !== id) }));
    }, 3600);
  },

  modal: null,
  openModal: (type, payload) => set({ modal: { type, payload } }),
  closeModal: () => set({ modal: null }),

  selLocal: new Set(),
  selRemote: new Set(),
  setSelection: (side, sel) =>
    set(side === "local" ? { selLocal: sel } : { selRemote: sel }),
}));

// ensure the initial browser tab id is wired
{
  const st = useStore.getState();
  useStore.setState({ activeTabId: st.tabs[0].id, localPath: st.tabs[0].localPath || "" });
}

// subscribe to backend transfer events
listenTransfer((e) => useStore.getState().onTransferEvent(e));

export { ACCENTS };

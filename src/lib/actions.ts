import { api } from "./api";
import { useStore, fileKind } from "./store";
import type { FileEntry, PaneSide, TransferDir } from "./types";

/** Start transfers for a set of items from one pane into the other pane's current dir. */
export async function transferItems(
  from: PaneSide,
  items: FileEntry[],
  targetDir?: string
): Promise<void> {
  const st = useStore.getState();
  const sessionId = st.session?.id;
  const dir: TransferDir = from === "remote" ? "down" : "up";
  const destBase = targetDir ?? (from === "remote" ? st.localPath : st.remotePath);

  if (from === "remote" && !sessionId) {
    st.toast("Not connected to a server", "error");
    return;
  }

  for (const item of items) {
    const name = item.name;
    const dest = joinPath(destBase, name, from === "remote" ? "local" : "remote");
    const source = item.path;
    const id = st.enqueue(name, dir, source, dest, item.is_dir);
    try {
      if (dir === "down") {
        await api.startDownload(sessionId!, source, dest, item.is_dir, id);
      } else {
        await api.startUpload(sessionId!, source, dest, item.is_dir, id);
      }
      st.patchTransfer(id, { status: "active" });
      st.log("info", `${dir === "down" ? "Download" : "Upload"} started: ${name}`);
    } catch (e: any) {
      st.patchTransfer(id, { status: "error", error: String(e) });
      st.log("error", `Failed to queue ${name}: ${e}`);
    }
  }
  st.toast(
    items.length === 1
      ? `${dir === "down" ? "Downloading" : "Uploading"} ${items[0].name}`
      : `${dir === "down" ? "Downloading" : "Uploading"} ${items.length} items`
  );
}

export function joinPath(base: string, name: string, side: PaneSide): string {
  if (side === "remote") {
    const b = base.endsWith("/") ? base.slice(0, -1) : base;
    return `${b || ""}/${name}`;
  }
  const b = base.replace(/[\\/]+$/, "");
  return `${b}\\${name}`;
}

export function parentPath(path: string, side: PaneSide): string {
  if (side === "remote") {
    const p = path.replace(/\/+$/, "");
    const idx = p.lastIndexOf("/");
    if (idx <= 0) return "/";
    return p.slice(0, idx);
  }
  return dirnameLocal(path);
}

export function dirnameLocal(p: string): string {
  const norm = p.replace(/[/\\]+$/, "");
  const idx = Math.max(norm.lastIndexOf("\\"), norm.lastIndexOf("/"));
  if (idx < 0) return p;
  if (idx === 2 && norm[1] === ":") return norm.slice(0, 3); // C:\
  if (idx === 0) return norm.slice(0, 1) || "/";
  return norm.slice(0, idx);
}

export function driveRoots(): string[] {
  if (navigator.platform.toLowerCase().includes("win")) {
    return ["C:\\", "D:\\", "E:\\", "F:\\"];
  }
  return ["/"];
}

/** Open a file: text/code/markdown → editor tab directly; media/image/pdf → preview tab. */
export async function openFile(item: FileEntry, side: PaneSide): Promise<void> {
  const st = useStore.getState();
  if (item.is_dir) return;
  const kind = fileKind(item.name, item.is_dir).kind;
  if (["code", "text", "markdown"].includes(kind)) {
    await editFile(item, side);
  } else {
    st.openPreviewTab(item, side);
  }
}

/** Create a new folder or empty file in the given pane's current directory. */
export async function createEntry(side: PaneSide, isDir: boolean, name: string): Promise<void> {
  const st = useStore.getState();
  const base = side === "local" ? st.localPath : st.remotePath;
  const full = joinPath(base, name, side);
  try {
    if (side === "local") {
      await api.mkdirLocal(full);
      if (!isDir) await api.writeTextLocal(full, "");
    } else {
      if (!st.session) throw new Error("not connected");
      await api.mkdirRemote(st.session.id, full);
      if (!isDir) await api.writeTextRemote(st.session.id, full, "");
    }
    st.refreshBoth();
    st.toast(`Created ${name}`);
  } catch (e: any) {
    st.toast(`Create failed: ${e}`, "error");
  }
}

/** Open in code editor directly. */
export async function editFile(item: FileEntry, side: PaneSide): Promise<void> {
  const st = useStore.getState();
  const sessionId = st.session?.id;
  try {
    const r =
      side === "remote"
        ? await api.readTextRemote(sessionId!, item.path)
        : await api.readTextLocal(item.path);
    st.openEditorTab({
      name: item.name,
      path: item.path,
      side,
      content: r.content,
      original: r.content,
      truncated: r.truncated,
    });
  } catch (e: any) {
    st.toast(`Failed to open: ${e}`, "error");
  }
}

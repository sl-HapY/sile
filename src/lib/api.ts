import { invoke } from "@tauri-apps/api/core";
import type { FileEntry, SiteInput, SiteView, TransferEvent } from "./types";

export interface ProxyConfig {
  kind: "none" | "socks5" | "socks4" | "http";
  host: string;
  port: number;
  username: string;
  password: string;
}

export const api = {
  // sites
  siteList: () => invoke<SiteView[]>("site_list"),
  siteSave: (site: SiteInput) => invoke<void>("site_save", { site }),
  siteDelete: (id: string) => invoke<void>("site_delete", { id }),
  siteGetPassword: (id: string) => invoke<string>("site_get_password", { id }),

  // sessions
  connect: (site: SiteInput, proxy?: ProxyConfig) =>
    invoke<{ session_id: number }>("connect", { site, proxy }),
  disconnect: (sessionId: number) => invoke<void>("disconnect", { sessionId }),

  // remote fs
  list: (sessionId: number, path: string) =>
    invoke<FileEntry[]>("list_dir", { sessionId, path }),
  mkdirRemote: (sessionId: number, path: string) =>
    invoke<void>("mkdir_remote", { sessionId, path }),
  removeRemote: (sessionId: number, path: string, isDir: boolean) =>
    invoke<void>("remove_remote", { sessionId, path, isDir }),
  renameRemote: (sessionId: number, from: string, to: string) =>
    invoke<void>("rename_remote", { sessionId, from, to }),
  setPermissions: (sessionId: number, path: string, mode: number, recursive: boolean) =>
    invoke<void>("set_permissions", { sessionId, path, mode, recursive }),
  readTextRemote: (sessionId: number, path: string) =>
    invoke<{ content: string; truncated: boolean }>("read_text_remote", { sessionId, path }),
  writeTextRemote: (sessionId: number, path: string, content: string) =>
    invoke<void>("write_text_remote", { sessionId, path, content }),
  searchRemote: (sessionId: number, path: string, pattern: string, maxResults?: number) =>
    invoke<string[]>("search_remote", { sessionId, path, pattern, maxResults }),
  remoteStat: (sessionId: number, path: string) =>
    invoke<FileEntry | null>("remote_stat", { sessionId, path }),

  // local fs
  listLocal: (path: string) => invoke<FileEntry[]>("list_local_dir", { path }),
  localHome: () => invoke<string>("local_home"),
  mkdirLocal: (path: string) => invoke<void>("mkdir_local", { path }),
  removeLocal: (path: string, isDir: boolean) =>
    invoke<void>("remove_local", { path, isDir }),
  renameLocal: (from: string, to: string) => invoke<void>("rename_local", { from, to }),
  readTextLocal: (path: string) =>
    invoke<{ content: string; truncated: boolean }>("read_text_local", { path }),
  writeTextLocal: (path: string, content: string) =>
    invoke<void>("write_text_local", { path, content }),
  localStat: (path: string) => invoke<FileEntry>("local_stat", { path }),

  // transfers
  startDownload: (
    sessionId: number,
    remotePath: string,
    localPath: string,
    isDir: boolean,
    transferId: string
  ) =>
    invoke<void>("start_download", {
      sessionId,
      remotePath,
      localPath,
      isDir,
      transferId,
    }),
  startUpload: (
    sessionId: number,
    localPath: string,
    remotePath: string,
    isDir: boolean,
    transferId: string
  ) =>
    invoke<void>("start_upload", {
      sessionId,
      localPath,
      remotePath,
      isDir,
      transferId,
    }),
  startCopyLocal: (
    from: string,
    to: string,
    isDir: boolean,
    transferId: string
  ) =>
    invoke<void>("start_copy_local", {
      from,
      to,
      isDir,
      transferId,
    }),
  abortTransfer: (transferId: string) => invoke<void>("abort_transfer", { transferId }),

  // terminal
  terminalOpen: (sessionId: number, termId: string, cols: number, rows: number) =>
    invoke<void>("terminal_open", { sessionId, termId, cols, rows }),
  terminalWrite: (termId: string, data: string) =>
    invoke<void>("terminal_write", { termId, data }),
  terminalResize: (termId: string, cols: number, rows: number) =>
    invoke<void>("terminal_resize", { termId, cols, rows }),
  terminalClose: (termId: string) => invoke<void>("terminal_close", { termId }),

  // utils
  previewPrepare: (path: string) =>
    invoke<{ path: string }>("preview_prepare", { path }),
  previewFetchRemote: (sessionId: number, remotePath: string) =>
    invoke<{ path: string }>("preview_fetch_remote", { sessionId, remotePath }),
  readHexLocal: (path: string, limit?: number) =>
    invoke<{ bytes: number[] }>("read_hex_local", { path, limit }),
  readHexRemote: (sessionId: number, path: string, limit?: number) =>
    invoke<{ bytes: number[] }>("read_hex_remote", { sessionId, path, limit }),
  dirSizeLocal: (path: string) =>
    invoke<{ bytes: number; files: number }>("dir_size_local", { path }),
  dirSizeRemote: (sessionId: number, path: string) =>
    invoke<{ bytes: number; files: number }>("dir_size_remote", { sessionId, path }),
  fileChecksum: (path: string, algo: string) =>
    invoke<string>("file_checksum", { path, algo }),
};

export function listenTransfer(cb: (e: TransferEvent) => void) {
  import("@tauri-apps/api/event").then(({ listen }) =>
    listen<TransferEvent>("transfer-progress", (ev) => cb(ev.payload))
  );
}

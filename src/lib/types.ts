export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: number; // epoch ms
  permissions: string | null;
  is_symlink: boolean;
}

export interface SiteView {
  id: string;
  name: string;
  protocol: "ftp" | "ftps" | "sftp";
  host: string;
  port: number;
  username: string;
  remote_start: string;
  local_start: string;
  accept_invalid_certs: boolean;
  color: string;
  has_password: boolean;
}

export interface SiteInput {
  id: string;
  name: string;
  protocol: "ftp" | "ftps" | "sftp";
  host: string;
  port: number;
  username: string;
  password: string;
  remote_start: string;
  local_start: string;
  accept_invalid_certs: boolean;
  color: string;
}

export interface TransferEvent {
  id: string;
  file_name: string;
  files_done: number;
  files_total: number;
  transferred: number;
  total: number;
  status: "active" | "done" | "error" | "aborted";
  error: string | null;
}

export type TransferDir = "down" | "up";

export interface TransferItem {
  id: string;
  name: string;
  dir: TransferDir;
  source: string;
  dest: string;
  isDir: boolean;
  transferred: number;
  total: number;
  filesDone: number;
  filesTotal: number;
  status: "queued" | "active" | "done" | "error" | "aborted";
  error: string | null;
  startedAt: number;
  endedAt: number | null;
  // derived
  speed: number; // bytes/s
  _lastBytes: number;
  _lastTime: number;
}

export type PaneSide = "local" | "remote";

export interface EditorTab {
  id: string;
  name: string;
  path: string;
  side: PaneSide;
  content: string;
  original: string;
  truncated: boolean;
  loading: boolean;
}

export interface LogEntry {
  t: number;
  level: "info" | "warn" | "error" | "success" | "debug";
  msg: string;
}

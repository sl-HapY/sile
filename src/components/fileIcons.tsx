import {
  FileText,
  FileCode2,
  FileJson,
  FileImage,
  FileVideo,
  FileAudio,
  FileArchive,
  File,
  FileSpreadsheet,
  Folder,
  FolderOpen,
  FileTerminal,
  FileType2,
} from "lucide-react";

export interface IconSpec {
  el: React.ReactNode;
  color: string;
}

export function fileIcon(name: string, isDir: boolean, size = 17, open = false): IconSpec {
  if (isDir) {
    return {
      el: open ? <FolderOpen size={size} /> : <Folder size={size} />,
      color: "var(--primary)",
    };
  }
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  const base = name.toLowerCase();
  if (["exe", "msi", "bat", "cmd", "sh", "ps1", "appimage", "deb", "rpm"].includes(ext) || base === "dockerfile")
    return { el: <FileTerminal size={size} />, color: "#4a9d5f" };
  if (["json", "yml", "yaml", "toml", "ini", "xml"].includes(ext))
    return { el: <FileJson size={size} />, color: "#c79216" };
  if (["html", "htm", "css", "scss", "less", "vue", "svelte"].includes(ext))
    return { el: <FileCode2 size={size} />, color: "#3b82c4" };
  if (
    ["js", "mjs", "cjs", "ts", "tsx", "jsx", "py", "rs", "go", "c", "h", "cpp", "hpp", "cc", "java", "kt", "rb", "php", "cs", "swift", "dart", "lua", "sql"].includes(ext)
  )
    return { el: <FileCode2 size={size} />, color: "#7c6fe0" };
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "avif"].includes(ext))
    return { el: <FileImage size={size} />, color: "#3b9d9d" };
  if (["mp4", "webm", "mkv", "avi", "mov", "m4v", "ogv"].includes(ext))
    return { el: <FileVideo size={size} />, color: "#c4559a" };
  if (["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus", "wma"].includes(ext))
    return { el: <FileAudio size={size} />, color: "#b06cc8" };
  if (["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "iso", "jar"].includes(ext))
    return { el: <FileArchive size={size} />, color: "#b58a3c" };
  if (["md", "markdown", "txt", "log", "nfo", "readme", "license"].includes(ext))
    return { el: <FileText size={size} />, color: "#5c8ac7" };
  if (["pdf"].includes(ext))
    return { el: <FileType2 size={size} />, color: "#d15b4c" };
  if (["csv", "tsv", "xls", "xlsx"].includes(ext))
    return { el: <FileSpreadsheet size={size} />, color: "#3f9d63" };
  return { el: <File size={size} />, color: "var(--on-surface-variant)" };
}

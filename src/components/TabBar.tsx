import React from "react";
import {
  FolderTree, FileCode2, FileImage, FileVideo, FileAudio, FileType2, X, Plus,
  Binary,
} from "lucide-react";
import { useStore } from "../lib/store";

function tabIcon(kind: string, title: string) {
  const ext = title.includes(".") ? title.split(".").pop()!.toLowerCase() : "";
  if (kind === "browser") return <FolderTree size={14} />;
  if (kind === "editor") return <FileCode2 size={14} />;
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "avif"].includes(ext))
    return <FileImage size={14} />;
  if (["mp4", "webm", "mkv", "avi", "mov", "m4v"].includes(ext)) return <FileVideo size={14} />;
  if (["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus"].includes(ext)) return <FileAudio size={14} />;
  if (ext === "pdf") return <FileType2 size={14} />;
  return <Binary size={14} />;
}

export function TabBar() {
  const st = useStore();

  return (
    <div
      className="top-tabs"
      onDoubleClick={(e) => {
        if (e.target === e.currentTarget) st.openFolderTab();
      }}
    >
      {st.tabs.map((t) => {
        const dirty = t.kind === "editor" && t.editor && t.editor.content !== t.editor.original;
        return (
          <div
            key={t.id}
            className={`top-tab ${t.id === st.activeTabId ? "active" : ""}`}
            title={
              t.kind === "editor"
                ? t.editor?.path
                : t.kind === "preview"
                ? t.preview?.entry.path
                : "Files"
            }
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                st.closeTab(t.id);
              } else {
                st.setActiveTab(t.id);
              }
            }}
          >
            {tabIcon(t.kind, t.title)}
            <span className="tt-title">{t.title}</span>
            {dirty && <span className="dirty-dot" />}
            <X
              size={13}
              className="tt-close"
              onClick={(e) => {
                e.stopPropagation();
                st.closeTab(t.id);
              }}
            />
          </div>
        );
      })}
      <button className="top-tab-new" onClick={() => st.openFolderTab()} title="New files tab">
        <Plus size={14} />
      </button>
    </div>
  );
}

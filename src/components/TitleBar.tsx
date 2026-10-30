import React, { useEffect, useState } from "react";
import { Minus, Square, X, Copy as CopyIcon } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function TitleBar({ title }: { title: string }) {
  const [maximized, setMaximized] = useState(false);
  const win = getCurrentWindow();

  useEffect(() => {
    let un: (() => void) | undefined;
    win.onResized(async () => {
      try {
        setMaximized(await win.isMaximized());
      } catch {}
    }).then((u) => (un = u));
    win.isMaximized().then(setMaximized).catch(() => {});
    return () => un?.();
  }, []);

  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="brand">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
          <path d="M12 10v6" />
          <path d="m9 13 3-3 3 3" />
        </svg>
        Sile
      </div>
      <div className="title-text">{title}</div>
      <div className="win-controls">
        <button
          className="titlebar-btn min"
          onClick={() => win.minimize()}
          aria-label="Minimize"
          title="Minimize"
        >
          <Minus size={15} />
        </button>
        <button
          className="titlebar-btn max"
          onClick={() => win.toggleMaximize()}
          aria-label={maximized ? "Restore" : "Maximize"}
          title={maximized ? "Restore" : "Maximize"}
        >
          {maximized ? <CopyIcon size={12} style={{ transform: "scaleX(-1)" }} /> : <Square size={12} />}
        </button>
        <button
          className="titlebar-btn close"
          onClick={() => win.close()}
          aria-label="Close"
          title="Close"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

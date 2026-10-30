import React, { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { api } from "../lib/api";
import { useStore } from "../lib/store";

let termSeq = 0;

export function TerminalView() {
  const st = useStore();
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const termIdRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const session = st.session;

  useEffect(() => {
    if (!session || !hostRef.current) return;
    let disposed = false;
    const termId = `term_${Date.now()}_${termSeq++}`;
    termIdRef.current = termId;
    setError(null);

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"Cascadia Code", Consolas, monospace',
      theme: {
        background: st.theme === "dark" ? "#13131b" : "#ffffff",
        foreground: st.theme === "dark" ? "#e6e1e9" : "#1b1b1f",
        cursor: "#6750a4",
        selectionBackground: "#6750a455",
      },
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    termRef.current = term;
    fitRef.current = fit;
    term.writeln("Connecting shell...");

    try {
      fit.fit();
    } catch {}

    const unsubs: (() => void)[] = [];

    (async () => {
      try {
        await api.terminalOpen(session.id, termId, term.cols, term.rows);
        if (disposed) return;
        term.onData((d) => {
          api.terminalWrite(termId, d).catch(() => {});
        });
        const { listen } = await import("@tauri-apps/api/event");
        const u1 = await listen<{ term_id: string; data: string }>("term-data", (ev) => {
          if (ev.payload.term_id === termId) term.write(ev.payload.data);
        });
        const u2 = await listen<{ term_id: string }>("term-exit", (ev) => {
          if (ev.payload.term_id === termId) term.writeln("\r\n\x1b[90m[shell closed]\x1b[0m");
        });
        unsubs.push(u1 as unknown as () => void, u2 as unknown as () => void);
        if (disposed) return;
        term.clear();
        setReady(true);
        setTimeout(() => fit.fit(), 50);
      } catch (e: any) {
        if (!disposed) {
          term.writeln(`\x1b[31m${String(e)}\x1b[0m`);
          setError(String(e));
        }
      }
    })();

    const onResize = () => {
      try {
        fit.fit();
        if (termIdRef.current)
          api.terminalResize(termIdRef.current, term.cols, term.rows).catch(() => {});
      } catch {}
    };
    window.addEventListener("resize", onResize);

    return () => {
      disposed = true;
      window.removeEventListener("resize", onResize);
      unsubs.forEach((u) => u?.());
      if (termIdRef.current) api.terminalClose(termIdRef.current).catch(() => {});
      term.dispose();
      termRef.current = null;
    };
  }, [session?.id]); // eslint-disable-line

  // keep terminal colors in sync with the app theme
  useEffect(() => {
    const t = termRef.current as any;
    if (t) {
      t.options.theme = {
        background: st.theme === "dark" ? "#13131b" : "#ffffff",
        foreground: st.theme === "dark" ? "#e6e1e9" : "#1b1b1f",
        cursor: "#6750a4",
        selectionBackground: "#6750a455",
      };
    }
  }, [st.theme]);

  if (!session) {
    return (
      <div className="empty-state">
        <div>Terminal requires an SFTP connection — connect to a server first</div>
      </div>
    );
  }

  return (
    <div className="terminal-view">
      {error && <div className="list-error">{error}</div>}
      <div ref={hostRef} className="terminal-host" style={{ opacity: ready ? 1 : 0.6 }} />
    </div>
  );
}

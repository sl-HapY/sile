import React, { useEffect, useRef, useState } from "react";
import { basicSetup, EditorView as CMEditorView } from "codemirror";
import { EditorState, Compartment } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { search } from "@codemirror/search";
import { Save, Loader2, FileCode2 } from "lucide-react";

import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { go as goLang } from "@codemirror/lang-go";
import { cpp } from "@codemirror/lang-cpp";
import { java } from "@codemirror/lang-java";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { yaml } from "@codemirror/lang-yaml";
import { markdown } from "@codemirror/lang-markdown";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { php } from "@codemirror/lang-php";
import { StreamLanguage } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";

import { api } from "../lib/api";
import { useStore } from "../lib/store";
import type { Tab } from "../lib/store";
import { M3Button } from "./m3";

function langExtension(name: string): any {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  const base = name.toLowerCase();
  if (base === "dockerfile") return StreamLanguage.define(dockerFile as any);
  switch (ext) {
    case "js": case "mjs": case "cjs": case "jsx":
      return javascript();
    case "ts": case "tsx":
      return javascript({ typescript: true });
    case "py": return python();
    case "rs": return rust();
    case "go": return goLang();
    case "c": case "h": case "cpp": case "hpp": case "cc": return cpp();
    case "java": case "kt": return java();
    case "html": case "htm": case "vue": case "svelte": return html();
    case "css": case "scss": case "less": return css();
    case "json": return json();
    case "yml": case "yaml": return yaml();
    case "md": case "markdown": return markdown();
    case "sql": return sql();
    case "xml": case "svg": return xml();
    case "php": return php();
    case "sh": case "bash": case "zsh": case "bat":
      return StreamLanguage.define(shell as any);
    case "toml": return StreamLanguage.define(toml as any);
    case "ini": case "cfg": case "conf": case "env":
      return StreamLanguage.define(properties as any);
    case "lua": return StreamLanguage.define(lua as any);
    default: return [];
  }
}

export function EditorView({ tab }: { tab: Tab }) {
  const st = useStore();
  const ed = tab.editor!;
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<CMEditorView | null>(null);
  const langComp = useRef(new Compartment());
  const themeComp = useRef(new Compartment());
  const [saving, setSaving] = useState(false);
  const [lineCol, setLineCol] = useState({ line: 1, col: 1 });

  useEffect(() => {
    if (!hostRef.current) return;
    const host = hostRef.current;
    host.innerHTML = "";
    const updateListener = CMEditorView.updateListener.of((u: any) => {
      if (u.docChanged) {
        st.updateEditorContent(tab.id, u.state.doc.toString());
      }
      if (u.selectionSet || u.docChanged) {
        const pos = u.state.selection.main.head;
        const line = u.state.doc.lineAt(pos);
        setLineCol({ line: line.number, col: pos - line.from + 1 });
      }
    });
    const state = EditorState.create({
      doc: ed.content,
      extensions: [
        basicSetup,
        search(),
        updateListener,
        langComp.current.of(langExtension(ed.name)),
        themeComp.current.of(st.theme === "dark" ? [oneDark] : []),
        CMEditorView.lineWrapping,
      ],
    });
    const view = new CMEditorView({ state, parent: host });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [tab.id]); // eslint-disable-line

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: themeComp.current.reconfigure(st.theme === "dark" ? [oneDark] : []),
    });
  }, [st.theme]);

  const dirty = ed.content !== ed.original;

  const save = async () => {
    setSaving(true);
    try {
      if (ed.side === "remote") {
        await api.writeTextRemote(st.session!.id, ed.path, ed.content);
      } else {
        await api.writeTextLocal(ed.path, ed.content);
      }
      st.markEditorSaved(tab.id);
      st.toast(`Saved ${ed.name}`, "success");
      st.refreshBoth();
    } catch (e: any) {
      st.toast(`Save failed: ${e}`, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="editor-view">
      <div className="editor-body" ref={hostRef} />
      <div className="editor-statusbar">
        <FileCode2 size={13} />
        <span>{ed.side === "remote" ? "REMOTE" : "LOCAL"}</span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{ed.path}</span>
        {ed.truncated && (
          <span style={{ color: "var(--warning)" }}>truncated (file too large)</span>
        )}
        <div className="grow" />
        <span>
          Ln {lineCol.line}, Col {lineCol.col}
        </span>
        <M3Button
          variant="filled"
          style={{ height: 30, padding: "0 14px" }}
          onClick={save}
          disabled={!dirty || saving}
        >
          {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
          Save {ed.side === "remote" ? "to server" : ""}
        </M3Button>
      </div>
    </div>
  );
}

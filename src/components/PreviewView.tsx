import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  X, ZoomIn, ZoomOut, RotateCw, Maximize2, Play, Pause, Volume2, VolumeX,
  Loader2, Pencil, FileWarning,
} from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { api } from "../lib/api";
import { fileKind, useStore } from "../lib/store";
import { editFile } from "../lib/actions";
import { IconButton, Tooltip } from "./m3";
import type { Tab } from "../lib/store";
import { marked } from "marked";

function hexDump(bytes: number[]): string {
  const lines: string[] = [];
  for (let off = 0; off < bytes.length; off += 16) {
    const slice = bytes.slice(off, off + 16);
    const hex = slice
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" ")
      .padEnd(47, " ");
    const ascii = slice
      .map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : "."))
      .join("");
    lines.push(
      `<span class="hx-off">${off.toString(16).padStart(8, "0")}</span>  ${hex}  <span class="hx-ascii">${ascii
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")}</span>`
    );
  }
  return lines.join("\n");
}

export function PreviewView({ tab }: { tab: Tab }) {
  const st = useStore();
  const payload = tab.preview!;
  const entry = payload.entry;
  const side = payload.side;
  const kind = fileKind(entry.name, entry.is_dir).kind;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<{ content: string; truncated: boolean } | null>(null);
  const [hex, setHex] = useState<string | null>(null);
  const [html, setHtml] = useState<string | null>(null);

  const [zoom, setZoom] = useState(1);
  const [rot, setRot] = useState(0);
  const panRef = useRef<{ x: number; y: number } | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setUrl(null);
    setText(null);
    setHex(null);
    setHtml(null);
    setZoom(1);
    setRot(0);
    setPan({ x: 0, y: 0 });

    (async () => {
      try {
        if (kind === "image" || kind === "video" || kind === "audio" || kind === "pdf") {
          if (side === "local") {
            setUrl(convertFileSrc(entry.path));
          } else {
            const r = await api.previewFetchRemote(st.session!.id, entry.path);
            setUrl(convertFileSrc(r.path));
          }
        } else if (kind === "code" || kind === "text") {
          const r =
            side === "local"
              ? await api.readTextLocal(entry.path)
              : await api.readTextRemote(st.session!.id, entry.path);
          setText(r);
        } else if (kind === "markdown") {
          const r =
            side === "local"
              ? await api.readTextLocal(entry.path)
              : await api.readTextRemote(st.session!.id, entry.path);
          setHtml(await marked(r.content));
        } else {
          const r =
            side === "local"
              ? await api.readHexLocal(entry.path, 4096)
              : await api.readHexRemote(st.session!.id, entry.path, 4096);
          setHex(hexDump(r.bytes));
        }
      } catch (e: any) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [entry.path, side]); // eslint-disable-line

  const onWheel = useCallback((ev: React.WheelEvent) => {
    if (fileKind(entry.name, entry.is_dir).kind !== "image") return;
    ev.preventDefault();
    setZoom((z) => Math.min(8, Math.max(0.1, z * (ev.deltaY < 0 ? 1.15 : 0.87))));
  }, [entry]);

  const isMedia = kind === "video" || kind === "audio";
  const fmtT = (t: number) => {
    if (!isFinite(t)) return "0:00";
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="preview-view">
      <div className="preview-toolbar">
        <span className="pname" title={entry.path}>
          {entry.path}
        </span>
        {(kind === "markdown" || kind === "image") && (
          <Tooltip label="Edit source in code editor">
            <IconButton
              onClick={() => {
                st.closeTab(tab.id);
                editFile({ ...entry, is_dir: false } as any, side);
              }}
            >
              <Pencil size={16} />
            </IconButton>
          </Tooltip>
        )}
        <IconButton onClick={() => st.closeTab(tab.id)} title="Close tab">
          <X size={17} />
        </IconButton>
      </div>

      <div className="preview-body" onWheel={onWheel}>
        {loading && (
          <div className="preview-loading">
            <Loader2 size={34} className="spin" />
            <div>{side === "remote" ? "Downloading for preview..." : "Loading preview..."}</div>
          </div>
        )}
        {!loading && error && (
          <div className="preview-loading" style={{ color: "var(--error)" }}>
            <FileWarning size={34} />
            <div>{error}</div>
          </div>
        )}
        {!loading && !error && kind === "image" && url && (
          <>
            <div className="img-host">
              <img
                src={url}
                alt={entry.name}
                draggable={false}
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) rotate(${rot}deg) scale(${zoom})`,
                  cursor: "grab",
                }}
                onPointerDown={(e) => {
                  panRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
                  (e.target as HTMLElement).setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  if (panRef.current)
                    setPan({ x: e.clientX - panRef.current.x, y: e.clientY - panRef.current.y });
                }}
                onPointerUp={() => (panRef.current = null)}
              />
            </div>
            <div className="preview-zoom-controls">
              <IconButton onClick={() => setZoom((z) => Math.max(0.1, z * 0.85))}>
                <ZoomOut size={16} />
              </IconButton>
              <span style={{ fontSize: 11, minWidth: 44, textAlign: "center" }}>
                {Math.round(zoom * 100)}%
              </span>
              <IconButton onClick={() => setZoom((z) => Math.min(8, z * 1.18))}>
                <ZoomIn size={16} />
              </IconButton>
              <IconButton onClick={() => setRot((r) => (r + 90) % 360)}>
                <RotateCw size={15} />
              </IconButton>
              <IconButton
                onClick={() => {
                  setZoom(1);
                  setRot(0);
                  setPan({ x: 0, y: 0 });
                }}
              >
                <Maximize2 size={15} />
              </IconButton>
            </div>
          </>
        )}
        {!loading && !error && isMedia && url && (
          <div className="media-shell">
            {kind === "video" && (
              <video
                ref={videoRef}
                src={url}
                onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
                onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onClick={() => (playing ? videoRef.current?.pause() : videoRef.current?.play())}
                style={{ maxHeight: "60vh", borderRadius: 12 }}
              />
            )}
            {kind === "audio" && (
              <audio
                ref={videoRef as any}
                src={url}
                onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
                onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                style={{ display: "none" }}
              />
            )}
            {kind === "audio" && (
              <div className="audio-disc">
                <Play size={72} style={{ opacity: playing ? 1 : 0.6 }} />
              </div>
            )}
            <div className="media-controls">
              <IconButton
                filled
                onClick={() => {
                  const el = videoRef.current;
                  if (!el) return;
                  if (playing) el.pause();
                  else el.play();
                }}
              >
                {playing ? <Pause size={20} /> : <Play size={20} />}
              </IconButton>
              <span className="mtime">{fmtT(time)}</span>
              <input
                type="range"
                className="media-seek"
                min={0}
                max={dur || 0}
                step={0.1}
                value={time}
                onChange={(e) => {
                  const el = videoRef.current;
                  if (el) el.currentTime = parseFloat(e.target.value);
                }}
              />
              <span className="mtime">{fmtT(dur)}</span>
              <IconButton
                onClick={() => {
                  const el = videoRef.current;
                  if (!el) return;
                  el.muted = !el.muted;
                  setMuted(el.muted);
                }}
              >
                {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </IconButton>
            </div>
          </div>
        )}
        {!loading && !error && kind === "pdf" && url && (
          <div className="pdf-host">
            <PdfViewer url={url} />
          </div>
        )}
        {!loading && !error && (kind === "code" || kind === "text") && text && (
          <div className="text-host">
            <pre>{text.content}</pre>
          </div>
        )}
        {!loading && !error && kind === "markdown" && html && (
          <div className="markdown-view" dangerouslySetInnerHTML={{ __html: html }} />
        )}
        {!loading && !error && hex && (
          <div className="hex-view" dangerouslySetInnerHTML={{ __html: hex }} />
        )}
      </div>
    </div>
  );
}

function PdfViewer({ url }: { url: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (started) return;
    let cancelled = false;
    setStarted(true);
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        // @ts-ignore
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url
        ).toString();
        const doc = await pdfjs.getDocument(url).promise;
        if (cancelled) return;
        const host = hostRef.current;
        if (!host) return;
        for (let i = 1; i <= Math.min(doc.numPages, 50); i++) {
          const page = await doc.getPage(i);
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.cssText =
            "display:block;margin:16px auto;box-shadow:var(--shadow-2);border-radius:4px;background:#fff";
          const ctx = canvas.getContext("2d")!;
          await page.render({ canvasContext: ctx, viewport } as any).promise;
          host.appendChild(canvas);
        }
      } catch (e) {
        console.error("pdf render", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, started]);

  return (
    <div ref={hostRef}>
      <div className="preview-loading" style={{ padding: 60 }}>
        <Loader2 size={30} className="spin" />
        <div>Rendering PDF...</div>
      </div>
    </div>
  );
}

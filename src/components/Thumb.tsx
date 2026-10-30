import React, { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { api } from "../lib/api";
import { fileKind, useStore } from "../lib/store";
import type { FileEntry, PaneSide } from "../lib/types";
import { fileIcon } from "./fileIcons";

// ---------------------------------------------------------------------------
// Remote thumbnail download queue (max 3 parallel, cached per path)
// ---------------------------------------------------------------------------

const thumbCache = new Map<string, string>();
const pending = new Set<string>();
const queue: (() => void)[] = [];
const MAX_PARALLEL = 3;

function pump() {
  while (pending.size < MAX_PARALLEL && queue.length > 0) {
    const job = queue.shift()!;
    job();
  }
}

function enqueueThumb(sessionId: number, path: string, done: (src: string | null) => void) {
  const cached = thumbCache.get(path);
  if (cached) {
    done(cached);
    return;
  }
  queue.push(() => {
    pending.add(path);
    api
      .previewFetchRemote(sessionId, path)
      .then((r) => {
        const src = convertFileSrc(r.path);
        thumbCache.set(path, src);
        done(src);
      })
      .catch(() => done(null))
      .finally(() => {
        pending.delete(path);
        pump();
      });
  });
  pump();
}

// ---------------------------------------------------------------------------
// Thumbnail: real image preview where possible, icon fallback otherwise
// ---------------------------------------------------------------------------

export function Thumb({
  entry,
  side,
  size = 64,
}: {
  entry: FileEntry;
  side: PaneSide;
  size?: number;
}) {
  const kind = fileKind(entry.name, entry.is_dir).kind;
  const [src, setSrc] = useState<string | null>(
    kind === "image" && side === "local" ? thumbCache.get(entry.path) ?? null : null
  );
  const [failed, setFailed] = useState(false);
  const session = useStore((s) => s.session);
  const dead = useRef(false);

  useEffect(() => {
    if (kind !== "image" || failed) return;
    dead.current = false;

    if (side === "local") {
      setSrc(convertFileSrc(entry.path));
      return;
    }
    if (!session) return;
    enqueueThumb(session.id, entry.path, (s) => {
      if (!dead.current) {
        setSrc(s);
        if (!s) setFailed(true);
      }
    });
    return () => {
      dead.current = true;
    };
  }, [entry.path, side, session, kind, failed]);

  const ic = fileIcon(entry.name, entry.is_dir, Math.round(size * 0.72));

  if (src && !failed) {
    return (
      <img
        className="thumb-img"
        src={src}
        alt=""
        loading="lazy"
        draggable={false}
        style={{ width: size, height: size }}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span
      className={`gicon ${entry.is_dir ? "dir" : ""}`}
      style={{ color: ic.color, width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      {ic.el}
    </span>
  );
}

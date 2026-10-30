import React, { useEffect, useState } from "react";
import { DownloadCloud, UploadCloud, FolderInput } from "lucide-react";
import { onDragChange } from "../lib/dnd";
import type { DragState } from "../lib/dnd";

/** Floating ghost that follows the pointer during an internal drag. */
export function DragLayer() {
  const [drag, setDrag] = useState<DragState | null>(null);

  useEffect(
    () =>
      onDragChange((d) => {
        setDrag(d);
      }),
    []
  );

  if (!drag) return null;

  const overFolder = drag.over && drag.over !== "local" && drag.over !== "remote";
  const samePane = drag.over === drag.side;

  return (
    <div
      className="drag-layer"
      style={{ left: drag.x + 14, top: drag.y + 10 }}
    >
      <div className="drag-ghost">
        {samePane ? <FolderInput size={15} /> : drag.side === "remote" ? (
          <DownloadCloud size={15} />
        ) : (
          <UploadCloud size={15} />
        )}
        {drag.items.length > 1 ? `${drag.items.length} items` : drag.items[0]?.name}
      </div>
      {overFolder && <div className="drag-hint">Move into folder</div>}
      {!samePane && !overFolder && (
        <div className="drag-hint">
          {drag.side === "remote" ? "Drop to download" : "Drop to upload"}
        </div>
      )}
    </div>
  );
}

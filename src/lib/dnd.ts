/**
 * Pointer-based internal drag engine.
 * Tauri's native drag-drop handler swallows HTML5 DnD events, so internal
 * pane-to-pane dragging is implemented with pointer events instead.
 */
import type { FileEntry, PaneSide } from "./types";

export interface DragItems {
  side: PaneSide;
  items: { name: string; path: string; is_dir: boolean }[];
}

export interface DragState extends DragItems {
  x: number;
  y: number;
  over?: string | null;
}

type Listener = (s: DragState | null) => void;

let current: DragState | null = null;
const listeners = new Set<Listener>();

export function onDragChange(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getDrag(): DragState | null {
  return current;
}

export function updateDrag(d: DragState | null) {
  current = d;
  listeners.forEach((l) => l(d ? { ...d } : null));
}

export function entriesToDragItems(items: FileEntry[]): DragItems["items"] {
  return items.map((i) => ({ name: i.name, path: i.path, is_dir: i.is_dir }));
}

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp, ChevronRight, Edit3, Eye, Grid2X2, HardDrive, List, Pencil,
  Plus, RefreshCw, Search, Trash2, UploadCloud, DownloadCloud, FolderPlus,
  FilePlus2, FolderOpen, ShieldCheck, Hash, Copy, FolderInput, Loader2,
} from "lucide-react";
import { api } from "../lib/api";
import { fmtDate, fmtSize, useStore, fileKind } from "../lib/store";
import type { FileEntry, PaneSide } from "../lib/types";
import { fileIcon } from "./fileIcons";
import { Thumb } from "./Thumb";
import { IconButton, Checkbox, ContextMenu, MenuItemDef, Tooltip, LinearProgress } from "./m3";
import { confirmDialog, promptDialog } from "../lib/ui";
import {
  onDragChange, updateDrag, entriesToDragItems, getDrag,
} from "../lib/dnd";
import type { DragItems } from "../lib/dnd";
import { editFile, joinPath, openFile, parentPath, transferItems } from "../lib/actions";

interface SortState {
  key: "name" | "size" | "modified";
  dir: 1 | -1;
}

function isTextLike(name: string, isDir: boolean) {
  const k = fileKind(name, isDir).kind;
  return ["code", "text", "markdown"].includes(k);
}

// recursive folder sizes, cached per path for the session
const folderSizeCache = new Map<string, { bytes: number; files: number }>();

export function useFolderSizes(
  side: PaneSide,
  entries: FileEntry[],
  session: { id: number } | null
): Record<string, { bytes: number; files: number }> {
  const [sizes, setSizes] = useState<Record<string, { bytes: number; files: number }>>({});
  useEffect(() => {
    let cancelled = false;
    // seed from cache first so nothing flickers or "refreshes"
    const seed: Record<string, { bytes: number; files: number }> = {};
    let missing: FileEntry[] = [];
    for (const e of entries) {
      if (!e.is_dir) continue;
      const cached = folderSizeCache.get(e.path);
      if (cached) seed[e.path] = cached;
      else missing.push(e);
    }
    setSizes((s) => ({ ...s, ...seed }));
    if (missing.length === 0) return;
    const todo = missing;
    (async () => {
      // small delay so interactive listing/loads go first
      await new Promise((r) => setTimeout(r, 600));
      for (const e of todo) {
        if (cancelled) return;
        const cached = folderSizeCache.get(e.path);
        if (cached) {
          setSizes((s) => ({ ...s, [e.path]: cached }));
          continue;
        }
        try {
          const r =
            side === "local"
              ? await api.dirSizeLocal(e.path)
              : await api.dirSizeRemote(session!.id, e.path);
          folderSizeCache.set(e.path, r);
          if (!cancelled) setSizes((s) => ({ ...s, [e.path]: r }));
        } catch {
          // ignore (permission errors etc.)
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entries, side, session]);
  return sizes;
}

export function FilePane({ side }: { side: PaneSide }) {
  const st = useStore();
  const session = st.session;
  const path = side === "local" ? st.localPath : st.remotePath;
  const setPath = side === "local" ? st.setLocalPath : st.setRemotePath;

  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>({ key: "name", dir: 1 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [filtering, setFiltering] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItemDef[] } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const renameCommitted = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // reset selection when path changes
  useEffect(() => {
    setSelected(new Set());
    setFilter("");
    setFiltering(false);
  }, [path]);

  useEffect(() => {
    st.setSelection(side, selected);
  }, [selected]); // eslint-disable-line

  const load = useCallback(async () => {
    if (side === "remote" && !session) {
      setEntries([]);
      setError(null);
      return;
    }
    if (!path) {
      if (side === "local") {
        try {
          const home = await api.localHome();
          st.setLocalPath(home);
        } catch {}
      }
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list =
        side === "local" ? await api.listLocal(path) : await api.list(session!.id, path);
      setEntries(list);
    } catch (e: any) {
      setError(String(e));
      setEntries([]);
      st.log("error", `Failed to list ${path}: ${e}`);
    } finally {
      setLoading(false);
    }
  }, [side, session, path]); // eslint-disable-line

  useEffect(() => {
    load();
    // per-side tick: navigating the remote pane must not reload the local pane
  }, [load, side === "local" ? st.localTick : st.remoteTick]);

  const visible = useMemo(() => {
    let list = entries;
    if (filter) {
      const q = filter.toLowerCase();
      list = list.filter((e) => e.name.toLowerCase().includes(q));
    }
    const sorted = [...list].sort((a, b) => {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
      let r = 0;
      if (sort.key === "name") r = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      else if (sort.key === "size") r = a.size - b.size;
      else r = a.modified - b.modified;
      return r * sort.dir;
    });
    return sorted;
  }, [entries, filter, sort]);

  const selSet = side === "local" ? st.selLocal : st.selRemote;
  const selectedEntries = useMemo(
    () => entries.filter((e) => selSet.has(e.name)),
    [entries, selSet]
  );
  const dirSizes = useFolderSizes(side, entries, session);

  const sizeLabel = (e: FileEntry) =>
    e.is_dir
      ? dirSizes[e.path]
        ? `${fmtSize(dirSizes[e.path].bytes)} (${dirSizes[e.path].files})`
        : "…"
      : fmtSize(e.size);

  // ---------------- navigation ----------------

  const openEntry = (e: FileEntry) => {
    if (e.is_dir) {
      setPath(e.path);
    } else {
      openFile(e, side);
    }
  };

  const goUp = () => {
    if (!path) return;
    setPath(parentPath(path, side));
  };

  // ---------------- row click ----------------

  const clickRow = (e: FileEntry, ev: React.MouseEvent) => {
    if (ev.ctrlKey || ev.metaKey) {
      setSelected((s) => {
        const n = new Set(s);
        if (n.has(e.name)) n.delete(e.name);
        else n.add(e.name);
        return n;
      });
    } else if (ev.shiftKey && selected.size > 0) {
      const names = visible.map((v) => v.name);
      const last = [...selected].filter((n) => names.includes(n)).pop()!;
      const i1 = names.indexOf(last);
      const i2 = names.indexOf(e.name);
      const range = names.slice(Math.min(i1, i2), Math.max(i1, i2) + 1);
      setSelected((s) => new Set([...s, ...range]));
    } else {
      setSelected(new Set([e.name]));
    }
  };

  // ---------------- drag & drop (pointer-based; WebView swallows HTML5 DnD) ----------------

  const dragCandidate = useRef<{ x: number; y: number; items: DragItems } | null>(null);
  const suppressClick = useRef(false);
  const [dragOverPane, setDragOverPaneLocal] = useState<string | null>(null);

  const performDrop = async (
    from: PaneSide,
    items: DragItems["items"],
    targetDir: string | null
  ) => {
    const st = useStore.getState();
    if (!items.length) return;
    try {
      if (from === side) {
        // same-pane: only dropping onto a folder performs a move
        if (!targetDir) return;
        const filtered = items.filter((it) => it.path !== targetDir);
        if (!filtered.length) return;
        for (const it of filtered) {
          if (side === "local") {
            await api.renameLocal(it.path, joinPath(targetDir, it.name, "local"));
          } else if (st.session) {
            await api.renameRemote(st.session.id, it.path, joinPath(targetDir, it.name, "remote"));
          }
        }
        st.refreshBoth();
        st.toast(`Moved ${filtered.length} item(s)`);
        return;
      }
      const entries: FileEntry[] = items.map((i) => ({
        ...i,
        size: 0,
        modified: 0,
        permissions: null,
        is_symlink: false,
      }));
      await transferItems(from, entries, targetDir ?? undefined);
    } catch (e: any) {
      st.toast(`Move failed: ${e}`, "error");
    }
  };

  // global pointer listeners drive the drag lifecycle
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const cand = dragCandidate.current;
      if (!cand) return;
      const drag = getDrag();
      if (!drag && Math.hypot(e.clientX - cand.x, e.clientY - cand.y) <= 6) return;
      // hit-test what's under the pointer for highlighting
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const pane = el?.closest("[data-pane]") as HTMLElement | null;
      const row = el?.closest("[data-droptarget]") as HTMLElement | null;
      const over = row?.dataset.droptarget ?? pane?.dataset.pane ?? null;
      updateDrag({ ...cand.items, x: e.clientX, y: e.clientY, over });
      setDragOverPaneLocal(over);
    };
    const up = async (e: PointerEvent) => {
      const cand = dragCandidate.current;
      const drag = getDrag();
      dragCandidate.current = null;
      setDragOverPaneLocal(null);
      if (!cand || !drag) {
        updateDrag(null);
        return;
      }
      updateDrag(null);
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 80);
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const crumb = el?.closest("[data-droppath]") as HTMLElement | null;
      const row = el?.closest("[data-droptarget]") as HTMLElement | null;
      const pane = el?.closest("[data-pane]") as HTMLElement | null;
      if (crumb?.dataset.droppath) {
        await performDrop(drag.side, drag.items, crumb.dataset.droppath);
      } else if (row?.dataset.droptarget) {
        await performDrop(drag.side, drag.items, row.dataset.droptarget);
      } else if (pane && pane.dataset.pane !== drag.side) {
        await performDrop(drag.side, drag.items, null);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, []); // eslint-disable-line

  const rowPointerDown = (e: React.PointerEvent, entry: FileEntry) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest(".m3-check") || target.closest("input") || target.closest(".tt-close")) return;
    const multi = selSet.has(entry.name) && selectedEntries.length > 1;
    const items = multi ? selectedEntries : [entry];
    dragCandidate.current = {
      x: e.clientX,
      y: e.clientY,
      items: { side, items: entriesToDragItems(items) },
    };
  };

  const clickRowGuarded = (e: FileEntry, ev: React.MouseEvent) => {
    if (suppressClick.current) return;
    clickRow(e, ev);
  };

  // ---------------- context menu ----------------

  const rowMenu = (e: FileEntry): MenuItemDef[] => {
    const multi = selected.has(e.name) && selectedEntries.length > 1;
    const targets = multi ? selectedEntries : [e];
    const isRemote = side === "remote";
    return [
      ...(e.is_dir
        ? [
            {
              label: "Open",
              icon: <FolderOpen size={15} />,
              onClick: () => setPath(e.path),
            },
            {
              label: "Open in new tab",
              icon: <FolderInput size={15} />,
              onClick: () => {
                if (side === "remote") st.openFolderTab(e.path);
                else {
                  st.openFolderTab();
                  st.setLocalPath(e.path);
                }
              },
            },
          ]
        : [
            {
              label: "Open / Preview",
              icon: <Eye size={15} />,
              onClick: () => openFile(e, side),
            },
            ...(isTextLike(e.name, e.is_dir)
              ? [{ label: "Edit in Code Editor", icon: <Edit3 size={15} />, onClick: () => editFile(e, side) }]
              : []),
          ]),
      { separator: true },
      {
        label: isRemote ? "Download" : "Upload",
        icon: isRemote ? <DownloadCloud size={15} /> : <UploadCloud size={15} />,
        disabled: isRemote && !session,
        onClick: () => transferItems(side, targets),
      },
      {
        label: "Copy to other pane",
        icon: <Copy size={15} />,
        disabled: isRemote && !session,
        onClick: () => transferItems(side, targets),
      },
      { separator: true },
      {
        label: "Rename",
        icon: <Pencil size={15} />,
        shortcut: "F2",
        onClick: () => {
          renameCommitted.current = false;
          setRenaming(e.name);
          setRenameVal(e.name);
        },
      },
      {
        label: "Delete",
        icon: <Trash2 size={15} />,
        danger: true,
        shortcut: "Del",
        onClick: () => deleteItems(targets),
      },
      ...(side === "remote" && !e.is_dir
        ? [{ separator: true } as MenuItemDef, { label: "Permissions (chmod)", icon: <ShieldCheck size={15} />, onClick: () => st.openModal("chmod", { entry: e }) } as MenuItemDef]
        : []),
      ...(!e.is_dir && !isRemote
        ? [{ separator: true } as MenuItemDef, { label: "Checksum (MD5/SHA256)", icon: <Hash size={15} />, onClick: () => st.openModal("checksum", { entry: e }) } as MenuItemDef]
        : []),
    ];
  };

  const paneMenu = (): MenuItemDef[] => {
    const isRemote = side === "remote";
    return [
      { sectionLabel: isRemote ? "Remote" : "Local" },
      { label: "Refresh", icon: <RefreshCw size={15} />, shortcut: "F5", onClick: load },
      { label: "Go up", icon: <ArrowUp size={15} />, onClick: goUp, disabled: !path },
      { separator: true },
      { label: "New folder", icon: <FolderPlus size={15} />, onClick: () => newItem(true) },
      { label: "New file", icon: <FilePlus2 size={15} />, onClick: () => newItem(false) },
      { separator: true },
      {
        label: "Search in folder",
        icon: <Search size={15} />,
        disabled: isRemote && !session,
        onClick: () => st.openModal("search", { side }),
      },
      {
        label: isRemote ? "Compare with local pane" : "Compare with remote pane",
        icon: <FolderInput size={15} />,
        disabled: !(side === "local" || session),
        onClick: () => st.openModal("compare", {}),
      },
      { separator: true },
      {
        label: "Upload files here",
        icon: <UploadCloud size={15} />,
        disabled: !(side === "remote" && session),
        onClick: () => transferItems("local", selLocalEntries()),
      },
      {
        label: "Download files here",
        icon: <DownloadCloud size={15} />,
        disabled: !(side === "local" && session),
        onClick: () => transferItems("remote", selRemoteEntries()),
      },
    ];
  };

  const selLocalEntries = () => {
    // upload selected local items
    const s = useStore.getState().selLocal;
    return visible.filter((e) => s.has(e.name));
  };
  const selRemoteEntries = () => {
    const s = useStore.getState().selRemote;
    return visible.filter((e) => s.has(e.name));
  };

  const deleteItems = async (targets: FileEntry[]) => {
    const count = targets.length;
    const ok = await confirmDialog(
      "Delete",
      count > 1
        ? `Delete ${count} items permanently?`
        : `Delete "${targets[0].name}" permanently?`
    );
    if (!ok) return;
    const sessionId = st.session?.id;
    for (const t of targets) {
      try {
        if (side === "local") await api.removeLocal(t.path, t.is_dir);
        else await api.removeRemote(sessionId!, t.path, t.is_dir);
        st.log("info", `Deleted ${t.path}`);
      } catch (e: any) {
        st.toast(`Delete failed: ${t.name} — ${e}`, "error");
      }
    }
    st.refreshBoth();
  };

  const newItem = async (isDir: boolean) => {
    const name = await promptDialog(
      isDir ? "New folder" : "New file",
      isDir ? "Folder name" : "File name"
    );
    if (!name) return;
    const full = joinPath(path, name, side);
    try {
      if (side === "local") await api.mkdirLocal(full);
      else await api.mkdirRemote(st.session!.id, full);
      if (!isDir) {
        // create empty file
        if (side === "local") await api.writeTextLocal(full, "");
        else await api.writeTextRemote(st.session!.id, full, "");
      }
      st.refreshBoth();
    } catch (e: any) {
      st.toast(`Create failed: ${e}`, "error");
    }
  };

  const doRename = async () => {
    const from = renaming!;
    const to = renameVal.trim();
    setRenaming(null);
    if (!to || to === from) return;
    const fromPath = joinPath(path, from, side);
    const toPath = joinPath(path, to, side);
    try {
      if (side === "local") await api.renameLocal(fromPath, toPath);
      else await api.renameRemote(st.session!.id, fromPath, toPath);
      st.refreshBoth();
    } catch (e: any) {
      st.toast(`Rename failed: ${e}`, "error");
    }
  };

  // blur handler — skip when Enter/Escape already committed
  const commitRename = () => {
    if (renameCommitted.current) return;
    renameCommitted.current = true;
    doRename();
  };

  // ---------------- render helpers ----------------

  const crumbs = useMemo(() => {
    if (!path) return [];
    if (side === "remote") {
      const parts = path.split("/").filter(Boolean);
      const out = [{ name: "/", path: "/" }];
      let acc = "";
      for (const p of parts) {
        acc += `/${p}`;
        out.push({ name: p, path: acc });
      }
      return out;
    }
    const parts = path.split(/[\\/]+/).filter(Boolean);
    const out: { name: string; path: string }[] = [];
    let acc = "";
    parts.forEach((p, i) => {
      if (i === 0 && p.endsWith(":")) {
        acc = p + "\\";
      } else {
        acc = acc.endsWith("\\") || acc === "" ? acc + p + "\\" : acc + "\\" + p;
      }
      out.push({ name: p, path: acc });
    });
    return out;
  }, [path, side]);

  const startPathEdit = async () => {
    const val = await promptDialog("Go to folder", "Full path", path);
    if (val && val.trim()) setPath(val.trim());
  };

  // pane header content
  const paneTitle =
    side === "local" ? (
      <>
        <HardDrive size={14} />
        <span>Local</span>
      </>
    ) : (
      <>
        <span className={`conn-dot ${session ? "on" : ""}`} />
        <span>Remote</span>
      </>
    );

  const cols = { name: "44%", size: "12%", modified: "18%", perms: "14%", type: "12%" };

  return (
    <div
      className={`pane ${side === "local" ? "left" : "right"} ${
        dragOverPane === side ? "drag-over" : ""
      }`}
      data-pane={side}
      onContextMenu={(ev) => {
        ev.preventDefault();
        setMenu({ x: ev.clientX, y: ev.clientY, items: paneMenu() });
      }}
    >
      <div className="pane-header">
        <div className="pane-title">{paneTitle}</div>
        {side === "remote" && session && (
          <span className="conn-label">
            {session.protocol.toUpperCase()} · {session.host}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <Tooltip label={filtering ? "Close filter" : "Filter files"}>
          <IconButton
            active={filtering}
            onClick={() => {
              setFiltering(!filtering);
              setFilter("");
            }}
          >
            <Search size={16} />
          </IconButton>
        </Tooltip>
        <Tooltip label={st.viewMode === "details" ? "Grid view" : "Details view"}>
          <IconButton onClick={st.toggleViewMode}>
            {st.viewMode === "details" ? <Grid2X2 size={16} /> : <List size={16} />}
          </IconButton>
        </Tooltip>
        <Tooltip label="Refresh">
          <IconButton onClick={load}>
            <RefreshCw size={16} />
          </IconButton>
        </Tooltip>
        <Tooltip label="Parent folder">
          <IconButton onClick={goUp}>
            <ArrowUp size={16} />
          </IconButton>
        </Tooltip>
      </div>

      <div
        className="pane-header"
        style={{ minHeight: 36, padding: "4px 12px" }}
        onDoubleClick={startPathEdit}
      >
        {filtering ? (
          <input
            autoFocus
            className="crumb-edit"
            placeholder="Filter by name..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setFiltering(false)}
          />
        ) : (
          <div className="breadcrumb">
            {crumbs.length === 0 && <span style={{ color: "var(--on-surface-variant)", fontSize: 12 }}>Not connected</span>}
            {crumbs.map((c, i) => (
              <React.Fragment key={c.path}>
                {i > 0 && (
                  <span className="crumb-sep">
                    <ChevronRight size={12} />
                  </span>
                )}
                <span
                  className={`crumb ${i === crumbs.length - 1 ? "current" : ""}`}
                  onClick={() => setPath(c.path)}
                  data-droppath={c.path}
                >
                  {c.name === "/" ? "root" : c.name}
                </span>
              </React.Fragment>
            ))}
          </div>
        )}
      </div>

      {loading && <LinearProgress indeterminate />}

      <div className="filelist-scroll" ref={scrollRef}>
        {error ? (
          <div className="list-error">
            <FolderOpen size={16} /> {error}
          </div>
        ) : st.viewMode === "details" ? (
          <div className="filelist" style={{ minWidth: 640 }}>
            <div className="file-header">
              <div style={{ width: 8 }} />
              {(
                [
                  ["name", "Name", cols.name],
                  ["size", "Size", cols.size],
                  ["modified", "Modified", cols.modified],
                ] as const
              ).map(([key, label, w]) => (
                <div
                  className="hcell"
                  style={{ width: w }}
                  key={key}
                  onClick={() =>
                    setSort((s) => ({ key, dir: s.key === key && s.dir === 1 ? -1 : 1 }))
                  }
                >
                  {label}
                  {sort.key === key && (
                    <span className="sort-ind">{sort.dir === 1 ? "▲" : "▼"}</span>
                  )}
                </div>
              ))}
              <div className="hcell" style={{ width: cols.perms }}>Perms</div>
            </div>
            {visible.map((e) => {
              const ic = fileIcon(e.name, e.is_dir);
              return (
                <div
                  key={e.name}
                  className={`file-row ${selSet.has(e.name) ? "selected" : ""}`}
                  data-droptarget={e.is_dir ? e.path : undefined}
                  onClick={(ev) => clickRowGuarded(e, ev)}
                  onDoubleClick={() => openEntry(e)}
                  onPointerDown={(ev) => rowPointerDown(ev, e)}
                  onContextMenu={(ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    if (!selSet.has(e.name)) setSelected(new Set([e.name]));
                    setMenu({ x: ev.clientX, y: ev.clientY, items: rowMenu(e) });
                  }}
                >
                  <div className="row-checkbox">
                    <Checkbox
                      checked={selSet.has(e.name)}
                      onChange={() => clickRow(e, { ctrlKey: true } as any)}
                    />
                  </div>
                  <div className="cell name-cell" style={{ width: `calc(${cols.name} - 34px)` }}>
                    <span className="ficon dir" style={{ color: ic.color }}>
                      {ic.el}
                    </span>
                    {renaming === e.name ? (
                      <input
                        autoFocus
                        className="name-input"
                        value={renameVal}
                        onChange={(ev) => setRenameVal(ev.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(ev) => {
                          if (ev.key === "Enter") {
                            renameCommitted.current = true;
                            doRename();
                          }
                          if (ev.key === "Escape") {
                            renameCommitted.current = true;
                            setRenaming(null);
                          }
                        }}
                        onClick={(ev) => ev.stopPropagation()}
                      />
                    ) : (
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{e.name}</span>
                    )}
                  </div>
                  <div className="cell size-cell" style={{ width: cols.size }}>
                    {sizeLabel(e)}
                  </div>
                  <div className="cell" style={{ width: cols.modified }}>
                    {fmtDate(e.modified)}
                  </div>
                  <div className="cell" style={{ width: cols.perms }}>
                    {e.permissions ?? (e.is_dir ? "dir" : "")}
                  </div>
                </div>
              );
            })}
            {!loading && visible.length === 0 && (
              <div className="empty-state">
                {side === "remote" && !session ? (
                  <>
                    <UploadCloud size={40} />
                    <div>Connect to a server using the toolbar or Site Manager</div>
                  </>
                ) : (
                  <>
                    <FolderOpen size={40} />
                    <div>{filter ? "No matching files" : "This folder is empty"}</div>
                  </>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="file-grid">
            {visible.map((e) => {
              return (
                <div
                  key={e.name}
                  className={`grid-item ${selSet.has(e.name) ? "selected" : ""}`}
                  onClick={(ev) => clickRowGuarded(e, ev)}
                  onDoubleClick={() => openEntry(e)}
                  onPointerDown={(ev) => rowPointerDown(ev, e)}
                  onContextMenu={(ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    if (!selSet.has(e.name)) setSelected(new Set([e.name]));
                    setMenu({ x: ev.clientX, y: ev.clientY, items: rowMenu(e) });
                  }}
                  data-droptarget={e.is_dir ? e.path : undefined}
                >
                  <Thumb entry={e} side={side} size={76} />
                  {renaming === e.name ? (
                    <input
                      autoFocus
                      className="name-input"
                      value={renameVal}
                      onChange={(ev) => setRenameVal(ev.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter") {
                          renameCommitted.current = true;
                          doRename();
                        }
                        if (ev.key === "Escape") {
                          renameCommitted.current = true;
                          setRenaming(null);
                        }
                      }}
                      onClick={(ev) => ev.stopPropagation()}
                    />
                  ) : (
                    <span className="gname" title={e.name}>
                      {e.name}
                    </span>
                  )}
                  <span className="gsize">{e.is_dir ? (dirSizes[e.path] ? fmtSize(dirSizes[e.path].bytes) : "Folder") : fmtSize(e.size)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}

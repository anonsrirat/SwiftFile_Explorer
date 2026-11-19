import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Archive,
  FilePlus2,
  FolderPlus,
  RefreshCw,
  Download,
  File,
  FileCode2,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
  FolderInput,
  Link2,
  Pencil,
  Copy,
  Scissors,
  Shield,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { sortEntries, useApp } from "@/stores/app";
import type { FileEntry } from "@/lib/types";
import { parentRemotePath } from "@/lib/path";
import { INTERNAL_MIME, readDragPayload } from "@/lib/dnd";
import { classifyFile, cn, formatBytes, formatDate, modeToString } from "@/lib/utils";
import { Button, Spinner } from "@/components/ui/controls";
import { ContextItem, ContextLabel, ContextMenu, ContextSeparator } from "@/components/ui/menu";
import { useT } from "@/lib/useT";

function FileGlyph({ entry, size = 16 }: { entry: FileEntry; size?: number }) {
  if (entry.isDir) {
    return <Folder className="shrink-0 text-warn" style={{ width: size, height: size }} strokeWidth={1.7} />;
  }
  const kind = classifyFile(entry);
  const style = { width: size, height: size };
  switch (kind) {
    case "image":
      return <FileImage className="shrink-0 text-[#a78bfa]" style={style} strokeWidth={1.7} />;
    case "archive":
      return <Archive className="shrink-0 text-[#fb923c]" style={style} strokeWidth={1.7} />;
    case "config":
      return <FileCode2 className="shrink-0 text-[#38bdf8]" style={style} strokeWidth={1.7} />;
    case "text":
      return <FileText className="shrink-0 text-[#94a3b8]" style={style} strokeWidth={1.7} />;
    case "code":
      return <FileCode2 className="shrink-0 text-[#38bdf8]" style={style} strokeWidth={1.7} />;
    default:
      return <File className="shrink-0 text-mute" style={style} strokeWidth={1.7} />;
  }
}

export function FileList() {
  const t = useT();
  const tabs = useApp((s) => s.tabs);
  const activeTabId = useApp((s) => s.activeTabId);
  const settings = useApp((s) => s.settings);
  const store = useApp;
  const navigate = useApp((s) => s.navigate);
  const select = useApp((s) => s.select);
  const openEditor = useApp((s) => s.openEditor);
  const setSort = useApp((s) => s.setSort);
  const openPrompt = useApp((s) => s.openPrompt);
  const openProperties = useApp((s) => s.openProperties);
  const deleteEntries = useApp((s) => s.deleteEntries);
  const askConfirm = useApp((s) => s.askConfirm);
  const copySelection = useApp((s) => s.copySelection);
  const paste = useApp((s) => s.paste);
  const downloadSelection = useApp((s) => s.downloadSelection);
  const addFavorite = useApp((s) => s.addFavorite);
  const clearSearch = useApp((s) => s.clearSearch);
  const cancelSearch = useApp((s) => s.cancelSearch);
  const selectPaths = useApp((s) => s.selectPaths);
  const clearSelection = useApp((s) => s.clearSelection);
  const refreshTab = useApp((s) => s.refreshTab);

  const tab = tabs.find((x) => x.id === activeTabId) ?? null;
  const parentRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const [band, setBand] = useState<{ left: number; top: number; width: number; height: number } | null>(
    null,
  );

  const searching = !!tab?.search;
  const entries = useMemo(() => {
    if (!tab) return [];
    if (tab.search) return tab.search.results;
    return sortEntries(tab.listing?.entries ?? [], tab.sortKey, tab.sortDir, settings.showHidden);
  }, [tab, settings.showHidden]);

  useEffect(() => {
    const element = parentRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  // Keep the folder in sync with the server: poll while the window is focused
  // and refresh as soon as it regains focus. Silent — no spinner, no scroll jump.
  useEffect(() => {
    const tabId = tab?.id;
    if (!tabId || !tab?.sessionId) return;
    const tick = () => {
      if (document.visibilityState !== "visible" || !document.hasFocus()) return;
      void useApp.getState().silentRefreshTab(tabId);
    };
    const interval = window.setInterval(tick, 4000);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [tab?.id, tab?.sessionId]);

  // Rubber-band selection over the empty space of the file view.
  const startBandSelection = (event: React.PointerEvent) => {
    if (!tab || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("[data-entry-path]")) return;
    // Ignore drags that start on a scrollbar.
    const container = parentRef.current;
    if (container) {
      const rect = container.getBoundingClientRect();
      if (
        event.clientX > rect.left + container.clientWidth ||
        event.clientY > rect.top + container.clientHeight
      ) {
        return;
      }
    }
    const additive = event.ctrlKey || event.metaKey;
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;

    const onMove = (move: PointerEvent) => {
      const left = Math.min(startX, move.clientX);
      const top = Math.min(startY, move.clientY);
      const width = Math.abs(move.clientX - startX);
      const height = Math.abs(move.clientY - startY);
      if (width > 3 || height > 3) moved = true;
      setBand({ left, top, width, height });
    };

    const onUp = (up: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setBand(null);
      const left = Math.min(startX, up.clientX);
      const top = Math.min(startY, up.clientY);
      const right = Math.max(startX, up.clientX);
      const bottom = Math.max(startY, up.clientY);
      if (!moved) {
        if (!additive) clearSelection(tab.id);
        return;
      }
      const paths: string[] = [];
      parentRef.current?.querySelectorAll<HTMLElement>("[data-entry-path]").forEach((node) => {
        const rect = node.getBoundingClientRect();
        if (rect.bottom >= top && rect.top <= bottom && rect.right >= left && rect.left <= right) {
          const path = node.dataset.entryPath;
          if (path) paths.push(path);
        }
      });
      selectPaths(tab.id, paths, additive);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // OS-level drag and drop (files from Windows Explorer).
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "over" || payload.type === "enter") {
          setDragging(true);
        } else if (payload.type === "leave") {
          setDragging(false);
        } else if (payload.type === "drop") {
          setDragging(false);
          const current = store.getState();
          const tabId = current.activeTabId;
          if (!tabId) return;
          current.uploadPaths(tabId, payload.paths).catch(() => undefined);
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [store]);

  const view = settings.viewMode;
  const rowHeight = settings.compact ? 25 : view === "list" ? 44 : 29;
  const columns = Math.max(1, Math.floor((width - 12) / 112));
  const isGrid = view === "grid";
  const virtualCount = isGrid ? Math.ceil(entries.length / columns) : entries.length;

  const virtualizer = useVirtualizer({
    count: virtualCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => (isGrid ? 98 : rowHeight),
    overscan: 10,
  });

  const selected = new Set(tab?.selection ?? []);

  const openEntry = useCallback(
    async (entry: FileEntry) => {
      if (!tab) return;
      if (entry.isDir) {
        if (searching) {
          await navigate(tab.id, entry.path);
          clearSearch(tab.id);
        } else {
          await navigate(tab.id, entry.path);
        }
        return;
      }
      const kind = classifyFile(entry);
      if (kind === "text" || kind === "config" || kind === "code") {
        await openEditor(tab.id, entry.path);
        return;
      }
      const target = await openDialog({
        directory: true,
        multiple: false,
        title: `Download ${entry.name} to…`,
        defaultPath: settings.defaultLocalFolder ?? undefined,
      });
      if (typeof target === "string") {
        await downloadSelection(tab.id, target);
      }
    },
    [tab, searching, navigate, clearSearch, openEditor, downloadSelection, settings.defaultLocalFolder],
  );

  const handleClick = (entry: FileEntry, event: React.MouseEvent) => {
    if (!tab) return;
    if (event.ctrlKey || event.metaKey) select(tab.id, entry.path, "toggle");
    else if (event.shiftKey) select(tab.id, entry.path, "range");
    else select(tab.id, entry.path, "single");
  };

  const contextItems = (entry: FileEntry | null) => {
    if (!tab) return null;
    const targets = entry && !selected.has(entry.path) ? [entry.path] : [...(tab.selection ?? [])];
    const single = entry ?? (tab.selection.length === 1 ? entries.find((e) => e.path === tab.selection[0]) ?? null : null);
    return (
      <>
        <ContextLabel>{entry ? entry.name : `${tab.selection.length} ${t("selected")}`}</ContextLabel>
        {single ? (
          <ContextItem icon={<FolderOpen className="h-3.5 w-3.5" />} onSelect={() => openEntry(single)}>
            {single.isDir ? t("open") : t("openWith")}
          </ContextItem>
        ) : null}
        <ContextItem
          icon={<Download className="h-3.5 w-3.5" />}
          onSelect={async () => {
            const dir = await openDialog({
              directory: true,
              multiple: false,
              title: t("download"),
              defaultPath: settings.defaultLocalFolder ?? undefined,
            });
            if (typeof dir === "string") {
              if (entry && !selected.has(entry.path)) select(tab.id, entry.path, "single");
              await downloadSelection(tab.id, dir);
            }
          }}
        >
          {t("download")}
        </ContextItem>
        <ContextSeparator />
        <ContextItem icon={<Copy className="h-3.5 w-3.5" />} shortcut="Ctrl+C" onSelect={() => copySelection(tab.id, false)}>
          {t("copy")}
        </ContextItem>
        <ContextItem icon={<Scissors className="h-3.5 w-3.5" />} shortcut="Ctrl+X" onSelect={() => copySelection(tab.id, true)}>
          {t("cut")}
        </ContextItem>
        <ContextItem icon={<FolderInput className="h-3.5 w-3.5" />} shortcut="Ctrl+V" onSelect={() => paste(tab.id)}>
          {t("paste")}
        </ContextItem>
        <ContextSeparator />
        <ContextItem
          icon={<Pencil className="h-3.5 w-3.5" />}
          shortcut="F2"
          disabled={!single}
          onSelect={() => single && openPrompt(tab.id, "rename", single.path)}
        >
          {t("rename")}
        </ContextItem>
        <ContextItem
          icon={<Star className="h-3.5 w-3.5" />}
          disabled={!single?.isDir}
          onSelect={() => {
            if (!single) return;
            addFavorite(tab.profileId, single.path, single.name).catch(() => undefined);
          }}
        >
          {t("addToFavourites")}
        </ContextItem>
        <ContextItem icon={<Shield className="h-3.5 w-3.5" />} disabled={!single} onSelect={() => single && openProperties(tab.id, single)}>
          {t("properties")}
        </ContextItem>
        <ContextSeparator />
        <ContextItem
          danger
          icon={<Trash2 className="h-3.5 w-3.5" />}
          shortcut="Del"
          onSelect={() => {
            if (targets.length === 0) return;
            if (settings.confirmDelete) {
              askConfirm({
                title: t("deleteConfirm"),
                body: `${t("deleteConfirmBody")}\n\n${targets.join("\n")}`,
                confirmLabel: t("delete"),
                danger: true,
                action: () => deleteEntries(tab.id, targets),
              });
              return;
            }
            deleteEntries(tab.id, targets).catch(() => undefined);
          }}
        >
          {t("delete")}
        </ContextItem>
      </>
    );
  };

  if (!tab) {
    return (
      <div className="flex flex-1 items-center justify-center text-[12px] text-mute">{t("noServer")}</div>
    );
  }

  const sortHeader = (key: typeof tab.sortKey, label: string, className?: string) => (
    <button
      onClick={() => setSort(tab.id, key)}
      className={cn(
        "flex h-full items-center gap-1 px-2 text-left text-[11px] font-medium text-dim transition-colors hover:text-ink",
        className,
      )}
    >
      {label}
      {tab.sortKey === key ? (
        tab.sortDir === "asc" ? (
          <ArrowUpNarrowWide className="h-3 w-3 text-brand" />
        ) : (
          <ArrowDownWideNarrow className="h-3 w-3 text-brand" />
        )
      ) : null}
    </button>
  );

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {tab.search ? (
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-brand-soft/40 px-3 text-[11.5px]">
          <span className="font-medium text-ink">
            {t("searchResults")}: “{tab.search.query}”
          </span>
          {tab.search.scanning ? (
            <>
              <Spinner className="h-3 w-3" />
              <span className="text-dim">
                {t("scanning")} {tab.search.scanned.toLocaleString()} checked
              </span>
              <Button size="sm" variant="ghost" onClick={() => cancelSearch(tab.id)}>
                {t("stopSearch")}
              </Button>
            </>
          ) : (
            <span className="text-dim">
              {tab.search.results.length.toLocaleString()} matches · {tab.search.scanned.toLocaleString()} scanned
            </span>
          )}
          {tab.search.truncated ? <span className="text-warn">{t("truncated")}</span> : null}
          <div className="flex-1" />
          <button
            onClick={() => clearSearch(tab.id)}
            className="flex h-5 w-5 items-center justify-center rounded text-dim hover:bg-surface-3 hover:text-ink"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      {view === "details" && !isGrid ? (
        <div className="flex h-7 shrink-0 items-center border-b border-line bg-surface-2/60 pr-2 text-[11px]">
          <div className="min-w-0 flex-1 pl-2">{sortHeader("name", t("name"))}</div>
          <div className="w-[92px] shrink-0">{sortHeader("size", t("size"))}</div>
          <div className="w-[152px] shrink-0">{sortHeader("modified", t("modified"))}</div>
          <div className="w-[104px] shrink-0 hidden xl:block">{sortHeader("type", t("permissionsCol"))}</div>
          <div className="w-[72px] shrink-0 hidden 2xl:block px-2 text-dim">{t("owner")}</div>
        </div>
      ) : null}

      <ContextMenu
        items={
          <>
            <ContextLabel>{tab.listing?.path ?? tab.path}</ContextLabel>
            <ContextItem
              icon={<RefreshCw className="h-3.5 w-3.5" />}
              shortcut="Ctrl+R"
              onSelect={() => refreshTab(tab.id)}
            >
              {t("refresh")}
            </ContextItem>
            <ContextItem
              icon={<FolderPlus className="h-3.5 w-3.5" />}
              onSelect={() => openPrompt(tab.id, "new-folder")}
            >
              {t("newFolder")}
            </ContextItem>
            <ContextItem
              icon={<FilePlus2 className="h-3.5 w-3.5" />}
              onSelect={() => openPrompt(tab.id, "new-file")}
            >
              {t("newFile")}
            </ContextItem>
            <ContextSeparator />
            <ContextItem
              icon={<FolderInput className="h-3.5 w-3.5" />}
              shortcut="Ctrl+V"
              onSelect={() => paste(tab.id)}
            >
              {t("paste")}
            </ContextItem>
          </>
        }
      >
      <div
        ref={parentRef}
        onPointerDown={startBandSelection}
        className="relative min-h-0 flex-1 overflow-auto px-1.5 py-1"
      >
        {tab.loading && entries.length === 0 ? (
          <div className="flex h-full items-center justify-center gap-2 text-[12px] text-dim">
            <Spinner /> {t("loading")}
          </div>
        ) : entries.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-[12px] text-mute">
            {searching ? (
              <>
                <FileText className="h-7 w-7 opacity-40" />
                {tab.search?.scanning ? t("scanning") : t("noResults")}
              </>
            ) : (
              <>
                <FolderOpen className="h-8 w-8 opacity-30" />
                {t("emptyFolder")}
                <span className="text-[11px] opacity-70">{t("dropHint")}</span>
              </>
            )}
          </div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              if (isGrid) {
                const start = virtualRow.index * columns;
                const rowEntries = entries.slice(start, start + columns);
                return (
                  <div
                    key={virtualRow.key}
                    className="absolute left-0 top-0 grid w-full gap-1 px-1"
                    style={{
                      height: virtualRow.size,
                      transform: `translateY(${virtualRow.start}px)`,
                      gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                    }}
                  >
                    {rowEntries.map((entry) => (
                      <EntryTile
                        key={entry.path}
                        entry={entry}
                        selected={selected.has(entry.path)}
                        dropActive={dropTarget === entry.path}
                        onClick={(event) => handleClick(entry, event)}
                        onDoubleClick={() => openEntry(entry)}
                        onContextMenu={() => {
                          if (!selected.has(entry.path)) select(tab.id, entry.path, "single");
                        }}
                        onDragStart={(event) => {
                          event.dataTransfer.setData(
                            INTERNAL_MIME,
                            JSON.stringify({ sessionId: tab.sessionId, paths: selected.has(entry.path) ? [...selected] : [entry.path] }),
                          );
                          event.dataTransfer.effectAllowed = "copyMove";
                        }}
                        onDropTarget={() => setDropTarget(entry.path)}
                        onDrop={(paths) => {
                          setDropTarget(null);
                          if (tab.sessionId) {
                            store
                              .getState()
                              .uploadPaths(tab.id, paths, entry.path)
                              .catch(() => undefined);
                          }
                        }}
                        menu={contextItems(entry) ?? <></>}
                      />
                    ))}
                  </div>
                );
              }
              const entry = entries[virtualRow.index];
              if (!entry) return null;
              return (
                <div
                  key={virtualRow.key}
                  style={{ height: virtualRow.size, transform: `translateY(${virtualRow.start}px)`, position: "absolute", left: 0, right: 0, top: 0 }}
                >
                  <EntryRow
                    entry={entry}
                    view={view}
                    selected={selected.has(entry.path)}
                    dropActive={dropTarget === entry.path}
                    onClick={(event) => handleClick(entry, event)}
                    onDoubleClick={() => openEntry(entry)}
                    onContextMenu={() => {
                      if (!selected.has(entry.path)) select(tab.id, entry.path, "single");
                    }}
                    onDragStart={(event) => {
                      event.dataTransfer.setData(
                        INTERNAL_MIME,
                        JSON.stringify({ sessionId: tab.sessionId, paths: selected.has(entry.path) ? [...selected] : [entry.path] }),
                      );
                      event.dataTransfer.effectAllowed = "copyMove";
                    }}
                    onDropTarget={() => setDropTarget(entry.path)}
                    onDrop={(paths) => {
                      setDropTarget(null);
                      if (tab.sessionId) {
                        store
                          .getState()
                          .uploadPaths(tab.id, paths, entry.path)
                          .catch(() => undefined);
                      }
                    }}
                    searchMode={searching}
                    menu={contextItems(entry) ?? <></>}
                  />
                </div>
              );
            })}
          </div>
        )}

        {dragging ? (
          <div className="pointer-events-none absolute inset-2 z-30 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-brand bg-brand-soft/60 backdrop-blur-[1px]">
            <Upload className="h-7 w-7 text-brand-strong" />
            <p className="text-[13px] font-medium text-ink">{t("dropToUpload")}</p>
            <p className="font-mono text-[11px] text-dim">{tab.listing?.path ?? tab.path}</p>
          </div>
        ) : null}
      </div>
      </ContextMenu>

      {band ? (
        <div
          className="pointer-events-none fixed z-50 rounded-[3px] border border-brand bg-brand/15"
          style={{ left: band.left, top: band.top, width: band.width, height: band.height }}
        />
      ) : null}

    </div>
  );
}

function EntryRow({
  entry,
  view,
  selected,
  dropActive,
  onClick,
  onDoubleClick,
  onContextMenu,
  onDragStart,
  onDropTarget,
  onDrop,
  searchMode,
  menu,
}: {
  entry: FileEntry;
  view: "details" | "list" | "grid";
  selected: boolean;
  dropActive: boolean;
  onClick: (event: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onContextMenu: () => void;
  onDragStart: (event: React.DragEvent) => void;
  onDropTarget: () => void;
  onDrop: (paths: string[]) => void;
  searchMode: boolean;
  menu: React.ReactNode;
}) {
  const content = (
    <div
      draggable={view !== "grid"}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      data-entry-path={entry.path}
      onContextMenu={(event) => {
        // Radix opens the menu itself; keep the background menu closed.
        event.stopPropagation();
        onContextMenu();
      }}
      onDragStart={onDragStart}
      onDragOver={(event) => {
        if (entry.isDir && event.dataTransfer.types.includes(INTERNAL_MIME)) {
          event.preventDefault();
          onDropTarget();
        }
      }}
      onDragLeave={() => undefined}
      onDrop={(event) => {
        if (!entry.isDir) return;
        event.preventDefault();
        event.stopPropagation();
        const payload = readDragPayload(event);
        if (payload) {
          const state = useApp.getState();
          const tab = state.tabs.find((t) => t.id === state.activeTabId);
          if (tab?.sessionId) {
            import("@/lib/api").then(({ api }) =>
              api
                .enqueueRemoteCopy(payload.sessionId, tab.sessionId!, payload.paths, entry.path, false, "rename")
                .catch(() => undefined),
            );
          }
        } else if (event.dataTransfer.files.length > 0) {
          const paths = Array.from(event.dataTransfer.files).map((f) => (f as File & { path?: string }).path ?? "");
          onDrop(paths.filter(Boolean));
        }
      }}
      className={cn(
        "row-focus group flex h-full w-full select-none items-center gap-2 rounded-lg px-2 text-left text-[12px] transition-colors",
        "border border-transparent",
        view === "list" ? "py-1" : "",
        selected
          ? "border-brand/40 bg-brand-soft text-ink"
          : "text-ink/85 hover:bg-[var(--row-hover)]",
        dropActive && "border-brand bg-brand-soft/70",
        view === "list" && "flex-col items-start justify-center gap-0.5",
      )}
    >
      {view === "list" ? (
        <>
          <div className="flex w-full min-w-0 items-center gap-2">
            <FileGlyph entry={entry} size={16} />
            <span className="min-w-0 flex-1 truncate font-medium">{entry.name}</span>
            {entry.isSymlink ? <Link2 className="h-3 w-3 shrink-0 text-mute" /> : null}
          </div>
          <div className="flex w-full items-center gap-3 pl-6 text-[10.5px] text-mute">
            <span>{entry.isDir ? "folder" : formatBytes(entry.size)}</span>
            <span>{formatDate(entry.modified)}</span>
            {entry.mode !== null ? <span className="font-mono">{modeToString(entry.mode)}</span> : null}
          </div>
        </>
      ) : (
        <>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <FileGlyph entry={entry} size={16} />
            <span className="min-w-0 truncate">{entry.name}</span>
            {entry.isSymlink ? <Link2 className="h-3 w-3 shrink-0 text-mute" /> : null}
            {searchMode ? (
              <span className="ml-2 hidden truncate font-mono text-[10px] text-mute md:inline">
                {parentRemotePath(entry.path)}
              </span>
            ) : null}
          </div>
          <div className="w-[92px] shrink-0 text-right text-[11px] tabular-nums text-dim">
            {entry.isDir ? "—" : formatBytes(entry.size)}
          </div>
          <div className="w-[152px] shrink-0 pl-2 text-[11px] text-dim">{formatDate(entry.modified)}</div>
          <div className="hidden w-[104px] shrink-0 pl-2 font-mono text-[10.5px] text-mute xl:block">
            {entry.mode !== null ? modeToString(entry.mode) : "—"}
          </div>
          <div className="hidden w-[72px] shrink-0 pl-2 text-[10.5px] text-mute 2xl:block">
            {entry.owner ?? "—"}
          </div>
        </>
      )}
    </div>
  );

  return <ContextMenu items={menu}>{content}</ContextMenu>;
}

function EntryTile({
  entry,
  selected,
  dropActive,
  onClick,
  onDoubleClick,
  onContextMenu,
  onDragStart,
  onDropTarget,
  onDrop,
  menu,
}: {
  entry: FileEntry;
  selected: boolean;
  dropActive: boolean;
  onClick: (event: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onContextMenu: () => void;
  onDragStart: (event: React.DragEvent) => void;
  onDropTarget: () => void;
  onDrop: (paths: string[]) => void;
  menu: React.ReactNode;
}) {
  return (
    <ContextMenu items={menu}>
    <div
      draggable
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      data-entry-path={entry.path}
      onContextMenu={(event) => {
        // Radix opens the menu itself; keep the background menu closed.
        event.stopPropagation();
        onContextMenu();
      }}
      onDragStart={onDragStart}
      onDragOver={(event) => {
        if (entry.isDir && event.dataTransfer.types.includes(INTERNAL_MIME)) {
          event.preventDefault();
          onDropTarget();
        }
      }}
      onDrop={(event) => {
        if (!entry.isDir) return;
        const raw = event.dataTransfer.getData(INTERNAL_MIME);
        if (raw) event.preventDefault();
        else if (event.dataTransfer.files.length > 0) {
          event.preventDefault();
          onDrop(Array.from(event.dataTransfer.files).map((f) => (f as File & { path?: string }).path ?? "").filter(Boolean));
        }
      }}
      className={cn(
        "flex cursor-default flex-col items-center justify-center gap-1.5 rounded-xl border border-transparent px-1 py-2 text-center transition-colors",
        selected ? "border-brand/40 bg-brand-soft text-ink" : "hover:bg-[var(--row-hover)]",
        dropActive && "border-brand bg-brand-soft/70",
      )}
      title={`${entry.name}\n${formatBytes(entry.size)} · ${formatDate(entry.modified)}`}
    >
      {entry.isDir ? (
        <FolderOpen className="h-8 w-8 text-warn" strokeWidth={1.4} />
      ) : (
        <FileGlyph entry={entry} size={30} />
      )}
      <span className="line-clamp-2 w-full break-words text-[11px] leading-tight text-ink/90">
        {entry.name}
      </span>
    </div>
    </ContextMenu>
  );
}

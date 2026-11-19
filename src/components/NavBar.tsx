import { useEffect, useMemo, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronRight,
  FilePlus2,
  FolderPlus,
  LayoutGrid,
  List,
  MoreHorizontal,
  RefreshCw,
  Rows3,
  Search,
  Star,
  Upload,
  X,
  Zap,
} from "lucide-react";
import { useApp, sortEntries } from "@/stores/app";
import { breadcrumbs, normalizeRemotePath, parentRemotePath } from "@/lib/path";
import { Button, Tooltip } from "@/components/ui/controls";
import { DropdownMenu, MenuItem, MenuSeparator, MenuLabel } from "@/components/ui/menu";
import { useT } from "@/lib/useT";
import { cn } from "@/lib/utils";

export function NavBar() {
  const t = useT();
  const tabs = useApp((s) => s.tabs);
  const activeTabId = useApp((s) => s.activeTabId);
  const profiles = useApp((s) => s.profiles);
  const connections = useApp((s) => s.connections);
  const settings = useApp((s) => s.settings);
  const navigate = useApp((s) => s.navigate);
  const goBack = useApp((s) => s.goBack);
  const goForward = useApp((s) => s.goForward);
  const goUp = useApp((s) => s.goUp);
  const refreshTab = useApp((s) => s.refreshTab);
  const setView = useApp((s) => s.setView);
  const startSearch = useApp((s) => s.startSearch);
  const cancelSearch = useApp((s) => s.cancelSearch);
  const clearSearch = useApp((s) => s.clearSearch);
  const addFavorite = useApp((s) => s.addFavorite);
  const openPrompt = useApp((s) => s.openPrompt);
  const uploadPaths = useApp((s) => s.uploadPaths);
  const selectAll = useApp((s) => s.selectAll);
  const reconnectTab = useApp((s) => s.reconnectTab);
  const pushToast = useApp((s) => s.pushToast);

  const tab = tabs.find((x) => x.id === activeTabId) ?? null;
  const profile = profiles.find((p) => p.id === tab?.profileId) ?? null;
  const connected = profile ? connections[profile.id] !== false && !!tab?.sessionId : false;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [searchText, setSearchText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const currentPath = tab?.listing?.path ?? tab?.path ?? "";
  const crumbs = useMemo(() => breadcrumbs(currentPath), [currentPath]);

  useEffect(() => {
    setEditing(false);
    setSearchText("");
  }, [activeTabId]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const suggestions = useMemo(() => {
    if (!editing || !tab?.listing) return [];
    const trimmed = draft.trim();
    const dirs = sortEntries(tab.listing.entries, "name", "asc", true).filter((e) => e.isDir);
    if (!trimmed || trimmed === "/" || trimmed.endsWith("/")) {
      return dirs.slice(0, 8).map((d) => d.path);
    }
    const last = trimmed.split("/").filter(Boolean).pop() ?? "";
    const parent = parentRemotePath(trimmed);
    if (parent === normalizeRemotePath(tab.listing.path) || !trimmed.includes("/")) {
      return dirs
        .filter((d) => d.name.toLowerCase().startsWith(last.toLowerCase()))
        .slice(0, 8)
        .map((d) => d.path);
    }
    return [];
  }, [draft, editing, tab?.listing]);

  const submitPath = async (value: string) => {
    if (!tab) return;
    const target = normalizeRemotePath(value.trim() || currentPath || "/");
    setEditing(false);
    await navigate(tab.id, target);
  };

  const pickFiles = async () => {
    if (!tab) return;
    const selection = await openDialog({ multiple: true, directory: false });
    if (!selection) return;
    const paths = Array.isArray(selection) ? selection : [selection];
    await uploadPaths(tab.id, paths);
  };

  const pickFolder = async () => {
    if (!tab) return;
    const selection = await openDialog({ directory: true, multiple: false });
    if (!selection || Array.isArray(selection)) return;
    await uploadPaths(tab.id, [selection]);
  };

  const searchNow = async () => {
    if (!tab) return;
    if (tab.search?.scanning) {
      await cancelSearch(tab.id);
      return;
    }
    if (!searchText.trim()) {
      clearSearch(tab.id);
      return;
    }
    await startSearch(tab.id, searchText.trim(), {
      recursive: true,
      includeHidden: settings.showHidden,
    });
  };

  const viewButtons: { mode: typeof settings.viewMode; icon: React.ReactNode; label: string }[] = [
    { mode: "details", icon: <Rows3 className="h-3.5 w-3.5" />, label: t("details") },
    { mode: "list", icon: <List className="h-3.5 w-3.5" />, label: t("list") },
    { mode: "grid", icon: <LayoutGrid className="h-3.5 w-3.5" />, label: t("grid") },
  ];

  return (
    <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-line bg-app/40 px-2">
      <div className="flex items-center gap-0.5">
        <Tooltip label={`${t("back")} (Alt+←)`}>
          <button
            disabled={!tab || tab.historyIndex <= 0}
            onClick={() => tab && goBack(tab.id)}
            className="nav-btn"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        </Tooltip>
        <Tooltip label={`${t("forward")} (Alt+→)`}>
          <button
            disabled={!tab || tab.historyIndex >= tab.history.length - 1}
            onClick={() => tab && goForward(tab.id)}
            className="nav-btn"
          >
            <ArrowRight className="h-4 w-4" />
          </button>
        </Tooltip>
        <Tooltip label={`${t("up")} (Alt+↑)`}>
          <button
            disabled={!tab || !currentPath || currentPath === "/"}
            onClick={() => tab && goUp(tab.id)}
            className="nav-btn"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </Tooltip>
        <Tooltip label={`${t("refresh")} (Ctrl+R)`}>
          <button
            disabled={!tab}
            onClick={() => tab && refreshTab(tab.id)}
            className="nav-btn"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", tab?.loading && "animate-spin")} />
          </button>
        </Tooltip>
      </div>

      <div className="relative min-w-0 flex-1">
        <div
          className={cn(
            "flex h-8 items-center gap-1 rounded-[10px] border px-2 transition-colors",
            editing
              ? "border-brand/70 bg-surface ring-2 ring-brand/20"
              : "border-line bg-surface-2 hover:border-line-strong",
          )}
        >
          {!editing && profile ? (
            <span className="flex shrink-0 items-center gap-1 rounded-md bg-surface-3 px-1.5 py-0.5 text-[10.5px] text-dim">
              <span className={cn("h-1.5 w-1.5 rounded-full", connected ? "bg-ok" : "bg-warn")} />
              {profile.name}
            </span>
          ) : null}
          {editing ? (
            <input
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => setTimeout(() => setEditing(false), 120)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitPath(suggestions[0] && !draft.includes("/") ? suggestions[0] : draft);
                if (event.key === "Escape") setEditing(false);
              }}
              className="h-full min-w-0 flex-1 bg-transparent font-mono text-[12px] text-ink outline-none"
              placeholder="/home/user"
              spellCheck={false}
            />
          ) : (
            <button
              className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden text-left"
              onClick={() => {
                if (!tab) return;
                setDraft(currentPath);
                setEditing(true);
              }}
              title={currentPath}
            >
              {crumbs.length === 0 ? (
                <span className="px-1 text-[12px] text-mute">
                  {tab ? t("loading") : t("noServer")}
                </span>
              ) : (
                crumbs.map((crumb, index) => (
                  <span key={crumb.path} className="flex min-w-0 items-center">
                    {index > 0 ? <ChevronRight className="h-3 w-3 shrink-0 text-mute/70" /> : null}
                    <span
                      role="button"
                      tabIndex={-1}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (tab) navigate(tab.id, crumb.path);
                      }}
                      className={cn(
                        "truncate rounded px-1 py-0.5 text-[12px] transition-colors hover:bg-surface-3",
                        index === crumbs.length - 1 ? "font-medium text-ink" : "text-dim",
                      )}
                    >
                      {crumb.label}
                    </span>
                  </span>
                ))
              )}
            </button>
          )}
          {editing && suggestions.length > 0 ? (
            <div className="absolute left-0 right-0 top-9 z-40 overflow-hidden rounded-xl border border-line-strong bg-surface-2 p-1 shadow-[var(--shadow)]">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    submitPath(suggestion);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left font-mono text-[11.5px] text-dim hover:bg-brand hover:text-white"
                >
                  <FolderPlus className="h-3 w-3" />
                  {suggestion}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="relative flex h-8 w-[190px] items-center gap-1 rounded-[10px] border border-line bg-surface-2 px-2 focus-within:border-brand/70 focus-within:ring-2 focus-within:ring-brand/20">
        <Search className="h-3.5 w-3.5 shrink-0 text-mute" />
        <input
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") searchNow();
            if (event.key === "Escape") {
              setSearchText("");
              if (tab) clearSearch(tab.id);
            }
          }}
          placeholder={t("searchPlaceholder")}
          className="h-full min-w-0 flex-1 bg-transparent text-[11.5px] text-ink outline-none placeholder:text-mute"
          disabled={!tab?.sessionId}
        />
        {tab?.search ? (
          <button
            onClick={() => {
              clearSearch(tab.id);
              setSearchText("");
            }}
            className="flex h-4 w-4 items-center justify-center rounded text-mute hover:text-ink"
          >
            <X className="h-3 w-3" />
          </button>
        ) : null}
      </div>

      <div className="flex items-center rounded-[10px] border border-line bg-surface-2 p-0.5">
        {viewButtons.map((button) => (
          <Tooltip key={button.mode} label={button.label}>
            <button
              onClick={() => setView(button.mode)}
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-md transition-colors",
                settings.viewMode === button.mode
                  ? "bg-brand-soft text-brand-strong"
                  : "text-mute hover:bg-surface-3 hover:text-ink",
              )}
            >
              {button.icon}
            </button>
          </Tooltip>
        ))}
      </div>

      <Tooltip label={t("addToFavourites")}>
        <button
          disabled={!tab?.sessionId || !currentPath}
          onClick={() => {
            if (!tab || !profile) return;
            const label = currentPath.split("/").filter(Boolean).pop() || profile.name;
            addFavorite(profile.id, currentPath, label)
              .then(() => pushToast({ kind: "success", title: t("pinnedToFavourites"), detail: currentPath }))
              .catch(() => undefined);
          }}
          className="nav-btn"
        >
          <Star className="h-3.5 w-3.5" />
        </button>
      </Tooltip>

      {!connected && tab ? (
        <Button size="sm" variant="brand" onClick={() => reconnectTab(tab.id)}>
          <Zap className="h-3.5 w-3.5" />
          {t("reconnect")}
        </Button>
      ) : null}

      <DropdownMenu
        align="end"
        trigger={
          <button className="nav-btn">
            <MoreHorizontal className="h-4 w-4" />
          </button>
        }
      >
        <MenuLabel>{t("thisFolder")}</MenuLabel>
        <MenuItem
          icon={<FolderPlus className="h-3.5 w-3.5" />}
          disabled={!tab}
          onSelect={() => tab && openPrompt(tab.id, "new-folder")}
        >
          {t("newFolder")}
        </MenuItem>
        <MenuItem
          icon={<FilePlus2 className="h-3.5 w-3.5" />}
          disabled={!tab}
          onSelect={() => tab && openPrompt(tab.id, "new-file")}
        >
          {t("newFile")}
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<Upload className="h-3.5 w-3.5" />} disabled={!tab} onSelect={pickFiles}>
          {t("upload")}
        </MenuItem>
        <MenuItem icon={<Upload className="h-3.5 w-3.5" />} disabled={!tab} onSelect={pickFolder}>
          {t("uploadFolder")}
        </MenuItem>
        <MenuSeparator />
        <MenuItem shortcut="Ctrl+A" disabled={!tab} onSelect={() => tab && selectAll(tab.id)}>
          {t("selectAll")}
        </MenuItem>
        <MenuItem
          shortcut="Ctrl+V"
          disabled={!tab}
          onSelect={() => tab && useApp.getState().paste(tab.id)}
        >
          {t("paste")}
        </MenuItem>
      </DropdownMenu>
    </div>
  );
}

import { useRef, useState } from "react";
import { ChevronDown, Plus, Server, X } from "lucide-react";
import { useApp } from "@/stores/app";
import { DropdownMenu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/controls";
import { useT } from "@/lib/useT";
import { cn } from "@/lib/utils";
import { hasInternalPayload, readDragPayload } from "@/lib/dnd";

export function TabBar() {
  const t = useT();
  const tabs = useApp((s) => s.tabs);
  const activeTabId = useApp((s) => s.activeTabId);
  const connections = useApp((s) => s.connections);
  const profiles = useApp((s) => s.profiles);
  const activateTab = useApp((s) => s.activateTab);
  const closeTab = useApp((s) => s.closeTab);
  const moveTab = useApp((s) => s.moveTab);
  const openServer = useApp((s) => s.openServer);
  const duplicateTab = useApp((s) => s.duplicateTab);
  const setUi = useApp((s) => s.setUi);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropTabId, setDropTabId] = useState<string | null>(null);
  const dropPathsIntoTab = useApp((s) => s.dropPathsIntoTab);
  const stripRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<number | null>(null);

  const cancelHover = () => {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    setDropTabId(null);
  };

  const connectedProfiles = profiles.filter((p) => connections[p.id]);

  return (
    <div className="flex h-10 shrink-0 items-end gap-0.5 border-b border-line bg-app/60 px-2">
      <div
        ref={stripRef}
        className="flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((tab, index) => {
          const active = tab.id === activeTabId;
          const connected = tab.sessionId ? connections[tab.profileId] !== false : false;
          return (
            <div
              key={tab.id}
              draggable
              onDragStart={() => setDragIndex(index)}
              onDragEnter={(event) => {
                if (!hasInternalPayload(event)) return;
                setDropTabId(tab.id);
                // Hovering a tab while dragging files opens that tab, so a drop
                // always lands in the folder the user is looking at.
                if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
                hoverTimer.current = window.setTimeout(() => {
                  hoverTimer.current = null;
                  activateTab(tab.id);
                }, 400);
              }}
              onDragLeave={() => {
                if (dropTabId === tab.id) cancelHover();
              }}
              onDragOver={(event) => {
                event.preventDefault();
                if (hasInternalPayload(event)) event.dataTransfer.dropEffect = "copy";
              }}
              onDrop={(event) => {
                const payload = readDragPayload(event);
                if (payload) {
                  event.preventDefault();
                  event.stopPropagation();
                  cancelHover();
                  activateTab(tab.id);
                  dropPathsIntoTab(tab.id, payload).catch(() => undefined);
                  return;
                }
                cancelHover();
                if (dragIndex !== null && dragIndex !== index) moveTab(dragIndex, index);
                setDragIndex(null);
              }}
              onDragEnd={() => {
                cancelHover();
                setDragIndex(null);
              }}
              onMouseDown={(event) => {
                if (event.button === 1) {
                  event.preventDefault();
                  closeTab(tab.id).catch(() => undefined);
                }
              }}
              onClick={() => activateTab(tab.id)}
              onAuxClick={(event) => {
                if (event.button === 1) closeTab(tab.id).catch(() => undefined);
              }}
              onDoubleClick={() => duplicateTab(tab.id).catch(() => undefined)}
              title={`${tab.title} — ${tab.subtitle}\n${tab.path}`}
              className={cn(
                "group relative flex h-[34px] min-w-[132px] max-w-[228px] shrink-0 cursor-default items-center gap-2 rounded-t-[10px] border border-b-0 px-2.5 text-[12px] transition-colors",
                active
                  ? "border-line bg-surface text-ink"
                  : "border-transparent bg-transparent text-dim hover:bg-surface/60 hover:text-ink",
                dragIndex === index && "opacity-50",
                dropTabId === tab.id && "border-brand bg-brand-soft text-ink ring-2 ring-brand/40",
              )}
            >
              {active ? (
                <span className="absolute inset-x-2 top-0 h-[2px] rounded-full bg-gradient-to-r from-brand to-accent" />
              ) : null}
              <span
                className={cn(
                  "h-[7px] w-[7px] shrink-0 rounded-full",
                  connected ? "bg-ok shadow-[0_0_6px_rgba(52,211,153,0.6)]" : "bg-mute/60",
                )}
              />
              <span className="min-w-0 flex-1 truncate">{tab.title}</span>
              <span className="hidden max-w-[70px] truncate text-[10.5px] text-mute group-hover:inline">
                {tab.loading ? "…" : tab.path.split("/").filter(Boolean).pop() ?? ""}
              </span>
              <button
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded text-mute transition-colors hover:bg-surface-4 hover:text-ink",
                  active ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                )}
                onClick={(event) => {
                  event.stopPropagation();
                  closeTab(tab.id).catch(() => undefined);
                }}
                aria-label={t("closeTab")}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-0.5 pb-1 pl-1">
        <Tooltip label={t("newTabCtrlT")}>
          <button
            onClick={() => {
              if (connectedProfiles.length === 1) {
                openServer(connectedProfiles[0].id).catch(() => undefined);
              } else {
                setUi({ connectionOpen: true, connectionTarget: null, connectionError: null });
              }
            }}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-dim transition-colors hover:bg-surface-3 hover:text-ink"
          >
            <Plus className="h-4 w-4" />
          </button>
        </Tooltip>
        <DropdownMenu
          align="end"
          trigger={
            <button className="flex h-7 w-6 items-center justify-center rounded-lg text-dim transition-colors hover:bg-surface-3 hover:text-ink">
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          }
        >
          <MenuLabel>{t("openTab")}</MenuLabel>
          {connectedProfiles.length === 0 ? (
            <MenuItem icon={<Server className="h-3.5 w-3.5" />} onSelect={() => setUi({ connectionOpen: true })}>
              {t("connectToServer")}
            </MenuItem>
          ) : (
            connectedProfiles.map((profile) => (
              <MenuItem
                key={profile.id}
                icon={<Server className="h-3.5 w-3.5" />}
                onSelect={() => openServer(profile.id).catch(() => undefined)}
              >
                {profile.name}
              </MenuItem>
            ))
          )}
          <MenuSeparator />
          <MenuItem
            icon={<Plus className="h-3.5 w-3.5" />}
            shortcut="Ctrl+T"
            onSelect={() => setUi({ connectionOpen: true, connectionTarget: null, connectionError: null })}
          >
            {t("newConnection")}…
          </MenuItem>
          {activeTabId ? (
            <MenuItem
              shortcut="Ctrl+Shift+K"
              onSelect={() => duplicateTab(activeTabId).catch(() => undefined)}
            >
              {t("duplicateTab")}
            </MenuItem>
          ) : null}
        </DropdownMenu>
      </div>
    </div>
  );
}

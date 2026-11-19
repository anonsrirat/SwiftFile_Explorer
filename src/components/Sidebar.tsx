import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Folder,
  Pencil,
  Plug,
  Plus,
  Server,
  ServerOff,
  Settings,
  Star,
  Trash2,
  Unplug,
} from "lucide-react";
import { useApp } from "@/stores/app";
import { DEFAULT_GROUP_COLOR } from "@/lib/colors";
import {
  ContextItem,
  ContextLabel,
  ContextMenu,
  ContextSeparator,
} from "@/components/ui/menu";
import { Badge, Tooltip } from "@/components/ui/controls";
import { useT } from "@/lib/useT";
import { cn } from "@/lib/utils";
import type { Profile } from "@/lib/types";

function Section({
  title,
  count,
  children,
  action,
  defaultOpen = true,
  icon,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
  action?: React.ReactNode;
  defaultOpen?: boolean;
  icon?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-1">
      <div className="group flex h-7 items-center gap-1 px-2">
        <button
          onClick={() => setOpen((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-mute transition-colors hover:text-dim"
        >
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {icon}
          <span className="truncate">{title}</span>
          {typeof count === "number" && count > 0 ? (
            <span className="ml-0.5 rounded bg-surface-3 px-1 text-[9.5px] font-semibold text-dim">
              {count}
            </span>
          ) : null}
        </button>
        {action}
      </div>
      {open ? <div className="mt-0.5 space-y-px px-1">{children}</div> : null}
    </div>
  );
}

const rowClass =
  "group flex w-full items-center gap-2 rounded-lg px-2 py-[5px] text-left text-[12px] text-dim transition-colors hover:bg-surface-3 hover:text-ink";

function ProfileRow({ profile, accent }: { profile: Profile; accent: string }) {
  const t = useT();
  const connected = useApp((s) => s.connections[profile.id] ?? false);
  const openServer = useApp((s) => s.openServer);
  const newSessionTab = useApp((s) => s.newSessionTab);
  const disconnect = useApp((s) => s.disconnect);
  const setUi = useApp((s) => s.setUi);
  const deleteProfile = useApp((s) => s.deleteProfile);
  const saveProfile = useApp((s) => s.saveProfile);

  return (
    <ContextMenu
      items={
        <>
          <ContextLabel>{profile.name}</ContextLabel>
          <ContextItem icon={<Plug className="h-3.5 w-3.5" />} onSelect={() => openServer(profile.id)}>
            {t("connect")}
          </ContextItem>
          <ContextItem icon={<Plus className="h-3.5 w-3.5" />} onSelect={() => newSessionTab(profile.id)}>
            {t("newTabShared")}
          </ContextItem>
          <ContextSeparator />
          <ContextItem
            icon={<Pencil className="h-3.5 w-3.5" />}
            onSelect={() => setUi({ connectionOpen: true, connectionTarget: profile, connectionError: null })}
          >
            {t("editProfile")}
          </ContextItem>
          <ContextItem
            icon={<Copy className="h-3.5 w-3.5" />}
            onSelect={() => {
              saveProfile({ profile: { ...profile, id: "", name: `${profile.name} copy` } }).catch(
                () => undefined,
              );
            }}
          >
            {t("duplicate")}
          </ContextItem>
          {connected ? (
            <ContextItem icon={<Unplug className="h-3.5 w-3.5" />} onSelect={() => disconnect(profile.id)}>
              {t("disconnect")}
            </ContextItem>
          ) : null}
          <ContextSeparator />
          <ContextItem
            danger
            icon={<Trash2 className="h-3.5 w-3.5" />}
            onSelect={() => {
              useApp.getState().askConfirm({
                title: `${t("deleteServerTitle")} “${profile.name}”?`,
                body: t("deleteServerBody"),
                danger: true,
                action: () => deleteProfile(profile.id),
              });
            }}
          >
            {t("deleteProfile")}
          </ContextItem>
        </>
      }
    >
      <button
        className={cn(rowClass, "relative pl-3")}
        onClick={() => openServer(profile.id).catch(() => undefined)}
      >
        <span
          className="absolute bottom-1.5 left-1 top-1.5 w-[2.5px] rounded-full"
          style={{ background: accent }}
        />
        <span
          className={cn(
            "h-[7px] w-[7px] shrink-0 rounded-full",
            connected ? "bg-ok shadow-[0_0_6px_rgba(52,211,153,0.55)]" : "bg-mute/50",
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-ink/90">{profile.name}</span>
          <span className="block truncate text-[10.5px] text-mute">
            {profile.username}@{profile.host}
          </span>
        </span>
        {profile.authMethod === "key" ? <span className="text-[9.5px] text-mute">{t("keyBadge")}</span> : null}
      </button>
    </ContextMenu>
  );
}

export function Sidebar() {
  const t = useT();
  const profiles = useApp((s) => s.profiles);
  const favorites = useApp((s) => s.favorites);
  const recent = useApp((s) => s.recent);
  const connections = useApp((s) => s.connections);
  const tabs = useApp((s) => s.tabs);
  const activeTabId = useApp((s) => s.activeTabId);
  const setUi = useApp((s) => s.setUi);
  const navigate = useApp((s) => s.navigate);
  const openServer = useApp((s) => s.openServer);
  const removeFavorite = useApp((s) => s.removeFavorite);
  const toggleHidden = useApp((s) => s.toggleHidden);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  const groups = useApp((s) => s.groups);

  const grouped = useMemo(() => {
    const map = new Map<string, Profile[]>();
    for (const profile of profiles) {
      const key = profile.groupName?.trim() || "Ungrouped";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(profile);
    }
    const order = new Map(groups.map((group, index) => [group.name, group.position * 1000 + index]));
    const rank = (name: string) =>
      name === "Ungrouped" ? -1 : (order.get(name) ?? Number.MAX_SAFE_INTEGER);
    return [...map.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]));
  }, [profiles, groups]);

  const accentFor = (profile: Profile) =>
    profile.color ||
    groups.find((group) => group.name === (profile.groupName || "Ungrouped"))?.color ||
    DEFAULT_GROUP_COLOR;

  const connectedCount = profiles.filter((p) => connections[p.id]).length;

  const openFavorite = async (profileId: string, path: string) => {
    if (activeTab && activeTab.profileId === profileId && activeTab.sessionId) {
      await navigate(activeTab.id, path);
      return;
    }
    await openServer(profileId);
    const tab = useApp.getState().tabs.find((t) => t.profileId === profileId);
    if (tab) await navigate(tab.id, path, "replace");
  };

  return (
    <aside className="flex w-[236px] shrink-0 flex-col border-r border-line bg-surface/70">
      <div className="flex items-center justify-between px-3 pb-1 pt-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mute">
            {t("explorer")}
          </span>
          {connectedCount > 0 ? (
            <Badge tone="ok">
              {connectedCount} {t("live")}
            </Badge>
          ) : null}
        </div>
        <Tooltip label={t("addServer")}>
          <button
            onClick={() => setUi({ connectionOpen: true, connectionTarget: null, connectionError: null })}
            className="flex h-6 w-6 items-center justify-center rounded-md text-dim transition-colors hover:bg-surface-3 hover:text-ink"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        <Section
          title={t("servers")}
          count={profiles.length}
          icon={<Server className="h-3 w-3" />}
          action={
            <Tooltip label={t("addServer")}>
              <button
                onClick={() => setUi({ connectionOpen: true, connectionTarget: null, connectionError: null })}
                className="mr-1 flex h-5 w-5 items-center justify-center rounded text-mute hover:bg-surface-3 hover:text-ink"
              >
                <Plus className="h-3 w-3" />
              </button>
            </Tooltip>
          }
        >
          {profiles.length === 0 ? (
            <p className="px-2 py-2 text-[11.5px] leading-relaxed text-mute">
              {t("noSavedServersHint")}
            </p>
          ) : (
            grouped.map(([group, items]) => {
              const color = group === "Ungrouped"
                ? "#94a3b8"
                : (groups.find((item) => item.name === group)?.color ?? DEFAULT_GROUP_COLOR);
              return (
                <div key={group} className="mb-1">
                  <div className="flex items-center gap-1.5 px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-mute/80">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
                    <span className="truncate">{group}</span>
                    <span className="text-[9.5px] font-normal text-mute/60">{items.length}</span>
                  </div>
                  {items.map((profile) => (
                    <ProfileRow key={profile.id} profile={profile} accent={accentFor(profile)} />
                  ))}
                </div>
              );
            })
          )}
        </Section>

        <Section
          title={t("favorites")}
          count={favorites.length}
          icon={<Star className="h-3 w-3" />}
          defaultOpen={favorites.length > 0}
        >
          {favorites.length === 0 ? (
            <p className="px-2 py-1 text-[11.5px] text-mute">
              {t("favouritesHint")}
            </p>
          ) : (
            favorites.map((favorite) => (
              <ContextMenu
                key={favorite.id}
                items={
                  <>
                    <ContextItem icon={<Folder className="h-3.5 w-3.5" />} onSelect={() => openFavorite(favorite.profileId, favorite.path)}>
                      {t("open")}
                    </ContextItem>
                    <ContextItem danger icon={<Trash2 className="h-3.5 w-3.5" />} onSelect={() => removeFavorite(favorite.id)}>
                      {t("remove")}
                    </ContextItem>
                  </>
                }
              >
                <button
                  className={rowClass}
                  onClick={() => openFavorite(favorite.profileId, favorite.path).catch(() => undefined)}
                >
                  <Star className="h-3.5 w-3.5 shrink-0 text-warn" />
                  <span className="min-w-0 flex-1 truncate">{favorite.label}</span>
                </button>
              </ContextMenu>
            ))
          )}
        </Section>

        <Section title={t("recent")} count={recent.length} icon={<Clock className="h-3 w-3" />} defaultOpen={false}>
          {recent.length === 0 ? (
            <p className="px-2 py-1 text-[11.5px] text-mute">{t("recentHint")}</p>
          ) : (
            recent.slice(0, 12).map((entry) => (
              <button
                key={`${entry.profileId}:${entry.path}`}
                className={rowClass}
                onClick={() => openFavorite(entry.profileId, entry.path).catch(() => undefined)}
              >
                <Clock className="h-3.5 w-3.5 shrink-0 text-mute" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{entry.label || entry.path}</span>
                  <span className="block truncate text-[10px] text-mute">{entry.path}</span>
                </span>
              </button>
            ))
          )}
        </Section>

        {connectedCount > 0 ? (
          <Section title={t("activeConnections")} count={connectedCount} icon={<Plug className="h-3 w-3" />}>
            {profiles
              .filter((p) => connections[p.id])
              .map((profile) => {
                const tab = tabs.find((t) => t.profileId === profile.id);
                return (
                  <button
                    key={profile.id}
                    className={rowClass}
                    onClick={() => (tab ? useApp.getState().activateTab(tab.id) : openServer(profile.id))}
                  >
                    <Plug className="h-3.5 w-3.5 shrink-0 text-ok" />
                    <span className="min-w-0 flex-1 truncate">{profile.name}</span>
                    <span className="text-[9.5px] uppercase text-ok">{t("live")}</span>
                  </button>
                );
              })}
          </Section>
        ) : null}
      </div>

      <div className="flex items-center gap-1 border-t border-line px-2 py-1.5">
        <Tooltip label={t("showHidden")}>
          <button
            onClick={() => activeTab && toggleHidden(activeTab.id)}
            className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[10.5px] text-mute hover:bg-surface-3 hover:text-ink"
          >
            {activeTab ? <ServerOff className="h-3 w-3" /> : <ServerOff className="h-3 w-3" />}
            {t("hiddenLabel")}
          </button>
        </Tooltip>
        <div className="flex-1" />
        <Tooltip label={t("settings")}>
          <button
            onClick={() => setUi({ settingsOpen: true })}
            className="flex h-6 w-6 items-center justify-center rounded-md text-mute hover:bg-surface-3 hover:text-ink"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      </div>
    </aside>
  );
}

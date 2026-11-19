import { Link2, Loader2, ShieldCheck, Wifi, WifiOff } from "lucide-react";
import { useApp } from "@/stores/app";
import { cn, formatBytes } from "@/lib/utils";
import { useT } from "@/lib/useT";

export function StatusBar() {
  const t = useT();
  const tabs = useApp((s) => s.tabs);
  const activeTabId = useApp((s) => s.activeTabId);
  const profiles = useApp((s) => s.profiles);
  const connections = useApp((s) => s.connections);
  const transfers = useApp((s) => s.transfers);
  const settings = useApp((s) => s.settings);
  const tab = tabs.find((x) => x.id === activeTabId) ?? null;
  const profile = profiles.find((p) => p.id === tab?.profileId) ?? null;

  const entries = tab?.search ? tab.search.results : tab?.listing?.entries ?? [];
  const visible = settings.showHidden ? entries : entries.filter((e) => !e.hidden);
  const selection = new Set(tab?.selection ?? []);
  const selectedEntries = visible.filter((e) => selection.has(e.path));
  const selectedSize = selectedEntries.reduce((sum, e) => sum + (e.isDir ? 0 : e.size), 0);

  const active = transfers.filter((x) =>
    ["queued", "connecting", "transferring", "verifying", "paused"].includes(x.status),
  );
  const speed = active.reduce((sum, x) => sum + x.speedBps, 0);

  return (
    <div className="flex h-[26px] shrink-0 items-center gap-3 border-t border-line bg-surface px-3 text-[10.5px] text-dim">
      <span className="tabular-nums">
        {visible.length.toLocaleString()} {t("items")}
      </span>
      {selectedEntries.length > 0 ? (
        <>
          <span className="text-line-strong">|</span>
          <span className="tabular-nums text-ink">
            {selectedEntries.length.toLocaleString()} {t("selected")} · {formatBytes(selectedSize)}
          </span>
        </>
      ) : null}
      {active.length > 0 ? (
        <>
          <span className="text-line-strong">|</span>
          <button
            onClick={() => useApp.getState().setUi({ transfersOpen: true })}
            className="flex items-center gap-1 text-brand-strong hover:underline"
          >
            <Loader2 className="h-3 w-3 animate-spin" />
            {active.length} {t("transfers")}
            {speed > 0 ? <span className="tabular-nums">· {formatBytes(speed)}/s</span> : null}
          </button>
        </>
      ) : null}
      <div className="flex-1" />
      {profile ? (
        <span className="flex items-center gap-1.5 font-mono text-[10px] text-mute">
          <Link2 className="h-3 w-3" />
          {profile.username}@{profile.host}:{profile.port}
        </span>
      ) : null}
      <span className="flex items-center gap-1">
        {tab?.sessionId && connections[tab.profileId] !== false ? (
          <>
            <Wifi className="h-3 w-3 text-ok" />
            <span className="text-ok">{t("connected")}</span>
          </>
        ) : (
          <>
            <WifiOff className="h-3 w-3 text-mute" />
            <span>{t("offline")}</span>
          </>
        )}
      </span>
      <span className="flex items-center gap-1 text-mute">
        <ShieldCheck className={cn("h-3 w-3", tab?.sessionId ? "text-ok" : "text-mute")} />
        SFTP
      </span>
    </div>
  );
}

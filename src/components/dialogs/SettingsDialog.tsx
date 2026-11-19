import { useEffect, useState } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  Activity,
  Cpu,
  Download,
  HardDrive,
  KeyRound,
  RefreshCw,
  RotateCcw,
  Settings as SettingsIcon,
  ShieldCheck,
  Trash2,
  Upload,
  Monitor,
} from "lucide-react";
import { useApp } from "@/stores/app";
import { Dialog, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Badge, Button, Field, Input, NativeSelect, Switch, Tooltip } from "@/components/ui/controls";
import { api, errorMessage } from "@/lib/api";
import type { AppInfo, KnownHost, Settings } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";
import { useT } from "@/lib/useT";

type SectionId = "general" | "appearance" | "performance" | "security" | "advanced";

export function SettingsDialog() {
  const t = useT();
  const open = useApp((s) => s.ui.settingsOpen);
  const setUi = useApp((s) => s.setUi);
  const settings = useApp((s) => s.settings);
  const applySettings = useApp((s) => s.applySettings);
  const pushToast = useApp((s) => s.pushToast);

  const [draft, setDraft] = useState<Settings>(settings);
  const [section, setSection] = useState<SectionId>("general");
  const [hosts, setHosts] = useState<KnownHost[]>([]);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [log, setLog] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setDraft(useApp.getState().settings);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    api.knownHosts().then(setHosts).catch(() => undefined);
    api.appInfo().then(setInfo).catch(() => undefined);
  }, [open]);

  useEffect(() => {
    if (section !== "advanced" || !open) return;
    api.logTail(300).then(setLog).catch(() => undefined);
  }, [section, open]);

  const patch = (values: Partial<Settings>) => setDraft((current) => ({ ...current, ...values }));
  const close = () => setUi({ settingsOpen: false });

  const save = async () => {
    setBusy(true);
    try {
      await applySettings(draft);
      pushToast({ kind: "success", title: t("settingsSaved") });
      close();
    } catch (e) {
      pushToast({ kind: "error", title: t("settingsSaveFailed"), detail: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const sections: { id: SectionId; label: string; icon: React.ReactNode }[] = [
    { id: "general", label: t("general"), icon: <SettingsIcon className="h-3.5 w-3.5" /> },
    { id: "appearance", label: t("appearance"), icon: <Monitor className="h-3.5 w-3.5" /> },
    { id: "performance", label: t("performance"), icon: <Cpu className="h-3.5 w-3.5" /> },
    { id: "security", label: t("security"), icon: <ShieldCheck className="h-3.5 w-3.5" /> },
    { id: "advanced", label: t("advanced"), icon: <Activity className="h-3.5 w-3.5" /> },
  ];

  return (
    <Dialog open={open} onOpenChange={(value) => (!value ? close() : undefined)}>
      <DialogContent size="xl" className="h-[min(620px,86vh)]">
        <DialogHeader title={t("settings")} description={t("settingsSubtitle")} />
        <div className="flex min-h-0 flex-1">
          <nav className="w-[178px] shrink-0 border-r border-line bg-surface-2/40 p-2">
            {sections.map((item) => (
              <button
                key={item.id}
                onClick={() => setSection(item.id)}
                className={cn(
                  "mb-0.5 flex h-8 w-full items-center gap-2 rounded-lg px-2 text-[12px] transition-colors",
                  section === item.id
                    ? "bg-brand-soft text-ink"
                    : "text-dim hover:bg-surface-3 hover:text-ink",
                )}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </nav>

          <div className="min-w-0 flex-1 overflow-y-auto px-5 py-4">
            {section === "general" ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t("language")}>
                    <NativeSelect
                      value={draft.language}
                      onChange={(event) => patch({ language: event.target.value as Settings["language"] })}
                    >
                      <option value="en">English</option>
                      <option value="th">ไทย</option>
                    </NativeSelect>
                  </Field>
                  <Field label={t("startup")}>
                    <NativeSelect
                      value={draft.startBehavior}
                      onChange={(event) =>
                        patch({ startBehavior: event.target.value as Settings["startBehavior"] })
                      }
                    >
                      <option value="restore">{t("startupRestore")}</option>
                      <option value="home">{t("startupHome")}</option>
                      <option value="welcome">{t("startupWelcome")}</option>
                    </NativeSelect>
                  </Field>
                </div>
                <Row label={t("restoreTabs")} hint={t("restoreTabsHint")}>
                  <Switch checked={draft.restoreTabs} onCheckedChange={(v) => patch({ restoreTabs: v })} />
                </Row>
                <Row label={t("confirmDelete")} hint={t("confirmDeleteHint")}>
                  <Switch checked={draft.confirmDelete} onCheckedChange={(v) => patch({ confirmDelete: v })} />
                </Row>
                <Field label={t("localFolderLabel")} hint={t("localFolderHint")}>
                  <div className="flex gap-1.5">
                    <Input
                      value={draft.defaultLocalFolder ?? ""}
                      onChange={(event) => patch({ defaultLocalFolder: event.target.value || null })}
                      placeholder="C:\Users\you\Downloads"
                      className="font-mono text-[11.5px]"
                    />
                    <Button
                      variant="subtle"
                      onClick={async () => {
                        const dir = await openDialog({ directory: true, multiple: false });
                        if (typeof dir === "string") patch({ defaultLocalFolder: dir });
                      }}
                    >
                      …
                    </Button>
                  </div>
                </Field>
              </div>
            ) : null}

            {section === "appearance" ? (
              <div className="space-y-4">
                <Field label={t("theme")}>
                  <div className="flex gap-1.5">
                    {(["system", "dark", "light"] as const).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => patch({ theme: mode })}
                        className={cn(
                          "flex-1 rounded-lg border px-2 py-1.5 text-[12px] transition-colors",
                          draft.theme === mode
                            ? "border-brand bg-brand-soft text-ink"
                            : "border-line bg-surface-2 text-dim hover:text-ink",
                        )}
                      >
                        {t(mode)}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label={t("viewMode")}>
                  <div className="flex gap-1.5">
                    {(["details", "list", "grid"] as const).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => patch({ viewMode: mode })}
                        className={cn(
                          "flex-1 rounded-lg border px-2 py-1.5 text-[12px] transition-colors",
                          draft.viewMode === mode
                            ? "border-brand bg-brand-soft text-ink"
                            : "border-line bg-surface-2 text-dim hover:text-ink",
                        )}
                      >
                        {t(mode)}
                      </button>
                    ))}
                  </div>
                </Field>
                <Row label={t("compact")}>
                  <Switch checked={draft.compact} onCheckedChange={(v) => patch({ compact: v })} />
                </Row>
                <Row label={t("animations")}>
                  <Switch checked={draft.animations} onCheckedChange={(v) => patch({ animations: v })} />
                </Row>
                <Row label={t("showHidden")}>
                  <Switch checked={draft.showHidden} onCheckedChange={(v) => patch({ showHidden: v })} />
                </Row>
              </div>
            ) : null}

            {section === "performance" ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t("maxTransfers")} hint="1–16 parallel transfers">
                    <Input
                      type="number"
                      min={1}
                      max={16}
                      value={draft.maxConcurrentTransfers}
                      onChange={(event) => patch({ maxConcurrentTransfers: Number(event.target.value) })}
                    />
                  </Field>
                  <Field label={t("bufferSize")} hint={t("bufferSizeHint")}>
                    <Input
                      type="number"
                      min={32}
                      max={4096}
                      value={draft.bufferSizeKb}
                      onChange={(event) => patch({ bufferSizeKb: Number(event.target.value) })}
                    />
                  </Field>
                  <Field label={t("speedLimit")}>
                    <Input
                      type="number"
                      min={0}
                      value={draft.speedLimitKbps}
                      onChange={(event) => patch({ speedLimitKbps: Number(event.target.value) })}
                    />
                  </Field>
                  <Field label={t("retries")}>
                    <Input
                      type="number"
                      min={0}
                      max={10}
                      value={draft.retryCount}
                      onChange={(event) => patch({ retryCount: Number(event.target.value) })}
                    />
                  </Field>
                  <Field label={t("timeout")}>
                    <Input
                      type="number"
                      min={5}
                      max={300}
                      value={draft.timeoutSecs}
                      onChange={(event) => patch({ timeoutSecs: Number(event.target.value) })}
                    />
                  </Field>
                  <Field label={t("keepalive")}>
                    <Input
                      type="number"
                      min={5}
                      max={300}
                      value={draft.keepaliveSecs}
                      onChange={(event) => patch({ keepaliveSecs: Number(event.target.value) })}
                    />
                  </Field>
                </div>
                <div className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-[11.5px] leading-relaxed text-dim">
                  Each tab and transfer opens its own SFTP channel over a single authenticated SSH transport.
                  Raising the transfer limit adds channels, not extra logins.
                </div>
              </div>
            ) : null}

            {section === "security" ? (
              <div className="space-y-4">
                <Row
                  label={t("allowCommands")}
                  hint={t("allowCommandsHint")}
                >
                  <Switch
                    checked={draft.allowServerCommands}
                    onCheckedChange={(v) => {
                      if (v) {
                        patch({ allowServerCommands: true });
                        return;
                      }
                      // Turning it off degrades copies to streaming; say so first.
                      useApp.getState().askConfirm({
                        title: t("disableCommandsTitle"),
                        body: t("disableCommandsBody"),
                        confirmLabel: t("confirmAction"),
                        action: () => patch({ allowServerCommands: false }),
                      });
                    }}
                  />
                </Row>
                <Row
                  label={t("verifyChecksums")}
                  hint={t("verifyChecksumsHint")}
                >
                  <Switch
                    checked={draft.verifyChecksums}
                    onCheckedChange={(v) => patch({ verifyChecksums: v })}
                  />
                </Row>

                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-[11.5px] font-medium text-dim">{t("trustedHosts")}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        useApp.getState().askConfirm({
                          title: t("forgetHostsTitle"),
                          body: t("forgetHostsBody"),
                          confirmLabel: t("forgetAll"),
                          danger: true,
                          action: async () => {
                            await api.clearKnownHosts().catch(() => undefined);
                            setHosts(await api.knownHosts().catch(() => []));
                          },
                        });
                      }}
                    >
                      <Trash2 className="h-3 w-3" /> {t("remove")}
                    </Button>
                  </div>
                  <div className="max-h-[168px] overflow-y-auto rounded-lg border border-line">
                    {hosts.length === 0 ? (
                      <p className="px-3 py-3 text-[11.5px] text-mute">
                        No trusted host keys yet. They are added when you accept a key on first connect.
                      </p>
                    ) : (
                      hosts.map((host) => (
                        <div
                          key={host.id}
                          className="flex items-center gap-2 border-b border-line px-2.5 py-1.5 last:border-b-0"
                        >
                          <KeyRound className="h-3.5 w-3.5 shrink-0 text-brand" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[11.5px] text-ink">
                              {host.host}:{host.port}{" "}
                              <span className="text-mute">({host.algorithm})</span>
                            </p>
                            <p className="truncate font-mono text-[10px] text-mute">{host.fingerprint}</p>
                          </div>
                          <Tooltip label={`Trusted ${formatDate(host.acceptedAt)}`}>
                            <span className="text-[10px] text-mute">
                              {new Date(host.acceptedAt).toLocaleDateString()}
                            </span>
                          </Tooltip>
                          <button
                            onClick={async () => {
                              await api.deleteKnownHost(host.id).catch(() => undefined);
                              setHosts(await api.knownHosts().catch(() => []));
                            }}
                            className="flex h-6 w-6 items-center justify-center rounded text-mute hover:bg-danger-soft hover:text-danger"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      useApp.getState().askConfirm({
                        title: t("clearCredsTitle"),
                        body: t("clearCredsBody"),
                        danger: true,
                        confirmLabel: t("clearCredentials"),
                        action: async () => {
                          const remaining = await api.clearCredentials().catch(() => -1);
                          await useApp.getState().refreshProfiles();
                          pushToast({
                            kind: "success",
                            title: t("credsCleared"),
                            detail:
                              remaining >= 0 ? `${remaining} ${t("secretsRemain")}` : undefined,
                          });
                        },
                      });
                    }}
                  >
                    <KeyRound className="h-3.5 w-3.5" /> {t("clearCredentials")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      await api.transferClearHistory().catch(() => undefined);
                      await useApp.getState().refreshHistory();
                      pushToast({ kind: "info", title: t("historyCleared") });
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> {t("clearHistoryBtn")}
                  </Button>
                </div>
              </div>
            ) : null}

            {section === "advanced" ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="subtle"
                    onClick={async () => {
                      const path = await saveDialog({
                        defaultPath: "swiftsftp-settings.json",
                        filters: [{ name: "JSON", extensions: ["json"] }],
                      });
                      if (!path) return;
                      await api.settingsExport(path).catch((e) =>
                        pushToast({ kind: "error", title: t("exportFailed"), detail: errorMessage(e) }),
                      );
                      pushToast({ kind: "success", title: t("settingsExported"), detail: path });
                    }}
                  >
                    <Download className="h-3.5 w-3.5" /> {t("exportSettings")}
                  </Button>
                  <Button
                    size="sm"
                    variant="subtle"
                    onClick={async () => {
                      const path = await openDialog({
                        multiple: false,
                        filters: [{ name: "JSON", extensions: ["json"] }],
                      });
                      if (typeof path !== "string") return;
                      try {
                        const imported = await api.settingsImport(path);
                        setDraft(imported);
                        await applySettings(imported);
                        pushToast({ kind: "success", title: t("settingsImported") });
                      } catch (e) {
                        pushToast({ kind: "error", title: t("importFailed"), detail: errorMessage(e) });
                      }
                    }}
                  >
                    <Upload className="h-3.5 w-3.5" /> {t("importSettings")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      setDraft(await api.settingsReset());
                      pushToast({ kind: "info", title: t("defaultsRestored") });
                    }}
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> {t("resetSettings")}
                  </Button>
                  <Button
                    size="sm"
                    variant="subtle"
                    onClick={() => void useApp.getState().checkForUpdates(false)}
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> {t("checkUpdates")}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      useApp.getState().askConfirm({
                        title: t("resetTitle"),
                        body: t("resetBody"),
                        confirmLabel: t("resetEverything"),
                        danger: true,
                        action: async () => {
                          await api.factoryReset().catch(() => undefined);
                          await useApp.getState().refreshProfiles();
                          setDraft(await api.settingsGet());
                          pushToast({ kind: "info", title: t("appReset") });
                        },
                      });
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> {t("factoryReset")}
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[11px]">
                  <span className="text-mute">{t("appVersion")}</span>
                  <span className="text-ink">{info?.version ?? "1.0.0"}</span>
                  <span className="text-mute">{t("dataFolder")}</span>
                  <span className="truncate font-mono text-[10.5px] text-dim" title={info?.dataDir}>
                    {info?.dataDir ?? "—"}
                  </span>
                  <span className="text-mute">{t("webview2")}</span>
                  <span className="text-ink">{info?.webview2 ?? "bundled / unknown"}</span>
                  <span className="text-mute">Platform</span>
                  <span className="text-ink">
                    {info?.os} · {info?.arch}
                  </span>
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[11.5px] font-medium text-dim">{t("logViewer")}</span>
                    <div className="flex items-center gap-1">
                      <Badge tone="neutral">swiftsftp.log</Badge>
                      <Button size="sm" variant="ghost" onClick={() => api.logTail(300).then(setLog).catch(() => undefined)}>
                        <RotateCcw className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  <pre className="h-[168px] overflow-auto rounded-lg border border-line bg-surface p-2 font-mono text-[10px] leading-relaxed text-dim">
                    {log || t("noLogEntries")}
                  </pre>
                </div>
                <p className="flex items-center gap-1.5 text-[11px] text-mute">
                  <HardDrive className="h-3 w-3" /> {info?.dbFile}
                </p>
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setDraft(useApp.getState().settings)}>
            Discard
          </Button>
          <div className="flex-1" />
          <Button variant="ghost" onClick={close}>
            {t("cancel")}
          </Button>
          <Button variant="brand" loading={busy} onClick={save}>
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-transparent px-0.5 py-1">
      <div className="min-w-0">
        <p className="text-[12.5px] text-ink">{label}</p>
        {hint ? <p className="mt-0.5 text-[11px] leading-snug text-mute">{hint}</p> : null}
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  );
}

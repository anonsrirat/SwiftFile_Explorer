import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Info,
  Pencil,
  Shield,
  TriangleAlert,
  X,
  XCircle,
} from "lucide-react";
import { useApp } from "@/stores/app";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Badge, Button, Checkbox, Field, Input } from "@/components/ui/controls";
import { bitmaskToPermissions, cn, formatBytes, formatDate, modeToString, permissionsToBitmask } from "@/lib/utils";
import { useT } from "@/lib/useT";
import type { OverwritePolicy } from "@/stores/app";

export function PromptDialog() {
  const t = useT();
  const prompt = useApp((s) => s.prompt);
  const close = useApp((s) => s.closePrompt);
  const submit = useApp((s) => s.submitPrompt);
  const [value, setValue] = useState("");

  useEffect(() => {
    setValue(prompt.value);
  }, [prompt.open, prompt.value]);

  return (
    <Dialog open={prompt.open} onOpenChange={(open) => (!open ? close() : undefined)}>
      <DialogContent size="sm">
        <DialogHeader
          title={prompt.title}
          icon={<Pencil className="h-4 w-4" />}
          description={prompt.mode === "rename" && prompt.targetPath ? prompt.targetPath : undefined}
        />
        <DialogBody>
          <Field label={prompt.mode === "rename" ? t("name") : t("name")}>
            <Input
              autoFocus
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && value.trim()) submit(value);
              }}
              placeholder={prompt.mode === "new-folder" ? "new-folder" : "file.txt"}
              spellCheck={false}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            {t("cancel")}
          </Button>
          <Button variant="brand" disabled={!value.trim()} onClick={() => submit(value)}>
            {prompt.mode === "rename" ? t("rename") : t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ConfirmDialog() {
  const t = useT();
  const confirm = useApp((s) => s.confirm);
  const close = useApp((s) => s.closeConfirm);
  const accept = useApp((s) => s.acceptConfirm);

  return (
    <Dialog open={confirm.open} onOpenChange={(open) => (!open ? close() : undefined)}>
      <DialogContent size="sm" onEscapeKeyDown={(event) => {
        event.preventDefault();
        close();
      }}>
        <DialogHeader
          title={confirm.title}
          description={confirm.body}
          icon={
            confirm.danger ? (
              <TriangleAlert className="h-4 w-4 text-danger" />
            ) : (
              <Info className="h-4 w-4" />
            )
          }
        />
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            {t("cancel")}
          </Button>
          <Button autoFocus variant={confirm.danger ? "danger" : "brand"} onClick={accept}>
            {confirm.confirmLabel ?? t("confirmAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ConflictDialog() {
  const t = useT();
  const conflict = useApp((s) => s.conflict);
  const resolve = useApp((s) => s.resolveConflict);
  const close = useApp((s) => s.closeConflict);
  const [policy, setPolicy] = useState<OverwritePolicy>("rename");
  const [applyAll, setApplyAll] = useState(false);

  useEffect(() => {
    if (conflict.open) {
      setPolicy("rename");
      setApplyAll(false);
    }
  }, [conflict.open]);

  const options: { value: OverwritePolicy; label: string; hint: string }[] = [
    { value: "replace", label: t("replace"), hint: t("hintReplace") },
    { value: "skip", label: t("skip"), hint: t("hintSkip") },
    { value: "rename", label: t("keepBoth"), hint: t("hintRename") },
  ];

  return (
    <Dialog open={conflict.open} onOpenChange={(open) => (!open ? close() : undefined)}>
      <DialogContent size="md">
        <DialogHeader
          title={t("conflictLocal")}
          description={`${conflict.names.length} ${t("namesExistIn")} ${conflict.remoteDir}`}
          icon={<AlertTriangle className="h-4 w-4 text-warn" />}
        />
        <DialogBody className="space-y-3">
          <div className="max-h-[120px] overflow-y-auto rounded-lg border border-line bg-surface-2 px-2 py-1.5">
            {conflict.names.map((name) => (
              <p key={name} className="truncate py-0.5 text-[11.5px] text-dim">
                {name}
              </p>
            ))}
          </div>
          <div className="space-y-1">
            {options.map((option) => (
              <button
                key={option.value}
                onClick={() => setPolicy(option.value)}
                className={cn(
                  "flex w-full items-start gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors",
                  policy === option.value
                    ? "border-brand bg-brand-soft"
                    : "border-line bg-surface-2 hover:border-line-strong",
                )}
              >
                <span
                  className={cn(
                    "mt-[3px] flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border",
                    policy === option.value ? "border-brand" : "border-line-strong",
                  )}
                >
                  {policy === option.value ? <span className="h-2 w-2 rounded-full bg-brand" /> : null}
                </span>
                <span className="min-w-0">
                  <span className="block text-[12.5px] text-ink">{option.label}</span>
                  <span className="block text-[10.5px] text-mute">{option.hint}</span>
                </span>
              </button>
            ))}
          </div>
          {policy === "replace" ? (
            <label className="flex cursor-pointer items-center gap-2 text-[11.5px] text-danger">
              <Checkbox checked={applyAll} onCheckedChange={(value) => setApplyAll(value === true)} />
              {t("applyToAll")}
            </label>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => resolve("cancel", false)}>
            {t("cancel")}
          </Button>
          <Button variant="brand" onClick={() => resolve(policy, applyAll)}>
            {t("paste")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PropertiesDialog() {
  const t = useT();
  const properties = useApp((s) => s.properties);
  const close = useApp((s) => s.closeProperties);
  const savePermissions = useApp((s) => s.savePermissions);
  const addFavorite = useApp((s) => s.addFavorite);
  const entry = properties.entry;
  const [perms, setPerms] = useState(bitmaskToPermissions(entry?.mode ?? 0o644));

  useEffect(() => {
    if (properties.open && entry) setPerms(bitmaskToPermissions(entry.mode ?? 0o644));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [properties.open, entry?.path]);

  const bitmask = permissionsToBitmask(perms);

  return (
    <Dialog open={properties.open} onOpenChange={(open) => (!open ? close() : undefined)}>
      <DialogContent size="md">
        <DialogHeader
          title={entry?.name ?? t("properties")}
          description={entry?.path}
          icon={<Shield className="h-4 w-4" />}
        />
        <DialogBody className="space-y-3">
          <div className="grid grid-cols-[110px_1fr] gap-y-1.5 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[11.5px]">
            <span className="text-mute">{t("type")}</span>
            <span className="text-ink">{entry?.isDir ? t("folder") : t("file")}{entry?.isSymlink ? ` (${t("symlink")})` : ""}</span>
            <span className="text-mute">{t("size")}</span>
            <span className="text-ink">{formatBytes(entry?.size ?? 0)}</span>
            <span className="text-mute">{t("modified")}</span>
            <span className="text-ink">{formatDate(entry?.modified)}</span>
            <span className="text-mute">{t("owner")}</span>
            <span className="text-ink">{entry?.owner ?? "—"}</span>
            <span className="text-mute">{t("group")}</span>
            <span className="text-ink">{entry?.group ?? "—"}</span>
            <span className="text-mute">{t("mode")}</span>
            <span className="flex items-center gap-2 text-ink">
              <span className="font-mono">{entry?.mode !== null && entry?.mode !== undefined ? entry.mode.toString(8).padStart(3, "0") : "—"}</span>
              <span className="font-mono text-dim">{modeToString(entry?.mode ?? null)}</span>
              <Badge tone="neutral">{t("newMode")}: {bitmask.toString(8).padStart(3, "0")}</Badge>
            </span>
          </div>

          <div className="rounded-lg border border-line">
            <div className="grid grid-cols-4 border-b border-line bg-surface-3/50 px-3 py-1 text-[10.5px] font-medium uppercase tracking-wide text-mute">
              <span />
              <span>{t("readShort")}</span>
              <span>{t("writeShort")}</span>
              <span>{t("execShort")}</span>
            </div>
            {[
              { label: t("owner"), prefix: "owner" as const },
              { label: t("group"), prefix: "group" as const },
              { label: t("other"), prefix: "other" as const },
            ].map((row) => (
              <div key={row.prefix} className="grid grid-cols-4 items-center px-3 py-1 text-[11.5px]">
                <span className="text-dim">{row.label}</span>
                {(["Read", "Write", "Exec"] as const).map((action) => {
                  const key = `${row.prefix}${action}` as keyof typeof perms;
                  const disabled = entry?.isDir && row.prefix === "other" && action === "Write";
                  return (
                    <Checkbox
                      key={key}
                      checked={perms[key]}
                      disabled={disabled}
                      onCheckedChange={(value) =>
                        setPerms((current) => ({ ...current, [key]: value === true }))
                      }
                    />
                  );
                })}
              </div>
            ))}
          </div>
          <p className="text-[10.5px] text-mute">
            {t("permissionsHint")}
          </p>
        </DialogBody>
        <DialogFooter>
          <Button
            size="md"
            variant="ghost"
            onClick={() => {
              if (!entry) return;
              const tab = useApp.getState().tabs.find((x) => x.id === properties.tabId);
              if (tab) addFavorite(tab.profileId, entry.path, entry.name).catch(() => undefined);
            }}
          >
            {t("addToFavourites")}
          </Button>
          <div className="flex-1" />
          <Button variant="ghost" onClick={close}>
            {t("close")}
          </Button>
          <Button variant="brand" onClick={() => savePermissions(bitmask)}>
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const toastStyles = {
  info: { icon: <Info className="h-4 w-4" />, className: "border-line-strong bg-surface-2 text-ink" },
  success: { icon: <CheckCircle2 className="h-4 w-4" />, className: "border-ok/40 bg-surface-2 text-ink" },
  warning: { icon: <TriangleAlert className="h-4 w-4" />, className: "border-warn/40 bg-surface-2 text-ink" },
  error: { icon: <XCircle className="h-4 w-4" />, className: "border-danger/40 bg-surface-2 text-ink" },
} as const;

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed bottom-3 right-3 z-[90] flex w-[336px] flex-col gap-1.5">
      {toasts.map((toast) => {
        const style = toastStyles[toast.kind];
        return (
          <div
            key={toast.id}
            className={cn(
              "pointer-events-auto flex items-start gap-2 rounded-xl border px-3 py-2 shadow-[var(--shadow)] animate-panel",
              style.className,
            )}
          >
            <span
              className={cn(
                "mt-[1px] shrink-0",
                toast.kind === "success"
                  ? "text-ok"
                  : toast.kind === "error"
                    ? "text-danger"
                    : toast.kind === "warning"
                      ? "text-warn"
                      : "text-brand",
              )}
            >
              {style.icon}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-medium">{toast.title}</p>
              {toast.detail ? (
                <p className="mt-0.5 break-words text-[11px] leading-snug text-dim">{toast.detail}</p>
              ) : null}
            </div>
            <button
              onClick={() => dismiss(toast.id)}
              className="mt-0.5 shrink-0 rounded p-0.5 text-mute hover:bg-surface-3 hover:text-ink"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function WelcomeView() {
  const t = useT();
  const profiles = useApp((s) => s.profiles);
  const setUi = useApp((s) => s.setUi);
  const openServer = useApp((s) => s.openServer);

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-8">
      <div className="w-full max-w-[540px]">
        <div className="mb-5 flex flex-col items-center text-center">
          <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-accent shadow-[0_16px_40px_-16px_rgba(111,108,248,0.9)]">
            <Copy className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-[19px] font-semibold tracking-tight text-ink">{t("welcomeTitle")}</h1>
          <p className="mt-1 max-w-[400px] text-[12.5px] leading-relaxed text-dim">{t("welcomeBody")}</p>
          <div className="mt-3 flex items-center gap-2">
            <Button
              variant="brand"
              onClick={() => setUi({ connectionOpen: true, connectionTarget: null, connectionError: null })}
            >
              {t("welcomeCta")}
            </Button>
            <Button variant="subtle" onClick={() => setUi({ settingsOpen: true })}>
              {t("settings")}
            </Button>
          </div>
        </div>

        {profiles.length > 0 ? (
          <div className="rounded-xl border border-line bg-surface/80 p-2">
            <p className="px-1.5 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-mute">
              {t("serversSaved")}
            </p>
            <div className="grid gap-1">
              {profiles.slice(0, 6).map((profile) => (
                <button
                  key={profile.id}
                  onClick={() => openServer(profile.id)}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-3"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-3 text-[10.5px] font-semibold uppercase text-dim">
                    {profile.name.slice(0, 2)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] text-ink">{profile.name}</span>
                    <span className="block truncate text-[10.5px] text-mute">
                      {profile.username}@{profile.host}:{profile.port}
                    </span>
                  </span>
                  <Badge tone="neutral">{profile.authMethod}</Badge>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

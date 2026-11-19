import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  FolderCog,
  FolderOpen,
  KeyRound,
  Plug,
  Plus,
  Server,
  Trash2,
  XCircle,
  Zap,
} from "lucide-react";
import { useApp } from "@/stores/app";
import { Dialog, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Badge, Button, Checkbox, Field, Input, NativeSelect, Spinner } from "@/components/ui/controls";
import { api, errorMessage } from "@/lib/api";
import { SERVER_COLORS } from "@/lib/colors";
import type { Profile, TestResult } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";
import { useT } from "@/lib/useT";

interface Draft {
  id: string;
  name: string;
  groupName: string;
  color: string | null;
  host: string;
  port: number;
  username: string;
  authMethod: "password" | "key" | "agent";
  keyPath: string;
  defaultRemoteDir: string;
  timeoutSecs: number;
  keepaliveSecs: number;
  autoConnect: boolean;
  lastDir: string | null;
  hasPassword: boolean;
  hasPassphrase: boolean;
  createdAt: number;
  updatedAt: number;
}

function emptyDraft(): Draft {
  return {
    id: "",
    name: "",
    groupName: "Ungrouped",
    color: null,
    host: "",
    port: 22,
    username: "",
    authMethod: "password",
    keyPath: "",
    defaultRemoteDir: "",
    timeoutSecs: 20,
    keepaliveSecs: 30,
    autoConnect: false,
    lastDir: null,
    hasPassword: false,
    hasPassphrase: false,
    createdAt: 0,
    updatedAt: 0,
  };
}

function toDraft(profile: Profile): Draft {
  return {
    ...profile,
    keyPath: profile.keyPath ?? "",
    defaultRemoteDir: profile.defaultRemoteDir ?? "",
  };
}

function toProfile(draft: Draft): Profile {
  return {
    id: draft.id,
    name: draft.name,
    groupName: draft.groupName || "Ungrouped",
    color: draft.color,
    host: draft.host,
    port: Number(draft.port) || 22,
    username: draft.username,
    authMethod: draft.authMethod,
    keyPath: draft.keyPath || null,
    defaultRemoteDir: draft.defaultRemoteDir || null,
    timeoutSecs: Number(draft.timeoutSecs) || 20,
    keepaliveSecs: Number(draft.keepaliveSecs) || 30,
    autoConnect: draft.autoConnect,
    lastDir: draft.lastDir,
    hasPassword: draft.hasPassword,
    hasPassphrase: draft.hasPassphrase,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
  };
}

export function ConnectionDialog() {
  const t = useT();
  const open = useApp((s) => s.ui.connectionOpen);
  const target = useApp((s) => s.ui.connectionTarget);
  const initialError = useApp((s) => s.ui.connectionError);
  const profiles = useApp((s) => s.profiles);
  const groups = useApp((s) => s.groups);
  const setUi = useApp((s) => s.setUi);
  const saveProfile = useApp((s) => s.saveProfile);
  const deleteProfile = useApp((s) => s.deleteProfile);
  const openServer = useApp((s) => s.openServer);
  const pushToast = useApp((s) => s.pushToast);

  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [password, setPassword] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [savePassword, setSavePassword] = useState(true);
  const [reveal, setReveal] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTest(null);
    setError(initialError ?? null);
    setPassword("");
    setPassphrase("");
    if (target) {
      setDraft(toDraft(target));
    } else {
      setDraft(emptyDraft());
    }
    // Only re-initialise when the dialog opens or targets a different profile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target?.id]);

  const patch = (values: Partial<Draft>) => setDraft((current) => ({ ...current, ...values }));

  const close = () => setUi({ connectionOpen: false, connectionTarget: null, connectionError: null });

  const persist = async (): Promise<Profile | null> => {
    if (!draft.name.trim()) {
      setError(t("errNameRequired"));
      return null;
    }
    if (!draft.host.trim()) {
      setError(t("errHostRequired"));
      return null;
    }
    if (!draft.username.trim()) {
      setError(t("errUserRequired"));
      return null;
    }
    try {
      const saved = await saveProfile({
        profile: toProfile(draft),
        password: savePassword && password ? password : undefined,
        passphrase: savePassword && passphrase ? passphrase : undefined,
      });
      setDraft(toDraft(saved));
      setError(null);
      return saved;
    } catch (e) {
      setError(errorMessage(e));
      return null;
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTest(null);
    setError(null);
    try {
      const result = await api.testProfile(toProfile(draft), password || null);
      setTest(result);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setTesting(false);
    }
  };

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    const saved = await persist();
    if (!saved) {
      setConnecting(false);
      return;
    }
    await openServer(saved.id, savePassword && password ? password : undefined);
    setConnecting(false);
    const state = useApp.getState();
    if (state.tabs.some((tab) => tab.profileId === saved.id && tab.sessionId)) {
      setUi({ connectionOpen: false, connectionTarget: null, connectionError: null });
    } else {
      setError(state.ui.connectionError ?? t("connectionFailed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => (!value ? close() : undefined)}>
      <DialogContent size="xl" className="h-[min(640px,86vh)]">
        <DialogHeader
          title={draft.id ? draft.name || "Server" : t("newConnection")}
          description="SFTP over SSH · host keys are verified before your credentials are sent"
          icon={<Server className="h-4 w-4" />}
        />
        <div className="flex min-h-0 flex-1">
          <div className="flex w-[218px] shrink-0 flex-col border-r border-line bg-surface-2/50">
            <div className="flex items-center justify-between px-2 pb-1 pt-2">
              <span className="px-1 text-[10px] font-semibold uppercase tracking-wide text-mute">
                {t("savedProfiles")}
              </span>
              <button
                onClick={() => {
                  setDraft(emptyDraft());
                  setPassword("");
                  setTest(null);
                  setError(null);
                }}
                className="flex h-6 w-6 items-center justify-center rounded-md text-dim hover:bg-surface-3 hover:text-ink"
                title={t("addServer")}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
              {profiles.length === 0 ? (
                <p className="px-2 py-3 text-[11.5px] leading-relaxed text-mute">{t("noServers")}</p>
              ) : (
                profiles.map((profile) => (
                  <button
                    key={profile.id}
                    onClick={() => {
                      setDraft(toDraft(profile));
                      setPassword("");
                      setTest(null);
                      setError(null);
                    }}
                    className={cn(
                      "mb-0.5 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
                      draft.id === profile.id ? "bg-brand-soft text-ink" : "text-dim hover:bg-surface-3",
                    )}
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface-3 text-[10px] font-semibold uppercase text-dim">
                      {profile.name.slice(0, 2)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] text-ink/90">{profile.name}</span>
                      <span className="block truncate text-[10px] text-mute">
                        {profile.username}@{profile.host}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
            <div className="border-t border-line px-2 py-2">
              <Button size="sm" variant="subtle" className="w-full" onClick={() => setDraft(emptyDraft())}>
                <Plus className="h-3.5 w-3.5" /> {t("addServer")}
              </Button>
            </div>
          </div>

          <div className="min-w-0 flex-1 overflow-y-auto px-5 py-4">
            {error ? (
              <div className="mb-3 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-2.5 py-1.5 text-[11.5px] leading-snug text-danger">
                <XCircle className="mt-[1px] h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0">{error}</span>
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-3">
              <Field label={t("profileName")} className="col-span-2">
                <Input
                  value={draft.name}
                  onChange={(event) => patch({ name: event.target.value })}
                  placeholder="Minecraft Production"
                  autoFocus
                />
              </Field>
              <Field label={t("host")}>
                <Input
                  value={draft.host}
                  onChange={(event) => patch({ host: event.target.value })}
                  placeholder="sftp.example.com"
                  spellCheck={false}
                />
              </Field>
              <Field label={t("port")}>
                <Input
                  type="number"
                  min={1}
                  max={65535}
                  value={draft.port}
                  onChange={(event) => patch({ port: Number(event.target.value) })}
                />
              </Field>
              <Field label={t("username")}>
                <Input
                  value={draft.username}
                  onChange={(event) => patch({ username: event.target.value })}
                  placeholder="root"
                  spellCheck={false}
                />
              </Field>
              <Field label={t("group")}>
                <div className="flex items-center gap-1.5">
                  <NativeSelect
                    value={draft.groupName}
                    onChange={(event) => patch({ groupName: event.target.value })}
                  >
                    <option value="Ungrouped">Ungrouped</option>
                    {groups.map((group) => (
                      <option key={group.name} value={group.name}>
                        {group.name}
                      </option>
                    ))}
                    {draft.groupName &&
                    draft.groupName !== "Ungrouped" &&
                    !groups.some((group) => group.name === draft.groupName) ? (
                      <option value={draft.groupName}>{draft.groupName}</option>
                    ) : null}
                  </NativeSelect>
                  <Button
                    size="sm"
                    variant="ghost"
                    title={t("manageGroups")}
                    onClick={() => setUi({ groupsOpen: true })}
                  >
                    <FolderCog className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </Field>

              <Field label={t("serverColour")}>
                <div className="flex flex-wrap items-center gap-1">
                  <button
                    onClick={() => patch({ color: null })}
                    className={cn(
                      "h-6 rounded-md border px-1.5 text-[10.5px] transition-colors",
                      draft.color === null
                        ? "border-brand bg-brand-soft text-ink"
                        : "border-line text-dim hover:border-line-strong",
                    )}
                  >
                    Group
                  </button>
                  {SERVER_COLORS.map((color) => (
                    <button
                      key={color}
                      onClick={() => patch({ color })}
                      aria-label={`${t("useColor")} ${color}`}
                      className={cn(
                        "h-5 w-5 rounded-full border transition-transform hover:scale-110",
                        draft.color?.toLowerCase() === color.toLowerCase()
                          ? "border-white ring-2 ring-brand"
                          : "border-black/20",
                      )}
                      style={{ background: color }}
                    />
                  ))}
                </div>
              </Field>

              <Field label={t("authMethod")} className="col-span-2">
                <NativeSelect
                  value={draft.authMethod}
                  onChange={(event) =>
                    patch({ authMethod: event.target.value as Draft["authMethod"] })
                  }
                >
                  <option value="password">Password</option>
                  <option value="key">Private key file</option>
                  <option value="agent">SSH agent (Windows OpenSSH)</option>
                </NativeSelect>
              </Field>

              {draft.authMethod === "password" ? (
                <Field
                  label={t("password")}
                  className="col-span-2"
                  hint={draft.hasPassword ? "A saved password exists — leave empty to keep it" : undefined}
                >
                  <div className="flex gap-1.5">
                    <div className="relative flex-1">
                      <Input
                        type={reveal ? "text" : "password"}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder={draft.hasPassword ? "••••••••" : "Password"}
                        className="pr-8"
                      />
                      <button
                        type="button"
                        onClick={() => setReveal((value) => !value)}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 text-mute hover:text-ink"
                      >
                        {reveal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                </Field>
              ) : null}

              {draft.authMethod === "key" ? (
                <>
                  <Field label={t("privateKey")} className="col-span-2">
                    <div className="flex gap-1.5">
                      <Input
                        value={draft.keyPath}
                        onChange={(event) => patch({ keyPath: event.target.value })}
                        placeholder="C:\Users\you\.ssh\id_ed25519"
                        spellCheck={false}
                        className="font-mono text-[11.5px]"
                      />
                      <Button
                        variant="subtle"
                        onClick={async () => {
                          const file = await openDialog({ multiple: false, directory: false });
                          if (typeof file === "string") patch({ keyPath: file });
                        }}
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </Field>
                  <Field
                    label={t("passphrase")}
                    className="col-span-2"
                    hint={
                      draft.hasPassphrase
                        ? t("savedPassphraseHint")
                        : t("keyPassphraseHint")
                    }
                  >
                    <Input
                      type="password"
                      value={passphrase}
                      onChange={(event) => setPassphrase(event.target.value)}
                      placeholder={t("optional")}
                    />
                  </Field>
                </>
              ) : null}

              {draft.authMethod === "agent" ? (
                <div className="col-span-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[11.5px] leading-relaxed text-dim">
                  <KeyRound className="mr-1 inline h-3.5 w-3.5 text-brand" />
                  Uses the Windows OpenSSH agent pipe{" "}
                  <code className="font-mono text-[10.5px]">\\.\pipe\openssh-ssh-agent</code>. Load a key with{" "}
                  <code className="font-mono text-[10.5px]">ssh-add</code> first.
                </div>
              ) : null}

              <Field label={t("defaultDir")} className="col-span-2">
                <Input
                  value={draft.defaultRemoteDir}
                  onChange={(event) => patch({ defaultRemoteDir: event.target.value })}
                  placeholder="/home/user (defaults to the login folder)"
                  spellCheck={false}
                  className="font-mono text-[11.5px]"
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

            <div className="mt-3 space-y-2">
              <label className="flex cursor-pointer items-center gap-2 text-[12px] text-dim">
                <Checkbox
                  checked={savePassword}
                  onCheckedChange={(value) => setSavePassword(value === true)}
                />
                {t("savePassword")}
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-[12px] text-dim">
                <Checkbox
                  checked={draft.autoConnect}
                  onCheckedChange={(value) => patch({ autoConnect: value === true })}
                />
                {t("autoConnect")}
              </label>
            </div>

            {test ? (
              <div
                className={cn(
                  "mt-3 rounded-lg border px-3 py-2 text-[11.5px] leading-snug",
                  test.ok
                    ? "border-ok/30 bg-ok/10 text-ok"
                    : "border-danger/30 bg-danger-soft text-danger",
                )}
              >
                <div className="flex items-center gap-1.5 font-medium">
                  {test.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                  {test.ok ? t("connected") : t("error")}
                  <span className="ml-auto font-mono text-[10px] opacity-80">{test.latencyMs} ms</span>
                </div>
                <p className="mt-0.5 opacity-90">{test.message}</p>
              </div>
            ) : null}

            {draft.id ? (
              <div className="mt-4 flex items-center gap-2 border-t border-line pt-3 text-[10.5px] text-mute">
                <Badge tone="neutral">{draft.authMethod}</Badge>
                <span>updated {formatDate(draft.updatedAt)}</span>
                <div className="flex-1" />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    try {
                      const copy = await api.duplicateProfile(draft.id);
                      await useApp.getState().refreshProfiles();
                      setDraft(toDraft(copy));
                      pushToast({ kind: "success", title: t("profileDuplicated") });
                    } catch (e) {
                      setError(errorMessage(e));
                    }
                  }}
                >
                  <Copy className="h-3.5 w-3.5" /> {t("duplicate")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    useApp.getState().askConfirm({
                      title: `${t("deleteServerTitle")} “${draft.name}”?`,
                      body: t("deleteServerBody"),
                      danger: true,
                      confirmLabel: t("delete"),
                      action: () =>
                        deleteProfile(draft.id)
                          .then(() => {
                            setDraft(emptyDraft());
                            pushToast({ kind: "info", title: t("profileDeleted") });
                          })
                          .catch((e) => setError(errorMessage(e))),
                    });
                  }}
                  className="text-danger"
                >
                  <Trash2 className="h-3.5 w-3.5" /> {t("delete")}
                </Button>
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={handleTest} disabled={testing || !draft.host}>
            {testing ? <Spinner className="h-3.5 w-3.5" /> : <Plug className="h-3.5 w-3.5" />}
            {t("testConnection")}
          </Button>
          <div className="flex-1" />
          <Button variant="ghost" onClick={close}>
            {t("cancel")}
          </Button>
          <Button variant="subtle" onClick={() => persist().catch(() => undefined)}>
            {t("save")}
          </Button>
          <Button variant="brand" loading={connecting} onClick={handleConnect}>
            <Zap className="h-3.5 w-3.5" />
            {t("connect")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

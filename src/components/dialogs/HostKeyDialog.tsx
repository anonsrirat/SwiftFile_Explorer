import { AlertTriangle, Fingerprint, ShieldCheck, ShieldX } from "lucide-react";
import { useApp } from "@/stores/app";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Button } from "@/components/ui/controls";
import { useT } from "@/lib/useT";

export function HostKeyDialog() {
  const t = useT();
  const prompt = useApp((s) => s.hostKey);
  const respond = useApp((s) => s.respondHostKey);

  return (
    <Dialog open={!!prompt} onOpenChange={() => undefined}>
      <DialogContent size="md" hideClose>
        <DialogHeader
          title={t("hostKeyTitle")}
          description={prompt ? `${prompt.host}:${prompt.port}` : ""}
          icon={
            prompt?.changed ? (
              <AlertTriangle className="h-4 w-4 text-warn" />
            ) : (
              <ShieldCheck className="h-4 w-4" />
            )
          }
        />
        <DialogBody className="space-y-3">
          <p className="text-[12.5px] leading-relaxed text-ink">
            {prompt?.changed ? t("hostKeyChanged") : t("hostKeyFirst")}
          </p>
          {prompt?.changed ? (
            <div className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-[11.5px] leading-snug text-danger">
              <ShieldX className="mt-[1px] h-4 w-4 shrink-0" />
              {t("hostKeyWarning")}
            </div>
          ) : null}

          <div className="rounded-lg border border-line bg-surface-2 px-3 py-2">
            <p className="mb-1 flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-wide text-mute">
              <Fingerprint className="h-3 w-3" /> {t("fingerprint")}
            </p>
            <p className="break-all font-mono text-[11.5px] leading-relaxed text-ink">
              {prompt?.fingerprint}
            </p>
            <p className="mt-1 text-[10px] text-mute">{prompt?.algorithm}</p>
          </div>

          {prompt?.changed && prompt.knownFingerprint ? (
            <div className="rounded-lg border border-line bg-surface-2 px-3 py-2">
              <p className="mb-1 text-[10.5px] font-medium uppercase tracking-wide text-mute">
                {t("previousFingerprint")}
              </p>
              <p className="break-all font-mono text-[11px] leading-relaxed text-dim line-through">
                {prompt.knownFingerprint}
              </p>
            </div>
          ) : null}

          <p className="text-[11px] leading-relaxed text-mute">
            Compare this fingerprint with the one printed by your server administrator
            (<code className="font-mono">ssh-keygen -lf /etc/ssh/ssh_host_*_key.pub</code>). The SSH
            transport is never accepted automatically.
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="danger" onClick={() => respond("reject")}>
            {t("reject")}
          </Button>
          <div className="flex-1" />
          <Button variant="subtle" onClick={() => respond("accept_once")}>
            {t("trustOnce")}
          </Button>
          <Button variant="brand" onClick={() => respond("accept_remember")}>
            <ShieldCheck className="h-3.5 w-3.5" />
            {t("trustRemember")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

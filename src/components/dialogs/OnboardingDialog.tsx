import { KeyRound, ShieldCheck, Terminal } from "lucide-react";
import { useState } from "react";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Button, Switch } from "@/components/ui/controls";
import { useT } from "@/lib/useT";
import { useApp } from "@/stores/app";

/**
 * Shown once, on the first launch. It explains the security model and asks for an
 * explicit decision on the one setting that lets the app run commands on the
 * server — which is now off by default, so copying files is slower but nothing
 * is ever executed on the remote machine unless the user opts in.
 */
export function OnboardingDialog() {
  const t = useT();
  const ready = useApp((s) => s.ready);
  const settings = useApp((s) => s.settings);
  const applySettings = useApp((s) => s.applySettings);
  const [serverCommands, setServerCommands] = useState(settings.allowServerCommands);
  // `ready` matters: before the stored settings arrive the store still holds the
  // defaults, which would flash this dialog on every launch.
  const open = ready && !settings.onboarded;

  const finish = () => {
    void applySettings({ ...settings, onboarded: true, allowServerCommands: serverCommands }).catch(
      () => undefined,
    );
  };

  const points = [
    { icon: ShieldCheck, title: t("onboardingHostKeys"), body: t("onboardingHostKeysBody") },
    { icon: KeyRound, title: t("onboardingSecrets"), body: t("onboardingSecretsBody") },
    { icon: Terminal, title: t("onboardingServerCommands"), body: t("onboardingServerCommandsBody") },
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Esc / overlay dismissal still counts as acknowledging the notice, so
        // the dialog can never trap the user if saving the setting fails.
        if (!next) finish();
      }}
    >
      <DialogContent size="md" hideClose>
        <DialogHeader
          title={t("onboardingTitle")}
          description={t("onboardingLead")}
          icon={<ShieldCheck className="h-4 w-4" />}
        />
        <DialogBody className="space-y-3">
          {points.map(({ icon: Icon, title, body }) => (
            <div key={title} className="flex items-start gap-2.5">
              <Icon className="mt-[2px] h-3.5 w-3.5 shrink-0 text-dim" />
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-ink">{title}</p>
                <p className="text-[11.5px] leading-relaxed text-dim">{body}</p>
              </div>
            </div>
          ))}

          <div className="flex items-start justify-between gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2">
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-ink">{t("onboardingEnableCommands")}</p>
              <p className="text-[11px] leading-snug text-mute">{t("onboardingEnableCommandsHint")}</p>
            </div>
            <Switch checked={serverCommands} onCheckedChange={setServerCommands} />
          </div>
        </DialogBody>
        <DialogFooter>
          <div className="flex-1" />
          <Button variant="brand" onClick={finish}>
            {t("onboardingContinue")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

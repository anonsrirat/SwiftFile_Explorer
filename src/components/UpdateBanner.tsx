import { useState } from "react";
import { ArrowUpCircle, ChevronDown, X } from "lucide-react";
import { useApp } from "@/stores/app";
import { Button } from "@/components/ui/controls";
import { useT } from "@/lib/useT";
import { cn } from "@/lib/utils";

/**
 * Sits directly under the title bar while a newer release is available.
 * All numbers come from the updater plugin; nothing here is simulated.
 */
export function UpdateBanner() {
  const t = useT();
  const update = useApp((s) => s.update);
  const install = useApp((s) => s.installUpdate);
  const dismiss = useApp((s) => s.dismissUpdate);
  const [showNotes, setShowNotes] = useState(false);

  if (!update.available || update.dismissed) return null;
  const info = update.available;
  const percent =
    update.total > 0 ? Math.min(100, Math.round((update.progress / update.total) * 100)) : 0;

  return (
    <div className="flex shrink-0 flex-col gap-1 border-b border-brand/30 bg-brand-soft/60 px-3 py-1.5">
      <div className="flex items-center gap-2">
        <ArrowUpCircle className="h-4 w-4 shrink-0 text-brand" />
        <div className="min-w-0 flex-1 text-[12px] text-ink">
          <span className="font-semibold">SwiftSFTP {info.version}</span>{" "}
          <span className="text-dim">{t("updateAvailable")}</span>
          {info.notes ? (
            <button
              onClick={() => setShowNotes((value) => !value)}
              className="ml-2 inline-flex items-center gap-0.5 text-[11px] text-brand hover:underline"
            >
              {t("whatsNew")}
              <ChevronDown className={cn("h-3 w-3 transition-transform", showNotes && "rotate-180")} />
            </button>
          ) : null}
        </div>
        {update.installing ? (
          <span className="w-[150px] shrink-0 text-right text-[11px] tabular-nums text-dim">
            {update.total > 0 ? `${percent}%` : `${Math.round(update.progress / 1024)} KB`}
          </span>
        ) : (
          <>
            <Button size="sm" variant="brand" onClick={() => install().catch(() => undefined)}>
              {t("updateNow")}
            </Button>
            <button
              onClick={dismiss}
              aria-label={t("dismiss")}
              className="flex h-6 w-6 items-center justify-center rounded text-dim hover:bg-surface-3 hover:text-ink"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
      {update.installing ? (
        <div className="h-1 overflow-hidden rounded-full bg-surface-3">
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-200"
            style={{ width: update.total > 0 ? `${percent}%` : "15%" }}
          />
        </div>
      ) : null}
      {showNotes && info.notes ? (
        <pre className="max-h-[120px] overflow-auto whitespace-pre-wrap rounded-lg bg-surface/70 p-2 font-sans text-[11px] leading-relaxed text-dim">
          {info.notes}
        </pre>
      ) : null}
      {update.error ? <p className="text-[11px] text-danger">{update.error}</p> : null}
    </div>
  );
}

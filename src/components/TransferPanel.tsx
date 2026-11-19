import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  ChevronDown,
  CircleSlash,
  Copy,
  FolderInput,
  History,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { useApp } from "@/stores/app";
import { Badge, Button, Progress, Tooltip } from "@/components/ui/controls";
import { cn, formatBytes, formatEta, formatSpeed } from "@/lib/utils";
import { useT } from "@/lib/useT";
import type { TransferStatus, TransferTask } from "@/lib/types";

function statusTone(status: TransferStatus): "neutral" | "brand" | "ok" | "danger" | "warn" {
  switch (status) {
    case "completed":
      return "ok";
    case "failed":
      return "danger";
    case "paused":
      return "warn";
    case "transferring":
    case "verifying":
    case "connecting":
      return "brand";
    default:
      return "neutral";
  }
}

function kindIcon(kind: TransferTask["kind"]) {
  if (kind === "upload") return <ArrowUpFromLine className="h-3.5 w-3.5 text-brand-strong" />;
  if (kind === "download") return <ArrowDownToLine className="h-3.5 w-3.5 text-accent" />;
  if (kind === "move_remote") return <FolderInput className="h-3.5 w-3.5 text-warn" />;
  return <Copy className="h-3.5 w-3.5 text-dim" />;
}

export function TransferPanel() {
  const t = useT();
  const transfers = useApp((s) => s.transfers);
  const history = useApp((s) => s.history);
  const open = useApp((s) => s.ui.transfersOpen);
  const setUi = useApp((s) => s.setUi);
  const pause = useApp((s) => s.pauseTransfer);
  const resume = useApp((s) => s.resumeTransfer);
  const cancel = useApp((s) => s.cancelTransfer);
  const retry = useApp((s) => s.retryTransfer);
  const retryFailed = useApp((s) => s.retryFailed);
  const clearCompleted = useApp((s) => s.clearCompleted);
  const refreshHistory = useApp((s) => s.refreshHistory);
  const [tab, setTab] = useState<"active" | "history">("active");

  useEffect(() => {
    if (open) refreshHistory().catch(() => undefined);
  }, [open, refreshHistory]);

  const active = useMemo(
    () => transfers.filter((x) => !["completed", "failed", "cancelled"].includes(x.status)),
    [transfers],
  );
  const finished = useMemo(
    () => transfers.filter((x) => ["completed", "failed", "cancelled"].includes(x.status)),
    [transfers],
  );

  if (!open) return null;

  return (
    <div className="flex h-[228px] shrink-0 flex-col border-t border-line bg-surface">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-2">
        <button
          onClick={() => setTab("active")}
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-md px-2 text-[11.5px] transition-colors",
            tab === "active" ? "bg-surface-3 text-ink" : "text-dim hover:text-ink",
          )}
        >
          {t("activeTransfers")}
          <span className="rounded bg-surface-4 px-1 text-[10px] tabular-nums">{active.length}</span>
        </button>
        <button
          onClick={() => setTab("history")}
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-md px-2 text-[11.5px] transition-colors",
            tab === "history" ? "bg-surface-3 text-ink" : "text-dim hover:text-ink",
          )}
        >
          <History className="h-3.5 w-3.5" />
          {t("transferHistory")}
        </button>
        <div className="flex-1" />
        {tab === "active" ? (
          <>
            <Button size="sm" variant="ghost" onClick={retryFailed} disabled={!transfers.some((x) => x.status === "failed")}>
              <RotateCcw className="h-3.5 w-3.5" /> {t("retryFailed")}
            </Button>
            <Button size="sm" variant="ghost" onClick={clearCompleted} disabled={finished.length === 0}>
              <Trash2 className="h-3.5 w-3.5" /> {t("clearCompleted")}
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              import("@/lib/api").then(({ api }) =>
                api.transferClearHistory().then(() => useApp.getState().refreshHistory()),
              );
            }}
            disabled={history.length === 0}
          >
            <Trash2 className="h-3.5 w-3.5" /> {t("clearHistory")}
          </Button>
        )}
        <Tooltip label={t("close")}>
          <button
            onClick={() => setUi({ transfersOpen: false })}
            className="flex h-7 w-7 items-center justify-center rounded-md text-dim hover:bg-surface-3 hover:text-ink"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </Tooltip>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
        {tab === "active" ? (
          transfers.length === 0 ? (
            <div className="flex h-full items-center justify-center text-[12px] text-mute">
              {t("noTransfers")}
            </div>
          ) : (
            <div className="space-y-1">
              {[...transfers].reverse().map((task) => (
                <div
                  key={task.id}
                  className="rounded-lg border border-line bg-surface-2/60 px-2 py-1.5"
                >
                  <div className="flex items-center gap-2">
                    {kindIcon(task.kind)}
                    <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink">{task.name}</span>
                    <Badge tone={statusTone(task.status)}>{t(task.status)}</Badge>
                    <button
                      onClick={() =>
                        task.status === "paused"
                          ? resume(task.id)
                          : task.status === "failed" || task.status === "completed" || task.status === "cancelled"
                            ? retry(task.id)
                            : pause(task.id)
                      }
                      disabled={!task.canPause && task.status === "transferring"}
                      className="flex h-6 w-6 items-center justify-center rounded-md text-dim hover:bg-surface-3 hover:text-ink disabled:opacity-30"
                      title={task.status === "paused" ? t("resume") : t("pause")}
                    >
                      {task.status === "paused" ? (
                        <Play className="h-3.5 w-3.5" />
                      ) : task.status === "failed" || task.status === "completed" || task.status === "cancelled" ? (
                        <RotateCcw className="h-3.5 w-3.5" />
                      ) : (
                        <Pause className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <button
                      onClick={() => cancel(task.id)}
                      className="flex h-6 w-6 items-center justify-center rounded-md text-dim hover:bg-danger-soft hover:text-danger"
                      title={t("cancel")}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <Progress
                      value={task.size > 0 ? (task.transferred / task.size) * 100 : task.status === "completed" ? 100 : 0}
                      indeterminate={["connecting", "verifying"].includes(task.status)}
                      tone={
                        task.status === "failed"
                          ? "danger"
                          : task.status === "completed"
                            ? "ok"
                            : task.status === "paused"
                              ? "warn"
                              : "brand"
                      }
                      className="flex-1"
                    />
                    <span className="w-[134px] shrink-0 text-right font-mono text-[10px] tabular-nums text-dim">
                      {formatBytes(task.transferred)} / {formatBytes(task.size)}
                    </span>
                    <span className="w-[74px] shrink-0 text-right font-mono text-[10px] tabular-nums text-dim">
                      {formatSpeed(task.speedBps)}
                    </span>
                    <span className="w-[54px] shrink-0 text-right font-mono text-[10px] tabular-nums text-mute">
                      {formatEta(Math.max(0, task.size - task.transferred), task.speedBps)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[10px] text-mute">
                    <span className="truncate" title={task.source}>
                      {task.source.length > 46 ? `…${task.source.slice(-45)}` : task.source}
                    </span>
                    <span>→</span>
                    <span className="truncate" title={task.dest}>
                      {task.dest.length > 46 ? `…${task.dest.slice(-45)}` : task.dest}
                    </span>
                    {task.method ? <span className="ml-auto shrink-0 text-dim">· {task.method}</span> : null}
                  </div>
                  {task.error ? (
                    <p className="mt-0.5 flex items-start gap-1 text-[10.5px] leading-snug text-danger">
                      <CircleSlash className="mt-[1px] h-3 w-3 shrink-0" />
                      {task.error}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          )
        ) : history.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[12px] text-mute">
            {t("transferHistory")} —
          </div>
        ) : (
          <div className="space-y-0.5">
            {history.map((entry) => (
              <div key={entry.id} className="flex items-center gap-2 rounded px-2 py-1 text-[11px] hover:bg-surface-2">
                <CheckCircle2
                  className={cn(
                    "h-3.5 w-3.5 shrink-0",
                    entry.status === "completed"
                      ? "text-ok"
                      : entry.status === "cancelled"
                        ? "text-mute"
                        : "text-danger",
                  )}
                />
                <span className="min-w-0 flex-1 truncate text-ink/90">{entry.name}</span>
                <span className="w-[80px] shrink-0 text-right text-dim">{formatBytes(entry.size)}</span>
                <span className="w-[130px] shrink-0 truncate text-[10px] text-mute">{entry.method ?? entry.kind}</span>
                <span className="w-[120px] shrink-0 text-right text-[10px] text-mute">
                  {new Date(entry.finishedAt).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

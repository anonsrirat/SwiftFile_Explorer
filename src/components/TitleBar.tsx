import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, PanelBottom, Settings, Square, X, Copy } from "lucide-react";
import { useApp } from "@/stores/app";
import { Tooltip } from "@/components/ui/controls";
import { useT } from "@/lib/useT";
import { cn } from "@/lib/utils";
import logoUrl from "@/assets/logo.png";

export function TitleBar() {
  const t = useT();
  const [maximized, setMaximized] = useState(false);
  const transfers = useApp((s) => s.transfers);
  const toggleTransfers = useApp((s) => s.toggleTransfers);
  const setUi = useApp((s) => s.setUi);
  const transfersOpen = useApp((s) => s.ui.transfersOpen);

  const activeCount = transfers.filter((t) =>
    ["queued", "connecting", "transferring", "verifying", "paused"].includes(t.status),
  ).length;

  useEffect(() => {
    const win = getCurrentWindow();
    let disposed = false;
    win.isMaximized().then((value) => !disposed && setMaximized(value)).catch(() => undefined);
    const unlisten = win.onResized(() => {
      win.isMaximized().then((value) => !disposed && setMaximized(value)).catch(() => undefined);
    });
    return () => {
      disposed = true;
      unlisten.then((fn) => fn()).catch(() => undefined);
    };
  }, []);

  const win = getCurrentWindow();

  return (
    <div
      data-tauri-drag-region
      className="relative flex h-9 shrink-0 select-none items-center justify-between border-b border-line bg-surface pl-2 pr-1"
    >
      <div data-tauri-drag-region className="flex min-w-0 items-center gap-2">
        <img src={logoUrl} alt="" className="ml-1 h-[18px] w-[18px] rounded-[5px]" draggable={false} />
        <span
          data-tauri-drag-region
          className="text-[12px] font-semibold tracking-tight text-ink/90"
        >
          SwiftSFTP <span className="font-normal text-dim">Explorer</span>
        </span>
      </div>

      <div className="title-no-drag flex items-center gap-0.5">
        <Tooltip label={t("transfersPanel")}>
          <button
            onClick={toggleTransfers}
            className={cn(
              "relative flex h-7 items-center gap-1.5 rounded-md px-2 text-[11.5px] text-dim transition-colors hover:bg-surface-3 hover:text-ink",
              transfersOpen && "bg-surface-3 text-ink",
            )}
          >
            <PanelBottom className="h-3.5 w-3.5" />
            {activeCount > 0 ? (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold text-white">
                {activeCount}
              </span>
            ) : null}
          </button>
        </Tooltip>
        <Tooltip label={t("settingsCtrl")}>
          <button
            onClick={() => setUi({ settingsOpen: true })}
            className="flex h-7 w-7 items-center justify-center rounded-md text-dim transition-colors hover:bg-surface-3 hover:text-ink"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
        <div className="mx-1 h-4 w-px bg-line" />
        <button
          onClick={() => win.minimize()}
          className="flex h-7 w-10 items-center justify-center rounded-md text-dim transition-colors hover:bg-surface-3 hover:text-ink"
          aria-label={t("minimize")}
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => win.toggleMaximize()}
          className="flex h-7 w-10 items-center justify-center rounded-md text-dim transition-colors hover:bg-surface-3 hover:text-ink"
          aria-label={maximized ? t("restore") : t("maximize")}
        >
          {maximized ? <Copy className="h-3 w-3 -scale-x-100" /> : <Square className="h-3 w-3" />}
        </button>
        <button
          onClick={() => win.close()}
          className="flex h-7 w-10 items-center justify-center rounded-md text-dim transition-colors hover:bg-[#e81123] hover:text-white"
          aria-label={t("close")}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

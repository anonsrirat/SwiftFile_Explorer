import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  size = "md",
  hideClose,
  onEscapeKeyDown,
}: {
  className?: string;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "full" | "editor";
  hideClose?: boolean;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
}) {
  const widths: Record<string, string> = {
    sm: "max-w-[400px]",
    md: "max-w-[540px]",
    lg: "max-w-[720px]",
    xl: "max-w-[940px]",
    full: "max-w-[min(1200px,94vw)]",
    editor: "max-w-[min(1180px,94vw)] h-[82vh]",
  };
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] animate-fade" />
      <DialogPrimitive.Content
        onEscapeKeyDown={onEscapeKeyDown}
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2",
          "rounded-2xl border border-line-strong bg-surface shadow-[var(--shadow)] outline-none",
          "flex flex-col overflow-hidden animate-panel",
          widths[size],
          className,
        )}
      >
        {children}
        {hideClose ? null : (
          <DialogPrimitive.Close
            className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-lg text-dim transition-colors hover:bg-surface-3 hover:text-ink"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({
  title,
  description,
  icon,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start gap-3 border-b border-line px-5 py-4 pr-12", className)}>
      {icon ? (
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-brand-soft text-brand">
          {icon}
        </div>
      ) : null}
      <div className="min-w-0">
        <DialogPrimitive.Title className="truncate text-[14.5px] font-semibold text-ink">
          {title}
        </DialogPrimitive.Title>
        {description ? (
          <DialogPrimitive.Description className="mt-0.5 text-[12px] leading-snug text-dim">
            {description}
          </DialogPrimitive.Description>
        ) : (
          <DialogPrimitive.Description className="sr-only">{String(title)}</DialogPrimitive.Description>
        )}
      </div>
    </div>
  );
}

export function DialogBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-4", className)}>{children}</div>;
}

export function DialogFooter({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-center justify-end gap-2 border-t border-line bg-surface-2/60 px-5 py-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

import * as React from "react";
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import * as ContextPrimitive from "@radix-ui/react-context-menu";
import { cn } from "@/lib/utils";

const contentClass =
  "z-[80] min-w-[194px] overflow-hidden rounded-xl border border-line-strong bg-surface-2/98 p-1 shadow-[var(--shadow)] backdrop-blur-md animate-fade";
const itemClass =
  "relative flex cursor-default select-none items-center gap-2 rounded-lg px-2 py-[6px] text-[12.5px] text-ink outline-none transition-colors data-[highlighted]:bg-brand data-[highlighted]:text-white data-[disabled]:pointer-events-none data-[disabled]:opacity-40";
const labelClass = "px-2 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-mute";

export function MenuItem({
  icon,
  children,
  shortcut,
  danger,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Item> & {
  icon?: React.ReactNode;
  shortcut?: string;
  danger?: boolean;
}) {
  return (
    <DropdownPrimitive.Item
      className={cn(itemClass, danger && "text-danger data-[highlighted]:bg-danger data-[highlighted]:text-white")}
      {...props}
    >
      {icon ? <span className="flex h-4 w-4 items-center justify-center">{icon}</span> : null}
      <span className="flex-1 truncate">{children}</span>
      {shortcut ? <span className="ml-3 text-[10.5px] text-mute group-data-[highlighted]/item:text-white/80">{shortcut}</span> : null}
    </DropdownPrimitive.Item>
  );
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return <DropdownPrimitive.Label className={labelClass}>{children}</DropdownPrimitive.Label>;
}

export function MenuSeparator() {
  return <DropdownPrimitive.Separator className="my-1 h-px bg-line" />;
}

export function DropdownMenu({
  trigger,
  children,
  align = "start",
  open,
  onOpenChange,
}: {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: "start" | "center" | "end";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <DropdownPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DropdownPrimitive.Trigger asChild>{trigger}</DropdownPrimitive.Trigger>
      <DropdownPrimitive.Portal>
        <DropdownPrimitive.Content align={align} sideOffset={6} className={contentClass}>
          {children}
        </DropdownPrimitive.Content>
      </DropdownPrimitive.Portal>
    </DropdownPrimitive.Root>
  );
}

export function ContextMenu({
  children,
  items,
}: {
  children: React.ReactNode;
  items: React.ReactNode;
}) {
  return (
    <ContextPrimitive.Root>
      <ContextPrimitive.Trigger asChild>{children}</ContextPrimitive.Trigger>
      <ContextPrimitive.Portal>
        <ContextPrimitive.Content className={contentClass}>{items}</ContextPrimitive.Content>
      </ContextPrimitive.Portal>
    </ContextPrimitive.Root>
  );
}

export function ContextItem({
  icon,
  children,
  shortcut,
  danger,
  ...props
}: React.ComponentPropsWithoutRef<typeof ContextPrimitive.Item> & {
  icon?: React.ReactNode;
  shortcut?: string;
  danger?: boolean;
}) {
  return (
    <ContextPrimitive.Item
      className={cn(itemClass, danger && "text-danger data-[highlighted]:bg-danger data-[highlighted]:text-white")}
      {...props}
    >
      {icon ? <span className="flex h-4 w-4 items-center justify-center">{icon}</span> : null}
      <span className="flex-1 truncate">{children}</span>
      {shortcut ? <span className="ml-3 text-[10.5px] text-mute">{shortcut}</span> : null}
    </ContextPrimitive.Item>
  );
}

export function ContextLabel({ children }: { children: React.ReactNode }) {
  return <ContextPrimitive.Label className={labelClass}>{children}</ContextPrimitive.Label>;
}

export function ContextSeparator() {
  return <ContextPrimitive.Separator className="my-1 h-px bg-line" />;
}

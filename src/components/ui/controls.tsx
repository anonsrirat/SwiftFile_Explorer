import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type ButtonVariant = "default" | "ghost" | "subtle" | "outline" | "danger" | "brand";
type ButtonSize = "sm" | "md" | "icon" | "icon-sm" | "lg";

const variants: Record<ButtonVariant, string> = {
  default:
    "bg-surface-3 text-ink hover:bg-surface-4 border border-line-strong/70 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]",
  brand:
    "bg-brand text-white hover:bg-brand-strong border border-brand/40 shadow-[0_6px_18px_-8px_rgba(111,108,248,0.9)]",
  ghost: "bg-transparent text-dim hover:bg-surface-3 hover:text-ink border border-transparent",
  subtle: "bg-surface-2 text-ink hover:bg-surface-3 border border-line/80",
  outline: "bg-transparent text-ink border border-line-strong hover:bg-surface-3",
  danger: "bg-danger/12 text-danger hover:bg-danger/20 border border-danger/30",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-[12px] rounded-lg gap-1.5",
  md: "h-8 px-3 text-[13px] rounded-[10px] gap-2",
  lg: "h-10 px-4 text-sm rounded-xl gap-2",
  icon: "h-8 w-8 rounded-[10px] justify-center",
  "icon-sm": "h-7 w-7 rounded-lg justify-center",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "default", size = "md", loading, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex select-none items-center font-medium transition-colors duration-100",
        "disabled:cursor-not-allowed disabled:opacity-45",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
      {children}
    </button>
  );
});

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "h-8 w-full rounded-[10px] border border-line bg-surface-2 px-2.5 text-[13px] text-ink",
          "placeholder:text-mute outline-none transition-colors",
          "focus:border-brand/70 focus:bg-surface focus:ring-2 focus:ring-brand/20",
          "disabled:opacity-50",
          className,
        )}
        {...props}
      />
    );
  },
);

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "w-full rounded-[10px] border border-line bg-surface-2 px-2.5 py-2 text-[13px] text-ink",
        "placeholder:text-mute outline-none focus:border-brand/70 focus:ring-2 focus:ring-brand/20",
        "resize-none",
        className,
      )}
      {...props}
    />
  );
});

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1 block text-[11.5px] font-medium text-dim", className)} {...props} />;
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      {label ? <Label>{label}</Label> : null}
      {children}
      {hint ? <p className="mt-1 text-[11px] leading-snug text-mute">{hint}</p> : null}
    </div>
  );
}

export function NativeSelect({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-8 w-full appearance-none rounded-[10px] border border-line bg-surface-2 px-2.5 text-[13px] text-ink",
        "bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2020%2020%22%20fill%3D%22%2397a1b2%22%3E%3Cpath%20d%3D%22M5.5%207.5l4.5%205%204.5-5z%22%2F%3E%3C%2Fsvg%3E')] bg-[length:18px_18px] bg-[right_4px_center] bg-no-repeat pr-7",
        "outline-none focus:border-brand/70 focus:ring-2 focus:ring-brand/20",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(function Switch({ className, ...props }, ref) {
  return (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        "relative inline-flex h-[19px] w-[34px] shrink-0 cursor-pointer items-center rounded-full",
        "border border-line-strong/60 transition-colors data-[state=checked]:border-brand data-[state=checked]:bg-brand",
        "bg-surface-4",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block h-[13px] w-[13px] rounded-full bg-white shadow",
          "transition-transform data-[state=unchecked]:translate-x-[3px] data-[state=checked]:translate-x-[17px]",
        )}
      />
    </SwitchPrimitive.Root>
  );
});

export const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(function Checkbox({ className, ...props }, ref) {
  return (
    <CheckboxPrimitive.Root
      ref={ref}
      className={cn(
        "flex h-4 w-4 items-center justify-center rounded-[5px] border border-line-strong bg-surface-2",
        "data-[state=checked]:border-brand data-[state=checked]:bg-brand",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="text-white">
        <Check className="h-3 w-3" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
});

export function Progress({
  value,
  indeterminate,
  className,
  tone = "brand",
}: {
  value: number;
  indeterminate?: boolean;
  className?: string;
  tone?: "brand" | "ok" | "danger" | "warn";
}) {
  const toneClass =
    tone === "ok" ? "bg-ok" : tone === "danger" ? "bg-danger" : tone === "warn" ? "bg-warn" : "bg-brand";
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-4/80", className)}>
      <div
        className={cn("h-full rounded-full transition-[width] duration-200", toneClass, indeterminate && "animate-pulse-soft")}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "brand" | "ok" | "danger" | "warn";
  className?: string;
}) {
  const tones = {
    neutral: "bg-surface-3 text-dim border-line",
    brand: "bg-brand-soft text-brand-strong border-brand/30",
    ok: "bg-ok/10 text-ok border-ok/30",
    danger: "bg-danger-soft text-danger border-danger/30",
    warn: "bg-warn/10 text-warn border-warn/30",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-[1px] text-[10.5px] font-medium uppercase tracking-wide",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-4 w-4 animate-spin text-dim", className)} />;
}

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={450} skipDelayDuration={250}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

export function Tooltip({
  label,
  children,
  side = "bottom",
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-[100] max-w-[280px] rounded-lg border border-line-strong bg-surface-3 px-2 py-1 text-[11.5px] text-ink shadow-xl animate-fade"
        >
          {label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export function Separator({ className }: { className?: string }) {
  return <div className={cn("h-px w-full bg-line", className)} />;
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-line-strong bg-surface-3 px-1.5 py-0.5 font-mono text-[10.5px] text-dim">
      {children}
    </kbd>
  );
}

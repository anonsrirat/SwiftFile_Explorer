import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number, fractionDigits = 1): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  if (exponent === 0) return `${bytes} B`;
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 100 ? 0 : fractionDigits)} ${units[exponent]}`;
}

export function formatSpeed(bytesPerSecond: number): string {
  if (!bytesPerSecond || bytesPerSecond < 1) return "—";
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 1) return "<1s";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function formatEta(remainingBytes: number, bytesPerSecond: number): string {
  if (!bytesPerSecond || bytesPerSecond <= 0) return "—";
  return formatDuration(remainingBytes / bytesPerSecond);
}

export function formatDate(millis: number | null | undefined): string {
  if (!millis) return "—";
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function modeToString(mode: number | null): string {
  if (mode === null || mode === undefined) return "—";
  const bits = mode & 0o777;
  let out = "";
  for (const shift of [6, 3, 0]) {
    const chunk = (bits >> shift) & 0o7;
    out += chunk & 0o4 ? "r" : "-";
    out += chunk & 0o2 ? "w" : "-";
    out += chunk & 0o1 ? "x" : "-";
  }
  return out;
}

export function permissionsToBitmask(perms: {
  ownerRead: boolean;
  ownerWrite: boolean;
  ownerExec: boolean;
  groupRead: boolean;
  groupWrite: boolean;
  groupExec: boolean;
  otherRead: boolean;
  otherWrite: boolean;
  otherExec: boolean;
}): number {
  const bit = (on: boolean, value: number) => (on ? value : 0);
  return (
    bit(perms.ownerRead, 0o400) +
    bit(perms.ownerWrite, 0o200) +
    bit(perms.ownerExec, 0o100) +
    bit(perms.groupRead, 0o040) +
    bit(perms.groupWrite, 0o020) +
    bit(perms.groupExec, 0o010) +
    bit(perms.otherRead, 0o004) +
    bit(perms.otherWrite, 0o002) +
    bit(perms.otherExec, 0o001)
  );
}

export function bitmaskToPermissions(mode: number) {
  const m = mode & 0o777;
  return {
    ownerRead: (m & 0o400) !== 0,
    ownerWrite: (m & 0o200) !== 0,
    ownerExec: (m & 0o100) !== 0,
    groupRead: (m & 0o040) !== 0,
    groupWrite: (m & 0o020) !== 0,
    groupExec: (m & 0o010) !== 0,
    otherRead: (m & 0o004) !== 0,
    otherWrite: (m & 0o002) !== 0,
    otherExec: (m & 0o001) !== 0,
  };
}

export function fileExtension(name: string): string {
  const idx = name.lastIndexOf(".");
  if (idx <= 0 || idx === name.length - 1) return "";
  return name.slice(idx + 1).toLowerCase();
}

export type FileKind = "folder" | "text" | "code" | "image" | "archive" | "config" | "file";

const TEXT_EXT = new Set([
  "txt", "log", "md", "yml", "yaml", "json", "toml", "xml", "properties", "conf", "ini", "sh",
  "bat", "ps1", "cfg", "env", "csv", "lock", "gitignore", "service", "java", "rs", "ts", "tsx",
  "js", "jsx", "css", "html", "sql", "py", "rb", "php", "lua", "go", "c", "h", "cpp",
]);
const CONFIG_EXT = new Set(["yml", "yaml", "json", "toml", "xml", "properties", "conf", "ini", "cfg", "env"]);
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp"]);
const ARCHIVE_EXT = new Set(["zip", "tar", "gz", "tgz", "rar", "7z", "xz", "bz2", "jar"]);

export function classifyFile(entry: { name: string; isDir: boolean }): FileKind {
  if (entry.isDir) return "folder";
  const ext = fileExtension(entry.name);
  if (CONFIG_EXT.has(ext)) return "config";
  if (IMAGE_EXT.has(ext)) return "image";
  if (ARCHIVE_EXT.has(ext)) return "archive";
  if (TEXT_EXT.has(ext)) return "text";
  return "file";
}

export function isTextFile(name: string): boolean {
  return TEXT_EXT.has(fileExtension(name)) || !name.includes(".");
}

export function shortPath(path: string, max = 42): string {
  if (path.length <= max) return path;
  const parts = path.split("/");
  return `…/${parts.slice(-2).join("/")}`;
}

export function isMacLike(): boolean {
  return false;
}

export function throttle<T extends (...args: never[]) => void>(fn: T, ms: number): T {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Args<T> | null = null;
  return function inner(this: unknown, ...args: Args<T>) {
    const now = Date.now();
    const remaining = ms - (now - last);
    pending = args;
    if (remaining <= 0) {
      last = now;
      fn.apply(this, args as never);
      pending = null;
    } else if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        last = Date.now();
        if (pending) {
          fn.apply(this, pending as never);
          pending = null;
        }
      }, remaining);
    }
  } as T;
}

type Args<T> = T extends (...args: infer A) => void ? A : never;

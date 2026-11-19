export function normalizeRemotePath(path: string): string {
  if (!path) return ".";
  const absolute = path.startsWith("/");
  const parts: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (parts.length && parts[parts.length - 1] !== "..") parts.pop();
      else if (!absolute) parts.push("..");
    } else {
      parts.push(segment);
    }
  }
  const joined = parts.join("/");
  if (absolute) return `/${joined}`;
  return joined || ".";
}

export function joinRemotePath(base: string, name: string): string {
  if (name.startsWith("/")) return normalizeRemotePath(name);
  if (!base || base === ".") return normalizeRemotePath(name);
  return normalizeRemotePath(`${base.replace(/\/+$/, "")}/${name}`);
}

export function parentRemotePath(path: string): string {
  const normalized = normalizeRemotePath(path);
  if (normalized === "/" || normalized === ".") return normalized;
  const idx = normalized.lastIndexOf("/");
  if (idx === 0) return "/";
  if (idx < 0) return ".";
  return normalized.slice(0, idx);
}

export function remoteFileName(path: string): string {
  const normalized = normalizeRemotePath(path);
  if (normalized === "/") return "/";
  const idx = normalized.lastIndexOf("/");
  return idx < 0 ? normalized : normalized.slice(idx + 1);
}

export interface Crumb {
  label: string;
  path: string;
}

export function breadcrumbs(path: string): Crumb[] {
  const normalized = normalizeRemotePath(path);
  if (normalized === "/") return [{ label: "/", path: "/" }];
  const absolute = normalized.startsWith("/");
  const parts = normalized.split("/").filter(Boolean);
  const crumbs: Crumb[] = [];
  if (absolute) crumbs.push({ label: "/", path: "/" });
  let current = absolute ? "" : "";
  parts.forEach((part, index) => {
    current = absolute ? `${current}/${part}` : index === 0 ? part : `${current}/${part}`;
    crumbs.push({ label: part, path: current });
  });
  return crumbs;
}

export function isSubPath(child: string, parent: string): boolean {
  const c = normalizeRemotePath(child);
  const p = normalizeRemotePath(parent);
  if (p === "/") return c !== "/";
  return c === p || c.startsWith(`${p}/`);
}

export function uniqueName(existing: Set<string>, name: string): string {
  if (!existing.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let i = 2; i < 10_000; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${stem}-${Date.now()}${ext}`;
}

export function sftpDisplayUrl(server: string, path: string): string {
  return `sftp://${server}${normalizeRemotePath(path)}`;
}

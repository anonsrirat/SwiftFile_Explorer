export type AuthMethod = "password" | "key" | "agent";
export type ThemeMode = "system" | "dark" | "light";
export type ViewMode = "details" | "grid" | "list";
export type SortKey = "name" | "size" | "modified" | "type";

export interface Profile {
  id: string;
  name: string;
  groupName: string;
  /** `#rrggbb` accent; `null` means "use the group colour". */
  color: string | null;
  host: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  keyPath: string | null;
  defaultRemoteDir: string | null;
  timeoutSecs: number;
  keepaliveSecs: number;
  autoConnect: boolean;
  lastDir: string | null;
  hasPassword: boolean;
  hasPassphrase: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ServerGroup {
  name: string;
  color: string;
  position: number;
}

export interface UpdateInfo {
  version: string;
  notes: string | null;
  date: string | null;
}

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  size: number;
  modified: number | null;
  mode: number | null;
  owner: number | null;
  group: number | null;
  hidden: boolean;
}

export interface ListResult {
  path: string;
  parent: string;
  home: string;
  entries: FileEntry[];
  atRoot: boolean;
}

export interface FileStat {
  path: string;
  name: string;
  isDir: boolean;
  isSymlink: boolean;
  size: number;
  modified: number | null;
  mode: number | null;
  owner: number | null;
  group: number | null;
}

export interface TextFile {
  path: string;
  content: string;
  encoding: string;
  size: number;
  modified: number | null;
  readOnly: boolean;
}

export type TransferStatus =
  | "queued"
  | "connecting"
  | "transferring"
  | "paused"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled";

export interface TransferTask {
  id: string;
  kind: "upload" | "download" | "copy_remote" | "move_remote";
  name: string;
  source: string;
  dest: string;
  profileId: string;
  destProfileId: string | null;
  size: number;
  transferred: number;
  speedBps: number;
  status: TransferStatus;
  error: string | null;
  method: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  attempt: number;
  canPause: boolean;
  bytesPerSecondLimit: number;
}

export interface TransferSpec {
  kind: string;
  profileId: string;
  destProfileId?: string | null;
  localPath?: string | null;
  remotePath: string;
  destRemotePath?: string | null;
  overwrite?: "replace" | "skip" | "rename";
  password?: string | null;
  size?: number | null;
}

export interface Settings {
  theme: ThemeMode;
  language: "en" | "th";
  startBehavior: "restore" | "home" | "welcome";
  restoreTabs: boolean;
  defaultLocalFolder: string | null;
  viewMode: ViewMode;
  compact: boolean;
  animations: boolean;
  showHidden: boolean;
  maxConcurrentTransfers: number;
  bufferSizeKb: number;
  speedLimitKbps: number;
  retryCount: number;
  timeoutSecs: number;
  keepaliveSecs: number;
  allowServerCommands: boolean;
  verifyChecksums: boolean;
  confirmDelete: boolean;
  logLevel: string;
  /** False until the first-run security notice has been acknowledged. */
  onboarded: boolean;
}

export interface HostKeyPrompt {
  requestId: string;
  host: string;
  port: number;
  algorithm: string;
  fingerprint: string;
  knownFingerprint: string | null;
  changed: boolean;
}

export interface KnownHost {
  id: number;
  host: string;
  port: number;
  algorithm: string;
  fingerprint: string;
  keyB64: string;
  acceptedAt: number;
}

export interface Favorite {
  id: string;
  profileId: string;
  path: string;
  label: string;
  createdAt: number;
}

export interface RecentEntry {
  profileId: string;
  path: string;
  label: string;
  visitedAt: number;
}

export interface HistoryEntry {
  id: string;
  name: string;
  kind: string;
  source: string;
  dest: string;
  size: number;
  status: string;
  method: string | null;
  error: string | null;
  finishedAt: number;
}

export interface SearchOptions {
  query: string;
  extensions?: string[];
  minSize?: number | null;
  maxSize?: number | null;
  modifiedAfter?: number | null;
  modifiedBefore?: number | null;
  recursive?: boolean;
  includeHidden?: boolean;
  maxResults?: number;
}

export interface SearchResult {
  searchId: string;
  entries: FileEntry[];
  scanned: number;
  truncated: boolean;
  cancelled: boolean;
}

export interface AppInfo {
  version: string;
  os: string;
  arch: string;
  dataDir: string;
  logFile: string;
  dbFile: string;
  webview2: string | null;
}

export interface TestResult {
  ok: boolean;
  message: string;
  latencyMs: number;
  method: string | null;
  reused: boolean;
  connected: boolean;
}

export interface AppError {
  code: string;
  message: string;
}

export interface ConnectResponse {
  profileId: string;
  sessionId: string;
  home: string;
  reused: boolean;
}

export interface OpenSession {
  sessionId: string;
  home: string;
}

export interface AppPaths {
  dataDir: string;
  logDir: string;
  dbPath: string;
  logFile: string;
}

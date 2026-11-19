import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AppInfo,
  AppPaths,
  ConnectResponse,
  Favorite,
  FileStat,
  HistoryEntry,
  HostKeyPrompt,
  KnownHost,
  ListResult,
  OpenSession,
  Profile,
  RecentEntry,
  ServerGroup,
  SearchOptions,
  SearchResult,
  Settings,
  TestResult,
  TextFile,
  TransferSpec,
  TransferTask,
} from "./types";

export interface SaveProfileArgs {
  profile: Profile;
  password?: string | null;
  passphrase?: string | null;
  clearPassword?: boolean;
  clearPassphrase?: boolean;
}

export const api = {
  appInfo: () => invoke<AppInfo>("app_info"),
  appPaths: () => invoke<AppPaths>("app_paths"),

  settingsGet: () => invoke<Settings>("settings_get"),
  settingsSet: (settings: Settings) => invoke<Settings>("settings_set", { settings }),
  settingsReset: () => invoke<Settings>("settings_reset"),
  settingsExport: (path: string) => invoke<void>("settings_export", { path }),
  settingsImport: (path: string) => invoke<Settings>("settings_import", { path }),

  profiles: () => invoke<Profile[]>("profiles_list"),
  groups: () => invoke<ServerGroup[]>("groups_list"),
  saveGroup: (group: ServerGroup, previous?: string | null) =>
    invoke<ServerGroup[]>("group_save", { args: { group, previous: previous ?? null } }),
  deleteGroup: (name: string) => invoke<ServerGroup[]>("group_delete", { name }),
  saveProfile: (args: SaveProfileArgs) => invoke<Profile>("profile_save", { args }),
  deleteProfile: (id: string) => invoke<void>("profile_delete", { id }),
  duplicateProfile: (id: string) => invoke<Profile>("profile_duplicate", { id }),
  testProfile: (profile: Profile, password?: string | null) =>
    invoke<TestResult>("profile_test", { profile, password: password ?? null }),
  touchProfile: (profileId: string, dir: string) =>
    invoke<void>("profile_touch", { profileId, dir }),

  connect: (profileId: string, password?: string | null) =>
    invoke<ConnectResponse>("connect", { profileId, password: password ?? null }),
  disconnect: (profileId: string) => invoke<void>("disconnect", { profileId }),
  connectionState: (profileId: string) =>
    invoke<{ profileId: string; connected: boolean }>("connection_state", { profileId }),

  respondHostKey: (requestId: string, decision: "accept_once" | "accept_remember" | "reject") =>
    invoke<void>("host_key_respond", { requestId, decision }),
  knownHosts: () => invoke<KnownHost[]>("known_hosts_list"),
  deleteKnownHost: (id: number) => invoke<void>("known_host_delete", { id }),
  clearKnownHosts: () => invoke<void>("trusted_hosts_clear"),

  openSession: (profileId: string, password?: string | null) =>
    invoke<OpenSession>("open_session", { profileId, password: password ?? null }),
  closeSession: (sessionId: string) => invoke<void>("close_session", { sessionId }),

  listDir: (sessionId: string, path: string) =>
    invoke<ListResult>("list_dir", { sessionId, path }),
  statPath: (sessionId: string, path: string) =>
    invoke<FileStat>("stat_path", { sessionId, path }),
  mkdir: (sessionId: string, parent: string, name: string) =>
    invoke<string>("mkdir", { sessionId, parent, name }),
  createFile: (sessionId: string, parent: string, name: string) =>
    invoke<string>("create_file", { sessionId, parent, name }),
  renamePath: (sessionId: string, path: string, newName: string) =>
    invoke<string>("rename_path", { sessionId, path, newName }),
  deletePaths: (sessionId: string, paths: string[], recursive: boolean) =>
    invoke<number>("delete_paths", { sessionId, paths, recursive }),
  chmod: (sessionId: string, path: string, mode: number) =>
    invoke<void>("chmod_path", { sessionId, path, mode }),

  readText: (sessionId: string, path: string) =>
    invoke<TextFile>("read_text_file", { sessionId, path }),
  writeText: (
    sessionId: string,
    path: string,
    content: string,
    expectedModified: number | null,
    expectedSize: number | null,
    force: boolean,
  ) =>
    invoke<number | null>("write_text_file", {
      sessionId,
      path,
      content,
      expectedModified,
      expectedSize,
      force,
    }),

  search: (sessionId: string, root: string, options: SearchOptions, searchId?: string | null) =>
    invoke<SearchResult>("search_files", { sessionId, root, options, searchId: searchId ?? null }),
  cancelSearch: (searchId: string) => invoke<boolean>("cancel_search", { searchId }),

  enqueueUpload: (
    sessionId: string,
    localPaths: string[],
    remoteDir: string,
    overwrite: "replace" | "skip" | "rename",
    password?: string | null,
  ) =>
    invoke<number>("enqueue_upload", {
      sessionId,
      localPaths,
      remoteDir,
      overwrite,
      password: password ?? null,
    }),
  enqueueDownload: (
    sessionId: string,
    remotePaths: string[],
    localDir: string,
    overwrite: "replace" | "skip" | "rename",
  ) => invoke<number>("enqueue_download", { sessionId, remotePaths, localDir, overwrite }),
  enqueueRemoteCopy: (
    sessionId: string,
    destSessionId: string,
    paths: string[],
    destDir: string,
    isMove: boolean,
    overwrite: "replace" | "skip" | "rename",
  ) =>
    invoke<number>("enqueue_remote_copy", {
      sessionId,
      destSessionId,
      paths,
      destDir,
      isMove,
      overwrite,
    }),

  transferEnqueue: (specs: TransferSpec[]) => invoke<TransferTask[]>("transfer_enqueue", { specs }),
  transfers: () => invoke<TransferTask[]>("transfer_list"),
  transferPause: (id: string) => invoke<void>("transfer_pause", { id }),
  transferResume: (id: string) => invoke<void>("transfer_resume", { id }),
  transferCancel: (id: string) => invoke<void>("transfer_cancel", { id }),
  transferRetry: (id: string) => invoke<void>("transfer_retry", { id }),
  transferRetryFailed: () => invoke<void>("transfer_retry_failed"),
  transferClearCompleted: () => invoke<void>("transfer_clear_completed"),
  transferHistory: () => invoke<HistoryEntry[]>("transfer_history"),
  transferClearHistory: () => invoke<void>("transfer_clear_history"),

  favorites: (profileId?: string) => invoke<Favorite[]>("favorites_list", { profileId }),
  addFavorite: (profileId: string, path: string, label: string) =>
    invoke<void>("favorite_add", { profileId, path, label }),
  removeFavorite: (id: string) => invoke<void>("favorite_remove", { id }),
  recent: () => invoke<RecentEntry[]>("recent_list"),
  clearRecent: () => invoke<void>("recent_clear"),

  loadTabs: () => invoke<[string, string][]>("open_tabs_load"),
  saveTabs: (tabs: [string, string][]) => invoke<void>("open_tabs_save", { tabs }),

  logTail: (lines: number) => invoke<string>("log_tail", { lines }),
  clearCredentials: () => invoke<number>("clear_credentials"),
  factoryReset: () => invoke<void>("factory_reset"),
  setLastDir: (profileId: string, dir: string) => invoke<void>("set_last_dir", { profileId, dir }),
};

export function onHostKeyRequest(handler: (prompt: HostKeyPrompt) => void): Promise<UnlistenFn> {
  return listen<HostKeyPrompt>("host-key://request", (event) => handler(event.payload));
}

export function onTransferUpdate(handler: (tasks: TransferTask[]) => void): Promise<UnlistenFn> {
  return listen<TransferTask[]>("transfer://update", (event) => handler(event.payload));
}

export function onSearchProgress(
  handler: (payload: { searchId: string; scanned: number; found: number }) => void,
): Promise<UnlistenFn> {
  return listen<{ searchId: string; scanned: number; found: number }>(
    "search://progress",
    (event) => handler(event.payload),
  );
}

export function onConnectionState(
  handler: (payload: {
    profileId: string;
    connected: boolean;
    method: string | null;
    error: string | null;
  }) => void,
): Promise<UnlistenFn> {
  return listen("connection://state", (event) =>
    handler(
      event.payload as {
        profileId: string;
        connected: boolean;
        method: string | null;
        error: string | null;
      },
    ),
  );
}

export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "Unexpected error";
}

export function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code: unknown }).code);
  }
  return "error";
}

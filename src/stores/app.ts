import { create } from "zustand";
import {
  api,
  errorCode,
  errorMessage,
  onConnectionState,
  onHostKeyRequest,
  onSearchProgress,
  onTransferUpdate,
} from "@/lib/api";
import { joinRemotePath, normalizeRemotePath, parentRemotePath, remoteFileName } from "@/lib/path";
import { translate, type I18nKey } from "@/lib/i18n";
import { fetchUpdate, installPending } from "@/lib/updater";
import type {
  AppInfo,
  Favorite,
  FileEntry,
  HistoryEntry,
  HostKeyPrompt,
  ListResult,
  Profile,
  RecentEntry,
  SearchOptions,
  ServerGroup,
  Settings,
  SortKey,
  TextFile,
  TransferSpec,
  TransferTask,
  UpdateInfo,
  ViewMode,
} from "@/lib/types";

export interface UpdateState {
  checking: boolean;
  available: UpdateInfo | null;
  installing: boolean;
  progress: number;
  total: number;
  error: string | null;
  dismissed: boolean;
  upToDateAt: number | null;
}

export type OverwritePolicy = "replace" | "skip" | "rename";

export interface SearchState {
  query: string;
  results: FileEntry[];
  scanning: boolean;
  scanned: number;
  searchId: string | null;
  truncated: boolean;
  finished: boolean;
  error: string | null;
}

export interface TabState {
  id: string;
  sessionId: string | null;
  profileId: string;
  title: string;
  subtitle: string;
  path: string;
  home: string;
  history: string[];
  historyIndex: number;
  listing: ListResult | null;
  loading: boolean;
  error: string | null;
  selection: string[];
  anchor: string | null;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  search: SearchState | null;
}

export interface Toast {
  id: string;
  kind: "info" | "success" | "error" | "warning";
  title: string;
  detail?: string;
}

export interface EditorState {
  open: boolean;
  tabId: string;
  sessionId: string;
  path: string;
  content: string;
  original: string;
  modified: number | null;
  size: number;
  encoding: string;
  loading: boolean;
  saving: boolean;
  error: string | null;
  conflict: boolean;
  readOnly: boolean;
}

export interface PromptState {
  open: boolean;
  mode: "new-folder" | "new-file" | "rename";
  title: string;
  value: string;
  targetPath: string | null;
  tabId: string;
}

export interface ConfirmState {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel?: string;
  danger?: boolean;
  action?: () => void | Promise<void>;
}

export interface ConflictState {
  open: boolean;
  names: string[];
  action: "upload" | "paste";
  localPaths: string[];
  remoteDir: string;
  tabId: string;
  clipboardMode: "copy" | "cut" | null;
  sourceSessionId: string | null;
  sourcePaths: string[];
  applyToAll: boolean;
}

export interface PropertiesState {
  open: boolean;
  tabId: string;
  entry: FileEntry | null;
}

interface UiState {
  transfersOpen: boolean;
  settingsOpen: boolean;
  aboutOpen: boolean;
  connectionOpen: boolean;
  connectionTarget: Profile | null;
  connectionError: string | null;
  commandPaletteOpen: boolean;
  shortcutHelpOpen: boolean;
  groupsOpen: boolean;
}

interface AppStore {
  ready: boolean;
  info: AppInfo | null;
  settings: Settings;
  profiles: Profile[];
  groups: ServerGroup[];
  update: UpdateState;
  favorites: Favorite[];
  recent: RecentEntry[];
  history: HistoryEntry[];
  connections: Record<string, boolean>;
  tabs: TabState[];
  activeTabId: string | null;
  transfers: TransferTask[];
  selectedTransferId: string | null;
  hostKey: HostKeyPrompt | null;
  toasts: Toast[];
  clipboard: {
    mode: "copy" | "cut";
    profileId: string;
    sessionId: string;
    paths: string[];
    names: string[];
  } | null;
  editor: EditorState;
  prompt: PromptState;
  conflict: ConflictState;
  confirm: ConfirmState;
  properties: PropertiesState;
  ui: UiState;
  sidebarSection: "servers" | "favorites" | "recent";

  init: () => Promise<void>;
  applySettings: (settings: Settings) => Promise<void>;
  refreshProfiles: () => Promise<void>;
  refreshGroups: () => Promise<void>;
  saveGroup: (group: ServerGroup, previous?: string | null) => Promise<void>;
  deleteGroup: (name: string) => Promise<void>;
  checkForUpdates: (silent?: boolean) => Promise<void>;
  installUpdate: () => Promise<void>;
  dismissUpdate: () => void;
  refreshBookmarks: () => Promise<void>;
  refreshTransfers: () => Promise<void>;
  refreshHistory: () => Promise<void>;

  openServer: (profileId: string, password?: string | null) => Promise<void>;
  newSessionTab: (profileId: string) => Promise<void>;
  duplicateTab: (tabId: string) => Promise<void>;
  closeTab: (tabId: string) => Promise<void>;
  activateTab: (tabId: string) => void;
  moveTab: (from: number, to: number) => void;
  reconnectTab: (tabId: string) => Promise<void>;

  navigate: (tabId: string, path: string, mode?: "push" | "replace") => Promise<void>;
  goBack: (tabId: string) => Promise<void>;
  goForward: (tabId: string) => Promise<void>;
  goUp: (tabId: string) => Promise<void>;
  refreshTab: (tabId: string) => Promise<void>;
  loadDir: (tabId: string, path: string, historyMode: "push" | "replace" | "none") => Promise<void>;

  select: (tabId: string, path: string, mode: "single" | "toggle" | "range") => void;
  /** Used by rubber-band selection; `additive` keeps the current selection. */
  selectPaths: (tabId: string, paths: string[], additive: boolean) => void;
  selectAll: (tabId: string) => void;
  clearSelection: (tabId: string) => void;
  /** Reloads a folder without showing the loading state, only when it changed. */
  silentRefreshTab: (tabId: string) => Promise<void>;
  /** Copies paths dragged from another tab into `tabId`'s current folder. */
  dropPathsIntoTab: (tabId: string, payload: { sessionId: string; paths: string[] }) => Promise<void>;
  setSort: (tabId: string, key: SortKey) => void;
  setView: (view: ViewMode) => Promise<void>;

  startSearch: (tabId: string, query: string, options?: Partial<SearchOptions>) => Promise<void>;
  cancelSearch: (tabId: string) => Promise<void>;
  clearSearch: (tabId: string) => void;

  openEditor: (tabId: string, path: string) => Promise<void>;
  closeEditor: () => void;
  setEditorContent: (content: string) => void;
  saveEditor: (force?: boolean) => Promise<void>;

  openPrompt: (tabId: string, mode: PromptState["mode"], targetPath?: string | null) => void;
  closePrompt: () => void;
  submitPrompt: (value: string) => Promise<void>;
  openProperties: (tabId: string, entry: FileEntry) => void;
  closeProperties: () => void;
  savePermissions: (mode: number) => Promise<void>;

  deleteEntries: (tabId: string, paths: string[]) => Promise<void>;
  copySelection: (tabId: string, cut: boolean) => void;
  paste: (tabId: string) => Promise<void>;
  uploadPaths: (tabId: string, localPaths: string[], targetDir?: string | null) => Promise<void>;
  downloadSelection: (tabId: string, localDir: string) => Promise<void>;

  resolveConflict: (policy: OverwritePolicy | "cancel", applyToAll: boolean) => Promise<void>;
  closeConflict: () => void;

  askConfirm: (request: Omit<ConfirmState, "open">) => void;
  closeConfirm: () => void;
  acceptConfirm: () => void;

  pauseTransfer: (id: string) => Promise<void>;
  resumeTransfer: (id: string) => Promise<void>;
  cancelTransfer: (id: string) => Promise<void>;
  retryTransfer: (id: string) => Promise<void>;
  retryFailed: () => Promise<void>;
  clearCompleted: () => Promise<void>;
  toggleTransfers: () => void;

  respondHostKey: (decision: "accept_once" | "accept_remember" | "reject") => Promise<void>;
  pushToast: (toast: Omit<Toast, "id">) => void;
  dismissToast: (id: string) => void;
  setUi: (patch: Partial<UiState>) => void;
  setSidebarSection: (section: AppStore["sidebarSection"]) => void;
  addFavorite: (profileId: string, path: string, label: string) => Promise<void>;
  removeFavorite: (id: string) => Promise<void>;
  disconnect: (profileId: string) => Promise<void>;
  saveProfile: (args: {
    profile: Profile;
    password?: string;
    passphrase?: string;
    clearPassword?: boolean;
    clearPassphrase?: boolean;
  }) => Promise<Profile>;
  deleteProfile: (id: string) => Promise<void>;
  toggleHidden: (tabId: string) => void;
}

const defaultEditor: EditorState = {
  open: false,
  tabId: "",
  sessionId: "",
  path: "",
  content: "",
  original: "",
  modified: null,
  size: 0,
  encoding: "utf-8",
  loading: false,
  saving: false,
  error: null,
  conflict: false,
  readOnly: false,
};

const defaultPrompt: PromptState = {
  open: false,
  mode: "new-folder",
  title: "",
  value: "",
  targetPath: null,
  tabId: "",
};

const defaultConfirm: ConfirmState = {
  open: false,
  title: "",
};

const defaultConflict: ConflictState = {
  open: false,
  names: [],
  action: "upload",
  localPaths: [],
  remoteDir: "",
  tabId: "",
  clipboardMode: null,
  sourceSessionId: null,
  sourcePaths: [],
  applyToAll: false,
};

const defaultUi: UiState = {
  transfersOpen: false,
  settingsOpen: false,
  aboutOpen: false,
  connectionOpen: false,
  connectionTarget: null,
  connectionError: null,
  commandPaletteOpen: false,
  shortcutHelpOpen: false,
  groupsOpen: false,
};

let eventBound = false;

/**
 * Per-tab request counter. A listing that finishes late must not overwrite the
 * folder the user navigated to afterwards (the same guard `silentRefreshTab`
 * applies to its path).
 */
const dirRequests = new Map<string, number>();

function uid(): string {
  return crypto.randomUUID();
}

/** Translate with the language currently selected in the store. */
function tr(key: I18nKey): string {
  return translate(useApp.getState().settings.language, key);
}

function sameEntries(a: FileEntry[], b: FileEntry[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (
      left.path !== right.path ||
      left.size !== right.size ||
      left.modified !== right.modified ||
      left.mode !== right.mode ||
      left.isDir !== right.isDir ||
      left.isSymlink !== right.isSymlink
    ) {
      return false;
    }
  }
  return true;
}

function tabForProfile(profile: Profile): TabState {
  return {
    id: uid(),
    sessionId: null,
    profileId: profile.id,
    title: profile.name,
    subtitle: `${profile.username}@${profile.host}`,
    // The folder configured on the profile wins; lastDir is only a fallback for
    // servers where no start folder was set.
    path: profile.defaultRemoteDir || profile.lastDir || "",
    home: "",
    history: [],
    historyIndex: -1,
    listing: null,
    loading: false,
    error: null,
    selection: [],
    anchor: null,
    sortKey: "name",
    sortDir: "asc",
    search: null,
  };
}

export function sortEntries(entries: FileEntry[], key: SortKey, dir: "asc" | "desc", showHidden: boolean) {
  const filtered = showHidden ? entries : entries.filter((e) => !e.hidden);
  const factor = dir === "asc" ? 1 : -1;
  return [...filtered].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    let result = 0;
    switch (key) {
      case "size":
        result = a.size - b.size;
        break;
      case "modified":
        result = (a.modified ?? 0) - (b.modified ?? 0);
        break;
      case "type": {
        const ea = a.name.includes(".") ? a.name.split(".").pop()! : "";
        const eb = b.name.includes(".") ? b.name.split(".").pop()! : "";
        result = ea.localeCompare(eb);
        break;
      }
      default:
        result = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    }
    if (result === 0) {
      result = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    }
    return result * factor;
  });
}

function applyTheme(theme: Settings["theme"], language: Settings["language"]) {
  const root = document.documentElement;
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
  const dark = theme === "dark" || (theme === "system" && prefersDark);
  root.classList.toggle("dark", dark);
  root.classList.toggle("light", !dark);
  root.dataset.theme = dark ? "dark" : "light";
  root.lang = language;
}

export const useApp = create<AppStore>()((set, get) => ({
  ready: false,
  info: null,
  settings: {
    theme: "system",
    language: "en",
    startBehavior: "restore",
    restoreTabs: true,
    defaultLocalFolder: null,
    viewMode: "details",
    compact: false,
    animations: true,
    showHidden: false,
    maxConcurrentTransfers: 4,
    bufferSizeKb: 256,
    speedLimitKbps: 0,
    retryCount: 3,
    timeoutSecs: 20,
    keepaliveSecs: 30,
    allowServerCommands: false,
    verifyChecksums: true,
    confirmDelete: true,
    logLevel: "info",
    onboarded: false,
  },
  profiles: [],
  groups: [],
  update: {
    checking: false,
    available: null,
    installing: false,
    progress: 0,
    total: 0,
    error: null,
    dismissed: false,
    upToDateAt: null,
  },
  favorites: [],
  recent: [],
  history: [],
  connections: {},
  tabs: [],
  activeTabId: null,
  transfers: [],
  selectedTransferId: null,
  hostKey: null,
  toasts: [],
  clipboard: null,
  editor: defaultEditor,
  prompt: defaultPrompt,
  conflict: defaultConflict,
  confirm: defaultConfirm,
  properties: { open: false, tabId: "", entry: null },
  ui: defaultUi,
  sidebarSection: "servers",

  init: async () => {
    const [settings, profiles, groups, info, transfers] = await Promise.all([
      api.settingsGet().catch(() => get().settings),
      api.profiles().catch(() => []),
      api.groups().catch(() => []),
      api.appInfo().catch(() => null),
      api.transfers().catch(() => []),
    ]);
    applyTheme(settings.theme, settings.language);
    set({ settings, profiles, groups, info, transfers, ready: true });
    await Promise.all([get().refreshBookmarks(), get().refreshHistory()]);
    // Silent background check; failures (offline, no release yet) are ignored.
    get().checkForUpdates(true).catch(() => undefined);

    if (!eventBound) {
      eventBound = true;
      await onTransferUpdate((tasks) => {
        const previous = get().transfers;
        const doneDirs = new Set<string>();
        for (const task of tasks) {
          const before = previous.find((item) => item.id === task.id);
          if (!before || before.status === "completed" || task.status !== "completed") continue;
          if (task.kind === "upload" || task.kind === "copy_remote" || task.kind === "move_remote") {
            doneDirs.add(parentRemotePath(task.dest));
            if (task.kind !== "upload") doneDirs.add(parentRemotePath(task.source));
          }
        }
        set({ transfers: tasks });
        if (doneDirs.size > 0) {
          for (const tab of get().tabs) {
            const open = tab.listing?.path;
            if (open && doneDirs.has(open)) void get().silentRefreshTab(tab.id);
          }
        }
      });
      await onHostKeyRequest((prompt) => set({ hostKey: prompt }));
      await onSearchProgress((payload) => {
        set((state) => ({
          tabs: state.tabs.map((tab) =>
            tab.search && tab.search.searchId === payload.searchId
              ? { ...tab, search: { ...tab.search, scanned: payload.scanned } }
              : tab,
          ),
        }));
      });
      await onConnectionState((payload) => {
        set((state) => ({
          connections: { ...state.connections, [payload.profileId]: payload.connected },
        }));
        if (!payload.connected && payload.error) {
          get().pushToast({
            kind: "error",
            title: tr("connectionLostTitle"),
            detail: payload.error,
          });
        }
      });
    }

    // Startup behaviour: restore the previous tabs, open the servers marked
    // "auto connect", or stay on the welcome screen.
    if (settings.startBehavior === "restore" && settings.restoreTabs) {
      try {
        const saved = await api.loadTabs();
        for (const [profileId, path] of saved.slice(0, 12)) {
          const profile = profiles.find((p) => p.id === profileId);
          if (!profile) continue;
          const before = new Set(get().tabs.map((t) => t.id));
          // The first tab of a server goes through the connect flow; further
          // tabs open an extra SFTP channel on the same transport.
          const alreadyOpen = get().tabs.some((t) => t.profileId === profile.id && t.sessionId);
          if (alreadyOpen) await get().newSessionTab(profile.id);
          else await get().openServer(profile.id);
          // Target the tab that was just created, not the first tab of this
          // server (which used to receive every restored path).
          const opened = get().tabs.find((t) => t.profileId === profile.id && !before.has(t.id));
          if (opened && path) {
            await get().navigate(opened.id, path, "replace");
          }
        }
      } catch {
        // Never block startup on restoring tabs.
      }
    } else if (settings.startBehavior === "home") {
      // "Home": open every server that is marked for auto-connect.
      for (const profile of profiles.filter((p) => p.autoConnect)) {
        await get().openServer(profile.id);
      }
    }
  },

  applySettings: async (settings) => {
    const saved = await api.settingsSet(settings);
    applyTheme(saved.theme, saved.language);
    set({ settings: saved });
  },

  refreshProfiles: async () => {
    const profiles = await api.profiles();
    set({ profiles });
  },

  refreshGroups: async () => {
    const groups = await api.groups().catch(() => get().groups);
    set({ groups });
  },

  saveGroup: async (group, previous) => {
    try {
      const groups = await api.saveGroup(group, previous ?? null);
      set({ groups });
      await get().refreshProfiles();
    } catch (error) {
      get().pushToast({ kind: "error", title: tr("cannotSaveGroup"), detail: errorMessage(error) });
    }
  },

  deleteGroup: async (name) => {
    try {
      const groups = await api.deleteGroup(name);
      set({ groups });
      await get().refreshProfiles();
    } catch (error) {
      get().pushToast({ kind: "error", title: tr("cannotDeleteGroup"), detail: errorMessage(error) });
    }
  },

  checkForUpdates: async (silent = false) => {
    set((state) => ({ update: { ...state.update, checking: true, error: null } }));
    try {
      const available = await fetchUpdate();
      set((state) => ({
        update: {
          ...state.update,
          checking: false,
          available,
          dismissed: false,
          upToDateAt: available ? state.update.upToDateAt : Date.now(),
        },
      }));
      if (!available && !silent) {
        get().pushToast({ kind: "success", title: tr("upToDate") });
      }
    } catch (error) {
      set((state) => ({ update: { ...state.update, checking: false, error: errorMessage(error) } }));
      if (!silent) {
        get().pushToast({
          kind: "warning",
          title: tr("updateCheckFailed"),
          detail: errorMessage(error),
        });
      }
    }
  },

  installUpdate: async () => {
    const current = get().update;
    if (!current.available || current.installing) return;
    set((state) => ({
      update: { ...state.update, installing: true, progress: 0, total: 0, error: null },
    }));
    try {
      await installPending((downloaded, total) =>
        set((state) => ({ update: { ...state.update, progress: downloaded, total } })),
      );
    } catch (error) {
      set((state) => ({
        update: { ...state.update, installing: false, error: errorMessage(error) },
      }));
      get().pushToast({ kind: "error", title: tr("updateFailed"), detail: errorMessage(error) });
    }
  },

  dismissUpdate: () =>
    set((state) => ({ update: { ...state.update, dismissed: true } })),

  refreshBookmarks: async () => {
    const [favorites, recent] = await Promise.all([
      api.favorites().catch(() => []),
      api.recent().catch(() => []),
    ]);
    set({ favorites, recent });
  },

  refreshTransfers: async () => {
    const transfers = await api.transfers();
    set({ transfers });
  },

  refreshHistory: async () => {
    const history = await api.transferHistory().catch(() => []);
    set({ history });
  },

  openServer: async (profileId, password) => {
    const profile = get().profiles.find((p) => p.id === profileId);
    if (!profile) return;
    const existing = get().tabs.find((t) => t.profileId === profileId && t.sessionId);
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }
    const tab = tabForProfile(profile);
    set((state) => ({ tabs: [...state.tabs, tab], activeTabId: tab.id }));
    try {
      const response = await api.connect(profileId, password);
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tab.id
            ? {
                ...t,
                sessionId: response.sessionId,
                home: response.home,
                path: tab.path || response.home,
              }
            : t,
        ),
        connections: { ...state.connections, [profileId]: true },
        ui: { ...state.ui, connectionOpen: false, connectionError: null, connectionTarget: null },
      }));
      const target = tab.path || response.home;
      await get().loadDir(tab.id, target, "push");
      if (response.reused) {
        get().pushToast({
          kind: "info",
          title: tr("sharedConnectionTitle"),
          detail: `${tr("reusedSessionFor")} ${profile.name}`,
        });
      }
    } catch (error) {
      const code = errorCode(error);
      set((state) => ({
        tabs: state.tabs.filter((t) => t.id !== tab.id),
        ui: {
          ...state.ui,
          connectionOpen: code === "credentials_required" || code === "auth_failed" || code === "key_error",
          connectionTarget: code === "credentials_required" || code === "auth_failed" || code === "key_error" ? profile : state.ui.connectionTarget,
          connectionError: errorMessage(error),
        },
      }));
      get().pushToast({
        kind: "error",
        title: `${tr("cannotConnectTo")} ${profile.name}`,
        detail: errorMessage(error),
      });
    }
  },

  newSessionTab: async (profileId) => {
    const profile = get().profiles.find((p) => p.id === profileId);
    if (!profile) return;
    const tab = tabForProfile(profile);
    set((state) => ({ tabs: [...state.tabs, tab], activeTabId: tab.id }));
    try {
      // A second SFTP channel over the same SSH transport: no new auth.
      const session = await api.openSession(profileId);
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tab.id ? { ...t, sessionId: session.sessionId, home: session.home } : t,
        ),
        connections: { ...state.connections, [profileId]: true },
      }));
      await get().loadDir(tab.id, profile.defaultRemoteDir || profile.lastDir || session.home, "push");
    } catch (error) {
      set((state) => ({ tabs: state.tabs.filter((t) => t.id !== tab.id) }));
      get().pushToast({ kind: "error", title: tr("cannotOpenTab"), detail: errorMessage(error) });
    }
  },

  duplicateTab: async (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const profile = get().profiles.find((p) => p.id === tab.profileId);
    if (!profile) return;
    const copy = tabForProfile(profile);
    copy.path = tab.path;
    set((state) => ({ tabs: [...state.tabs, copy], activeTabId: copy.id }));
    try {
      // Same SSH transport, new SFTP channel.
      const session = await api.openSession(profile.id);
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === copy.id ? { ...t, sessionId: session.sessionId, home: session.home } : t,
        ),
      }));
      await get().loadDir(copy.id, tab.path, "push");
    } catch (error) {
      set((state) => ({ tabs: state.tabs.filter((t) => t.id !== copy.id) }));
      get().pushToast({ kind: "error", title: tr("cannotDuplicateTab"), detail: errorMessage(error) });
    }
  },

  closeTab: async (tabId) => {
    const state = get();
    const index = state.tabs.findIndex((t) => t.id === tabId);
    if (index < 0) return;
    const tab = state.tabs[index];
    if (tab.search?.searchId) {
      api.cancelSearch(tab.search.searchId).catch(() => undefined);
    }
    if (tab.sessionId) {
      api.closeSession(tab.sessionId).catch(() => undefined);
    }
    const remaining = state.tabs.filter((t) => t.id !== tabId);
    let activeId = state.activeTabId;
    if (activeId === tabId) {
      const next = remaining[Math.min(index, remaining.length - 1)];
      activeId = next ? next.id : null;
    }
    set({ tabs: remaining, activeTabId: activeId });
    await persistTabs(remaining);
  },

  activateTab: (tabId) => set({ activeTabId: tabId }),

  moveTab: (from, to) => {
    const tabs = [...get().tabs];
    if (from < 0 || to < 0 || from >= tabs.length || to >= tabs.length) return;
    const [moved] = tabs.splice(from, 1);
    tabs.splice(to, 0, moved);
    set({ tabs });
    persistTabs(tabs).catch(() => undefined);
  },

  reconnectTab: async (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab) return;
    try {
      const session = await api.openSession(tab.profileId);
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId ? { ...t, sessionId: session.sessionId, home: session.home, error: null } : t,
        ),
      }));
      await get().loadDir(tabId, tab.path || session.home, "replace");
    } catch (error) {
      get().pushToast({ kind: "error", title: tr("reconnectFailed"), detail: errorMessage(error) });
    }
  },

  navigate: async (tabId, path, mode = "push") => {
    await get().loadDir(tabId, path, mode);
  },

  goBack: async (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.historyIndex <= 0) return;
    const index = tab.historyIndex - 1;
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, historyIndex: index } : t)),
    }));
    await get().loadDir(tabId, tab.history[index], "none");
  },

  goForward: async (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.historyIndex >= tab.history.length - 1) return;
    const index = tab.historyIndex + 1;
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, historyIndex: index } : t)),
    }));
    await get().loadDir(tabId, tab.history[index], "none");
  },

  goUp: async (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const current = tab.listing?.path ?? tab.path;
    if (!current || current === "/") return;
    await get().navigate(tabId, parentRemotePath(current));
  },

  refreshTab: async (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab) return;
    // Re-reading the current folder in place avoids tearing down the list and
    // losing the scroll position.
    if (tab.listing) {
      await get().silentRefreshTab(tabId);
      return;
    }
    await get().loadDir(tabId, tab.path, "none");
  },

  silentRefreshTab: async (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab?.sessionId || tab.loading || tab.search) return;
    const path = tab.listing?.path ?? tab.path;
    if (!path) return;
    try {
      const result = await api.listDir(tab.sessionId, path);
      const current = get().tabs.find((t) => t.id === tabId);
      if (!current || (current.listing?.path && current.listing.path !== result.path)) return;
      if (sameEntries(current.listing?.entries ?? [], result.entries)) return;
      set((state) => ({
        tabs: state.tabs.map((t) => {
          if (t.id !== tabId) return t;
          const available = new Set(result.entries.map((entry) => entry.path));
          return {
            ...t,
            listing: result,
            path: result.path,
            home: result.home || t.home,
            selection: t.selection.filter((p) => available.has(p)),
            anchor: t.anchor && available.has(t.anchor) ? t.anchor : null,
          };
        }),
      }));
    } catch {
      // A silent refresh never disturbs the user; the next action retries.
    }
  },

  dropPathsIntoTab: async (tabId, payload) => {
    const target = get().tabs.find((t) => t.id === tabId);
    if (!target?.sessionId) return;
    const destDir = target.listing?.path ?? target.path;
    if (!destDir) return;
    try {
      const count = await api.enqueueRemoteCopy(
        payload.sessionId,
        target.sessionId,
        payload.paths,
        destDir,
        false,
        "rename",
      );
      get().pushToast({
        kind: "info",
        title: `${tr("copyQueuedTo")} ${target.title}`,
        detail: `${count} ${tr("items")} → ${destDir}`,
      });
      get().setUi({ transfersOpen: true });
    } catch (error) {
      get().pushToast({ kind: "error", title: tr("copyFailed"), detail: errorMessage(error) });
    }
  },

  loadDir: async (tabId, path, historyMode) => {
    const state = get();
    const tab = state.tabs.find((t) => t.id === tabId);
    if (!tab) return;
    if (!tab.sessionId) {
      await get().reconnectTab(tabId);
      return;
    }
    const requestId = (dirRequests.get(tabId) ?? 0) + 1;
    dirRequests.set(tabId, requestId);
    const isCurrent = () => dirRequests.get(tabId) === requestId;
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, loading: true, error: null } : t)),
    }));

    const attempt = async (sessionId: string) => api.listDir(sessionId, path || ".");

    try {
      let result: ListResult;
      try {
        result = await attempt(tab.sessionId);
      } catch (error) {
        const code = errorCode(error);
        if (code === "session_not_found" || code === "connection_lost" || code === "sftp_error") {
          const session = await api.openSession(tab.profileId);
          set((s) => ({
            tabs: s.tabs.map((t) =>
              t.id === tabId ? { ...t, sessionId: session.sessionId, home: session.home } : t,
            ),
          }));
          result = await attempt(session.sessionId);
        } else {
          throw error;
        }
      }

      // A slower, superseded listing must not replace the current folder.
      if (!isCurrent()) return;

      set((s) => ({
        tabs: s.tabs.map((t) => {
          if (t.id !== tabId) return t;
          let history = t.history;
          let historyIndex = t.historyIndex;
          if (historyMode === "push") {
            const trimmed = t.history.slice(0, t.historyIndex + 1);
            if (trimmed[trimmed.length - 1] !== result.path) {
              trimmed.push(result.path);
              history = trimmed.slice(-80);
              historyIndex = history.length - 1;
            } else {
              history = trimmed;
              historyIndex = trimmed.length - 1;
            }
          } else if (historyMode === "replace") {
            history = [result.path];
            historyIndex = 0;
          }
          const available = new Set(result.entries.map((e) => e.path));
          return {
            ...t,
            listing: result,
            path: result.path,
            home: result.home || t.home,
            loading: false,
            error: null,
            history,
            historyIndex,
            selection: t.selection.filter((p) => available.has(p)),
            anchor: t.anchor && available.has(t.anchor) ? t.anchor : null,
          };
        }),
      }));
      const profile = get().profiles.find((p) => p.id === tab.profileId);
      if (profile) {
        api.setLastDir(profile.id, result.path).catch(() => undefined);
      }
    } catch (error) {
      if (!isCurrent()) return;
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId ? { ...t, loading: false, error: errorMessage(error) } : t,
        ),
      }));
      get().pushToast({
        kind: "error",
        title: tr("cannotOpenFolder"),
        detail: errorMessage(error),
      });
    }
  },

  select: (tabId, path, mode) => {
    set((s) => ({
      tabs: s.tabs.map((tab) => {
        if (tab.id !== tabId) return tab;
        const entries = tab.listing?.entries ?? [];
        const ordered = sortEntries(entries, tab.sortKey, tab.sortDir, get().settings.showHidden);
        if (mode === "toggle") {
          const selection = tab.selection.includes(path)
            ? tab.selection.filter((p) => p !== path)
            : [...tab.selection, path];
          return { ...tab, selection, anchor: path };
        }
        if (mode === "range" && tab.anchor) {
          const start = ordered.findIndex((e) => e.path === tab.anchor);
          const end = ordered.findIndex((e) => e.path === path);
          if (start >= 0 && end >= 0) {
            const [a, b] = start < end ? [start, end] : [end, start];
            return { ...tab, selection: ordered.slice(a, b + 1).map((e) => e.path) };
          }
        }
        return { ...tab, selection: [path], anchor: path };
      }),
    }));
  },

  selectPaths: (tabId, paths, additive) => {
    set((s) => ({
      tabs: s.tabs.map((tab) => {
        if (tab.id !== tabId) return tab;
        const selection = additive
          ? [...new Set([...tab.selection, ...paths])]
          : paths;
        return { ...tab, selection, anchor: paths[paths.length - 1] ?? tab.anchor };
      }),
    }));
  },

  selectAll: (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const ordered = sortEntries(
      tab.listing?.entries ?? [],
      tab.sortKey,
      tab.sortDir,
      get().settings.showHidden,
    );
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, selection: ordered.map((e) => e.path) } : t)),
    }));
  },

  clearSelection: (tabId) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, selection: [], anchor: null } : t)),
    }));
  },

  setSort: (tabId, key) => {
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId) return t;
        if (t.sortKey === key) {
          return { ...t, sortDir: t.sortDir === "asc" ? "desc" : "asc" };
        }
        return { ...t, sortKey: key, sortDir: "asc" };
      }),
    }));
  },

  setView: async (view) => {
    await get().applySettings({ ...get().settings, viewMode: view });
  },

  startSearch: async (tabId, query, options = {}) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab?.sessionId) return;
    const root = tab.listing?.path ?? tab.path;
    // The id is created here so progress events can be matched and the search can
    // be cancelled while it is still running (previously it was only known once
    // the command had already finished).
    const searchId = uid();
    const patchSearch = (patch: Partial<SearchState>) =>
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId && t.search?.searchId === searchId
            ? { ...t, search: { ...t.search, ...patch } }
            : t,
        ),
      }));
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId
          ? {
              ...t,
              search: {
                query,
                results: [],
                scanning: true,
                scanned: 0,
                searchId,
                truncated: false,
                finished: false,
                error: null,
              },
            }
          : t,
      ),
    }));
    try {
      const result = await api.search(
        tab.sessionId,
        root,
        {
          query,
          recursive: true,
          includeHidden: get().settings.showHidden,
          maxResults: 2000,
          ...options,
        },
        searchId,
      );
      patchSearch({
        results: result.entries,
        scanning: false,
        scanned: result.scanned,
        truncated: result.truncated,
        finished: true,
      });
    } catch (error) {
      patchSearch({ scanning: false, error: errorMessage(error) });
    }
  },

  cancelSearch: async (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (tab?.search?.searchId) {
      await api.cancelSearch(tab.search.searchId).catch(() => undefined);
    }
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.search ? { ...t, search: { ...t.search, scanning: false } } : t,
      ),
    }));
  },

  clearSearch: (tabId) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, search: null } : t)),
    }));
  },

  openEditor: async (tabId, path) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab?.sessionId) return;
    set({
      editor: { ...defaultEditor, open: true, tabId, sessionId: tab.sessionId, path, loading: true },
    });
    try {
      const file: TextFile = await api.readText(tab.sessionId, path);
      set({
        editor: {
          open: true,
          tabId,
          sessionId: tab.sessionId,
          path: file.path,
          content: file.content,
          original: file.content,
          modified: file.modified,
          size: file.size,
          encoding: file.encoding,
          loading: false,
          saving: false,
          error: null,
          conflict: false,
          readOnly: file.readOnly,
        },
      });
    } catch (error) {
      set((s) => ({
        editor: { ...s.editor, loading: false, error: errorMessage(error) },
      }));
    }
  },

  closeEditor: () => {
    const editor = get().editor;
    if (editor.content !== editor.original) {
      get().askConfirm({
        title: tr("discardChangesTitle"),
        body: `“${editor.path.split("/").pop() ?? editor.path}” ${tr("discardChangesBody")}`,
        confirmLabel: tr("discard"),
        danger: true,
        action: () => set({ editor: defaultEditor }),
      });
      return;
    }
    set({ editor: defaultEditor });
  },

  setEditorContent: (content) => {
    set((s) => ({ editor: { ...s.editor, content, conflict: false } }));
  },

  saveEditor: async (force = false) => {
    const editor = get().editor;
    if (!editor.open || editor.saving) return;
    set((s) => ({ editor: { ...s.editor, saving: true, error: null } }));
    try {
      const modified = await api.writeText(
        editor.sessionId,
        editor.path,
        editor.content,
        editor.modified,
        editor.size,
        force,
      );
      set((s) => ({
        editor: {
          ...s.editor,
          saving: false,
          original: s.editor.content,
          modified,
          size: new Blob([s.editor.content]).size,
          conflict: false,
        },
      }));
      get().pushToast({ kind: "success", title: tr("saved"), detail: editor.path });
      const tab = get().tabs.find((t) => t.id === editor.tabId);
      if (tab) await get().refreshTab(tab.id);
    } catch (error) {
      const conflict = errorCode(error) === "conflict";
      set((s) => ({
        editor: { ...s.editor, saving: false, conflict, error: errorMessage(error) },
      }));
      if (!conflict) {
        get().pushToast({ kind: "error", title: tr("saveFailed"), detail: errorMessage(error) });
      }
    }
  },

  openPrompt: (tabId, mode, targetPath = null) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    set({
      prompt: {
        open: true,
        mode,
        title:
          mode === "new-folder"
            ? tr("newFolder")
            : mode === "new-file"
              ? tr("newFile")
              : tr("rename"),
        value: mode === "rename" && targetPath ? remoteFileName(targetPath) : "",
        targetPath,
        tabId,
      },
    });
    if (!tab) set({ prompt: { ...defaultPrompt } });
  },

  closePrompt: () => set({ prompt: defaultPrompt }),

  askConfirm: (request) => set({ confirm: { ...defaultConfirm, ...request, open: true } }),

  closeConfirm: () => set({ confirm: defaultConfirm }),

  acceptConfirm: () => {
    const { action } = get().confirm;
    set({ confirm: defaultConfirm });
    if (action) void action();
  },

  submitPrompt: async (value) => {
    const prompt = get().prompt;
    const tab = get().tabs.find((t) => t.id === prompt.tabId);
    if (!tab?.sessionId || !value.trim()) return;
    try {
      if (prompt.mode === "new-folder") {
        await api.mkdir(tab.sessionId, tab.listing?.path ?? tab.path, value.trim());
      } else if (prompt.mode === "new-file") {
        const path = await api.createFile(tab.sessionId, tab.listing?.path ?? tab.path, value.trim());
        await get().refreshTab(tab.id);
        set({ prompt: defaultPrompt });
        await get().openEditor(tab.id, path);
        return;
      } else if (prompt.mode === "rename" && prompt.targetPath) {
        await api.renamePath(tab.sessionId, prompt.targetPath, value.trim());
      }
      set({ prompt: defaultPrompt });
      await get().refreshTab(tab.id);
    } catch (error) {
      get().pushToast({ kind: "error", title: tr("operationFailed"), detail: errorMessage(error) });
    }
  },

  openProperties: (tabId, entry) => set({ properties: { open: true, tabId, entry } }),
  closeProperties: () => set({ properties: { open: false, tabId: "", entry: null } }),

  savePermissions: async (mode) => {
    const { properties } = get();
    const tab = get().tabs.find((t) => t.id === properties.tabId);
    if (!tab?.sessionId || !properties.entry) return;
    try {
      await api.chmod(tab.sessionId, properties.entry.path, mode);
      set({ properties: { ...properties, entry: { ...properties.entry, mode } } });
      get().pushToast({ kind: "success", title: tr("permissionsUpdated") });
      await get().refreshTab(tab.id);
    } catch (error) {
      get().pushToast({ kind: "error", title: tr("permissionChangeFailed"), detail: errorMessage(error) });
    }
  },

  deleteEntries: async (tabId, paths) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab?.sessionId || paths.length === 0) return;
    try {
      const count = await api.deletePaths(tab.sessionId, paths, true);
      get().pushToast({
        kind: "success",
        title: `${tr("deletedItems")} ${count} ${tr("items")}`,
      });
      await get().refreshTab(tab.id);
    } catch (error) {
      get().pushToast({ kind: "error", title: tr("deleteFailed"), detail: errorMessage(error) });
    }
  },

  copySelection: (tabId, cut) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab?.sessionId || tab.selection.length === 0) return;
    set({
      clipboard: {
        mode: cut ? "cut" : "copy",
        profileId: tab.profileId,
        sessionId: tab.sessionId,
        paths: [...tab.selection],
        names: tab.selection.map(remoteFileName),
      },
    });
    get().pushToast({
      kind: "info",
      title: cut ? tr("cutDone") : tr("copiedDone"),
      detail: `${tab.selection.length} ${tr("items")} ${tr("readyToPaste")}`,
    });
  },

  paste: async (tabId) => {
    const state = get();
    const tab = state.tabs.find((t) => t.id === tabId);
    const clipboard = state.clipboard;
    if (!tab?.sessionId || !clipboard) return;
    const destDir = tab.listing?.path ?? tab.path;
    const existing = new Set((tab.listing?.entries ?? []).map((e) => e.name));
    const conflicts = clipboard.names.filter((n) => existing.has(n));
    if (conflicts.length > 0) {
      set({
        conflict: {
          ...defaultConflict,
          open: true,
          names: conflicts,
          action: "paste",
          tabId,
          remoteDir: destDir,
          clipboardMode: clipboard.mode,
          sourceSessionId: clipboard.sessionId,
          sourcePaths: clipboard.paths,
        },
      });
      return;
    }
    await performPaste(tabId, destDir, clipboard.sessionId, clipboard.paths, clipboard.mode === "cut", "rename");
    if (clipboard.mode === "cut") set({ clipboard: null });
  },

  uploadPaths: async (tabId, localPaths, targetDir) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab?.sessionId || localPaths.length === 0) return;
    const currentDir = tab.listing?.path ?? tab.path;
    // Dropping onto a folder row uploads into that folder, not into the folder
    // that happens to be open.
    const destDir = targetDir ?? currentDir;
    const existing = new Set(
      destDir === currentDir ? (tab.listing?.entries ?? []).map((e) => e.name) : [],
    );
    const names = localPaths.map((p) => p.split(/[\\/]/).filter(Boolean).pop() ?? "file");
    const conflicts = names.filter((n) => existing.has(n));
    if (conflicts.length > 0) {
      set({
        conflict: {
          ...defaultConflict,
          open: true,
          names: conflicts,
          action: "upload",
          tabId,
          remoteDir: destDir,
          localPaths,
        },
      });
      return;
    }
    try {
      const queued = await api.enqueueUpload(tab.sessionId, localPaths, destDir, "rename");
      get().pushToast({
        kind: "info",
        title: tr("uploadQueued"),
        detail: `${queued} ${tr("items")}`,
      });
      set((s) => ({ ui: { ...s.ui, transfersOpen: true } }));
    } catch (error) {
      get().pushToast({ kind: "error", title: tr("uploadFailed"), detail: errorMessage(error) });
    }
  },

  downloadSelection: async (tabId, localDir) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab?.sessionId || tab.selection.length === 0) return;
    try {
      const count = await api.enqueueDownload(tab.sessionId, tab.selection, localDir, "rename");
      get().pushToast({
        kind: "info",
        title: tr("downloadQueued"),
        detail: `${count} ${tr("items")}`,
      });
      set((s) => ({ ui: { ...s.ui, transfersOpen: true } }));
    } catch (error) {
      get().pushToast({ kind: "error", title: tr("downloadFailed"), detail: errorMessage(error) });
    }
  },

  resolveConflict: async (policy, applyToAll) => {
    const conflict = get().conflict;
    if (!conflict.open) return;
    if (policy === "cancel") {
      set({ conflict: defaultConflict });
      return;
    }
    const overwrite: OverwritePolicy = policy;
    if (conflict.action === "upload") {
      const tab = get().tabs.find((t) => t.id === conflict.tabId);
      if (tab?.sessionId) {
        try {
          await api.enqueueUpload(tab.sessionId, conflict.localPaths, conflict.remoteDir, overwrite);
          set((s) => ({ ui: { ...s.ui, transfersOpen: true } }));
        } catch (error) {
          get().pushToast({ kind: "error", title: tr("uploadFailed"), detail: errorMessage(error) });
        }
      }
    } else if (conflict.sourceSessionId && conflict.sourcePaths.length) {
      await performPaste(
        conflict.tabId,
        conflict.remoteDir,
        conflict.sourceSessionId,
        conflict.sourcePaths,
        conflict.clipboardMode === "cut",
        overwrite,
      );
      if (conflict.clipboardMode === "cut") set({ clipboard: null });
    }
    set({ conflict: { ...defaultConflict, applyToAll: applyToAll && policy === "replace" } });
  },

  closeConflict: () => set({ conflict: defaultConflict }),

  pauseTransfer: async (id) => {
    await api.transferPause(id).catch((error) =>
      get().pushToast({ kind: "warning", title: tr("cannotPause"), detail: errorMessage(error) }),
    );
  },
  resumeTransfer: async (id) => {
    await api.transferResume(id).catch(() => undefined);
  },
  cancelTransfer: async (id) => {
    await api.transferCancel(id).catch(() => undefined);
  },
  retryTransfer: async (id) => {
    await api.transferRetry(id).catch(() => undefined);
  },
  retryFailed: async () => {
    await api.transferRetryFailed().catch(() => undefined);
    await get().refreshTransfers();
  },
  clearCompleted: async () => {
    await api.transferClearCompleted().catch(() => undefined);
    await get().refreshTransfers();
  },
  toggleTransfers: () => set((s) => ({ ui: { ...s.ui, transfersOpen: !s.ui.transfersOpen } })),

  respondHostKey: async (decision) => {
    const prompt = get().hostKey;
    if (!prompt) return;
    set({ hostKey: null });
    try {
      await api.respondHostKey(prompt.requestId, decision);
    } catch (error) {
      get().pushToast({ kind: "error", title: tr("hostKeyError"), detail: errorMessage(error) });
    }
  },

  pushToast: (toast) => {
    const id = uid();
    set((s) => ({ toasts: [...s.toasts.slice(-4), { ...toast, id }] }));
    setTimeout(() => get().dismissToast(id), 7000);
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  setUi: (patch) => set((s) => ({ ui: { ...s.ui, ...patch } })),
  setSidebarSection: (section) => set({ sidebarSection: section }),

  addFavorite: async (profileId, path, label) => {
    await api.addFavorite(profileId, path, label);
    await get().refreshBookmarks();
  },

  removeFavorite: async (id) => {
    await api.removeFavorite(id);
    await get().refreshBookmarks();
  },

  disconnect: async (profileId) => {
    await api.disconnect(profileId);
    set((s) => ({ connections: { ...s.connections, [profileId]: false } }));
    set((s) => ({
      tabs: s.tabs.map((t) => (t.profileId === profileId ? { ...t, sessionId: null } : t)),
    }));
  },

  saveProfile: async (args) => {
    const profile = await api.saveProfile(args);
    await get().refreshProfiles();
    return profile;
  },

  deleteProfile: async (id) => {
    await api.deleteProfile(id);
    await get().refreshProfiles();
  },

  toggleHidden: (tabId) => {
    const next = !get().settings.showHidden;
    get()
      .applySettings({ ...get().settings, showHidden: next })
      .catch(() => undefined);
    void tabId;
  },
}));

async function persistTabs(tabs: TabState[]) {
  try {
    await api.saveTabs(tabs.filter((t) => t.sessionId).map((t) => [t.profileId, t.path]));
  } catch {
    // Persisting the tab layout is best-effort.
  }
}

async function performPaste(
  tabId: string,
  destDir: string,
  sourceSessionId: string,
  sourcePaths: string[],
  isMove: boolean,
  overwrite: OverwritePolicy,
) {
  const store = useApp.getState();
  const tab = store.tabs.find((t) => t.id === tabId);
  if (!tab?.sessionId) return;
  try {
    const count = await api.enqueueRemoteCopy(
      sourceSessionId,
      tab.sessionId,
      sourcePaths,
      destDir,
      isMove,
      overwrite,
    );
    store.pushToast({
      kind: "info",
      title: isMove ? tr("moveQueued") : tr("copyQueued"),
      detail: `${count} ${tr("items")} → ${destDir}`,
    });
    store.setUi({ transfersOpen: true });
  } catch (error) {
    store.pushToast({
      kind: "error",
      title: isMove ? tr("moveFailed") : tr("copyFailed"),
      detail: errorMessage(error),
    });
  }
}

/** Kept for components that only need the active tab. */
export function useActiveTab() {
  return useApp((state) => state.tabs.find((t) => t.id === state.activeTabId) ?? null);
}

export function upsertTabPath(tab: TabState, name: string): string {
  return joinRemotePath(tab.listing?.path ?? tab.path, name);
}

export function normalizeForDisplay(path: string): string {
  return normalizeRemotePath(path);
}

export type { TransferSpec };

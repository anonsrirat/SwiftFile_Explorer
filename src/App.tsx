import { lazy, Suspense, useEffect } from "react";
import { useApp } from "@/stores/app";
import { TitleBar } from "@/components/TitleBar";
import { TabBar } from "@/components/TabBar";
import { NavBar } from "@/components/NavBar";
import { Sidebar } from "@/components/Sidebar";
import { FileList } from "@/components/FileList";
import { StatusBar } from "@/components/StatusBar";
import { TransferPanel } from "@/components/TransferPanel";
import { UpdateBanner } from "@/components/UpdateBanner";
import { GroupDialog } from "@/components/dialogs/GroupDialog";
import { ConnectionDialog } from "@/components/dialogs/ConnectionDialog";
import { SettingsDialog } from "@/components/dialogs/SettingsDialog";
import { HostKeyDialog } from "@/components/dialogs/HostKeyDialog";
import { OnboardingDialog } from "@/components/dialogs/OnboardingDialog";
const EditorDialog = lazy(() =>
  import("@/components/dialogs/EditorDialog").then((module) => ({ default: module.EditorDialog })),
);
import {
  ConfirmDialog,
  ConflictDialog,
  PromptDialog,
  PropertiesDialog,
  Toasts,
  WelcomeView,
} from "@/components/dialogs/MiscDialogs";
import { translate } from "@/lib/i18n";
import { TooltipProvider } from "@/components/ui/controls";
import { isTextFile } from "@/lib/utils";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return !!target.closest("input, textarea, select, .monaco-editor, [contenteditable='true']");
}

export default function App() {
  const init = useApp((s) => s.init);
  const tabs = useApp((s) => s.tabs);
  const activeTabId = useApp((s) => s.activeTabId);
  const animations = useApp((s) => s.settings.animations);
  const theme = useApp((s) => s.settings.theme);
  const language = useApp((s) => s.settings.language);
  const editorOpen = useApp((s) => s.editor.open);

  useEffect(() => {
    init().catch((error) => console.error("init failed", error));
  }, [init]);

  useEffect(() => {
    document.documentElement.classList.toggle("no-anim", !animations);
  }, [animations]);

  // Follow the OS theme when the user chose "system".
  useEffect(() => {
    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = media.matches;
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.classList.toggle("light", !dark);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  // Suppress the WebView2 menu (it contains "Reload", which restarts the whole
  // app and drops every session). Inputs and the editor keep their own menus.
  useEffect(() => {
    const handler = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true'], .monaco-editor")) return;
      event.preventDefault();
    };
    document.addEventListener("contextmenu", handler);
    return () => document.removeEventListener("contextmenu", handler);
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const state = useApp.getState();
      const tabId = state.activeTabId;
      const tab = state.tabs.find((t) => t.id === tabId);
      const mod = event.ctrlKey || event.metaKey;
      const typing = isTypingTarget(event.target);

      if (event.key === "Escape") {
        if (state.prompt.open) return;
        if (tab?.search) {
          state.clearSearch(tab.id);
          return;
        }
        if (tab) state.clearSelection(tab.id);
        return;
      }

      if (mod && event.key === ",") {
        event.preventDefault();
        state.setUi({ settingsOpen: true });
        return;
      }
      if (mod && event.key.toLowerCase() === "j") {
        event.preventDefault();
        state.toggleTransfers();
        return;
      }
      if (typing) return;

      if (mod && event.key.toLowerCase() === "t") {
        event.preventDefault();
        if (tab) state.newSessionTab(tab.profileId);
        else state.setUi({ connectionOpen: true, connectionTarget: null, connectionError: null });
        return;
      }
      if (mod && event.key.toLowerCase() === "w") {
        event.preventDefault();
        if (tab) state.closeTab(tab.id);
        return;
      }
      if (mod && event.key.toLowerCase() === "k" && event.shiftKey) {
        event.preventDefault();
        if (tab) state.duplicateTab(tab.id);
        return;
      }
      if (mod && event.key.toLowerCase() === "r") {
        event.preventDefault();
        if (tab) state.refreshTab(tab.id);
        return;
      }
      if (event.key === "F5") {
        // Never let the WebView reload the app; refresh the folder instead.
        event.preventDefault();
        if (tab) state.refreshTab(tab.id);
        return;
      }
      if (mod && event.key.toLowerCase() === "a") {
        event.preventDefault();
        if (tab) state.selectAll(tab.id);
        return;
      }
      if (mod && event.key.toLowerCase() === "c") {
        if (tab && tab.selection.length) {
          event.preventDefault();
          state.copySelection(tab.id, false);
        }
        return;
      }
      if (mod && event.key.toLowerCase() === "x") {
        if (tab && tab.selection.length) {
          event.preventDefault();
          state.copySelection(tab.id, true);
        }
        return;
      }
      if (mod && event.key.toLowerCase() === "v") {
        if (tab && state.clipboard) {
          event.preventDefault();
          state.paste(tab.id);
        }
        return;
      }
      if (event.key === "Tab" && event.ctrlKey && state.tabs.length > 1) {
        event.preventDefault();
        const index = state.tabs.findIndex((t) => t.id === tabId);
        const next = (index + (event.shiftKey ? -1 : 1) + state.tabs.length) % state.tabs.length;
        state.activateTab(state.tabs[next].id);
        return;
      }
      if (event.altKey && event.key === "ArrowLeft") {
        event.preventDefault();
        if (tab) state.goBack(tab.id);
        return;
      }
      if (event.altKey && event.key === "ArrowRight") {
        event.preventDefault();
        if (tab) state.goForward(tab.id);
        return;
      }
      if (event.altKey && event.key === "ArrowUp") {
        event.preventDefault();
        if (tab) state.goUp(tab.id);
        return;
      }
      if (event.key === "Backspace") {
        event.preventDefault();
        if (tab) state.goUp(tab.id);
        return;
      }
      if (event.key === "F2") {
        event.preventDefault();
        if (tab && tab.selection.length === 1) state.openPrompt(tab.id, "rename", tab.selection[0]);
        return;
      }
      if (event.key === "Delete" && tab && tab.selection.length > 0) {
        event.preventDefault();
        const paths = [...tab.selection];
        if (event.shiftKey || !state.settings.confirmDelete) {
          state.deleteEntries(tab.id, paths);
        } else {
          const names = paths.map((p) => p.split("/").pop()).join("\n");
          const tr = (key: Parameters<typeof translate>[1]) => translate(state.settings.language, key);
          state.askConfirm({
            title: tr("deleteConfirm"),
            body: `${tr("deleteConfirmBody")}\n\n${names}`,
            confirmLabel: tr("delete"),
            danger: true,
            action: () => {
              void state.deleteEntries(tab.id, paths);
            },
          });
        }
        return;
      }
      if (event.key === "Enter" && tab) {
        const entries = tab.listing?.entries ?? [];
        const target = entries.find((e) => e.path === tab.selection[0]);
        if (!target) return;
        event.preventDefault();
        if (target.isDir) {
          state.navigate(tab.id, target.path);
        } else if (isTextFile(target.name)) {
          state.openEditor(tab.id, target.path);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col bg-app text-ink">
        <TitleBar />
        <UpdateBanner />
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <main className="flex min-w-0 flex-1 flex-col bg-surface">
            <TabBar />
            <NavBar />
            <div className="flex min-h-0 flex-1 flex-col">
              {tabs.length === 0 || !tabs.some((t) => t.id === activeTabId) ? <WelcomeView /> : <FileList />}
              <TransferPanel />
            </div>
            <StatusBar />
          </main>
        </div>

        <ConnectionDialog />
        <SettingsDialog />
        <GroupDialog />
        <HostKeyDialog />
        <OnboardingDialog />
        {editorOpen ? (
          <Suspense fallback={null}>
            <EditorDialog />
          </Suspense>
        ) : null}
        <PromptDialog />
        <ConfirmDialog />
        <ConflictDialog />
        <PropertiesDialog />
        <Toasts />
      </div>
    </TooltipProvider>
  );
}

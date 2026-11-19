import { useEffect, useRef } from "react";
import {
  AlertTriangle,
  FileCode2,
  RefreshCw,
  Save,
  X,
} from "lucide-react";
import { useApp } from "@/stores/app";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Badge, Button, Spinner } from "@/components/ui/controls";
import { languageForFile, monaco } from "@/lib/monaco";
import { cn, formatBytes, formatDate } from "@/lib/utils";
import { useT } from "@/lib/useT";

export function EditorDialog() {
  const t = useT();
  const editor = useApp((s) => s.editor);
  const theme = useApp((s) => s.settings.theme);
  const closeEditor = useApp((s) => s.closeEditor);
  const saveEditor = useApp((s) => s.saveEditor);
  const setEditorContent = useApp((s) => s.setEditorContent);
  const openEditor = useApp((s) => s.openEditor);
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  const dark =
    theme === "dark" ||
    (theme === "system" && (window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true));

  useEffect(() => {
    if (!editor.open || editor.loading || !containerRef.current) return;
    const instance = monaco.editor.create(containerRef.current, {
      value: editor.content,
      language: languageForFile(editor.path),
      theme: dark ? "vs-dark" : "vs",
      automaticLayout: true,
      fontSize: 12.5,
      lineHeight: 20,
      fontFamily: '"Cascadia Code", Consolas, monospace',
      minimap: { enabled: true, maxColumn: 80 },
      scrollBeyondLastLine: false,
      renderWhitespace: "selection",
      tabSize: 2,
      insertSpaces: true,
      wordWrap: "off",
      smoothScrolling: true,
      padding: { top: 10, bottom: 10 },
      readOnly: editor.readOnly,
      contextmenu: true,
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
    });
    editorRef.current = instance;
    const subscription = instance.onDidChangeModelContent(() => {
      const value = instance.getValue();
      if (value !== useApp.getState().editor.content) setEditorContent(value);
    });
    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      useApp.getState().saveEditor().catch(() => undefined);
    });
    instance.focus();

    return () => {
      subscription.dispose();
      instance.dispose();
      editorRef.current = null;
    };
    // Recreate only when a different file is opened; content updates are pushed
    // through setValue below so the cursor and undo stack are preserved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor.open, editor.loading, editor.path, editor.sessionId, dark]);

  useEffect(() => {
    const instance = editorRef.current;
    if (!instance) return;
    const model = instance.getModel();
    if (model && model.getValue() !== editor.content && editor.content === editor.original) {
      instance.setValue(editor.content);
    }
  }, [editor.content, editor.original]);

  const dirty = editor.content !== editor.original;
  const language = languageForFile(editor.path);

  return (
    <Dialog open={editor.open} onOpenChange={(open) => (!open ? closeEditor() : undefined)}>
      <DialogContent size="editor" className="p-0" hideClose>
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3 pr-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-soft text-brand">
            <FileCode2 className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[12.5px] font-medium text-ink">{editor.path.split("/").pop()}</span>
              {dirty ? <Badge tone="warn">{t("unsavedChanges")}</Badge> : null}
              {editor.readOnly ? <Badge tone="neutral">read-only</Badge> : null}
            </div>
            <p className="truncate font-mono text-[10px] text-mute">{editor.path}</p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            disabled={editor.loading || !editor.tabId}
            onClick={() =>
              openEditor(editor.tabId, editor.path).catch(() => undefined)
            }
            title={t("reloadFile")}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="brand"
            loading={editor.saving}
            disabled={!dirty || editor.readOnly}
            onClick={() => saveEditor().catch(() => undefined)}
            title={`${t("save")} (Ctrl+S)`}
          >
            <Save className="h-3.5 w-3.5" />
            {t("save")}
          </Button>
          <button
            onClick={closeEditor}
            className="ml-1 flex h-7 w-7 items-center justify-center rounded-md text-dim hover:bg-surface-3 hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {editor.conflict ? (
          <div className="flex items-center gap-2 border-b border-warn/30 bg-warn/10 px-3 py-2 text-[11.5px] text-warn">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <span className="font-medium">{t("conflictTitle")}</span> {t("conflictBody")}
            </div>
            <Button size="sm" variant="subtle" onClick={() => saveEditor(true).catch(() => undefined)}>
              {t("overwriteAnyway")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => openEditor(editor.tabId, editor.path).catch(() => undefined)}
            >
              {t("reloadFile")}
            </Button>
          </div>
        ) : null}

        {editor.error && !editor.conflict ? (
          <div className="border-b border-danger/30 bg-danger-soft px-3 py-1.5 text-[11.5px] text-danger">
            {editor.error}
          </div>
        ) : null}

        <div className="relative min-h-0 flex-1 bg-[#1e1e1e]">
          {editor.loading ? (
            <div className="flex h-full items-center justify-center gap-2 text-[12px] text-dim">
              <Spinner /> {t("loading")}
            </div>
          ) : null}
          <div ref={containerRef} className={cn("h-full w-full", editor.loading && "hidden")} />
        </div>

        <div className="flex h-7 shrink-0 items-center gap-3 border-t border-line bg-surface-2 px-3 text-[10px] text-mute">
          <span>{language}</span>
          <span>{editor.encoding}</span>
          <span>{formatBytes(new Blob([editor.content]).size)}</span>
          <span>{formatDate(editor.modified)}</span>
          <div className="flex-1" />
          <span>Ctrl+S {t("save")}</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

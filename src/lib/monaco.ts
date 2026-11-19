import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/language/json/json.worker?worker";
import cssWorker from "monaco-editor/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/language/html/html.worker?worker";
import tsWorker from "monaco-editor/language/typescript/ts.worker?worker";

type WorkerCtor = new () => Worker;

(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    const map: Record<string, WorkerCtor> = {
      json: jsonWorker as unknown as WorkerCtor,
      css: cssWorker as unknown as WorkerCtor,
      scss: cssWorker as unknown as WorkerCtor,
      less: cssWorker as unknown as WorkerCtor,
      html: htmlWorker as unknown as WorkerCtor,
      handlebars: htmlWorker as unknown as WorkerCtor,
      razor: htmlWorker as unknown as WorkerCtor,
      typescript: tsWorker as unknown as WorkerCtor,
      javascript: tsWorker as unknown as WorkerCtor,
    };
    const worker = map[label];
    return worker ? new worker() : new (editorWorker as unknown as WorkerCtor)();
  },
};

export function languageForFile(path: string): string {
  const name = path.split("/").pop() ?? path;
  const lower = name.toLowerCase();
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".jsonc")) return "json";
  if (/\.ya?ml$/.test(lower)) return "yaml";
  if (/\.(xml|html|htm|xhtml)$/.test(lower)) return "xml";
  if (/\.(ini|properties|conf|cfg|env)$/.test(lower)) return "ini";
  if (/\.(sh|bash|zsh)$/.test(lower)) return "shell";
  if (lower.endsWith(".bat") || lower.endsWith(".cmd")) return "bat";
  if (lower.endsWith(".ps1")) return "powershell";
  if (lower.endsWith(".toml")) return "ini";
  if (lower.endsWith(".java")) return "java";
  if (/\.(ts|tsx)$/.test(lower)) return "typescript";
  if (/\.(js|jsx|mjs|cjs)$/.test(lower)) return "javascript";
  if (lower.endsWith(".py")) return "python";
  if (lower.endsWith(".sql")) return "sql";
  if (lower.endsWith(".md")) return "markdown";
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".log")) return "plaintext";
  return "plaintext";
}

export { monaco };

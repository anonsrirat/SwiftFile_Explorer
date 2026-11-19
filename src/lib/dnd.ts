/** MIME type used for in-app drag payloads (paths from one tab to another). */
export const INTERNAL_MIME = "application/x-swiftsftp-paths";

export interface DragPayload {
  sessionId: string;
  paths: string[];
}

export function readDragPayload(event: React.DragEvent): DragPayload | null {
  const raw = event.dataTransfer.getData(INTERNAL_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DragPayload;
    if (!parsed?.sessionId || !Array.isArray(parsed.paths) || parsed.paths.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function hasInternalPayload(event: React.DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes(INTERNAL_MIME);
}

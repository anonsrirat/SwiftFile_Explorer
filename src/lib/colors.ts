/** Palette shared by the server/group colour pickers. */
export const SERVER_COLORS = [
  "#6f6cf8",
  "#2dd4bf",
  "#f59e0b",
  "#ef4444",
  "#a855f7",
  "#3b82f6",
  "#22c55e",
  "#ec4899",
  "#94a3b8",
] as const;

export const DEFAULT_GROUP_COLOR = "#6f6cf8";

export function isHexColor(value: string | null | undefined): value is string {
  return !!value && /^#[0-9a-f]{6}$/i.test(value);
}

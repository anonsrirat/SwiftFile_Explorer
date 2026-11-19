import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import type { UpdateInfo } from "./types";

/**
 * The updater checks the GitHub `latest.json` configured in `tauri.conf.json`.
 * The returned handle must be kept until the user installs, because the plugin
 * reuses the parsed release manifest.
 */
let pending: Update | null = null;

export async function fetchUpdate(): Promise<UpdateInfo | null> {
  const update = await check();
  if (!update) {
    pending = null;
    return null;
  }
  pending = update;
  return { version: update.version, notes: update.body ?? null, date: update.date ?? null };
}

export async function installPending(
  onProgress: (downloaded: number, total: number) => void,
): Promise<void> {
  const update = pending;
  if (!update) throw new Error("No update has been downloaded yet");
  let total = 0;
  let downloaded = 0;
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") {
      total = event.data.contentLength ?? 0;
      onProgress(0, total);
    } else if (event.event === "Progress") {
      downloaded += event.data.chunkLength;
      onProgress(downloaded, total);
    } else if (event.event === "Finished") {
      onProgress(total || downloaded, total || downloaded);
    }
  });
  // On Windows the NSIS installer closes the app; relaunch brings the new
  // version back up for the user.
  await relaunch();
}

export function currentVersion(): string {
  return pending?.currentVersion ?? "";
}

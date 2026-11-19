import { describe, expect, it } from "vitest";
import {
  bitmaskToPermissions,
  classifyFile,
  fileExtension,
  formatBytes,
  formatDuration,
  formatEta,
  modeToString,
  permissionsToBitmask,
} from "./utils";

describe("formatBytes", () => {
  it("formats binary units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(1024 ** 3)).toBe("1.0 GB");
  });

  it("handles invalid input", () => {
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(Number.NaN)).toBe("—");
  });
});

describe("duration helpers", () => {
  it("formats seconds", () => {
    expect(formatDuration(0.4)).toBe("<1s");
    expect(formatDuration(30)).toBe("30s");
    expect(formatDuration(90)).toBe("1m 30s");
    expect(formatDuration(3700)).toBe("1h 1m");
  });

  it("computes an ETA from speed", () => {
    expect(formatEta(1024, 0)).toBe("—");
    expect(formatEta(2048, 1024)).toBe("2s");
  });
});

describe("permissions", () => {
  it("renders POSIX mode strings", () => {
    expect(modeToString(0o644)).toBe("rw-r--r--");
    expect(modeToString(0o755)).toBe("rwxr-xr-x");
    expect(modeToString(null)).toBe("—");
  });

  it("round-trips permission masks", () => {
    expect(permissionsToBitmask(bitmaskToPermissions(0o750))).toBe(0o750);
    expect(permissionsToBitmask(bitmaskToPermissions(0o600))).toBe(0o600);
  });
});

describe("file classification", () => {
  it("classifies by extension", () => {
    expect(classifyFile({ name: "plugins", isDir: true })).toBe("folder");
    expect(classifyFile({ name: "server.properties", isDir: false })).toBe("config");
    expect(classifyFile({ name: "config.yml", isDir: false })).toBe("config");
    expect(classifyFile({ name: "screenshot.png", isDir: false })).toBe("image");
    expect(classifyFile({ name: "backup.tar.gz", isDir: false })).toBe("archive");
    expect(classifyFile({ name: "README", isDir: false })).toBe("file");
  });

  it("extracts extensions safely", () => {
    expect(fileExtension("server.properties")).toBe("properties");
    expect(fileExtension(".bashrc")).toBe("");
    expect(fileExtension("trailing.")).toBe("");
    expect(fileExtension("noext")).toBe("");
  });
});

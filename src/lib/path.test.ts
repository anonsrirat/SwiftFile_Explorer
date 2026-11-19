import { describe, expect, it } from "vitest";
import {
  breadcrumbs,
  isSubPath,
  joinRemotePath,
  normalizeRemotePath,
  parentRemotePath,
  remoteFileName,
  uniqueName,
} from "./path";

describe("normalizeRemotePath", () => {
  it("collapses duplicate and trailing separators", () => {
    expect(normalizeRemotePath("/home//user/")).toBe("/home/user");
    expect(normalizeRemotePath("/")).toBe("/");
  });

  it("resolves dot segments", () => {
    expect(normalizeRemotePath("/home/./user/../root")).toBe("/home/root");
    expect(normalizeRemotePath("/../etc")).toBe("/etc");
    expect(normalizeRemotePath("../a")).toBe("../a");
  });

  it("keeps relative paths relative", () => {
    expect(normalizeRemotePath("plugins/core")).toBe("plugins/core");
    expect(normalizeRemotePath("")).toBe(".");
  });
});

describe("joinRemotePath", () => {
  it("joins base and name", () => {
    expect(joinRemotePath("/srv", "plugins")).toBe("/srv/plugins");
    expect(joinRemotePath("/srv/", "plugins")).toBe("/srv/plugins");
  });

  it("treats absolute names as absolute", () => {
    expect(joinRemotePath("/srv", "/etc/hosts")).toBe("/etc/hosts");
  });
});

describe("parent and name", () => {
  it("walks up posix paths", () => {
    expect(parentRemotePath("/home/user/file.txt")).toBe("/home/user");
    expect(parentRemotePath("/home")).toBe("/");
    expect(parentRemotePath("/")).toBe("/");
  });

  it("extracts the last segment", () => {
    expect(remoteFileName("/home/user/สวัสดี world.txt")).toBe("สวัสดี world.txt");
    expect(remoteFileName("/")).toBe("/");
  });
});

describe("breadcrumbs", () => {
  it("builds clickable path segments", () => {
    expect(breadcrumbs("/home/user/plugins")).toEqual([
      { label: "/", path: "/" },
      { label: "home", path: "/home" },
      { label: "user", path: "/home/user" },
      { label: "plugins", path: "/home/user/plugins" },
    ]);
  });

  it("handles the root", () => {
    expect(breadcrumbs("/")).toEqual([{ label: "/", path: "/" }]);
  });
});

describe("isSubPath", () => {
  it("detects nested paths", () => {
    expect(isSubPath("/home/user/plugins", "/home/user")).toBe(true);
    expect(isSubPath("/home/user", "/home/user")).toBe(true);
    expect(isSubPath("/home/other", "/home/user")).toBe(false);
  });
});

describe("uniqueName", () => {
  it("adds a numeric suffix before the extension", () => {
    const existing = new Set(["server.properties", "server (2).properties"]);
    expect(uniqueName(existing, "server.properties")).toBe("server (3).properties");
    expect(uniqueName(existing, "other.txt")).toBe("other.txt");
  });
});

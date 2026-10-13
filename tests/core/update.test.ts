import { describe, expect, it } from "vitest";
import { isNewer, platformOf, updateFrom } from "../../src/core/update";

describe("isNewer", () => {
  it("compares each part as a number, not as text", () => {
    expect(isNewer("0.1.10", "0.1.9")).toBe(true);
    expect(isNewer("0.2.0", "0.1.99")).toBe(true);
    expect(isNewer("1.0.0", "0.9.9")).toBe(true);
  });

  it("is false for the same version or an older one", () => {
    expect(isNewer("0.1.0", "0.1.0")).toBe(false);
    expect(isNewer("0.1.0", "0.1.1")).toBe(false);
  });

  it("never claims an update from a number it cannot read", () => {
    expect(isNewer("latest", "0.1.0")).toBe(false);
    expect(isNewer("0.2", "0.1.0")).toBe(false);
    expect(isNewer("0.2.0", "dev")).toBe(false);
  });
});

describe("updateFrom", () => {
  const answer = { latest: { windows: "0.1.1", mac: null }, downloadPageUrl: "https://panel.example.com/download" };

  it("offers the newer version for this computer, with the page to get it", () => {
    expect(updateFrom(answer, "0.1.0", "win32")).toEqual({
      current: "0.1.0",
      latest: "0.1.1",
      downloadPageUrl: "https://panel.example.com/download",
    });
  });

  it("says nothing when this platform has no newer version, or none recorded", () => {
    expect(updateFrom(answer, "0.1.1", "win32")).toBeNull();
    expect(updateFrom(answer, "0.1.0", "darwin")).toBeNull();
    expect(updateFrom(answer, "0.1.0", "linux")).toBeNull();
  });

  it("keeps the notice but drops a download link that is not https", () => {
    const update = updateFrom({ ...answer, downloadPageUrl: "javascript:alert(1)" }, "0.1.0", "win32");
    expect(update?.latest).toBe("0.1.1");
    expect(update?.downloadPageUrl).toBeNull();
  });

  it("maps Electron's platform names to the installers'", () => {
    expect(platformOf("win32")).toBe("windows");
    expect(platformOf("darwin")).toBe("mac");
    expect(platformOf("linux")).toBeNull();
  });
});

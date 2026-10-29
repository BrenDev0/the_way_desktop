import { describe, expect, it } from "vitest";
import { checkFrom, describeCheck, failedCheck, isNewer, platformOf, updateFrom } from "../../src/core/update";

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
      canInstall: true,
    });
  });

  it("can be installed from the app on Windows only", () => {
    const both = { latest: { windows: "0.1.1", mac: "0.1.1" }, downloadPageUrl: "https://panel.example.com/download" };

    expect(updateFrom(both, "0.1.0", "win32")?.canInstall).toBe(true);
    expect(updateFrom(both, "0.1.0", "darwin")?.canInstall).toBe(false);
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

describe("checkFrom", () => {
  const answer = { latest: { windows: "0.1.1", mac: null }, downloadPageUrl: "https://panel.example.com/download" };

  it("reports the latest and the update when this version is behind", () => {
    const check = checkFrom(answer, "0.1.0", "win32");

    expect(check).toMatchObject({ current: "0.1.0", latest: "0.1.1", failed: false });
    expect(check.update?.latest).toBe("0.1.1");
  });

  it("reports the latest but no update when this version is current or ahead", () => {
    expect(checkFrom(answer, "0.1.1", "win32")).toMatchObject({ latest: "0.1.1", update: null, failed: false });
    expect(checkFrom(answer, "0.2.0", "win32")).toMatchObject({ latest: "0.1.1", update: null, failed: false });
  });

  it("says nothing is published for a platform that has no version recorded", () => {
    expect(checkFrom(answer, "0.1.0", "darwin")).toMatchObject({ latest: null, update: null, failed: false });
    expect(checkFrom(answer, "0.1.0", "linux")).toMatchObject({ latest: null, update: null, failed: false });
  });

  it("says nothing is published when the server knows no versions at all", () => {
    const none = { latest: { windows: null, mac: null } };

    expect(checkFrom(none, "0.1.0", "win32")).toMatchObject({ latest: null, update: null });
  });
});

describe("failedCheck", () => {
  it("is a check that could not ask, with the running version still known", () => {
    expect(failedCheck("0.1.1")).toEqual({ current: "0.1.1", latest: null, update: null, failed: true });
  });
});

describe("describeCheck", () => {
  const answer = { latest: { windows: "0.1.2", mac: null }, downloadPageUrl: "https://panel.example.com/download" };

  it("says it is checking before the first answer, with no version to show yet", () => {
    expect(describeCheck(null)).toEqual({ version: null, text: "Comprobando…", update: null });
  });

  it("offers the update, and says which version", () => {
    const said = describeCheck(checkFrom(answer, "0.1.1", "win32"));

    expect(said.version).toBe("0.1.1");
    expect(said.text).toBe("Hay una versión nueva (0.1.2).");
    expect(said.update?.downloadPageUrl).toBe("https://panel.example.com/download");
  });

  it("says it is up to date when the published version is the one running", () => {
    expect(describeCheck(checkFrom(answer, "0.1.2", "win32"))).toMatchObject({ text: "Estás al día.", update: null });
  });

  it("says nothing is published, rather than 'up to date', when no version is recorded", () => {
    const said = describeCheck(checkFrom(answer, "0.1.1", "darwin"));

    expect(said.text).toBe("Aún no hay versiones publicadas.");
    expect(said.update).toBeNull();
  });

  it("says the server could not be asked, and still shows the version", () => {
    const said = describeCheck(failedCheck("0.1.1"));

    expect(said.version).toBe("0.1.1");
    expect(said.text).toContain("No se pudo comprobar");
    expect(said.update).toBeNull();
  });

  it("never shows 'up to date' for a failed check, a missing one or a malformed published version", () => {
    expect(describeCheck(failedCheck("0.1.1")).text).not.toContain("al día");
    expect(describeCheck(null).text).not.toContain("al día");
    // a published number it cannot read is no update, and is not worth a claim either way
    expect(describeCheck(checkFrom({ latest: { windows: "latest" } }, "0.1.1", "win32")).update).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { bundleOf, versionFromPlist } from "../../src/core/bundleVersion";

describe("the version of an installed Mac app", () => {
  it("is read from its Info.plist", () => {
    const plist = `<dict><key>CFBundleName</key><string>THE WAY</string>
      <key>CFBundleShortVersionString</key>
      <string>0.1.16</string></dict>`;

    expect(versionFromPlist(plist)).toBe("0.1.16");
  });

  it("is nothing when the file does not say", () => {
    expect(versionFromPlist("<dict></dict>")).toBeNull();
  });

  it("finds the app folder from the running executable", () => {
    expect(bundleOf("/Applications/THE WAY.app/Contents/MacOS/the-way")).toBe("/Applications/THE WAY.app");
    expect(bundleOf("/Users/ana/Downloads/THE WAY.app/Contents/MacOS/the-way")).toBe("/Users/ana/Downloads/THE WAY.app");
  });

  it("finds nothing for a program that is not inside an app", () => {
    expect(bundleOf("C:\Users\ana\AppData\Local\the_way\the-way.exe")).toBeNull();
  });
});

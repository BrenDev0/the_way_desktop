import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { checkFrom, failedCheck } from "../../src/core/update";
import { UpdateLine } from "../../src/renderer/views/UpdateLine";

const answer = { latest: { windows: "0.1.2", mac: null }, downloadPageUrl: "https://panel.example.com/download" };

function html(check: Parameters<typeof UpdateLine>[0]["check"]) {
  return renderToStaticMarkup(<UpdateLine check={check} onCheck={async () => {}} />);
}

describe("the version line in the rail", () => {
  it("is always there, with a button to check, even before anything has been answered", () => {
    const shown = html(null);

    expect(shown).toContain("VERSIÓN");
    expect(shown).toContain(">BUSCAR<");
    expect(shown).toContain("Comprobando…");
    expect(shown).not.toContain("DESCARGAR");
  });

  it("shows the installed version and says it is up to date", () => {
    const shown = html(checkFrom(answer, "0.1.2", "win32"));

    expect(shown).toContain("VERSIÓN 0.1.2");
    expect(shown).toContain("Estás al día.");
    expect(shown).not.toContain("DESCARGAR");
  });

  it("on Windows offers to update from the app, naming the version, when a newer one is out", () => {
    const shown = html(checkFrom(answer, "0.1.1", "win32"));

    expect(shown).toContain("VERSIÓN 0.1.1");
    expect(shown).toContain("Hay una versión nueva (0.1.2).");
    expect(shown).toContain("ACTUALIZAR 0.1.2");
    expect(shown).not.toContain("DESCARGAR");
  });

  it("on a Mac sends the person to the download page instead", () => {
    const shown = html(checkFrom({ ...answer, latest: { windows: null, mac: "0.1.2" } }, "0.1.1", "darwin"));

    expect(shown).toContain("DESCARGAR 0.1.2");
    expect(shown).not.toContain("ACTUALIZAR");
  });

  it("does not offer a download it has no safe page for", () => {
    const unsafe = { ...answer, downloadPageUrl: "javascript:alert(1)", latest: { windows: null, mac: "0.1.2" } };
    const shown = html(checkFrom(unsafe, "0.1.1", "darwin"));

    expect(shown).toContain("Hay una versión nueva (0.1.2).");
    expect(shown).not.toContain("DESCARGAR");
  });

  it("updates from the app on Windows even with no page to send the person to", () => {
    const unsafe = { ...answer, downloadPageUrl: "javascript:alert(1)" };

    expect(html(checkFrom(unsafe, "0.1.1", "win32"))).toContain("ACTUALIZAR 0.1.2");
  });

  it("says nothing is published when the server has no version for this computer", () => {
    expect(html(checkFrom(answer, "0.1.1", "darwin"))).toContain("Aún no hay versiones publicadas.");
  });

  it("says it could not check, and keeps the version, when the server cannot be asked", () => {
    const shown = html(failedCheck("0.1.1"));

    expect(shown).toContain("VERSIÓN 0.1.1");
    expect(shown).toContain("No se pudo comprobar");
    expect(shown).not.toContain("Estás al día");
  });
});

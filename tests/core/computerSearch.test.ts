import { describe, expect, it } from "vitest";
import { foldText, hasAllTerms, rawTermsOf, snippetOf, termsOf, TEXT_FILE } from "../../src/core/computer/search";

describe("folding text for searching", () => {
  it("ignores capitals and accents, including the ñ", () => {
    expect(foldText("Contrató al ÑANDÚ")).toBe("contrato al nandu");
  });

  it("splits a query into words, folded for matching and as typed for the index", () => {
    expect(termsOf("Contrato-ACME, mayo_2026")).toEqual(["contrato", "acme", "mayo", "2026"]);
    expect(rawTermsOf("Ñandú Contrató")).toEqual(["ñandú", "contrató"]);
    expect(termsOf("  ,, ")).toEqual([]);
  });

  it("drops filler words in English and Spanish, so a long question still finds the file", () => {
    expect(termsOf("review of fingerprints of the gods")).toEqual(["review", "fingerprints", "gods"]);
    expect(rawTermsOf("la reseña de Fingerprints of the Gods")).toEqual(["reseña", "fingerprints", "gods"]);
  });

  it("keeps a query that is nothing but filler words, rather than search for nothing", () => {
    expect(termsOf("the of")).toEqual(["the", "of"]);
    expect(rawTermsOf("Y el")).toEqual(["y", "el"]);
  });

  it("needs every word", () => {
    expect(hasAllTerms("El Contrato con ACME", ["contrato", "acme"])).toBe(true);
    expect(hasAllTerms("El Contrato", ["contrato", "acme"])).toBe(false);
  });
});

describe("the line that matched", () => {
  const text = "uno\nel contrato con Acme\n   otro contrato   ";

  it("is the first line with any of the words, numbered from 1 and trimmed", () => {
    expect(snippetOf(text, ["acme"])).toEqual({ line: 2, text: "el contrato con Acme" });
    expect(snippetOf(text, ["otro"])).toEqual({ line: 3, text: "otro contrato" });
  });

  it("is nothing when no line has them", () => {
    expect(snippetOf(text, ["zzz"])).toBeNull();
  });

  it("cuts a very long line", () => {
    const long = `contrato ${"x".repeat(500)}`;

    expect(snippetOf(long, ["contrato"], 50)?.text).toBe(`${long.slice(0, 50)} ...`);
  });
});

describe("which files are text", () => {
  it("knows the usual text and code files, and not documents or pictures", () => {
    for (const name of ["a.txt", "A.MD", "b.csv", "c.json", "d.html", "e.yaml", "f.ts", "g.log"]) expect(TEXT_FILE.test(name), name).toBe(true);
    for (const name of ["a.pdf", "b.docx", "c.png", "d.exe", "txt"]) expect(TEXT_FILE.test(name), name).toBe(false);
  });
});

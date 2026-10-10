import { describe, expect, it } from "vitest";
import { MAX_EXPORT_RANGE_DAYS, exportFilename, parseExportRequest } from "@/domain/data-export";
import { ValidationError } from "@/domain/errors";

const ok = { kind: "traces", from: "2026-10-01T00:00:00Z", to: "2026-10-08T00:00:00Z" };

describe("export request (ADR-084)", () => {
  it("accepts a known kind with a range of up to 31 days", () => {
    expect(parseExportRequest(ok)).toMatchObject({ kind: "traces" });
    expect(() => parseExportRequest({ ...ok, to: "2026-11-01T00:00:00Z" })).not.toThrow();
  });

  it.each([
    ["no kind", { ...ok, kind: null }, "kind"],
    ["unknown kind", { ...ok, kind: "everything" }, "kind"],
    ["no from", { ...ok, from: null }, "from"],
    ["no to", { ...ok, to: "" }, "to"],
    ["garbage date", { ...ok, from: "yesterday-ish" }, "from"],
    ["inverted range", { ...ok, from: ok.to, to: ok.from }, "to"],
    ["empty range", { ...ok, to: ok.from }, "to"],
    ["over 31 days", { ...ok, to: "2026-11-02T00:00:00Z" }, "to"],
  ])("refuses %s", (_name, input, field) => {
    try {
      parseExportRequest(input);
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect(Object.keys((error as ValidationError).fields)).toContain(field);
    }
  });

  it("there is no way to export without a range", () => {
    expect(() => parseExportRequest({ kind: "traces", from: undefined, to: undefined })).toThrow(ValidationError);
    expect(MAX_EXPORT_RANGE_DAYS).toBe(31);
  });

  it("builds a safe filename", () => {
    const request = parseExportRequest(ok);
    expect(exportFilename("weather/../assistant", request)).toBe("weather_.._assistant-traces-2026-10-01_2026-10-08.jsonl");
    expect(exportFilename('a"b', request)).not.toContain('"');
  });
});

import { describe, expect, it } from "vitest";
import { mergeLatestConversations, mergeLatestTraces as mergeLatest } from "@/domain/merge";
import { summary } from "../fakes";

const at = (id: string, iso: string, extra = {}) => summary({ traceId: id.padEnd(32, "0"), startTime: iso, ...extra });
const ids = (list: { traceId: string }[]) => list.map((t) => t.traceId[0]);

describe("mergeLatest", () => {
  it("replaces everything when the latest page is the whole result set", () => {
    const current = [at("a", "2026-01-01T10:00:00Z"), at("b", "2026-01-01T09:00:00Z")];
    const latest = { items: [at("c", "2026-01-01T11:00:00Z"), at("a", "2026-01-01T10:00:00Z")], nextCursor: null };
    const merged = mergeLatest(current, "cur", latest);
    expect(ids(merged.items)).toEqual(["c", "a"]);
    expect(merged.nextCursor).toBeNull();
    expect(merged.newKeys.map((i) => i[0])).toEqual(["c"]);
  });

  it("keeps the pages loaded with 'load more' and puts new traces on top", () => {
    // el usuario tenía 4 cargadas (2 páginas de 2); llega una nueva y la primera página se desplaza
    const current = [at("d", "2026-01-01T10:03:00Z"), at("c", "2026-01-01T10:02:00Z"), at("b", "2026-01-01T10:01:00Z"), at("a", "2026-01-01T10:00:00Z")];
    const latest = { items: [at("e", "2026-01-01T10:04:00Z"), at("d", "2026-01-01T10:03:00Z")], nextCursor: "next-of-first-page" };
    const merged = mergeLatest(current, "end-of-loaded", latest);
    expect(ids(merged.items)).toEqual(["e", "d", "c", "b", "a"]);
    expect(merged.nextCursor).toBe("end-of-loaded"); // sigue paginando desde donde el usuario lo dejó
    expect(merged.newKeys.map((i) => i[0])).toEqual(["e"]);
  });

  it("uses the fresh version of a trace that already existed", () => {
    const current = [at("a", "2026-01-01T10:00:00Z", { spanCount: 1 })];
    const latest = { items: [at("a", "2026-01-01T10:00:00Z", { spanCount: 9 })], nextCursor: "n" };
    expect(mergeLatest(current, null, latest).items[0]!.spanCount).toBe(9);
  });

  it("only the first page loaded: continues from the latest page's cursor", () => {
    const current = [at("b", "2026-01-01T10:01:00Z"), at("a", "2026-01-01T10:00:00Z")];
    const latest = { items: [at("c", "2026-01-01T10:02:00Z"), at("b", "2026-01-01T10:01:00Z")], nextCursor: "n1" };
    const merged = mergeLatest(current, "n0", latest);
    expect(ids(merged.items)).toEqual(["c", "b", "a"]);
    expect(merged.nextCursor).toBe("n0");
  });

  it("handles an empty latest page", () => {
    expect(mergeLatest([at("a", "2026-01-01T10:00:00Z")], "c", { items: [], nextCursor: null })).toEqual({ items: [], nextCursor: null, newKeys: [] });
  });
});

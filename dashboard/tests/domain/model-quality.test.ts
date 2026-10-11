import { describe, expect, it } from "vitest";
import type { ModelQualityItemDto } from "@contract";
import { compareElo, eloBarWidth, eloScale, inScope, parseScope, qualityCell, snapshotNote } from "@/domain/model-quality";

const item = (over: Partial<ModelQualityItemDto> = {}): ModelQualityItemDto => ({
  modelId: "m", modelKey: "m", state: "matched", inUse: false, candidate: null, candidateCount: 0, via: null,
  quality: { arenaName: "m", elo: 1483, ci: 4, rank: 15, votes: 66315, origin: "exact", stale: false }, ...over,
});

describe("qualityCell", () => {
  it("shows the score of a matched model", () => {
    expect(qualityCell(item(), true)).toEqual({ kind: "score", elo: 1483, ci: 4, rank: 15, votes: 66315, arenaName: "m", via: null, confirmed: false, stale: false });
  });
  it("tells a person-confirmed score from an exact one, and keeps where a copy inherits from", () => {
    const cell = qualityCell(item({ via: "gpt-5.2", quality: { arenaName: "gpt-5.2", elo: 1412, ci: 3, rank: 135, votes: 1, origin: "confirmed", stale: true } }), true);
    expect(cell).toMatchObject({ kind: "score", confirmed: true, stale: true, via: "gpt-5.2" });
  });
  it("offers the nearest candidate to confirm", () => {
    const cell = qualityCell(item({ state: "candidate", quality: null, candidateCount: 2, candidate: { arenaName: "m-2025", elo: 1, ci: 1, rank: 1, votes: 1, reason: "" } }), true);
    expect(cell).toEqual({ kind: "candidate", arenaName: "m-2025", count: 2 });
  });
  it("says no equivalent when somebody decided so, and none when the API has nothing", () => {
    expect(qualityCell(item({ state: "no_equivalent", quality: null }), true)).toEqual({ kind: "no_equivalent" });
    expect(qualityCell(undefined, true)).toEqual({ kind: "none" });
    expect(qualityCell(item({ state: "none", quality: null, inUse: true }), true)).toEqual({ kind: "none" });
  });
  it("is unavailable when the scores could not be loaded", () => {
    expect(qualityCell(item(), false)).toEqual({ kind: "unavailable" });
  });
});

describe("scope", () => {
  it("reads the scope from the url and falls back to all", () => {
    expect(parseScope("in_use")).toBe("in_use");
    expect(parseScope("review")).toBe("review");
    expect(parseScope("nonsense")).toBe("all");
    expect(parseScope(undefined)).toBe("all");
    expect(parseScope(["in_use"])).toBe("all");
  });
  it("filters by use and by pending review; a model the API does not list is neither", () => {
    expect(inScope("all", undefined)).toBe(true);
    expect(inScope("in_use", undefined)).toBe(false);
    expect(inScope("in_use", item({ inUse: true }))).toBe(true);
    expect(inScope("review", item({ state: "candidate", quality: null }))).toBe(true);
    expect(inScope("review", item())).toBe(false);
  });
});

describe("sorting and bars", () => {
  it("sorts by Elo in both directions with unscored models always last", () => {
    const a = item({ quality: { arenaName: "a", elo: 1400, ci: 1, rank: 1, votes: 1, origin: "exact", stale: false } });
    const b = item({ quality: { arenaName: "b", elo: 1500, ci: 1, rank: 1, votes: 1, origin: "exact", stale: false } });
    const none = undefined;
    expect([a, none, b].sort((x, y) => compareElo(x, y, -1))).toEqual([b, a, none]);
    expect([a, none, b].sort((x, y) => compareElo(x, y, 1))).toEqual([a, b, none]);
  });
  it("scales the bar between the lowest and highest Elo with a margin so the lowest is still visible", () => {
    const items = [item({ quality: { arenaName: "a", elo: 1400, ci: 1, rank: 1, votes: 1, origin: "exact", stale: false } }), item()];
    const scale = eloScale(items);
    expect(scale).not.toBeNull();
    expect(eloBarWidth(1483, scale)).toBe("100%");
    const low = parseInt(eloBarWidth(1400, scale), 10);
    expect(low).toBeGreaterThanOrEqual(4);
    expect(low).toBeLessThan(40);
  });
  it("has no scale without scores and draws a full bar when every score is the same", () => {
    expect(eloScale([item({ quality: null, state: "none" })])).toBeNull();
    expect(eloBarWidth(1400, null)).toBe("100%");
    expect(eloBarWidth(1483, { lo: 1483, hi: 1483 })).toBe("100%");
  });
});

describe("snapshotNote", () => {
  it("writes the date of the leaderboard, or nothing before the first sync", () => {
    expect(snapshotNote("2026-10-08T00:00:00.000Z")).toBe("8 Oct 2026");
    expect(snapshotNote(null)).toBe("");
  });
});

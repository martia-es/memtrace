import { describe, expect, it } from "vitest";
import { candidateBase, candidatesFor, isPending, modelKey, resolveModelQuality, squash, type ArenaModel, type MatchDecision } from "@/domain/model-quality";

const arenaModel = (modelName: string, rating: number, voteCount: number, rank: number, publishedAtMs = 2): ArenaModel => ({
  modelName,
  organization: "x",
  license: "Proprietary",
  rating,
  ratingLower: rating - 4,
  ratingUpper: rating + 4,
  voteCount,
  rank,
  publishedAtMs,
  updatedAtMs: publishedAtMs,
});

// nombres y puntuaciones reales del leaderboard de texto de Arena (8 oct 2026)
const ARENA: ArenaModel[] = [
  arenaModel("claude-opus-4-7", 1483, 66315, 15),
  arenaModel("claude-opus-4-7-high", 1490, 65192, 11),
  arenaModel("claude-sonnet-4-5-20250929", 1439, 82735, 79),
  arenaModel("claude-sonnet-4-5-20250929-high-32k", 1435, 83973, 88),
  arenaModel("gemini-3-flash", 1466, 31337, 35),
  arenaModel("gemini-3-flash (thinking-minimal)", 1442, 91105, 69),
  arenaModel("gpt-5.2", 1412, 83928, 135),
  arenaModel("gpt-5.2-chat-latest-20260210", 1439, 36007, 78),
  arenaModel("claude-fable-5.1-max", 1500, 1000, 1),
];

describe("modelKey", () => {
  it.each([
    ["azure/gpt-5.2", "gpt-5.2"],
    ["openrouter/anthropic/claude-3.5-sonnet", "claude-3.5-sonnet"],
    ["bedrock/us.anthropic.claude-3-5-sonnet-20241022-v2:0", "claude-3-5-sonnet-20241022"],
    ["anthropic.claude-opus-5", "claude-opus-5"],
    ["vertex_ai/claude-opus-4-1@20250805", "claude-opus-4-1-20250805"],
    ["Gemini-3-Flash (thinking-minimal)", "gemini-3-flash-thinking-minimal"],
    ["qwen3.5-max", "qwen3.5-max"],
    ["  GPT-5.2 ", "gpt-5.2"],
  ])("%s -> %s", (name, key) => expect(modelKey(name)).toBe(key));

  it("treats 3-5 and 3.5 as the same model", () => expect(squash(modelKey("claude-3-5-sonnet"))).toBe(squash(modelKey("claude-3.5-sonnet"))));
});

describe("candidateBase", () => {
  it.each([
    ["claude-opus-4-7-high", "claude-opus-4-7"],
    ["claude-sonnet-4-5-20250929-high-32k", "claude-sonnet-4-5"],
    ["gemini-3-flash-thinking-minimal", "gemini-3-flash"],
    ["gemini-3-flash-preview", "gemini-3-flash"],
    ["gpt-5.2-chat-latest-20260210", "gpt-5.2"],
    ["o1-2024-12-17", "o1"],
    ["grok-3-preview-02-24", "grok-3"],
    ["amazon-nova-experimental-chat-26-02-10", "amazon-nova"],
    ["ernie-5.0-0110", "ernie-5.0"],
    ["qwen3-235b-a22b-no-thinking", "qwen3-235b-a22b"],
    ["deepseek-v4-pro-high-20260813", "deepseek-v4-pro"],
  ])("%s -> %s", (key, base) => expect(candidateBase(key).base).toBe(base));

  it("never strips a name down to nothing", () => {
    expect(candidateBase("max").base).toBe("max");
    expect(candidateBase("gpt-4").base).toBe("gpt-4");
    expect(candidateBase("claude-3-5").base).toBe("claude-3-5");
  });
});

describe("resolveModelQuality", () => {
  const resolve = (pricingIds: string[], decisions: MatchDecision[] = [], usedModels: string[] = []) => resolveModelQuality({ pricingIds, arena: ARENA, decisions, usedModels });
  const one = (id: string, decisions: MatchDecision[] = [], used: string[] = []) => resolve([id], decisions, used).rows[0]!;

  it("matches an identical name with no question", () => {
    const row = one("claude-opus-4-7");
    expect(row.state).toBe("matched");
    expect(row.quality).toMatchObject({ arenaName: "claude-opus-4-7", elo: 1483, ci: 4, rank: 15, votes: 66315, origin: "exact", stale: false });
    expect(row.candidate).toBeNull();
  });

  it("does not silently pick an effort variant: the plain name wins and the variant is not offered", () => {
    expect(one("claude-opus-4-7").quality?.arenaName).toBe("claude-opus-4-7");
  });

  it("shares the match with provider-prefixed copies", () => {
    const row = one("azure/gpt-5.2");
    expect(row).toMatchObject({ state: "matched", modelKey: "gpt-5.2", via: "gpt-5.2" });
    expect(one("gpt-5.2").via).toBeNull();
  });

  it("offers a candidate, nearest name first, when only a suffix or date differs", () => {
    const row = one("claude-sonnet-4-5");
    expect(row.state).toBe("candidate");
    expect(row.quality).toBeNull();
    expect(row.candidate).toMatchObject({ arenaName: "claude-sonnet-4-5-20250929", elo: 1439, reason: "Same name plus “20250929”" });
    expect(row.candidateCount).toBe(2);
    expect(candidatesFor("claude-sonnet-4-5", ARENA).map((c) => c.arenaName)).toEqual(["claude-sonnet-4-5-20250929", "claude-sonnet-4-5-20250929-high-32k"]);
  });

  it("explains a suffix on the catalog side", () => {
    expect(one("gemini-3-flash-preview").candidate).toMatchObject({ arenaName: "gemini-3-flash", reason: "Same name without “preview”" });
    expect(one("gpt-5.2-chat-latest").candidate?.arenaName).toBe("gpt-5.2-chat-latest-20260210");
  });

  it("matches nothing it cannot explain", () => {
    expect(one("mistral-large")).toMatchObject({ state: "none", quality: null, candidate: null, candidateCount: 0 });
  });

  it("a confirmed decision shows that entry", () => {
    const row = one("claude-sonnet-4-5", [{ modelKey: "claude-sonnet-4-5", arenaModelName: "claude-sonnet-4-5-20250929-high-32k", decision: "confirmed" }]);
    expect(row.state).toBe("matched");
    expect(row.quality).toMatchObject({ arenaName: "claude-sonnet-4-5-20250929-high-32k", elo: 1435, origin: "confirmed" });
  });

  it("a confirmed decision beats an exact match", () => {
    const row = one("claude-opus-4-7", [{ modelKey: "claude-opus-4-7", arenaModelName: "claude-opus-4-7-high", decision: "confirmed" }]);
    expect(row.quality).toMatchObject({ arenaName: "claude-opus-4-7-high", elo: 1490, origin: "confirmed" });
  });

  it("a rejected candidate is never offered again", () => {
    const decisions: MatchDecision[] = [{ modelKey: "claude-sonnet-4-5", arenaModelName: "claude-sonnet-4-5-20250929", decision: "rejected" }];
    const row = one("claude-sonnet-4-5", decisions);
    expect(row.candidate?.arenaName).toBe("claude-sonnet-4-5-20250929-high-32k");
    expect(row.candidateCount).toBe(1);
    const both = [...decisions, { modelKey: "claude-sonnet-4-5", arenaModelName: "claude-sonnet-4-5-20250929-high-32k", decision: "rejected" as const }];
    expect(one("claude-sonnet-4-5", both).state).toBe("none");
  });

  it("no_equivalent silences the model", () => {
    const row = one("claude-sonnet-4-5", [{ modelKey: "claude-sonnet-4-5", arenaModelName: "", decision: "no_equivalent" }]);
    expect(row).toMatchObject({ state: "no_equivalent", quality: null, candidate: null });
  });

  it("a confirmed entry that left the leaderboard keeps its last score and is marked stale", () => {
    const arena = [...ARENA, arenaModel("old-model", 1300, 10, 300, 1)];
    const { rows } = resolveModelQuality({ pricingIds: ["old-model"], arena, decisions: [], usedModels: [] });
    expect(rows[0]!.quality).toMatchObject({ elo: 1300, stale: true });
  });

  it("a decision pointing at an entry that no longer exists falls back to the automatic match", () => {
    const row = one("gpt-5.2", [{ modelKey: "gpt-5.2", arenaModelName: "gone", decision: "confirmed" }]);
    expect(row.quality?.arenaName).toBe("gpt-5.2");
  });

  it("marks a model in use even when the trace carries a dated name", () => {
    const rows = resolve(["gpt-5.2", "claude-opus-4-7"], [], ["gpt-5.2-2025-12-11", "azure/claude-opus-4-7-high"]).rows;
    expect(rows.map((r) => r.inUse)).toEqual([true, true]);
    expect(resolve(["gpt-5.2"], [], ["gemini-3-flash"]).rows[0]!.inUse).toBe(false);
  });

  it("a model is pending only with candidates, no decision and in use", () => {
    expect(isPending(one("claude-sonnet-4-5", [], ["claude-sonnet-4-5"]))).toBe(true);
    expect(isPending(one("claude-sonnet-4-5"))).toBe(false);
    expect(isPending(one("gpt-5.2", [], ["gpt-5.2"]))).toBe(false);
    const decided = one("claude-sonnet-4-5", [{ modelKey: "claude-sonnet-4-5", arenaModelName: "claude-sonnet-4-5-20250929", decision: "confirmed" }], ["claude-sonnet-4-5"]);
    expect(isPending(decided)).toBe(false);
  });
});

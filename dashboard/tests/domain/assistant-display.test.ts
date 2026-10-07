import { describe, expect, it } from "vitest";
import { allowedModes, assistantDisplayName, fullscreenPath, parseFullscreenQuery, resolveMode } from "@/domain/assistant-display";

const theme = (over: Partial<Parameters<typeof resolveMode>[0] & object> = {}) => ({ assistantName: null, assistantDefaultMode: null, assistantAllowedModes: null, ...over });

describe("resolveMode", () => {
  it("falls back to the bubble when nothing is configured", () => {
    expect(resolveMode(null, null)).toBe("bubble");
    expect(resolveMode(theme(), null)).toBe("bubble");
  });
  it("uses the organization default when the user has no preference", () => {
    expect(resolveMode(theme({ assistantDefaultMode: "dock" }), null)).toBe("dock");
  });
  it("lets the user pick any allowed mode", () => {
    expect(resolveMode(theme({ assistantDefaultMode: "dock" }), "fullscreen")).toBe("fullscreen");
  });
  it("ignores a user preference the organization does not allow", () => {
    expect(resolveMode(theme({ assistantAllowedModes: ["dock", "fullscreen"], assistantDefaultMode: "dock" }), "bubble")).toBe("dock");
  });
  it("uses the first allowed mode when the default is not allowed", () => {
    expect(resolveMode(theme({ assistantAllowedModes: ["fullscreen"], assistantDefaultMode: "dock" }), null)).toBe("fullscreen");
  });
});

describe("allowedModes", () => {
  it("treats an empty list as all modes and keeps canonical order", () => {
    expect(allowedModes(theme({ assistantAllowedModes: [] }))).toEqual(["bubble", "dock", "fullscreen"]);
    expect(allowedModes(theme({ assistantAllowedModes: ["fullscreen", "bubble"] }))).toEqual(["bubble", "fullscreen"]);
  });
});

describe("assistantDisplayName", () => {
  it("prefers the organization name and ignores blanks", () => {
    expect(assistantDisplayName(theme({ assistantName: "Aria" }), "weather")).toBe("Aria");
    expect(assistantDisplayName(theme({ assistantName: "  " }), "weather")).toBe("weather");
  });
});

describe("fullscreen target", () => {
  it("round-trips through the URL", () => {
    const target = { experimentId: "e1", deploymentId: "d1", agentName: "Weather & Co", environmentLabel: "PRO" };
    const query = Object.fromEntries(new URLSearchParams(fullscreenPath(target).split("?")[1]));
    expect(parseFullscreenQuery(query)).toEqual(target);
  });
  it("rejects incomplete queries", () => {
    expect(parseFullscreenQuery({ experimentId: "e1" })).toBeNull();
  });
});

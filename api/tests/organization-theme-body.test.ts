import { describe, expect, it } from "vitest";
import { organizationThemeBody } from "@/adapters/inbound/http/identity-schemas";

const base = { accentColor: null, radiusPreset: null };

describe("organizationThemeBody", () => {
  it("accepts the legacy 2-field body and fills the new fields with null", () => {
    const parsed = organizationThemeBody.parse(base);
    expect(parsed).toMatchObject({ secondaryColor: null, fontPreset: null, assistantName: null, assistantDefaultMode: null, assistantAllowedModes: null });
  });

  it("accepts a full assistant configuration", () => {
    const parsed = organizationThemeBody.parse({ ...base, fontPreset: "serif", assistantName: " Aria ", assistantAllowedModes: ["dock", "fullscreen"], assistantDefaultMode: "dock" });
    expect(parsed.assistantName).toBe("Aria");
  });

  it("rejects a default mode that is not allowed", () => {
    expect(organizationThemeBody.safeParse({ ...base, assistantAllowedModes: ["dock"], assistantDefaultMode: "bubble" }).success).toBe(false);
  });

  it("rejects an empty allowed list, unknown fonts and long names", () => {
    expect(organizationThemeBody.safeParse({ ...base, assistantAllowedModes: [] }).success).toBe(false);
    expect(organizationThemeBody.safeParse({ ...base, fontPreset: "comic" }).success).toBe(false);
    expect(organizationThemeBody.safeParse({ ...base, assistantName: "x".repeat(41) }).success).toBe(false);
  });
});

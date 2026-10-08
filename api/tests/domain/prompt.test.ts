import { describe, expect, it } from "vitest";
import { ValidationError } from "@/domain/errors";
import { extractVariables, isEnvironmentTag, validateContent, validateMessage, validatePromptName, validateTag } from "@/domain/prompt";

describe("prompt names and tags (ADR-067)", () => {
  it("accepts slug-like names and trims them", () => {
    expect(validatePromptName("  weather-system.v2 ")).toBe("weather-system.v2");
  });

  it.each(["", "Weather", "-weather", "has space", "a".repeat(65)])("rejects the name %j", (name) => {
    expect(() => validatePromptName(name)).toThrow(ValidationError);
  });

  it("accepts lowercase tags that start with a letter", () => {
    expect(validateTag("pro")).toBe("pro");
    expect(validateTag("release-2026_q4")).toBe("release-2026_q4");
  });

  it.each(["", "1st", "Pro", "a".repeat(33), "has space"])("rejects the tag %j", (tag) => {
    expect(() => validateTag(tag)).toThrow(ValidationError);
  });

  it("recognizes environment tags from the organization's environment keys", () => {
    expect(isEnvironmentTag("pro", ["dev", "pre", "pro"])).toBe(true);
    expect(isEnvironmentTag("stable", ["dev", "pre", "pro"])).toBe(false);
  });
});

describe("prompt content", () => {
  it("rejects empty or blank text and keeps the text as written", () => {
    expect(() => validateContent("  \n ")).toThrow(ValidationError);
    expect(validateContent("  Eres un asistente.\n")).toBe("  Eres un asistente.\n");
  });

  it("rejects text over the limit", () => {
    expect(() => validateContent("x".repeat(100_001))).toThrow(ValidationError);
  });

  it("limits the commit message", () => {
    expect(validateMessage(undefined)).toBe("");
    expect(validateMessage("  fix tone ")).toBe("fix tone");
    expect(() => validateMessage("m".repeat(501))).toThrow(ValidationError);
  });
});

describe("variables", () => {
  it("extracts {{name}} variables once each, in order, tolerating spaces", () => {
    expect(extractVariables("Hola {{ nombre }}, hoy en {{ciudad}} hace sol, {{nombre}}.")).toEqual(["nombre", "ciudad"]);
  });

  it("ignores things that are not valid variable names", () => {
    expect(extractVariables("{{}} {{ 1abc }} {{a-b}} {single}")).toEqual([]);
  });
});

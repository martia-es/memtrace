import { describe, expect, it } from "vitest";
import { deployMarker, deployRunIdFromTitle, missingDeploySetup, parseGithubRepo, statusFromWorkflowRun, validateBypassReason } from "@/domain/deploy";
import { ValidationError } from "@/domain/errors";

const repo = { url: "https://github.com/acme/weather", provider: "github" as const, deployWorkflow: "deploy.yml" };

describe("deploy rules (ADR-064)", () => {
  it("asks for repo, workflow and branch, in that order", () => {
    expect(missingDeploySetup(null, "main")).toContain("source repository");
    expect(missingDeploySetup({ ...repo, deployWorkflow: null }, "main")).toContain("deploy workflow");
    expect(missingDeploySetup(repo, null)).toContain("branch or tag");
    expect(missingDeploySetup(repo, "main")).toBeNull();
  });

  it("requires a written reason to skip the gate", () => {
    expect(validateBypassReason("  prod is down, hotfix  ")).toBe("prod is down, hotfix");
    expect(() => validateBypassReason("")).toThrow(ValidationError);
    expect(() => validateBypassReason("no")).toThrow(ValidationError);
    expect(() => validateBypassReason(null)).toThrow(ValidationError);
  });

  it("reads owner and name from a GitHub URL", () => {
    expect(parseGithubRepo("https://github.com/acme/weather.git")).toEqual({ owner: "acme", repo: "weather" });
    expect(parseGithubRepo("https://github.com/acme")).toBeNull();
    expect(parseGithubRepo("https://github.com/a/b/c")).toBeNull();
    expect(parseGithubRepo("nope")).toBeNull();
  });

  it("links a workflow run back to its deployment through the run name", () => {
    const id = "0b9a3f10-1f6c-4a7e-9b2d-5d3c1e8f7a64";
    expect(deployRunIdFromTitle(`Deploy ${deployMarker(id)} to pro`)).toBe(id);
    expect(deployRunIdFromTitle(`DEPLOY:${id.toUpperCase()}`)).toBe(id);
    expect(deployRunIdFromTitle("Fix typo")).toBeNull();
    expect(deployRunIdFromTitle(null)).toBeNull();
  });

  it("maps a workflow run to a deploy status", () => {
    expect(statusFromWorkflowRun("completed", "success")).toBe("succeeded");
    expect(statusFromWorkflowRun("completed", "cancelled")).toBe("cancelled");
    expect(statusFromWorkflowRun("completed", "failure")).toBe("failed");
    expect(statusFromWorkflowRun("completed", "timed_out")).toBe("failed");
    expect(statusFromWorkflowRun("in_progress", null)).toBe("running");
    expect(statusFromWorkflowRun("queued", null)).toBe("queued");
  });
});

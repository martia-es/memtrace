import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import CiSetup from "@/ui/components/assistants/CiSetup.vue";
import { buildCommand } from "@/domain/ci-snippet";

describe("CI setup snippet (ADR-065)", () => {
  it("builds the image with the commit as a build-arg, with each CI's own variable", () => {
    expect(buildCommand("github")).toBe("docker build --build-arg GIT_SHA=${{ github.sha }} -t my-assistant .");
    expect(buildCommand("gitlab")).toContain("$CI_COMMIT_SHA");
    expect(buildCommand("bitbucket")).toContain("$BITBUCKET_COMMIT");
  });

  it("starts with the provider of the agent's repository and lets the user switch", async () => {
    const wrapper = mount(CiSetup, { props: { repo: { url: "https://gitlab.com/acme/w", provider: "gitlab", deployWorkflow: null } } });
    expect(wrapper.get('[data-testid="ci-build"]').text()).toContain("$CI_COMMIT_SHA");
    await wrapper.findAll(".providers button")[0]!.trigger("click");
    expect(wrapper.get('[data-testid="ci-build"]').text()).toContain("github.sha");
    expect(wrapper.get('[data-testid="ci-dockerfile"]').text()).toContain("ENV GIT_SHA=$GIT_SHA");
  });

  it("defaults to GitHub without a repository", () => {
    expect(mount(CiSetup, { props: { repo: null } }).get('[data-testid="ci-build"]').text()).toContain("github.sha");
  });
});

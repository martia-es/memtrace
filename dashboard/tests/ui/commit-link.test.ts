import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import CommitLink from "@/ui/components/CommitLink.vue";
import { commitUrl } from "@/domain/assistants";

const SHA = "3a08213f9b1c2d4e5f60718293a4b5c6d7e8f901";
const github = { url: "https://github.com/acme/weather", provider: "github" as const, deployWorkflow: null };

describe("CommitLink (ADR-065)", () => {
  it("links the short SHA to the commit when the agent declares its repository", () => {
    const wrapper = mount(CommitLink, { props: { revision: SHA, repo: github } });
    const a = wrapper.get("a");
    expect(a.text()).toBe("3a08213");
    expect(a.attributes("href")).toBe(`https://github.com/acme/weather/commit/${SHA}`);
    expect(a.attributes("rel")).toContain("noopener");
  });

  it("shows plain text without a repository, and a dash without a version", () => {
    expect(mount(CommitLink, { props: { revision: SHA } }).find("a").exists()).toBe(false);
    expect(mount(CommitLink, { props: { revision: SHA } }).text()).toBe("3a08213");
    expect(mount(CommitLink, { props: { revision: null, repo: github } }).text()).toBe("–");
  });

  it("marks a run evaluated with uncommitted changes", () => {
    expect(mount(CommitLink, { props: { revision: SHA, dirty: true } }).text()).toContain("✱");
  });

  it("builds the commit URL for each provider", () => {
    expect(commitUrl({ url: "https://gitlab.com/a/b.git", provider: "gitlab" }, SHA)).toBe(`https://gitlab.com/a/b/-/commit/${SHA}`);
    expect(commitUrl({ url: "https://bitbucket.org/a/b/", provider: "bitbucket" }, SHA)).toBe(`https://bitbucket.org/a/b/commits/${SHA}`);
    expect(commitUrl(null, SHA)).toBeNull();
  });
});

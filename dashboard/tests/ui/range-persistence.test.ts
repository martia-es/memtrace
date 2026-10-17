import { beforeEach, describe, expect, it } from "vitest";
import { defineComponent } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { useFilters } from "@/ui/composables/useFilters";

async function setup(path: string) {
  let f!: ReturnType<typeof useFilters>;
  const Probe = defineComponent({ setup: () => ((f = useFilters()), () => null) });
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", component: Probe }] });
  await router.push(path);
  mount(Probe, { global: { plugins: [router] } });
  return { f, router };
}

describe("range persistence", () => {
  beforeEach(() => sessionStorage.clear());

  it("keeps the chosen preset when navigating to a URL without range", async () => {
    const { f, router } = await setup("/a");
    f.setRange("7d");
    await flushPromises();
    await router.push("/b");
    expect(f.range.value).toBe("7d");
    expect(f.shared.value).toEqual({ range: "7d" });
  });

  it("keeps a custom range across views", async () => {
    const { f, router } = await setup("/a");
    f.setCustomRange({ from: "2026-10-01", to: "2026-10-05" });
    await flushPromises();
    await router.push("/b");
    expect(f.range.value).toBe("custom");
    expect(f.customRange.value).toEqual({ from: "2026-10-01", to: "2026-10-05" });
  });

  it("choosing the default preset overrides the stored one", async () => {
    const { f, router } = await setup("/a?range=7d");
    f.setRange("1h");
    await flushPromises();
    await router.push("/b");
    expect(f.range.value).toBe("1h");
  });
});

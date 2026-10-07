import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { Quasar } from "quasar";
import ConversationPreview from "@/ui/components/ConversationPreview.vue";

let mounted: VueWrapper | undefined;
beforeEach(() => localStorage.clear());
afterEach(() => mounted?.unmount());

const mountPreview = () => {
  mounted = mount(ConversationPreview, { props: { title: "t", subtitle: "s", stats: [], messages: [] }, global: { plugins: [[Quasar, {}]] } });
  return mounted;
};
const widthOf = (w: VueWrapper) => (w.find("aside").element as HTMLElement).style.width;

describe("ConversationPreview resizing", () => {
  it("starts at 500px, widens with the arrow keys, remembers it and resets on double click", async () => {
    const w = mountPreview();
    expect(widthOf(w)).toBe("500px");
    await w.find('[data-testid="preview-resize"]').trigger("keydown", { key: "ArrowLeft" });
    expect(widthOf(w)).toBe("540px");
    expect(localStorage.getItem("mt.preview.width")).toBe("540");
    await w.find('[data-testid="preview-resize"]').trigger("dblclick");
    expect(widthOf(w)).toBe("500px");
  });

  it("never gets narrower than 400px and restores the saved width", async () => {
    localStorage.setItem("mt.preview.width", "420");
    const w = mountPreview();
    expect(widthOf(w)).toBe("420px");
    await w.find('[data-testid="preview-resize"]').trigger("keydown", { key: "ArrowRight" });
    expect(widthOf(w)).toBe("400px");
  });
});

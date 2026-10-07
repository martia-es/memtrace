import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { Dark, Quasar } from "quasar";
import type { TraceFeedbackResponse } from "@contract";
import { TRACE_API } from "@/dependency-container";
import TraceFeedbackStrip from "@/ui/components/TraceFeedbackStrip.vue";
import { FakeTraceApi } from "../../fakes";

const vote = (rating: 1 | -1, comment: string | null = null) => ({ rating, comment, spanId: null, endUserId: null, externalMessageId: null, createdAt: "2026-10-06T10:00:00.000Z" });

async function mountStrip(feedback: TraceFeedbackResponse) {
  const api = new FakeTraceApi();
  api.feedback = feedback;
  const wrapper = mount(TraceFeedbackStrip, { props: { traceId: "t1" }, global: { plugins: [[Quasar, { plugins: { Dark } }]], provide: { [TRACE_API as symbol]: api } } });
  await flushPromises();
  return wrapper;
}

describe("TraceFeedbackStrip", () => {
  it("renders nothing when nobody voted", async () => {
    const wrapper = await mountStrip({ votes: [], alignment: "unknown" });
    expect(wrapper.find("[data-testid='trace-feedback']").exists()).toBe(false);
  });

  it("shows the counts, the comments and a red strip for a thumbs down that disagrees with the reviewers", async () => {
    const wrapper = await mountStrip({ votes: [vote(-1, "wrong city")], alignment: "misaligned" });
    const strip = wrapper.get("[data-testid='trace-feedback']");
    expect(strip.classes()).toContain("error");
    expect(strip.get(".counts").attributes("aria-label")).toBe("0 positive, 1 negative");
    expect(strip.text()).toContain("wrong city");
    expect(wrapper.get("[data-testid='feedback-alignment']").text()).toBe("Disagrees with the reviewers");
  });

  it("is green when thumbs up win and says nothing about alignment without a review", async () => {
    const wrapper = await mountStrip({ votes: [vote(1), vote(1), vote(-1)], alignment: "unknown" });
    expect(wrapper.get("[data-testid='trace-feedback']").classes()).toContain("ok");
    expect(wrapper.find("[data-testid='feedback-alignment']").exists()).toBe(false);
  });
});

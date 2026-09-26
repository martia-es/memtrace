import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import AgentSelect from "@/ui/components/AgentSelect.vue";

describe("AgentSelect", () => {
  it("renders with default placeholder", () => {
    const wrapper = mount(AgentSelect, {
      props: {
        modelValue: null,
        options: [],
      },
    });

    const trigger = wrapper.find(".select-trigger");
    expect(trigger.text()).toContain("Seleccionar agente");
  });

  it("displays selected value", () => {
    const wrapper = mount(AgentSelect, {
      props: {
        modelValue: "service-1",
        options: ["service-1", "service-2"],
      },
    });

    const trigger = wrapper.find(".select-trigger");
    expect(trigger.text()).toContain("service-1");
  });

  it("opens menu when trigger is clicked", async () => {
    const wrapper = mount(AgentSelect, {
      props: {
        modelValue: null,
        options: ["service-1", "service-2"],
      },
    });

    const trigger = wrapper.find(".select-trigger");
    await trigger.trigger("click");

    expect(wrapper.find(".select-menu").exists()).toBe(true);
  });

  it("renders all options in menu", async () => {
    const wrapper = mount(AgentSelect, {
      props: {
        modelValue: null,
        options: ["service-1", "service-2", "service-3"],
      },
    });

    const trigger = wrapper.find(".select-trigger");
    await trigger.trigger("click");

    const options = wrapper.findAll(".select-option:not(.clear)");
    expect(options).toHaveLength(3);
  });

  it("emits update when option is selected", async () => {
    const wrapper = mount(AgentSelect, {
      props: {
        modelValue: null,
        options: ["service-1", "service-2"],
      },
    });

    const trigger = wrapper.find(".select-trigger");
    await trigger.trigger("click");

    const options = wrapper.findAll(".select-option");
    expect(options.length).toBeGreaterThan(0);
    await options[0]!.trigger("click");

    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual(["service-1"]);
  });

  it("emits null when clicking selected item", async () => {
    const wrapper = mount(AgentSelect, {
      props: {
        modelValue: "service-1",
        options: ["service-1", "service-2"],
      },
    });

    const trigger = wrapper.find(".select-trigger");
    await trigger.trigger("click");

    const options = wrapper.findAll(".select-option");
    expect(options.length).toBeGreaterThan(0);
    await options[0]!.trigger("click");

    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([null]);
  });

  it("shows loading state", () => {
    const wrapper = mount(AgentSelect, {
      props: {
        modelValue: null,
        options: [],
        loading: true,
      },
    });

    expect(wrapper.find(".select-trigger").attributes("disabled")).toBeDefined();
  });

  it("shows active state when value is selected", () => {
    const wrapper = mount(AgentSelect, {
      props: {
        modelValue: "service-1",
        options: ["service-1", "service-2"],
      },
    });

    const trigger = wrapper.find(".select-trigger");
    expect(trigger.classes()).toContain("active");
  });

  it("closes menu after selection", async () => {
    const wrapper = mount(AgentSelect, {
      props: {
        modelValue: null,
        options: ["service-1", "service-2"],
      },
    });

    const trigger = wrapper.find(".select-trigger");
    await trigger.trigger("click");

    const options = wrapper.findAll(".select-option");
    expect(options.length).toBeGreaterThan(0);
    await options[0]!.trigger("click");

    expect(wrapper.find(".select-menu").exists()).toBe(false);
  });
});

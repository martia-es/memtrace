import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import Select from "@/ui/components/Select.vue";

describe("Select", () => {
  it("renders with placeholder", () => {
    const wrapper = mount(Select, {
      props: {
        modelValue: null,
        options: [],
        placeholder: "Choose one",
      },
    });

    const trigger = wrapper.find(".select-trigger");
    expect(trigger.text()).toContain("Choose one");
  });

  it("displays selected option label", () => {
    const wrapper = mount(Select, {
      props: {
        modelValue: "opt1",
        options: [
          { label: "Option 1", value: "opt1" },
          { label: "Option 2", value: "opt2" },
        ],
      },
    });

    const trigger = wrapper.find(".select-trigger");
    expect(trigger.text()).toContain("Option 1");
  });

  it("opens menu on trigger click", async () => {
    const wrapper = mount(Select, {
      props: {
        modelValue: null,
        options: [
          { label: "Option 1", value: "opt1" },
          { label: "Option 2", value: "opt2" },
        ],
      },
    });

    const trigger = wrapper.find(".select-trigger");
    await trigger.trigger("click");

    expect(wrapper.find(".select-menu").exists()).toBe(true);
  });

  it("renders all options in menu", async () => {
    const wrapper = mount(Select, {
      props: {
        modelValue: null,
        options: [
          { label: "Option 1", value: "opt1" },
          { label: "Option 2", value: "opt2" },
          { label: "Option 3", value: "opt3" },
        ],
      },
    });

    const trigger = wrapper.find(".select-trigger");
    await trigger.trigger("click");

    const options = wrapper.findAll(".select-option");
    expect(options).toHaveLength(3);
  });

  it("emits update when option is selected", async () => {
    const wrapper = mount(Select, {
      props: {
        modelValue: null,
        options: [
          { label: "Option 1", value: "opt1" },
          { label: "Option 2", value: "opt2" },
        ],
      },
    });

    const trigger = wrapper.find(".select-trigger");
    await trigger.trigger("click");

    const options = wrapper.findAll(".select-option");
    await options[0]!.trigger("click");

    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual(["opt1"]);
  });

  it("shows active state when value selected", () => {
    const wrapper = mount(Select, {
      props: {
        modelValue: "opt1",
        options: [{ label: "Option 1", value: "opt1" }],
      },
    });

    const trigger = wrapper.find(".select-trigger");
    expect(trigger.classes()).toContain("active");
  });

  it("marks selected option as selected", async () => {
    const wrapper = mount(Select, {
      props: {
        modelValue: "opt1",
        options: [
          { label: "Option 1", value: "opt1" },
          { label: "Option 2", value: "opt2" },
        ],
      },
    });

    const trigger = wrapper.find(".select-trigger");
    await trigger.trigger("click");

    const options = wrapper.findAll(".select-option");
    expect(options[0]!.classes()).toContain("selected");
    expect(options[1]!.classes()).not.toContain("selected");
  });

  it("closes menu after selection", async () => {
    const wrapper = mount(Select, {
      props: {
        modelValue: null,
        options: [
          { label: "Option 1", value: "opt1" },
          { label: "Option 2", value: "opt2" },
        ],
      },
    });

    const trigger = wrapper.find(".select-trigger");
    await trigger.trigger("click");

    const options = wrapper.findAll(".select-option");
    await options[0]!.trigger("click");

    expect(wrapper.find(".select-menu").exists()).toBe(false);
  });

  it("shows loading state", () => {
    const wrapper = mount(Select, {
      props: {
        modelValue: null,
        options: [],
        loading: true,
      },
    });

    expect(wrapper.find(".select-trigger").attributes("disabled")).toBeDefined();
  });

  it("works with numeric values", async () => {
    const wrapper = mount<any>(Select, {
      props: {
        modelValue: 1000,
        options: [
          { label: "1 second", value: 1000 },
          { label: "5 seconds", value: 5000 },
        ],
      },
    });

    const trigger = wrapper.find(".select-trigger");
    expect(trigger.text()).toContain("1 second");
  });

  it("opens with the arrow keys and closes with Escape", async () => {
    const wrapper = mount(Select, { props: { modelValue: null, options: [{ label: "Option 1", value: "opt1" }] }, attachTo: document.body });
    await wrapper.find(".select-trigger").trigger("keydown", { key: "ArrowDown" });
    expect(wrapper.find(".select-menu").exists()).toBe(true);
    await wrapper.find(".select").trigger("keydown", { key: "Escape" });
    expect(wrapper.find(".select-menu").exists()).toBe(false);
    wrapper.unmount();
  });

  it("looks like a field: a chevron button is always visible, even with no value", () => {
    const wrapper = mount(Select, { props: { modelValue: null, options: [] } });
    expect(wrapper.find(".select-chevron").exists()).toBe(true);
    expect(wrapper.find(".select-trigger").classes()).toContain("empty");
  });
});

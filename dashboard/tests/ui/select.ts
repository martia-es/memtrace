import { flushPromises } from "@vue/test-utils";

/** Opens the `Select` trigger matching `selector` and clicks the option with that label. */
export async function chooseOption(root: ParentNode, selector: string, label: string) {
  const trigger = root.querySelector<HTMLElement>(selector)!;
  trigger.click();
  await flushPromises();
  const option = [...(trigger.parentElement as HTMLElement).querySelectorAll<HTMLElement>(".select-option")].find((o) => o.textContent?.trim() === label)!;
  option.click();
  await flushPromises();
}

/** Labels of the options of the `Select` matching `selector` (opens it). */
export async function optionLabels(root: ParentNode, selector: string) {
  const trigger = root.querySelector<HTMLElement>(selector)!;
  trigger.click();
  await flushPromises();
  const labels = [...(trigger.parentElement as HTMLElement).querySelectorAll(".select-option")].map((o) => o.textContent?.trim() ?? "");
  trigger.click();
  await flushPromises();
  return labels;
}

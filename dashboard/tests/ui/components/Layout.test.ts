import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import Card from "@/ui/components/Card.vue";
import DataTable from "@/ui/components/DataTable.vue";
import FormField from "@/ui/components/FormField.vue";
import Pagination from "@/ui/components/Pagination.vue";

describe("Card", () => {
  it("renders the requested tag, padding, gap and tone and keeps extra classes", () => {
    const w = mount(Card, { props: { as: "section", padding: "lg", gap: "md", tone: "danger" }, attrs: { class: "mine", "data-testid": "c" }, slots: { default: "x" } });
    expect(w.element.tagName).toBe("SECTION");
    expect(w.classes()).toEqual(expect.arrayContaining(["mt-card", "p-lg", "g-md", "danger", "mine"]));
    expect(w.attributes("data-testid")).toBe("c");
  });
});

describe("DataTable", () => {
  it("wraps the table in a bordered box by default and forwards attributes to the table", () => {
    const w = mount(DataTable, { attrs: { "data-testid": "t", class: "x" }, slots: { default: "<tbody><tr><td>1</td></tr></tbody>" } });
    expect(w.classes()).toContain("mt-table-wrap");
    expect(w.get("table").attributes("data-testid")).toBe("t");
    expect(w.get("table").classes()).toEqual(expect.arrayContaining(["mt-table", "x", "d-md"]));
  });

  it("is a bare table when bare or sticky", () => {
    expect(mount(DataTable, { props: { bare: true } }).element.tagName).toBe("TABLE");
    const s = mount(DataTable, { props: { sticky: true, nowrap: true, density: "sm" } });
    expect(s.element.tagName).toBe("TABLE");
    expect(s.classes()).toEqual(expect.arrayContaining(["sticky", "nowrap", "d-sm"]));
  });
});

describe("FormField", () => {
  it("wraps the control in a label with hint, and the error replaces the hint", () => {
    const w = mount(FormField, { props: { label: "Name", hint: "Shown to everyone" }, slots: { default: "<input />" } });
    expect(w.element.tagName).toBe("LABEL");
    expect(w.text()).toContain("Name");
    expect(w.text()).toContain("Shown to everyone");
    return w.setProps({ error: "Required" }).then(() => {
      expect(w.find(".hint").exists()).toBe(false);
      expect(w.get(".err").text()).toBe("Required");
    });
  });

  it("can render as a div for composite controls", () => {
    expect(mount(FormField, { props: { label: "Person", as: "div" } }).element.tagName).toBe("DIV");
  });
});

describe("Pagination", () => {
  it("emits the neighbouring page and disables the edges", async () => {
    const w = mount(Pagination, { props: { page: 1, pageCount: 3 }, slots: { default: "30 runs" } });
    expect(w.text()).toContain("30 runs");
    expect(w.text()).toContain("Page 1 / 3");
    expect(w.get("[data-testid=page-prev]").attributes("disabled")).toBeDefined();
    await w.get("[data-testid=page-next]").trigger("click");
    expect(w.emitted("update:page")![0]).toEqual([2]);
    await w.setProps({ page: 3 });
    expect(w.get("[data-testid=page-next]").attributes("disabled")).toBeDefined();
  });
});

/** Guardia: las tablas de listado, la paginación y los campos con etiqueta usan los componentes. */
describe("layout primitives across the dashboard", () => {
  const UI = join(__dirname, "..", "..", "..", "src", "ui");
  const vueFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? vueFiles(p) : p.endsWith(".vue") ? [p] : [];
    });
  const OWN = new Set(["DataTable.vue", "Pagination.vue"]);
  const offenders = (re: RegExp) => vueFiles(UI).filter((f) => !OWN.has(f.split("/").pop()!) && re.test(readFileSync(f, "utf8")));
  it("has no leftover mt-table / pager markup", () => {
    expect(offenders(/class="[^"]*\b(mt-table-wrap|pager|pager-controls)\b/)).toEqual([]);
  });
});

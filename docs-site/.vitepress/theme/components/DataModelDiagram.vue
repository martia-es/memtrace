<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import model from "../data/data-model.json";
import { TEXT } from "../data/data-model-text";

/**
 * Interactive data model: pan with the mouse, zoom with the buttons or ctrl/⌘ + wheel, click a table for its details.
 * Structure (fields, grid positions, relations) comes from data-model.json; the words from data-model-text.ts.
 */
type Field = { name: string; type: string; mark?: "pk" | "fk" | "rf" };
type Table = { store: "postgres" | "clickhouse"; fields: Field[] };

const tables = model.tables as Record<string, Table>;
const pos = model.pos as Record<string, [number, number]>;
const rels = model.rels as [string, string][];

const view = ref<HTMLElement | null>(null);
const world = ref<HTMLElement | null>(null);
const links = ref<{ d: string; a: string; b: string }[]>([]);
const size = ref({ w: 0, h: 0 });
const selected = ref<string | null>(null);
const scale = ref(1);
const tx = ref(0);
const ty = ref(0);
const dragging = ref(false);
const full = ref(false);

const MIN = 0.15;
const MAX = 2.5;
const cols = Math.max(...Object.values(pos).map((p) => p[0]));
const ids = Object.keys(pos);

const detail = computed(() => {
  const id = selected.value;
  if (!id) return null;
  const related = rels.filter(([a, b]) => a === id || b === id).map(([a, b]) => (a === id ? b : a));
  return { id, table: tables[id]!, text: TEXT[id]!, related };
});

const transform = computed(() => `translate(${tx.value}px, ${ty.value}px) scale(${scale.value})`);

function edge(el: HTMLElement, other: HTMLElement) {
  const ax = el.offsetLeft + el.offsetWidth / 2;
  const ay = el.offsetTop + el.offsetHeight / 2;
  const dx = other.offsetLeft + other.offsetWidth / 2 - ax;
  const dy = other.offsetTop + other.offsetHeight / 2 - ay;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? { x: el.offsetLeft + el.offsetWidth, y: ay } : { x: el.offsetLeft, y: ay };
  return dy > 0 ? { x: ax, y: el.offsetTop + el.offsetHeight } : { x: ax, y: el.offsetTop };
}

function drawLinks() {
  const w = world.value;
  if (!w) return;
  size.value = { w: w.scrollWidth, h: w.scrollHeight };
  links.value = rels.flatMap(([a, b]) => {
    const ea = w.querySelector<HTMLElement>(`[data-table="${a}"]`);
    const eb = w.querySelector<HTMLElement>(`[data-table="${b}"]`);
    if (!ea || !eb) return [];
    const p = edge(ea, eb);
    const q = edge(eb, ea);
    const horizontal = Math.abs(q.x - p.x) > Math.abs(q.y - p.y);
    const d = horizontal
      ? `M${p.x},${p.y} C${(p.x + q.x) / 2},${p.y} ${(p.x + q.x) / 2},${q.y} ${q.x},${q.y}`
      : `M${p.x},${p.y} C${p.x},${(p.y + q.y) / 2} ${q.x},${(p.y + q.y) / 2} ${q.x},${q.y}`;
    return [{ d, a, b }];
  });
}

function zoomAt(factor: number, cx: number, cy: number) {
  const next = Math.min(MAX, Math.max(MIN, scale.value * factor));
  const k = next / scale.value;
  tx.value = cx - (cx - tx.value) * k;
  ty.value = cy - (cy - ty.value) * k;
  scale.value = next;
}

function zoomCenter(factor: number) {
  const v = view.value;
  if (v) zoomAt(factor, v.clientWidth / 2, v.clientHeight / 2);
}

function fit() {
  const v = view.value;
  const w = world.value;
  if (!v || !w) return;
  const W = w.scrollWidth;
  const H = w.scrollHeight;
  scale.value = Math.min(v.clientWidth / W, v.clientHeight / H, 1);
  tx.value = (v.clientWidth - W * scale.value) / 2;
  ty.value = (v.clientHeight - H * scale.value) / 2;
}

function onWheel(e: WheelEvent) {
  // plain wheel scrolls the page; only ctrl/⌘ + wheel (or a pinch) zooms
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  const rect = view.value!.getBoundingClientRect();
  zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - rect.left, e.clientY - rect.top);
}

let last: { x: number; y: number } | null = null;
let moved = false;
function onDown(e: PointerEvent) {
  if ((e.target as HTMLElement).closest(".dm-table")) return;
  last = { x: e.clientX, y: e.clientY };
  moved = false;
  dragging.value = true;
  view.value?.setPointerCapture(e.pointerId);
}
function onMove(e: PointerEvent) {
  if (!last) return;
  tx.value += e.clientX - last.x;
  ty.value += e.clientY - last.y;
  if (Math.abs(e.clientX - last.x) + Math.abs(e.clientY - last.y) > 0) moved = true;
  last = { x: e.clientX, y: e.clientY };
}
function onUp() {
  last = null;
  dragging.value = false;
}
function onBackground() {
  if (!moved) selected.value = null;
}

async function toggleFull() {
  full.value = !full.value;
  await nextTick();
  fit();
}
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape" && full.value) void toggleFull();
}

function select(id: string) {
  selected.value = selected.value === id ? null : id;
}

onMounted(async () => {
  await nextTick();
  drawLinks();
  fit();
  view.value?.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("resize", fit);
  window.addEventListener("keydown", onKey);
});
onBeforeUnmount(() => {
  view.value?.removeEventListener("wheel", onWheel);
  window.removeEventListener("resize", fit);
  window.removeEventListener("keydown", onKey);
});
</script>

<template>
  <div class="dm" :class="{ full }">
    <div class="dm-bar">
      <button type="button" aria-label="Zoom in" @click="zoomCenter(1.2)">+</button>
      <button type="button" aria-label="Zoom out" @click="zoomCenter(1 / 1.2)">−</button>
      <button type="button" @click="fit">Fit</button>
      <button type="button" @click="toggleFull">{{ full ? "Close (Esc)" : "Full screen" }}</button>
      <span class="dm-pct">{{ Math.round(scale * 100) }}%</span>
      <span class="dm-legend">
        <span><i class="dm-sw pg" />PostgreSQL</span>
        <span><i class="dm-sw ch" />ClickHouse</span>
        <span><b class="dm-mk pk">PK</b>primary key</span>
        <span><b class="dm-mk fk">FK</b>foreign key</span>
        <span><b class="dm-mk rf">REF</b>id from the other store</span>
      </span>
    </div>

    <div ref="view" class="dm-view" :class="{ drag: dragging }" @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointercancel="onUp" @click="onBackground">
      <div ref="world" class="dm-world" :style="{ transform, gridTemplateColumns: `repeat(${cols}, 236px)` }">
        <svg class="dm-links" :width="size.w" :height="size.h" :viewBox="`0 0 ${size.w} ${size.h}`">
          <path v-for="l in links" :key="l.a + l.b" :d="l.d" :class="{ hl: selected === l.a || selected === l.b }" />
        </svg>
        <div
          v-for="id in ids"
          :key="id"
          :data-table="id"
          class="dm-table"
          :class="{ ch: tables[id]!.store === 'clickhouse', sel: selected === id }"
          :style="{ gridColumn: pos[id]![0], gridRow: pos[id]![1] }"
          role="button"
          tabindex="0"
          @click.stop="select(id)"
          @keydown.enter.prevent="select(id)"
        >
          <div class="dm-hd">{{ id }}<i>{{ tables[id]!.store === "postgres" ? "PG" : "CH" }}</i></div>
          <div class="dm-ds">{{ TEXT[id]!.short }}</div>
          <ul>
            <li v-for="f in tables[id]!.fields" :key="f.name" :class="f.mark">
              <span class="n">{{ f.name }}</span>
              <b v-if="f.mark" class="m" :class="f.mark">{{ f.mark.toUpperCase() }}</b>
              <span class="t">{{ f.type }}</span>
            </li>
          </ul>
        </div>
      </div>

      <aside v-if="detail" class="dm-detail" @pointerdown.stop @click.stop>
        <button type="button" class="dm-close" aria-label="Close" @click="selected = null">✕</button>
        <h4>{{ detail.id }}</h4>
        <div class="dm-kind">{{ detail.table.store === "postgres" ? "PostgreSQL" : "ClickHouse" }}</div>
        <p>{{ detail.text.what }}</p>
        <h5>Why it exists</h5>
        <p>{{ detail.text.why }}</p>
        <h5>Relations</h5>
        <ul>
          <li v-for="r in detail.text.relations" :key="r">{{ r }}</li>
          <li v-if="detail.related.length">Connected with: <code v-for="r in detail.related" :key="r">{{ r }}</code></li>
        </ul>
        <template v-if="detail.text.states?.length">
          <h5>States and what they mean</h5>
          <ul class="dm-states">
            <li v-for="[v, t] in detail.text.states" :key="v"><code>{{ v }}</code><span>{{ t }}</span></li>
          </ul>
        </template>
        <h5>Fields</h5>
        <ul>
          <li v-for="f in detail.table.fields" :key="f.name"><code>{{ f.name }}</code> · {{ f.type }}<template v-if="f.mark"> · {{ f.mark.toUpperCase() }}</template></li>
        </ul>
      </aside>
    </div>
    <p class="dm-hint">Drag the background to move, ctrl/⌘ + wheel or the buttons to zoom, click a table for its details. Use Full screen for a larger canvas.</p>
  </div>
</template>

<style scoped>
.dm { margin: 18px 0; border: 1px solid var(--mt-line); border-top: 3px solid var(--mt-brand); border-radius: var(--mt-radius-lg); background: var(--mt-card); overflow: hidden; }
.dm.full { position: fixed; inset: 0; z-index: 200; display: flex; flex-direction: column; margin: 0; border-radius: 0; }
.dm.full .dm-view { flex: 1; height: auto; }
.dm-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--mt-line); background: var(--mt-soft); }
.dm-bar button { min-width: 30px; height: 28px; padding: 0 10px; font: 700 13px var(--mt-sans); color: var(--mt-ink); background: var(--mt-card); border: 1px solid var(--mt-line); border-radius: var(--mt-radius-sm); cursor: pointer; }
.dm-bar button:hover { border-color: var(--mt-accent); color: var(--mt-accent-text); }
.dm-pct { min-width: 44px; text-align: center; font: 12px var(--mt-mono); color: var(--mt-muted); }
.dm-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-left: auto; font-size: 12px; color: var(--mt-muted); }
.dm-sw { display: inline-block; width: 11px; height: 11px; margin-right: 5px; vertical-align: -1px; border-radius: 3px; border: 1px solid var(--mt-line); }
.dm-sw.pg { background: var(--mt-accent-tint); border-color: var(--mt-accent); }
.dm-sw.ch { background: var(--mt-highlight-tint); border-color: var(--mt-highlight); }
.dm-mk { margin-right: 4px; font: 700 10px var(--mt-mono); }
.dm-mk.pk { color: var(--mt-highlight); } .dm-mk.fk { color: var(--mt-info); } .dm-mk.rf { color: var(--mt-accent-text); }

.dm-view { position: relative; height: min(78vh, 760px); min-height: 460px; overflow: hidden; cursor: grab; touch-action: pan-y; background: var(--mt-bg); }
.dm-view.drag { cursor: grabbing; }
.dm-world { position: absolute; top: 0; left: 0; transform-origin: 0 0; display: grid; column-gap: 56px; row-gap: 46px; padding: 40px; }
.dm-links { position: absolute; top: 0; left: 0; overflow: visible; pointer-events: none; }
.dm-links path { fill: none; stroke: var(--mt-faint); stroke-width: 1.5; opacity: 0.7; }
.dm-links path.hl { stroke: var(--mt-highlight); stroke-width: 2.5; opacity: 1; }

.dm-table { position: relative; z-index: 1; width: 236px; align-self: start; cursor: pointer; background: var(--mt-card); border: 1.5px solid var(--mt-accent); border-radius: var(--mt-radius-lg); }
.dm-table:hover { border-color: var(--mt-ink); }
.dm-table.sel { outline: 3px solid var(--mt-highlight); outline-offset: 2px; }
.dm-table.ch { border-color: var(--mt-highlight); }
.dm-hd { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 6px 10px; font: 700 12.5px var(--mt-mono); color: var(--mt-accent-text); background: var(--mt-accent-tint); border-radius: 6px 6px 0 0; }
.dm-table.ch .dm-hd { color: var(--mt-warn-ink); background: var(--mt-highlight-tint); }
.dm-hd i { font: 700 9px var(--mt-sans); font-style: normal; letter-spacing: 0.06em; color: var(--mt-faint); }
.dm-ds { padding: 4px 10px 2px; font-size: 11px; color: var(--mt-muted); }
.dm-table ul { list-style: none; margin: 0; padding: 3px 0 5px; border-top: 1px solid var(--mt-line); }
.dm-table li { display: flex; align-items: center; gap: 5px; margin: 0; padding: 1px 10px; font: 11.5px/1.5 var(--mt-mono); white-space: nowrap; }
.dm-table li .n { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.dm-table li .t { font-size: 10px; color: var(--mt-faint); }
.dm-table li.pk .n { color: var(--mt-highlight); font-weight: 700; }
.dm-table li.fk .n { color: var(--mt-info); }
.dm-table li.rf .n { color: var(--mt-accent-text); }
.dm-table li .m { padding: 0 3px; font-size: 9px; color: #fff; border-radius: 3px; }
.dm-table li .m.pk { background: var(--mt-highlight); } .dm-table li .m.fk { background: var(--mt-info); } .dm-table li .m.rf { background: var(--mt-accent); }

.dm-detail { position: absolute; top: 0; right: 0; bottom: 0; z-index: 3; width: min(380px, 100%); padding: 16px 18px 28px; overflow-y: auto; cursor: default; background: var(--mt-card); border-left: 1px solid var(--mt-line); }
.dm-close { position: absolute; top: 10px; right: 10px; width: 28px; height: 28px; font: 13px var(--mt-sans); color: var(--mt-ink); background: var(--mt-bg); border: 1px solid var(--mt-line); border-radius: var(--mt-radius-sm); cursor: pointer; }
.dm-detail h4 { margin: 0 32px 2px 0; font: 700 15px var(--mt-mono); color: var(--mt-accent-text); }
.dm-kind { margin-bottom: 12px; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--mt-muted); }
.dm-detail h5 { margin: 16px 0 4px; font-size: 11px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--mt-muted); }
.dm-detail p { margin: 0 0 6px; font-size: 13.5px; line-height: 1.6; }
.dm-detail ul { margin: 0; padding-left: 18px; font-size: 13px; line-height: 1.55; }
.dm-detail li { margin-bottom: 4px; }
.dm-detail code { margin-right: 4px; padding: 1px 5px; font: 12px var(--mt-mono); background: var(--code-bg); border-radius: var(--mt-radius-xs); }
.dm-states { list-style: none; padding: 0 !important; }
.dm-states li { padding: 6px 8px; border: 1px solid var(--mt-line); border-radius: var(--mt-radius-sm); }
.dm-states code { color: var(--mt-accent-text); }
.dm-states span { display: block; margin-top: 2px; font-size: 12.5px; color: var(--mt-muted); }
.dm-hint { margin: 0; padding: 8px 12px; font-size: 12.5px; color: var(--mt-muted); border-top: 1px solid var(--mt-line); }
@media (max-width: 720px) { .dm-legend { display: none; } .dm-detail { width: 100%; } }
</style>

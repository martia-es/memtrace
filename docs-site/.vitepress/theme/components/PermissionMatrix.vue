<script setup lang="ts">
import { computed, ref } from "vue";
import data from "../data/permissions.json";

/** Permission × role matrix. Click a permission for what it unlocks, a role header to highlight its column. */
const selected = ref<string>(data.permissions[0]!.id);
const role = ref<string | null>(null);
const current = computed(() => data.permissions.find((p) => p.id === selected.value)!);
const holders = computed(() => data.roles.filter((r) => r.permissions.includes(selected.value)).map((r) => r.id));
const groups = computed(() => {
  const out: { name: string; items: typeof data.permissions }[] = [];
  for (const p of data.permissions) {
    const last = out[out.length - 1];
    if (last && last.name === p.group) last.items.push(p);
    else out.push({ name: p.group, items: [p] });
  }
  return out;
});
</script>

<template>
  <div class="pm">
    <div class="pm-scroll">
      <table>
        <thead>
          <tr>
            <th>Permission</th>
            <th v-for="r in data.roles" :key="r.id" class="c" :class="{ hl: role === r.id }">
              <button type="button" @click="role = role === r.id ? null : r.id">{{ r.id }}</button>
            </th>
          </tr>
        </thead>
        <tbody v-for="g in groups" :key="g.name">
          <tr class="grp"><td :colspan="data.roles.length + 1">{{ g.name }}</td></tr>
          <tr v-for="p in g.items" :key="p.id" class="perm" :class="{ sel: selected === p.id }" tabindex="0" @click="selected = p.id" @keydown.enter="selected = p.id">
            <td><code>{{ p.id }}</code><small>{{ p.description }}</small></td>
            <td v-for="r in data.roles" :key="r.id" class="c" :class="{ hl: role === r.id }">
              <span v-if="r.permissions.includes(p.id)" class="yes" aria-label="yes">✓</span>
              <span v-else class="no" aria-label="no">—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="pm-detail">
      <h4><code>{{ current.id }}</code></h4>
      <p>{{ current.description }}</p>
      <p class="held">Held by: <code v-for="h in holders" :key="h">{{ h }}</code><span v-if="!holders.length">—</span></p>
      <strong>Unlocks</strong>
      <ul><li v-for="u in current.unlocks" :key="u">{{ u }}</li></ul>
    </div>
  </div>
</template>

<style scoped>
.pm { margin: 18px 0; }
.pm-scroll { overflow-x: auto; border: 1px solid var(--mt-line); border-radius: var(--mt-radius-lg); background: var(--mt-card); }
.pm table { width: 100%; margin: 0; border: 0; border-collapse: collapse; display: table; }
.pm th, .pm td { padding: 8px 14px; border: 0; border-top: 1px solid var(--mt-line); font-size: 13px; text-align: left; vertical-align: top; }
.pm thead th { border-top: 0; }
.pm th.c, .pm td.c { width: 110px; text-align: center; }
.pm th button { font: inherit; letter-spacing: inherit; text-transform: none; color: inherit; background: none; border: 0; cursor: pointer; }
.pm th.hl, .pm td.hl { background: var(--mt-highlight-tint); }
.pm tr.grp td { padding: 5px 14px; font-size: 11px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--mt-muted); background: var(--mt-soft); }
.pm tr.perm { cursor: pointer; background: var(--mt-card); }
.pm tr.perm:hover { background: var(--mt-soft); }
.pm tr.perm.sel { background: var(--mt-accent-tint); }
.pm td small { display: block; margin-top: 2px; font-size: 12px; color: var(--mt-muted); }
.pm .yes { color: var(--mt-accent-text); font-weight: 800; }
.pm .no { color: var(--mt-line); }
.pm-detail { margin-top: 12px; padding: 14px 18px; background: var(--mt-card); border: 1px solid var(--mt-line); border-left: 4px solid var(--mt-accent); border-radius: var(--mt-radius-lg); }
.pm-detail h4 { margin: 0 0 4px; font-size: 14px; }
.pm-detail p { margin: 0 0 6px; font-size: 14px; }
.pm-detail .held code { margin-right: 6px; }
.pm-detail ul { margin: 4px 0 0; padding-left: 20px; }
</style>

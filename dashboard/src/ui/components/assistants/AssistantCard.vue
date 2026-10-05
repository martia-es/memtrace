<script setup lang="ts">
import { computed } from "vue";
import type { AssistantCardDto, EnvironmentDto } from "@contract";
import { formatClock, formatDuration } from "@/domain/format";
import { HEALTH_LABEL, ROLE_LABEL, accessSummary, authSummary, cardTone, featuredDeployment, formatUptime, headline, initials, personLabel } from "@/domain/assistants";
import PersonAvatar from "./PersonAvatar.vue";

/**
 * Tarjeta de presentación de un asistente en el catálogo (ADR-053): cabecera tintada con su estado, una caja por entorno,
 * disponibilidad de 24 h, conexiones y quién puede llamarlo. Sin desplegar o retirado, todo en gris. Toda la tarjeta es el enlace.
 */
const props = defineProps<{ card: AssistantCardDto; slots: Pick<EnvironmentDto, "id" | "key" | "label">[] }>();

const head = computed(() => headline(props.card));
const tone = computed(() => cardTone(props.card));
const featured = computed(() => featuredDeployment(props.card));
const envSlots = computed(() =>
  props.slots.map((slot) => {
    const d = props.card.deployments.find((x) => x.environment.key === slot.key);
    if (!d) return { key: slot.key, label: slot.label, state: "none", status: "Not deployed", detail: "" };
    const detail =
      d.healthStatus === "down" && d.healthStatusSince ? `since ${formatClock(d.healthStatusSince, false)}` : d.healthStatus === "unknown" ? "no check yet" : d.healthLatencyMs !== null ? formatDuration(d.healthLatencyMs) : "";
    return { key: slot.key, label: slot.label, state: d.healthStatus, status: HEALTH_LABEL[d.healthStatus], detail };
  }),
);
const bars = computed(() => featured.value?.recent.buckets ?? []);
const barsLabel = computed(() => (featured.value ? `${featured.value.environment.label} · last 24 h` : "Not deployed"));
const uptime = computed(() => (featured.value ? formatUptime(featured.value.recent.uptimePercent) : ""));

const counts = computed(() => props.card.connectionCounts);
// hasta 2 nombres de servidores MCP; el resto, «+N MCP»
const mcpChips = computed(() => {
  const names = props.card.mcpServerNames;
  const chips = names.slice(0, 2);
  const rest = counts.value.mcpServers - chips.length;
  return rest > 0 ? [...chips, `+${rest} MCP`] : chips;
});
const access = computed(() => (featured.value ? accessSummary(featured.value) : "Nothing deployed yet"));
const auth = computed(() => (featured.value ? `${authSummary(featured.value)} · ${featured.value.environment.label}` : ""));
// quien participa en el experimento (técnicos y negocio): su foto, o sus iniciales
const people = computed(() => props.card.members.preview);
const moreMembers = computed(() => Math.max(0, props.card.members.total - people.value.length));
const peopleLabel = computed(() => props.card.members.preview.map((m) => `${personLabel(m)} (${ROLE_LABEL[m.role] ?? m.role})`).join(", "));
</script>

<template>
  <router-link :to="{ name: 'assistant', params: { expId: card.experimentId } }" class="card" :class="tone" :data-testid="`assistant-card-${card.name}`" :data-tone="tone">
    <header class="top">
      <div class="top-row">
        <span class="avatar" aria-hidden="true">{{ initials(card.name) }}</span>
        <div class="who">
          <span class="name">{{ card.name }}</span>
          <span class="meta">Owned by <b>{{ card.owner?.name ?? card.owner?.email ?? "nobody yet" }}</b></span>
        </div>
        <span class="pill" :class="head.tone" data-testid="status-badge"><span class="dot" aria-hidden="true" />{{ head.label }}</span>
      </div>
      <p class="desc">{{ card.description || "No description yet." }}</p>
    </header>

    <div class="body">
      <div class="envs">
        <div v-for="e in envSlots" :key="e.key" class="env" :class="e.state">
          <span class="env-key">{{ e.label }}</span>
          <span class="env-status"><span class="dot" aria-hidden="true" />{{ e.status }}</span>
          <span class="env-detail">{{ e.detail }}</span>
        </div>
      </div>
      <div class="uptime">
        <div class="bars" role="img" :aria-label="barsLabel">
          <span v-for="(b, i) in bars.length > 0 ? bars : Array(36).fill(null)" :key="i" class="bar" :class="b ?? 'none'" />
        </div>
        <div class="legend"><span>{{ barsLabel }}</span><span class="mono">{{ uptime }}</span></div>
      </div>
    </div>

    <div class="chips">
      <span v-for="m in mcpChips" :key="m" class="chip mcp"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4" /></svg>{{ m }}</span>
      <span class="chip tools"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.7 2.7-2.3-.7-.7-2.3z" /></svg>{{ counts.tools }} {{ counts.tools === 1 ? "tool" : "tools" }}</span>
      <span class="chip agents"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4" /></svg>{{ counts.agents }} {{ counts.agents === 1 ? "agent" : "agents" }}</span>
    </div>

    <footer class="foot">
      <div v-if="people.length > 0" class="faces" role="img" :aria-label="`People in this experiment: ${peopleLabel}`" data-testid="members">
        <PersonAvatar v-for="m in people" :key="m.userId" :name="m.name" :email="m.email" :image="m.image" :title="`${personLabel(m)} · ${ROLE_LABEL[m.role] ?? m.role}`" class="face" :class="m.role" />
        <span v-if="moreMembers > 0" class="face more" :title="`${moreMembers} more`">+{{ moreMembers }}</span>
      </div>
      <div class="foot-main">
        <span class="access" :class="{ none: !featured }">{{ access }}</span>
        <span v-if="auth" class="auth">{{ auth }}</span>
      </div>
      <span v-if="counts.toReview > 0" class="review">{{ counts.toReview }} to review</span>
      <span class="open">Open →</span>
    </footer>
  </router-link>
</template>

<style scoped>
.card {
  --band: var(--mt-accent-tint);
  --edge: var(--mt-line);
  --avatar-bg: var(--mt-accent-soft);
  --avatar-ink: var(--mt-accent-text);
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  color: inherit;
  text-decoration: none;
  background: var(--mt-card);
  border: 1px solid var(--edge);
  border-radius: 10px;
  transition: border-color 0.15s, transform 0.15s;
}
.card:hover { border-color: var(--mt-accent); transform: translateY(-1px); }
.card:focus-visible { outline: 2px solid var(--mt-accent); outline-offset: 2px; }
/* el estado tiñe cabecera, borde y avatar; `off` (sin desplegar / retirado) lo deja todo en gris */
.card.warn { --band: color-mix(in srgb, var(--mt-warn-bg) 70%, var(--mt-card)); --edge: var(--mt-warn); --avatar-bg: var(--mt-warn-bg); --avatar-ink: var(--mt-warn-ink); }
.card.error { --band: color-mix(in srgb, var(--mt-err-bg) 70%, var(--mt-card)); --edge: var(--mt-err); --avatar-bg: var(--mt-err-bg); --avatar-ink: var(--mt-err-ink); }
.card.off { --band: var(--mt-soft); --edge: var(--mt-line); --avatar-bg: var(--mt-line); --avatar-ink: var(--mt-muted); }
.card.off .name { color: var(--mt-muted); }
.card.off .chip { background: var(--mt-soft); color: var(--mt-faint); }
.card.off .open { color: var(--mt-muted); }

.top { display: flex; flex-direction: column; gap: 9px; padding: 14px 16px 12px; background: var(--band); }
.top-row { display: flex; align-items: center; gap: 12px; }
.avatar { width: 42px; height: 42px; flex: none; display: grid; place-items: center; border-radius: 10px; font-weight: 800; font-size: 15px; letter-spacing: -0.01em; background: var(--avatar-bg); color: var(--avatar-ink); }
.who { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
.name { font-weight: 800; font-size: 15px; letter-spacing: -0.01em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.meta { font-size: 12px; color: var(--mt-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.meta b { color: var(--mt-ink); font-weight: 700; }
.card.off .meta b { color: var(--mt-muted); }
.desc { margin: 0; font-size: 12.5px; line-height: 1.45; height: 36px; overflow: hidden; }
.card.off .desc { color: var(--mt-muted); }

.pill { display: inline-flex; align-items: center; gap: 6px; flex: none; height: 24px; padding: 0 9px; border-radius: 12px; font-size: 11.5px; font-weight: 800; background: var(--mt-soft); color: var(--mt-muted); }
.pill.ok { background: var(--mt-ok-bg); color: var(--mt-ok-ink); }
.pill.warn { background: var(--mt-warn-bg); color: var(--mt-warn-ink); }
.pill.error { background: var(--mt-err-bg); color: var(--mt-err-ink); }
.dot { width: 7px; height: 7px; flex: none; border-radius: 50%; background: currentColor; }

.body { display: flex; flex-direction: column; gap: 10px; padding: 12px 16px 0; }
.envs { display: grid; grid-template-columns: repeat(auto-fit, minmax(0, 1fr)); gap: 8px; }
.env { display: flex; flex-direction: column; gap: 2px; min-width: 0; padding: 7px 10px; border-radius: 6px; background: var(--mt-soft); color: var(--mt-muted); }
.env-key { font-family: var(--mt-mono); font-size: 11px; font-weight: 500; letter-spacing: 0.04em; }
.env-status { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; white-space: nowrap; }
.env-detail { height: 14px; font-family: var(--mt-mono); font-size: 11px; }
.env.up { background: var(--mt-ok-bg); color: var(--mt-ok-ink); }
.env.degraded { background: var(--mt-warn-bg); color: var(--mt-warn-ink); }
.env.down { background: var(--mt-err-bg); color: var(--mt-err-ink); }
.env.none { background: transparent; border: 1px dashed var(--mt-line); color: var(--mt-faint); }
.env.none .dot { background: var(--mt-line); }

.uptime { display: flex; flex-direction: column; gap: 4px; }
.bars { display: flex; align-items: flex-end; gap: 2px; height: 18px; }
.bar { flex: 1; height: 100%; border-radius: 1px; background: var(--mt-brand); }
.bar.degraded { background: var(--mt-warn); }
.bar.down { background: var(--mt-err); }
.bar.unknown { background: var(--mt-faint); }
.bar.none { background: var(--mt-line); height: 45%; }
.legend { display: flex; justify-content: space-between; font-size: 11px; color: var(--mt-faint); }
.mono { font-family: var(--mt-mono); color: var(--mt-muted); }

.chips { display: flex; flex-wrap: wrap; align-content: flex-start; gap: 6px; min-height: 50px; padding: 12px 16px 0; box-sizing: border-box; }
.chip { display: inline-flex; align-items: center; gap: 5px; height: 22px; padding: 0 8px; border-radius: var(--mt-radius-xs); font-size: 11.5px; font-weight: 600; background: var(--mt-accent-tint); color: var(--mt-accent-text); }
.chip.tools { background: var(--mt-soft); color: var(--mt-muted); }
.chip.agents { background: var(--mt-highlight-soft); color: var(--mt-highlight-ink); }

.foot { display: flex; align-items: center; gap: 10px; margin-top: auto; padding: 11px 16px; border-top: 1px solid var(--mt-line-2); }
.faces { display: flex; align-items: center; padding-right: 6px; }
.face { margin-right: -6px; }
.face.business { background: var(--mt-highlight-soft); color: var(--mt-highlight-ink); }
.face.more { width: 24px; height: 24px; box-sizing: border-box; display: grid; place-items: center; border: 2px solid var(--mt-card); border-radius: 50%; font-size: 9.5px; font-weight: 800; background: var(--mt-soft); color: var(--mt-muted); }
.card.off .face:not(.business) { background: var(--mt-line); color: var(--mt-muted); }
.foot-main { display: flex; flex-direction: column; line-height: 1.3; flex: 1; min-width: 0; }
.access { font-size: 12px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.access.none { color: var(--mt-faint); font-weight: 600; }
.auth { font-size: 11px; color: var(--mt-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.review { display: inline-flex; align-items: center; height: 22px; padding: 0 8px; border-radius: var(--mt-radius-xs); font-size: 11.5px; font-weight: 700; background: var(--mt-warn-bg); color: var(--mt-warn-ink); }
.open { font-size: 12px; font-weight: 700; color: var(--mt-accent-text); }
</style>

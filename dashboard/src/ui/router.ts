import { createRouter, createWebHistory } from "vue-router";
import { getContainer } from "@/dependency-container";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/login", name: "login", component: () => import("./pages/LoginPage.vue"), meta: { title: "Login", bare: true, public: true } },
    // nunca se renderiza: beforeEach siempre la resuelve a /e/:id/conversations o /admin
    { path: "/", name: "home", component: { render: () => null } },
    { path: "/admin", name: "admin", component: () => import("./pages/ExperimentsPage.vue"), meta: { title: "Admin", section: "admin" } },
    {
      path: "/e/:experimentId",
      children: [
        { path: "", redirect: (to) => ({ name: "conversations", params: to.params }) },
        { path: "spans", redirect: (to) => ({ name: "conversations", params: to.params }) },
        { path: "conversations", name: "conversations", component: () => import("./pages/ConversationsPage.vue"), meta: { title: "Conversations", section: "conversations", framed: true } },
        { path: "conversations/:conversationId", name: "conversation", component: () => import("./pages/ConversationDetailPage.vue"), props: true, meta: { title: "Conversation", section: "conversations", framed: true } },
        { path: "traces/:traceId", name: "trace", component: () => import("./pages/TraceDetailPage.vue"), props: true, meta: { title: "Trace", section: "conversations", framed: true } },
        { path: "metrics", name: "metrics", component: () => import("./pages/MetricsPage.vue"), meta: { title: "Metrics", section: "metrics" } },
      ],
    },
    { path: "/:pathMatch(.*)*", redirect: { name: "home" } },
  ],
});

router.afterEach((to) => {
  document.title = `${String(to.meta.title ?? "MemTrace")} · MemTrace`;
});

// Sesión + scoping por experimento (ADR-013): sin sesión -> /login; con experimentId en la ruta -> se
// fija en el TraceApi compartido antes de que las páginas disparen ninguna petición.
const LAST_EXPERIMENT_KEY = "memtrace:lastExperimentId";
let sessionChecked = false;
router.beforeEach(async (to) => {
  const { identityApi, traceApi } = getContainer();

  if (!to.meta.public) {
    if (!sessionChecked) {
      const me = await identityApi.getMe();
      sessionChecked = true;
      if (!me) return { name: "login" };
    }
  }

  // landing tras login: entra directo al último experimento usado (o al primero disponible),
  // y si el usuario no tiene ninguno todavía, a la gestión de experimentos para crear uno.
  if (to.name === "home") {
    const experiments = await identityApi.listExperiments();
    const lastId = localStorage.getItem(LAST_EXPERIMENT_KEY);
    const target = experiments.find((e) => e.id === lastId) ?? experiments[0];
    if (!target) return { name: "admin" };
    return { name: "conversations", params: { experimentId: target.id } };
  }

  const experimentId = to.params.experimentId;
  if (typeof experimentId === "string") {
    traceApi.setExperimentId(experimentId);
    localStorage.setItem(LAST_EXPERIMENT_KEY, experimentId);
  }

  return true;
});

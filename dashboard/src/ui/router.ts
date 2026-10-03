import { createRouter, createWebHistory } from "vue-router";
import { getContainer } from "@/dependency-container";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/login", name: "login", component: () => import("./pages/LoginPage.vue"), meta: { title: "Login", bare: true, public: true } },
    // nunca se renderiza: beforeEach siempre la resuelve a /e/:id/conversations o /admin
    { path: "/", name: "home", component: { render: () => null } },
    { path: "/admin", name: "admin", component: () => import("./pages/ExperimentsPage.vue"), meta: { title: "Admin", section: "admin" } },
    { path: "/model-pricing", name: "model-pricing", component: () => import("./pages/ModelPricingPage.vue"), meta: { title: "Model pricing", section: "model-pricing" } },
    {
      path: "/e/:experimentId",
      children: [
        { path: "", redirect: (to) => ({ name: "conversations", params: to.params }) },
        { path: "spans", redirect: (to) => ({ name: "conversations", params: to.params }) },
        { path: "conversations", name: "conversations", component: () => import("./pages/ConversationsPage.vue"), meta: { title: "Conversations", section: "conversations" } },
        { path: "conversations/:conversationId", name: "conversation", component: () => import("./pages/ConversationDetailPage.vue"), props: true, meta: { title: "Conversation", section: "conversations", framed: true } },
        { path: "traces/:traceId", name: "trace", component: () => import("./pages/TraceDetailPage.vue"), props: true, meta: { title: "Trace", section: "conversations", framed: true } },
        { path: "metrics", name: "metrics", component: () => import("./pages/MetricsPage.vue"), meta: { title: "Metrics", section: "metrics" } },
        { path: "annotation-queues", name: "annotation-queues", component: () => import("./pages/AnnotationQueuesPage.vue"), meta: { title: "Review queues", section: "annotation-queues" } },
        { path: "annotation-queues/:queueId/review", name: "annotation-queue-review", component: () => import("./pages/AnnotationQueueReviewPage.vue"), props: true, meta: { title: "Review", section: "annotation-queues", framed: true } },
        { path: "datasets", name: "datasets", component: () => import("./pages/DatasetsPage.vue"), meta: { title: "Datasets", section: "datasets" } },
        { path: "datasets/:datasetId", name: "dataset", component: () => import("./pages/DatasetDetailPage.vue"), props: true, meta: { title: "Dataset", section: "datasets", framed: true } },
        { path: "runs", name: "runs", component: () => import("./pages/RunsPage.vue"), meta: { title: "Runs", section: "runs" } },
        { path: "datasets/:datasetId/runs/:runId", name: "dataset-run", component: () => import("./pages/DatasetRunDetailPage.vue"), props: true, meta: { title: "Run", section: "runs", framed: true } },
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

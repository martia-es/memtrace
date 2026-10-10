import { createRouter, createWebHistory, type RouteLocationNormalized } from "vue-router";
import { getContainer } from "@/dependency-container";

const metricsPage = () => import("./pages/MetricsPage.vue");
const queuesPage = () => import("./pages/AnnotationQueuesPage.vue");

// enlaces guardados de cuando Overview tenía pestañas: /overview?tab=compare|custom|offline
const LEGACY_TABS: Record<string, string> = { compare: "overview-compare", custom: "overview-charts", offline: "trends" };
function legacyOverviewTab(to: RouteLocationNormalized) {
  const name = LEGACY_TABS[String(to.query.tab)];
  if (!name) return true;
  const { tab: _tab, ...query } = to.query;
  return { name, params: to.params, query };
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/login", name: "login", component: () => import("./pages/LoginPage.vue"), meta: { title: "Login", bare: true, public: true } },
    // chat del asistente a pantalla completa, en su propia pestaña (ADR-063): requiere sesión pero no lleva sidebar
    { path: "/assistant", name: "assistant-fullscreen", component: () => import("./pages/AssistantFullscreenPage.vue"), meta: { title: "Assistant", bare: true } },
    // nunca se renderiza: beforeEach siempre la resuelve a /e/:id/conversations o /admin
    { path: "/", name: "home", component: { render: () => null } },
    // área de administración (ADR-037): organización → experimento, con una pestaña por paso de configuración
    { path: "/admin", name: "admin", component: () => import("./pages/admin/AdminHomePage.vue"), meta: { title: "Admin", section: "admin" } },
    { path: "/admin/members", name: "admin-members", component: () => import("./pages/admin/AdminMembersPage.vue"), meta: { title: "Members", section: "admin" } },
    { path: "/admin/organizations/:organizationId", name: "admin-organization", component: () => import("./pages/admin/AdminOrganizationPage.vue"), props: true, meta: { title: "Organization", section: "admin" } },
    // el parámetro no se llama :experimentId a propósito: el guard de abajo fija el experimento "activo" para :experimentId
    { path: "/admin/experiments/:expId", name: "admin-experiment", component: () => import("./pages/admin/AdminExperimentPage.vue"), props: (route) => ({ experimentId: route.params.expId }), meta: { title: "Experiment", section: "admin" } },
    // catálogo de asistentes para gobernanza (ADR-053): de organización, no cuelga de :experimentId; el parámetro se llama :expId por la misma razón que en /admin
    { path: "/assistants", name: "assistants", component: () => import("./pages/AssistantsPage.vue"), meta: { title: "Assistants", section: "assistants" } },
    { path: "/assistants/:expId", name: "assistant", component: () => import("./pages/AssistantDetailPage.vue"), props: (route) => ({ experimentId: route.params.expId }), meta: { title: "Assistant", section: "assistants" } },
    { path: "/model-pricing", name: "model-pricing", component: () => import("./pages/ModelPricingPage.vue"), meta: { title: "Model pricing", section: "model-pricing" } },
    {
      path: "/e/:experimentId",
      children: [
        { path: "", redirect: (to) => ({ name: "overview", params: to.params }) },
        { path: "spans", redirect: (to) => ({ name: "conversations", params: to.params }) },
        { path: "conversations", name: "conversations", component: () => import("./pages/ConversationsPage.vue"), meta: { title: "Conversations", section: "conversations" } },
        { path: "conversations/:conversationId", name: "conversation", component: () => import("./pages/ConversationDetailPage.vue"), props: true, meta: { title: "Conversation", section: "conversations", framed: true } },
        { path: "traces/:traceId", name: "trace", component: () => import("./pages/TraceDetailPage.vue"), props: true, meta: { title: "Trace", section: "conversations", framed: true } },
        // Overview: una sola página con varias vistas; cada una tiene su URL y su entrada de submenú (ADR-059)
        { path: "overview", name: "overview", component: metricsPage, beforeEnter: legacyOverviewTab, meta: { title: "Overview", section: "overview", view: "summary" } },
        { path: "overview/compare", name: "overview-compare", component: metricsPage, meta: { title: "Compare", section: "compare", view: "compare" } },
        { path: "overview/charts", name: "overview-charts", component: metricsPage, meta: { title: "Custom charts", section: "charts", view: "charts" } },
        { path: "overview/catalog", name: "overview-catalog", component: () => import("./pages/ChartCatalogPage.vue"), meta: { title: "Data catalog", section: "catalog" } },
        { path: "overview/reports", name: "overview-reports", component: metricsPage, meta: { title: "Reports", section: "reports", view: "reports" } },
        { path: "overview/reports/:reportId", name: "overview-report", component: metricsPage, meta: { title: "Report", section: "reports", view: "report" } },
        // antes "Metrics": se mantiene el path para enlaces guardados (ADR-048)
        { path: "metrics", redirect: (to) => ({ name: "overview", params: to.params, query: to.query }) },
        // Review: bandeja personal, todas las colas y archivadas (ADR-059)
        { path: "annotation-queues", name: "annotation-queues", component: queuesPage, meta: { title: "My inbox", section: "review-inbox", view: "assigned" } },
        { path: "annotation-queues/all", name: "annotation-queues-all", component: queuesPage, meta: { title: "All queues", section: "review-queues", view: "active" } },
        { path: "annotation-queues/archived", name: "annotation-queues-archived", component: queuesPage, meta: { title: "Archived queues", section: "review-archived", view: "archived" } },
        { path: "annotation-queues/:queueId/review", name: "annotation-queue-review", component: () => import("./pages/AnnotationQueueReviewPage.vue"), props: true, meta: { title: "Review", section: "review-inbox", framed: true } },
        // registro de prompts (ADR-067): versiones inmutables y tags por entorno
        { path: "prompts", name: "prompts", component: () => import("./pages/PromptsPage.vue"), meta: { title: "Prompts", section: "prompts", timeRange: false } },
        { path: "prompts/:promptId", name: "prompt", component: () => import("./pages/PromptDetailPage.vue"), props: true, meta: { title: "Prompt", section: "prompts", framed: true, timeRange: false } },
        { path: "datasets", name: "datasets", component: () => import("./pages/DatasetsPage.vue"), meta: { title: "Datasets", section: "datasets" } },
        { path: "datasets/:datasetId", name: "dataset", component: () => import("./pages/DatasetDetailPage.vue"), props: true, meta: { title: "Dataset", section: "datasets", framed: true } },
        { path: "runs", name: "runs", component: () => import("./pages/RunsPage.vue"), meta: { title: "Runs", section: "runs" } },
        // antes la pestaña "Offline evals" de Overview (ADR-059)
        { path: "evaluations/trends", name: "trends", component: () => import("./pages/TrendsPage.vue"), meta: { title: "Trends", section: "trends" } },
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
    // solo experimentos que puede leer: un org_admin sin rol de trabajo aterriza en Admin (ADR-052)
    const readable = experiments.filter((e) => e.permissions.includes("experiment:read"));
    const target = readable.find((e) => e.id === lastId) ?? readable[0];
    if (!target) return { name: "admin" };
    return { name: "overview", params: { experimentId: target.id } };
  }

  const experimentId = to.params.experimentId;
  if (typeof experimentId === "string") {
    traceApi.setExperimentId(experimentId);
    localStorage.setItem(LAST_EXPERIMENT_KEY, experimentId);
  }

  return true;
});

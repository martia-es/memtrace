import { createRouter, createWebHistory } from "vue-router";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: { name: "spans" } },
    { path: "/spans", name: "spans", component: () => import("./pages/SpansPage.vue"), meta: { title: "Conversaciones", section: "spans", framed: true } },
    { path: "/conversations/:conversationId", name: "conversation", component: () => import("./pages/ConversationDetailPage.vue"), props: true, meta: { title: "Conversación", section: "spans", framed: true } },
    { path: "/traces/:traceId", name: "trace", component: () => import("./pages/TraceDetailPage.vue"), props: true, meta: { title: "Traza", section: "spans" } },
    { path: "/metrics", name: "metrics", component: () => import("./pages/MetricsPage.vue"), meta: { title: "Métricas", section: "metrics" } },
    { path: "/:pathMatch(.*)*", redirect: { name: "spans" } },
  ],
});

router.afterEach((to) => {
  document.title = `${String(to.meta.title ?? "MemTrace")} · MemTrace`;
});

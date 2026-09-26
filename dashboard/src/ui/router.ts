import { createRouter, createWebHistory } from "vue-router";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: { name: "conversations" } },
    { path: "/spans", redirect: { name: "conversations" } },
    { path: "/conversations", name: "conversations", component: () => import("./pages/ConversationsPage.vue"), meta: { title: "Conversaciones", section: "conversations", framed: true } },
    { path: "/conversations/:conversationId", name: "conversation", component: () => import("./pages/ConversationDetailPage.vue"), props: true, meta: { title: "Conversación", section: "conversations", framed: true } },
    { path: "/traces/:traceId", name: "trace", component: () => import("./pages/TraceDetailPage.vue"), props: true, meta: { title: "Traza", section: "conversations", framed: true } },
    { path: "/metrics", name: "metrics", component: () => import("./pages/MetricsPage.vue"), meta: { title: "Métricas", section: "metrics" } },
    { path: "/:pathMatch(.*)*", redirect: { name: "conversations" } },
  ],
});

router.afterEach((to) => {
  document.title = `${String(to.meta.title ?? "MemTrace")} · MemTrace`;
});

import { createRouter, createWebHistory } from "vue-router";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: { name: "traces" } },
    { path: "/traces", name: "traces", component: () => import("./pages/TracesPage.vue"), meta: { title: "Trazas" } },
    { path: "/traces/:traceId", name: "trace", component: () => import("./pages/TraceDetailPage.vue"), props: true, meta: { title: "Traza" } },
    { path: "/metrics", name: "metrics", component: () => import("./pages/MetricsPage.vue"), meta: { title: "Métricas" } },
    { path: "/:pathMatch(.*)*", redirect: { name: "traces" } },
  ],
});

router.afterEach((to) => {
  document.title = `${String(to.meta.title ?? "MemTrace")} · MemTrace`;
});

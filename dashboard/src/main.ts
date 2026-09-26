import "@fontsource-variable/plus-jakarta-sans";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "@quasar/extras/material-icons/material-icons.css";
import "quasar/dist/quasar.css";
import "./styles/app.css";
import { Notify, Quasar } from "quasar";
import { createApp } from "vue";
import App from "./App.vue";
import { createContainer, TRACE_API } from "./dependency-container";
import { router } from "./ui/router";

const container = createContainer();

// Solo tema claro: es el que define el diseño
createApp(App)
  .use(Quasar, { plugins: { Notify }, config: { dark: false } })
  .use(router)
  .provide(TRACE_API, container.traceApi)
  .mount("#app");

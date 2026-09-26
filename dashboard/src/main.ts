import "@quasar/extras/material-icons/material-icons.css";
import "quasar/dist/quasar.css";
import "./styles/app.css";
import { Dark, Notify, Quasar } from "quasar";
import { createApp } from "vue";
import App from "./App.vue";
import { createContainer, TRACE_API } from "./dependency-container";
import { router } from "./ui/router";

const container = createContainer();

createApp(App)
  .use(Quasar, { plugins: { Dark, Notify }, config: { dark: "auto" } })
  .use(router)
  .provide(TRACE_API, container.traceApi)
  .mount("#app");

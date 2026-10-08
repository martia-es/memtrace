import "@fontsource-variable/plus-jakarta-sans";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@quasar/extras/material-icons/material-icons.css";
import "quasar/dist/quasar.css";
import "./styles/app.css";
import { Dark, Notify, Quasar } from "quasar";
import { createApp } from "vue";
import App from "./App.vue";
import { ASSISTANT_API, getContainer, IDENTITY_API, PROMPT_API, TRACE_API } from "./dependency-container";
import { router } from "./ui/router";
import "./ui/composables/useTheme"; // aplica el tema persistido (ADR-017) antes del primer render

const container = getContainer();

createApp(App)
  .use(Quasar, { plugins: { Notify, Dark } })
  .use(router)
  .provide(TRACE_API, container.traceApi)
  .provide(IDENTITY_API, container.identityApi)
  .provide(ASSISTANT_API, container.assistantApi)
  .provide(PROMPT_API, container.promptApi)
  .mount("#app");

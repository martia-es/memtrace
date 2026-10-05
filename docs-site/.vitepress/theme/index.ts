import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import "@fontsource-variable/plus-jakarta-sans";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./style.css";
import DataModelDiagram from "./components/DataModelDiagram.vue";
import PermissionMatrix from "./components/PermissionMatrix.vue";
import PermissionSimulator from "./components/PermissionSimulator.vue";

const theme: Theme = {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("DataModelDiagram", DataModelDiagram);
    app.component("PermissionMatrix", PermissionMatrix);
    app.component("PermissionSimulator", PermissionSimulator);
  },
};

export default theme;

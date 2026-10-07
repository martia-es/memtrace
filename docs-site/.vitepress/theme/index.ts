import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import "@fontsource-variable/plus-jakarta-sans";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./style.css";
import DataModelDiagram from "./components/DataModelDiagram.vue";
import PermissionMatrix from "./components/PermissionMatrix.vue";
import PermissionSimulator from "./components/PermissionSimulator.vue";
import HomeHero from "./components/HomeHero.vue";
import { h } from "vue";

const theme: Theme = {
  extends: DefaultTheme,
  Layout: () => h(DefaultTheme.Layout, null, { "home-hero-before": () => h(HomeHero) }),
  enhanceApp({ app }) {
    app.component("DataModelDiagram", DataModelDiagram);
    app.component("PermissionMatrix", PermissionMatrix);
    app.component("PermissionSimulator", PermissionSimulator);
  },
};

export default theme;

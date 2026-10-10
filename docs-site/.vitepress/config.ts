import { defineConfig } from "vitepress";

export default defineConfig({
  title: "MemTrace Docs",
  description: "Observability and learning for AI agents: the Python library and the MemTrace platform.",
  cleanUrls: true,
  markdown: { theme: { light: "github-dark", dark: "github-dark" } },
  sitemap: { hostname: "https://docs.memtraces.ai" },
  themeConfig: {
    nav: [
      { text: "Library", link: "/library/", activeMatch: "/library/" },
      { text: "Platform", link: "/platform/", activeMatch: "/platform/" },
    ],
    sidebar: {
      "/library/": [
        {
          text: "Library",
          items: [
            { text: "Overview", link: "/library/" },
            { text: "Installation", link: "/library/installation" },
            { text: "Quickstart", link: "/library/quickstart" },
            { text: "Tracing steps", link: "/library/tracing" },
            { text: "Conversations", link: "/library/conversations" },
            { text: "Integrations", link: "/library/integrations" },
            { text: "Bring your own backend", link: "/library/bring-your-own-backend" },
            { text: "Configuration", link: "/library/configuration" },
            { text: "Personal data (PII)", link: "/library/pii" },
            { text: "Offline evaluation", link: "/library/evaluation" },
            { text: "User feedback", link: "/library/feedback" },
            { text: "Prompts", link: "/library/prompts" },
            { text: "Authentication", link: "/library/authentication" },
          ],
        },
      ],
      "/platform/": [
        {
          text: "Platform",
          items: [
            { text: "Overview", link: "/platform/" },
            { text: "Run it locally", link: "/platform/getting-started" },
            { text: "Dashboard", link: "/platform/dashboard" },
            { text: "Alerts & budgets", link: "/platform/alerts" },
            { text: "Datasets & offline evals", link: "/platform/evaluation" },
            { text: "Annotations & review", link: "/platform/annotations" },
            { text: "Prompts", link: "/platform/prompts" },
            { text: "Organizations & roles", link: "/platform/access-control" },
            { text: "Data protection", link: "/platform/data-protection" },
            { text: "Assistants catalog", link: "/platform/assistants" },
            { text: "Set up deploys", link: "/platform/deploy-setup" },
            { text: "Query API", link: "/platform/api" },
            { text: "Architecture", link: "/platform/architecture" },
          ],
        },
        {
          text: "Technical reference",
          items: [
            { text: "Data model", link: "/platform/data-model" },
            { text: "Roles & permissions", link: "/platform/roles-and-permissions" },
          ],
        },
      ],
    },
    search: { provider: "local" },
    outline: [2, 3],
  },
});

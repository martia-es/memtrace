import { defineConfig } from "vitepress";

export default defineConfig({
  title: "MemTrace Docs",
  description: "Observability and learning for AI agents: the Python library and the MemTrace platform.",
  cleanUrls: true,
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
            { text: "Configuration", link: "/library/configuration" },
            { text: "Personal data (PII)", link: "/library/pii" },
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
            { text: "Organizations & roles", link: "/platform/access-control" },
            { text: "Query API", link: "/platform/api" },
            { text: "Architecture", link: "/platform/architecture" },
          ],
        },
      ],
    },
    search: { provider: "local" },
    outline: [2, 3],
  },
});

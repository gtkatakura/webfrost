import { withMermaid } from "vitepress-plugin-mermaid";

export default withMermaid({
  title: "WebFrost",
  description:
    "Self-hosted web archiving toolkit — fastest practical archiver with one shared HTTP cache and no lock-in.",
  lang: "en-US",

  ignoreDeadLinks: [
    /^\/WEB\/issues\//,
    // Repo-root files not included in docs/
    /ROADMAP$/,
    /\.env\.example$/,
    // Diagram directory index links from legacy docs
    /\/diagrams\//,
  ],

  themeConfig: {
    logo: "/logo.svg",
    siteTitle: "WebFrost",

    nav: [
      { text: "Getting Started", link: "/getting-started/" },
      { text: "Guides", link: "/guides/cli-usage" },
      { text: "Reference", link: "/reference/cli" },
      { text: "Architecture", link: "/architecture/overview" },
    ],

    sidebar: {
      "/getting-started/": [
        {
          text: "Getting Started",
          items: [
            { text: "What is WebFrost?", link: "/getting-started/" },
            { text: "Quickstart", link: "/getting-started/quickstart" },
            { text: "Installation", link: "/getting-started/install" },
            { text: "Docker setup", link: "/getting-started/docker" },
          ],
        },
      ],
      "/guides/": [
        {
          text: "Guides",
          items: [
            { text: "CLI usage", link: "/guides/cli-usage" },
            { text: "Web UI", link: "/guides/web-ui" },
            { text: "SDK usage", link: "/guides/sdk-usage" },
            { text: "Bulk import", link: "/guides/bulk-import" },
            { text: "Scheduled archiving", link: "/guides/scheduled-archiving" },
            { text: "Storage backends", link: "/guides/storage-backends" },
            { text: "Docker deploy", link: "/guides/docker-deploy" },
            { text: "Cookies and sessions", link: "/guides/cookies-sessions" },
            { text: "Troubleshooting", link: "/guides/troubleshooting" },
          ],
        },
      ],
      "/reference/": [
        {
          text: "Reference",
          items: [
            { text: "CLI", link: "/reference/cli" },
            { text: "REST API", link: "/reference/rest-api" },
            { text: "SDK API", link: "/reference/sdk-api" },
            { text: "Configuration", link: "/reference/configuration" },
            { text: "Extractors", link: "/reference/extractors" },
            { text: "Supported sources", link: "/reference/supported-sources" },
            { text: "Supported outputs", link: "/reference/supported-outputs" },
            { text: "Disk layout", link: "/reference/disk-layout" },
            { text: "Database schema", link: "/reference/database-schema" },
          ],
        },
      ],
      "/architecture/": [
        {
          text: "Architecture",
          items: [
            { text: "Overview", link: "/architecture/overview" },
            { text: "Containers", link: "/architecture/containers" },
            { text: "Components", link: "/architecture/components" },
            { text: "Pipeline", link: "/architecture/pipeline" },
            { text: "Storage model", link: "/architecture/storage-model" },
            { text: "Security", link: "/architecture/security" },
          ],
        },
      ],
      "/contributing/": [
        {
          text: "Contributing",
          items: [
            { text: "Development setup", link: "/contributing/development" },
            { text: "Project structure", link: "/contributing/project-structure" },
            { text: "Roadmap", link: "/contributing/roadmap" },
          ],
        },
      ],
    },

    search: {
      provider: "local",
    },

    socialLinks: [
      {
        icon: "github",
        link: "https://github.com/gtkatakura/webfrost",
      },
    ],

    footer: {
      message: "WebFrost — self-hosted web archiving toolkit.",
    },

    editLink: {
      pattern: "https://github.com/gtkatakura/webfrost/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },
  },

  mermaid: {},
  mermaidPlugin: {
    class: "mermaid",
  },
});

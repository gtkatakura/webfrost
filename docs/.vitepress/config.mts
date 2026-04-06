import { withMermaid } from "vitepress-plugin-mermaid";

export default withMermaid({
  title: "WebFrost",
  description: "A self-hosted web archiving toolkit",
  base: "/",
  outDir: "../dist/docs",
  ignoreDeadLinks: true,

  themeConfig: {
    nav: [
      { text: "Getting Started", link: "/tutorials/first-archive" },
      { text: "Guides", link: "/how-to/bulk-import" },
      { text: "Reference", link: "/reference/cli" },
      { text: "Architecture", link: "/explanation/architecture" },
    ],

    sidebar: [
      {
        text: "Tutorials",
        items: [{ text: "Archive Your First Page", link: "/tutorials/first-archive" }],
      },
      {
        text: "How-to Guides",
        items: [
          { text: "Bulk Import", link: "/how-to/bulk-import" },
          { text: "Scheduled Archives", link: "/how-to/scheduled-archives" },
          { text: "Docker Deploy", link: "/how-to/docker-deploy" },
          { text: "S3 Storage", link: "/how-to/s3-storage" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "CLI Commands", link: "/reference/cli" },
          { text: "REST API", link: "/reference/rest-api" },
          { text: "SDK", link: "/reference/sdk" },
          { text: "Environment Variables", link: "/reference/environment-variables" },
          { text: "Extractors", link: "/reference/extractors" },
        ],
      },
      {
        text: "Architecture",
        items: [
          { text: "Architecture Overview", link: "/explanation/architecture" },
          { text: "Pipeline", link: "/explanation/pipeline" },
          { text: "Storage Model", link: "/explanation/storage-model" },
        ],
      },
      {
        text: "Operations",
        items: [
          { text: "Deployment", link: "/DEPLOY" },
          { text: "Release Process", link: "/RELEASE" },
          { text: "Versioning", link: "/VERSIONING" },
          { text: "Security", link: "/SECURITY" },
        ],
      },
    ],

    search: {
      provider: "local",
    },

    socialLinks: [{ icon: "github", link: "https://github.com/gtkatakura/webfrost" }],

    footer: {
      message: "WebFrost — self-hosted web archiving toolkit",
    },
  },
});

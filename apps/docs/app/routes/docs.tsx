import { useMDXComponents } from "@/components/mdx";
import { AuthorCredit } from "@/components/site-footer";
import { baseOptions } from "@/lib/layout.shared";
import { shareMeta } from "@/lib/site";
import { docs, source } from "@/lib/source";
import { useFumadocsLoader } from "fumadocs-core/source/client";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/layouts/docs/page";
import { use } from "react";
import type { Route } from "./+types/docs";

export async function loader({ params }: Route.LoaderArgs) {
  const slugs = params["*"].split("/").filter((v) => v.length > 0);
  const page = source.getPage(slugs);
  if (!page) throw new Response("Not found", { status: 404 });

  return {
    path: page.path,
    url: page.url,
    pageTree: await source.serializePageTree(source.getPageTree()),
  };
}

function Content({ path, url }: { path: string; url: string }) {
  const page = docs.getPage(path);
  if (!page) throw new Error(`unknown page: ${path}`);

  const { toc } = use(page.load());
  const Mdx = page.body;

  return (
    <DocsPage toc={toc} full={page.full}>
      <title>{`${page.title} · WebFrost`}</title>
      <meta name="description" content={page.description} />
      {shareMeta({
        title: `${page.title} · WebFrost`,
        description: page.description ?? "",
        path: url,
      }).map((tag) => (
        <meta key={"name" in tag ? tag.name : tag.property} {...tag} />
      ))}
      <DocsTitle>{page.title}</DocsTitle>
      <DocsDescription>{page.description}</DocsDescription>
      <DocsBody>
        <Mdx components={useMDXComponents()} />
      </DocsBody>
    </DocsPage>
  );
}

export default function Page({ loaderData }: Route.ComponentProps) {
  const { pageTree, path, url } = useFumadocsLoader(loaderData);

  return (
    <DocsLayout
      {...baseOptions({ inDocs: true })}
      tree={pageTree}
      sidebar={{ footer: <AuthorCredit className="px-2 pt-2" /> }}
    >
      <Content path={path} url={url} />
    </DocsLayout>
  );
}

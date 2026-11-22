import { Callout } from "fumadocs-ui/components/callout";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import { ArchDiagram } from "./arch-diagram";
import { Picture } from "./picture";
import { Screenshot } from "./screenshot";

// What a page may use without importing it.
export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    ArchDiagram,
    Callout,
    Picture,
    Screenshot,
    Step,
    Steps,
    Tab,
    Tabs,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}

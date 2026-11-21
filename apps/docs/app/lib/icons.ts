import type { LoaderPlugin } from "fumadocs-core/source";
import {
  Archive,
  BookBookmark,
  BookOpen,
  Boxes,
  Braces,
  Bug,
  CalendarClock,
  Compass,
  Database,
  Download,
  Eye,
  FileStack,
  FolderTree,
  GitPullRequest,
  Globe,
  HardDrive,
  LayoutDashboard,
  LifeBuoy,
  Lock,
  Network,
  Rocket,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Terminal,
  Upload,
  Workflow,
  Wrench,
  Zap,
} from "lucide-react";
import { type ComponentType, createElement } from "react";

/**
 * The icons that pages and sections name in their frontmatter or meta.json. Fumadocs' Lucide plugin
 * imports every Lucide icon (about 650 KB of JavaScript on every page); this imports only these.
 * A name missing here fails the build, so add new icons when a page uses them.
 */
const icons: Record<string, ComponentType> = {
  Archive,
  BookBookmark,
  BookOpen,
  Boxes,
  Braces,
  Bug,
  CalendarClock,
  Compass,
  Database,
  Download,
  Eye,
  FileStack,
  FolderTree,
  GitPullRequest,
  Globe,
  HardDrive,
  LayoutDashboard,
  LifeBuoy,
  Lock,
  Network,
  Rocket,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Terminal,
  Upload,
  Workflow,
  Wrench,
  Zap,
};

function resolve<T extends { icon?: unknown }>(node: T): T {
  if (typeof node.icon !== "string") return node;
  const Icon = icons[node.icon];
  if (!Icon) throw new Error(`Unknown icon "${node.icon}": add it to app/lib/icons.ts`);
  (node as { icon?: unknown }).icon = createElement(Icon);
  return node;
}

export const iconsPlugin: LoaderPlugin = {
  name: "webfrost:icons",
  transformPageTree: { file: resolve, folder: resolve, separator: resolve },
};

---
name: WebFrost
description: The web UI of a self-hosted web archive, in the Ice Blue palette shared with webfrost.dev.
colors:
  app: "#f7f9fd"
  surface: "#ffffff"
  overlay: "#edf2fa"
  subtle: "#e6efff"
  border: "#dbe3f0"
  border-strong: "#c0cce1"
  text-high: "#0c1424"
  text-mid: "#4d5b72"
  text-low: "#5f6d85"
  accent: "#1d64d8"
  accent-hover: "#1a56bb"
  accent-text: "#1a56bb"
  success: "#047857"
  warning: "#a94a07"
  danger: "#c62828"
  frost-from: "#1d64d8"
  frost-to: "#0891b2"
  dark-app: "#080c16"
  dark-surface: "#0e1422"
  dark-overlay: "#111a2a"
  dark-border: "#1b2538"
  dark-text-high: "#e9eef8"
  dark-text-mid: "#97a3b8"
  dark-text-low: "#8592a8"
  dark-accent: "#7cc4ff"
typography:
  page-title:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  toolbar-title:
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.3
  card-title:
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.35
  body:
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  secondary:
    fontSize: "13px"
    lineHeight: 1.4
  meta:
    fontSize: "12px"
    lineHeight: 1.35
  label-caps:
    fontSize: "12px"
    fontWeight: 600
    letterSpacing: "0.06em"
  mono:
    fontFamily: "ui-monospace, Cascadia Code, Fira Code, JetBrains Mono, monospace"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  full: "9999px"
spacing:
  page-x: "16px / 24px from sm"
  page-y: "24px / 32px from sm"
  panel: "12px-20px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "0 12px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    backgroundColor: "{colors.overlay}"
    textColor: "{colors.text-high}"
    rounded: "{rounded.md}"
    height: "32px"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-high}"
    rounded: "{rounded.md}"
    padding: "5.6px 11.2px"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.xl}"
    padding: "16px"
  status-badge-done:
    backgroundColor: "#04785719"
    textColor: "{colors.success}"
    rounded: "{rounded.full}"
---

# Design System: WebFrost

## Overview

**Creative North Star: "The Cold Store"** (inferred, not yet confirmed with the owner): a quiet, well-lit archive room. Everything is labelled, nothing is decorated, and the one cold blue tells you where to act.

WebFrost's UI is an Operate surface: a tool someone opens to archive a URL, check that it worked and find it again. Density is moderate (rows of 36-56px, 14px body), the shell is a left sidebar with a search trigger, and pages are a title, an optional toolbar panel, and one list or table. Brand lives in the details: the hexagon-snowflake mark, the gradient "Frost" in the wordmark, the sleeping arctic fox on empty archives, and the Ice Blue accent.

**Key Characteristics:**
- Semantic tokens only (`bg-surface`, `text-mid`, `border-border`…), defined once in `src/index.css` for light and dark.
- System sans for everything; monospace only for URLs, cron expressions, extractor codes and keys.
- Flat surfaces separated by 1px borders; shadow only on floating layers.
- State is explicit: loading skeletons, teaching empty states, errors with a reason and Retry.

## Colors

A cool neutral ground with one blue accent; status colours appear only where they carry meaning.

### Primary
- **Ice Blue** (`accent`): primary buttons, the active nav icon and its 2px inset rail, links, focus ring, selection. In dark mode it becomes the pale `dark-accent`, with near-black text on it.
- **Deep Ice** (`accent-text`): accent used as text on an accent tint (`accent/10`, `accent-soft`), where plain accent would drop below 4.5:1.

### Neutral
- **Frost Ground** (`app`), **Snow** (`surface`), **Rime** (`overlay`) and **Glacier Tint** (`subtle`): page, panels, table heads and hover.
- **Ink**, **Slate**, **Fog** (`text-high`, `text-mid`, `text-low`): all three are 4.5:1 or more on every ground, in both themes.

### Named Rules
**The Not-a-Failure Rule.** Red means something failed. An extractor that did not run is quiet (dashed, `text-low`), never red.
**The Tint Rule.** Text on a `/10` tint of a colour uses that colour's text token (`accent-text`, `success`, `danger`, `warning`), each verified at 4.5:1 on the tint.
**The User Colour Rule.** Tag colours are the user's data: inline hex, with near-black or white text picked by contrast ratio.

## Typography

**Body Font:** the system UI stack. **Mono:** `ui-monospace` stack.

Fixed steps, no fluid type: 12 / 13 / 14 / 16 / 20 / 24px (`text-ui-xs` … `text-ui-2xl`). Nothing below 12px except the `kbd` key cap (11px mono).

### Hierarchy
- **Page title** (600, 24px): the h1 of every content page, through `PageHeader`.
- **Toolbar title** (600, 20px): the h1 of the full-height Snapshots workspace.
- **Card title** (600, 16px): Settings sections, API key sections.
- **Body** (400, 14px): rows, forms, reader text (line-height 1.6 there).
- **Secondary** (13px): descriptions, field text, filters.
- **Meta** (12px): dates, counts, chips, URLs under titles.
- **Label caps** (600, 12px, 0.06em, uppercase, `text-mid`): section headings, table headers, stat labels, day dividers. Never above another heading.

Headings use `text-wrap: balance`; paragraphs `text-wrap: pretty`.

## Layout

Sidebar 240px (56px collapsed) from 1024px up; a 48px top bar and a drawer below. Content pages centre in `max-w-3xl` to `max-w-5xl` with 16px side padding (24px from 640px). Tables become stacked cards below 640px (Schedules). Rhythm: 24px under the page header, 24-32px between sections, 8-12px inside groups.

## Elevation & Depth

Flat by default: depth is tonal (`app` < `surface` < `overlay`) plus 1px borders. `shadow-xl`/`shadow-2xl` only on layers that float above the page: dialogs, the detail slide-over, popovers, the bulk-action bar.

## Shapes

Gently rounded: 6px on controls, 8px on rows and cards inside panels, 12px on panels and stat cards, full pills for status badges, tags and counts.

## Components

### Buttons
- **Shape:** 6px radius, fixed heights 28 / 32 / 36px (`sm`/`md`/`lg`) so they align with fields (32px, or 36px with `field-lg`).
- **Primary:** accent fill. **Secondary:** `overlay` fill with border. **Ghost:** transparent, `text-mid`. **Danger:** danger fill; on lists, a ghost button that turns danger on hover.

### Inputs / Fields
- `field` utility: 1px border, 6px radius, 13px text; border-strong on hover, accent border plus the focus ring on focus; danger border when `aria-invalid`.

### Chips
- Status badge: pill, `/10` tint, 12px semibold. Extractor chip: 3-letter mono code, tinted when captured, dashed when not. Tag chip: pill in the user's colour. Filter rows: full-width toggle rows with a check.

### Cards / Containers
- Panels: `surface`, 1px border, 12px radius, 12-20px padding. No nested cards: rows inside a panel are separated by borders.

### Navigation
- Sidebar: grouped "Archive" / "Manage" with label-caps headings; 40px items; active = `subtle` fill, accent icon, 2px inset accent rail; account card at the foot.

## Do's and Don'ts

### Do:
- **Do** use `PageHeader` for every page title, and `label-caps` for every small heading.
- **Do** keep touch targets at 32px on desktop and 40px for primary phone controls.
- **Do** show title first and URL second (mono, 12px) wherever a snapshot is listed.

### Don't:
- **Don't** paint a missing or not-applicable state red.
- **Don't** use type outside the six-step scale (no `text-2xl`, `text-[22px]`).
- **Don't** use the Frost gradient on anything but the wordmark.
- **Don't** add icons to page titles; the sidebar already carries them.

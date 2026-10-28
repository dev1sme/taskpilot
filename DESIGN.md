---
name: TaskPilot
description: Calm professional coordination for coding agents.
colors:
  dark-bg: "#0f172a"
  dark-sidebar: "#0b1222"
  dark-surface: "#1b2336"
  dark-raised: "#232c3f"
  dark-hover: "#283245"
  dark-sunken: "#0a101e"
  dark-line: "#2a3446"
  dark-line-strong: "#475569"
  dark-ink: "#f8fafc"
  dark-muted: "#a3b1c6"
  dark-faint: "#94a3b8"
  dark-signal: "#22c55e"
  dark-signal-text: "#4ade80"
  dark-on-signal: "#0f172a"
  dark-signal-soft: "rgba(34, 197, 94, 0.14)"
  dark-attention: "#fbbf24"
  dark-on-attention: "#0f172a"
  dark-attention-soft: "#2a2414"
  dark-attention-line: "#6b5520"
  dark-done: "#4ade80"
  dark-done-soft: "rgba(74, 222, 128, 0.12)"
  dark-danger: "#fca5a5"
  dark-danger-soft: "rgba(248, 113, 113, 0.14)"
  dark-cat-read: "#60a5fa"
  dark-cat-write: "#4ade80"
  dark-cat-run: "#c4b5fd"
  dark-cat-search: "#22d3ee"
  dark-cat-web: "#fdba74"
  dark-cat-agent: "#f9a8d4"
  dark-cat-plan: "#fcd34d"
  dark-cat-other: "#a3b1c6"
  dark-terminal: "#0a0f1c"
  light-bg: "#f8fafc"
  light-sidebar: "#f1f5f9"
  light-surface: "#ffffff"
  light-raised: "#f4f7fa"
  light-hover: "#eaeff5"
  light-sunken: "#eef2f6"
  light-line: "#e2e8f0"
  light-line-strong: "#cbd5e1"
  light-ink: "#0f172a"
  light-muted: "#475569"
  light-faint: "#556378"
  light-signal: "#15803d"
  light-signal-text: "#166534"
  light-on-signal: "#ffffff"
  light-signal-soft: "rgba(21, 128, 61, 0.1)"
  light-attention: "#92400e"
  light-on-attention: "#ffffff"
  light-attention-soft: "#fff7e6"
  light-attention-line: "#f5d28a"
  light-done: "#166534"
  light-done-soft: "rgba(22, 101, 52, 0.1)"
  light-danger: "#b91c1c"
  light-danger-soft: "rgba(185, 28, 28, 0.08)"
  light-cat-read: "#1d4ed8"
  light-cat-write: "#166534"
  light-cat-run: "#6d28d9"
  light-cat-search: "#0e7490"
  light-cat-web: "#c2410c"
  light-cat-agent: "#be185d"
  light-cat-plan: "#92400e"
  light-cat-other: "#475569"
typography:
  body:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "15px"
    lineHeight: 1.5
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
  label:
    fontSize: "13px"
    fontWeight: 500
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
spacing:
  button-block: "6px"
  button-inline: "14px"
  pill-block: "3px"
  pill-inline: "10px"
components:
  button-primary-dark:
    backgroundColor: "{colors.dark-signal}"
    textColor: "{colors.dark-on-signal}"
    rounded: "{rounded.sm}"
    padding: "6px 14px"
    height: "34px"
  button-attention-dark:
    backgroundColor: "{colors.dark-attention}"
    textColor: "{colors.dark-on-attention}"
    rounded: "{rounded.sm}"
    padding: "6px 14px"
    height: "34px"
  button-secondary-dark:
    backgroundColor: "{colors.dark-raised}"
    textColor: "{colors.dark-ink}"
    rounded: "{rounded.sm}"
    padding: "6px 14px"
    height: "34px"
  button-primary-light:
    backgroundColor: "{colors.light-signal}"
    textColor: "{colors.light-on-signal}"
    rounded: "{rounded.sm}"
    padding: "6px 14px"
    height: "34px"
  button-attention-light:
    backgroundColor: "{colors.light-attention}"
    textColor: "{colors.light-on-attention}"
    rounded: "{rounded.sm}"
    padding: "6px 14px"
    height: "34px"
  button-secondary-light:
    backgroundColor: "{colors.light-raised}"
    textColor: "{colors.light-ink}"
    rounded: "{rounded.sm}"
    padding: "6px 14px"
    height: "34px"
---

# Design System: TaskPilot

## Overview

**Creative North Star: "Converging work streams", run as a developer tool.**

TaskPilot is a calm, dense working environment for coordinating coding agents over long sessions. The visual direction comes from ui-ux-pro-max for developer tools: dark mode first with Swiss-style minimalism, slate surfaces, a green "run" accent, monospace headings and a terminal-like real-time monitor feel. Light appearance is a full peer of dark.

The three streams of the brand mark converge into one forward path: coordination without decoration on working surfaces.

**Key Characteristics:**

- Slate surfaces (dark first, light supported), dense dashboard spacing.
- One green accent for interaction and progress; amber only for work needing the user; red for failure.
- IBM Plex Sans for interface text, JetBrains Mono for headings, code and terminal.
- Clear type hierarchy, sharp restrained shadows, short (150–250 ms) transitions.

## Colors

Frontmatter keys prefixed `dark-` describe the default root palette; `light-` keys describe the overrides of `html[data-theme="light"]`. The source of implementation truth is `apps/web/src/styles/tokens.css`; Tailwind's theme (`apps/web/src/styles/app.css`) only names those variables. Do not add a second token API or raw hex values in components. The terminal background stays dark in both appearances.

### Primary

- **Run green:** `signal` fills primary actions and the brand tile; `signal-text` is accent text; `on-signal` its foreground; `signal-soft` selection and the current navigation item.

### Secondary

- **Amber:** `attention`, its foreground, soft surface and border mark approval, answers and permission requests: work waiting on the user.
- **Done:** `done` and `done-soft` mark completion. It shares the green family with `signal`, so completion is never shown by color alone: it always carries its check icon and label.
- **Error red:** `danger` and `danger-soft` mark failure and destructive intent.

### Neutral

- `bg`, `sidebar`, `surface`, `raised`, `hover` and `sunken` give tonal separation; `ink`, `muted` and `faint` give text hierarchy; `line` and `line-strong` separate content and outline controls.
- Category tokens (`cat-*`) are a functional vocabulary for tool activity and provider badges, not extra brand accents.

**The Semantic Color Rule.** Amber only for requests needing the user; green for interaction and progress, completion always with its check icon; red for failure. Never convey state by color alone.

**The Contrast Rule.** Every text/background pair in use is at least 4.5:1 in both appearances (checked when the palette was set). Re-check rendered combinations; token values alone are no proof of conformance.

## Typography

IBM Plex Sans (with system sans fallbacks) is the interface face at a 15 px base. JetBrains Mono (with monospace fallbacks) serves headings (h1–h3), code, file paths, keys and the terminal. Both are bundled with `@fontsource`, never fetched from a CDN. Body text is never below 12 px.

## Layout

Dense dashboard spacing (ui-ux-pro-max density 8: an 8–32 px rhythm). Pages put the next decision and the work in progress first; configuration inventory and history are secondary. Layouts are mobile-first and verified at 375, 768, 1024 and 1440 px with no horizontal page scroll: tables become stacked rows on narrow screens, long file names truncate with the full name available.

Requirements carried from the impeccable critique of the previous client (2026-10-28):

- Overview: the attention list and running work (with agent, model and elapsed time) lead; configuration inventory moves to a compact secondary summary.
- Task list: local search plus quick filters (needs you, running, open, done, all); stacked rows on mobile with status next to the key.
- Task screen on mobile: compact header (key as metadata, title on at most two lines), short primary CTA (for example "Duyệt và tiếp tục") with consequences below it, few nested borders.
- Config scope selectors: short labels (Project, Local, Global) with the file name as secondary text.
- Rare or destructive actions (rerun, cancel) live in a "Tác vụ" menu, not beside the primary action.

## Elevation & Depth

Tonal surfaces and borders carry everyday hierarchy; shadows only for overlays (menus, dialogs, toasts). Focus is a visible two-pixel green outline with a two-pixel offset. Transitions use 150–250 ms ease-out on color and opacity, never width or height; `prefers-reduced-motion` turns motion off.

## Shapes

Small radius on controls, medium and large on containers; pills and provider badges are fully rounded. The brand tile is a rounded square (32 px tile, 24 px mark) with the converging-stream glyph: one stroked path, rounded caps and joins.

## Components

Components are shadcn-style wrappers over Radix primitives in `apps/web/src/components/ui/` (button, input, label, dialog, dropdown menu, tabs, tooltip, badge, sheet, command, toaster). Pages compose these; they do not restyle Radix primitives ad hoc.

### Buttons

Variants: primary (green), attention (amber, only for the user's pending decision), secondary (raised neutral), ghost, danger, link. Pointer targets are at least 32 px high on desktop and never below the WCAG 2.2 minimum of 24×24 px; icon-only buttons carry an accessible label and a tooltip. A running action shows a spinner and disables the button.

### Chips

Status badges use neutral defaults and semantic soft backgrounds (signal, attention, done, danger), always with text, and with an icon where the state matters.

### Inputs / Fields

Visible labels above fields (never placeholder-only), errors next to the field with `aria-describedby`, green focus border. Forms use react-hook-form with zod schemas.

### Navigation

Sidebar groups (Workspace, Cấu hình agent, Tích hợp) in three modes: full column, icon rail (remembered) and a sheet drawer below 860 px. The current page uses `signal-soft` with a filled icon. Ctrl/Cmd+K opens the command palette; matching ignores Vietnamese diacritics.

### Brand Mark

Use `BrandMark` from `apps/web/src/components/brand-mark.tsx`: the approved converging-stream path on the green tile. It is decorative and hidden from assistive technology.

## Do's and Don'ts

### Do:

- Do use the semantic tokens through Tailwind's theme names.
- Do keep text and icons with every status color.
- Do keep pointer targets at least 24 px (32 px on desktop) and visible focus.
- Do verify both appearances and the four reference widths.

### Don't:

- Don't use amber as a general accent.
- Don't show completion by green alone.
- Don't use emoji as icons; use Phosphor icons.
- Don't recolor provider identities or terminal ANSI palettes as part of branding.
- Don't claim accessibility conformance from token values alone.

## Theme selection

The sidebar offers system, light and dark, stored in localStorage under `taskpilot.theme`. The resolved theme is set on `html[data-theme]` before the first paint (inline script in `apps/web/index.html`). System mode follows live OS changes; the terminal stays dark.

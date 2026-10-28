---
name: TaskPilot
description: Calm professional coordination for coding agents.
colors:
  dark-bg: "#18191b"
  dark-sidebar: "#1c1d20"
  dark-surface: "#212225"
  dark-raised: "#27282c"
  dark-hover: "#303136"
  dark-sunken: "#141517"
  dark-line: "#34353b"
  dark-line-strong: "#50525b"
  dark-ink: "#e6e7eb"
  dark-muted: "#afb1bb"
  dark-faint: "#9598a4"
  dark-signal: "#85c7b2"
  dark-signal-text: "#a1d7c6"
  dark-on-signal: "#10251d"
  dark-signal-soft: "rgba(133, 199, 178, 0.12)"
  dark-attention: "#e6b566"
  dark-on-attention: "#1d1404"
  dark-attention-soft: "#29251e"
  dark-attention-line: "#655338"
  dark-done: "#91c79b"
  dark-done-soft: "rgba(145, 199, 155, 0.12)"
  dark-danger: "#ff8a8a"
  dark-danger-soft: "rgba(255, 107, 107, 0.13)"
  dark-cat-read: "#85c7b2"
  dark-cat-write: "#91c79b"
  dark-cat-run: "#b48cf2"
  dark-cat-search: "#3fc1c9"
  dark-cat-web: "#f08a5d"
  dark-cat-agent: "#e879b0"
  dark-cat-plan: "#d8b44a"
  dark-cat-other: "#afb1bb"
  dark-terminal: "#141517"
  light-bg: "#f5f6f1"
  light-sidebar: "#ebeee6"
  light-surface: "#ffffff"
  light-raised: "#f7f9f3"
  light-hover: "#e3e9dd"
  light-sunken: "#eef1e8"
  light-line: "#dce2d5"
  light-line-strong: "#bac6b7"
  light-ink: "#181d1b"
  light-muted: "#536451"
  light-faint: "#586a53"
  light-signal: "#226d53"
  light-signal-text: "#195e46"
  light-on-signal: "#ffffff"
  light-signal-soft: "rgba(34, 109, 83, 0.1)"
  light-attention: "#8a5c00"
  light-on-attention: "#ffffff"
  light-attention-soft: "#fff7e8"
  light-attention-line: "#f0d29a"
  light-done: "#426d27"
  light-done-soft: "rgba(66, 109, 39, 0.1)"
  light-danger: "#c0362c"
  light-danger-soft: "rgba(192, 54, 44, 0.08)"
  light-cat-read: "#226d53"
  light-cat-write: "#426d27"
  light-cat-run: "#7046c2"
  light-cat-search: "#0d7f87"
  light-cat-web: "#b4501f"
  light-cat-agent: "#b3366f"
  light-cat-plan: "#8a6a00"
  light-cat-other: "#536451"
typography:
  body:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "15px"
    lineHeight: 1.5
  mono:
    fontFamily: "Geist Mono, ui-monospace, monospace"
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

**Creative North Star: "Converging work streams"**

TaskPilot is a calm, professional working environment for sustained coordination of coding agents. Neutral charcoal surfaces in dark appearance and warm neutral surfaces in light appearance carry the information; jade identifies interaction, amber identifies work needing the user, and leaf green identifies completion.

The three streams of the brand mark converge into one forward path. This provides a compact expression of coordination without adding decoration to working surfaces. Both light and dark appearances belong to the same system.

**Key Characteristics:**

- Neutral charcoal dark surfaces and warm light surfaces.
- Restrained jade interaction accents.
- Distinct amber attention and leaf completion states.
- Compact, legible controls and a converging-stream brand mark.

## Colors

The palette combines neutral charcoal dark surfaces and warm mineral light surfaces with a restrained jade accent. Frontmatter keys prefixed `dark-` describe the default root palette; `light-` keys describe overrides under `prefers-color-scheme: light`. The source of implementation truth is `client/src/styles/tokens.css`; do not turn these theme prefixes into a second CSS token API. The terminal background intentionally remains dark in both appearances.

### Primary

- **Jade:** `signal` fills primary actions and the brand tile; `signal-text` supports accent text; `on-signal` supplies foreground contrast; `signal-soft` supports selection and hover halos.

### Secondary

- **Amber:** `attention`, its foreground, soft surface and border identify approval, response, or other user attention.
- **Leaf:** `done` and its soft surface communicate completion.
- **Error red:** `danger` and its soft surface communicate failure or destructive intent.

### Neutral

- `bg`, `sidebar`, `surface`, `raised`, `hover`, and `sunken` provide quiet tonal separation.
- `ink`, `muted`, and `faint` establish information hierarchy; `line` and `line-strong` separate content and outline controls.
- Category tokens remain a separate functional vocabulary for tools and provider badges. They are not extra brand accents.

**The Semantic Color Rule.** Reserve amber for requests needing the user, leaf green for completion, and jade for interaction. Keep text and icons alongside status color.

**The Preserve the Workspace Rule.** A palette or logo change preserves existing layout, density, responsive behavior, labels, and task actions.

## Typography

Geist with system sans fallbacks is the interface face. Geist Mono with system monospace fallbacks serves code and terminal contexts. The established body is compact and readable; preserve the current type hierarchy. Pills use the label role, provider badges use smaller semibold text, and document headings retain their current scale. No display face is introduced by this brand update.

## Layout

Preserve the existing workspace layout, component spacing, breakpoints and responsive behavior. This system change defines color and identity; it does not authorize new page compositions or new density rules. The spacing entries record observed button and pill padding rather than inventing a global spacing scale.

## Elevation & Depth

Tonal surfaces and borders carry everyday hierarchy. Existing overlay shadows remain theme dependent: dark uses the stronger ambient shadow and light uses a softer one. Primary and attention buttons retain their soft color halo on hover. Focus remains a visible two-pixel jade outline with a two-pixel offset. State transitions retain the existing fast ease-out motion; reduced-motion preferences retain their existing override.

## Shapes

Controls use gently rounded small corners; larger containers use the established medium and large radii. Pills and provider badges retain fully rounded ends. The brand tile retains its own rounded-square silhouette, with a 32-pixel tile and 24-pixel mark. The logo is a single stroked glyph, with rounded caps and joins, representing three streams converging toward a rightward path.

## Components

### Buttons

Compact and restrained. Retain the existing padding, small radius, border and minimum height. Primary actions use jade with the paired foreground. Attention actions use amber with its paired foreground. Secondary buttons use raised neutral surfaces; quiet buttons remain transparent; danger buttons retain red text and outline. Preserve hover halos, visible focus, pressed translation, and disabled opacity. Frontmatter height records the ordinary minimum height; allow content to grow.

### Chips

Status pills use muted neutral defaults and semantic soft backgrounds for interaction, attention, completion and errors. Preserve their compact padding, label typography and rounded shape.

### Inputs / Fields

Keep existing field geometry and focus behavior. The command palette uses a borderless field inside a divided row, with muted supporting icons. Apply the shared surface, ink and line tokens instead of adding a new field treatment.

### Navigation

Preserve existing navigation geometry and responsive collapse behavior. Muted labels become ink on hover; the current location uses stronger weight and a neutral hover-toned surface. Brand changes do not add new navigation chrome.

### Brand Mark

Use `BrandMark` from `client/src/shared/ui/BrandMark.tsx`. Preserve the approved converging-stream SVG path, rounded stroke, jade tile and paired foreground. The decorative mark is hidden from assistive technology; surrounding product text supplies the name.

## Do's and Don'ts

### Do:

- Do use semantic CSS variables so both appearances stay aligned.
- Do retain status text and icons alongside color.
- Do preserve the existing control geometry and responsive behavior.
- Do use the converging-stream mark with its established path geometry.

### Don't:

- Don't use amber as a general brand accent.
- Don't use completion green for primary actions.
- Don't recolor provider identities or terminal ANSI palettes as part of branding.
- Don't claim accessibility conformance from token values alone; verify rendered combinations.

## Theme selection

The sidebar offers system, light, and dark preferences, stored in browser localStorage under `taskpilot.theme`. The resolved theme is applied through `html[data-theme]` before rendering. System mode follows live OS preference changes; terminal remains dark.

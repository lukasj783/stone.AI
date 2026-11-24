---
name: "Genesis Pro"
description: "Design tokens for the Genesis Pro web app, extracted from the running app with Dembrandt v0.41.0 (Home, Story, Image pages) and cleaned up by hand."
colors:
  background: "#000000"      # page background (black)
  surface: "#18181B"         # zinc-900: cards, inputs, active nav item
  border: "#27272A"          # zinc-800: card and control borders
  text: "#FFFFFF"            # headings, active labels
  text-body: "#EDEDED"       # default body text
  text-muted: "#9F9FA9"      # zinc-400: inactive labels, captions (8.0:1 on black)
  primary: "#9810FA"         # purple-600: Upgrade button, primary actions
  accent: "#AD46FF"          # purple-500: active indicator bar, focus rings
  secondary: "#EFB100"       # yellow-500: highlights and badges
typography:
  fontFamily: "Geist"
  monoFamily: "Geist Mono"
  display:    { fontSize: "60px", fontWeight: 800, lineHeight: 1.25, letterSpacing: "-1.5px" }
  heading-1:  { fontSize: "36px", fontWeight: 800, lineHeight: 1.11, letterSpacing: "-0.9px" }
  heading-2:  { fontSize: "24px", fontWeight: 800, lineHeight: 1.33, letterSpacing: "-0.6px" }
  heading-3:  { fontSize: "18px", fontWeight: 700, lineHeight: 1.56, letterSpacing: "-0.45px" }
  lead:       { fontSize: "20px", fontWeight: 500, lineHeight: 1.4 }
  body:       { fontSize: "16px", fontWeight: 400, lineHeight: 1.5 }
  body-sm:    { fontSize: "14px", fontWeight: 400, lineHeight: 1.43 }
  label:      { fontSize: "14px", fontWeight: 700, lineHeight: 1.43 }
  caption:    { fontSize: "12px", fontWeight: 500, lineHeight: 1.33 }
  overline:   { fontSize: "10px", fontWeight: 700, lineHeight: 1.5, letterSpacing: "0.1em", textTransform: "uppercase" }
spacing:
  base: "4px"
  scale: ["2px", "4px", "6px", "8px", "10px", "12px", "16px", "20px", "24px", "32px"]
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  full: "9999px"
---

# Genesis Pro design system

Genesis Pro is a dark app: black page, zinc greys for surfaces and text, and purple as the single action colour. Build new UI with the Tailwind classes below so it matches what is already there.

## Colour

| Role | Value | Tailwind | Use it for |
|---|---|---|---|
| Background | `#000000` | `bg-black` | Page background |
| Surface | `#18181B` | `bg-zinc-900` | Cards, inputs, the active nav item |
| Border | `#27272A` | `border-zinc-800` | Card and control borders (`border-zinc-900` for faint dividers) |
| Text | `#FFFFFF` | `text-white` | Headings, active labels |
| Muted text | `#9F9FA9` | `text-zinc-400` | Inactive labels, descriptions, section headers |
| Primary | `#9810FA` | `bg-purple-600` | Primary buttons such as Upgrade |
| Accent | purple-500 | `bg-purple-500` | Active indicator bar, focus rings |
| Secondary | `#EFB100` | `text-yellow-500` | Highlights and badges, sparingly |

The home headline uses a purple-to-blue gradient on its second line. Keep gradients to headline text.

### Contrast rule

On the black background, **text must be `zinc-400` or lighter**.

| Colour on black | Ratio | Body text (4.5:1) |
|---|---|---|
| `zinc-400` | 8.0:1 | Pass |
| `zinc-500` | 4.35:1 | Fail |
| `zinc-600` | 2.72:1 | Fail |

Use `zinc-500` and darker only for icons, borders and decoration, never for words. White on `purple-600` is 5.5:1 and passes.

## Typography

Geist for everything, Geist Mono for code and numbers that should line up. Headings are tight (negative letter spacing) and heavy (700–800).

| Style | Size / weight | Use it for |
|---|---|---|
| Display | 60px / 800 | One hero headline per page |
| Heading 1 | 36px / 800 | Page titles |
| Heading 2 | 24px / 800 | Section titles ("Create Story") |
| Heading 3 | 18px / 700 | Card titles |
| Lead | 20px / 500 | The line under a hero headline |
| Body | 16px / 400 | Paragraphs |
| Body small | 14px / 400 | Dense UI text |
| Label | 14px / 700 | Buttons, tabs |
| Caption | 12px / 500 | Metadata, helper text |
| Overline | 10px / 700, uppercase, wide tracking | Small section headers ("Navigation") |

A heading should always be larger or heavier than the body text next to it.

## Spacing and shape

- Spacing follows a 4px grid (Tailwind's default scale). The half steps `1.5` (6px) and `2.5` (10px) are used for tight controls and are fine there.
- Corner radius: `rounded` 4px for badges, `rounded-md` 6px and `rounded-lg` 8px for small controls, `rounded-xl` 12px for buttons, nav items and cards, `rounded-full` for avatars and pills.
- Elevation is mostly borders, not shadows. Large floating panels use `shadow-2xl`.

## Scrollbars

Use one of the classes in `app/globals.css`:

- `scrollbar-hidden` (aliases `scrollbar-none`, `no-scrollbar`): hidden, still scrollable.
- `scrollbar-visible`: a thin, dark scrollbar.
- `scrollbar-hover-only`: thin scrollbar that appears on hover.

Never leave a scroll area with the browser's default scrollbar.

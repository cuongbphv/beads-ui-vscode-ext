# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** Beads Kanban UI
**Generated:** 2026-08-04 01:50:17
**Category:** Productivity Tool
**Design Dials:** Variance 3/10 (Centered / Minimal) | Motion 2/10 (Subtle) | Density 9/10 (Dense / Dashboard)

---

## ⚠️ Project Overrides — read these FIRST

This file was generated from a generic web/landing-page template. Beads Kanban UI is a **VSCode extension
webview**, not a website. Where the sections below disagree with this block, **this block wins**.

### Hard constraints (VSCode webview)

| Generated guidance | Override for this project | Why |
|---|---|---|
| `@import` Google Fonts (Inter) | **Never.** Use `var(--vscode-font-family)` and `var(--vscode-editor-font-family)` for code/ids | Webview CSP blocks remote hosts; the extension must work offline |
| Hardcoded hex colors in components | **Never.** Map every token to `--vscode-*` variables in `src/webview/styles/globals.css`; the palette below is only a fallback/semantic reference | The user's theme is the source of truth; a hardcoded palette breaks every custom theme |
| `Exaggerated Minimalism`, `clamp(3rem 10vw 12rem)`, `font-weight: 900`, "massive whitespace" | **Discard.** Style is **Flat Design + micro-interactions** with dense spacing. Body 13px, headings 13-18px, `font-weight` 400/500/600 only | This is an information-dense dev tool inside an editor pane, not an editorial hero |
| Page pattern "Minimal Single Column" with hero + CTA + footer | **Discard.** Pattern is **Drill-Down Analytics**: Overview → Epic → Task, presented as tabs (Overview / Roadmap / Board) | There is no marketing funnel; the job is scanning and controlling work items |
| GSAP `ScrollTrigger` scroll-reveal | **Discard.** No GSAP dependency. Motion is CSS transitions only, 150-300ms, on hover/focus/expand/status-change | GSAP is dead weight in a `.vsix`; scroll-reveal hides data the user came to read |
| `@media` breakpoints at 375/768/1024/1440px | Use **CSS container queries** on the webview root. A panel can be 400px wide while the viewport is 2560px | Media queries report the window size, not the panel size |
| Card padding 24px, radius 12px, `translateY(-2px)` on hover | Card padding 8-12px, radius 4-6px, hover = background/border change only, **no transform** | Dense lists; transforms cause layout shift and drag jitter in dnd-kit |

### Responsive tiers (container queries on the webview root)

| Container width | Board | Overview stat cards | Detail |
|---|---|---|---|
| `< 500px` | 1 column + status switcher | 1 column | Full-width sheet |
| `500-900px` | scroll-snap columns | 2 columns | Full-width sheet |
| `> 900px` | all columns visible | 4 columns | Side pane |

### Card content budget (the core complaint about existing Beads Kanban UIs)

A bead card shows **exactly four things** and nothing else: issue id, truncated title, type icon,
priority dot. Epic parent may appear as a subtle prefix on the id.
**No label chips. No assignee pills. No status badges** — status is the column the card sits in.
Everything else lives in the detail pane.

### Non-negotiable accessibility rules

- Status and priority are **never** conveyed by colour alone — always colour **plus** an icon or text.
- Contrast at least 4.5:1 verified in **both** a light and a dark VSCode theme.
- Every icon-only button has an `aria-label`; every interactive element has a visible focus ring.
- Drag-and-drop always has a keyboard/menu equivalent (`bd update --status` via the quick-action menu).
- `@media (prefers-reduced-motion: reduce)` disables all transitions.
- Icons come from `lucide-react` only. No emoji as icons.

---

## Global Rules

### Color Palette

| Role | Hex | CSS Variable |
|------|-----|--------------|
| Primary | `#1E293B` | `--color-primary` |
| On Primary | `#FFFFFF` | `--color-on-primary` |
| Secondary | `#334155` | `--color-secondary` |
| Accent/CTA | `#22C55E` | `--color-accent` |
| Background | `#0F172A` | `--color-background` |
| Foreground | `#F8FAFC` | `--color-foreground` |
| Muted | `#272F42` | `--color-muted` |
| Border | `#475569` | `--color-border` |
| Destructive | `#EF4444` | `--color-destructive` |
| Ring | `#1E293B` | `--color-ring` |

**Color Notes:** Code dark + run green

### Typography

- **Heading Font:** Inter
- **Body Font:** Inter
- **Mood:** dark, cinematic, technical, precision, clean, premium, developer, professional, high-end utility
- **Google Fonts:** [Inter + Inter](https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap)

**CSS Import:**
```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
```

### Spacing Variables

*Density: 9/10 — Dense / Dashboard*

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `2px` / `0.125rem` | Tight gaps |
| `--space-sm` | `4px` / `0.25rem` | Icon gaps, inline spacing |
| `--space-md` | `8px` / `0.5rem` | Standard padding |
| `--space-lg` | `12px` / `0.75rem` | Section padding |
| `--space-xl` | `16px` / `1rem` | Large gaps |
| `--space-2xl` | `24px` / `1.5rem` | Section margins |
| `--space-3xl` | `32px` / `2rem` | Hero padding |

### Shadow Depths

| Level | Value | Usage |
|-------|-------|-------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | Subtle lift |
| `--shadow-md` | `0 4px 6px rgba(0,0,0,0.1)` | Cards, buttons |
| `--shadow-lg` | `0 10px 15px rgba(0,0,0,0.1)` | Modals, dropdowns |
| `--shadow-xl` | `0 20px 25px rgba(0,0,0,0.15)` | Hero images, featured cards |

---

## Component Specs

### Buttons

```css
/* Primary Button */
.btn-primary {
  background: #22C55E;
  color: white;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}

.btn-primary:hover {
  opacity: 0.9;
  transform: translateY(-1px);
}

/* Secondary Button */
.btn-secondary {
  background: transparent;
  color: #1E293B;
  border: 2px solid #1E293B;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}
```

### Cards

```css
.card {
  background: #0F172A;
  border-radius: 12px;
  padding: 24px;
  box-shadow: var(--shadow-md);
  transition: all 200ms ease;
  cursor: pointer;
}

.card:hover {
  box-shadow: var(--shadow-lg);
  transform: translateY(-2px);
}
```

### Inputs

```css
.input {
  padding: 12px 16px;
  border: 1px solid #E2E8F0;
  border-radius: 8px;
  font-size: 16px;
  transition: border-color 200ms ease;
}

.input:focus {
  border-color: #1E293B;
  outline: none;
  box-shadow: 0 0 0 3px #1E293B20;
}
```

### Modals

```css
.modal-overlay {
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.modal {
  background: white;
  border-radius: 16px;
  padding: 32px;
  box-shadow: var(--shadow-xl);
  max-width: 500px;
  width: 90%;
}
```

---

## Style Guidelines

**Style:** Exaggerated Minimalism

**Keywords:** Bold minimalism, oversized typography, high contrast, negative space, loud minimal, statement design

**Best For:** Fashion, architecture, portfolios, agency landing pages, luxury brands, editorial

**Key Effects:** font-size: clamp(3rem 10vw 12rem), font-weight: 900, letter-spacing: -0.05em, massive whitespace

### Page Pattern

**Pattern Name:** Minimal Single Column

- **Conversion Strategy:** Single CTA focus. Large typography. Lots of whitespace. No nav clutter. Mobile-first.
- **CTA Placement:** Center, large CTA button
- **Section Order:** 1. Hero headline, 2. Short description, 3. Benefit bullets (3 max), 4. CTA, 5. Footer

---

## Motion

**Scroll Reveal** (Subtle) — Trigger: scroll (viewport enter) | Duration: 300-400ms | Easing: `power1.out`

```js
gsap.from(el, { opacity: 0, y: 12, duration: 0.35, ease: 'power1.out', scrollTrigger: { trigger: el, start: 'top 90%', toggleActions: 'play none none reverse' } });
```

**Framework notes:** Requires the ScrollTrigger plugin registered once via gsap.registerPlugin(ScrollTrigger)

- ✅ Keep the y offset small (8-16px) so it reads as a fade, not a slide
- ❌ Don't reveal below-the-fold content needed for SEO/crawlers as invisible-by-default without a no-JS fallback
- ⚡ toggleActions 'play none none reverse' avoids re-triggering on every scroll direction change

---

## Anti-Patterns (Do NOT Use)

- ❌ Complex onboarding
- ❌ Slow performance

### Additional Forbidden Patterns

- ❌ **Emojis as icons** — Use SVG icons (Heroicons, Lucide, Simple Icons)
- ❌ **Missing cursor:pointer** — All clickable elements must have cursor:pointer
- ❌ **Layout-shifting hovers** — Avoid scale transforms that shift layout
- ❌ **Low contrast text** — Maintain 4.5:1 minimum contrast ratio
- ❌ **Instant state changes** — Always use transitions (150-300ms)
- ❌ **Invisible focus states** — Focus states must be visible for a11y

---

## Pre-Delivery Checklist

Before delivering any UI code, verify:

- [ ] No emojis used as icons (use SVG instead)
- [ ] All icons from consistent icon set (Heroicons/Lucide)
- [ ] `cursor-pointer` on all clickable elements
- [ ] Hover states with smooth transitions (150-300ms)
- [ ] Light mode: text contrast 4.5:1 minimum
- [ ] Focus states visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive: 375px, 768px, 1024px, 1440px
- [ ] No content hidden behind fixed navbars
- [ ] No horizontal scroll on mobile

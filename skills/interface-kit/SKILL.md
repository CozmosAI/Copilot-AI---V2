---
name: interface-kit
description: |
  Authoritative guide for implementing stunning, accessible, performant UI. Synthesizes
  design engineering philosophy, accessibility standards, animation principles, spatial design,
  typography, color systems, and component craft into a single actionable reference.
  Complements the design-system skill (which covers DESIGN.md spec writing) by covering
  the HOW of implementation.
  Trigger phrases: "build UI", "create component", "landing page", "make it look good",
  "frontend", "design", "polish UI", "implement design", "make it beautiful",
  "UI implementation", "component styling", "animation", "accessibility"
---

# Interface Kit: Implementation Guide for Exceptional Interfaces

> If a DESIGN.md exists at the project root, its tokens and specifications override all defaults in this skill. This skill provides sensible defaults for when no design system exists, and implementation guidance that applies regardless.

---

## 1. Core Philosophy

Taste is trained, not innate. Study why great interfaces feel right. Deconstruct apps you admire — the spacing, the timing, the weight of a shadow. The gap between "fine" and "exceptional" is built from hundreds of micro-decisions that users feel but never consciously notice.

**Unseen details compound.** A single rounded corner, a single eased transition, a single well-chosen shadow — none of these matter alone. Together they become "a thousand barely audible voices singing in tune." The cumulative effect is what separates craft from output.

**Beauty is leverage.** Polish is not vanity. Good defaults, considered typography, and intentional motion are real differentiators. Users trust interfaces that feel cared for. Investors notice. Competitors can't easily replicate taste.

**Intentionality over intensity.** Both bold maximalism and refined minimalism work — what fails is the absence of a clear point of view. Every visual decision should trace back to a deliberate conceptual direction. If you can't articulate WHY a choice was made, reconsider it.

**Choose a direction and execute with precision.** Don't hedge between styles. A brutalist page committed fully will always outperform a page that's "a little bit of everything." Commit, then refine.

**NEVER produce generic "AI slop" aesthetics.** No gratuitous gradients on white backgrounds. No cookie-cutter hero sections with stock illustrations. No safe, forgettable layouts that could belong to any product. Every interface should have a point of view that makes it recognizable.

---

## 2. The Priority Stack

When implementing UI, work through these priorities in order. Higher priorities are non-negotiable; lower priorities are polish that compounds quality.

| Priority | Level | What It Means |
|----------|-------|---------------|
| **Accessibility** | CRITICAL | Contrast 4.5:1, keyboard nav, ARIA semantics, visible focus rings. Ship nothing that excludes users. |
| **Performance** | HIGH | WebP/AVIF images, lazy loading below fold, CLS < 0.1, transform-only animations on the compositor thread. |
| **Typography** | HIGH | Font smoothing, text-wrap balance/pretty, tabular-nums for data, 65ch max line length. |
| **Layout & Spatial** | HIGH | 4/8px grid, concentric border radius, optical alignment over geometric. |
| **Color & Theme** | MEDIUM | HSL custom properties, semantic tokens, dark mode pairs tested separately. |
| **Motion & Interaction** | MEDIUM | Frequency-based animation decisions, 150-300ms durations, ease-out default. |
| **Polish & Details** | LOW | Layered shadows over borders, press feedback on buttons, staggered enter animations. |

Never skip a CRITICAL/HIGH item to chase a LOW item. A beautifully animated button that fails keyboard navigation is a net negative.

---

## 3. Aesthetic Direction

Before writing a single line of CSS, commit to a bold aesthetic direction. The most common failure mode in AI-generated UI is convergence on the same safe, forgettable look.

### Pick a Tone

Choose one and commit fully:

- **Brutally minimal** — generous whitespace, monospace type, stark contrast, near-zero decoration
- **Maximalist chaos** — layered textures, clashing type scales, dense information, intentional visual noise
- **Retro-futuristic** — CRT glow effects, monospace terminals, scan lines, neon on dark
- **Organic / natural** — earth tones, rounded shapes, paper textures, hand-drawn accents
- **Luxury / refined** — serif headlines, muted palettes, ample negative space, subtle gold or cream accents
- **Editorial / magazine** — dramatic type hierarchy, full-bleed imagery, grid-breaking layouts
- **Playful / bold** — bright primaries, chunky borders, exaggerated shadows, bouncy motion

---

## 4. Typography Essentials

Typography is the single highest-leverage design element. Get it right and mediocre layouts still feel good. Get it wrong and nothing else saves it.

### Root Setup

```css
html {
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}
```

Apply font smoothing to the root layout. On macOS, the default sub-pixel rendering makes text appear heavier than the designer intended.

### Text Wrapping

```css
h1, h2, h3, h4, h5, h6 {
  text-wrap: balance;
}

p, li, dd, blockquote {
  text-wrap: pretty;
}
```

`balance` distributes heading lines evenly. `pretty` avoids orphaned words in body text.

### Numeric Display

```css
.data-value, .price, .counter, [data-numeric] {
  font-variant-numeric: tabular-nums;
}
```

Use `tabular-nums` for any number that updates dynamically — prices, counters, table columns. Without it, layout shifts as digit widths change.

---

## 5. Spatial Design

### Concentric Border Radius

```
outer_radius = inner_radius + padding
```

```css
/* Correct: concentric */
.card        { border-radius: 16px; padding: 8px; }
.card-inner  { border-radius: 8px; }  /* 16 - 8 = 8 */
```

### Shadows Over Borders

Layer multiple transparent `box-shadow` values for natural depth instead of using borders:

```css
.elevated {
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.04),
    0 2px 4px rgba(0, 0, 0, 0.04),
    0 4px 8px rgba(0, 0, 0, 0.04);
}
```

### Hit Areas

Minimum 44x44px for all interactive elements.

---

## 6. Motion & Interaction

### Custom Easing Curves

```css
:root {
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
}
```

### Press Feedback

Every pressable element should scale down slightly on `:active`:

```css
button:active {
  transform: scale(0.97);
}
```

---

## 7. Accessibility Essentials

- Visible focus rings on all interactive elements
- Semantic HTML (`<button>`, `<nav>`, `<main>`, etc.)
- Contrast ratio meeting WCAG AA (4.5:1)
- Touch targets at least 44x44px

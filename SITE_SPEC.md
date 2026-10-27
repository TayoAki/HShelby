# reception — Complete Site Specification

> Source: https://reception.sh/ scraped 2026-10-27 with Firecrawl (`/v1/scrape` markdown+html+rawHtml+fullPage screenshot+links, `/v1/crawl` 40 pages), a raw `curl` of the HTML, the compiled Tailwind v4 stylesheet `/_next/static/chunks/32rvj_mjnjy55.css` (327 KB), and the 25 Turbopack client chunks. Every value below was read from those sources. Where something could not be copied (licensed font, photos), the substitution is called out explicitly.
>
> Product/architecture teardown (how the product itself works) lives in `docs/PRODUCT_TEARDOWN.md`. This file is only about the marketing site.

---

## 1. Project Overview

| | |
|---|---|
| Product | **reception** (always lowercase in the wordmark) |
| `<title>` | `reception · Live support for your iOS apps` |
| Meta description | `Be there when your users need you. Native in-app chat, with every conversation in one simple inbox.` |
| OG image alt | `reception: in app support for iOS apps, with a support chat on an iPhone` (2400×1260) |
| Canonical | `https://reception.sh` |
| What it is | Native in-app support chat SDK for iOS (Swift / React Native / Expo) + hosted multi-app inbox, with AI auto-replies, Telegram replies, paywall/offer cards, review-request cards and subscription-provider integrations. Flat $25/mo founder pricing. |
| Audience | Indie iOS developers ("appmaxxers") |
| Original stack | Next.js App Router (Turbopack build, React Server Components), Tailwind CSS v4, `motion` (Framer Motion) for animation, Radix Icons + Phosphor Icons, Radix-style Sheet/Popover primitives, DataFast analytics (`/js/script.js` → `https://datafa.st/api/events`), Cloudflare (email obfuscation script). |
| Clone stack | Next.js 16 (App Router, `src/`), TypeScript, Tailwind CSS v4 (`@tailwindcss/turbopack`), `@radix-ui/react-icons`, `@phosphor-icons/react`. Animations re-implemented with CSS + small React hooks (no `motion` dependency). |

### Global copy conventions
- `<main>` applies `[&_h1]:lowercase [&_h2]:lowercase [&_h3]:lowercase [&_h2]:font-normal [&_h2]:tracking-[-.04em] [&_h3]:font-normal`. Headings are **visually lowercase** even when authored in sentence case (FAQ title is authored `Your questions, answered`). Elements opt out with `!normal-case` / `normal-case!`.
- Two-tone headings everywhere: line 1 in `--landing-foreground`, line 2 (`<span class="block">`) in `--landing-secondary` (#909090) or `--landing-muted` (#b8b8b8).

---

## 2. Design Tokens

### 2.1 Color palette

All landing tokens are scoped to `[data-landing-theme]` on the page wrapper (`<div data-landing-theme="true" data-theme="light" class="group/landing min-h-screen overflow-x-clip antialiased bg-[var(--landing-background)] text-[var(--landing-foreground)]">`).

#### Brand (`:root`)
| Token | Light | Notes |
|---|---|---|
| `--brand-primary` | `#ff4b2b` | CTA buttons (= `--landing-accent`) |
| `--brand-primary-hover` | `#e93e20` | (= `--landing-accent-hover`) |
| `--brand-primary-active` | `#d33419` | |
| `--brand-mark` | `#f60` (`#ff6600`) | the dot in the wordmark |
| `--brand-on-primary` | `#fff` | (= `--landing-on-accent`) |

#### Landing surface tokens (`[data-landing-theme]`)
| Token | Light | Dark (`[data-theme=dark]`) |
|---|---|---|
| `--landing-background` | `#fff` | `#111215` |
| `--landing-foreground` | `#242424` | `#f1f1f4` |
| `--landing-secondary` | `#909090` | `#a3a5af` |
| `--landing-muted` | `#b8b8b8` | `#818185` |
| `--landing-panel` | `#f7f7f7` | `#1c1c1e` |
| `--landing-panel-hover` | `#ececef` | `#2a2a2e` |
| `--landing-accent` | `var(--brand-primary)` | same |
| `--landing-accent-hover` | `var(--brand-primary-hover)` | same |
| `--landing-on-accent` | `var(--brand-on-primary)` | same |
| `--feature-border` | `#e7e7ea` | `#303138` |
| `--feature-rim` | `#f5f5f7` | `#212228` |
| `--hero-shadow` | `0 4px 28px #00000012` | `0 4px 28px #00000038` |
| `--footer-foreground` | `#fff` | |
| `--footer-shade` | `linear-gradient(0deg, #000000b3, #00000040 38%, transparent 60%)` | |
| `--phone-frame-shadow` | `0 12px 12px #0000001f` | |
| `--landing-launcher` / `-foreground` | — | `#f1f1f4` / `#111215` (html background in dark: `#111215`) |

#### Product-preview tokens (dashboard/phone mocks)
| Token | Light | Dark |
|---|---|---|
| `--preview-white` | `#fff` | `#1c1c1e` |
| `--preview-ink` | `#242424` | `#f1f1f4` |
| `--preview-muted` | `#929296` | `#8e8e93` |
| `--preview-surface` | `#f7f7f8` | `#232326` |
| `--preview-bubble` | `#eeeeef` | `#2c2c2e` |
| `--preview-line` | `#eaeaed` | `#2e2e32` |
| `--preview-blue` | `#007aff` | |
| `--preview-claude` | `#d97757` | |
| `--device-bezel` | `#171717` | `linear-gradient(135deg,#d5d5d7 0%,#f2f2f3 24%,#b9b9bd 52%,#e0e0e2 76%,#b0b0b4 100%)` |
| `--device-lid-shadow` | `0 12px 32px #0000000f` | (see globals) |
| `--device-metal-gradient` | `linear-gradient(#b9b9bd, #e4e4e7 82%, #a1a1a6)` | |

#### In-phone chat tokens (`[data-website-support]`)
| Token | Light | Dark |
|---|---|---|
| `--website-chat-font` | `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` | |
| `--website-chat-background` | `#fff` | `#1c1c1e` |
| `--website-chat-foreground` | `#000` | `#fff` |
| `--website-chat-secondary` | `#3c3c4399` | `#ebebf599` |
| `--website-chat-placeholder` | `#3c3c434d` | `#ebebf54d` |
| `--website-chat-incoming` | `#f2f2f7` | `#2c2c2e` |
| `--website-chat-outgoing` | `#08f` (`#0088ff`) | `#0091ff` |
| `--website-chat-glass` | `#ffffff0a` | `#3c3c420f` |
| `--website-chat-glass-shadow` | `inset 0 1px 1px #ffffffd9, inset 0 -1px 1px #0000000a, inset 1px 0 1px #ffffff59, 0 0 0 .5px #0000000d, 0 2px 6px #0000000d, 0 10px 24px #0000000f` | see globals |
| `--website-chat-glass-rim` | `linear-gradient(140deg, #fffffff2, #ffffff59 25%, #fff0 48%, #fff0 60%, #ffffffbf)` | see globals |

`.website-glass` = `isolation:isolate; background:var(--website-chat-glass); box-shadow:var(--website-chat-glass-shadow); backdrop-filter: blur(2px) saturate(1.1); position:relative` + a `::before` 1px gradient rim using `mask-composite: exclude`.

#### Accent / chip tokens
| Token | Light | Dark |
|---|---|---|
| `--stat-yellow` | `#fc0` | `#ffd60a` |
| `--stat-blue` | `#007aff` | `#0a84ff` |
| `--stat-red` | `#ff3b30` | `#ff453a` |
| `--stat-green` | `#34c759` | `#30d158` |
| `--context-glass-pink` / `--context-ink-pink` | `#5856d624` / `#5856d6` | `#5e5ce63d` / `#9d9bff` |
| `--context-glass-blue` / `--context-ink-blue` | `#007aff24` / `#007aff` | `#0a84ff38` / `#64b0ff` |
| `--context-glass-orange` / `--context-ink-orange` | `#ff95002b` / `#ff8a00` | `#ff9f0a33` / `#ffb340` |
| `--context-glass-green` / `--context-ink-green` | `#34c75929` / `#2fb350` | `#30d1582e` / `#4ee07a` |
| `--context-glass-purple` / `--context-ink-purple` | `#af52de24` / `#af52de` | `#bf5af238` / `#da8fff` |

Provider chips (`[data-provider=…]`, glass bg / ink):
| provider | glass | ink | dark glass | dark ink |
|---|---|---|---|---|
| swift | `#f051381f` | `#de4a30` | `#f051382e` | `#ff7a5c` |
| expo | `#00002012` | `#000020` | `#ffffff1f` | `#fff` |
| react-native | `#61dafb2e` | `#087ea4` | `#61dafb24` | `#61dafb` |
| revenuecat | `#f2545b1f` | `#dc4149` | | `#ff8d92` |
| superwall | `#3ad3cc1f` | `#118c86` | | `#3ad3cc` |
| adapty | `#6720ff1a` | `#6720ff` | | `#b38aff` |

Pill 3D ("Issue resolved" badge):
`--pill-3d-rim: linear-gradient(135deg,#fff 0%,#dcdce0 30%,#f7f7f8 55%,#c9c9ce 100%)`, `--pill-3d-surface: linear-gradient(#fff,#f1f1f4)`, `--pill-3d-depth: 0 1px 1px #00000014, 0 8px 18px -6px #0000002e`, `--pill-3d-light: inset 0 1px 0 #fff, inset 0 -1px 1px #0000000f`.

Paywall: `--paywall-serif: Georgia,"Times New Roman",serif`, `--paywall-badge: #fafafae0`, `--paywall-badge-shadow: inset 0 1px 2px #fff, 0 3px 8px #0000001f`, `--purchase-sheet: #f7f7fcf5`, `--purchase-overlay: #00000047`.

Native "Clucky" demo app: `--native-clucky-surface:#f3f3f3; --native-clucky-ink:#1c1412; --native-clucky-orange:#ff9500; --native-clucky-ember:#cc4005; --native-clucky-alert:#d70015; --native-clucky-off:#c7c7cc; --native-muted:#8b858d`.

Telegram card: `--telegram-screen:#07090d; --telegram-device-shadow:-12px 16px 18px #00000038; --telegram-glass:linear-gradient(135deg,#ffffffd1,#e2eaf4a6 45%,#f6f8ffc7); --telegram-glass-edge:#ffffffa6; --telegram-glass-ink:#17191e; --telegram-glass-shadow:inset 0 1px 1px #fffffff2, inset 0 -1px 1px #fff6, 0 8px 22px #00000038`.

Showcase icons: `--showcase-edge-light:#eeeef1; --showcase-edge-mid:#d7d7dd; --showcase-edge-dark:#b8b8c1; --showcase-icon-rim: inset 0 1px 2px #ffffffb3, inset 0 -2px 3px #0000002e; --showcase-icon-sheen: linear-gradient(140deg,#fff3,transparent 45%); --showcase-icon-shadow: 1px 2px 0 var(--showcase-edge-light), 2px 4px 0 var(--showcase-edge-mid), 3px 6px 0 var(--showcase-edge-dark), 8px 16px 24px #00000038; --stealth-icon-surface: linear-gradient(150deg,#fdfdfe,#ededf0); --stealth-icon-ink:#1d1d1f61`.

App-level (`:root`, used by the floating launcher): `--primary:#1d1d1f; --primary-foreground:#fff; --elevation: 0 10px 40px #0000001f; --selection:#d9e6f8`.

### 2.2 Typography

| Role | Original | Clone substitute | CSS var |
|---|---|---|---|
| Everything (UI + headings) | **Suisse Intl** (Swiss Typefaces, *commercial license*), self-hosted `/fonts/SuisseIntl-Regular.ttf` (400) and `/fonts/SuisseIntl-Medium.ttf` (500–700) | **Inter** via `next/font/google` (closest freely-licensed neo-grotesk; tighter tracking already in the type scale). The skill default (Plus Jakarta Sans) was **not** used because Suisse is a neo-grotesk, not a geometric. | `--font-suisse` (`"Suisse","Helvetica Neue",sans-serif` originally) |
| Rotating italic hero line | **Instrument Serif Italic** (OFL, Google Fonts) self-hosted `/fonts/InstrumentSerif-Italic.ttf` | Instrument Serif 400 italic via `next/font/google` | `--landing-font-cursive` (`"Instrument Serif", Georgia, serif`) |
| In-phone chat UI | `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` | same | `--website-chat-font` |
| Paywall headline | `Georgia, "Times New Roman", serif` | same | `--paywall-serif` |

Body: `font-normal`, `antialiased`. Weight 400 everywhere except a few `font-medium` labels; headings are **400** (no bold).

Type scale (exact classes):
| Element | Classes |
|---|---|
| H1 hero | `text-balance text-[clamp(36px,10vw,48px)] sm:text-[clamp(38px,4.5vw,72px)] font-normal leading-[1.12] tracking-[-.05em]` |
| Hero subtitle (an `h2`) | `mx-auto mt-6 max-w-[36rem] text-balance text-[15px] leading-[1.6] sm:text-[16px] tracking-[-.013em]! normal-case! text-[var(--landing-secondary)]` |
| Section H2 (centered) | `text-center text-[clamp(34px,4vw,60px)] leading-[1.12]` + main's `tracking-[-.04em]` |
| Feature H2 (left) | `text-[clamp(36px,4.6vw,68px)] leading-[1.08] tracking-[-.045em] text-balance !normal-case` |
| How-it-works H2 | `text-center text-[clamp(40px,5vw,64px)] font-normal leading-[1.06] tracking-[-.045em]` |
| Stat numbers | `text-[clamp(38px,11vw,44px)] leading-none sm:text-[clamp(44px,5vw,76px)] tracking-[-.055em]` |
| "39 apps" | `text-[clamp(32px,3.1vw,46px)] leading-[1.08] tracking-[-.045em]` |
| Price | `text-[clamp(56px,7vw,92px)] leading-none tracking-[-.055em]` |
| Tab description | `text-[16px] leading-[1.5] tracking-[-.015em] sm:text-[18px]` |
| Feature details list | `py-3 text-[18px] leading-[1.25] tracking-[-.02em] sm:py-4 sm:text-[clamp(20px,2vw,26px)]` |
| Founder bubbles | `text-[16px] leading-[1.5] tracking-[-.015em] sm:text-[19px]` |
| FAQ question | `text-[15px] leading-[1.5]` (≤601px: `text-sm`) |
| FAQ answer | `text-sm leading-[1.8]` (≤601px: `text-[13px]`) |
| Wordmark | `text-[20px] sm:text-[23px] leading-none tracking-[-.05em]` (footer: `text-2xl`) |

### 2.3 Spacing, layout, radius, shadows

`[data-landing-theme]` layout variables:
| Var | < 48rem | ≥ 48rem (`@media (min-width:48rem)`) |
|---|---|---|
| `--landing-content-width` | `1200px` | `1200px` |
| `--landing-gutter` | `20px` | `40px` |
| `--landing-section-gap` | `144px` | `176px` |
| `--landing-heading-gap` | `56px` | `64px` |
| `--landing-proof-gap` | `96px` | — |
| `--landing-card-gap` | `16px` | — |
| `--landing-card-padding` | `28px` | `32px` |
| `--landing-card-padding-y` | `32px` | — |
| `--landing-hero-top` | `112px` | `168px` |
| `--landing-header-height` | `80px` | `88px` |
| `--landing-radius` | `clamp(28px, 3vw, 48px)` | |
| `--landing-choice-radius` | `24px` | |
| `--landing-ease-out` | `cubic-bezier(.23, 1, .32, 1)` | |

Content container: `mx-auto max-w-[var(--landing-content-width)] px-[var(--landing-gutter)]`.
Other radii: app icon `22%` (`--radius-app-icon`), multi-tenant icons `27%`, showcase 3D icon `24%`.
Breakpoints: Tailwind v4 defaults (`sm` 40rem, `md` 48rem, `lg` 64rem, `xl` 80rem) plus `min-[400px]` and `max-[601px]`.

### 2.4 Animations

| Name | Definition | Used by |
|---|---|---|
| Rotating headline | words `["Increase conversion 💸","Lower churn 😍","Get more reviews ⭐️"]`, every **2.4 s**, spring (stiffness 900, damping 80, mass 10); enter `{y:20, rotateX:90, opacity:0, blur(4px)}` → `{y:0, rotateX:0, opacity:1, blur(0)}`, exit `{y:-20, rotateX:-90, opacity:0, blur(4px)}`. Only runs while ≥50% in view. | Hero H1 line 2 |
| Spotlight tabs | 4 topics, each `duration: 11000ms`, auto-advance while ≥35% in view and the user hasn't clicked a tab | Hero gallery |
| Tab description swap | `transition-[opacity,translate] ease-[cubic-bezier(.32,.72,0,1)]`; active `translate-y-0 opacity-100 delay-150 duration-700`; inactive `translate-y-2 opacity-0 duration-200` (stacked with `[grid-area:1/1]`) | Hero |
| Scooter drive | `translateX(viewportWidth - imgLeft) → -imgRight`, `duration 2.6s linear`, infinite, `repeatDelay 2.5s` | integrations tab |
| Hanging bubbles | drop in with spring (stiffness 90, damping 11, delay `.15+.12*i`s) then sway `rotate [-1.5°,1.5°]` mirror, `2.8+.35*i`s | retention tab |
| `@keyframes marquee` | `to{transform:translate(-50%)}` | (languages list uses a scripted translateY ticker instead) |
| `@keyframes car-lights` | `0%,54%,to{opacity:0} 13%,41%{opacity:1}`, applied `9s ease-in-out infinite` | footer CTA headlights |
| `ScrollReveal` | `initial {opacity:0,y:24}` → in-view `{opacity:1,y:0}`, `0.6s`, ease `[.22,1,.36,1]`, once, amount .12 | sections |
| Founder bubbles | each bubble `opacity:0; translateY(12px) scale(.97)` → visible, staggered | founder note |
| Card hover | `transition-transform duration-500 ease-out hover:-translate-y-1` | stat cards |
| Buttons | `transition-[background-color,transform,translate,scale,rotate] active:scale-96` | all pill buttons |
| FAQ | `grid transition-[grid-template-rows,opacity] duration-200 ease-[var(--landing-ease-out)]`, closed `grid-rows-[0fr] opacity-0`, open `grid-rows-[1fr] opacity-100`; plus icon rotates 45° | FAQ |
| Read more overlay | `transition-opacity duration-200 ease-[var(--landing-ease-out)]`; button label cross-fades `read more` ↔ `close`, plus icon `rotate-45` when open | feature cards |

All motion respects `prefers-reduced-motion` (`motion-reduce:transition-none`, timers disabled).

---

## 3. Global Styles

- `html` background `#fff` (dark: `#111215`). `color-scheme: light` / `dark` follows `data-theme`.
- Selection: `::selection { background: #d9e6f8 }` (`--selection`).
- Body class string (wrapper): `group/landing min-h-screen overflow-x-clip antialiased bg-[var(--landing-background)] text-[var(--landing-foreground)]`.
- Theme toggle: footer button flips `data-theme` between `light` and `dark` on the wrapper (persisted to `localStorage`).
- The full token set above is implemented in `src/app/globals.css`.

## 4. Tailwind Config

Tailwind v4 (CSS-first). No `tailwind.config.ts` is needed; tokens are plain CSS custom properties consumed with arbitrary values (`bg-[var(--landing-panel)]`), exactly like the original. `@theme inline` maps `--font-sans` → `--font-suisse` so the default sans is the substitute font.

## 5. Button Component

Base (accent / "Connect my app", "Log in"):
```
inline-flex min-h-10 sm:min-h-11 items-center justify-center gap-2 rounded-full
bg-[var(--landing-accent)] px-4 py-2 text-xs sm:px-6 sm:py-3 sm:text-sm font-normal
text-[var(--landing-on-accent)] transition-[background-color,transform,translate,scale,rotate]
hover:bg-[var(--landing-accent-hover)] active:scale-96 focus-visible:outline-[var(--landing-accent)]
```
- Heights: 40px mobile / 44px ≥ sm. Padding 16×8 / 24×12. Text 12px / 14px.
- "Connect my app" variants append Radix `ArrowRightIcon` (`size-4 shrink-0`). "Log in" has no icon.
- Colors: default `#ff4b2b`, hover `#e93e20`, active scale .96.

Secondary ("Read the docs"):
```
inline-flex min-h-10 items-center justify-center rounded-full bg-[var(--landing-panel)] px-4 py-2 text-xs
text-[var(--landing-foreground)] transition-[background-color,transform,translate,scale,rotate]
hover:bg-[var(--landing-panel-hover)] active:scale-96 sm:min-h-11 sm:px-6 sm:py-3 sm:text-sm
```
(`target="_blank"`).

"read more" toggle (feature cards): `absolute bottom-5 right-5 z-30 flex h-11 w-28 items-center justify-center gap-1.5 rounded-full bg-[var(--landing-background)] text-[var(--landing-foreground)] active:scale-[.97]` with Radix `PlusIcon` 16px.

Founder "i'm in 🙌" bubble-button: `rounded-[22px] rounded-br-md bg-[var(--landing-foreground)] px-4 py-2.5 text-[16px] leading-[1.5] tracking-[-.015em] text-[var(--landing-background)] hover:opacity-85 sm:px-5 sm:py-3 sm:text-[19px]`.

---

## 6. Section-by-Section Spec

Page order (all inside `<main class="font-normal [font-family:var(--font-suisse)] …">`):

0. Header (fixed)
1. Hero
2. Spotlight gallery (`#features`)
3. Stats proof ("don't take our word")
4. Support demo ("speak to your users")
5. Support features (`#support-features`): `#native`, `#context`, `#notifications`, `#inbox`, `#languages`
6. How it works (`#how-it-works`)
7. Founder note
8. Pricing (`#pricing`)
9. FAQ (`#faq`)
10. Footer CTA (car card)
11. Footer
12. Floating chat launcher

Every section is on the white `--landing-background`; there are **no dark sections** in light mode. Visual rhythm comes from `--landing-panel` (#f7f7f7) cards with `--landing-radius` corners.

### 0. Header
- `<header class="fixed inset-x-0 top-0 z-40 bg-[var(--landing-background)]/70 backdrop-blur-xl backdrop-saturate-150">` — always translucent white, no scroll state change.
- `<nav>`: `relative mx-auto flex h-[var(--landing-header-height)] max-w-[1200px] items-center justify-between gap-3 px-[var(--landing-gutter)]`.
- Left: wordmark link `/` — `●reception`: dot is `inline-block size-[1ex] rounded-full bg-[var(--brand-mark)]`, wrapper `inline-flex items-baseline gap-[.16em] leading-none tracking-[-.05em]`, text `text-[20px] sm:text-[23px]`.
- Center (≥lg only, absolutely centered `left-1/2 -translate-x-1/2`, `gap-6 text-sm`): `Features` (#features), `Setup` (#how-it-works), `Pricing` (#pricing), `FAQ` (#faq). Hover → `--landing-secondary`.
- Right (`gap-3 sm:gap-5`): `Docs` (`/docs`, text-sm) + accent pill `Log in` (`/login`).

### 1. Hero
- `<section class="mx-auto max-w-[1200px] px-[var(--landing-gutter)] pt-[var(--landing-hero-top)] text-center">`
- H1 line 1: **`agentic in app support`**
- H1 line 2 (`block min-h-[1.2em]`, aria-hidden): rotating italic serif in `--landing-muted`, `tracking-[-.02em]`, emoji in `Apple Color Emoji` at `.7em` upright: `Increase conversion 💸` → `Lower churn 😍` → `Get more reviews ⭐️` (rendered lowercase by the H1 rule). `sr-only`: `Increase conversion, lower churn, get more reviews`.
- Subtitle: **`Talk to users right inside your app. Solve problems before they churn, ask happy customers for reviews, and turn conversations into upgrades.`**
- CTAs (`mt-8 flex flex-wrap justify-center gap-x-3 gap-y-3 sm:gap-x-6`): `Connect my app →` (accent, `/login`), `Read the docs` (secondary, `/docs`).

### 2. Spotlight gallery (`#features`, aria-label "Features your app is missing")
- Wrapper: `scroll-mt-28 pt-[var(--landing-heading-gap)]`, inner `pb-[calc(var(--landing-section-gap)/2)]`.
- Stage: `relative isolate h-[480px] sm:h-[600px] lg:h-[680px] overflow-x-visible overflow-y-clip rounded-[var(--landing-radius)]`, child mask `linear-gradient(to bottom, black calc(100% - 56px), transparent)`. **No panel background** — the props float on white.
- Tabs (`role=tablist`, `mt-6`, centered): `inline-flex gap-1 rounded-full bg-[var(--landing-panel)] p-1`; each tab `relative rounded-full px-4 py-2.5 text-[13px] sm:px-5 sm:text-sm transition-colors duration-300`; active tab gets a sliding white pill `absolute inset-0 rounded-full bg-[var(--landing-background)] shadow-[var(--hero-shadow)]` and foreground text; inactive `--landing-secondary` hover foreground. Horizontal scroll on mobile (`-mx-4 overflow-x-auto px-4 [scrollbar-width:none]`).
- Description (`mx-auto mt-5 grid max-w-[640px] text-center`): `<span class=fg>{secondaryTitle}.</span> {benefits joined ", "}. docs ↗`

| # | kind | tab title | secondaryTitle | benefits | docs link | prop (behind phone) |
|---|---|---|---|---|---|---|
| 0 | conversion | upsell your users | or give them a deal | offer a deal when it helps · find a plan that actually fits · switch plans right in the chat | /docs/paywalls | two crumpled $100 bills, `w-[96%]` centered |
| 1 | retention | in app support chat | fix it before they churn | help them without leaving your app · see where they got stuck · fix it before they leave | /docs/chat-features | MacBook with inbox + iPhone + hanging reaction bubbles |
| 2 | integrations | integrate with everyone | triage your users | see the details behind every conversation · add your own data · works with RevenueCat, Superwall, Adapty and more | /docs/identity | orange scooter driving across (`w-[165%] sm:w-[96%] lg:w-[76%]`) + white story card |
| 3 | reviews | get more reviews | ask when you help them | ask while they're still smiling · one tap to the App Store · say it in your own words | /docs/reviews | chrome stars, `w-[96%]` |

Phone (conversion/reviews): `absolute aspect-[450/920] left-1/2 top-[32px] w-[60cqw] -translate-x-1/2 sm:top-[40px] sm:w-[min(540px,80cqw)]` inside a `[container-type:size]` box — i.e. a big phone whose bottom is cut off by the stage mask. Black screen underlay `inset-x-[4.3%] inset-y-[1.5%] rounded-[19.7%/9.1%]`, screen `inset-x-[5.33%] inset-y-[2.5%] rounded-[16cqw]`, frame PNG on top (`/devices/iphone-17-pro-silver.png`, 1350×2760).

In-phone chat chrome (all units `cqw` of screen width): status bar `h-[13cqw] px-[9cqw] text-[3.8cqw] font-semibold` "9:41" + Phosphor cell/wifi/battery; top fade `h-[34cqw]`; glass title pill `Support` at `top-[16.3cqw]`, `px-[4cqw] py-[2cqw] text-[4.2cqw] font-semibold`; messages `px-[4cqw] pt-[34cqw] gap-[2cqw]`; timestamp `Today 9:41` `text-[2.8cqw]`; bubbles `max-w-[86%] rounded-[4.2cqw] px-[3.5cqw] py-[2.3cqw] text-[4.2cqw] leading-[1.3]`; composer: glass round `+` button `size-[10cqw]` + glass field `Message` `h-[10cqw] rounded-[5cqw]`, `px-[6cqw] pb-[8cqw]`.

**Conversion scene timeline** (ms from tab start, loops at 11000): 1000 user bubble `is there a cheaper way to keep this?` → 2300 founder reply (avatar+name "Andi") `yearly is 40% off rn, want it?` with blue pill button `👑 View offer ›` → 3400 button pressed (scale .94) → 3900 paywall sheet slides up (spring) → 5000 → 6300 Face ID / "Confirm with Side Button" → 7100 → 7900 sheet dismisses, button turns grey `#aeaeb2` + `No longer available` → 8600 system line `👑 User upgraded to Yearly`.
Paywall sheet copy: avatars (coffee, cabin, city, meadow) + badge `Stronger together`; serif headline `Become your / best self.`; `Build habits that last.` / `See how far you’ve come.` / `Make time for you.`; plans — offer variant: **Yearly** `~~$83.88~~ $49.99/year` (selected, badge `40% off · just for you`), **Monthly** `$6.99/month`; CTA `Continue` → `You’re on Yearly`.

**Retention scene**: user `bro my whole streak is gone 🥀` → reply `oh no, lemme fix that rn` → user `yooo it's back. absolute legend 😭` (timings 1500/3400/5800/7400). Hanging bubbles (text · reaction · initial · color · x%): `yooo it works now 🙌` 😍 J blue 13 · `you guys actually replied?? 😭` 💯 M red 31 · `restored my purchase, legends 🙏` ❤️ S green 50 · `best support ever ngl` 🔥 A yellow 67 · `fixed in 2 mins wtf` 💯 L blue 86 · `ok i'm never leaving 💗` 😍 T red 88.

**Reviews scene**: user `yooo you actually fixed it 😭` → reply `anytime 🫶 if you're feeling it, a review helps us a ton` → App Store sheet (`◀ 75 Days`, `Write a Review`, `Tap a Star to Rate` ★★★★★, `Title`, `Review (Optional)`, `Cancel` / `Send`).

**Integrations scene**: centered card `max-w-[520px] rounded-[24px] bg-[var(--spotlight-card)] shadow-[var(--hero-shadow)] px-7 py-5` containing a story sentence with a provider chip cycling RevenueCat → Superwall → Adapty every 2200 ms (chip enters `opacity 0, scale .25, blur 4px` → 1, spring, exits toward `x:.2em`).

> **Approximations (not recoverable from the bundle):** the integrations story-sentence wording lives in a code-split chunk that was not in the scrape, so the clone writes its own sentence in the same chip style. The reviews scene's step timings and its closing system line (`User left a 5-star review`) are likewise the clone's choice; the strings `Write a Review`, `Tap a Star to Rate`, `Title`, `Review (Optional)`, `Cancel`, `Send`, `◀ 75 Days` are verbatim. The purchase sheet copy (`App Store`, `75 Days: Her Challenge`, `Yearly Pro`, `Subscription`, `$49.99 / year`, `Renews yearly. Cancel anytime in Settings.`, `Double Click`, `Confirm with Side Button`) is verbatim.

### 3. Stats proof
- Section: `flex min-h-svh flex-col justify-center py-[calc(var(--landing-section-gap)/2)]`.
- H2: `don't take our word` / `take theirs` (secondary).
- Grid: `grid grid-cols-2 gap-[var(--landing-card-gap)] lg:grid-cols-3 lg:grid-rows-2`.
- Card base: `relative flex flex-col justify-between gap-8 overflow-hidden rounded-[var(--landing-radius)] bg-[var(--landing-panel)] p-5 min-[400px]:p-7 sm:p-10 transition-transform duration-500 ease-out hover:-translate-y-1`.
  1. `col-span-2 min-h-[300px] sm:min-h-[380px] lg:col-span-1 lg:row-span-2`: icon grid `grid-cols-[repeat(6,minmax(0,38px))] gap-3` of 12 app icons (`rounded-[22%] outline outline-1 -outline-offset-1 outline-black/5`, each a button opening a popover with store/website links). Order: Clucky, 75 Days: Her Challenge, Calorie Tracker (stealth "C"), Aesty, StepKey, Acadeller Spark, Peptide App (stealth "P"), Loomi, ekto, Superlife, Marker, Grove. Stealth tiles: gradient `--stealth-icon-surface`, letter `text-[62cqw] font-semibold blur-[7cqw]` in `--stealth-icon-ink`. Bottom: H3 `39 apps` / `use reception` (secondary).
  2. `col-span-2 min-h-[220px] sm:min-h-[260px]`: 3D pill `✓ Issue resolved` (Radix CheckIcon in `--stat-green`), stat `2,456` / `issues resolved`.
  3. `min-h-[200px] sm:min-h-[260px]`: five Radix StarFilledIcon `size-[18px] min-[400px]:size-[22px]` in `--stat-yellow`, stat `563` / `extra reviews`.
  4. same size: 7 green bars `w-3 rounded-full bg-[var(--stat-green)]`, heights 28/38/34/52/60/78/100%, opacity .35→.95 in .1 steps (h-16 container, gap-1.5), stat `$7.9k` / `additional revenue`.
- Stat label: `mt-2 text-sm sm:text-[15px] text-[var(--landing-secondary)]`.

### 4. Support demo
- Same section shell; H2 `speak to your users` / `stop them from churning`.
- Panel: `relative overflow-hidden rounded-[var(--landing-radius)] bg-[var(--landing-panel)] pt-8 sm:pt-12 lg:pt-[60px]`, `<figure [container-type:inline-size]>`.
- Display: positioned `left-6 w-[125%] sm:left-12 sm:w-[112%] lg:left-[60px] lg:w-[calc(100%-120px)]`; bezel `rounded-[1.2cqw] bg-[var(--device-bezel)] p-[.65cqw]`, screen `aspect-[5544/3144] rounded-[.55cqw]`; stand image below (`w-[35%]`, faded mask).
- Inbox UI (font `text-[1.12cqw] leading-[1.4]`, bg `--preview-surface`): 5% icon rail (brand dot, grid, inbox w/ blue badge `3`, user; bottom: doc, gear, avatar) → white card (`my-[.6cqw] mr-[.6cqw] rounded-[1cqw]`, ring `--preview-line`):
  - List (34% width): `Inbox` (1.6cqw medium), search `Search ⌘K`, filters `Open 5` (active pill) `Closed 12` `All 17`. Rows: **Alex Morgan** now (blue, bold) `bro ts app is ass 🥀` badge 2 · **Jamie Chen** 2m `yooo it works now 🙌` badge 1 · Sam Wilson 12m `wait lemme send a screenshot` · Taylor Reed 24m `does pro work on my ipad?` · Jordan Lee 1h `How do I restore my purchase?`. Each row ends with the app icon (`size-[1.3cqw] rounded-[.3cqw]`).
  - Thread: header `Alex Morgan` / `[icon] Her Challenge · English`, star, pill `✓ Mark resolved`; `Today, 9:41 AM`; bubbles (incoming `--preview-bubble`, outgoing `--preview-blue`, `rounded-[1.15em] px-[1em] py-[.7em]`): `bro ts app is ass 🥀` / `damn, yeah that sucks, let me fix it now` / `yooo that's crazy you actually replied wtf` / `nw man, we here for u 🫵 👑`; composer `+ Write a reply…` with blue up-arrow.
- Phone overlapping bottom-right: `right-[8%] top-[24cqw] w-[36%] sm:right-[10%] sm:top-[20cqw] sm:w-[30%] lg:-bottom-[11cqw] lg:right-[2%] lg:top-auto lg:w-[29%]` — same conversation mirrored (user = outgoing blue).
- Figcaption (lg: left column 30% width, `ml-[60px] pt/pb-[60px]`): H3 `in app support` / `increase revenue` (`text-[26px] sm:text-[32px] lg:text-[clamp(24px,2.4vw,32px)] tracking-[-.03em]`), p `Lower churn by actually solving the users problems. Get more reviews, upsell across plans, or offer discounts. Fully native, within your app. It just works.` (`text-[16px] leading-[1.55] lg:text-[clamp(15px,1.3vw,18px)]` secondary), `Connect my app →`.

### 5. Support features (`#support-features`)
- `pb/pt-[var(--landing-section-gap)]`, children `space-y-[var(--landing-section-gap)]`.
- Each row: `grid grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-20`. Text column has the feature H2; card column `aspect-square w-full sm:aspect-[4/3] lg:aspect-square lg:max-w-[600px]` (right-aligned with `lg:justify-self-end` when on the right). Rows alternate: card right, left, right, left, right.
- Card: `group/feature relative isolate flex flex-col overflow-hidden rounded-[var(--landing-radius)] bg-[var(--landing-panel)] p-4 pb-5 sm:p-8 sm:pb-5 h-full`, a `read more` button bottom-right that fades in a details overlay (`absolute inset-0 z-20 flex flex-col justify-center bg-[var(--landing-panel)] px-6 pb-16 sm:px-14`) with a 3-item list (`border-t border-[var(--feature-border)] first:border-t-0`) and `Connect my app →`.

| id | H2 line 1 | H2 line 2 (muted, `whitespace-pre-line`) | side | card visual | details list |
|---|---|---|---|---|---|
| `#native` | native chat | looks like you\nbuilt it yourself | card right | provider chips `Swift` `Expo` `React Native` above H2; phone (h-88%, `pl-[14%]`) showing the "Clucky" alarm app (streak 🔥3, Su–Sa row with 3 🔥, `Next Wakeup` Tomorrow · Alarm in 8 hours · **7:30** AM, `Alarms` 6:30 am Early Bird · Weekdays [on], 7:30 am Morning Routine · Every day [on], 9:00 am Weekend Reset · Weekends [off]) dimmed 28% with a support sheet `Clucky support`: `Can I make Clucky even louder? 😅` / `Done 🐓 Max volume is on. No escape tomorrow.` / `lol ok thank you` in Clucky colors (outgoing `#cc4005`, incoming white); floating 3D app icon bottom-left (`rotateY(-16deg) rotateZ(-9deg)`, `--showcase-icon-shadow`) | Your colors, your font, your words · You decide where support lives in your app · Remote config: change colors and texts without an app update |
| `#context` | ai integration | automate your support | card left (`lg:order-1`) | sentence card (`justify-center px-6 py-20 sm:px-12`, `text-[20px] sm:text-[clamp(24px,2.4vw,36px)] leading-[1.5] tracking-[-.035em]`): `go get a [☕ coffee], let ai [⚡ automate] your support.` / `give [ChatGPT logo] your [📄 docs], it'll reply better than [👤 you] probably anyway.` Chips: `rounded-full px-2 py-1 sm:px-3 sm:py-1.5 text-[.78em] font-medium` pink/blue/orange/green glass | Answers from your own docs · Replies instantly, day and night · Hands over to you when it's unsure |
| `#notifications` | telegram integration | reply from the beach or the gym | card right | phone (`w-[88%] max-w-[520px] top-3 sm:top-[40px]`, shadow `--telegram-device-shadow`) on an iOS home screen with a glass notification: Telegram logo · **Telegram** · now · `Hey, can you help me restore my purchase?`; bottom fade `h-14` to panel | New messages land in Telegram · Reply there, it reaches your user · One group for your whole team |
| `#inbox` | multi tenancy | all your apps, all your team | card left | mini inbox window (`w-[480px] h-[320px] rounded-[28px] scale-[.85] sm:scale-[1.45]`, `left-[10%] top-[14%]`, masked fade right/bottom): 76px app rail with 4 icons + red badges 2/2/1/3 and active indicator bar; header `Clucky` + avatars A J S (`from-[#a9adb6] to-[#868a93]`); rows Ava `Can I wake up to my own song?` (unread dot, highlighted) · Max `Can I change the rooster sound?` (unread) · Zoe `Clucky is so loud lol, love it` | One inbox across your apps · Stay on top of unread messages · Give your team a shared view |
| `#languages` | every language, every user | make everyone feel at home | card right | vertical ticker (`h-[420px]`, mask fade top/bottom), center glass lens `h-[60px] rounded-full border-white/70`; rows `h-[60px] text-[22px] tracking-[-.02em]`, active row foreground + color flag, others muted + `opacity-40 grayscale` flag. Rows: 🇺🇸 how can we help you? · 🇪🇸 ¿cómo podemos ayudarte? · 🇯🇵 どうされましたか？ · 🇩🇪 wie können wir helfen? · 🇫🇷 comment pouvons-nous aider ? · 🇰🇷 무엇을 도와드릴까요? · 🇧🇷 como podemos ajudar? · 🇨🇳 有什么可以帮您？ · 🇮🇹 come possiamo aiutarti? · 🇹🇷 nasıl yardımcı olabiliriz? (list repeated 3× for seamless loop) | Support your users in any language · Auto-detects the device language · Localize your own welcome text |

### 6. How it works (`#how-it-works`)
- H2 `one prompt setup` / `live in minutes` (secondary), then centered `Connect my app →` (`mt-8`).
- `<ol class="mx-auto mt-[var(--landing-heading-gap)] grid max-w-[880px] gap-[var(--landing-card-gap)] xl:max-w-none xl:grid-cols-3">`; each `li`: `rounded-[var(--landing-radius)] bg-[var(--landing-panel)] px-[var(--landing-card-padding)] py-[var(--landing-card-padding-y)] sm:grid sm:grid-cols-2 sm:items-center sm:gap-10 xl:block`.
- Illustration area `flex h-56 items-center justify-center`; mini card `w-full max-w-[290px] rounded-[20px] bg-[var(--landing-background)] shadow-[0_1px_3px_rgb(0_0_0/6%),0_8px_24px_rgb(0_0_0/4%)]`.
  1. `New app`; dashed icon box with `+`; field with orange caret `App name`; black pill `Add app`. → `1` / **add your app to reception** / name and icon
  2. attachment chip `[📄] setup prompt · 142 lines`; text `add reception to my app`; footer `(+) [Claude logo] Opus 5.5` and orange `#d97757` send button with ↑. → `2` / **integrate with one prompt** / paste it into your coding agent
  3. `●reception`; rows `M Mia now — is there a dark mode?` (highlighted + blue unread dot) and `L Leon 2m — thanks, works again!`. → `3` / **ready to chat** / your users can reach you
- Step number `text-[15px] secondary`, title `mt-2 text-[24px] leading-[1.15] tracking-[-.03em]`, sub `mt-1 text-[17px] tracking-[-.01em] secondary`.

### 7. Founder note (aria-label "A note from the founders")
- `mx-auto max-w-[680px]` section shell; H2 `by appmaxxers` / `for appmaxxers`.
- iMessage-style thread (`space-y-6`), each group `flex items-end gap-3`: avatar `size-9 sm:size-10 rounded-full`; name `pl-4 text-[12px] secondary`; bubbles `w-fit rounded-[22px] bg-[var(--landing-panel)] px-4 py-2.5 sm:px-5 sm:py-3 last:rounded-bl-md`.
  - Frederick: `hey 👋 we're andi and frederick.` · `iOS apps are tough.` · `apple takes [🍎 15-30%], you can't request [★ reviews] during onboarding, it's hard to [↗ upsell] users or get feedback.`
  - Andi: `your customers just [⎋ churn].` · `we built reception, a toolkit to solve all these issues, via [💬 in app support], and soon [💬 imessage].`
  - Frederick: `our early adopters saw significant reduction in churn, more upsells and more reviews.`
  - Frederick & Andi (stacked avatars): `we're so [🚀 excited] to bring this to all of you. we're just getting started.`
  - Right-aligned reply: label `you`, dark bubble-link `i'm in 🙌` → `/login`.
- Handwritten signatures (two animated SVG strokes) centered below.
- Inline chips: `mx-0.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[.82em] font-medium` with context glass/ink colors (orange 15-30%, blue reviews, green upsell, pink churn, blue in app support, green imessage, orange excited).

### 8. Pricing (`#pricing`)
- H2 `no bulls**t pricing` / `one flat price` (muted).
- `<article class="grid overflow-hidden rounded-[var(--landing-radius)] bg-[var(--landing-panel)] lg:grid-cols-2">`
  - Left (`flex flex-col items-start px/py card padding`): `$25` + `per month` (`text-base tracking-normal secondary`); `41/50 spots claimed.` (secondary) / `Next price: ` (fg) `$50/m` (accent) at `text-[clamp(20px,2vw,26px)] leading-[1.45] tracking-[-.025em] mb-9 mt-7`; `Connect my app →` pinned bottom (`mt-auto`).
  - Right (`border-t lg:border-l lg:border-t-0 border-[var(--feature-border)]`): H3 `everything you need, included` (`mb-6 text-[26px]`), list (`space-y-4 text-[15px] secondary`, red check icons): Native iOS chat and photo sharing · Review requests and in-app offers · Your colors, fonts and welcome screen · User details, plans and metadata · Push notifications and Telegram replies · One inbox for your apps and team. Then bordered link block (mailto `hello@reception.sh`): H3 `enterprise?` (`text-[22px]`), `doing over 30k/mo in revenue or have 10k+ active users` / `get in touch with us for pricing ↗` (fg, underline on hover).

### 9. FAQ (`#faq`)
- `max-w-190 mx-auto pt-[calc(var(--landing-section-gap)/2)]`; header `mb-[var(--landing-heading-gap)]`, H2 `Your questions, answered` (`text-[clamp(32px,4vw,44px)] tracking-[-.035em] leading-[1.15]`, left-aligned).
- Items `border-b border-[var(--feature-border)] first:border-t`; button `flex min-h-18 w-full items-center justify-between gap-6 py-[22px] px-0.5 text-[15px] hover:text-secondary` + `PlusIcon`.
  1. **Do my users need an account?** — No. They can open the chat and send you a message without creating a separate support account.
  2. **Can I use it in more than one app?** — Yes. Add each app to your organization and connect it with its own App ID. You can manage their conversations in one inbox.
  3. **What happens when I’m offline?** — Users can still leave you a message. Reply when you’re back. If you’ve set up push notifications and the user has allowed them, they’ll be notified of your reply.
  4. **Can I make the chat match my app?** — Yes. Change the accent color, chat title, and welcome message. You also choose where users open the chat.
  5. **Which devices and languages are supported?** — The Reception SDK works on iOS 17 and later, in native iOS and React Native/Expo apps (development builds, not Expo Go). The chat interface supports 48 languages. Custom text is localized by your app; messages are not automatically translated.
  6. **Does Telegram let me reply to users?** — Yes. Reply to a new support notification in your connected Telegram chat, and your text is sent to the user. You can also reply from the web inbox.

### 10. Footer CTA
- `relative isolate mx-auto mb-[calc(var(--landing-section-gap)-64px)] mt-[var(--landing-section-gap)] flex aspect-[1163/1353] w-full max-w-[560px] flex-col justify-end overflow-hidden rounded-[var(--landing-radius)] p-7 sm:p-10 text-white`.
- Background photo: gold car hood with chrome "reception" badge (dark mode: orange car); a second "lights on" photo blinks via `car-lights 9s`; `--footer-shade` gradient on top.
- H2 `give them a reason to stay` (`text-[clamp(32px,4vw,44px)] leading-[1.1]`), `Connect my app →`.

### 11. Footer
- `grid grid-cols-2 gap-10 px-3 py-16 text-sm md:grid-cols-[2fr_1fr_1fr_1fr]`.
- Brand column: wordmark (`text-2xl`) + `By appmaxxers, for appmaxxers.` (secondary).
- **Product**: Features (`/#features`), Request a review (`/#reviews`), Pricing (`/#pricing`), Your inbox (`/inbox`).
- **Resources**: Documentation (`/docs`), Getting started (`/#how-it-works`), FAQ (`/#faq`).
- **Legal**: Terms of service (`/terms`), Privacy policy (`/privacy-policy`), Data processing agreement (`/dpa`).
- Bottom row (`text-xs secondary`): `© 2026 reception` · theme toggle pill (`border var(--feature-border) bg var(--feature-rim) rounded-full px 10 py 7`, half-moon icon, `dark mode` / `light mode`).
- Fine print: `Apps built with reception have been approved by App Review across multiple apps and multiple submissions.`

### 12. Floating launcher
- `fixed right-4 sm:right-8 lg:right-[calc(max(0px,(100%-1600px)/2)+4rem)] bottom-[max(1.25rem,env(safe-area-inset-bottom))] sm:bottom-[5.5rem] z-40 size-13 rounded-full bg-[#1d1d1f] text-white shadow-[0_10px_40px_#0000001f] hover:brightness-[.92]`, Radix `ChatBubbleIcon` `size-6`. Opens a sheet with the live reception chat (`/v1` API) on the original; the clone opens a static demo chat sheet.

---

## 7. Assets

| Original path | What it shows | Size | Clone handling |
|---|---|---|---|
| `/features/crumpled-hundred-cutout.webp` | two crumpled $100 bills (hero conversion prop) | 1536×1024 | **CSS/SVG banknote placeholder** (not copied — photo is third-party) |
| `/features/orange-scooter-cutout.webp` | orange Vespa-style scooter | 1536×1024 | **inline SVG scooter** |
| `/features/chrome-stars-cutout.webp` | chrome 3D stars | 1536×1024 | **inline SVG chrome-gradient stars** |
| `/features/footer-gold-car(.lights).webp`, `footer-orange-car(.lights).webp` | car hood with "reception" badge, headlights on/off | 1163×1353 | **CSS gradient "hood" + glowing headlights** with the same `car-lights` keyframes |
| `/devices/iphone-17-pro-silver.png` | iPhone frame | 1350×2760 | **CSS-drawn frame** (metal gradient rim + black bezel + Dynamic Island) |
| `/devices/mac-display-stand-generated.webp`, `macbook-neo-silver.webp` | display stand, laptop | — | CSS stand / laptop |
| `/devices/ios-home-screen.png` | iOS home screen | — | CSS gradient wallpaper + emoji app grid |
| `/showcase/*-icon.jpg` (12) | customer app icons | 96–512px | **gradient tiles with emoji/letter** (customer trademarks not copied) |
| `/brand/andi.jpg`, `/brand/frederick.jpg` | founder photos | 40px | **initial avatars** (real people's photos not copied) |
| `/brand/swift.svg`, `expo.svg`, `react.svg`, `claude.svg`, `telegram.svg` | brand marks | — | simple inline SVG/glyph stand-ins |
| `/fonts/SuisseIntl-*.ttf` | licensed font | — | **not copied**; Inter substitute |
| `/opengraph-image.png`, `/icon.svg`, `/favicon.ico` | OG + favicons | 2400×1260 | clone ships its own `icon.svg` (orange dot) |

All placeholder art lives in `src/components/art/` so real assets can be dropped in later by swapping one component each.

## 8. Third-Party Integrations
- **DataFast** analytics (`<script src="/js/script.js">` → `https://datafa.st/api/events`, bot/webdriver filtering, localhost ignored). Not included in the clone.
- **Cloudflare** email-obfuscation (`/cdn-cgi/l/email-protection`) for the enterprise mailto. Clone uses a plain `mailto:`.
- **reception's own widget** behind the floating launcher (dog-fooding their product on the web). Clone: static demo sheet.
- No Cal.com/Calendly/HubSpot/Intercom.

## 9. Build Instructions
```bash
npx create-next-app@latest reception-clone --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm
npm install @radix-ui/react-icons @phosphor-icons/react
npm run dev   # http://localhost:3000
npm run build
```
Known issues:
- `create-next-app` rejects directory names with capitals (`HShelby`) — scaffold under a lowercase name and move files.
- Next 16 scaffolds `cacheComponents: true`; the landing page is fully static, so this is fine.
- Container-query units (`cqw`, `cqh`) need `[container-type:inline-size|size]` on the right ancestor — every phone/laptop mock depends on it.

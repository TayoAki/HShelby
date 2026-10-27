# reception.sh — teardown + landing-page clone

A study of [reception.sh](https://reception.sh) ("agentic in app support" for iOS apps): what the product is, how it works under the hood, and a rebuild of its marketing site.

| File | What's in it |
|---|---|
| [`docs/PRODUCT_TEARDOWN.md`](docs/PRODUCT_TEARDOWN.md) | How the product works: features and their mechanics, SDK surface, identity/JWT flow, message protocol, push, Telegram, automations, inferred architecture, data model, phased rebuild plan. Facts cite the docs; inferences are labelled. |
| [`docs/BACKEND_PLAN.md`](docs/BACKEND_PLAN.md) | How to build the backend: stack decisions, architecture, data model, the message-send transaction, API contract, jobs, security checklist, and a phased schedule with acceptance tests. |
| [`preview/`](preview/) | Walkthrough video and screenshots of the clone. |
| [`SITE_SPEC.md`](SITE_SPEC.md) | Exhaustive spec of the landing page: every color token (light + dark), type scale, spacing, animation timings, and section-by-section copy and classes, extracted from the scraped HTML/CSS/JS. |
| `src/` | Next.js 16 + Tailwind v4 rebuild of the landing page, built from the spec. |

## Run it

```bash
npm install
npm run dev      # http://localhost:3000
npm run build && npm start
```

## What's faithful and what isn't

- **Faithful:** layout, spacing, colors (light and dark), type scale, copy, the four animated hero scenes (upsell/paywall flow, retention, integrations, App Store review), feature cards with "read more" overlays, language ticker, founder note, pricing, FAQ, theme toggle, floating chat launcher.
- **Substituted on purpose:**
  - **Font:** Suisse Intl is a commercial font, so Inter stands in under the same CSS variable. Instrument Serif (OFL) is used as in the original.
  - **Photos and logos:** the crumpled bills, scooter, chrome stars, gold car, iPhone/Mac frames, customer app icons and founder photos belong to reception or to third parties, so none were copied. All of them are CSS/SVG stand-ins in `src/components/art/`; swap one component to use real assets.
  - **Routes:** `/login`, `/docs`, `/inbox` and the legal pages are not rebuilt and land on a not-found page.
- The page sets `robots: noindex`. It reproduces another company's brand and copy, so it's for study only; rebrand it before deploying anything public.

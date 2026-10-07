---
name: wallapop-poster
description: >-
  Wallapop live publish and dry-run in this CRM (Playwright + Chrome CDP, not a
  browser extension). Use when changing publish flow, autopost, shipping on the
  Wallapop form, POST /publish, or wallapop-publish tests.
paths:
  - "server/src/lib/wallapop-publish/**"
  - "server/src/lib/wallapop-cdp.ts"
  - "server/src/lib/wallapop-autopost.ts"
  - "server/src/routes/product-publish.ts"
  - "lib/inventory/shipping-for-publish.ts"
  - "lib/api/publish.ts"
  - "components/product-form/test-publish-button.tsx"
---

# Wallapop publish (CRM)

There is **no** `actions/post-item.ts`, Phase 2 placeholder, or extension simulation. Posting is implemented on the **Express API** with **Playwright** attached to **Chrome CDP** (`server/src/lib/wallapop-cdp.ts`).

## Entry points (do not invent others)

| Layer | Location | Role |
|-------|----------|------|
| HTTP | `server/src/routes/product-publish.ts` | `runProductPublish`, claim `READY_TO_POST` → `POSTING` → `ACTIVE`, gates (photos, brand, shipping, session) |
| Browser flow | `server/src/lib/wallapop-publish/` | `publishWallapopInBrowser` → `flow.ts` orchestrator; domain modules (`form`, `shipping`, `envio`, `publicar`, `verify`, …) |
| Queue | `server/src/lib/wallapop-autopost.ts` | In-process FIFO; calls same `runProductPublish` with `{ dryRun: false }` |
| UI test | `lib/api/publish.ts` + `TestPublishButton` | `POST /api/v1/products/:id/publish` with `{ dryRun: true }` |
| Docs | `server/API.md` | Publish + autopost + env vars |

Public import path stays `../lib/wallapop-publish` (folder `index.ts` re-exports).

## Dry-run rule (D5)

Live click on **Publicar** happens only when **`WALLAPOP_PUBLISH_DRY_RUN === "false"`** (string).

- Unset, `true`, or anything else → **dry-run**: form filled in Chrome, stop at `before_publicar`, no claim on listing.
- HTTP body `{ dryRun: true }` also forces dry-run; env still applies for autopost (`isAutopostLivePublishEnabled`).

Autopost does **not** post until default account `autopost_enabled` **and** env is exactly `false`.

Secrets and DB: `server/.env` (`DATABASE_URL`, session, `WALLAPOP_*`). Next only `NEXT_PUBLIC_*` at repo root.

## Listing / shipping (CRM vs Wallapop)

- `ProductListing.shippingEnabled` (UI on edit listing) → `PublishWallapopInput.shippingEnabled` → `ensureEnvioToggle` in `envio.ts`; when off, skip peso/package DOM steps.
- `validateShippingForPublish` / autopost skip: peso required only when envío is on (`lib/inventory/shipping-for-publish.ts`).

## When changing behavior

1. Read surrounding module in `wallapop-publish/`; keep SRP (eslint limits on `server/src/**/*.ts`).
2. Prefer extending existing helpers over new top-level files.
3. Run `npx vitest run --config server/vitest.config.ts tests/wallapop-publish.test.ts` (DOM fixtures under `server/tests/fixtures/`).
4. Manual check: Chrome on CDP, session ACTIVE, dry-run from product page or API.

Do **not** add Next Server Actions or `app/actions/post-item.ts` for publish — mutations go through Express as in `server/API.md`.

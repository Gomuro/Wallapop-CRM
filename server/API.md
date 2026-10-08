# API v1 — Wallapop CRM (`server/`)

Процес **Express** на `PORT` (default **4000**). UI (Next) ходить сюди, не в Next Route Handlers.

- Origin API (браузер / Vercel): `NEXT_PUBLIC_API_URL` у **кореневому** `.env`, не тут
- Префікс: `/api/v1`
- JSON **camelCase** (`categoryId`, `sortOrder`). У Postgres колонки snake_case через Prisma `@@map`
- Клієнт **не** шле `accountId`. Етап 1: завжди default-акаунт
- Реалізація хендлерів: #55–#65 (auth уже в #54). Інші маршрути — **501** `NOT_IMPLEMENTED` **після** логіна.

## Env

Два файли. **Vercel / Next** бачить лише корінь. **VPS / Express** — `server/.env`.

Корінь (`.env.example`): `NEXT_PUBLIC_API_URL` — єдине, що можна світити в браузер.

`server/.env` (цей процес):

| Змінна | Навіщо |
|--------|--------|
| `DATABASE_URL` | Postgres (Docker локально: хост `5436`) |
| `PORT` | Listen API, default 4000 |
| `JWT_SECRET` | Підпис httpOnly cookie `crm_session` |
| `SEED_USER_EMAIL` / `SEED_USER_PASSWORD` / `SEED_USER_NAME` | Один оператор у `npm run db:seed` |
| `COOKIE_SAMESITE` | Default `none` (крос-origin UI ↔ API). `lax` / `strict` теж можна |
| `COOKIE_SECURE` | Default `true` (потрібно для `SameSite=none`) |
| `UPLOAD_DIR` | Файли фото на диску цього процесу |
| `CORS_ORIGIN` | Origin Next (локально `http://localhost:3000`, проді — Vercel). Кілька через кому |
| `API_ORIGIN` | Опційно для `npm run server:smoke`, якщо не `http://127.0.0.1:$PORT` |
| `WALLAPOP_PUBLISH_DRY_RUN` | Publish: не `false` = стоп перед Publicar. Див. [Publish](#publish-phase-1) |
| `WALLAPOP_SOLD_DRY_RUN` | C8 sold: не `false` = стоп перед confirm `#markAsSoldButton`. Не reuse publish-env. Див. [Wallapop sold](#wallapop-sold-c8) |
| `WALLAPOP_AUTOPOST` | Deprecated / ignored. Черга вмикається з UI `POST /accounts/default/autopost/start` (`accounts.autopost_enabled`) |
| `WALLAPOP_AUTOPOST_INTERVAL_MS` | Fallback інтервалу, якщо `accounts.autopost_interval_ms` null. Default `900000` = 15 хв + ±20% jitter. UI `PATCH /accounts/default/autopost` перемагає env |
| `WALLAPOP_POSTING_STALE_MS` | Watchdog: `POSTING` старший за це (default `1200000` = 20 хв) і Chrome не в `publish` → retry. Див. [Autopost queue](#autopost-queue) |
| `WALLAPOP_POSTING_MAX_ATTEMPTS` | Ліміт claim-ів одного SKU без `ACTIVE` (default `3`). Далі `FAILED` |

## Помилки

Усі помилки одного вигляду:

```json
{ "error": { "code": "SKU_TAKEN", "message": "…" } }
```

| HTTP | code | Коли |
|------|------|------|
| 400 | `VALIDATION_ERROR` | Zod не пройшов |
| 400 | `INVALID_CATEGORY` | `categoryId` не існує або не листок |
| 401 | `UNAUTHORIZED` | Немає/битий токен |
| 404 | `NOT_FOUND` | Немає ресурсу або невідомий шлях |
| 409 | `SKU_TAKEN` | Унікальний SKU |
| 409 | `ALREADY_SOLD` | Повторний `POST …/sold` або `…/wallapop-sold` |
| 409 | `LISTING_NOT_ACTIVE` | `POST …/wallapop-sold` без listing `ACTIVE` |
| 409 | `NO_ITEM_URL` | Немає `https://es.wallapop.com/item/…` |
| 500 | `SOLD_FAILED` | Браузер C8 упав, або Wallapop уже vendido а DB не записала |
| 409 | `PRODUCT_SOLD` | `PATCH …/status` на вже проданому SKU |
| 500 | `INTERNAL` | Несподівана помилка |
| 501 | `NOT_IMPLEMENTED` | Контракт є, хендлера ще немає |

Складський `ProductStatus` і `ListingStatus` — різні поля. Не мішати в одному ключі.

`GET /health` (і `GET /api/health`) — живий процес, без `/api/v1`.

Перевірка без ручного curl:

| Команда | Що робить |
|---------|-----------|
| `npm run test:api` | **Автотести** (#61): Vitest + supertest проти `createApp()` in-process, **реальний Postgres** з `server/.env`. Перед першим запуском: `npm run db:up`, `npm run db:migrate:deploy`, `npm run db:seed`. Не потрібен окремий `server:dev`. |
| `npm run server:smoke` | Швидкий скрипт проти **вже запущеного** API (`API_ORIGIN` або `http://127.0.0.1:$PORT`). |

Postman-колекція: `server/postman/`.

---

## Auth (#54)

Сесія: **JWT у httpOnly cookie** `crm_session` (7 днів). Не Bearer. UI шле `credentials: 'include'`.

| Метод | Шлях | Тіло / відповідь |
|-------|------|------------------|
| POST | `/api/v1/auth/login` | `{ email, password }` → `{ user: { id, email, name } }` + `Set-Cookie` |
| POST | `/api/v1/auth/logout` | чистить cookie → `{ ok: true }` |
| GET | `/api/v1/auth/me` | `{ user: { id, email, name } }` |

Без cookie — **401** `UNAUTHORIZED` на всіх `/api/v1/*` крім login. Пароль у БД лише `password_hash` (bcrypt). Один seed-юзер. Форми логіна немає (UI #46).

## Categories (#60)

Дерево Wallapop ES зі seed, **не** 6 EN-slug.

| Метод | Шлях | Нотатки |
|-------|------|---------|
| GET | `/api/v1/categories` | `ORDER BY parentId, sortOrder` (корені `parentId` null спочатку). Поля: `id`, `wallapopId`, `parentId`, `slug`, `nameEs`, `nameUk`, `isLeaf`, `leafSelectionMandatory`, `depth`, `path`, `sortOrder`. Опційно `?parentId=` (cuid або `root` лише корені) |
| GET | `/api/v1/categories/:id` | Один вузол + `fields` (upload/components листка). 404 якщо немає |

Каскад форми: корінь → … → **листок**. `products.categoryId` лише листок, інакше 400 `INVALID_CATEGORY`.

## Products (#55, #56)

Склад, не оголошення Wallapop.

| Метод | Шлях | Нотатки |
|-------|------|---------|
| GET | `/api/v1/products` | Пагінація `page` (default 1), `pageSize` (default 20, max 100). Фільтри: `status` (`ALL` \| `ACTIVE` \| `SOLD` \| `INACTIVE`), `q` (SKU або title, case-insensitive), опційно `categoryId`. Сортування: `updatedAt` desc. Відповідь: `{ products: [{ id, sku, title, price, currency, status, categoryId, coverUrl, updatedAt, listingStatus, listingActive }], page, pageSize, total, totalPages }`. `listingStatus` — статус listing **default**-акаунта (`READY_TO_POST` \| `POSTING` \| `ACTIVE` \| `DEACTIVATED` \| `FAILED`) або `null`. `listingActive` **true лише** коли `listingStatus === ACTIVE` (не `POSTING`, не `READY_TO_POST`). |
| POST | `/api/v1/products` | `sku`, `title`, `description`, `price`, `currency` default `EUR`, `categoryId` (листок), `condition` enum, `brand` (обов’язкова), `weightKg?`, `shippingPackageSize?` (`STANDARD` \| `BULKY`), `widthCm?` / `lengthCm?` / `heightCm?`, `typeAttributes?`. Авто listing на default, статус `READY_TO_POST` |
| GET | `/api/v1/products/:id` | Картка + images + listing |
| PATCH | `/api/v1/products/:id` | Часткове оновлення складу: `sku`, `title`, `description`, `price`, `currency`, `categoryId`, `condition`, `brand`, `weightKg`, `shippingPackageSize`, `widthCm`, `lengthCm`, `heightCm`, `typeAttributes` (усі опційно). **Strict body:** `status`, `soldAt`, `soldPrice` та невідомі ключі → **400** `VALIDATION_ERROR` (не strip). Статус — лише #57. |
| DELETE | `/api/v1/products/:id` | |

`condition`: `NEW` \| `AS_GOOD_AS_NEW` \| `GOOD` \| `FAIR` \| `HAS_GIVEN_IT_ALL`.  
Складський `status` на картці: `ACTIVE` \| `SOLD` \| `INACTIVE` (змінюється лише ендпоінтами #57, не загальним PATCH).

## Status (#57)

| Метод | Шлях | Нотатки |
|-------|------|---------|
| PATCH | `/api/v1/products/:id/status` | JSON `{ "status": "ACTIVE" \| "INACTIVE" }`. Лише складський статус; listings не чіпаються. **200** `{ product }` (той самий shape, що GET `/:id`). `SOLD` у body → **400** `VALIDATION_ERROR`. Продукт уже `SOLD` → **409** `PRODUCT_SOLD`. |
| POST | `/api/v1/products/:id/sold` | Опційно `{ "soldPrice": number }` (EUR, як `price`); порожнє `{}` або без body — `soldPrice` = поточний `price`. Одна транзакція: `status` `SOLD`, `soldAt` (серверний now), усі `product_listings` → `DEACTIVATED` (`external_url` не змінюється). **200** `{ product }`. Повтор → **409** `ALREADY_SOLD`. CRM-only, без браузера. |
| POST | `/api/v1/products/:id/wallapop-sold` | C8: Wallapop **Marcar como vendido** потім та сама транзакція, що `POST …/sold`. Див. [Wallapop sold](#wallapop-sold-c8). |

## Wallapop sold (C8)

Один Chrome **9222** / `ChromeCDP-Persistent`. Sold — **окреме вікно** (не другий порт). Слот `sold` може йти паралельно з `publish`; повторний sold → **409** `BROWSER_BUSY`. Login/logout/rehydrate ексклюзивні.

Канон: лише `ProductListing.externalUrl` = `https://es.wallapop.com/item/…`. Listing має бути `ACTIVE`. Продукт уже `SOLD` → **409** `ALREADY_SOLD` (браузер ні). Session не `ACTIVE` → **409** `NOT_ACTIVE`.

Браузер (живий DOM 2026-10-08): `[class*="ItemDetailSellerButtons"]` `walla-button[text="Marcar como vendido"]` (не Destacar / Editar / Reservar / Eliminar) → нова вкладка `tsl-sold-modal` → `#markAsSoldButton` (не Cancelar) → `/app/catalog/sold`, перший `.CatalogItem__content--sold` **href** збігається з `externalUrl`. Немає match → **500** `SOLD_FAILED`, CRM не писати. Після Wallapop OK — `markProductSoldTx` (`external_url` не затирати). DB fail — **без** rollback на Wallapop.

Dry-run default: `WALLAPOP_SOLD_DRY_RUN !== "false"` (або body `{ "dryRun": true }`) — знайти кнопку, **не** confirm. Live: env рівно `false`.

**200** dry-run: `{ ok: true, dryRun: true, step: "before_confirm", product: null, error: null }`.  
**200** live: `{ ok: true, dryRun: false, step: "sold", product, error: null }`.

Модулі: `server/src/lib/wallapop-sold/`. UI `POST …/sold` не змінюється.

## Photos (#58)

До 10 файлів на продукт. `sortOrder` 0 = обкладинка (`coverUrl` у списку).

| Метод | Шлях | Нотатки |
|-------|------|---------|
| POST | `/api/v1/products/:id/images` | `multipart/form-data`, поле **`files`** (1–10 файлів за запит). JPEG/PNG/WebP, max 10MB, EXIF знімається. Відповідь `{ product }`. |
| PATCH | `/api/v1/products/:id/images` | JSON `{ "ids": ["…"] }` — **усі** id фото продукту в новому порядку (перший = обкладинка). |
| PUT | `/api/v1/products/:id/images/:imageId` | `multipart/form-data`, поле **`file`** — заміна файлу, старий файл на диску видаляється. |
| DELETE | `/api/v1/products/:id/images/:imageId` | Рядок + файл; `sortOrder` решти зжимається 0…n−1. |

Помилки: `NOT_FOUND` (продукт/фото), `VALIDATION_ERROR` (тип/розмір, ліміт 10, невалідний reorder).

## Listings (#65)

Один default-акаунт (`accounts.is_default = true`). Клієнт **не** шле `accountId`, `productId`, `externalItemId`, `lastPostedAt`, `lastEditedAt` у body PUT.

Після `POST /products` на default вже є рядок `product_listings` з `status: READY_TO_POST`. PUT = **upsert** за `@@unique([productId, accountId])` лише для default.

`POSTING` — внутрішній claim під час live publish (Chrome ще не відкрито / публікація в польоті). GET / вкладений `product.listing` **можуть** повернути `POSTING` або `FAILED` (watchdog вичерпав ретраї). PUT **не** приймає `POSTING` / `FAILED` у body → **400** `VALIDATION_ERROR`. З `FAILED` оператор може PUT `READY_TO_POST` (знову в чергу) або `ACTIVE` (товар уже в Wallapop).

Якщо поточний статус **вже** `POSTING`: `status: READY_TO_POST` (і будь-який статус, що знімає claim, крім recovery) → **409** `PUBLISH_IN_PROGRESS`. Дозволено `status: ACTIVE` (оператор: уже в Wallapop) і `status: DEACTIVATED`. Якщо `status` немає — оновлення URL/shipping **не** знімає claim.

### `GET /api/v1/products/:id/listing`

**200**

```json
{
  "listing": {
    "id": "cuid",
    "status": "READY_TO_POST",
    "externalUrl": null,
    "externalItemId": null,
    "shippingEnabled": false,
    "shippingUpToKg": null,
    "accountId": "cuid"
  }
}
```

Та сама форма, що вкладений `product.listing` у картці продукту. `externalItemId` лише read-only (етап 2).

| HTTP | code | Коли |
|------|------|------|
| 404 | `NOT_FOUND` | Порожній/невідомий `:id`, продукт не існує, немає default account, немає listing для `(product, default)` |
| 500 | `INTERNAL` | Немає `DATABASE_URL` |

Повідомлення про відсутній default: `Default account is not configured.` (як у `POST /products`).

### `PUT /api/v1/products/:id/listing`

Body (JSON, camelCase): усі поля опційні, **хоча б одне** обов’язкове.

| Поле | Тип |
|------|-----|
| `externalUrl` | публічний URL `/item/…` або `null` (очистити). Головна Wallapop, `/upload…` і будь-який інший рядок **стають `null`** |
| `status` | `READY_TO_POST` \| `ACTIVE` \| `DEACTIVATED` (не `POSTING`) |
| `shippingEnabled` | `boolean` |
| `shippingUpToKg` | позитивне ціле або `null` |

Зайві ключі в body → **400** `VALIDATION_ERROR`. Порожній `{}` → **400**.

**200** — той самий envelope, що GET. Якщо рядка listing ще не було (рідко) — **create** через upsert.

| HTTP | code | Коли |
|------|------|------|
| 400 | `VALIDATION_ERROR` | Zod |
| 404 | `NOT_FOUND` | Продукт не знайдено або немає default account |
| 409 | `PUBLISH_IN_PROGRESS` | Listing зараз `POSTING`, а body `status` знімає claim (`READY_TO_POST`). `ACTIVE` / `DEACTIVATED` / без `status` — ок |
| 500 | `INTERNAL` | БД не налаштована |

## Accounts (#64)

| Метод | Шлях | Нотатки |
|-------|------|---------|
| GET | `/api/v1/accounts/default` | Єдиний `isDefault: true`. `{ account, autopost }`. `autopost.enabled` — `accounts.autopost_enabled` (кнопка Start/Stop). `lastPublication`: `{ at, title }` або `null`. `nextTickAt` — ISO наступного in-process тіку черги, або `null` якщо autopost parado. `recentSkips` — останні пропуски черги без peso/medidas (`{ at, productId, sku, title, code, message }[]`). `livePublish` — env `WALLAPOP_PUBLISH_DRY_RUN===false` |
| PATCH | `/api/v1/accounts/default/autopost` | Body `{ value: int, unit: "seconds" \| "minutes" \| "hours" \| "days" }`. Конвертує в ms на сервері (1 хв … 7 діб). Пише `accounts.autopost_interval_ms`. Відповідь як GET. 400 `VALIDATION_ERROR`, 404 без default |
| POST | `/api/v1/accounts/default/autopost/start` | `autopostEnabled: true`. Session має бути `ACTIVE`, інакше **409** `NOT_ACTIVE`. Відповідь як GET |
| POST | `/api/v1/accounts/default/autopost/stop` | `autopostEnabled: false`. Якщо Chrome зараз у тіку publish — **abort** in-flight CDP, закриває owned upload-таб (`wallapop_publish_abort_requested` / `wallapop_publish_abort` `reason: stop`). Chrome / `/wall` **не** гасяться (сесія для наступного Start). Publicar після Stop під час заповнення форми не клікається. Відповідь як GET |
| GET | `/api/v1/accounts/status` | In-memory сесія браузера: `{ status, requires2FA, email, error? }`. `status`: `DISCONNECTED` \| `AUTHENTICATING` \| `ACTIVE`. Boot-rehydrate **може spawn** Chrome; цей GET лише **attach**. Якщо немає Wallapop-табу — probe **goto** `/wall`, далі MFA → `AUTHENTICATING` / logged-in → `ACTIVE` |
| POST | `/api/v1/accounts/connect` | Body `{ email, password, proxy? }` — **password використовується** для Keycloak fill (у БД **не** зберігається). Відкриває/чіпляє Chrome → onboarding «Iniciar sesión con email» → fill `#username`/`#password` → `#kc-login`. Вже залогінений профіль → `ACTIVE` без форми. Потрібен 2FA → `requires2FA: true`. Fail (у т.ч. reCAPTCHA) → **400** `CONNECT_FAILED`. Якщо email Wallapop **інший**, ніж `accounts.wallapop_email` — listings default-акаунта → `READY_TO_POST`, URL/lastPostedAt null, autopost Stop; відповідь `listingsReset: true` |
| POST | `/api/v1/accounts/connect/2fa` | Body `{ code }` (4–8 alphanumeric). Вводить OTP у відкритий контекст. Якщо RAM злетіла після рестарту, але MFA-екран у Chrome лишився — **re-attach CDP** і прийняти код (не 409). Без MFA/сесії → **409** `NOT_AUTHENTICATING`. Помилка коду → **400** `CONNECT_FAILED` |
| POST | `/api/v1/accounts/disconnect` | Повний **logout Wallapop** у Chrome-профілі (`clearCookies` + `es.wallapop.com/logout`) + CRM `DISCONNECTED`; Prisma default → `INACTIVE`. Профіль на диску / процес Chrome не видаляються. Якщо CDP недоступний — CRM все одно від’єднується |

| GET | `/api/v1/backups` | Список файлів у `BACKUP_DIR` (`{ files: { file, size, mtime }[] }`). Cookie. Не `public/uploads`. |
| POST | `/api/v1/backups` | Один `pg_dump -Fc` на календарний день. 201 `{ file, reused: false }` або 200 `{ file, reused: true }` якщо сьогодні вже є копія. 500 `BACKUP_FAILED` якщо немає `pg_dump`. CRM на буті дамп **не** робить — лише Task Scheduler / ця команда. |
| GET | `/api/v1/backups/:file` | Attachment. Ім’я лише `wallapop_crm-YYYYMMDD-HHmm.pgdump`. 400/404 |

Пароль Wallapop у БД **не** зберігається. При `ACTIVE` / disconnect оновлюється `status` default-акаунта в Prisma (`ACTIVE` / `INACTIVE`).

### Браузерні профілі (обов’язково — 1 акаунт = 1 Chrome user-data-dir)

**Правило:** кожен Wallapop-акаунт має **окремий** persistent Chrome profile (`--user-data-dir`). Не шарити один профіль між кількох акаунтів і не ганяти логін у «чистому» тимчасовому профілі.

**Навіщо:** Wallapop / антифрод сильно детектить однакові fingerprints, cookies і історію. Окремий `user-data-dir` зберігає cookies, Google-логін у Chrome, історію й локальний стан саме під цей акаунт — як зараз локальний ярлик `Chrome CDP.lnk` → `ChromeCDP-Persistent`.

**Як робимо зараз (один акаунт) — ТИМЧАСОВО, не фінальна архітектура:**

> **`WALLAPOP_CDP_URL` / один порт `:9222` / один `ChromeCDP-Persistent` — лише single-account MVP.**  
> Зараз у коді **один глобальний** CDP-endpoint і **один** `user-data-dir` на весь API-процес. Це **не** назавжди.  
> **Для multi-account буде інакше:** не шарити один `WALLAPOP_CDP_URL` між акаунтами — per-account `user-data-dir` + окремий CDP-порт (або послідовний attach). Не проєктувати прод multi-login навколо поточного env.

- Launch / attach: реальний Google Chrome + CDP (`WALLAPOP_CDP_URL`, default `http://127.0.0.1:9222`). Якщо CDP ще не слухає — API **сам** spawn Chrome з `--remote-debugging-port` + `--user-data-dir`.
- Profile: `WALLAPOP_CHROME_USER_DATA_DIR` або `%USERPROFILE%\ChromeCDP-Persistent` (той самий каталог, що в ярлику).
- Не використовуємо порожній `profiles/account_1` для робочого акаунта.

**Як будемо масштабувати (multi-account, етап 2+) — замінить глобальний `WALLAPOP_CDP_*`:**
- На кожен CRM `Account` — свій каталог, напр. `ChromeCDP-<accountId>` або `profiles/wallapop_<n>` **поза** спільним Default Chrome.
- Окремий CDP-порт на акаунт (9222, 9223, …) або один Chrome за раз з відповідним `user-data-dir` (не один shared `WALLAPOP_CDP_URL` на всіх).
- Proxy (якщо є) — теж per-account, бажано з самого старту Chrome.
- У БД / конфігу акаунта зберігати шлях до `userDataDir` (+ порт / proxy), **не** пароль Wallapop.
- Shortcut-шаблон як `Chrome CDP.lnk`: `chrome.exe --remote-debugging-port=<port> --user-data-dir="<dir>"` + stability flags.

Потрібно: встановлений Google Chrome на машині API; Playwright для CDP (`npm i playwright`).

### Email login UI map + selector registry

Реалізовано в `SELECTORS` / `loginWallapopInBrowser` / `submitWallapop2faInBrowser` (`server/src/lib/wallapop-browser.ts`).

**Правило:** не шукай email/password на onboarding — їх немає до Keycloak. Для 2FA віддавай перевагу структурним маркерам (`id`, `name`, `data-*`), не копії тексту (текст може змінитись). Якщо Wallapop оновить DOM — оновлюй **і** цей розділ, **і** `SELECTORS` у коді.

#### Крок 1 — Onboarding

URL: `https://es.wallapop.com/login` → редірект на `…/auth/onboarding`

- SSO-кнопки: Google, Apple, Facebook; також «Regístrate»
- Полів email/password **немає**
- `walla-button` = Stencil / shadow DOM — у коді спочатку `getByRole('button', { name: 'Iniciar sesión con email' })`, потім CSS-фолбек

| Призначення | Селектори (порядок як у коді) |
|-------------|-------------------------------|
| Email-login entry | role: `button` name `Iniciar sesión con email` |
| Email-login entry (CSS) | `walla-button[text="Iniciar sesión con email"]` |

#### Крок 2 — Keycloak password

URL: `https://accounts.wallapop.com/realms/wallapop-internal/protocol/openid-connect/auth…`

| Призначення (`SELECTORS.*`) | Селектори |
|-----------------------------|-----------|
| `email` | `#username`, `input[name="username"]`, `input[type="email"]`, `input[autocomplete="username"]` |
| `password` | `#password`, `input[name="password"]`, `input[type="password"]`, `input[autocomplete="current-password"]` |
| `submit` (Acceder) | `#kc-login`, `walla-button#kc-login`, `button:has-text("Acceder a Wallapop")`, `button[type="submit"]` |

Label на UI (довідково, не для детекції): «Dirección de email», кнопка «Acceder a Wallapop».

#### Крок 3 — SMS 2FA (MFA)

URL: `…/realms/wallapop-internal/login-actions/authenticate?execution=…`  
Форма: `#mfa-code-validation-form` (`method=post`, class з модулем `mfa-code-validation-module__otp-form___…` — hash у class може змінитись, **id стабільніший**).

| Призначення (`SELECTORS.*`) | Селектори |
|-----------------------------|-----------|
| `otpScreen` (детект `REQUIRES_2FA`) | `#mfa-code-validation-form`, `form[id="mfa-code-validation-form"]`, `[data-input-otp-container="true"]`, `input[name="mfa_code"]`, `input[data-input-otp="true"]` |
| `otp` (fill коду) | `input[data-input-otp="true"]`, `input[name="mfa_code"]`, `input[autocomplete="one-time-code"]` |
| `otpSubmit` | `#mfa-code-validation-form walla-button[behaviour-type="submit"]`, `walla-button[behaviour-type="submit"][text="Verificar"]`, `walla-button[text="Verificar"]` |

Додаткові спостереження з live DOM (довідково):

| Елемент | Маркер |
|---------|--------|
| Visible OTP widget | `input[data-input-otp="true"]` — також `inputmode="numeric"`, `pattern="^\\d+$"`, `maxlength="6"`, `autocomplete="one-time-code"` |
| Hidden post field | `input[name="mfa_code"]` (синхронізуємо при submit 2FA) |
| OTP container | `[data-input-otp-container="true"]` (6 «клітинок» — візуал; реальний input один overlay) |
| Resend | `walla-button[text="Reenviar"]` (`button-type="tertiary"`) — поки не автоматизуємо |
| Device/session hiddens | `#id-device-id` (`deviceId`), `#id-device-os`, `#id-app-version`, `#id-session-id`, `#id-tracking-user-id` — не чіпаємо |

Текст на екрані («Introduce el código de verificación», «Lo hemos enviado al número…») — **не** використовуємо для детекції.

**Важливо після submit 2FA:** Wallapop може одразу редіректнути з MFA на `/wall`. Не блокуватись довго на sync hidden `input[name="mfa_code"]` (нода зникає → Playwright timeout → CRM зависає на «Verificando»). Якщо MFA-форми вже немає — вважати перехід до outcome / logged-in. Playwright має дивитись вкладку `es.wallapop.com` (часто `/wall`), а не застряглий `accounts.wallapop.com`.

#### Крок 4 — Logged-in success markers (ACTIVE)

Знято live через CDP з профілю після успішного email+2FA логіну. Для `detectLoggedIn` / `waitForLoginOutcome` — **структура**, не фрази на кшталт «Elegidos para…».

| Сигнал | Маркер |
|--------|--------|
| URL (primary) | `https://es.wallapop.com/wall` (pathname `/wall`) |
| URL (також ок) | `/app/`, `/profile`, `/you`, `/account` на `*.wallapop.com` |
| URL (не logged-in) | `accounts.wallapop.com`, `/login`, `/auth/onboarding` |
| DOM | `img[data-testid="user-avatar"]` |
| DOM | `[data-testid="section-inview-feed"]` (стрічка feed на `/wall`) |
| Cookie | `accessToken` (domain `.wallapop.com`) |
| Cookie (також) | `__Secure-next-auth.session-token`, `publisherId`, `trackingUserId`, `wallapop_keep_session` |

Довідково (не primary): у header видно «Tú», «Favoritos»; персоналізований feed «Elegidos para …» — текст може змінитись, `data-testid` надійніший.

Якщо після 2FA з’явилась нова вкладка на `/wall`, а стара MFA закрилась/порожня — **перемкнути** `page` на вкладку з `es.wallapop.com/wall` перед детекцією SUCCESS.

#### Cookies / CMP

Wallapop часто показує **consentmanager** `#cmpbox` (GDPR welcome) з кнопками **Accept all** / **Reject all** — це `<a class="cmpboxbtnyes">`, не `<button>`. **`dismissWallapopConsent`** (селектори `WALLAPOP_CMP_ACCEPT_SELECTORS` у `wallapop-cdp.ts`) викликається на Connect/login, після probe `/wall` при rehydrate, і на старті publish/dry-run.

| `WALLAPOP_CMP_ACCEPT_SELECTORS` / `SELECTORS.cookieAccept` (пріоритет) |
|--------------------------------------|
| `#cmpwelcomebtnyes a.cmpboxbtnyes`, `#cmpwelcomebtnyes a`, `a.cmpboxbtnyes`, `#cmpbntyestxt` |
| `a.cmpboxbtn:has-text("Accept all")` / `Aceptar todo` / `Aceptar todas` |
| legacy: `button:has-text(…)`, `#onetrust-accept-btn-handler` |

Після кліку чекаємо `#cmpbox` hidden, щоб оверлей не блокував «Iniciar sesión con email».

#### reCAPTCHA (fail, без обходу)

| `SELECTORS.recaptcha` |
|-----------------------|
| `iframe[src*="recaptcha"]`, `#id-recaptcha-token`, `.g-recaptcha` |

При видимому captcha після submit пароля → `CONNECT_FAILED` з повідомленням (можна вирішити вручну в headed Chrome).

#### Поза скоупом (кнопки є, логін не робимо)

Google / Apple / Facebook SSO на onboarding — окремі `walla-button`; email-шлях вище.


## Publish (Phase 1)

**Статус:** live publish + атомарний claim (`READY_TO_POST` → `POSTING` → `ACTIVE`) + in-process черга. HTTP і autopost ділять `runProductPublish`. Dry-run лишається **default** (стоп перед Publicar, доки `WALLAPOP_PUBLISH_DRY_RUN` не `false`). Research: `Desk/clients/dmytro-filyk-wallapop/tmp/autopost-research/PUBLISH-FLOW-RESEARCH.md`.

**Модулі:** `wallapop-cdp.ts` (CDP / `location.assign`) · `wallapop-browser.ts` (login/2FA/logout) · `wallapop-publish.ts` (upload flow). Login не змішується з publish.

### Locked decisions

1. **Gate:** publish лише якщо in-memory Wallapop session `status === "ACTIVE"`. Інакше **409** `NOT_ACTIVE` (повідомлення ES). Після `listen` API fire-and-forget `rehydrateWallapopSessionOnBoot()` — **attach або spawn** Chrome на CDP (`WALLAPOP_CDP_PORT` / профіль Persistent); якщо немає Wallapop-табу — **goto** `https://es.wallapop.com/wall`, потім classify (ACTIVE / 2FA / DISCONNECTED). Звичайний `GET /accounts/status` reconcile — **лише attach** (без spawn), але той самий probe `/wall` якщо вкладка не Wallapop. **Publish / Probar:** `ensureWallapopPage()` — **attach або spawn** (як login), потім **завжди нова вкладка** upload (`ownedPage: true`); існуючий `/wall` не reuse і не `location.assign`. Post-`listen` хуки: [`runStartupHooks()`](./src/startup.ts) (rehydrate з тим самим логом + `startWallapopAutopostLoop()`). [`server/src/index.ts`](./src/index.ts) — лише boot + listen + `runStartupHooks()`.
2. **Navigation:** у publish-flow **заборонено** `page.goto` на вже відкритому Wallapop-табі. Дозволено: `location.assign`, UI-кліки, нова вкладка через CDP при recover.
3. **Dry-run default:** стоп **перед** кліком `Publicar`, якщо `WALLAPOP_PUBLISH_DRY_RUN` не дорівнює `false` (unset / `true` = dry-run).
4. **MVP scope:** один CDP-акаунт; лише consumer-goods («Algo que ya no necesito»).
5. **Data path:** CRM `title` → Resumen ≤50; images з `UPLOAD_DIR` + `storageKey`; **category** ← `Category.path` (wallapop_id segments) → breadcrumb `nameEs` root→leaf → desplegable «Categoría y subcategoría» (`ensureCategorySelected` у `wallapop-publish.ts`, константа `PUBLISH_CATEGORY`); Estado / Precio / **tamaño del paquete** (`#delivery` Estándar / `#bulky` Voluminoso) / **tramo de peso** після Estándar з CRM `weightKg` / опційно Medidas `#width` `#length` `#height`; Material fallback `Otro`; skip Pro «Añadir más unidades».

### Category picker (upload form DOM)

Після photos + **Continuar** — `walla-dropdown` («Categoría y subcategoría») → floating `[role=listbox]`. Опції: **`walla-dropdown-item[role=option][aria-label="<nameEs>"]`** (блоки «Categorías sugeridas» / «Todas las categorías»). Спочатку клік по **leaf** з CRM (часто в sugeridas), інакше breadcrumb root→leaf. Breadcrumb: `categoryBreadcrumbLabelsEs(..., { consumerGoodsPublish: true })`.

**Estado / Precio (información del producto):** після категорії закриваємо leftover listbox. `Estado*` відкриваємо від hidden `#condition` (не бейдж «Nuevo» vacaciones). Опції — `walla-dropdown-item[role=option]` з нормалізованим `aria-label`/текстом (`Nuevo`, `Como nuevo`, `En condiciones aceptables` для `FAIR`). Після кліку `#condition` має значення (`new` тощо). Логи: `wallapop_publish_estado_try` / `_selected`. **Precio** — `input#price_amount` / `name="price_amount"` (не `price`). Без Estado + Precio кнопка **Publicar** не з’являється. Кнопка **Publicar** — у **shadow DOM** `walla-button` (host `innerText` порожній); детектор dry-run читає `shadowRoot.querySelector("button")`. Текст кнопки залежить від мови акаунта: `Publicar` (ES) або `Пост` (UK).

**Marca:** обов’язкова на кожному товарі в CRM (`brand`). Combo-каталог: `GET /brands?categoryId=`. **Поля листка:** `POST upload/components` → `Category.attributes.uploadFields`; `GET /categories/:id` віддає `fields`. Extra (Color*, Material* тощо) у формі товару й `typeAttributes`. Немає обов’язкового extra — fail до Publicar. Фетч: `npm run db:upload-fields:fetch`. `externalUrl` лише `/item/…`.

**Envío:** **не клікати** «Activar envío». Дві живі розкладки: (1) одразу «¿Cuánto pesa?» — лише tramo ваги; (2) «Tamaño del producto» Estándar/Voluminoso без kg (jardín тощо) — клікнути radio `delivery`/`bulky` з CRM `shippingPackageSize`, тоді вага. Немає жодного з блоків — не фейлити.

**Envío / tramo de peso:** CRM `weightKg` + buffer **0.25 kg** → смуга `0 a 1` … `20 a 30` kg. Якщо блок **«¿Cuánto pesa?»** на формі **немає** — **не фейлити** (лог `wallapop_publish_weight_selector_missing`), іти далі до Publicar. Medidas `#width`/`#length`/`#height` **опційні** (немає cm у CRM → поля не чіпаємо). Live HTTP без `weightKg` досі **400** `SHIPPING_NOT_READY` (не пускати в Chrome порожню вагу). Якщо `effectiveKg > 30` → **400**.

**Descripción vs IA:** після photos CRM **завжди перезаписує** textarea опису (не `fillIfEmpty` — Wallapop AI часто вже підставляє свій текст). Перед кліком Publicar повторна перевірка: нормалізований текст форми має збігатися з CRM. Якщо IA переписала — ще одна спроба fill; якщо знову чужий текст → `PUBLISH_FAILED` («La descripción en Wallapop no coincide con la del CRM…»), listing ревертиться з `POSTING` (Publicar не натиснуто).

**Логи publish (VPS `server/logs/server.log`, без дебагера):** `wallapop_publish_start` → `wallapop_publish_step` з `phase` → `wallapop_publish_weight_try` / `_selector_missing` (skip) / `_selected` → `wallapop_publish_measures_skip|_filled` → `wallapop_publish_continuar_round` → `before_publicar` → `done`. Abort і missing-weight: `wallapop_publish_abort` / `_weight_selector_missing` + snapshot + **`htmlAround`** (±100 рядків HTML навколо envío / peso / toggle; `htmlNeedle`, `htmlFromLine`–`htmlToLine`).

### Chrome lifecycle

Chrome / вкладки Wallapop відкриваються коли потрібна дія (login, 2FA, publish). Після **publish / Probar** API **гасить chrome.exe** (`quitWallapopChrome`: CDP `Browser.close` + `taskkill` якщо ми spawn-или процес). Профіль Persistent лишається на диску — наступний тік знову `attachOrLaunch`. Сесія в RAM може лишатись `ACTIVE` (cookies у профілі).

| Що | Зараз | План |
|----|--------|------|
| Boot rehydrate | `attachOrLaunch` + probe `/wall` | без змін (Chrome після boot ще живе, поки не publish) |
| Login / 2FA | `attachOrLaunch` | після logout / FAILED — `closeWallapopBrowser` = quit Chrome |
| `GET /accounts/status` reconcile | attach-only; при NONE — quit | не spawn зі status |
| Publish / **Probar publicación** | live: після дії **quit chrome.exe**. Dry-run (Probar): лише закрити upload-таб, Chrome лишається подивитись форму | — |
| `closeWallapopBrowser()` / `quitWallapopChrome()` | disconnect + **quit chrome.exe**; профіль на диску. Logout кидає `BROWSER_BUSY`, якщо слот publish або sold зайнятий. | — |

**Probar:** dry-run зупиняється **перед** `Publicar` (форма заповнена в Chrome, клік Publicar не робиться). Повідомлення UI типу «Rellena el formulario…» — очікувана підказка для live publish; при успішному dry-run API повертає `step: "before_publicar"`.

### Endpoint

| Метод | Шлях | Нотатки |
|-------|------|---------|
| POST | `/api/v1/products/:id/publish` | Auth cookie. Optional body `{ dryRun?: true }` forces stop before Publicar (інакше dry-run з env). `ACTIVE` обов'язково. |

**200** dry-run:

```json
{
  "ok": true,
  "dryRun": true,
  "listing": null,
  "error": null,
  "step": "before_publicar"
}
```

**200** live (`WALLAPOP_PUBLISH_DRY_RUN=false`): `{ ok, dryRun: false, listing, error: null, step: "published" }` — listing `ACTIVE`. `externalUrl` лише унікальний `/item/…` (D11), інакше `null`.

Перед Chrome live publish атомарно claim-ить listing: `READY_TO_POST` → `POSTING` де `productId+accountId` і **немає** публічного URL `/item/…` (upload/home URL не рахується; claim також обнуляє junk URL і інкрементить `postingAttempts`). 0 рядків → **409** `ALREADY_POSTED` (вже `ACTIVE` / `POSTING` / `DEACTIVATED` / `FAILED` / є `/item/…`). Після live-успіху браузера (`dryRun: false`) пише `ACTIVE` **лише якщо** listing ще `POSTING` (не форсить `ACTIVE` поверх `DEACTIVATED` / sold) і обнуляє `postingAttempts`. Якщо браузер уже опублікував, а DB-запис упав — статус лишається `POSTING`, **500** `PUBLISH_FAILED`, revert **немає**.

**D9 — пост висить:** після кліку Publicar Wallapop кидає на `https://es.wallapop.com/app/catalog/published` (Tu Catálogo), **не** на `/item/…`. Поверх каталогу — **`tsl-bump-suggestion-modal`** / `walla-dialog.BumpSuggestionModal`: заголовок **«¡Yuhu! Producto subido»**, кнопки **«Ahora no, gracias»** (secondary) і **«Destacar producto»** (primary), хрестик `aria-label="Close"`. Це успіх публікації. **D11 швидко:** `evaluate` перший `tsl-catalog-item a[href*="/item/"]` (~98%; Follow-up може зняти рядок — не чекати `visible`, рядок під Yuhu). Назва на Wallapop часто **не** збігається з CRM (`aria-label` / `info-title`, напр. «Mesa Auxiliar Cama Teqler Regulable»). Модалку можна закривати після зчитування `href`. У рядку каталогу: `button.btn-sold`, `button.btn-reserve`, `button.btn-edit`. `ACTIVE` лише якщо вкладка жива і URL — цей каталог (або рідкісний `/item/…`) **і** немає банера «Revisa los campos / Revisa la información». Лишились на `/upload/…` або банер → fail, listing **ревертиться** з `POSTING`. `target closed` / інший URL (`/wall` тощо) → fail, **не** `ACTIVE`, claim лишається `POSTING` (лог `wallapop_publish_verify` з `reason`: `published_catalog` \| `item_url` \| `still_on_upload` \| `review_banner` \| `target_closed` \| `unexpected_url`). Без `href` — `ACTIVE` і `externalUrl: null`. Ніколи не писати `/upload/` чи `/published/` у `externalUrl`.

Revert `POSTING` → `READY_TO_POST` лише якщо був claim і Publicar **не** натиснули (BrowserBusy / фейл до Publicar / Stop / банер / upload). Watchdog (boot + кожен autopost тік): `POSTING` старший за `WALLAPOP_POSTING_STALE_MS` і `getBrowserBusy() !== "publish"` → знову `READY_TO_POST` з логом причини (`chrome_dead` / `timeout` / `target_closed`); після `WALLAPOP_POSTING_MAX_ATTEMPTS` claim-ів без `ACTIVE` → `FAILED`. Live publish під lock `publish` watchdog не чіпає. Dry-run **не** claim-ить; **409** `ALREADY_POSTED` якщо listing уже `ACTIVE` або є публічний `/item/…` (`POSTING` для dry-run дозволений, read-only).

| HTTP | code | Коли |
|------|------|------|
| 401 | `UNAUTHORIZED` | Немає cookie |
| 404 | `NOT_FOUND` | Продукт / default account |
| 409 | `NOT_ACTIVE` | Session не ACTIVE |
| 409 | `BROWSER_BUSY` | Chrome зайнятий іншою дією (login / logout / publish / sold / rehydrate). Слоти publish+sold можуть бути разом; два publish або два sold — ні |
| 409 | `ALREADY_POSTED` | Listing уже опублікований / claimed / має публічний `/item/…` |
| 409 | `NOT_PUBLISHABLE` | Складський статус продукту `SOLD` або `INACTIVE` |
| 400 | `SHIPPING_NOT_READY` | Немає peso (live publish, до claim). Medidas не обов’язкові. |
| 400 | `VALIDATION_ERROR` | Немає фото / файл відсутній на диску / вага > 30 kg Estándar |
| 500 | `PUBLISH_FAILED` | Браузерний крок упав (`step: message`); або live success, але listing уже не `POSTING` / DB не записала `ACTIVE` (Wallapop може вже мати товар; статус **не** ревертиться в `READY_TO_POST`) |

### Autopost queue

In-process цикл по `product_listings` (без Redis / нової таблиці). Таймери стартують на буті завжди. Тік **не** поститить, доки UI Start не поставить `accounts.autopost_enabled` **і** `WALLAPOP_PUBLISH_DRY_RUN=false`. `{ dryRun: false }` у воркері **не** обходить env. Якщо live: session `ACTIVE` і Chrome idle (`getBrowserBusy() === "idle"`) → FIFO eligible listings на **default** акаунті (`status: READY_TO_POST`, без публічного `/item/…`, продукт `ACTIVE` з ≥1 image, `orderBy: createdAt asc`, batch 30). Listings без peso **пропускаються** (`wallapop_autopost_skip_shipping`, `recentSkips` у GET default) і тік бере **наступний** ready. Один publish на тік. Не вибирає `POSTING` / `ACTIVE` / `DEACTIVATED` / `FAILED`. Тік **спочатку** ганяє posting watchdog (навіть без Start / без live), щоб після вбитого Chrome черга знову взяла товар або лишила `FAILED`. Модуль watchdog: [`server/src/lib/wallapop-posting-watchdog.ts`](./src/lib/wallapop-posting-watchdog.ts). Інтервал: `account.autopostIntervalMs` → env `WALLAPOP_AUTOPOST_INTERVAL_MS` → default 15 хв; + ±20% jitter. PATCH інтервалу і Start **перезапускають** поточний `setTimeout` (`rescheduleAutopostLoop`), щоб countdown не лишався від старого (довшого) інтервалу. Після кожного тіка loop знову читає інтервал. Інший email Wallapop на connect скидає listings цього default-акаунта. Модуль: [`server/src/lib/wallapop-autopost.ts`](./src/lib/wallapop-autopost.ts). Старт: [`runStartupHooks()`](./src/startup.ts).

### Manual verify (dry-run)

1. Chrome CDP + connect → session `ACTIVE`.
2. Продукт з ≥1 фото в `UPLOAD_DIR` і **leaf** `categoryId` (breadcrumb у БД по `path`).
3. `WALLAPOP_PUBLISH_DRY_RUN` unset або `true`.
4. `POST /api/v1/products/:id/publish` (або **Probar publicación** у CRM) → `step: before_publicar`; у Chrome заповнена категорія з CRM, **не** натиснуто Publicar.
5. У логах API: `wallapop_publish_step` (category `select_done`), потім `wallapop_publish_before_publicar`.

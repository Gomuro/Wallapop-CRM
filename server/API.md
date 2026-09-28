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
| 409 | `ALREADY_SOLD` | Повторний `POST …/sold` |
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
| GET | `/api/v1/categories/:id` | Один вузол, інакше 404 |

Каскад форми: корінь → … → **листок**. `products.categoryId` лише листок, інакше 400 `INVALID_CATEGORY`.

## Products (#55, #56)

Склад, не оголошення Wallapop.

| Метод | Шлях | Нотатки |
|-------|------|---------|
| GET | `/api/v1/products` | Пагінація `page` (default 1), `pageSize` (default 20, max 100). Фільтри: `status` (`ALL` \| `ACTIVE` \| `SOLD` \| `INACTIVE`), `q` (SKU або title, case-insensitive), опційно `categoryId`. Сортування: `updatedAt` desc. Відповідь: `{ products: [{ id, sku, title, price, currency, status, categoryId, coverUrl, updatedAt, listingActive }], page, pageSize, total, totalPages }` |
| POST | `/api/v1/products` | `sku`, `title`, `description`, `price`, `currency` default `EUR`, `categoryId` (листок), `condition` enum, `brand?`, `weightKg?`, `typeAttributes?`. Авто listing на default, статус `READY_TO_POST` |
| GET | `/api/v1/products/:id` | Картка + images + listing |
| PATCH | `/api/v1/products/:id` | Часткове оновлення складу: `sku`, `title`, `description`, `price`, `currency`, `categoryId`, `condition`, `brand`, `weightKg`, `typeAttributes` (усі опційно). **Strict body:** `status`, `soldAt`, `soldPrice` та невідомі ключі → **400** `VALIDATION_ERROR` (не strip). Статус — лише #57. |
| DELETE | `/api/v1/products/:id` | |

`condition`: `NEW` \| `AS_GOOD_AS_NEW` \| `GOOD` \| `FAIR` \| `HAS_GIVEN_IT_ALL`.  
Складський `status` на картці: `ACTIVE` \| `SOLD` \| `INACTIVE` (змінюється лише ендпоінтами #57, не загальним PATCH).

## Status (#57)

| Метод | Шлях | Нотатки |
|-------|------|---------|
| PATCH | `/api/v1/products/:id/status` | JSON `{ "status": "ACTIVE" \| "INACTIVE" }`. Лише складський статус; listings не чіпаються. **200** `{ product }` (той самий shape, що GET `/:id`). `SOLD` у body → **400** `VALIDATION_ERROR`. Продукт уже `SOLD` → **409** `PRODUCT_SOLD`. |
| POST | `/api/v1/products/:id/sold` | Опційно `{ "soldPrice": number }` (EUR, як `price`); порожнє `{}` або без body — `soldPrice` = поточний `price`. Одна транзакція: `status` `SOLD`, `soldAt` (серверний now), усі `product_listings` → `DEACTIVATED` (`external_url` не змінюється). **200** `{ product }`. Повтор → **409** `ALREADY_SOLD`. |

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
| `externalUrl` | URL string або `null` (очистити) |
| `status` | `READY_TO_POST` \| `ACTIVE` \| `DEACTIVATED` |
| `shippingEnabled` | `boolean` |
| `shippingUpToKg` | позитивне ціле або `null` |

Зайві ключі в body → **400** `VALIDATION_ERROR`. Порожній `{}` → **400**.

**200** — той самий envelope, що GET. Якщо рядка listing ще не було (рідко) — **create** через upsert.

| HTTP | code | Коли |
|------|------|------|
| 400 | `VALIDATION_ERROR` | Zod |
| 404 | `NOT_FOUND` | Продукт не знайдено або немає default account |
| 500 | `INTERNAL` | БД не налаштована |

## Accounts (#64)

| Метод | Шлях | Нотатки |
|-------|------|---------|
| GET | `/api/v1/accounts/default` | Єдиний `isDefault: true`. Повний CRUD акаунтів — етап 2 |
| GET | `/api/v1/accounts/status` | In-memory сесія браузера: `{ status, requires2FA, email, error? }`. `status`: `DISCONNECTED` \| `AUTHENTICATING` \| `ACTIVE`. Після рестарту API: **CDP rehydrate** — якщо Chrome ще на MFA (`#mfa-code-validation-form`) → знову `AUTHENTICATING` + `requires2FA`; якщо вже залогінений → `ACTIVE` |
| POST | `/api/v1/accounts/connect` | Body `{ email, password, proxy? }` — **password використовується** для Keycloak fill (у БД **не** зберігається). Відкриває/чіпляє Chrome → onboarding «Iniciar sesión con email» → fill `#username`/`#password` → `#kc-login`. Вже залогінений профіль → `ACTIVE` без форми. Потрібен 2FA → `requires2FA: true`. Fail (у т.ч. reCAPTCHA) → **400** `CONNECT_FAILED` |
| POST | `/api/v1/accounts/connect/2fa` | Body `{ code }` (4–8 alphanumeric). Вводить OTP у відкритий контекст. Якщо RAM злетіла після рестарту, але MFA-екран у Chrome лишився — **re-attach CDP** і прийняти код (не 409). Без MFA/сесії → **409** `NOT_AUTHENTICATING`. Помилка коду → **400** `CONNECT_FAILED` |
| POST | `/api/v1/accounts/disconnect` | Повний **logout Wallapop** у Chrome-профілі (`clearCookies` + `es.wallapop.com/logout`) + CRM `DISCONNECTED`; Prisma default → `INACTIVE`. Профіль на диску / процес Chrome не видаляються. Якщо CDP недоступний — CRM все одно від’єднується |

Пароль Wallapop у БД **не** зберігається. При `ACTIVE` / disconnect оновлюється `status` default-акаунта в Prisma (`ACTIVE` / `INACTIVE`).

### Браузерні профілі (обов’язково — 1 акаунт = 1 Chrome user-data-dir)

**Правило:** кожен Wallapop-акаунт має **окремий** persistent Chrome profile (`--user-data-dir`). Не шарити один профіль між кількох акаунтів і не ганяти логін у «чистому» тимчасовому профілі.

**Навіщо:** Wallapop / антифрод сильно детектить однакові fingerprints, cookies і історію. Окремий `user-data-dir` зберігає cookies, Google-логін у Chrome, історію й локальний стан саме під цей акаунт — як зараз локальний ярлик `Chrome CDP.lnk` → `ChromeCDP-Persistent`.

**Як робимо зараз (один акаунт):**
- Launch / attach: реальний Google Chrome + CDP (`WALLAPOP_CDP_URL`, default `:9222`).
- Profile: `WALLAPOP_CHROME_USER_DATA_DIR` або `%USERPROFILE%\ChromeCDP-Persistent` (той самий каталог, що в ярлику).
- Не використовуємо порожній `profiles/account_1` для робочого акаунта.

**Як будемо масштабувати (multi-account, етап 2+):**
- На кожен CRM `Account` — свій каталог, напр. `ChromeCDP-<accountId>` або `profiles/wallapop_<n>` **поза** спільним Default Chrome.
- Окремий CDP-порт на акаунт (9222, 9223, …) або один Chrome за раз з відповідним `user-data-dir`.
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

| `SELECTORS.cookieAccept` |
|--------------------------|
| `button:has-text("Aceptar")`, `button:has-text("Accept")`, `button:has-text("Accept all")`, `button:has-text("Aceptar todas")`, `#onetrust-accept-btn-handler` |

#### reCAPTCHA (fail, без обходу)

| `SELECTORS.recaptcha` |
|-----------------------|
| `iframe[src*="recaptcha"]`, `#id-recaptcha-token`, `.g-recaptcha` |

При видимому captcha після submit пароля → `CONNECT_FAILED` з повідомленням (можна вирішити вручну в headed Chrome).

#### Поза скоупом (кнопки є, логін не робимо)

Google / Apple / Facebook SSO на onboarding — окремі `walla-button`; email-шлях вище.


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

Перевірка без ручного curl: `npm run server:smoke` (API вже слухає). Postman-колекція: `server/postman/`.

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
| PATCH | `/api/v1/products/:id` | Часткове оновлення складу (**без** `status`, `soldAt`, `soldPrice` — див. Status #57) |
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

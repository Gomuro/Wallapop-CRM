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
| GET | `/api/v1/categories` | `ORDER BY parentId, sortOrder`. Поля: `id`, `wallapopId`, `parentId`, `slug`, `nameEs`, `nameUk`, `isLeaf`, `leafSelectionMandatory`, `depth`, `path`, `sortOrder` |
| GET | `/api/v1/categories/:id` | Один вузол |

Каскад форми: корінь → … → **листок**. `products.categoryId` лише листок, інакше 400 `INVALID_CATEGORY`.

## Products (#55, #56)

Склад, не оголошення Wallapop.

| Метод | Шлях | Нотатки |
|-------|------|---------|
| GET | `/api/v1/products` | Пагінація `page`, `pageSize`. Фільтри `status`, `q` (SKU/назва) |
| POST | `/api/v1/products` | `sku`, `title`, `description`, `price`, `currency` default `EUR`, `categoryId` (листок), `condition` enum, `brand?`, `weightKg?`, `typeAttributes?`. Авто listing на default, статус `READY_TO_POST` |
| GET | `/api/v1/products/:id` | Картка + images + listing |
| PATCH | `/api/v1/products/:id` | Часткове оновлення складу |
| DELETE | `/api/v1/products/:id` | |

`condition`: `NEW` \| `AS_GOOD_AS_NEW` \| `GOOD` \| `FAIR` \| `HAS_GIVEN_IT_ALL`.  
`status`: `ACTIVE` \| `SOLD` \| `INACTIVE`.

## Status (#57)

| Метод | Шлях | Нотатки |
|-------|------|---------|
| PATCH | `/api/v1/products/:id/status` | `ACTIVE` / `INACTIVE` (не sold) |
| POST | `/api/v1/products/:id/sold` | Одна транзакція: product `SOLD` + `soldAt` + усі listing `DEACTIVATED` |

## Photos (#58)

До 10 файлів. `sortOrder` 0 = обкладинка.

| Метод | Шлях | Нотатки |
|-------|------|---------|
| POST | `/api/v1/products/:id/images` | `multipart` → диск `UPLOAD_DIR` |
| PATCH | `/api/v1/products/:id/images` | reorder `{ ids: string[] }` |
| PUT | `/api/v1/products/:id/images/:imageId` | замінити файл |
| DELETE | `/api/v1/products/:id/images/:imageId` | |

## Listings (#65)

Один default-акаунт. Клієнт не шле `accountId`.

| Метод | Шлях | Нотатки |
|-------|------|---------|
| GET | `/api/v1/products/:id/listing` | URL + `status` (`READY_TO_POST` \| `ACTIVE` \| `DEACTIVATED`) |
| PUT | `/api/v1/products/:id/listing` | upsert `externalUrl?`, `status?`, `shippingEnabled?`, `shippingUpToKg?` |

## Accounts (#64)

| Метод | Шлях | Нотатки |
|-------|------|---------|
| GET | `/api/v1/accounts/default` | Єдиний `isDefault: true`. Повний CRUD акаунтів — етап 2 |

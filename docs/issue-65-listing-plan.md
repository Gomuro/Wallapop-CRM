# План виконання · issue #65 — ProductListing (GET/PUT, default account)

**Статус:** план, не код.  
**Scope:** лише Express API у `server/` (до #61 — без автотестів).  
**Контракт:** `server/API.md` (секція Listings #65), epic #50, milestone «2 · Backend API».  
**Issue:** [Gomuro/Wallapop-CRM#65](https://github.com/Gomuro/Wallapop-CRM/issues/65).

Етап 1: один default-акаунт, клієнт **не** шле `accountId`. «Де висить» = один рядок `product_listings` на пару `(productId, defaultAccountId)`.

---

## 1. Мета й контракт

### 1.1 Бізнес-мета

- Після створення товару (#55) вже є listing на default з `status: READY_TO_POST`.
- Окремі ендпоінти дають картці «Where it hangs» (#63 web) читання й оновлення **URL + статус** (і опційно shipping-поля з БД, без UI на етапі 1).
- PUT = **upsert** за `@@unique([productId, accountId])`, `accountId` завжди з `accounts.is_default = true`.

### 1.2 Авторизація

Як у решти каталогу: `requireAuth` на `/api/v1/*` (`server/src/routes/v1.ts`). Без сесії → **401** `UNAUTHORIZED`.

### 1.3 `GET /api/v1/products/:id/listing`

**Успіх 200**

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

- Форма полів **та сама**, що вкладений `product.listing` у `toProductJson` (`server/src/routes/products.ts`) — один shared mapper `toListingJson`, щоб картка продукту й listing-ендпоінт не роз’їхались.
- `status`: `READY_TO_POST` | `ACTIVE` | `DEACTIVATED` (`ListingStatus`).
- `externalItemId` лише **read-only** у відповіді (етап 2 / воркер); клієнт етапу 1 не редагує.

**Помилки**

| HTTP | code | Коли |
|------|------|------|
| 404 | `NOT_FOUND` | Невалідний/порожній `:id`, продукт не існує, **немає default account**, або немає рядка listing для `(product, default)` |
| 500 | `INTERNAL` | Немає `DATABASE_URL` / Prisma |

Повідомлення для default account — **те саме**, що в `createProduct` і `getDefaultAccount`: `"Default account is not configured."`

### 1.4 `PUT /api/v1/products/:id/listing`

**Body (JSON, camelCase)** — усі поля опційні, але **хоча б одне** має бути присутнє (інакше 400):

| Поле | Тип | Правила |
|------|-----|---------|
| `externalUrl` | `string` (URL) \| `null` | `null` або відсутність після parse — очистити колонку |
| `status` | enum `ListingStatus` | |
| `shippingEnabled` | `boolean` | |
| `shippingUpToKg` | `integer` \| `null` | Позитивне ціле; для етапу 1 узгодити з колонкою (смуги Wallapop 2/5/10/20/30 — опційно `z.union` літералів у Zod, інакше будь-яке `int().positive()`) |

**Заборонено в body:** `accountId`, `productId`, `externalItemId`, `lastPostedAt`, `lastEditedAt` — Zod `.strict()` або явний pick, зайві ключі → 400.

**Upsert**

1. Знайти default account; якщо немає → **404** (як вище).
2. Перевірити, що `product` з `:id` існує → інакше **404** `"Product not found."`
3. `prisma.productListing.upsert` з `where: { productId_accountId: { productId, accountId } }`:
   - **create:** поля з body + дефолти схеми: `status` → `READY_TO_POST` якщо не передано; `shippingEnabled` → `false`; `externalUrl` / `shippingUpToKg` → `null` де не задано.
   - **update:** лише передані поля (partial merge).

**Успіх 200** — той самий envelope, що GET: `{ "listing": { … } }`.

**Помилки:** `VALIDATION_ERROR` (Zod), `NOT_FOUND` (продукт / default), `INTERNAL`.

### 1.5 Відмінність від `GET /api/v1/products/:id`

Картка продукту вже повертає `listing` (перший рядок з `productCardInclude`). Ендпоінт #65 потрібен для легкого екрану «де висить» без тягнення images/опису. Після #65 **рекомендовано** звузити `productCardInclude.listings` до `where: { account: { isDefault: true } }`, щоб при майбутніх multi-account (етап 2) картка не показувала «чужий» рядок.

---

## 2. Крайові випадки

| Ситуація | Очікувана поведінка |
|----------|---------------------|
| Немає рядка `is_default = true` | **404** на GET/PUT listing і на POST product (вже так у #55) |
| Продукт не знайдено | **404** `"Product not found."` (перевірка **до** upsert) |
| Продукт є, listing на default відсутній (ручні дані / старий seed) | GET → **404** (немає рядка). PUT → **create** через upsert |
| Два listing на один продукт (різні accountId) | Етап 1: лише default у фокусі; UNIQUE не дає двох рядків на один account. GET/PUT працюють лише з default |
| Порожній body на PUT `{}` | **400** `VALIDATION_ERROR` |
| Невалідний URL / status / shippingUpToKg | **400** |
| `externalUrl: null` на PUT | Очистити `external_url` |
| Sold (#57, не в scope) | Пізніше: усі listings → `DEACTIVATED`; #65 не змінює product status |
| Видалення продукту | CASCADE знімає listings (схема вже є) |
| Анонімний запит | **401** |

**Інваріант етапу 1:** максимум **один** listing на товар у нормальному флоу (create #55). Upsert на PUT — страховка, не заміна create.

---

## 3. Зміни по файлах

| Файл | Дія |
|------|-----|
| **`server/src/routes/product-listings.ts`** | **Новий.** `getProductListing`, `putProductListing`; спільні `sendZod`, `requireDefaultAccount`, `assertProductExists`, `toListingJson`. |
| **`server/src/routes/catalog.ts`** | Замінити `notImplemented` на імпорт хендлерів для `GET`/`PUT` `/products/:id/listing`. |
| **`lib/validations/listing.ts`** | Додати **`productListingApiPutBodySchema`** (pick + partial + refine ≥1 key + strict). Експорт типу. Існуючі `productListingCreateSchema` / `productListingUpdateSchema` лишити для Prisma/внутрішнього використання або звести PUT до нової схеми. |
| **`server/src/routes/products.ts`** | (Рекомендовано в #65) Винести `findDefaultAccountId(prisma)` у `server/src/lib/default-account.ts` або локальний helper, щоб не дублювати з `product-listings.ts`. Опційно: `productCardInclude.listings.where.account.isDefault`. **Не** змінювати контракт create/list без потреби. |
| **`server/API.md`** | Розширити секцію Listings: повні request/response, таблиця помилок, заборона `accountId` у body, upsert, узгодження з `product.listing`. |
| **`server/scripts/smoke.ts`** | Після `POST /products` (існуючий smoke): `GET …/listing` (200, `READY_TO_POST`), `PUT` з `externalUrl` + `status: ACTIVE`, повторний `GET` (перевірка полів). Cleanup як зараз — `DELETE` product. |
| **`server/postman/Wallapop-CRM.postman_collection.json`** | Оновити описи запитів listing; body PUT узгодити з контрактом; за можливості `{{productId}}` замість `replace-me` (як у сусідніх запитах, якщо вже є pattern). |

**Не чіпати:** `docs/issue-58*` (якщо з’явиться), `.cursor/plans` з #58, Prisma schema (колонки вже є), Next `app/`.

---

## 4. Zod-схеми

У `lib/validations/listing.ts`:

1. **`listingStatusSchema`** — вже є; перевикористати.
2. **`productListingApiPutBodySchema`** (нова):

```ts
z.object({
  externalUrl: z.string().trim().url().nullable().optional(),
  status: listingStatusSchema.optional(),
  shippingEnabled: z.boolean().optional(),
  shippingUpToKg: z.number().int().positive().nullable().optional(),
})
.strict()
.refine((o) => Object.keys(o).length > 0, { message: "At least one field is required." })
```

3. Опційно **`shippingUpToKgSchema`** = `z.union([z.literal(2), z.literal(5), …])` — якщо хочемо жорсткі смуги в API; інакше лишити positive int (як у `productListingCreateSchema`).
4. **`productListingJsonSchema`** — не обов’язково в runtime; тип відповіді вивести з `toListingJson` або `z.infer` окремого об’єкта для документації.

**Не використовувати** для PUT напряму `productListingUpdateSchema` — там є `externalItemId` і семантика create; API body вужчий (див. issue + `API.md`).

---

## 5. Чеклист перевірки (без #61)

### 5.1 Ручно (Postman / curl після логіну)

- [ ] `GET /api/v1/products/:id/listing` на щойно створеному товарі → 200, `status: READY_TO_POST`, `externalUrl: null`.
- [ ] `PUT` з валідним `externalUrl` (наприклад `https://es.wallapop.com/item/…`) + `status: ACTIVE` → 200, поля збережені.
- [ ] `PUT` з `externalUrl: null` → URL очищено.
- [ ] `PUT` з невалідним URL → 400.
- [ ] `PUT` з порожнім `{}` → 400.
- [ ] `GET`/`PUT` для неіснуючого `productId` → 404.
- [ ] `GET /api/v1/products/:id` після PUT — `product.listing` збігається з `GET …/listing` (якщо оновлено include на default-only).
- [ ] Без cookie → 401 на listing routes.

### 5.2 Smoke

- [ ] `npm run server:smoke` (або скрипт з `package.json`) проходить з новими кроками listing **до** delete product.

### 5.3 Регресія

- [ ] `POST /api/v1/products` досі вимагає default account (404 без seed account).
- [ ] `GET /api/v1/accounts/default` без змін (#64).

---

## 6. Залежності (вже зроблено)

| Issue | Що дає для #65 |
|-------|----------------|
| **#55** | Product CRUD, авто-`productListing.create` на default, `toProductJson` / `productCardInclude`, повідомлення про default account. |
| **#64** | `GET /accounts/default`, seed з одним `is_default`, інваріант одного default у БД. |

Без default account у seed (#66/#53) listing-флоу не перевірити — це очікувано.

---

## 7. Явно поза scope (#65)

- **#61** — Vitest/supertest suite, CI contract tests.
- **#57** — `POST …/sold`, `PATCH …/status`, масове `DEACTIVATED` listings.
- **#56** — пагінація/фільтри списку (окремо від listing endpoints).
- **#63** — UI «Where it hangs».
- Публікація / bump / expiry на Wallapop, черги, `lastPostedAt` / `lastEditedAt`.
- Запис `externalItemId` з клієнта (етап 2).
- CRUD акаунтів, мульти-listing, різні фото per account.
- Зміни Prisma / нові міграції (модель готова).
- Spaces/S3 для фото (#58 окремо).

---

## 8. Критерій готовності PR (issue #65)

1. `GET` і `PUT` `/api/v1/products/:id/listing` реалізовані, не 501.
2. Контракт у `server/API.md` відповідає коду.
3. Smoke покриває happy-path listing.
4. Новий товар через API має listing на default; PUT upsert без `accountId` у body.
5. Поведінка помилок узгоджена з таблицею в `API.md` (розділ «Помилки»).

Після merge — можна брати #57 (sold) і #63 (web), не блокуючи один одного на рівні listing API.

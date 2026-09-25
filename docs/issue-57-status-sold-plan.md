# План виконання · #57 Status + Sold-sync

**Статус:** план, не код.  
**Issue:** [Gomuro/Wallapop-CRM#57](https://github.com/Gomuro/Wallapop-CRM/issues/57) — Sold-sync (продано + зняти listings).  
**Milestone:** 2 · Backend API (epic #50).  
**Залежить від:** #55 (Product CRUD), #65 (listing upsert — sold лише **деактивує** існуючі рядки).  
**Не входить:** #61 (автотести API), зняття на Wallapop, `sold_via_account_id`, RESERVED.

Джерела контракту: `server/API.md` (розділ Status #57), `docs/backend-etap1-plan.md` (рядок #57 у таблиці після #66), `server/prisma/schema.prisma` (`ProductStatus`, `ListingStatus`, `soldAt` / `soldPrice`).

---

## 1. Мета й HTTP-контракт

### 1.1 Бізнес-мета

Кнопка «Продано» на складі: товар більше не в наявності (`SOLD`), фіксується час і ціна продажу, усі оголошення цього SKU в БД → `DEACTIVATED`. Без HTTP до Wallapop.

Окремий шлях для **складського** статусу «в наявності / приховано» без продажу: `ACTIVE` ↔ `INACTIVE` через `PATCH …/status`. **`SOLD` лише через `POST …/sold`**, не через загальний `PATCH /products/:id` і не через `…/status`.

### 1.2 `PATCH /api/v1/products/:id/status`

| Аспект | Значення |
| ------ | -------- |
| Auth | Cookie `crm_session`, інакше **401** `UNAUTHORIZED` |
| Body | `{ "status": "ACTIVE" \| "INACTIVE" }` — рівно один ключ, camelCase |
| Успіх | **200** `{ "product": { … } }` — той самий shape, що `GET /api/v1/products/:id` (`toProductJson` + `productCardInclude`) |
| Семантика | Лише зміна `products.status`. **Не** чіпати `soldAt`, `soldPrice`, `product_listings` |

Заборонено в body: `SOLD` (Zod → **400** `VALIDATION_ERROR`). Не приймати `soldAt` / `soldPrice` тут.

### 1.3 `POST /api/v1/products/:id/sold`

| Аспект | Значення |
| ------ | -------- |
| Auth | Як вище |
| Body | Опційно `{ "soldPrice": number }` (EUR, ті ж правила що `price` у `warehouseProductCreateSchema`). Порожнє тіло `{}` або відсутність body — OK |
| Успіх | **200** `{ "product": { … } }` після транзакції (картка з `status: "SOLD"`, `soldAt` ISO, `soldPrice`, `listing.status: "DEACTIVATED"`) |
| Семантика | Одна Postgres-транзакція (див. §2) |

Поля відповіді `product`: як у #55 — `soldAt`, `soldPrice`, `listing` (перший listing за `createdAt asc`, як зараз у `productCardInclude`).

---

## 2. Правила транзакцій і інваріанти

### 2.1 `POST …/sold` (обов’язкова `$transaction`)

У межах однієї `prisma.$transaction`:

1. `findUnique` продукт за `:id`. Немає рядка → **404** `NOT_FOUND` (до або всередині tx — однаково для клієнта).
2. Якщо `product.status === "SOLD"` → **409** (новий code, див. §3), **без** змін у БД.
3. `product.update`:
   - `status = SOLD`
   - `soldAt = now()` (серверний `Date`, не з body)
   - `soldPrice = body.soldPrice ?? product.price` (Decimal як у create)
4. `productListing.updateMany` where `productId = id` → `status = DEACTIVATED`.
5. **Не** змінювати: `external_url`, `external_item_id`, `shipping_*`, `last_posted_at`, `last_edited_at`, фото, `price` складу (лише `sold_price`).

Якщо listingів 0 (теоретично без #55 auto-listing) — крок 4 no-op, **не** створювати listing (#57 issue).

### 2.2 `PATCH …/status`

1. Продукт існує, інакше **404**.
2. Якщо поточний `product.status === "SOLD"` → **409** (той самий або окремий code — див. §3); не дозволяти «розпродати назад» через status.
3. `update` лише `status` на `ACTIVE` або `INACTIVE`.
4. Listings **не** оновлювати (зняття з Wallapop — етап 2; UI «де висить» може лишатися `ACTIVE` у БД, поки людина не змінить через #65 — свідомо не змішуємо складський INACTIVE з listing).

### 2.3 Розділення з `PATCH /api/v1/products/:id`

Сьогодні `warehouseProductUpdateSchema` дозволяє `status` включно з `SOLD`, а хендлер `patchProduct` застосовує `body.status` (#55).

**Рішення для #57:**

- Прибрати `status`, `soldAt`, `soldPrice` з body схеми оновлення картки (`updateBodySchema` у `server/src/routes/products.ts` — вже omit sold-полів; **додати omit `status`** або окрема partial-схема без status).
- Якщо клієнт шле `status` на загальний PATCH → **400** `VALIDATION_ERROR` (unrecognized / strip через `.strict()` або omit).
- Перехід у `SOLD` — лише `POST …/sold`; `ACTIVE`/`INACTIVE` — лише `PATCH …/status`.

Це узгоджує API.md і уникає обходу транзакції sold.

### 2.4 Два різні «status»

`ProductStatus` (склад) і `ListingStatus` (оголошення) — різні поля (`server/API.md`). #57 змінює обидва лише в сценарії **sold**; status PATCH чіпає лише продукт.

---

## 3. Помилки, валідація, ідемпотентність

### 3.1 Таблиця помилок

| HTTP | code | Ендпоінт | Коли |
| ---- | ---- | -------- | ---- |
| 400 | `VALIDATION_ERROR` | обидва | Zod: невідомий/зайвий ключ, `status` не ACTIVE/INACTIVE, невалідний `soldPrice` |
| 401 | `UNAUTHORIZED` | обидва | Немає сесії |
| 404 | `NOT_FOUND` | обидва | Невідомий `id` або порожній `:id` (як у `patchProduct`) |
| 409 | **`ALREADY_SOLD`** (рекомендовано) | `POST …/sold` | Продукт уже `SOLD` |
| 409 | **`PRODUCT_SOLD`** або той самий `ALREADY_SOLD` | `PATCH …/status` | Намагаються змінити статус проданого SKU |
| 500 | `INTERNAL` | обидва | Prisma / БД не налаштована |

Додати рядки в `server/API.md` (таблиця помилок + розширити Status #57 тілом sold).

`SKU_TAKEN` тут не застосовується.

### 3.2 Ідемпотентність `POST …/sold`

Тіло issue: повторний sold **не ламає** дані, але API повертає **409**, якщо вже `SOLD` (захист від подвійного кліку). Це **не** HTTP-idempotent success (не 200 з тим самим станом). Повторний запит не змінює `soldAt`/`soldPrice` вдруге.

Альтернатива (не брати без зміни issue): 200 з поточною карткою — **не** плануємо.

### 3.3 `PATCH …/status` ідемпотентність

`PATCH` з тим самим `status`, що вже в БД — **200** з карткою (звичайна семантика PATCH, без 409).

---

## 4. Зміни по файлах

### 4.1 `lib/validations/product.ts`

| Додати | Призначення |
| ------ | ----------- |
| `warehouseProductStatusPatchSchema` | `z.object({ status: z.enum(["ACTIVE", "INACTIVE"], …) })` |
| `productSoldBodySchema` | `z.object({ soldPrice: moneySchema.optional() }).default({})` або `.optional()` на весь body |

Експорт типів за потреби. **Не** розширювати `warehouseProductUpdateSchema` полем sold — sold лишається окремим маршрутом.

Опційно: `warehouseProductUpdateSchema` без `status` / sold-полів (окремий `warehouseProductFieldsUpdateSchema`) — щоб один source of truth для PATCH картки.

### 4.2 `server/src/routes/products.ts`

| Дія | Деталі |
| --- | ------ |
| Нові експорти | `patchProductStatus`, `postProductSold` (або один файл `product-status.ts` — **краще лишити в `products.ts`** поруч з `patchProduct`, reuse `paramId`, `loadProductCard`, `toProductJson`, `sendZod`) |
| `patchProduct` | Прибрати гілку `if (body.status !== undefined)`; схема без `status` |
| `postProductSold` | Tx з §2.1; parse `productSoldBodySchema`; 409 на SOLD |
| `patchProductStatus` | Логіка §2.2 |

Патерн помилок: як у `createProduct` / `patchProduct` (`sendError`, `prismaErrorCode` P2025 → 404).

### 4.3 `server/src/routes/catalog.ts`

Замінити:

```ts
catalog.patch("/products/:id/status", notImplemented)
catalog.post("/products/:id/sold", notImplemented)
```

на імпорт реальних хендлерів з `./products`. Порядок маршрутів лишається: специфічні шляхи (`/status`, `/sold`, `/images`) вже після `/:id` — для Express важливо, що `PATCH /products/:id` не перехоплює `/status` (зараз окремі рядки — OK).

### 4.4 `server/API.md`

- Розділ **Status (#57)**: body для `PATCH …/status`; для `POST …/sold` — опційний `soldPrice`; відповідь `{ product }`.
- Таблиця помилок: `ALREADY_SOLD` / `PRODUCT_SOLD` (узгодити одну або дві коди).
- **Products (#55)**: примітка, що `status` / sold-поля **не** через `PATCH /products/:id`.

### 4.5 `server/scripts/smoke.ts`

Після створення smoke-товару (існуючий флоу):

1. `PATCH …/status` → `INACTIVE`, перевірити `product.status`.
2. `PATCH …/status` → `ACTIVE`.
3. `POST …/sold` → 200, `status === "SOLD"`, `soldAt` не null, `listing.status === "DEACTIVATED"`, `listingActive` у списку false (опційно `GET /products`).
4. Повторний `POST …/sold` → 409 `ALREADY_SOLD`.
5. Cleanup: `DELETE /products/:id` як зараз.

Не замінює #61; лише ручний `npm run server:smoke`.

### 4.6 `server/postman/Wallapop-CRM.postman_collection.json`

- `PATCH /products/:id/status` — body вже `{ "status": "INACTIVE" }`; додати приклад ACTIVE, опис у name/description за потреби.
- `POST /products/:id/sold` — raw JSON `{ "soldPrice": 19.99 }` + варіант без body.
- Після sold — приклад `GET /products/:id` у тій же папці (якщо є змінна `productId`).

### 4.7 Не чіпати в #57

- `server/prisma/schema.prisma` — поля вже є.
- `lib/validations/listing.ts` — окремий контракт #65.
- Next `app/`, UI #63.
- Файли плану #58 (photos).

---

## 5. Взаємодія з #65 (listing)

| Тема | Поведінка |
| ---- | --------- |
| Create #55 | Listing `READY_TO_POST` на default — без змін |
| `PUT /products/:id/listing` (#65) | Може виставити `ACTIVE` / `DEACTIVATED` / URL, поки продукт **не** `SOLD` |
| Після `POST …/sold` (#57) | Усі listings → `DEACTIVATED`; `external_url` зберігається (посилання для історії) |
| `GET /products` `listingActive` | `listings.some(s => s !== "DEACTIVATED")` — після sold **false** |
| Конфлікт | Рекомендація для #65 (можна імплементувати там): `PUT listing` на `SOLD` продукт → **409** `PRODUCT_SOLD` або **400**, не відкочувати sold. #57 **не** блокує #65, але в PR #57 задокументувати очікування в `API.md` під Listings |

#57 **не** реалізує GET/PUT listing — лише `updateMany` при sold.

---

## 6. Чеклист перевірки (без #61)

Перед закриттям issue вручну (Postman / smoke / curl з cookie):

- [ ] `PATCH …/status` ACTIVE ↔ INACTIVE, 200 + повна картка
- [ ] `PATCH …/status` з `"status": "SOLD"` → 400
- [ ] `PATCH /products/:id` з `"status": "SOLD"` → 400 (поле не в схемі)
- [ ] `POST …/sold` на ACTIVE: один рядок `SOLD`, `soldAt` заповнений, `soldPrice` = `price` без body
- [ ] `POST …/sold` з `soldPrice` → збережене значення
- [ ] Усі listings товару `DEACTIVATED`, `external_url` без змін
- [ ] Товар без listings (якщо вручну видалили) — sold лишається 200, без помилки
- [ ] Повторний `POST …/sold` → 409, дані не зсунулись
- [ ] `PATCH …/status` на SOLD → 409
- [ ] Анонім → 401 на обох маршрутах
- [ ] Невідомий id → 404
- [ ] `npm run server:smoke` проходить з новими кроками
- [ ] `server/API.md` і Postman узгоджені з реалізацією

---

## 7. Поза scope (#57 і цей план)

- Автоматизовані тести (#61), Playwright UI (#31)
- Виклик Wallapop для зняття оголошення
- `RESERVED`, `sold_via_account_id`, мульти-акаунт listings
- Скасування продажу (повернення з `SOLD` у `ACTIVE`)
- Зміна listing status разом з `INACTIVE` продуктом
- Міграції БД, зміни seed (окрім smoke SKU)
- Реалізація `GET`/`PUT` `/products/:id/listing` (#65) — окремий PR, узгоджений з sold

---

## 8. Порядок імплементації (для виконавця)

1. Zod-схеми в `lib/validations/product.ts`.
2. Прибрати `status` з PATCH картки + хендлери `patchProductStatus` / `postProductSold`.
3. Підключити маршрути в `catalog.ts`.
4. Оновити `API.md`, Postman, `smoke.ts`.
5. Прогін чеклисту §6, коментар у GitHub #57 з прикладом JSON відповіді.

Орієнтовний обсяг: один PR, без залежності від #58; паралель з #65 можлива, якщо sold не чіпає listing routes.

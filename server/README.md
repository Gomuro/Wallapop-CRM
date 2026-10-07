# server

API-процес Wallapop CRM. **Express** + TypeScript. Один git з UI (`app/`), **окремий деплой** на VPS.

- UI (Next) → Vercel
- цей процес → VPS: `npm run server:start` з **кореня** репо
- Prisma живе **тут**: `server/prisma/` (схема, міграції, seed) і клієнт `server/generated/prisma`. Next на Vercel у склад не ходить — лише HTTPS на цей API. Zod (`lib/validations/`) спільний.
- Postgres теж **тут**: `server/docker-compose.yml` (`npm run db:up` з кореня) і секрети в `server/.env` (не в корневому `.env` UI).
- Контракт: [API.md](./API.md)

```bash
npm run db:up
npx playwright install chromium
npm run server:dev
npm run server:smoke
```

`server:smoke` сам логіниться seed-юзером з `.env` і перевіряє health / 401 / login / me / 501 / logout.

Підключення Wallapop (`POST /api/v1/accounts/connect`):
1. Чіпляється до Chrome на CDP (`WALLAPOP_CDP_URL`, default `http://127.0.0.1:9222`), якщо вже відкритий.
2. Якщо ні — **сам** запускає Google Chrome (headed) з тим самим профілем, що ярлик «Chrome CDP»:
   `WALLAPOP_CHROME_USER_DATA_DIR` або `%USERPROFILE%\ChromeCDP-Persistent`, порт `9222`.
3. Email-login: onboarding → Keycloak fill → submit; 2FA через CRM-модалку; disconnect = logout Wallapop у профілі + CRM `DISCONNECTED`.

**CDP env — тимчасово (single-account MVP):** один глобальний `WALLAPOP_CDP_URL` / один профіль на весь процес. **Для multi-account буде інакше** (per-account `user-data-dir` + порт) — не вважати поточний env фінальним. Деталі: [API.md → Браузерні профілі](./API.md#браузерні-профілі-обовязково--1-акаунт--1-chrome-user-data-dir).

**Профілі (запам’ятати):** 1 Wallapop-акаунт = 1 окремий Chrome `--user-data-dir` (cookies / історія / fingerprint). Не шарити профіль між акаунтами — інакше сильний детект.

### Autopost (Phase 1)

`POST /api/v1/products/:id/publish` — browser publish consumer-goods через CDP. Потрібна session `ACTIVE`. За замовчуванням dry-run (`WALLAPOP_PUBLISH_DRY_RUN` ≠ `false`) — стоп перед Publicar, без UI. Модулі: `wallapop-cdp` / `wallapop-browser` (login) / `wallapop-publish`. Деталі: [API.md → Publish](./API.md#publish-phase-1).

Черга — це `product_listings` (без Redis). **Start/Stop** у `/accounts` (`accounts.autopost_enabled`). Live Publicar: `WALLAPOP_PUBLISH_DRY_RUN=false`. Інтервал: UI або env `WALLAPOP_AUTOPOST_INTERVAL_MS` (default **15 хв** + ±20% jitter). Тіки без Start або без live — idle, без Chrome. Цикл (live + Start): session `ACTIVE` + Chrome idle → FIFO `READY_TO_POST` без URL; **без peso/medidas пропускає** і бере наступний. `POSTING` / `ACTIVE` / `DEACTIVATED` / `FAILED` не бере. Watchdog: `POSTING` старший за `WALLAPOP_POSTING_STALE_MS` (default 20 хв) і Chrome не в `publish` → `READY_TO_POST` (ліміт `WALLAPOP_POSTING_MAX_ATTEMPTS`, далі `FAILED`; лог `chrome_dead` / `timeout` / `target_closed`). Інший email Wallapop на connect скидає статуси лістингів. Старт таймерів: `runStartupHooks()` у [`startup.ts`](./src/startup.ts).


Postman: імпорт `server/postman/Wallapop-CRM.postman_collection.json` + `server/postman/local.postman_environment.json`, environment **Wallapop CRM · local**, папка **Smoke** → Runner. Cookie `crm_session` після Login кладеться в jar сама.

У Cursor: `server/api.http` (розширення REST Client).

`NEXT_PUBLIC_API_URL` — лише в корневому `.env` (Next/Vercel). `PORT` default `4000` у `server/.env`.

## Ops (локальна Docker-Postgres і VPS)

Окремий CLI, не частина API/publish: `server/ops/`. Тунель SSH + дві бази.

```bash
npm run ops -- tunnel
npm run ops -- ping
npm run ops -- pull --dry-run
npm run ops -- push --sku SKU --dry-run
npm run ops -- github
npm run ops -- backup
```

`BACKUP_DIR` — дампи Postgres (`pg_dump -Fc`), не `public/uploads`. Завантаження з CRM: `/accounts`, cookie. На Windows VPS раз на добу: `powershell -File server/ops/install-backup-task.ps1`.

`DATABASE_URL_VPS` / `OPS_SSH` лише в `server/.env`. Users/seed не чіпає. Після `refresh-local` на локалі `autopost_enabled=false`. `pull` також качає файли з VPS `/uploads` у локальний `UPLOAD_DIR`. `push` після listing ще дописує на VPS фото, яких там ще немає (`PUT /api/v1/ops/uploads/:key`, логін seed). `OPS_UPLOAD_ORIGIN` якщо API не `http://<OPS_SSH host>:PORT`.

## Логи

Кожен запит (крім `/health`) і кожна помилка пишуться в **`server/logs/server.log`** і в вікно, де запущений `npm run server:start`. Паролі й cookie туди не потрапляють.

На VPS після `git pull` треба **перезапустити** процес API, інакше файл не з’явиться. Якщо файл виріс понад 5 МБ, старий зсувається в `server/logs/server.prev.log`.

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
3. Відкриває сторінку Wallapop (поки **без** автологіну). Disconnect лише від’єднує Playwright.

**Профілі (запам’ятати):** 1 Wallapop-акаунт = 1 окремий Chrome `--user-data-dir` (cookies / історія / fingerprint). Не шарити профіль між акаунтами — інакше сильний детект. Деталі й план multi-account: [API.md → Accounts → Браузерні профілі](./API.md#браузерні-профілі-обовязково--1-акаунт--1-chrome-user-data-dir).


Postman: імпорт `server/postman/Wallapop-CRM.postman_collection.json` + `server/postman/local.postman_environment.json`, environment **Wallapop CRM · local**, папка **Smoke** → Runner. Cookie `crm_session` після Login кладеться в jar сама.

У Cursor: `server/api.http` (розширення REST Client).

`NEXT_PUBLIC_API_URL` — лише в корневому `.env` (Next/Vercel). `PORT` default `4000` у `server/.env`.

## Логи

Кожен запит (крім `/health`) і кожна помилка пишуться в **`server/logs/server.log`** і в вікно, де запущений `npm run server:start`. Паролі й cookie туди не потрапляють.

На VPS після `git pull` треба **перезапустити** процес API, інакше файл не з’явиться. Якщо файл виріс понад 5 МБ, старий зсувається в `server/logs/server.prev.log`.

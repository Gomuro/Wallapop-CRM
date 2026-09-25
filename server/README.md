# server

API-процес Wallapop CRM. **Express** + TypeScript. Один git з UI (`app/`), **окремий деплой** на VPS.

- UI (Next) → Vercel
- цей процес → VPS: `npm run server:start` з **кореня** репо
- Prisma живе **тут**: `server/prisma/` (схема, міграції, seed) і клієнт `server/generated/prisma`. Next на Vercel у склад не ходить — лише HTTPS на цей API. Zod (`lib/validations/`) спільний.
- Postgres теж **тут**: `server/docker-compose.yml` (`npm run db:up` з кореня) і секрети в `server/.env` (не в корневому `.env` UI).
- Контракт: [API.md](./API.md)

```bash
npm run db:up
npm run server:dev
npm run server:smoke
```

`server:smoke` сам логіниться seed-юзером з `.env` і перевіряє health / 401 / login / me / 501 / logout.

Postman: імпорт `server/postman/Wallapop-CRM.postman_collection.json` + `server/postman/local.postman_environment.json`, environment **Wallapop CRM · local**, папка **Smoke** → Runner. Cookie `crm_session` після Login кладеться в jar сама.

У Cursor: `server/api.http` (розширення REST Client).

`NEXT_PUBLIC_API_URL` — лише в корневому `.env` (Next/Vercel). `PORT` default `4000` у `server/.env`.

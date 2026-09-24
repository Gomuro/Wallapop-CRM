# server

API-процес Wallapop CRM. Один git-репозиторій з UI (`app/`), **окремий деплой** на VPS.

- UI (Next) → Vercel
- цей процес → VPS: `npm run server:start` з **кореня** репо
- Prisma (`prisma/`) і Zod (`lib/validations/`) спільні, сюди не копіювати

Зараз: `GET /health`. CRUD `/api/v1` з’явиться після схеми (#66) і контракту (#52).

```bash
npm run server:dev
# http://localhost:4000/health
```

`PORT` (default `4000`) щоб не перетинатися з Next `:3000`.

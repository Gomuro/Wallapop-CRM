# Wallapop CRM — application

Prod code for Etap 1. Start here or evolve from `../prototype/demo-app/` when added.

**Auth (issue #46):** Operators sign in at `/login` via `POST {NEXT_PUBLIC_API_URL}/api/v1/auth/login` with `credentials: 'include'`; the API sets httpOnly `crm_session`. Protected warehouse routes use client `SessionGuard` (`GET /auth/me`) and optional Next middleware when the session cookie is on the same host. Set `NEXT_PUBLIC_API_URL` in the repo-root `.env` (see `.env.example`); on Vercel, point it at the VPS API and allow the Vercel origin in `server/.env` `CORS_ORIGIN`.

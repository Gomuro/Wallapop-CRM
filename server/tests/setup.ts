import "../load-env"

// In-process supertest over HTTP: Secure / SameSite=none cookies are not stored by the agent
process.env.COOKIE_SECURE = "false"
process.env.COOKIE_SAMESITE = "lax"

const email = process.env.SEED_USER_EMAIL
const password = process.env.SEED_USER_PASSWORD
if (!email || !password) {
  throw new Error(
    "SEED_USER_EMAIL and SEED_USER_PASSWORD must be set in server/.env (run npm run db:seed)",
  )
}

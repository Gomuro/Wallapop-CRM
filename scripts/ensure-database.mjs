import "dotenv/config"
import pg from "pg"

const url = process.env.DATABASE_URL
if (!url) {
  throw new Error("DATABASE_URL is not set")
}

const adminUrl = new URL(url)
adminUrl.pathname = "/postgres"

const dbName = new URL(url).pathname.replace(/^\//, "").split("?")[0]
if (!/^[a-zA-Z0-9_]+$/.test(dbName)) {
  throw new Error("Unsafe database name")
}

const client = new pg.Client({ connectionString: adminUrl.toString() })
await client.connect()
const existing = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [
  dbName,
])
if (existing.rowCount === 0) {
  await client.query(`CREATE DATABASE ${dbName}`)
  console.log(`created ${dbName}`)
} else {
  console.log(`exists ${dbName}`)
}
await client.end()

import { existsSync } from "node:fs"
import { resolve } from "node:path"

import { config } from "dotenv"

const fromRoot = resolve(process.cwd(), "server/.env")
const fromServer = resolve(process.cwd(), ".env")
config({ path: existsSync(fromRoot) ? fromRoot : fromServer })

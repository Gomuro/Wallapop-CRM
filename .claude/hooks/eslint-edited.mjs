// PostToolUse hook: lint only the TS file that Edit/Write just changed.
// Prints eslint output to stderr and exits 2 so the model sees it.
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join, relative, resolve } from "node:path"

const LINTED = /^(app|components|lib|server\/src)\/|^proxy\.ts$/
const SKIPPED = /^(components\/ui|lib\/generated|server\/generated)\/|\.(test|spec)\.tsx?$/

let raw = ""
for await (const chunk of process.stdin) raw += chunk
const filePath = JSON.parse(raw || "{}").tool_input?.file_path
if (typeof filePath !== "string" || !/\.tsx?$/.test(filePath)) process.exit(0)

const rel = relative(process.cwd(), resolve(filePath)).replaceAll("\\", "/")
if (!LINTED.test(rel) || SKIPPED.test(rel)) process.exit(0)

// Local eslint only: no npx (it may download), no shell (the path stays one argument), no --fix.
const ESLINT_BIN = join(process.cwd(), "node_modules", "eslint", "bin", "eslint.js")
if (!existsSync(ESLINT_BIN)) process.exit(0)
const result = spawnSync(process.execPath, [ESLINT_BIN, rel], { encoding: "utf8" })
const out = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim()
if (out) {
  process.stderr.write(`eslint ${rel}\n${out}\n`)
  process.exit(2)
}

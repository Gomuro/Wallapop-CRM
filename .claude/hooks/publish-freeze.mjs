// PreToolUse hook: blocks changes to the frozen publish code unless .publish-unlocked exists.
// Edit/Write/MultiEdit are checked by path. Bash is best effort: a command that names a
// frozen path AND looks like it writes. The agent may never create the unlock file itself:
// only the user does that, in their own terminal. See "Publish freeze" in CLAUDE.md.
import { existsSync } from "node:fs"
import { join, relative, resolve } from "node:path"

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd()
const UNLOCK_FILE = ".publish-unlocked"

const FROZEN_PATHS = [
  /^server\/src\/lib\/wallapop-publish\//,
  /^server\/src\/lib\/wallapop-autopost\//,
  /^server\/src\/routes\/product-publish-[^/]*\.ts$/,
  /^server\/tests\/wallapop-publish[^/]*\.test\.ts$/,
  /^server\/tests\/wallapop-autopost[^/]*\.test\.ts$/,
  /^server\/tests\/category-menu\.test\.ts$/,
  /^server\/tests\/fixtures\/wallapop-(envio-form|marca-form|tsl-catalog-item)\.html$/,
]

// Substrings that put a Bash command in scope (kept loose on purpose).
const FROZEN_HINTS = [
  "wallapop-publish/",
  "wallapop-autopost/",
  "product-publish-",
  "wallapop-publish.test",
  "wallapop-autopost.test",
  "category-menu.test",
  "wallapop-envio-form",
  "wallapop-marca-form",
  "wallapop-tsl-catalog-item",
]

const WRITE_VERBS =
  /\b(sed|perl)\b[^|;&\n]*\s-[a-zA-Z]*i|\b(tee|mv|cp|rm|touch|truncate|install|patch|ln)\b|\bgit\s+(checkout|restore|apply|stash|reset|clean|rm|mv|am|cherry-pick|revert)\b|writeFile|write_text|open\([^)]*['"][wa]|Set-Content|Add-Content|Out-File|Remove-Item|Move-Item|Copy-Item|New-Item/

function isFrozenPath(filePath) {
  const rel = relative(ROOT, resolve(ROOT, filePath)).replaceAll("\\", "/")
  return FROZEN_PATHS.some((pattern) => pattern.test(rel))
}

function bashWritesFrozen(command) {
  if (!FROZEN_HINTS.some((hint) => command.includes(hint))) return false
  const withoutSafeRedirects = command.replace(/\d?>\s*&\d|\d?>\s*\/dev\/null|2>&1/g, " ")
  return WRITE_VERBS.test(withoutSafeRedirects) || /(^|[^-<\d])>>?\s*\S/.test(withoutSafeRedirects)
}

// Verbs that can create or fill a file. rm/del are deliberately absent: removing the lock is safe.
const CREATE_VERBS =
  /\b(touch|tee|cp|copy|mv|move|install|ln|ni|sc|New-Item|Set-Content|Add-Content|Out-File|Copy-Item|Move-Item|fsutil|WriteAll\w*|writeFile\w*|write_text|Create\w*)\b|open\([^)]*['"][wa]/i

function bashCreatesLock(command) {
  if (!command.includes("publish-unlocked")) return false
  const plain = command.replace(/\d?>\s*&\d|\d?>\s*\/dev\/null|2>&1/g, " ")
  return CREATE_VERBS.test(plain) || /(^|[^-<\d])>>?\s*\S/.test(plain)
}

function isLockPath(filePath) {
  return resolve(ROOT, filePath).replaceAll("\\", "/").endsWith("/" + UNLOCK_FILE)
}

function blockedLock() {
  process.stderr.write(
    `[publish-freeze] агент не створює ${UNLOCK_FILE}.\n` +
      `Розморозити може лише користувач: створи ${UNLOCK_FILE} сам у терміналі.\n`,
  )
  process.exit(2)
}

function blocked(target) {
  process.stderr.write(
    `[publish-freeze] publish заморожено, не чіпаю: ${target}\n` +
      `Розморозити може лише користувач: створи ${UNLOCK_FILE} сам у терміналі (або скажи «розморозь publish»).\n` +
      `Після роботи видали ${UNLOCK_FILE}. Правила: розділ «Publish freeze» у CLAUDE.md.\n`,
  )
  process.exit(2)
}

let raw = ""
for await (const chunk of process.stdin) raw += chunk
const input = JSON.parse(raw || "{}")
const tool = input.tool_name
const args = input.tool_input ?? {}

// Checked even when unlocked: the agent never writes the unlock file.
if (["Edit", "Write", "MultiEdit"].includes(tool) && typeof args.file_path === "string") {
  if (isLockPath(args.file_path)) blockedLock()
}
if (tool === "Bash" && typeof args.command === "string" && bashCreatesLock(args.command)) {
  blockedLock()
}

if (existsSync(join(ROOT, UNLOCK_FILE))) process.exit(0)
if (["Edit", "Write", "MultiEdit"].includes(tool)) {
  if (typeof args.file_path === "string" && isFrozenPath(args.file_path)) blocked(args.file_path)
} else if (tool === "Bash" && typeof args.command === "string" && bashWritesFrozen(args.command)) {
  blocked("команда Bash пише в заморожений шлях")
}

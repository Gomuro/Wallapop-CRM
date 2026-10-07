import { dirname, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(PLUGIN_DIR, "../..")

export function toPosix(filePath) {
  return filePath.replaceAll("\\", "/")
}

export function repoRelative(absPath) {
  return toPosix(relative(REPO_ROOT, absPath))
}

export function option(context, key, fallback) {
  return context.options[0]?.[key] ?? fallback
}

export function functionName(node) {
  if (node.id?.name) return node.id.name

  const parent = node.parent
  if (!parent) return "(anonymous)"

  if (parent.type === "VariableDeclarator" && parent.id?.type === "Identifier") {
    return parent.id.name
  }
  if (
    (parent.type === "MethodDefinition" ||
      parent.type === "PropertyDefinition" ||
      parent.type === "Property") &&
    parent.key?.type === "Identifier"
  ) {
    return parent.key.name
  }
  if (
    parent.type === "AssignmentExpression" &&
    parent.left?.type === "Identifier"
  ) {
    return parent.left.name
  }
  return "(anonymous)"
}

export function countSignificantLines(sourceCode, node) {
  if (!node.loc) return 0

  const start = node.loc.start.line
  const end = node.loc.end.line
  const commentLines = new Set()

  for (const comment of sourceCode.getCommentsInside(node)) {
    if (!comment.loc) continue
    for (let line = comment.loc.start.line; line <= comment.loc.end.line; line++) {
      commentLines.add(line)
    }
  }

  const lines = sourceCode.getLines()
  let count = 0
  for (let line = start; line <= end; line++) {
    if (commentLines.has(line)) continue
    const text = lines[line - 1] ?? ""
    if (text.trim() === "") continue
    count += 1
  }
  return count
}

export function isElseIf(node) {
  return node.parent?.type === "IfStatement" && node.parent.alternate === node
}

export function resolveImportedSpecifier(fromFile, source) {
  if (source.startsWith("@/")) {
    return source.slice(2)
  }
  if (source.startsWith(".")) {
    return repoRelative(resolve(dirname(fromFile), source))
  }
  return source
}

export function isUiLayer(repoPath) {
  return (
    repoPath.startsWith("app/") ||
    repoPath.startsWith("components/") ||
    repoPath === "middleware.ts"
  )
}

export function isNextLib(repoPath) {
  return repoPath.startsWith("lib/")
}

export function isServerImpl(imported) {
  return (
    imported.startsWith("server/src/") ||
    imported.startsWith("server/generated/") ||
    imported === "server" ||
    imported.startsWith("server/")
  )
}

export function isPrismaPackage(imported) {
  return (
    imported === "@prisma/client" ||
    imported.startsWith("@prisma/") ||
    imported.includes("generated/prisma")
  )
}

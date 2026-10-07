import {
  isNextLib,
  isPrismaPackage,
  isServerImpl,
  isUiLayer,
  repoRelative,
  resolveImportedSpecifier,
  toPosix,
} from "./helpers.mjs"

function currentRepoPath(context) {
  const file = context.filename || context.physicalFilename
  return repoRelative(file)
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "D — Dependency Inversion: depend on abstractions, not concretions",
    },
    schema: [],
    messages: {
      uiImportsServer:
        "D (DIP): UI-шар імпортує server ({{source}}). Залеж від API/типів, не від Express-реалізації.",
      libImportsServer:
        "D (DIP): lib/ імпортує server ({{source}}). Спільний код не повинен знати про Express/Prisma runtime.",
      clientImportsPrisma:
        "D (DIP): клієнтський шар імпортує Prisma ({{source}}). БД — деталь server/, не Next-шару.",
      prismaClientNew:
        "D (DIP): PrismaClient створюється поза server/src/lib/db.ts. Інвертуй залежність через getPrisma().",
      nextImportsPlaywright:
        "D (DIP): Next-шар імпортує Playwright ({{source}}). Браузерна автоматизація — деталь server/.",
      nextImportsExpress:
        "D (DIP): Next-шар імпортує Express ({{source}}). HTTP-сервер — деталь server/.",
    },
  },

  create(context) {
    const repoPath = toPosix(currentRepoPath(context))
    const ui = isUiLayer(repoPath)
    const nextLib = isNextLib(repoPath)
    const clientLayer = ui || nextLib

    return {
      ImportDeclaration(node) {
        const source = node.source.value
        if (typeof source !== "string") return

        const imported = resolveImportedSpecifier(
          context.filename || context.physicalFilename,
          source,
        )

        if (ui && isServerImpl(imported)) {
          context.report({
            node: node.source,
            messageId: "uiImportsServer",
            data: { source },
          })
        } else if (nextLib && isServerImpl(imported)) {
          context.report({
            node: node.source,
            messageId: "libImportsServer",
            data: { source },
          })
        }

        if (clientLayer && isPrismaPackage(imported)) {
          context.report({
            node: node.source,
            messageId: "clientImportsPrisma",
            data: { source },
          })
        }

        if (clientLayer && (imported === "playwright" || imported.startsWith("playwright/"))) {
          context.report({
            node: node.source,
            messageId: "nextImportsPlaywright",
            data: { source },
          })
        }

        if (clientLayer && (imported === "express" || imported.startsWith("express/"))) {
          context.report({
            node: node.source,
            messageId: "nextImportsExpress",
            data: { source },
          })
        }
      },

      NewExpression(node) {
        if (node.callee?.type !== "Identifier") return
        if (node.callee.name !== "PrismaClient") return
        if (toPosix(repoPath) === "server/src/lib/db.ts") return
        context.report({ node, messageId: "prismaClientNew" })
      },
    }
  },
}

export default rule

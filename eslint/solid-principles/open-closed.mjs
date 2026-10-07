import { option } from "./helpers.mjs"

function discriminantKey(sourceCode, test) {
  if (!test) return null

  if (test.type === "BinaryExpression" && test.operator === "instanceof") {
    return `instanceof:${sourceCode.getText(test.left)}`
  }

  if (
    test.type === "BinaryExpression" &&
    ["==", "===", "!=", "!=="].includes(test.operator)
  ) {
    if (
      test.left.type === "UnaryExpression" &&
      test.left.operator === "typeof"
    ) {
      return `typeof:${sourceCode.getText(test.left.argument)}`
    }
    if (test.left.type === "Identifier") {
      return `id:${test.left.name}`
    }
    if (
      test.left.type === "MemberExpression" &&
      !test.left.computed &&
      test.left.property.type === "Identifier"
    ) {
      return `mem:${sourceCode.getText(test.left)}`
    }
  }

  return null
}

function isElseIf(node) {
  return node.parent?.type === "IfStatement" && node.parent.alternate === node
}

function chainLength(node) {
  let count = 1
  let current = node
  while (current.alternate?.type === "IfStatement") {
    count += 1
    current = current.alternate
  }
  if (current.alternate) count += 1
  return count
}

const rule = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "O — Open/Closed: open for extension, closed for modification",
    },
    schema: [
      {
        type: "object",
        properties: {
          minSwitchCases: { type: "integer", minimum: 2 },
          minIfElseChain: { type: "integer", minimum: 2 },
          minInstanceofChain: { type: "integer", minimum: 2 },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      longSwitch:
        "O (OCP): switch з {{count}} гілками. Нові варіанти змусять правити цей код — краще мапа або стратегія.",
      ifElseChain:
        "O (OCP): ланцюжок if/else ({{count}} гілок) на тому самому значенні. Закрий модифікацію, відкрий розширення (мапа/поліморфізм).",
      instanceofChain:
        "O (OCP): ланцюжок instanceof ({{count}}). Додавання типу змінить цей блок — використай поліморфізм.",
    },
  },

  create(context) {
    const sourceCode = context.sourceCode
    const minSwitchCases = option(context, "minSwitchCases", 5)
    const minIfElseChain = option(context, "minIfElseChain", 4)
    const minInstanceofChain = option(context, "minInstanceofChain", 3)

    return {
      SwitchStatement(node) {
        const cases = node.cases.filter((c) => c.test != null)
        if (cases.length >= minSwitchCases) {
          context.report({
            node,
            messageId: "longSwitch",
            data: { count: String(cases.length) },
          })
        }
      },

      IfStatement(node) {
        if (isElseIf(node)) return
        if (node.alternate?.type !== "IfStatement") return

        const key = discriminantKey(sourceCode, node.test)
        if (!key) return

        let current = node.alternate
        let same = 1
        let instanceofCount = key.startsWith("instanceof:") ? 1 : 0

        while (current?.type === "IfStatement") {
          const nextKey = discriminantKey(sourceCode, current.test)
          if (nextKey !== key) break
          same += 1
          if (nextKey.startsWith("instanceof:")) instanceofCount += 1
          current = current.alternate?.type === "IfStatement" ? current.alternate : null
        }

        const total = chainLength(node)

        if (instanceofCount >= minInstanceofChain) {
          context.report({
            node,
            messageId: "instanceofChain",
            data: { count: String(instanceofCount) },
          })
          return
        }

        if (same >= minIfElseChain && total >= minIfElseChain) {
          context.report({
            node,
            messageId: "ifElseChain",
            data: { count: String(same) },
          })
        }
      },
    }
  },
}

export default rule

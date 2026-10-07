import { functionName } from "./helpers.mjs"

function isAssertNever(node) {
  const name = functionName(node)
  return /^(assertNever|exhaustive|unreachable|assertUnreachable)$/i.test(name)
}

function methodName(fn) {
  if (
    fn.parent?.type === "MethodDefinition" &&
    fn.parent.key?.type === "Identifier"
  ) {
    return fn.parent.key.name
  }
  return functionName(fn)
}

function isClassMethod(node) {
  return node.parent?.type === "MethodDefinition"
}

function isConstructor(node) {
  return node.parent?.type === "MethodDefinition" && node.parent.kind === "constructor"
}

function blockStatements(body) {
  if (!body || body.type !== "BlockStatement") return []
  return body.body ?? []
}

const rule = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "L — Liskov Substitution: subtypes must honor the base contract",
    },
    schema: [],
    messages: {
      throwOnly:
        "L (LSP): метод «{{name}}» лише кидає помилку. Підклас не може замінити базовий тип.",
      emptyMethod:
        "L (LSP): порожній метод «{{name}}». Порушує очікувану поведінку контракту.",
    },
  },

  create(context) {
    function checkFn(node) {
      if (!isClassMethod(node) || isConstructor(node) || isAssertNever(node)) {
        return
      }
      if (!node.body || node.body.type !== "BlockStatement") return

      const name = methodName(node)
      const statements = blockStatements(node.body)

      if (statements.length === 0) {
        context.report({
          node,
          messageId: "emptyMethod",
          data: { name },
        })
        return
      }

      if (
        statements.length === 1 &&
        statements[0].type === "ThrowStatement"
      ) {
        context.report({
          node,
          messageId: "throwOnly",
          data: { name },
        })
      }
    }

    return {
      FunctionExpression: checkFn,
      ArrowFunctionExpression: checkFn,
    }
  },
}

export default rule

import {
  countSignificantLines,
  functionName,
  isElseIf,
  option,
} from "./helpers.mjs"

const NEST_TYPES = new Set([
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
  "SwitchStatement",
  "CatchClause",
])

function isNestNode(node) {
  if (NEST_TYPES.has(node.type)) return true
  return node.type === "IfStatement" && !isElseIf(node)
}

function isComplexityNode(node) {
  switch (node.type) {
    case "IfStatement":
    case "ForStatement":
    case "ForInStatement":
    case "ForOfStatement":
    case "WhileStatement":
    case "DoWhileStatement":
    case "CatchClause":
    case "ConditionalExpression":
      return true
    case "LogicalExpression":
      return node.operator === "&&" || node.operator === "||"
    case "SwitchCase":
      return node.test != null
    default:
      return false
  }
}

const rule = {
  meta: {
    type: "suggestion",
    docs: {
      description: "S — Single Responsibility: one unit, one reason to change",
    },
    schema: [
      {
        type: "object",
        properties: {
          maxFunctionLines: { type: "integer", minimum: 1 },
          maxFileLines: { type: "integer", minimum: 1 },
          maxComplexity: { type: "integer", minimum: 1 },
          maxClassMethods: { type: "integer", minimum: 1 },
          maxDepth: { type: "integer", minimum: 1 },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      tooLongFn:
        "S (SRP): функція «{{name}}» має {{count}} рядків (макс. {{max}}). Одна функція — одна відповідальність; розбий її.",
      tooLongFile:
        "S (SRP): файл має {{count}} рядків (макс. {{max}}). Модуль робить занадто багато — винеси частини.",
      tooManyMethods:
        "S (SRP): клас «{{name}}» має {{count}} методів (макс. {{max}}). God object — розділи відповідальності.",
      tooComplex:
        "S (SRP): цикломатична складність «{{name}}» = {{count}} (макс. {{max}}). Спрости умови або винеси гілки.",
      tooDeep:
        "S (SRP): вкладеність у «{{name}}» = {{count}} (макс. {{max}}). Винеси вкладені блоки в окремі функції.",
    },
  },

  create(context) {
    const sourceCode = context.sourceCode
    const maxFunctionLines = option(context, "maxFunctionLines", 40)
    const maxFileLines = option(context, "maxFileLines", 300)
    const maxComplexity = option(context, "maxComplexity", 12)
    const maxClassMethods = option(context, "maxClassMethods", 10)
    const maxDepth = option(context, "maxDepth", 3)
    const frames = []

    function enterFn(node) {
      if (!node.body) return
      frames.push({ node, complexity: 1, depth: 0, maxDepth: 0 })
    }

    function leaveFn(node) {
      if (!node.body) return
      const frame = frames.pop()
      if (!frame) return

      const name = functionName(node)
      const lines = countSignificantLines(sourceCode, node)

      if (lines > maxFunctionLines) {
        context.report({
          node,
          messageId: "tooLongFn",
          data: { name, count: String(lines), max: String(maxFunctionLines) },
        })
      }
      if (frame.complexity > maxComplexity) {
        context.report({
          node,
          messageId: "tooComplex",
          data: {
            name,
            count: String(frame.complexity),
            max: String(maxComplexity),
          },
        })
      }
      if (frame.maxDepth > maxDepth) {
        context.report({
          node,
          messageId: "tooDeep",
          data: {
            name,
            count: String(frame.maxDepth),
            max: String(maxDepth),
          },
        })
      }
    }

    function onNode(node) {
      const frame = frames.at(-1)
      if (!frame) return
      if (isComplexityNode(node)) frame.complexity += 1
      if (isNestNode(node)) {
        frame.depth += 1
        if (frame.depth > frame.maxDepth) frame.maxDepth = frame.depth
      }
    }

    function onNodeExit(node) {
      const frame = frames.at(-1)
      if (!frame) return
      if (isNestNode(node) && frame.depth > 0) frame.depth -= 1
    }

    return {
      FunctionDeclaration: enterFn,
      "FunctionDeclaration:exit": leaveFn,
      FunctionExpression: enterFn,
      "FunctionExpression:exit": leaveFn,
      ArrowFunctionExpression: enterFn,
      "ArrowFunctionExpression:exit": leaveFn,

      IfStatement: onNode,
      "IfStatement:exit": onNodeExit,
      ForStatement: onNode,
      "ForStatement:exit": onNodeExit,
      ForInStatement: onNode,
      "ForInStatement:exit": onNodeExit,
      ForOfStatement: onNode,
      "ForOfStatement:exit": onNodeExit,
      WhileStatement: onNode,
      "WhileStatement:exit": onNodeExit,
      DoWhileStatement: onNode,
      "DoWhileStatement:exit": onNodeExit,
      SwitchStatement: onNode,
      "SwitchStatement:exit": onNodeExit,
      CatchClause: onNode,
      "CatchClause:exit": onNodeExit,
      ConditionalExpression: onNode,
      LogicalExpression: onNode,
      SwitchCase: onNode,

      ClassDeclaration(node) {
        const body = node.body?.body
        if (!Array.isArray(body)) return
        const methods = body.filter(
          (member) =>
            member.type === "MethodDefinition" ||
            (member.type === "PropertyDefinition" &&
              (member.value?.type === "FunctionExpression" ||
                member.value?.type === "ArrowFunctionExpression")),
        )
        if (methods.length > maxClassMethods) {
          context.report({
            node: node.id ?? node,
            messageId: "tooManyMethods",
            data: {
              name: node.id?.name ?? "(anonymous)",
              count: String(methods.length),
              max: String(maxClassMethods),
            },
          })
        }
      },

      "Program:exit"(node) {
        const lines = countSignificantLines(sourceCode, node)
        if (lines > maxFileLines) {
          context.report({
            node,
            loc: node.loc?.start ?? { line: 1, column: 0 },
            messageId: "tooLongFile",
            data: { count: String(lines), max: String(maxFileLines) },
          })
        }
      },
    }
  },
}

export default rule

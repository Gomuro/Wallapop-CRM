import { functionName, option } from "./helpers.mjs"

function paramCount(params) {
  return params.filter((p) => p.type !== "RestElement").length
}

function typeLiteralMembers(node) {
  if (node?.type !== "TSTypeLiteral") return []
  return node.members ?? []
}

function interfaceName(node) {
  return node.id?.name ?? "(anonymous)"
}

function isFatAllowedName(name) {
  return /(?:Props|Options|Config|Context)$/.test(name)
}

const rule = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "I — Interface Segregation: clients must not depend on unused surface",
    },
    schema: [
      {
        type: "object",
        properties: {
          maxParams: { type: "integer", minimum: 1 },
          maxInterfaceMembers: { type: "integer", minimum: 1 },
          maxPropsMembers: { type: "integer", minimum: 1 },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      tooManyParams:
        "I (ISP): «{{name}}» має {{count}} параметрів (макс. {{max}}). Розбий контракт або збери аргументи в один об’єкт.",
      fatInterface:
        "I (ISP): тип «{{name}}» має {{count}} полів (макс. {{max}}). Клієнти залежать від зайвого — розділи інтерфейс.",
    },
  },

  create(context) {
    const maxParams = option(context, "maxParams", 4)
    const maxInterfaceMembers = option(context, "maxInterfaceMembers", 10)
    const maxPropsMembers = option(context, "maxPropsMembers", 16)

    function checkParams(node) {
      if (!node.params) return
      const count = paramCount(node.params)
      if (count > maxParams) {
        context.report({
          node,
          messageId: "tooManyParams",
          data: {
            name: functionName(node),
            count: String(count),
            max: String(maxParams),
          },
        })
      }
    }

    return {
      FunctionDeclaration: checkParams,
      FunctionExpression: checkParams,
      ArrowFunctionExpression: checkParams,
      TSDeclareFunction: checkParams,

      TSInterfaceDeclaration(node) {
        const count = node.body?.body?.length ?? 0
        const name = interfaceName(node)
        const max = isFatAllowedName(name) ? maxPropsMembers : maxInterfaceMembers
        if (count > max) {
          context.report({
            node: node.id ?? node,
            messageId: "fatInterface",
            data: { name, count: String(count), max: String(max) },
          })
        }
      },

      TSTypeAliasDeclaration(node) {
        const members = typeLiteralMembers(node.typeAnnotation)
        if (members.length === 0) return
        const name = interfaceName(node)
        const max = isFatAllowedName(name) ? maxPropsMembers : maxInterfaceMembers
        if (members.length > max) {
          context.report({
            node: node.id ?? node,
            messageId: "fatInterface",
            data: {
              name,
              count: String(members.length),
              max: String(max),
            },
          })
        }
      },
    }
  },
}

export default rule

import type { Express } from "express"
import sharp from "sharp"
import request from "supertest"

export type Json = Record<string, unknown>

export function seedCredentials() {
  const email = process.env.SEED_USER_EMAIL
  const password = process.env.SEED_USER_PASSWORD
  if (!email || !password) {
    throw new Error("SEED_USER_EMAIL / SEED_USER_PASSWORD missing")
  }
  return { email, password }
}

export function errorCode(body: unknown) {
  if (typeof body !== "object" || body === null) return undefined
  const error = (body as Json).error as { code?: string } | undefined
  return error?.code
}

export function authedAgent(app: Express) {
  return request.agent(app)
}

export async function login(
  app: Express,
  email: string,
  password: string,
) {
  const agent = authedAgent(app)
  const res = await agent
    .post("/api/v1/auth/login")
    .send({ email, password })
  return { agent, res }
}

type CategoryRow = { id: string; isLeaf: boolean }

export async function findLeafCategoryId(agent: request.Agent) {
  let parentId = "root"
  for (let depth = 0; depth < 12; depth += 1) {
    const res = await agent.get(
      `/api/v1/categories?parentId=${encodeURIComponent(parentId)}`,
    )
    if (res.status !== 200) {
      throw new Error(`categories walk failed: ${res.status} ${JSON.stringify(res.body)}`)
    }
    const categories = res.body.categories as CategoryRow[] | undefined
    if (!Array.isArray(categories) || categories.length === 0) {
      throw new Error("no categories in tree — run npm run db:seed")
    }
    const leaf = categories.find((row) => row.isLeaf)
    if (leaf) return leaf.id
    parentId = categories[0].id
  }
  throw new Error("could not find leaf category")
}

export async function tinyPngBuffer() {
  return sharp({
    create: {
      width: 2,
      height: 2,
      channels: 3,
      background: { r: 20, g: 120, b: 200 },
    },
  })
    .png()
    .toBuffer()
}

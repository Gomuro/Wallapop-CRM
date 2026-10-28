import { parseGroqJsonObject } from "./groq-chat-json"
import { log } from "./log"

/** Pinned, not the "~latest" alias, so the model never changes under us. */
export const OPENROUTER_MODEL = "anthropic/claude-haiku-5.5"
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions"
const TIMEOUT_MS = 60_000

export type OpenRouterOptions = {
  temperature?: number
  /** Rewriting text needs little thinking. */
  reasoningEffort?: "low" | "medium" | "high"
}

type OpenRouterBody = {
  error?: { message?: string }
  choices?: { message?: { content?: string } }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number }
}

/** One call, no retry: the caller falls back to Groq when this throws. */
export async function openRouterChatJson(
  system: string,
  user: string,
  options: OpenRouterOptions = {},
): Promise<Record<string, unknown>> {
  const key = process.env.OPENROUTER_API_KEY?.trim()
  if (!key) throw new Error("OPENROUTER_API_KEY is not set")
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      temperature: options.temperature ?? 0.7,
      reasoning: { effort: options.reasoningEffort ?? "low" },
      response_format: { type: "json_object" },
      usage: { include: true },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const body = (await res.json().catch(() => ({}))) as OpenRouterBody
  if (!res.ok) throw new Error(body.error?.message || `OpenRouter HTTP ${res.status}`)
  log("info", "openrouter_usage", {
    model: OPENROUTER_MODEL,
    promptTokens: body.usage?.prompt_tokens ?? null,
    completionTokens: body.usage?.completion_tokens ?? null,
    costUsd: body.usage?.cost ?? null,
  })
  const text = body.choices?.[0]?.message?.content?.trim()
  if (!text) throw new Error("OpenRouter returned empty text")
  return parseGroqJsonObject(text)
}

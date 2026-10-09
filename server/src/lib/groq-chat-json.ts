export const GROQ_MODEL = "qwen/qwen3.8-27b"

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function parseGroqJsonObject(text: string): Record<string, unknown> {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/u, "")
    .trim()
  const parsed: unknown = JSON.parse(trimmed)
  return asRecord(parsed) ?? {}
}

export async function groqChatJson(
  system: string,
  user: string,
): Promise<Record<string, unknown>> {
  const key = process.env.GROQ_API_KEY?.trim()
  if (!key) throw new Error("GROQ_API_KEY is not set")
  let last = "Groq failed"
  for (let attempt = 0; attempt < 6; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt))
    }
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    })
    const body = (await res.json()) as {
      error?: { message?: string }
      choices?: { message?: { content?: string } }[]
    }
    if (!res.ok) {
      last = body.error?.message || `Groq HTTP ${res.status}`
      if (res.status === 429 || /try again|unavailable|rate/i.test(last)) {
        continue
      }
      throw new Error(last)
    }
    const text = body.choices?.[0]?.message?.content?.trim()
    if (!text) {
      last = "Groq returned empty text"
      continue
    }
    try {
      return parseGroqJsonObject(text)
    } catch {
      last = "Groq returned invalid JSON"
    }
  }
  throw new Error(last)
}

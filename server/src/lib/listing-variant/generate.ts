import { groqChatJson } from "../groq-chat-json"
import { log } from "../log"
import { VARIANT_SYSTEM_PROMPT, variantUserPrompt } from "./prompt"
import { variantProblems, type VariantSource, type VariantText } from "./validate"

/** First try plus two corrections that quote the validator's complaints. */
const ATTEMPTS = 3
const TEMPERATURE = 0.7

export type VariantResult =
  | { ok: true; text: VariantText; attempts: number }
  | { ok: false; error: string; attempts: number }

export type AskModel = (system: string, user: string) => Promise<Record<string, unknown>>

const askGroq: AskModel = (system, user) =>
  groqChatJson(system, user, { temperature: TEMPERATURE })

let askOverride: AskModel | null = null

/** Tests only: replace the model call. Pass null to restore Groq. */
export function setVariantModelForTests(ask: AskModel | null): void {
  askOverride = ask
}

function asText(reply: Record<string, unknown>): VariantText {
  return {
    title: typeof reply.title === "string" ? reply.title.trim() : "",
    description: typeof reply.description === "string" ? reply.description.trim() : "",
  }
}

async function askOnce(
  ask: AskModel,
  source: VariantSource,
  problems: string[],
): Promise<{ text: VariantText | null; problems: string[] }> {
  try {
    const text = asText(await ask(VARIANT_SYSTEM_PROMPT, variantUserPrompt(source, problems)))
    return { text, problems: variantProblems(source, text) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { text: null, problems: [`La IA no respondió: ${message}`] }
  }
}

/** Never returns the original wording: on failure the caller must not publish a duplicate. */
export async function generateVariantText(source: VariantSource): Promise<VariantResult> {
  const ask = askOverride ?? askGroq
  let problems: string[] = []
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const result = await askOnce(ask, source, problems)
    if (result.text && result.problems.length === 0) {
      return { ok: true, text: result.text, attempts: attempt }
    }
    problems = result.problems
    log("info", "listing_variant_rejected", { attempt, problems })
    // groqChatJson already retried the transport; a second round only adds wait.
    if (!result.text) return { ok: false, error: problems.join(" "), attempts: attempt }
  }
  return { ok: false, error: problems.join(" "), attempts: ATTEMPTS }
}

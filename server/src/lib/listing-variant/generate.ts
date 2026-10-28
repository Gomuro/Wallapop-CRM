import { groqChatJson } from "../groq-chat-json"
import { log } from "../log"
import { openRouterChatJson } from "../openrouter-chat-json"
import { VARIANT_SYSTEM_PROMPT, variantUserPrompt } from "./prompt"
import { variantProblems, type VariantSource, type VariantText } from "./validate"

/** First try plus two corrections that quote the validator's complaints. */
const ATTEMPTS = 3
const TEMPERATURE = 0.7

export type VariantResult =
  | { ok: true; text: VariantText; attempts: number }
  | { ok: false; error: string; attempts: number }

export type AskModel = (system: string, user: string) => Promise<Record<string, unknown>>

/** Claude Haiku on OpenRouter first; Groq only when OpenRouter does not answer. */
const askModels: AskModel = async (system, user) => {
  try {
    return await openRouterChatJson(system, user, { temperature: TEMPERATURE, reasoningEffort: "low" })
  } catch (error) {
    log("warn", "listing_variant_openrouter_failed", {
      message: error instanceof Error ? error.message : String(error),
    })
    return groqChatJson(system, user, { temperature: TEMPERATURE })
  }
}

let askOverride: AskModel | null = null

/** Tests only: replace the model call. Pass null to restore OpenRouter + Groq. */
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

/** Never returns the original wording: on failure the duplicate keeps waiting (PREPARING). */
export async function generateVariantText(source: VariantSource): Promise<VariantResult> {
  const ask = askOverride ?? askModels
  let problems: string[] = []
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const result = await askOnce(ask, source, problems)
    if (result.text && result.problems.length === 0) {
      return { ok: true, text: result.text, attempts: attempt }
    }
    problems = result.problems
    log("info", "listing_variant_rejected", { attempt, problems })
    // Both models were tried for this round; the background retry comes back later.
    if (!result.text) return { ok: false, error: problems.join(" "), attempts: attempt }
  }
  return { ok: false, error: problems.join(" "), attempts: ATTEMPTS }
}

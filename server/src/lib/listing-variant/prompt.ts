import { VARIANT_TITLE_MAX, type VariantSource } from "./validate"

export const VARIANT_SYSTEM_PROMPT = [
  "Eres redactor de anuncios de segunda mano para Wallapop (España).",
  "Reescribe el título y la descripción de un anuncio con OTRAS palabras, en español de España,",
  "para publicar el mismo producto en otra cuenta. El comprador debe recibir la misma información.",
  "Reglas:",
  "- Ortografía correcta con todas las tildes (á, é, í, ó, ú, ñ).",
  `- Título: máximo ${VARIANT_TITLE_MAX} caracteres, distinto del original, sin emojis ni mayúsculas sostenidas.`,
  "- Conserva TODOS los datos: cada cifra con su unidad (medidas, capacidad, peso, potencia, cantidades),",
  "  la marca, el modelo, el material, el color y el estado. No los cambies ni los redondees.",
  "- No inventes nada: ninguna cifra, característica, accesorio, garantía o condición que no esté en el original.",
  "- No menciones el precio.",
  "- La descripción: misma información, otro orden y otras frases; longitud parecida a la original.",
  "- Mantén los saltos de línea si ayudan a leer.",
  'Responde SOLO con JSON: {"title": "...", "description": "..."}',
].join("\n")

export function variantUserPrompt(source: VariantSource, problems: string[] = []): string {
  const parts = [
    `Marca: ${source.brand?.trim() || "(sin marca)"}`,
    `Título original: ${source.title}`,
    "Descripción original:",
    source.description,
  ]
  if (problems.length) {
    parts.push(
      "",
      "Tu intento anterior no sirvió por estos motivos. Corrígelos:",
      ...problems.map((problem) => `- ${problem}`),
    )
  }
  return parts.join("\n")
}

import type { AppliedPhoto, UniquifiedPhotos } from "./run"
import type { ShootLook } from "./shoot"

const EOL = "\r\n"

function signed(value: number, digits: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`
}

function share(px: number, side: number): string {
  return `${((px / side) * 100).toFixed(1)} %`
}

function colourLine(look: ShootLook): string {
  if (look.style === "duplicate") return "Color: sin cambios (tono y saturación originales)."
  const { saturation, hue } = look.grade
  return `Color: saturación ${signed((saturation - 1) * 100, 2)} %, tono ${signed(hue, 2)}°.`
}

function headerLines(look: ShootLook): string[] {
  const { profile, grade } = look
  return [
    "Cambios en las fotos que se suben a Wallapop",
    `Cámara en EXIF: ${profile.make} ${profile.model} (${profile.label})`,
    colourLine(look),
    `Brillo ${signed(grade.brightness * 100, 2)} %, contraste ${signed((grade.contrast - 1) * 100, 2)} %, ruido nivel ${grade.noise}.`,
    "Orden de las fotos: el mismo que en el CRM.",
    "Giro: + es sentido horario. Tras el giro se recorta, sin esquinas vacías; la foto vuelve a su tamaño.",
    "",
  ]
}

function photoLine(photo: AppliedPhoto, index: number): string {
  const { crop, width, height } = photo
  const name = `${String(index + 1).padStart(2, "0")}.jpg`
  const turn = photo.degrees === 0 ? "sin giro" : `giro ${signed(photo.degrees, 2)}°`
  const cut =
    `recorte izq ${crop.left} px, der ${crop.right} px, arriba ${crop.top} px, abajo ${crop.bottom} px` +
    ` (hasta ${share(Math.max(crop.left, crop.right), width)} ancho, ${share(Math.max(crop.top, crop.bottom), height)} alto por lado)`
  return `${name} | original ${photo.source} ${width}x${height} | ${cut} | ${turn}`
}

/** Plain-text report of what the publish photos got, one line per photo in upload order. */
export function describePhotos(photos: Pick<UniquifiedPhotos, "look" | "applied">): string {
  const lines = [...headerLines(photos.look), ...photos.applied.map(photoLine)]
  return lines.join(EOL) + EOL
}

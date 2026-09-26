const MAX_EDGE = 1400
const TARGET_MAX_BYTES = 350 * 1024
const SKIP_WEBP_UNDER_BYTES = 500 * 1024

const WEBP_QUALITIES = [0.82, 0.72, 0.60, 0.45]
const JPEG_QUALITIES = [0.82, 0.72, 0.60, 0.45]

export function isHeicFile(file: File | Blob, name?: string): boolean {
  const type = (file.type || "").toLowerCase()
  if (type === "image/heic" || type === "image/heif") return true
  const filename = name || (file instanceof File ? file.name : "")
  return /\.(heic|heif)$/i.test(filename)
}

export function isSafariOrIos(): boolean {
  if (typeof navigator === "undefined") return false
  const ua = navigator.userAgent
  const isIos =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  const isSafari =
    /^((?!chrome|android).)*safari/i.test(ua) ||
    (/AppleWebKit/.test(ua) && !/Chrome|CriOS|Android/.test(ua))
  return isIos || isSafari
}

export function outputName(
  file: File,
  mimeType: "image/jpeg" | "image/webp" = "image/jpeg",
): string {
  const base = file.name.replace(/\.[^.]+$/, "") || "photo"
  const ext = mimeType === "image/webp" ? ".webp" : ".jpg"
  return `${base}${ext}`
}

export function fitSize(width: number, height: number): { width: number; height: number } {
  const edge = Math.max(width, height)
  if (edge <= MAX_EDGE) return { width, height }
  const scale = MAX_EDGE / edge
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function canvasToBlob(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  type: "image/jpeg" | "image/webp",
  quality: number,
): Promise<Blob | null> {
  if (
    typeof OffscreenCanvas !== "undefined" &&
    canvas instanceof OffscreenCanvas &&
    typeof canvas.convertToBlob === "function"
  ) {
    return canvas.convertToBlob({ type, quality }).catch(() => null)
  }
  return new Promise((resolve) => {
    try {
      ;(canvas as HTMLCanvasElement).toBlob(
        (blob) => resolve(blob),
        type,
        quality,
      )
    } catch {
      resolve(null)
    }
  })
}

function loadHtmlImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error("No se pudo cargar la imagen."))
    }
    image.src = url
  })
}

async function convertHeicToJpeg(file: File): Promise<Blob> {
  try {
    const img = await loadHtmlImage(file)
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      return file
    }
  } catch {
    // Native load failed, proceed to heic2any fallback
  }

  try {
    const heic2anyModule = await import("heic2any")
    const heic2any = heic2anyModule.default || heic2anyModule
    const converted = await heic2any({
      blob: file,
      toType: "image/jpeg",
      quality: 0.85,
    })
    return Array.isArray(converted) ? converted[0] : converted
  } catch {
    throw new Error("No se pudo convertir la foto HEIC de iPhone.")
  }
}

type DecodedImage = {
  source: CanvasImageSource
  width: number
  height: number
  close?: () => void
}

async function decodeImage(file: File): Promise<DecodedImage> {
  if (isHeicFile(file)) {
    const convertedBlob = await convertHeicToJpeg(file)
    const img = await loadHtmlImage(convertedBlob)
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
    }
  }

  if (!isSafariOrIos() && typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
      })
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      }
    } catch {
      // Fall through to HTMLImageElement
    }
  }

  const image = await loadHtmlImage(file)
  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
  }
}

function makeCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas === "function") {
    return new OffscreenCanvas(width, height)
  }
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  return canvas
}

function disposeCanvas(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null,
  width: number,
  height: number,
) {
  try {
    ctx?.clearRect(0, 0, width, height)
    canvas.width = 0
    canvas.height = 0
  } catch {
    // ignore
  }
}

async function encodeCanvas(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  preferredType: "image/jpeg" | "image/webp",
  qualities: number[],
): Promise<Blob | null> {
  for (const quality of qualities) {
    const blob = await canvasToBlob(canvas, preferredType, quality)
    if (!blob) return null
    if (blob.type !== preferredType) return null
    if (blob.size <= TARGET_MAX_BYTES) return blob
  }
  return await canvasToBlob(canvas, preferredType, qualities[qualities.length - 1] ?? 0.45)
}

export async function compressImageFile(file: File): Promise<File> {
  if (typeof window === "undefined") return file

  const isWebp =
    file.type.toLowerCase() === "image/webp" || /\.webp$/i.test(file.name)
  if (isWebp && file.size > 0 && file.size < SKIP_WEBP_UNDER_BYTES) {
    return file
  }

  let decoded: DecodedImage | null = null
  let canvas: (HTMLCanvasElement | OffscreenCanvas) | null = null
  let ctx: (CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) | null = null
  let width = 0
  let height = 0

  try {
    decoded = await decodeImage(file)
    const fit = fitSize(decoded.width, decoded.height)
    width = fit.width
    height = fit.height

    canvas = makeCanvas(width, height)
    ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
    if (!ctx) throw new Error("No se pudo inicializar el lienzo para procesar la foto.")

    if ("imageSmoothingEnabled" in ctx) ctx.imageSmoothingEnabled = true
    if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high"
    ctx.drawImage(decoded.source, 0, 0, width, height)

    decoded.close?.()
    decoded = null

    const safariOrIos = isSafariOrIos()
    let chosenBlob: Blob | null = null
    let chosenMime: "image/jpeg" | "image/webp" = "image/jpeg"

    if (!safariOrIos) {
      const webpBlob = await encodeCanvas(canvas, "image/webp", WEBP_QUALITIES)
      if (
        webpBlob &&
        webpBlob.type === "image/webp" &&
        (webpBlob.size <= TARGET_MAX_BYTES || webpBlob.size < file.size)
      ) {
        chosenBlob = webpBlob
        chosenMime = "image/webp"
      }
    }

    if (!chosenBlob) {
      const jpegBlob = await encodeCanvas(canvas, "image/jpeg", JPEG_QUALITIES)
      if (jpegBlob && jpegBlob.type === "image/jpeg") {
        chosenBlob = jpegBlob
        chosenMime = "image/jpeg"
      }
    }

    if (!chosenBlob || chosenBlob.size <= 0) {
      throw new Error("No se pudo codificar la foto.")
    }

    return new File([chosenBlob], outputName(file, chosenMime), {
      type: chosenMime,
      lastModified: Date.now(),
    })
  } catch (err) {
    const isStandardSmall =
      file.size > 0 &&
      file.size <= TARGET_MAX_BYTES &&
      ["image/jpeg", "image/png", "image/webp"].includes(file.type.toLowerCase())
    if (isStandardSmall) {
      return file
    }
    throw err instanceof Error ? err : new Error("No se pudo procesar la foto.")
  } finally {
    decoded?.close?.()
    if (canvas) {
      disposeCanvas(canvas, ctx, width, height)
    }
  }
}

export async function compressImageFiles(files: File[]): Promise<File[]> {
  const out: File[] = []
  for (const file of files) {
    out.push(await compressImageFile(file))
  }
  return out
}

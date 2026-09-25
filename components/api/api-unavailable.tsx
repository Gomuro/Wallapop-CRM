"use client"

import { Button } from "@/components/ui/button"
import type { ApiUnavailableReason } from "@/lib/api/availability"

type Props = {
  reason: ApiUnavailableReason
  className?: string
}

const COPY: Record<
  ApiUnavailableReason,
  { title: string; body: string; hint?: string }
> = {
  config: {
    title: "API не налаштовано",
    body:
      "Застосунок не знає адресу сервера складу. Адміністратор має задати NEXT_PUBLIC_API_URL (Vercel) і підняти Express на VPS.",
    hint: "Локально: кореневий .env → NEXT_PUBLIC_API_URL=http://localhost:4000 і npm run server:dev",
  },
  unreachable: {
    title: "Сервер складу недоступний",
    body:
      "Не вдалося зв’язатися з API. Перевірте, чи працює процес server на VPS, мережу та CORS_ORIGIN для цього сайту.",
    hint: "Спробуйте оновити сторінку через хвилину.",
  },
}

export function ApiUnavailable({ reason, className }: Props) {
  const copy = COPY[reason]

  return (
    <div
      className={
        className ??
        "flex min-h-[50dvh] flex-col items-center justify-center gap-4 px-6 py-12 text-center"
      }
    >
      <div className="max-w-md space-y-2">
        <h1 className="text-lg font-semibold tracking-tight">{copy.title}</h1>
        <p className="text-sm text-muted-foreground">{copy.body}</p>
        {copy.hint ? (
          <p className="text-xs text-muted-foreground/80">{copy.hint}</p>
        ) : null}
      </div>
      <Button
        type="button"
        variant="outline"
        className="h-11"
        onClick={() => window.location.reload()}
      >
        Оновити сторінку
      </Button>
    </div>
  )
}

import Link from "next/link"
import { SearchXIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

export function CatalogEmpty({ view }: { view: "grid" | "list" }) {
  const href = view === "list" ? "/?view=list" : "/"

  return (
    <div className="flex flex-col items-center gap-4 px-1 py-16 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-muted">
        <SearchXIcon className="size-6 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium">Нічого не знайдено</p>
      <Button className="h-11" nativeButton={false} render={<Link href={href} />}>
        Скинути фільтри
      </Button>
    </div>
  )
}

import Link from "next/link"

import { Button } from "@/components/ui/button"

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-lg font-semibold">Item not found</h1>
      <p className="text-sm text-muted-foreground">
        It may have been deleted from this session.
      </p>
      <Button nativeButton={false} render={<Link href="/" />}>
        Back to catalog
      </Button>
    </main>
  )
}

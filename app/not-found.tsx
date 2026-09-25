import Link from "next/link"

import { Button } from "@/components/ui/button"
import { typeScreen } from "@/lib/ui/type"

export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center md:px-8">
      <h1 className={typeScreen}>Item not found</h1>
      <p className="text-sm text-muted-foreground">
        It may have been deleted from this session.
      </p>
      <Button className="h-11" nativeButton={false} render={<Link href="/" />}>
        Back to catalog
      </Button>
    </div>
  )
}

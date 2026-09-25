import { cn } from "@/lib/utils"

export function OfflineBanner({ className }: { className?: string }) {
  return (
    <div
      role="status"
      className={cn(
        "border-b bg-muted px-4 py-2.5 text-center text-sm text-foreground",
        className,
      )}
    >
      Modo sin conexión temporal: los cambios se sincronizarán cuando el servidor esté activo.
    </div>
  )
}

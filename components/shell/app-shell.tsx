import { BottomNav } from "@/components/shell/bottom-nav"
import { DesktopNav } from "@/components/shell/desktop-nav"

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh w-full md:bg-muted/40">
      <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col bg-background md:shadow-sm">
        <DesktopNav />
        <div className="flex min-h-0 flex-1 flex-col pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-0">
          {children}
        </div>
        <BottomNav />
      </div>
    </div>
  )
}

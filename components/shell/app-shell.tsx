import { BottomNav } from "@/components/shell/bottom-nav"

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-background">
      <div className="flex min-h-dvh flex-col pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
        {children}
      </div>
      <BottomNav />
    </div>
  )
}

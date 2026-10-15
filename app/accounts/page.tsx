import { AccountList } from "@/components/accounts/account-list"
import { DatabaseBackupCard } from "@/components/accounts/database-backup-card"
import { DevMonitorSwitch } from "@/components/accounts/dev-monitor-switch"
import { PageContainer } from "@/components/shell/page-container"
import { ThemeToggle } from "@/components/theme/theme-toggle"
import { typeScreen } from "@/lib/ui/type"

export default function AccountsPage() {
  return (
    <PageContainer className="py-4 md:py-8">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <h1 className={typeScreen}>Cuentas</h1>
        <ThemeToggle variant="row" />
        {process.env.NODE_ENV === "development" ? <DevMonitorSwitch /> : null}
        <AccountList />
        <DatabaseBackupCard />
      </div>
    </PageContainer>
  )
}

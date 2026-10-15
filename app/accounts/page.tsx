import { AccountList } from "@/components/accounts/account-list"
import { DatabaseBackupCard } from "@/components/accounts/database-backup-card"
import { PageContainer } from "@/components/shell/page-container"
import { ThemeToggle } from "@/components/theme/theme-toggle"

export default function AccountsPage() {
  return (
    <PageContainer className="py-4 md:py-8">
      <div className="mx-auto flex w-full max-w-md flex-col gap-4">
        <ThemeToggle variant="row" />
        <AccountList />
        <DatabaseBackupCard />
      </div>
    </PageContainer>
  )
}

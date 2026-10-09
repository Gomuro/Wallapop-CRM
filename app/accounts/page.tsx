import { AutopostIntervalForm } from "@/components/accounts/autopost-interval-form"
import { ConnectAccountForm } from "@/components/accounts/connect-account-form"
import { DatabaseBackupCard } from "@/components/accounts/database-backup-card"
import { PageContainer } from "@/components/shell/page-container"
import { ThemeToggle } from "@/components/theme/theme-toggle"

export default function AccountsPage() {
  return (
    <PageContainer className="py-4 md:py-8">
      <div className="mx-auto mb-6 w-full max-w-md border-b border-border pb-6">
        <ThemeToggle variant="row" />
      </div>
      <ConnectAccountForm />
      <AutopostIntervalForm />
      <DatabaseBackupCard />
    </PageContainer>
  )
}

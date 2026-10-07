import { AutopostIntervalForm } from "@/components/accounts/autopost-interval-form"
import { ConnectAccountForm } from "@/components/accounts/connect-account-form"
import { DatabaseBackupCard } from "@/components/accounts/database-backup-card"
import { PageContainer } from "@/components/shell/page-container"

export default function AccountsPage() {
  return (
    <PageContainer className="py-4 md:py-8">
      <ConnectAccountForm />
      <AutopostIntervalForm />
      <DatabaseBackupCard />
    </PageContainer>
  )
}

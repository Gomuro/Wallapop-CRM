import { AutopostIntervalForm } from "@/components/accounts/autopost-interval-form"
import { ConnectAccountForm } from "@/components/accounts/connect-account-form"
import { PageContainer } from "@/components/shell/page-container"

export default function AccountsPage() {
  return (
    <PageContainer className="py-4 md:py-8">
      <ConnectAccountForm />
      <AutopostIntervalForm />
    </PageContainer>
  )
}

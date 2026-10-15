import { AccountDetail } from "@/components/accounts/account-list"

export default async function AccountPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <AccountDetail accountId={id} />
}

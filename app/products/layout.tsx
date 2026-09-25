/** Warehouse routes call Express at request time; skip static prerender without API env. */
export const dynamic = "force-dynamic"

export default function ProductsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}

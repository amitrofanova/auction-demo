export function formatRubles(amount: number): string {
  const body = String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return `${body} ₽`
}

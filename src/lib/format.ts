const dateFormatter = new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'short', timeStyle: 'short' })

export function formatPrice(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: value >= 1 ? 2 : 4,
    maximumFractionDigits: value >= 1 ? 2 : 8,
  }).format(value)
}

export function formatDate(value: string) {
  return dateFormatter.format(new Date(value))
}

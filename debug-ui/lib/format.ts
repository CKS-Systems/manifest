export function formatPrice(n: number): string {
  const decimals = Math.max(0, Math.floor(9 - Math.log10(n)));
  return Intl.NumberFormat('en', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

export function formatNotional(n: number, decimals: number): string {
  return Intl.NumberFormat('en', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    style: 'currency',
    currency: 'USD',
  }).format(n);
}

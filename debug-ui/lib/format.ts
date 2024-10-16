



export function formatPrice(n: number): string {
  let decimals = 9;
  if (n > 9000) {
    decimals = 0;
  } else if (n > 900) {
    decimals = 1;
  } else if (n > 90) {
    decimals = 2;
  } else if (n > 9) {
    decimals = 3;
  } else if (n > 0.9) {
    decimals = 4;
  } else if (n > 0.09) {
    decimals = 5;
  } else if (n > 0.009) {
    decimals = 6;
  } else if (n > 0.0009) {
    decimals = 7;
  } else if (n > 0.00009) {
    decimals = 8;
  }

  return Intl.NumberFormat('en', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}
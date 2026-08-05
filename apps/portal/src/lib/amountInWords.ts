const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
]

const TENS = [
  '',
  '',
  'Twenty',
  'Thirty',
  'Forty',
  'Fifty',
  'Sixty',
  'Seventy',
  'Eighty',
  'Ninety',
]

function twoDigits(n: number): string {
  if (n < 20) return ONES[n]
  const ten = Math.floor(n / 10)
  const one = n % 10
  return one ? `${TENS[ten]} ${ONES[one]}` : TENS[ten]
}

function threeDigits(n: number): string {
  if (n < 100) return twoDigits(n)
  const hundred = Math.floor(n / 100)
  const rest = n % 100
  return rest
    ? `${ONES[hundred]} Hundred ${twoDigits(rest)}`
    : `${ONES[hundred]} Hundred`
}

/** Convert a PKR amount to English words (Indian numbering: Lakh / Crore). */
export function amountInWords(amount: number | string): string {
  const value = Math.round(Number(amount) || 0)
  if (value === 0) return 'Zero Rupees Only'

  const crore = Math.floor(value / 10000000)
  const lakh = Math.floor((value % 10000000) / 100000)
  const thousand = Math.floor((value % 100000) / 1000)
  const hundred = value % 1000

  const parts: string[] = []
  if (crore) parts.push(`${threeDigits(crore)} Crore`)
  if (lakh) parts.push(`${threeDigits(lakh)} Lakh`)
  if (thousand) parts.push(`${threeDigits(thousand)} Thousand`)
  if (hundred) parts.push(threeDigits(hundred))

  return `${parts.join(' ')} Rupees Only`
}

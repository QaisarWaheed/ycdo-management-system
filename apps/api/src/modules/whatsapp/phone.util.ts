/** Digits only E.164 without +. Pakistan: 03… → 923… */
export function normalizePakistanPhone(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;

  let digits = raw.replace(/\D/g, '');
  if (!digits) return null;

  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  if (digits.startsWith('0') && digits.length === 11) {
    digits = `92${digits.slice(1)}`;
  }

  if (digits.length === 10 && digits.startsWith('3')) {
    digits = `92${digits}`;
  }

  if (!digits.startsWith('92') || digits.length < 12) {
    return null;
  }

  return digits;
}

if (require.main === module) {
  const cases: Array<[string, string | null]> = [
    ['03001234567', '923001234567'],
    ['+92 300 1234567', '923001234567'],
    ['923001234567', '923001234567'],
    ['3001234567', '923001234567'],
    ['', null],
    ['abc', null],
  ];
  for (const [input, expected] of cases) {
    const got = normalizePakistanPhone(input);
    if (got !== expected) {
      throw new Error(`normalizePakistanPhone(${JSON.stringify(input)}) => ${got}, want ${expected}`);
    }
  }
  // eslint-disable-next-line no-console
  console.log('normalizePakistanPhone ok');
}

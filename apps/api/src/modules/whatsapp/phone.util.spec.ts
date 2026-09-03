import { normalizePakistanPhone, isOnWhatsAppAllowlist } from './phone.util';

describe('isOnWhatsAppAllowlist', () => {
  it('allows every number when the allowlist is empty', () => {
    expect(isOnWhatsAppAllowlist('923001234567', '')).toBe(true);
    expect(isOnWhatsAppAllowlist('923001234567', undefined)).toBe(true);
  });

  it('allows only listed numbers while testing', () => {
    const list = '03001234567, +92 333 1112222';
    expect(isOnWhatsAppAllowlist('923001234567', list)).toBe(true);
    expect(isOnWhatsAppAllowlist('923331112222', list)).toBe(true);
    expect(isOnWhatsAppAllowlist('923009999999', list)).toBe(false);
  });

  it('normalizes mixed Pakistan formats in the allowlist', () => {
    expect(normalizePakistanPhone('03360070735')).toBe('923360070735');
  });
});

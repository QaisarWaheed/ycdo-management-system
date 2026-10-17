import { pickDutyCheckout } from './attendance.service';

const t = (iso: string) => new Date(iso);

describe('pickDutyCheckout (recalculate month)', () => {
  const checkIn = t('2026-10-04T03:39:00Z'); // 08:39 PKT

  it('takes the last checkout of the duty', () => {
    expect(
      pickDutyCheckout(checkIn, t('2026-10-05T03:23:00Z'), [
        t('2026-10-04T15:40:00Z'),
        t('2026-10-04T15:55:00Z'), // 20:55 PKT, last
      ]),
    ).toEqual(t('2026-10-04T15:55:00Z'));
  });

  it('never borrows the next day checkout or one before check-in', () => {
    expect(
      pickDutyCheckout(checkIn, t('2026-10-05T03:23:00Z'), [
        t('2026-10-04T02:00:00Z'),
        t('2026-10-05T15:00:00Z'),
      ]),
    ).toBeUndefined();
  });

  it('overnight duty: checkout after midnight still belongs to the duty', () => {
    const nightIn = t('2026-10-04T15:00:00Z'); // 20:00 PKT
    expect(
      pickDutyCheckout(nightIn, null, [t('2026-10-05T03:10:00Z')]),
    ).toEqual(t('2026-10-05T03:10:00Z'));
  });

  it('ignores anything beyond 20 hours', () => {
    expect(
      pickDutyCheckout(checkIn, null, [t('2026-10-05T00:00:01Z')]),
    ).toBeUndefined();
  });
});

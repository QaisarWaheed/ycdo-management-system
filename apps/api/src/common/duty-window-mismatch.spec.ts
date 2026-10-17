import { dutyWindowMismatch } from './duty.util';

// A mistyped end time must not silently turn someone into 24-hour staff.
describe('dutyWindowMismatch', () => {
  it('flags windows of 20h+ when total hours say otherwise', () => {
    expect(dutyWindowMismatch('14:00', '10:00', 8)).toMatch(/20 hours/); // meant 22:00
    expect(dutyWindowMismatch('16:00', '12:00', 8)).toMatch(/20 hours/); // meant 00:00
    expect(dutyWindowMismatch('08:30', '08:30', 12)).toMatch(/24 hours/); // meant 20:30
  });

  it('accepts correct and genuine 24-hour duties', () => {
    expect(dutyWindowMismatch('14:00', '22:00', 8)).toBeNull();
    expect(dutyWindowMismatch('16:00', '00:00', 8)).toBeNull();
    expect(dutyWindowMismatch('20:00', '08:00', 12)).toBeNull();
    expect(dutyWindowMismatch('00:00', '23:59', 24)).toBeNull();
    expect(dutyWindowMismatch('14:00', '10:00', null)).toBeNull();
  });
});

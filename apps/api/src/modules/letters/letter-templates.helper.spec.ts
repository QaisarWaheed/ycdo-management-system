import {
  parseAttendanceRows,
  parseViolationLines,
} from './letter-templates.helper';

describe('letter template parsers', () => {
  it('parses violation lines from newline text', () => {
    expect(parseViolationLines('late\nabsent\n')).toEqual(['late', 'absent']);
  });

  it('parses attendance rows from pipe lines', () => {
    expect(
      parseAttendanceRows('01/08/2026 | 08:00 AM | 05:00 PM\n02/08/2026|09:00|17:00'),
    ).toEqual([
      { date: '01/08/2026', inTime: '08:00 AM', outTime: '05:00 PM' },
      { date: '02/08/2026', inTime: '09:00', outTime: '17:00' },
    ]);
  });

  it('parses attendance rows from JSON', () => {
    expect(
      parseAttendanceRows(
        JSON.stringify([{ date: '01/08/2026', checkIn: '8am', checkOut: '5pm' }]),
      ),
    ).toEqual([{ date: '01/08/2026', inTime: '8am', outTime: '5pm' }]);
  });
});

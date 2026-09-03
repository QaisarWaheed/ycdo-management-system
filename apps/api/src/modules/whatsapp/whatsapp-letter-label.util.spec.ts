import { LetterType } from '@prisma/client';
import {
  ordinal,
  sequencedLetterLabel,
} from './whatsapp-letter-label.util';

describe('sequencedLetterLabel', () => {
  it('names the 1st, 2nd, and 3rd warning', () => {
    expect(sequencedLetterLabel(LetterType.WARNING, 1)).toBe(
      '1st Letter Of Warning',
    );
    expect(sequencedLetterLabel(LetterType.WARNING, 2)).toBe(
      '2nd Letter Of Warning',
    );
    expect(sequencedLetterLabel(LetterType.WARNING, 3)).toBe(
      '3rd Letter Of Warning',
    );
  });

  it('sequences other letter types the same way', () => {
    expect(sequencedLetterLabel(LetterType.ADVICE, 1)).toBe(
      '1st Letter Of Advice',
    );
    expect(sequencedLetterLabel(LetterType.EXPLANATION, 2)).toBe(
      '2nd Absence Notice',
    );
    expect(sequencedLetterLabel(LetterType.FINE, 3)).toBe(
      '3rd Letter Of Fine / Penalty',
    );
  });

  it('uses English ordinal suffixes', () => {
    expect(ordinal(11)).toBe('11th');
    expect(ordinal(12)).toBe('12th');
    expect(ordinal(21)).toBe('21st');
  });
});

import {
  isUserGeneratedTextAllowed,
  RUSSIAN_README_DISALLOWED_HEADWORDS,
} from './content-moderation';

describe('content moderation', () => {
  it.each([
    'Играем спокойно и с уважением',
    'Please meet near court seven',
    'Защитная мебель для корта',
    'Charles Dickens',
    'Scunthorpe tournament',
    'Fast upper court keeper',
    'A glass hole near the court',
    'Sukanya studies the Huygens principle',
    'Mudakov joined the tournament',
    'Dickens saw a peacock and a pussywillow',
    'Mrazek joined the match',
    'Отличная игра 🎾',
  ])('allows ordinary Russian and English text', (value) => {
    expect(isUserGeneratedTextAllowed(value)).toBe(true);
  });

  it.each([
    'хуй',
    'пиздец',
    'бля',
    'блядь',
    'ёб',
    'долбоеб',
    'сука',
    'мудак',
    'fuck',
    'shit',
    'bitch',
    'asshole',
    'dick',
    'cock',
    'pussy',
  ])('rejects direct Russian and English disallowed language', (value) => {
    expect(isUserGeneratedTextAllowed(value)).toBe(false);
  });

  it.each([
    'suka',
    'blyat',
    'bl1@t',
    'pidor',
    'huy',
    'khui',
    'pizdec',
    'ebat',
    'mudak',
    'govno',
    'gandon',
    'shluha',
    'mraz',
    'dolboeb',
    'nahuy',
    'zaebal',
    'zaebis',
    'b l y a t',
    'p.i.z.d.e.c',
    'g0v.n0',
    'dol bo eb',
    'na hu y',
    'z@ eb al',
    'p.u.s.s.y',
    'c 0 c k',
  ])('rejects common Russian transliteration evasions', (value) => {
    expect(isUserGeneratedTextAllowed(value)).toBe(false);
  });

  it('rejects every unique Russian headword imported from the README dictionary', () => {
    expect(RUSSIAN_README_DISALLOWED_HEADWORDS).toHaveLength(377);
    expect(new Set(RUSSIAN_README_DISALLOWED_HEADWORDS).size).toBe(
      RUSSIAN_README_DISALLOWED_HEADWORDS.length,
    );
    for (const headword of RUSSIAN_README_DISALLOWED_HEADWORDS) {
      expect(isUserGeneratedTextAllowed(headword)).toBe(false);
    }
  });

  it.each([
    'х у й',
    'п.и.з.д.е.ц',
    '6лядь',
    'f u c k',
    'f.u.c.k',
    'fucк',
    'sh1t',
    'b!tch',
    'fu ck',
    'f uck',
    'fuckyou',
    'ху й',
    'х уй',
    'пиз дец',
  ])('rejects common separator, leetspeak and homoglyph evasions', (value) => {
    expect(isUserGeneratedTextAllowed(value)).toBe(false);
  });

  it('does not include rejected text in its result', () => {
    const privateMarker = 'fuck';
    expect(isUserGeneratedTextAllowed(privateMarker)).toBe(false);
    expect(JSON.stringify(isUserGeneratedTextAllowed(privateMarker))).not.toContain(
      privateMarker,
    );
  });
});

const ENGLISH_HOMOGLYPHS: Readonly<Record<string, string>> =
  Object.freeze({
    а: 'a',
    в: 'b',
    с: 'c',
    е: 'e',
    н: 'h',
    і: 'i',
    к: 'k',
    м: 'm',
    о: 'o',
    р: 'p',
    т: 't',
    х: 'x',
    у: 'y',
  });

const RUSSIAN_HOMOGLYPHS: Readonly<Record<string, string>> =
  Object.freeze({
    a: 'а',
    b: 'в',
    c: 'с',
    e: 'е',
    h: 'н',
    i: 'и',
    k: 'к',
    m: 'м',
    o: 'о',
    p: 'р',
    t: 'т',
    x: 'х',
    y: 'у',
  });

const ENGLISH_LEET: Readonly<Record<string, string>> = Object.freeze({
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '!': 'i',
  '|': 'i',
  '@': 'a',
  '$': 's',
});

const RUSSIAN_LEET: Readonly<Record<string, string>> = Object.freeze({
  '0': 'о',
  '1': 'и',
  '3': 'з',
  '4': 'ч',
  '6': 'б',
  '8': 'в',
  '9': 'я',
  '!': 'и',
  '|': 'и',
  '@': 'а',
});

export const RUSSIAN_README_DISALLOWED_HEADWORDS: readonly string[] =
  Object.freeze(
    `
беспиздая бледь бля блядва блядемудиный блядиада блядина
блядистость блядки блядовать блядогон блядословник блядский
блядство блядун блядь блять бляхомудия взбляд взъебка
взъебнуть взъебщик взъебывать впиздить впиздиться впиздохать
впиздохивать впиздохиваться впиздронивать впиздрониваться
впиздюлить впиздячил впиздячить впизживать впизживаться
вхуйнуть вхуйнуться вхуякаться вхуяривание вхуярить
вхуяриться вхуячить вхуячиться вхуяшить въебать въебывать
выблядовал выблядок выебаный выебать выебок выебон
выебывается выпиздеться выпиздить выхуякивание выхуяривание
выхуячивание глупизди говноеб голоебица греблядь
дерьмохеропиздократ дерьмохеропиздократия доебался
доебаться доебывать долбоеб допиздеться допизды дохуйнуть
дохуя дохуякать дохуякивать дохуяриваться дуроеб дядееб
еб ебака ебал ебалка ебало ебалово ебальник ебальный
ебанатик ебандей ебанешься ебанной ебаной ебанул
ебанулся ебанутый ебануть ебануться ебаный ебанько
ебаришка ебарь ебаторий ебать ебаться ебашит ебеня
ебет еби ебистика ебись ебическая ебкость ебла еблан
ебланить еблась ебливая ебло еблом еблысь ебля ебнул
ебнутый ебнуть ебнуться ебс ебукентий жидоеб жидоебка
жидоебский жопа жопу заеб заебал заебанный заебать
заебаться заебашить заебенить заебешь заебись заебцовый
запизденевать запиздеть запиздить запизживаться захуем
захуй захуяривать захуярить злоебучая изъебнулся
испизделся испиздить исхуячить козлоеб козлоебина
козлоебиться козлоебище козоеб козоебиться коноеб
коноебиться косоебится малоебучий малоебущий многопиздная
мозгоеб мудоеб наблядовал наебалово наебать наебаться
наебашился наебениться наебка наебнулся наебнуть напиздеть
напиздить настоебать нахуевертеть нахуя нахуяривать
нахуяриться невъебенный нехуевый нехуй нихуя оберблядь
объебал объебалово объебательство объебать объебаться
объебос однохуйственно опизденевать опиздихуительный
опиздоумел оскотоебился ослоеб ослоебиться остоебал
остопиздело остопиздеть остохуеть отпиздить отхуяривать
отъебаться охуевать охуенно охуенный охуительно охуительный
охуячивать охуячить оххуетительно пезды переебать
перехуяривать перехуярить пизда пиздабол пиздаеб
пиздакрыл пиздануть пиздануться пиздатый пизде пиздеж
пизделиться пизделякает пизденыш пиздеть пиздец
пиздецкий пиздить пиздишь пиздоблошка пиздобол пиздобрат
пиздобратия пиздовать пиздовладелец пиздодушие
пиздоебищность пиздой пиздолет пиздолиз пиздомания
пиздопляска пиздопроеб пиздорванец пиздорванка
пиздострадалец пиздострадания пиздохуй пиздошить пиздрик
пизду пиздуй пиздун пизды пиздюк пиздюлей пиздюли
пиздюлина пиздюлька пиздюля пиздюлятору пиздюрить
пиздюхать пиздюшник подзаебать подзаебенить поднаебнуть
поднаебнуться поднаебывать подпездывать подпиздывает
подъебка подъебки подъебнуть подъебывать поебать поебень
попиздеть попиздили похую похуярили приебаться припиздеть
припиздить припиздью прихуевать прихуяривать прихуярить
проблядь проеб проебать проебаться пропиздить пропиздью
разебанный разъебай разъебаться распиздон распиздошил
распиздяй распиздяйство расхуюжить расхуяривать свиноеб
свиноебиться скотоеб скотоебина сосихуйский спиздил
страхоебище сухопиздая схуярить съебаться трепездон
трепездонит туебень тупиздень уебался уебать уебище
уебищенски уебок уебывать упиздить хитровыебанный
худоебина хуе хуебратия хуев хуеватенький хуевато
хуевина хуевничать хуево хуеву хуевый хуеглот хуегрыз
хуедин хуелес хуем хуеман хуемырло хуеплет хуепутало
хуесос хуета хуетень хуеть хуи хуила хуило хуй хуйло
хуйнуть хуйню хуйня хули хую хуюм хуюшки хуя хуяк
хуями хуярить хуяция хуячить шароебится широкопиздая
`
      .trim()
      .split(/\s+/u),
  );

const ENGLISH_DISALLOWED_PATTERNS: readonly RegExp[] = Object.freeze([
  /^f+u+c+k+(?:e+d|e+r+s?|i+n+g|s)?$/u,
  /^m+o+t+h+e+r+f+u+c+k+(?:e+d|e+r+s?|i+n+g)?$/u,
  /^s+h+i+t+(?:s|t+y|t+e+d|t+i+n+g)?$/u,
  /^b+u+l+l+s+h+i+t+$/u,
  /^b+i+t+c+h+(?:e+s|y|i+n+g)?$/u,
  /^c+u+n+t+s?$/u,
  /^a+s+s+h+o+l+e+s?$/u,
  /^d+i+c+k+s?$/u,
  /^d+i+c+k+h+e+a+d+s?$/u,
  /^c+o+c+k+s?$/u,
  /^p+u+s+s+(?:y|i+e+s)$/u,
  /^w+a+n+k+e+r+s?$/u,
  /^w+h+o+r+e+s?$/u,
  /^s+l+u+t+(?:s|t+y)?$/u,
  /^f+a+g+g+o+t+s?$/u,
  /^n+i+g+g+(?:e+r|a)s?$/u,
]);

const ENGLISH_DISALLOWED_FRAGMENTS: readonly RegExp[] = Object.freeze([
  /f+u+c+k+/u,
  /b+i+t+c+h+/u,
  /a+s+s+h+o+l+e+/u,
  /f+a+g+g+o+t+/u,
  /n+i+g+g+(?:e+r|a)/u,
]);

const RUSSIAN_TRANSLITERATION_DISALLOWED_PATTERNS: readonly RegExp[] =
  Object.freeze([
    /^(?:(?:na|po|za|pod|pro|do|vy|u|ot|pri|raz|s|vz|ob|pere)?(?:h|k+h+)u+(?:i|y)(?:a|e|u|i|o+m)?)$/u,
    /^(?:(?:ras|pro|za|na|do|vy|ot|pri|u|po)?p+i+z+d+(?:e+c|e+t+s|e+z|a|u|y|o+y|e)[a-z]*)$/u,
    /^(?:(?:za|na|po|pro|pere|pod|do|vy|u|ot|pri|raz|s|vz|ob)?(?:y+)?e+b+(?:a+t|a+l|i+s|u+c+h)[a-z]*)$/u,
    /^s+u+k+(?:a|i|u|e|o+y|a+m+i)?$/u,
    /^b+l+(?:y|i)+a+(?:d+[a-z]*|t+)?$/u,
    /^m+u+d+a+k+(?:i|a|u|o+m|e)?$/u,
    /^g+o+v+n+(?:o|a|u|e|o+m|y|i)?$/u,
    /^g+(?:a|o)+n+d+o+n+(?:a|u|o+m|e|y|i)?$/u,
    /^s+h+l+(?:y+)?u+(?:k+h+|h+)(?:a|i|u|e|o+y)?$/u,
    /^m+r+a+z+(?:i|a|u|e|y|o+t+a)?$/u,
    /^d+o+l+b+o+(?:e|y+o)+b+[a-z]*$/u,
    /^p+i+d+(?:o+r|a+r|e+r+a+s+t)(?:a|u|o+m|e|y|i)?$/u,
  ]);

const RUSSIAN_DISALLOWED_PATTERNS: readonly RegExp[] = Object.freeze([
  /^(?:(?:а|о|на|по|за|под|про|до|вы|у|от|при|раз|с|вз|об|пере)?х+у+(?:й|я|е|и|ю)[а-я]*)$/u,
  /^(?:(?:рас|про|за|на|до|вы|от|при|у|по)?п+и+з+д+[а-я]*)$/u,
  /^б+л+я+(?:д+[а-яь]*|т+ь?)?$/u,
  /^(?:(?:за|на|по|про|пере|под|до|вы|у|от|при|раз|с|вз|об)?ъ?е+б+[а-я]*)$/u,
  /^д+о+л+б+о+е+б+[а-я]*$/u,
  /^с+у+к+(?:а|и|у|е|ой|ами|арь|арю|аря)?$/u,
  /^с+у+ч+(?:ка|ки|ку|ке|кой|ары?|арами)$/u,
  /^м+у+д+а+к+[а-я]*$/u,
  /^г+о+в+н+[а-я]*$/u,
  /^г+а+н+д+о+н+[а-я]*$/u,
  /^п+(?:и+д+о+р|и+д+а+р|е+д+е+р+а+с+т)[а-я]*$/u,
  /^ш+л+ю+х+[а-я]*$/u,
  /^м+р+а+з+[а-яь]*$/u,
]);

const RUSSIAN_DISALLOWED_FRAGMENTS: readonly RegExp[] = Object.freeze([
  /п+и+з+д+/u,
  /б+л+я+д+/u,
  /д+о+л+б+о+е+б+/u,
  /м+у+д+а+к+/u,
  /г+а+н+д+о+н+/u,
  /п+(?:и+д+о+р|и+д+а+р|е+д+е+р+а+с+т)/u,
  /ш+л+ю+х+/u,
]);

const LETTER_OR_NUMBER_PATTERN = /[\p{L}\p{N}]/u;
const LETTER_OR_NUMBER_SEQUENCE_PATTERN = /[\p{L}\p{N}]+/gu;
const COMBINING_MARK_PATTERN = /\p{M}/u;
const WHITESPACE_PATTERN = /\s+/u;

function fold(
  value: string,
  homoglyphs: Readonly<Record<string, string>>,
  leet: Readonly<Record<string, string>>,
): string {
  return [...value.normalize('NFKD').toLocaleLowerCase('und')]
    .filter((character) => !COMBINING_MARK_PATTERN.test(character))
    .map(
      (character) =>
        leet[character] ?? homoglyphs[character] ?? character,
    )
    .join('')
    .replaceAll('ё', 'е');
}

const RUSSIAN_README_DISALLOWED_HEADWORD_SET: ReadonlySet<string> =
  new Set(
    RUSSIAN_README_DISALLOWED_HEADWORDS.map((headword) =>
      fold(headword, RUSSIAN_HOMOGLYPHS, RUSSIAN_LEET),
    ),
  );

function addCandidate(
  candidates: Set<string>,
  value: string,
): void {
  if (value.length > 0 && [...value].length <= 2_048) {
    candidates.add(value);
  }
}

interface ModerationCandidates {
  readonly exact: readonly string[];
  readonly fragments: readonly string[];
}

function candidates(value: string): ModerationCandidates {
  const exact = new Set<string>();
  const fragments = new Set<string>();
  const tokens = value.match(LETTER_OR_NUMBER_SEQUENCE_PATTERN) ?? [];
  for (const token of tokens) {
    addCandidate(exact, token);
    addCandidate(fragments, token);
  }

  for (let start = 0; start < tokens.length; start += 1) {
    let joined = '';
    for (
      let offset = 0;
      offset < 4 && start + offset < tokens.length;
      offset += 1
    ) {
      joined += tokens[start + offset];
      addCandidate(exact, joined);
    }
  }

  for (const chunk of value.split(WHITESPACE_PATTERN)) {
    const compact = [...chunk]
      .filter((character) => LETTER_OR_NUMBER_PATTERN.test(character))
      .join('');
    addCandidate(exact, compact);
    addCandidate(fragments, compact);
  }

  let singleCharacterRun = '';
  for (const token of tokens) {
    if ([...token].length === 1) {
      singleCharacterRun += token;
      continue;
    }
    addCandidate(exact, singleCharacterRun);
    addCandidate(fragments, singleCharacterRun);
    singleCharacterRun = '';
  }
  addCandidate(exact, singleCharacterRun);
  addCandidate(fragments, singleCharacterRun);
  return Object.freeze({
    exact: Object.freeze([...exact]),
    fragments: Object.freeze([...fragments]),
  });
}

function matchesAny(
  values: readonly string[],
  patterns: readonly RegExp[],
): boolean {
  return values.some((value) =>
    patterns.some((pattern) => pattern.test(value)),
  );
}

function containsAny(
  values: readonly string[],
  patterns: readonly RegExp[],
): boolean {
  return values.some((value) =>
    patterns.some((pattern) => pattern.test(value)),
  );
}

/**
 * Returns only an allow/deny decision so rejected user text cannot be
 * accidentally copied into logs, errors, audit metadata or HTTP responses.
 */
export function isUserGeneratedTextAllowed(value: string): boolean {
  const english = candidates(
    fold(value, ENGLISH_HOMOGLYPHS, ENGLISH_LEET),
  );
  if (
    matchesAny(english.exact, ENGLISH_DISALLOWED_PATTERNS) ||
    matchesAny(
      english.exact,
      RUSSIAN_TRANSLITERATION_DISALLOWED_PATTERNS,
    ) ||
    containsAny(english.fragments, ENGLISH_DISALLOWED_FRAGMENTS)
  ) {
    return false;
  }
  const russian = candidates(
    fold(value, RUSSIAN_HOMOGLYPHS, RUSSIAN_LEET),
  );
  return !(
    russian.exact.some((value) =>
      RUSSIAN_README_DISALLOWED_HEADWORD_SET.has(value),
    ) ||
    matchesAny(russian.exact, RUSSIAN_DISALLOWED_PATTERNS) ||
    containsAny(russian.fragments, RUSSIAN_DISALLOWED_FRAGMENTS)
  );
}

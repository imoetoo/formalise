/**
 * Substance check, PLAN.md §2: after a rewrite, every ask, deadline, constraint, number and
 * stated position in the input must still be present in the output. Flag what went missing
 * rather than silently shipping it. One check serves both directions.
 *
 * Design (phase 03, see plans/03-claude-client.plan.md Log):
 *
 * 1. A deterministic heuristic layer extracts substance from the input with lexicons and
 *    patterns written for the language actually used (Singlish and colloquial English), and
 *    checks for its presence in the output through equivalence classes ("tomorrow" may come
 *    back as "tmr", "get this done" as "do this", "where got enough time" as "a while longer").
 *    It is exact and unit-tested; it cannot judge meaning.
 * 2. The model self-reports the substance it found and, for each item, the phrase in its
 *    output that carries it (`ReportedSubstance.carriedBy`). That claim is never trusted: the
 *    phrase must actually occur in the output or the item is flagged as missing.
 *
 * The two layers are merged by union: an item is missing when either layer says so. Emotional
 * temperature ("i dont care", swearing) is deliberately not substance (PLAN.md §5 D2).
 */
import type { SubstanceItem, SubstanceKind } from '../shared/types';

export type { SubstanceItem, SubstanceKind };

export interface SubstanceReport {
  /** True when nothing extracted from the input is missing from the output. */
  ok: boolean;
  /** Items found in the input. */
  found: readonly SubstanceItem[];
  /** Items found in the input that could not be located in the output. */
  missing: readonly SubstanceItem[];
}

/** A substance item the model reported, with the output phrase it claims carries the item. */
export interface ReportedSubstance extends SubstanceItem {
  /** The phrase in the output that carries the item, or empty when the model dropped it. */
  carriedBy: string;
}

/** A group of alternatives; the item is present when at least one alternative is found. */
type Alternatives = readonly string[];

interface Extracted extends SubstanceItem {
  start: number;
  end: number;
  /** Conjunction of disjunctions: every group must have one alternative in the output. */
  requires: readonly Alternatives[];
}

// ---------------------------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------------------------

const NUMBER_WORDS: Readonly<Record<string, string>> = {
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  eleven: '11',
  twelve: '12',
  thirteen: '13',
  fourteen: '14',
  fifteen: '15',
  sixteen: '16',
  seventeen: '17',
  eighteen: '18',
  nineteen: '19',
  twenty: '20',
  thirty: '30',
  forty: '40',
  fifty: '50',
  sixty: '60',
  seventy: '70',
  eighty: '80',
  ninety: '90',
  hundred: '100',
  thousand: '1000',
};

/**
 * Lower-case, unify quotes and dashes, turn number words into digits, join "3 pm" to "3pm",
 * strip punctuation that is not part of a number, and collapse whitespace. Exported for tests.
 */
export function normalise(text: string): string {
  return normaliseWith(text, false);
}

/**
 * Like {@link normalise} but keeps sentence punctuation as a `|` token so extraction patterns
 * can stop at a clause boundary ("fix it by friday, or else" -> "fix it by friday | or else").
 */
export function tokenise(text: string): string {
  return normaliseWith(text, true);
}

function normaliseWith(text: string, keepBreaks: boolean): string {
  let s = text
    .toLowerCase()
    .replace(/[\u2018\u2019\u201b]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/(\d)\s+(am|pm)\b/g, '$1$2')
    .replace(/(\d),(\d{3})\b/g, '$1$2');
  s = s.replace(/\b[a-z]+\b/g, (word) => NUMBER_WORDS[word] ?? word);
  // "don't" -> "dont" so both spellings compare equal; other apostrophes are dropped too.
  s = s.replace(/'/g, '');
  if (keepBreaks) {
    s = s.replace(/(?<!\d)[.,!?;:]|[.,!?;:](?!\d)|\n+/g, ' | ');
  }
  // Keep $ € £ % : / - . only when glued to a digit; everything else non-alphanumeric is a space.
  s = s.replace(keepBreaks ? /[^a-z0-9$€£%:/.\-\s|]/g : /[^a-z0-9$€£%:/.\-\s]/g, ' ');
  s = s.replace(/(?<!\d)[:/.-]|[:/.-](?!\d)/g, ' ');
  s = s.replace(/[$€£](?!\d)/g, ' ').replace(/%(?!\s|$)/g, '% ');
  s = s.replace(/\s+/g, ' ').trim();
  return keepBreaks
    ? s
        .replace(/(?:\| ?)+/g, '| ')
        .replace(/^\| |\s*\|$/g, '')
        .trim()
    : s;
}

/** Whole-word / whole-phrase containment on normalised text. Exported for tests. */
export function containsPhrase(haystackNormalised: string, phrase: string): boolean {
  const needle = normalise(phrase);
  if (needle === '') {
    return false;
  }
  const escaped = needle.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`).test(haystackNormalised);
}

/** Strip a few common English suffixes so "finished" ~ "finish", "days" ~ "day". */
function stem(word: string): string {
  if (word.length <= 3) {
    return word;
  }
  return word
    .replace(/(ing|ed|es|s)$/, '')
    .replace(/ie$/, 'y')
    .replace(/(.)\1$/, '$1');
}

function containsStem(haystackNormalised: string, word: string): boolean {
  const target = stem(word);
  return haystackNormalised.split(' ').some((w) => stem(w) === target);
}

// ---------------------------------------------------------------------------------------------
// Lexicons
// ---------------------------------------------------------------------------------------------

const WEEKDAY_FULL = 'monday|tuesday|wednesday|thursday|friday|saturday|sunday';
const WEEKDAY_ABBR = 'mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun';
const MONTH =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const DEADLINE_PREP = 'by|on|before|until|till|latest|this|next|coming|every|due|for|since|from';
const TIME_UNIT = 'hours?|hrs?|minutes?|mins?|days?|weeks?|wks?|months?|years?|yrs?';

/** Deadline tokens that mean the same thing, so any of them counts as survival. */
const DEADLINE_CLASSES: readonly Alternatives[] = [
  ['tomorrow', 'tmr', 'tmrw', 'tomorow', 'tommorow'],
  ['today', 'tdy', 'by the end of today', 'later today'],
  ['tonight', 'this evening', 'tonite'],
  ['eod', 'end of day', 'end of the day', 'close of business', 'cob', 'end of today'],
  ['eow', 'end of week', 'end of the week'],
  ['eom', 'end of month', 'end of the month'],
  ['asap', 'as soon as possible', 'at the earliest', 'urgently', 'soonest', 'earliest possible'],
  ['monday', 'mon'],
  ['tuesday', 'tue', 'tues'],
  ['wednesday', 'wed'],
  ['thursday', 'thu', 'thur', 'thurs'],
  ['friday', 'fri'],
  ['saturday', 'sat'],
  ['sunday', 'sun'],
  ['next week', 'the coming week', 'following week'],
  ['this week', 'within the week', 'the week'],
  ['next month', 'the coming month'],
];

interface PositionFamily {
  name: string;
  pattern: RegExp;
  evidence: Alternatives;
}

/**
 * Stated positions, written as they are actually typed (Singlish included). Each family maps to
 * the professional vocabulary a faithful rewrite would use for the same position.
 */
const POSITION_FAMILIES: readonly PositionFamily[] = [
  {
    name: 'time-shortage',
    pattern:
      /\b(?:where got (?:enough |so much |the )?time|got no time|no time|not enough time|dont have (?:enough |the )?time|so little time|too (?:rush|rushed|tight|short)|rushing|cannot make it(?: in time)?|cant make it|no way (?:can|to|i can|we can) finish|how to finish|(?:this |the )?deadline is impossible|impossible deadline|not possible in time|need more time|short notice|last minute|cannot finish (?:in time|by then)|wont be able to finish)\b/,
    evidence: [
      'more time',
      'longer',
      'extension',
      'extend',
      'additional time',
      'extra time',
      'not enough time',
      'insufficient time',
      'tight',
      'not feasible',
      'unable to meet',
      'unable to complete',
      'unable to deliver',
      'cannot meet',
      'cannot complete',
      'cannot deliver',
      'will not be able',
      'wont be able',
      'realistic timeline',
      'revisit the timeline',
      'adjust the deadline',
      'adjust the timeline',
      'push back',
      'reschedule',
      'later date',
      'timeline',
      'short notice',
      'not possible',
      'impossible',
    ],
  },
  {
    name: 'impossible',
    pattern:
      /\b(?:impossible|cannot|cant|no way|not possible|wont work|not doable|cannot be done|not feasible|out of the question|confirm cannot|sure cannot|how can|cannot la|cannot lah|cannot leh)\b/,
    evidence: [
      'not feasible',
      'not possible',
      'not achievable',
      'not realistic',
      'not viable',
      'unable',
      'cannot',
      'impossible',
      'will not be able',
      'wont be able',
      'not in a position',
      'challenging',
      'difficult',
      'concern',
      'unlikely',
      'beyond',
      'constraints',
    ],
  },
  {
    name: 'disagree',
    pattern:
      /\b(?:disagree|dont agree|do not agree|not agree|doesnt make sense|does not make sense|makes no sense|no sense|nonsense|wrong|not right|not correct|incorrect|mistake|error|bug)\b/,
    evidence: [
      'disagree',
      'differ',
      'not convinced',
      'concern',
      'reconsider',
      'respectfully',
      'different view',
      'not correct',
      'not accurate',
      'not right',
      'incorrect',
      'mistake',
      'error',
      'bug',
      'revisit',
      'may not be',
      'unsure',
      'question',
      'issue',
    ],
  },
  {
    name: 'unacceptable',
    pattern:
      /\b(?:unacceptable|not acceptable|not ok|not okay|cannot accept|cant accept|not good enough|too much|too many|overloaded|over capacity|burnt out|burned out|overworked|cannot take it|cannot cope|cant cope)\b/,
    evidence: [
      'unacceptable',
      'not acceptable',
      'cannot accept',
      'serious',
      'concern',
      'must be addressed',
      'too much',
      'beyond capacity',
      'at capacity',
      'stretched',
      'workload',
      'overloaded',
      'bandwidth',
      'sustainable',
      'burnout',
      'not in a position',
      'not able to take on',
      'unable to take on',
      'below the standard',
      'not meet',
    ],
  },
  {
    name: 'scope',
    pattern:
      /\b(?:scope (?:doubled|tripled|increased|changed|crept|creep|grew|expanded|keep changing|keeps changing)|scope creep|keep adding|kept adding|keeps adding|more work|extra work|additional work|added more|out of scope|not in scope|wasnt in scope|never agreed|didnt agree to)\b/,
    evidence: [
      'scope',
      'doubled',
      'increased',
      'expanded',
      'grown',
      'additional work',
      'extra work',
      'more work',
      'beyond what was agreed',
      'original',
      'originally agreed',
      'added requirements',
      'new requirements',
      'change in requirements',
      'additional requirements',
    ],
  },
  {
    name: 'escalation',
    pattern:
      /\b(?:or we escalate|escalate|escalation|last warning|final warning|consequences|or else|not tolerate|wont tolerate|will be reported|written warning|fired|terminate|termination)\b/,
    evidence: [
      'escalat',
      'warning',
      'consequence',
      'serious',
      'report',
      'formal',
      'hr',
      'management',
      'further action',
      'next step',
      'performance',
      'raised',
    ],
  },
  {
    name: 'resources',
    pattern:
      /\b(?:need (?:more )?(?:help|people|manpower|resources|budget|headcount|support|hands)|short of (?:manpower|people|hands|staff)|understaffed|not enough (?:people|manpower|resources|budget|hands|staff)|no budget|no manpower)\b/,
    evidence: [
      'help',
      'support',
      'resources',
      'manpower',
      'headcount',
      'additional people',
      'additional staff',
      'additional team',
      'assistance',
      'budget',
      'staffing',
      'understaffed',
      'capacity',
      'resourcing',
    ],
  },
];

/** Words that carry no substance in an ask ("get this done" -> "done"). */
const ASK_STOPWORDS = new Set([
  'this',
  'it',
  'that',
  'the',
  'a',
  'an',
  'to',
  'me',
  'us',
  'them',
  'you',
  'u',
  'please',
  'pls',
  'plz',
  'kindly',
  'get',
  'make',
  'sure',
  'just',
  'all',
  'also',
  'again',
  'now',
  'then',
  'already',
  'can',
  'one',
  'and',
  'or',
  'of',
  'for',
  'with',
  'in',
  'is',
  'be',
  'go',
  'do',
  'sia',
  'lah',
  'la',
  'lor',
  'leh',
  'meh',
  'hor',
  'liao',
  'ah',
  'eh',
  'ya',
  'yah',
  'i',
  'we',
  'my',
  'our',
  'your',
  'so',
  'very',
  'really',
  'some',
  'more',
  'up',
]);

/** Synonym classes for the content words of an ask; a word not listed falls back to stems. */
const ASK_SYNONYMS: readonly Alternatives[] = [
  [
    'done',
    'finish',
    'finished',
    'complete',
    'completed',
    'completion',
    'deliver',
    'delivered',
    'wrap up',
    'do this',
    'do it',
    'do so',
    'do that',
    'carry out',
    'carried out',
    'handle',
    'ready',
    'close out',
    'closed',
  ],
  [
    'fix',
    'fixed',
    'resolve',
    'resolved',
    'address',
    'addressed',
    'repair',
    'correct',
    'sort out',
    'rectify',
  ],
  ['send', 'share', 'forward', 'provide', 'pass', 'circulate', 'submit', 'deliver', 'attach'],
  [
    'check',
    'verify',
    'confirm',
    'review',
    'look into',
    'look at',
    'take a look',
    'go through',
    'double check',
  ],
  ['reply', 'respond', 'revert', 'get back', 'response', 'answer', 'feedback'],
  ['update', 'inform', 'let me know', 'let us know', 'brief', 'keep me posted', 'status'],
  [
    'time',
    'longer',
    'extension',
    'extend',
    'more time',
    'while longer',
    'additional time',
    'extra time',
  ],
  ['help', 'assist', 'support', 'assistance', 'hand'],
  ['approve', 'approval', 'sign off', 'sign-off', 'green light', 'go ahead', 'clearance'],
  ['call', 'ring', 'phone', 'speak', 'chat', 'discuss', 'talk', 'meet', 'meeting'],
  ['stop', 'cease', 'hold off', 'pause', 'refrain', 'no longer'],
  ['change', 'revise', 'amend', 'adjust', 'modify', 'edit', 'rework'],
  ['pay', 'payment', 'reimburse', 'settle', 'invoice'],
];

function synonymGroup(word: string): Alternatives {
  const target = stem(word);
  const group = ASK_SYNONYMS.find((alts) =>
    alts.some((a) => a.split(' ').length === 1 && stem(a) === target),
  );
  return group ?? [word];
}

// ---------------------------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------------------------

function overlaps(a: { start: number; end: number }, items: readonly Extracted[]): boolean {
  return items.some((b) => a.start < b.end && b.start < a.end);
}

function pushMatches(
  text: string,
  pattern: RegExp,
  build: (match: RegExpExecArray) => Extracted | null,
  into: Extracted[],
  blockers: readonly Extracted[] = [],
): void {
  const re = new RegExp(
    pattern.source,
    pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`,
  );
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match[0] === '') {
      re.lastIndex += 1;
      continue;
    }
    const item = build(match);
    if (item !== null && !overlaps(item, into) && !overlaps(item, blockers)) {
      into.push(item);
    }
  }
}

function deadlineRequirement(core: string): Alternatives {
  const cls = DEADLINE_CLASSES.find((alts) => alts.includes(core));
  return cls ?? [core];
}

function extractDeadlines(n: string, into: Extracted[]): void {
  // Explicit dates: 18/9, 18-09-2026, 2026-09-18, 18 sep, sept 18, 18th september.
  const datePatterns = [
    /\b\d{4}-\d{1,2}-\d{1,2}\b/,
    /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/,
    new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)? (?:of )?(?:${MONTH})\\b`),
    new RegExp(`\\b(?:${MONTH}) \\d{1,2}(?:st|nd|rd|th)?\\b`),
  ];
  for (const p of datePatterns) {
    pushMatches(
      n,
      p,
      (m) => ({
        kind: 'deadline',
        text: m[0],
        start: m.index,
        end: m.index + m[0].length,
        requires: [[m[0].replace(/(st|nd|rd|th)\b/, '')]],
      }),
      into,
    );
  }
  // Clock times with a deadline preposition: "by 3pm", "before 17:00".
  pushMatches(
    n,
    new RegExp(`\\b(?:${DEADLINE_PREP}) (\\d{1,2}(?::\\d{2})?(?:am|pm)?)\\b`),
    (m) => {
      const t = m[1] ?? '';
      if (!/am|pm|:/.test(t)) {
        return null;
      }
      return {
        kind: 'deadline',
        text: m[0],
        start: m.index,
        end: m.index + m[0].length,
        requires: [[t]],
      };
    },
    into,
  );
  // Relative windows: "within 2 days", "in 3 hours".
  pushMatches(
    n,
    new RegExp(`\\b(?:within|in|inside|over) (?:the )?(?:next )?(\\d+) (${TIME_UNIT})\\b`),
    (m) => ({
      kind: 'deadline',
      text: m[0],
      start: m.index,
      end: m.index + m[0].length,
      requires: [[m[1] ?? ''], [stem(m[2] ?? '')]],
    }),
    into,
  );
  // Day words and named deadlines, with or without a preposition.
  const dayCore = `tomorrow|tmr|tmrw|today|tdy|tonight|tonite|eod|eow|eom|cob|asap|end of (?:the )?(?:day|week|month)|as soon as possible|next (?:week|month|${WEEKDAY_FULL}|${WEEKDAY_ABBR})|this (?:week|afternoon|evening|morning|${WEEKDAY_FULL}|${WEEKDAY_ABBR})|${WEEKDAY_FULL}`;
  pushMatches(
    n,
    new RegExp(`\\b(?:(?:${DEADLINE_PREP}) )?(${dayCore})\\b`),
    (m) => {
      const core = (m[1] ?? '').replace(/^(?:next|this) /, '');
      const requires: Alternatives[] = [deadlineRequirement(core)];
      if ((m[1] ?? '').startsWith('next ')) {
        requires.push(['next', 'coming', 'following', 'upcoming']);
      }
      return { kind: 'deadline', text: m[0], start: m.index, end: m.index + m[0].length, requires };
    },
    into,
  );
  // Weekday abbreviations only when a preposition makes them unambiguous ("we sat" is not Saturday).
  pushMatches(
    n,
    new RegExp(`\\b(?:${DEADLINE_PREP}) (${WEEKDAY_ABBR})\\b`),
    (m) => ({
      kind: 'deadline',
      text: m[0],
      start: m.index,
      end: m.index + m[0].length,
      requires: [deadlineRequirement(m[1] ?? '')],
    }),
    into,
  );
}

function extractConstraints(n: string, into: Extracted[], blockers: readonly Extracted[]): void {
  // Quantity ceilings and floors: "only 2 people", "at most 3", "no more than 5", "at least 2 days".
  pushMatches(
    n,
    new RegExp(
      `\\b(only|at most|no more than|not more than|max|maximum|maximum of|up to|capped at|at least|minimum|minimum of|no less than|not less than|no later than|not later than) ([$€£]?\\d[\\d.]*%?)(?: (${TIME_UNIT}|people|pax|persons?|staff|members?|items?|units?|pages?|rounds?|times?|slots?))?\\b`,
    ),
    (m) => {
      const quantifier = m[1] ?? '';
      const ceiling =
        /^(only|at most|no more than|not more than|max|maximum|maximum of|up to|capped at|no later than|not later than)$/.test(
          quantifier,
        );
      const requires: Alternatives[] = [
        [m[2] ?? ''],
        ceiling
          ? [
              'only',
              'just',
              'no more than',
              'not more than',
              'at most',
              'maximum',
              'max',
              'limited to',
              'cap',
              'capped',
              'up to',
              'no later than',
              'not later than',
              'latest',
              'ceiling',
              'within',
            ]
          : ['at least', 'minimum', 'no less than', 'not less than', 'or more', 'a minimum of'],
      ];
      if (m[3] !== undefined) {
        requires.push([stem(m[3])]);
      }
      return {
        kind: 'constraint',
        text: m[0],
        start: m.index,
        end: m.index + m[0].length,
        requires,
      };
    },
    into,
    blockers,
  );
  // Absences: "no budget", "without approval", "no extra headcount", "cannot exceed the budget".
  pushMatches(
    n,
    /\b(?:no|without|zero|cannot exceed|must not exceed|not allowed|no more) (?:extra |additional |more |further |any )?(budget|approval|headcount|overtime|ot|manpower|resources|funding|access|permission|support|weekend|weekends|leave|exceptions?|delay|delays|changes?|excuses?)\b/,
    (m) => ({
      kind: 'constraint',
      text: m[0],
      start: m.index,
      end: m.index + m[0].length,
      requires: [
        [stem(m[1] ?? '')],
        [
          'no',
          'not',
          'without',
          'cannot',
          'unable',
          'lack',
          'absence',
          'none',
          'zero',
          'exceed',
          'limited',
        ],
      ],
    }),
    into,
    blockers,
  );
  // Preconditions: "unless X", "only if X" — X must survive as a whole phrase (stems).
  pushMatches(
    n,
    /\b(?:unless|only if|provided that|on condition that) ((?:\w+ ?){1,5}?)(?=\b(?:by|before|then|and|or|but|so|because)\b|$)/,
    (m) => {
      const words = contentWords(m[1] ?? '');
      if (words.length === 0) {
        return null;
      }
      return {
        kind: 'constraint',
        text: m[0].trim(),
        start: m.index,
        end: m.index + m[0].length,
        requires: words.map((w) => synonymGroup(w)),
      };
    },
    into,
    blockers,
  );
}

function contentWords(phrase: string): string[] {
  return phrase
    .split(' ')
    .filter((w) => w !== '' && !ASK_STOPWORDS.has(w) && !/^\d/.test(w))
    .slice(0, 4);
}

/** Cut an ask at the point where a deadline, condition or clause boundary starts. */
function trimAskTail(phrase: string): string {
  return phrase
    .replace(/\s*\|.*$/, '')
    .replace(
      /(?:^|\s+)(?:by|before|until|till|on|latest|within|in|unless|because|cos|coz|since|so|then|and|or|tomorrow|tmr|tmrw|today|tdy|tonight|eod|eow|eom|cob|asap)\b.*$/,
      '',
    )
    .trim();
}

const IMPERATIVE_VERBS =
  'send|fix|finish|complete|submit|update|review|approve|reply|revert|confirm|check|stop|share|forward|pay|call|prepare|schedule|cancel|remove|add|include|resend|redo|rerun|deliver|hand in|get';

function extractAsks(n: string, into: Extracted[]): void {
  const stop =
    'by|before|until|till|on|latest|within|unless|because|cos|coz|since|so|then|and|or|tomorrow|tmr|tmrw|today|tdy|tonight|eod|eow|eom|cob|asap';
  const verbPhrase = `((?:\\w+ ?){1,6}?)(?=\\s*(?:${stop}|\\||$))`;
  const object = 'it|this|that|the|them|these|those|me|us|all|everything|your|my|our|a|an|one';
  const patterns = [
    new RegExp(`\\b(?:please|pls|plz|kindly) (?:help me |help to |help )?${verbPhrase}`),
    new RegExp(
      `\\b(?:you|u|they|he|she|everyone|all of you) (?:all )?(?:need to|have to|must|got to|gotta|should|better|are to|have got to|needa) ${verbPhrase}`,
    ),
    new RegExp(
      `\\b(?:can|could|would|will|mind to|help me) (?:you|u) (?:please |pls |kindly |help me |help to |help )?${verbPhrase}`,
    ),
    new RegExp(
      `\\b(?:i|we) (?:need|want|require|would like|need you to|want you to|expect you to|ask that you) ${verbPhrase}`,
    ),
    new RegExp(`\\b(?:need|want|require) (?:this|it|them|these|that) (?:to be )?${verbPhrase}`),
    // Singlish drops the subject: "can send me by tmr?", "could help check?".
    new RegExp(
      `\\b(?:can|could) (?:please |pls |kindly |help me |help to |help )?(${IMPERATIVE_VERBS}) ${verbPhrase}`,
    ),
    // A bare imperative with an object anywhere in the text: "fix it by friday".
    new RegExp(
      `\\b(?:just |quickly |go and |go )?(${IMPERATIVE_VERBS}) ((?:${object}) ?(?:\\w+ ?){0,5}?)(?=\\s*(?:${stop}|\\||$))`,
    ),
  ];
  for (const p of patterns) {
    pushMatches(
      n,
      p,
      (m) => {
        const captured = m.length > 2 ? `${m[1] ?? ''} ${m[2] ?? ''}` : (m[1] ?? '');
        const phrase = trimAskTail(captured);
        const words = contentWords(phrase);
        if (words.length === 0) {
          return null;
        }
        return {
          kind: 'ask',
          text: m[0].trim(),
          start: m.index,
          end: m.index + m[0].length,
          requires: words.map((w) => synonymGroup(w)),
        };
      },
      into,
    );
  }
}

function extractNumbers(n: string, into: Extracted[], blockers: readonly Extracted[]): void {
  pushMatches(
    n,
    new RegExp(
      `(?<![a-z0-9$€£])([$€£]?\\d[\\d.]*(?:%|am|pm|k|m|x)?)(?: (?:more|extra|additional|full|whole|working|business|new))?(?: (${TIME_UNIT}|pax|people|persons?|percent|dollars?|bucks|k|units?|items?|pages?|rounds?|times?|slides?|tickets?|bugs?|issues?|files?|versions?|members?|staff))?(?![a-z0-9])`,
    ),
    (m) => {
      const core = (m[1] ?? '').replace(/\.$/, '');
      const requires: Alternatives[] = [[core]];
      if (m[2] !== undefined) {
        requires.push([stem(m[2])]);
      }
      return { kind: 'number', text: m[0], start: m.index, end: m.index + m[0].length, requires };
    },
    into,
    blockers,
  );
}

function extractPositions(n: string, into: Extracted[]): void {
  for (const family of POSITION_FAMILIES) {
    pushMatches(
      n,
      family.pattern,
      (m) => ({
        kind: 'position',
        text: m[0],
        start: m.index,
        end: m.index + m[0].length,
        requires: [family.evidence],
      }),
      into,
    );
  }
}

/**
 * Extract the substance of `input`: deadlines, constraints, asks, numbers and stated positions,
 * in that order of precedence when spans overlap. Deterministic. Exported for tests.
 */
export function extractSubstance(input: string): SubstanceItem[] {
  return extractDetailed(input).map(({ kind, text }) => ({ kind, text }));
}

function extractDetailed(input: string): Extracted[] {
  const n = tokenise(input);
  const deadlines: Extracted[] = [];
  extractDeadlines(n, deadlines);
  const constraints: Extracted[] = [];
  extractConstraints(n, constraints, deadlines);
  // Asks may legitimately span a number or a deadline ("need 2 days by friday"), so they are
  // extracted independently and each layer keeps its own span bookkeeping.
  const asks: Extracted[] = [];
  extractAsks(n, asks);
  const numbers: Extracted[] = [];
  extractNumbers(n, numbers, [...deadlines, ...constraints]);
  const positions: Extracted[] = [];
  extractPositions(n, positions);
  return [...deadlines, ...constraints, ...asks, ...numbers, ...positions].sort(
    (a, b) => a.start - b.start || a.end - b.end,
  );
}

// ---------------------------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------------------------

function satisfied(outputNormalised: string, requires: readonly Alternatives[]): boolean {
  const words = outputNormalised.split(' ');
  return requires.every((group) =>
    group.some((alt) => {
      if (alt === '') {
        return false;
      }
      if (alt.includes(' ') || /\d/.test(alt)) {
        return containsPhrase(outputNormalised, alt);
      }
      return (
        containsPhrase(outputNormalised, alt) ||
        containsStem(outputNormalised, alt) ||
        (alt.length >= 5 && words.some((w) => w.startsWith(alt)))
      );
    }),
  );
}

function sameItem(a: SubstanceItem, b: SubstanceItem): boolean {
  return a.kind === b.kind && normalise(a.text) === normalise(b.text);
}

/**
 * Compare `input` and `output` and report any substance that did not survive.
 *
 * `reported` is what the model claims it carried over, each with the output phrase carrying
 * it; a claim is honoured only when that phrase really occurs in the output. Items are missing
 * when either the heuristic layer or the verified model report says so.
 */
export function substanceCheck(
  input: string,
  output: string,
  reported: readonly ReportedSubstance[] = [],
): SubstanceReport {
  const out = normalise(output);
  const found: SubstanceItem[] = [];
  const missing: SubstanceItem[] = [];

  for (const item of extractDetailed(input)) {
    const plain: SubstanceItem = { kind: item.kind, text: item.text };
    found.push(plain);
    if (!satisfied(out, item.requires)) {
      missing.push(plain);
    }
  }

  for (const r of reported) {
    if (typeof r.text !== 'string' || r.text.trim() === '') {
      continue;
    }
    const plain: SubstanceItem = { kind: r.kind, text: r.text.trim() };
    const carried =
      typeof r.carriedBy === 'string' &&
      r.carriedBy.trim() !== '' &&
      containsPhrase(out, r.carriedBy);
    if (!found.some((f) => sameItem(f, plain))) {
      found.push(plain);
    }
    if (!carried && !missing.some((m) => sameItem(m, plain))) {
      missing.push(plain);
    }
  }

  return { ok: missing.length === 0, found, missing };
}

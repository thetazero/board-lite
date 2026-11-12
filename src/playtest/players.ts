// A Claude seat's configuration: its model and the options switched on for it,
// written as one --models entry like "opus+advice+expected". Contests put
// differently configured Claude players against each other and batch.ts
// tallies wins per configuration, the way it tallies them per model. See
// "Contests between configurations" in docs/playtest.md.
//
// A seat with no options is the plain Claude player: no advice, and the view
// as it was before #469. To add an option: name it in OPTIONS, then read it
// where it applies (run.ts for the prompt, seat-server.ts for the view).

import { readFileSync } from 'node:fs';

/** The fixed advice +fable51 gives a seat, exactly as the user wrote it (#479). */
export const FABLE_5_1_ADVICE = readFileSync(new URL('./advice/fable-5-1.txt', import.meta.url), 'utf8').trimEnd();

/** The advice appended to a seat's prompt: --advice for +advice, the fixed text for +fable51, each in its own block. */
export function seatAdvice(options: readonly PlayerOption[], advice: string | undefined): string {
  const parts = [
    ...(advice && options.includes('advice') ? [`Advice: ${advice}`] : []),
    ...(options.includes('fable51') ? [`Advice:\n\n${FABLE_5_1_ADVICE}`] : []),
  ];
  return parts.map((x) => `\n\n${x}`).join('');
}

export const OPTIONS = {
  advice: 'the --advice text is appended to its prompt',
  fable51: 'the "advice from Fable 5.1" (src/playtest/advice/fable-5-1.txt) is appended to its prompt, word for word',
  expected: "its view shows each player's expected production each round and what they made at the latest roll (#469)",
} as const;

export type PlayerOption = keyof typeof OPTIONS;

export interface PlayerSpec {
  model: string; // a claude --model alias or name, codex:<model>, "bot" (the random bot), "strongbot" (src/strongbot.ts) or person:<name>
  options: PlayerOption[]; // in OPTIONS order, so the same configuration always gets the same label
  label: string; // "opus+advice+expected": what results.json and the batch's tallies call it
}

/** Reads one --models entry: a model, then "+option" for each option switched on. */
export function parseSpec(entry: string): PlayerSpec {
  const [model, ...given] = entry.trim().split('+').map((x) => x.trim());
  if (!model) throw new Error(`"${entry}" names no model; a seat looks like opus or opus+advice+expected.`);
  for (const o of given) {
    if (!(o in OPTIONS)) throw new Error(`"${o}" in "${entry}" isn't a Claude player option. The options: ${optionList()}.`);
  }
  if (isBot(model) && given.length) throw new Error(`A bot takes no options ("${entry}").`);
  if (isPerson(model)) {
    if (given.length) throw new Error(`A person takes no options ("${entry}").`);
    if (!personName(model)) throw new Error(`"${entry}" names no one; a person's seat looks like person:Lesha.`);
  }
  const options = (Object.keys(OPTIONS) as PlayerOption[]).filter((o) => given.includes(o));
  return { model, options, label: [model, ...options].join('+') };
}

/** A seat the server plays, no Claude: the random bot or the strong bot. */
export const isBot = (model: string) => model === 'bot' || model === 'strongbot';

/** A seat a person plays, on their phone: person:<the name they play under>. */
export const isPerson = (entry: string) => entry.startsWith('person:');
export const personName = (entry: string) => entry.slice('person:'.length).trim();

/** A seat played by an AI model (Claude or Codex), which takes a slot from the seat pool: not a bot, not a person. */
export const isAi = (entry: string) => { const model = entry.split('+')[0]; return !isBot(model) && !isPerson(model); };

/** What a game's results.json calls the seat of a --models entry: its label, or "player: <name>" for a person. */
export const resultsLabel = (entry: string) => (isPerson(entry) ? `player: ${personName(entry)}` : parseSpec(entry).label);

export const optionList = () => Object.entries(OPTIONS).map(([k, v]) => `+${k} (${v})`).join(', ');

/**
 * The seats of a game from --models and --advice. An --advice given with no
 * seat naming +advice goes to every Claude seat, as it did before seats had
 * options; +advice with no --advice has nothing to append.
 */
export function parseSeats(models: string[], advice: string | undefined): PlayerSpec[] {
  const specs = models.map(parseSpec);
  const anyAdvice = specs.some((s) => s.options.includes('advice'));
  if (anyAdvice && advice === undefined) throw new Error('A seat has +advice, so give the advice with --advice TEXT.');
  if (advice !== undefined && !anyAdvice) return specs.map((s) => (isBot(s.model) || isPerson(s.model) ? s : parseSpec(`${s.label}+advice`)));
  return specs;
}

// A Claude seat's configuration: its model and the options switched on for it,
// written as one --models entry like "opus+advice+expected". Contests put
// differently configured Claude players against each other and batch.ts
// tallies wins per configuration, the way it tallies them per model. See
// "Contests between configurations" in docs/playtest.md.
//
// A seat with no options is the plain Claude player: no advice, and the view
// as it was before #469. To add an option: name it in OPTIONS, then read it
// where it applies (run.ts for the prompt, seat-server.ts for the view).

export const OPTIONS = {
  advice: 'the --advice text is appended to its prompt',
  expected: "its view shows each player's expected production each round and what they made at the latest roll (#469)",
} as const;

export type PlayerOption = keyof typeof OPTIONS;

export interface PlayerSpec {
  model: string; // a claude --model alias or name, "bot" (the random bot) or "strongbot" (src/strongbot.ts)
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
  const options = (Object.keys(OPTIONS) as PlayerOption[]).filter((o) => given.includes(o));
  return { model, options, label: [model, ...options].join('+') };
}

/** A seat the server plays, no Claude: the random bot or the strong bot. */
export const isBot = (model: string) => model === 'bot' || model === 'strongbot';

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
  if (advice !== undefined && !anyAdvice) return specs.map((s) => (isBot(s.model) ? s : parseSpec(`${s.label}+advice`)));
  return specs;
}

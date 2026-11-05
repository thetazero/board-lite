// All content and tuning numbers live here. Numbers are first guesses, to be
// tuned by playtests (see docs/design.md, open questions).
// docs/datasheet.md lists these numbers as the raw rules. After changing any, run `npm run datasheet` and read the
// diff; `npm test` fails until it is regenerated.

// The basic resources are the ones basic buildings make and the merchants trade; gold is neither (#279).
export const BASIC_RESOURCES = ['stone', 'timber', 'crystal', 'livestock'] as const;
export type BasicResource = (typeof BASIC_RESOURCES)[number];
export const RESOURCES = [...BASIC_RESOURCES, 'gold'] as const;
export type Resource = (typeof RESOURCES)[number];
export type Bundle = Partial<Record<Resource, number>>;

export const ELEMENTS = ['fire', 'ice', 'lightning', 'air', 'water'] as const;
export type Element = (typeof ELEMENTS)[number];
// The element wheel, for everything that fights (#223): dragons, raid
// defenders, fauna and great beasts each have an element, and each element
// beats exactly one other. A hit from an element that beats what it hits deals
// double damage, whichever side struck, dragons fighting dragons too. That is
// the only element effect: nothing deals half. Neutral beats nothing and
// nothing beats it.
export const UNIT_ELEMENTS = [...ELEMENTS, 'neutral'] as const;
export type UnitElement = (typeof UNIT_ELEMENTS)[number];
// water → fire → ice → air → lightning → water
export const ELEMENT_BEATS: Record<Element, Element> = { water: 'fire', fire: 'ice', ice: 'air', air: 'lightning', lightning: 'water' };
// What each element is weak to: the elements that beat it.
export const ELEMENT_WEAK: Record<UnitElement, Element[]> = Object.fromEntries(
  UNIT_ELEMENTS.map((e) => [e, ELEMENTS.filter((by) => ELEMENT_BEATS[by] === e)]),
) as Record<UnitElement, Element[]>;
// Damage after elements: what `by` deals to something of element `to`.
export function elementalDamage(dmg: number, by: UnitElement, to: UnitElement): number {
  return by !== 'neutral' && ELEMENT_BEATS[by] === to ? dmg * 2 : dmg;
}

export const TERRAINS = ['mountain', 'forest', 'ley', 'meadow', 'plains', 'harbor', 'ocean'] as const;
export type Terrain = (typeof TERRAINS)[number];
// How text names one hex of a terrain ("a mountain hex", "a crystal field hex"). Terrain
// is a hex, so "meadow hex" can't be read as the building on it (#150).
export const TERRAIN_NOUN: Record<Terrain, string> = {
  mountain: 'mountain hex', forest: 'forest hex', ley: 'crystal field hex', meadow: 'meadow hex', plains: 'plains hex', harbor: 'harbor hex', ocean: 'ocean hex',
};
// "a, b or c": how card text lists choices.
export const orList = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs.at(-1)}`);

export const TUNING = {
  pointsToWin: 30,
  handCap: 7,
  // Each round a player draws this many building cards and keeps one.
  buildingCardsDrawn: 2,
  actionCardsPerRound: 1,
  startingResources: { stone: 3, timber: 3, crystal: 3, livestock: 3 } as Bundle,
  // The tower produces this every round, no dice.
  towerProduction: { stone: 1, timber: 1, crystal: 1, livestock: 1 } as Bundle,
  bankRate: 4,
  livestockPerDragon: 1,
  // Dragons are worth no points; they count toward Strongest Dragon Army.
  titlePoints: 6,
  // A title needs at least this much: dragons' combat power, tower floors,
  // gold. The army's is about 3 adults and a hatchling, as 10 dragon points
  // were (#134). The hoard's was a Monument's gold when Monuments cost gold
  // (#109).
  titleMinimum: { army: 55, tower: 4, hoard: 20 },
  // A hurt dragon heals this much health at each production it's fed,
  // instead of growing. It fights hurt; only a knocked-out one can't, and
  // one fed production brings it back.
  healPerRound: 7,
  towerDragonCapacity: 1,
  // Each player's starting base dragon begins at this life stage (0 egg).
  startingDragonStage: 0,
  // The base-egg special project costs this many times the base dragon card.
  specialProjectMultiplier: 2,
  // The starting map has one fauna for every this many land hexes (src/map.ts).
  landHexesPerFauna: 8,
  // In production, each beast of the fauna (not a great beast) has a 1 in this
  // many chance to move to a random adjacent land hex with no tower or beast.
  faunaWanderOdds: 3,
  // A wandering beast is this many times as likely to pick an open hex beside
  // no other beast as one beside a beast, so the fauna tends to spread out.
  faunaSpreadWeight: 2,
  // Once the Thunderbird falls, each production building on or next to its
  // peak (the centre hex) makes this many more a round.
  peakBonus: 2,
};

// A building's class is what upgrades and other buildings' effects refer to.
// The four resource classes each hold a basic building and the special
// buildings that make the same resource.
export const CLASSES = ['quarry', 'lumber', 'mine', 'pasture', 'dragon', 'monument', 'trade'] as const;
export type BuildingClass = (typeof CLASSES)[number];
// How card text names one building of a class. A class is always a "building",
// and the four resource classes are named for what they make, so a card that
// counts buildings never reads like one that counts terrain ("livestock
// building", not "pasture", next to "meadow hex"; #150).
export const CLASS_NAMES: Record<BuildingClass, string> = {
  quarry: 'stone building', lumber: 'timber building', mine: 'crystal building', pasture: 'livestock building', dragon: 'dragon building', monument: 'monument', trade: 'trade building',
};
// The tower is a monument (it holds floors) and a dragon building (it houses one).
export const TOWER_CLASSES: BuildingClass[] = ['monument', 'dragon'];

// What a building's effect counts among its six neighbouring hexes: buildings
// of a class (whoever owns them), or hexes of a terrain (built on or not).
export type Counted = BuildingClass | Terrain;

export interface BuildingDef {
  name: string;
  class: BuildingClass;
  cost: Bundle;
  text: string;
  basic?: boolean; // anyone may build it without a card
  copies?: number; // cards in the building deck (not basic buildings)
  terrain?: Terrain; // must go on this terrain
  onTower?: boolean; // stacks on your tower hex instead of taking a hex
  // Effects. With `per`, each is multiplied by the number of neighbouring
  // hexes that match it, counted fresh whenever it matters.
  produces?: { resource: Resource; base: number; die: number }; // a die rolled each round
  makes?: Bundle; // each round, no dice
  points?: number; // flat, never multiplied by `per`
  beside?: Counted; // must be built adjacent to at least one of these
  dragonCapacity?: number;
  growthBonus?: number;
  bankRate?: { resource: BasicResource; rate: number }; // a better merchants' rate for one resource you give
  per?: Counted;
}

const terrainMaker = (name: string, cls: BuildingClass, r: Resource, per: Terrain, cost: Bundle, copies: number, noun = TERRAIN_NOUN[per]): BuildingDef =>
  ({ name, class: cls, cost, makes: { [r]: 1 }, per, copies, points: 1, text: `Makes 1 ${r} each round for each adjacent ${noun}; worth 1 point.` });
const classMaker = (name: string, cls: BuildingClass, r: Resource, per: BuildingClass, cost: Bundle, copies: number): BuildingDef =>
  ({ name, class: cls, cost, makes: { [r]: 1 }, per, copies, points: 1, text: `Makes 1 ${r} each round for each adjacent ${CLASS_NAMES[per]}; worth 1 point.` });

// A port trades one basic resource with the merchants at 2:1 (#277), in place of
// the generic 3:1 Port: one card each, gold has none.
const portCard = (r: BasicResource): BuildingDef =>
  ({ name: `${r[0].toUpperCase()}${r.slice(1)} Port`, class: 'trade', cost: { timber: 6, stone: 2, livestock: 2 }, terrain: 'harbor', bankRate: { resource: r, rate: 2 }, text: `You trade ${r} with the merchants at 2:1.`, copies: 1 });

export const BUILDINGS: Record<string, BuildingDef> = {
  // Basic buildings: no card needed.
  quarry: { name: 'Quarry', class: 'quarry', basic: true, cost: { timber: 4, livestock: 3, crystal: 4 }, terrain: 'mountain', produces: { resource: 'stone', base: 0, die: 4 }, points: 1, text: 'Makes 1d4 stone each round; worth 1 point.' },
  lumber_camp: { name: 'Lumber Camp', class: 'lumber', basic: true, cost: { stone: 4, crystal: 4, livestock: 3 }, terrain: 'forest', produces: { resource: 'timber', base: 0, die: 4 }, points: 1, text: 'Makes 1d4 timber each round; worth 1 point.' },
  crystal_mine: { name: 'Crystal Mine', class: 'mine', basic: true, cost: { stone: 4, timber: 4, livestock: 3 }, terrain: 'ley', produces: { resource: 'crystal', base: 0, die: 4 }, points: 1, text: 'Makes 1d4 crystal each round; worth 1 point.' },
  pasture: { name: 'Pasture', class: 'pasture', basic: true, cost: { timber: 4, crystal: 4, stone: 3 }, terrain: 'meadow', produces: { resource: 'livestock', base: 0, die: 4 }, points: 1, text: 'Makes 1d4 livestock each round; worth 1 point.' },
  roost: { name: 'Roost', class: 'dragon', basic: true, cost: { stone: 4, timber: 4 }, dragonCapacity: 2, text: 'Houses 2 more dragons.' },
  // Worth no points itself: floors count only toward Tallest Tower, a side
  // quest and a sink for raid gold (#98).
  tower_floor: { name: 'Tower Floor', class: 'monument', basic: true, cost: { stone: 6, gold: 4 }, onTower: true, text: 'Adds a floor to your tower. Floors count toward Tallest Tower.' },
  // Building cards. Most count their neighbours.
  cliff_works: terrainMaker('Cliff Works', 'quarry', 'stone', 'mountain', { timber: 3, crystal: 3, livestock: 2 }, 2),
  stonemason: classMaker('Stonemason', 'quarry', 'stone', 'quarry', { timber: 3, crystal: 3, livestock: 2 }, 2),
  woodcutter: terrainMaker("Woodcutter's Hut", 'lumber', 'timber', 'forest', { stone: 3, crystal: 3, livestock: 2 }, 2),
  sawmill: classMaker('Sawmill', 'lumber', 'timber', 'lumber', { stone: 3, crystal: 3, livestock: 2 }, 2),
  driftwood_yard: terrainMaker('Driftwood Yard', 'lumber', 'timber', 'ocean', { stone: 4, crystal: 3, livestock: 3 }, 1),
  ley_spire: terrainMaker('Crystal Spire', 'mine', 'crystal', 'ley', { stone: 3, timber: 3, livestock: 2 }, 2),
  gem_cutter: classMaker('Gem Cutter', 'mine', 'crystal', 'mine', { stone: 3, timber: 3, livestock: 2 }, 2),
  smelter: classMaker('Smelter', 'mine', 'crystal', 'quarry', { timber: 3, stone: 2, livestock: 3 }, 1),
  shepherds_fold: terrainMaker("Shepherd's Fold", 'pasture', 'livestock', 'meadow', { stone: 3, timber: 3, crystal: 2 }, 2),
  drovers_barn: classMaker("Drovers' Barn", 'pasture', 'livestock', 'pasture', { timber: 3, crystal: 3, stone: 2 }, 2),
  fishery: terrainMaker('Fishery', 'pasture', 'livestock', 'ocean', { stone: 3, timber: 4, crystal: 3 }, 1),
  hatchery: { name: 'Hatchery', class: 'dragon', cost: { stone: 6, timber: 6, crystal: 6 }, growthBonus: 1, text: 'Your dragons grow 1 extra step each round.', copies: 2 },
  stone_port: portCard('stone'),
  timber_port: portCard('timber'),
  crystal_port: portCard('crystal'),
  livestock_port: portCard('livestock'),
  market: { name: 'Market', class: 'trade', cost: { stone: 6, timber: 6, crystal: 6, gold: 4 }, makes: { gold: 1 }, per: 'trade', text: 'Makes 1 gold each round for each adjacent trade building.', copies: 2 },
  // Point cards: a flat 2 points each, built adjacent to what they used to
  // count (#134). About 11 resources and no gold: 50% better at points than a
  // production card (8 resources, 1 point), the owner's call.
  monument: { name: 'Monument', class: 'monument', cost: { stone: 6, timber: 5 }, points: 2, beside: 'monument', text: 'Worth 2 points.', copies: 2 },
  standing_stones: { name: 'Standing Stones', class: 'monument', cost: { stone: 5, crystal: 6 }, points: 2, beside: 'ley', text: 'Worth 2 points.', copies: 2 },
  lighthouse: { name: 'Lighthouse', class: 'monument', cost: { stone: 7, timber: 4 }, points: 2, beside: 'ocean', text: 'Worth 2 points.', copies: 2 },
  guildhall: { name: 'Guildhall', class: 'monument', cost: { stone: 5, timber: 6 }, points: 2, beside: 'trade', text: 'Worth 2 points.', copies: 1 },
};

export const BASIC_BUILDINGS = Object.keys(BUILDINGS).filter((k) => BUILDINGS[k].basic);

export interface UpgradeDef {
  name: string;
  appliesTo: BuildingClass[];
  cost: Bundle;
  text: string;
  baseBonus?: number; // more of what the building makes
  dragonCapacity?: number;
  makes?: Bundle;
  copies: number;
}

export const UPGRADES: Record<string, UpgradeDef> = {
  workshop: { name: 'Workshop', appliesTo: ['quarry', 'lumber', 'mine', 'pasture'], cost: { timber: 4, stone: 4, crystal: 2 }, baseBonus: 2, text: 'This stone, timber, crystal or livestock building makes 2 more.', copies: 4 },
  nesting_grounds: { name: 'Nesting Grounds', appliesTo: ['dragon'], cost: { stone: 4, timber: 2 }, dragonCapacity: 2, text: 'This roost, hatchery or tower houses 2 more dragons.', copies: 3 },
  trade_charter: { name: 'Trade Charter', appliesTo: ['trade'], cost: { gold: 8, stone: 4 }, makes: { gold: 1 }, text: 'This port or market makes 1 more gold each round.', copies: 3 },
};

export type ActionEffect = 'gain_resource' | 'gain_gold' | 'grow_dragon' | 'heal_dragon' | 'extra_raid' | 'hidden_point' | 'send_fauna';

export interface ActionDef {
  name: string;
  effect: ActionEffect;
  amount?: number; // hidden_point: its points
  fauna?: string; // send_fauna: which beast, a FAUNA key
  cost: Bundle;
  text: string;
  copies: number;
}

// The action deck was doubled in #201 (with two of each dragon) so that adding
// one card doesn't swing the mix; Windfall was made rarer, not doubled.
export const ACTIONS: Record<string, ActionDef> = {
  windfall: { name: 'Windfall', effect: 'gain_resource', amount: 3, cost: {}, text: 'Gain 3 of one resource other than gold.', copies: 4 },
  treasure: { name: 'Buried Treasure', effect: 'gain_gold', amount: 2, cost: {}, text: 'Gain 2 gold.', copies: 10 },
  growth_elixir: { name: 'Growth Elixir', effect: 'grow_dragon', cost: { gold: 3 }, text: 'Grow one of your dragons to its next life stage.', copies: 10 },
  healing_potion: { name: 'Healing Potion', effect: 'heal_dragon', cost: {}, text: 'Fully heal one of your hurt dragons.', copies: 8 },
  war_horn: { name: 'War Horn', effect: 'extra_raid', cost: { crystal: 1 }, text: 'Hold 1 more raid this round.', copies: 6 },
  secret_hoard: { name: 'Secret Hoard', effect: 'hidden_point', amount: 2, cost: {}, text: 'Worth 2 points while in your hand.', copies: 4 },
  // Sabotage, kept rare and dear (the owner: "a bit of this just like in
  // catan, you just don't want to over do it").
  rouse_bear: { name: 'Rouse the Bear', effect: 'send_fauna', fauna: 'cave_bear', cost: { crystal: 1 }, text: 'Place a Cave Bear on any land hex with no tower or beast.', copies: 8 },
  wake_basilisk: { name: 'Wake the Basilisk', effect: 'send_fauna', fauna: 'basilisk', cost: { crystal: 1 }, text: 'Place a Basilisk on any land hex with no tower or beast.', copies: 4 },
};

export type Targeting = 'random' | 'lowest_health' | 'strongest_attacker' | 'weak_to_me';
export const TARGETING_TEXT: Record<Targeting, string> = {
  random: 'attacks random defenders',
  lowest_health: 'attacks the defenders with the lowest health',
  strongest_attacker: 'attacks the hardest-hitting defenders',
  weak_to_me: 'attacks defenders weak to its element first',
};

export interface Attack {
  hp: number;
  targets: number; // how many different enemies it hits each combat round
  dice: number;
  sides: number;
}
export type DragonStage = Attack;

export const avgDamage = (a: Attack) => a.targets * a.dice * (a.sides + 1) / 2;
// Combat power: one rough number for how much a dragon or defender is worth in
// a fight, √(health × average damage a combat round). By Lanchester's square
// law a side's strength is the square of the sum of these, so they add up:
// raiders whose powers sum past a kingdom's usually win. It ignores elements
// and targeting on purpose, so it misleads (the owner: "the single number
// misleads is literally the point").
export const combatPower = (a: Attack) => Math.round(Math.sqrt(a.hp * avgDamage(a)));

export interface DragonDef {
  name: string;
  element: Element;
  growthTime: number; // growth steps needed per life stage
  stages: [DragonStage, DragonStage, DragonStage]; // hatchling, young, adult
  targeting: Targeting;
  cost: Bundle;
  copies: number;
  base?: boolean; // available as a special project
}

const baseStages: [DragonStage, DragonStage, DragonStage] = [
  { hp: 6, targets: 1, dice: 1, sides: 6 },
  { hp: 12, targets: 1, dice: 2, sides: 6 },
  { hp: 20, targets: 2, dice: 2, sides: 6 },
];

function baseDragon(element: Element, name: string): DragonDef {
  return { name, element, growthTime: 2, stages: baseStages, targeting: 'random', cost: { crystal: 6, livestock: 4 }, copies: 2, base: true };
}

export const DRAGONS: Record<string, DragonDef> = {
  fire_whelp: baseDragon('fire', 'Fire Dragon'),
  ice_whelp: baseDragon('ice', 'Ice Dragon'),
  lightning_whelp: baseDragon('lightning', 'Lightning Dragon'),
  air_whelp: baseDragon('air', 'Air Dragon'),
  water_whelp: baseDragon('water', 'Water Dragon'),
  ember_wyrm: {
    name: 'Ember Wyrm', element: 'fire', growthTime: 3, targeting: 'weak_to_me', cost: { crystal: 8, livestock: 4, gold: 2 }, copies: 2,
    stages: [{ hp: 7, targets: 1, dice: 1, sides: 8 }, { hp: 14, targets: 1, dice: 2, sides: 8 }, { hp: 24, targets: 2, dice: 3, sides: 8 }],
  },
  cinder_drake: {
    name: 'Cinder Drake', element: 'fire', growthTime: 2, targeting: 'lowest_health', cost: { crystal: 8, livestock: 4 }, copies: 2,
    stages: [{ hp: 6, targets: 1, dice: 1, sides: 6 }, { hp: 11, targets: 2, dice: 1, sides: 6 }, { hp: 18, targets: 3, dice: 1, sides: 8 }],
  },
  frost_wyrm: {
    name: 'Frost Wyrm', element: 'ice', growthTime: 3, targeting: 'strongest_attacker', cost: { crystal: 8, livestock: 4, gold: 2 }, copies: 2,
    stages: [{ hp: 9, targets: 1, dice: 1, sides: 6 }, { hp: 17, targets: 1, dice: 2, sides: 6 }, { hp: 30, targets: 1, dice: 3, sides: 8 }],
  },
  rime_drake: {
    name: 'Rime Drake', element: 'ice', growthTime: 2, targeting: 'weak_to_me', cost: { crystal: 8, livestock: 4 }, copies: 2,
    stages: [{ hp: 6, targets: 1, dice: 1, sides: 6 }, { hp: 12, targets: 1, dice: 2, sides: 6 }, { hp: 20, targets: 2, dice: 2, sides: 8 }],
  },
  storm_wyrm: {
    name: 'Storm Wyrm', element: 'lightning', growthTime: 3, targeting: 'random', cost: { crystal: 8, livestock: 4, gold: 2 }, copies: 2,
    stages: [{ hp: 6, targets: 2, dice: 1, sides: 4 }, { hp: 12, targets: 3, dice: 1, sides: 6 }, { hp: 24, targets: 4, dice: 1, sides: 8 }],
  },
  bolt_drake: {
    name: 'Bolt Drake', element: 'lightning', growthTime: 2, targeting: 'strongest_attacker', cost: { crystal: 8, livestock: 4 }, copies: 2,
    stages: [{ hp: 5, targets: 1, dice: 1, sides: 8 }, { hp: 10, targets: 1, dice: 2, sides: 8 }, { hp: 20, targets: 1, dice: 4, sides: 8 }],
  },
  sky_wyrm: {
    name: 'Sky Wyrm', element: 'air', growthTime: 3, targeting: 'lowest_health', cost: { crystal: 8, livestock: 4, gold: 2 }, copies: 2,
    stages: [{ hp: 6, targets: 1, dice: 1, sides: 6 }, { hp: 13, targets: 2, dice: 1, sides: 8 }, { hp: 22, targets: 2, dice: 2, sides: 8 }],
  },
  zephyr_drake: {
    name: 'Zephyr Drake', element: 'air', growthTime: 2, targeting: 'random', cost: { crystal: 8, livestock: 4 }, copies: 2,
    stages: [{ hp: 5, targets: 1, dice: 1, sides: 6 }, { hp: 10, targets: 2, dice: 1, sides: 6 }, { hp: 20, targets: 3, dice: 1, sides: 8 }],
  },
  abyss_wyrm: {
    name: 'Abyss Wyrm', element: 'water', growthTime: 3, targeting: 'strongest_attacker', cost: { crystal: 8, livestock: 4, gold: 2 }, copies: 2,
    stages: [{ hp: 8, targets: 1, dice: 1, sides: 8 }, { hp: 16, targets: 2, dice: 1, sides: 8 }, { hp: 28, targets: 2, dice: 2, sides: 8 }],
  },
  reef_drake: {
    name: 'Reef Drake', element: 'water', growthTime: 2, targeting: 'weak_to_me', cost: { crystal: 8, livestock: 4 }, copies: 2,
    stages: [{ hp: 7, targets: 1, dice: 1, sides: 6 }, { hp: 13, targets: 1, dice: 2, sides: 6 }, { hp: 21, targets: 2, dice: 2, sides: 6 }],
  },
};

// What goes into each deck: every card of these kinds, its copies times.
// Basic buildings have no copies and are in neither deck.
export const DECKS = {
  building: [BUILDINGS, UPGRADES],
  action: [ACTIONS, DRAGONS],
} as const satisfies Record<string, Record<string, { copies?: number }>[]>;

export interface UnitDef extends Attack {
  name: string;
  element: UnitElement; // what beats it and what it beats: the element wheel (ELEMENT_BEATS)
}

// Defenders attack a random dragon still in the fight.
export const UNITS: Record<string, UnitDef> = {
  militia: { name: 'Militia', hp: 5, targets: 1, dice: 1, sides: 4, element: 'neutral' },
  archers: { name: 'Archers', hp: 6, targets: 1, dice: 1, sides: 6, element: 'neutral' },
  knights: { name: 'Knights', hp: 12, targets: 1, dice: 1, sides: 8, element: 'neutral' },
  frost_golem: { name: 'Frost Golem', hp: 16, targets: 1, dice: 1, sides: 6, element: 'ice' },
  storm_griffin: { name: 'Storm Griffin', hp: 10, targets: 1, dice: 1, sides: 8, element: 'air' },
  sea_serpent: { name: 'Sea Serpent', hp: 14, targets: 2, dice: 1, sides: 4, element: 'water' },
};

// Aggressive fauna: wild beasts on the map. A hex with fauna can't be built
// on, and a building under it produces nothing. A player's dragons clear it
// in the same combat as a raid; the beast's loot goes to that player, unless
// a card sent it (#139). In production each beast may wander a hex.
// Kept apart from UNITS: these are not raid defenders.
export interface FaunaDef extends UnitDef {
  loot: Bundle;
}

export const FAUNA: Record<string, FaunaDef> = {
  wolf_pack: { name: 'Wolf Pack', hp: 8, targets: 1, dice: 1, sides: 6, element: 'neutral', loot: { livestock: 2 } },
  cave_bear: { name: 'Cave Bear', hp: 16, targets: 1, dice: 1, sides: 10, element: 'neutral', loot: { livestock: 4 } },
  basilisk: { name: 'Basilisk', hp: 26, targets: 2, dice: 1, sides: 8, element: 'neutral', loot: { livestock: 4, gold: 2 } },
};
// Great beasts (#67): the top tier of the fauna, one of each on every map.
// Each holds its hex and every hex around it until it is slain: nothing is
// built there. Fighting one is clearing fauna, but a player gets one try at
// a great beast a round, and the one who slays it scores its points for good.
// It never comes back. Its weakness makes the race about the right dragons.
export interface BeastDef extends FaunaDef {
  points: number;
}

export const BEASTS: Record<string, BeastDef> = {
  // On the mountain at the centre of the map.
  thunderbird: { name: 'Thunderbird', hp: 70, targets: 2, dice: 2, sides: 8, element: 'air', loot: {}, points: 4 },
  // In the ocean off one coast, beside its harbor.
  leviathan: { name: 'Leviathan', hp: 80, targets: 1, dice: 3, sides: 10, element: 'water', loot: {}, points: 4 },
};

// A beast on the map: one of the fauna, or a great beast.
export function faunaDef(k: string): FaunaDef {
  return FAUNA[k] ?? BEASTS[k];
}

// On the starting map, a beast's kind goes by its distance to the nearest
// tower: wolves close in, the basilisk furthest out.
export const FAUNA_BY_DISTANCE = ['wolf_pack', 'cave_bear', 'basilisk']; // at 2, 3, 4 or more steps

export interface TargetDef {
  name: string;
  units: string[];
  loot: Bundle;
}

export const TARGETS: Record<string, TargetDef> = {
  // A ladder of combat power (in brackets; a base adult dragon is 17), with
  // loot that grows with its square, about power² ÷ 18 in value: easy kingdoms
  // give little, hard ones a lot. Per point of power sent, the hardest pays
  // about three times the easiest. Brindle's one gold is the only gold a
  // young dragon can win alone (#80). This is printed loot: each kingdom adds
  // 1 gold after every raid it doesn't fall in (the engine's hoard, #99).
  brindle: { name: 'Hamlet of Brindle', units: ['militia', 'militia'], loot: { livestock: 2, gold: 1 } }, // 8
  archers_hold: { name: "Archer's Hold", units: ['archers', 'archers', 'archers', 'militia'], loot: { gold: 4, timber: 4 } }, // 19
  frostpeak: { name: 'Frostpeak', units: ['frost_golem', 'frost_golem', 'archers', 'archers'], loot: { gold: 7, crystal: 4 } }, // 24
  knightsgate: { name: 'Knightsgate', units: ['knights', 'knights', 'knights', 'knights'], loot: { gold: 10, stone: 4 } }, // 28
  stormspire: { name: 'Stormspire', units: ['storm_griffin', 'storm_griffin', 'storm_griffin', 'storm_griffin', 'storm_griffin'], loot: { gold: 17 } }, // 35
  tidewatch: { name: 'Tidewatch', units: ['sea_serpent', 'sea_serpent', 'sea_serpent', 'knights', 'knights', 'knights'], loot: { gold: 27, livestock: 4 } }, // 45
};

export const targetPower = (key: string) => TARGETS[key].units.reduce((s, u) => s + combatPower(UNITS[u]), 0);

// Share of each terrain on the generated land. The ocean rings the land, and
// each of its six coasts has one natural harbor (src/map.ts).
export const TERRAIN_WEIGHTS: Partial<Record<Terrain, number>> = { mountain: 1, forest: 1, ley: 1, meadow: 1, plains: 1 };

export const STAGE_NAMES = ['egg', 'hatchling', 'young', 'adult'] as const;

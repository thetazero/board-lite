// All content and tuning numbers live here. Numbers are first guesses, to be
// tuned by playtests (see docs/design.md, open questions).
// docs/datasheet.md shows what these numbers add up to (payback, cost per
// point, raid odds). After changing any, run `npm run datasheet` and read the
// diff; `npm test` fails until it is regenerated.

export const RESOURCES = ['stone', 'timber', 'crystal', 'livestock', 'gold'] as const;
export type Resource = (typeof RESOURCES)[number];
export type Bundle = Partial<Record<Resource, number>>;

export const ELEMENTS = ['fire', 'ice', 'lightning', 'air', 'water'] as const;
export type Element = (typeof ELEMENTS)[number];

export const TERRAINS = ['mountain', 'forest', 'ley', 'meadow', 'plains'] as const;
export type Terrain = (typeof TERRAINS)[number];

export const TUNING = {
  pointsToWin: 15,
  handCap: 7,
  buildingCardsPerRound: 2,
  actionCardsPerRound: 1,
  startingResources: { stone: 3, timber: 3, crystal: 3, livestock: 3 } as Bundle,
  // The tower produces this every round, no dice.
  towerProduction: { stone: 1, timber: 1, crystal: 1, livestock: 1 } as Bundle,
  bankRate: 4,
  livestockPerDragon: 1,
  dragonPointsByStage: [0, 1, 2, 4], // egg, hatchling, young, adult
  titlePoints: 2,
  raidCandidates: 3,
  towerDragonCapacity: 1,
  // Special projects cost this many times the equivalent card's cost.
  specialProjectMultiplier: 2,
};

export type BuildingClass = 'production' | 'dragon' | 'points' | 'trade';

export interface BuildingDef {
  name: string;
  class: BuildingClass;
  cost: Bundle;
  text: string;
  terrain?: Terrain; // production buildings must go on this terrain
  produces?: { resource: Resource; base: number; die: number };
  points?: number;
  dragonCapacity?: number;
  growthBonus?: number;
  bankRate?: number;
  onTower?: boolean; // stacks on your tower hex instead of taking a hex
  copies: number; // in the building deck
  specialProject?: boolean; // can be built without a card, at a premium
}

export const BUILDINGS: Record<string, BuildingDef> = {
  quarry: { name: 'Quarry', class: 'production', cost: { timber: 3, livestock: 3, crystal: 2 }, terrain: 'mountain', produces: { resource: 'stone', base: 0, die: 6 }, text: 'Produces a d6 stone each round.', copies: 4, specialProject: true },
  lumber_camp: { name: 'Lumber Camp', class: 'production', cost: { stone: 3, crystal: 3, livestock: 2 }, terrain: 'forest', produces: { resource: 'timber', base: 0, die: 6 }, text: 'Produces a d6 timber each round.', copies: 4, specialProject: true },
  crystal_mine: { name: 'Crystal Mine', class: 'production', cost: { stone: 3, timber: 3, livestock: 2 }, terrain: 'ley', produces: { resource: 'crystal', base: 0, die: 6 }, text: 'Produces a d6 crystal each round.', copies: 4, specialProject: true },
  pasture: { name: 'Pasture', class: 'production', cost: { timber: 3, crystal: 3, stone: 2 }, terrain: 'meadow', produces: { resource: 'livestock', base: 0, die: 6 }, text: 'Produces a d6 livestock each round.', copies: 4, specialProject: true },
  roost: { name: 'Roost', class: 'dragon', cost: { stone: 3, timber: 1 }, dragonCapacity: 2, text: 'Houses 2 more dragons.', copies: 4, specialProject: true },
  hatchery: { name: 'Hatchery', class: 'dragon', cost: { stone: 2, timber: 2, crystal: 2 }, growthBonus: 1, text: 'Your growing dragons grow one extra step each round.', copies: 3 },
  market: { name: 'Market', class: 'trade', cost: { timber: 3, stone: 1, livestock: 1 }, bankRate: 3, text: 'You trade with the bank at 3:1.', copies: 3 },
  caravan_post: { name: 'Caravan Post', class: 'trade', cost: { timber: 3, stone: 2, gold: 1 }, bankRate: 2, text: 'You trade with the bank at 2:1.', copies: 2 },
  tower_floor: { name: 'Tower Floor', class: 'points', cost: { stone: 4, crystal: 1, gold: 1 }, points: 1, onTower: true, text: 'Adds a floor to your tower, worth 1 point.', copies: 6 },
  monument: { name: 'Monument', class: 'points', cost: { stone: 4, timber: 2, gold: 2 }, points: 2, text: 'Worth 2 points.', copies: 3 },
};

export interface UpgradeDef {
  name: string;
  appliesTo: BuildingClass;
  cost: Bundle;
  text: string;
  baseBonus?: number; // production
  points?: number;
  dragonCapacity?: number;
  goldPerRound?: number;
  copies: number;
}

// The tower itself counts as a 'points' class building (for Gilding) and
// a 'dragon' class building (for Nesting Grounds).
export const UPGRADES: Record<string, UpgradeDef> = {
  workshop: { name: 'Workshop', appliesTo: 'production', cost: { gold: 2, timber: 1 }, baseBonus: 1, text: 'This production building produces 1 more.', copies: 3 },
  gilding: { name: 'Gilding', appliesTo: 'points', cost: { gold: 3 }, points: 1, text: 'This tower or monument is worth 1 more point.', copies: 3 },
  nesting_grounds: { name: 'Nesting Grounds', appliesTo: 'dragon', cost: { gold: 2, stone: 1 }, dragonCapacity: 1, text: 'This roost, hatchery or tower houses 1 more dragon.', copies: 3 },
  trade_charter: { name: 'Trade Charter', appliesTo: 'trade', cost: { gold: 2, crystal: 1 }, goldPerRound: 1, text: 'This trade building produces 1 gold each round.', copies: 3 },
};

export type ActionEffect = 'gain_resource' | 'gain_gold' | 'grow_dragon' | 'heal_dragon' | 'extra_raid' | 'hidden_point';

export interface ActionDef {
  name: string;
  effect: ActionEffect;
  amount?: number;
  cost: Bundle;
  text: string;
  copies: number;
}

export const ACTIONS: Record<string, ActionDef> = {
  windfall: { name: 'Windfall', effect: 'gain_resource', amount: 3, cost: {}, text: 'Gain 3 of one resource other than gold.', copies: 5 },
  treasure: { name: 'Buried Treasure', effect: 'gain_gold', amount: 2, cost: {}, text: 'Gain 2 gold.', copies: 4 },
  growth_elixir: { name: 'Growth Elixir', effect: 'grow_dragon', cost: { crystal: 1 }, text: 'One of your dragons grows to its next life stage.', copies: 4 },
  healing_potion: { name: 'Healing Potion', effect: 'heal_dragon', cost: {}, text: 'Heal one of your hurt dragons so it can raid this round.', copies: 3 },
  war_horn: { name: 'War Horn', effect: 'extra_raid', cost: { crystal: 1 }, text: 'This round has one more raid.', copies: 3 },
  secret_hoard: { name: 'Secret Hoard', effect: 'hidden_point', cost: {}, text: 'Worth 1 point while in your hand.', copies: 4 },
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
  return { name, element, growthTime: 2, stages: baseStages, targeting: 'random', cost: { crystal: 2, livestock: 1 }, copies: 1, base: true };
}

export const DRAGONS: Record<string, DragonDef> = {
  fire_whelp: baseDragon('fire', 'Fire Whelp'),
  ice_whelp: baseDragon('ice', 'Ice Whelp'),
  lightning_whelp: baseDragon('lightning', 'Spark Whelp'),
  air_whelp: baseDragon('air', 'Gust Whelp'),
  water_whelp: baseDragon('water', 'Tide Whelp'),
  ember_wyrm: {
    name: 'Ember Wyrm', element: 'fire', growthTime: 3, targeting: 'weak_to_me', cost: { crystal: 3, livestock: 1, gold: 1 }, copies: 1,
    stages: [{ hp: 7, targets: 1, dice: 1, sides: 8 }, { hp: 14, targets: 1, dice: 2, sides: 8 }, { hp: 24, targets: 2, dice: 3, sides: 8 }],
  },
  cinder_drake: {
    name: 'Cinder Drake', element: 'fire', growthTime: 2, targeting: 'lowest_health', cost: { crystal: 3, livestock: 1 }, copies: 1,
    stages: [{ hp: 6, targets: 1, dice: 1, sides: 6 }, { hp: 11, targets: 2, dice: 1, sides: 6 }, { hp: 18, targets: 3, dice: 1, sides: 8 }],
  },
  frost_wyrm: {
    name: 'Frost Wyrm', element: 'ice', growthTime: 3, targeting: 'strongest_attacker', cost: { crystal: 3, livestock: 1, gold: 1 }, copies: 1,
    stages: [{ hp: 9, targets: 1, dice: 1, sides: 6 }, { hp: 17, targets: 1, dice: 2, sides: 6 }, { hp: 30, targets: 1, dice: 3, sides: 8 }],
  },
  rime_drake: {
    name: 'Rime Drake', element: 'ice', growthTime: 2, targeting: 'weak_to_me', cost: { crystal: 3, livestock: 1 }, copies: 1,
    stages: [{ hp: 6, targets: 1, dice: 1, sides: 6 }, { hp: 12, targets: 1, dice: 2, sides: 6 }, { hp: 20, targets: 2, dice: 2, sides: 8 }],
  },
  storm_wyrm: {
    name: 'Storm Wyrm', element: 'lightning', growthTime: 3, targeting: 'random', cost: { crystal: 3, livestock: 1, gold: 1 }, copies: 1,
    stages: [{ hp: 6, targets: 2, dice: 1, sides: 4 }, { hp: 12, targets: 3, dice: 1, sides: 6 }, { hp: 20, targets: 4, dice: 1, sides: 8 }],
  },
  bolt_drake: {
    name: 'Bolt Drake', element: 'lightning', growthTime: 2, targeting: 'strongest_attacker', cost: { crystal: 3, livestock: 1 }, copies: 1,
    stages: [{ hp: 5, targets: 1, dice: 1, sides: 8 }, { hp: 10, targets: 1, dice: 2, sides: 8 }, { hp: 16, targets: 1, dice: 3, sides: 8 }],
  },
  sky_wyrm: {
    name: 'Sky Wyrm', element: 'air', growthTime: 3, targeting: 'lowest_health', cost: { crystal: 3, livestock: 1, gold: 1 }, copies: 1,
    stages: [{ hp: 6, targets: 1, dice: 1, sides: 6 }, { hp: 13, targets: 2, dice: 1, sides: 8 }, { hp: 22, targets: 2, dice: 2, sides: 8 }],
  },
  zephyr_drake: {
    name: 'Zephyr Drake', element: 'air', growthTime: 1, targeting: 'random', cost: { crystal: 3, livestock: 1 }, copies: 1,
    stages: [{ hp: 5, targets: 1, dice: 1, sides: 4 }, { hp: 9, targets: 1, dice: 1, sides: 8 }, { hp: 14, targets: 2, dice: 1, sides: 8 }],
  },
  abyss_wyrm: {
    name: 'Abyss Wyrm', element: 'water', growthTime: 3, targeting: 'strongest_attacker', cost: { crystal: 3, livestock: 1, gold: 1 }, copies: 1,
    stages: [{ hp: 8, targets: 1, dice: 1, sides: 8 }, { hp: 16, targets: 2, dice: 1, sides: 8 }, { hp: 28, targets: 2, dice: 2, sides: 8 }],
  },
  reef_drake: {
    name: 'Reef Drake', element: 'water', growthTime: 2, targeting: 'weak_to_me', cost: { crystal: 3, livestock: 1 }, copies: 1,
    stages: [{ hp: 7, targets: 1, dice: 1, sides: 6 }, { hp: 13, targets: 1, dice: 2, sides: 6 }, { hp: 21, targets: 2, dice: 2, sides: 6 }],
  },
};

export interface UnitDef extends Attack {
  name: string;
  strong: Element[]; // takes half damage from these
  weak: Element[]; // takes double damage from these
}

// Defenders attack a random dragon still in the fight.
export const UNITS: Record<string, UnitDef> = {
  militia: { name: 'Militia', hp: 5, targets: 1, dice: 1, sides: 4, strong: [], weak: ['fire'] },
  archers: { name: 'Archers', hp: 6, targets: 1, dice: 1, sides: 6, strong: ['water'], weak: ['air'] },
  knights: { name: 'Knights', hp: 12, targets: 1, dice: 1, sides: 8, strong: ['fire'], weak: ['lightning'] },
  frost_golem: { name: 'Frost Golem', hp: 16, targets: 1, dice: 1, sides: 6, strong: ['ice', 'water'], weak: ['fire'] },
  storm_griffin: { name: 'Storm Griffin', hp: 10, targets: 1, dice: 1, sides: 8, strong: ['air', 'lightning'], weak: ['ice'] },
  sea_serpent: { name: 'Sea Serpent', hp: 14, targets: 2, dice: 1, sides: 4, strong: ['water', 'fire'], weak: ['lightning'] },
};

export interface TargetDef {
  name: string;
  units: string[];
  loot: Bundle;
}

export const TARGETS: Record<string, TargetDef> = {
  // Brindle is a solo raid. Archer's Hold is a coin flip for one adult. The
  // four rich kingdoms need two adults (one alone wins 10-25% of the time),
  // and a third makes the fight shorter, so each fighter is less likely to be hit.
  brindle: { name: 'Hamlet of Brindle', units: ['militia', 'militia'], loot: { gold: 3, livestock: 2 } },
  archers_hold: { name: "Archer's Hold", units: ['archers', 'archers', 'archers', 'archers', 'militia'], loot: { gold: 7, timber: 2 } },
  knightsgate: { name: 'Knightsgate', units: ['knights', 'knights', 'knights', 'knights'], loot: { gold: 14, stone: 3 } },
  frostpeak: { name: 'Frostpeak', units: ['frost_golem', 'frost_golem', 'archers', 'archers'], loot: { gold: 14, crystal: 3 } },
  stormspire: { name: 'Stormspire', units: ['storm_griffin', 'storm_griffin', 'storm_griffin', 'storm_griffin'], loot: { gold: 16 } },
  tidewatch: { name: 'Tidewatch', units: ['sea_serpent', 'sea_serpent', 'knights', 'knights'], loot: { gold: 16, livestock: 3 } },
};

// Share of each terrain on the generated map.
export const TERRAIN_WEIGHTS: Record<Terrain, number> = { mountain: 3, forest: 3, ley: 2, meadow: 3, plains: 3 };

export const STAGE_NAMES = ['egg', 'hatchling', 'young', 'adult'] as const;

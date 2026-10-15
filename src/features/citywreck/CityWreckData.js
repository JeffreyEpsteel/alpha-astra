// The numbers of the destructible city (wave 21C): hit points by building kind, the stage thresholds, fire, spread, rain,
// the fire crews, repairs, the city's mood and wanted level, the repair bills, and the render / collapse budgets.
// Damage is counted in kJ: a 6-pounder ball ~16, a powder bomb 60 (with falloff), a seaplane crash ~700.

// Towers can burn and collapse, with heavier structure than ordinary buildings.
// Other highrises remain breached/gutted shells.
export const CLASS_OF = {
	tower: 'tower',
	highrise: 'high',
	midrise: 'mid',
	lowrise: 'low',
	shop: 'low',
	warehouse: 'low',
	station: 'low',
	landmark: 'mid', // (a landmark's own collapsible flag and height decide: classOf)
};

// hit points (kJ) by kind at the reference footprint; scaled by sqrt( area / REF_AREA ) in 0.6 .. 2.2
export const HP = { tower: 4000, highrise: 1600, midrise: 560, lowrise: 190, shop: 150, warehouse: 260, station: 420, landmark: 640 };
export const REF_AREA = 220; // m^2
export const ARMOR = { tower: 0.65, high: 0.8, mid: 1, low: 1 }; // fraction of the energy that counts

// the damage fraction at which each stage begins (1 scarred, 2 gutted, 3 collapsed)
export const STAGE_AT = [ 0, 0.2, 0.55, 1 ];
export const MAX_STAGE = { tower: 3, high: 2, mid: 3, low: 3 };

// how far a blast reaches a building (its radius times this) and the energy share of a cannonball that lands near one
export const BLAST_REACH = 1.6;
export const NEAR_BALL = 2.0; // m from a facade: a ball that lands this close still hits it
export const CRASH = { mass: 900, radius: 9, classes: [ 'low', 'mid', 'tower' ] };

// the towers: cosmetic marks on the lower facade (cannon, bombs), mended over a few in-game hours
export const TOWER_MARKS = { below: 40, max: 10, mendHours: 3 };

// fire (0..1 per building)
export const FIRE = {
	ignite: 0.32, // a fire bottle, or a gutting hit
	grow: 0.018, // per s at full dryness
	rainDamp: 0.05, // per s at full rain (rain slows it and puts it out)
	burn: 0.0035, // damage fraction per s at full fire (stops at gutted: fire alone never brings a building down)
	burnCap: 0.9,
	gutAt: 0.62, // a fire this strong guts the floors (stage 2)
	out: 0.02,
	spreadEvery: 2, // s between spread checks
	spreadChance: 0.09, // per check at fire 1 in dry weather, to each adjacent low building
	spreadGap: 7, // m between footprints: neighbours
	dryBelow: 0.15, // weather.rain below this is dry weather
	classes: [ 'low', 'mid', 'high', 'tower' ],
	bottleReach: 2.6, // m from a footprint: a fire pool there sets it alight
	shownMax: 4, // the nearest burning buildings drawn with vfx fires (the rest smoke only)
};

// the fire crews (and the fire engine, a 21B car kind when it exists: event cityFireCall)
export const CREW = { respond: 40, douse: 0.035, teams: 2 }; // s to arrive; fire per s each team; teams at once

// repairs, in in-game hours from the moment the fire is out and the shooting stopped
export const REPAIR = {
	quiet: 1, // h with no new damage before work begins
	clearRubble: 8, // h to clear a collapse (the road opens again)
	hours: [ 0, 6, 24, 48 ], // h of scaffolding by stage
	mendRate: 1, // damage fraction mended over the scaffolding time
};

// repair bills ($) per kJ of hit points, by stage, posted on the notice board; the player owes a share of what they did
export const COST = { perKJ: 9, stage: [ 0, 0.25, 0.6, 1 ], playerShare: 0.3 };

// the city's mood: unrest points from damage and fire, decaying; shops close past 'uneasy' in their block, everywhere at 'panic'
export const MOOD = { uneasy: 4, panic: 12, decayPerHour: 3, perStage: 1.5, perCollapse: 4, perHit: 0.15 };

// the wanted level (stars 0..5) for the player's damage: heat points, decaying an hour at a time
export const WANTED = { at: [ 1, 3, 6, 10, 16 ], perStage: 1, perCollapse: 3, perHit: 0.12, decayPerHour: 1.2, max: 24 };

// collapses: a few rigid chunks per building, at most two animating at once; then a merged rubble heap
export const COLLAPSE = {
	animating: 2,
	chunks: { desktop: 56, phone: 22 },
	duration: 4.5, // s of fall before the heap takes over
	gravity: 9.81,
	heap: { desktop: 110, phone: 40 }, // rubble pieces per heap
	heapHeight: 0.3, // of the building height, capped
	heapMax: 8, // m
	spill: 0.6, // of the height (at least spillMin), beyond the footprint: rubble on the road
	spillMin: 4,
	spillMax: 16,
	debrisEnergy: 0.5, // kJ per m^3 / 1000 of the fallen volume reaching each neighbour (scaled by distance)
};

// the render: one instanced box mesh (chunks, rubble, scorch and window decals, breaches, scaffolding)
export const RENDER = { capacity: { desktop: 4096, phone: 1400 }, drawWithin: 1200, decals: [ 0, 10, 16, 16 ] };

// the multiplayer stage stream: the host batches stage / fire changes (the server lets 10 events / s through per client)
export const NET = { flush: 0.6, batch: 48, fireStep: 0.1 };

// colours (linear-ish sRGB 0..1) of concrete, brick, glass, soot, timber and steel scaffold
export const COLORS = {
	concrete: [ 0.62, 0.6, 0.56 ],
	brick: [ 0.52, 0.3, 0.22 ],
	stone: [ 0.7, 0.66, 0.58 ],
	soot: [ 0.07, 0.065, 0.06 ],
	scorch: [ 0.14, 0.12, 0.1 ],
	window: [ 0.04, 0.045, 0.05 ],
	breach: [ 0.03, 0.028, 0.026 ],
	dust: [ 0.55, 0.52, 0.47 ],
	timber: [ 0.55, 0.42, 0.26 ],
	steel: [ 0.32, 0.36, 0.4 ],
	tarp: [ 0.2, 0.42, 0.6 ],
	rebar: [ 0.3, 0.2, 0.15 ],
};

export const KIND_COLOR = { highrise: 'concrete', midrise: 'stone', lowrise: 'brick', shop: 'brick', warehouse: 'brick', station: 'stone', landmark: 'stone', tower: 'concrete' };

// a building's class from its plan entry (a landmark: high when tall or not collapsible, else mid)
export function classOf( b ) {

	if ( ! b ) return 'low';
	if ( b.kind === 'tower' ) return 'tower';
	if ( b.kind === 'landmark' ) return b.collapsible === false || ( b.h || 0 ) > 60 ? 'high' : 'mid';
	const c = CLASS_OF[ b.kind ] || 'low';
	// the plan's own word wins over the kind: a building flagged not collapsible never falls
	if ( c !== 'tower' && c !== 'high' && b.collapsible === false ) return 'high';
	return c;

}

export function hpOf( b ) {

	const base = HP[ b.kind ] ?? HP.lowrise;
	if ( ! Number.isFinite( base ) ) return Infinity;
	const area = Math.max( 1, ( b.w || 10 ) * ( b.d || 10 ) );
	const k = Math.min( 2.2, Math.max( 0.6, Math.sqrt( area / REF_AREA ) ) );
	return base * k;

}

export function stageFor( frac, cls ) {

	let s = 0;
	for ( let i = 1; i < STAGE_AT.length; i ++ ) if ( frac >= STAGE_AT[ i ] - 1e-9 ) s = i;
	return Math.min( s, MAX_STAGE[ cls ] ?? 0 );

}

export function wantedLevel( heat ) {

	let n = 0;
	for ( const a of WANTED.at ) if ( heat >= a ) n ++;
	return n;

}

export function repairCost( b, stage ) {

	const hp = hpOf( b );
	if ( ! Number.isFinite( hp ) ) return 0;
	return Math.round( hp * COST.perKJ * ( COST.stage[ stage ] || 0 ) / 10 ) * 10;

}

// Gear and upgrade data. The upgrade shop (a vendor by the boathouse) is not built yet; everything
// the game reads goes through gearStats( state.upgrades ), so buying a level is just
// state.upgrades[ key ]++ and the stats follow.
//
// Each track: levels[ 0 ] is what you start with; cost is the price of that level (0 for the first).
// req (optional) gates a level beyond its price (docs/UNREAL_PARITY.md F6): { level: player level, rep: { port: min },
// quest: story quest id done (state.quests.done), standing: merchant standing (trade.credit) }. gearGate( state, key,
// standing ) says whether the next level may be bought and why not; GameState.buy and the shop panel ask it.
export const UPGRADES = {
	// rod and reel
	line: { name: 'Fishing line', levels: [
		{ cost: 0, label: '8 lb mono', lineKg: 7 },
		{ cost: 60, label: '15 lb mono', lineKg: 13 },
		{ cost: 180, label: '30 lb braid', lineKg: 26 },
		{ cost: 450, label: '60 lb braid', lineKg: 50, req: { level: 3 } },
		{ cost: 950, label: 'Reinforced fishing line', lineKg: 80, req: { level: 5, rep: { home: 30 }, quest: 'deepWater' } },
	] },
	reel: { name: 'Reel', levels: [
		{ cost: 0, label: 'Old spinning reel', reelSpeed: 1.1 },
		{ cost: 90, label: 'Smooth spinning reel', reelSpeed: 1.6 },
		{ cost: 320, label: 'Conventional reel', reelSpeed: 2.2, req: { level: 3 } },
	] },
	rod: { name: 'Rod', levels: [
		{ cost: 0, label: 'Hand-me-down rod', castM: 22 },
		{ cost: 75, label: '7 ft graphite rod', castM: 32 },
		{ cost: 260, label: '9 ft surf rod', castM: 45, req: { level: 2, rep: { home: 10 } } },
	] },
	// boat
	hold: { name: 'Fish hold', levels: [
		{ cost: 0, label: 'Cooler', holdKg: 30 },
		{ cost: 120, label: 'Ice chest', holdKg: 70 },
		{ cost: 400, label: 'Insulated fish hold', holdKg: 160, req: { level: 3, rep: { pons: 10 } } },
	] },
	fuel: { name: 'Fuel tank', levels: [
		{ cost: 0, label: '40 L tank', fuelL: 40 },
		{ cost: 150, label: '80 L tank', fuelL: 80 },
		{ cost: 380, label: '150 L tank', fuelL: 150, req: { level: 3 } },
	] },
	engine: { name: 'Engine', levels: [
		{ cost: 0, label: 'Tired diesel', speedMul: 1 },
		{ cost: 300, label: 'Rebuilt diesel', speedMul: 1.15 },
		{ cost: 700, label: 'Turbo diesel', speedMul: 1.3, req: { level: 4, rep: { pons: 20 }, standing: 20 } },
	] },
	fishFinder: { name: 'Fish finder', levels: [
		{ cost: 0, label: 'None', finder: false },
		{ cost: 250, label: 'Fish finder (depth and fish on the HUD)', finder: true },
	] },
	lights: { name: 'Boat lights', levels: [
		{ cost: 0, label: 'Nav lights only', deckLights: false },
		{ cost: 140, label: 'Deck floodlights for night fishing', deckLights: true },
	] },
};

export const FUEL_PRICE = 1.5; // $ per litre of diesel at the chandlery
// litres per second at the helm: idle plus a lot more at full rpm (40 L lasts ~25 min flat out)
export function fuelBurn( rpm ) {

	return 0.0025 + 0.024 * rpm * rpm;

}

// next level of a track, or null when maxed
export function nextLevel( upgrades, key ) {

	const lv = UPGRADES[ key ].levels;
	const i = ( upgrades[ key ] | 0 ) + 1;
	return i < lv.length ? { index: i, ...lv[ i ] } : null;

}

const PORT_NAMES = { home: 'Home', pons: 'Pons Cove', gull: 'Gull Rock', key: 'Saltmarsh Key' };
const QUEST_NAMES = { firstCatch: 'First catch', reefRun: 'Reef run', nightShift: 'Night shift', deepWater: 'Deep water', recordHunter: 'Record hunter' };

// the reasons a requirement is not met by this state (empty: it is); sandbox (state.free) meets every one.
// standing: the merchant standing when the caller knows it (features.get( 'trade' )?.credit?.standing), else unchecked
export function unmetReqs( state, req, standing = null ) {

	const out = [];
	if ( ! req || ( state && state.free ) ) return out;
	const level = state && Number.isFinite( state.level ) ? state.level : 1;
	if ( req.level && level < req.level ) out.push( { kind: 'level', need: req.level, have: level, text: `Reach level ${ req.level }` } );
	for ( const port in req.rep || {} ) {

		const have = state && state.rep && Number.isFinite( state.rep[ port ] ) ? state.rep[ port ] : 0;
		if ( have < req.rep[ port ] ) out.push( { kind: 'rep', port, need: req.rep[ port ], have, text: `${ req.rep[ port ] } reputation at ${ PORT_NAMES[ port ] || port }` } );

	}

	if ( req.quest ) {

		const done = state && state.quests && Array.isArray( state.quests.done ) ? state.quests.done : [];
		if ( ! done.includes( req.quest ) ) out.push( { kind: 'quest', quest: req.quest, text: `Finish the quest ${ QUEST_NAMES[ req.quest ] || req.quest }` } );

	}

	if ( req.standing && Number.isFinite( standing ) && standing < req.standing ) out.push( { kind: 'standing', need: req.standing, have: Math.floor( standing ), text: `Merchant standing ${ req.standing }` } );
	return out;

}

// may the next level of a track be bought? { ok, next, cost, reasons: [ text ], why: 'max' | 'locked' | 'money' | null }
export function gearGate( state, key, standing = null ) {

	if ( ! UPGRADES[ key ] ) return { ok: false, next: null, cost: 0, reasons: [ 'Unknown upgrade' ], why: 'unknown' };
	const next = nextLevel( state && state.upgrades ? state.upgrades : {}, key );
	if ( ! next ) return { ok: false, next: null, cost: 0, reasons: [ 'Top of the line' ], why: 'max' };
	const unmet = unmetReqs( state, next.req, standing );
	const cost = state && state.free ? 0 : next.cost;
	if ( unmet.length ) return { ok: false, next, cost, reasons: unmet.map( ( u ) => u.text ), why: 'locked' };
	const money = state && Number.isFinite( state.money ) ? state.money : 0;
	if ( cost > money ) return { ok: false, next, cost, reasons: [ `Costs $${ cost }` ], why: 'money' };
	return { ok: true, next, cost, reasons: [], why: null };

}

export function defaultUpgrades() {

	const u = {};
	for ( const k in UPGRADES ) u[ k ] = 0;
	return u;

}

// merged stats of the current levels
export function gearStats( upgrades ) {

	const s = {};
	for ( const k in UPGRADES ) {

		const lv = UPGRADES[ k ].levels;
		const i = Math.max( 0, Math.min( lv.length - 1, upgrades[ k ] | 0 ) );
		for ( const [ key, v ] of Object.entries( lv[ i ] ) ) if ( key !== 'cost' && key !== 'label' && key !== 'req' ) s[ key ] = v;

	}

	return s;

}

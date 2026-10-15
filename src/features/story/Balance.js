import { FISH } from '../../game/FishTable.js';
import { fishValue } from '../../game/FishTable.js';
import { pickSpecies, rollWeight, biteDelay } from '../../game/Bites.js';
import { BOATS } from '../../game/Boats.js';
import { DAY_SPEED } from '../../game/GameMode.js';
import { HOLD_CRATES, BOAT_SPEED, seaDistance } from '../trade/goods.js';
import { BAIT, CREW as CREW_ON, OPERATING } from '../trade/Operating.js';
import { DUES } from '../trade/Dues.js';
import { LICENCES } from '../trade/HaulContracts.js';
import { CREW_RULES } from '../crew/Crew.js';
import { anglingMul, newMember, sailorsFor } from '../crew/Life.js';
import { BOUNTY as NAVY_BOUNTY, EVENTS as NAVY_EVENTS, CHANDLER } from '../navy/NavyData.js';
import { SHIP_CLASSES } from '../naval/ShipClasses.js';
import { FENCE } from '../hijack/Fence.js';
import { HIJACK } from '../hijack/Rules.js';
import { BOUNTY_TIERS } from '../notices/NoticeData.js';
import { MELEE as MELEE_ARMS, THROWN, SHOT } from '../weapons/WeaponsData.js';
import { WEAPONS as GUNS } from '../firearms/FirearmsData.js';
import { MODULES } from '../naval/Modules.js';

// The wave 20 balance pass (pure: no engine, no DOM, deterministic). Earnings per REAL hour of play for each way of making money,
// at three stages of a career, from the game's own constants (the fish table and bite maths, the trade boards, the haul offers,
// the notice and navy bounties, the hijack fence) and a few stated assumptions about time (TIME). docs/briefs/w20-balance-table.md
// is the table this writes (test/feature-balance.mjs builds it, checks the invariants and rewrites the doc).
//
//   STAGES                      early (a marsh skiff, no guns), mid (the lobster boat, swivels, 2 tavern hands, coastal licence),
//                               late (the brigantine, 4 hands, master licence)
//   table( { boards, haul, overrides } ) -> { rows: [ { id, label, early, mid, late, note } ], wages, medians, flags, prices, loops }
//     boards: { port: routes.board( trade, port, 20 ) rows } measured on a seeded market (the test does it); the best two-leg loop
//            per stage fills the stage's hold from them. haul: the haul offers of every board ({ from, to, crates, reward, tier }).
//            overrides: { 'hijack.fence': 0.08, ... } to try a constant another worker owns (PROPOSED below).
//   invariants( t ) -> [ { ok, text } ]   no activity > 3x the stage's median; mid-game wages < 40 % of the mid-game median income
//   markdown( t ) -> the doc
//
// Real time: DAY_SPEED island hours a second (0.01: a 40-minute day), so a real hour is DAYS_PER_HOUR in-game days of wages.

export const DAYS_PER_HOUR = DAY_SPEED * 3600 / 24;

// what the player has at each stage (boat, hands, licence, the notice tier the boards give a trusted captain)
export const STAGES = {
	early: { label: 'Early (marsh skiff, cooler, no guns)', boat: 'skiff', hands: 0, anglers: 0, licence: 0, tier: 0, guns: false, fishing: { pier: 1, shallows: 0.35, bay: 0.25 }, cooler: 30, sellTrip: 90, boardLevel: 0 },
	mid: { label: 'Mid (lobster boat, ice chest, swivel gun, 2 hands)', boat: 'lobster', hands: 2, anglers: 1, licence: 1, tier: 2, guns: true, fishing: { reef: 1, bay: 0.3 }, cooler: 70, sellTrip: 240, boardLevel: 2, pirate: 'sloop' },
	late: { label: 'Late (brigantine, fish hold, 4 hands)', boat: 'brigantine', hands: 4, anglers: 2, licence: 2, tier: 3, guns: true, fishing: { deep: 1, bay: 0.15 }, cooler: 160, sellTrip: 420, boardLevel: 4, pirate: 'brigantine' },
};
export const STAGE_IDS = Object.keys( STAGES );

// time assumptions (real seconds): what a player spends besides sailing
export const TIME = {
	cast: 6, // cast, settle, strike
	reelPerStamina: 2, // s of fighting per second of the fish's stamina (slack, surges, the catch card)
	reelBase: 4,
	land: 0.8, // of the hooked fish landed (strike windows, broken lines)
	// the cooler / hold (Gear holdKg x the boat's holdMul) fills, then a trip to sell (STAGES[ s ].sellTrip s)
	port: 120, // s in a port per call (dock, market, dues)
	loopRepeat: 0.75, // a loop run again soon pays less (the market fills; prices drift; you do not always find the best)
	bountySearch: [ 0, 300, 420, 540 ], // s to find a notice's target in its search zone, by tier
	fight: { sloop: 240, brigantine: 330 }, // s to sink a ship of that class at the stage's guns
	huntSearch: 300, // s to find an ordinary pirate in pirate waters
	take: 360, // s to cripple, board and take a pirate ship
	toFence: 1500, // m from pirate waters to Blackwater's fence
	homeAgain: 420, // s to get back to your own boat after selling a taken hull (a launch, a ferry, the long way)
	convoyFight: 300, // s a convoy rescue takes
};

export const MEDIAN_MAX = 3; // no activity above this times the stage's median
export const PRICE_MIN = { gear: 2, pack: 0.3 }; // minutes of the stage's median income: cheaper is trivial
export const PRICE_MAX = 180; // minutes: dearer is out of reach
export const WAGE_SHARE = 0.4; // mid-game wages under this share of the mid-game median income

// constants of other workers' files this pass proposes (reported patches); table( { overrides: PROPOSED } ) shows the effect
export const PROPOSED = {
	'hijack.fence': 0.08, // hijack/Fence.js FENCE 0.35: a taken sloop fenced for $12,600 (a brigantine $21,700) in ~25 minutes was 9x the mid-game median
};

const r10 = ( v ) => Math.round( v / 10 ) * 10;
const mean = ( a ) => ( a.length ? a.reduce( ( s, x ) => s + x, 0 ) / a.length : 0 );
export function median( list ) {

	const a = list.filter( ( v ) => Number.isFinite( v ) ).sort( ( x, y ) => x - y );
	if ( ! a.length ) return 0;
	const m = a.length >> 1;
	return a.length % 2 ? a[ m ] : ( a[ m - 1 ] + a[ m ] ) / 2;

}

function rng( seed ) {

	let a = seed >>> 0;
	return () => {

		a = ( a + 0x6d2b79f5 ) >>> 0;
		let t = a;
		t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
		t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}

// ---------------------------------------------------------------- each way of earning ($ per real hour; null: not open at that stage)

// the skipper's rod plus the crew's anglers, Monte Carlo over the day (06-20) in the stage's water, until the cooler / hold is
// full; then the trip to sell
export function fishingPerHour( stage, n = 4000 ) {

	const S = STAGES[ stage ], R = rng( 20 + stage.length );
	const water = { shallows: 0, reef: 0, pier: 0, bay: 0, deep: 0, ...S.fishing }; // (Bites reads every key)
	let value = 0, secs = 0, kg = 0, fish = 0;
	for ( let i = 0; i < n; i ++ ) {

		const hour = 6 + 14 * R();
		const id = pickSpecies( water, hour, R );
		if ( ! id ) continue;
		const w = rollWeight( id, R );
		secs += biteDelay( water, hour, R ) + TIME.cast + TIME.reelBase + FISH[ id ].stamina * TIME.reelPerStamina;
		value += fishValue( id, w ) * TIME.land - BAIT.tinPrice / BAIT.tin;
		kg += w * TIME.land;
		fish ++;

	}

	if ( ! fish ) return { value: 0, rod: 0, crew: 0 };
	// the crew's anglers land the same water's fish every Crew.catchInterval (45..90 s; richer water sooner), a little better
	const rich = Object.values( S.fishing ).reduce( ( a, b ) => a + b, 0 );
	const every = CREW_RULES.catchMax - ( CREW_RULES.catchMax - CREW_RULES.catchMin ) * Math.min( 1, Math.max( 0, rich - 0.35 ) );
	const perFish = value / fish, kgPerFish = kg / fish, castS = secs / fish;
	const hand = anglingMul( newMember( { skills: { angling: 30 } } ) );
	const rate = 1 / castS + S.anglers * hand / every; // fish a second, aboard
	const holdKg = S.cooler * ( BOATS[ S.boat ] ? BOATS[ S.boat ].holdMul : 1 );
	const fill = holdKg / ( kgPerFish * rate ); // s to fill the hold
	const perHour = ( rate * fill * perFish ) / ( fill + S.sellTrip ) * 3600;
	const rodShare = ( 1 / castS ) / rate;
	return { value: perHour, rod: perHour * rodShare, crew: perHour * ( 1 - rodShare ), fill, perFish };

}

// trade runs: a loop's gain (both legs, the hold filled from the best margins per crate) over the sail there and back
export function tradePerHour( stage, loop ) {

	if ( ! loop ) return null;
	const S = STAGES[ stage ], speed = BOAT_SPEED[ S.boat ] || 3, hold = HOLD_CRATES[ S.boat ] || 4;
	const secs = 2 * loop.metres / speed + 2 * TIME.port;
	const dues = 2 * ( DUES.base + DUES.perCrate * hold );
	return Math.max( 0, ( loop.gain * TIME.loopRepeat - dues ) / secs * 3600 );

}

// what one leg earns: the board's rows bound for `to`, best per crate first, until the hold is full (a row's gain walks its
// `room` units: each one bought dearer here, sold cheaper there)
export function legGain( rows, to, hold ) {

	let left = hold, g = 0;
	for ( const r of ( rows || [] ).filter( ( x ) => x.to === to && x.gain > 0 ).sort( ( a, b ) => b.perCrate - a.perCrate ) ) {

		const per = r.margin > 0 && r.perCrate > 0 ? Math.max( 1, Math.round( r.margin / r.perCrate ) ) : 1;
		const units = Math.min( r.room, Math.floor( left / per ) );
		if ( units <= 0 ) continue;
		g += r.gain * units / r.room;
		left -= units * per;

	}

	return g;

}

// the best two-leg loop between any two boards for the stage's boat: { from, to, gain, metres, rate }
export function bestLoop( stage, boards ) {

	const S = STAGES[ stage ], hold = HOLD_CRATES[ S.boat ] || 4, ports = Object.keys( boards || {} );
	let best = null;
	for ( let i = 0; i < ports.length; i ++ ) for ( let j = i + 1; j < ports.length; j ++ ) {

		const a = ports[ i ], b = ports[ j ];
		const gain = legGain( boards[ a ], b, hold ) + legGain( boards[ b ], a, hold );
		if ( ! ( gain > 0 ) ) continue;
		const loop = { from: a, to: b, gain, metres: seaDistance( a, b ) };
		loop.rate = tradePerHour( stage, loop );
		if ( ! best || loop.rate > best.rate ) best = loop;

	}

	return best;

}

// notice-board bounties (tier by stage, the board's scale by standing): the reward, the navy's bounty for the same named ship and
// her loot, over the sail out and back, the search and the fight
export function bountyPerHour( stage ) {

	const S = STAGES[ stage ];
	if ( ! S.guns || ! S.tier ) return null;
	const T = BOUNTY_TIERS, tier = S.tier, cls = S.pirate;
	const reward = T.base[ tier ] * ( 1 + 0.07 * S.boardLevel );
	const navy = NAVY_BOUNTY[ cls ] * NAVY_BOUNTY.named;
	const loot = lootOf( cls );
	const range = mean( T.range[ tier ] ), speed = BOAT_SPEED[ S.boat ];
	const secs = 2 * range / speed + TIME.bountySearch[ tier ] + TIME.fight[ cls ] + TIME.port;
	return ( reward + navy + loot ) / secs * 3600;

}

function lootOf( cls ) {

	const c = SHIP_CLASSES[ cls ];
	return c && c.loot ? c.loot.crates * mean( c.loot.value ) : 0;

}

// hunting ordinary pirates for the navy's bounty (sloops: the common raider) and the convoys the sea events throw up meanwhile
export function navyPerHour( stage ) {

	const S = STAGES[ stage ];
	if ( ! S.guns ) return null;
	const kill = NAVY_BOUNTY.sloop + lootOf( 'sloop' ), tKill = TIME.huntSearch + TIME.fight.sloop * ( stage === 'late' ? 0.75 : 1 );
	// the sea events' clock runs while none is on (SeaEvents.update): every EVENTS.every s, a convoy (55 %: her reward and her
	// raiders' bounties) or a man overboard (his reward); hunting raiders the rest of the time
	const every = mean( NAVY_EVENTS.every ), pConvoy = 0.55;
	const convoy = NAVY_EVENTS.convoy.reward + mean( NAVY_EVENTS.convoy.pirates ) * kill;
	const overboard = NAVY_EVENTS.overboard.reward, tOverboard = 150;
	const perCycle = pConvoy * convoy + ( 1 - pConvoy ) * overboard + every / tKill * kill;
	const cycle = every + pConvoy * TIME.convoyFight + ( 1 - pConvoy ) * tOverboard;
	return perCycle / cycle * 3600;

}

// taking a pirate ship and selling her to Blackwater's fence (the hijack feature)
export function hijackPerHour( stage, overrides = {} ) {

	const S = STAGES[ stage ];
	if ( ! S.guns ) return null;
	const share = Number.isFinite( overrides[ 'hijack.fence' ] ) ? overrides[ 'hijack.fence' ] : FENCE;
	// the stage's raider: a sloop mid-game, a brigantine late (Fence.fencePrice: the yard price x FENCE, to $10)
	const hull = S.pirate || 'sloop', price = Math.round( BOATS[ hull ].price * share / 10 ) * 10;
	const sail = TIME.toFence / ( BOAT_SPEED[ hull ] || 8 );
	const secs = TIME.huntSearch + TIME.take * ( hull === 'brigantine' ? 1.3 : 1 ) + sail + TIME.port + TIME.homeAgain;
	const heat = HIJACK.cost.pirate.bounty || 0; // a pirate hull carries no bounty on you
	return ( price + lootOf( hull ) - heat ) / secs * 3600;

}

// hauling contracts: the best offers the licence allows, one at a time, at the boat's speed (the deposit comes back)
export function haulPerHour( stage, offers ) {

	if ( ! offers || ! offers.length ) return null;
	const S = STAGES[ stage ], speed = BOAT_SPEED[ S.boat ] || 3, hold = HOLD_CRATES[ S.boat ] || 4;
	const L = LICENCES[ S.licence ], max = Math.min( hold, L.maxCrates );
	const fit = offers.filter( ( o ) => o.crates <= max && ( o.tier || 0 ) <= S.licence );
	if ( ! fit.length ) return null;
	// out with the consignment and back with nothing (the deposit comes back on delivery)
	const rate = fit.map( ( o ) => o.reward * ( S.licence >= 2 ? L.payMul : 1 ) / ( 2 * seaDistance( o.from, o.to ) / speed + 2 * TIME.port ) * 3600 ).sort( ( a, b ) => b - a );
	return mean( rate.slice( 0, 3 ) ); // the three best on offer (a board is not always kind)

}

// what the boat and the crew cost per real hour: the boat's crew wages and upkeep (trade Operating) and the tavern hands (crew life)
export function wagesPerHour( stage ) {

	const S = STAGES[ stage ];
	const hands = mean( sailorsFor( 'tidemark', 0, 12 ).map( ( s ) => s.wage ) ) * S.hands;
	const boatCrew = ( CREW_ON[ S.boat ] || 0 ) * OPERATING.wage;
	const upkeep = ( BOATS[ S.boat ] ? BOATS[ S.boat ].price : 0 ) * OPERATING.upkeep;
	return { perHour: ( hands + boatCrew + upkeep ) * DAYS_PER_HOUR, perDay: hands + boatCrew + upkeep, hands, boatCrew, upkeep };

}

// ---------------------------------------------------------------- the table

export function table( { boards = {}, haul = [], overrides = {} } = {} ) {

	const rows = [], loops = {};
	for ( const st of STAGE_IDS ) loops[ st ] = bestLoop( st, boards );
	const row = ( id, label, fn, note ) => {

		const out = { id, label, note };
		for ( const st of STAGE_IDS ) { const v = fn( st ); out[ st ] = v === null || v === undefined ? null : r10( typeof v === 'object' ? v.value : v ); }
		rows.push( out );

	};

	row( 'fishing', 'Fishing (rod + crew anglers)', ( st ) => fishingPerHour( st ), 'Bites.js maths over FishTable, 06-20 h; crew anglers mid / late' );
	row( 'trade', 'Trade runs (best two-leg loop)', ( st ) => ( loops[ st ] ? loops[ st ].rate : null ), 'routes.board on a seeded market, the hold filled, less dues' );
	row( 'bounty', 'Notice bounties (named captains)', ( st ) => bountyPerHour( st ), 'NoticeData tier by stage + the navy\'s named bounty + loot' );
	row( 'navy', 'Navy bounties and convoys', ( st ) => navyPerHour( st ), 'NavyData BOUNTY.sloop + loot; a convoy (EVENTS.convoy) 55 % of event intervals' );
	row( 'hijack', 'Hijack fencing (the stage\'s pirate)', ( st ) => hijackPerHour( st, overrides ), `Fence.js FENCE ${ Number.isFinite( overrides[ 'hijack.fence' ] ) ? overrides[ 'hijack.fence' ] : FENCE } of the yard price` );
	row( 'haul', 'Haul contracts', ( st ) => haulPerHour( st, haul ), 'HaulContracts offers the licence allows (best three, back empty)' );

	const medians = {}, flags = [];
	for ( const st of STAGE_IDS ) {

		medians[ st ] = r10( median( rows.map( ( r ) => r[ st ] ).filter( ( v ) => v !== null ) ) );
		for ( const r of rows ) if ( r[ st ] !== null && medians[ st ] > 0 && r[ st ] > MEDIAN_MAX * medians[ st ] ) flags.push( { stage: st, id: r.id, value: r[ st ], times: Math.round( r[ st ] / medians[ st ] * 10 ) / 10 } );

	}

	const wages = {};
	for ( const st of STAGE_IDS ) { const w = wagesPerHour( st ); wages[ st ] = { perHour: r10( w.perHour ), perDay: Math.round( w.perDay ), share: medians[ st ] > 0 ? Math.round( w.perHour / medians[ st ] * 100 ) / 100 : 0 }; }
	return { rows, medians, flags, wages, prices: prices( medians ), overrides: { ...overrides }, loops };

}

// prices of the wave 18D arsenal and the navy chandler in minutes of the income of the stage that buys them
export function prices( medians ) {

	const list = [];
	const add = ( name, price, stage, src, pack = false ) => list.push( { name, price, stage, src, pack, minutes: medians[ stage ] > 0 ? Math.round( price / medians[ stage ] * 600 ) / 10 : null } );
	for ( const w of [ ...Object.values( MELEE_ARMS ), ...Object.values( THROWN ) ] ) if ( w.price > 0 ) add( w.name + ( w.pack ? ` x${ w.pack }` : '' ), w.price, w.id === 'axe' || w.pack ? 'mid' : 'early', 'weapons', !! w.pack );
	for ( const s of Object.values( SHOT ) ) if ( s && s.price > 0 ) add( s.name + ( s.pack ? ` x${ s.pack }` : '' ), s.price, 'mid', 'weapons', true );
	for ( const g of Object.values( GUNS ) ) if ( g.price > 0 && ! g.hidden ) add( g.name, g.price, g.id === 'pistol' ? 'early' : 'mid', 'firearms' );
	const hg = MODULES.heavyGuns && MODULES.heavyGuns.tiers;
	if ( hg ) { add( `Navy chandler: ${ hg[ 0 ].name } (standing ${ CHANDLER.heavy })`, hg[ 0 ].price, 'mid', 'navy' ); add( `Navy chandler: ${ hg[ 1 ].name } (standing ${ CHANDLER.long })`, hg[ 1 ].price, 'late', 'navy' ); }
	add( `Navy chandler: chain shot x${ CHANDLER.chain.pack }`, CHANDLER.chain.price, 'mid', 'navy', true );
	add( `Navy chandler: powder and shot x${ CHANDLER.powder.rounds }`, CHANDLER.powder.price, 'mid', 'navy', true );
	// a durable piece under PRICE_MIN.gear minutes of income is trivial, a consumable pack under PRICE_MIN.pack; anything over
	// PRICE_MAX minutes is out of reach of the stage that should buy it
	for ( const p of list ) p.flag = p.minutes === null ? '' : p.minutes < ( p.pack ? PRICE_MIN.pack : PRICE_MIN.gear ) ? 'trivial' : p.minutes > PRICE_MAX ? 'out of reach' : '';
	return list;

}

export function invariants( t ) {

	const out = [];
	for ( const st of STAGE_IDS ) {

		const top = Math.max( ...t.rows.map( ( r ) => r[ st ] ).filter( ( v ) => v !== null ) );
		out.push( { ok: top <= MEDIAN_MAX * t.medians[ st ], text: `${ st }: the best activity ($${ top }/h) is within ${ MEDIAN_MAX }x the median ($${ t.medians[ st ] }/h)` } );

	}

	out.push( { ok: t.wages.mid.perHour < WAGE_SHARE * t.medians.mid, text: `mid-game wages ($${ t.wages.mid.perHour }/h) under ${ WAGE_SHARE * 100 } % of the mid-game median income ($${ t.medians.mid }/h)` } );
	return out;

}

const money = ( v ) => ( v === null || v === undefined ? 'n/a' : '$' + Math.round( v ).toLocaleString( 'en-US' ) );

export function markdown( live, tuned ) {

	const L = [];
	L.push( '# Wave 20 balance table (earnings per real hour)', '' );
	L.push( 'Generated by `node test/feature-balance.mjs` from the game\'s constants (src/features/story/Balance.js has the model and its time', 'assumptions). A real hour is ' + DAYS_PER_HOUR + ' in-game days (DAY_SPEED ' + DAY_SPEED + ' island hours a second). n/a: not open at that stage', '(no guns early: no bounties, no navy work, no hijacking). Medians are over the activities open at the stage.', '' );
	const tab = ( t, title ) => {

		L.push( `## ${ title }`, '' );
		L.push( '| Activity | Early | Mid | Late | Source |', '|---|---:|---:|---:|---|' );
		for ( const r of t.rows ) L.push( `| ${ r.label } | ${ money( r.early ) } | ${ money( r.mid ) } | ${ money( r.late ) } | ${ r.note } |` );
		L.push( `| **Median** | ${ money( t.medians.early ) } | ${ money( t.medians.mid ) } | ${ money( t.medians.late ) } | |` );
		L.push( `| Wages and upkeep | ${ money( t.wages.early.perHour ) } | ${ money( t.wages.mid.perHour ) } | ${ money( t.wages.late.perHour ) } | Operating CREW x wage + upkeep, tavern hands (Life.sailorsFor) |` );
		L.push( `| Wages / median | ${ Math.round( t.wages.early.share * 100 ) } % | ${ Math.round( t.wages.mid.share * 100 ) } % | ${ Math.round( t.wages.late.share * 100 ) } % | invariant: mid < ${ WAGE_SHARE * 100 } % |`, '' );
		if ( t.flags.length ) L.push( 'Outliers (over ' + MEDIAN_MAX + 'x the median): ' + t.flags.map( ( f ) => `${ f.id } ${ f.stage } (${ f.times }x)` ).join( ', ' ), '' );
		else L.push( 'No outliers: every activity is within ' + MEDIAN_MAX + 'x its stage\'s median.', '' );
		for ( const i of invariants( t ) ) L.push( `- ${ i.ok ? 'holds' : 'BROKEN' }: ${ i.text }` );
		L.push( '' );

	};

	// what the numbers say beyond the invariants
	const t = tuned || live, by = ( id ) => t.rows.find( ( r ) => r.id === id );
	const notes = [];
	if ( by( 'hijack' ) && live.flags.some( ( f ) => f.id === 'hijack' ) ) notes.push( `Hijack fencing is the outlier: Fence.js FENCE ${ FENCE } pays ${ money( BOATS.sloop.price * FENCE ) } for a taken sloop, ${ money( BOATS.brigantine.price * FENCE ) } for a brigantine. Proposed patch: FENCE = ${ PROPOSED[ 'hijack.fence' ] }.` );
	if ( by( 'trade' ) && by( 'trade' ).late < by( 'trade' ).mid ) notes.push( `Trade runs do not grow with the hull: the boards' room (routes.roomFor) caps a loop at a few units a good, so the brigantine's ${ HOLD_CRATES.brigantine } crates earn less than the lobster boat's ${ HOLD_CRATES.lobster } (it sails slower). Bulk lots (master licence, the warehouse) are the late trader's tool; a deeper market for big holds is a trade-side follow-up.` );
	if ( t.wages.mid.share < 0.1 ) notes.push( `Wages are cheap: ${ Math.round( t.wages.mid.share * 100 ) } % of the mid-game median, ${ Math.round( t.wages.late.share * 100 ) } % late (tavern hands ${ money( wagesPerHour( 'mid' ).hands / Math.max( 1, STAGES.mid.hands ) ) } a day each). The invariant (< ${ WAGE_SHARE * 100 } %) holds with room; crew morale, not money, is what a skipper manages.` );
	if ( by( 'fishing' ) && by( 'fishing' ).late > t.medians.late ) notes.push( 'Fishing stays a real living: deep water with two crew anglers is the top late activity (the hold, not the bite rate, limits it).' );
	L.push( '## Findings', '', ...notes.map( ( n ) => `- ${ n }` ), '' );
	tab( live, 'As the constants stand now' );
	if ( tuned ) tab( tuned, 'With the proposed patches (' + Object.entries( tuned.overrides ).map( ( [ k, v ] ) => `${ k } = ${ v }` ).join( ', ' ) + ')' );
	L.push( '## Prices in minutes of income', '', '| Item | Price | Bought at | Minutes of that stage\'s median | Flag |', '|---|---:|---|---:|---|' );
	for ( const p of ( tuned || live ).prices ) L.push( `| ${ p.name } | ${ money( p.price ) } | ${ p.stage } | ${ p.minutes === null ? 'n/a' : p.minutes } | ${ p.flag } |` );
	L.push( '' );
	return L.join( '\n' );

}

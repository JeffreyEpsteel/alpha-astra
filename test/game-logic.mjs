// Plain-node tests of the fishing game logic (no GPU): bites, the catch fight, inventory, save.
import { FISH, FISH_IDS, fishValue, fishLengthCm } from '../src/game/FishTable.js';
import { habitatAt, pickSpecies, rollWeight, biteDelay, strikeWindow } from '../src/game/Bites.js';
import { CatchMinigame } from '../src/game/CatchMinigame.js';
import { GameState } from '../src/game/GameState.js';
import { gearStats, defaultUpgrades, UPGRADES } from '../src/game/Gear.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};
let seed = 12345;
const rng = () => ( ( seed = ( seed * 1664525 + 1013904223 ) >>> 0 ) / 4294967296 );

// ---- habitats and species
const spots = {
	sand: { depth: 0, reefDist: 200, pierDist: 200 },
	shallows: { depth: 1.5, reefDist: 200, pierDist: 80 },
	pier: { depth: 4, reefDist: 150, pierDist: 1 },
	reef: { depth: 5, reefDist: - 10, pierDist: 150 },
	deep: { depth: 40, reefDist: 300, pierDist: 400 },
};
for ( const [ name, s ] of Object.entries( spots ) ) {

	const h = habitatAt( s );
	const counts = {};
	for ( let i = 0; i < 2000; i ++ ) {

		const id = pickSpecies( h, 12, rng );
		if ( id ) counts[ id ] = ( counts[ id ] || 0 ) + 1;

	}

	const top = Object.entries( counts ).sort( ( a, b ) => b[ 1 ] - a[ 1 ] ).slice( 0, 5 ).map( ( [ k, v ] ) => `${ k } ${ ( v / 20 ).toFixed( 0 ) }%` ).join( ', ' );
	console.log( `     ${ name }: delay ~${ biteDelay( h, 12, () => 0.5 ).toFixed( 1 ) } s; ${ top || 'nothing' }` );

}
ok( pickSpecies( habitatAt( spots.sand ), 12, rng ) === null, 'nothing bites on dry sand' );
ok( biteDelay( habitatAt( spots.sand ), 12, rng ) === Infinity, 'no bite delay on sand' );
{

	let deepOnly = 0;
	for ( let i = 0; i < 500; i ++ ) if ( [ 'tuna', 'mahi', 'redSnapper', 'grouper', 'barracuda' ].includes( pickSpecies( habitatAt( spots.deep ), 12, rng ) ) ) deepOnly ++;
	ok( deepOnly === 500, 'deep water gives offshore species only' );
	let reefFish = 0;
	for ( let i = 0; i < 500; i ++ ) if ( FISH[ pickSpecies( habitatAt( spots.reef ), 12, rng ) ].habitat.reef ) reefFish ++;
	ok( reefFish > 400, `the reef gives mostly reef fish (${ reefFish / 5 }%)` );

}
{

	let tarponNight = 0, tarponDay = 0;
	for ( let i = 0; i < 4000; i ++ ) {

		if ( pickSpecies( habitatAt( spots.pier ), 22, rng ) === 'tarpon' ) tarponNight ++;
		if ( pickSpecies( habitatAt( spots.pier ), 12, rng ) === 'tarpon' ) tarponDay ++;

	}

	ok( tarponNight > tarponDay * 2, `tarpon bite at night (${ tarponNight } vs ${ tarponDay } by day)` );

}
for ( const id of FISH_IDS ) {

	const w = rollWeight( id, rng );
	if ( w < FISH[ id ].kg[ 0 ] || w > FISH[ id ].kg[ 1 ] ) ok( false, `weight in range for ${ id }` );

}
ok( fishValue( 'redSnapper', 5 ) > fishValue( 'redSnapper', 2 ), 'bigger fish is worth more' );

// ---- the fight: careful / skilled / mash / idle players, fixed seed, catch rates over many fights
// careful = a decent human: sees the gauge 0.25 s late, eases off on surges, loses focus now and then.
// skilled = same without lapses, and reacts to the surge warning. mash = always reeling. idle = never.
let fseed = 99;
const frng = () => ( ( fseed = ( fseed * 1664525 + 1013904223 ) >>> 0 ) / 4294967296 );
const player = ( kind ) => {

	if ( kind === 'mash' ) return () => true;
	if ( kind === 'idle' ) return () => false;
	const q = [];
	let lapse = 0;
	return ( g ) => {

		q.push( { t: g.tension, s: g.surge } );
		const v = kind === 'skilled' ? { t: g.tension, s: Math.max( g.surge, g.surgeWarn > 0.5 ? 1 : 0 ) } : q.length > 15 ? q[ q.length - 16 ] : q[ 0 ];
		if ( kind === 'careful' ) {

			if ( lapse > 0 ) { lapse -= 1 / 60; return true; }
			if ( frng() < 0.12 / 60 ) { lapse = 0.5; return true; }

		}

		return v.t < g.band[ 1 ] - 0.05 && v.s < 0.6;

	};

};

const fightOnce = ( species, kg, kind, lineKg, reelSpeed ) => {

	const g = new CatchMinigame( { species, kg, lineKg, reelSpeed, distance: 18, rng: frng } );
	const p = player( kind );
	let st = 'fighting';
	for ( let i = 0; i < 60 * 180 && st === 'fighting'; i ++ ) st = g.update( 1 / 60, p( g ) );
	return st;

};

const rate = ( species, kg, kind, lineKg = 7, reelSpeed = 1.1, n = 150 ) => {

	let c = 0;
	for ( let i = 0; i < n; i ++ ) if ( fightOnce( species, kg, kind, lineKg, reelSpeed ) === 'caught' ) c ++;
	return c / n;

};

// [ label, class, [ species, kg ], lineKg, reelSpeed ]
const cases = [
	[ 'grunt 0.8 kg, 8 lb', 'small', [ 'grunt', 0.8 ], 7, 1.1 ],
	[ 'yellowtail 1.2 kg, 8 lb', 'small', [ 'yellowtail', 1.2 ], 7, 1.1 ],
	[ 'redSnapper 6 kg, 8 lb', 'medium', [ 'redSnapper', 6 ], 7, 1.1 ],
	[ 'jack 4 kg, 8 lb', 'medium', [ 'jack', 4 ], 7, 1.1 ],
	[ 'tuna 7 kg, 15 lb', 'medium', [ 'tuna', 7 ], 13, 1.6 ],
	[ 'jack 6 kg, 8 lb', 'big', [ 'jack', 6 ], 7, 1.1 ],
	[ 'tuna 6 kg, 8 lb', 'big', [ 'tuna', 6 ], 7, 1.1 ],
	[ 'tuna 8 kg, 15 lb', 'big', [ 'tuna', 8 ], 13, 1.6 ],
	[ 'tuna 14 kg, 30 lb', 'big', [ 'tuna', 14 ], 26, 2.2 ],
	[ 'tarpon 25 kg, 60 lb', 'big', [ 'tarpon', 25 ], 50, 2.2 ],
];
const R = {};
console.log( '     catch rate %      careful skilled mash idle' );
for ( const [ label, cls, [ sp, kg ], lk, rs ] of cases ) {

	const r = { careful: rate( sp, kg, 'careful', lk, rs ), skilled: rate( sp, kg, 'skilled', lk, rs ), mash: rate( sp, kg, 'mash', lk, rs, 60 ), idle: rate( sp, kg, 'idle', lk, rs, 60 ) };
	R[ label ] = { cls, ...r };
	console.log( `     ${ ( cls + ' ' + label ).padEnd( 36 ) } ${ [ r.careful, r.skilled, r.mash, r.idle ].map( ( v ) => String( Math.round( v * 100 ) ).padStart( 5 ) ).join( ' ' ) }` );

}

const avg = ( cls, k ) => { const l = Object.values( R ).filter( ( r ) => r.cls === cls ); return l.reduce( ( a, r ) => a + r[ k ], 0 ) / l.length; };
ok( cases.filter( ( c ) => c[ 1 ] === 'small' ).every( ( c ) => R[ c[ 0 ] ].careful >= 0.9 ), 'careful reeling lands small fish 90%+' );
ok( avg( 'medium', 'careful' ) >= 0.68 && avg( 'medium', 'careful' ) <= 0.92, `careful lands medium fish about 70-90% (${ Math.round( avg( 'medium', 'careful' ) * 100 ) }%)` );
ok( avg( 'big', 'careful' ) >= 0.3 && avg( 'big', 'careful' ) <= 0.6, `careful lands big fish about 35-55% (${ Math.round( avg( 'big', 'careful' ) * 100 ) }%)` );
ok( cases.filter( ( c ) => c[ 1 ] !== 'small' ).every( ( c ) => R[ c[ 0 ] ].mash <= 0.1 ), 'mashing the button almost never lands anything but small fish' );
ok( cases.every( ( c ) => R[ c[ 0 ] ].idle === 0 ), 'never reeling loses every fish' );
ok( avg( 'big', 'skilled' ) > avg( 'big', 'careful' ), 'reacting to the surge warning beats reacting late' );
ok( rate( 'jack', 6, 'careful', 26, 2.2 ) > rate( 'jack', 6, 'careful', 7, 1.1 ) + 0.3, 'a stronger line and reel raise the odds on the same fish' );
ok( rate( 'tarpon', 35, 'careful', 7, 1.1, 40 ) <= 0.05, 'a 35 kg tarpon beats the starter line' );
{

	const g = new CatchMinigame( { species: 'tuna', kg: 8, lineKg: 7, reelSpeed: 1.1, distance: 18, rng: frng } );
	let warned = 0, hold = 1;
	for ( let i = 0; i < 60 * 40 && g.state === 'fighting'; i ++ ) { g.update( 1 / 60, g.tension < 0.5 ); if ( g.surgeWarn > 0 && g.surge < 0.3 ) warned ++; hold = Math.min( hold, g.hookHold ); }
	ok( warned > 10 && hold <= 1, 'a surge is announced by surgeWarn before it hits' );

}

ok( strikeWindow( 'grunt' ) < 1.7 && strikeWindow( 'tarpon' ) >= 1.0 && strikeWindow( 'tarpon' ) < strikeWindow( 'grunt' ), 'the strike window is short (1.1 to 1.6 s)' );
const slow = new CatchMinigame( { species: 'tuna', kg: 8, lineKg: 7, distance: 18, rng: frng } );
ok( slow.band[ 1 ] - slow.band[ 0 ] < new CatchMinigame( { species: 'grunt', kg: 0.8, lineKg: 7, distance: 18, rng: frng } ).band[ 1 ] - 0.3, 'strong fish have a narrower green band' );

// ---- inventory, wallet, save round trip
const mem = new Map();
const storage = { getItem: ( k ) => mem.get( k ) ?? null, setItem: ( k, v ) => mem.set( k, v ) };
const s = new GameState( storage );
ok( s.stats.holdKg === 30, 'cooler holds 30 kg' );
const a = s.addFish( 'grunt', 0.84, 9.5 );
const b = s.addFish( 'yellowtail', 1.31, 10 );
ok( a && b && s.inventory.length === 2, 'fish go into the cooler' );
ok( s.addFish( 'tarpon', 40, 22 ) === null && s.log.tarpon.count === 1, 'a fish too big for the hold is logged but not kept' );
const value = s.holdValue;
const sale = s.sell( [ a.id ] );
ok( sale.count === 1 && s.money === a.value && s.inventory.length === 1, 'selling one fish pays for it' );
s.upgrades.hold = 1;
const s2 = new GameState( storage );
s.save();
ok( s2.load() && s2.money === s.money && s2.inventory.length === 1 && s2.log.grunt.bestKg === 0.84 && s2.stats.holdKg === 70, 'save / load round trip' );
ok( s2.addFish( 'grunt', 0.5 ).id > b.id, 'ids keep counting after a load' );
// ---- lengths and the catch card's record logic
{

	let sane = true;
	for ( const id of FISH_IDS ) {

		const f = FISH[ id ];
		const lo = fishLengthCm( id, f.kg[ 0 ] ), hi = fishLengthCm( id, f.kg[ 1 ] );
		if ( ! ( lo > 5 && hi < 200 && hi > lo && typeof f.sci === 'string' ) ) sane = false;

	}

	ok( sane, 'every species has a scientific name and a plausible, increasing length (5–200 cm)' );
	ok( Math.abs( fishLengthCm( 'mahi', 10 ) - 108 ) < 3 && Math.abs( fishLengthCm( 'grunt', 0.84 ) - 36 ) < 2, 'length-weight: a 10 kg mahi ~108 cm, a 0.84 kg grunt ~36 cm' );
	const m = new Map();
	const st = new GameState( { getItem: ( k ) => m.get( k ) ?? null, setItem: ( k, v ) => m.set( k, v ) } );
	const c1 = st.addFish( 'jack', 3.2 ), i1 = st.lastCatch;
	ok( c1 && i1.newSpecies && ! i1.record && c1.cm === i1.cm && i1.cm > 50, 'first of a species: new species, not a record, length stored' );
	st.addFish( 'jack', 2.1 );
	const i2 = st.lastCatch;
	ok( ! i2.newSpecies && ! i2.record && i2.prevBestKg === 3.2 && st.log.jack.bestKg === 3.2, 'a smaller one: no record, best unchanged' );
	st.addFish( 'jack', 4.05 );
	const i3 = st.lastCatch;
	ok( i3.record && i3.prevBestKg === 3.2 && i3.prevBestCm === i1.cm && st.log.jack.bestKg === 4.05 && st.log.jack.bestCm === i3.cm, 'a bigger one: new record, previous best reported, log updated' );
	st.addFish( 'tarpon', 40 );
	ok( st.lastCatch.kept === false && st.lastCatch.newSpecies, 'a fish that does not fit: logged, card says released' );
	// a save from before lengths: inventory and log get lengths on load
	const old = { v: 1, money: 5, inventory: [ { id: 1, species: 'grunt', kg: 0.84, value: 6, caughtAt: 9 } ], log: { grunt: { count: 1, bestKg: 0.84 } }, upgrades: {}, fuel: null, nextId: 2 };
	const st2 = new GameState( { getItem: () => JSON.stringify( old ), setItem: () => {} } );
	ok( st2.load() && st2.inventory[ 0 ].cm === 36 && st2.log.grunt.bestCm === 36, 'old saves load with lengths filled in' );

}
ok( new GameState( { getItem: () => { throw new Error( 'blocked' ); }, setItem: () => { throw new Error( 'blocked' ); } } ).load() === false, 'blocked storage does not throw' );
ok( s.spend( 1e9 ) === false, 'cannot spend more than you have' );
ok( Object.keys( defaultUpgrades() ).length === Object.keys( UPGRADES ).length && gearStats( defaultUpgrades() ).finder === false, 'gear stats' );
{

	const m = new Map();
	const st = new GameState( { getItem: ( k ) => m.get( k ) ?? null, setItem: ( k, v ) => m.set( k, v ) } );
	st.money = 100;
	ok( st.buy( 'reel' ) && st.upgrades.reel === 1 && st.money === 10 && st.stats.reelSpeed === 1.6, 'buying the reel upgrade' );
	ok( st.buy( 'reel' ) === null && st.upgrades.reel === 1, 'cannot buy what you cannot afford' );
	ok( st.fuelL === 40 && st.burn( 30 ) === 10 && st.refuelCost() === 45, 'fuel burns and costs to refill' );
	st.money = 20;
	ok( st.refuel() === 13 && st.money === 0 && Math.abs( st.fuelL - 23 ) < 1e-6, 'refuel stops when the money runs out' );
	st.money = 1000;
	ok( st.buy( 'fuel' ) && st.fuelL === 80, 'a new tank comes full' );
	ok( st.buy( 'fishFinder' ) && st.stats.finder === true && st.buy( 'fishFinder' ) === null, 'fish finder: one level' );

}
console.log( `value check ${ value }` );
console.log( fails ? `${ fails } FAILED` : 'all passed' );
process.exit( fails ? 1 : 0 );

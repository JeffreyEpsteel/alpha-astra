// Plain-node tests of the Unreal game's fish set (UpsideDownFishing Data/Fish.csv) and the marker
// timing fight: the table entries, the bite balance (rarity, night-only, no flooding), the models,
// and that the marker fight can be won and lost while the tension fight is untouched.
//   node test/feature-fish-unreal.mjs
import { FISH, FISH_IDS, fishLengthCm, fishValue } from '../src/game/FishTable.js';
import { pickSpecies, activity, habitatAt, strikeWindow } from '../src/game/Bites.js';
import { CatchMinigame, MarkerMinigame, createFight, MarkerGauge, MARKER, MARKER_PALETTE, setMarkerPalette } from '../src/game/CatchMinigame.js';
import { SPECIES, SKIN, PATTERN } from '../src/world/fish/FishSpecies.js';
import { fishGeometry } from '../src/world/fish/FishGeometry.js';
import { mulberry32 } from '../src/util/Noise.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};

// Data/Fish.csv: StableId, MinSizeCm, MaxSizeCm, AllowedTimePeriods, CatchDifficulty, Weight (SelectionWeight), BaseValue
const CSV = {
	silverminnow: { id: 'Fish.SilverMinnow', cm: [ 8, 18 ], difficulty: 1, weight: 50, base: 12, rarity: 'Common' },
	rootfin: { id: 'Fish.Rootfin', cm: [ 15, 28 ], difficulty: 2, weight: 34, base: 18, rarity: 'Common' },
	lanterncarp: { id: 'Fish.LanternCarp', cm: [ 22, 42 ], difficulty: 3, weight: 18, base: 36, rarity: 'Uncommon' },
	upsidedowneel: { id: 'Fish.UpsideDownEel', cm: [ 45, 90 ], difficulty: 4, weight: 14, base: 42, rarity: 'Uncommon' },
	glassperch: { id: 'Fish.GlassPerch', cm: [ 18, 32 ], difficulty: 4, weight: 8, base: 48, rarity: 'Rare' },
	crookedcod: { id: 'Fish.CrookedCod', cm: [ 38, 70 ], difficulty: 5, weight: 6, base: 65, rarity: 'Rare' },
};
const UNREAL = Object.keys( CSV );

// ---- table entries on the existing schema
{

	ok( UNREAL.every( ( id ) => FISH_IDS.includes( id ) ), 'the six ids exist exactly as the quests spell them' );
	ok( FISH_IDS.length === 24, 'the 18 Tidewater species are all still there' );
	for ( const id of UNREAL ) {

		const f = FISH[ id ], c = CSV[ id ];
		const keys = [ 'name', 'sci', 'lw', 'model', 'habitat', 'kg', 'price', 'fight', 'stamina', 'time', 'rarity' ];
		ok( keys.every( ( k ) => f[ k ] !== undefined ) && SPECIES[ f.model ] && SKIN[ f.model ], `${ id }: full schema, model and skin` );
		ok( f.unreal === c.id && f.difficulty === c.difficulty && f.unrealRarity === c.rarity && f.minigame === 'marker', `${ id }: Unreal id, difficulty ${ c.difficulty }, rarity, marker fight` );
		const l0 = fishLengthCm( id, f.kg[ 0 ] ), l1 = fishLengthCm( id, f.kg[ 1 ] );
		ok( Math.abs( l0 - c.cm[ 0 ] ) < 0.6 && Math.abs( l1 - c.cm[ 1 ] ) < 0.6, `${ id }: ${ l0.toFixed( 1 ) } .. ${ l1.toFixed( 1 ) } cm (CSV ${ c.cm[ 0 ] } .. ${ c.cm[ 1 ] })` );
		ok( fishValue( id, f.kg[ 0 ] ) >= 1 && strikeWindow( id ) > 1, `${ id }: value and strike window` );

	}

	// rarity follows the Unreal SelectionWeight order
	const byWeight = [ ...UNREAL ].sort( ( a, b ) => CSV[ b ].weight - CSV[ a ].weight );
	ok( byWeight.every( ( id, i ) => i === 0 || FISH[ id ].rarity <= FISH[ byWeight[ i - 1 ] ].rarity ), 'rarity follows the Unreal weights' );
	// typical value follows BaseValue (rarer fish are worth more)
	const typ = ( id ) => fishValue( id, FISH[ id ].kg[ 0 ] + ( FISH[ id ].kg[ 1 ] - FISH[ id ].kg[ 0 ] ) * 0.31 );
	const byBase = [ ...UNREAL ].sort( ( a, b ) => CSV[ a ].base - CSV[ b ].base );
	ok( byBase.every( ( id, i ) => i === 0 || typ( id ) >= typ( byBase[ i - 1 ] ) ), 'typical value follows the Unreal base value: ' + byBase.map( ( id ) => '$' + typ( id ) ).join( ' ' ) );
	const pats = UNREAL.map( ( id ) => PATTERN[ id ] );
	ok( new Set( Object.values( PATTERN ) ).size === Object.keys( PATTERN ).length && pats.every( ( p ) => p >= 21 ), 'own pattern ids (skin table rows)' );

}

// ---- bites: night-only lantern carp, the habitats, no flooding
{

	ok( activity( 'nightOnly', 12 ) < 1e-3 && activity( 'nightOnly', 8 ) < 1e-3 && activity( 'nightOnly', 23 ) === 1 && activity( 'nightOnly', 18.5 ) > 0.7, 'nightOnly: dusk and night, never by day or dawn' );
	const pier = habitatAt( { depth: 4, reefDist: 40, pierDist: 3 } );
	const shallows = habitatAt( { depth: 1.5, reefDist: 60, pierDist: 60 } );
	const reef = habitatAt( { depth: 5, reefDist: - 3, pierDist: 80 } );
	const deep = habitatAt( { depth: 30, reefDist: 80, pierDist: 200 } );
	const count = ( h, hour, n = 20000 ) => {

		const rng = mulberry32( 7 ), c = {};
		for ( let i = 0; i < n; i ++ ) {

			const s = pickSpecies( h, hour, rng );
			c[ s ] = ( c[ s ] || 0 ) + 1;

		}

		return c;

	};
	const noon = count( pier, 12 ), night = count( pier, 23 );
	ok( ! noon.lanterncarp && night.lanterncarp > 0, `lantern carp: none at noon, ${ night.lanterncarp } of 20000 bites at night by the pier` );
	ok( count( shallows, 10 ).silverminnow > 0 && count( pier, 10 ).rootfin > 0 && count( pier, 23 ).upsidedowneel > 0 && count( shallows, 6.5 ).glassperch > 0 && count( reef, 12 ).crookedcod > 0, 'every Unreal fish bites in its home water (quests can be done)' );
	for ( const [ name, h ] of [ [ 'pier', pier ], [ 'shallows', shallows ], [ 'reef', reef ], [ 'deep', deep ] ] ) for ( const hour of [ 6.5, 12, 23 ] ) {

		const c = count( h, hour, 8000 );
		let u = 0, all = 0;
		for ( const k in c ) {

			all += c[ k ];
			if ( UNREAL.includes( k ) ) u += c[ k ];

		}

		ok( u / all < 0.42, `no flooding: ${ name } at ${ hour } h, Unreal fish ${ ( u / all * 100 ).toFixed( 0 ) } % of bites` );

	}

}

// ---- models: every level of detail, distinct shapes
{

	for ( const id of UNREAL ) {

		const S = SPECIES[ id ];
		let finite = true, tris = 0;
		for ( const lod of [ 0, 1, 2, 3 ] ) for ( const pose of [ 'swim', 'dead' ] ) {

			const g = fishGeometry( S, { lod, pose } );
			for ( const v of g.attributes.position.array ) if ( ! Number.isFinite( v ) ) finite = false;
			if ( lod === 0 && pose === 'swim' ) tris = ( g.index ? g.index.count : g.attributes.position.count ) / 3;

		}

		ok( finite && tris > 500, `${ id }: geometry at every level of detail (${ tris } triangles)` );

	}

	const xs = ( id ) => {

		const p = fishGeometry( SPECIES[ id ], { lod: 1, pose: 'swim' } ).attributes.position.array;
		let mn = 1e9, mx = - 1e9;
		for ( let i = 0; i < p.length; i += 3 ) { mn = Math.min( mn, p[ i ] ); mx = Math.max( mx, p[ i ] ); }
		return [ mn, mx ];

	};
	const [ cn, cx ] = xs( 'crookedcod' ), [ gn, gx ] = xs( 'grunt' );
	ok( Math.abs( cx + cn ) > 0.02 && Math.abs( gx + gn ) < 1e-3, 'the crooked cod is bent to one side (the grunt is symmetric)' );
	ok( SPECIES.upsidedowneel.pelvic === null && SKIN.upsidedowneel.belly < SKIN.upsidedowneel.back, 'the eel: no pelvic fins, inverted counter-shading (dark belly up when belly-up)' );

}

// ---- the tension fight is untouched for the Tidewater species
{

	const a = new CatchMinigame( { species: 'grunt', kg: 0.8, rng: mulberry32( 3 ) } );
	ok( a instanceof CatchMinigame && a.kind === 'tension' && a.band[ 0 ] > 0.3, 'grunt: the tension fight' );
	const b = createFight( { species: 'grunt', kg: 0.8, rng: mulberry32( 3 ) } );
	let sa, sb;
	for ( let i = 0; i < 600; i ++ ) {

		sa = a.update( 1 / 60, i % 90 < 60 );
		sb = b.update( 1 / 60, i % 90 < 60 );

	}

	ok( sa === sb && Math.abs( a.distance - b.distance ) < 1e-9 && Math.abs( a.tension - b.tension ) < 1e-9, 'createFight gives the same tension fight' );
	const m = new CatchMinigame( { species: 'rootfin', kg: 0.2 } );
	ok( m instanceof MarkerMinigame && m.kind === 'marker', 'new CatchMinigame( rootfin ) is a marker fight (Game.js unchanged)' );
	ok( new CatchMinigame( { species: 'rootfin', kg: 0.2, classic: true } ) instanceof CatchMinigame, 'classic: true forces the tension fight' );

}

// ---- the marker fight
const DT = 1 / 60;
// a player: presses (a one-frame press) when wanted( fight ) says so
function play( fight, wanted, maxT = 40 ) {

	let st = 'fighting', held = false, t = 0;
	while ( st === 'fighting' && t < maxT ) {

		const press = ! held && fight.cooldown <= 0 && wanted( fight );
		held = press;
		st = fight.update( DT, press );
		t += DT;

	}

	return { st, t };

}

const sharp = ( f ) => {

	const [ lo, hi ] = f.zone;
	return Math.abs( f.marker - ( lo + hi ) / 2 ) < ( hi - lo ) * 0.3;

};
const base = { lineKg: 7, reelSpeed: 1.1, castM: 22, distance: 12 };
{

	for ( const id of UNREAL ) {

		const f = FISH[ id ];
		const big = new MarkerMinigame( { species: id, kg: f.kg[ 1 ], ...base, rng: mulberry32( 11 ) } );
		const r = play( big, sharp );
		ok( r.st === 'caught' && big.misses === 0 && big.hits === big.required, `${ id }: sharp timing lands even a trophy (${ big.required } strikes in ${ r.t.toFixed( 1 ) } s)` );

	}

	// idle: the fish never comes in; the strain or the clock loses it
	const idle = new MarkerMinigame( { species: 'silverminnow', kg: 0.03, ...base } );
	const ri = play( idle, () => false );
	ok( ri.st === 'escaped' || ri.st === 'snapped', `waiting never lands it (${ ri.st } after ${ ri.t.toFixed( 1 ) } s)` );
	// mashing: presses out of the zone build strain; three misses lose it
	const mash = new MarkerMinigame( { species: 'crookedcod', kg: 2, ...base } );
	const rm = play( mash, ( f ) => ! f.inZone );
	ok( ( rm.st === 'escaped' || rm.st === 'snapped' ) && mash.misses <= 3 && mash.hits === 0, `missing every strike loses the fish (${ rm.st }, ${ mash.misses } misses)` );
	const three = new MarkerMinigame( { species: 'silverminnow', kg: 0.01, lineKg: 50, reelSpeed: 2.2, castM: 45 } );
	ok( three.missStrain * 3 + three.strain < 1, 'light minnow on heavy line: three misses do not snap it' );
	ok( play( three, ( f ) => ! f.inZone ).st === 'escaped' && three.misses === 3, 'three misses: the hook pulls free' );
	// a random presser mostly loses the hard fish
	let wins = 0;
	for ( let s = 0; s < 40; s ++ ) {

		const rng = mulberry32( 100 + s );
		const g = new MarkerMinigame( { species: 'crookedcod', kg: 2.5, ...base, rng } );
		if ( play( g, () => rng() < 0.02 ).st === 'caught' ) wins ++;

	}

	ok( wins < 12, `random presses land a crooked cod ${ wins } / 40 times` );
	// the press that hooked the fish is still held: no strike until it is released and pressed again
	const h = new MarkerMinigame( { species: 'rootfin', kg: 0.2, ...base } );
	for ( let i = 0; i < 120; i ++ ) h.update( DT, true );
	ok( h.hits === 0 && h.misses === 0, 'holding the button does not strike' );
	h.update( DT, false );
	h.update( DT, true );
	ok( h.hits + h.misses === 1, 'a fresh press strikes once' );

	// difficulty and gear
	const easy = new MarkerMinigame( { species: 'silverminnow', kg: 0.03, ...base } );
	const hard = new MarkerMinigame( { species: 'crookedcod', kg: 2, ...base } );
	ok( hard.speed > easy.speed && hard.zoneWidth < easy.zoneWidth && hard.required === 4 && easy.required === 3, `difficulty: marker ${ easy.speed.toFixed( 2 ) } -> ${ hard.speed.toFixed( 2 ) }, zone ${ easy.zoneWidth.toFixed( 3 ) } -> ${ hard.zoneWidth.toFixed( 3 ) }` );
	ok( Math.abs( easy.zoneWidth - ( MARKER.zone - MARKER.zoneShrink ) ) < 1e-9, 'base gear: the Unreal zone width (0.22 - 0.02 d)' );
	const geared = new MarkerMinigame( { species: 'crookedcod', kg: 2, lineKg: 50, reelSpeed: 2.2, castM: 45 } );
	ok( geared.speed < hard.speed && geared.zoneWidth > hard.zoneWidth && geared.passive < hard.passive, 'better reel, line and rod: slower marker, wider zone, less strain' );
	const heavy = new MarkerMinigame( { species: 'crookedcod', kg: 3.6, ...base } );
	ok( heavy.passive > hard.passive, 'a heavier fish strains the line faster' );
	ok( hard.drift > 0 && easy.drift === 0, 'difficulty 4+ fish shift the zone' );

	// the shared HUD / rod fields
	const s = new MarkerMinigame( { species: 'lanterncarp', kg: 0.6, ...base } );
	ok( [ 'tension', 'stamina', 'distance', 'surge', 'surgeWarn', 'hookHold' ].every( ( k ) => Number.isFinite( s[ k ] ) ) && s.band.length === 2 && s.call && s.call.text, 'fields for the fight panel and the rod' );
	ok( s.tension >= s.band[ 0 ] && s.tension <= s.band[ 1 ], 'a fresh fight reads as good pressure on the tension gauge' );

	// the gauge without a DOM, and the palette hook
	const gauge = new MarkerGauge( null );
	gauge.update( s );
	setMarkerPalette( { zone: '#00ff00' } );
	ok( gauge.el === null && typeof MARKER_PALETTE.zone === 'string', 'MarkerGauge is a no-op without a DOM; the palette can be swapped' );

}

console.log( fails ? `\n${ fails } FAILED` : '\nall fish checks passed' );
process.exit( fails ? 1 : 0 );

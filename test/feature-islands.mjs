// Islands 5-8 (the Unreal game's West Haven, The Shrine, Quiet Shoal and the Inverted Isles): the terrain keeps
// the main island, Pons Cove, Gull Rock and Saltmarsh Key bit-identical, each new island has its beach, jetty and
// mooring where WORLD says, deep water round it and a sailing approach; the Inverted Isles' atoll holds a calm
// lagoon a seaplane can land in; the Ports class builds the four islands (vendors, lights, markers, colliders,
// discovery spots, distance culling).
//   node test/feature-islands.mjs                 checks only
//   node test/feature-islands.mjs --render [dir]  also renders each island headless (PNG per view)
import assert from 'node:assert/strict';
import { TerrainData } from '../src/world/TerrainData.js';
import { WORLD } from '../src/world/WorldLayout.js';
import { ISLETS, ISLETS_BY_ID, ISLES_5_8, isletWorld, SEA_STACKS, PONS_STACKS } from '../src/world/terrain/IslandShape.js';
import { MERCHANT_ROUTE, PATROLS, legs } from '../src/features/naval/Routes.js';

let fails = 0, n = 0;
const ok = ( c, msg, info = '' ) => {

	n ++;
	if ( ! c ) { fails ++; console.log( 'FAIL', msg, info ); } else console.log( 'ok  ', msg, info );

};

const NEW = [ 'haven', 'shrine', 'shoal', 'inverted' ];
const t0 = performance.now();
const t = new TerrainData();
const genMs = performance.now() - t0;
ok( genMs < 15000, 'terrain generates in reasonable time', Math.round( genMs ) + ' ms ' + JSON.stringify( t.timings ) );

// ---------------------------------------------------------------- 1. the older islands are bit-identical
const f32 = new Float32Array( 1 ), u32 = new Uint32Array( f32.buffer );
function fnv( cx, cz, R ) {

	let h = 0x811c9dc5 >>> 0, c = 0;
	for ( let j = 0; j < t.res; j ++ ) for ( let i = 0; i < t.res; i ++ ) {

		const x = t.origin + i + 0.5, z = t.origin + j + 0.5;
		if ( Math.hypot( x - cx, z - cz ) > R ) continue;
		const k = j * t.res + i;
		f32[ 0 ] = t.heights[ k ];
		for ( const v of [ u32[ 0 ], Math.round( t.rock[ k ] * 1e6 ), t.sand[ k ], t.path[ k ], t.gully[ k ], t.seagrass[ k ], t.rubble[ k ], t.scarp[ k ] ] ) {

			h ^= v >>> 0;
			h = Math.imul( h, 16777619 ) >>> 0;

		}

		c ++;

	}

	return h.toString( 16 ) + ':' + c;

}

// hashes recorded on the four-island terrain before islands 5-8 were composed in (test/world-islands.mjs has the first three)
for ( const [ name, x, z, R, want ] of [
	[ 'Pons (300 m)', 620, 560, 300, '9cb7cd06:282792' ],
	[ 'the main island (450 m round the summit bay)', 0, - 300, 450, '1f5cf4a1:636160' ],
	[ 'Gull Rock (175 m)', - 560, 200, 175, 'dbe56728:96224' ],
	[ 'Saltmarsh Key (200 m)', 740, 70, 200, '1c0fcfb4:125676' ],
] ) {

	const h = fnv( x, z, R );
	ok( h === want, name + ' is bit-identical', h );

}

// ---------------------------------------------------------------- 2. each new island
const foot = {};
for ( const id of NEW ) {

	const I = ISLETS_BY_ID[ id ], W = WORLD[ id ], Dk = W.dock;
	// the footprint: land and shoal (> -2.5 m) of this island within its own reach (rock heads farther out are seabed)
	const R = Math.max( I.ru, I.rv ) + 60;
	let land = 0, rmax = 0, peak = - 99, edge = 0, shoalEdge = 0;
	for ( let dz = - R; dz <= R; dz += 1 ) for ( let dx = - R; dx <= R; dx += 1 ) {

		if ( Math.hypot( dx, dz ) > R ) continue;
		const x = I.x + dx, z = I.z + dz;
		if ( t.islandAt( x, z ) !== id ) continue;
		const h = t.heightAt( x, z );
		if ( h > 0.3 ) land ++;
		if ( h > 1 ) edge = Math.max( edge, Math.abs( x ), Math.abs( z ) ); // dry land (awash rock heads off the cliffs aside)
		if ( h > - 2.5 ) { rmax = Math.max( rmax, Math.hypot( dx, dz ) ); shoalEdge = Math.max( shoalEdge, Math.abs( x ), Math.abs( z ) ); }
		peak = Math.max( peak, h );

	}

	foot[ id ] = rmax;
	ok( land > 2500, id + ': a real island (land, shoal footprint)', land + ' m2 land, footprint ' + rmax.toFixed( 0 ) + ' m, peak ' + peak.toFixed( 1 ) + ' m' );
	// the terrain fades to the deep ocean floor over the outer 120 m (|x|, |z| > 904): the land stays inside, the
	// shoal and the awash rocks off the cliffs may reach a few metres into the band, where the fade lowers them by
	// under 0.3 m
	ok( edge < 904 && shoalEdge < 920, id + ': inside the terrain, its land clear of the border fade', 'land to ' + edge.toFixed( 0 ) + ' m, shoal to ' + shoalEdge.toFixed( 0 ) + ' m' );
	const hS = t.heightAt( Dk.start.x, Dk.start.z );
	ok( hS >= 0.3 && hS <= 2.0, id + ': ground at the jetty foot', hS.toFixed( 2 ) + ' m' );
	ok( Dk.deckHeight - hS <= 0.36 && Dk.deckHeight > hS, id + ': the deck is one step up from the foot', 'deck ' + Dk.deckHeight + ' foot ' + hS.toFixed( 2 ) );
	const hE = t.heightAt( Dk.end.x, Dk.end.z );
	ok( hE < - 1.5, id + ': water under the jetty head', hE.toFixed( 2 ) + ' m' );
	const hM = t.heightAt( Dk.position.x, Dk.position.z );
	ok( hM < - 1.5 && Math.hypot( Dk.position.x - Dk.end.x, Dk.position.z - Dk.end.z ) < 12, id + ': the mooring has water for the hull, by the jetty head', hM.toFixed( 2 ) + ' m' );
	let under = - 99;
	for ( let q = 0; q <= 30; q ++ ) under = Math.max( under, t.heightAt( Dk.start.x + ( Dk.end.x - Dk.start.x ) * q / 30, Dk.start.z + ( Dk.end.z - Dk.start.z ) * q / 30 ) );
	ok( under < Dk.deckHeight - 0.1, id + ': the ground under the jetty stays below the deck', under.toFixed( 2 ) + ' m' );
	ok( t.coastDistance( Dk.end.x, Dk.end.z ).d > 0 && t.coastDistance( Dk.start.x, Dk.start.z ).d < 0, id + ': coastDistance: the jetty runs from land to water' );
	ok( t.islandAt( I.x + ( id === 'inverted' ? I.ax * - 130 : 0 ), I.z + ( id === 'inverted' ? I.az * - 130 : 0 ) ) === id, id + ': islandAt names it' );
	const ring = [];
	for ( let a = 0; a < 16; a ++ ) ring.push( t.heightAt( I.x + Math.cos( a * 0.3927 ) * ( rmax + 60 ), I.z + Math.sin( a * 0.3927 ) * ( rmax + 60 ) ) );
	const deep = ring.filter( ( h ) => h < - 4 ).length;
	ok( deep >= 12, id + ': deep water on most sides (60 m past the shoal)', deep + ' of 16, shallowest ' + Math.max( ...ring ).toFixed( 1 ) + ' m' );

}

// island character
const H = ISLETS_BY_ID.haven, Sh = ISLETS_BY_ID.shrine, So = ISLETS_BY_ID.shoal, V = ISLETS_BY_ID.inverted;
{

	let flat = 0;
	for ( const [ u, v, r, , h ] of H.pads ) {

		const [ x, z ] = isletWorld( H, u, v );
		let worst = 0;
		for ( const [ ox, oz ] of [ [ 0, 0 ], [ r * 0.7, 0 ], [ - r * 0.7, 0 ], [ 0, r * 0.7 ], [ 0, - r * 0.7 ] ] ) worst = Math.max( worst, Math.abs( t.heightAt( x + ox, z + oz ) - h ) );
		if ( worst < 0.12 ) flat ++;

	}

	ok( flat === H.pads.length, 'West Haven: every building pad is level', flat + ' of ' + H.pads.length );
	let hpk = - 99;
	for ( let dx = - 130; dx <= 130; dx += 3 ) for ( let dz = - 130; dz <= 130; dz += 3 ) if ( t.islandAt( H.x + dx, H.z + dz ) === 'haven' ) hpk = Math.max( hpk, t.heightAt( H.x + dx, H.z + dz ) );
	ok( hpk > 18 && hpk < 40, 'West Haven: green hills behind the town', 'peak ' + hpk.toFixed( 1 ) + ' m' );
	const stacks = t.rockSites.filter( ( r ) => Math.hypot( r.x - Sh.x, r.z - Sh.z ) < 120 );
	ok( stacks.length === Sh.stacks.length && stacks.filter( ( r ) => r.h >= 17 ).length >= 4, 'The Shrine: a cluster of sea stacks, several over 17 m', stacks.length + ' stacks' );
	const [ sx, sz ] = isletWorld( Sh, 10, 10 );
	ok( t.heightAt( sx, sz ) > 20, 'The Shrine: the shrine pad on the summit', t.heightAt( sx, sz ).toFixed( 1 ) + ' m' );
	let rockMax = 0;
	const texel = ( a, x, z ) => a[ Math.floor( z - t.origin ) * t.res + Math.floor( x - t.origin ) ];
	for ( let dx = - 30; dx <= 30; dx += 3 ) for ( let dz = - 30; dz <= 30; dz += 3 ) rockMax = Math.max( rockMax, texel( t.rock, Sh.x + dx, Sh.z + dz ) );
	ok( rockMax > 0.6, 'The Shrine is rock', 'rock mask ' + rockMax.toFixed( 2 ) );
	let kmax = - 99;
	for ( let dx = - 90; dx <= 90; dx += 2 ) for ( let dz = - 90; dz <= 90; dz += 2 ) if ( t.islandAt( So.x + dx, So.z + dz ) === 'shoal' ) kmax = Math.max( kmax, t.heightAt( So.x + dx, So.z + dz ) );
	ok( kmax > 1.5 && kmax < 4.5, 'Quiet Shoal: low and muddy (peak 1.5-4.5 m)', kmax.toFixed( 2 ) + ' m' );
	let shallow = 0, tot = 0;
	for ( let a = 0; a < 32; a ++ ) {

		const [ x, z ] = isletWorld( So, Math.cos( a / 32 * 6.283 ) * ( So.ru + 25 ), Math.sin( a / 32 * 6.283 ) * ( So.rv + 25 ) );
		const h = t.heightAt( x, z );
		tot ++;
		if ( h < 0 && h > - 3 ) shallow ++;

	}

	ok( shallow >= 20, 'Quiet Shoal: a wide shallow shoal round the shore (25 m out, 0-3 m deep)', shallow + ' of ' + tot );

}

// the atoll and its lagoon
{

	const L = WORLD.inverted.lagoon;
	ok( L && L.x === V.x && L.z === V.z && L.radius > 50, 'WORLD.inverted.lagoon is published', JSON.stringify( L ) );
	let wet = 0, tot = 0, deepest = 0, landIn = 0;
	for ( let k = 0; k < 400; k ++ ) {

		const a = k * 2.399, r = Math.sqrt( k / 400 ) * 0.85;
		const [ x, z ] = isletWorld( V, Math.cos( a ) * r * V.atoll[ 0 ], Math.sin( a ) * r * V.atoll[ 1 ] );
		const h = t.heightAt( x, z );
		tot ++;
		if ( h < - 1.5 ) wet ++;
		if ( h > - 0.3 ) landIn ++;
		deepest = Math.min( deepest, h );

	}

	ok( wet >= tot * 0.97 && landIn === 0 && deepest > - 4.5, 'Inverted Isles: the lagoon (85% of the inner ellipse) is open water 1.5-4.5 m deep', wet + ' of ' + tot + ' wet, deepest ' + deepest.toFixed( 2 ) + ' m' );
	ok( t.coastDistance( L.x, L.z ).d > 0, 'Inverted Isles: coastDistance calls the lagoon water' );
	// a seaplane run: the longest straight line through the lagoon centre with >= 1.5 m of water
	let best = 0, bestA = 0;
	for ( let a = 0; a < 180; a += 5 ) {

		const dx = Math.cos( a * Math.PI / 180 ), dz = Math.sin( a * Math.PI / 180 );
		let len = 0;
		for ( const s of [ - 1, 1 ] ) for ( let r = 0; r < 200; r += 2 ) {

			if ( t.heightAt( L.x + dx * r * s, L.z + dz * r * s ) > - 1.5 ) break;
			len += 2;

		}

		if ( len > best ) { best = len; bestA = a; }

	}

	ok( best >= 190, 'Inverted Isles: a seaplane landing run of 190 m+ across the lagoon', best + ' m at ' + bestA + ' deg' );
	// the ring is land all round except the channel
	let ringLand = 0;
	for ( let a = 0; a < 64; a ++ ) {

		const u = Math.cos( a / 64 * 6.283 ) * ( V.ru + V.atoll[ 0 ] ) / 2, v = Math.sin( a / 64 * 6.283 ) * ( V.rv + V.atoll[ 1 ] ) / 2;
		const [ x, z ] = isletWorld( V, u, v );
		if ( t.heightAt( x, z ) > 0.2 ) ringLand ++;

	}

	ok( ringLand >= 56, 'Inverted Isles: a sand ring round the lagoon', ringLand + ' of 64 points on land' );
	// the channel through the ring: water at least 2 m deep along its axis, from outside into the lagoon
	const [ cv, , cu0, cu1 ] = V.channel;
	let chHigh = - 99;
	for ( let u = cu0 + 15; u <= cu1 - 5; u += 2 ) {

		const [ x, z ] = isletWorld( V, u, cv );
		chHigh = Math.max( chHigh, t.heightAt( x, z ) );

	}

	ok( chHigh < - 1.8, 'Inverted Isles: a boat channel through the ring', 'shallowest ' + chHigh.toFixed( 2 ) + ' m' );

}

// ---------------------------------------------------------------- 3. clear of everything else
const segDist = ( px, pz, a, b ) => {

	const dx = b[ 0 ] - a[ 0 ], dz = b[ 1 ] - a[ 1 ];
	const f = Math.max( 0, Math.min( 1, ( ( px - a[ 0 ] ) * dx + ( pz - a[ 1 ] ) * dz ) / ( dx * dx + dz * dz ) ) );
	return Math.hypot( px - a[ 0 ] - dx * f, pz - a[ 1 ] - dz * f );

};
const REF = 'file:///D:/tidewater-main/tidewater-main/src/world/TerrainData.js';
let ref = null;
try { ref = new ( await import( REF ) ).TerrainData(); } catch ( e ) { console.log( 'note: the Tidewater reference terrain is not available, main-coast clearance uses this terrain' ); }
for ( const id of NEW ) {

	const I = ISLETS_BY_ID[ id ], r = foot[ id ];
	const reef = Math.hypot( I.x - WORLD.reef.center.x, I.z - WORLD.reef.center.z ) - WORLD.reef.radius - r;
	ok( reef > 300, id + ': clear of the reef', reef.toFixed( 0 ) + ' m' );
	const st = Math.min( ...[ ...SEA_STACKS, ...PONS_STACKS ].map( ( s ) => Math.hypot( I.x - s[ 0 ], I.z - s[ 1 ] ) - s[ 2 ] - r ) );
	ok( st > 150, id + ': clear of the main island sea stacks', st.toFixed( 0 ) + ' m' );
	let other = Infinity;
	for ( const J of ISLETS ) if ( J.id !== id ) other = Math.min( other, Math.hypot( I.x - J.x, I.z - J.z ) - r - ( foot[ J.id ] || Math.max( J.ru, J.rv ) + 30 ) );
	other = Math.min( other, Math.hypot( I.x - WORLD.pons.center.x, I.z - WORLD.pons.center.z ) - r - WORLD.pons.radius );
	ok( other > 150, id + ': clear of the other small islands and Pons', other.toFixed( 0 ) + ' m' );
	let main = Infinity;
	for ( let a = 0; a < 24; a ++ ) {

		const x = I.x + Math.cos( a * 0.2618 ) * r, z = I.z + Math.sin( a * 0.2618 ) * r;
		main = Math.min( main, ( ref || t ).coastDistance( x, z ).d );

	}

	ok( main > 80, id + ': clear of the main island coast (from its shoal footprint ring)', main.toFixed( 0 ) + ' m' );
	let route = Infinity;
	for ( const [ a, b ] of [ ...legs( MERCHANT_ROUTE ), ...PATROLS.flatMap( ( p ) => legs( p, true ) ) ] ) route = Math.min( route, segDist( I.x, I.z, a, b ) - r );
	ok( route > 100, id + ': clear of the merchant route and the patrols', route.toFixed( 0 ) + ' m' );
	const dist = Math.hypot( I.x - WORLD.boatDock.position.x, I.z - WORLD.boatDock.position.z );
	ok( dist > 600 && dist < 1300, id + ': a voyage away (600-1300 m from the pier head)', dist.toFixed( 0 ) + ' m' );

}

// the sailing approaches from the harbour anchorage: open water at least 2.5 m deep within 20 m of every leg
for ( const id of NEW ) {

	const p = WORLD.ports.find( ( q ) => q.id === id );
	const pts = [ [ 80, 80 ], ...p.approach ];
	let high = - 99, at = null;
	for ( const [ a, b ] of legs( pts ) ) {

		const len = Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] );
		for ( let q = 0; q <= len; q += 4 ) for ( const o of [ - 20, 0, 20 ] ) {

			const x = a[ 0 ] + ( b[ 0 ] - a[ 0 ] ) * q / len - ( b[ 1 ] - a[ 1 ] ) / len * o, z = a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * q / len + ( b[ 0 ] - a[ 0 ] ) / len * o;
			const h = t.heightAt( x, z );
			if ( h > high ) { high = h; at = [ Math.round( x ), Math.round( z ) ]; }

		}

	}

	ok( high < - 2.5, id + ': the sailing approach is water at least 2.5 m deep', 'shallowest ' + high.toFixed( 1 ) + ' m at ' + at );
	// and from the roads in to the mooring
	const R = p.roads, M = p.dock.position;
	let inner = - 99;
	for ( let q = 0; q <= 40; q ++ ) inner = Math.max( inner, t.heightAt( R[ 0 ] + ( M.x - R[ 0 ] ) * q / 40, R[ 1 ] + ( M.z - R[ 1 ] ) * q / 40 ) );
	ok( inner < - 1.4, id + ': the roads to the mooring is water', 'shallowest ' + inner.toFixed( 2 ) + ' m' );

}

// ---------------------------------------------------------------- 4. WORLD
const ids = WORLD.ports.map( ( p ) => p.id );
ok( ids.slice( 0, 4 ).join() === 'home,pons,gull,key' && NEW.every( ( id ) => ids.includes( id ) ), 'WORLD.ports: the first four unchanged, the four new ones added', ids.join() );
for ( const id of NEW ) {

	const p = WORLD.ports.find( ( q ) => q.id === id ), I = ISLETS_BY_ID[ id ];
	ok( p.name === I.name && p.dock && Number.isFinite( p.dock.heading ) && p.stand && Number.isFinite( p.stand.x + p.stand.z + p.stand.yaw ) && p.radius > 0, id + ': port entry complete', p.name );
	ok( WORLD.islands.some( ( q ) => q.id === id && q.center.x === I.x && q.center.z === I.z ), id + ': WORLD.islands entry' );
	const sh = t.heightAt( p.stand.x, p.stand.z );
	ok( sh > 0.5 && t.coastDistance( p.stand.x, p.stand.z ).d < 0, id + ': the stand is on land', sh.toFixed( 2 ) + ' m' );
	const D2 = I.dock, [ sx, sz ] = isletWorld( I, D2.u0, D2.v ), [ ex, ez ] = isletWorld( I, D2.u1, D2.v );
	ok( Math.hypot( sx - p.dock.start.x, sz - p.dock.start.z ) < 0.01 && Math.hypot( ex - p.dock.end.x, ez - p.dock.end.z ) < 0.01 && Math.abs( Math.atan2( ex - sx, ez - sz ) - p.dock.heading ) < 1e-6, id + ': the jetty in WORLD is the one the terrain was shaped for' );
	ok( p.approach.length >= 2 && p.approach[ p.approach.length - 1 ] === p.roads, id + ': the approach ends at the roads' );

}

// ---------------------------------------------------------------- 5. the scenery (CPU side: a stub scene)
globalThis.fetch = () => Promise.reject( new Error( 'no network in the test' ) );
const origWarn = console.warn;
console.warn = () => {};
const { Ports } = await import( '../src/game/ports/Ports.js' );
const { Colliders } = await import( '../src/world/Colliders.js' );
const { FrameUniforms } = await import( '../src/engine/render/Frame.js' );
const { Vector3 } = await import( '../src/engine/index.js' );
const { isleGeometry, SKY_ISLES } = await import( '../src/world/islands/InvertedIsles.js' );
const scene = { children: [], add( o ) { this.children.push( o ); } };
const colliders = new Colliders();
const tb = performance.now();
const ports = new Ports( { scene, terrain: t, colliders } );
ok( true, 'Ports builds all six islands', Math.round( performance.now() - tb ) + ' ms' );
const kinds = ports.vendors.map( ( v ) => v.kind + ':' + v.name.split( ' ' )[ 0 ] );
// (wave 12A: Tidemark's fish hall and chandler join them; test/feature-town.mjs checks the town itself)
ok( ports.vendors.length === 8 && ports.meridianPort.market.kind === 'buyer' && ports.meridianPort.chandler.kind === 'shop' && ports.havenPort.chandler.kind === 'shop' && ports.havenPort.market.kind === 'buyer' && ports.shrinePort.vendor.kind === 'buyer' && ports.tidemarkPort.market.kind === 'buyer' && ports.tidemarkPort.chandler.kind === 'shop', 'vendors: Pengu, the Haven chandler (shop) and market (buyer), the hermit (buyer), the Tidemark fish hall (buyer) and chandler (shop)', kinds.join() );
for ( const v of ports.vendors.slice( 1 ) ) ok( t.heightAt( v.position.x, v.position.z ) > 0.5, v.name + ' stands on land', t.heightAt( v.position.x, v.position.z ).toFixed( 2 ) + ' m' );
const fish = [ { species: 'tuna', value: 40 }, { species: 'mullet', value: 10 }, { species: 'crookedcod', value: 30 }, { species: 'rootfin', value: 8 } ];
const mk = ports.havenPort.market, hm = ports.shrinePort.vendor;
ok( ports.priceFor( mk, fish[ 0 ] ) === 50 && ports.priceFor( mk, fish[ 1 ] ) === 10 && ports.premiumBonus( mk, fish ) === 10 + 8, 'the Haven market: a deep-water premium', 'bonus $' + ports.premiumBonus( mk, fish ) );
ok( ports.priceFor( hm, fish[ 2 ] ) === 45 && ports.priceFor( hm, fish[ 0 ] ) === 40 && ports.premiumBonus( hm, fish ) === 15 + 4, 'the hermit: a premium on the strange fish', 'bonus $' + ports.premiumBonus( hm, fish ) );
ok( ports.premiumBonus( ports.havenPort.chandler, fish ) === 0, 'the chandler buys no fish' );
ok( ports.lights.length - ports.meridian.lights.length - ports.meridianPort.lights.length >= 8 + 14 + 3 && ports.lights.length - ports.meridian.lights.length - ports.meridianPort.lights.length <= 8 + 24 + 6 && ports.meridian.lights.length < 400, 'lights: a few per island (Meridian\'s street lamps: LocalLights takes the 16 nearest)', ports.lights.length + ' (8 were Gull Rock and Saltmarsh Key; Tidemark adds ' + ( ports.tidemark.lights.length + ports.tidemarkPort.lights.length ) + ')' );
ok( ports.markers.length === 10 && ports.markers.some( ( m ) => m.id === 'meridian:airstrip' ) && ports.markers.every( ( m ) => t.heightAt( m.x, m.z ) > 0.5 ) && ports.markers.some( ( m ) => m.id === 'tidemark:airstrip' ), 'markers: seven ports and the Tidemark airstrip, all on land', ports.markers.map( ( m ) => m.id ).join() );
for ( const id of NEW ) {

	const d = WORLD[ id ].dock;
	const mid = { x: ( d.start.x + d.end.x ) / 2, z: ( d.start.z + d.end.z ) / 2 };
	ok( ports.near( mid ) === id && ports.near( { position: d.start } ) === id, id + ': Ports.near on its jetty (the discovery)' );
	ok( colliders.groundHeightAt( d.start.x + Math.sin( d.heading ) * 3, d.start.z + Math.cos( d.heading ) * 3, 5 ) === d.deckHeight, id + ': the jetty deck is walkable at its height' );

}

ok( ports.near( { x: 0, z: 0 } ) === null && ports.near( WORLD.pons.dock.start ) === null && ports.near( { x: - 300, z: 900 } ) === null, 'Ports.near: null at home, Pons and open sea' );
const tags = new Set( [ ...colliders.boxes.map( ( b ) => b.tag ), ...colliders.cylinders.map( ( c ) => c.tag ) ] );
ok( [ 'havenHouse', 'havenTower', 'havenChandlery', 'havenMarket', 'shrineHut', 'shrineCairn', 'shrineTable', 'shoalShed', 'shoalFig', 'invertedMarker' ].every( ( g ) => tags.has( g ) ), 'colliders: houses, tower, stalls, hut, cairn, shed, fig, channel markers' );
const high = colliders.cylinders.filter( ( c ) => /^inverted/.test( c.tag ) ).concat( colliders.boxes.filter( ( b ) => /^inverted/.test( b.tag ) ) );
ok( high.length > 0 && high.every( ( c ) => ( c.yMax ?? c.top ) < 8 ), 'the Inverted Isles: nothing collides above head height (the sky isles are scenery)' );
ok( ports.haven.houses === 8 && ports.haven.palms >= 10, 'West Haven: eight buildings and palms', ports.haven.houses + ' houses, ' + ports.haven.palms + ' palms' );
ok( ports.shrine.columns >= 150, 'The Shrine: basalt columns at the stacks and along the shore', ports.shrine.columns + ' columns' );
ok( ports.shoal.shrubs >= 100 && ports.shoal.roots >= 100, 'Quiet Shoal: mangroves and the Hanging Roots', ports.shoal.shrubs + ' mangroves, ' + ports.shoal.roots + ' aerial roots' );
const sky = ports.inverted.sky;
ok( sky.length === SKY_ISLES.length && sky.every( ( s ) => s.y - 0.22 * s.r > 35 ), 'the Inverted Isles: suspended isles, all well above the sea', sky.length + ' isles, lowest ground face ' + Math.min( ...sky.map( ( s ) => s.y - 0.22 * s.r ) ).toFixed( 0 ) + ' m' );
const skyGeo = ports.inverted.skyMesh.geometry, sp = skyGeo.attributes.position;
let lowest = Infinity;
for ( let i = 0; i < sp.count; i ++ ) lowest = Math.min( lowest, sp.getY( i ) );
const tris = ( g ) => ( g.index ? g.index.count : g.attributes.position.count ) / 3;
ok( lowest > 18, 'the lowest root tip hangs well above head height', lowest.toFixed( 1 ) + ' m' );
ok( tris( skyGeo ) < 40000, 'the sky isles are one cheap mesh', tris( skyGeo ) + ' triangles' );
ok( ports.inverted.falls >= 6 && tris( ports.inverted.fallsMesh.geometry ) < 4000, 'upward waterfalls: columns and rim sheets in one transparent mesh', ports.inverted.falls + ' falls, ' + tris( ports.inverted.fallsMesh.geometry ) + ' triangles' );
// the isle body faces outward (the ground face down, the cone out and up)
{

	let s = 1;
	const g = isleGeometry( 20, () => ( ( s = ( s * 16807 ) % 2147483647 ) / 2147483647 ) );
	const p = g.attributes.position, nn = g.attributes.normal;
	let outward = 0, down = 0, total = 0;
	for ( let i = 0; i < p.count; i ++ ) {

		const x = p.getX( i ), y = p.getY( i ), z = p.getZ( i );
		const r = Math.hypot( x, z );
		if ( y < - 1 && r < 10 ) { total ++; if ( nn.getY( i ) < - 0.5 ) down ++; } else if ( y > 2 && r > 3 ) { total ++; if ( nn.getX( i ) * x + nn.getZ( i ) * z > 0 ) outward ++; }

	}

	ok( down + outward >= total * 0.95, 'isle geometry: the ground faces down, the rock faces out', ( down + outward ) + ' of ' + total );

}

// distance culling: far from everything only the landmarks draw; close to an island its props draw
const camAt = ( x, y, z ) => { FrameUniforms.fields.cameraPos.value = new Vector3( x, y, z ); ports.update( 0.016, null ); };
camAt( 60, 10, 0 );
const vis = ( o ) => o.visible !== false;
ok( ! vis( ports.haven.parts[ 0 ].object ) && vis( ports.haven.parts[ 1 ].object ) && ! vis( ports.shrine.parts[ 0 ].object ) && ! vis( ports.shoal.parts[ 0 ].object ) && vis( ports.shoal.parts[ 1 ].object ) &&
	! vis( ports.inverted.parts[ 0 ].object ) && vis( ports.inverted.skyMesh ) && vis( ports.inverted.fallsMesh ), 'from the main island: the islands\' props are culled, the tower, the fig and the sky isles stay on the horizon' );
const hd = WORLD.haven.dock.position;
camAt( hd.x, 3, hd.z );
ok( vis( ports.haven.parts[ 0 ].object ) && ports.havenPort.chandler._lazyCharacter === null, 'at West Haven: its props draw and the traders\' characters start loading' );
const vd = WORLD.inverted.dock.position;
camAt( vd.x, 3, vd.z );
ok( vis( ports.inverted.parts[ 0 ].object ) && ! vis( ports.haven.parts[ 0 ].object ), 'at the Inverted Isles: the atoll draws, West Haven is culled' );
await new Promise( ( r ) => setTimeout( r, 50 ) ); // the characters' fetches fail quietly
console.warn = origWarn;

console.log( ( n - fails ) + ' / ' + n + ' checks passed' );
if ( fails ) process.exit( 1 );

// ---------------------------------------------------------------- optional headless render
if ( process.argv.includes( '--render' ) ) {

	const arg = process.argv[ process.argv.indexOf( '--render' ) + 1 ];
	const dir = arg && ! arg.startsWith( '--' ) ? arg : decodeURIComponent( new URL( './out/islands58', import.meta.url ).pathname ).replace( /^\/(\w:)/, '$1' );
	const { mkdirSync } = await import( 'node:fs' );
	mkdirSync( dir, { recursive: true } );
	const { worldHarness, done } = await import( './world-harness.mjs' );
	const { TerrainGPU } = await import( '../src/world/TerrainGPU.js' );
	const { Terrain } = await import( '../src/world/Terrain.js' );
	const { computeShoreField } = await import( '../src/world/ShoreField.js' );
	const { Rocks } = await import( '../src/world/Rocks.js' );
	const Hn = await worldHarness( { sun: [ 0.5, 0.42, 0.45 ] } );
	const shore = computeShoreField( t, { res: 512, swellDir: [ WORLD.swellDir.x, WORLD.swellDir.y ] } );
	const gpu = new TerrainGPU( t, shore );
	const terrain = new Terrain( { scene: Hn.scene, terrainData: t, terrainGPU: gpu } );
	terrain.material.appliesHillShadow = true;
	const rocks = new Rocks( { scene: Hn.scene, terrain, colliders: new Colliders() } );
	rocks.material.appliesHillShadow = true;
	console.warn = () => {};
	const rp = new Ports( { scene: Hn.scene, terrain: t, colliders: new Colliders() } );
	Hn.before.push( ( cam ) => { terrain.update( cam ); rocks.update( cam ); rp.update( 1 / 60, null ); } );
	const at = ( id, u, v, y ) => { const [ x, z ] = isletWorld( ISLETS_BY_ID[ id ], u, v ); return [ x, y ?? t.heightAt( x, z ) + 1.7, z ]; };
	const views = {
		'haven-aerial': { pos: at( 'haven', - 190, - 90, 70 ), target: at( 'haven', - 30, 0, 6 ), fov: 50 },
		'haven-pier': { pos: at( 'haven', - 104, 6, 4.5 ), target: at( 'haven', - 40, 0, 8 ), fov: 60 },
		'haven-plaza': { pos: at( 'haven', - 60, - 4 ), target: at( 'haven', - 46, 4, 3 ), fov: 62 },
		'shrine-aerial': { pos: at( 'shrine', - 140, - 80, 60 ), target: at( 'shrine', 10, 0, 10 ), fov: 50 },
		'shrine-landing': { pos: at( 'shrine', - 58, - 8, 3.5 ), target: at( 'shrine', - 20, 8, 6 ), fov: 62 },
		'shrine-summit': { pos: at( 'shrine', - 4, 4 ), target: at( 'shrine', 10, 10, 25 ), fov: 62 },
		'shoal-aerial': { pos: at( 'shoal', - 130, - 70, 45 ), target: at( 'shoal', 0, 0, 6 ), fov: 52 },
		'shoal-roots': { pos: at( 'shoal', - 22, - 6 ), target: at( 'shoal', 0, 2, 8 ), fov: 66 },
		'inverted-aerial': { pos: at( 'inverted', - 330, - 120, 90 ), target: at( 'inverted', 0, 0, 50 ), fov: 55 },
		'inverted-lagoon': { pos: at( 'inverted', - 60, - 40, 3 ), target: at( 'inverted', 20, 10, 70 ), fov: 70 },
		'inverted-from-home': { pos: [ 40, 4, - 40 ], target: at( 'inverted', 0, 0, 60 ), fov: 30 },
	};
	const only = process.argv.find( ( a ) => a.startsWith( '--view=' ) );
	for ( const [ name, view ] of Object.entries( views ) ) {

		if ( only && only.slice( 7 ) !== name ) continue;
		await Hn.shot( `${ dir }/isle-${ name }.png`, view );

	}

	console.log( 'rendered into ' + dir );
	await done();

}

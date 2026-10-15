// Four islands in one heightmap: the main island and Pons Cove are unchanged (bit-identical), Gull Rock
// and Saltmarsh Key are where WORLD says; the extra ports (src/game/ports) and their builders.
//   node test/world-islands.mjs                         checks only
//   node test/world-islands.mjs --render [out] [--night] [--view=name]   also renders each island headless
import assert from 'node:assert/strict';
import { TerrainData } from '../src/world/TerrainData.js';
import { WORLD } from '../src/world/WorldLayout.js';
import { PONS_STAND } from '../src/game/PonsPort.js';
import { ISLETS, ISLETS_BY_ID, isletWorld, SEA_STACKS, PONS_STACKS } from '../src/world/terrain/IslandShape.js';
import { MERCHANT_ROUTE, PATROLS, legs } from '../src/features/naval/Routes.js';

const REF = 'file:///D:/tidewater-main/tidewater-main/src/world/TerrainData.js';
const ref = new ( await import( REF ) ).TerrainData();
const t = new TerrainData();
let ok = 0;
const check = ( name, cond, info = '' ) => { assert.ok( cond, name + ' ' + info ); console.log( 'ok  ' + name + ( info ? '  ' + info : '' ) ); ok ++; };

// 1. the main island: identical heights on a deterministic spread of points (land, coast, bay, sea)
let worst = 0, n = 0;
for ( let i = 0; i < 40; i ++ ) {

	const x = - 700 + ( i * 311 ) % 1400 + i * 0.37, z = - 840 + ( i * 197 ) % 1000 + i * 0.91;
	if ( ISLETS.some( ( I ) => Math.hypot( x - I.x, z - I.z ) < 320 ) ) continue; // the small islands' own sea
	worst = Math.max( worst, Math.abs( t.heightAt( x, z ) - ref.heightAt( x, z ) ) );
	n ++;

}

for ( const [ x, z ] of [ [ 0, - 60 ], [ 55, - 20 ], [ 64.5, 36.5 ], [ - 78, 58 ], [ 40, - 118 ], [ 18, - 60 ] ] ) worst = Math.max( worst, Math.abs( t.heightAt( x, z ) - ref.heightAt( x, z ) ) );
check( 'main island heights unchanged', worst === 0, n + 6 + ' points, max diff ' + worst );
const P = WORLD.pons, c = P.center;
// the raster: every texel on the main island or within 40 m of its coast is bit-identical; the open
// sea farther out only differs by Pons' own continental shelf (it rises towards the second island)
let landDiff = 0, seaDiff = 0, checked = 0;
for ( let j = 0; j < t.res; j += 3 ) for ( let i = 0; i < t.res; i += 3 ) {

	const x = t.origin + i, z = t.origin + j, k = j * t.res + i;
	const d = Math.abs( t.heights[ k ] - ref.heights[ k ] );
	if ( d === 0 ) continue;
	if ( ref.coastDistance( x, z ).d < 40 ) landDiff = Math.max( landDiff, d );
	else if ( Math.hypot( x - c.x, z - c.z ) > 760 && ISLETS.every( ( I ) => Math.hypot( x - I.x, z - I.z ) > 420 ) ) seaDiff = Math.max( seaDiff, d );
	checked ++;

}

check( 'raster identical on the main island and its 40 m coast', landDiff === 0, 'max diff ' + landDiff + ', ' + checked + ' texels differ (Pons shelf)' );
check( 'open sea beyond 760 m of Pons and 420 m of the small islands barely changes', seaDiff < 0.05, 'max diff ' + seaDiff.toFixed( 4 ) + ' m' );

// 2. Pons
const hc = t.heightAt( c.x, c.z );
check( 'Pons centre is land above 2 m and hills stay below 25 m', hc > 2 && hc < 25, hc.toFixed( 1 ) + ' m' );
let hmax = - 99;
for ( let dx = - 160; dx <= 160; dx += 4 ) for ( let dz = - 160; dz <= 160; dz += 4 ) hmax = Math.max( hmax, t.heightAt( c.x + dx, c.z + dz ) );
check( 'Pons peak <= 25 m', hmax <= 25, hmax.toFixed( 1 ) + ' m' );
const D = P.dock;
const hs = t.heightAt( D.start.x, D.start.z );
check( 'beach at the dock foot 0.3-1.5 m', hs >= 0.3 && hs <= 1.5, hs.toFixed( 2 ) + ' m' );
const he = t.heightAt( D.end.x, D.end.z );
check( 'water under the dock head, deep enough to float', he < - 1.5, he.toFixed( 2 ) + ' m' );
const hm = t.heightAt( D.position.x, D.position.z );
check( 'mooring has water for the hull', hm < - 1.2, hm.toFixed( 2 ) + ' m' );
check( 'mooring is clear of the deck', Math.hypot( D.position.x - D.end.x, D.position.z - D.end.z ) < 12 );

// 3. open water between the islands. The straight line from the pier head runs through the east sea
// stacks (298, 252) and the shoals around them, so the sailing lane bends south through W, then
// runs east to the cove; "halfway" is measured along that lane.
const a = WORLD.boatDock.position, W = { x: 150, z: 500 };
const lane = [ [ a, W ], [ W, D.position ] ];
const len = lane.map( ( [ p, q ] ) => Math.hypot( q.x - p.x, q.z - p.z ) );
const mid = ( len[ 0 ] + len[ 1 ] ) / 2;
const [ p0, q0 ] = lane[ mid < len[ 0 ] ? 0 : 1 ];
const f0 = ( mid - ( mid < len[ 0 ] ? 0 : len[ 0 ] ) ) / len[ mid < len[ 0 ] ? 0 : 1 ];
const hmid = t.heightAt( p0.x + ( q0.x - p0.x ) * f0, p0.z + ( q0.z - p0.z ) * f0 );
check( 'deep water halfway from the pier head to Pons', hmid < - 8, hmid.toFixed( 1 ) + ' m' );
let highest = - 1e9;
for ( let k = 0; k <= 100; k ++ ) {

	const f = k / 100, x = a.x + ( W.x - a.x ) * f, z = a.z + ( W.z - a.z ) * f;
	highest = Math.max( highest, t.heightAt( x, z ) );

}

for ( let k = 0; k <= 100; k ++ ) {

	const f = k / 100 * 0.85, x = W.x + ( D.position.x - W.x ) * f, z = W.z + ( D.position.z - W.z ) * f;
	highest = Math.max( highest, t.heightAt( x, z ) );

}

check( 'the sailing lane is water at least 2 m deep until the last 15 percent', highest < - 2, 'highest ' + highest.toFixed( 1 ) + ' m' );
check( 'the reef is untouched', Math.abs( t.heightAt( - 78, 58 ) - ref.heightAt( - 78, 58 ) ) === 0 );

// 4. coastDistance on both islands (< 0 land, > 0 water)
check( 'coastDistance: Pons land < 0', t.coastDistance( c.x, c.z ).d < 0 );
check( 'coastDistance: Pons sea > 0', t.coastDistance( c.x - 260, c.z - 160 ).d > 0 && t.coastDistance( D.end.x, D.end.z ).d > 0 );
check( 'coastDistance: main island land < 0', t.coastDistance( 0, - 300 ).d < 0 );
check( 'coastDistance: main sea > 0', t.coastDistance( 0, 200 ).d > 0 );
check( 'coastDistance matches the reference on the main island', Math.abs( t.coastDistance( 30, - 200 ).d - ref.coastDistance( 30, - 200 ).d ) < 1e-9 );

// 5. the stall stands on land
const hp = t.heightAt( PONS_STAND.x, PONS_STAND.z );
check( 'PONS_STAND on land', hp > 0.5 && t.coastDistance( PONS_STAND.x, PONS_STAND.z ).d < 0, hp.toFixed( 2 ) + ' m' );


// ---------------------------------------------------------------- Gull Rock and Saltmarsh Key
// 6. Pons and the main island are bit-identical to the two-island terrain (hashes recorded before the small
// islands were composed in: heights, rock, sand, path, gully, seagrass, rubble and scarp over the region)
const f32 = new Float32Array( 1 ), u32 = new Uint32Array( f32.buffer );
function fnv( cx, cz, R ) {

	let h = 0x811c9dc5 >>> 0, n = 0;
	for ( let j = 0; j < t.res; j ++ ) for ( let i = 0; i < t.res; i ++ ) {

		const x = t.origin + i + 0.5, z = t.origin + j + 0.5;
		if ( Math.hypot( x - cx, z - cz ) > R ) continue;
		const k = j * t.res + i;
		f32[ 0 ] = t.heights[ k ];
		for ( const v of [ u32[ 0 ], Math.round( t.rock[ k ] * 1e6 ), t.sand[ k ], t.path[ k ], t.gully[ k ], t.seagrass[ k ], t.rubble[ k ], t.scarp[ k ] ] ) {

			h ^= v >>> 0;
			h = Math.imul( h, 16777619 ) >>> 0;

		}

		n ++;

	}

	return h.toString( 16 ) + ':' + n;

}

check( 'Pons is bit-identical (300 m around its centre)', fnv( c.x, c.z, 300 ) === '9cb7cd06:282792', fnv( c.x, c.z, 300 ) );
check( 'Pons core is bit-identical (200 m)', fnv( c.x, c.z, 200 ) === 'b02ec12e:125676', fnv( c.x, c.z, 200 ) );
check( 'main island region is bit-identical (450 m around the summit bay)', fnv( 0, - 300, 450 ) === '1f5cf4a1:636160', fnv( 0, - 300, 450 ) );

// 7. the new islands: land, beaches at the docks, deep water between, coast distance signs
const NEW = [ 'gull', 'key' ];
const foot = {}; // footprint radius from the centre (texels above -2.5 m)
for ( const id of NEW ) {

	const I = ISLETS_BY_ID[ id ], W = WORLD[ id ], Dk = W.dock;
	let land = 0, rmax = 0, peak = - 99;
	for ( let dz = - 130; dz <= 130; dz += 1 ) for ( let dx = - 130; dx <= 130; dx += 1 ) {

		const h = t.heightAt( I.x + dx, I.z + dz );
		if ( h > 0.3 ) land ++;
		if ( h > - 2.5 ) rmax = Math.max( rmax, Math.hypot( dx, dz ) );
		peak = Math.max( peak, h );

	}

	foot[ id ] = rmax;
	check( id + ': a real island (land area, shoal footprint under 140 m)', land > 3000 && rmax < 140, land + ' m2 land, footprint ' + rmax.toFixed( 0 ) + ' m, peak ' + peak.toFixed( 1 ) + ' m' );
	const hS = t.heightAt( Dk.start.x, Dk.start.z );
	check( id + ': beach at the dock foot 0.3-1.5 m', hS >= 0.3 && hS <= 1.5, hS.toFixed( 2 ) + ' m' );
	check( id + ': the deck is one step up from the foot (<= 0.36 m)', Dk.deckHeight - hS <= 0.36 && Dk.deckHeight > hS, 'deck ' + Dk.deckHeight + ' foot ' + hS.toFixed( 2 ) );
	const hE = t.heightAt( Dk.end.x, Dk.end.z );
	check( id + ': water under the dock head, deep enough to float', hE < - 1.5, hE.toFixed( 2 ) + ' m' );
	const hM = t.heightAt( Dk.position.x, Dk.position.z );
	check( id + ': mooring has water for the hull and is by the dock end', hM < - 1.2 && Math.hypot( Dk.position.x - Dk.end.x, Dk.position.z - Dk.end.z ) < 12, hM.toFixed( 2 ) + ' m' );
	// the ground along the deck stays under it
	let worstUnder = - 99;
	for ( let q = 0; q <= 20; q ++ ) {

		const f = q / 20, gr = t.heightAt( Dk.start.x + ( Dk.end.x - Dk.start.x ) * f, Dk.start.z + ( Dk.end.z - Dk.start.z ) * f );
		worstUnder = Math.max( worstUnder, gr );

	}

	check( id + ': the ground under the dock stays below the deck', worstUnder < Dk.deckHeight - 0.1, worstUnder.toFixed( 2 ) + ' m' );
	check( id + ': coastDistance land < 0 at the centre, water > 0 at the dock end and 300 m out', t.coastDistance( I.x, I.z ).d < 0 && t.coastDistance( Dk.end.x, Dk.end.z ).d > 0 && t.coastDistance( I.x, I.z - 300 ).d > 0 );
	check( id + ': islandAt names it at the centre and not far away', t.islandAt( I.x, I.z ) === id && t.islandAt( 0, - 300 ) === 'main' && t.islandAt( c.x, c.z ) === 'pons' );
	const ring = [];
	for ( let a = 0; a < 16; a ++ ) ring.push( t.heightAt( I.x + Math.cos( a * 0.3927 ) * ( rmax + 70 ), I.z + Math.sin( a * 0.3927 ) * ( rmax + 70 ) ) );
	const deepRing = ring.filter( ( h ) => h < - 4 ).length;
	check( id + ': deep water on most sides (70 m past the shore, 12 of 16 points > 4 m)', deepRing >= 12, deepRing + ' of 16, shallowest ' + Math.max( ...ring ).toFixed( 1 ) + ' m (toward the main island coast)' );

}

const g = ISLETS_BY_ID.gull, k = ISLETS_BY_ID.key;
const lh = isletWorld( g, 0, 0 );
check( 'Gull Rock: a rocky islet with a flat summit pad for the lighthouse', t.heightAt( lh[ 0 ], lh[ 1 ] ) > 14 && Math.abs( t.heightAt( lh[ 0 ] + 3, lh[ 1 ] ) - t.heightAt( lh[ 0 ], lh[ 1 ] ) ) < 0.2, t.heightAt( lh[ 0 ], lh[ 1 ] ).toFixed( 1 ) + ' m' );
check( 'Gull Rock: the sea stacks stand', g.stacks.length === 4 && t.rockSites.filter( ( r ) => Math.hypot( r.x - g.x, r.z - g.z ) < 130 ).length === 4 );
let kmax = - 99;
for ( let dx = - 120; dx <= 120; dx += 2 ) for ( let dz = - 120; dz <= 120; dz += 2 ) kmax = Math.max( kmax, t.heightAt( k.x + dx, k.z + dz ) );
check( 'Saltmarsh Key: low and sandy (peak 1-4 m)', kmax > 1 && kmax < 4, kmax.toFixed( 2 ) + ' m' );
const kh = isletWorld( k, - 22, - 8 );
check( 'Saltmarsh Key: a flat pad for the hut', Math.abs( t.heightAt( kh[ 0 ], kh[ 1 ] ) - 1.6 ) < 0.05 && Math.abs( t.heightAt( kh[ 0 ] + 2, kh[ 1 ] ) - 1.6 ) < 0.1 );
const texel = ( a, x, z ) => a[ Math.floor( z - t.origin ) * t.res + Math.floor( x - t.origin ) ];
check( 'Saltmarsh Key is sand', texel( t.sand, k.x, k.z ) > 150 && texel( t.rock, k.x, k.z ) < 0.2, 'sand ' + texel( t.sand, k.x, k.z ) );
let rockMax = 0;
for ( let dx = - 40; dx <= 40; dx += 3 ) for ( let dz = - 40; dz <= 40; dz += 3 ) rockMax = Math.max( rockMax, texel( t.rock, g.x + dx, g.z + dz ) );
check( 'Gull Rock is rock', rockMax > 0.6, 'rock mask ' + rockMax.toFixed( 2 ) );

// the small islands lie inside the 1 m passes' main band (rows -900 .. 320), where no extra box is needed
for ( const I of ISLETS.filter( ( q ) => NEW.includes( q.id ) ) ) check( I.id + ': inside the main rows of the 1 m passes', I.z + foot[ I.id ] < 320 && I.z - foot[ I.id ] > - 880 );

// 8. no overlap with the reef, the sea stacks, Pons, the main island or the naval routes
const segDist = ( px, pz, a, b ) => {

	const dx = b[ 0 ] - a[ 0 ], dz = b[ 1 ] - a[ 1 ];
	const f = Math.max( 0, Math.min( 1, ( ( px - a[ 0 ] ) * dx + ( pz - a[ 1 ] ) * dz ) / ( dx * dx + dz * dz ) ) );
	return Math.hypot( px - a[ 0 ] - dx * f, pz - a[ 1 ] - dz * f );

};

for ( const I of ISLETS.filter( ( q ) => NEW.includes( q.id ) ) ) {

	const r = foot[ I.id ];
	const reef = Math.hypot( I.x - WORLD.reef.center.x, I.z - WORLD.reef.center.z ) - WORLD.reef.radius - r;
	check( I.id + ': clear of the reef', reef > 100, reef.toFixed( 0 ) + ' m' );
	const stacks = Math.min( ...[ ...SEA_STACKS, ...PONS_STACKS ].map( ( s ) => Math.hypot( I.x - s[ 0 ], I.z - s[ 1 ] ) - s[ 2 ] - r ) );
	check( I.id + ': clear of the main sea stacks', stacks > 100, stacks.toFixed( 0 ) + ' m' );
	const pons = Math.hypot( I.x - c.x, I.z - c.z ) - WORLD.pons.radius - r;
	check( I.id + ': clear of Pons', pons > 200, pons.toFixed( 0 ) + ' m' );
	const main = ref.coastDistance( I.x, I.z ).d - r;
	check( I.id + ': clear of the main island coast', main > 100, main.toFixed( 0 ) + ' m' );
	let route = Infinity;
	for ( const [ a, b ] of [ ...legs( MERCHANT_ROUTE ), ...PATROLS.flatMap( ( p ) => legs( p, true ) ) ] ) route = Math.min( route, segDist( I.x, I.z, a, b ) - r );
	check( I.id + ': clear of the merchant route and the patrols', route > 150, route.toFixed( 0 ) + ' m' );
	const dist = Math.hypot( I.x - WORLD.boatDock.position.x, I.z - WORLD.boatDock.position.z );
	check( I.id + ': a voyage away (300-900 m from the pier head)', dist > 300 && dist < 900, dist.toFixed( 0 ) + ' m' );

}

// the sailing approaches: open water at least 2.5 m deep within 20 m of every leg
for ( const p of WORLD.ports.filter( ( q ) => NEW.includes( q.id ) ) ) {

	const pts = [ [ 80, 80 ], ...p.approach ];
	let high = - 99;
	for ( const [ a, b ] of legs( pts ) ) {

		const len = Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] );
		for ( let q = 0; q <= len; q += 4 ) for ( const o of [ - 20, 0, 20 ] ) {

			const x = a[ 0 ] + ( b[ 0 ] - a[ 0 ] ) * q / len - ( b[ 1 ] - a[ 1 ] ) / len * o, z = a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * q / len + ( b[ 0 ] - a[ 0 ] ) / len * o;
			high = Math.max( high, t.heightAt( x, z ) );

		}

	}

	check( p.id + ': the sailing approach is water at least 2.5 m deep', high < - 2.5, 'highest ' + high.toFixed( 1 ) + ' m' );

}

// 9. WORLD.ports
const ids = WORLD.ports.map( ( p ) => p.id );
check( 'WORLD.ports lists home, pons, gull, key', ids.slice( 0, 4 ).join() === 'home,pons,gull,key' );
for ( const p of WORLD.ports ) {

	const okShape = p.name && p.dock && p.dock.position && Number.isFinite( p.dock.heading ) && p.stand && Number.isFinite( p.stand.x + p.stand.z + p.stand.yaw ) && p.center && p.radius > 0;
	check( p.id + ': port entry complete (name, dock.position/heading, stand, center, radius)', !! okShape );
	check( p.id + ': the island entry matches', WORLD.islands.some( ( i ) => i.center.x === p.center.x && i.center.z === p.center.z && i.radius === p.radius ) );

}

check( 'home and pons entries point at the existing docks', WORLD.ports[ 0 ].dock.position === WORLD.boatDock.position && WORLD.ports[ 1 ].dock.position.x === WORLD.pons.dock.position.x );
for ( const id of NEW ) {

	const p = WORLD.ports.find( ( q ) => q.id === id ), I = ISLETS_BY_ID[ id ];
	check( id + ': WORLD and the terrain agree on the island', Math.hypot( p.center.x - I.x, p.center.z - I.z ) < 0.01 && WORLD.islands.find( ( q ) => q.id === id ).center.x === I.x );
	const sh = t.heightAt( p.stand.x, p.stand.z );
	check( id + ': the stand is on land', sh > 0.5 && t.coastDistance( p.stand.x, p.stand.z ).d < 0, sh.toFixed( 2 ) + ' m' );
	const D2 = I.dock, [ sx, sz ] = isletWorld( I, D2.u0, D2.v ), [ ex, ez ] = isletWorld( I, D2.u1, D2.v );
	check( id + ': the jetty in WORLD is the one the terrain was shaped for', Math.hypot( sx - p.dock.start.x, sz - p.dock.start.z ) < 0.1 && Math.hypot( ex - p.dock.end.x, ez - p.dock.end.z ) < 0.1 && Math.abs( Math.atan2( ex - sx, ez - sz ) - p.dock.heading ) < 1e-3 );

}

// 10. the Ports class and its builders (CPU side: a stub scene)
globalThis.fetch = () => Promise.reject( new Error( 'no network in the test' ) );
const origWarn = console.warn;
console.warn = () => {};
const { Ports } = await import( '../src/game/ports/Ports.js' );
const { Colliders } = await import( '../src/world/Colliders.js' );
const scene = { children: [], add( o ) { this.children.push( o ); } };
const colliders = new Colliders();
const ports = new Ports( { scene, terrain: t, colliders } );
check( 'Ports: one vendor (Pengu, kind buyer) and lights', ports.vendors[ 0 ].kind === 'buyer' && ports.lights.length >= 8, ports.lights.length + ' lights' );
check( 'Ports: the lighthouse lamp is a lit lantern light at the top of the tower', ports.gull.lampLight.kind === 'lantern' && ports.gull.lampLight.position.y > ports.gull.lighthouse.y + 11 && ports.gull.lampLight.range > 50 );
check( 'Ports: a bird colony', ports.gull.birds >= 30, ports.gull.birds + ' perched gulls' );
check( 'Ports: mangroves', ports.key.shrubs >= 40, ports.key.shrubs + ' shrubs' );
check( 'Ports: Pengu stands on land behind his stall', t.heightAt( ports.vendors[ 0 ].position.x, ports.vendors[ 0 ].position.z ) > 0.5 );
check( 'Ports: the colliders (deck, piles, tower, hut, stall) were added', colliders.boxes.some( ( b ) => b.tag === 'gullDeck' && b.walkable ) && colliders.boxes.some( ( b ) => b.tag === 'keyDeck' && b.walkable ) && colliders.cylinders.some( ( q ) => q.tag === 'gullLighthouse' ) && colliders.boxes.some( ( b ) => b.tag === 'keyHut' ) && colliders.boxes.some( ( b ) => b.tag === 'keyStall' ) );
const gd = WORLD.gull.dock;
check( 'Ports: the gull deck is walkable at its deck height', colliders.groundHeightAt( gd.start.x + Math.sin( gd.heading ) * 3, gd.start.z + Math.cos( gd.heading ) * 3, 5 ) === gd.deckHeight );
const at = ( x, z ) => ( { x, z } );
check( 'Ports.near: gull at its jetty foot, key at its stall, null elsewhere (home, Pons, open sea)',
	ports.near( at( gd.start.x, gd.start.z ) ) === 'gull' && ports.near( { position: at( ports.markers[ 1 ].x, ports.markers[ 1 ].z ) } ) === 'key' &&
	ports.near( at( 55, - 70 ) ) === null && ports.near( WORLD.pons.dock.start ) === null && ports.near( at( 0, 600 ) ) === null );
check( 'Ports.markers: the lighthouse and the stall are on land', ports.markers.every( ( m ) => t.heightAt( m.x, m.z ) > 0.5 ) );
const fishes = [ { species: 'mullet', value: 10 }, { species: 'tuna', value: 50 }, { species: 'jack', value: 5 } ];
const bonus = ports.premiumBonus( ports.vendors[ 0 ], fishes );
check( 'Ports: the premium is paid on flats fish only', bonus === Math.round( 10 * 1.4 ) - 10 + Math.round( 5 * 1.4 ) - 5 && ports.priceFor( ports.vendors[ 0 ], fishes[ 1 ] ) === 50 && ports.priceFor( ports.vendors[ 0 ], fishes[ 0 ] ) === 14 && ports.premiumBonus( null, fishes ) === 0, 'bonus $' + bonus );
ports.update( 0.016, { x: 0, y: 0, z: 0 } );
check( 'Ports.update runs without a player nearby', true );
await new Promise( ( r ) => setTimeout( r, 30 ) ); // the vendor's character fetch fails quietly
console.warn = origWarn;

console.log( ok + ' checks passed' );

// ---------------------------------------------------------------- optional headless render
if ( process.argv.includes( '--render' ) ) {

	const arg = process.argv[ process.argv.indexOf( '--render' ) + 1 ];
	const dir = arg && ! arg.startsWith( '--' ) ? arg : decodeURIComponent( new URL( './out/islands', import.meta.url ).pathname ).replace( /^\/(\w:)/, '$1' );
	const { mkdirSync } = await import( 'node:fs' );
	mkdirSync( dir, { recursive: true } );
	const { worldHarness, done } = await import( './world-harness.mjs' );
	const { TerrainGPU } = await import( '../src/world/TerrainGPU.js' );
	const { Terrain } = await import( '../src/world/Terrain.js' );
	const { computeShoreField } = await import( '../src/world/ShoreField.js' );
	const { Rocks } = await import( '../src/world/Rocks.js' );
	const H = await worldHarness( { sun: [ 0.5, 0.42, 0.45 ] } );
	const shore = computeShoreField( t, { res: 512, swellDir: [ WORLD.swellDir.x, WORLD.swellDir.y ] } );
	const gpu = new TerrainGPU( t, shore );
	const terrain = new Terrain( { scene: H.scene, terrainData: t, terrainGPU: gpu } );
	terrain.material.appliesHillShadow = true;
	const rocks = new Rocks( { scene: H.scene, terrain, colliders: new Colliders() } );
	rocks.material.appliesHillShadow = true;
	console.warn = () => {};
	const rports = new Ports( { scene: H.scene, terrain: t, colliders: new Colliders() } );
	for ( const m of [ rports.gull.material, rports.key.material, rports.keyPort.material, rports.gull.lampMaterial ] ) m.appliesHillShadow = true;
	H.before.push( ( cam ) => { terrain.update( cam ); rocks.update( cam ); } );
	const L = rports.gull.lighthouse, KS = ports.markers[ 1 ];
	const colony = rports.gull.colonies[ 0 ];
	const views = {
		'gull-aerial': { pos: [ g.x + 150, 70, g.z + 150 ], target: [ g.x, 6, g.z ], fov: 50 },
		'gull-jetty': { pos: [ WORLD.gull.dock.end.x + 16, 5, WORLD.gull.dock.end.z + 10 ], target: [ L.x - 6, 12, L.z ], fov: 62 },
		'gull-top': { pos: [ L.x + 12, L.y + 6, L.z + 16 ], target: [ L.x, L.y + 10, L.z ], fov: 60 },
		'gull-colony': { pos: [ colony[ 0 ] + 5, t.heightAt( colony[ 0 ] + 5, colony[ 1 ] + 4 ) + 2.2, colony[ 1 ] + 4 ], target: [ colony[ 0 ], t.heightAt( colony[ 0 ], colony[ 1 ] ) + 0.3, colony[ 1 ] ], fov: 60 },
		'key-aerial': { pos: [ k.x - 120, 55, k.z + 120 ], target: [ k.x, 0, k.z ], fov: 52 },
		'key-dock': { pos: [ WORLD.key.dock.end.x - 12, 4.5, WORLD.key.dock.end.z + 12 ], target: [ KS.x, 1.5, KS.z ], fov: 62 },
		'key-stall': { pos: [ KS.x - 6, 2.4, KS.z + 3.5 ], target: [ KS.x + 3.5, 1.3, KS.z - 2 ], fov: 62 },
		'key-mangrove': { pos: [ k.x + 8, 3.2, k.z + 60 ], target: [ k.x + 10, 0.5, k.z + 30 ], fov: 62 },
	};
	const only = process.argv.find( ( a ) => a.startsWith( '--view=' ) );
	for ( const [ name, v ] of Object.entries( views ) ) {

		if ( only && only.slice( 7 ) !== name ) continue;
		await H.shot( `${ dir }/island-${ name }.png`, v );

	}

	if ( process.argv.includes( '--night' ) ) {

		const { LocalLights } = await import( '../src/materials/LocalLights.js' );
		const ll = new LocalLights();
		for ( const l of rports.lights ) ll.add( l );
		H.G.night.value = 1;
		H.G.exposure.value = 12;
		H.G.sunColor.value.setRGB( 0.02, 0.025, 0.04 );
		H.G.skyIrradiance.value.setRGB( 0.004, 0.006, 0.01 );
		H.before.push( ( cam ) => { rports.update( 1 / 60 ); ll.update( cam, 1 / 60 ); } );
		for ( const name of [ 'gull-aerial', 'gull-jetty', 'key-dock' ] ) await H.shot( `${ dir }/island-night-${ name }.png`, views[ name ] );

	}

	console.log( 'rendered into ' + dir );
	await done();

}

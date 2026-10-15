// Wave 12A: Tidemark, the big town island with a destructible little town and an airstrip. Plain node, no GPU:
//   the island entry is inside the world extent, 400 m+ of water from every other island and the pirate lanes, on its own
//   terrain tile beyond the 2048 m heightmap (which stays bit-identical: the older islands' hashes, and every query inside
//   the domain is unchanged once the tile is attached); the bay, the beach, the headland cliffs, the lookout hill, the
//   river mouth, the pier and its berth, a seaplane run; the airstrip level within 0.3 m, inside the island and clear of
//   buildings; the town's 10-14 buildings on two streets; its props plan through the destruction feature's planProps and
//   break; the port's markers, trade cell, residents (schedules without gaps), tavern, den and building damage.
//   node test/feature-town.mjs
import { TerrainData } from '../src/world/TerrainData.js';
import { WORLD } from '../src/world/WorldLayout.js';
import { TIDEMARK as I, tidemarkWorld, tidemarkLocal } from '../src/world/terrain/IslandShape.js';
import { MERCHANT_ROUTE, PATROLS, legs } from '../src/features/naval/Routes.js';
import { TidemarkTerrain, attachTidemark, ensureTidemark, airstripRects, rectOut } from '../src/world/islands/town/TidemarkTerrain.js';
import { BUILDINGS, EXTRA, TOWN_PROPS, SQUARE, SPOTS, townProps } from '../src/world/islands/town/Layout.js';
import { TIDEMARK_FOLK } from '../src/world/islands/town/Folk.js';
import { worldBounds } from '../src/features/worldmap/MapLogic.js';

let fails = 0, n = 0;
const ok = ( c, msg, info = '' ) => {

	n ++;
	if ( ! c ) { fails ++; console.log( 'FAIL', msg, info ); } else console.log( 'ok  ', msg, info );

};
const section = ( s ) => console.log( '\n== ' + s );

const t = new TerrainData();
const half = t.size / 2;

// ------------------------------------------------------------------------------ the heightmap stays bit-identical
section( 'the heightmap and the older islands' );
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

for ( const [ name, x, z, R, want ] of [
	[ 'Pons (300 m)', 620, 560, 300, '9cb7cd06:282792' ],
	[ 'the main island (450 m round the summit bay)', 0, - 300, 450, '1f5cf4a1:636160' ],
	[ 'Gull Rock (175 m)', - 560, 200, 175, 'dbe56728:96224' ],
	[ 'Saltmarsh Key (200 m)', 740, 70, 200, '1c0fcfb4:125676' ],
] ) ok( fnv( x, z, R ) === want, name + ' is bit-identical (Tidemark is not in the heightmap)', fnv( x, z, R ) );

// queries inside the domain with / without the tile (TerrainData attaches it on construction: the prototype's methods are
// the heightmap's own answers, the instance's are wrapped)
let rs = 12345;
const rnd = () => ( ( rs = ( rs * 16807 ) % 2147483647 ) / 2147483647 );
const probes = [];
for ( let k = 0; k < 4000; k ++ ) probes.push( [ ( rnd() * 2 - 1 ) * ( half - 1 ), ( rnd() * 2 - 1 ) * ( half - 1 ) ] );
const TP = TerrainData.prototype;
const before = probes.map( ( [ x, z ] ) => [ TP.heightAt.call( t, x, z ), TP.coastDistance.call( t, x, z ).d, TP.islandAt.call( t, x, z ) ] );
const t0 = performance.now();
const fresh = new TidemarkTerrain();
const tileMs = performance.now() - t0;
const tile = t._outerTiles && t._outerTiles.find( ( q ) => q.id === fresh.id );
const nTiles = t._outerTiles ? t._outerTiles.length : 0; // (Blackwater has a tile of its own since wave 14D)
ok( tile && tile.id === fresh.id && attachTidemark( t, fresh ) === tile && ensureTidemark( t ) === tile && t._outerTiles.length === nTiles, 'TerrainData attaches the tile on construction; attaching again is idempotent' );
const after = probes.map( ( [ x, z ] ) => [ t.heightAt( x, z ), t.coastDistance( x, z ).d, t.islandAt( x, z ) ] );
ok( before.every( ( b, k ) => b[ 0 ] === after[ k ][ 0 ] && b[ 1 ] === after[ k ][ 1 ] && b[ 2 ] === after[ k ][ 2 ] ), 'every query inside the 2048 m domain is unchanged with the tile attached', probes.length + ' probes' );
ok( tileMs < 2500, 'the tile builds quickly', Math.round( tileMs ) + ' ms ' + JSON.stringify( fresh.timings ) );
ok( tile.x0 >= half && Math.min( tile.x0, tile.x1 ) >= half, 'the tile lies wholly outside the heightmap (east of x = 1024)', 'x ' + tile.x0 + '..' + tile.x1 + ', z ' + tile.z0 + '..' + tile.z1 );
ok( t.heightAt( tile.x0 - 1, I.z ) === - 90 && Math.abs( tile.heightAt( tile.x0 + 0.5, I.z ) + 90 ) < 0.5 && t.heightAt( tile.x1 + 5, I.z ) === - 90, 'the tile meets the open-ocean floor (-90 m) at its rim' );

// ------------------------------------------------------------------------------ size, place, clearance
section( 'the island' );
const land = [];
let peak = - 99;
for ( let j = 0; j < tile.n; j += 2 ) for ( let i = 0; i < tile.n; i += 2 ) {

	const h = tile.heights[ j * tile.n + i ];
	if ( h > 0 ) land.push( [ tile.x0 + i * tile.texel, tile.z0 + j * tile.texel ] );
	peak = Math.max( peak, h );

}

const area = land.length * 16;
let rmax = 0;
for ( const [ x, z ] of land ) rmax = Math.max( rmax, Math.hypot( x - I.x, z - I.z ) );
const isl = WORLD.islands.find( ( q ) => q.id === 'tidemark' );
// (wave 21A: Meridian, the city island, is bigger still)
const others = WORLD.islands.filter( ( q ) => q.id !== 'tidemark' && q.id !== 'home' && q.id !== 'meridian' );
ok( isl && isl.radius >= 400 && isl.radius <= 460 && others.every( ( q ) => q.radius < isl.radius ), 'the biggest island after the home island and Meridian (WORLD radius)', isl && isl.radius + ' m (next: ' + Math.max( ...others.map( ( q ) => q.radius ) ) + ' m)' );
ok( rmax > 380 && rmax < 470 && area > 300000, 'a big island: ~420 m from its centre to its farthest shore', 'land ' + Math.round( area / 1000 ) + 'k m2, farthest shore ' + rmax.toFixed( 0 ) + ' m, peak ' + peak.toFixed( 1 ) + ' m' );
const B = worldBounds( WORLD, t );
ok( land.every( ( [ x, z ] ) => x > B.x0 && x < B.x1 && z > B.z0 && z < B.z1 ), 'inside the world extent (the world map\'s bounds)', JSON.stringify( B ) );
const harbourD = Math.hypot( I.x - WORLD.boatDock.position.x, I.z - WORLD.boatDock.position.z );
ok( harbourD < 2500, 'within sight of the archipelago (camera far plane 60 km; 1.7 km from the harbour)', harbourD.toFixed( 0 ) + ' m' );
// 400 m of water: from every other island's land (the heightmap's dry texels) and every island circle in WORLD.islands
const other = [];
for ( let j = 0; j < t.res; j += 4 ) for ( let i = 0; i < t.res; i += 4 ) if ( t.heights[ j * t.res + i ] > 0 ) other.push( [ t.origin + i + 0.5, t.origin + j + 0.5 ] );
const coast = land.filter( ( [ x, z ] ) => tile.heightAt( x + 8, z ) <= 0 || tile.heightAt( x - 8, z ) <= 0 || tile.heightAt( x, z + 8 ) <= 0 || tile.heightAt( x, z - 8 ) <= 0 );
let water = Infinity;
for ( const [ x, z ] of coast ) for ( const [ ox, oz ] of other ) {

	const d = ( x - ox ) ** 2 + ( z - oz ) ** 2;
	if ( d < water ) water = d;

}

water = Math.sqrt( water );
ok( water >= 400, '400 m+ of open water to any other island\'s land', water.toFixed( 0 ) + ' m' );
let circ = Infinity, circId = '';
for ( const q of WORLD.islands ) {

	if ( q.id === 'tidemark' ) continue;
	const d = Math.hypot( q.center.x - I.x, q.center.z - I.z ) - q.radius - isl.radius;
	if ( d < circ ) { circ = d; circId = q.id; }

}

ok( circ >= 400, '400 m+ between the WORLD.islands circles too (the pirate island included)', circ.toFixed( 0 ) + ' m to ' + circId );
const segDist = ( px, pz, a, b ) => {

	const dx = b[ 0 ] - a[ 0 ], dz = b[ 1 ] - a[ 1 ];
	const f = Math.max( 0, Math.min( 1, ( ( px - a[ 0 ] ) * dx + ( pz - a[ 1 ] ) * dz ) / ( dx * dx + dz * dz ) ) );
	return Math.hypot( px - a[ 0 ] - dx * f, pz - a[ 1 ] - dz * f );

};
let lane = Infinity;
for ( const [ a, b ] of [ ...legs( MERCHANT_ROUTE ), ...PATROLS.flatMap( ( p ) => legs( p, true ) ) ] ) for ( const [ x, z ] of coast ) lane = Math.min( lane, segDist( x, z, a, b ) );
ok( lane >= 400, '400 m+ from the pirates\' patrol lines and the merchant lane', lane.toFixed( 0 ) + ' m' );

// ------------------------------------------------------------------------------ the island's character
section( 'bay, beach, headland, hill, river' );
const H = ( u, v ) => { const [ x, z ] = tidemarkWorld( u, v ); return t.heightAt( x, z ); };
const bay = WORLD.tidemark.bay;
ok( bay && t.heightAt( bay.x, bay.z ) < - 4 && t.coastDistance( bay.x, bay.z ).d > 0 && t.islandAt( bay.x, bay.z ) === 'tidemark', 'WORLD.tidemark.bay: open water, coastDistance and islandAt answer from the tile', t.heightAt( bay.x, bay.z ).toFixed( 1 ) + ' m deep' );
// the bay is sheltered: land on both horns and behind it
ok( H( - 240, 175 ) > 0 && H( - 240, - 160 ) > 0 && H( - 150, 10 ) > 0, 'a bay: land on both horns and behind the water' );
// a seaplane run: from the roads out along the bay axis (and in toward the pier), 3 m+ of water
let run = 0, started = false;
for ( let u = - 165; u > - 640; u -= 2 ) {

	const wet = H( u, 10 ) < - 1.5;
	if ( wet ) { started = true; run += 2; } else if ( started ) break;

}

ok( run >= 300, 'a seaplane can land in the bay: a straight run of 300 m+ with 1.5 m+ of water from the pier out', run + ' m' );
// the long beach: sandy shore round the bay
let beach = 0;
for ( let v = - 200; v <= 200; v += 2 ) {

	for ( let u = - 260; u < - 100; u += 1 ) {

		if ( H( u, v ) <= 0.05 ) continue;
		const [ x, z ] = tidemarkWorld( u, v );
		if ( tile.maskAt( x, z ).sand > 0.5 || ( v >= - 82 && v <= 70 ) ) beach += 2;
		break;

	}

}

ok( beach >= 250, 'a long beach round the bay (or the quay where the town meets the water)', beach + ' m of shore' );
let cliff = 0;
for ( let u = - 360; u <= - 160; u += 3 ) for ( let v = 200; v <= 360; v += 3 ) {

	const h = H( u, v ), [ x, z ] = tidemarkWorld( u, v );
	if ( h > 12 && t.coastDistance( x, z ).d > - 30 ) cliff = Math.max( cliff, h );

}

ok( cliff > 16, 'a headland with sea cliffs north of the bay', 'up to ' + cliff.toFixed( 1 ) + ' m within 30 m of the sea' );
ok( H( 130, 110 ) > 60, 'the lookout hill', H( 130, 110 ).toFixed( 1 ) + ' m' );
const R = I.river;
const mouth = R.pts[ R.pts.length - 1 ];
let mono = true, prevBed = Infinity;
for ( let s = 0; s <= 1.0001; s += 0.02 ) { const b = tile.riverBed( s ); if ( b > prevBed + 1e-6 ) mono = false; prevBed = b; }
ok( H( mouth[ 0 ], mouth[ 1 ] ) < - 0.5 && mono && tile.riverBed( 0 ) > 15, 'a river from the hills, its bed falling all the way, its mouth open to the bay', 'spring bed ' + tile.riverBed( 0 ).toFixed( 1 ) + ' m, mouth ' + H( mouth[ 0 ], mouth[ 1 ] ).toFixed( 2 ) + ' m' );
let banks = 0;
for ( let k = 1; k < R.pts.length - 1; k ++ ) {

	const [ u, v ] = R.pts[ k ];
	const [ x, z ] = tidemarkWorld( u, v );
	const bed = t.heightAt( x, z );
	if ( H( u + 12, v ) > bed + 0.4 || H( u, v + 12 ) > bed + 0.4 ) banks ++;

}

ok( banks >= R.pts.length - 3, 'the river runs in a valley (banks above its bed)', banks + ' of ' + ( R.pts.length - 2 ) );

// ------------------------------------------------------------------------------ port, pier, berth
section( 'the port' );
const port = WORLD.ports.find( ( p ) => p.id === 'tidemark' );
ok( port && port.name === 'Tidemark' && port.size === 2 && port.dock && port.stand && port.market && port.roads && port.approach.at( - 1 ) === port.roads, 'WORLD.ports tidemark: dock, stand, market, roads, approach, size', JSON.stringify( { stand: port.stand, market: port.market, roads: port.roads } ) );
const Dk = port.dock;
const foot = t.heightAt( Dk.start.x, Dk.start.z ), endH = t.heightAt( Dk.end.x, Dk.end.z ), berth = t.heightAt( Dk.position.x, Dk.position.z );
ok( foot > 2 && Dk.deckHeight - foot <= 0.36 && Dk.deckHeight > foot, 'the stone pier starts on the quay, one step up', 'deck ' + Dk.deckHeight + ' quay ' + foot.toFixed( 2 ) );
ok( endH < - 3 && berth < - 3 && Math.hypot( Dk.position.x - Dk.end.x, Dk.position.z - Dk.end.z ) < 12, 'water under the pier head and at the berth alongside it', 'head ' + endH.toFixed( 2 ) + ', berth ' + berth.toFixed( 2 ) + ' m' );
ok( t.heightAt( port.stand.x, port.stand.z ) > 1.5 && t.coastDistance( port.stand.x, port.stand.z ).d < 0, 'the fish hall stands on the town terrace' );
// the sailing approach from the harbour anchorage: 2.5 m+ deep within 20 m of every leg
{

	const pts = [ [ 80, 80 ], ...port.approach ];
	let high = - 99, at = null;
	for ( const [ a, b ] of legs( pts ) ) {

		const len = Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] );
		for ( let q = 0; q <= len; q += 4 ) for ( const o of [ - 20, 0, 20 ] ) {

			const x = a[ 0 ] + ( b[ 0 ] - a[ 0 ] ) * q / len - ( b[ 1 ] - a[ 1 ] ) / len * o, z = a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * q / len + ( b[ 0 ] - a[ 0 ] ) / len * o;
			const h = t.heightAt( x, z );
			if ( h > high ) { high = h; at = [ Math.round( x ), Math.round( z ) ]; }

		}

	}

	ok( high < - 2.5, 'the sailing approach is water at least 2.5 m deep', 'shallowest ' + high.toFixed( 1 ) + ' m at ' + at );
	const Rd = port.roads, M = Dk.position;
	let inner = - 99;
	for ( let q = 0; q <= 40; q ++ ) inner = Math.max( inner, t.heightAt( Rd[ 0 ] + ( M.x - Rd[ 0 ] ) * q / 40, Rd[ 1 ] + ( M.z - Rd[ 1 ] ) * q / 40 ) );
	ok( inner < - 2, 'from the roads in to the berth is water', 'shallowest ' + inner.toFixed( 2 ) + ' m' );

}

// ------------------------------------------------------------------------------ the airstrip
section( 'the airstrip' );
const A = WORLD.tidemark.airstrip, S = I.airstrip;
ok( A && [ A.x, A.z, A.y, A.heading, A.length, A.width, A.pad.x, A.pad.z ].every( Number.isFinite ) && A.length >= 300 && A.width >= 25, 'WORLD.tidemark.airstrip { x, z, y, heading, length, width, pad }', JSON.stringify( A ) );
const dir = [ Math.sin( A.heading ), Math.cos( A.heading ) ];
const wind = [ 0.906, 0.423 ]; // the wave field's wind (25 deg: weather/WorldLink sets G.windDir from it): blowing toward
ok( dir[ 0 ] * - wind[ 0 ] + dir[ 1 ] * - wind[ 1 ] > 0.99, 'take-off heading into the prevailing wind', 'heading ' + A.heading );
let lo = Infinity, hi = - Infinity, landMin = Infinity, inside = Infinity;
for ( let a = - S.length / 2; a <= S.length / 2 + 1e-6; a += 2 ) for ( let b = - S.width / 2; b <= S.width / 2 + 1e-6; b += 2 ) {

	const [ x, z ] = tidemarkWorld( S.u + a, S.v + b );
	const h = t.heightAt( x, z );
	lo = Math.min( lo, h ); hi = Math.max( hi, h );
	landMin = Math.min( landMin, h );
	inside = Math.min( inside, - t.coastDistance( x, z ).d );

}

ok( hi - lo <= 0.3 && Math.abs( lo - A.y ) < 0.05, 'the runway is level within 0.3 m (graded in the tile)', ( hi - lo ).toFixed( 3 ) + ' m at y ' + lo.toFixed( 2 ) );
ok( landMin > 2 && inside > 20, 'the runway lies inside the island (20 m+ from the shore everywhere)', 'nearest shore ' + inside.toFixed( 0 ) + ' m' );
let padSpan = 0;
{

	const [ pu, pv, phu, phv ] = S.pad;
	let a = Infinity, b = - Infinity;
	for ( let du = - phu; du <= phu; du += 2 ) for ( let dv = - phv; dv <= phv; dv += 2 ) { const h = H( pu + du, pv + dv ); a = Math.min( a, h ); b = Math.max( b, h ); }
	padSpan = b - a;

}

ok( padSpan <= 0.3 && Math.abs( t.heightAt( A.pad.x, A.pad.z ) - A.y ) < 0.05, 'the apron (hangar and parking) is level with the runway', padSpan.toFixed( 3 ) + ' m' );

// ------------------------------------------------------------------------------ the scenery (CPU side, stub scene)
section( 'the town' );
globalThis.fetch = () => Promise.reject( new Error( 'no network in the test' ) );
const warn = console.warn;
console.warn = () => {};
const { Ports } = await import( '../src/game/ports/Ports.js' );
const { Colliders } = await import( '../src/world/Colliders.js' );
const { FrameUniforms } = await import( '../src/engine/render/Frame.js' );
const { Vector3 } = await import( '../src/engine/index.js' );
const scene = { children: [], add( o ) { this.children.push( o ); } };
const colliders = new Colliders();
const tb = performance.now();
const ports = new Ports( { scene, terrain: t, colliders } );
const TM = ports.tidemark;
ok( TM && TM.tile === tile, 'Ports builds Tidemark on the attached tile', Math.round( performance.now() - tb ) + ' ms for all the ports, ' + JSON.stringify( TM.stats ) );
const kinds = new Set( BUILDINGS.map( ( b ) => b.kind ) );
ok( BUILDINGS.length >= 10 && BUILDINGS.length <= 14 && [ 'chandler', 'tavern', 'warehouse', 'chapel', 'house', 'boatyard' ].every( ( k ) => kinds.has( k ) ), 'a town of 10-14 buildings: chandler, tavern, warehouse, chapel, fishermen\'s houses, boatyard', BUILDINGS.length + ': ' + BUILDINGS.map( ( b ) => b.id ).join() );
// footprints: level under each (the terrace / slip), no overlaps, off the streets, the square kept clear
const corners = ( b, m = 0 ) => {

	const c = Math.cos( b.yaw ), s = Math.sin( b.yaw ), out = [];
	for ( const [ sx, sz ] of [ [ - 1, - 1 ], [ 1, - 1 ], [ 1, 1 ], [ - 1, 1 ], [ 0, 0 ] ] ) {

		const lx = sx * ( b.w / 2 + m ), lz = sz * ( b.d / 2 + m );
		out.push( [ b.x + lx * c + lz * s, b.z - lx * s + lz * c ] );

	}

	return out;

};
let level = 0;
for ( const b of BUILDINGS ) {

	const hs = corners( b ).map( ( [ x, z ] ) => t.heightAt( x, z ) );
	if ( Math.max( ...hs ) - Math.min( ...hs ) < 0.3 && Math.min( ...hs ) > 0.6 ) level ++;

}

ok( level === BUILDINGS.length, 'every shell stands on level dry ground', level + ' of ' + BUILDINGS.length );
const inRect = ( p, b, m ) => {

	const c = Math.cos( b.yaw ), s = Math.sin( b.yaw ), dx = p[ 0 ] - b.x, dz = p[ 1 ] - b.z;
	return Math.abs( dx * c - dz * s ) < b.w / 2 + m && Math.abs( dx * s + dz * c ) < b.d / 2 + m;

};
let overlap = 0;
for ( const a of BUILDINGS ) for ( const b of BUILDINGS ) if ( a !== b && corners( a ).some( ( p ) => inRect( p, b, 1 ) ) ) overlap ++;
ok( overlap === 0, 'no two shells overlap (1 m between them at least)' );
let onStreet = 0;
for ( const b of BUILDINGS ) for ( const p of corners( b ) ) if ( t.pathDistance( p[ 0 ], p[ 1 ] ) < 0 ) onStreet ++;
const sq = [ [ SQUARE.u0, SQUARE.v0 ], [ SQUARE.u1, SQUARE.v0 ], [ SQUARE.u1, SQUARE.v1 ], [ SQUARE.u0, SQUARE.v1 ] ];
const sqClear = BUILDINGS.every( ( b ) => { const [ u, v ] = tidemarkLocal( b.x, b.z ); return rectOut( u, v, SQUARE.u0, SQUARE.u1, SQUARE.v0, SQUARE.v1 ) > Math.max( b.w, b.d ) / 2; } );
ok( onStreet === 0 && sqClear && sq.length === 4, 'the quay street, the market street and the market square are clear of shells' );
const tags = new Set( colliders.boxes.map( ( b ) => b.tag ).concat( colliders.cylinders.map( ( c ) => c.tag ) ) );
ok( [ 'tidemarkWarehouse', 'tidemarkChapel', 'tidemarkBoatyard', 'tidemarkHangar', 'tidemarkLookout', 'tidemarkPier', 'tidemarkQuay', 'tidemarkWharfDeck', 'tidemarkWell', 'tidemarkFuel', 'tidemarkFishHall', 'tidemarkChandler' ].every( ( g ) => tags.has( g ) ), 'colliders: shells, the pier and the quay (walkable), the wharf, the well, the fuel drums, the stalls' );
const pier = colliders.boxes.find( ( b ) => b.tag === 'tidemarkPier' );
ok( pier && pier.walkable && Math.abs( pier.top - Dk.deckHeight ) < 1e-6, 'the stone pier\'s deck is walkable at deck height' );
// the strip: no collider on the runway, the taxiway or the apron except the hangar's own walls
const rects = airstripRects();
const onStrip = ( x, z, pad = 0 ) => { const [ u, v ] = tidemarkLocal( x, z ); return rects.some( ( r ) => rectOut( u, v, r[ 0 ], r[ 1 ], r[ 2 ], r[ 3 ] ) <= pad ); };
const runwayHit = colliders.boxes.filter( ( b ) => b.tag !== 'tidemarkHangar' && onStrip( b.center.x, b.center.z, b.radius ) && ( ( u, v ) => Math.abs( v - S.v ) < S.width / 2 + 6 + b.radius )( ...tidemarkLocal( b.center.x, b.center.z ) ) )
	.concat( colliders.cylinders.filter( ( c ) => ( ( u, v ) => Math.abs( v - S.v ) < S.width / 2 + 6 + c.radius && Math.abs( u - S.u ) < S.length / 2 + 6 )( ...tidemarkLocal( c.x, c.z ) ) ) );
ok( runwayHit.length === 0, 'the runway and its shoulders have no colliders', runwayHit.map( ( b ) => b.tag ).join() );
const near = BUILDINGS.map( ( b ) => {

	let m = Infinity;
	for ( const [ x, z ] of corners( b ) ) { const [ u, v ] = tidemarkLocal( x, z ); m = Math.min( m, rectOut( u, v, S.u - S.length / 2, S.u + S.length / 2, S.v - S.width / 2, S.v + S.width / 2 ) ); }
	return m;

} );
ok( Math.min( ...near ) > 60, 'the airstrip is clear of the town\'s buildings', 'nearest shell ' + Math.min( ...near ).toFixed( 0 ) + ' m from the runway' );
const hg = EXTRA.find( ( e ) => e.id === 'hangar' );
ok( onStrip( hg.x, hg.z ) && Math.abs( t.heightAt( hg.x, hg.z ) - A.y ) < 0.05 && Math.hypot( A.hangar.x - hg.x, A.hangar.z - hg.z ) < 0.2, 'the hangar stands on the apron (WORLD.tidemark.airstrip.hangar)' );
ok( TM.stats.edgeLights >= 20 && TM.lights.length <= 10, 'runway edge lights are emissive (no local lights); the island adds 10 lights at most (wave 18C: five street lamps)', TM.stats.edgeLights + ' edge lights, ' + TM.lights.length + ' island lights + ' + ports.tidemarkPort.lights.length + ' at the stalls' );
ok( TM.stats.palms >= 30 && TM.stats.treeCount >= 60, 'palms on the beach, woodland on the hills', TM.stats.palms + ' palms, ' + TM.stats.treeCount + ' trees' );

// distance culling: from home the town is hidden, the far terrain and the lookout stay; close up the town draws
const camAt = ( x, y, z ) => { FrameUniforms.fields.cameraPos.value = new Vector3( x, y, z ); ports.update( 0.016, null ); };
camAt( 55, 20, 40 );
ok( ! TM.parts.nearT.visible && TM.parts.farT.visible && TM.parts.farT.position.y === 0 && ! TM.parts.props.visible && TM.parts.crowns.visible, 'from the home harbour: the far terrain, crowns and lookout only', TM.distance.toFixed( 0 ) + ' m' );
camAt( SPOTS.market.x, 10, SPOTS.market.z );
ok( TM.parts.nearT.visible && TM.parts.farT.position.y < 0 && TM.parts.props.visible && TM.parts.trees.visible, 'in the town: the near terrain (the coarse one dropped under it), the shells, the props and the trees draw' );
ok( TM.stats.terrain + TM.stats.terrainFar + TM.stats.trees + TM.stats.town < 160000, 'the island stays light: triangles drawn in the town', JSON.stringify( { terrain: TM.stats.terrain, far: TM.stats.terrainFar, trees: TM.stats.trees, town: TM.stats.town } ) );

// the village-material path (the game passes app.village): the home village's own house builder, porches and all; the
// props, the vendors' spots and the tavern door must stay clear of those wider footprints too
{

	const { buildShells } = await import( '../src/world/islands/town/Buildings.js' );
	const { createPropMaterial } = await import( '../src/game/GameMaterials.js' );
	const mats = {};
	for ( const k of [ 'wood', 'hard', 'roofMetal', 'thatch', 'stone', 'fabric', 'net' ] ) mats[ k ] = createPropMaterial( 'stand-in ' + k );
	const vc = new Colliders();
	const vs = buildShells( { terrain: tile, colliders: vc, village: { materials: mats, textures: { bake() {} } }, propMaterial: createPropMaterial( 'p' ) } );
	const clear = ( x, z, y0, y1 ) => {

		let best = Infinity;
		for ( const b of vc.boxes ) {

			if ( b.top < y0 || b.bottom > y1 ) continue;
			const dx = x - b.center.x, dz = z - b.center.z;
			const lx = dx * b.cos - dz * b.sin, lz = dx * b.sin + dz * b.cos;
			best = Math.min( best, Math.hypot( Math.max( 0, Math.abs( lx ) - b.half.x ), Math.max( 0, Math.abs( lz ) - b.half.z ) ) );

		}

		return best;

	};
	const close = townProps( tile ).filter( ( p ) => clear( p.x, p.z, p.y - 0.3, p.y + 2.5 ) < 0.8 ).map( ( p ) => p.id )
		.concat( Object.keys( SPOTS ).filter( ( k ) => clear( SPOTS[ k ].x, SPOTS[ k ].z, tile.heightAt( SPOTS[ k ].x, SPOTS[ k ].z ) - 0.3, tile.heightAt( SPOTS[ k ].x, SPOTS[ k ].z ) + 2.5 ) < 1.2 ) );
	ok( vs.village && vs.meshes.some( ( m ) => m.name === 'tidemark_wood' ) && vc.boxes.some( ( b ) => b.tag === 'porch' ), 'with the village: the houses are the home village\'s (its materials, porches, stairs)', vs.meshes.map( ( m ) => m.name ).join() );
	ok( close.length === 0, 'and the props, the vendors\' spots and the tavern door keep clear of the porches', close.join() );

}

// ------------------------------------------------------------------------------ destructible props
section( 'the breakable props' );
const { planProps, KINDS, buildKind } = await import( '../src/features/destruction/index.js' );
const plan = planProps( { terrain: t, colliders, keep: [] } );
const town = plan.filter( ( p ) => p.site === 'town' );
ok( town.length === TOWN_PROPS.length && town.every( ( p ) => p.port === 'tidemark' && p.id.startsWith( 'tidemark.town.' ) ), 'every town prop plans through planProps (site town, port tidemark)', town.length + ' props' );
const tk = new Set( town.map( ( p ) => p.kind ) );
ok( [ 'stall', 'cart', 'lampPost', 'fence', 'wellRoof', 'railing', 'shedDoor', 'crate', 'barrel' ].every( ( k ) => tk.has( k ) && KINDS[ k ] ), 'kinds: stall, cart, lampPost, fence, wellRoof, railing, shedDoor, crate, barrel', [ ...tk ].join() );
for ( const k of [ 'stall', 'cart', 'lampPost', 'wellRoof', 'shedDoor' ] ) {

	const lay = buildKind( k, () => 0.5 );
	// (a cart stands free on its wheels: no world anchor; the rest are fixed to the ground at their posts)
	ok( lay.pieces.length >= 3 && ( k === 'cart' || lay.anchors.length >= 1 ) && lay.joints.length >= 1, k + ': pieces, joints' + ( k === 'cart' ? '' : ' and world anchors' ), lay.pieces.length + ' pieces, ' + lay.joints.length + ' joints, ' + lay.anchors.length + ' anchors' );

}

const ground = town.every( ( p ) => {

	const src = TOWN_PROPS.find( ( q, i ) => townProps( t )[ i ].id === p.id );
	return src && src.deck !== null ? Math.abs( p.y - src.deck ) < 1e-6 : Math.abs( p.y - t.heightAt( p.x, p.z ) + 0.02 ) < 0.01 && t.heightAt( p.x, p.z ) > 0.5;

} );
ok( ground, 'each stands on the ground (or on its deck: the pier railings, the wharf cargo)' );
const shellHit = town.filter( ( p ) => BUILDINGS.some( ( b ) => inRect( [ p.x, p.z ], b, - 0.2 ) && b.kind !== 'boatyard' ) );
ok( shellHit.length === 0, 'no prop stands inside a shell', shellHit.map( ( p ) => p.id ).join() );
const spotsClear = town.every( ( p ) => [ SPOTS.fish, SPOTS.chandler, SPOTS.market, SPOTS.board, SPOTS.keeper ].every( ( s ) => Math.hypot( p.x - s.x, p.z - s.z ) > 2.4 ) );
ok( spotsClear, 'the vendors, the trade booth, the notice board and the tavern door are clear of props' );
ok( new Set( plan.map( ( p ) => p.id ) ).size === plan.length, 'prop ids stay unique across the world' );
{

	const { Features } = await import( '../src/features/Features.js' );
	const destruction = await import( '../src/features/destruction/index.js' );
	const { initPhysics } = await import( '../src/physics/World.js' );
	const events = [];
	const app = { terrainData: t, colliders, settings: { timeOfDay: 10, timeSpeed: 1 }, mode: 'campaign', player: { position: new Vector3( 0, 5, - 300 ), yaw: 0, mode: 'walk' }, netsync: null };
	const features = new Features( app );
	features.on( 'propDestroyed', ( e ) => events.push( e ) );
	const d = features.add( 'destruction', destruction );
	await initPhysics();
	await new Promise( ( r ) => setTimeout( r, 0 ) );
	for ( let i = 0; i < 3; i ++ ) features.update( 1 / 60 );
	const stall = d.props.find( ( p ) => p.kind === 'stall' && p.site === 'town' );
	ok( stall && stall.state === 'intact', 'the destruction feature builds the town\'s props', d.props.filter( ( p ) => p.site === 'town' ).length + ' town props' );
	const c = stall.center;
	const hit = d.raycastSegment( c.x - 6, c.y, c.z, c.x + 6, c.y, c.z );
	features.emit( 'cannonballImpact', { x: c.x, y: c.y, z: c.z, vx: 120, vy: 0, vz: 0, hit: 'prop', target: stall.id, by: 'player' } );
	ok( hit && hit.id === stall.id && stall.state === 'broken' && events.some( ( e ) => e.id === stall.id && e.port === 'tidemark' ), 'a cannonball breaks a market stall (propDestroyed, port tidemark)' );
	const lamp = d.props.find( ( p ) => p.kind === 'lampPost' && p.site === 'town' );
	d.impulse( lamp.center.x, lamp.center.y, lamp.center.z, 2, 20000 );
	ok( lamp.state === 'broken', 'an explosion knocks a lamp post down' );
	for ( let i = 0; i < 120; i ++ ) features.update( 1 / 60 );
	ok( d.world.count > 0, 'their pieces fall through the physics world', d.world.count + ' bodies' );
	features.dispose && features.dispose();

}

// ------------------------------------------------------------------------------ the port in the game
section( 'markers, trade, residents, tavern, den, damage' );
const mk = ports.markers.find( ( m ) => m.id === 'tidemark' ), am = ports.markers.find( ( m ) => m.id === 'tidemark:airstrip' );
ok( mk && am && am.name === 'Airstrip' && t.heightAt( mk.x, mk.z ) > 0.5 && Math.abs( t.heightAt( am.x, am.z ) - A.y ) < 0.05, 'Ports.markers: Tidemark (the fish hall) and the Airstrip' );
ok( ports.near( { x: ( Dk.start.x + Dk.end.x ) / 2, z: ( Dk.start.z + Dk.end.z ) / 2 } ) === 'tidemark' && ports.near( A.pad ) === 'tidemark' && ports.near( { x: 1400, z: 600 } ) === null, 'Ports.near: on the pier and on the apron (the discovery: Game.discoverPort)' );
const fishList = [ { species: 'yellowtail', value: 20 }, { species: 'tuna', value: 40 }, { species: 'parrot', value: 10 } ];
const hall = ports.tidemarkPort.market;
ok( ports.priceFor( hall, fishList[ 0 ] ) === 24 && ports.priceFor( hall, fishList[ 1 ] ) === 40 && ports.premiumBonus( hall, fishList ) === 4 + 2, 'the fish hall: a reef-fish premium', '$' + ports.premiumBonus( hall, fishList ) );
const goods = await import( '../src/features/trade/goods.js' );
const { Market } = await import( '../src/features/trade/market.js' );
goods.syncPorts();
const mkt = new Market( { seed: 3, noise: 0, events: false } );
ok( goods.PORT_IDS.includes( 'tidemark' ) && goods.PORTS.tidemark && goods.REGION.tidemark && mkt.cells.tidemark && Object.keys( mkt.cells.tidemark ).length === goods.GOOD_IDS.length, 'trade: a market cell for every good at Tidemark', goods.PORTS.tidemark.title );
const { factorSite } = await import( '../src/features/trade/index.js' );
const fs = factorSite( 'tidemark' );
ok( fs && t.heightAt( fs.x, fs.z ) > 1.5, 'the trade stall\'s site is on the town\'s ground', JSON.stringify( fs ) + ( Math.hypot( fs.x - port.market.x, fs.z - port.market.z ) < 1 ? ' (the booth)' : ' (the pier foot until trade reads WORLD.ports market)' ) );
const { ROLES, SCHEDULES, scheduleOf, validSchedule, activityAt } = await import( '../src/features/harbour/Roles.js' );
const { populationFor, generatedRole } = await import( '../src/features/harbour/Schedules.js' );
const { PORT_FOLK } = await import( '../src/world/residents/ResidentData.js' );
const pop = populationFor( port );
ok( pop >= 6 && pop <= 10, 'the harbour feature gives the town 6-10 residents', pop + ' (size ' + port.size + ')' );
ok( TIDEMARK_FOLK.every( ( d ) => PORT_FOLK.includes( d ) ) && TIDEMARK_FOLK.some( ( d ) => d.service === 'tavern' && d.dice ), 'the named folk (the tavern keeper among them) are in the harbour\'s PORT_FOLK' );
const roles = [ ...TIDEMARK_FOLK.map( ( d ) => d ), ...Array.from( { length: Math.max( 0, pop - TIDEMARK_FOLK.length ) }, ( _, k ) => ( { role: generatedRole( k ) } ) ) ];
const gaps = roles.filter( ( d ) => ! ROLES[ d.role ] || ! validSchedule( scheduleOf( d ) ) );
ok( gaps.length === 0, 'every resident has a role and a schedule covering 0-24 h without gaps', roles.map( ( d ) => d.role + ( d.schedule ? '/' + d.schedule : '' ) ).join() );
let cover = true;
for ( const d of roles ) for ( let h = 0; h < 24; h += 0.25 ) if ( ! activityAt( scheduleOf( d ), h ) ) cover = false;
ok( cover, 'an activity at every quarter hour of the day for each of them' );
{

	const harbourModule = await import( '../src/features/harbour/index.js' );
	const { Features } = await import( '../src/features/Features.js' );
	const app = { settings: { timeOfDay: 12 }, terrainData: t, colliders, residents: null, game: { toast() {} }, player: { mode: 'walk', position: new Vector3( 0, 0, 0 ) } };
	const features = new Features( app );
	const hb = features.add( 'harbour', harbourModule, { audio: false, toasts: false } );
	const P = hb.places.tidemark;
	const homes = P ? Object.keys( P.homes ).length : 0;
	const tav = hb.sites.tavern.find( ( s ) => s.port === 'tidemark' );
	ok( P && homes >= 6 && homes <= 10, 'the harbour feature populates Tidemark (residents with homes on the island)', homes + ' residents' );
	ok( tav && tav.keeper === 'brine' && t.heightAt( tav.x, tav.z ) > 0.5, 'the tavern with its keeper', tav && tav.name + ' at ' + tav.x.toFixed( 1 ) + ', ' + tav.z.toFixed( 1 ) );

}

const { denSite } = await import( '../src/features/pirates/Dens.js' );
const den = denSite( isl, t, port );
const dTown = Math.hypot( den.x - SPOTS.market.x, den.z - SPOTS.market.z );
ok( t.heightAt( den.x, den.z ) > 0.3 && t.heightAt( den.mx, den.mz ) < - 3 && dTown > 300, 'a pirate den fits on the far shore (Dens reads WORLD.islands), its mooring in deep water', 'camp ' + den.x.toFixed( 0 ) + ', ' + den.z.toFixed( 0 ) + ' ' + dTown.toFixed( 0 ) + ' m from the market' );
const { SAFE_ZONES } = await import( '../src/features/naval/Routes.js' );
ok( ! SAFE_ZONES.some( ( s ) => Math.hypot( s.x - I.x, s.z - I.z ) < 600 ), 'not a safe zone: pirates may raid its waters' );
const dmg = TM.damage;
const tav = TM.buildings.find( ( b ) => b.id === 'tavern' );
ok( dmg.hit( tav.x, tav.floorY + 3, tav.z, 1000 ) === 'tavern' && dmg.state( 'tavern' ) === 'ok', 'a light hit on the tavern: no mark yet' );
dmg.hit( tav.x, tav.floorY + 3, tav.z, 800 );
ok( dmg.state( 'tavern' ) === 'cracked' && TM.group.children.some( ( m ) => m.name === 'tidemarkDamage_tavern' ), 'more: its walls crack (a decal), it does not collapse' );
dmg.hit( tav.x, tav.floorY + 3, tav.z, 6000 );
const puffs = [];
dmg.update( 1, { smoke: ( ...a ) => puffs.push( a ) } );
ok( dmg.state( 'tavern' ) === 'smoking' && puffs.length === 1, 'a heavy hit: the roof smokes (vfx.smoke)' );
const saved = JSON.parse( JSON.stringify( dmg.toJSON() ) );
dmg.reset();
dmg.fromJSON( saved );
ok( dmg.state( 'tavern' ) === 'smoking' && dmg.hit( I.x, 0, I.z, 5000 ) === null, 'damage saves and loads; a hit away from the town marks nothing' );
for ( let k = 0; k < 300; k ++ ) dmg.update( 1, null );
ok( dmg.state( 'tavern' ) === 'cracked', 'the smoke dies down after a while (cracked stays)' );
{

	const { Features } = await import( '../src/features/Features.js' );
	const features = new Features( { terrainData: t } );
	const off = TM.connect( features );
	const wh = TM.buildings.find( ( b ) => b.id === 'warehouse' ), ch = TM.buildings.find( ( b ) => b.id === 'chapel' );
	features.emit( 'cannonballImpact', { x: wh.x, y: wh.floorY + 2, z: wh.z, energy: 3500, hit: 'land' } );
	features.emit( 'explosion', { x: ch.x, y: ch.floorY + 3, z: ch.z, radius: 6, energy: 9000 } );
	ok( dmg.state( 'warehouse' ) === 'cracked' && dmg.state( 'chapel' ) === 'smoking', 'Tidemark.connect( features ): a cannonball cracks the warehouse, an explosion sets the chapel smoking' );
	off();
	features.emit( 'explosion', { x: wh.x, y: wh.floorY + 3, z: wh.z, energy: 9000 } );
	ok( dmg.state( 'warehouse' ) === 'cracked', 'and the hook comes off cleanly' );

}

console.warn = warn;
console.log( `\n${ n - fails } / ${ n } checks passed` );

// ---------------------------------------------------------------- optional headless render (node test/feature-town.mjs --render [dir])
if ( process.argv.includes( '--render' ) ) {

	const arg = process.argv[ process.argv.indexOf( '--render' ) + 1 ];
	const dir = arg && ! arg.startsWith( '--' ) ? arg : decodeURIComponent( new URL( './out/town', import.meta.url ).pathname ).replace( /^\/(\w:)/, '$1' );
	const { mkdirSync } = await import( 'node:fs' );
	mkdirSync( dir, { recursive: true } );
	const { worldHarness, done } = await import( './world-harness.mjs' );
	const Hn = await worldHarness( { width: 1600, height: 900, sun: [ 0.5, 0.5, 0.35 ] } );
	console.warn = () => {};
	const rp = new Ports( { scene: Hn.scene, terrain: t, colliders: new Colliders() } );
	Hn.before.push( () => rp.update( 1 / 60, null ) );
	const at = ( u, v, y ) => { const [ x, z ] = tidemarkWorld( u, v ); return [ x, y ?? t.heightAt( x, z ) + 1.7, z ]; };
	const views = {
		'town-aerial': { pos: at( - 330, - 130, 95 ), target: at( - 115, 0, 4 ), fov: 50 },
		'town-square': { pos: at( - 150, - 4 ), target: at( - 112, 10, 4 ), fov: 62 },
		'pier': { pos: at( - 226, 2, 5 ), target: at( - 130, 10, 6 ), fov: 60 },
		'airstrip': { pos: at( - 120, - 230, 35 ), target: at( 95, - 172, 9 ), fov: 55 },
		'island': { pos: at( - 760, - 240, 120 ), target: at( 0, 0, 25 ), fov: 48 },
		'from-home': { pos: [ 120, 12, 60 ], target: [ I.x, 30, I.z ], fov: 22 },
	};
	const only = process.argv.find( ( a ) => a.startsWith( '--view=' ) );
	for ( const [ name, view ] of Object.entries( views ) ) {

		if ( only && only.slice( 7 ) !== name ) continue;
		await Hn.shot( `${ dir }/town-${ name }.png`, view );

	}

	console.log( 'rendered into ' + dir );
	await done();

}

process.exit( fails ? 1 : 0 );

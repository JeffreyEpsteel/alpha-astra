// Plain-node test of Blackwater's own terrain tile (wave 14D: src/world/islands/BlackwaterTerrain.js). The island moved from
// (-55, 688), 480 m ahead of the seaplane's take-off run, to terrain/IslandShape.js BLACKWATER beyond the heightmap's south
// edge: the tile carries the heightmap's islet recipe (the ring, the caldera cove, the channel, the pads, the stacks), the
// heightmap at the old spot is open ocean again, and the tile coexists with Tidemark's (TerrainData's wrapped queries, the
// GPU height atlas, the world map's extent).
//   node test/feature-blackwater-tile.mjs
import { TerrainData } from '../src/world/TerrainData.js';
import { WORLD } from '../src/world/WorldLayout.js';
import * as Shape from '../src/world/terrain/IslandShape.js';
import { BlackwaterTerrain, ensureBlackwater, SOURCE, HALF } from '../src/world/islands/BlackwaterTerrain.js';
import { ensureTidemark } from '../src/world/islands/town/TidemarkTerrain.js';
import { terrainTiles, heightAtlasLayout, buildHeightStrip, stripHeightAt, tileHeightWGSL, mapExtent } from '../src/world/terrain/TerrainTiles.js';
import { strongholdLayout } from '../src/world/islands/stronghold/Layout.js';
import { blackwaterLandGeometry } from '../src/world/islands/BlackwaterMesh.js';

let fails = 0, passes = 0;
const ok = ( c, msg, info = '' ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg, info ); } else { passes ++; console.log( 'ok  ', msg, info ); }

};
const section = ( s ) => console.log( '\n== ' + s );
const { BLACKWATER: I, ISLETS, ISLETS_BY_ID, isletWorld } = Shape;
const L = strongholdLayout(), L0 = L;

// ---------------------------------------------------------------- the reference: the old heightmap islet
// Until wave 14D the heightmap stamped Blackwater at SOURCE (an ISLETS entry with `box`, its stacks and its paths). Rebuild
// that terrain once as the reference, then take the island back out.
const OLD = { ...I, x: SOURCE.x, z: SOURCE.z, box: true };
delete OLD.tile;
ISLETS.push( OLD );
Shape.refreshIsletStacks();
const oldPaths = Shape.BLACKWATER_PATHS.map( ( p ) => ( { w: p.w, pts: p.pts.map( ( [ u, v ] ) => isletWorld( OLD, u, v ).map( ( q ) => Math.round( q * 10 ) / 10 ) ) } ) );
Shape.PATHS.push( ...oldPaths );
let t0 = Date.now();
const ref = new TerrainData();
const tRef = Date.now() - t0;
ISLETS.splice( ISLETS.indexOf( OLD ), 1 );
Shape.refreshIsletStacks();
Shape.PATHS.splice( Shape.PATHS.length - oldPaths.length, oldPaths.length );

t0 = Date.now();
const T = new TerrainData();
const tNew = Date.now() - t0;
ensureTidemark( T );
const tile = ensureBlackwater( T ); // TerrainData's constructor does this once root applies the wave 14D patch (idempotent)
console.log( `terrains: reference ${ tRef } ms, current ${ tNew } ms; tile`, tile.timings );
const DX = SOURCE.x - I.x, DZ = SOURCE.z - I.z;
const at = ( u, v ) => isletWorld( I, u, v );

// ---------------------------------------------------------------- 1. the tile
section( '1. the tile' );
{

	const half = WORLD.terrainSize / 2;
	ok( Math.hypot( I.x - ( - 120 ), I.z - 1520 ) < 60 && I.tile === true && ! I.box, 'BLACKWATER at about (-120, 1520), a tile island', `(${ I.x }, ${ I.z })` );
	ok( tile instanceof BlackwaterTerrain && tile.id === 'blackwater' && tile.texel === 2 && tile.n === 2 * HALF / 2 + 1 && tile.x1 - tile.x0 === 2 * HALF, `a 2 m grid over a ${ 2 * HALF } m box` );
	ok( tile.z0 >= 1030 && tile.z0 > half, 'the box lies wholly outside the 2048 m heightmap', `z ${ tile.z0 }..${ tile.z1 }, x ${ tile.x0 }..${ tile.x1 }` );
	ok( tile.contains( I.x, I.z ) && ! tile.contains( 0, 0 ) && ! tile.contains( I.x, tile.z0 - 1 ), 'contains() is the box' );
	ok( tile.timings.total < 4000, 'built in ' + tile.timings.total + ' ms' );
	let rim = - 1e9;
	for ( let k = 0; k < tile.n; k ++ ) rim = Math.max( rim, tile.heights[ k ], tile.heights[ ( tile.n - 1 ) * tile.n + k ], tile.heights[ k * tile.n ], tile.heights[ k * tile.n + tile.n - 1 ] );
	ok( Math.abs( rim + 90 ) < 1e-3 && tile.heightAt( tile.x0 - 5, I.z ) === - 90, 'the rim fades to the open-ocean floor (-90 m), beyond it the ocean', rim.toFixed( 2 ) );
	ok( ensureBlackwater( T ) === tile && T.tiles.filter( ( q ) => q.id === 'blackwater' ).length === 1 && ensureBlackwater( ref ) === tile, 'ensureBlackwater is idempotent and shares one tile' );

}

// ---------------------------------------------------------------- 2. the recipe
section( '2. the heightmap islet recipe on the tile' );
{

	// every pad level at its height (the town, the fort yard, the gun platforms, the powder store)
	const off = ( [ u, v, r, f, h ], s ) => [ 0, 1, 2, 3 ].map( ( q ) => tile.heightAt( ...at( u + Math.cos( q * 1.57 ) * r * s, v + Math.sin( q * 1.57 ) * r * s ) ) - h );
	const centre = Math.max( ...I.pads.map( ( [ u, v, , , h ] ) => Math.abs( tile.heightAt( ...at( u, v ) ) - h ) ) );
	const ring = Math.max( ...I.pads.flatMap( ( p ) => off( p, 0.6 ) ).map( Math.abs ) );
	ok( centre < 0.02 && ring < 0.2, `all ${ I.pads.length } pads level at their heights (fort 27 m, platforms 26.5 / 27 m, the town 2.2-2.4 m)`, `centres within ${ centre.toFixed( 3 ) } m, 0.6 r within ${ ring.toFixed( 2 ) } m` );
	ok( Math.abs( T.heightAt( L.fort.x, L.fort.z ) - 27 ) < 0.05 && L.batteries.every( ( b ) => Math.abs( T.heightAt( b.x, b.z ) - b.y ) < 0.05 ), 'TerrainData.heightAt answers from the tile: the fort and both batteries' );
	// the docks: dry sand at the foot, water at the end; the cove floor at the lagoon depth; the moorings afloat
	ok( L.docks.every( ( d ) => T.heightAt( d.start.x, d.start.z ) > 0.3 && T.heightAt( d.start.x, d.start.z ) < 1.6 && T.heightAt( d.end.x, d.end.z ) < - 2 ), 'the docks run from the sand into the cove',
		L.docks.map( ( d ) => T.heightAt( d.start.x, d.start.z ).toFixed( 2 ) + '/' + T.heightAt( d.end.x, d.end.z ).toFixed( 1 ) ).join( ' ' ) );
	const cove = T.heightAt( L.cove.x, L.cove.z );
	ok( Math.abs( cove + I.lagoon ) < 0.6, `the cove floor at the lagoon depth (${ I.lagoon } m)`, cove.toFixed( 2 ) + ' m' );
	// the tile against the old heightmap islet, point for point relative to the centre
	let sum = 0, n = 0, worstLand = 0;
	for ( let v = - 260; v <= 260; v += 3 ) for ( let u = - 300; u <= 300; u += 3 ) {

		const [ x, z ] = at( u, v ), a = tile.heightAt( x, z ), b = ref.heightAt( x + DX, z + DZ );
		if ( a <= 0.3 && b <= 0.3 ) continue;
		sum += Math.abs( a - b ); n ++;
		worstLand = Math.max( worstLand, Math.abs( a - b ) );

	}

	ok( sum / n < 0.3, 'the land matches the old heightmap islet (same recipe, same noise)', `mean |dh| ${ ( sum / n ).toFixed( 3 ) } m over ${ n } points, worst ${ worstLand.toFixed( 1 ) } m (2 m vs 1 m relief)` );
	const spots = { 'fort pad': [ 185, - 64 ], 'seaward battery': [ 218, - 46 ], 'channel battery': [ 158, - 36 ], tavern: [ - 128, 0 ], 'dock foot': [ I.dock.u0, 0 ], 'dock end': [ I.dock.u1, 0 ], cove: [ - 10, 0 ], 'mooring': [ - 46, 32 ] };
	const diffs = Object.entries( spots ).map( ( [ k, [ u, v ] ] ) => {

		const [ x, z ] = at( u, v );
		return [ k, tile.heightAt( x, z ), ref.heightAt( x + DX, z + DZ ) ];

	} );
	ok( diffs.every( ( [ , a, b ] ) => Math.abs( a - b ) < 0.1 ), 'the fort pad, the batteries, the town, the dock and the cove stand exactly as before', diffs.map( ( [ k, a ] ) => `${ k } ${ a.toFixed( 2 ) }` ).join( ', ' ) );
	// the channel: as deep as it was or deeper (the old seabed there was shallowed by Pons' distance and the home pier's lane)
	let chNew = - 99, chOld = - 99;
	for ( const [ a, b ] of [ [ L.sailOut[ 1 ], L.sailOut[ 2 ] ], [ L.sailOut[ 2 ], L.sailOut[ 3 ] ] ] ) for ( let s = 0; s <= 1; s += 0.02 ) {

		const x = a[ 0 ] + ( b[ 0 ] - a[ 0 ] ) * s, z = a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * s;
		chNew = Math.max( chNew, T.heightAt( x, z ) ); chOld = Math.max( chOld, ref.heightAt( x + DX, z + DZ ) );

	}

	ok( chNew < - 4.5 && chNew <= chOld + 0.3, 'the hidden entrance channel is deep enough to sail', `shallowest ${ chNew.toFixed( 1 ) } m (was ${ chOld.toFixed( 1 ) } m)` );
	let peak = - 99;
	for ( let v = - 200; v <= 200; v += 4 ) for ( let u = - 260; u <= 260; u += 4 ) peak = Math.max( peak, tile.heightAt( ...at( u, v ) ) );
	ok( peak > 55 && peak < 80, 'the summit behind the town', peak.toFixed( 0 ) + ' m' );
	const st = I.stacks[ 0 ];
	ok( tile.heightAt( ...at( st[ 0 ], st[ 1 ] ) ) > st[ 3 ] * 0.6 && tile.rockSites.length === I.stacks.length, 'the sea stacks stand off the shore', `${ tile.rockSites.length } stacks` );

}

// ---------------------------------------------------------------- 3. queries and masks
section( '3. the queries on the tile' );
{

	const town = L.town[ 0 ];
	const c = T.coastDistance( town.x, town.z ), w = T.coastDistance( L.cove.x, L.cove.z );
	ok( c.d < 0 && w.d > 0 && T.coastDistance( I.x, I.z - 400 ).d > 100, 'coastDistance: the town on land, the cove and the open sea water', `${ c.d.toFixed( 0 ) } / ${ w.d.toFixed( 0 ) }` );
	ok( T.islandAt( I.x, I.z ) === 'blackwater' && T.islandAt( town.x, town.z ) === 'blackwater' && T.islandAt( WORLD.tidemark.center.x, WORLD.tidemark.center.z ) === 'tidemark' && T.islandAt( 0, - 330 ) === 'main', 'islandAt: Blackwater, Tidemark and the home island each answer for themselves' );
	const rim = Shape.blackwaterPaths().find( ( p ) => p.id === 'rim' ).pts[ 3 ];
	ok( T.pathDistance( rim[ 0 ], rim[ 1 ] ) < 0 && T.pathDistance( L.fort.x, L.fort.z ) < 0 && T.pathDistance( ...at( - 172, - 10 ) ) > 10, 'pathDistance: the rim path, the fort yard (worn ground); not the summit' );
	const m = tile.maskAt( rim[ 0 ], rim[ 1 ] ), fy = tile.maskAt( L.fort.x, L.fort.z );
	ok( m.path > 0.5 && fy.path > 0.5 && fy.forest === 0 && fy.rock < 0.1, 'maskAt: the path, the fort yard clear of woods and rock', JSON.stringify( fy ) );
	let rock = 0, sand = 0;
	for ( let v = - 200; v <= 200; v += 4 ) for ( let u = - 260; u <= 260; u += 4 ) {

		const q = tile.maskAt( ...at( u, v ) ), h = tile.heightAt( ...at( u, v ) );
		if ( h > 0.5 && q.rock > 0.6 ) rock ++;
		if ( h > 0.3 && h < 3 && q.sand > 0.6 ) sand ++;

	}

	ok( rock > 50 && sand > 20, 'rocky cliffs and black-sand shores', `${ rock } rock / ${ sand } sand samples` );
	const nrm = T.normalAt( ...at( 120, - 140 ), { set( x, y, z ) { this.x = x; this.y = y; this.z = z; return this; }, normalize() { const l = Math.hypot( this.x, this.y, this.z ); this.x /= l; this.y /= l; this.z /= l; return this; } } );
	ok( nrm.y > 0 && nrm.y < 0.999, 'normalAt reads the tile through the wrapped heightAt', nrm.y.toFixed( 3 ) );

}

// ---------------------------------------------------------------- 3b. the land mesh's colours
section( '3b. the land mesh (BlackwaterMesh: TerrainMesh.terrainGeometry with the island’s own colours)' );
{

	const g = blackwaterLandGeometry( tile, { step: 1, floor: - 12 } );
	const P = g.getAttribute( 'position' ).array, Cl = g.getAttribute( 'color' ).array;
	const near = ( x, z ) => {

		let best = 0, bd = Infinity;
		for ( let v = 0; v < P.length / 3; v ++ ) { const d = ( P[ v * 3 ] - x ) ** 2 + ( P[ v * 3 + 2 ] - z ) ** 2; if ( d < bd ) { bd = d; best = v; } }
		return [ Cl[ best * 3 ], Cl[ best * 3 + 1 ], Cl[ best * 3 + 2 ] ];

	};
	const L = ( c ) => 0.2126 * c[ 0 ] + 0.7152 * c[ 1 ] + 0.0722 * c[ 2 ];
	const beach = near( ...at( - 112, 20 ) ), cove = near( L0.cove.x, L0.cove.z ), cliff = near( ...at( 0, - 150 ) );
	let scrub = null;
	for ( let v = 0; v < P.length / 3 && ! scrub; v += 7 ) { const c = [ Cl[ v * 3 ], Cl[ v * 3 + 1 ], Cl[ v * 3 + 2 ] ]; if ( P[ v * 3 + 1 ] > 8 && c[ 1 ] > c[ 0 ] * 1.25 ) scrub = c; }
	ok( L( beach ) < 0.06 && L( cove ) < 0.04 && L( cliff ) < 0.09 && !! scrub, 'black sand on the crescent, a dark caldera floor, basalt on the ring, scrub green on the flanks',
		[ beach, cove, cliff ].map( ( c ) => L( c ).toFixed( 3 ) ).join( ' / ' ) );

}

// ---------------------------------------------------------------- 4. the old spot
section( '4. the heightmap at the old spot is open ocean' );
{

	// over the old island's footprint (its ellipse and 40 m of shore round it)
	let hi = - 1e9, land = 0;
	for ( let v = - I.rv - 40; v <= I.rv + 40; v += 4 ) for ( let u = - I.ru - 40; u <= I.ru + 40; u += 4 ) {

		if ( ( u / ( I.ru + 40 ) ) ** 2 + ( v / ( I.rv + 40 ) ) ** 2 > 1 ) continue;
		const [ x, z ] = isletWorld( OLD, u, v );
		hi = Math.max( hi, T.heightAt( x, z ) );
		if ( T.islandAt( x, z ) === 'blackwater' ) land ++;

	}

	const mid = T.heightAt( SOURCE.x, SOURCE.z );
	ok( hi < - 5 && mid < - 15 && land === 0, 'no island left where Blackwater was: open sea (the home island south shelf at its north edge)', `highest ${ hi.toFixed( 1 ) } m over its old footprint, ${ mid.toFixed( 1 ) } m at the old centre` );
	ok( ref.heightAt( SOURCE.x, SOURCE.z - 150 ) > 10, '(control) the reference terrain has the island there', ref.heightAt( SOURCE.x, SOURCE.z - 150 ).toFixed( 1 ) + ' m' );
	ok( ! ISLETS.includes( I ) && ISLETS_BY_ID.blackwater === I && ! Shape.ISLET_STACKS.some( ( s ) => Math.hypot( s[ 0 ] - SOURCE.x, s[ 1 ] - SOURCE.z ) < 320 ), 'not an ISLETS entry, no stacks stamped there' );
	ok( ! Shape.PATHS.some( ( p ) => p.pts.some( ( q ) => q[ 1 ] > 1024 ) ), 'no heightmap footpaths beyond the domain (the tile wears its own)' );
	// the take-off run from the seaplane's berth (0, -20), due +z
	let run = 0;
	for ( let z = 60; z <= 1500; z += 2 ) { if ( T.heightAt( 0, z ) > - 1 ) break; run = z + 20; }
	ok( run > 1200, 'the seaplane has 1.2 km+ of open water ahead of its berth', run + ' m' );

}

// ---------------------------------------------------------------- 5. two tiles
section( '5. two tiles coexist' );
{

	const tiles = terrainTiles( T );
	ok( tiles.length === 3 && tiles[ 0 ].id === 'tidemark' && tiles[ 1 ].id === 'blackwater' && tiles[ 2 ].id === 'meridian', 'terrainTiles: Tidemark, Blackwater, then Meridian (wave 21A)', tiles.map( ( q ) => `${ q.id } ${ q.n }x${ q.n }` ).join( ', ' ) );
	const a = tiles[ 0 ], b = tiles[ 1 ];
	ok( a.x0 > b.x0 + b.size || b.x0 > a.x0 + a.size || a.z0 > b.z0 + b.size || b.z0 > a.z0 + a.size, 'their boxes do not overlap' );
	const layout = heightAtlasLayout( T ), strip = buildHeightStrip( layout );
	const probes = [ [ L.fort.x, L.fort.z ], [ L.cove.x, L.cove.z ], [ WORLD.tidemark.center.x, WORLD.tidemark.center.z ], [ WORLD.tidemark.dock.start.x, WORLD.tidemark.dock.start.z ] ];
	ok( probes.every( ( [ x, z ] ) => Math.abs( stripHeightAt( layout, strip, x, z ) - T.heightAt( x, z ) ) < 1e-3 ), 'the GPU height atlas packs both (the WGSL lookup on the CPU = TerrainData.heightAt)', `${ layout.stripRows } strip rows` );
	const wgsl = tileHeightWGSL( layout );
	ok( ( wgsl.match( /textureLoad/g ) || [] ).length === 1 && ( wgsl.match( /if \( f\.x >= 0\.0/g ) || [] ).length === 3, 'one tile branch each in the WGSL' );
	const ext = mapExtent( T );
	ok( ext.z0 + ext.size >= tile.z1 && ext.x0 + ext.size >= a.x0 + a.size && ext.x0 <= - 1024, 'the world map\'s picture covers both tiles', JSON.stringify( ext ) );
	ok( T.heightAt( 0, 0 ) === ref.heightAt( 0, 0 ) && T.heightAt( 600, 560 ) === ref.heightAt( 600, 560 ), 'the home island and Pons are untouched' );

}

console.log( `\n${ passes } passed, ${ fails } failed` );
process.exit( fails ? 1 : 0 );

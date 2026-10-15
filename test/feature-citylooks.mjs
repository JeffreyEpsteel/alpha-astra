// Wave 18C: the cities look like places. Plain node, no GPU: Tidemark's infill houses stand clear of the streets, the
// square, the paths, the breakable props, the vendors' spots and the street furniture; every original shell keeps its id,
// footprint and collider (and every breakable prop still plans); the town kit (public/models/town/kit.glb, built by
// tools/town/kit.py) has every piece the towns place and merges into one prop mesh and one glow mesh; the seats lists
// (Tidemark, the home village, Blackwater) are on the ground and out of the colliders; the near / far LOD switches by
// the camera's distance (phones at 60 m); the budgets (Tidemark <= 120k triangles near, <= 25k far, no new textures).
//   node test/feature-citylooks.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join( dirname( fileURLToPath( import.meta.url ) ), '..' );
let fails = 0, n = 0;
const ok = ( c, msg, info = '' ) => {

	n ++;
	if ( ! c ) { fails ++; console.log( 'FAIL', msg, info ); } else console.log( 'ok  ', msg, info );

};
const section = ( s ) => console.log( '\n== ' + s );

// the kit GLB from disk (GLTF.js asks globalThis.__assetFile in node), no network otherwise
globalThis.__assetFile = async ( url ) => {

	const b = readFileSync( join( root, 'public', url.replace( /^\/+/, '' ) ) );
	return b.buffer.slice( b.byteOffset, b.byteOffset + b.byteLength );

};
globalThis.fetch = () => Promise.reject( new Error( 'no network in the test' ) );
const warn = console.warn;
console.warn = () => {};

const { TerrainData } = await import( '../src/world/TerrainData.js' );
const { TIDEMARK_PATHS, tidemarkWorld, tidemarkLocal } = await import( '../src/world/terrain/IslandShape.js' );
const { ensureTidemark } = await import( '../src/world/islands/town/TidemarkTerrain.js' );
const { BUILDINGS, EXTRA, SQUARE, SPOTS, townProps } = await import( '../src/world/islands/town/Layout.js' );
const { buildShells, FILLERS, LOD, PAVING } = await import( '../src/world/islands/town/Buildings.js' );
const { STREET, tidemarkSeats, buildWaterfront } = await import( '../src/world/islands/town/Waterfront.js' );
const { loadKit, pieceTriangles, channelsOf } = await import( '../src/world/village/TownKit.js' );
const { Colliders } = await import( '../src/world/Colliders.js' );
const { createPropMaterial } = await import( '../src/game/GameMaterials.js' );
const { FrameUniforms } = await import( '../src/engine/render/Frame.js' );
const { Vector3 } = await import( '../src/engine/index.js' );

const t = new TerrainData();
const tile = ensureTidemark( t );
const standIns = () => {

	const mats = {};
	for ( const k of [ 'wood', 'hard', 'roofMetal', 'thatch', 'stone', 'fabric', 'net' ] ) mats[ k ] = createPropMaterial( 'stand-in ' + k );
	return { materials: mats, textures: { bake() {} } };

};
const tris = ( m ) => ( m && m.geometry && m.geometry.index ? m.geometry.index.count / 3 : 0 );

// ------------------------------------------------------------------------------ the kit
section( 'the town kit (Blender)' );
const pieces = await loadKit();
ok( pieces && Object.keys( pieces ).length >= 20, 'kit.glb loads: one root object per piece', pieces ? Object.keys( pieces ).length + ' pieces' : 'missing' );
const kitTris = Object.fromEntries( Object.entries( pieces || {} ).map( ( [ k, v ] ) => [ k, pieceTriangles( v ) ] ) );
ok( Object.values( kitTris ).every( ( v ) => v > 20 && v < 4000 ), 'every piece within 4k triangles', JSON.stringify( kitTris ) );
ok( pieces && pieces.lamp_street.some( ( p ) => p.glow ) && pieces.lantern_wall.some( ( p ) => p.glow ) && ! pieces.bench.some( ( p ) => p.glow ), 'the lamps\' glass is a glow part (lit at night), the bench is not' );
ok( pieces && Object.values( pieces ).flat().every( ( p ) => p.normal && p.index && p.position.length > 0 ), 'normals and indices on every primitive' );
ok( channelsOf( 'wood_dark' ).pattern === 1 && channelsOf( 'cloth_red' ).pattern === 2 && channelsOf( 'iron' ).metal > 0.5 && channelsOf( 'glow_warm' ).glow, 'material names map to the prop material\'s channels' );
const kitBytes = readFileSync( join( root, 'public/models/town/kit.glb' ) ).length;
ok( kitBytes < 1.5e6, 'the GLB is small (no textures)', ( kitBytes / 1024 ).toFixed( 0 ) + ' KB' );

// ------------------------------------------------------------------------------ the shells with the village materials
section( 'Tidemark: shells, infill, ids and colliders' );
const colliders = new Colliders();
const sh = buildShells( { terrain: tile, colliders, village: standIns(), propMaterial: createPropMaterial( 'p' ) } );
const wf = buildWaterfront( { terrain: tile, add: () => {}, colliders } );
const ids = new Set( sh.list.map( ( b ) => b.id ) );
ok( BUILDINGS.every( ( b ) => ids.has( b.id ) ) && ids.has( 'hangar' ) && ids.has( 'lookout' ), 'every original shell keeps its id (12 buildings, the hangar, the lookout)' );
ok( BUILDINGS.every( ( b ) => { const s = sh.list.find( ( q ) => q.id === b.id ); return s.x === b.x && s.z === b.z && s.w === b.w && s.d === b.d && s.yaw === b.yaw; } ), 'and its footprint (position, size, yaw)' );
const tags = new Set( colliders.boxes.map( ( b ) => b.tag ).concat( colliders.cylinders.map( ( c ) => c.tag ) ) );
ok( [ 'tidemarkWarehouse', 'tidemarkChapel', 'tidemarkBelfry', 'tidemarkBoatyard', 'tidemarkHangar', 'tidemarkLookout', 'house' ].every( ( g ) => tags.has( g ) ), 'the shells\' colliders', [ ...tags ].join() );
const houseBoxes = colliders.boxes.filter( ( b ) => b.tag === 'house' );
const houses = BUILDINGS.filter( ( b ) => [ 'house', 'tavern', 'chandler' ].includes( b.kind ) ).length + FILLERS.length;
ok( houseBoxes.length === houses, 'one body collider per village house (originals + infill)', houseBoxes.length + ' of ' + houses );
ok( FILLERS.length >= 12 && FILLERS.every( ( f ) => ids.has( f.id ) ) && sh.list.filter( ( b ) => b.filler ).length === FILLERS.length, 'the infill houses are shells too (the damage states reach them)', FILLERS.length + ' infill' );

const seatsN = () => STREET.benches.length * 2;
const rectOut = ( u, v, u0, u1, v0, v1 ) => Math.hypot( Math.max( 0, u0 - u, u - u1 ), Math.max( 0, v0 - v, v - v1 ) );
const local = ( b ) => tidemarkLocal( b.x, b.z );
const segD = ( p, a, b ) => {

	const dx = b[ 0 ] - a[ 0 ], dz = b[ 1 ] - a[ 1 ], f = Math.max( 0, Math.min( 1, ( ( p[ 0 ] - a[ 0 ] ) * dx + ( p[ 1 ] - a[ 1 ] ) * dz ) / ( dx * dx + dz * dz ) ) );
	return Math.hypot( p[ 0 ] - a[ 0 ] - dx * f, p[ 1 ] - a[ 1 ] - dz * f );

};
// the distance from a point (island u, v) to a filler's footprint (its own u, v box: fillers face the bay, w along v)
const outOf = ( f, u, v ) => rectOut( u, v, f.u - f.d / 2, f.u + f.d / 2, f.v - f.w / 2, f.v + f.w / 2 );
const bad = [];
for ( const f of FILLERS ) {

	for ( const P of TIDEMARK_PATHS ) for ( let k = 1; k < P.pts.length; k ++ ) {

		// sample the path and check its distance to the footprint
		const [ a, b ] = [ P.pts[ k - 1 ], P.pts[ k ] ];
		for ( let s = 0; s <= 20; s ++ ) if ( outOf( f, a[ 0 ] + ( b[ 0 ] - a[ 0 ] ) * s / 20, a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * s / 20 ) < P.w + 1 ) { bad.push( f.id + '@' + P.id ); s = 99; k = 99; }

	}

	if ( rectOut( f.u, f.v, SQUARE.u0, SQUARE.u1, SQUARE.v0, SQUARE.v1 ) < Math.max( f.w, f.d ) / 2 + 1 ) bad.push( f.id + '@square' );
	for ( const p of townProps( tile ) ) { const [ u, v ] = tidemarkLocal( p.x, p.z ); if ( outOf( f, u, v ) < 1.5 ) bad.push( f.id + '@' + p.id ); }
	for ( const [ k, s ] of Object.entries( SPOTS ) ) { const [ u, v ] = tidemarkLocal( s.x, s.z ); if ( outOf( f, u, v ) < 3 ) bad.push( f.id + '@spot.' + k ); }
	for ( const L of [ ...STREET.lamps, ...STREET.benches, ...STREET.planters, ...STREET.netracks, STREET.fountain ] ) if ( outOf( f, L.u, L.v ) < 2 ) bad.push( f.id + '@street' );
	for ( const [ u, v ] of [ [ - 150, - 66 ], [ - 150, - 44 ], [ - 150, - 24 ], [ - 150, 38 ], [ - 150, 52 ], [ - 150, 64 ], [ - 100, 2.6 ], [ - 100, 13.4 ], [ - 88, 2.6 ], [ - 88, 13.4 ] ] ) if ( outOf( f, u, v ) < 1.5 ) bad.push( f.id + '@palm' );
	for ( const b of [ ...BUILDINGS, ...FILLERS ] ) {

		if ( b === f ) continue;
		const [ u, v ] = local( b );
		// both face the bay: an axis-aligned gap in (u, v)
		const gu = Math.abs( u - f.u ) - ( b.d + f.d ) / 2, gv = Math.abs( v - f.v ) - ( b.w + f.w ) / 2;
		if ( Math.max( gu, gv ) < 1.5 ) bad.push( f.id + '@' + b.id );

	}

}

ok( bad.length === 0, 'the infill stands clear of the paths, the square, the breakable props, the vendors\' spots, the street furniture, the street palms and the other shells', bad.join() );
const level = FILLERS.filter( ( f ) => { const hs = [ [ - 1, - 1 ], [ 1, - 1 ], [ 1, 1 ], [ - 1, 1 ] ].map( ( [ a, b ] ) => { const [ x, z ] = tidemarkWorld( f.u + a * f.d / 2, f.v + b * f.w / 2 ); return tile.heightAt( x, z ); } ); return Math.min( ...hs ) > 0.6 && Math.max( ...hs ) - Math.min( ...hs ) < 1.2; } );
ok( level.length === FILLERS.length, 'on dry ground, at most 1.2 m of slope under a footprint (stone foundations take it)', level.length + ' of ' + FILLERS.length );
ok( STREET.lamps.every( ( L ) => townProps( tile ).every( ( p ) => { const [ u, v ] = tidemarkLocal( p.x, p.z ); return Math.hypot( u - L.u, v - L.v ) > 1.5; } ) ) && STREET.benches.every( ( L ) => townProps( tile ).every( ( p ) => { const [ u, v ] = tidemarkLocal( p.x, p.z ); return Math.hypot( u - L.u, v - L.v ) > 1.5; } ) ), 'the street furniture keeps clear of the breakable props' );
const fy = ( () => { const [ x, z ] = tidemarkWorld( STREET.fountain.u, STREET.fountain.v ); return colliders.cylinders.find( ( c ) => c.tag === 'tidemarkFountain' && Math.hypot( c.x - x, c.z - z ) < 0.1 ); } )();
ok( !! fy, 'the fountain has its collider' );
ok( wf.lights.length >= 7 && wf.lights.length <= 9 && wf.seats.length === seatsN(), 'the waterfront: the pier head, the tavern and five street-lamp lights; its seats', wf.lights.length + ' lights' );

// ------------------------------------------------------------------------------ the destructible props still plan
section( 'the breakable props' );
{

	const { planProps } = await import( '../src/features/destruction/index.js' );
	const plan = planProps( { terrain: t, colliders, keep: [] } ).filter( ( p ) => p.site === 'town' );
	const want = townProps( tile ).map( ( p ) => p.id );
	ok( want.every( ( id ) => plan.some( ( p ) => p.id === id ) ), 'every town prop id still plans with the new colliders', plan.length + ' of ' + want.length );

}

// ------------------------------------------------------------------------------ the seats
section( 'seats' );
const seats = tidemarkSeats( tile );
const inBox = ( x, y, z ) => colliders.boxes.some( ( b ) => {

	if ( y < b.bottom || y > b.top ) return false;
	const dx = x - b.center.x, dz = z - b.center.z;
	return Math.abs( dx * b.cos - dz * b.sin ) < b.half.x && Math.abs( dx * b.sin + dz * b.cos ) < b.half.z;

} );
ok( seats.length === STREET.benches.length * 2 && seats.every( ( s ) => Number.isFinite( s.yaw ) && Math.abs( s.y - tile.heightAt( s.x, s.z ) - 0.46 ) < 0.12 && ! inBox( s.x, s.y + 0.3, s.z ) ), 'Tidemark: two places per bench, 0.46 m over the ground, out of every collider', seats.length + ' seats' );
ok( new Set( seats.map( ( s ) => s.id ) ).size === seats.length, 'seat ids are unique' );
{

	const onPave = seats.filter( ( s ) => { const [ u, v ] = tidemarkLocal( s.x, s.z ); return PAVING.some( ( [ u0, u1, v0, v1 ] ) => u >= u0 && u <= u1 && v >= v0 && v <= v1 ); } );
	ok( onPave.length === seats.length, 'the benches stand on the cobbles' );

}

// ------------------------------------------------------------------------------ the kit in the town, LOD, budgets
section( 'kit, LOD and budgets' );
const anchor = sh.meshes.find( ( m ) => m.name === 'tidemark_paving' );
const kitRes = await sh.kit.ready;
ok( kitRes && kitRes.missing.length === 0 && kitRes.meshes.length === 2 && kitRes.meshes.every( ( m ) => m.parent === anchor ), 'the kit merges into one prop mesh and one glow mesh under the paving', kitRes ? kitRes.meshes.map( ( m ) => m.name ).join() + ' missing: ' + kitRes.missing.join() : 'none' );
const counts = {};
for ( const p of sh.kit.placements ) counts[ p.piece ] = ( counts[ p.piece ] || 0 ) + 1;
ok( [ 'sign_tavern', 'sign_chandler', 'sign_fishhall', 'sign_harbour' ].every( ( k ) => counts[ k ] === 1 ) && counts.lamp_street === STREET.lamps.length && counts.bench === STREET.benches.length && counts.fountain === 1 && ( counts.flowerbox_a || 0 ) + ( counts.flowerbox_b || 0 ) >= 6, 'the name boards (tavern, chandlery, fish hall, harbourmaster), lamps, benches, the fountain, window boxes', JSON.stringify( counts ) );
const near = sh.stats.near + sh.stats.paving + ( kitRes ? kitRes.triangles : 0 );
ok( near <= 120000, 'Tidemark near: <= 120k triangles (houses, landmarks, paving, kit)', JSON.stringify( { shells: sh.stats.near, paving: sh.stats.paving, kit: kitRes && kitRes.triangles } ) );
ok( sh.stats.far <= 25000 && sh.stats.far > 500, 'Tidemark far: <= 25k triangles (the blocks merged)', sh.stats.far + ' triangles' );
const cam = ( x, z ) => { FrameUniforms.fields.cameraPos.value = new Vector3( x, 5, z ); };
const lodMeshes = sh.meshes.filter( ( m ) => m.userData && m.userData.lod );
const show = ( x, z ) => { cam( x, z ); for ( const m of lodMeshes ) { m.visible = true; m.onBeforeRender(); } return lodMeshes.filter( ( m ) => m.visible ).map( ( m ) => m.name ); };
const B0 = sh.blocks.find( ( b ) => b.id === 'south' ), B1 = sh.blocks.find( ( b ) => b.id === 'north' );
{

	const inTown = show( B0.x, B0.z );
	ok( inTown.every( ( n ) => ! n.startsWith( 'TidemarkFar' ) ) && inTown.length === lodMeshes.length - 2, 'in town (desktop): every block\'s near meshes, no far mesh', inTown.length + ' near' );
	const off = show( B0.x + 600, B0.z );
	ok( off.length === 2 && off.every( ( n ) => n.startsWith( 'TidemarkFar' ) ), 'from 600 m out: the two far meshes only', off.join() );
	ok( sh.blocks.length === 2 && Math.hypot( B0.x - B1.x, B0.z - B1.z ) > 40, 'two blocks, south and north of the market street', sh.blocks.map( ( b ) => b.id + ' ' + b.ids.length ).join( ', ' ) );

}

{

	globalThis.__phoneBudget = { propTexture: 256 };
	const sp = buildShells( { terrain: tile, colliders: new Colliders(), village: standIns(), propMaterial: createPropMaterial( 'p' ) } );
	delete globalThis.__phoneBudget;
	const lm = sp.meshes.filter( ( m ) => m.userData && m.userData.lod );
	cam( sp.blocks[ 0 ].x + 80, sp.blocks[ 0 ].z );
	for ( const m of lm ) { m.visible = true; m.onBeforeRender(); }
	const b0 = sp.blocks[ 0 ].id;
	const farB0 = lm.find( ( m ) => m.name === 'TidemarkFar_' + b0 );
	const nearB0 = lm.filter( ( m ) => m.userData.lod.near && Math.hypot( m.userData.lod.x - sp.blocks[ 0 ].x, m.userData.lod.z - sp.blocks[ 0 ].z ) < 1 );
	ok( farB0.visible && nearB0.every( ( m ) => ! m.visible ) && LOD.phone === 60, 'phones: 80 m from a block its far mesh draws, not its near ones (switch at 60 m)' );

}

ok( sh.meshes.every( ( m ) => ! m.material || ! m.material.textures || Object.keys( m.material.textures ).every( ( k ) => ! /town|kit/i.test( k ) ) ), 'no new textures: the kit is vertex colours, the cobbles reuse the village stone set' );

// ------------------------------------------------------------------------------ Blackwater and the home village
section( 'Blackwater and the home village' );
{

	const { ensureBlackwater } = await import( '../src/world/islands/BlackwaterTerrain.js' );
	const { Blackwater, BLACKWATER_SHACKS, blackwaterSeats } = await import( '../src/world/islands/Blackwater.js' );
	const { strongholdLayout } = await import( '../src/world/islands/stronghold/Layout.js' );
	ensureBlackwater( t );
	const bc = new Colliders();
	const scene = { children: [], add( o ) { this.children.push( o ); } };
	const isle = new Blackwater( { scene, terrain: t, colliders: bc } );
	const L = strongholdLayout();
	const bt = new Set( bc.boxes.map( ( b ) => b.tag ) );
	ok( [ 'bwTavern', 'bwMarket', 'bwHut', 'bwShack', 'bwBlockhouse', 'bwTower' ].every( ( g ) => bt.has( g ) ) && bc.boxes.filter( ( b ) => b.tag === 'bwHut' ).length === 5 && bc.boxes.filter( ( b ) => b.tag === 'bwShack' ).length === BLACKWATER_SHACKS.length, 'the den keeps its colliders (tavern, market, store + four huts) and adds the stilt shacks', BLACKWATER_SHACKS.length + ' shacks' );
	const crowd = BLACKWATER_SHACKS.filter( ( s ) => L.town.some( ( b ) => Math.hypot( b.x - s.x, b.z - s.z ) < 7 ) || L.docks.some( ( d ) => segD( [ s.x, s.z ], [ d.start.x, d.start.z ], [ d.end.x, d.end.z ] ) < 5 ) || segD( [ s.x, s.z ], ...L.routes.town.slice( 0, 2 ) ) < 3 );
	ok( crowd.length === 0 && BLACKWATER_SHACKS.every( ( s ) => { const h = t.heightAt( s.x, s.z ); return h > 0.6 && h < 9; } ), 'the shacks stand on the beach band, clear of the old buildings and the docks', crowd.map( ( s ) => s.id ).join() );
	const kr = await isle.kit.ready;
	ok( kr && kr.missing.length === 0 && isle.kit.count( 'sign_rumhole' ) === 1 && isle.kit.count( 'sign_blackmarket' ) === 1 && isle.kit.count( 'skull_pole' ) >= 2, 'the Rum Hole and black market boards, skull poles, rum barrels (the kit)', kr ? kr.triangles + ' kit triangles' : 'no kit' );
	const bs = blackwaterSeats( t );
	ok( isle.seats.length === bs.length && bs.length >= 8 && bs.every( ( q ) => Number.isFinite( q.x + q.y + q.z + q.yaw ) && q.y > t.heightAt( q.x, q.z ) + 0.3 ), 'Blackwater seats: the Rum Hole bench and the fire logs', bs.length + ' seats' );
	ok( isle.lights.length <= 8, 'Blackwater lights within budget (the fire pit added)', isle.lights.length + ' lights' );

}

{

	const { villageSeats, VILLAGE_BENCHES } = await import( '../src/world/Village.js' );
	const vs = villageSeats( t );
	ok( vs.length === VILLAGE_BENCHES.length * 2 && vs.every( ( q ) => Math.abs( q.y - t.heightAt( q.x, q.z ) - 0.46 ) < 0.3 ), 'the home village seats (its plaza benches)', vs.length + ' seats' );

}

console.warn = warn;
console.log( `\n${ n - fails } passed, ${ fails } failed` );
process.exit( fails ? 1 : 0 );

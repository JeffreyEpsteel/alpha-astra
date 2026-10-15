// Plain-node test of the wave 20A pass (docs/PERF.md "Wave 20A"): the budgets per tier (the phone keys: near release, simple
// kit plants, the stalls' prop textures), the near-mesh release / rebuild round trip (TownKit NearRelease: buffers given back
// beyond 1.5 km, the same arrays re-uploaded from 1.3 km over several frames, the colliders untouched; Blackwater's own),
// the kit's simplified plants, the NavGrid's connected pieces (an unreachable goal answered without a search, the same answers
// as A*), the interiors' one load a frame, the new "wave19" CPU scenario (deterministic: the navy, the crew aboard, a front,
// an interior, townlife's evening), and the phone memory of the last headless run when there is one
// (tools/perf/out/perf-phone-w20.json: every view <= 387 MB). No GPU, no DOM.
//   node test/perf-w20.mjs
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join( dirname( fileURLToPath( import.meta.url ) ), '..' );
globalThis.__quietKit = true;
const { TIERS, MOBILE, PHONE_BUDGET, mobileTier } = await import( '../src/core/Quality.js' );
const { NearRelease, NEAR_RELEASE, rewrapGeometry, geometryBytes, simplePlants, parseKit, TownKit, PLANT_PIECES } = await import( '../src/world/village/TownKit.js' );
const { Group, Mesh, BufferGeometry, BufferAttribute, Matrix4 } = await import( '../src/engine/index.js' );
const { createPropMaterial } = await import( '../src/game/GameMaterials.js' );
const { parseGLB } = await import( '../src/engine/loaders/GLTF.js' );
const { NavGrid } = await import( '../src/features/townlife/NavGrid.js' );
const { EYE_PART } = await import( '../src/features/townlife/index.js' );
const { LOAD } = await import( '../src/world/interiors/Interiors.js' );
const { SCENARIOS, VIEW_SET, validateScenario } = await import( '../tools/perf/scenarios.js' );

let fails = 0, passes = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else { passes ++; console.log( 'ok  ', msg ); }

};
const section = ( s ) => console.log( '\n== ' + s );

// ================================================================================================ 1. budgets per tier
section( '1. the budgets per tier' );
{

	ok( [ 'low', 'medium', 'high', 'ultra' ].every( ( t ) => TIERS[ t ] && Number.isFinite( TIERS[ t ].townBodies ) && TIERS[ t ].draw > 0 ), 'four tiers, each with its townsfolk bodies and draw scale' );
	const phone = mobileTier( TIERS.low, MOBILE.phone );
	ok( phone.townBodies === 8 && phone.ships === 6 && phone.shadowSize === 512, `a phone at Low: 8 bodies, 6 ships awake, 512 px cascades (${ phone.townBodies } / ${ phone.ships } / ${ phone.shadowSize })` );
	ok( PHONE_BUDGET.nearRelease === true && PHONE_BUDGET.kitPlants === 'simple' && PHONE_BUDGET.stallTexture === 128 && PHONE_BUDGET.stallTexture < PHONE_BUDGET.propTexture, 'the phone budget: near release on, simple kit plants, stall props at 128 px (under propTexture)' );
	ok( NEAR_RELEASE.release > NEAR_RELEASE.rebuild && NEAR_RELEASE.rebuild > 1200 && NEAR_RELEASE.snap < NEAR_RELEASE.rebuild, `release ${ NEAR_RELEASE.release } m > rebuild ${ NEAR_RELEASE.rebuild } m > the towns' 1,200 m show distance; a closer arrival snaps` );
	ok( LOAD.perFrame === 1, 'the interiors start one room loading a frame' );

}

// ================================================================================================ 2. near release round trip
section( '2. the near meshes: released far, rebuilt on approach' );
{

	const mat = createPropMaterial( 'perf-w20' );
	const geo = ( n ) => {

		const g = new BufferGeometry();
		g.setAttribute( 'position', new BufferAttribute( new Float32Array( n * 3 ).map( ( _, i ) => i % 7 ), 3 ) );
		g.setAttribute( 'normal', new BufferAttribute( new Float32Array( n * 3 ), 3 ) );
		g.setIndex( new BufferAttribute( new Uint32Array( n ).map( ( _, i ) => i ), 1 ) );
		g.computeBoundingSphere();
		return g;

	};
	// three meshes, one with a child (the kit under the paving), one left out (the far terrain)
	const town = new Mesh( geo( 30000 ), mat ), kit = new Mesh( geo( 20000 ), mat ), props = new Mesh( geo( 40000 ), mat ), far = new Mesh( geo( 1000 ), mat );
	town.add( kit );
	const before = [ town, kit, props ].map( ( m ) => m.geometry ), arrays = before.map( ( g ) => g.attributes.position.array );
	let disposed = 0;
	for ( const g of before ) g.addEventListener( 'dispose', () => disposed ++ );
	const uploads = [];
	const renderer = {
		_cachedLayout: ( o, g ) => ( { buffers: [ { packed: true, key: 'p' } ] } ),
		_packedBuffer: ( g ) => uploads.push( g ),
		_attributeBuffer: () => {},
		_indexBuffer: () => {},
	};
	const perFrame = geometryBytes( before[ 2 ] ); // (one big mesh a frame)
	const rel = new NearRelease( { roots: [ town, props ], enabled: true, renderer, perFrame } );
	ok( rel.update( 800 ) === 'live' && disposed === 0, 'near: live, nothing freed' );
	ok( rel.update( 1600 ) === 'released' && disposed === 3 && ! town.visible && ! props.visible && far.geometry.attributes.position, `beyond ${ NEAR_RELEASE.release } m: three geometries' buffers freed (${ ( rel.stats.freed / 1048576 ).toFixed( 2 ) } MB), the roots hidden, the far mesh untouched` );
	ok( [ town, kit, props ].every( ( m, i ) => m.geometry !== before[ i ] && m.geometry.attributes.position.array === arrays[ i ] && m.geometry.index.array === before[ i ].index.array ), 'each mesh keeps its arrays under a new geometry (no copy; the renderer meets no stale cache entry)' );
	ok( [ town, kit, props ].every( ( m, i ) => m.geometry.boundingSphere && m.geometry.boundingSphere.radius === before[ i ].boundingSphere.radius ), 'the bounds come along' );
	town.visible = props.visible = true; // (the island sets its own visibility every frame)
	ok( rel.update( 1400 ) === 'released' && ! town.visible && uploads.length === 0, 'between the two distances it stays released (hidden, no upload)' );
	town.visible = props.visible = true;
	const s1 = rel.update( 1250 );
	ok( s1 === 'rebuilding' && uploads.length >= 1 && uploads.length < 3 && ! town.visible, `inside ${ NEAR_RELEASE.rebuild } m the rebuild starts: ${ uploads.length } upload(s) the first frame, still hidden` );
	let frames = 1;
	while ( rel.state !== 'live' && frames < 10 ) { town.visible = props.visible = true; rel.update( 1240 ); frames ++; }
	ok( rel.state === 'live' && uploads.length === 3 && frames >= 2 && town.visible, `spread over ${ frames } frames, every mesh uploaded once, then shown` );
	ok( uploads.every( ( g ) => [ town, kit, props ].some( ( m ) => m.geometry === g ) ), 'the uploads are the live geometries' );
	// turned away mid-rebuild, a teleport into the town
	rel.update( 1700 );
	town.visible = props.visible = true;
	rel.update( 1250 );
	ok( rel.update( 1600 ) === 'released', 'turning away during a rebuild releases again' );
	uploads.length = 0;
	town.visible = props.visible = true;
	ok( rel.update( 300 ) === 'live' && uploads.length === 3, `arriving at ${ 300 } m (a teleport): everything uploaded the same frame` );
	const off = new NearRelease( { roots: [ props ], enabled: false, renderer } );
	ok( off.update( 5000 ) === 'live', 'off a phone (enabled false): never released' );
	ok( rewrapGeometry( before[ 0 ] ).attributes.position !== before[ 0 ].attributes.position, 'rewrapGeometry makes new attribute objects' );

	// Blackwater with the phone budget: its props and near land go, its colliders stay
	globalThis.__phoneBudget = { nearRelease: true };
	console.warn = () => {};
	const { TerrainData } = await import( '../src/world/TerrainData.js' );
	const { ensureBlackwater } = await import( '../src/world/islands/BlackwaterTerrain.js' );
	const { Colliders } = await import( '../src/world/Colliders.js' );
	const { Blackwater } = await import( '../src/world/islands/Blackwater.js' );
	const { FrameUniforms } = await import( '../src/engine/render/Frame.js' );
	const T = new TerrainData();
	ensureBlackwater( T );
	const colliders = new Colliders();
	const isle = new Blackwater( { scene: new Group(), terrain: T, colliders } );
	const nBoxes = colliders.boxes.length;
	const cam = FrameUniforms.fields.cameraPos.value;
	cam.set( isle.center.x + 2000, 5, isle.center.z );
	isle.update( 1 / 60 );
	ok( isle.release.state === 'released' && ! isle.land.near.visible && colliders.boxes.length === nBoxes && isle.release.stats.freed > 1e6, `Blackwater 2 km off: released (${ ( isle.release.stats.freed / 1048576 ).toFixed( 1 ) } MB of arrays), ${ nBoxes } colliders kept` );
	cam.set( isle.center.x + 1200, 5, isle.center.z );
	let n = 0;
	while ( isle.release.state !== 'live' && n < 20 ) { isle.update( 1 / 60 ); n ++; }
	ok( isle.release.state === 'live' && n >= 1, `back within 1.2 km: live again after ${ n } frame(s)` );
	cam.set( isle.center.x + 100, 5, isle.center.z );
	isle.update( 1 / 60 );
	ok( isle.land.near.visible && colliders.boxes.length === nBoxes, 'close by: the near land shows, the colliders as they were' );
	delete globalThis.__phoneBudget;

}

// ================================================================================================ 3. simple kit plants
section( '3. the kit plants on phones' );
{

	const buf = readFileSync( join( root, 'public/models/town/kit.glb' ) );
	const pieces = parseKit( parseGLB( buf.buffer.slice( buf.byteOffset, buf.byteOffset + buf.byteLength ) ) );
	const verts = ( prims ) => prims.reduce( ( s, p ) => s + p.position.length / 3, 0 );
	for ( const k of PLANT_PIECES ) {

		const sp = simplePlants( pieces[ k ] );
		ok( sp && sp.keep.length >= 3 && sp.keep.filter( ( p ) => /^flower/i.test( p.name ) ).length === 1 && ! sp.keep.some( ( p ) => /^leaf/i.test( p.name ) ) && verts( sp.keep ) + 36 < verts( pieces[ k ] ) * 0.36, `${ k }: ${ verts( pieces[ k ] ) } -> ${ verts( sp.keep ) + 36 } vertices (the box / tub and one bloom colour kept, one dome for the rest)` );
		ok( sp.color[ 1 ] >= sp.color[ 0 ] * 0.9 && sp.color[ 1 ] > sp.color[ 2 ] && sp.color.every( ( c ) => c >= 0 && c <= 1 ), `${ k }: the dome: the leaves' green (${ sp.color.map( ( c ) => c.toFixed( 2 ) ).join( ', ' ) })` );

	}

	ok( simplePlants( pieces.bench ) === null, 'a piece without plants is left as it is' );
	const mat = createPropMaterial( 'perf-w20' );
	const place = ( kit ) => { for ( let i = 0; i < 6; i ++ ) kit.place( [ 'flowerbox_a', 'flowerbox_b', 'planter', 'bench' ][ i % 4 ], new Matrix4() ); };
	const full = new TownKit( { material: mat, plants: 'full' } ), simple = new TownKit( { material: mat, plants: 'simple' } );
	place( full ); place( simple );
	const a = full.build( pieces ), b = simple.build( pieces );
	ok( b.triangles < a.triangles * 0.6 && b.meshes.length === a.meshes.length, `six pieces: ${ a.triangles } -> ${ b.triangles } triangles, the same draws` );

}

// ================================================================================================ 4. NavGrid pieces
section( '4. the NavGrid: unreachable goals answered at once' );
{

	// a 60 x 60 m yard with a closed pen (a ring of posts) and a wall with one gap
	const obstacles = [];
	for ( let a = 0; a < 48; a ++ ) obstacles.push( { x: 15 + Math.cos( a / 48 * Math.PI * 2 ) * 6, z: 15 + Math.sin( a / 48 * Math.PI * 2 ) * 6, r: 0.6 } );
	for ( let z = - 30; z < 30; z += 1 ) if ( Math.abs( z - 10 ) > 2 ) obstacles.push( { x: - 10, z, r: 0.6 } );
	const g = new NavGrid( { frame: { x: 0, z: 0, yaw: 0 }, u0: - 30, u1: 30, v0: - 30, v1: 30, cell: 1 }, { ground: () => ( { y: 1, deck: false } ), obstacles } );
	while ( ! g.buildStep( 5000 ) );
	const comp = g.components();
	ok( g.componentCount >= 2, `${ g.componentCount } pieces (the pen's inside is its own)` );
	let same = 0, n = 0, rnd = 7;
	const r = () => ( ( rnd = ( Math.imul( rnd, 1664525 ) + 1013904223 ) >>> 0 ) / 4294967296 ) * 58 - 29;
	for ( let i = 0; i < 300; i ++ ) {

		const ax = r(), az = r(), bx = i % 5 === 0 ? 15 + r() / 15 : r(), bz = i % 5 === 0 ? 15 + r() / 15 : r();
		const s = g.nearestFreeIndex( ax, az, 8 ), t = g.nearestFreeIndex( bx, bz, 8 );
		if ( s < 0 || t < 0 ) continue;
		n ++;
		const viaAstar = !! g._astar( s, t ), viaRoute = !! g.route( ax, az, bx, bz );
		if ( viaAstar === viaRoute && viaAstar === ( comp[ s ] === comp[ t ] ) ) same ++;

	}

	ok( n > 200 && same === n, `${ same } / ${ n } random pairs: route() answers as A* does, and A* finds a way exactly when both are in one piece` );
	const e0 = g.expansions;
	ok( g.route( - 25, 0, 15, 15 ) === null && g.expansions === e0 && g.unreachable > 0, 'into the closed pen: null with no search (expansions unchanged)' );

}

// ================================================================================================ 5. townsfolk eyes
section( '5. the townsfolk\'s eye parts cast no shadow' );
ok( [ 'skinned:Pepe_Pupil_l', 'skinned:Pengu_Rim_r', 'skinned:Hyptile_Lid_l' ].every( ( n ) => EYE_PART.test( n ) ) && ! [ 'skinned:Pepe_Eye_l', 'skinned:body', 'skinned:Pepe_Body' ].some( ( n ) => EYE_PART.test( n ) ), 'pupils, rims and lids match; the eyeballs and bodies keep their shadows' );

// ================================================================================================ 6. scenarios
section( '6. the wave19 CPU scenario and the tavern view' );
{

	const s = SCENARIOS.tidemarkTavern;
	ok( s && VIEW_SET.includes( 'tidemarkTavern' ) && validateScenario( s ).length === 0 && s.place.interior === 'tidemark.tavern', 'tidemarkTavern: a view inside the Tide & Tankard (place.interior)' );
	ok( validateScenario( { ...s, place: { ...s.place, kind: 'helm', boat: 'launch' } } ).some( ( p ) => /interior/.test( p ) ), 'an interior place must be on foot' );
	const runIt = () => {

		const r = spawnSync( process.execPath, [ join( root, 'tools/perf/cpu-scenarios.mjs' ), '--scenario=wave19', '--frames=400', '--repeat=1', '--no-alloc' ], { encoding: 'utf8', cwd: root } );
		const m = /== wave19: .*?(\{.*\}), heap/.exec( r.stdout || '' );
		return m ? JSON.parse( m[ 1 ] ) : { error: ( r.stderr || '' ).slice( - 400 ) };

	};
	const a = runIt(), b = runIt();
	ok( a.fingerprint && a.fingerprint === b.fingerprint, `deterministic: fingerprint ${ a.fingerprint } twice${ a.error ? ' ' + a.error : '' }` );
	ok( a.navy === 3 && a.crew === 4 && a.front !== null && a.townsfolk > 40 && a.bodies > 0, `in it: ${ a.navy } navy ships, ${ a.crew } hands aboard, front ${ a.front }, ${ a.townsfolk } townsfolk (${ a.bodies } bodies)` );
	ok( a.expansions < 2e6, `townlife's evening searches stay small: ${ a.expansions } A* expansions in 400 frames (${ a.unreachable } goals answered unreachable at once)` );

}

// ================================================================================================ 7. phone memory
section( '7. the phone memory of the last headless run' );
{

	const f = join( root, 'tools/perf/out/perf-phone-w20.json' );
	if ( ! existsSync( f ) ) ok( true, 'no tools/perf/out/perf-phone-w20.json (run headless.mjs --perf=views --mobile --real-sizes): skipped' );
	else {

		const r = JSON.parse( readFileSync( f, 'utf8' ) );
		const views = Object.entries( r.scenarios || {} ).map( ( [ id, s ] ) => [ id, s.memory ? s.memory.total : NaN ] );
		ok( views.length >= 5 && views.every( ( [ , mb ] ) => mb <= 387 ), 'every view <= 387 MB: ' + views.map( ( [ id, mb ] ) => `${ id } ${ mb }` ).join( ', ' ) );

	}

}

console.log( `\n${ fails ? fails + ' FAILED, ' : '' }${ passes } passed` );
process.exit( fails ? 1 : 0 );

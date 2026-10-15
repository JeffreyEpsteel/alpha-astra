// Test of the dressing feature ( src/features/dressing ): the converted marine / harbour GLBs, the placements against the real
// heightmap and colliders ( kelp, palms, rocks, harbour clusters, bunting posts ), the dolphin pod simulation, the registry
// integration, and headless renders of the dolphins, a kelp bed, the pier and Pons Cove ( test/out/dressing-*.png ).
//   node test/feature-dressing.mjs              everything
//   node test/feature-dressing.mjs --no-render  logic only ( still needs the headless WebGPU for the Village )
import './headless.mjs';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { Features } from '../src/features/Features.js';
import * as dressingModule from '../src/features/dressing/index.js';
import { kelpSites, palmSites, rockSites, ponsKeepOut, dockDistance, dockFrame, dockLength } from '../src/features/dressing/Sites.js';
import { planHome, planPons, planHarbour, makeProbe, boardwalkSamples, MODELS } from '../src/features/dressing/Harbour.js';
import { DolphinPods, swell } from '../src/features/dressing/Marine.js';
import { harbourKeepOut, schoolSites } from '../src/features/dressing/Dressing.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { Colliders } from '../src/world/Colliders.js';
import { Village } from '../src/world/Village.js';
import { PonsCove, PONS_HUTS } from '../src/world/PonsCove.js';
import { WORLD } from '../src/world/WorldLayout.js';
import { PONS_STACKS, PONS, ponsWorld } from '../src/world/terrain/IslandShape.js';
import { STALL_SITES } from '../src/features/trade/stall.js';
import { BOARD_SITES } from '../src/features/notices/Sites.js';
import { PONS_STAND } from '../src/game/PonsPort.js';
import { STAND } from '../src/game/FishStand.js';
import { parseGLB } from '../src/engine/loaders/GLTF.js';
import { Vector3 } from '../src/engine/index.js';

const NO_RENDER = process.argv.includes( '--no-render' );
const root = new URL( '../', import.meta.url );
let fails = 0, passes = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else { passes ++; console.log( 'ok  ', msg ); }

};
const section = ( s ) => console.log( '\n== ' + s );
const P = WORLD.pier, D = WORLD.pons.dock;

// the GLBs are read from public/ ( the page fetches them from the dev server )
globalThis.__assetFile = async ( url ) => {

	const b = readFileSync( new URL( 'public/' + url.replace( /^\//, '' ), root ) );
	return b.buffer.slice( b.byteOffset, b.byteOffset + b.byteLength );

};

// the GPU ( the Village builds buffers ); the render section uses the same device
const { setupLife } = await import( './life-harness.mjs' );
const L = await setupLife( { W: 1600, H: 760, shadowSplits: [ 10, 60, 300 ], far: 4000 } );
const T = L.terrain;
const colliders = new Colliders();
const village = new Village( { scene: L.scene, terrain: T, colliders } );
const cove = new PonsCove( { scene: L.scene, terrain: T, colliders } );
// the village bakes its texture sets on the first frame ( the app does it in the loading screen ): do it outside any render pass
L.GPU.beginFrame();
village.textures.bake();
L.GPU.submit();
await L.GPU.queue.onSubmittedWorkDone();

// ================================================================================================ 1. assets
section( '1. converted models' );
const glbInfo = ( rel ) => {

	const b = readFileSync( new URL( 'public/models/' + rel, root ) );
	const g = parseGLB( b.buffer.slice( b.byteOffset, b.byteOffset + b.byteLength ) );
	const lo = [ 1e9, 1e9, 1e9 ], hi = [ - 1e9, - 1e9, - 1e9 ];
	let tris = 0;
	for ( const m of g.meshes ) for ( const p of m ) {

		const a = p.attributes.POSITION.array;
		for ( let i = 0; i < a.length; i += 3 ) for ( let c = 0; c < 3; c ++ ) { lo[ c ] = Math.min( lo[ c ], a[ i + c ] ); hi[ c ] = Math.max( hi[ c ], a[ i + c ] ); }
		tris += p.indices ? p.indices.length / 3 : a.length / 9;

	}

	return { lo, hi, tris, size: b.length };

};

for ( const f of [ 'Dolphin_LOD0', 'Dolphin_LOD1', 'Fish_LOD0', 'Fish_LOD1', 'KelpCluster_LOD0', 'KelpCluster_LOD1' ] ) ok( existsSync( new URL( `public/models/marine/${ f }.glb`, root ) ), `marine/${ f }.glb exists` );
for ( const m of Object.values( MODELS ) ) ok( existsSync( new URL( 'public/models/' + m.file, root ) ), `${ m.file } exists` );
{

	const d = glbInfo( 'marine/Dolphin_LOD0.glb' ), d1 = glbInfo( 'marine/Dolphin_LOD1.glb' );
	ok( Math.abs( ( d.hi[ 2 ] - d.lo[ 2 ] ) - 2.6 ) < 0.05, `dolphin is 2.6 m long along Z ( ${ ( d.hi[ 2 ] - d.lo[ 2 ] ).toFixed( 2 ) } )` );
	ok( d.hi[ 2 ] > Math.abs( d.lo[ 2 ] ), 'the dolphin\'s nose is at +Z ( the nose end sticks out further than the tail )' );
	ok( d.hi[ 1 ] > 0.5 && d.lo[ 1 ] > - 0.4, 'the dolphin is upright ( dorsal fin up, +Y )' );
	ok( d1.tris < d.tris * 0.6, `dolphin LOD1 ${ d1.tris } < LOD0 ${ d.tris } triangles` );
	const k = glbInfo( 'marine/KelpCluster_LOD0.glb' );
	ok( Math.abs( k.hi[ 1 ] - 1.68 ) < 0.05 && k.lo[ 1 ] > - 0.05, `kelp cluster is 1.68 m tall from y = 0 ( ${ k.hi[ 1 ].toFixed( 2 ) } )` );
	const f = glbInfo( 'marine/Fish_LOD0.glb' );
	ok( f.hi[ 2 ] - f.lo[ 2 ] > 0.6 && f.hi[ 2 ] - f.lo[ 2 ] < 0.7, 'fish is 0.66 m long' );
	const n = glbInfo( 'harbour/hanging-net.glb' );
	ok( n.tris < 9000, `hanging net decimated to ${ n.tris } triangles ( from 24144 )` );

}

// ================================================================================================ 2. kelp
section( '2. kelp sites against the real seabed' );
const kelp = kelpSites( T );
ok( kelp.length > 300, `${ kelp.length } kelp clusters` );
ok( kelp.filter( ( k ) => k.area === 'reef' ).length > 80 && kelp.filter( ( k ) => k.area === 'pons' ).length > 150, `around the reef ${ kelp.filter( ( k ) => k.area === 'reef' ).length } and Pons ${ kelp.filter( ( k ) => k.area === 'pons' ).length }` );
ok( kelp.every( ( k ) => Math.abs( T.heightAt( k.x, k.z ) - ( k.y + 0.04 ) ) < 1e-6 ), 'every cluster stands on the seabed' );
ok( kelp.every( ( k ) => k.depth >= 2.4 && k.depth <= 8.5 ), 'all in 2.4 - 8.5 m of water' );
ok( kelp.every( ( k ) => k.y + 1.68 * k.s <= - 0.85 ), 'the tallest frond tip stays at least 0.85 m under the still sea level' );
ok( kelp.every( ( k ) => T.coastDistance( k.x, k.z ).d > 0 ), 'every site is in the water ( coast distance > 0 )' );
ok( kelp.every( ( k ) => ! ( Math.abs( k.x - P.x ) < 16 && k.z > P.zStart - 10 && k.z < P.zEnd + 24 ) ), 'none under the pier or its approach' );
ok( kelp.every( ( k ) => Math.hypot( k.x - WORLD.boatDock.position.x, k.z - WORLD.boatDock.position.z ) > 38 ), 'none at the home berth' );
ok( kelp.every( ( k ) => k.area !== 'pons' || ( dockDistance( k.x, k.z ) > 16 && Math.hypot( k.x - D.position.x, k.z - D.position.z ) > 46 ) ), 'none near Pons\'s dock or its mooring pocket' );
ok( kelp.every( ( k ) => PONS_STACKS.every( ( [ sx, sz, sr ] ) => Math.hypot( k.x - sx, k.z - sz ) > sr + 7 ) ), 'none against the sea stacks' );
{

	// nearest-neighbour spacing
	let min = 1e9;
	for ( let i = 0; i < kelp.length; i ++ ) for ( let j = i + 1; j < kelp.length; j ++ ) min = Math.min( min, Math.hypot( kelp[ i ].x - kelp[ j ].x, kelp[ i ].z - kelp[ j ].z ) );
	ok( min > 3.4, `clusters at least ${ min.toFixed( 1 ) } m apart` );
	const again = kelpSites( T );
	ok( again.length === kelp.length && again[ 7 ].x === kelp[ 7 ].x, 'placement is deterministic' );

}

const schools = schoolSites( T, kelp );
ok( schools.length >= 2 && schools.every( ( s ) => s.y < - 1 && T.heightAt( s.x, s.z ) < s.y - 0.8 ), `${ schools.length } baitfish schools, all below the surface and above the bottom` );

// ================================================================================================ 3. Pons palms and rocks
section( '3. Pons Cove palms and rocks' );
const keepP = ponsKeepOut();
const palms = palmSites( T, keepP ), rocks = rockSites( T, keepP );
ok( palms.length >= 15 && palms.length <= 40, `${ palms.length } palms` );
ok( rocks.length >= 20 && rocks.length <= 60, `${ rocks.length } rocks` );
ok( palms.every( ( p ) => T.coastDistance( p.x, p.z ).d < 0 && T.heightAt( p.x, p.z ) > 2.1 ), 'every palm is on dry land ( above 2.1 m )' );
ok( palms.every( ( p ) => Math.abs( p.y + 0.05 - Math.min( T.heightAt( p.x, p.z ), p.y + 0.05 ) ) < 0.5 && p.y > 1.5 ), 'palm roots sit at the ground' );
ok( rocks.every( ( r ) => T.islandAt( r.x, r.z ) === 'pons' ), 'every rock is on Pons' );
ok( rocks.filter( ( r ) => ! r.waterline ).every( ( r ) => T.heightAt( r.x, r.z ) > 0.8 ), 'inland rocks are on dry ground' );
ok( rocks.some( ( r ) => r.waterline ) && rocks.some( ( r ) => ! r.waterline ), 'both waterline and inland rocks' );
const huts = PONS_HUTS.map( ( [ u, v ] ) => ponsWorld( u, v ) );
const all = [ ...palms.map( ( p ) => ( { ...p, r: 0.6 } ) ), ...rocks.map( ( r ) => ( { ...r, r: r.size } ) ) ];
ok( all.every( ( a ) => huts.every( ( [ hx, hz ] ) => Math.hypot( a.x - hx, a.z - hz ) > 3.5 + a.r + 1 ) ), 'nothing within 4.5 m of a hut' );
ok( all.every( ( a ) => dockDistance( a.x, a.z ) > 4.5 + a.r ), 'nothing on or beside the dock' );
ok( all.every( ( a ) => Math.hypot( a.x - PONS_STAND.x, a.z - PONS_STAND.z ) > 5 + a.r && Math.hypot( a.x - STALL_SITES.pons.x, a.z - STALL_SITES.pons.z ) > 5 + a.r && Math.hypot( a.x - BOARD_SITES.pons.x, a.z - BOARD_SITES.pons.z ) > 3 + a.r ), 'nothing near the fish stall, the trade stall or the notice board' );
ok( all.every( ( a ) => T.pathDistance( a.x, a.z ) > 2.5 ), 'nothing on the footpath' );
{

	// against the real colliders ( dock deck + piles, hut boxes )
	const probe = makeProbe( T, colliders, [] );
	ok( palms.every( ( p ) => ! probe.blocked( p.x, p.z, 0.5, p.y, 4 ) ), 'no palm trunk inside a collider' );
	ok( rocks.every( ( r ) => ! probe.blocked( r.x, r.z, r.size * 0.8, Math.max( r.y, T.heightAt( r.x, r.z ) ), 1 ) ), 'no rock inside a collider' );
	let overlap = 0;
	for ( let i = 0; i < all.length; i ++ ) for ( let j = i + 1; j < all.length; j ++ ) if ( Math.hypot( all[ i ].x - all[ j ].x, all[ i ].z - all[ j ].z ) < all[ i ].r * 0.5 + all[ j ].r * 0.5 ) overlap ++;
	ok( overlap === 0, 'no two palms / rocks overlap' );

}

// ================================================================================================ 4. harbour: home
section( '4. harbour dressing on the home pier and boardwalk' );
const keepHome = harbourKeepOut( { game: { vendors: [] } }, null );
const bw = boardwalkSamples( T, village.path );
const planH = planHome( { terrain: T, colliders, keep: keepHome, boardwalk: bw } );
const countBy = ( items, id ) => items.filter( ( i ) => i.id === id ).length;
console.log( '   home items:', Object.keys( MODELS ).map( ( id ) => id + ' ' + countBy( planH.items, id ) ).join( ', ' ), `| poles ${ planH.poles.length }` );
ok( countBy( planH.items, 'net' ) === 3 && countBy( planH.items, 'rope-coil' ) >= 4 && countBy( planH.items, 'bunting' ) === 2, 'three nets, coils and two bunting lines' );
ok( planH.poles.length === 4, 'two posts per bunting line' );
ok( planH.items.filter( ( i ) => i.tag === 'mending spot' && i.id === 'rope-coil' ).length >= 2, 'at least two net-mending spots beside the boardwalk' );
ok( planH.items.every( ( i ) => [ i.x, i.y, i.z, i.yaw, i.scale ].every( Number.isFinite ) ), 'every item has finite placement' );
{

	const probe = makeProbe( T, colliders, keepHome );
	const floor = planH.items.filter( ( i ) => /coil|mending/.test( i.tag ) || ( i.id === 'bait-bowl' && /mending/.test( i.tag ) ) || ( i.id === 'shuttle' && /mending/.test( i.tag ) ) );
	// the pier's own deck level
	for ( const i of floor.filter( ( q ) => /pier/.test( q.tag ) ) ) ok( Math.abs( i.y - P.deckHeight ) < 1e-6 && Math.abs( i.x - P.x ) >= 0.6, `${ i.tag } at z ${ i.z.toFixed( 1 ) } sits on the deck, ${ Math.abs( i.x - P.x ).toFixed( 2 ) } m off the centreline` );
	for ( const i of floor.filter( ( q ) => /boardwalk coil/.test( q.tag ) ) ) {

		let dmin = 1e9;
		for ( const s of bw ) dmin = Math.min( dmin, Math.hypot( s.x - i.x, s.z - i.z ) );
		ok( dmin >= 0.5 && dmin <= 0.75 && Math.abs( probe.surface( i.x, i.z, i.y + 0.2 ) - i.y ) < 0.02, `${ i.tag } sits ${ dmin.toFixed( 2 ) } m off the boardwalk centreline, on the deck` );

	}

	for ( const i of planH.items.filter( ( q ) => /mending spot/.test( q.tag ) && q.id === 'rope-coil' ) ) {

		let dmin = 1e9;
		for ( const s of bw ) dmin = Math.min( dmin, Math.hypot( s.x - i.x, s.z - i.z ) );
		ok( dmin > 2 && T.pathDistance( i.x, i.z ) > 1.4 && T.heightAt( i.x, i.z ) > 1.9, `mending spot ${ dmin.toFixed( 1 ) } m beside the boardwalk, on dry sand, off the footpath` );

	}

	// nothing inside a collider, nothing in the keep-out circles
	for ( const i of planH.items.filter( ( q ) => q.id === 'rope-coil' || ( q.id !== 'net' && q.id !== 'bunting' && /mending/.test( q.tag ) ) ) ) {

		ok( ! probe.blocked( i.x, i.z, MODELS[ i.id ].r, i.y, 0.2 ), `${ i.id } ( ${ i.tag } ) ${ i.x.toFixed( 1 ) },${ i.z.toFixed( 1 ) } is free of colliders and keep-out circles` );

	}

	// crate-top things sit on the crate's top
	for ( const i of planH.items.filter( ( q ) => /crate/.test( q.tag ) ) ) {

		const b = colliders.boxes.find( ( q ) => q.tag === 'crate' && Math.abs( q.center.x - i.x ) < q.half.x + 0.05 && Math.abs( q.center.z - i.z ) < q.half.z + 0.05 );
		ok( !! b && Math.abs( b.top - i.y ) < 1e-6, `${ i.id } on a crate top ( y ${ i.y.toFixed( 2 ) } )` );

	}

	// nets: outside the rail, over water, clear of the cleats
	for ( const i of planH.items.filter( ( q ) => q.id === 'net' ) ) {

		const side = Math.sign( i.x - P.x );
		ok( Math.abs( i.x - P.x ) > 1.6 && Math.abs( i.x - P.x ) < 1.9 && T.heightAt( i.x, i.z ) < i.y - 1, `net at z ${ i.z.toFixed( 1 ) } hangs ${ Math.abs( i.x - P.x ).toFixed( 2 ) } m out from the pier axis, over deep water` );
		ok( ! [ [ - 47.3, 1 ], [ - 15.4, - 1 ], [ 27.8, 1 ] ].some( ( [ cz, s ] ) => s === side && Math.abs( cz - i.z ) < 1.5 + 0.4 ), '  and clear of the cleats\' lines' );

	}

	// bunting: posts free, the line overhead
	for ( const b of planH.items.filter( ( q ) => q.id === 'bunting' ) ) {

		const lowest = b.y + 0.78 * b.scale;
		const near = planH.poles.filter( ( p ) => Math.hypot( p.x - b.x, p.z - b.z ) < 1.6 );
		ok( near.length === 2 && near.every( ( p ) => ! probe.blocked( p.x, p.z, 0.2, p.y0 + 0.1, 2.5 ) ), 'bunting posts stand free of colliders' );
		ok( near.every( ( p ) => Math.abs( b.y + 1.355 * b.scale - ( p.y1 - 0.1 ) ) < 1e-6 ), 'the line is made fast at the post tops' );
		let dmin = 1e9;
		for ( const s of bw ) dmin = Math.min( dmin, Math.hypot( s.x - b.x, s.z - b.z ) );
		ok( dmin < 0.6 && lowest - Math.max( ...near.map( ( p ) => p.y0 + 0.1 ) ) > 2.0, `the flags hang ${ ( lowest - Math.max( ...near.map( ( p ) => p.y0 + 0.1 ) ) ).toFixed( 2 ) } m above the ground, over the walkway, scale ${ b.scale.toFixed( 2 ) }` );

	}

	// nothing close to the stalls, boards and vendors
	const stalls = [ STAND, STALL_SITES.home, BOARD_SITES.home ];
	ok( planH.items.every( ( i ) => i.id === 'bunting' || stalls.every( ( s ) => Math.hypot( i.x - s.x, i.z - s.z ) > 2.4 ) ), 'no prop within 2.4 m of PoorGoat\'s stand, the trade stall or the notice board' );

}

// ================================================================================================ 5. harbour: Pons
section( '5. harbour dressing at Pons Cove' );
const planPo = planPons( { terrain: T, colliders, keep: [] } );
console.log( '   pons items:', Object.keys( MODELS ).map( ( id ) => id + ' ' + countBy( planPo.items, id ) ).join( ', ' ), `| poles ${ planPo.poles.length }` );
ok( planPo.items.every( ( i ) => [ i.x, i.y, i.z ].every( Number.isFinite ) ), 'finite placements' );
{

	const probe = makeProbe( T, colliders, [] );
	const dock = planPo.items.filter( ( i ) => /^dock (crate|coil)/.test( i.tag ) );
	ok( dock.length === 4 && dock.every( ( i ) => dockDistance( i.x, i.z ) < - 0.2 ), 'the dock items are on the deck' );
	for ( const i of dock.filter( ( q ) => q.tag === 'dock coil' ) ) {

		ok( Math.abs( i.y - D.deckHeight ) < 1e-6 && ! probe.blocked( i.x, i.z, 0.3, D.deckHeight, 0.2 ), 'a dock coil lies on the deck, clear of bollards and lantern posts' );
		const lat = Math.abs( ( i.x - D.start.x ) * Math.cos( D.heading ) - ( i.z - D.start.z ) * Math.sin( D.heading ) );
		ok( lat >= 0.5 && lat <= 0.75, `  ${ lat.toFixed( 2 ) } m off the dock centreline ( the dock is ${ D.width } m wide )` );

	}

	ok( dock.filter( ( q ) => q.tag === 'dock crate' ).every( ( q ) => Math.abs( q.y - ( D.deckHeight + 0.7 ) ) < 1e-6 ), 'bowl and shuttle on the top crate ( deck + 0.7 )' );
	const bun = planPo.items.find( ( q ) => q.id === 'bunting' );
	ok( planPo.poles.length === 2 && planPo.poles.every( ( p ) => dockDistance( p.x, p.z ) > 0.2 && dockDistance( p.x, p.z ) < 0.7 && ! probe.blocked( p.x, p.z, 0.2, p.y0 + 0.1, 2 ) ), 'two bunting posts flank the dock foot, off the deck' );
	ok( bun.y + 0.78 * bun.scale - Math.max( ...planPo.poles.map( ( p ) => p.y0 + 0.1 ) ) > 2.0, 'bunting at the dock foot clears head height' );
	ok( planPo.poles.every( ( p ) => Math.hypot( p.x - PONS_STAND.x, p.z - PONS_STAND.z ) > 3 ), 'the posts are clear of the fish stall' );
	const hutItems = planPo.items.filter( ( i ) => /^hut/.test( i.tag ) );
	ok( hutItems.length === 8, `${ hutItems.length } hut items ( a net, two bench things and a coil per hut )` );
	for ( const [ k, [ hx, hz ] ] of huts.entries() ) {

		const mine = hutItems.filter( ( i ) => Math.hypot( i.x - hx, i.z - hz ) < 4.2 );
		const net = mine.find( ( i ) => i.id === 'net' );
		// the net is on a side wall ( 1.87 m out along the hut's own x axis ), nothing in the hut box
		const ax = ( net.x - hx ) * Math.cos( D.heading ) - ( net.z - hz ) * Math.sin( D.heading );
		ok( Math.abs( Math.abs( ax ) - 1.87 ) < 1e-6, `hut ${ k }: net hangs on a side wall ( ${ ax.toFixed( 2 ) } m from the hut centre )` );
		const hutBox = colliders.boxes.find( ( b ) => b.tag === 'ponsHut' && Math.hypot( b.center.x - hx, b.center.z - hz ) < 0.5 );
		ok( !! hutBox && mine.filter( ( i ) => i.id === 'rope-coil' ).every( ( i ) => ! probe.blocked( i.x, i.z, 0.34, i.y, 0.2 ) ), `hut ${ k }: the coil beside the barrel is clear of the hut box and the ground` );
		ok( mine.filter( ( i ) => /bench/.test( i.tag ) ).every( ( i ) => Math.abs( i.y - ( hutBox.center.y - hutBox.half.y + 0.1 + 0.535 - 0.0 ) ) < 0.6 ), `hut ${ k }: bench things at bench height` );

	}

	ok( hutItems.filter( ( i ) => i.id === 'net' ).every( ( i ) => T.heightAt( i.x, i.z ) < i.y + 0.7 ), 'the nets clear the ground beside the huts' );

}

// ================================================================================================ 6. dolphins
section( '6. dolphin pods' );
const sprayCalls = [];
const spray = { emit( p, v, n, size, kind ) { sprayCalls.push( { x: p.x, y: p.y, z: p.z, n, size, kind } ); } };
const app = {
	mode: 'campaign', scene: L.scene, camera: L.camera, terrainData: T, colliders, village, spray, query: null,
	player: { mode: 'boat' }, boatCtl: { position: new Vector3( 0, 0, 0 ), velocity: new Vector3() }, game: { vendors: [], state: {} },
};
const features = new Features( app );
const dressing = features.add( 'dressing', dressingModule );
ok( dressing && dressing.update && dressing.dispose && dressing.stats, 'installs through the registry and has the instance interface' );
ok( features.get( 'dressing' ) === dressing, 'features.get( \'dressing\' )' );
L.GPU.beginFrame(); // the detail texture the palms sample is created ( and mipmapped ) on first use: outside a render pass
await dressing.build();
L.GPU.submit();
const st0 = dressing.stats();
console.log( '   stats:', JSON.stringify( st0 ) );
ok( st0.kelp && st0.fish && st0.dolphins && st0.harbour && st0.island, 'every part built' );
ok( dressing.parts.kelp.lod && dressing.parts.fish.lod && dressing.parts.dolphins.lod && dressing.parts.harbour.sets.length === 6, 'all the GLBs loaded ( kelp, fish, dolphin, six harbour models )' );

// a stretch of open water: find a start and a heading with 600 m of deep sea
let start = null, head = 0;
{

	const pods = dressing.parts.dolphins;
	search: for ( let z = 380; z <= 900; z += 40 ) for ( let x = - 700; x <= 300; x += 40 ) for ( let a = 0; a < 6.28; a += 0.785 ) {

		let good = true;
		for ( let d = 0; d <= 700 && good; d += 35 ) good = pods.openWater( x + Math.sin( a ) * d, z + Math.cos( a ) * d );
		if ( good ) { start = [ x, z ]; head = a; break search; }

	}

}

ok( !! start, `found open water for the run: from ( ${ start && start[ 0 ] }, ${ start && start[ 1 ] } ) heading ${ head.toFixed( 2 ) }` );
{

	const pods = dressing.parts.dolphins;
	const boat = app.boatCtl;
	boat.position.set( start[ 0 ], 0, start[ 1 ] );
	let t = 0, minD = 1e9, maxAir = - 1e9, minDepth = 1e9, near40 = false, podsSeen = 0, maxN = 0, maxInst = 0, bad = 0, escortFrames = 0;
	const dt = 1 / 30;
	camPos( L, boat.position );
	for ( ; t < 200; t += dt ) {

		// stationary for 50 s, then underway at 6 m/s for 100 s, then stationary
		const speed = t > 50 && t < 150 ? 6 : 0;
		boat.velocity.set( Math.sin( head ) * speed, 0, Math.cos( head ) * speed );
		boat.position.addScaledVector( boat.velocity, dt );
		L.camera.position.set( boat.position.x, 3, boat.position.z );
		dressing.update( dt );
		podsSeen = Math.max( podsSeen, pods.pods.length );
		let n = 0;
		for ( const pod of pods.pods ) for ( const m of pod.members ) {

			n ++;
			const d = Math.hypot( m.wx - boat.position.x, m.wz - boat.position.z );
			if ( d < minD ) { minD = d; globalThis.__minAt = { t: t.toFixed( 1 ), state: pod.state, speed: pod.speed.toFixed( 1 ), podD: Math.hypot( pod.x - boat.position.x, pod.z - boat.position.z ).toFixed( 1 ), boat: speed }; }
			if ( d < 40 ) near40 = true;
			maxAir = Math.max( maxAir, m.y - pod.sea );
			minDepth = Math.min( minDepth, - T.heightAt( m.wx, m.wz ) );
			if ( ! Number.isFinite( m.wx + m.wz + m.y ) ) bad ++;
			if ( pod.state === 'escort' ) escortFrames ++;

		}

		maxN = Math.max( maxN, n );
		maxInst = Math.max( maxInst, pods.counts.near + pods.counts.far );

	}

	ok( podsSeen >= 1, `a pod showed up ( up to ${ podsSeen } at once )` );
	ok( near40 && escortFrames > 300, `the pod came alongside the boat ( ${ ( escortFrames / 30 ).toFixed( 0 ) } dolphin-seconds of escort, closest ${ minD.toFixed( 1 ) } m )` );
	console.log( '   closest approach at', JSON.stringify( globalThis.__minAt ) );
	ok( minD > 6, `never closer than 6 m to the boat's centre ( ${ minD.toFixed( 1 ) } )` );
	ok( maxAir > 0.7 && maxAir < 2.4, `breaching: highest ${ maxAir.toFixed( 2 ) } m above the sea` );
	ok( minDepth > 4, `only over deep water ( shallowest ${ minDepth.toFixed( 1 ) } m )` );
	ok( maxN <= 10 && maxInst <= 10, `at most ${ maxN } dolphins, ${ maxInst } instances drawn at a time` );
	ok( bad === 0, 'positions stay finite' );
	ok( sprayCalls.length >= 6 && sprayCalls.every( ( c ) => Math.abs( c.y ) < 1.5 ), `${ sprayCalls.length } splash emissions at the surface` );
	ok( pods.counts.splashes > 3, `${ pods.counts.splashes } surface breaks` );
	// on foot: no new pod and the old ones leave
	app.player.mode = 'walk';
	for ( let i = 0; i < 30 * 600; i ++ ) dressing.update( dt );
	ok( pods.pods.length === 0 || pods.pods.every( ( p ) => p.state !== 'approach' ), 'with the player ashore pods are not called in' );

}

// ================================================================================================ 7. cost
section( '7. draw calls and triangles' );
{

	L.camera.position.set( start[ 0 ], 3, start[ 1 ] );
	for ( let i = 0; i < 5; i ++ ) dressing.update( 1 / 30 );
	const st = dressing.stats();
	const drawn = [];
	L.scene.traverse( ( o ) => { if ( o.isInstancedMesh && o.visible && o.count > 0 && /^(kelp|fish|dolphin|harbour|pons)/.test( o.name ) ) drawn.push( o.name ); } );
	ok( dressing.parts.island.stats().draws <= 6, `Pons palms + rocks: ${ dressing.parts.island.stats().draws } draws` );
	const all = [];
	L.scene.traverse( ( o ) => { if ( o.isInstancedMesh && /^(kelp|fish|dolphin|harbour|pons)/.test( o.name ) ) all.push( o ); } );
	console.log( '   instanced meshes in the scene:', all.length, '( kelp 2, fish 6, dolphin 4, harbour <= 14, poles 1, rocks 4 )' );
	ok( all.length <= 40, `${ all.length } instanced meshes in all, one draw each at most ( the rest is culled by range )` );

}

// ================================================================================================ 8. render
if ( ! NO_RENDER ) {

	section( '8. headless renders' );
	const out = new URL( 'test/out/', root );
	mkdirSync( out, { recursive: true } );
	const png = ( n ) => new URL( n, out ).pathname.replace( /^\//, '' );
	const { groundMesh } = await import( './life-harness.mjs' );
	const { G } = await import( '../src/engine/render/Frame.js' );
	const E = await import( '../src/engine/index.js' );

	// the ground around the places we look at ( after the village flattened its pads )
	for ( const [ cx, cz, size ] of [ [ 60, - 40, 260 ], [ 560, 520, 340 ], [ - 78, 58, 300 ] ] ) {

		const g = groundMesh( T, cx, cz, size, size > 300 ? 1.5 : 1 );
		g.frustumCulled = false;
		L.scene.add( g );

	}

	if ( process.env.DRESS_SKIP ) for ( const n of process.env.DRESS_SKIP.split( ',' ) ) { const g = dressing.parts[ n ] && dressing.parts[ n ].group; if ( g ) L.scene.remove( g ); else if ( n === 'village' ) L.scene.remove( village.group ); else if ( n === 'cove' ) L.scene.remove( cove.group ); else if ( n === 'palms' ) for ( const m of dressing.parts.island.palms.meshes ) dressing.parts.island.group.remove( m ); else if ( n === 'rocks' ) for ( const m of dressing.parts.island.rockMeshes ) dressing.parts.island.group.remove( m ); }
	const view = ( pos, target, fov = 55 ) => {

		L.camera.fov = fov;
		L.camera.position.set( ...pos );
		L.camera.lookAt( ...target );
		L.camera.updateMatrixWorld();

	};

	const shot = async ( name, pos, target, fov, { frames = 6, dt = 1 / 30, hook = null } = {} ) => {

		view( pos, target, fov );
		await L.run( frames, ( d, t ) => { G.time.value = t; if ( hook ) hook( d, t ); dressing.update( 0.0001 ); view( pos, target, fov ); }, dt );
		await L.save( png( name ) );

	};

	// -- dolphins: a pod frozen mid-porpoise, in front of the reef
	{

		const pods = dressing.parts.dolphins;
		pods.pods.length = 0;
		app.player.mode = 'boat';
		const bx = - 140, bz = 190;
		app.boatCtl.position.set( bx, 0, bz );
		app.boatCtl.velocity.set( 0, 0, 0 );
		const cam = [ bx, 2.2, bz ];
		const pod = pods.spawn( { x: bx, z: bz, vx: 0, vz: 0 } );
		if ( pod ) {

			pod.x = bx + 14; pod.z = bz + 24; pod.heading = - 2.3; pod.state = 'escort'; pod.life = 1e9; pod.speed = 6;
			pod.members.forEach( ( m, i ) => { m.phase = [ 0.16, 0.5, 0.05, 0.27, 0.62 ][ i ]; m.period = 3.4; } );
			pod.clock = 0;

		}

		ok( !! pod, 'a pod for the picture' );
		pods.timer = 1e9;
		await shot( 'dressing-dolphins.png', cam, [ bx + 12, 0.6, bz + 22 ], 48, { hook: () => { pod.clock = 0; pod.x = bx + 14; pod.z = bz + 24; } } );
		ok( existsSync( new URL( 'test/out/dressing-dolphins.png', root ) ), 'wrote test/out/dressing-dolphins.png' );
		// side-on, close: the pod's lead dolphin 9 m abeam
		{

			const px = bx + 14, pz = bz + 24, rx = Math.cos( pod.heading ), rz = - Math.sin( pod.heading );
			await shot( 'dressing-dolphins-close.png', [ px + rx * 10, 1.4, pz + rz * 10 ], [ px - Math.sin( pod.heading ) * 1.5, 0.5, pz - Math.cos( pod.heading ) * 1.5 ], 38, { hook: () => { pod.clock = 0; pod.x = px; pod.z = pz; } } );

		}

		pods.pods.length = 0;

	}

	// -- a kelp bed seen from the surface, with a baitfish school
	{

		const reef = kelp.filter( ( k ) => k.area === 'reef' );
		let best = reef[ 0 ], bn = 0;
		for ( const k of reef ) { let n = 0; for ( const o of reef ) if ( Math.hypot( o.x - k.x, o.z - k.z ) < 12 ) n ++; if ( n > bn ) { bn = n; best = k; } }
		console.log( '   densest reef kelp: ', bn, 'clusters within 12 m of', best.x.toFixed( 0 ), best.z.toFixed( 0 ) );
		await shot( 'dressing-kelp.png', [ best.x - 5, 3.2, best.z - 7 ], [ best.x + 2, - best.depth * 0.45, best.z + 3 ], 62, { frames: 8, dt: 0.1 } );
		ok( existsSync( new URL( 'test/out/dressing-kelp.png', root ) ), 'wrote test/out/dressing-kelp.png' );
		const sc = dressing.sites.schools[ 0 ];
		await shot( 'dressing-school.png', [ sc.x - 7, 2.6, sc.z - 7 ], [ sc.x, sc.y, sc.z ], 55, { frames: 8, dt: 0.1 } );


	}

	// -- the home pier: overviews, then a close look at each kind of cluster from the planned positions
	{

		await shot( 'dressing-pier.png', [ 62.5, 5.2, - 58 ], [ 55, 2.6, - 76 ], 62 );
		await shot( 'dressing-boardwalk.png', [ 56.5, 5.4, - 69 ], [ 47.5, 3.2, - 98 ], 58 );
		const it = ( id, tag ) => planH.items.find( ( q ) => q.id === id && ( ! tag || q.tag === tag ) );
		const near = ( q, dx, dy, dz, fov = 55, ty = 0.15 ) => [ [ q.x + dx, q.y + dy, q.z + dz ], [ q.x, q.y + ty, q.z ], fov ];
		const net = it( 'net' ), side = Math.sign( net.x - P.x );
		await shot( 'dressing-pier-net.png', ...[ [ P.x - side * 0.6, P.deckHeight + 1.55, net.z - 3.2 ], [ net.x, net.y + 1.0, net.z ], 58 ] );
		const coil = it( 'rope-coil', 'pier coil' );
		await shot( 'dressing-pier-coil.png', ...near( coil, 0.2, 1.3, - 2.0, 55, 0.1 ) );
		const mend = it( 'rope-coil', 'mending spot' );
		await shot( 'dressing-mending.png', ...near( mend, 1.0, 1.1, - 1.5, 55, 0.1 ) );
		const bowl = it( 'bait-bowl', 'crate bowl' );
		await shot( 'dressing-crate.png', ...near( bowl, 0.5, 0.75, - 0.9, 50, 0.05 ) );
		const bun = it( 'bunting' );
		await shot( 'dressing-bunting.png', [ bun.x + 4, 2.6 + bun.y, bun.z + 7 ], [ bun.x, bun.y + 1.1, bun.z ], 55 );
		ok( existsSync( new URL( 'test/out/dressing-pier.png', root ) ), 'wrote the pier pictures' );

	}

	// -- Pons Cove: the dock, the huts, palms and rocks
	{

		const [ hx, hz ] = huts[ 0 ];
		const [ fx, fz ] = dockFrame( 0, 3 );
		await shot( 'dressing-pons-dock.png', [ fx + 6, T.heightAt( fx, fz ) + 4, fz - 5 ], [ fx - 10, 1.4, fz - 10 ], 60 );
		const pit = ( id, tag ) => planPo.items.find( ( q ) => q.id === id && ( ! tag || q.tag === tag ) );
		const crate = pit( 'bait-bowl', 'dock crate' ), dcoil = pit( 'rope-coil', 'dock coil' );
		const dc = Math.cos( D.heading ), ds = Math.sin( D.heading );
		await shot( 'dressing-pons-crate.png', [ crate.x - ds * 1.8 - dc * 0.2, crate.y + 1.3, crate.z - dc * 1.8 + ds * 0.2 ], [ crate.x, crate.y + 0.05, crate.z ], 52 );
		await shot( 'dressing-pons-coil.png', [ dcoil.x - ds * 2.0, dcoil.y + 1.4, dcoil.z - dc * 2.0 ], [ dcoil.x, dcoil.y + 0.05, dcoil.z ], 52 );
		await shot( 'dressing-pons-bunting.png', [ fx + dc * 1.5 + ds * 6, T.heightAt( fx, fz ) + 2.2, fz - ds * 1.5 + dc * 6 ], [ fx, T.heightAt( fx, fz ) + 2.6, fz ], 55 );
		await shot( 'dressing-pons-hut.png', [ hx - 8, T.heightAt( hx, hz ) + 3.2, hz + 9 ], [ hx, T.heightAt( hx, hz ) + 1.3, hz ], 58 );
		const hnet = planPo.items.find( ( q ) => q.id === 'net' );
		await shot( 'dressing-pons-net.png', [ hnet.x + ( hnet.x - hx ) * 1.7, T.heightAt( hnet.x, hnet.z ) + 1.7, hnet.z + ( hnet.z - hz ) * 1.7 ], [ hnet.x, hnet.y + 1.0, hnet.z ], 55 );
		const [ ix, iz ] = ponsWorld( - 60, 70 );
		await shot( 'dressing-pons-island.png', [ ix - 70, 22, iz - 30 ], [ ix + 30, 4, iz + 40 ], 62 );
		ok( existsSync( new URL( 'test/out/dressing-pons-island.png', root ) ), 'wrote the Pons pictures' );

	}

}

dressing.dispose();
console.log( `\n${ passes } checks passed, ${ fails } failed${ NO_RENDER ? ' ( render skipped )' : '' }` );
if ( fails ) process.exit( 1 );
await L.exit();

function camPos( life, p ) {

	life.camera.position.set( p.x, 3, p.z );

}

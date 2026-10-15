// Fleet hull test: builds a FleetBoatModel for each fleet boat of the catalog (GLB + SimpleHullLines),
// checks the hull-sample displacement against the catalog mass and renders a side view of each.
//   node test/world-fleet.mjs [outDir]     -> <outDir>/<id>-side.png, <outDir>/<id>-quarter.png
// Headless: GLBs come from public/ through globalThis.__assetFile, embedded PNGs are replaced by a
// flat 2x2 texture (globalThis.__assetImage) so no OS image decoder is needed.
import './headless.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { worldHarness, done } from './world-harness.mjs';
import { Material } from '../src/engine/render/Material.js';
import { FleetBoatModel } from '../src/world/boat/FleetBoatModel.js';
import { createBoatModel, boatInfo } from '../src/world/boat/BoatFactory.js';
import { ShipBoatModel } from '../src/world/boat/ShipBoatModel.js';
import { SimpleHullLines } from '../src/world/boat/SimpleHullLines.js';
import { findMoorings, YARD } from '../src/game/BoatYard.js';
import { RHO_SEAWATER as RHO } from '../src/world/boat/HullLines.js';

const out = process.argv[ 2 ] || 'test/out/fleet';
mkdirSync( out, { recursive: true } );
const root = new URL( '../public/', import.meta.url );

globalThis.__assetFile = async ( url ) => {

	const path = new URL( url.replace( /^\//, '' ), root );
	const b = readFileSync( path );
	return b.buffer.slice( b.byteOffset, b.byteOffset + b.byteLength );

};

// optional argv[3] 'r,g,b' tints the stub texture (e.g. 255,40,40 to prove the albedo path is sampled)
const tint = ( process.argv[ 3 ] || '190,175,150' ).split( ',' ).map( Number );
const px = ( k ) => [ tint[ 0 ] * k, tint[ 1 ] * k, tint[ 2 ] * k, 255 ].map( Math.round );
globalThis.__assetImage = async () => ( { data: new Uint8Array( [ ...px( 1 ), ...px( 0.88 ), ...px( 0.88 ), ...px( 1 ) ] ), width: 2, height: 2 } );

const H = await worldHarness( { width: 1600, height: 900 } );
const { E, scene } = H;

const ground = new E.Mesh( new E.PlaneGeometry( 100, 100 ).rotateX( - Math.PI / 2 ), new Material( { name: 'ground', color: 0x8f8a78, roughness: 0.95 } ) );
ground.position.y = - 0.45;
ground.receiveShadow = true;
scene.add( ground );

let failed = 0;
const check = ( cond, msg ) => {

	if ( ! cond ) { failed ++; console.log( '  FAIL', msg ); }

};

for ( const id of [ 'skiff', 'canoe', 'cutter', 'launch' ] ) {

	const t0 = performance.now();
	const model = createBoatModel( id );
	check( model instanceof FleetBoatModel, id + ' is a FleetBoatModel' );
	check( model.lines instanceof SimpleHullLines, id + ' lines' );
	const placeholderTris = model.triangleCount;
	await model.ready;
	const d = model.dimensions, h = model.hydro;
	console.log( `== ${ id } (${ boatInfo( id ).name }) loaded in ${ ( performance.now() - t0 ).toFixed( 0 ) } ms, triangles ${ model.triangleCount } (placeholder ${ placeholderTris }), meshes ${ Object.keys( model.meshes ).join( ', ' ) }` );
	console.log( `  dimensions L ${ d.length } B ${ d.beam } draft ${ d.draft } freeboard ${ d.freeboard.toFixed( 2 ) }/${ d.freeboardBow.toFixed( 2 ) } deck ${ d.deckHeight } hullDepth ${ d.hullDepth.toFixed( 3 ) } LWL ${ d.waterlineLength.toFixed( 2 ) } BWL ${ d.waterlineBeam.toFixed( 2 ) } roof ${ d.houseRoofHeight.toFixed( 2 ) }` );

	// displacement of the hull samples at the design waterline (water at y = 0)
	let disp = 0, moment = 0;
	for ( const s of model.hullSamples ) { disp += s.area * Math.max( 0, 0 - s.position.y ); moment += s.area * Math.max( 0, - s.position.y ) * s.position.z; }
	const kg = disp * RHO;
	const ratio = kg / h.suggestedMass;
	console.log( `  hydro mass ${ h.suggestedMass } kg, samples displace ${ kg.toFixed( 0 ) } kg (${ ( ratio * 100 ).toFixed( 1 ) } %), canoeVolume ${ h.canoeVolume.toFixed( 3 ) } m3, Awp ${ h.waterplaneArea.toFixed( 2 ) } m2, draftScale ${ model.lines.draftScale.toFixed( 2 ) } (hydro draft ${ model.lines.hydroDraft.toFixed( 3 ) }), CB z ${ h.centerOfBuoyancy.z.toFixed( 3 ) } y ${ h.centerOfBuoyancy.y.toFixed( 3 ) }, samples CB z ${ ( moment / disp ).toFixed( 3 ) }, BM ${ h.metacentricRadius.toFixed( 2 ) }, samples ${ model.hullSamples.length }` );
	check( Math.abs( ratio - 1 ) < 0.25, id + ' displacement within 25 % of the mass' );
	check( Math.abs( h.canoeVolume - disp ) < 0.02 * h.canoeVolume, id + ' canoeVolume consistent with the samples' );
	check( model.colliders.length >= 8, id + ' colliders' );
	check( model.stations.length === 7 && model.contactPoints.length === 8 && model.outline.length === 7, id + ' controller tables' );
	check( model.exitPoints.length === 6 && model.bowSprayPoints.length === 8, id + ' anchor points' );
	check( ! model.meshes.placeholder && model.group.children.length === 1, id + ' placeholder removed' );
	const vol = model.createHullVolumeGeometry();
	check( vol.index && vol.index.count > 100, id + ' hull volume geometry' );
	console.log( `  hull volume ${ vol.index.count / 3 } tris, colliders ${ model.colliders.map( ( c ) => c.tag ).filter( ( v, i, a ) => a.indexOf( v ) === i ).join( '/' ) }, helmEye ${ model.helmEye.toArray().map( ( v ) => v.toFixed( 2 ) ).join( ',' ) }, exit ${ model.exitPoints[ 0 ].toArray().map( ( v ) => v.toFixed( 2 ) ).join( ',' ) }` );
	if ( id === 'launch' ) check( model.meshes.glass && model.meshes.glass.name === 'boat-glass' && model.meshes.glass.material.transparent, 'launch glass mesh' );

	// a few frames of the interface
	model.setSteering( 0.3 ); model.setThrottle( 0.5 ); model.setPropellerRPM( 600 ); model.setNavLights( true );
	for ( let i = 0; i < 5; i ++ ) model.update( 1 / 30 );

	scene.add( model.group );
	model.group.updateMatrixWorld( true );
	const L = d.length;
	await H.shot( join( out, id + '-side.png' ), { pos: [ - L * 1.7, 1.3, 0 ], target: [ 0, 0.4, 0 ], fov: 45 } );
	await H.shot( join( out, id + '-quarter.png' ), { pos: [ - L * 1.1, L * 0.55, L * 1.2 ], target: [ 0, 0.3, 0 ], fov: 45 } );
	scene.remove( model.group );
	model.dispose();

}

// the two classes keep to their own catalog kinds (ships are built by ShipBoatModel, see test/feature-ships.mjs)
let rejected = 0;
for ( const make of [ () => new FleetBoatModel( 'sloop' ), () => new ShipBoatModel( 'skiff' ), () => new FleetBoatModel( 'lobster' ) ] ) {

	try { make(); } catch ( e ) { rejected ++; }

}

check( rejected === 3, 'FleetBoatModel refuses ships and the lobster boat, ShipBoatModel refuses the small boats' );
check( createBoatModel( 'sloop' ) instanceof ShipBoatModel && createBoatModel( 'launch' ) instanceof FleetBoatModel && ! ( createBoatModel( 'launch' ) instanceof ShipBoatModel ), 'BoatFactory picks the model class by catalog kind' );
// the fleet lines are unchanged by the ship options (wlBeam 0.9, flare 1, sheerRise 0.12, shell 0.05)
{

	const l = new SimpleHullLines( { length: 4.5, beam: 1.9, draft: 0.25, deckY: 0.31, freeboard: 0.65 } );
	check( l.wlBeam === 0.9 && l.flare === 1 && l.sheerRise === 0.12 && l.shell === 0.05 && Math.abs( l.halfBreadth( 0.5, 0.3 ) - ( l.halfBeamAt( l.sheerZ( 0.5 ) ) + ( l.sheerX( 0.5 ) - l.halfBeamAt( l.sheerZ( 0.5 ) ) ) * 0.3 / l.sheerY( 0.5 ) ) ) < 1e-9, 'SimpleHullLines defaults keep the fleet shape' );

}

// mooring search with a synthetic sloping shore (deeper toward +z)
const spots = findMoorings( { heightAt: ( x, z ) => - 1 - ( z + 40 ) * 0.1 }, 4 );
console.log( 'moorings', spots.map( ( s ) => `(${ s.x }, ${ s.z }, h ${ s.h.toFixed( 1 ) })` ).join( ' ' ), 'YARD default', YARD );
check( spots.length === 4 && spots.every( ( s ) => Math.abs( s.x - 55 ) >= 12 ), 'moorings clear of the pier' );

console.log( failed ? `FAILED ${ failed } check(s)` : 'all checks passed' );
if ( failed ) process.exit( 1 );
await done();

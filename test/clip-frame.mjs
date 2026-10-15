// Roster smoke test: loads every Hyptile Island character GLB (public/models/roster/*.glb), checks
// Clip frame renderer (a variant of roster-smoke.mjs): CLIP=<name> CLIP_T=<seconds> node test/clip-frame.mjs <id> renders
// that clip at that time to test/out/roster-<id>-<clip>-<t>.png. The rig (48 joints) and the clip set are checked as in the smoke test; it plays Walk_InPlace for ten frames and
// renders one studio frame per character to test/out/roster-<id>.png with the headless engine.
// Windows-safe: embedded textures are not decoded (no sips / image codec in Node); every image
// becomes a flat mid-grey 2x2 texture, so the renders are grey. Exit code 1 on any failure.
//   node test/roster-smoke.mjs [id ...]        (default: every GLB in public/models/roster)
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, basename } from 'node:path';
import { writePNG } from './headless.mjs';
import { GPU } from '../src/engine/gpu/GPU.js';
import { RenderTarget } from '../src/engine/gpu/Texture.js';
import { readTexture } from '../src/engine/gpu/Readback.js';
import { G, setFrameCamera } from '../src/engine/render/Frame.js';
import { Material } from '../src/engine/render/Material.js';
import { MeshRenderer } from '../src/engine/render/MeshRenderer.js';
import { SunShadows } from '../src/engine/render/Shadows.js';
import { FullscreenPass } from '../src/engine/render/FullscreenPass.js';
import { SkinnedModel } from '../src/engine/render/Skinning.js';
import { parseGLB } from '../src/engine/loaders/GLTF.js';
import * as E from '../src/engine/index.js';
import { CLIPS, CHARACTER_IDS } from '../src/game/Characters.js';

const ROOT = fileURLToPath( new URL( '..', import.meta.url ) );
const ROSTER = join( ROOT, 'public', 'models', 'roster' );
const OUT_DIR = join( ROOT, 'test', 'out' );
const JOINTS = 48;
const EXPECTED_CLIPS = Object.values( CLIPS );
const WALK = CLIPS.walk; // 'Walk_InPlace'
const FRAMES = 10, DT = 1 / 30;
const W = 540, H = 720;

// every embedded image -> a flat mid-grey 2x2 RGBA texture (no image decoding in Node)
const GREY = new Uint8Array( 2 * 2 * 4 ).fill( 128 );
for ( let i = 3; i < GREY.length; i += 4 ) GREY[ i ] = 255;
globalThis.__assetImage = async () => ( { data: GREY.slice(), width: 2, height: 2 } );

const only = process.argv.slice( 2 );
const files = readdirSync( ROSTER ).filter( ( f ) => f.endsWith( '.glb' ) ).sort()
	.filter( ( f ) => only.length === 0 || only.includes( basename( f, '.glb' ) ) );
if ( files.length === 0 ) fail( 'no roster GLBs in ' + ROSTER );
const missingIds = CHARACTER_IDS.filter( ( id ) => ! files.includes( id + '.glb' ) );
if ( only.length === 0 && missingIds.length ) fail( 'Characters.js lists characters with no GLB: ' + missingIds.join( ', ' ) );

try {

	await GPU.init( { headless: true } );

} catch ( e ) {

	fail( 'headless WebGPU init failed: ' + ( e && e.stack || e ) );

}

mkdirSync( OUT_DIR, { recursive: true } );

// studio: a ground plane, a sun and a tonemap pass (as test/character-smoke.mjs)
const scene = new E.Scene();
const ground = new E.Mesh( new E.PlaneGeometry( 30, 30 ).rotateX( - Math.PI / 2 ), new Material( { name: 'ground', color: 0x7a7266, roughness: 0.9 } ) );
ground.castShadow = true;
scene.add( ground );
const camera = new E.PerspectiveCamera( 30, W / H, 0.1, 100 );
camera.position.set( 0.6, 1.2, 4.2 ); camera.lookAt( 0, 0.9, 0 );
G.sunDir.value.set( 0.45, 0.75, 0.5 ).normalize();
G.sunColor.value.setRGB( 3, 2.9, 2.7 );
G.skyIrradiance.value.setRGB( 0.3, 0.36, 0.45 );
const rt = new RenderTarget( W, H, { colors: [ 'rgba16float', 'rgba16float', 'rgba8unorm' ], depth: 'depth32float', label: 'scene' } );
const ldr = new RenderTarget( W, H, { colors: [ 'rgba8unorm' ], label: 'ldr' } );
const mr = new MeshRenderer();
const shadows = new SunShadows();
const tonemap = new FullscreenPass( { label: 'tonemap', colorFormats: [ 'rgba8unorm' ], bindings: { hdr: { texture: () => rt.texture } },
	code: `fn fragment( in: FSIn ) -> vec4f {
		let c = textureLoad( hdr, vec2i( in.pos.xy ), 0 ).rgb;
		let a = c * 0.8; let t = ( a * ( 2.51 * a + 0.03 ) ) / ( a * ( 2.43 * a + 0.59 ) + 0.14 );
		return vec4f( linearToSrgb( sat3( t ) ), 1.0 ); }` } );

const results = [];
let failures = 0;

for ( const file of files ) {

	const id = basename( file, '.glb' );
	const errors = [];
	let model = null;
	try {

		const buf = readFileSync( join( ROSTER, file ) );
		const gltf = parseGLB( buf.buffer.slice( buf.byteOffset, buf.byteOffset + buf.byteLength ) );
		model = await SkinnedModel.create( gltf );
		// mesh triangles in the file (every primitive, every mesh); mr.stats counts shadow passes too
		let meshTris = 0;
		for ( const prims of gltf.meshes ) for ( const p of prims ) meshTris += ( p.indices ? p.indices.length : p.attributes.POSITION.array.length / 3 ) / 3;
		if ( model.joints !== JOINTS ) errors.push( `joints ${ model.joints }, expected ${ JOINTS }` );
		const have = new Set( model.clipNames() );
		const missing = EXPECTED_CLIPS.filter( ( n ) => ! have.has( n ) );
		if ( missing.length ) errors.push( 'missing clips: ' + missing.join( ', ' ) );
		if ( have.has( WALK ) ) {

			model.play( process.env.CLIP || WALK, { fade: 0.01 } );
			model.update( 0 ); for ( let acc = 0, T = Number( process.env.CLIP_T || 0.3 ); acc < T; acc += 1 / 60 ) model.update( 1 / 60 );

		}

		scene.add( model.group );
		mr.stats.draws = 0; mr.stats.triangles = 0;
		GPU.beginFrame();
		setFrameCamera( camera, W, H );
		shadows.render( scene, mr, shadows.update( camera, G.sunDir.value ) );
		mr.render( scene, { camera, kind: 'main', colorViews: rt.textures.map( ( t ) => t.view() ), colorFormats: rt.formats,
			clearColors: [ [ 0.55, 0.62, 0.72, 1 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ] ], depthView: rt.depthTexture.view(), depthFormat: 'depth32float', clearDepth: 0 } );
		tonemap.render( { colorViews: [ ldr.texture ] } );
		GPU.submit();
		const stats = { ...mr.stats };
		const img = await readTexture( ldr.texture );
		const png = join( OUT_DIR, `roster-${ id }-${ process.env.CLIP || 'walk' }-${ process.env.CLIP_T || '' }.png` );
		writePNG( png, W, H, new Uint8Array( img.data ) );
		scene.remove( model.group );
		results.push( { id, joints: model.joints, clips: have.size, meshTris: Math.round( meshTris ), triangles: Math.round( stats.triangles ), draws: stats.draws, png } );

	} catch ( e ) {

		errors.push( 'exception: ' + ( e && e.stack || e ) );
		if ( model ) scene.remove( model.group );

	}

	if ( errors.length ) {

		failures ++;
		console.error( `FAIL ${ id }: ` + errors.join( '; ' ) );

	} else {

		const r = results[ results.length - 1 ];
		console.log( `ok   ${ id.padEnd( 8 ) } joints ${ r.joints }  clips ${ r.clips }  mesh triangles ${ r.meshTris }  rendered ${ r.triangles } tris / ${ r.draws } draws (shadow passes + ground)  -> ${ r.png }` );

	}

}

console.log( `${ files.length - failures } / ${ files.length } characters passed` );
await new Promise( ( r ) => setTimeout( r, 200 ) );
process.exit( failures ? 1 : 0 );

function fail( msg ) {

	console.error( 'FAIL: ' + msg );
	process.exit( 1 );

}

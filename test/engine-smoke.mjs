import { writePNG } from './headless.mjs';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { GPU } from '../src/engine/gpu/GPU.js';
import { RenderTarget } from '../src/engine/gpu/Texture.js';
import { readTexture } from '../src/engine/gpu/Readback.js';
import { FrameUniforms, G, setFrameCamera } from '../src/engine/render/Frame.js';
import { Material } from '../src/engine/render/Material.js';
import { MeshRenderer } from '../src/engine/render/MeshRenderer.js';
import { SunShadows } from '../src/engine/render/Shadows.js';
import { FullscreenPass } from '../src/engine/render/FullscreenPass.js';
import * as E from '../src/engine/index.js';

// --limits=default: the device gets the spec's default limits only (what WebKit / iOS reports), then the whole App boots
// under them (tools/perf/headless.mjs --boot --limits=default; pass --dawn=<dir> --backend=vulkan as for the perf runs)
const limitsDefault = process.argv.includes( '--limits=default' );
await GPU.init( { headless: true, limits: limitsDefault ? 'default' : null } );
if ( limitsDefault ) console.log( 'device limits: the spec defaults (maxSampledTexturesPerShaderStage ' + GPU.limits.maxSampledTexturesPerShaderStage + ', maxStorageTexturesPerShaderStage ' + GPU.limits.maxStorageTexturesPerShaderStage + ')' );
const gpuErrors = [];
GPU.onError( ( e ) => gpuErrors.push( e ) );
const W = 640, H = 360;
const scene = new E.Scene();
const ground = new E.Mesh( new E.PlaneGeometry( 60, 60 ).rotateX( - Math.PI / 2 ), new Material( { name: 'ground', color: 0x9a8a70, roughness: 0.9 } ) );
ground.castShadow = true;
const box = new E.Mesh( new E.BoxGeometry( 2, 2, 2 ), new Material( { name: 'box', color: 0xcc4422, roughness: 0.4,
	uniforms: { stripe: [ 'f32', 6 ] },
	surface: 's.albedo = mix( s.albedo, vec3f( 0.9 ), step( 0.5, fract( in.P.y * mat.stripe ) ) );' } ) );
box.position.set( 0, 1, 0 ); box.castShadow = true;
const ball = new E.Mesh( new E.SphereGeometry( 1, 48, 24 ), new Material( { name: 'ball', color: 0xdddddd, metalness: 1, roughness: 0.25 } ) );
ball.position.set( 3, 1, 1 ); ball.castShadow = true;
const inst = new E.InstancedMesh( new E.BoxGeometry( 0.4, 0.4, 0.4 ), new Material( { name: 'inst', color: 0x3377cc, vertex: 'v.worldOffset = vec3f( 0.0, 0.2 * sin( f32( v.instance ) ), 0.0 );' } ), 20 );
const m = new E.Matrix4();
for ( let i = 0; i < 20; i ++ ) inst.setMatrixAt( i, m.makeTranslation( - 6 + Math.cos( i ) * 3, 0.3, - 2 + Math.sin( i ) * 3 ) );
inst.castShadow = true;
scene.add( ground, box, ball, inst );

const camera = new E.PerspectiveCamera( 55, W / H, 0.1, 1000 );
camera.position.set( 6, 5, 9 ); camera.lookAt( 0, 0.5, 0 );
G.sunDir.value.set( 0.5, 0.7, 0.3 ).normalize();
G.sunColor.value.setRGB( 3, 2.9, 2.7 );
G.skyIrradiance.value.setRGB( 0.25, 0.32, 0.45 );

const rt = new RenderTarget( W, H, { colors: [ 'rgba16float', 'rgba16float', 'rgba8unorm' ], depth: 'depth32float', label: 'scene' } );
const mr = new MeshRenderer();
const shadows = new SunShadows();
const tonemap = new FullscreenPass( { label: 'tonemap', colorFormats: [ 'rgba8unorm' ], bindings: { hdr: { texture: () => rt.texture } },
	code: `fn fragment( in: FSIn ) -> vec4f {
		let c = textureLoad( hdr, vec2i( in.pos.xy ), 0 ).rgb;
		let a = c * 0.8; let t = ( a * ( 2.51 * a + 0.03 ) ) / ( a * ( 2.43 * a + 0.59 ) + 0.14 );
		return vec4f( linearToSrgb( sat3( t ) ), 1.0 ); }` } );
const out = new E.Vector2();
const ldr = new RenderTarget( W, H, { colors: [ 'rgba8unorm' ], label: 'ldr' } );
for ( let f = 0; f < 2; f ++ ) {
	GPU.beginFrame();
	setFrameCamera( camera, W, H );
	shadows.render( scene, mr, shadows.update( camera, G.sunDir.value ) );
	mr.render( scene, { camera, kind: 'main', colorViews: rt.textures.map( ( t ) => t.view() ), colorFormats: rt.formats,
		clearColors: [ [ 0.4, 0.55, 0.8, 1 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ] ], depthView: rt.depthTexture.view(), depthFormat: 'depth32float', clearDepth: 0 } );
	tonemap.render( { colorViews: [ ldr.texture ] } );
	GPU.submit();
}
const img = await readTexture( ldr.texture );
const OUT = process.argv.slice( 2 ).find( ( a ) => ! a.startsWith( '--' ) ) || new URL( './out/engine-smoke.png', import.meta.url ).pathname.replace( /^\/([A-Za-z]:)/, '$1' );
mkdirSync( dirname( OUT ), { recursive: true } );
writePNG( OUT, W, H, new Uint8Array( img.data ) );
console.log( 'stats', mr.stats );
await new Promise( ( r ) => setTimeout( r, 200 ) );
if ( gpuErrors.length ) {

	for ( const e of gpuErrors ) console.log( 'GPU ' + e.kind + ': ' + e.message.split( '\n' )[ 0 ] );
	console.log( 'FAIL engine smoke: GPU errors' );
	process.exit( 1 );

}

if ( limitsDefault ) {

	// the whole App under the defaults. Known over the 16 sampled textures a stage of the defaults: the water (23-24) and the
	// harbour stalls (17); they are skipped (no crash) and named on the error card. Anything else fails.
	const KNOWN = [ 'water', 'stall' ];
	const { spawnSync } = await import( 'node:child_process' );
	const { fileURLToPath } = await import( 'node:url' );
	const pass = process.argv.filter( ( a ) => /^--(dawn|backend|size|features)=/.test( a ) );
	const script = fileURLToPath( new URL( '../tools/perf/headless.mjs', import.meta.url ) );
	const r = spawnSync( process.execPath, [ script, '--boot=20', '--limits=default', '--mobile', '--size=402x874', ...pass ], { encoding: 'utf8', maxBuffer: 64 << 20 } );
	const out = ( r.stdout || '' ) + ( r.stderr || '' );
	const lines = out.split( '\n' );
	for ( const l of lines ) if ( /GPU memory|^GPU |boot |canvas |device limit/.test( l ) ) console.log( '  ' + l.slice( 0, 240 ) );
	const over = lines.filter( ( l ) => /\.g1: \d+ [a-z ]+ in the \w+ stage \(device limit/.test( l ) ).map( ( l ) => l.split( '.g1' )[ 0 ].trim() );
	const errs = lines.filter( ( l ) => /^GPU /.test( l ) );
	const attributed = ( l ) => KNOWN.some( ( k ) => l.includes( k ) ) || ( /sampled textures \(\d+\) in the Fragment stage/.test( l ) && over.every( ( g ) => KNOWN.includes( g ) ) );
	const unknown = errs.filter( ( l ) => ! attributed( l ) );
	const booted = /GPU memory after \d+ frames/.test( out );
	if ( ! booted || unknown.length ) {

		console.log( 'FAIL App boot under the default limits' + ( booted ? '' : ` (did not reach the frames: exit ${ r.status })` ) );
		for ( const l of unknown.slice( 0, 10 ) ) console.log( '  ' + l );
		if ( ! booted ) console.log( lines.slice( - 30 ).join( '\n' ) );
		process.exit( 1 );

	}

	console.log( 'ok   App boot + 20 frames under the default limits' + ( errs.length ? ` (known over the defaults, skipped: ${ [ ...new Set( over ) ].join( ', ' ) })` : '' ) );

}

process.exit( 0 );

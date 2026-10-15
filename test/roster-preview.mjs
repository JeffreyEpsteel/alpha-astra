// Roster pose preview: drives the real Avatar (src/player/Avatar.js) headlessly with a pose and renders
// contact sheets of a clip over time, from several cameras, optionally with the fishing rod in the hand.
// Textures are flat grey (no image decoding in Node), so this checks poses, transforms and geometry.
//   node test/roster-preview.mjs <out.png> key=value ...
//     char=hyptile  action=hold|reel|cast|...   mode=walk|swim|boat  speed=0  diving=0  frames=6  step=0.25
//     warm=0.5 (seconds simulated before the first frame)  cam=front|side|three|face|top|...  rod=1  rodState=idle|windup|fighting
//     then=cast at=0.7  (switch the action at that simulated time, counted from the start incl. warm)
//     pitch=0  (extra degrees of body pitch for experiments)  w=270 h=360  cols=N (wrap the sheet into rows of N frames)
//     cam=front,q,sideU  one panel per camera (side by side for one frame, else one row per camera); named cameras are in CAMS below;
//       cam=p:x;y;z>lx;ly;lz@fov  is a custom camera (position, look-at point, field of view)
//     clip=Fishing_Cast  plays that clip directly on the base layer (the avatar's own clip choice is switched off); use warm=0.001 and
//       loop=0 for one-shots, from=0.3 seeks
//     overlay=Fishing_Hold  plays that clip on the upper-body overlay, over the locomotion of mode / speed (walking with the rod:
//       action=hold speed=1.25 does it through the real Avatar)
import './headless.mjs';
import { mkdirSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writePNG } from './headless.mjs';
import { GPU } from '../src/engine/gpu/GPU.js';
import { RenderTarget } from '../src/engine/gpu/Texture.js';
import { readTexture } from '../src/engine/gpu/Readback.js';
import { G, setFrameCamera } from '../src/engine/render/Frame.js';
import { Material } from '../src/engine/render/Material.js';
import { MeshRenderer } from '../src/engine/render/MeshRenderer.js';
import { SunShadows } from '../src/engine/render/Shadows.js';
import { FullscreenPass } from '../src/engine/render/FullscreenPass.js';
import * as E from '../src/engine/index.js';
import { Avatar, UPPER_BODY } from '../src/player/Avatar.js';

const ROOT = fileURLToPath( new URL( '..', import.meta.url ) );
const args = { char: 'hyptile', action: '', mode: 'walk', speed: '0', diving: '0', frames: '6', step: '0.25', warm: '0.5', cam: 'side', rod: '0', rodState: 'idle', w: '270', h: '360', pitch: '0', clip: '' };
const out = process.argv[ 2 ];
for ( const a of process.argv.slice( 3 ) ) { const i = a.indexOf( '=' ); args[ a.slice( 0, i ) ] = a.slice( i + 1 ); }
const W = + args.w, H = + args.h, N = + args.frames, STEP = + args.step;

const GREY = new Uint8Array( 16 ).fill( 150 );
for ( let i = 3; i < 16; i += 4 ) GREY[ i ] = 255;
globalThis.__assetImage = async () => ( { data: GREY.slice(), width: 2, height: 2 } );
globalThis.__assetFile = async ( url ) => { const b = readFileSync( join( ROOT, 'public', url.replace( /^\//, '' ) ) ); return b.buffer.slice( b.byteOffset, b.byteOffset + b.byteLength ); };
await GPU.init( { headless: true } );

const scene = new E.Scene();
const ground = new E.Mesh( new E.PlaneGeometry( 30, 30 ).rotateX( - Math.PI / 2 ), new Material( { name: 'ground', color: 0x7a7266, roughness: 0.9 } ) );
scene.add( ground );
const camera = new E.PerspectiveCamera( 30, W / H, 0.05, 100 );
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

const av = new Avatar( { scene, character: args.char } );
await av.ready;
if ( args.clip || args.overlay ) {

	// direct clip playback for checking one clip: the avatar's own clip choice (and its overlay) is switched off
	const m = av.model, from = + ( args.from || 0 ), loop = args.loop !== '0';
	if ( args.clip ) m.play( args.clip, { fade: 0.01, loop, from } );
	else m.play( { idle: 'Idle_Breathe', walk: 'Walk_InPlace', run: 'Run_InPlace' }[ + args.speed > 1.8 ? 'run' : + args.speed > 0.25 ? 'walk' : 'idle' ], { fade: 0.01 } );
	if ( args.overlay ) m.setOverlay( args.overlay, { mask: UPPER_BODY, fade: 0.01, loop, from } );
	m.play = () => {};
	m.setOverlay = () => {};

}

const swim = args.mode === 'swim';
if ( swim ) scene.remove( ground );
// the character faces -Z at yaw 0: the front camera is at -Z, the side camera at +X
const feetY = swim ? 0.55 : 0; // swimming: the water line is the origin; feet y comes from Avatar
const pose = { position: new E.Vector3( 0, 0, 0 ), yaw: 0, mode: args.mode, speed: + args.speed, vy: 0, grounded: true, diving: args.diving === '1', frame: null, action: args.action || null };
const dist = swim ? 6 : 4.2;
// cameras (cam=front,side,three renders one row per camera, one column per frame). The avatar faces -Z, so +X is its right side.
const CAMS = {
	front: { pos: [ 0, 1.0, - dist ], look: [ 0, 0.9, 0 ], fov: 30 },
	side: { pos: [ dist, 1.0, 0 ], look: [ 0, 0.9, 0 ], fov: 30 },
	lside: { pos: [ - dist, 1.0, 0 ], look: [ 0, 0.9, 0 ], fov: 30 },
	back: { pos: [ 0, 1.0, dist ], look: [ 0, 0.9, 0 ], fov: 30 },
	three: { pos: [ 3.0, 1.4, - 3.0 ].map( ( x ) => x * ( swim ? 1.5 : 1 ) ), look: [ 0, 0.9, 0 ], fov: 30 },
	wide: { pos: [ 5.2, 1.5, 0 ], look: [ 0.2, 1.3, 0 ], fov: 38 },
	wide3: { pos: [ 4.0, 1.7, - 3.4 ], look: [ 0, 1.3, 0 ], fov: 38 },
	face: { pos: [ 0.35, 1.45, - 0.9 ], look: [ 0, 1.42, 0 ], fov: 20 },
	top: { pos: [ 0.01, 4.5, 0.01 ], look: [ 0, 0.9, 0 ], fov: 30 },
	hands: { pos: [ - 1.3, 1.0, - 1.5 ], look: [ 0, 0.8, - 0.3 ], fov: 22 },
	handsL: { pos: [ 1.3, 1.0, - 1.5 ], look: [ 0, 0.8, - 0.3 ], fov: 22 },
	q: { pos: [ 2.4, 1.5, - 2.4 ], look: [ - 0.15, 1.2, 0.1 ], fov: 32 },
	qL: { pos: [ - 2.4, 1.5, - 2.4 ], look: [ 0.15, 1.2, 0.1 ], fov: 32 },
	sideU: { pos: [ 3.2, 1.4, 0 ], look: [ 0, 1.25, 0 ], fov: 34 },
	arms: { pos: [ 1.6, 1.15, - 1.3 ], look: [ 0, 1.0, - 0.1 ], fov: 24 },
};
// custom camera: cam=p:x;y;z>lx;ly;lz@fov  (position, look-at, field of view; separate cameras with a space or comma-free list "cam=a,b")
const camNames = args.cam.split( ',' );
for ( const c of camNames ) {

	const m = /^p:([-\d.;]+)>([-\d.;]+)@([\d.]+)$/.exec( c );
	if ( m ) CAMS[ c ] = { pos: m[ 1 ].split( ';' ).map( Number ), look: m[ 2 ].split( ';' ).map( Number ), fov: + m[ 3 ] };

}

for ( const c of camNames ) if ( ! CAMS[ c ] ) throw new Error( 'unknown cam ' + c + ' (' + Object.keys( CAMS ).join( ', ' ) + ')' );
const setCam = ( name ) => {

	const c = CAMS[ name ];
	camera.fov = c.fov; camera.updateProjectionMatrix && camera.updateProjectionMatrix();
	camera.position.set( ...c.pos ); camera.lookAt( ...c.look );

};

let rod = null;
if ( args.rod === '1' ) {

	const { FishingRod } = await import( '../src/game/FishingRod.js' );
	const query = { allocate: () => 0, setPoint() {}, cpuValid: false, cpu: new Float32Array( 8 ) };
	rod = new FishingRod( { scene, camera, query, terrain: { heightAt: () => - 10 } } );
	scene.add( rod.rodMesh );
	rod.setEquipped && rod.setEquipped( true );
	rod.equipped = true;
	rod.setState( args.rodState );

}

const handM = new E.Matrix4();
let clock = 0;
const step = ( dt ) => {

	clock += dt;
	if ( args.then && clock >= + args.at ) pose.action = args.then;
	av.update( dt, pose );
	if ( rod ) {

		rod.anchor = av.handMatrix( handM ) ? handM : null;
		rod.update( dt, { visible: true, fight: null } );

	}

};

for ( let t = 0; t < + args.warm; t += 1 / 30 ) step( 1 / 30 );
const multi = camNames.length > 1, across = multi && N === 1; // one frame: the cameras go side by side, else one row per camera
const COLS = across ? camNames.length : Math.min( N, + ( args.cols || N ) ), ROWS = multi ? ( across ? 1 : camNames.length ) : Math.ceil( N / COLS );
const sheet = new Uint8Array( W * COLS * H * ROWS * 4 );
for ( let f = 0; f < N; f ++ ) {

	for ( let ci = 0; ci < camNames.length; ci ++ ) {

		setCam( camNames[ ci ] );
		GPU.beginFrame();
		setFrameCamera( camera, W, H );
		shadows.render( scene, mr, shadows.update( camera, G.sunDir.value ) );
		mr.render( scene, { camera, kind: 'main', colorViews: rt.textures.map( ( t ) => t.view() ), colorFormats: rt.formats,
			clearColors: [ [ 0.55, 0.62, 0.72, 1 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ] ], depthView: rt.depthTexture.view(), depthFormat: 'depth32float', clearDepth: 0 } );
		tonemap.render( { colorViews: [ ldr.texture ] } );
		GPU.submit();
		const img = new Uint8Array( ( await readTexture( ldr.texture ) ).data );
		const cx = across ? ci : multi ? f : f % COLS, cy = across ? 0 : multi ? ci : Math.floor( f / COLS );
		for ( let y = 0; y < H; y ++ ) sheet.set( img.subarray( y * W * 4, ( y + 1 ) * W * 4 ), ( ( cy * H + y ) * W * COLS + cx * W ) * 4 );

	}

	for ( let t = 0; t < STEP - 1e-6; t += 1 / 30 ) step( 1 / 30 );

}

mkdirSync( dirname( out ), { recursive: true } );
writePNG( out, W * COLS, H * ROWS, sheet );
console.log( 'wrote', out, 'clip', av.model.current, 'overlay', av.model.overlay );
process.exit( 0 );

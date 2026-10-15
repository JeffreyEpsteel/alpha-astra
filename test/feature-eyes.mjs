// Eyes (blink / gaze morph targets) and the ragdoll knockdown, on the real roster GLBs and the real Avatar.
//   node test/feature-eyes.mjs            -> checks + test/out/eyes-*.png (a blink close-up sheet, a ragdoll fall sheet)
// Headless WebGPU; textures are flat grey (no image decoding in Node), the lids and rims keep their material colour.
import './headless.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
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
import { SkinnedModel } from '../src/engine/render/Skinning.js';
import { parseGLB } from '../src/engine/loaders/GLTF.js';
import * as E from '../src/engine/index.js';
import { Avatar, EyeDriver, Ragdoll } from '../src/player/Avatar.js';
import { CLIPS, CHARACTER_IDS } from '../src/game/Characters.js';

const ROOT = fileURLToPath( new URL( '..', import.meta.url ) );
const OUT = join( ROOT, 'test', 'out' );
mkdirSync( OUT, { recursive: true } );
const GREY = new Uint8Array( 16 ).fill( 150 );
for ( let i = 3; i < 16; i += 4 ) GREY[ i ] = 255;
globalThis.__assetImage = async () => ( { data: GREY.slice(), width: 2, height: 2 } );
globalThis.__assetFile = async ( url ) => { const b = readFileSync( join( ROOT, 'public', url.replace( /^\//, '' ) ) ); return b.buffer.slice( b.byteOffset, b.byteOffset + b.byteLength ); };
await GPU.init( { headless: true } );

let failures = 0;
const check = ( ok, msg ) => { if ( ! ok ) { failures ++; console.error( 'FAIL ' + msg ); } else console.log( 'ok   ' + msg ); };
const DT = 1 / 30;
const WITH_EYES = [ 'hyptile', 'pepe', 'doge', 'bonk', 'pengu', 'clown' ];
const SIX = [ 'Blink_L', 'Blink_R', 'Gaze_Left', 'Gaze_Right', 'Gaze_Up', 'Gaze_Down' ];
const load = ( id ) => { const b = readFileSync( join( ROOT, 'public/models/roster', id + '.glb' ) ); return parseGLB( b.buffer.slice( b.byteOffset, b.byteOffset + b.byteLength ) ); };
const rng = ( seed ) => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul( seed ^ seed >>> 15, 1 | seed ); t = t + Math.imul( t ^ t >>> 7, 61 | t ) ^ t; return ( ( t ^ t >>> 14 ) >>> 0 ) / 4294967296; };

// ---- the GLBs: morph targets present on the six-key characters, none on the cousins
for ( const id of CHARACTER_IDS ) {

	const g = load( id );
	const prims = g.meshes.flat();
	const withTargets = prims.filter( ( p ) => p.targets.length );
	if ( ! WITH_EYES.includes( id ) ) {

		check( withTargets.length === 0, `${ id }: no morph targets (cousin without the eye keys)` );
		continue;

	}

	const names = new Set( withTargets.flatMap( ( p ) => p.targetNames ) );
	check( SIX.every( ( n ) => names.has( n ) ) && names.size === 6, `${ id }: morph targets ${ [ ...names ].join( ', ' ) }` );
	let lidMax = 0, pupilMax = 0;
	for ( const p of withTargets ) p.targets.forEach( ( t, k ) => {

		let mx = 0;
		for ( const x of t.POSITION ) mx = Math.max( mx, Math.abs( x ) );
		if ( p.targetNames[ k ].startsWith( 'Blink' ) ) lidMax = Math.max( lidMax, mx ); else pupilMax = Math.max( pupilMax, mx );

	} );
	check( lidMax > 0.04 && lidMax < 0.3, `${ id }: the blink targets move vertices up to ${ ( lidMax * 100 ).toFixed( 1 ) } cm` );
	check( pupilMax > 0.003 && pupilMax < 0.1, `${ id }: the gaze targets move vertices up to ${ ( pupilMax * 100 ).toFixed( 1 ) } cm` );
	// the targets are deltas: finite everywhere
	check( withTargets.every( ( p ) => p.targets.every( ( t ) => t.POSITION.every( Number.isFinite ) ) ), `${ id }: every delta finite` );
	const m = await SkinnedModel.create( g );
	check( m.morphNames.length === 6 && SIX.every( ( n ) => m.hasMorph( n ) ), `${ id }: SkinnedModel exposes ${ m.morphNames.length } morph weights` );
	m.dispose();

}

// ---- headless render harness (as roster-smoke)
const W = 320, H = 320;
const scene = new E.Scene();
const ground = new E.Mesh( new E.PlaneGeometry( 30, 30 ).rotateX( - Math.PI / 2 ), new Material( { name: 'ground', color: 0x7a7266, roughness: 0.9 } ) );
ground.castShadow = true;
scene.add( ground );
const camera = new E.PerspectiveCamera( 24, W / H, 0.05, 100 );
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
async function shot( cam ) {

	GPU.beginFrame();
	setFrameCamera( cam, W, H );
	shadows.render( scene, mr, shadows.update( cam, G.sunDir.value ) );
	mr.render( scene, { camera: cam, kind: 'main', colorViews: rt.textures.map( ( t ) => t.view() ), colorFormats: rt.formats,
		clearColors: [ [ 0.55, 0.62, 0.72, 1 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ] ], depthView: rt.depthTexture.view(), depthFormat: 'depth32float', clearDepth: 0 } );
	tonemap.render( { colorViews: [ ldr.texture ] } );
	GPU.submit();
	const img = await readTexture( ldr.texture );
	return new Uint8Array( img.data );

}

function sheet( tiles, cols, name ) {

	const rows = Math.ceil( tiles.length / cols ), out = new Uint8Array( cols * W * rows * H * 4 );
	tiles.forEach( ( t, k ) => {

		const cx = ( k % cols ) * W, cy = Math.floor( k / cols ) * H;
		for ( let y = 0; y < H; y ++ ) out.set( t.subarray( y * W * 4, ( y + 1 ) * W * 4 ), ( ( cy + y ) * cols * W + cx ) * 4 );

	} );
	writePNG( join( OUT, name ), cols * W, rows * H, out );
	console.log( 'wrote test/out/' + name );

}

// pixels that differ between two tiles inside a column range
function diff( a, b, x0, x1 ) {

	let n = 0;
	for ( let y = 0; y < H; y ++ ) for ( let x = x0; x < x1; x ++ ) {

		const i = ( y * W + x ) * 4;
		if ( Math.abs( a[ i ] - b[ i ] ) + Math.abs( a[ i + 1 ] - b[ i + 1 ] ) + Math.abs( a[ i + 2 ] - b[ i + 2 ] ) > 24 ) n ++;

	}

	return n;

}

// ---- the weights move the eyelids: face close-ups with the morph weights set directly on the SkinnedModel
const poses = [
	[ 'open', {} ], [ 'blink both', { Blink_L: 1, Blink_R: 1 } ], [ 'blink half', { Blink_L: 0.5, Blink_R: 0.5 } ], [ 'blink L (image right)', { Blink_L: 1 } ],
	[ 'blink R (image left)', { Blink_R: 1 } ], [ 'gaze left', { Gaze_Left: 1 } ], [ 'gaze right', { Gaze_Right: 1 } ], [ 'gaze up', { Gaze_Up: 1 } ],
];
for ( const id of [ 'hyptile', 'pepe', 'doge', 'bonk', 'pengu', 'clown' ] ) {

	const m = await SkinnedModel.create( load( id ) );
	m.play( CLIPS.idle, { fade: 0.01 } );
	m.update( 0 );
	scene.add( m.group );
	const head = m.nodeWorld( 'head', new E.Vector3() );
	const eyeAt = m.nodeWorld( 'eye_l', new E.Vector3() ).add( m.nodeWorld( 'eye_r', new E.Vector3() ) ).multiplyScalar( 0.5 );
	camera.position.set( eyeAt.x, eyeAt.y, eyeAt.z + 1.8 );
	camera.lookAt( eyeAt.x, eyeAt.y - 0.02, eyeAt.z );
	camera.updateMatrixWorld( true );
	const tiles = [];
	for ( const [ , w ] of poses ) {

		for ( const n of SIX ) m.setMorph( n, w[ n ] || 0 );
		m.update( 0 );
		tiles.push( await shot( camera ) );

	}

	const [ open, both, half, onlyL, onlyR, gl, gr, gu ] = tiles;
	const half_ = W / 2;
	const dBoth = diff( open, both, 0, W ), dHalf = diff( open, half, 0, W );
	check( dBoth > 150, `${ id }: both lids closed changes ${ dBoth } pixels of the face close-up` );
	check( dHalf > 50 && dHalf < dBoth, `${ id }: half closed changes less (${ dHalf } < ${ dBoth })` );
	// (the outer two fifths of the image: the lids meet at the nose, so the middle is shared)
	const lo = Math.floor( W * 0.4 ), hi = Math.ceil( W * 0.6 );
	const lr = diff( open, onlyL, hi, W ), ll = diff( open, onlyL, 0, lo ), rr = diff( open, onlyR, 0, lo ), rl = diff( open, onlyR, hi, W );
	// (50 px floor: the clown's narrow lids change 58 px of the close-up while the other side stays at 0)
	check( lr > 50 && ll < Math.max( 30, lr * 0.5 ), `${ id }: Blink_L moves the character's left eye only (image right ${ lr } px, image left ${ ll } px)` );
	check( rr > 50 && rl < Math.max( 30, rr * 0.5 ), `${ id }: Blink_R moves the right eye only (image left ${ rr } px, image right ${ rl } px)` );
	const dg = diff( open, gl, 0, W );
	check( dg > 20 && diff( gl, gr, 0, W ) > 20 && diff( open, gu, 0, W ) > 10, `${ id }: the gaze targets move the pupils (left ${ dg } px, left vs right ${ diff( gl, gr, 0, W ) } px, up ${ diff( open, gu, 0, W ) } px)` );
	if ( id === 'hyptile' || id === 'pepe' ) sheet( tiles, 4, `eyes-blink-${ id }.png` );
	if ( id === 'hyptile' || id === 'pepe' || id === 'pengu' || id === 'clown' ) {

		// a tight close-up of the character's left eye (image right) and the nose: open, half, closed, the other eye closed
		const tight = new E.PerspectiveCamera( 13, W / H, 0.05, 100 );
		const ey = m.nodeWorld( 'eye_l', new E.Vector3() );
		tight.position.set( ey.x * 0.55, ey.y + 0.03, ey.z + 1.6 );
		tight.lookAt( ey.x * 0.55, ey.y - 0.03, ey.z );
		tight.updateMatrixWorld( true );
		const close = [];
		for ( const w of [ {}, { Blink_L: 0.5, Blink_R: 0.5 }, { Blink_L: 1, Blink_R: 1 }, { Blink_R: 1, Gaze_Right: 1 } ] ) {

			for ( const n of SIX ) m.setMorph( n, w[ n ] || 0 );
			m.update( 0 );
			close.push( await shot( tight ) );

		}

		sheet( close, 4, `eyes-close-${ id }.png` );

	}

	scene.remove( m.group );
	m.dispose();

}

// ---- blink timing and gaze (the EyeDriver, seeded, a SkinnedModel stand-in that only records the weights)
{

	const w = {};
	const fake = { setMorph( n, v ) { w[ n ] = v; return true; } };
	const d = new EyeDriver( fake, rng( 7 ) );
	const starts = [], singles = [], doubles = [];
	let t = 0, lastBlinks = 0, maxL = 0, maxR = 0, bothGaze = 0, outOfRange = 0, minGaze = 0, gazeMoves = 0, prevGaze = 0, lastStart = - 1;
	for ( let f = 0; f < 30 * 600; f ++ ) {

		d.update( DT );
		t += DT;
		if ( d.blinks !== lastBlinks ) { lastBlinks = d.blinks; starts.push( t ); }
		maxL = Math.max( maxL, w.Blink_L ); maxR = Math.max( maxR, w.Blink_R );
		if ( ( w.Blink_L > 0.9 ) !== ( w.Blink_R > 0.9 ) && ( w.Blink_L > 0.9 || w.Blink_R > 0.9 ) && t - lastStart > 0.5 ) { singles.push( t ); lastStart = t; }
		if ( w.Gaze_Left > 1e-6 && w.Gaze_Right > 1e-6 || w.Gaze_Up > 1e-6 && w.Gaze_Down > 1e-6 ) bothGaze ++;
		for ( const n of SIX ) if ( ! ( w[ n ] >= 0 && w[ n ] <= 1 ) ) outOfRange ++;
		const gz = w.Gaze_Left - w.Gaze_Right;
		if ( Math.abs( gz - prevGaze ) > 0.002 ) gazeMoves ++;
		prevGaze = gz;

	}

	const gaps = starts.slice( 1 ).map( ( s, i ) => s - starts[ i ] );
	const longGaps = gaps.filter( ( g ) => g > 0.6 );
	check( starts.length > 100 && starts.length < 300, `blinks over 600 s: ${ starts.length }` );
	check( longGaps.length > 80 && Math.min( ...longGaps ) >= 2.0 - 0.01 && Math.max( ...longGaps ) <= 6.4, `blinks are 2 to 6 s apart (${ Math.min( ...longGaps ).toFixed( 2 ) } to ${ Math.max( ...longGaps ).toFixed( 2 ) } s)` );
	check( gaps.some( ( g ) => g < 0.6 ), 'some blinks come twice in a row' );
	check( maxL > 0.99 && maxR > 0.99, `both lids reach full closure (${ maxL.toFixed( 2 ) }, ${ maxR.toFixed( 2 ) })` );
	check( singles.length > 20, `sometimes only one lid blinks (${ singles.length } single blinks)` );
	check( bothGaze === 0 && outOfRange === 0, 'opposite gaze keys are never driven together and every weight stays in 0..1' );
	check( gazeMoves > 300, `the gaze drifts (${ gazeMoves } frames with movement)` );
	const lid = [ 0, 0.035, 0.07, 0.085, 0.1, 0.16, 0.22 ].map( EyeDriver.lid );
	check( lid[ 0 ] === 0 && lid[ 2 ] === 1 && lid[ 4 ] === 1 && lid[ 6 ] < 1e-6 && lid[ 1 ] > 0.3 && lid[ 1 ] < 0.7 && lid[ 5 ] > 0.1 && lid[ 5 ] < 0.9, 'the lid curve closes fast, holds and opens slower' );

}

// ---- the Avatar: eyes on the six, none on a cousin; lookAt turns the gaze; blinking is visible on the model
const scene2 = new E.Scene();
function pose( o = {} ) { return { position: new E.Vector3( 0, 0, 0 ), yaw: 0, mode: 'walk', speed: 0, vy: 0, grounded: true, diving: false, frame: null, action: null, ...o }; }
{

	const a = new Avatar( { scene: scene2, character: 'hyptile' } );
	await a.ready;
	check( a._eyes && a.model.morphNames.length === 6, 'Avatar: the Hyptile has an EyeDriver' );
	const b = new Avatar( { scene: scene2, character: 'bravile' } );
	await b.ready;
	check( b._eyes === null && b.model.morphNames.length === 0, 'Avatar: Bravile (no morph keys) has no EyeDriver and skips' );
	for ( let i = 0; i < 5; i ++ ) b.update( DT, pose() );
	b.lookAt( new E.Vector3( 1, 1, 1 ) );
	b.update( DT, pose() );
	check( true, 'Avatar: lookAt and blink on a character without eyes are no-ops' );
	// the avatar at yaw 0 faces world -Z; its left (model +X after the half turn) is world -X
	const gaze = ( target, frames = 40 ) => {

		a.lookAt( target );
		for ( let i = 0; i < frames; i ++ ) a.update( DT, pose() );
		const m = a.model;
		return { l: m.getMorph( 'Gaze_Left' ), r: m.getMorph( 'Gaze_Right' ), u: m.getMorph( 'Gaze_Up' ), d: m.getMorph( 'Gaze_Down' ) };

	};

	const head = a.headPosition( new E.Vector3() );
	const L = gaze( head.clone().add( new E.Vector3( - 1.2, 0, - 3 ) ) );
	check( L.l > 0.6 && L.r < 0.12, `lookAt a point on the character's left: Gaze_Left ${ L.l.toFixed( 2 ) }, Gaze_Right ${ L.r.toFixed( 2 ) }` );
	const R = gaze( head.clone().add( new E.Vector3( 1.2, 0, - 3 ) ) );
	check( R.r > 0.6 && R.l < 0.12, `lookAt the right: Gaze_Right ${ R.r.toFixed( 2 ) }, Gaze_Left ${ R.l.toFixed( 2 ) }` );
	const U = gaze( head.clone().add( new E.Vector3( 0, 2, - 3 ) ) );
	check( U.u > 0.6 && U.d < 0.12, `lookAt above: Gaze_Up ${ U.u.toFixed( 2 ) }` );
	const D = gaze( head.clone().add( new E.Vector3( 0, - 2, - 3 ) ) );
	check( D.d > 0.6 && D.u < 0.12, `lookAt below: Gaze_Down ${ D.d.toFixed( 2 ) }` );
	const Bk = gaze( head.clone().add( new E.Vector3( 0, 0, 3 ) ) );
	check( Math.max( Bk.l, Bk.r ) < 0.6, `a target behind the head is not looked at (the eyes wander: ${ Bk.l.toFixed( 2 ) }, ${ Bk.r.toFixed( 2 ) })` );
	// with the avatar turned half a circle the same world point is on the other side
	a.lookAt( head.clone().add( new E.Vector3( - 1.2, 0, 3 ) ) );
	for ( let i = 0; i < 40; i ++ ) a.update( DT, pose( { yaw: Math.PI } ) );
	check( a.model.getMorph( 'Gaze_Right' ) > 0.6 && a.model.getMorph( 'Gaze_Left' ) < 0.12, 'lookAt follows the avatar turning (the gaze is in the head frame)' );
	a.lookAt( null );
	// timed look: lets go by itself
	a.lookAt( head.clone().add( new E.Vector3( - 1.2, 0, - 3 ) ), { seconds: 0.5 } );
	for ( let i = 0; i < 40; i ++ ) a.update( DT, pose() );
	check( ! a.looking, 'lookAt( p, { seconds } ) releases after the time' );
	// a scheduled blink shows in the weights
	let sawBlink = false;
	a.blink();
	for ( let i = 0; i < 8; i ++ ) { a.update( DT, pose() ); if ( a.model.getMorph( 'Blink_L' ) > 0.9 && a.model.getMorph( 'Blink_R' ) > 0.9 ) sawBlink = true; }
	check( sawBlink, 'blink() closes both lids within a quarter of a second' );
	a.dispose(); b.dispose();

}

// ---- ragdoll
{

	const a = new Avatar( { scene: scene2, character: 'hyptile' } );
	await a.ready;
	const slope = ( x, z ) => 0.1 * x; // a gentle slope
	let ended = null;
	a.onRagdollEnd = ( p, yaw ) => { ended = { p: p.clone(), yaw }; };
	a.groundHeight = slope;
	const P = pose( { position: new E.Vector3( 2, slope( 2, 0 ), 0 ), yaw: 0.8, action: null } );
	for ( let i = 0; i < 20; i ++ ) a.update( DT, P ); // standing
	const stand = a.model.nodeWorld( 'pelvis', new E.Vector3() ).y;
	check( a.ragdoll( new E.Vector3( 3, 2, 1 ), { duration: 2.5 } ) && a.ragdolling && a.ragdollPhase === 'fall', 'ragdoll( impulse ) starts' );
	const sim = a._rd.sim;
	check( sim.p.length === 19 && sim.links.length > 25, `the simulation has ${ sim.p.length } particles and ${ sim.links.length } bone / torso links (14 bone segments)` );
	// the bones keep their lengths and nothing goes through the ground or non-finite
	const lens = sim.links.map( ( l ) => l.len );
	let worstStretch = 0, worstUnder = Infinity, finite = true, minPelvis = 9, maxPelvisDist = 0, calmAt = - 1;
	const p0 = sim.pelvisWorld( new E.Vector3() );
	let t = 0, phaseAt = {}, framesRagdoll = 0, bonesFinite = true;
	const tiles = [];
	const camR = new E.PerspectiveCamera( 32, W / H, 0.05, 100 );
	scene.add( a.group );
	const snapshots = [ 0.15, 0.45, 0.8, 1.2, 1.8, 2.45, 2.75, 3.1 ];
	for ( let f = 0; f < 30 * 6 && a.ragdolling; f ++ ) {

		a.update( DT, P );
		t += DT; framesRagdoll ++;
		const s = a._rd ? a._rd.sim : sim;
		finite = finite && s.valid();
		s.links.forEach( ( l, i ) => { worstStretch = Math.max( worstStretch, Math.abs( s.p[ l.a ].distanceTo( s.p[ l.b ] ) / lens[ i ] - 1 ) ); } );
		worstUnder = Math.min( worstUnder, s.clearance() );
		const pw = s.pelvisWorld( new E.Vector3() );
		minPelvis = Math.min( minPelvis, pw.y - slope( pw.x, pw.z ) );
		maxPelvisDist = Math.max( maxPelvisDist, Math.hypot( pw.x - p0.x, pw.z - p0.z ) );
		if ( calmAt < 0 && s.calm > 0.2 ) calmAt = t;
		phaseAt[ a.ragdollPhase ] = phaseAt[ a.ragdollPhase ] ?? t;
		for ( const l of a.model.local ) for ( const x of l.r ) if ( ! Number.isFinite( x ) ) bonesFinite = false;
		if ( snapshots.length && t >= snapshots[ 0 ] ) {

			snapshots.shift();
			const pel = a.model.nodeWorld( 'pelvis', new E.Vector3() ).applyMatrix4( a.group.matrixWorld );
			camR.position.set( pel.x + 1.5, pel.y + 1.5, pel.z + 2.4 );
			camR.lookAt( pel.x, pel.y + 0.1, pel.z );
			camR.updateMatrixWorld( true );
			tiles.push( await shot( camR ) );

		}

	}

	check( finite && bonesFinite, 'ragdoll stays finite over the fall and the get-up (particles and every bone rotation)' );
	check( worstUnder > - 0.02, `no particle goes through the ground (lowest clearance ${ ( worstUnder * 100 ).toFixed( 1 ) } cm)` );
	check( worstStretch < 0.08, `bone and torso links stay within 8% of their length (the peak is the first impact at about 5 m/s) (worst ${ ( worstStretch * 100 ).toFixed( 2 ) }%)` );
	check( minPelvis > 0.05 && minPelvis < stand * 0.6, `the pelvis falls from ${ stand.toFixed( 2 ) } m to ${ minPelvis.toFixed( 2 ) } m above the ground` );
	check( maxPelvisDist > 0.4 && maxPelvisDist < 8, `the body travels ${ maxPelvisDist.toFixed( 2 ) } m with the impulse` );
	check( calmAt > 0.8 && calmAt < 2.5, `it comes to rest (still from ${ calmAt.toFixed( 2 ) } s)` );
	check( phaseAt.recover >= 2.45 && phaseAt.recover < 2.6, `it recovers after about 2.5 s (recover phase from ${ ( phaseAt.recover || 0 ).toFixed( 2 ) } s)` );
	check( ! a.ragdolling && ended && ended.p.distanceTo( P.position ) > 0.3, `the get-up ends (${ t.toFixed( 2 ) } s), onRagdollEnd( ${ ended ? ended.p.toArray().map( ( x ) => x.toFixed( 2 ) ).join( ', ' ) : '-' } )` );
	check( t > 3.3 && t < 4.5, `the whole knockdown takes ${ t.toFixed( 2 ) } s (2.5 s down + a get-up)` );
	// after the end the avatar is a standing, idle avatar again
	for ( let i = 0; i < 20; i ++ ) a.update( DT, { ...P, position: ended.p.clone(), yaw: ended.yaw } );
	const up = a.model.nodeWorld( 'pelvis', new E.Vector3() ).y, head = a.model.nodeWorld( 'head', new E.Vector3() ).y;
	check( Math.abs( up - stand ) < 0.04 && head > 1.15, `standing again afterwards (pelvis ${ up.toFixed( 2 ) } m, head ${ head.toFixed( 2 ) } m)` );
	if ( tiles.length ) sheet( tiles, 4, 'eyes-ragdoll.png' );
	scene.remove( a.group );
	// a hit while down adds an impulse; a second avatar with no hook eases back to its player
	const c = new Avatar( { scene: scene2, character: 'pepe' } );
	await c.ready;
	for ( let i = 0; i < 5; i ++ ) c.update( DT, P );
	c.ragdoll( new E.Vector3( 0, 1, - 2 ), { duration: 1.0, ground: () => P.position.y } );
	c.ragdoll( new E.Vector3( 0, 0, - 1 ) );
	for ( let i = 0; i < 30 * 3 && c.ragdolling; i ++ ) c.update( DT, P );
	const away = c._disp.length();
	for ( let i = 0; i < 30 * 3; i ++ ) c.update( DT, P );
	check( ! c.ragdolling && away > 0.2 && c._disp.length() < away * 0.05, `without a hook the avatar eases back to the player (${ away.toFixed( 2 ) } m -> ${ c._disp.length().toFixed( 3 ) } m)` );
	c.dispose();
	a.dispose();

}

console.log( failures ? `${ failures } failure(s)` : 'all feature-eyes checks passed' );
await new Promise( ( r ) => setTimeout( r, 200 ) );
process.exit( failures ? 1 : 0 );

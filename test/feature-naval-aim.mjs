// Plain-node test of wave 10's third-person cannon aiming (src/features/naval/AimCamera.js, Naval.aimCamera, AimAssist.lookAim
// pitchMap, Hud.js crosshair on the impact, the helm camera in src/player/Player.js updateBoat):
//   the rig maths (shoulder 2.5 m, 1.2 m up, 30 % closer, fov -8 deg, 0.25 s ease), pitch ranging, side pick, swing clamp and
//   out of arc, first person keeping wave 9's ray ranging, the fov narrowed and restored, the HUD crosshair on the projected
//   impact, and the chase camera swinging over the aimed shoulder.
//   node test/feature-naval-aim.mjs
import { Features } from '../src/features/Features.js';
import { Naval, GUN_LEVELS } from '../src/features/naval/Naval.js';
import { AIM_CAM, pitchToRange, rangeToPitch, easeAimCam, aimRig } from '../src/features/naval/AimCamera.js';
import { lookAim } from '../src/features/naval/AimAssist.js';
import { hudModel, NavalHud } from '../src/features/naval/Hud.js';
import { solveElevation, MUZZLE_SPEED } from '../src/features/naval/Ballistics.js';
import { Player } from '../src/player/Player.js';
import { Vector3, Quaternion, PerspectiveCamera } from '../src/engine/index.js';

let fails = 0, passes = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else { passes ++; console.log( 'ok  ', msg ); }

};
const near = ( a, b, e = 1e-6 ) => Math.abs( a - b ) <= e;
const section = ( s ) => console.log( '\n== ' + s );
const DEG = Math.PI / 180;

// a camera quaternion looking along heading yaw (the direction ( -sin yaw, -cos yaw ) like Player) and pitch (+ up)
function lookQ( dir, pitch ) {

	const yaw = Math.atan2( - dir.x, - dir.z );
	return new Quaternion().setFromAxisAngle( new Vector3( 0, 1, 0 ), yaw ).multiply( new Quaternion().setFromAxisAngle( new Vector3( 1, 0, 0 ), pitch ) );

}

function makeApp( over = {} ) {

	const toasts = [];
	const state = { boat: 'lobster', money: 0, earn( n ) { this.money += n; }, spend( n ) { if ( n > this.money ) return false; this.money -= n; return true; } };
	const input = { hit: () => false, rightDown: false, mouseDown: false, enabled: true };
	return {
		mode: 'sandbox', settings: { timeOfDay: 12 },
		terrainData: null, query: null, spray: null, scene: null, audio: null,
		boatCtl: { position: new Vector3( 0, 0, 1500 ), quaternion: new Quaternion(), velocity: new Vector3(), angular: new Vector3(), driven: true, moored: false },
		boat: { dimensions: { length: 8.2, beam: 2.9, draft: 0.85, freeboard: 0.9 } },
		camera: { position: new Vector3( - 9, 5, 1500 ), quaternion: new Quaternion(), fov: 60, aspect: 16 / 9, updates: 0, updateProjectionMatrix() { this.updates ++; } },
		player: { mode: 'boat', camMode: 'third', position: new Vector3( 0, 1, 1500 ) },
		cameraFeel: { fovKick: 0, baseFov: () => 60, kick() {} },
		input, game: { state, toast( t ) { toasts.push( t ); } }, toasts, ...over,
	};

}

function setup( app = makeApp() ) {

	const features = new Features( app );
	const events = [];
	for ( const n of [ 'cannonFired' ] ) features.on( n, ( e ) => events.push( [ n, e ] ) );
	const naval = features.add( 'naval', { install: ( a, f ) => new Naval( a, f, { seed: 3, hud: false, models: false, settings: { autoSpawn: false } } ) } );
	return { app, features, naval, events };

}

const run = ( features, seconds, dt = 1 / 60 ) => { for ( let i = 0, n = Math.round( seconds / dt ); i < n; i ++ ) features.update( dt ); };

// ================================================================================================ 1. rig maths
section( '1. the aim rig maths (AimCamera.js)' );
{

	ok( near( pitchToRange( AIM_CAM.pitchLo, 20, 320 ), 20 ) && near( pitchToRange( AIM_CAM.pitchHi, 20, 320 ), 320 ), 'the pitch band spans the gun\'s reach: bottom 20 m, top 320 m' );
	ok( near( pitchToRange( - 1.2, 20, 320 ), 20 ) && near( pitchToRange( 0.5, 20, 320 ), 320 ), 'clamped outside the band' );
	const mid = ( AIM_CAM.pitchLo + AIM_CAM.pitchHi ) / 2;
	ok( near( pitchToRange( mid, 20, 320 ), 170, 1e-9 ), 'linear in between (the middle of the band is 170 m)' );
	ok( near( rangeToPitch( pitchToRange( - 0.21, 20, 320 ), 20, 320 ), - 0.21, 1e-9 ), 'rangeToPitch inverts it' );
	ok( pitchToRange( - 0.10, 20, 320 ) > pitchToRange( - 0.20, 20, 320 ), 'raising the look lengthens the range' );

	const st = { blend: 0, shoulder: 1, side: 'port' };
	easeAimCam( st, { aiming: true, side: 'starboard' }, 1 / 60 );
	ok( st.side === 'starboard' && st.shoulder === - 1, 'a fresh aim starts on its own shoulder (starboard: -1)' );
	let t = 1 / 60;
	while ( st.blend < 1 && t < 2 ) { easeAimCam( st, { aiming: true, side: 'starboard' }, 1 / 60 ); t += 1 / 60; }
	ok( near( t, AIM_CAM.ease, 0.02 ), `eased in over ${ t.toFixed( 3 ) } s (0.25)` );
	const r = aimRig( st, { dist: 13, fov: 60, pitch: - 0.2, az: 0.1 } );
	ok( r.side === 'starboard' && r.sign === - 1 && near( r.blend, 1 ), 'full rig on the starboard side' );
	ok( near( r.shoulder.x, - 2.5 ) && near( r.shoulder.y, 1.2 ), 'the pivot 2.5 m out to starboard (-X) and 1.2 m up' );
	ok( near( r.dist, 13 * 0.7 ) && near( r.fov, 52 ) && near( r.fovDelta, - 8 ), '30 % closer (9.1 m) and 8 deg narrower (52)' );
	ok( near( r.pitch, - 0.2 ) && near( r.yawOffset, 0.1 ) && r.pitchMin === AIM_CAM.pitchLo && r.pitchMax === AIM_CAM.pitchHi, 'pitch held in the band; yawOffset the laid bearing' );
	// a side change mid-aim swings the shoulder across (not a jump)
	easeAimCam( st, { aiming: true, side: 'port' }, 1 / 60 );
	ok( st.shoulder > - 1 && st.shoulder < 1, `switching sides swings the shoulder (${ st.shoulder.toFixed( 2 ) })` );
	t = 0;
	while ( st.shoulder < 1 && t < 2 ) { easeAimCam( st, { aiming: true, side: 'port' }, 1 / 60 ); t += 1 / 60; }
	ok( t <= AIM_CAM.ease + 0.02, `across in ${ ( t + 1 / 60 ).toFixed( 2 ) } s` );
	// release: out over 0.25 s, then no rig
	t = 0;
	while ( st.blend > 0 && t < 2 ) { easeAimCam( st, { aiming: false }, 1 / 60 ); t += 1 / 60; }
	ok( near( t, AIM_CAM.ease, 0.02 ) && aimRig( st, {} ) === null, `eased out over ${ t.toFixed( 3 ) } s, then null` );
	const half = aimRig( { blend: 0.5, shoulder: 1, side: 'port' }, { dist: 10, fov: 60 } );
	ok( near( half.blend, 0.5 ) && near( half.shoulder.x, 1.25 ) && near( half.dist, 8.5 ) && near( half.fov, 56 ), 'half way: smoothstep blend, half the offset, fov and arm' );

}

// ================================================================================================ 2. lookAim with pitch ranging
section( '2. third-person ranging: the look pitch sets the range' );
{

	const gunFor = ( side ) => ( { m: { x: side === 'port' ? 1.5 : - 1.5, y: 1, z: 1 }, n: { x: side === 'port' ? 1 : - 1, z: 0 } } );
	const opts = { traverse: 24 * DEG, maxRange: 320, minRange: 20, speed: MUZZLE_SPEED, pitchMap: true };
	const eye = { x: - 8, y: 5, z: 0 };
	const dir = ( yaw, pitch ) => ( { x: Math.cos( pitch ) * Math.cos( yaw ), y: Math.sin( pitch ), z: Math.cos( pitch ) * Math.sin( yaw ) } );
	const a = lookAim( dir( 0, rangeToPitch( 150, 20, 320 ) ), eye, gunFor, opts );
	ok( a.side === 'port' && a.inArc && near( a.range, 150, 1e-6 ), `looking over the port beam at the 150 m pitch: port, ${ a.range.toFixed( 1 ) } m` );
	ok( near( a.el, solveElevation( MUZZLE_SPEED, 150, - 1 ), 1e-9 ), 'the elevation drops the ball at that range' );
	const ray = lookAim( dir( 0, rangeToPitch( 150, 20, 320 ) ), eye, gunFor, { ...opts, pitchMap: false } );
	ok( ray.range < 40, `the old ray ranging from the chase camera lands uselessly close (${ ray.range.toFixed( 1 ) } m): why pitch ranging` );
	const sb = lookAim( dir( Math.PI, - 0.1 ), eye, gunFor, opts );
	ok( sb.side === 'starboard' && sb.dir.x < 0, 'looking over the starboard beam picks starboard' );
	const fwd = lookAim( dir( 70 * DEG, - 0.1 ), eye, gunFor, opts );
	ok( fwd.side === 'port' && ! fwd.inArc && near( Math.abs( fwd.az ), 24 * DEG, 1e-9 ), 'past the swing: the bearing is held at the edge (24 deg) and out of arc' );
	const within = lookAim( dir( 20 * DEG, - 0.1 ), eye, gunFor, opts );
	ok( within.inArc && near( Math.abs( within.az ), 20 * DEG, 1e-9 ), 'inside the swing the guns follow the look (20 deg)' );
	ok( near( Math.asin( a.dir.y ), a.el, 1e-9 ) && Number.isFinite( a.pitch ), 'aimInfo carries the look pitch' );

}

// ================================================================================================ 3. through Naval
section( '3. Naval: aimCamera(), the fov, first person unchanged' );
{

	const saved = GUN_LEVELS[ 1 ].spread;
	GUN_LEVELS[ 1 ].spread = 0;
	const { app, features, naval, events } = setup();
	ok( typeof app.player.aimCamera === 'function', 'naval hands the helm camera its hook (app.player.aimCamera)' );
	ok( naval.aimCamera() === null, 'not aiming: no rig' );
	const cam = app.camera;
	cam.quaternion.copy( lookQ( { x: 1, y: 0, z: 0 }, rangeToPitch( 200, 20, 320 ) ) );
	app.input.rightDown = true;
	run( features, 0.1 );
	const half = naval.aimCamera( { dist: 13, fov: 60 } );
	ok( naval.aiming && half && half.side === 'port' && half.blend > 0.1 && half.blend < 1, `right mouse in the chase view: the rig eases in (blend ${ half && half.blend.toFixed( 2 ) })` );
	run( features, 0.3 );
	const rig = naval.aimCamera( { dist: 13 } );
	ok( rig && near( rig.blend, 1 ) && near( rig.shoulder.x, 2.5 ) && near( rig.dist, 9.1, 1e-9 ), 'after 0.25 s: the full rig over the port shoulder' );
	ok( near( naval.aimInfo.range, 200, 1 ), `the range from the look pitch: ${ naval.aimInfo.range.toFixed( 1 ) } m` );
	ok( near( cam.fov, 52, 1e-9 ) && cam.updates > 0, `the fov narrowed by 8 deg (${ cam.fov })` );
	// the crosshair: on the projected impact
	app.camera.position.set( - 9, 6, 1500 );
	const m = hudModel( naval );
	ok( m.aiming && m.aiming.third && m.aiming.screen && m.aiming.point, 'the HUD model has the impact point and its screen position' );
	ok( m.aiming.point && Math.abs( Math.hypot( m.aiming.point.x - naval.aimInfo.from.x, m.aiming.point.z - naval.aimInfo.from.z ) - 200 ) < 6, `the impact is the arc's end, ~200 m out (${ Math.hypot( m.aiming.point.x - naval.aimInfo.from.x, m.aiming.point.z - naval.aimInfo.from.z ).toFixed( 1 ) } m)` );
	ok( m.aiming.screen.visible && m.aiming.screen.y < 0.5 && Math.abs( m.aiming.screen.x - 0.5 ) < 0.05, `on screen above the centre (the hull below it): ${ m.aiming.screen.x.toFixed( 3 ) }, ${ m.aiming.screen.y.toFixed( 3 ) }` );
	const plan = m.aim.find( ( p ) => p && p.aimed );
	ok( plan && plan.points.length > 3 && Math.hypot( plan.points[ plan.points.length - 1 ].x - m.aiming.point.x, plan.points[ plan.points.length - 1 ].z - m.aiming.point.z ) < 1e-6, 'the aim dots run from the gun to the crosshair\'s impact' );
	// out of arc
	cam.quaternion.copy( lookQ( { x: 0.3, y: 0, z: 0.95 }, - 0.1 ) );
	run( features, 1 / 60 );
	const out = hudModel( naval );
	ok( out.aiming && ! out.aiming.inArc && out.aim.find( ( p ) => p && p.aimed ).outOfArc, 'looking ahead past the swing: out of arc (the HUD dims)' );
	// fire
	cam.quaternion.copy( lookQ( { x: 1, y: 0, z: 0 }, rangeToPitch( 200, 20, 320 ) ) );
	run( features, 1 / 60 );
	app.input.mouseDown = true;
	run( features, 1 / 60 );
	app.input.mouseDown = false;
	const shot = events.filter( ( e ) => e[ 0 ] === 'cannonFired' ).pop();
	ok( shot && Math.abs( shot[ 1 ].dir.y - naval.aimInfo.dir.y ) < 0.01 && shot[ 1 ].side === 'port', 'the left button fires the aimed side at that elevation' );
	// release: eased out, fov restored
	app.input.rightDown = false;
	run( features, 0.1 );
	ok( naval.aimCamera() !== null && cam.fov > 52 && cam.fov < 60, 'released: easing out' );
	run( features, 0.3 );
	ok( naval.aimCamera() === null && near( cam.fov, 60 ), `and gone, the fov back to ${ cam.fov }` );

	// first person: wave 9's ray ranging, no rig, the centred crosshair
	app.player.camMode = 'first';
	cam.position.set( - 0.5, 2.6, 1500 );
	cam.quaternion.copy( lookQ( { x: 1, y: 0, z: 0 }, - Math.atan2( 2.6, 120 ) ) );
	app.input.rightDown = true;
	run( features, 0.4 );
	ok( naval.aiming && naval.aimCamera() === null && near( cam.fov, 60 ), 'first person: aiming without the rig or the fov change' );
	ok( Math.abs( naval.aimInfo.range - 119 ) < 3, `ranged by the look ray (${ naval.aimInfo.range.toFixed( 1 ) } m)` );
	const fm = hudModel( naval );
	ok( fm.aiming && ! fm.aiming.third && fm.aiming.screen === null, 'the crosshair stays centred in first person' );
	app.input.rightDown = false;
	run( features, 0.1 );
	naval.dispose();
	ok( app.player.aimCamera === null, 'dispose removes the hook' );
	GUN_LEVELS[ 1 ].spread = saved;

}

// ================================================================================================ 4. HUD DOM
section( '4. HUD: the crosshair on the impact' );
{

	const mk = ( tag ) => {

		const e = { tag, children: [], classes: new Set(), style: {}, textContent: '', parent: null };
		e.classList = { add: ( c ) => e.classes.add( c ), remove: ( c ) => e.classes.delete( c ), toggle: ( c, on ) => ( on ?? ! e.classes.has( c ) ) ? e.classes.add( c ) : e.classes.delete( c ), contains: ( c ) => e.classes.has( c ) };
		Object.defineProperty( e, 'className', { get: () => [ ...e.classes ].join( ' ' ), set: ( v ) => { e.classes = new Set( String( v ).split( /\s+/ ).filter( Boolean ) ); } } );
		e.append = ( ...cs ) => { for ( const c of cs ) { c.parent = e; e.children.push( c ); } };
		e.remove = () => { if ( e.parent ) e.parent.children.splice( e.parent.children.indexOf( e ), 1 ); };
		return e;

	};

	const doc = { createElement: mk, head: mk( 'head' ), body: mk( 'body' ) };
	const hud = new NavalHud( { doc } );
	const model = {
		visible: true, hull: { hp: 200, max: 264, frac: 0.75, low: false, sunk: false },
		guns: [ { side: 'port', key: 'Z', owned: true, ready: true, frac: 1, count: 1 }, { side: 'starboard', key: 'X', owned: true, ready: true, frac: 1, count: 1 } ],
		arrows: [], aim: null, target: null, noGun: false, camera: null, features: null,
		aiming: { side: 'port', range: 214, inArc: true, ready: true, left: 0, third: true, point: { x: 0, y: 0, z: 0 }, screen: { visible: true, x: 0.52, y: 0.31 } },
	};
	hud.update( model, 0.016 );
	ok( hud.xhair.style.left === '52.00%' && hud.xhair.style.top === '31.00%', 'third person: the crosshair sits on the impact\'s screen point' );
	ok( hud.xread.style.left === '52.00%' && /31\.00%/.test( hud.xread.style.top ) && /PORT · 214 m/.test( hud.xread.textContent ), 'the readout beside it: "PORT · 214 m"' );
	hud.update( { ...model, aiming: { ...model.aiming, inArc: false } }, 0.016 );
	ok( hud.xhair.classes.has( 'is-out' ) && /out of arc/.test( hud.xread.textContent ), 'past the swing: dim, "out of arc"' );
	hud.update( { ...model, aiming: { ...model.aiming, third: false, screen: null } }, 0.016 );
	ok( hud.xhair.style.left === '' && hud.xhair.style.top === '', 'first person: back to the centre' );
	hud.dispose();

}

// ================================================================================================ 5. the helm camera
section( '5. Player.updateBoat: the chase camera swings over the aimed shoulder' );
{

	// a stand-in boat at the origin heading +Z (port +X), the real Player.updateBoat on a bare object
	const boat = {
		speed: 0, quaternion: new Quaternion(), position: new Vector3(),
		model: { helmEye: new Vector3( 0, 1.6, 0 ) },
		setInput() {}, getYaw() { return 0; },
		toWorld( l, out ) { return out.copy( l ).applyQuaternion( this.quaternion ).add( this.position ); },
	};
	const input = { consumeLook: () => ( { x: 0, y: 0 } ), consumeWheel: () => 0, hit: () => false, down: () => false };
	const camera = new PerspectiveCamera( 60, 16 / 9, 0.1, 1000 );
	const p = Object.create( Player.prototype );
	Object.assign( p, {
		input, boat, camera, camMode: 'third', mode: 'boat', position: new Vector3(), waterH: 0, _ashoreT: 1, _ashore: null,
		orbitYaw: - Math.PI / 2, orbitPitch: 0.22, orbitDist: 13, camPos: new Vector3(), camInit: false, helmAshore: false, prompt: null,
		ashoreTarget: () => null,
	} );
	// orbitYaw -PI/2: the camera sits off the starboard side (-X) looking over the boat to port (+X)
	p.updateBoat( 1 / 60 );
	const chase = camera.position.clone();
	ok( near( chase.x, - 13 * Math.cos( 0.22 ), 1e-6 ) && near( chase.y, 1.4 + 13 * Math.sin( 0.22 ), 1e-6 ), `the plain chase camera without the hook (${ chase.x.toFixed( 2 ) }, ${ chase.y.toFixed( 2 ) })` );
	const st = { blend: 1, shoulder: 1, side: 'port' };
	p.aimCamera = ( o ) => aimRig( st, { dist: o.dist, pitch: - 0.22 } );
	for ( let i = 0; i < 120; i ++ ) p.updateBoat( 1 / 60 );
	const aimP = camera.position;
	const d = 13 * 0.7;
	ok( near( aimP.x, 2.5 - d * Math.cos( 0.22 ), 1e-3 ) && near( aimP.y, 1.4 + 1.2 + d * Math.sin( 0.22 ), 1e-3 ) && near( aimP.z, 0, 1e-6 ), `aiming port: the pivot 2.5 m to port and 1.2 m up, the arm 30 % shorter (${ aimP.x.toFixed( 2 ) }, ${ aimP.y.toFixed( 2 ) }, ${ aimP.z.toFixed( 2 ) })` );
	const look = new Vector3( 0, 0, - 1 ).applyQuaternion( camera.quaternion );
	ok( look.x > 0.9 && near( Math.asin( look.y ), - 0.22, 1e-3 ), 'looking out over the port beam at the aimed pitch' );
	// the pitch is held in the ranging band while aiming
	p.orbitPitch = 0.9;
	p.updateBoat( 1 / 60 );
	ok( near( p.orbitPitch, - AIM_CAM.pitchLo, 1e-9 ), `a steep look is pulled into the band (${ p.orbitPitch.toFixed( 2 ) } rad)` );
	p.aimCamera = null;
	p.orbitPitch = 0.9;
	p.updateBoat( 1 / 60 );
	ok( near( p.orbitPitch, 0.9 ), 'released: the chase camera\'s own range again' );

}

console.log( `\n${ passes } checks passed, ${ fails } failed` );
process.exit( fails ? 1 : 0 );

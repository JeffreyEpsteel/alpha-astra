// Plain-node tests of wave 14A, a cockpit of its own for every airframe (src/features/seaplane/Panels.js, Cockpit.js):
// each airframe's layout (its control ids and gauges, the face's shape and size, every control reachable by a ray
// from the eye, none overlapping, the attitude indicator ahead of the pilot), hitControl per layout, the face drawing
// on a stand-in 2D context for all four, the per-engine / gear fields of the snapshot, the texture rebuilt when the
// airframe changes, and a click on the Albatross's feather switch.
// No DOM, no GPU.
//   node test/feature-cockpit.mjs
import * as E from '../src/engine/index.js';
import { Flight, GEOM } from '../src/features/seaplane/Flight.js';
import { Pilot } from '../src/features/seaplane/Pilot.js';
import { Systems } from '../src/features/seaplane/Systems.js';
import { AIRFRAMES, AIRFRAME_IDS, spec } from '../src/features/seaplane/Airframes.js';
import { LAYOUTS, layoutFor, DIAL_KINDS } from '../src/features/seaplane/Panels.js';
import { Cockpit, CONTROLS, TEX, FACE, rayPanel, hitControl, panelSnapshot, drawPanel, stripCells } from '../src/features/seaplane/Cockpit.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};

// a stand-in 2D context: counts the calls, accepts any property
const KNOWN = [ 'fillRect', 'fillText', 'beginPath', 'arc', 'fill', 'stroke', 'moveTo', 'lineTo', 'closePath', 'save', 'restore', 'translate', 'rotate', 'clip', 'arcTo', 'getImageData' ];
function stubCtx() {

	const calls = new Map();
	const ctx = new Proxy( {}, {
		get: ( o, k ) => ( k in o ? o[ k ] : ( ...a ) => { calls.set( k, ( calls.get( k ) || 0 ) + 1 ); return k === 'getImageData' ? { data: new Uint8ClampedArray( 4 ) } : undefined; } ),
		set: ( o, k, v ) => { o[ k ] = v; return true; },
	} );
	return { ctx, calls };

}

// a bare plane for the snapshot / the cockpit: the real flight model, systems and pilot of an airframe
function plane( af ) {

	const f = new Flight( spec( af ) );
	f.place( 0, 0, 0 );
	const pilot = new Pilot();
	const systems = new Systems( f, pilot );
	return { af, flight: f, pilot, systems, hp: 100, piloted: false, app: {}, visual: null };

}

const plain = ( snap ) => Object.values( snap ).every( ( v ) => v === null || typeof v === 'boolean' || typeof v === 'string' || Number.isFinite( v ) );
const ids = ( L ) => L.controls.map( ( c ) => c.id );
const has = ( L, ...want ) => want.every( ( id ) => ids( L ).includes( id ) );

// ---------------------------------------------------------------- one layout per airframe
{

	const eye = new E.Vector3( ...GEOM.eye );
	const centre = ( L, c ) => {

		const u = ( c.x + c.w / 2 ) / L.w - 0.5, v = 0.5 - ( c.y + c.h / 2 ) / L.h;
		return FACE.C.clone().addScaledVector( FACE.R, u * FACE.w ).addScaledVector( FACE.U, v * FACE.h );

	};

	ok( CONTROLS === LAYOUTS.jade.controls && TEX.w === LAYOUTS.jade.w && TEX.h === LAYOUTS.jade.h, 'CONTROLS / TEX stay the Jade\'s (the old callers)' );
	const ACTS = [ 'master', 'engine', 'nav', 'landing', 'ap', 'warn', 'flapsUp', 'flapsDown', 'trimDown', 'trimUp', 'map', 'brake', 'feather1', 'feather2' ];
	for ( const id of AIRFRAME_IDS ) {

		const L = layoutFor( id );
		ok( L === LAYOUTS[ AIRFRAMES[ id ].cockpit ] && L.id === id, `${ id }: AIRFRAMES.${ id }.cockpit picks its own layout` );
		ok( L.w <= 1024 && L.h <= 512 && Math.abs( L.w / L.h - FACE.w / FACE.h ) < 0.02, `${ id }: a ${ L.w } x ${ L.h } face in the panel housing's shape (${ ( L.w / L.h ).toFixed( 3 ) } vs ${ ( FACE.w / FACE.h ).toFixed( 3 ) })` );
		ok( new Set( ids( L ) ).size === L.controls.length, `${ id }: ${ L.controls.length } controls with unique ids` );
		ok( L.controls.every( ( c ) => c.x >= 0 && c.y >= 0 && c.x + c.w <= L.w && c.y + c.h <= L.h ), `${ id }: the controls lie on the face` );
		let overlap = null;
		for ( let i = 0; i < L.controls.length; i ++ ) for ( let j = i + 1; j < L.controls.length; j ++ ) {

			const a = L.controls[ i ], b = L.controls[ j ];
			if ( a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h ) overlap = overlap || `${ a.id } / ${ b.id }`;

		}

		ok( ! overlap, `${ id }: no two controls overlap${ overlap ? ' (' + overlap + ')' : '' }` );
		let reach = 0;
		for ( const c of L.controls ) {

			const hit = rayPanel( eye, centre( L, c ).sub( eye ).normalize(), L );
			if ( hit && hitControl( hit.px, hit.py, L ) === c ) reach ++;

		}

		ok( reach === L.controls.length, `${ id }: every control is hit by a ray from the eye to its centre (${ reach } / ${ L.controls.length })` );
		const att = centre( L, L.controls.find( ( c ) => c.id === 'att' ) );
		ok( Math.abs( att.x - GEOM.eye[ 0 ] ) < 0.1, `${ id }: the attitude indicator is straight ahead of the pilot (x ${ att.x.toFixed( 2 ) })` );
		ok( has( L, 'master', 'engine', 'nav', 'landing', 'ap', 'warn', 'flapsUp', 'flapsDown', 'trimUp', 'trimDown', 'map', 'att', 'alt', 'vsi', 'fuel', 'hull', 'stallLamp', 'fuelLamp' ), `${ id }: the common switches, levers, radio and flight instruments` );
		ok( L.controls.filter( ( c ) => c.act ).every( ( c ) => ACTS.includes( c.id ) ), `${ id }: clickable controls call act ids (${ L.controls.filter( ( c ) => c.act ).map( ( c ) => c.id ).join( ' ' ) })` );
		ok( L.controls.filter( ( c ) => [ 'master', 'engine', 'nav', 'landing', 'ap', 'map' ].includes( c.id ) ).every( ( c ) => c.key === { master: 'U', engine: 'O', nav: 'N', landing: ';', ap: 'Y', map: 'M' }[ c.id ] ), `${ id }: the keys are unchanged` );

	}

	// distinct: control ids, gauge counts, paint
	const sig = AIRFRAME_IDS.map( ( id ) => ids( layoutFor( id ) ).slice().sort().join( ',' ) );
	ok( new Set( sig ).size === AIRFRAME_IDS.length, 'every airframe\'s control set differs' );
	ok( new Set( AIRFRAME_IDS.map( ( id ) => layoutFor( id ).theme.paint ) ).size === AIRFRAME_IDS.length, 'and every panel has its own paint' );
	const dials = Object.fromEntries( AIRFRAME_IDS.map( ( id ) => [ id, layoutFor( id ).dials ] ) );
	ok( dials.albatross > dials.jade && dials.kestrel < dials.jade && layoutFor( 'jade' ).items.filter( ( i ) => DIAL_KINDS.includes( i.kind ) ).length === dials.jade, `gauge counts differ (${ JSON.stringify( dials ) })` );
	const J = LAYOUTS.jade, Pe = LAYOUTS.petrel, A = LAYOUTS.albatross, K = LAYOUTS.kestrel;
	ok( has( A, 'rpm1', 'rpm2', 'oil1', 'oil2', 'ff1', 'ff2', 'out1', 'out2', 'feather1', 'feather2', 'tc' ) && ! has( A, 'rpm' ), 'the Albatross: two engine columns (rpm, oil, fuel flow, engine-out lamp, feather) and a turn coordinator' );
	ok( has( K, 'tape', 'gear', 'brake', 'brakeLamp', 'gs' ) && ! has( K, 'asi' ) && ! has( K, 'rudderLamp' ) && ! has( K, 'ftrim' ), 'the Kestrel: an airspeed tape, the gear, the brakes and ground speed; no water rudder, no float trim' );
	ok( [ J, Pe, A ].every( ( L ) => has( L, 'rudderLamp', 'ftrim' ) && ! has( L, 'gear', 'brake' ) ), 'the water planes: the water-rudder lamp and the float / hull trim gauge, no gear' );
	ok( has( Pe, 'compass', 'oil1', 'ff1' ) && ! has( Pe, 'hdg' ), 'the Petrel: a wet compass, oil and fuel flow' );
	ok( J.controls.find( ( c ) => c.id === 'att' ).w === 140 && J.controls.find( ( c ) => c.id === 'map' ).x === 822, 'the Jade keeps today\'s six-pack and radio' );
	ok( stripCells( A ).some( ( [ k ] ) => k === 'rpm2' ) && stripCells( K ).some( ( [ k ] ) => k === 'gear' ) && stripCells( J ).length === 6, 'the chase strip: two rpm cells on the Albatross, GEAR on the Kestrel, the six on the Jade' );

	// a known pixel per airframe
	const at = ( L, x, y ) => ( hitControl( x, y, L ) || {} ).id;
	ok( at( J, 243, 84 ) === 'att' && at( J, 520, 270 ) === 'master' && at( J, 974, 273 ) === 'ftrim', 'Jade: px (243, 84) att, (520, 270) master, (974, 273) float trim' );
	ok( at( Pe, 228, 205 ) === 'compass' && at( Pe, 604, 238 ) === 'ftrim' && at( Pe, 496, 28 ) === 'stallLamp', 'Petrel: (228, 205) compass, (604, 238) float trim, (496, 28) the stall lamp' );
	ok( at( A, 456, 78 ) === 'rpm1' && at( A, 586, 290 ) === 'feather2' && at( A, 70, 196 ) === 'tc', 'Albatross: (456, 78) port rpm, (586, 290) starboard feather, (70, 196) turn coordinator' );
	ok( at( K, 48, 130 ) === 'tape' && at( K, 468, 250 ) === 'gear' && at( K, 860, 250 ) === 'brake', 'Kestrel: (48, 130) tape, (468, 250) gear, (860, 250) parking brake' );
	ok( at( J, 456, 78 ) === 'alt' && hitControl( 243, 84 ) === J.controls.find( ( c ) => c.id === 'att' ), 'the same pixel is another control on another panel; no layout: the Jade' );

}

// ---------------------------------------------------------------- the snapshot: per engine, gear, brakes
{

	const a = plane( 'albatross' ), f = a.flight;
	f.engineOn = true;
	f.rpm = 0.8;
	f.controls.throttle = 0.8;
	f.engineFail[ 1 ] = true;
	const s = panelSnapshot( a );
	ok( plain( s ), 'the snapshot stays plain numbers / flags / strings' );
	ok( s.af === 'albatross' && s.engines === 2 && s.rpm1 > 1500 && s.rpm2 === 0 && ! s.out1 && s.out2, `the Albatross: two engines, port ${ Math.round( s.rpm1 ) } rpm, starboard out` );
	ok( s.oil1 > 40 && s.oil2 === 0 && s.ff1 > 0 && s.ff2 === 0, `oil ${ Math.round( s.oil1 ) } / ${ s.oil2 } psi, fuel flow ${ Math.round( s.ff1 ) } / ${ s.ff2 } L/h` );
	f.engineFail[ 1 ] = false;
	const s2 = panelSnapshot( a );
	ok( s2.rpm2 === s2.rpm1 && Math.abs( s2.ff1 + s2.ff2 - s.ff1 ) < 1e-6, 'both running: equal rpm, the burn shared' );
	ok( ! s2.gear && s.bail === '', 'no gear on the flying boat; no bail hint without Seaplane.bailHint' );

	const k = plane( 'kestrel' );
	k.flight.controls.brake = 1;
	k.flight.velocity.set( 3, 0, 4 );
	k.parkBrake = true;
	k.bailHint = () => "' ' bail out (press twice)";
	const sk = panelSnapshot( k );
	ok( sk.gear && sk.brake && sk.parkBrake && Math.abs( sk.groundSpeed - 5 ) < 1e-9 && sk.engines === 1 && sk.rpm2 === 0 && sk.bail.includes( 'bail' ), 'the Kestrel: gear, brakes, the parking brake, ground speed 5 m/s, one engine, the bail hint' );
	const sj = panelSnapshot( plane( 'jade' ) );
	ok( ! sj.gear && ! sj.brake && sj.engines === 1 && sj.onWater !== undefined && Number.isFinite( sj.turn ) && Number.isFinite( sj.slip ), 'the Jade: no gear, one engine, turn and slip finite' );

}

// ---------------------------------------------------------------- drawing every face on a stand-in context
{

	for ( const id of AIRFRAME_IDS ) {

		const { ctx, calls } = stubCtx();
		const p = plane( id );
		const s = panelSnapshot( p, layoutFor( id ).controls[ 0 ].id );
		let threw = null;
		try {

			drawPanel( ctx, s );
			drawPanel( ctx, { ...s, bank: 70, pitch: - 50, airspeed: 999, alt: 12345, vs: - 40, heading: 359.7, fuel: 0, hp: 5, flapPos: 2, trim: - 1, master: false, hover: null, out1: true, out2: true, turn: 40, slip: - 30, onWater: true, bail: "' ' bail out (press twice)" }, layoutFor( id ) );

		} catch ( e ) { threw = e; }

		const n = [ ...calls.values() ].reduce( ( a, b ) => a + b, 0 );
		ok( ! threw && calls.get( 'fillText' ) > 60 && [ ...calls.keys() ].every( ( c ) => KNOWN.includes( c ) ), `${ id }: the face draws (${ n } canvas calls, ${ calls.get( 'fillText' ) } texts${ threw ? ', threw ' + threw.stack : '' })` );
		ok( ctx.globalCompositeOperation === 'source-over', `${ id }: the paint is laid with 'copy' (the glow mask) and compositing restored` );

	}

}

// ---------------------------------------------------------------- the Cockpit follows sp.af; a click on a twin's feather
{

	const { ctx } = stubCtx();
	const canvas = { width: 1, height: 1, getContext: () => ctx };
	const p = plane( 'jade' );
	const cp = new Cockpit( p, { canvas } );
	cp.update( 0.1 );
	ok( cp.layout.id === 'jade' && canvas.width === 1024 && canvas.height === 336 && cp.redraws === 1, 'the Jade\'s face at first' );
	p.af = 'kestrel';
	p.flight.setSpec( spec( 'kestrel' ) );
	cp.update( 0.1 );
	ok( cp.layout.id === 'kestrel' && canvas.width === 896 && canvas.height === 294 && cp.rebuilds === 1 && cp.redraws === 2, 'another airframe out: the face is rebuilt at its size (896 x 294) and redrawn' );
	cp.update( 0.1 );
	ok( cp.rebuilds === 1, 'and only once' );

	// the Albatross in first person: the eye on the starboard feather switch, a click
	p.af = 'albatross';
	p.flight.setSpec( spec( 'albatross' ) );
	p.flight.place( 0, 0, 0 );
	const acts = [];
	p.act = ( id ) => acts.push( id );
	p.piloted = true;
	const camera = new E.PerspectiveCamera( 60, 2, 0.1, 5000 );
	p.app = cp.app = { camera, player: { view: 'first' }, input: { locked: true, mouseDown: false } };
	const L = LAYOUTS.albatross, c = L.controls.find( ( k ) => k.id === 'feather2' );
	const u = ( c.x + c.w / 2 ) / L.w - 0.5, v = 0.5 - ( c.y + c.h / 2 ) / L.h;
	const local = FACE.C.clone().addScaledVector( FACE.R, u * FACE.w ).addScaledVector( FACE.U, v * FACE.h );
	camera.position.copy( p.flight.toWorld( new E.Vector3( ...GEOM.eye ), new E.Vector3() ) );
	camera.lookAt( p.flight.toWorld( local, new E.Vector3() ) );
	cp.update( 1 / 60 );
	ok( cp.layout.id === 'albatross' && cp.hover === 'feather2', `the Albatross: looking at the starboard feather switch hovers it (${ cp.hover })` );
	cp.app.input.mouseDown = true;
	cp.update( 1 / 60 );
	ok( acts.join() === 'feather2', `a click asks Seaplane.act( 'feather2' ) (${ acts.join() })` );
	cp.dispose();

}

console.log( fails ? `\n${ fails } FAILED` : '\nall passed' );
process.exit( fails ? 1 : 0 );

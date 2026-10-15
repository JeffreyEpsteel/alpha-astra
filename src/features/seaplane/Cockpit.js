// The seaplane's cockpit: a live instrument panel in the model (a canvas-drawn face on a quad at GEOM.panel, redrawn
// ~10 Hz in first person, uploaded as a texture with an emissive night glow), its clickable switches (a ray from the
// eye or the mouse against the panel: hover highlight and a tooltip with the key), the first-person HUD rule (the
// desktop HUD steps off the windscreen; toasts and prompts stay) and the slim instrument strip of the chase view.
//
//   const cp = new Cockpit( seaplane );   cp.update( dt );   cp.dispose()
//   panelSnapshot( seaplane ) -> plain numbers the face shows;  drawPanel( ctx, snap, layout? )  (any 2D context)
//   rayPanel( origin, dir, layout? ) -> { px, py, u, v, t } | null   (model frame: where a ray meets the face, in the
//                                       layout's canvas px)
//   hitControl( px, py, layout? ) -> control | null;   control: { id, label, key, x, y, w, h, act }  (canvas px)
//   CONTROLS / TEX: the Jade's (the layout of the old saves); LAYOUTS / layoutFor( af ) from Panels.js
//
// Wave 14A: every airframe has a cockpit of its own (Panels.js: the paint, the instruments and where they sit, the
// lamps, switches, placards and the radio). The Jade keeps today's face on cream enamel with brass rims; the Petrel
// a grey crackle bush panel with a wet compass; the Albatross a wide dark panel with an engine column per engine (rpm,
// oil, fuel flow, an engine-out lamp, a feather / restart switch) and a turn coordinator; the Kestrel a compact tan
// panel with an airspeed tape, the gear lever and its three greens, a brake lamp, a parking brake and ground speed.
// The texture follows sp.af (rebuilt and resized when the airframe changes). The canvas alpha is the night-glow
// mask: the bare paint glows a little (theme.glow), the markings fully.

import { Mesh, BufferGeometry, BufferAttribute, Vector3, Quaternion } from '../../engine/index.js';
import { Texture } from '../../engine/gpu/Texture.js';
import { GPU } from '../../engine/gpu/GPU.js';
import { generateMipmaps } from '../../engine/gpu/Mipmaps.js';
import { standard } from '../../materials/Materials.js';
import { GEOM, SPEC } from './Flight.js';
import { FUEL } from './Systems.js';
import { SITE } from './Site.js';
import { LAYOUTS, layoutFor, controlAt } from './Panels.js';
import { t } from '../../i18n/index.js';

export { LAYOUTS, layoutFor };

const JADE = LAYOUTS.jade;
export const TEX = { w: JADE.w, h: JADE.h };
export const CONTROLS = JADE.controls;
const DEG = 180 / Math.PI;
const KT = 1.94384;

export function hitControl( px, py, layout = JADE ) {

	return controlAt( layout || JADE, px, py );

}

// the face's frame in the model: centre C, R (canvas +x: the pilot's right = -X), U (canvas up), N (towards the pilot)
const P = GEOM.panel;
export const FACE = {
	C: new Vector3( ...P.c ),
	R: new Vector3( - 1, 0, 0 ),
	U: new Vector3( 0, Math.cos( P.tilt ), Math.sin( P.tilt ) ),
	N: new Vector3( 0, Math.sin( P.tilt ), - Math.cos( P.tilt ) ),
	w: P.w, h: P.h,
};

const _d = new Vector3(), _p = new Vector3();

export function rayPanel( o, d, layout = JADE, maxT = 3 ) {

	if ( typeof layout === 'number' ) {

		maxT = layout; // (the older ( o, d, maxT ) form)
		layout = JADE;

	}

	const L = layout || JADE;
	const dn = d.x * FACE.N.x + d.y * FACE.N.y + d.z * FACE.N.z;
	if ( dn > - 1e-4 ) return null; // from behind or edge on
	_d.copy( FACE.C ).sub( o );
	const tt = _d.dot( FACE.N ) / dn;
	if ( ! ( tt > 0 && tt < maxT ) ) return null;
	_p.copy( d ).multiplyScalar( tt ).add( o ).sub( FACE.C );
	const u = _p.dot( FACE.R ) / FACE.w + 0.5, v = 0.5 - _p.dot( FACE.U ) / FACE.h;
	if ( u < 0 || u > 1 || v < 0 || v > 1 ) return null;
	return { u, v, px: u * L.w, py: v * L.h, t: tt };

}

export function buildFaceGeometry() {

	const { C, R, U, N, w, h } = FACE;
	const corner = ( sx, sy ) => C.clone().addScaledVector( R, sx * w / 2 ).addScaledVector( U, sy * h / 2 );
	const bl = corner( - 1, - 1 ), br = corner( 1, - 1 ), tr = corner( 1, 1 ), tl = corner( - 1, 1 );
	const pos = new Float32Array( [ bl.x, bl.y, bl.z, br.x, br.y, br.z, tr.x, tr.y, tr.z, tl.x, tl.y, tl.z ] );
	const nrm = new Float32Array( [ N.x, N.y, N.z, N.x, N.y, N.z, N.x, N.y, N.z, N.x, N.y, N.z ] );
	const uv = new Float32Array( [ 0, 0, 1, 0, 1, 1, 0, 1 ] );
	const g = new BufferGeometry();
	g.setAttribute( 'position', new BufferAttribute( pos, 3 ) );
	g.setAttribute( 'normal', new BufferAttribute( nrm, 3 ) );
	g.setAttribute( 'uv', new BufferAttribute( uv, 2 ) );
	g.setIndex( new BufferAttribute( new Uint16Array( [ 0, 1, 2, 0, 2, 3 ] ), 1 ) );
	g.computeBoundingBox();
	g.computeBoundingSphere();
	return g;

}

// ---------------------------------------------------------------- what the face shows

const wrap360 = ( a ) => ( ( a % 360 ) + 360 ) % 360;
const _fw = new Vector3();

export function panelSnapshot( sp, hover = null ) {

	const f = sp.flight, sys = sp.systems, pilot = sp.pilot;
	const fwd = f.toWorldXYZ( 0, 0, 1, _fw ).sub( f.position );
	const sea = f.seaLevel();
	const dx = SITE.berth.x - f.position.x, dz = SITE.berth.z - f.position.z;
	const S = f.spec || SPEC; // (wave 12: the airframe's tank and burn)
	const burn = ( S.fuelIdle + ( 1 - S.fuelIdle ) * f.rpm ) / ( S.fuelMinutes * 60 );
	// wave 14A: per engine (a twin's failed / feathered engine stands still), the gear and the brakes
	const ef = f.engineFail || [], n = Math.max( 1, ef.length );
	const live = Math.max( 1, ef.filter( ( x ) => ! x ).length );
	const rpm = f.engineOn ? 600 + 1600 * f.rpm : f.rpm * 2200;
	const lph = f.engineOn ? burn * ( S.litres || FUEL.litres ) * 3600 : 0;
	const turns = ( i ) => i < n && ! ef[ i ];
	const oil = ( i ) => ! turns( i ) ? 0 : f.engineOn ? 28 + 46 * f.rpm : sys.cranking ? 12 : 0;
	return {
		af: sp.af || S.id || 'jade',
		airspeed: f.airspeed, alt: Math.max( 0, f.position.y - sea + 0.2 ), vs: f.velocity.y,
		pitch: f.pitchAngle() * DEG, bank: f.rollAngle() * DEG,
		heading: wrap360( Math.atan2( fwd.x, - fwd.z ) * DEG ), // compass: north is -z (the HUD's convention)
		rpm, throttle: f.controls.throttle || 0,
		fuel: f.fuel, litres: f.fuel * ( S.litres || FUEL.litres ), endurance: f.engineOn && burn > 0 ? f.fuel / burn / 60 : null,
		hp: sp.hp, flapPos: f.flapPos, flaps: f.flaps, notches: f.notches || 2, trim: pilot.trim, name: S.name || 'Jade', engineOut: !! ( f.engineFail && f.engineFail.some( Boolean ) ),
		master: sys.master, engineOn: f.engineOn, cranking: sys.cranking, nav: sys.nav, landing: sys.landing, ap: sys.apOn,
		stall: sys.stallWarn, warn: sys.master && sys.masterWarn, flash: sys.flash, fuelLow: sys.master && sys.fuelLow,
		rudderDown: sys.rudderDown, airborne: f.airborne, onWater: !! f.onWater,
		engines: n,
		rpm1: turns( 0 ) ? rpm : 0, rpm2: n > 1 && turns( 1 ) ? rpm : 0, out1: !! ef[ 0 ], out2: !! ef[ 1 ],
		oil1: oil( 0 ), oil2: n > 1 ? oil( 1 ) : 0, ff1: turns( 0 ) ? lph / live : 0, ff2: n > 1 && turns( 1 ) ? lph / live : 0,
		turn: - ( f.angular ? f.angular.y : 0 ) * DEG, slip: ( f.beta || 0 ) * DEG, // deg/s (+ right), deg
		gear: !! ( f.geom && f.geom.wheels ), onGround: !! f.grounded, brake: ( f.controls.brake || 0 ) > 0, parkBrake: !! sp.parkBrake,
		groundSpeed: Math.hypot( f.velocity.x, f.velocity.z ),
		bail: ( sp.bailHint && sp.bailHint() ) || '', // (wave 14B: the bail-out hint while high enough for the chute)
		homeBearing: wrap360( Math.atan2( dx, - dz ) * DEG ), homeDist: Math.hypot( dx, dz ),
		hover,
	};

}

// ---------------------------------------------------------------- drawing (plain 2D canvas calls)

const AQUA = '#5fe3d4', AMBER = '#ffb347', RED = '#ff4b3e', GREEN = '#59e08a';
const ASI_BANDS = { white: [ 17, 35 ], green: [ 22, 55 ], amber: [ 55, 70 ], red: 70 };
const clamp = ( v, a, b ) => Math.max( a, Math.min( b, v ) );
let T = JADE.theme; // the theme of the face being drawn (drawPanel sets it)

// a = radians clockwise from twelve o'clock
function polar( cx, cy, r, a ) {

	return [ cx + r * Math.sin( a ), cy - r * Math.cos( a ) ];

}

function text( ctx, s, x, y, px, color = T.ink, w = 700, align = 'center' ) {

	ctx.font = `${ w } ${ Math.round( px * 10 ) / 10 }px ${ T.font }`;
	ctx.fillStyle = color;
	ctx.textAlign = align;
	ctx.textBaseline = 'middle';
	ctx.fillText( s, x, y );

}

function circle( ctx, cx, cy, r, color ) {

	ctx.beginPath();
	ctx.arc( cx, cy, r, 0, Math.PI * 2 );
	ctx.fillStyle = color;
	ctx.fill();

}

// the dial's bezel (a coloured rim on the themes that have one) and its face
function dial( ctx, cx, cy, r ) {

	if ( T.ring ) circle( ctx, cx, cy, r + 7, T.ring );
	circle( ctx, cx, cy, r + 4, T.bezel );
	circle( ctx, cx, cy, r, T.face );

}

function ticks( ctx, cx, cy, r, a0, a1, n, len, width = 2, color = T.ink ) {

	ctx.strokeStyle = color;
	ctx.lineWidth = width;
	ctx.lineCap = 'butt';
	ctx.beginPath();
	for ( let i = 0; i <= n; i ++ ) {

		const a = n ? a0 + ( a1 - a0 ) * i / n : a0;
		const [ x1, y1 ] = polar( cx, cy, r, a ), [ x2, y2 ] = polar( cx, cy, r - len, a );
		ctx.moveTo( x1, y1 );
		ctx.lineTo( x2, y2 );

	}

	ctx.stroke();

}

function arcBand( ctx, cx, cy, r, a0, a1, color, width ) {

	ctx.strokeStyle = color;
	ctx.lineWidth = width;
	ctx.lineCap = 'butt';
	ctx.beginPath();
	ctx.arc( cx, cy, r, a0 - Math.PI / 2, a1 - Math.PI / 2 );
	ctx.stroke();

}

function needle( ctx, cx, cy, a, len, width, color = T.needle, tail = 12 ) {

	const [ x1, y1 ] = polar( cx, cy, len, a ), [ x0, y0 ] = polar( cx, cy, - tail, a );
	ctx.strokeStyle = color;
	ctx.lineWidth = width;
	ctx.lineCap = 'round';
	ctx.beginPath();
	ctx.moveTo( x0, y0 );
	ctx.lineTo( x1, y1 );
	ctx.stroke();
	circle( ctx, cx, cy, width + 2, T.hub );

}

function rrect( ctx, x, y, w, h, r ) {

	ctx.beginPath();
	ctx.moveTo( x + r, y );
	ctx.lineTo( x + w - r, y );
	ctx.arcTo( x + w, y, x + w, y + r, r );
	ctx.lineTo( x + w, y + h - r );
	ctx.arcTo( x + w, y + h, x + w - r, y + h, r );
	ctx.lineTo( x + r, y + h );
	ctx.arcTo( x, y + h, x, y + h - r, r );
	ctx.lineTo( x, y + r );
	ctx.arcTo( x, y, x + r, y, r );
	ctx.closePath();

}

function box( ctx, x, y, w, h, color, r = 8 ) {

	rrect( ctx, x, y, w, h, r );
	ctx.fillStyle = color;
	ctx.fill();

}

function drawASI( ctx, it, s ) {

	const { cx, cy, r } = it, k = r / 70, MAX = it.max || 80, B = it.bands || ASI_BANDS;
	dial( ctx, cx, cy, r );
	const A0 = - 150 / DEG, A1 = 150 / DEG;
	const ang = ( v ) => A0 + ( A1 - A0 ) * clamp( v / MAX, 0, 1 );
	// white: the flap range, green: normal, amber: caution, the red line
	arcBand( ctx, cx, cy, r - 6 * k, ang( B.white[ 0 ] ), ang( B.white[ 1 ] ), T.ink, 5 * k );
	arcBand( ctx, cx, cy, r - 12 * k, ang( B.green[ 0 ] ), ang( B.green[ 1 ] ), GREEN, 5 * k );
	arcBand( ctx, cx, cy, r - 12 * k, ang( B.amber[ 0 ] ), ang( B.amber[ 1 ] ), AMBER, 5 * k );
	ticks( ctx, cx, cy, r - 2, A0, A1, Math.round( MAX / 5 ), 7 * k, 2 );
	ticks( ctx, cx, cy, r - 2, ang( B.red ), ang( B.red ), 0, 16 * k, 4 * k, RED );
	for ( let v = 0; v <= MAX; v += 20 ) {

		const [ x, y ] = polar( cx, cy, r - 31 * k, ang( v ) );
		text( ctx, String( v ), x, y, 17 * k );

	}

	text( ctx, 'm/s', cx, cy - 24 * k, 13 * k, T.dim, 600 );
	text( ctx, `${ Math.round( s.airspeed * KT ) } kt`, cx, cy + 30 * k, 17 * k, AQUA );
	needle( ctx, cx, cy, ang( s.airspeed ), r - 12 * k, 4 * k, T.needle, 12 * k );

}

function drawATT( ctx, it, s ) {

	const { cx, cy, r } = it, k = r / 70;
	if ( T.ring ) circle( ctx, cx, cy, r + 7, T.ring );
	circle( ctx, cx, cy, r + 4, T.bezel );
	ctx.save();
	ctx.beginPath();
	ctx.arc( cx, cy, r, 0, Math.PI * 2 );
	ctx.clip();
	ctx.translate( cx, cy );
	// banking right turns the horizon the other way; pitching up lowers it
	ctx.rotate( - s.bank / DEG );
	const kp = 2.4 * k; // px per degree of pitch
	const off = clamp( s.pitch, - 40, 40 ) * kp;
	ctx.fillStyle = '#2f7fc1';
	ctx.fillRect( - r * 2, - r * 3 + off, r * 4, r * 3 );
	ctx.fillStyle = '#7a4f2a';
	ctx.fillRect( - r * 2, off, r * 4, r * 3 );
	ctx.strokeStyle = T.ink;
	ctx.lineWidth = 2.5;
	ctx.beginPath();
	ctx.moveTo( - r * 2, off );
	ctx.lineTo( r * 2, off );
	ctx.stroke();
	// the pitch ladder every 5 degrees, numbered at 10 and 20
	ctx.lineWidth = 2;
	for ( let p = - 20; p <= 20; p += 5 ) {

		if ( ! p ) continue;
		const y = off - p * kp, half = ( p % 10 === 0 ? 24 : 12 ) * k;
		ctx.strokeStyle = T.ink;
		ctx.beginPath();
		ctx.moveTo( - half, y );
		ctx.lineTo( half, y );
		ctx.stroke();
		if ( p % 10 === 0 ) {

			text( ctx, String( Math.abs( p ) ), - half - 13 * k, y, 13 * k );
			text( ctx, String( Math.abs( p ) ), half + 13 * k, y, 13 * k );

		}

	}

	// the bank pointer turns with the horizon
	ctx.fillStyle = T.ink;
	ctx.beginPath();
	ctx.moveTo( 0, - r + 14 * k );
	ctx.lineTo( - 7 * k, - r + 26 * k );
	ctx.lineTo( 7 * k, - r + 26 * k );
	ctx.closePath();
	ctx.fill();
	ctx.restore();
	// the fixed bank scale, its index and the little plane
	for ( const b of [ - 60, - 30, - 20, - 10, 10, 20, 30, 60 ] ) ticks( ctx, cx, cy, r - 2, b / DEG, b / DEG, 0, ( b % 30 === 0 ? 12 : 7 ) * k, 2.5 );
	ctx.fillStyle = AMBER;
	ctx.beginPath();
	ctx.moveTo( cx, cy - r + 13 * k );
	ctx.lineTo( cx - 7 * k, cy - r + 2 );
	ctx.lineTo( cx + 7 * k, cy - r + 2 );
	ctx.closePath();
	ctx.fill();
	ctx.strokeStyle = AMBER;
	ctx.lineWidth = 5 * k;
	ctx.lineCap = 'round';
	ctx.beginPath();
	ctx.moveTo( cx - 42 * k, cy );
	ctx.lineTo( cx - 16 * k, cy );
	ctx.lineTo( cx - 8 * k, cy + 9 * k );
	ctx.moveTo( cx + 42 * k, cy );
	ctx.lineTo( cx + 16 * k, cy );
	ctx.lineTo( cx + 8 * k, cy + 9 * k );
	ctx.stroke();
	circle( ctx, cx, cy, 3.5 * k, AMBER );
	ctx.beginPath();
	ctx.arc( cx, cy, r + 2, 0, Math.PI * 2 );
	ctx.strokeStyle = T.bezel;
	ctx.lineWidth = 6;
	ctx.stroke();

}

function drawALT( ctx, it, s ) {

	const { cx, cy, r } = it, k = r / 70;
	dial( ctx, cx, cy, r );
	ticks( ctx, cx, cy, r - 2, 0, Math.PI * 2, 50, 6 * k, 1.5 );
	ticks( ctx, cx, cy, r - 2, 0, Math.PI * 2, 10, 12 * k, 3 );
	for ( let i = 0; i < 10; i ++ ) {

		const [ x, y ] = polar( cx, cy, r - 26 * k, i / 10 * Math.PI * 2 );
		text( ctx, String( i ), x, y, 18 * k );

	}

	text( ctx, 'x10 m', cx, cy - 22 * k, 12 * k, T.dim, 600 );
	text( ctx, `${ Math.round( s.alt ) } m`, cx, cy + 28 * k, 17 * k, AQUA );
	// the short needle turns once per 1000 m, the long one once per 100 m
	needle( ctx, cx, cy, s.alt / 1000 * Math.PI * 2, r - 34 * k, 6 * k, T.needle, 8 * k );
	needle( ctx, cx, cy, s.alt / 100 * Math.PI * 2, r - 10 * k, 3.5 * k, T.needle, 12 * k );

}

// the tachometer (rpm, the throttle lever's arc); `title` names it, `sub` replaces the throttle line (a dead engine)
function drawRPM( ctx, it, rpm, thr, title, sub = null ) {

	const { cx, cy, r } = it, k = r / 70;
	dial( ctx, cx, cy, r );
	const A0 = - 135 / DEG, A1 = 135 / DEG, MAX = 2500;
	const ang = ( v ) => A0 + ( A1 - A0 ) * clamp( v / MAX, 0, 1 );
	arcBand( ctx, cx, cy, r - 8 * k, ang( 600 ), ang( 2200 ), GREEN, 5 * k );
	ticks( ctx, cx, cy, r - 2, A0, A1, 25, 6 * k, 1.5 );
	ticks( ctx, cx, cy, r - 2, A0, A1, 5, 12 * k, 3 );
	ticks( ctx, cx, cy, r - 2, ang( 2300 ), ang( 2300 ), 0, 16 * k, 4 * k, RED );
	for ( let v = 0; v <= 25; v += 5 ) {

		const [ x, y ] = polar( cx, cy, r - 28 * k, ang( v * 100 ) );
		text( ctx, String( v ), x, y, Math.max( 9, 16 * k ) );

	}

	// the throttle lever's position: an inner arc
	arcBand( ctx, cx, cy, r - 44 * k, A0, A1, '#2a3236', 6 * k );
	if ( thr > 0.005 ) arcBand( ctx, cx, cy, r - 44 * k, A0, A0 + ( A1 - A0 ) * clamp( thr, 0, 1 ), AQUA, 6 * k );
	text( ctx, title, cx, cy - 16 * k, Math.max( 8, 12 * k ), T.dim, 600 );
	if ( sub ) text( ctx, sub, cx, cy + 36 * k, Math.max( 9, 15 * k ), RED, 800 );
	else text( ctx, `THR ${ Math.round( thr * 100 ) }%`, cx, cy + 36 * k, Math.max( 9, 15 * k ), AQUA );
	needle( ctx, cx, cy, ang( rpm ), r - 12 * k, Math.max( 2.5, 4 * k ), T.needle, 12 * k );

}

function drawHDG( ctx, it, s ) {

	const { cx, cy, r } = it, k = r / 70;
	dial( ctx, cx, cy, r );
	ctx.save();
	ctx.translate( cx, cy );
	ctx.rotate( - s.heading / DEG );
	for ( let d = 0; d < 360; d += 10 ) {

		const a = d / DEG, maj = d % 30 === 0;
		const [ x1, y1 ] = polar( 0, 0, r - 3, a ), [ x2, y2 ] = polar( 0, 0, r - ( maj ? 14 : 8 ) * k, a );
		ctx.strokeStyle = T.ink;
		ctx.lineWidth = maj ? 2.5 : 1.5;
		ctx.beginPath();
		ctx.moveTo( x1, y1 );
		ctx.lineTo( x2, y2 );
		ctx.stroke();
		if ( maj ) {

			const card = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[ d ];
			const [ x, y ] = polar( 0, 0, r - 27 * k, a );
			ctx.save();
			ctx.translate( x, y );
			ctx.rotate( a );
			text( ctx, card || String( d / 10 ), 0, 0, ( card ? 19 : 14 ) * k, card === 'N' ? AMBER : T.ink );
			ctx.restore();

		}

	}

	ctx.restore();
	// the lubber line and the little plane
	ctx.fillStyle = AMBER;
	ctx.beginPath();
	ctx.moveTo( cx, cy - r + 10 * k );
	ctx.lineTo( cx - 6 * k, cy - r - 1 );
	ctx.lineTo( cx + 6 * k, cy - r - 1 );
	ctx.closePath();
	ctx.fill();
	ctx.strokeStyle = AMBER;
	ctx.lineWidth = 4 * k;
	ctx.lineCap = 'round';
	ctx.beginPath();
	ctx.moveTo( cx, cy - 16 * k );
	ctx.lineTo( cx, cy + 14 * k );
	ctx.moveTo( cx - 14 * k, cy - 3 * k );
	ctx.lineTo( cx + 14 * k, cy - 3 * k );
	ctx.moveTo( cx - 6 * k, cy + 12 * k );
	ctx.lineTo( cx + 6 * k, cy + 12 * k );
	ctx.stroke();
	box( ctx, cx - 26 * k, cy + 24 * k, 52 * k, 22 * k, 'rgba(0,0,0,0.6)', 5 * k );
	text( ctx, String( Math.round( s.heading ) % 360 ).padStart( 3, '0' ) + '°', cx, cy + 35 * k, 15 * k, AQUA );

}

function drawVSI( ctx, it, s ) {

	const { cx, cy, r } = it, k = r / 70;
	dial( ctx, cx, cy, r );
	// zero at nine o'clock, climbing clockwise, +-10 m/s
	const ang = ( v ) => - Math.PI / 2 + clamp( v / 10, - 1, 1 ) * ( 165 / DEG );
	ticks( ctx, cx, cy, r - 2, ang( - 10 ), ang( 10 ), 20, 7 * k, 1.5 );
	ticks( ctx, cx, cy, r - 2, ang( - 10 ), ang( 10 ), 4, 13 * k, 3 );
	for ( const v of [ - 10, - 5, 0, 5, 10 ] ) {

		const [ x, y ] = polar( cx, cy, r - 28 * k, ang( v ) );
		text( ctx, String( Math.abs( v ) ), x, y, 16 * k );

	}

	text( ctx, 'UP', cx + 8 * k, cy - 30 * k, 12 * k, T.dim, 600 );
	text( ctx, 'DN', cx + 8 * k, cy + 30 * k, 12 * k, T.dim, 600 );
	text( ctx, 'm/s', cx + 28 * k, cy, 12 * k, T.dim, 600 );
	needle( ctx, cx, cy, ang( s.vs ), r - 12 * k, 4 * k, T.needle, 12 * k );

}

// the turn coordinator: a little plane tilting with the rate of turn (the standard-rate mark: 3 deg/s, a full circle in
// two minutes) and the slip ball in its tube
function drawTC( ctx, it, s ) {

	const { cx, cy, r } = it, k = r / 70;
	dial( ctx, cx, cy, r );
	const STD = 20 / DEG;
	ticks( ctx, cx, cy, r - 2, Math.PI / 2, Math.PI / 2, 0, 12 * k, 3 );
	ticks( ctx, cx, cy, r - 2, - Math.PI / 2, - Math.PI / 2, 0, 12 * k, 3 );
	ticks( ctx, cx, cy, r - 2, Math.PI / 2 + STD, Math.PI / 2 + STD, 0, 14 * k, 4, T.ink );
	ticks( ctx, cx, cy, r - 2, - Math.PI / 2 - STD, - Math.PI / 2 - STD, 0, 14 * k, 4, T.ink );
	text( ctx, 'L', ...polar( cx, cy, r - 24 * k, - Math.PI / 2 - STD - 0.3 ), 14 * k );
	text( ctx, 'R', ...polar( cx, cy, r - 24 * k, Math.PI / 2 + STD + 0.3 ), 14 * k );
	text( ctx, 'TURN', cx, cy - 32 * k, 11 * k, T.dim, 600 );
	// the plane: wings level at no turn, on the mark at 3 deg/s
	ctx.save();
	ctx.translate( cx, cy );
	ctx.rotate( clamp( ( s.turn || 0 ) / 3, - 1.6, 1.6 ) * STD );
	ctx.strokeStyle = T.needle;
	ctx.lineWidth = 5 * k;
	ctx.lineCap = 'round';
	ctx.beginPath();
	ctx.moveTo( - 46 * k, 0 );
	ctx.lineTo( 46 * k, 0 );
	ctx.moveTo( 0, - 3 * k );
	ctx.lineTo( 0, - 14 * k );
	ctx.stroke();
	circle( ctx, 0, 0, 7 * k, T.needle );
	ctx.restore();
	// the slip ball
	const ty = cy + 26 * k, tw = 36 * k;
	box( ctx, cx - tw, ty - 7 * k, tw * 2, 14 * k, '#000', 7 * k );
	ctx.fillStyle = T.dim;
	ctx.fillRect( cx - 8 * k, ty - 8 * k, 2, 16 * k );
	ctx.fillRect( cx + 8 * k - 2, ty - 8 * k, 2, 16 * k );
	circle( ctx, cx + clamp( - ( s.slip || 0 ) * 2.5 * k, - tw + 7 * k, tw - 7 * k ), ty, 6 * k, T.ink );
	text( ctx, '2 MIN', cx, cy + 46 * k, 10 * k, T.dim, 600 );

}

// float / hull trim: the attitude on the water, the step's band green (a parked needle off the water)
function drawFTrim( ctx, it, s ) {

	const { cx, cy, r } = it, k = r / 70;
	dial( ctx, cx, cy, r );
	const A0 = - 120 / DEG, A1 = 120 / DEG;
	const ang = ( p ) => A0 + ( A1 - A0 ) * clamp( ( p + 5 ) / 20, 0, 1 );
	arcBand( ctx, cx, cy, r - 8 * k, ang( 3 ), ang( 8 ), GREEN, 6 * k );
	arcBand( ctx, cx, cy, r - 8 * k, ang( 8 ), ang( 12 ), AMBER, 6 * k );
	arcBand( ctx, cx, cy, r - 8 * k, ang( 12 ), ang( 15 ), RED, 6 * k );
	ticks( ctx, cx, cy, r - 2, A0, A1, 20, 6 * k, 1.5 );
	ticks( ctx, cx, cy, r - 2, A0, A1, 4, 13 * k, 3 );
	if ( k >= 0.6 ) for ( const p of [ 0, 5, 10, 15 ] ) text( ctx, String( p ), ...polar( cx, cy, r - 28 * k, ang( p ) ), 15 * k );
	else for ( const p of [ 0, 10 ] ) text( ctx, String( p ), ...polar( cx, cy, r - 30 * k, ang( p ) ), 10 );
	text( ctx, it.text || 'FLOATS', cx, cy + 26 * k, Math.max( 8, 12 * k ), T.dim, 700 );
	const water = s.onWater && ! s.airborne;
	const step = water && s.airspeed > 12 && s.pitch > 3 && s.pitch < 8;
	text( ctx, water ? ( step ? 'STEP' : 'TRIM' ) : '--', cx, cy + 44 * k, Math.max( 8, 13 * k ), step ? GREEN : water ? AQUA : T.dim, 800 );
	needle( ctx, cx, cy, ang( water ? s.pitch : 0 ), r - 12 * k, Math.max( 2.5, 4 * k ), water ? T.needle : T.dim, 10 * k );

}

// oil pressure (psi)
function drawOil( ctx, it, s ) {

	const { cx, cy, r } = it, k = r / 70;
	dial( ctx, cx, cy, r );
	const A0 = - 120 / DEG, A1 = 120 / DEG;
	const ang = ( p ) => A0 + ( A1 - A0 ) * clamp( p / 100, 0, 1 );
	arcBand( ctx, cx, cy, r - 6 * k, ang( 25 ), ang( 80 ), GREEN, Math.max( 3, 6 * k ) );
	ticks( ctx, cx, cy, r - 2, ang( 15 ), ang( 15 ), 0, 14 * k, 3, RED );
	ticks( ctx, cx, cy, r - 2, A0, A1, 4, 12 * k, 2 );
	text( ctx, 'OIL', cx, cy + r * 0.5, Math.max( 9, 14 * k ), T.dim, 700 );
	needle( ctx, cx, cy, ang( s[ 'oil' + ( it.eng || 1 ) ] || 0 ), r - 6, 2.5, T.needle, 5 );

}

// a digital readout box
function readout( ctx, it, title, value, unit, color = AQUA ) {

	box( ctx, it.x, it.y, it.w, it.h, '#0b0d0e', 6 );
	const tall = it.h >= 46;
	if ( tall ) {

		text( ctx, title, it.x + it.w / 2, it.y + 10, 10, T.dim, 700 );
		text( ctx, value, it.x + it.w / 2, it.y + it.h / 2 + 1, Math.min( 17, it.w / 2.6 ), color, 700 );
		text( ctx, unit, it.x + it.w / 2, it.y + it.h - 9, 10, T.dim, 600 );

	} else {

		text( ctx, title, it.x + 10, it.y + it.h / 2, 12, T.dim, 700, 'left' );
		text( ctx, `${ value } ${ unit }`, it.x + it.w - 10, it.y + it.h / 2, 16, color, 700, 'right' );

	}

}

function drawFF( ctx, it, s ) {

	const e = it.eng || 1;
	readout( ctx, it, 'FF', String( Math.round( s[ 'ff' + e ] || 0 ) ), 'L/h', s[ 'out' + e ] ? RED : AQUA );

}

function drawGS( ctx, it, s ) {

	readout( ctx, it, 'GS', String( Math.round( ( s.groundSpeed || 0 ) * KT ) ), 'kt' );

}

// a vertical airspeed tape (m/s, the bands down its right edge, the value boxed at the middle, knots below)
function drawTape( ctx, it, s ) {

	const { x, y, w, h } = it;
	box( ctx, x - 3, y - 3, w + 6, h + 6, T.bezel, 9 );
	box( ctx, x, y, w, h, T.face, 7 );
	const top = y + 20, bot = y + h - 26, mid = ( top + bot ) / 2, ppm = 4, v = Math.max( 0, s.airspeed );
	const yOf = ( m ) => mid - ( m - v ) * ppm;
	ctx.save();
	ctx.beginPath();
	ctx.moveTo( x, top );
	ctx.lineTo( x + w, top );
	ctx.lineTo( x + w, bot );
	ctx.lineTo( x, bot );
	ctx.closePath();
	ctx.clip();
	const band = ( a, b, color, bx ) => {

		const ya = yOf( b ), yb = yOf( a );
		ctx.fillStyle = color;
		ctx.fillRect( x + w - bx, ya, 5, yb - ya );

	};

	band( ASI_BANDS.white[ 0 ], ASI_BANDS.white[ 1 ], T.ink, 14 );
	band( ASI_BANDS.green[ 0 ], ASI_BANDS.green[ 1 ], GREEN, 7 );
	band( ASI_BANDS.amber[ 0 ], ASI_BANDS.amber[ 1 ], AMBER, 7 );
	band( ASI_BANDS.red, ASI_BANDS.red + 30, RED, 7 );
	ctx.strokeStyle = T.ink;
	ctx.lineWidth = 2;
	ctx.beginPath();
	const lo = Math.max( 0, Math.floor( v - ( mid - top ) / ppm ) ), hi = Math.ceil( v + ( mid - top ) / ppm );
	for ( let m = lo; m <= hi; m ++ ) {

		const yy = yOf( m ), len = m % 5 === 0 ? 14 : 6;
		ctx.moveTo( x + w - 16 - len, yy );
		ctx.lineTo( x + w - 16, yy );

	}

	ctx.stroke();
	for ( let m = Math.ceil( lo / 10 ) * 10; m <= hi; m += 10 ) text( ctx, String( m ), x + 22, yOf( m ), 15 );
	ctx.restore();
	text( ctx, 'm/s', x + w / 2, y + 10, 11, T.dim, 600 );
	// the pointer box at the middle
	box( ctx, x + 2, mid - 13, w - 18, 26, '#000', 4 );
	ctx.fillStyle = '#000';
	ctx.beginPath();
	ctx.moveTo( x + w - 16, mid - 8 );
	ctx.lineTo( x + w - 6, mid );
	ctx.lineTo( x + w - 16, mid + 8 );
	ctx.closePath();
	ctx.fill();
	text( ctx, String( Math.round( v ) ), x + ( w - 14 ) / 2, mid + 1, 18, s.stall ? RED : AQUA, 800 );
	text( ctx, `${ Math.round( v * KT ) } kt`, x + w / 2, y + h - 12, 13, AQUA );

}

// the wet compass: a card swimming behind a window, the lubber line red
function drawCompass( ctx, it, s ) {

	const { x, y, w, h } = it, cx = x + w / 2, ppd = w / 80;
	box( ctx, x - 3, y - 3, w + 6, h + 6, T.bezel, 10 );
	box( ctx, x, y, w, h, '#1c1a14', 8 );
	ctx.save();
	rrect( ctx, x, y, w, h, 8 );
	ctx.clip();
	ctx.strokeStyle = '#f2ead2';
	ctx.lineWidth = 1.5;
	ctx.beginPath();
	const hd = s.heading;
	for ( let d = Math.floor( ( hd - 45 ) / 5 ) * 5; d <= hd + 45; d += 5 ) {

		const xx = cx + ( d - hd ) * ppd, len = d % 10 === 0 ? 10 : 5;
		ctx.moveTo( xx, y + h - 6 );
		ctx.lineTo( xx, y + h - 6 - len );

	}

	ctx.stroke();
	for ( let d = Math.ceil( ( hd - 45 ) / 30 ) * 30; d <= hd + 45; d += 30 ) {

		const dd = wrap360( d ), card = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[ dd ];
		text( ctx, card || String( dd / 10 ), cx + ( d - hd ) * ppd, y + h / 2 - 6, card ? 18 : 14, card === 'N' ? AMBER : '#f2ead2', 800 );

	}

	ctx.restore();
	ctx.fillStyle = RED;
	ctx.fillRect( cx - 1.5, y + 2, 3, h - 4 );

}

function lampBox( ctx, it, label, lit, color ) {

	box( ctx, it.x, it.y, it.w, it.h, lit ? color : T.lampOff, 6 );
	ctx.strokeStyle = '#000';
	ctx.lineWidth = 2;
	ctx.stroke();
	text( ctx, label, it.x + it.w / 2, it.y + it.h / 2 + 1, Math.min( 15, it.h * 0.36, it.w / 5.2 ), lit ? '#140a05' : T.lampInk, 800 );

}

// the warning lamps (dark without the master)
function drawLamp( ctx, it, s ) {

	const m = s.master;
	switch ( it.lamp ) {

		case 'stall': return lampBox( ctx, it, 'STALL', m && s.stall && s.flash, RED );
		case 'warn': return lampBox( ctx, it, 'WARN', m && s.warn && ( s.flash || s.hp < 50 ), s.hp < 30 ? RED : AMBER );
		case 'fuel': return lampBox( ctx, it, 'FUEL', m && s.fuelLow, AMBER );
		case 'start': return lampBox( ctx, it, 'START', m && s.cranking, AMBER );
		case 'ap': return lampBox( ctx, it, 'AP', m && s.ap, GREEN );
		case 'rudder': return lampBox( ctx, it, s.rudderDown ? 'RUD DN' : 'RUD UP', m && s.rudderDown, GREEN );
		case 'out': return lampBox( ctx, it, `ENG ${ it.eng } OUT`, m && s[ 'out' + it.eng ], RED );
		case 'brake': return lampBox( ctx, it, 'BRAKE', m && ( s.brake || s.parkBrake ), AMBER );

	}

}

function drawBar( ctx, it, s ) {

	const { x, y, w, h } = it, fuel = it.bar === 'fuel';
	const frac = fuel ? s.fuel : s.hp / 100;
	const color = fuel ? ( s.fuel < FUEL.low ? RED : s.fuel < 0.3 ? AMBER : GREEN ) : ( s.hp < 30 ? RED : s.hp < 60 ? AMBER : GREEN );
	box( ctx, x, y, w, h, '#0d1012', 6 );
	const ih = h - 40, fh = ih * clamp( frac, 0, 1 );
	box( ctx, x + 12, y + 8, w - 24, ih, '#20272a', 4 );
	if ( fh > 1 ) {

		ctx.fillStyle = color;
		ctx.fillRect( x + 12, y + 8 + ih - fh, w - 24, fh );

	}

	ctx.fillStyle = 'rgba(0,0,0,0.55)';
	for ( let i = 1; i < 4; i ++ ) ctx.fillRect( x + 12, y + 8 + ih * i / 4, w - 24, 2 );
	const label = it.text || ( fuel ? 'FUEL' : 'HULL' );
	text( ctx, label, x + w / 2, y + h - 23, Math.min( 12, w / ( label.length * 0.75 ) ), T.dim, 700 );
	text( ctx, `${ Math.round( frac * 100 ) }%`, x + w / 2, y + h - 9, 14, T.ink, 700 );

}

function drawFlaps( ctx, it, s ) {

	const { x, y, w, h } = it;
	box( ctx, x, y, w, h, T.plate );
	text( ctx, 'FLAPS', x + w / 2, y + 12, 12, T.plateInk, 800 );
	const top = y + 34, bot = y + h - 22, sx = x + w * 0.305;
	box( ctx, sx - 4, top - 6, 8, bot - top + 12, '#060708', 4 );
	const N = s.notches || 2; // (STOL flaps: a third notch)
	for ( let n = 0; n <= N; n ++ ) {

		const yy = top + ( bot - top ) * n / N;
		text( ctx, [ 'UP', '1', '2', '3' ][ n ], x + w * 0.722, yy, 13, Math.round( s.flaps ) === n ? AQUA : T.dim, 800 );
		ctx.fillStyle = T.dim;
		ctx.fillRect( sx + 8, yy - 1, 8, 2 );

	}

	// the knob shows where the flaps are (the motor follows the lever)
	const ky = top + ( bot - top ) * clamp( s.flapPos, 0, N ) / N;
	box( ctx, sx - 12, ky - 8, 24, 16, '#e8ece8', 4 );

}

function drawTrim( ctx, it, s ) {

	const { x, y, w, h } = it;
	box( ctx, x, y, w, h, T.plate );
	text( ctx, 'TRIM', x + w / 2, y + 12, 12, T.plateInk, 800 );
	// the wheel: ribs that roll with the trim
	const wx = x + w * 0.13, wy = y + 26, ww = w * 0.37, wh = h - 40;
	box( ctx, wx, wy, ww, wh, '#0b0d0e', 10 );
	ctx.save();
	rrect( ctx, wx, wy, ww, wh, 10 );
	ctx.clip();
	const roll = ( ( s.trim * 60 ) % 12 + 12 ) % 12;
	ctx.fillStyle = '#3a4246';
	for ( let yy = wy - 12 + roll; yy < wy + wh + 12; yy += 12 ) ctx.fillRect( wx + 4, yy, ww - 8, 4 );
	ctx.restore();
	// the indicator: nose down at the top, nose up at the bottom
	const ix = x + w * 0.674, top = y + 34, bot = y + h - 18;
	ctx.fillStyle = '#060708';
	ctx.fillRect( ix - 2, top, 4, bot - top );
	ctx.fillStyle = T.dim;
	ctx.fillRect( ix - 8, ( top + bot ) / 2 - 1, 16, 2 );
	const ty = ( top + bot ) / 2 + clamp( s.trim, - 1, 1 ) * ( bot - top ) / 2;
	ctx.fillStyle = AQUA;
	ctx.beginPath();
	ctx.moveTo( ix + 4, ty );
	ctx.lineTo( ix + 16, ty - 7 );
	ctx.lineTo( ix + 16, ty + 7 );
	ctx.closePath();
	ctx.fill();
	text( ctx, 'DN', ix + 4, top - 9, 10, T.dim, 700 );
	text( ctx, 'UP', ix + 4, bot + 9, 10, T.dim, 700 );

}

function fmtDist( m ) {

	return m < 1000 ? `${ Math.round( m / 10 ) * 10 } m` : `${ ( m / 1000 ).toFixed( m < 10000 ? 1 : 0 ) } km`;

}

// the radio: bearing / distance home, speed, fuel, endurance; a click opens the map (a narrow box stacks the lines)
function drawRadio( ctx, it, s ) {

	const { x, y, w, h } = it, g = T.screenInk;
	const brg = `${ String( Math.round( s.homeBearing ) % 360 ).padStart( 3, '0' ) }°`;
	box( ctx, x, y, w, h, T.plate );
	if ( w >= 150 ) {

		box( ctx, x + 8, y + 8, w - 16, 92, s.master ? T.screen : '#0a0d0c', 6 );
		if ( s.master ) {

			text( ctx, `HOME ${ brg }`, x + 16, y + 26, 16, g, 700, 'left' );
			text( ctx, fmtDist( s.homeDist ), x + w - 16, y + 26, 16, g, 700, 'right' );
			text( ctx, `GS ${ Math.round( s.airspeed * KT ) } kt`, x + 16, y + 52, 16, g, 600, 'left' );
			text( ctx, `${ Math.round( s.litres ) } L`, x + w - 16, y + 52, 16, g, 600, 'right' );
			text( ctx, s.endurance === null ? 'ENDUR --' : `ENDUR ${ Math.floor( s.endurance ) } min`, x + 16, y + 78, 16, g, 600, 'left' );

		}

		box( ctx, x + 8, y + 106, w - 16, 28, '#262c30', 6 );
		text( ctx, it.brand ? `${ it.brand }  ·  MAP (M)` : 'MAP  (M)', x + w / 2, y + 120, 14, '#eef2ee', 800 );
		return;

	}

	const sh = h - 70, px = Math.min( 15, ( w - 12 ) / 8.2, sh / 5.2 );
	box( ctx, x + 6, y + 6, w - 12, sh, s.master ? T.screen : '#0a0d0c', 5 );
	if ( s.master ) {

		const lines = [ `HOME ${ brg }`, fmtDist( s.homeDist ), `${ Math.round( s.airspeed * KT ) } kt  ${ Math.round( s.litres ) } L`, s.endurance === null ? 'END --' : `END ${ Math.floor( s.endurance ) } min` ];
		if ( it.bail && s.bail ) lines[ 3 ] = s.bail; // (the panels without a wide placard: the bail-out hint on the screen)
		lines.forEach( ( l, i ) => fitText( ctx, l, x + w / 2, y + 6 + sh * ( i + 0.5 ) / lines.length, px, w - 16, i === 3 && it.bail && s.bail ? AMBER : g ) );

	}

	text( ctx, it.brand || 'RADIO', x + w / 2, y + h - 50, 11, T.plateInk, 800 );
	box( ctx, x + 6, y + h - 38, w - 12, 30, '#262c30', 6 );
	text( ctx, 'MAP (M)', x + w / 2, y + h - 23, 13, '#eef2ee', 800 );

}

// a toggle switch (lever up = on); the sizes follow the box (the Jade's 98 x 102 is the scale)
function drawSwitch( ctx, it, s ) {

	const { x, y, w, h } = it, k = h / 102;
	const on = !! s[ it.state ];
	box( ctx, x, y, w, h, T.plate );
	text( ctx, it.text, x + w / 2, y + 15 * k, Math.min( 14, w * 0.17 ), T.plateInk, 800 );
	const cx = x + w / 2, cy = y + 64 * k, bw = Math.min( 32, w * 0.42 ), lw = bw * 0.44;
	circle( ctx, cx, y + 32 * k, Math.max( 3, 5 * k ), on ? ( it.state === 'parkBrake' ? AMBER : GREEN ) : '#2b3134' );
	box( ctx, cx - bw / 2, cy - 20 * k, bw, 40 * k, '#0a0c0d' );
	box( ctx, cx - lw / 2, on ? cy - 26 * k : cy - 4 * k, lw, 30 * k, '#c9d1d3', Math.min( 6, lw / 2 ) );
	const sub = it.sub || ( on ? 'on' : 'off' );
	if ( h >= 80 ) text( ctx, sub, cx, y + h - 9, 11, T.dim, 700 );

}

function drawEngine( ctx, it, s ) {

	const { x, y, w, h } = it, k = h / 102;
	box( ctx, x, y, w, h, T.plate );
	text( ctx, it.text || 'ENGINE', x + w / 2, y + 15 * k, Math.min( 14, w * 0.17 ), T.plateInk, 800 );
	const cx = x + w / 2, cy = y + 58 * k, r = Math.min( 22 * k, w / 2 - 9 );
	circle( ctx, cx, cy, r + 5, '#0a0c0d' );
	circle( ctx, cx, cy, r, s.engineOn ? '#b3261e' : s.cranking ? ( s.flash ? AMBER : '#8a5a1a' ) : '#2e7d4f' );
	text( ctx, s.engineOn ? 'STOP' : s.cranking ? '...' : 'START', cx, cy + 1, Math.min( 13, r * 0.6 ), '#fff', 800 );
	if ( h >= 80 ) text( ctx, s.engineOn ? 'running' : s.cranking ? 'cranking' : 'off', cx, y + h - 9, 11, T.dim, 700 );

}

// a twin's feather / restart switch under a red guard: up runs, down feathers the propeller
function drawFeather( ctx, it, s ) {

	const { x, y, w, h } = it, out = !! s[ 'out' + it.eng ];
	box( ctx, x, y, w, h, T.plate );
	text( ctx, `FEATHER ${ it.eng }`, x + w / 2, y + 11, 12, T.plateInk, 800 );
	const cx = x + w * 0.3, cy = y + 44;
	rrect( ctx, cx - 19, cy - 22, 38, 44, 6 );
	ctx.strokeStyle = '#a3241b';
	ctx.lineWidth = 3;
	ctx.stroke();
	box( ctx, cx - 14, cy - 17, 28, 34, '#0a0c0d' );
	box( ctx, cx - 6, out ? cy - 2 : cy - 22, 12, 24, '#c9d1d3', 5 );
	circle( ctx, x + w * 0.72, y + 36, 9, s.master ? ( out ? RED : GREEN ) : '#2b3134' );
	text( ctx, out ? 'FEATH' : 'RUN', x + w * 0.72, y + 56, 11, out ? RED : T.dim, 800 );
	text( ctx, out ? 'click: restart' : 'click: feather', x + w / 2, y + h - 8, 10, T.dim, 600 );

}

// the Kestrel's gear: a wheel-knobbed lever, fixed down, and its three greens (nose, left, right)
function drawGear( ctx, it, s ) {

	const { x, y, w, h } = it;
	box( ctx, x, y, w, h, T.plate );
	text( ctx, 'GEAR  ·  FIXED', x + w / 2, y + 11, 11, T.plateInk, 800 );
	const lx = x + 26;
	box( ctx, lx - 4, y + 22, 8, h - 30, '#060708', 4 );
	text( ctx, 'UP', lx + 18, y + 26, 9, T.dim, 700 );
	text( ctx, 'DN', lx + 18, y + h - 12, 9, AQUA, 800 );
	circle( ctx, lx, y + h - 14, 10, '#e8ece8' );
	circle( ctx, lx, y + h - 14, 4, '#3a4246' );
	const lit = s.master;
	for ( const [ dx, dy ] of [ [ 92, 32 ], [ 72, 56 ], [ 112, 56 ] ] ) {

		circle( ctx, x + dx, y + dy, 10, '#000' );
		circle( ctx, x + dx, y + dy, 8, lit ? GREEN : T.lampOff );

	}

}

function drawPlate( ctx, it ) {

	box( ctx, it.x, it.y, it.w, it.h, T.plate, 10 );
	if ( it.title ) text( ctx, it.title, it.x + it.w / 2, it.y + 13, 11, T.plateInk, 800 );

}

// a fitted line of text (shrinks to the width it has)
function fitText( ctx, s, x, y, px, maxW, color, w = 700 ) {

	text( ctx, s, x, y, Math.max( 7, Math.min( px, maxW / Math.max( 1, s.length * 0.58 ) ) ), color, w );

}

// a placard; one marked `bail` prints the bail-out hint while there is one
function drawPlacard( ctx, it, s ) {

	box( ctx, it.x, it.y, it.w, it.h, T.placard, 3 );
	const lines = it.bail && s && s.bail ? [ s.bail ] : it.lines;
	const n = lines.length;
	lines.forEach( ( l, i ) => fitText( ctx, l, it.x + it.w / 2, it.y + it.h * ( i + 0.5 ) / n + 0.5, it.px || 11, it.w - 8, lines === it.lines ? T.placardInk : '#a3241b' ) );

}

const DRAW = {
	asi: drawASI, att: drawATT, alt: drawALT, hdg: drawHDG, vsi: drawVSI, tc: drawTC, ftrim: drawFTrim, oil: drawOil,
	rpm: ( ctx, it, s ) => drawRPM( ctx, it, s.rpm, s.throttle, 'rpm x100' ),
	erpm: ( ctx, it, s ) => drawRPM( ctx, it, s[ 'rpm' + it.eng ] || 0, s.throttle, `ENG ${ it.eng }`, s[ 'out' + it.eng ] ? 'OUT' : null ),
	tape: drawTape, compass: drawCompass, ff: drawFF, gs: drawGS, lamp: drawLamp, bar: drawBar, flaps: drawFlaps, trim: drawTrim,
	radio: drawRadio, switch: drawSwitch, engine: drawEngine, feather: drawFeather, gear: drawGear, plate: drawPlate, placard: drawPlacard,
};

// a fixed pseudo-random sequence (the paint's texture is the same every redraw)
function rng( seed ) {

	let a = seed >>> 0;
	return () => {

		a = ( a + 0x6d2b79f5 ) >>> 0;
		let q = Math.imul( a ^ ( a >>> 15 ), 1 | a );
		q = ( q + Math.imul( q ^ ( q >>> 7 ), 61 | q ) ) ^ q;
		return ( ( q ^ ( q >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}

function rgba( hex, a ) {

	const n = parseInt( hex.slice( 1 ), 16 );
	return `rgba(${ ( n >> 16 ) & 255 },${ ( n >> 8 ) & 255 },${ n & 255 },${ a })`;

}

// the bare paint (its alpha: the share of the night glow) and its finish
function drawPaint( ctx, L ) {

	const th = L.theme, W = L.w, H = L.h;
	ctx.globalCompositeOperation = 'copy';
	ctx.fillStyle = rgba( th.paint, th.glow );
	ctx.fillRect( 0, 0, W, H );
	ctx.globalCompositeOperation = 'source-over';
	ctx.fillStyle = th.grainColor;
	ctx.strokeStyle = th.grainColor;
	const r = rng( W * 7 + H );
	if ( th.grain === 'lines' ) for ( let y = 0; y < H; y += 14 ) ctx.fillRect( 0, y, W, 1 );
	else if ( th.grain === 'grain' ) for ( let i = 0; i < 220; i ++ ) ctx.fillRect( r() * W, r() * H, 6 + r() * 30, 1 );
	else if ( th.grain === 'wrinkle' ) for ( let i = 0; i < 420; i ++ ) ctx.fillRect( r() * W, r() * H, 2, 2 );
	else if ( th.grain === 'crackle' ) {

		ctx.lineWidth = 1;
		ctx.beginPath();
		for ( let i = 0; i < 170; i ++ ) {

			let x = r() * W, y = r() * H;
			ctx.moveTo( x, y );
			for ( let j = 0; j < 3; j ++ ) {

				x += ( r() - 0.5 ) * 22;
				y += ( r() - 0.5 ) * 22;
				ctx.lineTo( x, y );

			}

		}

		ctx.stroke();

	}

}

export function drawPanel( ctx, s, layout = null ) {

	const L = layout || layoutFor( s.af );
	T = L.theme;
	drawPaint( ctx, L );
	for ( const it of L.items ) {

		const fn = DRAW[ it.kind ];
		if ( fn ) fn( ctx, it, s );

	}

	// the hovered control
	const c = s.hover ? L.controls.find( ( k ) => k.id === s.hover ) : null;
	if ( c ) {

		rrect( ctx, c.x - 3, c.y - 3, c.w + 6, c.h + 6, 9 );
		ctx.strokeStyle = AQUA;
		ctx.lineWidth = 4;
		ctx.stroke();

	}

}

// ---------------------------------------------------------------- the DOM bits (tooltip, aim dot, chase strip)

const CSS = /* css */`
.sp-tip { position: absolute; left: 50%; top: 50%; transform: translate(-50%, calc(18 * var(--tw-u))); padding: calc(4 * var(--tw-u)) calc(10 * var(--tw-u));
	border-radius: 999px; font: 600 var(--tw-fs-sm) var(--tw-font); color: var(--tw-ink); white-space: nowrap; pointer-events: none; opacity: 0;
	transition: opacity var(--tw-fast) var(--tw-ease); z-index: 5; }
.sp-tip.is-on { opacity: 1; }
.sp-tip kbd { margin-left: calc(6 * var(--tw-u)); font: 600 var(--tw-fs-xs) var(--tw-mono); padding: 0 calc(5 * var(--tw-u)); border-radius: 4px; background: var(--tw-fill-2); }
.sp-dot { position: absolute; left: 50%; top: 50%; width: 5px; height: 5px; margin: -2.5px; border-radius: 50%; background: rgba(255,255,255,0.8);
	box-shadow: 0 0 3px rgba(0,0,0,0.7); pointer-events: none; opacity: 0; transition: opacity var(--tw-fast); }
.sp-dot.is-on { opacity: 1; }
.sp-dot.is-hot { background: var(--tw-aqua); }
.sp-strip { position: absolute; left: var(--tw-edge); bottom: var(--tw-edge); display: flex; gap: var(--tw-2);
	padding: var(--tw-2) var(--tw-3); border-radius: calc(16 * var(--tw-u)); pointer-events: none; opacity: 0; transform: translateY(calc(10 * var(--tw-u)));
	transition: opacity var(--tw-slow) var(--tw-ease), transform var(--tw-slow) var(--tw-ease); }
.sp-strip.is-on { opacity: 1; transform: none; }
.sp-cell { display: flex; flex-direction: column; align-items: flex-start; min-width: calc(54 * var(--tw-u)); padding: 0 var(--tw-2); }
.sp-cell + .sp-cell { border-left: 1px solid var(--tw-line); }
.sp-cell span { font: 600 var(--tw-fs-xs) var(--tw-font); letter-spacing: 0.08em; text-transform: uppercase; color: var(--tw-ink-3); }
.sp-cell b { font: 600 var(--tw-fs-md) var(--tw-mono); color: var(--tw-ink); white-space: nowrap; }
.sp-cell b small { font-size: var(--tw-fs-xs); color: var(--tw-ink-3); margin: 0 2px; }
.sp-cell.is-warn b { color: var(--tw-coral); }
.sp-strip:not([data-bail=""])::after { content: attr(data-bail); align-self: center; padding-left: var(--tw-2); border-left: 1px solid var(--tw-line);
	font: 600 var(--tw-fs-xs) var(--tw-font); color: var(--tw-ink-2); white-space: nowrap; }
.sp-strip[data-bail=""]::after, .sp-strip:not([data-bail])::after { content: none; }
.tw-root.is-touch .sp-strip { left: 50%; bottom: auto; top: calc(var(--tw-edge) + 40px); translate: -50% 0; scale: 0.8; transform-origin: 50% 0; }
.tw-root.is-photo .sp-strip, .tw-root.is-photo .sp-tip, .tw-root.is-photo .sp-dot { display: none; }
/* first person in the cockpit: the windscreen is clear (toasts and the prompt stay) */
.tw-root.sp-cockpit .tw-tl, .tw-root.sp-cockpit .gm-purse, .tw-root.sp-cockpit .gm-map, .tw-root.sp-cockpit .tw-depth, .tw-root.sp-cockpit .tw-boat {
	opacity: 0 !important; pointer-events: none !important; transition: opacity var(--tw-med) var(--tw-ease); }
`;

let cssInstalled = false;
const STRIP = [ [ 'af', 'Plane' ], [ 'spd', 'Speed' ], [ 'alt', 'Alt' ], [ 'hdg', 'Hdg' ], [ 'thr', 'Thr' ], [ 'fuel', 'Fuel' ] ];

// the strip's cells for a layout: the six of every plane, then the airframe's own (two engines, the gear)
export function stripCells( layout ) {

	return [ ...STRIP, ...( ( layout && layout.strip ) || [] ) ];

}

function makeCanvas( w, h ) {

	if ( typeof OffscreenCanvas !== 'undefined' ) return new OffscreenCanvas( w, h );
	if ( typeof document !== 'undefined' ) return Object.assign( document.createElement( 'canvas' ), { width: w, height: h } );
	return null;

}

// the face before its first draw (and in a run without a canvas): the bare paint
function blankFace( L ) {

	const n = parseInt( L.theme.paint.slice( 1 ), 16 );
	const px = new Uint8Array( L.w * L.h * 4 );
	for ( let i = 0; i < px.length; i += 4 ) {

		px[ i ] = ( n >> 16 ) & 255; px[ i + 1 ] = ( n >> 8 ) & 255; px[ i + 2 ] = n & 255; px[ i + 3 ] = 255;

	}

	return px;

}

const _o = new Vector3(), _dir = new Vector3(), _q = new Quaternion();

// what the face shows, as a string (wave 16C): numbers to 1/100 (a needle moves well under a pixel for that), the rest as
// they are. Equal keys draw the same face.
export function faceKey( snap ) {

	let k = '';
	for ( const n in snap ) {

		const v = snap[ n ];
		k += ( typeof v === 'number' ? Math.round( v * 100 ) : v ) + '|';

	}

	return k;

}

export class Cockpit {

	constructor( sp, { canvas = null } = {} ) {

		this.sp = sp;
		this.app = sp.app || {};
		this.hover = null;
		this.aim = null; // { px, py } where the eye / mouse meets the face (null: not looking at it)
		this.redraws = 0;
		this.skipped = 0; // timed redraws skipped: the face was unchanged (wave 16C)
		this.rebuilds = 0;
		this._acc = 1;
		this._dirty = true;
		this._lmb = false;
		this._mouse = null; // client px of the pointer while it is free
		this._cls = false;
		this.tip = undefined;
		this.layout = layoutFor( sp.af );
		const L = this.layout;
		this.canvas = canvas || makeCanvas( L.w, L.h );
		if ( this.canvas && ( this.canvas.width !== L.w || this.canvas.height !== L.h ) ) {

			this.canvas.width = L.w;
			this.canvas.height = L.h;

		}

		this.ctx = this.canvas && this.canvas.getContext ? this.canvas.getContext( '2d' ) : null;
		this.tex = null;
		this.mesh = null;
		this.material = null;
		const visual = sp.visual;
		if ( visual ) {

			// phones: no mip chain (the face is viewed near 1:1 from the seat; a 10-level rebuild after every redraw cost frames)
			this._phone = !! globalThis.__phoneBudget;
			this.tex = new Texture( { label: 'seaplane.panel', width: L.w, height: L.h, format: 'rgba8unorm-srgb', mips: ! this._phone, usage: [ 'sample', 'copyDst', 'render' ], data: blankFace( L ) } ); // ('render': copyExternalImageToTexture needs RenderAttachment on its destination)
			this.material = standard( {
				name: 'seaplanePanel',
				side: 'double',
				textures: { cpFace: this.tex },
				uniforms: { glow: [ 'f32', 0 ] },
				surface: /* wgsl */`
	let t = textureSample( cpFace, smpAnisoClamp, vec2f( in.uv.x, 1.0 - in.uv.y ) );
	s.albedo = t.rgb;
	s.roughness = 0.55;
	s.metalness = 0.0;
	// backlit markings: a little by day (the cabin's shade), a warm glow at night with the master on; the alpha is
	// the glow mask (the bare paint of a light panel glows less than its markings)
	let nightOn = smoothstep( 0.15, 0.75, frame.night );
	s.emissive = t.rgb * t.a * mat.glow * ( 0.22 + 1.1 * nightOn ) * vec3f( 1.0, 0.86, 0.72 );
`,
			} );
			this.mesh = new Mesh( buildFaceGeometry(), this.material );
			this.mesh.name = 'seaplane-panel';
			this.mesh.castShadow = false;
			this.mesh.receiveShadow = true;
			visual.body.add( this.mesh );
			this._gpu();

		}

		this._onMove = ( e ) => {

			this._mouse = { x: e.clientX, y: e.clientY };

		};

		if ( typeof window !== 'undefined' && window.addEventListener ) window.addEventListener( 'mousemove', this._onMove, { passive: true } );

	}

	_gpu() {

		if ( ! GPU.device || ! this.tex ) return;
		this.tex.getGPU();
		if ( ! this._phone ) generateMipmaps( this.tex );

	}

	// another airframe out: its own face (the canvas and the texture take its size; the quad stays: every model has
	// the same panel housing)
	_setLayout( L ) {

		this.layout = L;
		this.rebuilds ++;
		this.hover = null;
		this.aim = null;
		this._dirty = true;
		this._stripFor = null;
		const c = this.canvas;
		if ( c && ( c.width !== L.w || c.height !== L.h ) ) {

			c.width = L.w;
			c.height = L.h;
			this.ctx = c.getContext ? c.getContext( '2d' ) : null;

		}

		const tx = this.tex;
		if ( tx && ( tx.width !== L.w || tx.height !== L.h ) ) {

			tx.pendingData = blankFace( L );
			if ( tx.gpu ) {

				tx.resize( L.w, L.h ); // (a fresh GPU texture; the material's binding follows its version)
				if ( ! this._phone ) generateMipmaps( tx );

			} else {

				tx.width = L.w;
				tx.height = L.h;

			}

		}

	}

	get firstPerson() {

		const p = this.app.player;
		return !! ( this.sp.piloted && p && p.view === 'first' );

	}

	// ---- per frame

	update( dt ) {

		const sp = this.sp;
		const lay = layoutFor( sp.af );
		if ( lay !== this.layout ) this._setLayout( lay );
		const fp = this.firstPerson;
		const open = !! ( sp.features && sp.features.panelOpen && sp.features.panelOpen() );
		this._setCls( fp );
		if ( sp.piloted !== this._wasPiloted ) {

			this._wasPiloted = sp.piloted;
			this._dirty = true; // (the switched-off panel after climbing out)

		}

		let hover = null;
		if ( fp && ! open ) hover = this._aimAt();
		else this.aim = null;
		const id = hover ? hover.id : null;
		if ( id !== this.hover ) {

			this.hover = id;
			this._dirty = true;

		}

		// a click on a control (the left button's press)
		const inp = this.app.input;
		const lmb = !! ( inp && inp.mouseDown && inp.enabled !== false );
		if ( lmb && ! this._lmb && fp && ! open && hover && hover.act && sp.act ) sp.act( hover.id, 'click' );
		this._lmb = lmb;

		// redraw: ~10 Hz in first person, a few times a second from outside while piloted, once after leaving
		this._acc += dt;
		const rate = this._phone ? ( fp ? 5 : sp.piloted ? 1 : 0 ) : ( fp ? 10 : sp.piloted ? 3 : 0 );
		// wave 16C: a timed redraw is skipped when the face would come out the same (moored, engine off, steady numbers):
		// no canvas drawing, no texture upload, no mip rebuild
		if ( this._dirty ) this.draw();
		else if ( rate && this._acc >= 1 / rate ) {

			const snap = panelSnapshot( sp, this.hover );
			if ( faceKey( snap ) !== this._faceKey ) this.draw( snap );
			else {

				this._acc = 0;
				this.skipped ++;

			}

		}
		if ( this.material ) this.material.uniforms.glow.value = sp.systems.master ? 1 : 0;
		this._dom( fp, hover, open );

	}

	// where the eye (pointer locked, touch) or the free mouse meets the face, and the control there
	_aimAt() {

		const cam = this.app.camera, f = this.sp.flight, inp = this.app.input;
		if ( ! cam ) return null;
		_o.copy( cam.position );
		let ok = false;
		const dom = inp && inp.dom;
		if ( inp && ! inp.locked && ! inp.touchMode && this._mouse && dom && dom.getBoundingClientRect ) {

			const r = dom.getBoundingClientRect();
			if ( r.width > 0 && r.height > 0 ) {

				const nx = ( this._mouse.x - r.left ) / r.width * 2 - 1, ny = - ( ( this._mouse.y - r.top ) / r.height * 2 - 1 );
				if ( cam.updateMatrixWorld ) cam.updateMatrixWorld();
				_dir.set( nx, ny, 0.5 ).unproject( cam ).sub( cam.position ).normalize();
				ok = Number.isFinite( _dir.x );

			}

		}

		if ( ! ok ) _dir.set( 0, 0, - 1 ).applyQuaternion( cam.quaternion );
		// into the model frame
		_q.copy( f.quaternion ).invert();
		_o.sub( f.position ).applyQuaternion( _q );
		_dir.applyQuaternion( _q );
		const hit = rayPanel( _o, _dir, this.layout );
		this.aim = hit;
		return hit ? hitControl( hit.px, hit.py, this.layout ) : null;

	}

	draw( snap = null ) {

		this._acc = 0;
		this._dirty = false;
		this.redraws ++;
		const ctx = this.ctx, L = this.layout;
		if ( ! ctx ) return;
		snap = snap || panelSnapshot( this.sp, this.hover );
		this._faceKey = faceKey( snap );
		drawPanel( ctx, snap, L );
		if ( ! this.tex ) return;
		// straight from the canvas to the texture when the device can (no read-back), else through the pixels
		if ( GPU.device && this.tex.gpu && GPU.queue && GPU.queue.copyExternalImageToTexture && ! this._noCopy ) {

			try {

				GPU.queue.copyExternalImageToTexture( { source: this.canvas }, { texture: this.tex.gpu }, { width: L.w, height: L.h } );
				if ( ! this._phone ) generateMipmaps( this.tex );
				return;

			} catch ( e ) {

				this._noCopy = true;

			}

		}

		if ( ! ctx.getImageData ) return;
		const img = ctx.getImageData( 0, 0, L.w, L.h );
		const data = new Uint8Array( img.data.buffer, img.data.byteOffset, img.data.byteLength );
		if ( GPU.device && this.tex.gpu ) {

			this.tex.upload( data );
			if ( ! this._phone ) generateMipmaps( this.tex );

		} else {

			this.tex.pendingData = data;
			this._gpu();

		}

	}

	// ---- the DOM (lazily, once a HUD exists)

	_ui() {

		const ui = this.app.ui && this.app.ui.ui;
		return ui && ui.root ? ui : null;

	}

	_setCls( on ) {

		if ( on === this._cls ) return;
		const ui = this._ui();
		if ( ! ui ) return;
		this._cls = on;
		ui.root.classList.toggle( 'sp-cockpit', on );

	}

	_ensureDom() {

		if ( this.tip ) return true;
		const ui = this._ui();
		if ( ! ui || typeof document === 'undefined' ) return false;
		if ( ! cssInstalled ) {

			const st = document.createElement( 'style' );
			st.textContent = CSS;
			document.head.append( st );
			cssInstalled = true;

		}

		const host = ui.hud || ui.root;
		this.tip = document.createElement( 'div' );
		this.tip.className = 'sp-tip tw-glass';
		this.dot = document.createElement( 'div' );
		this.dot.className = 'sp-dot';
		this.strip = document.createElement( 'div' );
		this.strip.className = 'sp-strip tw-glass';
		this.strip.setAttribute( 'aria-hidden', 'true' );
		this._stripFor = null;
		host.append( this.tip, this.dot, this.strip );
		return true;

	}

	// the strip's cells for the airframe out (rebuilt when it changes)
	_buildStrip() {

		const cells = stripCells( this.layout );
		this._stripFor = this.layout.id;
		this.strip.innerHTML = cells.map( ( [ k, l ] ) => `<div class="sp-cell" data-k="${ k }"><span>${ t( 'seaplane.strip.' + k, l ) }</span><b>-</b></div>` ).join( '' );
		this.cells = {};
		for ( const [ k ] of cells ) this.cells[ k ] = this.strip.querySelector( `[data-k="${ k }"]` );

	}

	_dom( fp, hover, open ) {

		if ( ! this._ensureDom() ) return;
		if ( this._stripFor !== this.layout.id ) this._buildStrip();
		const sp = this.sp, f = sp.flight, inp = this.app.input;
		// the aim dot and the tooltip, only while the eye is on the panel
		const looking = fp && ! open && !! this.aim;
		const centred = ! inp || inp.locked || inp.touchMode || ! this._mouse;
		this.dot.classList.toggle( 'is-on', looking && centred );
		this.dot.classList.toggle( 'is-hot', !! ( hover && hover.act ) );
		const tipOn = looking && !! hover;
		if ( tipOn && this._tipId !== hover.id ) {

			this._tipId = hover.id;
			this.tip.innerHTML = `${ t( 'seaplane.ctl.' + hover.id, hover.label ) }${ hover.key ? `<kbd>${ hover.key }</kbd>` : '' }`;

		}

		if ( ! tipOn ) this._tipId = null;
		this.tip.classList.toggle( 'is-on', tipOn );
		if ( tipOn && ! centred ) {

			this.tip.style.left = `${ this._mouse.x }px`;
			this.tip.style.top = `${ this._mouse.y }px`;

		} else if ( this.tip.style.left ) {

			this.tip.style.left = '';
			this.tip.style.top = '';

		}

		// the chase view's strip
		const p = this.app.player;
		const on = !! ( sp.piloted && p && p.view !== 'first' && ! open );
		this.strip.classList.toggle( 'is-on', on );
		if ( ! on ) return;
		this._stripN = ( this._stripN || 0 ) + 1;
		if ( this._stripN % 6 !== 1 ) return; // ~10 Hz
		const s = panelSnapshot( sp );
		const set = ( k, html, warn = false ) => {

			const c = this.cells[ k ];
			if ( ! c ) return;
			const b = c.lastChild;
			if ( b._v !== html ) {

				b._v = html;
				b.innerHTML = html;

			}

			c.classList.toggle( 'is-warn', warn );

		};

		set( 'af', s.name + ( s.engineOut ? ' <small>1 eng</small>' : '' ), s.engineOut ); // wave 12: the airframe
		set( 'spd', `${ Math.round( s.airspeed * KT ) }<small>kt</small>${ Math.round( s.airspeed ) }<small>m/s</small>`, s.stall );
		set( 'alt', `${ Math.round( s.alt ) }<small>m</small>` );
		set( 'hdg', `${ String( Math.round( s.heading ) % 360 ).padStart( 3, '0' ) }°` );
		set( 'thr', f.engineOn ? `${ Math.round( s.throttle * 100 ) }<small>%</small>` : sp.systems.cranking ? '...' : t( 'seaplane.strip.off', 'off' ), ! f.engineOn );
		set( 'fuel', `${ Math.round( s.fuel * 100 ) }<small>%</small>`, s.fuel < FUEL.low );
		const bail = s.bail;
		if ( this.strip.dataset && this.strip.dataset.bail !== bail ) this.strip.dataset.bail = bail; // (wave 14B: shown by the CSS)
		// wave 14A: the airframe's own cells
		for ( const e of [ 1, 2 ] ) set( 'rpm' + e, s[ 'out' + e ] ? t( 'seaplane.strip.feathered', 'out' ) : `${ Math.round( s[ 'rpm' + e ] ) }<small>rpm</small>`, s[ 'out' + e ] );
		set( 'gear', `${ t( 'seaplane.strip.down', 'down' ) }${ s.brake || s.parkBrake ? ' <small>brk</small>' : '' }` );
		set( 'gs', `${ Math.round( s.groundSpeed * KT ) }<small>kt</small>` );

	}

	dispose() {

		this._setCls( false );
		if ( typeof window !== 'undefined' && window.removeEventListener ) window.removeEventListener( 'mousemove', this._onMove );
		for ( const el of [ this.tip, this.dot, this.strip ] ) if ( el && el.remove ) el.remove();
		if ( this.mesh ) {

			this.mesh.removeFromParent();
			this.mesh.geometry.dispose();

		}

		if ( this.tex ) this.tex.destroy();

	}

}

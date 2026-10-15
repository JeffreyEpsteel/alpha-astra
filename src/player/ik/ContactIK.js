import {
	vec, quat, set3, copy3, sub3, add3, dist3, unit3, clamp,
	mul4, conj4, rot3, fromUnit4, nlerp4, scaleAngle4, quatFromMat4, norm4,
} from './ikmath.js';
import { solveTwoBone, solveCCD } from './Solvers.js';

// Contact IK for the roster characters (the JadeFisher 48-bone rig): a post-animation pass on a SkinnedModel, run from
// model.poseOverride after the clip pose and the upper-body overlay and before the world / joint matrices are built and
// uploaded (src/engine/render/Skinning.js). PBIK-style in spirit (the Unreal game's planned hand / foot IK): a few cheap
// ordered passes instead of one full-body solve.
//
//   1. feet: the ground under each animated ankle (a probe callback, src/player/ik/Ground.js), the offsets eased so the
//      feet plant without popping; the pelvis drops to the lower foot; each leg is a two-bone solve (thigh, calf) to its
//      ankle target with the knee kept in its clip plane; stance feet tilt to the ground normal (clamped).
//   2. hands: world targets (or targets in another bone's frame, e.g. the reel knob in the rod hand's socket); the palm
//      socket (weapon_l / weapon_r) is the effector. A target beyond the arm moves the pelvis toward it (the legs keep
//      the feet planted) and bends the spine by CCD (limited per vertebra), then each arm is a two-bone solve.
//   3. look (optional): neck and head by CCD toward a point.
//
// Inputs, set by the avatar each frame before model.update( dt ): dt, mode, footWeight (0..1 target, eased here), pelvisDrop,
// probe, setAnchor( groupMatrixWorld.elements ), setTargets( request ). All math is on preallocated Float64Arrays, and scalars
// stay in locals (a double passed to or returned from a helper V8 does not inline gets boxed), so the pass itself allocates
// nothing per frame (test/feature-ik.mjs measures it). ?ikdebug logs timing and state every 2 s.
//
// probe( point, mode, out ): point = { x, y, z } (world, the root plane under the ankle, reused), out = { x, y, z, nx, ny, nz }
// (src/player/ik/Ground.js); false where there is nothing to stand on.

const NAMES = [
	'pelvis', 'spine_01', 'spine_02', 'neck_01', 'head',
	'thigh_l', 'calf_l', 'foot_l', 'ball_l', 'thigh_r', 'calf_r', 'foot_r', 'ball_r',
	'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l', 'weapon_l', 'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r', 'weapon_r',
];
const DEG = Math.PI / 180;
export const FOOT = {
	maxUp: 0.45, maxDown: 0.4, // ground further than this from the root plane is a wall / a drop, not a step: the clip foot stays
	maxDrop: 0.35, // the pelvis drops at most this far
	maxTilt: 25 * DEG, // foot alignment to the ground normal
	rateUp: 18, rateDown: 10, // 1/s easing of the ground offsets (faster up, so a toe never sinks into a step)
	fadeIn: 0.3, fadeOut: 0.12, // s for the foot weight
};
const KNEE = { minBend: 30 * DEG, maxBend: 178 * DEG };
const ELBOW = { minBend: 25 * DEG, maxBend: 178 * DEG };
const REACH = { slack: 0.97, pelvisShare: 0.45, pelvisMax: 0.18, spine: [ 0.22, 0.26 ], iterations: 6 };
const LOOK = { limits: [ 0.35, 0.5 ], iterations: 4 };
const HAND_FADE = 0.2; // s to blend a hand / foot / look target in or out
// foot lock (stance weights from the animation graph, ik.footLock = { l, r }): a planted foot keeps its world XZ until the
// weight drops, then blends back to the clip; a pin left further than maxSlip from the clip foot (a moving deck, a shove) lets go
export const LOCK = { on: 0.5, release: 0.15, maxSlip: 0.3 };

// lowest-foot pelvis drop: min( offL, offR ) when below the root plane, never more than maxDrop (both feet up: no rise)
export function pelvisOffset( offL, offR, maxDrop = FOOT.maxDrop ) {

	return clamp( Math.min( offL, offR, 0 ), - maxDrop, 0 );

}

// a probed ground height (model space, relative to the root plane) the foot may plant on, or 0 (no support: wall / drop)
export function supportOffset( hy, maxUp = FOOT.maxUp, maxDown = FOOT.maxDown ) {

	return Number.isFinite( hy ) && hy <= maxUp && hy >= - maxDown ? hy : 0;

}

const slot = () => ( { p: vec(), q: quat(), hasQ: false, pole: vec(), hasPole: false, socket: - 1, req: 0.5, w: 0.5 } );

// scratch
const _a = vec(), _b = vec(), _c = vec(), _e = vec(), _t = vec(), _d = vec(), _h = vec(), _pole = vec(), _up = vec( 0, 1, 0 ), _n = vec();
const _S = vec(), _sh = vec(), _q = quat(), _qA = quat(), _qB = quat(), _qF = quat(), _qP = quat(), _qt = quat();
const _ccdPos = new Float64Array( 6 ), _ccdG = new Float64Array( 8 ), _ccdLim = new Float64Array( 2 ), _eff = vec();
const _hit = { x: 0.5, y: 0.5, z: 0.5, nx: 0.5, ny: 0.5, nz: 0.5 }; // double fields from the start (stored in place)
const _at = { x: 0.5, y: 0.5, z: 0.5 };
const _sol = { qa: quat(), qb: quat(), end: vec(), reached: false, bend: 0 };
const _legOpts = { minBend: KNEE.minBend, maxBend: KNEE.maxBend, pole: null, poleWeight: 0, hint: vec() };
const _armOpts = { minBend: ELBOW.minBend, maxBend: ELBOW.maxBend, pole: null, poleWeight: 0, hint: vec() };

export class ContactIK {

	// null when the model lacks the rig (or scales a chain bone: the FK here is rotation + translation)
	static create( model ) {

		const nodes = model.gltf.nodes, I = {};
		for ( const n of NAMES ) {

			const i = nodes.findIndex( ( x ) => x.name === n );
			if ( i < 0 ) return null;
			I[ n ] = i;

		}

		for ( const n of NAMES ) for ( let i = I[ n ]; i >= 0; i = model.parent[ i ] ) {

			const s = model.rest[ i ].s;
			if ( Math.abs( s[ 0 ] - 1 ) > 1e-3 || Math.abs( s[ 1 ] - 1 ) > 1e-3 || Math.abs( s[ 2 ] - 1 ) > 1e-3 ) return null;

		}

		return new ContactIK( model, I );

	}

	constructor( model, I ) {

		this.model = model;
		this.I = I;
		const N = model.nodeCount;
		this.Wp = new Float64Array( N * 3 );
		this.Wq = new Float64Array( N * 4 );
		const need = new Uint8Array( N );
		for ( const n of NAMES ) for ( let i = I[ n ]; i >= 0; i = model.parent[ i ] ) need[ i ] = 1;
		this.fkOrder = Int32Array.from( model.order.filter( ( i ) => need[ i ] ) );
		const leg = ( s ) => ( { thigh: I[ 'thigh_' + s ], calf: I[ 'calf_' + s ], foot: I[ 'foot_' + s ], ball: I[ 'ball_' + s ], a0: vec(), off: 0, n: vec( 0, 1, 0 ), stance: 0, pin: vec(), pinned: false, pw: 0.5 } );
		const arm = ( s ) => ( { side: s === 'l' ? 1 : - 1, upper: I[ 'upperarm_' + s ], lower: I[ 'lowerarm_' + s ], hand: I[ 'hand_' + s ], sock: I[ 'weapon_' + s ], len: 0, palm: 0, T: vec() } );
		this.legs = [ leg( 'l' ), leg( 'r' ) ];
		this.arms = [ arm( 'l' ), arm( 'r' ) ];
		// targets (Avatar.setIKTargets): hands, feet, look
		this.hands = [ slot(), slot() ];
		this.feet = [ slot(), slot() ];
		this.look = slot();
		this.footLock = { l: 0, r: 0 }; // stance weights 0..1 per foot (src/player/anim/AnimGraph.js writes them each frame)
		for ( const l of this.legs ) l.pw = 0;
		for ( const s of [ ...this.hands, ...this.feet, this.look ] ) { s.req = 0; s.w = 0; }
		// inputs
		this.enabled = true;
		this.dt = 0;
		this.mode = 'walk';
		this.footWeight = 0; // target; eased into fw
		this.fw = 0;
		this.pelvisDrop = true;
		this.probe = null; // ( point, mode, out ) -> bool, world space (Ground.js)
		this._dtc = 0.5; // this frame's clamped dt (a field, not an argument: see the header)
		this.anchor = new Float64Array( 16 );
		this.aq = quat(); this.aqi = quat(); this.as = 1;
		this._snap = true;
		this.drop = 0; // the pelvis offset applied last frame (m, model up)
		this.lean = 0; // the reach shift of the pelvis last frame (m)
		this.reachLen = 0; // the mean hand shortfall this frame (m)
		this._slots = [ this.hands[ 0 ], this.hands[ 1 ], this.feet[ 0 ], this.feet[ 1 ], this.look ];
		// rest measurements: ankle height of the rest pose, the head's forward axis in its own frame
		this._fkFrom( model.rest );
		this.ankleRest = Math.min( this.Wp[ I.foot_l * 3 + 1 ], this.Wp[ I.foot_r * 3 + 1 ] );
		for ( const a of this.arms ) {

			a.len = dist3( this._p( a.upper, _a ), this._p( a.lower, _b ) ) + dist3( _b, this._p( a.hand, _c ) );
			a.palm = dist3( _c, this._p( a.sock, _e ) );

		}

		this.headFwd = vec( 0, 0, 1 );
		rot3( this.headFwd, conj4( _q, this._q( I.head, _q ) ), this.headFwd );
		// stats (?ikdebug)
		this.debug = ContactIK.debug;
		this.stats = { n: 0, ms: 0, max: 0, t: 0 };

	}

	static get debug() {

		try {

			return typeof location !== 'undefined' && /[?&]ikdebug\b/.test( location.search );

		} catch ( e ) {

			return false;

		}

	}

	// the avatar group's world matrix (column-major elements): model space -> world
	setAnchor( e ) {

		const A = this.anchor;
		if ( Math.abs( e[ 12 ] - A[ 12 ] ) + Math.abs( e[ 13 ] - A[ 13 ] ) + Math.abs( e[ 14 ] - A[ 14 ] ) > 1.5 ) this._snap = true; // a teleport: no easing
		for ( let i = 0; i < 16; i ++ ) A[ i ] = e[ i ];
		quatFromMat4( this.aq, A );
		conj4( this.aqi, this.aq );
		this.as = Math.sqrt( A[ 0 ] * A[ 0 ] + A[ 1 ] * A[ 1 ] + A[ 2 ] * A[ 2 ] ) || 1;

	}

	// request = { leftHand, rightHand, leftFoot, rightFoot, look, weight }: each a world point ({ x, y, z }) or
	// { position, quaternion?, socket?: bone name (position in that bone's frame), pole?, weight? }; missing / null releases it
	setTargets( r ) {

		const g = r && Number.isFinite( r.weight ) ? Math.min( 1, Math.max( 0, r.weight ) ) : 1;
		this._req( this.hands[ 0 ], r && r.leftHand, g );
		this._req( this.hands[ 1 ], r && r.rightHand, g );
		this._req( this.feet[ 0 ], r && r.leftFoot, g );
		this._req( this.feet[ 1 ], r && r.rightFoot, g );
		this._req( this.look, r && r.look, g );

	}

	_req( s, r, g ) {

		const p = r && ( r.position || r );
		if ( ! p || ! Number.isFinite( p.x ) || ! Number.isFinite( p.y ) || ! Number.isFinite( p.z ) ) {

			s.req = 0;
			return;

		}

		// (inline stores: the avatar hands its request over every frame)
		s.p[ 0 ] = p.x; s.p[ 1 ] = p.y; s.p[ 2 ] = p.z;
		s.req = Math.min( 1, Math.max( 0, ( Number.isFinite( r.weight ) ? r.weight : 1 ) * g ) );
		const q = r.quaternion;
		s.hasQ = !! q;
		if ( q ) { s.q[ 0 ] = q.x; s.q[ 1 ] = q.y; s.q[ 2 ] = q.z; s.q[ 3 ] = q.w; }
		s.hasPole = !! r.pole;
		if ( r.pole ) { s.pole[ 0 ] = r.pole.x; s.pole[ 1 ] = r.pole.y; s.pole[ 2 ] = r.pole.z; }
		s.socket = r.socket && this.I[ r.socket ] !== undefined ? this.I[ r.socket ] : - 1;

	}

	// drop every eased state (after a ragdoll, a character swap or a teleport): the IK fades back in
	reset() {

		this.fw = 0;
		this.drop = 0;
		this.lean = 0;
		for ( const l of this.legs ) { l.off = 0; set3( l.n, 0, 1, 0 ); l.pinned = false; l.pw = 0; }
		for ( const s of this.hands ) s.w = 0;
		for ( const s of this.feet ) s.w = 0;
		this.look.w = 0;
		this._snap = true;

	}

	get active() {

		// the feet only count with a ground probe: an avatar with nothing to stand on skips the pass entirely
		return ( this.fw > 0 && !! this.probe ) || this.hands[ 0 ].w > 0 || this.hands[ 1 ].w > 0 || this.feet[ 0 ].w > 0 || this.feet[ 1 ].w > 0 || this.look.w > 0;

	}

	// ---- the pass (model.poseOverride)

	apply( m ) {

		const dt = Math.min( Math.max( this.dt || 0, 0 ), 0.1 );
		// ease the weights toward their targets (inline: see the header)
		const fwT = this.footWeight, fr = dt / ( fwT > this.fw ? FOOT.fadeIn : FOOT.fadeOut );
		this.fw = this.fw < fwT ? Math.min( fwT, this.fw + fr ) : Math.max( fwT, this.fw - fr );
		const step = dt / HAND_FADE, S = this._slots;
		for ( let k = 0; k < 5; k ++ ) {

			const s = S[ k ];
			s.w = s.w < s.req ? Math.min( s.req, s.w + step ) : Math.max( s.req, s.w - step );

		}

		if ( ! this.enabled || ! this.active ) {

			// idle: the clip pose stands; the ground offsets restart from the clip when the IK comes back
			this.legs[ 0 ].off = this.legs[ 1 ].off = 0;
			this.legs[ 0 ].pw = this.legs[ 1 ].pw = 0;
			this.legs[ 0 ].pinned = this.legs[ 1 ].pinned = false;
			this.drop = this.lean = 0;
			return false;

		}

		const t0 = this.debug ? performance.now() : 0;
		this._fkFrom( m.local );
		this._dtc = dt;
		this._feet();
		const reach = this._reach();
		this._pelvis( reach );
		if ( reach ) this._spine();
		this._legs();
		if ( this.look.w > 0 ) this._look();
		this._arms();
		this._snap = false;
		if ( this.debug ) this._stat( performance.now() - t0, dt );
		return true;

	}

	// ---- forward kinematics of the IK nodes (rotation + translation: the rig has unit scales)

	_fkFrom( local ) {

		const P = this.model.parent, order = this.fkOrder, Wp = this.Wp, Wq = this.Wq;
		for ( let k = 0; k < order.length; k ++ ) {

			const i = order[ k ], p = P[ i ], r = local[ i ].r, t = local[ i ].t, o = i * 3, o4 = i * 4;
			if ( p < 0 ) {

				Wq[ o4 ] = r[ 0 ]; Wq[ o4 + 1 ] = r[ 1 ]; Wq[ o4 + 2 ] = r[ 2 ]; Wq[ o4 + 3 ] = r[ 3 ];
				Wp[ o ] = t[ 0 ]; Wp[ o + 1 ] = t[ 1 ]; Wp[ o + 2 ] = t[ 2 ];
				continue;

			}

			const p3 = p * 3, p4 = p * 4;
			const qx = Wq[ p4 ], qy = Wq[ p4 + 1 ], qz = Wq[ p4 + 2 ], qw = Wq[ p4 + 3 ];
			// position: parent + parent rotation * t
			const vx = t[ 0 ], vy = t[ 1 ], vz = t[ 2 ];
			const tx = 2 * ( qy * vz - qz * vy ), ty = 2 * ( qz * vx - qx * vz ), tz = 2 * ( qx * vy - qy * vx );
			Wp[ o ] = Wp[ p3 ] + vx + qw * tx + qy * tz - qz * ty;
			Wp[ o + 1 ] = Wp[ p3 + 1 ] + vy + qw * ty + qz * tx - qx * tz;
			Wp[ o + 2 ] = Wp[ p3 + 2 ] + vz + qw * tz + qx * ty - qy * tx;
			// rotation: parent * r
			const bx = r[ 0 ], by = r[ 1 ], bz = r[ 2 ], bw = r[ 3 ];
			Wq[ o4 ] = qx * bw + qw * bx + qy * bz - qz * by;
			Wq[ o4 + 1 ] = qy * bw + qw * by + qz * bx - qx * bz;
			Wq[ o4 + 2 ] = qz * bw + qw * bz + qx * by - qy * bx;
			Wq[ o4 + 3 ] = qw * bw - qx * bx - qy * by - qz * bz;

		}

	}

	_fk() {

		this._fkFrom( this.model.local );

	}

	_p( i, o ) {

		o[ 0 ] = this.Wp[ i * 3 ]; o[ 1 ] = this.Wp[ i * 3 + 1 ]; o[ 2 ] = this.Wp[ i * 3 + 2 ];
		return o;

	}

	_q( i, o ) {

		const W = this.Wq, k = i * 4;
		o[ 0 ] = W[ k ]; o[ 1 ] = W[ k + 1 ]; o[ 2 ] = W[ k + 2 ]; o[ 3 ] = W[ k + 3 ];
		return o;

	}

	// write a node's world rotation q as its local rotation (under its parent's current world rotation)
	_setWorldRot( i, q ) {

		const p = this.model.parent[ i ];
		if ( p >= 0 ) mul4( _qt, conj4( _qt, this._q( p, _qt ) ), q ); else norm4( _qt, q );
		norm4( _qt, _qt );
		const r = this.model.local[ i ].r;
		r[ 0 ] = _qt[ 0 ]; r[ 1 ] = _qt[ 1 ]; r[ 2 ] = _qt[ 2 ]; r[ 3 ] = _qt[ 3 ];
		const W = this.Wq, k = i * 4;
		W[ k ] = q[ 0 ]; W[ k + 1 ] = q[ 1 ]; W[ k + 2 ] = q[ 2 ]; W[ k + 3 ] = q[ 3 ];

	}

	// world <-> model space (the anchor is rigid with a uniform scale)
	// v: a world point (Float64Array( 3 ) or any [ 0 ] / [ 1 ] / [ 2 ])
	_toModel( o, v ) {

		const A = this.anchor, k = 1 / this.as;
		o[ 0 ] = v[ 0 ] - A[ 12 ]; o[ 1 ] = v[ 1 ] - A[ 13 ]; o[ 2 ] = v[ 2 ] - A[ 14 ];
		rot3( o, this.aqi, o );
		o[ 0 ] *= k; o[ 1 ] *= k; o[ 2 ] *= k;
		return o;

	}

	_toWorld( o, v ) {

		const A = this.anchor;
		rot3( o, this.aq, v );
		o[ 0 ] = o[ 0 ] * this.as + A[ 12 ]; o[ 1 ] = o[ 1 ] * this.as + A[ 13 ]; o[ 2 ] = o[ 2 ] * this.as + A[ 14 ];
		return o;

	}

	// a target slot in model space now (a bone-frame target follows that bone's current pose)
	_target( s, o ) {

		if ( s.socket >= 0 ) {

			rot3( o, this._q( s.socket, _qt ), s.p );
			return add3( o, o, this._p( s.socket, _d ) );

		}

		return this._toModel( o, s.p );

	}

	// ---- 1. feet: ground offsets under the animated ankles

	_feet() {

		const fw = this.fw, probe = this.probe, dt = this._dtc;
		for ( let s = 0; s < 2; s ++ ) {

			const g = this.legs[ s ], ft = this.feet[ s ];
			this._p( g.foot, g.a0 );
			// how planted the clip has this foot: the ankle near its rest height (smoothstep over 0.1 m)
			const x = Math.min( 1, Math.max( 0, ( g.a0[ 1 ] - this.ankleRest - 0.03 ) / 0.1 ) );
			g.stance = 1 - x * x * ( 3 - 2 * x );
			let offT = 0;
			_n[ 0 ] = 0; _n[ 1 ] = 1; _n[ 2 ] = 0;
			if ( ft.w > 0 ) offT = ( this._target( ft, _t )[ 1 ] - g.a0[ 1 ] ) * ft.w;
			else if ( fw > 0 && probe ) {

				// the root plane under the ankle, in the world
				_t[ 0 ] = g.a0[ 0 ]; _t[ 1 ] = 0; _t[ 2 ] = g.a0[ 2 ];
				this._toWorld( _t, _t );
				_at.x = _t[ 0 ]; _at.y = _t[ 1 ]; _at.z = _t[ 2 ];
				if ( probe( _at, this.mode, _hit ) ) {

					_d[ 0 ] = _hit.x; _d[ 1 ] = _hit.y; _d[ 2 ] = _hit.z;
					const hy = this._toModel( _t, _d )[ 1 ];
					// a wall or a drop is no support (supportOffset, inline)
					if ( hy <= FOOT.maxUp && hy >= - FOOT.maxDown ) {

						offT = hy;
						// the ground's normal wherever it supports the foot (level with the root plane too)
						_n[ 0 ] = _hit.nx; _n[ 1 ] = _hit.ny; _n[ 2 ] = _hit.nz;
						rot3( _n, this.aqi, _n );

					}

				}

			}

			// plant: ease toward the ground
			const k = this._snap ? 1 : 1 - Math.exp( - dt * ( offT > g.off ? FOOT.rateUp : FOOT.rateDown ) );
			g.off += ( offT - g.off ) * k;
			const n = g.n;
			n[ 0 ] += ( _n[ 0 ] - n[ 0 ] ) * k; n[ 1 ] += ( _n[ 1 ] - n[ 1 ] ) * k; n[ 2 ] += ( _n[ 2 ] - n[ 2 ] ) * k;
			if ( ! unit3( n, n ) ) { n[ 0 ] = 0; n[ 1 ] = 1; n[ 2 ] = 0; }

		}

	}

	// ---- 2a. reach: how far the hand targets lie beyond the arms (shoulder to palm, nearly straight): the mean shortfall
	// (m) in this.reachLen, its direction in _S (model space); true when there is any

	_reach() {

		_S[ 0 ] = 0; _S[ 1 ] = 0; _S[ 2 ] = 0;
		let n = 0;
		for ( let s = 0; s < 2; s ++ ) {

			const h = this.hands[ s ], a = this.arms[ s ];
			if ( h.w <= 0 || h.socket === a.sock || h.socket === a.hand ) continue;
			this._target( h, a.T );
			sub3( _d, a.T, this._p( a.upper, _sh ) );
			const l = Math.sqrt( _d[ 0 ] * _d[ 0 ] + _d[ 1 ] * _d[ 1 ] + _d[ 2 ] * _d[ 2 ] );
			const def = ( l - ( a.len * REACH.slack + a.palm ) ) * h.w;
			if ( def > 0 ) {

				const k = def / l;
				_S[ 0 ] += _d[ 0 ] * k; _S[ 1 ] += _d[ 1 ] * k; _S[ 2 ] += _d[ 2 ] * k;
				n ++;

			}

		}

		if ( n > 1 ) { _S[ 0 ] /= n; _S[ 1 ] /= n; _S[ 2 ] /= n; }
		this.reachLen = Math.sqrt( _S[ 0 ] * _S[ 0 ] + _S[ 1 ] * _S[ 1 ] + _S[ 2 ] * _S[ 2 ] );
		return this.reachLen > 0;

	}

	// ---- 2b. pelvis: down to the lower foot, and toward a far hand target (horizontal, part of the shortfall)

	_pelvis( reach ) {

		const g = this.legs;
		// the lower foot below the root plane, at most maxDrop, never up (pelvisOffset, inline)
		const drop = this.pelvisDrop && this.probe ? Math.max( Math.min( g[ 0 ].off, g[ 1 ].off, 0 ), - FOOT.maxDrop ) * this.fw : 0;
		_d[ 0 ] = 0; _d[ 1 ] = drop; _d[ 2 ] = 0;
		this.lean = 0;
		if ( reach ) {

			const hx = _S[ 0 ], hz = _S[ 2 ];
			const l = Math.sqrt( hx * hx + hz * hz ) * REACH.pelvisShare, k = REACH.pelvisShare * ( l > REACH.pelvisMax ? REACH.pelvisMax / l : 1 );
			_d[ 0 ] += hx * k; _d[ 2 ] += hz * k;
			_S[ 0 ] -= hx * k; _S[ 2 ] -= hz * k; // what is left for the spine
			this.lean = Math.min( l, REACH.pelvisMax );

		}

		this.drop = drop;
		if ( _d[ 0 ] * _d[ 0 ] + _d[ 1 ] * _d[ 1 ] + _d[ 2 ] * _d[ 2 ] < 1e-12 ) return;
		const i = this.I.pelvis, p = this.model.parent[ i ];
		if ( p >= 0 ) rot3( _d, conj4( _qt, this._q( p, _qt ) ), _d );
		const t = this.model.local[ i ].t;
		t[ 0 ] += _d[ 0 ]; t[ 1 ] += _d[ 1 ]; t[ 2 ] += _d[ 2 ];
		this._fk();

	}

	// ---- 2c. spine: CCD over spine_01 / spine_02 moving the shoulders by the rest of the shortfall

	_spine() {

		const I = this.I;
		if ( _S[ 0 ] * _S[ 0 ] + _S[ 1 ] * _S[ 1 ] + _S[ 2 ] * _S[ 2 ] < 1e-6 ) return;
		// effector: the shoulders of the hands that reach (both: their midpoint)
		_eff[ 0 ] = 0; _eff[ 1 ] = 0; _eff[ 2 ] = 0;
		let n = 0;
		for ( let s = 0; s < 2; s ++ ) if ( this.hands[ s ].w > 0 ) { add3( _eff, _eff, this._p( this.arms[ s ].upper, _sh ) ); n ++; }
		if ( ! n ) return;
		_eff[ 0 ] /= n; _eff[ 1 ] /= n; _eff[ 2 ] /= n;
		add3( _t, _eff, _S );
		this._p( I.spine_01, _a ); this._p( I.spine_02, _b );
		_ccdPos[ 0 ] = _a[ 0 ]; _ccdPos[ 1 ] = _a[ 1 ]; _ccdPos[ 2 ] = _a[ 2 ]; _ccdPos[ 3 ] = _b[ 0 ]; _ccdPos[ 4 ] = _b[ 1 ]; _ccdPos[ 5 ] = _b[ 2 ];
		_ccdLim[ 0 ] = REACH.spine[ 0 ]; _ccdLim[ 1 ] = REACH.spine[ 1 ];
		solveCCD( _ccdPos, 2, _eff, _t, _ccdLim, REACH.iterations, _ccdG );
		this._writeChain( I.spine_01, I.spine_02, false );
		this._fk();

	}

	// world rotations G (in _ccdG) for a two-joint chain j0 -> j1, scaled by the look weight when byLook (the weight is read
	// here, not passed: see the header)
	_writeChain( j0, j1, byLook ) {

		const w = byLook ? this.look.w : 1;
		_qA[ 0 ] = _ccdG[ 0 ]; _qA[ 1 ] = _ccdG[ 1 ]; _qA[ 2 ] = _ccdG[ 2 ]; _qA[ 3 ] = _ccdG[ 3 ];
		_qB[ 0 ] = _ccdG[ 4 ]; _qB[ 1 ] = _ccdG[ 5 ]; _qB[ 2 ] = _ccdG[ 6 ]; _qB[ 3 ] = _ccdG[ 7 ];
		if ( w < 1 ) { scaleAngle4( _qA, _qA, w ); scaleAngle4( _qB, _qB, w ); }
		mul4( _qF, _qB, this._q( j1, _q ) ); // the child's new world rotation (before the parent is rewritten)
		this._setWorldRot( j0, mul4( _q, _qA, this._q( j0, _q ) ) );
		this._setWorldRot( j1, _qF );

	}

	// ---- 3. legs: two-bone to the planted ankles, then the foot onto the ground normal

	_legs() {

		const fw = this.probe ? this.fw : 0; // no ground probe: the legs keep the clip (foot targets still apply)
		for ( let s = 0; s < 2; s ++ ) {

			const g = this.legs[ s ], ft = this.feet[ s ];
			// the target: the clip ankle raised / lowered by the ground (absolute: a pelvis that moved leaves the feet planted)
			if ( ft.w > 0 ) {

				const w = ft.w, a0 = g.a0;
				this._target( ft, _t );
				_t[ 0 ] = a0[ 0 ] + ( _t[ 0 ] - a0[ 0 ] ) * w; _t[ 1 ] = a0[ 1 ] + ( _t[ 1 ] - a0[ 1 ] ) * w; _t[ 2 ] = a0[ 2 ] + ( _t[ 2 ] - a0[ 2 ] ) * w;

			} else {

				_t[ 0 ] = g.a0[ 0 ]; _t[ 1 ] = g.a0[ 1 ] + g.off * fw; _t[ 2 ] = g.a0[ 2 ];
				if ( fw > 0 ) this._lock( g, s === 0 ? this.footLock.l : this.footLock.r );

			}

			this._p( g.thigh, _a ); this._p( g.calf, _b ); this._p( g.foot, _c );
			const tilt = ft.w > 0 ? ( ft.hasQ ? ft.w : 0 ) : g.stance * fw;
			if ( dist3( _c, _t ) < 1e-5 && tilt <= 0 ) continue;
			// the knee bends toward the toes when the clip has the leg straight
			sub3( _h, this._p( g.ball, _e ), _c );
			_h[ 1 ] = 0;
			if ( ! unit3( _h, _h ) ) { _h[ 0 ] = 0; _h[ 1 ] = 0; _h[ 2 ] = 1; }
			copy3( _legOpts.hint, _h );
			solveTwoBone( _a, _b, _c, _t, _sol, _legOpts );
			// thigh, calf, and the foot's new world rotation (its local is unchanged by the solve)
			mul4( _qA, _sol.qa, this._q( g.thigh, _q ) );
			mul4( _qP, _sol.qb, _sol.qa );
			mul4( _qB, _qP, this._q( g.calf, _q ) );
			mul4( _qF, _qP, this._q( g.foot, _q ) );
			this._setWorldRot( g.thigh, _qA );
			this._setWorldRot( g.calf, _qB );
			if ( tilt > 0 ) {

				if ( ft.w > 0 && ft.hasQ ) nlerp4( _qF, _qF, mul4( _q, this.aqi, ft.q ), ft.w );
				else {

					// stance feet tilt with the ground (clamped)
					// (clampAngle4 then scaleAngle4, inline: the same axis, min( angle, maxTilt ) * tilt)
					fromUnit4( _q, _up, g.n );
					const aw = Math.min( 1, Math.abs( _q[ 3 ] ) ), ang = 2 * Math.acos( aw );
					if ( ang > 1e-6 ) {

						const half = Math.min( ang, FOOT.maxTilt ) * tilt * 0.5, k = ( _q[ 3 ] < 0 ? - 1 : 1 ) * Math.sin( half ) / Math.sqrt( 1 - aw * aw );
						_q[ 0 ] *= k; _q[ 1 ] *= k; _q[ 2 ] *= k; _q[ 3 ] = Math.cos( half );
						mul4( _qF, _q, _qF );

					}

				}

				this._setWorldRot( g.foot, _qF );

			}

		}

		this._fk();

	}

	// foot lock on _t (the leg's model-space ankle target): pin the world XZ where the foot plants, hold it while the stance
	// weight stays above LOCK.on (walk / deck), blend back to the clip over LOCK.release once it drops
	_lock( g, lock ) {

		const fl = this.footLock;
		if ( this._snap || ! fl ) { g.pinned = false; g.pw = 0; return; }
		const want = lock > LOCK.on && ( this.mode === 'walk' || this.mode === 'deck' );
		if ( want && ! g.pinned ) {

			// plant: pin where the foot is now (the blended target, so a re-plant mid-release does not pop)
			if ( g.pw > 0 ) {

				this._toModel( _e, g.pin );
				_t[ 0 ] += ( _e[ 0 ] - _t[ 0 ] ) * g.pw; _t[ 2 ] += ( _e[ 2 ] - _t[ 2 ] ) * g.pw;

			}

			this._toWorld( g.pin, _t );
			g.pinned = true;
			g.pw = 1;
			return;

		}

		if ( ! want ) g.pinned = false;
		if ( ! g.pinned ) g.pw = Math.max( 0, g.pw - this._dtc / LOCK.release );
		if ( g.pw <= 0 ) return;
		this._toModel( _e, g.pin );
		const dx = _e[ 0 ] - _t[ 0 ], dz = _e[ 2 ] - _t[ 2 ];
		if ( dx * dx + dz * dz > LOCK.maxSlip * LOCK.maxSlip ) { g.pinned = false; g.pw = 0; return; } // too far: let go now
		_t[ 0 ] += dx * g.pw; _t[ 2 ] += dz * g.pw;

	}

	// ---- 4. look: neck and head by CCD so the face points at the target

	_look() {

		const I = this.I, s = this.look;
		this._target( s, _t );
		this._p( I.neck_01, _a ); this._p( I.head, _b );
		rot3( _eff, this._q( I.head, _q ), this.headFwd );
		add3( _eff, _b, _eff );
		_ccdPos[ 0 ] = _a[ 0 ]; _ccdPos[ 1 ] = _a[ 1 ]; _ccdPos[ 2 ] = _a[ 2 ]; _ccdPos[ 3 ] = _b[ 0 ]; _ccdPos[ 4 ] = _b[ 1 ]; _ccdPos[ 5 ] = _b[ 2 ];
		_ccdLim[ 0 ] = LOOK.limits[ 0 ]; _ccdLim[ 1 ] = LOOK.limits[ 1 ];
		solveCCD( _ccdPos, 2, _eff, _t, _ccdLim, LOOK.iterations, _ccdG );
		this._writeChain( I.neck_01, I.head, true );
		this._fk();

	}

	// ---- 5. arms: two-bone so the palm socket lands on the target (world targets first, then targets in a bone's frame,
	// which may sit on the other hand). The hand keeps its local rotation through the solve, so the palm is rigid with the
	// forearm and is the chain's end itself: one exact solve, and a partial weight moves it exactly that part of the way.

	_arms() {

		for ( let pass = 0; pass < 2; pass ++ ) for ( let s = 0; s < 2; s ++ ) {

			const h = this.hands[ s ], a = this.arms[ s ];
			if ( h.w <= 0 || ( h.socket >= 0 ) !== ( pass === 1 ) || h.socket === a.sock || h.socket === a.hand ) continue;
			this._target( h, a.T );
			// default pole: the elbow down, out and back (a straight arm has no plane of its own)
			this._p( a.upper, _a ); this._p( a.lower, _b ); this._p( a.hand, _c ); this._p( a.sock, _e );
			if ( h.hasPole ) this._toModel( _pole, h.pole );
			else { _pole[ 0 ] = _a[ 0 ] + a.side * 0.3; _pole[ 1 ] = _a[ 1 ] - 0.4; _pole[ 2 ] = _a[ 2 ] - 0.3; }
			_armOpts.pole = _pole;
			_armOpts.poleWeight = h.hasPole ? 1 : 0;
			sub3( _armOpts.hint, _pole, _a );
			// where the palm goes this frame (lerp, inline)
			const w = h.w, T = a.T;
			_t[ 0 ] = _e[ 0 ] + ( T[ 0 ] - _e[ 0 ] ) * w; _t[ 1 ] = _e[ 1 ] + ( T[ 1 ] - _e[ 1 ] ) * w; _t[ 2 ] = _e[ 2 ] + ( T[ 2 ] - _e[ 2 ] ) * w;
			if ( h.hasQ ) {

				// the hand turns too: aim the wrist at the palm target less the palm offset under the new hand rotation
				this._q( a.hand, _q );
				nlerp4( _qF, _q, mul4( _qt, this.aqi, h.q ), h.w );
				rot3( _d, conj4( _qt, _q ), sub3( _d, _e, _c ) ); // the palm in the hand's frame
				sub3( _t, _t, rot3( _d, _qF, _d ) );
				if ( dist3( _t, _c ) > 1e-6 ) this._solveArm( a, _c, _t );
				this._setWorldRot( a.hand, _qF );

			} else if ( dist3( _t, _e ) > 1e-6 ) this._solveArm( a, _e, _t );

			this._fk();

		}

	}

	// shoulder _a, elbow _b, end e (wrist or palm) -> t; writes the upper and lower arm
	_solveArm( a, e, t ) {

		solveTwoBone( _a, _b, e, t, _sol, _armOpts );
		mul4( _qA, _sol.qa, this._q( a.upper, _q ) );
		mul4( _qP, _sol.qb, _sol.qa );
		mul4( _qB, _qP, this._q( a.lower, _q ) );
		this._setWorldRot( a.upper, _qA );
		this._setWorldRot( a.lower, _qB );

	}

	_stat( ms, dt ) {

		const S = this.stats;
		S.n ++; S.ms += ms; S.max = Math.max( S.max, ms ); S.t += dt;
		if ( S.t < 2 ) return;
		const L = this.legs, H = this.hands;
		console.log( `ik ${ ( S.ms / S.n ).toFixed( 3 ) } ms avg, ${ S.max.toFixed( 3 ) } max (${ S.n } frames) | ${ this.mode } feet ${ this.fw.toFixed( 2 ) } L ${ L[ 0 ].off.toFixed( 3 ) } R ${ L[ 1 ].off.toFixed( 3 ) } pelvis ${ this.drop.toFixed( 3 ) } lean ${ this.lean.toFixed( 3 ) } | hands L ${ H[ 0 ].w.toFixed( 2 ) } R ${ H[ 1 ].w.toFixed( 2 ) } look ${ this.look.w.toFixed( 2 ) }` );
		S.n = 0; S.ms = 0; S.max = 0; S.t = 0;

	}

}

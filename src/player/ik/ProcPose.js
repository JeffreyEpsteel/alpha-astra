import { Quaternion, Vector3 } from '../../engine/index.js';

// Procedural pose passes on a SkinnedModel's local pose (model.poseOverride, after the animation graph and before the contact IK):
//
//   const pp = ProcPose.create( model );          // null when the rig has no arms / legs it can find
//   pp.helm = { weight, steer, upX, upZ, armL, armR }   at the wheel: lean / weight shift with the steering, sway against the
//        hull roll, and (armL / armR > 0: no IK hand on that side) the arms forward with the hands at wheel height
//   pp.swim = { tread, crawl, time }              in the water: treading (sculling arms, eggbeater legs) and the crawl's
//        flutter kick with the arms kept off the bind pose
//   pp.apply( model )                             writes model.local (rotations, the pelvis translation)
//
// Model space of the roster GLBs: +Y up, the character faces +Z, +X is its left. Works on the JadeFisher rig names (upperarm_l,
// lowerarm_l, hand_l, thigh_l, calf_l, foot_l, spine_01, pelvis) and the usual Mixamo / Rocketbox / Blender names, so a rig
// without the ContactIK bones still gets a pose instead of its bind (A) pose.
//
// bindLike( clip, model ) / repairHelmClip( model ): clips whose keys stay within a few degrees of the rest pose are the bind
// pose (the roster's Helm_Idle, Steer_Left / Steer_Right and Seated_Idle came out of the retarget that way); the helm clip is
// then replaced on this model by a standing idle so the graph's helm state never shows the A.

const PATTERNS = {
	pelvis: [ /^pelvis$/i, /^(mixamorig:)?hips$/i, /\bpelvis$/i ],
	spine: [ /^spine_01$/i, /^(mixamorig:)?spine$/i, /\bspine$/i ],
	upperL: [ /^upperarm_l$/i, /^upper_?arm[._ ]?l(eft)?$/i, /^(mixamorig:)?leftarm$/i, /\bl upperarm$/i ],
	lowerL: [ /^lowerarm_l$/i, /^(lower|fore)_?arm[._ ]?l(eft)?$/i, /^(mixamorig:)?leftforearm$/i, /\bl forearm$/i ],
	handL: [ /^hand_l$/i, /^hand[._ ]?l(eft)?$/i, /^(mixamorig:)?lefthand$/i, /\bl hand$/i ],
	upperR: [ /^upperarm_r$/i, /^upper_?arm[._ ]?r(ight)?$/i, /^(mixamorig:)?rightarm$/i, /\br upperarm$/i ],
	lowerR: [ /^lowerarm_r$/i, /^(lower|fore)_?arm[._ ]?r(ight)?$/i, /^(mixamorig:)?rightforearm$/i, /\br forearm$/i ],
	handR: [ /^hand_r$/i, /^hand[._ ]?r(ight)?$/i, /^(mixamorig:)?righthand$/i, /\br hand$/i ],
	thighL: [ /^thigh_l$/i, /^thigh[._ ]?l(eft)?$/i, /^(mixamorig:)?leftupleg$/i, /\bl thigh$/i ],
	calfL: [ /^calf_l$/i, /^(calf|shin)[._ ]?l(eft)?$/i, /^(mixamorig:)?leftleg$/i, /\bl calf$/i ],
	footL: [ /^foot_l$/i, /^foot[._ ]?l(eft)?$/i, /^(mixamorig:)?leftfoot$/i, /\bl foot$/i ],
	thighR: [ /^thigh_r$/i, /^thigh[._ ]?r(ight)?$/i, /^(mixamorig:)?rightupleg$/i, /\br thigh$/i ],
	calfR: [ /^calf_r$/i, /^(calf|shin)[._ ]?r(ight)?$/i, /^(mixamorig:)?rightleg$/i, /\br calf$/i ],
	footR: [ /^foot_r$/i, /^foot[._ ]?r(ight)?$/i, /^(mixamorig:)?rightfoot$/i, /\br foot$/i ],
};

const BIND_DEG = 8; // a clip that never turns a bone further than this from the rest pose is the bind pose
const STAND_IDLES = [ 'Idle_Breathe', 'Swagger_Idle', 'Look_Around' ];
const DEG = Math.PI / 180;
const smooth = ( x ) => x <= 0 ? 0 : x >= 1 ? 1 : x * x * ( 3 - 2 * x );

// max rotation (deg) of any rotation key from the node's rest rotation
export function clipRestDeviation( clip, rest ) {

	let mx = 0;
	for ( const c of clip.channels ) {

		if ( c.path !== 'rotation' || ! rest[ c.node ] ) continue;
		const r = rest[ c.node ].r, v = c.values;
		for ( let i = 0; i + 3 < v.length; i += 4 ) {

			const d = Math.min( 1, Math.abs( v[ i ] * r[ 0 ] + v[ i + 1 ] * r[ 1 ] + v[ i + 2 ] * r[ 2 ] + v[ i + 3 ] * r[ 3 ] ) );
			mx = Math.max( mx, 2 * Math.acos( d ) / DEG );

		}

	}

	return mx;

}

export function bindLike( clip, model ) {

	return !! clip && clipRestDeviation( clip, model.rest ) < BIND_DEG;

}

// a standing idle clip of this model that is not the bind pose (null when there is none)
export function standingIdle( model ) {

	for ( const n of STAND_IDLES ) {

		const c = model.clips.get( n );
		if ( c && ! bindLike( c, model ) ) return c;

	}

	return null;

}

// The helm clip of this model when it is the bind pose -> a copy of the standing idle under the helm clip's name (the graph's
// helm state and SkinnedModel.current keep the name). Returns 'clip' (a real helm clip), 'idle' (replaced) or 'none' (no
// usable clip: the graph falls back to its idle, the procedural pass carries the arms).
export function repairHelmClip( model, name = 'Helm_Idle' ) {

	const c = model.clips.get( name );
	if ( c && ! bindLike( c, model ) ) return 'clip';
	const idle = standingIdle( model );
	if ( idle ) {

		model.clips.set( name, { ...idle, name } );
		return 'idle';

	}

	if ( c ) model.clips.delete( name );
	return 'none';

}

const _qa = new Quaternion(), _qb = new Quaternion(), _qc = new Quaternion(), _qi = new Quaternion(), _qr = new Quaternion();
const _va = new Vector3(), _vb = new Vector3(), _vc = new Vector3(), _vd = new Vector3();
const _ax = new Vector3( 1, 0, 0 ), _ay = new Vector3( 0, 1, 0 ), _az = new Vector3( 0, 0, 1 );

export class ProcPose {

	static create( model ) {

		const nodes = model.gltf ? model.gltf.nodes : [];
		const B = {};
		for ( const k in PATTERNS ) {

			B[ k ] = - 1;
			for ( const re of PATTERNS[ k ] ) {

				const i = nodes.findIndex( ( n ) => n.name && re.test( n.name ) );
				if ( i >= 0 ) { B[ k ] = i; break; }

			}

		}

		const arms = B.upperL >= 0 && B.lowerL >= 0 && B.handL >= 0 && B.upperR >= 0 && B.lowerR >= 0 && B.handR >= 0;
		const legs = B.thighL >= 0 && B.calfL >= 0 && B.footL >= 0 && B.thighR >= 0 && B.calfR >= 0 && B.footR >= 0;
		if ( ! arms && ! legs ) return null;
		return new ProcPose( model, B, arms, legs );

	}

	constructor( model, B, arms, legs ) {

		this.model = model;
		this.B = B;
		this.hasArms = arms;
		this.hasLegs = legs;
		this.helm = { weight: 0, steer: 0, upX: 0, upZ: 0, armL: 0, armR: 0 };
		this.swim = { tread: 0, crawl: 0, time: 0 };
		this._chain = new Int32Array( 64 );
		this._q = new Quaternion();
		this._p = new Vector3();
		this._s = 1;

	}

	apply( m ) {

		const h = this.helm, s = this.swim;
		if ( h.weight > 1e-3 ) this._helm( m, h );
		if ( s.tread > 1e-3 || s.crawl > 1e-3 ) this._swim( m, s );

	}

	// ---- the helm: lean with the steering, sway against the roll, hands at the wheel when no IK holds them

	_helm( m, h ) {

		const B = this.B, w = h.weight, st = h.steer;
		const spine = B.spine >= 0 ? B.spine : B.pelvis;
		if ( spine >= 0 ) {

			// into the turn (+ = port, the helmsman's left = model +X): the chest turns and leans left; the upper body keeps
			// toward the world's up against the hull roll / pitch (upX / upZ: the counter angles, eased by the caller)
			_qa.setFromAxisAngle( _ay, 0.17 * st );
			_qb.setFromAxisAngle( _az, - 0.09 * st - h.upX );
			_qc.setFromAxisAngle( _ax, h.upZ );
			_qa.multiply( _qb ).multiply( _qc );
			this._rotateModel( m, spine, _qa, w );

		}

		// the weight on the inside foot: the hips 2.5 cm toward the turn
		if ( B.pelvis >= 0 ) this._shift( m, B.pelvis, _va.set( 0.025 * st * w, 0, 0 ) );
		if ( ! this.hasArms ) return;
		for ( const side of [ 1, - 1 ] ) {

			const aw = w * ( side > 0 ? h.armL : h.armR );
			if ( aw <= 1e-3 ) continue;
			const up = side > 0 ? B.upperL : B.upperR, lo = side > 0 ? B.lowerL : B.lowerR, ha = side > 0 ? B.handL : B.handR;
			// elbows down and out, forearms forward: the hands meet the rim at about the wheel's height (~0.95 m)
			this._aim( m, up, lo, _vb.set( side * 0.3, - 0.62, 0.62 ), aw );
			this._aim( m, lo, ha, _vb.set( - side * 0.12, 0.08, 1 ), aw );

		}

	}

	// ---- the water

	_swim( m, s ) {

		const B = this.B, t = s.time;
		const tw = s.tread, cw = s.crawl;
		// treading: sculling (the forearms sweep in and out in front of the chest, elbows wide) and an eggbeater kick
		if ( tw > 1e-3 ) {

			const sweep = 0.5 + 0.5 * Math.sin( t * Math.PI * 2 / 1.4 );
			if ( this.hasArms ) for ( const side of [ 1, - 1 ] ) {

				const up = side > 0 ? B.upperL : B.upperR, lo = side > 0 ? B.lowerL : B.lowerR, ha = side > 0 ? B.handL : B.handR;
				this._aim( m, up, lo, _vb.set( side * 0.7, - 0.45, 0.45 ), tw );
				this._aim( m, lo, ha, _vb.set( side * ( 0.15 + 0.6 * sweep ), - 0.06, 0.8 - 0.4 * sweep ), tw );

			}

			if ( this.hasLegs ) for ( const side of [ 1, - 1 ] ) {

				const th = side > 0 ? B.thighL : B.thighR, ca = side > 0 ? B.calfL : B.calfR, ft = side > 0 ? B.footL : B.footR;
				const a = t * Math.PI * 2 / 1.1 + ( side > 0 ? 0 : Math.PI );
				this._aim( m, th, ca, _vb.set( side * 0.16, - 0.8, 0.42 + 0.15 * Math.sin( a ) ), tw );
				this._aim( m, ca, ft, _vb.set( side * ( 0.18 + 0.14 * Math.cos( a ) ), - 0.85, - 0.3 ), tw );

			}

		}

		// the crawl: the stroke clip carries the arms; the arm under the body comes in along the side instead of the clip's
		// 45 deg A spread at the end of the pull, and the legs flutter (the clip's legs hang straight)
		if ( cw > 1e-3 ) {

			if ( this.hasArms ) for ( const side of [ 1, - 1 ] ) {

				const up = side > 0 ? B.upperL : B.upperR, lo = side > 0 ? B.lowerL : B.lowerR;
				this._fk( m, up );
				_vc.copy( this._p );
				this._fk( m, lo );
				_vd.subVectors( this._p, _vc ).normalize();
				const k = cw * 0.7 * smooth( ( - _vd.y - 0.2 ) / 0.5 );
				if ( k > 1e-3 ) this._aim( m, up, lo, _vb.set( side * 0.12, - 1, 0.18 ), k );

			}

			if ( this.hasLegs ) for ( const side of [ 1, - 1 ] ) {

				const th = side > 0 ? B.thighL : B.thighR, ca = side > 0 ? B.calfL : B.calfR, ft = side > 0 ? B.footL : B.footR;
				const a = Math.sin( t * Math.PI * 2 / 0.55 + ( side > 0 ? 0 : Math.PI ) );
				this._aim( m, th, ca, _vb.set( side * 0.07, - 1, 0.24 * a ), cw );
				this._aim( m, ca, ft, _vb.set( side * 0.07, - 1, 0.32 * a - 0.18 ), cw );

			}

		}

	}

	// ---- model-space helpers on model.local (rotation + translation with a uniform scale per node)

	// node i's model-space rotation / position / scale -> this._q / this._p / this._s
	_fk( m, i ) {

		const C = this._chain;
		let n = 0;
		for ( let k = i; k >= 0 && n < C.length; k = m.parent[ k ] ) C[ n ++ ] = k;
		const q = this._q.set( 0, 0, 0, 1 ), p = this._p.set( 0, 0, 0 );
		let s = 1;
		for ( let j = n - 1; j >= 0; j -- ) {

			const L = m.local[ C[ j ] ];
			_vd.set( L.t[ 0 ], L.t[ 1 ], L.t[ 2 ] ).multiplyScalar( s ).applyQuaternion( q );
			p.add( _vd );
			q.multiply( _qi.set( L.r[ 0 ], L.r[ 1 ], L.r[ 2 ], L.r[ 3 ] ) );
			s *= L.s[ 0 ];

		}

		this._s = s;
		return q;

	}

	// pre-rotate node i by R (model space) at weight w: local' = parentQ^-1 * R_w * nodeQ
	_rotateModel( m, i, R, w ) {

		const par = m.parent[ i ];
		const qp = _qb.copy( par >= 0 ? this._fk( m, par ) : _qi.set( 0, 0, 0, 1 ) );
		const qn = _qc.copy( this._fk( m, i ) );
		const Rw = _qr.copy( R );
		if ( w < 1 ) Rw.set( 0, 0, 0, 1 ).slerp( R, w );
		qn.premultiply( Rw ).premultiply( qp.invert() ).normalize();
		const r = m.local[ i ].r;
		r[ 0 ] = qn.x; r[ 1 ] = qn.y; r[ 2 ] = qn.z; r[ 3 ] = qn.w;

	}

	// turn node i so the direction to its child c points along dir (model space), by weight w
	_aim( m, i, c, dir, w ) {

		this._fk( m, i );
		_vc.copy( this._p );
		this._fk( m, c );
		_vd.subVectors( this._p, _vc );
		if ( _vd.lengthSq() < 1e-10 ) return;
		_vd.normalize();
		_va.copy( dir ).normalize();
		this._rotateModel( m, i, _qa.setFromUnitVectors( _vd, _va ), w );

	}

	// move node i by d (model space)
	_shift( m, i, d ) {

		const par = m.parent[ i ];
		const t = m.local[ i ].t;
		if ( par >= 0 ) {

			const q = this._fk( m, par );
			_vd.copy( d ).applyQuaternion( _qb.copy( q ).invert() ).divideScalar( this._s || 1 );

		} else _vd.copy( d );
		t[ 0 ] += _vd.x; t[ 1 ] += _vd.y; t[ 2 ] += _vd.z;

	}

}

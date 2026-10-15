// The posted crew standing on deck (wave 10): one lite Avatar per member from the roster GLB, the residents' skinned-model
// path (src/world/Residents.js: the avatar's SkinnedModel play / update / hold, no AnimGraph or IK driven), placed every frame
// at the member's deck point in the boat frame (Crew.deckPoint) through the boat's pose, so they ride her like the deck props
// and never collide with anything. Gunners crouch at their side's guns (Gun_Ready; the Gun_Ram loop while the guns reload,
// pose clips built below; a point when the side fires), anglers at the rail holding a rod (Fishing_Hold; a celebration when one lands a fish).
// Cheap: within ANIMATE m of the eye they animate, past it they hold the pose; on a phone (globalThis.__phoneBudget) at most
// CREW_RULES.phoneAnimated of them animate at once.
//
//   const deck = new CrewDeck( { scene, avatarFactory, rodFactory, phone } )
//   deck.sync( members )        [ { id, post, side, slot } ]: spawns / removes / re-posts figures
//   deck.update( dt, { boat, boatId, deckY, visible, eye, reloading: ( side ) => bool } )
//   deck.fired( id ) / deck.caught( id )      one-shot gestures
//   deck.dispose()
// Tests inject avatarFactory (anything with { group, ready, dispose }, ready resolving to a model) and rodFactory.
//
// Wave 19C, life aboard: members carry `look` (the roster GLB a tavern hand wears) and update takes life( id ) -> { act, spot,
// fire } | null from the crew feature: off duty the figure goes to its rest spot (spot, boat frame) and eats, drinks, mends,
// plays dice (crouched), yarns or dozes (Sit_Ground under the awning); on duty it works the post (a cook kneels at the stove, a
// lookout looks about); 'fire' carries buckets between the rail and the fire (fire: { x, z } boat frame), 'pump' works the
// pump brake (Hammer). deck.gesture( id, clip ) plays any one-shot (a cheer, the lookout's point); deck.headOf( id, out )
// the world point over a figure's head (speech bubbles).

import { Vector3, Quaternion, Matrix4, BoxGeometry, Mesh } from '../../engine/index.js';
import { Material } from '../../engine/render/Material.js';
import { Avatar } from '../../player/Avatar.js';
import { CLIPS } from '../../game/Characters.js';
import { CREW_RULES, deckPoint } from './Crew.js';
import { makeRig, poseClip } from '../../player/anim/ClipTools.js';

export const ANIMATE = 60; // m from the eye: farther, the figures hold their pose
const RAM_CLIPS = [ 'Cannon_Ram', 'Gun_Ram', 'Ram_Loop' ]; // a gun ramming loop (a roster take, else the pose clip below)
// the clips of each activity, first one the GLB has (wave 18E's way-of-life takes); none: the post's own
export const ACT_CLIPS = {
	sleep: [ CLIPS.sitGround, CLIPS.seated ], eat: [ CLIPS.eat ], drink: [ CLIPS.drink ], mend: [ CLIPS.kneelWork, CLIPS.fishNet ],
	dice: [ CLIPS.crouch ], talk: [ CLIPS.talkGroup, CLIPS.chat ], fire: [ CLIPS.carryBox ], pump: [ CLIPS.hammer, CLIPS.kneelWork ],
	cook: [ CLIPS.kneelWork ], lookout: [ CLIPS.lookAround ],
};
const CARRY_SPEED = 1.1; // m/s, the Carry_Box loop's stride (Characters.CLIP_SPEED.carry)
const HEAD = 1.95; // m over the deck point: where a speech bubble hangs

// the gunner at the gun (wave 17B: no standing idle by the guns): crouched behind it with the hands forward on the tackle, and
// a ramming loop while the side reloads. Pose clips on the figure's own rig from its idle (AnimDef's { base, keys } recipe,
// ClipTools.poseClip; +X is the character's left, reach: [ wrist x, y, z, elbow pole x, y, z ] in model space)
export const GUNNER_CLIPS = { ready: 'Gun_Ready', ram: 'Gun_Ram' };
const crouchPose = ( drop, extra ) => {

	const a = Math.acos( 1 - drop / 0.6 ) * 180 / Math.PI;
	return { pelvis: [ 0, - drop, 0 ], thigh_l: [ [ 'x', - a ] ], calf_l: [ [ 'x', 2 * a ] ], foot_l: [ [ 'x', - a ] ], thigh_r: [ [ 'x', - a ] ], calf_r: [ [ 'x', 2 * a ] ], foot_r: [ [ 'x', - a ] ], ...extra };

};
const READY = crouchPose( 0.12, { spine_01: [ [ 'x', 14 ] ], head: [ [ 'x', - 10 ] ], reach: { l: [ 0.15, 0.74, 0.3, 1, - 1, 0 ], r: [ - 0.15, 0.74, 0.3, - 1, - 1, 0 ] } } );
const RAM = ( z ) => crouchPose( 0.12, { spine_01: [ [ 'x', 10 + z * 30 ] ], head: [ [ 'x', - 10 ] ], reach: { l: [ 0.1, 0.86, 0.12 + z, 1, - 1, 0 ], r: [ - 0.1, 0.86, 0.12 + z, - 1, - 1, 0 ] } } );
export const GUNNER_RECIPES = {
	Gun_Ready: { keys: [ { t: 0, pose: READY }, { t: 1.97, pose: READY } ] },
	Gun_Ram: { keys: [ { t: 0, pose: RAM( 0 ) }, { t: 0.45, pose: RAM( 0.22 ) }, { t: 0.9, pose: RAM( 0 ) } ] },
};

// builds the gunner clips into a loaded roster model (once; false when the model has no rig / idle to build them on)
export function gunnerClips( model ) {

	if ( ! model || ! model.clips || ! model.gltf || typeof model.clips.get !== 'function' ) return false;
	if ( model.clips.has( GUNNER_CLIPS.ready ) ) return true;
	const base = model.clips.get( 'Idle_Breathe' );
	if ( ! base ) return false;
	try {

		const rig = makeRig( model.gltf );
		if ( rig.index.pelvis === undefined || rig.index.upperarm_r === undefined ) return false;
		for ( const name in GUNNER_RECIPES ) if ( ! model.clips.has( name ) ) model.clips.set( name, poseClip( rig, base, name, GUNNER_RECIPES[ name ].keys, { loopBase: true } ) );
		return true;

	} catch ( e ) {

		return false;

	}

}
const ROD_LEN = 2.2;

const _y = new Vector3( 0, 1, 0 );
const _q = new Quaternion();
const _v = new Vector3();
const _m = new Matrix4();
const _w = new Matrix4();
const _s = new Vector3();

// a world point from the boat frame: the boat's toWorld when it has one (BoatController), else its position / quaternion
function toWorld( boat, local, out ) {

	if ( typeof boat.toWorld === 'function' ) return boat.toWorld( local, out );
	return out.copy( local ).applyQuaternion( boat.quaternion ).add( boat.position );

}

let rodGeo = null, rodMat = null;
function defaultRod( scene ) {

	if ( ! rodGeo ) {

		// the blank along +Z from the grip (the rig's weapon_r socket: +Z along the shaft)
		rodGeo = new BoxGeometry( 0.022, 0.022, ROD_LEN );
		rodGeo.translate( 0, 0, ROD_LEN / 2 - 0.25 );
		rodMat = new Material( { name: 'crew-rod', color: 0x2b2420, roughness: 0.45, underwaterLighting: 'lite' } );

	}

	const m = new Mesh( rodGeo, rodMat );
	m.castShadow = false;
	scene.add( m );
	return m;

}

export class CrewDeck {

	constructor( { scene = null, avatarFactory = null, rodFactory = null, phone = !! globalThis.__phoneBudget } = {} ) {

		this.scene = scene;
		this.avatarFactory = avatarFactory || ( ( o ) => new Avatar( o ) );
		this.rodFactory = rodFactory || ( scene ? () => defaultRod( scene ) : null );
		this.phone = phone;
		this.figures = new Map(); // id -> figure

	}

	sync( members ) {

		const want = new Map( members.map( ( m ) => [ m.id, m ] ) );
		for ( const [ id, f ] of this.figures ) if ( ! want.has( id ) ) this._remove( id, f );
		for ( const m of members ) {

			let f = this.figures.get( m.id );
			if ( ! f ) f = this._spawn( m );
			if ( ! f ) continue;
			if ( f.post !== m.post ) {

				f.post = m.post;
				f.oneShot = null;
				f.clip = null;

			}

			f.side = m.side || 'port';
			f.slot = m.slot | 0;
			if ( f.rod ) f.rod.visible = false; // update shows it again for an angler

		}

	}

	_spawn( m ) {

		if ( ! this.scene ) return null;
		let avatar;
		try {

			avatar = this.avatarFactory( { scene: this.scene, character: m.look || m.id, lite: true } );

		} catch ( e ) {

			return null;

		}

		const f = { id: m.id, post: m.post, side: m.side || 'port', slot: m.slot | 0, avatar, model: null, clip: null, oneShot: null, oneShotT: 0, rod: null, shown: true, act: 'post', carryT: ( m.slot | 0 ) * 1.3 };
		const gen = avatar.ready;
		if ( gen && gen.then ) gen.then( ( model ) => { if ( model && this.figures.get( m.id ) === f ) f.model = model; } ).catch( () => {} );
		else if ( avatar.model ) f.model = avatar.model;
		this.figures.set( m.id, f );
		return f;

	}

	_remove( id, f ) {

		if ( f.avatar && f.avatar.dispose ) f.avatar.dispose();
		if ( f.rod ) {

			if ( f.rod.parent ) f.rod.parent.remove( f.rod );
			else if ( this.scene && this.scene.remove ) this.scene.remove( f.rod );

		}

		this.figures.delete( id );

	}

	// a clip the loaded GLB has (else the fallback)
	_has( f, name ) {

		return !! ( f.model && f.model.clips && f.model.clips.has( name ) );

	}

	_base( f, reloading ) {

		const acts = f.act && f.act !== 'post' ? ACT_CLIPS[ f.act ] : f.post === 'cook' || f.post === 'lookout' ? ACT_CLIPS[ f.post ] : null;
		if ( acts ) for ( const c of acts ) if ( this._has( f, c ) ) return c;
		if ( f.act && f.act !== 'post' ) return CLIPS.idle;
		if ( f.post === 'angler' ) return this._has( f, CLIPS.hold ) ? CLIPS.hold : CLIPS.idle;
		if ( f.post === 'gunner' && f.model && ! f.gunPose ) f.gunPose = gunnerClips( f.model ) ? 'built' : 'none';
		if ( reloading ) for ( const c of RAM_CLIPS ) if ( this._has( f, c ) ) return c;
		return f.post === 'gunner' && this._has( f, GUNNER_CLIPS.ready ) ? GUNNER_CLIPS.ready : CLIPS.idle;

	}

	_oneShot( id, clip ) {

		const f = this.figures.get( id );
		if ( ! f || ! this._has( f, clip ) ) return false;
		f.oneShot = clip;
		const d = f.model.clipDuration ? f.model.clipDuration( clip ) : 0;
		f.oneShotT = d > 0 ? d : 1.6;
		return true;

	}

	fired( id ) {

		return this._oneShot( id, CLIPS.point );

	}

	caught( id ) {

		return this._oneShot( id, CLIPS.celebrate );

	}

	gesture( id, clip ) {

		return this._oneShot( id, clip );

	}

	headOf( id, out ) {

		const f = this.figures.get( id ), g = f && f.avatar && f.avatar.group;
		if ( ! g || ! g.visible || ! f.placed ) return null;
		out.x = g.position.x;
		out.y = g.position.y + HEAD;
		out.z = g.position.z;
		return out;

	}

	// where the figure stands this frame (boat frame): its post, its rest spot, or on the bucket run to the fire
	_place( f, boatId, deckY, L, dt ) {

		const act = f.act;
		if ( act === 'fire' && L && L.fire ) {

			// to and fro between the rail beside the fire and the fire itself, at the carrying stride
			const fx = L.fire.x, fz = L.fire.z, b = deckPoint( boatId, 'angler', 0, 'port', deckY );
			const rx = ( fx >= 0 ? 1 : - 1 ) * Math.abs( b.x ), run = Math.max( 0.6, Math.abs( rx - fx ) - 0.6 );
			f.carryT += dt;
			const ph = ( f.carryT * CARRY_SPEED / run ) % 2, u = ph < 1 ? ph : 2 - ph;
			const ex = fx + ( rx > fx ? 0.6 : - 0.6 );
			const x = rx + ( ex - rx ) * u;
			return { x, y: b.y, z: fz + ( f.slot % 2 ? 0.5 : - 0.5 ), yaw: ( ph < 1 ) === ( ex > rx ) ? Math.PI / 2 : - Math.PI / 2 };

		}

		if ( L && L.spot && act !== 'post' ) return L.spot;
		return deckPoint( boatId, f.post, f.slot, f.side, deckY );

	}

	update( dt, { boat = null, boatId = 'lobster', deckY = null, visible = true, eye = null, reloading = null, life = null } = {} ) {

		const show = !! ( visible && boat && boat.position && boat.quaternion );
		let animated = 0;
		for ( const f of this.figures.values() ) {

			const g = f.avatar && f.avatar.group;
			if ( g && g.visible !== show ) g.visible = show;
			if ( f.avatar && 'visible' in f.avatar ) f.avatar.visible = show;
			if ( ! show || ! g ) {

				if ( f.rod ) f.rod.visible = false;
				continue;

			}

			// the deck point rides the boat's pose; the figure turns with her and faces outboard (or its rest spot, its job)
			const L = life ? life( f.id ) : null;
			const act = L && L.act ? L.act : 'post';
			if ( act !== f.act ) {

				f.act = act;
				f.oneShot = null;

			}

			const p = this._place( f, boatId, deckY, L, dt );
			f.placed = true;
			toWorld( boat, _v.set( p.x, p.y, p.z ), g.position );
			if ( g.quaternion ) g.quaternion.copy( boat.quaternion ).multiply( _q.setFromAxisAngle( _y, p.yaw ) );
			if ( typeof g.updateMatrixWorld === 'function' ) g.updateMatrixWorld( true );

			const m = f.model;
			if ( ! m ) continue;
			const near = ! eye || Math.hypot( eye.x - g.position.x, eye.z - g.position.z ) < ANIMATE;
			const budget = ! this.phone || animated < CREW_RULES.phoneAnimated;
			if ( near && budget ) {

				animated ++;
				if ( f.oneShot ) {

					f.oneShotT -= dt;
					if ( f.oneShotT <= 0 ) f.oneShot = null;

				}

				const want = f.oneShot || this._base( f, f.post === 'gunner' && reloading ? reloading( f.side ) : false );
				if ( m.current !== want ) m.play( want, { fade: 0.25, loop: ! f.oneShot } );
				m.update( dt );

			} else if ( m.hold ) m.hold();

			this._rod( f, g );

		}

	}

	// the angler's rod in the right hand's prop socket (weapon_r, +Z along the shaft)
	_rod( f, g ) {

		if ( f.post !== 'angler' || ( f.act && f.act !== 'post' ) ) {

			if ( f.rod ) f.rod.visible = false;
			return;

		}

		if ( ! f.rod && this.rodFactory ) f.rod = this.rodFactory();
		const r = f.rod;
		if ( ! r ) return;
		const m = f.model;
		if ( ! m || ! m.nodeMatrix || ! m.nodeMatrix( 'weapon_r', _m ) || ! g.matrixWorld ) {

			r.visible = false;
			return;

		}

		_w.multiplyMatrices( g.matrixWorld, _m );
		_w.decompose( r.position, r.quaternion, _s );
		r.visible = true;
		if ( typeof r.updateMatrixWorld === 'function' ) r.updateMatrixWorld( true );

	}

	dispose() {

		for ( const [ id, f ] of [ ...this.figures ] ) this._remove( id, f );

	}

}

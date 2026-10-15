// The launch's coxswain (wave 16A): a roster character standing at the wheel of the harbour launch (the class's helm point,
// boat frame), the crew deck's way of standing a figure on a hull (features/crew/Deck.js: a lite Avatar, the SkinnedModel's
// play / update / hold, no AnimGraph). He faces forward at the wheel (Helm_Idle), turns to the player when he speaks (talk(): the Talk
// clip for a few seconds) or when you are close aboard, and waves when she comes alongside. On the launch's own visual
// (LaunchVisual) he is a child of her group, so he pitches and rolls with her; without one he is placed in the world.
//
//   const cox = new Coxswain( { scene, avatarFactory, name, character } )
//   cox.update( dt, { ship, visual, eye, player } )   per frame while she is out
//   cox.talk( seconds ) / cox.wave()                  cox.world { x, y, z } (his feet)   cox.yaw (local, 0 = forward)
//   cox.dispose()
// The roster has no jerseys: he is a roster character picked from his name (not the one the player wears).

import { Avatar } from '../../player/Avatar.js';
import { CLIPS, CHARACTER_IDS } from '../../game/Characters.js';

export const COX = {
	talk: 3.5, // s of the talk loop per line
	near: 9, // m: closer than this he looks at you
	animate: 60, // m from the eye: farther he holds his pose
	turn: 3, // rad/s he turns at
	reach: 2.6, // rad: how far round he turns from the wheel
};

const wrap = ( a ) => Math.atan2( Math.sin( a ), Math.cos( a ) );

// a roster character for a coxswain's name (stable), never the player's own
export function coxswainCharacter( name, avoid = null ) {

	const pool = CHARACTER_IDS.filter( ( id ) => id !== avoid );
	let h = 0;
	for ( const c of String( name || '' ) ) h = ( Math.imul( h, 31 ) + c.charCodeAt( 0 ) ) >>> 0;
	return pool.length ? pool[ h % pool.length ] : CHARACTER_IDS[ 0 ];

}

export class Coxswain {

	constructor( { scene = null, avatarFactory = null, name = 'Coxswain', character = null, avoid = null } = {} ) {

		this.scene = scene;
		this.name = name;
		this.character = character || coxswainCharacter( name, avoid );
		this.world = { x: 0, y: 0, z: 0 };
		this.local = { x: 0, y: 0, z: 0 };
		this.yaw = 0; // turned from facing forward (+Z of the boat frame), + = toward port
		this.talkT = 0;
		this.oneShot = null;
		this.oneShotT = 0;
		this.model = null;
		this.host = null; // the visual group he stands on, when there is one
		const make = avatarFactory || ( scene ? ( o ) => new Avatar( o ) : null );
		this.avatar = null;
		if ( make ) {

			try {

				this.avatar = make( { scene, character: this.character, lite: true } );

			} catch ( e ) {

				this.avatar = null;

			}

		}

		const a = this.avatar;
		if ( a && a.ready && a.ready.then ) a.ready.then( ( m ) => { if ( this.avatar === a ) this.model = m || a.model || null; } ).catch( () => {} );
		else if ( a && a.model ) this.model = a.model;

	}

	get group() {

		return this.avatar ? this.avatar.group : null;

	}

	talk( seconds = COX.talk ) {

		this.talkT = Math.max( this.talkT, seconds );

	}

	wave() {

		this.oneShot = CLIPS.wave;
		this.oneShotT = 1.8;

	}

	_has( clip ) {

		const m = this.model;
		return !! ( m && m.clips && m.clips.has && m.clips.has( clip ) );

	}

	update( dt, { ship = null, visual = null, eye = null, player = null } = {} ) {

		if ( ! ship || ! ship.cls ) return;
		const c = ship.cls, h = c.helm || { x: 0, z: - c.length * 0.28 };
		this.local.x = h.x || 0;
		this.local.y = c.deck;
		this.local.z = h.z;
		const pose = ship.pose || { y: 0 };
		const sn = Math.sin( ship.yaw ), cs = Math.cos( ship.yaw );
		this.world.x = ship.x + this.local.x * cs + this.local.z * sn;
		this.world.z = ship.z - this.local.x * sn + this.local.z * cs;
		this.world.y = ( pose.y || 0 ) + c.deck;
		if ( this.talkT > 0 ) this.talkT -= dt;
		if ( this.oneShotT > 0 ) {

			this.oneShotT -= dt;
			if ( this.oneShotT <= 0 ) this.oneShot = null;

		}

		// he looks at you while he speaks or when you are close; else ahead, at the wheel
		let want = 0;
		if ( player && Number.isFinite( player.x ) ) {

			const dx = player.x - this.world.x, dz = player.z - this.world.z;
			if ( this.talkT > 0 || this.oneShot || Math.hypot( dx, dz ) < COX.near ) {

				const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs; // (into her frame)
				want = Math.max( - COX.reach, Math.min( COX.reach, Math.atan2( lx, lz ) ) );

			}

		}

		const d = wrap( want - this.yaw ), step = COX.turn * dt;
		this.yaw += Math.abs( d ) <= step ? d : Math.sign( d ) * step;

		const g = this.group;
		if ( ! g ) return;
		const host = visual && visual.group ? visual.group : null;
		if ( host !== this.host ) {

			// on her visual: a child of her group (her pitch and roll); else in the scene
			if ( g.parent && g.parent.remove ) g.parent.remove( g );
			if ( host ) host.add( g );
			else if ( this.scene && this.scene.add ) this.scene.add( g );
			this.host = host;

		}

		if ( host ) {

			g.position.set( this.local.x, this.local.y, this.local.z );
			g.rotation.set( 0, this.yaw, 0 );

		} else {

			g.position.set( this.world.x, this.world.y, this.world.z );
			g.rotation.set( 0, ship.yaw + this.yaw, 0 );

		}

		g.visible = ! visual || visual.group.visible !== false;
		const m = this.model;
		if ( ! m ) return;
		const near = ! eye || Math.hypot( eye.x - this.world.x, eye.z - this.world.z ) < COX.animate;
		if ( ! near ) {

			if ( m.hold ) m.hold();
			return;

		}

		// at the wheel the helm stance (Helm_Idle: Avatar.repairHelmClip swaps in a standing idle on a rig whose helm take is
		// its bind pose), turned toward you the plain idle
		const atWheel = Math.abs( this.yaw ) < 0.5 && this._has( CLIPS.helm );
		const clip = this.oneShot && this._has( this.oneShot ) ? this.oneShot : this.talkT > 0 && this._has( CLIPS.talk ) ? CLIPS.talk : atWheel ? CLIPS.helm : CLIPS.idle;
		if ( m.current !== clip && m.play ) m.play( clip, { fade: 0.25, loop: clip !== this.oneShot } );
		if ( m.update ) m.update( dt );

	}

	dispose() {

		const g = this.group;
		if ( g && g.parent && g.parent.remove ) g.parent.remove( g );
		if ( this.avatar && this.avatar.dispose ) this.avatar.dispose();
		this.avatar = null;
		this.model = null;
		this.host = null;

	}

}

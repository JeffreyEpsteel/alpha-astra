import { Vector3 } from '../../engine/index.js';
import { BOATS } from '../../game/Boats.js';
import { yawToward, wrapAngle } from '../melee/MeleeData.js';

// A captured pirate captain in the player's care. While the player is aboard (helm, deck, seat, swimming beside the boat) the
// prisoner sits in the boat's passenger seat; once the player walks ashore he follows a few steps behind. The avatar (a roster
// character, lite) is driven with the same pose object the player's own avatar gets ( Avatar.update( dt, pose ) ).
//
//   const p = new Prisoner( data, avatar );        data: { id, name, ship, kind, tier, value, character, bountyId?, target?, bountyInfo? }
//   p.update( dt, { player, boat, boatId, terrain } )     per frame
//   p.mode     'aboard' | 'follow'        p.position (world feet)     p.dispose()

const _l = new Vector3(), _pose = { position: new Vector3(), yaw: 0, mode: 'seat', speed: 0, vy: 0, grounded: true, diving: false, frame: null, action: null };
const FOLLOW_GAP = 1.9; // m behind the player
const FOLLOW_SPEED = 2.7;
const MIN_GROUND = 0.12; // he will not wade out

export class Prisoner {

	constructor( data, avatar ) {

		this.data = data;
		this.avatar = avatar;
		this.mode = 'aboard';
		this.position = new Vector3();
		this.yaw = 0;
		this.speed = 0;
		this.placed = false;

	}

	get name() {

		return this.data.name;

	}

	// the passenger seat of the boat (boat frame) the prisoner sits in; a boat without one gets a spot astern of the helm
	static seatOf( boatId ) {

		const b = BOATS[ boatId ];
		if ( b && b.seats && b.seats.length ) return b.seats[ 0 ];
		return { x: 0.4, z: - 1.0, yaw: 0 };

	}

	update( dt, ctx ) {

		const { player, boat, boatId, terrain } = ctx;
		const aboardMode = ctx.hold || player && ( player.mode === 'boat' || player.mode === 'deck' || player.mode === 'seat' || player.mode === 'swim' );
		const want = aboardMode && boat ? 'aboard' : 'follow';
		if ( want !== this.mode || ! this.placed ) this._switch( want, ctx );
		let frame = null, grounded = true;

		if ( this.mode === 'aboard' ) {

			const seat = Prisoner.seatOf( boatId );
			const deckY = ( BOATS[ boatId ] && BOATS[ boatId ].deckY ) || 0.3;
			if ( boat && boat.toWorld ) {

				boat.toWorld( _l.set( seat.x, deckY, seat.z ), this.position );
				frame = boat.quaternion || null;
				this.yaw = ( seat.yaw || 0 ) + Math.PI;

			} else if ( player ) this.position.copy( player.position );

			this.speed = 0;

		} else if ( player ) {

			const p = player.position;
			// the boards of the pier count as ground (Player.groundAt: terrain, colliders, reef), the open sea does not
			const ground = ( x, z ) => ( typeof player.groundAt === 'function' ? player.groundAt( x, z, p.y + 0.6 ) : terrain ? terrain.heightAt( x, z ) : 1 );
			const tx = p.x + Math.sin( player.yaw ) * FOLLOW_GAP, tz = p.z + Math.cos( player.yaw ) * FOLLOW_GAP;
			const dx = tx - this.position.x, dz = tz - this.position.z, d = Math.hypot( dx, dz );
			this.speed = 0;
			if ( d > 0.9 ) {

				const sp = Math.min( FOLLOW_SPEED, d * 1.6 );
				const nx = this.position.x + dx / d * sp * dt, nz = this.position.z + dz / d * sp * dt;
				if ( ground( nx, nz ) > MIN_GROUND ) {

					this.position.x = nx;
					this.position.z = nz;
					this.speed = sp;

				}

				const want = yawToward( 0, 0, dx, dz );
				this.yaw = wrapAngle( this.yaw + wrapAngle( want - this.yaw ) * Math.min( 1, dt * 8 ) );

			} else {

				const want = yawToward( this.position.x, this.position.z, p.x, p.z );
				this.yaw = wrapAngle( this.yaw + wrapAngle( want - this.yaw ) * Math.min( 1, dt * 4 ) );

			}

			this.position.y = Math.max( ground( this.position.x, this.position.z ), player.position.y - 3 );

		}

		if ( this.avatar && this.avatar.update ) {

			_pose.position.copy( this.position );
			_pose.yaw = this.yaw;
			_pose.mode = this.mode === 'aboard' ? 'seat' : 'walk';
			_pose.speed = this.speed;
			_pose.frame = frame;
			_pose.grounded = grounded;
			this.avatar.update( dt, _pose );

		}

	}

	_switch( mode, ctx ) {

		this.mode = mode;
		this.placed = true;
		if ( mode === 'follow' && ctx.player ) {

			// put him beside the player when the boat is not close (a load, a long walk)
			const p = ctx.player.position;
			if ( Math.hypot( this.position.x - p.x, this.position.z - p.z ) > 6 ) {

				this.position.set( p.x + Math.sin( ctx.player.yaw ) * FOLLOW_GAP, p.y, p.z + Math.cos( ctx.player.yaw ) * FOLLOW_GAP );

			}

		}

	}

	dispose() {

		if ( this.avatar && this.avatar.dispose ) this.avatar.dispose();
		this.avatar = null;

	}

}

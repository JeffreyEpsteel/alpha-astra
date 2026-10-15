// Fire aboard (wave 11A, Unreal parity V5), pure logic: one fire source per hull (the player's boat: naval.fireState; an
// AI ship: ship.fire). Naval.js lights it, applies what it burns, and draws it (vfx.fire / stopFire / smoke).
//
//   FIRE.bigChance   a hit from a brigantine's big guns starts a fire 10 % of the time; a ramming crash faster than
//                    FIRE.ramSpeed (7 m/s) FIRE.ramChance of the time, at the contact
//   const f = new Fire()
//   f.ignite( { x, y, z } boat frame ) -> bool (a new fire; a second spark only feeds the one burning)
//   f.update( dt, { headwind (m/s of wind over the deck from ahead), ammo (rounds aboard), sails (bool: canvas to catch) } )
//       -> { hull, sails, magazine, out }   hull / sails: points burnt this step (0.5 / s hull at full, the sails 2x once it
//       has spread past FIRE.spreadAt); magazine: true once, when it held above FIRE.magazineAt for FIRE.magazineT s with
//       powder aboard (the explosion: FIRE.blast of the hull, the ammo is gone); out: it went out this step (by itself after
//       FIRE.life s, or doused)
//   f.douse( amount = FIRE.douseAmount ) -> level left (a bucket chain: the 3 s "Douse the fire" channel at the rail)
//   f.extinguish()   f.burning   f.level 0..1   f.t (s burning)   f.at (where, boat frame)
//   growthMul( headwind )   heading into the wind at speed slows the growth (wind over the deck carries the heat aft)
//   headwindOver( vx, vz, yaw, windX, windZ )   the apparent wind along the bow (m/s; + from ahead)
//   aiDouseTime( crew ) s until an AI crew puts its own fire out (FIRE.aiDouse: 40 s for one hand .. 20 s for three or more)

export const FIRE = {
	grow: 40, // s from a spark to full
	start: 0.05, // a new fire's level
	burn: 0.5, // hull points / s at full
	sailsMul: 2, // the sails lose twice that once it spreads
	spreadAt: 0.5,
	life: 90, // s: then it burns itself out
	magazineAt: 0.8, // above this for magazineT s with powder aboard: the magazine goes up
	magazineT: 10,
	blast: 0.45, // of the hull's points
	bigChance: 0.1,
	ramSpeed: 7, // m/s closing speed
	ramChance: 0.4,
	douseTime: 3, // s of the bucket channel
	douseAmount: 0.4,
	wind: { from: 3, full: 12, min: 0.25 }, // m/s of headwind where the growth starts to slow, where it is slowest, and that factor
	aiDouse: [ 40, 20 ], // s for a crew of one .. three
};

const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );

export function growthMul( headwind = 0 ) {

	const W = FIRE.wind;
	const k = clamp( ( headwind - W.from ) / ( W.full - W.from ), 0, 1 );
	return 1 - ( 1 - W.min ) * k;

}

// the apparent wind along the bow: the way she makes through the air minus the wind (it blows toward wind{X,Z})
export function headwindOver( vx, vz, yaw, windX = 0, windZ = 0 ) {

	const fx = Math.sin( yaw ), fz = Math.cos( yaw );
	return ( vx - windX ) * fx + ( vz - windZ ) * fz;

}

export function aiDouseTime( crew = 2 ) {

	const [ a, b ] = FIRE.aiDouse;
	return a + ( b - a ) * clamp( ( crew - 1 ) / 2, 0, 1 );

}

export class Fire {

	constructor() {

		this.level = 0;
		this.t = 0;
		this.hot = 0; // s above magazineAt
		this.blown = false; // the magazine already went up (once per fire)
		this.at = { x: 0, y: 0, z: 0 };

	}

	get burning() {

		return this.level > 0;

	}

	ignite( p = null ) {

		if ( p ) this.at = { x: +p.x || 0, y: +p.y || 0, z: +p.z || 0 };
		if ( this.burning ) {

			this.level = Math.min( 1, this.level + FIRE.start );
			return false;

		}

		this.level = FIRE.start;
		this.t = 0;
		this.hot = 0;
		this.blown = false;
		return true;

	}

	douse( amount = FIRE.douseAmount ) {

		if ( ! this.burning ) return 0;
		this.level = Math.max( 0, this.level - amount );
		if ( this.level <= 0.001 ) this.extinguish();
		return this.level;

	}

	extinguish() {

		this.level = 0;
		this.t = 0;
		this.hot = 0;

	}

	update( dt, { headwind = 0, ammo = 0, sails = true } = {} ) {

		const r = { hull: 0, sails: 0, magazine: false, out: false };
		if ( ! this.burning || ! ( dt > 0 ) ) return r;
		this.t += dt;
		this.level = Math.min( 1, this.level + dt / FIRE.grow * growthMul( headwind ) );
		r.hull = FIRE.burn * this.level * dt;
		if ( sails && this.level > FIRE.spreadAt ) r.sails = FIRE.burn * FIRE.sailsMul * this.level * dt;
		if ( ammo > 0 && this.level > FIRE.magazineAt && ! this.blown ) {

			this.hot += dt;
			if ( this.hot >= FIRE.magazineT ) {

				this.blown = true;
				r.magazine = true;

			}

		} else if ( this.level <= FIRE.magazineAt ) this.hot = 0;

		if ( this.t >= FIRE.life && ! r.magazine ) {

			this.extinguish();
			r.out = true;

		}

		return r;

	}

	toJSON() {

		return this.burning ? { level: Math.round( this.level * 100 ) / 100, t: Math.round( this.t ), at: this.at } : null;

	}

	fromJSON( d ) {

		this.extinguish();
		if ( ! d || typeof d !== 'object' || ! ( d.level > 0 ) ) return;
		this.level = clamp( d.level, 0, 1 );
		this.t = clamp( +d.t || 0, 0, FIRE.life );
		if ( d.at && typeof d.at === 'object' ) this.at = { x: +d.at.x || 0, y: +d.at.y || 0, z: +d.at.z || 0 };

	}

}

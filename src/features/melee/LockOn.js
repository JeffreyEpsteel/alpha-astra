import { facingDot, yawToward, wrapAngle } from './MeleeData.js';

// Soft lock-on (pure; the tests drive it without a scene). The nearest enemy inside the facing cone is picked,
// scored by distance plus how far off the view it is; a current lock is kept (sticky) while it stays inside the
// wider keep cone and range, so the reticle does not flick between two raiders standing side by side.
//
//   pickLock( { x, z, yaw }, targets, current = null, opts = LOCK ) -> target | null
//      target: { x, z, targetable } (Raider, the training post)
//   assistYaw( yaw, from, to, dt, opts = LOCK ) -> yaw   eases the camera yaw toward the lock (camera-assisted strafing):
//      exponential at opts.assist per second, none when the lock is behind the player (he turned away on purpose)

export const LOCK = {
	range: 9, // m: a lock is picked inside this
	keepRange: 12, // m: and kept inside this
	cone: 0.5, // dot( facing, to target ) for a new lock (60 degrees off the view)
	keepCone: 0.05, // ... to keep it (about 87 degrees)
	angleWeight: 4, // m of distance one unit of (1 - dot) is worth
	assist: 2.4, // 1/s: how fast the camera eases onto the lock
	assistMax: 1.7, // rad: no pull beyond this off the view (behind the player)
	magnet: 0.5, // rad: the most a swing turns the player toward the lock at its start
};

export function pickLock( p, targets, current = null, o = LOCK ) {

	if ( ! p || ! targets ) return null;
	if ( current && current.targetable ) {

		const d = Math.hypot( current.x - p.x, current.z - p.z );
		if ( d <= o.keepRange && ( d < 1 || facingDot( p.yaw, p.x, p.z, current.x, current.z ) >= o.keepCone ) ) return current;

	}

	let best = null, bs = Infinity;
	for ( const t of targets ) {

		if ( ! t || ! t.targetable ) continue;
		const d = Math.hypot( t.x - p.x, t.z - p.z );
		if ( d > o.range ) continue;
		const dot = d < 1 ? 1 : facingDot( p.yaw, p.x, p.z, t.x, t.z );
		if ( dot < o.cone ) continue;
		const score = d + ( 1 - dot ) * o.angleWeight;
		if ( score < bs ) { bs = score; best = t; }

	}

	return best;

}

export function assistYaw( yaw, from, to, dt, o = LOCK ) {

	if ( ! to ) return yaw;
	const want = yawToward( from.x, from.z, to.x, to.z );
	const d = wrapAngle( want - yaw );
	if ( Math.abs( d ) > o.assistMax || Math.hypot( to.x - from.x, to.z - from.z ) < 0.6 ) return yaw;
	return yaw + d * ( 1 - Math.exp( - o.assist * dt ) );

}

// the turn ( rad, signed, at most opts.magnet ) a swing gives toward the lock
export function magnetTurn( yaw, from, to, o = LOCK ) {

	if ( ! to ) return 0;
	const d = wrapAngle( yawToward( from.x, from.z, to.x, to.z ) - yaw );
	return Math.max( - o.magnet, Math.min( o.magnet, d ) );

}

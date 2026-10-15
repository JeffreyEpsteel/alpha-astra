import { Vector3 } from '../../engine/index.js';
import { segmentVsObb, yawBox } from '../naval/Ballistics.js';
import { raySphere, rayCylinderY } from './FirearmsData.js';

// The shot: one hitscan along a ray ( o + d t, t from tMin to tMax ) against everything a ball can stop in. The nearest hit
// wins; on a tie the order of the brief decides: raiders / boarding crew (melee's targets: Raider and the training post),
// then pirate ships (the deck where the crew stand, then the hull), then destruction props, then the world (colliders,
// the ground, the water).
//
//   resolveShot( ctx, o, d, tMin, tMax ) -> { kind, t, x, y, z, target, head, part } | null
//   ctx: {
//     targets:   [ Raider | Dummy ]            melee.targets() (targetable, x / y / z, scale, kind, headPosition( out ))
//     ships:     [ Ship ]                     naval.ships (alive, x / z / yaw, pose.y, cls { beam, length, sheer }, hullBox())
//     skipShip:  ( ship ) -> bool              the ship the player stands on
//     props:     { raycastSegment( ax, ay, az, bx, by, bz ) -> { t: 0..1, id, x, y, z } | null }   (destruction)
//     world:     ( o, d, len ) -> distance (>= len: clear)   (Colliders.raycast)
//     groundAt:  ( x, z ) -> y                 (TerrainData.heightAt)
//     seaLevel:  number
//   }
// kind: 'raider' | 'ship' | 'prop' | 'world' | 'ground' | 'water'; head: a head hit on a humanoid; part: 'deck' | 'hull' on ships.

export const BODY = { radius: 0.3, head: 0.15, neck: 0.12 }; // m at scale 1
export const POST = { radius: 0.36, height: 1.9 }; // the training post (melee TRAINING_POST radius 0.35)
export const DECK = { height: 2.0, inset: 0.85 }; // the crew's box above the deck
const PRIORITY = { raider: 0, ship: 1, prop: 2, world: 3, ground: 3, water: 3 };
const GROUND_STEP = 0.35;

const _h = new Vector3();

function headOf( r, out ) {

	if ( r.headPosition ) {

		try {

			const v = r.headPosition( out );
			if ( v && Number.isFinite( v.y ) ) return v;

		} catch ( e ) { /* the fallback below */ }

	}

	return out.set( r.x, r.y + 1.7 * ( r.scale || 1 ), r.z );

}

// a raider / crew member / the post along the ray: { t, head } or null
export function hitHumanoid( r, o, d, tMin, tMax ) {

	if ( ! r || ! r.targetable ) return null;
	if ( r.kind === 'dummy' ) {

		const t = rayCylinderY( o, d, r.x, r.z, POST.radius, r.y, r.y + POST.height );
		return t >= tMin && t <= tMax ? { t, head: false } : null;

	}

	const s = r.scale || 1;
	const h = headOf( r, _h );
	const hx = h.x, hy = h.y, hz = h.z;
	// broad phase: the ray must pass within 2 m of the chest
	const cx = r.x - o.x, cy = r.y + 1 - o.y, cz = r.z - o.z;
	const along = cx * d.x + cy * d.y + cz * d.z;
	if ( along < tMin - 2 || along > tMax + 2 ) return null;
	const px = cx - d.x * along, py = cy - d.y * along, pz = cz - d.z * along;
	if ( px * px + py * py + pz * pz > 4 ) return null;
	const tb = rayCylinderY( o, d, r.x, r.z, BODY.radius * s, r.y, hy - BODY.neck * s );
	const th = raySphere( o, d, { x: hx, y: hy, z: hz }, BODY.head * s );
	const body = tb >= tMin && tb <= tMax ? tb : - 1;
	const head = th >= tMin && th <= tMax ? th : - 1;
	if ( head >= 0 && ( body < 0 || head <= body + 0.05 ) ) return { t: head, head: true };
	return body >= 0 ? { t: body, head: false } : null;

}

// the box the crew stand in: the deck (sheer) up DECK.height m, inset from the rails
export function deckBox( ship ) {

	const c = ship.cls || {};
	const py = ship.pose && Number.isFinite( ship.pose.y ) ? ship.pose.y : 0;
	const base = py + ( c.sheer || 1 );
	return yawBox( ship.x, base + DECK.height / 2, ship.z, ship.yaw || 0, ( c.beam || 4 ) / 2 * DECK.inset, DECK.height / 2, ( c.length || 12 ) / 2 * DECK.inset );

}

const _p0 = { x: 0, y: 0, z: 0 }, _p1 = { x: 0, y: 0, z: 0 };

// a ship along the ray: { t, part } or null (the deck box first: a ball over the bulwark finds the crew)
export function hitShip( ship, o, d, tMin, tMax ) {

	if ( ! ship || ship.alive === false ) return null;
	const c = ship.cls || {};
	const reach = ( c.length || 12 ) + tMax;
	if ( ( ship.x - o.x ) ** 2 + ( ship.z - o.z ) ** 2 > reach * reach ) return null;
	_p0.x = o.x + d.x * tMin; _p0.y = o.y + d.y * tMin; _p0.z = o.z + d.z * tMin;
	_p1.x = o.x + d.x * tMax; _p1.y = o.y + d.y * tMax; _p1.z = o.z + d.z * tMax;
	const span = tMax - tMin;
	let best = null;
	const test = ( box, part ) => {

		if ( ! box ) return;
		const f = segmentVsObb( _p0, _p1, box );
		if ( ! ( f > 0 ) ) return; // -1 missed, 0 the shot starts inside it (the player's own deck)
		const t = tMin + f * span;
		if ( ! best || t < best.t - 1e-6 ) best = { t, part };

	};

	test( deckBox( ship ), 'deck' );
	let hull = null;
	try { hull = ship.hullBox ? ship.hullBox() : null; } catch ( e ) { hull = null; }
	test( hull, 'hull' );
	return best;

}

// the first ground crossing along the ray (march, then bisect)
export function hitGround( groundAt, o, d, tMin, tMax ) {

	if ( ! groundAt ) return - 1;
	const below = ( t ) => {

		const g = groundAt( o.x + d.x * t, o.z + d.z * t );
		return Number.isFinite( g ) && o.y + d.y * t <= g;

	};

	if ( below( tMin ) ) return - 1; // the muzzle is in the ground (a slope under the camera): no ground hit
	let a = tMin;
	for ( let t = tMin + GROUND_STEP; t <= tMax + GROUND_STEP; t += GROUND_STEP ) {

		const tt = Math.min( t, tMax );
		if ( below( tt ) ) {

			let lo = a, hi = tt;
			for ( let i = 0; i < 12; i ++ ) {

				const m = ( lo + hi ) / 2;
				if ( below( m ) ) hi = m; else lo = m;

			}

			return hi;

		}

		a = tt;
		if ( tt >= tMax ) break;

	}

	return - 1;

}

export function resolveShot( ctx, o, d, tMin, tMax ) {

	const hits = [];
	const push = ( h ) => { if ( h && h.t >= tMin && h.t <= tMax ) hits.push( h ); };

	for ( const r of ctx.targets || [] ) {

		const h = hitHumanoid( r, o, d, tMin, tMax );
		if ( h ) push( { kind: 'raider', t: h.t, target: r, head: h.head && r.kind !== 'dummy' } );

	}

	for ( const s of ctx.ships || [] ) {

		if ( ctx.skipShip && ctx.skipShip( s ) ) continue;
		const h = hitShip( s, o, d, tMin, tMax );
		if ( h ) push( { kind: 'ship', t: h.t, target: s, part: h.part } );

	}

	if ( ctx.props && ctx.props.raycastSegment ) {

		try {

			const span = tMax - tMin;
			const h = ctx.props.raycastSegment( o.x + d.x * tMin, o.y + d.y * tMin, o.z + d.z * tMin, o.x + d.x * tMax, o.y + d.y * tMax, o.z + d.z * tMax );
			if ( h && Number.isFinite( h.t ) ) push( { kind: 'prop', t: tMin + h.t * span, target: h.id } );

		} catch ( e ) { /* no props */ }

	}

	if ( ctx.world ) {

		try {

			const len = tMax - tMin;
			const dist = ctx.world( { x: o.x + d.x * tMin, y: o.y + d.y * tMin, z: o.z + d.z * tMin }, d, len );
			// 0: the shot starts inside a box (a roof over the player): not a hit
			if ( Number.isFinite( dist ) && dist > 0.05 && dist < len - 1e-3 ) push( { kind: 'world', t: tMin + dist } );

		} catch ( e ) { /* no colliders */ }

	}

	const tg = hitGround( ctx.groundAt, o, d, tMin, tMax );
	if ( tg >= 0 ) push( { kind: 'ground', t: tg } );
	const sea = Number.isFinite( ctx.seaLevel ) ? ctx.seaLevel : 0;
	if ( d.y < - 1e-6 ) {

		const tw = ( sea - o.y ) / d.y;
		if ( tw >= tMin && tw <= tMax ) push( { kind: 'water', t: tw } );

	}

	if ( ! hits.length ) return null;
	hits.sort( ( a, b ) => ( Math.abs( a.t - b.t ) < 1e-4 ? PRIORITY[ a.kind ] - PRIORITY[ b.kind ] : a.t - b.t ) );
	const h = hits[ 0 ];
	h.x = o.x + d.x * h.t;
	h.y = o.y + d.y * h.t;
	h.z = o.z + d.z * h.t;
	return h;

}

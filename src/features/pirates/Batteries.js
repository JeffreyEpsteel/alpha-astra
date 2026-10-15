// The shore batteries of the Blackwater fort (wave 12B): two platforms of three guns that fire at a player boat inside their
// reach unless she flies the black flag, with the naval ballistics (leadAim at the boat's motion, gaussian spread) and a slow
// reload. A battery whose gun platform is broken (destruction kind 'gunPlatform') is silenced.
//
//   const bats = new Batteries( layout.batteries, { rng, launch, terrain } );
//   batteryDecision( battery, target, { terrain } ) -> { fire, reason, range }   reasons: 'ok' | 'silenced' | 'noTarget' | 'flag' |
//                        'range' | 'close' | 'arc' | 'reloading' | 'blocked' (the ground between)
//   bats.update( dt, target ) -> balls launched this step      target { ok, x, y, z, vx, vz, friendly } (the player's boat) | null
//   bats.silence( id, why ) / restore( id ) / silenced( id ) / allSilenced() / byId( id ) / list / toJSON() / fromJSON( d )
//
// launch( muzzle { x, y, z }, dir { x, y, z } (unit), { owner, damage, faction, big, speed } ) is the naval feature's: the
// Stronghold passes naval.launchFrom when it exists, else naval.remoteShot (a ball flown here, never re-broadcast).

import { leadAim, MUZZLE_SPEED } from '../naval/Ballistics.js';

const DEG = Math.PI / 180;

export const BATTERY_RULES = {
	range: 220, // m: the guns reach this far (horizontal, muzzle to boat)
	minRange: 30, // m: they cannot depress onto a boat right under the cliff
	guns: 3,
	reload: 9, // s: slow shore guns
	ripple: [ 0.25, 0.6 ], // s between the guns of a salvo
	damage: 30, // per ball (a pirate brigantine's is ~32)
	spread: 0.008, spreadPerM: 0.00009, // rad one-sigma: tight close in, looser at the edge of the reach
	traverse: 72 * DEG, // half arc each side of the battery's facing
	muzzle: 1.6, // m above the platform's ground
	clearance: 0.6, // m the line of fire must keep above the ground
};

const angleDiff = ( a, b ) => Math.atan2( Math.sin( a - b ), Math.cos( a - b ) );

// the straight line from the muzzle to the target stays above the ground (the low arc flies above it)
export function lineClear( terrain, a, b, clearance = BATTERY_RULES.clearance ) {

	if ( ! terrain || ! terrain.heightAt ) return true;
	const L = Math.hypot( b.x - a.x, b.z - a.z );
	for ( let s = 6; s < L - 4; s += 3 ) {

		const k = s / L;
		if ( terrain.heightAt( a.x + ( b.x - a.x ) * k, a.z + ( b.z - a.z ) * k ) > a.y + ( b.y - a.y ) * k - clearance ) return false;

	}

	return true;

}

export function batteryDecision( b, t, { terrain = null, rules = BATTERY_RULES } = {} ) {

	if ( b.silenced ) return { fire: false, reason: 'silenced' };
	if ( ! t || t.ok === false || ! Number.isFinite( t.x ) ) return { fire: false, reason: 'noTarget' };
	if ( t.friendly ) return { fire: false, reason: 'flag' };
	const range = Math.hypot( t.x - b.x, t.z - b.z );
	if ( range > rules.range ) return { fire: false, reason: 'range', range };
	if ( range < rules.minRange ) return { fire: false, reason: 'close', range };
	if ( Math.abs( angleDiff( Math.atan2( t.x - b.x, t.z - b.z ), b.yaw ) ) > rules.traverse ) return { fire: false, reason: 'arc', range };
	if ( b.reload > 0 ) return { fire: false, reason: 'reloading', range };
	if ( ! lineClear( terrain, { x: b.x, y: b.y + rules.muzzle, z: b.z }, { x: t.x, y: ( t.y || 0 ) + 1, z: t.z }, rules.clearance ) ) return { fire: false, reason: 'blocked', range };
	return { fire: true, reason: 'ok', range };

}

export class Batteries {

	constructor( defs, { rng = Math.random, launch = null, terrain = null, rules = BATTERY_RULES } = {} ) {

		this.rules = rules;
		this.rng = rng;
		this.launch = launch;
		this.terrain = terrain;
		this.list = defs.map( ( d ) => ( { ...d, reload: 0, silenced: false, why: null, salvos: 0 } ) );
		this.queue = []; // { t, b, gun }
		this.stats = { salvos: 0, balls: 0 };

	}

	byId( id ) {

		return this.list.find( ( b ) => b.id === id ) || null;

	}

	silenced( id ) {

		const b = this.byId( id );
		return !! ( b && b.silenced );

	}

	allSilenced() {

		return this.list.every( ( b ) => b.silenced );

	}

	// a broken platform (or a blown magazine beside it) puts the battery out of action until it is rebuilt
	silence( id, why = 'platform' ) {

		const b = this.byId( id );
		if ( ! b || b.silenced ) return false;
		b.silenced = true;
		b.why = why;
		this.queue = this.queue.filter( ( q ) => q.b !== b );
		return true;

	}

	restore( id ) {

		const b = this.byId( id );
		if ( ! b || ! b.silenced ) return false;
		b.silenced = false;
		b.why = null;
		b.reload = this.rules.reload * 0.5;
		return true;

	}

	_gauss() {

		const u = Math.max( 1e-9, this.rng() ), v = this.rng();
		return Math.sqrt( - 2 * Math.log( u ) ) * Math.cos( 2 * Math.PI * v );

	}

	// one gun of a salvo: lead the boat, spread, launch
	_fireGun( b, gun, t ) {

		const R = this.rules;
		const m = { x: gun.x, y: b.y + R.muzzle, z: gun.z };
		const aim = leadAim( m, { x: 0, y: 0, z: 0 }, { x: t.x, y: ( t.y || 0 ) + 0.9, z: t.z }, { x: t.vx || 0, y: 0, z: t.vz || 0 }, MUZZLE_SPEED );
		if ( ! aim ) return null;
		const range = Math.hypot( t.x - m.x, t.z - m.z );
		const sigma = R.spread + R.spreadPerM * range;
		const d = aim.dir;
		// across (horizontal) and up-ish perpendiculars
		let ux = - d.z, uz = d.x;
		const ul = Math.hypot( ux, uz ) || 1;
		ux /= ul; uz /= ul;
		const g1 = this._gauss() * sigma, g2 = this._gauss() * sigma * 0.6;
		let dx = d.x + ux * g1, dy = d.y + g2, dz = d.z + uz * g1;
		const l = Math.hypot( dx, dy, dz );
		dx /= l; dy /= l; dz /= l;
		this.stats.balls ++;
		const dir = { x: dx, y: dy, z: dz };
		if ( this.launch ) this.launch( m, dir, { owner: 'battery-' + b.id, damage: R.damage, faction: 'pirate', big: true, speed: MUZZLE_SPEED } );
		return { from: m, dir };

	}

	update( dt, target ) {

		const R = this.rules, out = [];
		for ( const b of this.list ) {

			b.reload = Math.max( 0, b.reload - dt );
			const d = batteryDecision( b, target, { terrain: this.terrain, rules: R } );
			b.last = d.reason;
			if ( ! d.fire ) continue;
			b.reload = R.reload * ( 0.95 + 0.15 * this.rng() );
			b.salvos ++;
			this.stats.salvos ++;
			let t = 0;
			for ( let i = 0; i < Math.min( R.guns, b.guns.length ); i ++ ) {

				this.queue.push( { t, b, gun: b.guns[ i ] } );
				t += R.ripple[ 0 ] + ( R.ripple[ 1 ] - R.ripple[ 0 ] ) * this.rng();

			}

		}

		for ( let i = this.queue.length - 1; i >= 0; i -- ) {

			const q = this.queue[ i ];
			q.t -= dt;
			if ( q.t > 0 ) continue;
			this.queue.splice( i, 1 );
			// the boat may have slipped out of reach or hoisted the flag between the guns
			if ( q.b.silenced || ! target || target.friendly || target.ok === false ) continue;
			const shot = this._fireGun( q.b, q.gun, target );
			if ( shot ) out.push( { battery: q.b.id, ...shot } );

		}

		return out;

	}

	toJSON() {

		return { silenced: this.list.filter( ( b ) => b.silenced ).map( ( b ) => [ b.id, b.why ] ) };

	}

	fromJSON( d ) {

		for ( const b of this.list ) { b.silenced = false; b.why = null; b.reload = 0; }
		this.queue.length = 0;
		if ( d && Array.isArray( d.silenced ) ) for ( const e of d.silenced ) if ( Array.isArray( e ) && typeof e[ 0 ] === 'string' ) this.silence( e[ 0 ], String( e[ 1 ] || 'platform' ).slice( 0, 16 ) );

	}

}

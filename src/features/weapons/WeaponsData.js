// The arsenal's data and pure maths (wave 18D): the melee weapons, the throwables, the cannon shot kinds, the quick slots,
// the raiders' loadouts, the throw arc and the blast falloff. No engine, no DOM (the tests and the feature share it).
// The firearms (pistol, duelling pair, musket, long rifle, blunderbuss, harpoon gun) stay in firearms/FirearmsData.js
// because the universe server imports that file for its gunshot gate.
//
//   MELEE[ id ]       paddle (free starter), cutlass, boarding axe, belaying pin, harpoon: damage, reach (m), cone (dot), contact /
//                     total / whiff (s), stamina, energy (J on props), parry (s added to the parry window), chip (x the stamina a
//                     block costs), guardBreak (through a cutlass guard and an armoured wind-up), combo (damage x per blow of a
//                     chain), stun (s added to a raider's stagger), throw (the harpoon: thrown and pulled back on its line)
//   THROWN[ id ]      powder bomb (fuse, blast), fire bottle (burns, sets a ship alight), smoke pot (hides you from raiders)
//   SHOT[ id ]        cannon shot for the player's guns: round (the default), chain (sails and masts), grape (the crew)
//   SLOTS             the quick slots 1-4: melee, sidearm, long gun, throwable (or the swivel gun from your own deck)
//   VENDOR            'chandlery' (Ethena Prosper's Gear tab, the legal ones) | 'blackmarket' (Blackwater's fence)
//   raiderLoadout( id, tier, kind, weapon )   the weapon a raider carries ('cutlass' | 'blunderbuss' | null)
//   arcPoints( from, vel, opts )   the throw's flight (the preview dots and the projectile share it)
//   throwVelocity( dir, speed, loft )   blastFactor( d, radius )

export const MELEE = {
	paddle: {
		id: 'paddle', name: 'Paddle', price: 0, vendor: null, model: 'paddle',
		// = MeleeData PLAYER (wave 12E): the numbers the combat harness was tuned on
		damage: 24, range: 2.6, cone: 0.5, contact: 0.3, total: 0.62, whiff: 0.78, stamina: 0.08, energy: 960,
		parry: 0, chip: 1, guardBreak: false, combo: null, stun: 0,
		desc: 'The free starter: a broad blade on a stout loom',
	},
	cutlass: {
		id: 'cutlass', name: 'Cutlass', price: 140, vendor: 'chandlery', model: 'cutlass',
		// quick and parry friendly: a longer parry window, cheaper blocks, a three-blow chain whose third cut bites deeper
		damage: 20, range: 2.5, cone: 0.45, contact: 0.2, total: 0.46, whiff: 0.6, stamina: 0.06, energy: 700,
		parry: 0.08, chip: 0.6, guardBreak: false, combo: [ 1, 1, 1.5 ], stun: 0,
		desc: 'Fast, and it parries well · the third cut of a chain bites deeper',
	},
	axe: {
		id: 'axe', name: 'Boarding axe', price: 160, vendor: 'blackmarket', model: 'axe',
		// slow and heavy: it goes through a cutlass guard and an armoured wind-up, and splits doors, crates and rails
		damage: 42, range: 2.4, cone: 0.5, contact: 0.48, total: 1.0, whiff: 1.1, stamina: 0.15, energy: 4200,
		parry: 0, chip: 1.2, guardBreak: true, combo: null, stun: 0.2,
		desc: 'Slow · breaks guards, doors and crates',
	},
	pin: {
		id: 'pin', name: 'Belaying pin', price: 25, vendor: 'chandlery', model: 'pin',
		damage: 16, range: 2.1, cone: 0.55, contact: 0.22, total: 0.44, whiff: 0.55, stamina: 0.05, energy: 600,
		parry: 0.02, chip: 0.9, guardBreak: false, combo: null, stun: 0.25,
		desc: 'A cheap club off the rail · it rattles a man',
	},
	harpoon: {
		id: 'harpoon', name: 'Harpoon', price: 90, vendor: 'chandlery', model: 'harpoon',
		// a thrust: long reach, a narrow line; thrown (hold the aim, release) it flies on its line and is pulled back
		damage: 28, range: 3.6, cone: 0.85, contact: 0.3, total: 0.68, whiff: 0.8, stamina: 0.09, energy: 1200,
		parry: 0, chip: 1, guardBreak: false, combo: null, stun: 0,
		throw: { speed: 24, damage: 46, line: 28, pull: 1.1, stamina: 0.12 },
		desc: 'A long thrust · RMB aims a throw, LMB lets it fly and the line brings it back',
	},
};
export const MELEE_ORDER = [ 'paddle', 'cutlass', 'axe', 'pin', 'harpoon' ];

export const THROWN = {
	bomb: {
		id: 'bomb', name: 'Powder bomb', pack: 3, price: 45, vendor: 'blackmarket', max: 9, model: 'bomb',
		// the fuse is lit as it leaves the hand; it bounces and rolls, then the blast: raiders, props (destruction), hulls
		fuse: 2.2, speed: 14, radius: 4.5, damage: 95, energy: 60000, hull: 14, bounce: 0.35,
		desc: 'Fuse and blast · breaks props, knocks men flat, holes a hull',
	},
	firebottle: {
		id: 'firebottle', name: 'Fire bottle', pack: 3, price: 36, vendor: 'blackmarket', max: 9, model: 'firebottle',
		// it shatters where it lands: a pool of fire that burns whoever stands in it; on a deck it sets the ship alight
		speed: 15, radius: 2.2, burn: 14, time: 7, bounce: 0,
		desc: 'Shatters into fire · sets a ship\'s deck alight',
	},
	smoke: {
		id: 'smoke', name: 'Smoke pot', pack: 3, price: 24, vendor: 'chandlery', max: 9, model: 'smoke',
		// thick smoke for a while: raiders lose sight of you while you stand in it
		speed: 12, radius: 5, time: 14, bounce: 0.2,
		desc: 'A cloud to slip away in · raiders lose you inside it',
	},
};
export const THROWN_ORDER = [ 'bomb', 'firebottle', 'smoke' ];

export const SHOT = {
	round: { id: 'round', name: 'Round shot', desc: 'The hull' },
	// chain shot: a share of the blow goes to the canvas and the mast on top of the hull's (through naval's public Ship.damage)
	chain: { id: 'chain', name: 'Chain shot', pack: 6, price: 54, vendor: 'chandlery', max: 24, sails: 14, mast: 6, desc: 'Two balls on a chain · tears sails and masts' },
	// grape shot: the deck is swept: crew down (a crippled pirate is easier to board), little hull damage
	grape: { id: 'grape', name: 'Grape shot', pack: 6, price: 48, vendor: 'blackmarket', max: 24, crew: 2, desc: 'A bag of balls · sweeps the crew off the deck' },
};
export const SHOT_ORDER = [ 'round', 'chain', 'grape' ];

// the quick slots (keyboard 1-4 on foot; at the helm 1-3 pick the shot). Emotes use 1-4 only while their row is open (5).
export const SLOTS = [
	{ key: 'Digit1', kind: 'melee', label: 'Melee' },
	{ key: 'Digit2', kind: 'side', label: 'Sidearm' },
	{ key: 'Digit3', kind: 'long', label: 'Long gun' },
	{ key: 'Digit4', kind: 'thrown', label: 'Throwable' },
];
export const CYCLE_KEY = 'Digit0'; // the touch Weapon button (and 0 on a keyboard): the next weapon

export const VENDOR = { chandlery: 'chandlery', blackmarket: 'blackmarket' };

// a raider's arms: an explicit slot.weapon wins; the captain carries a cutlass; den / fort guards and boarding crews are armed
// by their index (deterministic: the same guard always carries the same thing); arena and practice raiders carry nothing
// (the combat harness, test/feature-combat-play.mjs, was tuned on them)
export const RAIDER_ARMS = {
	cutlass: { block: 0.35, damage: 1.1, model: 'cutlass' }, // block: chance a frontal plain blow is turned aside
	blunderbuss: { damage: 1.4, range: 9, model: 'blunderbuss', every: 4.2, windup: 1.0 }, // the gunman: hangs back and fires
};

export function raiderLoadout( id = '', tier = 2, kind = 'raider', weapon = undefined ) {

	if ( weapon !== undefined ) return RAIDER_ARMS[ weapon ] ? weapon : null;
	if ( kind === 'captain' ) return 'cutlass';
	const s = String( id );
	let m = /^bd-crew-(\d+)$/.exec( s );
	if ( m ) {

		const i = + m[ 1 ];
		return i % 4 === 2 ? 'blunderbuss' : i % 2 === 0 ? 'cutlass' : null;

	}

	m = /-guard-(\d+)$/.exec( s );
	if ( m ) {

		const i = + m[ 1 ];
		if ( i % 4 === 1 ) return 'blunderbuss';
		return tier >= 3 || i % 3 === 0 ? 'cutlass' : null;

	}

	return null;

}

// ---- the throw

export const GRAVITY = 9.8;
export const LOFT = 0.32; // rad added above the look so a level throw arcs

// the launch velocity along a unit look direction, lofted (looking well down it is lobbed short)
export function throwVelocity( dir, speed, loft = LOFT, out = {} ) {

	const h = Math.hypot( dir.x, dir.z ) || 1e-6;
	const look = Math.atan2( dir.y, h );
	const pitch = Math.max( - 1.3, Math.min( 1.25, look + loft ) );
	// looking down at your feet you drop it short (a lob, not a fastball into the ground)
	if ( look < - 0.4 ) speed *= Math.max( 0.25, 1 + ( look + 0.4 ) * 1.2 );
	const c = Math.cos( pitch );
	out.x = dir.x / h * c * speed;
	out.y = Math.sin( pitch ) * speed;
	out.z = dir.z / h * c * speed;
	return out;

}

// the flight from `from` with `vel` until it meets the ground (groundAt) / the sea, or `maxT` s: [ { x, y, z, t } ], the last one
// the landing (its `hit`: 'ground' | 'water' | null). step: s between points
export function arcPoints( from, vel, { groundAt = null, seaLevel = 0, step = 0.05, maxT = 4, gravity = GRAVITY } = {} ) {

	const pts = [];
	let x = from.x, y = from.y, z = from.z, vy = vel.y;
	for ( let t = 0; t <= maxT + 1e-9; t += step ) {

		x = from.x + vel.x * t;
		z = from.z + vel.z * t;
		y = from.y + vel.y * t - 0.5 * gravity * t * t;
		vy = vel.y - gravity * t;
		const g = groundAt ? groundAt( x, z ) : - Infinity;
		const floor = Math.max( Number.isFinite( g ) ? g : - Infinity, seaLevel );
		if ( t > 0 && y <= floor && vy < 0 ) {

			pts.push( { x, y: floor, z, t, hit: Number.isFinite( g ) && g >= seaLevel ? 'ground' : 'water' } );
			return pts;

		}

		pts.push( { x, y, z, t, hit: null } );

	}

	return pts;

}

// how much of a blast reaches d m from its centre: 1 at the centre, eased to 0 at the radius
export function blastFactor( d, radius ) {

	if ( ! ( radius > 0 ) || ! ( d >= 0 ) || d >= radius ) return 0;
	const k = 1 - d / radius;
	return k * Math.sqrt( k );

}

// the harpoon's thrown flight: straight-ish and fast; the line pulls it home over `pull` s
export function lineLeft( thrownAt, now, pull ) {

	return Math.max( 0, 1 - ( now - thrownAt ) / Math.max( 1e-3, pull ) );

}

export const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );

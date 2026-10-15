// Numbers and pure rules of the rescue feature (wave 15D): the flare pack, the flare's flight, who answers a flare and
// what the ride costs. No state here: Rescue.js runs them, test/feature-rescue.mjs checks them.
import { WORLD } from '../../world/WorldLayout.js';

// the flare pack (chandlery / harbour agents) and one flare: held F for `hold` s; it climbs `rise` s at `speed` m/s
// (gravity pulls it over), bursts and hangs under its parachute for `burn` s, sinking `sink` m/s and drifting downwind
export const FLARE = {
	pack: 3, price: 45, max: 9, hold: 0.5, cooldown: 4,
	rise: 2.4, speed: 68, burn: 25, sink: 1.6, drift: 0.7,
	light: { color: [ 1.0, 0.16, 0.1 ], intensity: 900, range: 240 },
};

// the answer: the nearest port's launch within portRange of the flare (or a passing merchant / fisher within passRange),
// after answer s (passAnswer for a ship already close); farther than portRange from every port, a merchant on passage
// happens by after ocean s. A high notoriety (pirates.notorietyLevel() >= pirateLevel) may bring a black sail instead.
export const RESCUE = {
	answer: [ 60, 120 ], passAnswer: [ 15, 30 ], ocean: [ 120, 180 ],
	portRange: 2500, passRange: 600, oceanSpawn: 420, launchOut: 900, // (a port farther than launchOut: the launch was already out on the harbour patrol)
	alongside: 4, slowAt: 60, sight: 450, wait: 180, deliver: 25, stuck: 6, rideMax: 480, leave: 40,
	pirateLevel: 4, pirateChance: 0.45, // per level from pirateLevel - 1
	fee: { base: 25, perKm: 60, tow: 1.5 },
};

// the harbour launch: naval's 'launch' class when there is one, else a trawler hull tuned as a fast open launch
export const LAUNCH = { kind: 'launch', fallback: 'trawler', tune: { label: 'Harbour launch', speed: 9, accel: 1.4, decel: 1.8, turn: 0.5 } };
export const COXSWAINS = [ 'Mabry', 'Old Tolan', 'Wren Achterberg', 'Isak Pell', 'Dora Kettle' ];

// the fee at the dock: a base and a rate per km from where the flare went up (x tow when your boat came in on a line)
export function rescueFee( dist, { tow = false } = {} ) {

	const f = RESCUE.fee;
	return Math.round( ( f.base + Math.max( 0, dist ) / 1000 * f.perKm ) * ( tow ? f.tow : 1 ) );

}

// the port whose dock is nearest ( x, z ): { port, d } | null (WORLD.ports grows: read it every time)
export function nearestPort( x, z, ports = WORLD.ports ) {

	let best = null, bd = Infinity;
	for ( const p of ports || [] ) {

		const q = p && p.dock && p.dock.position;
		if ( ! q ) continue;
		const d = Math.hypot( q.x - x, q.z - z );
		if ( d < bd ) { bd = d; best = p; }

	}

	return best ? { port: best, d: bd } : null;

}

const range = ( rng, [ a, b ] ) => a + ( b - a ) * rng();

// who answers a flare at ( x, z ): { by: 'pirate' | 'merchant' | 'launch', delay, ship?, port?, ocean? }
//   ships: naval's ships (a merchant afloat, not running, within passRange answers first); notoriety: the HUD pips 0..5
export function planResponse( { x, z, ports = WORLD.ports, ships = [], notoriety = 0, rng = Math.random } ) {

	if ( notoriety >= RESCUE.pirateLevel && rng() < ( notoriety - RESCUE.pirateLevel + 1 ) * RESCUE.pirateChance ) {

		return { by: 'pirate', delay: range( rng, RESCUE.answer ) };

	}

	let pass = null, pd = RESCUE.passRange;
	for ( const s of ships ) {

		if ( ! s || ! s.alive || s.faction === 'pirate' || s.puppet || s.rescuing ) continue;
		if ( s.state === 'flee' || s.state === 'sinking' ) continue;
		const d = Math.hypot( s.x - x, s.z - z );
		if ( d < pd ) { pd = d; pass = s; }

	}

	if ( pass ) return { by: 'merchant', ship: pass, delay: range( rng, RESCUE.passAnswer ) };
	const np = nearestPort( x, z, ports );
	if ( np && np.d <= RESCUE.portRange ) return { by: 'launch', port: np.port, delay: range( rng, RESCUE.answer ) };
	return { by: 'merchant', ocean: true, port: np ? np.port : null, delay: range( rng, RESCUE.ocean ) };

}

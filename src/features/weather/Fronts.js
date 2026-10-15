// Storm fronts at sea (wave 19B): a pure function of the absolute island time, like the schedule (Schedule.js). Every client that
// derives the same island hours from the universe clock (Weather._time: the server's clock in a universe) sees the same front in
// the same place with no messages: where its line is, the squall it pushes ahead, its lightning and its waterspout.
//
// A front is a long ragged line of weather that crosses the whole sea in one direction. Front slots come every FRONT.every
// island hours; a slot carries one with FRONT.chance (never on the first day's fair morning), starting at a jittered hour and
// moving FRONT.speed m per island hour (11 m/s at the 40-minute day) from FRONT.reach m behind the map's centre to as far past
// it. Behind its leading edge lies FRONT.width m of weather (rain, the sea getting up), then the clearing: FRONT.calm m where
// the wind dies away. At the edge itself the squall: gusts of up to FRONT.maxGust m/s over the steady wind, along the front's
// travel, coming and going.
//
//   frontAt( A ) -> front | null             { id, t0, t1, angle, dir: { x, z }, lat: { x, z }, speed, strength, p1, p2, spout }
//   edgeOffset( f, A ) -> m                  the leading edge's distance from the centre along dir (before the wobble)
//   wobble( f, v ) -> m                      the ragged line at lateral offset v
//   influence( f, x, z, A, out ) -> out      { depth (m behind the edge; < 0 ahead), rain 0..1, squall 0..1, calm 0..1, under }
//   gustAt( f, x, z, A, out ) -> out         { x, z, speed } the squall's wind over the steady wind (bounded by FRONT.maxGust)
//   strikesBetween( f, A0, A1, cb, max )      the lightning strikes of island hours (A0, A1]: cb( { x, z, at, j } )
//   spoutAt( f, A ) -> { x, z, r, life } | null     a waterspout (rare: FRONT.spoutChance of the fronts), inside the band
//   arrival( x, z, A, within ) -> { inHours, from, strength, passHours, id } | null   when the next front reaches (x, z)
//   forecastText( x, z, A, { speed } ) -> string   the harbourmaster's / the plane radio's words
//   compass( angle ) -> 'south-west' ...    the quarter a heading points to (angle: atan2( x, z ), +z south)

import { hash } from './Schedule.js';

export const FRONT = {
	every: 9, // island hours between front slots
	chance: 0.55,
	jitter: 0.3, // of `every`: the start's spread (a front is gone before the next slot's can start)
	speed: 1100, // m per island hour
	width: 900, // m of weather behind the edge
	squall: 170, // m: the squall's reach either side of the edge
	calm: 700, // m of dying wind behind the band
	reach: 2900, // m: the crossing starts this far behind the centre and ends as far past it
	center: { x: 700, z: 150 },
	wobble: 170, // m: how ragged the line is
	maxGust: 13, // m/s
	// (an island hour is 100 s of real time at the 40-minute day: 0.1 h is a slot every 10 s. It was 0.0012 h, a slot every
	// 0.12 s, which strobed the whole sea with the front's lightning several times a second: the wave 21 play-test)
	strikeStep: 0.1, // island hours per lightning slot (10 s of real time at the 40-minute day)
	strikeP: 0.35, // chance per slot, times the front's strength: a strike somewhere along the line every ~30 - 50 s
	spoutChance: 0.12,
	spoutLife: 0.5, // island hours
};

const TAU = Math.PI * 2;
const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );
const smooth = ( a, b, x ) => {

	const t = clamp( ( x - a ) / ( b - a ), 0, 1 );
	return t * t * ( 3 - 2 * t );

};

// the crossing in island hours
export function crossHours() {

	return ( 2 * FRONT.reach + FRONT.width + FRONT.calm ) / FRONT.speed;

}

function slotFront( k ) {

	if ( k < 2 || hash( k, 41 ) >= FRONT.chance ) return null; // (k < 2: the first morning is fair)
	const t0 = k * FRONT.every + FRONT.jitter * FRONT.every * hash( k, 42 );
	const angle = hash( k, 43 ) * TAU;
	const dir = { x: Math.sin( angle ), z: Math.cos( angle ) };
	return {
		id: k, t0, t1: t0 + crossHours(), angle, dir, lat: { x: - dir.z, z: dir.x },
		speed: FRONT.speed, strength: 0.6 + 0.4 * hash( k, 44 ),
		p1: hash( k, 45 ) * TAU, p2: hash( k, 46 ) * TAU,
		spout: hash( k, 47 ) < FRONT.spoutChance,
	};

}

// the front crossing the sea at island hour A (one at a time by construction), or null
export function frontAt( A ) {

	if ( ! Number.isFinite( A ) ) return null;
	const k = Math.floor( A / FRONT.every );
	for ( let i = k; i >= k - 1; i -- ) {

		const f = slotFront( i );
		if ( f && A >= f.t0 && A < f.t1 ) return f;

	}

	return null;

}

export function edgeOffset( f, A ) {

	return - FRONT.reach + f.speed * ( A - f.t0 );

}

export function wobble( f, v ) {

	return FRONT.wobble * ( 0.6 * Math.sin( v / 520 + f.p1 ) + 0.4 * Math.sin( v / 210 + f.p2 ) );

}

// along / lateral coordinates of (x, z) in the front's frame
function frame( f, x, z ) {

	const dx = x - FRONT.center.x, dz = z - FRONT.center.z;
	return [ dx * f.dir.x + dz * f.dir.z, dx * f.lat.x + dz * f.lat.z ];

}

export function influence( f, x, z, A, out = {} ) {

	out.depth = - Infinity;
	out.rain = 0;
	out.squall = 0;
	out.calm = 0;
	out.under = false;
	if ( ! f ) return out;
	const [ u, v ] = frame( f, x, z );
	const depth = edgeOffset( f, A ) + wobble( f, v ) - u;
	const W = FRONT.width;
	out.depth = depth;
	// the band: up fast behind the edge, heavy over its first half, thinning to its back
	out.rain = f.strength * smooth( - 40, 140, depth ) * ( 1 - smooth( W * 0.55, W, depth ) );
	// the squall: either side of the edge, strongest just behind it
	const q = ( depth - 50 ) / FRONT.squall;
	out.squall = f.strength * Math.exp( - q * q );
	// the clearing behind the band
	out.calm = smooth( W * 0.85, W + 80, depth ) * ( 1 - smooth( W + FRONT.calm * 0.6, W + FRONT.calm, depth ) );
	out.under = depth > 0 && depth < W;
	return out;

}

// the squall's gusts: along the front's travel, rising and falling over ~10 s of real time (a function of the island hour)
export function gustAt( f, x, z, A, out = {} ) {

	out.x = 0;
	out.z = 0;
	out.speed = 0;
	if ( ! f ) return out;
	const inf = influence( f, x, z, A, _inf );
	if ( inf.squall < 0.02 ) return out;
	const g = A / 0.0016; // (the gust rhythm: island hours to ~10 s periods)
	const puff = 0.55 + 0.45 * Math.sin( g + f.p1 ) * Math.sin( g * 0.43 + f.p2 );
	const s = clamp( FRONT.maxGust * inf.squall * puff, 0, FRONT.maxGust );
	out.speed = s;
	out.x = f.dir.x * s;
	out.z = f.dir.z * s;
	return out;

}

const _inf = {};

// the strikes of the slots in (A0, A1]: inside the band, anywhere along the line (max: a long jump of the clock fires no barrage)
export function strikesBetween( f, A0, A1, cb, max = 3 ) {

	if ( ! f || ! ( A1 > A0 ) ) return 0;
	const step = FRONT.strikeStep;
	let j = Math.floor( A0 / step ) + 1;
	const last = Math.floor( A1 / step );
	if ( last - j > 400 ) j = last - 400;
	let n = 0;
	for ( ; j <= last && n < max; j ++ ) {

		const at = j * step;
		if ( at < f.t0 || at >= f.t1 ) continue;
		if ( hash( f.id, j, 51 ) >= FRONT.strikeP * f.strength ) continue;
		const v = ( hash( f.id, j, 52 ) - 0.5 ) * 2 * FRONT.reach;
		const depth = 60 + hash( f.id, j, 53 ) * FRONT.width * 0.65;
		const u = edgeOffset( f, at ) + wobble( f, v ) - depth;
		const x = FRONT.center.x + f.dir.x * u + f.lat.x * v, z = FRONT.center.z + f.dir.z * u + f.lat.z * v;
		cb( { x, z, at, j } );
		n ++;

	}

	return n;

}

// a waterspout: on FRONT.spoutChance of the fronts, for FRONT.spoutLife island hours in the middle of the crossing, 250 m behind
// the edge at a lateral place of its own; it creeps along the line a little
export function spoutAt( f, A ) {

	if ( ! f || ! f.spout ) return null;
	const mid = ( f.t0 + f.t1 ) / 2 - 0.35 * crossHours() * hash( f.id, 61 );
	const life = FRONT.spoutLife;
	if ( A < mid || A > mid + life ) return null;
	const k = ( A - mid ) / life;
	const v = ( hash( f.id, 62 ) - 0.5 ) * 2400 + ( k - 0.5 ) * 220;
	const u = edgeOffset( f, A ) + wobble( f, v ) - 250;
	return {
		x: FRONT.center.x + f.dir.x * u + f.lat.x * v, z: FRONT.center.z + f.dir.z * u + f.lat.z * v,
		r: 6 + 4 * Math.sin( k * Math.PI ), life: Math.sin( k * Math.PI ), // 0 -> 1 -> 0 over its life
	};

}

const QUARTERS = [ 'south', 'south-east', 'east', 'north-east', 'north', 'north-west', 'west', 'south-west' ];
// the quarter a heading points to (atan2( x, z ): 0 is +z, the south)
export function compass( angle ) {

	const i = Math.round( ( ( angle % TAU ) + TAU ) % TAU / ( TAU / 8 ) ) % 8;
	return QUARTERS[ i ];

}

// when the next front reaches (x, z): the one crossing now (if its edge has not passed) or one of the next slots
export function arrival( x, z, A, within = 12 ) {

	const k = Math.floor( A / FRONT.every );
	for ( let i = k - 1; i <= k + Math.ceil( within / FRONT.every ) + 1; i ++ ) {

		const f = slotFront( i );
		if ( ! f || f.t1 <= A ) continue;
		const [ u, v ] = frame( f, x, z );
		// edge( t ) + wobble - u = 0
		const at = f.t0 + ( u - wobble( f, v ) + FRONT.reach ) / f.speed;
		const passHours = FRONT.width / f.speed;
		if ( at + passHours < A || at < f.t0 || at > f.t1 ) continue;
		const inHours = at - A;
		if ( inHours > within ) continue;
		return { id: f.id, inHours, from: compass( f.angle + Math.PI ), strength: f.strength, passHours, under: inHours <= 0 };

	}

	return null;

}

// "A squall line from the south-west, about 25 minutes out: gusts to 25 knots, then clearing" (speed: island hours per real
// second, to give real minutes; 0 or a stopped clock: island hours)
export function forecastText( x, z, A, { speed = 0.01, within = 10 } = {} ) {

	const a = arrival( x, z, A, within );
	if ( ! a ) return 'No fronts on the glass: fair sailing for now.';
	const kn = Math.round( FRONT.maxGust * a.strength * 1.94 / 5 ) * 5 + 10;
	if ( a.under ) return `The front from the ${ a.from } is over you now: squalls, gusts to ${ kn } knots, clearing behind it.`;
	const when = speed > 1e-6
		? ( () => { const min = a.inHours / speed / 60; return min < 90 ? `about ${ Math.max( 1, Math.round( min / 5 ) * 5 ) } minutes out` : `about ${ Math.round( min / 60 ) } hours out`; } )()
		: `${ a.inHours.toFixed( 1 ) } island hours out`;
	return `A squall line from the ${ a.from }, ${ when }: gusts to ${ kn } knots and rain, then clearing.`;

}

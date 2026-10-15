// The weather schedule: a pure function of the absolute island time (hours), no state, no DOM, no engine.
// Every client that knows the same island time computes the same weather, so the multiplayer server needs
// no weather messages (the shared clock is enough).
//
//   scheduleAt( absHours ) -> { kind, intensity, id, front, start, end }
//     kind       'clear' | 'breezy' | 'overcast' | 'rain' | 'storm' | 'fog'
//     intensity  0.25..1, how strongly the kind is expressed (rain: drizzle .. downpour; storm: .7 .. 1)
//     id         identity of the schedule entry: the weather eases toward a new target when it changes
//     front      true in the rain that builds up before a storm
//     start, end absolute hours the entry lasts (for the forecast)
//   stormWindow( day ) -> { start, end, intensity } | null      hours of that day
//   nextStorm( absHours, within = 12 ) -> absolute start hour of the next storm, or null
//
// Shape of a day: the base weather changes every SLOT_H (4) island hours, from a smooth value noise over the
// slot index (so a clear spell drifts into a breeze, then cloud, then rain, instead of jumping). A foggy
// morning is possible in the 04:00-08:00 slot on calm days. Storms are separate, short windows (2.5 to 4.5 h):
// at most one a day, never on two days running and never on day 0 (storms are bounded by construction to
// 4 x 4.5 h in a week, 10.7%; on average about 3%). A storm is preceded by PRE hours of building rain and
// followed by AFTER hours of clear sky.

export const KINDS = [ 'clear', 'breezy', 'overcast', 'rain', 'storm', 'fog' ];
export const WORLD_SEED = 0x7a1d3c5b;
export const SLOT_H = 4;
export const PRE = 2; // h of building rain before a storm
export const AFTER = 2; // h of clear sky after one
const STORM_P = 0.3; // chance that a day carries a storm window (before the no-two-in-a-row rule)

// base weather by value-noise level w (0..1, mid-heavy): cumulative cut points between the kinds
const CUTS = [ 0.4, 0.58, 0.72 ]; // clear < .40 <= breezy < .58 <= overcast < .72 <= rain

// integer hash -> [0, 1). Deterministic across engines (Math.imul / shifts only)
export function hash( a, b = 0, c = 0, seed = WORLD_SEED ) {

	let h = ( seed ^ Math.imul( a | 0, 0x9e3779b1 ) ) | 0;
	h = Math.imul( h ^ ( h >>> 15 ), 0x85ebca77 );
	h = ( h ^ Math.imul( b | 0, 0xc2b2ae3d ) ) | 0;
	h = Math.imul( h ^ ( h >>> 13 ), 0x27d4eb2f );
	h = ( h ^ Math.imul( c | 0, 0x165667b1 ) ) | 0;
	h = Math.imul( h ^ ( h >>> 16 ), 0x7feb352d );
	h = h ^ ( h >>> 15 );
	return ( h >>> 0 ) / 4294967296;

}

function noise( x, ch ) {

	const i = Math.floor( x ), f = x - i, u = f * f * ( 3 - 2 * f );
	const a = hash( i, ch, 1 ), b = hash( i + 1, ch, 1 );
	return a + ( b - a ) * u;

}

// the slowly varying "weather level" of a base slot
export function level( slot ) {

	return 0.62 * noise( slot / 2.4, 11 ) + 0.38 * noise( slot / 0.9 + 100, 12 );

}

export function stormWindow( day ) {

	if ( ! Number.isFinite( day ) || day <= 0 ) return null; // a quiet first day
	if ( hash( day, 21 ) >= STORM_P || hash( day - 1, 21 ) < STORM_P ) return null;
	const dur = 2.5 + 2 * hash( day, 22 );
	const lo = PRE, hi = 24 - dur - AFTER;
	const start = lo + ( hi - lo ) * hash( day, 23 );
	return { start, end: start + dur, intensity: 0.7 + 0.3 * hash( day, 24 ) };

}

function baseSlot( s ) {

	const w = level( s );
	const intensity = 0.25 + 0.75 * hash( s, 4 );
	const slotOfDay = ( ( s % 6 ) + 6 ) % 6;
	let kind;
	if ( slotOfDay === 1 && w < CUTS[ 1 ] && hash( s, 3 ) < 0.24 ) kind = 'fog';
	else kind = w < CUTS[ 0 ] ? 'clear' : w < CUTS[ 1 ] ? 'breezy' : w < CUTS[ 2 ] ? 'overcast' : 'rain';
	return { kind, intensity, id: 'b' + s, front: false, start: s * SLOT_H, end: ( s + 1 ) * SLOT_H };

}

export function scheduleAt( absHours ) {

	const t = Number.isFinite( absHours ) ? absHours : 0;
	const day = Math.floor( t / 24 ), hour = t - day * 24, base = day * 24;
	const sw = stormWindow( day );
	if ( sw ) {

		if ( hour >= sw.start && hour < sw.end ) return { kind: 'storm', intensity: sw.intensity, id: 's' + day, front: false, start: base + sw.start, end: base + sw.end };
		if ( hour >= sw.start - PRE && hour < sw.start ) return { kind: 'rain', intensity: 0.5, id: 'p' + day, front: true, start: base + sw.start - PRE, end: base + sw.start };
		if ( hour >= sw.end && hour < sw.end + AFTER ) return { kind: 'clear', intensity: 0.9, id: 'a' + day, front: false, start: base + sw.end, end: base + sw.end + AFTER };

	}

	// a fair first morning (day 0 is where a new game starts)
	if ( day === 0 && hour < 14 ) return { kind: hour < 9 ? 'clear' : 'breezy', intensity: 0.6, id: 'f' + ( hour < 9 ? 0 : 1 ), front: false, start: hour < 9 ? 0 : 9, end: hour < 9 ? 9 : 14 };
	return baseSlot( Math.floor( t / SLOT_H ) );

}

// absolute start hour of the next storm after t (within `within` hours), or null
export function nextStorm( absHours, within = 12 ) {

	const t = Number.isFinite( absHours ) ? absHours : 0;
	const day = Math.floor( t / 24 );
	for ( let d = day; d <= day + 1; d ++ ) {

		const sw = stormWindow( d );
		if ( ! sw ) continue;
		const s = d * 24 + sw.start;
		if ( s > t && s - t <= within ) return s;

	}

	return null;

}

// seconds the transition into a new entry takes (2 to 4 minutes), from the entry's id
export function transitionSeconds( id ) {

	let n = 0;
	for ( let i = 0; i < id.length; i ++ ) n = ( Math.imul( n, 31 ) + id.charCodeAt( i ) ) | 0;
	return 120 + 120 * hash( n, 5 );

}

// a deterministic wind direction offset (degrees) per entry
export function dirOffset( id, kind ) {

	let n = 0;
	for ( let i = 0; i < id.length; i ++ ) n = ( Math.imul( n, 31 ) + id.charCodeAt( i ) ) | 0;
	return ( hash( n, 6 ) - 0.5 ) * 70 + ( kind === 'storm' ? 20 : 0 );

}

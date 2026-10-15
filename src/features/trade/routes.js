import { GOODS, GOOD_IDS, PORTS, PORT_IDS, legalAt, seaDistance, dockOf } from './goods.js';
import { PATROLS } from '../naval/Routes.js';
import { WORLD } from '../../world/WorldLayout.js';

// Route maths for the trade window (wave 15B): where to sell what you hold, where to buy what a port wants, and the
// harbourmaster's price board (the five best margins from a port). Pure functions over a Trade (its seen prices,
// its live market and its voyage hours), so the panel and the tests read the same numbers.
//
//   lanesCrossed( a, b ) -> n          pirate patrol lanes (naval/Routes.js PATROLS) within LANE.near of the straight run
//   riskOf( n ) -> 'safe' | 'lane' | 'pirate waters'
//   leg( trade, from, to ) -> { from, to, metres, hours, lanes, risk }
//   bestSale( trade, here, good, { cond, cost } ) -> { port, name, price, value, margin, perCrate, ...leg } | null
//   bestSource( trade, here, good ) -> the cheapest port to bring a good here from (margin against selling it here)
//   board( trade, here, n = 5 ) -> [ { good, name, to, toName, buy, sell, margin, perCrate, room, gain, ...leg } ]
//
// Prices elsewhere are the ones last seen there (trade.seen: rumours, marked, until you have been); the price here is
// live. A unit's margin is what it fetches there, after the spoilage of the voyage, minus what it costs here; per crate
// divides by the crates a unit fills (timber, reeds: two). The board's room / gain walk the units one by one like the
// market does (each one bought lifts the price here, each one sold pushes it down there).

export const LANE = {
	near: 180, // m: a patrol leg this close to the run counts as crossed
	blackwater: 650, // m: running this close to Blackwater counts as one more lane
};

const segDist2 = ( px, pz, ax, az, bx, bz ) => {

	const dx = bx - ax, dz = bz - az, l = dx * dx + dz * dz;
	const t = l > 0 ? Math.max( 0, Math.min( 1, ( ( px - ax ) * dx + ( pz - az ) * dz ) / l ) ) : 0;
	const x = ax + dx * t - px, z = az + dz * t - pz;
	return x * x + z * z;

};

// closest approach of two segments (squared), sampled: good enough at these scales
function segSeg2( a, b, c, d ) {

	let best = Infinity;
	for ( let i = 0; i <= 8; i ++ ) {

		const t = i / 8;
		best = Math.min( best, segDist2( a[ 0 ] + ( b[ 0 ] - a[ 0 ] ) * t, a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * t, c[ 0 ], c[ 1 ], d[ 0 ], d[ 1 ] ) );
		best = Math.min( best, segDist2( c[ 0 ] + ( d[ 0 ] - c[ 0 ] ) * t, c[ 1 ] + ( d[ 1 ] - c[ 1 ] ) * t, a[ 0 ], a[ 1 ], b[ 0 ], b[ 1 ] ) );

	}

	return best;

}

const laneCache = new Map();

export function lanesCrossed( a, b ) {

	if ( a === b ) return 0;
	const key = a < b ? a + '>' + b : b + '>' + a;
	if ( laneCache.has( key ) ) return laneCache.get( key );
	const p = dockOf( a ), q = dockOf( b );
	if ( ! p || ! q ) return 0;
	const A = [ p.x, p.z ], B = [ q.x, q.z ];
	let n = 0;
	for ( const loop of PATROLS || [] ) {

		let hit = false;
		for ( let i = 0; i < loop.length && ! hit; i ++ ) hit = segSeg2( A, B, loop[ i ], loop[ ( i + 1 ) % loop.length ] ) < LANE.near * LANE.near;
		if ( hit ) n ++;

	}

	const bw = WORLD.blackwater && WORLD.blackwater.center;
	if ( bw && segDist2( bw.x, bw.z, A[ 0 ], A[ 1 ], B[ 0 ], B[ 1 ] ) < LANE.blackwater * LANE.blackwater ) n ++;
	laneCache.set( key, n );
	return n;

}

export const riskOf = ( n ) => ( n <= 0 ? 'safe' : n === 1 ? 'lane' : 'pirate waters' );

export function leg( trade, from, to ) {

	const lanes = lanesCrossed( from, to );
	return { from, to, metres: Math.round( seaDistance( from, to ) ), hours: from === to ? 0 : trade.voyageHours( from, to ), lanes, risk: riskOf( lanes ) };

}

const seenAt = ( trade, port, good ) => ( trade.seen[ port ] && trade.seen[ port ][ good ] ) || null;

// where a unit of `good` (held at condition cond, cost = what it cost a unit) fetches the most, counting the voyage's
// spoilage; `here` is priced live. Ports where it is contraband are skipped. null when nowhere buys it.
export function bestSale( trade, here, good, { cond = 1, cost = null } = {} ) {

	const G = GOODS[ good ];
	if ( ! G ) return null;
	const ask = cost != null ? cost : trade.sim.ask( here, good );
	let best = null;
	for ( const p of PORT_IDS ) {

		if ( ! legalAt( p, good ) ) continue;
		const L = leg( trade, here, p );
		const s = p === here ? { sell: trade.sim.bid( here, good ), rumour: false, t: trade.sim.abs } : seenAt( trade, p, good );
		if ( ! s ) continue;
		const value = s.sell * Math.max( 0, Math.min( 1, cond ) ) * Math.exp( - G.perish * L.hours );
		const margin = value - ask;
		// a port a little further is worth it only for a little more: an hour of sailing costs a percent
		const score = margin - value * 0.01 * L.hours - value * 0.02 * L.lanes;
		if ( ! best || score > best.score ) best = { port: p, name: PORTS[ p ].name, price: s.sell, value, margin, perCrate: margin / G.crates, rumour: !! s.rumour, age: trade.sim.abs - s.t, score, here: p === here, ...L };

	}

	return best;

}

// the port to bring a good here from: the best margin of buying it there (last seen) and selling it here (live)
export function bestSource( trade, here, good ) {

	const G = GOODS[ good ];
	if ( ! G || ! legalAt( here, good ) ) return null;
	const bid = trade.sim.bid( here, good );
	let best = null;
	for ( const p of PORT_IDS ) {

		if ( p === here || ! legalAt( p, good ) ) continue;
		const s = seenAt( trade, p, good );
		if ( ! s ) continue;
		const L = leg( trade, p, here );
		const margin = bid * Math.exp( - G.perish * L.hours ) - s.buy;
		if ( ! best || margin > best.margin ) best = { port: p, name: PORTS[ p ].name, price: s.buy, margin, perCrate: margin / G.crates, rumour: !! s.rumour, age: trade.sim.abs - s.t, ...L };

	}

	return best;

}

// units of `good` bought here and sold at `to` that still pay one by one (and the money they make), up to `max`
export function roomFor( trade, here, to, good, max = 60, held = 0 ) {

	const G = GOODS[ good ];
	const s = seenAt( trade, to, good );
	if ( ! G || ! s || ! legalAt( here, good ) || ! legalAt( to, good ) ) return { room: 0, gain: 0 };
	const k = trade.sim.impact( to, good ), arriving = Math.exp( - G.perish * trade.voyageHours( here, to ) );
	let room = 0, gain = 0;
	for ( let j = 0; j < max; j ++ ) {

		const d = s.sell * Math.exp( - k * ( held + j ) ) * arriving - trade.sim.unitAsk( here, good, j );
		if ( d <= 0 ) break;
		room = j + 1;
		gain += d;

	}

	return { room, gain };

}

// the harbourmaster's board: the n best loads to buy here, by margin per crate at their best port
export function board( trade, here, n = 5 ) {

	const out = [];
	if ( ! PORTS[ here ] ) return out;
	for ( const g of GOOD_IDS ) {

		if ( ! legalAt( here, g ) ) continue;
		const b = bestSale( trade, here, g );
		if ( ! b || b.here || b.margin <= 0 ) continue;
		const r = roomFor( trade, here, b.port, g, 40 );
		if ( r.room < 1 ) continue;
		out.push( {
			good: g, name: GOODS[ g ].name, to: b.port, toName: b.name, buy: trade.sim.ask( here, g ), sell: b.price, margin: b.margin, perCrate: b.perCrate,
			room: r.room, gain: r.gain, rumour: b.rumour, age: b.age, from: here, metres: b.metres, hours: b.hours, lanes: b.lanes, risk: b.risk, fine: GOODS[ g ].tags.includes( 'fine' ),
		} );

	}

	out.sort( ( a, b ) => b.perCrate - a.perCrate );
	return out.slice( 0, Math.max( 0, n | 0 ) );

}

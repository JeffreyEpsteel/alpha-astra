import { GOODS, GOOD_IDS, PORTS, PORT_IDS, seaDistance, legalAt, dockOf } from './goods.js';
import { Rng, clamp, num } from './market.js';
import { DAY_SPEED } from '../../game/GameMode.js';

// Rival merchants (docs/UNREAL_PARITY.md E7): a few named traders sail between the markets on their own. In port a
// rival loads the good with the best margin to some other port (buying lifts the price where it loads), sails for
// the voyage's hours, and unloads at the other end (selling pushes the price down there), so the player finds
// routes already worked and prices moved by somebody else; the news says who did it.
//
// World causes (E4): a merchant ship sunk at sea (features 'shipSunk', faction 'merchant') takes the nearest
// rival's cargo down with her: the port it was bound for goes short of that good. A storm ('weatherChanged' to
// 'storm') holds the rivals at sea a few hours. Both are wired by trade/index.js.
//
//   rivals.list                     [ { id, name, ship, crates, speed, phase: 'port' | 'sea' | 'lost', at, to, good, qty, eta, until } ]
//   rivals.advance( hours )         trade.advance does it (skipped while the market follows the universe server)
//   rivals.lose( x, z ) -> rival | null      the nearest rival at sea loses her cargo (a sunk merchant)
//   rivals.delay( hours )           every rival at sea arrives later (a storm)
//
// Wave 15B: the supply is alive. The Tidemark guild's convoy and Captain Hale join the three; a convoy's arrival
// lands a big load (a 'convoy' market event: "A merchant convoy landed cloth at Tidemark"), and a merchant hijacked at
// sea (rivals.lose( x, z, { hijack } ), from boarding's shipPlundered) takes her cargo off the destination's supply
// the same way a sinking does. In a universe the host runs the rivals; snapshot() / adopt() carry where they are to
// the guests (display only: their trades already reach the guests as market cells).
//
// Events: rivalVoyage { id, name, from, to, good, qty } on sailing, rivalArrived { id, name, port, good, qty, convoy },
// rivalLost { id, name, good, qty, to, hijack }.

export const RIVALS = [
	{ id: 'marlow', name: 'Captain Marlow', ship: 'Salt Wren', crates: 16, speed: 6 },
	{ id: 'vos', name: 'Widow Vos', ship: 'Copper Gull', crates: 24, speed: 5 },
	{ id: 'teague', name: 'Old Teague', ship: 'Ninefold', crates: 12, speed: 7.5 },
	{ id: 'guild', name: 'The Tidemark guild', ship: 'convoy', crates: 48, speed: 5, convoy: true, home: 'tidemark' },
	{ id: 'hale', name: 'Captain Hale', ship: 'Morning Ledger', crates: 20, speed: 6.5 },
];

const RIVAL = {
	minWait: 4, maxWait: 12, // hours in port between voyages
	slow: 2.5, // rivals sail this much slower than their speed suggests (tacking, loading)
	minVoyage: 2,
	margin: 0.04, // the least margin per unit (fraction of the price) worth a voyage
	lostFor: 30, // hours before a lost rival is back with a new ship
};

export class Rivals {

	constructor( trade, seed = 11 ) {

		this.trade = trade;
		this.seed = seed;
		this.enabled = true;
		this.reset();

	}

	reset() {

		this.rng = new Rng( this.seed * 7919 + 3 );
		this.list = RIVALS.map( ( r, i ) => ( {
			...r, phase: 'port', at: r.home && PORTS[ r.home ] ? r.home : PORT_IDS[ ( i + 1 ) % PORT_IDS.length ] || 'home', to: null, good: null, qty: 0, eta: 0,
			until: 3 + i * 5, // they start out staggered
			voyages: 0,
		} ) );

	}

	get sim() {

		return this.trade.sim;

	}

	_emit( name, payload ) {

		const f = this.trade.features;
		if ( f && f.emit ) f.emit( name, payload );

	}

	// the best load from `from`: the good, port and units whose last unit still clears RIVAL.margin
	plan( r, from ) {

		const m = this.sim;
		let best = null;
		for ( const to of PORT_IDS ) {

			if ( to === from ) continue;
			for ( const g of GOOD_IDS ) {

				if ( ! legalAt( from, g ) || ! legalAt( to, g ) ) continue;
				const G = GOODS[ g ];
				const maxU = Math.floor( r.crates / G.crates );
				const kTo = m.impact( to, g );
				const decay = Math.exp( - G.perish * this.voyageHours( r, from, to ) );
				let units = 0, gain = 0;
				for ( let j = 0; j < maxU; j ++ ) {

					const sell = m.bid( to, g ) * Math.exp( - kTo * ( j + 0.5 ) ) * decay;
					const buy = m.unitAsk( from, g, j );
					if ( sell - buy < buy * RIVAL.margin ) break;
					units = j + 1;
					gain += sell - buy;

				}

				if ( units > 0 && ( ! best || gain > best.gain ) ) best = { to, good: g, qty: units, gain };

			}

		}

		return best;

	}

	_who( r ) {

		return r.convoy ? `${ r.name }'s convoy` : `${ r.name }'s ${ r.ship }`;

	}

	voyageHours( r, from, to ) {

		return Math.max( RIVAL.minVoyage, seaDistance( from, to ) / r.speed * DAY_SPEED * RIVAL.slow );

	}

	_sail( r ) {

		const p = this.plan( r, r.at );
		const now = this.sim.abs;
		if ( ! p ) {

			r.until = now + RIVAL.minWait + this.rng.next() * RIVAL.maxWait;
			return;

		}

		this.sim.applyBuy( r.at, p.good, p.qty, r.id );
		r.phase = 'sea';
		r.to = p.to;
		r.good = p.good;
		r.qty = p.qty;
		r.from = r.at;
		r.eta = now + this.voyageHours( r, r.at, p.to );
		r.voyages ++;
		this.sim.post( `${ this._who( r ) } loaded ${ p.qty } ${ GOODS[ p.good ].name.toLowerCase() } at ${ PORTS[ r.at ].name }, bound for ${ PORTS[ p.to ].name }.`, 'rival', { good: p.good, port: r.at } );
		this._emit( 'rivalVoyage', { id: r.id, name: r.name, from: r.at, to: p.to, good: p.good, qty: p.qty } );

	}

	_arrive( r ) {

		const now = this.sim.abs;
		if ( PORTS[ r.to ] ) {

			this.sim.applySell( r.to, r.good, r.qty, r.id );
			this.sim.post( `${ this._who( r ) } unloaded ${ r.qty } ${ GOODS[ r.good ].name.toLowerCase() } at ${ PORTS[ r.to ].name }.`, 'rival', { good: r.good, port: r.to } );
			this._emit( 'rivalArrived', { id: r.id, name: r.name, port: r.to, good: r.good, qty: r.qty, convoy: !! r.convoy } );
			// a big load into a thin market is a glut for a while (a convoy's always is news)
			const push = r.qty * this.sim.impact( r.to, r.good );
			if ( r.convoy && push > 0.25 ) this.sim.forceEvent( 'convoy', { good: r.good, ports: [ r.to ], mult: 0.8 } );
			else if ( push > 0.45 ) this.sim.forceEvent( 'rivalGlut', { good: r.good, ports: [ r.to ], rival: r.name, mult: 0.85 } );

		}

		r.at = PORTS[ r.to ] ? r.to : 'home';
		r.phase = 'port';
		r.to = null;
		r.good = null;
		r.qty = 0;
		r.until = now + RIVAL.minWait + this.rng.next() * ( RIVAL.maxWait - RIVAL.minWait );

	}

	advance( hours ) {

		if ( ! this.enabled || ! ( hours > 0 ) ) return;
		const now = this.sim.abs;
		for ( const r of this.list ) {

			if ( r.phase === 'lost' && now >= r.until ) {

				r.phase = 'port';
				r.until = now + 2;
				this.sim.post( `${ r.name } is trading again with a new ship.`, 'rival' );

			} else if ( r.phase === 'sea' && now >= r.eta ) this._arrive( r );
			else if ( r.phase === 'port' && now >= r.until ) this._sail( r );

		}

	}

	// where a rival at sea is, roughly: along the line between the docks by the share of the voyage done
	where( r ) {

		if ( r.phase !== 'sea' ) return null;
		const a = dockOf( r.from || r.at ), b = dockOf( r.to );
		if ( ! a || ! b ) return null;
		const total = this.voyageHours( r, r.from || r.at, r.to );
		const t = clamp( 1 - ( r.eta - this.sim.abs ) / Math.max( 1e-6, total ), 0, 1 );
		return { x: a.x + ( b.x - a.x ) * t, z: a.z + ( b.z - a.z ) * t };

	}

	// hijack: taken at sea (boarding's shipPlundered) rather than sunk; the cargo is off the market all the same
	lose( x, z, { hijack = false } = {} ) {

		let best = null, bd = Infinity;
		for ( const r of this.list ) {

			const w = this.where( r );
			if ( ! w ) continue;
			const d = Number.isFinite( x ) && Number.isFinite( z ) ? Math.hypot( w.x - x, w.z - z ) : 0;
			if ( d < bd ) { bd = d; best = r; }

		}

		if ( ! best ) return null;
		const r = best;
		this._emit( 'rivalLost', { id: r.id, name: r.name, good: r.good, qty: r.qty, to: r.to, hijack } );
		this.sim.post( `${ this._who( r ) } ${ hijack ? 'was taken at sea' : 'went down' } with ${ r.qty } ${ GOODS[ r.good ].name.toLowerCase() } bound for ${ PORTS[ r.to ] ? PORTS[ r.to ].name : r.to }.`, 'rival', { good: r.good, port: r.to } );
		const lost = { ...r };
		r.phase = 'lost';
		r.until = this.sim.abs + RIVAL.lostFor;
		r.at = r.from || r.at;
		r.to = null;
		r.good = null;
		r.qty = 0;
		return lost;

	}

	delay( hours ) {

		for ( const r of this.list ) if ( r.phase === 'sea' ) r.eta += num( hours, 0, 0, 48 );

	}

	// where the rivals are, for the universe's guests (display only)
	snapshot() {

		const r4 = ( v ) => Math.round( v * 1e4 ) / 1e4;
		return this.list.map( ( r ) => [ r.id, r.phase, r.at, r.from || null, r.to, r.good, r.qty, r4( r.eta ), r.voyages ] );

	}

	adopt( list ) {

		if ( ! Array.isArray( list ) ) return false;
		for ( const a of list ) {

			const r = Array.isArray( a ) && this.list.find( ( x ) => x.id === a[ 0 ] );
			if ( ! r ) continue;
			r.phase = [ 'port', 'sea', 'lost' ].includes( a[ 1 ] ) ? a[ 1 ] : 'port';
			r.at = PORTS[ a[ 2 ] ] ? a[ 2 ] : r.at;
			r.from = PORTS[ a[ 3 ] ] ? a[ 3 ] : null;
			r.to = PORTS[ a[ 4 ] ] ? a[ 4 ] : null;
			r.good = GOODS[ a[ 5 ] ] ? a[ 5 ] : null;
			r.qty = num( a[ 6 ], 0, 0, 1000 ) | 0;
			r.eta = num( a[ 7 ], 0 ); // (the voyage count stays local: a guest's rivals sail nowhere)
			if ( r.phase === 'sea' && ( ! r.to || ! r.good ) ) r.phase = 'port';

		}

		return true;

	}

	view() {

		return this.list.map( ( r ) => ( {
			id: r.id, name: r.name, ship: r.ship, convoy: !! r.convoy, phase: r.phase, at: PORTS[ r.at ] ? PORTS[ r.at ].name : r.at, to: r.to && PORTS[ r.to ] ? PORTS[ r.to ].name : null,
			good: r.good ? GOODS[ r.good ].name : null, qty: r.qty, eta: r.phase === 'sea' ? Math.max( 0, r.eta - this.sim.abs ) : 0, voyages: r.voyages,
		} ) );

	}

	toJSON() {

		const r4 = ( v ) => Math.round( v * 1e4 ) / 1e4;
		return { rng: this.rng.s, list: this.list.map( ( r ) => ( { id: r.id, phase: r.phase, at: r.at, from: r.from || null, to: r.to, good: r.good, qty: r.qty, eta: r4( r.eta ), until: r4( r.until ), voyages: r.voyages } ) ) };

	}

	fromJSON( d ) {

		this.reset();
		if ( ! d || typeof d !== 'object' ) return;
		if ( typeof d.rng === 'number' && Number.isFinite( d.rng ) ) this.rng.s = d.rng >>> 0;
		for ( const s of Array.isArray( d.list ) ? d.list : [] ) {

			const r = s && this.list.find( ( x ) => x.id === s.id );
			if ( ! r ) continue;
			r.phase = [ 'port', 'sea', 'lost' ].includes( s.phase ) ? s.phase : 'port';
			r.at = PORTS[ s.at ] ? s.at : r.at;
			r.from = PORTS[ s.from ] ? s.from : null;
			r.to = PORTS[ s.to ] ? s.to : null;
			r.good = GOODS[ s.good ] ? s.good : null;
			r.qty = num( s.qty, 0, 0, 1000 ) | 0;
			r.eta = num( s.eta, 0 );
			r.until = num( s.until, 0 );
			r.voyages = num( s.voyages, 0, 0, 1e9 ) | 0;
			if ( r.phase === 'sea' && ( ! r.to || ! r.good || r.qty < 1 ) ) r.phase = 'port';

		}

	}

}


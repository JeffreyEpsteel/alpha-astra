import { GOODS, GOOD_IDS, PORTS, PORT_IDS, REGION, MARKET, EVENTS, CAUSES, syncPorts, identity } from './goods.js';

// The market model of the two ports: pure logic, no engine, no DOM, deterministic from a seed (the generator's
// state is saved, so a loaded game goes on exactly where it was).
//
// Every (port, good) cell keeps a log price offset on top of its equilibrium:
//   mid = base * REGION[ port ][ good ] * eventFactor * exp( x + w )
//   x   the push of the player's trades: buying adds 1/depth per unit, selling takes it away; it fades by a
//       factor e every GOODS[ good ].recover hours (that is the recovery)
//   w   a slow drift around the equilibrium (an Ornstein-Uhlenbeck walk, about 7%), the market's own mood
// The stall asks mid * (1 + spread) when you buy and bids mid * (1 - spread) when you sell, and every unit of a
// batch moves the price on for the next, so a big load pays more going in and fetches less coming out:
// a route is profitable at first and the margin closes as it is used, then reopens as the markets recover.
// Each unit is priced at the middle of its own push, so buying and selling a lot right back at one stall loses the
// spread whatever the depth (thin islet markets included).
//
//   const m = new Market( { seed, noise, events } );
//   m.advance( hours );                         time passes (drift, recovery, events, sparkline samples)
//   m.quoteBuy( port, good, n ) / m.quoteSell( port, good, n, cond )   { qty, raw, total, avg, units }
//   m.applyBuy( port, good, n ) / m.applySell( ... )                   the trade moves the price
//   m.port( id )                                the PortMarket view of one port
//   m.forceEvent( 'wreck' )                     start an event now (EVENTS or CAUSES); m.on( fn ) hears new events and trades
//   m.mod( port, good ) -> factor               optional price hook (story priceMod); m.spreadMul scales the spread
//   m.snapshot() / m.adopt( snap )              the shared part of the market (cells and events) for the universe server
//   m.trend( port, good ) -> { pct, dir }        the change over the last in-game day ('up' | 'down' | 'flat', 3% band)
//   m.post( text, kind, { good, port } )        a line of news; good / port tie it to a row of the window (why it moved)
//
// Wave 15B: each port's drift is scaled by its identity's swing (Tidemark's prices wander more); the save keeps the
// sparklines as two base-36 characters a point (the log price against the equilibrium), loading the older arrays too.
//
// Ports come from goods.js PORT_IDS, which grows with WORLD.ports: a port that appears later gets its cells on
// the next advance / quote (lazily, with a flat history).

export class Rng {

	constructor( seed = 1 ) {

		this.s = seed >>> 0;

	}

	// mulberry32
	next() {

		this.s = ( this.s + 0x6D2B79F5 ) >>> 0;
		let t = this.s;
		t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
		t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

	}

	normal() {

		const u = Math.max( this.next(), 1e-9 ), v = this.next();
		return Math.sqrt( - 2 * Math.log( u ) ) * Math.cos( 2 * Math.PI * v );

	}

}

export const clamp = ( v, lo, hi ) => ( v < lo ? lo : v > hi ? hi : v );
export const num = ( v, d = 0, lo = - Infinity, hi = Infinity ) => ( typeof v === 'number' && Number.isFinite( v ) ? clamp( v, lo, hi ) : d );
const r2 = ( v ) => Math.round( v * 100 ) / 100;
const r4 = ( v ) => Math.round( v * 10000 ) / 10000;

// the sparkline in a save: two base-36 characters a point, the log price against the equilibrium in steps of 1/400
// (a quarter percent) between -1.6 and +1.6
const HIST_OFF = 1.6, HIST_RES = 400;

export function packHist( hist, eq ) {

	let s = '';
	for ( const p of hist ) {

		const v = clamp( Math.round( ( Math.log( Math.max( 1e-6, p ) / eq ) + HIST_OFF ) * HIST_RES ), 0, 1295 );
		s += v.toString( 36 ).padStart( 2, '0' );

	}

	return s;

}

export function unpackHist( s, eq ) {

	const out = [];
	for ( let i = 0; i + 1 < s.length; i += 2 ) {

		const v = parseInt( s.slice( i, i + 2 ), 36 );
		if ( Number.isFinite( v ) ) out.push( r2( eq * Math.exp( v / HIST_RES - HIST_OFF ) ) );

	}

	return out.slice( - MARKET.histLen );

}

export class Market {

	constructor( { seed = 20261012, noise = 1, events = true, warm = true } = {} ) {

		this.seed = seed;
		this.noise = noise; // 0 = no drift (tests)
		this.useEvents = events;
		this.listeners = new Set();
		this.mod = null; // ( port, good ) -> price factor, or null
		this.spreadMul = 1;
		this.reset( warm );

	}

	reset( warm = true ) {

		this.rng = new Rng( this.seed );
		this.abs = 0; // hours since the start
		this.cells = {};
		this.events = []; // active: { id, tpl, good, ports, mult, start, end, text }
		this.news = []; // newest first: { t, text, kind, id? }
		this._acc = 0;
		this._evId = 1;
		syncPorts();
		for ( const p of PORT_IDS ) {

			this.cells[ p ] = {};
			for ( const g of GOOD_IDS ) this.cells[ p ][ g ] = { x: 0, w: this.noise ? this.noise * MARKET.noiseStd * this.rng.normal() : 0, hist: [] };

		}

		if ( warm ) this._warm();
		this.nextEventAt = 10 + this.rng.next() * 10; // the first event comes within the first game day

	}

	on( fn ) {

		this.listeners.add( fn );
		return () => this.listeners.delete( fn );

	}

	_tell( e ) {

		for ( const fn of [ ...this.listeners ] ) {

			try { fn( e ); } catch ( err ) { /* a listener must not stop the market */ }

		}

	}

	// cells for ports added to WORLD.ports since the market was made (no random draw: the saved walk stays in step)
	_ensure() {

		syncPorts();
		if ( Object.keys( this.cells ).length === PORT_IDS.length ) return;
		for ( const p of PORT_IDS ) {

			if ( this.cells[ p ] ) continue;
			this.cells[ p ] = {};
			for ( const g of GOOD_IDS ) this.cells[ p ][ g ] = { x: 0, w: 0, hist: [] };
			for ( const g of GOOD_IDS ) this.cells[ p ][ g ].hist.push( r2( this.mid( p, g ) ) );

		}

	}

	_cell( port, good ) {

		if ( ! this.cells[ port ] ) this._ensure();
		return this.cells[ port ][ good ];

	}

	spread() {

		return MARKET.spread * this.spreadMul;

	}

	_mod( port, good ) {

		if ( ! this.mod ) return 1;
		let m = 1;
		try { m = this.mod( port, good ); } catch ( e ) { m = 1; }
		return typeof m === 'number' && Number.isFinite( m ) && m > 0 ? clamp( m, 0.2, 5 ) : 1;

	}

	// ---- prices

	eq( port, good ) {

		return GOODS[ good ].base * REGION[ port ][ good ];

	}

	// the events' factor on a price now: each eases in over 3 h and out over the last 6 h
	ev( port, good ) {

		let m = 1;
		for ( const e of this.events ) {

			if ( e.good !== good || ! e.ports.includes( port ) ) continue;
			const rise = Math.min( 1, ( this.abs - e.start ) / 3 ), fall = Math.min( 1, ( e.end - this.abs ) / 6 );
			m *= 1 + ( e.mult - 1 ) * Math.max( 0, Math.min( rise, fall ) );

		}

		return m;

	}

	_priceAt( port, good, dx ) {

		const c = this._cell( port, good );
		const x = clamp( c.x + dx, - MARKET.xMax, MARKET.xMax );
		return Math.max( 0.5, this.eq( port, good ) * this.ev( port, good ) * this._mod( port, good ) * Math.exp( x + c.w ) );

	}

	mid( port, good ) {

		return this._priceAt( port, good, 0 );

	}

	// what the stall asks for a unit / what it pays for one in perfect condition
	ask( port, good ) {

		return this.mid( port, good ) * ( 1 + this.spread() );

	}

	bid( port, good ) {

		return this.mid( port, good ) * ( 1 - this.spread() );

	}

	depth( port, good ) {

		return GOODS[ good ].depth * PORTS[ port ].size;

	}

	// log price a unit moves the market by
	impact( port, good ) {

		return 1 / this.depth( port, good );

	}

	// the price asked for the unit that is i units into a purchase
	unitAsk( port, good, i ) {

		return this._priceAt( port, good, this.impact( port, good ) * ( i + 0.5 ) ) * ( 1 + this.spread() );

	}

	// n units bought one after the other; the money charged is rounded up (a round trip can never gain by rounding)
	quoteBuy( port, good, n ) {

		n = clamp( Math.floor( num( n ) ), 0, 200 );
		const k = this.impact( port, good ), f = 1 + this.spread();
		let raw = 0;
		for ( let i = 0; i < n; i ++ ) raw += this._priceAt( port, good, k * ( i + 0.5 ) ) * f;
		return { qty: n, raw, total: Math.ceil( raw - 1e-9 ), avg: n ? raw / n : 0 };

	}

	// n units sold one after the other; cond = condition 0..1 of every unit, or an array of them; the money is rounded down
	quoteSell( port, good, n, cond = 1 ) {

		n = clamp( Math.floor( num( n ) ), 0, 200 );
		const k = this.impact( port, good ), f = 1 - this.spread();
		let raw = 0;
		const units = [];
		for ( let i = 0; i < n; i ++ ) {

			const c = Array.isArray( cond ) ? num( cond[ i ], 1 ) : num( cond, 1 );
			const u = this._priceAt( port, good, - k * ( i + 0.5 ) ) * f * clamp( c, 0, 1 );
			units.push( u );
			raw += u;

		}

		return { qty: n, raw, total: Math.floor( raw + 1e-9 ), avg: n ? raw / n : 0, units };

	}

	// who: 'player' | a rival's id | 'remote' (a trade relayed from the universe server: not told again)
	applyBuy( port, good, n, who = 'player' ) {

		const c = this._cell( port, good );
		c.x = clamp( c.x + n * this.impact( port, good ), - MARKET.xMax, MARKET.xMax );
		if ( who !== 'remote' ) this._tell( { type: 'trade', side: 'buy', port, good, qty: n, who } );

	}

	applySell( port, good, n, who = 'player' ) {

		const c = this._cell( port, good );
		c.x = clamp( c.x - n * this.impact( port, good ), - MARKET.xMax, MARKET.xMax );
		if ( who !== 'remote' ) this._tell( { type: 'trade', side: 'sell', port, good, qty: n, who } );

	}

	// { mid, buy, sell, eq (with the events), rel (mid against the good's base: < 0.9 cheap, > 1.15 dear), hist }
	quote( port, good ) {

		const mid = this.mid( port, good );
		return {
			mid, buy: mid * ( 1 + this.spread() ), sell: mid * ( 1 - this.spread() ),
			eq: this.eq( port, good ) * this.ev( port, good ) * this._mod( port, good ), rel: mid / GOODS[ good ].base, hist: this._cell( port, good ).hist.slice(),
		};

	}

	port( id ) {

		return new PortMarket( this, id );

	}

	// ---- time

	_tick( dh ) {

		const kw = Math.exp( - dh / MARKET.noiseTau );
		const sw0 = this.noise ? this.noise * MARKET.noiseStd * Math.sqrt( 1 - kw * kw ) : 0;
		for ( const p of PORT_IDS ) {

			const sw = sw0 * this._swing( p );
			for ( const g of GOOD_IDS ) {

				const c = this.cells[ p ][ g ];
				c.x *= Math.exp( - dh / GOODS[ g ].recover );
				c.w = c.w * kw + ( sw ? sw * this.rng.normal() : 0 );

			}

		}

	}

	_swing( port ) {

		const s = identity( port ).swing;
		return typeof s === 'number' && s > 0 ? Math.min( 3, s ) : 1;

	}

	// the change of the middle price over the last in-game day, from the sparkline
	trend( port, good ) {

		const h = this._cell( port, good ).hist;
		const back = Math.round( 24 / MARKET.histStep );
		const then = h.length ? h[ Math.max( 0, h.length - back ) ] : 0;
		const now = this.mid( port, good );
		const pct = then > 0 ? ( now / then - 1 ) * 100 : 0;
		return { pct: Math.round( pct ), dir: pct > 3 ? 'up' : pct < - 3 ? 'down' : 'flat' };

	}

	_sample() {

		for ( const p of PORT_IDS ) {

			for ( const g of GOOD_IDS ) {

				const h = this.cells[ p ][ g ].hist;
				h.push( r2( this.mid( p, g ) ) );
				while ( h.length > MARKET.histLen ) h.shift();

			}

		}

	}

	_warm() {

		const steps = Math.round( MARKET.warmHours / MARKET.histStep );
		for ( let i = 0; i < steps; i ++ ) {

			this._tick( MARKET.histStep );
			this._sample();

		}

	}

	advance( hours ) {

		this._ensure();
		let left = num( hours );
		while ( left > 1e-9 ) {

			const s = Math.min( left, 1 );
			this._tick( s );
			this.abs += s;
			left -= s;
			this._acc += s;
			if ( this._acc >= MARKET.histStep - 1e-9 ) {

				this._acc -= MARKET.histStep;
				this._sample();

			}

			this._events();

		}

	}

	// ---- events

	_events() {

		if ( this.events.some( ( e ) => e.end <= this.abs ) ) this.events = this.events.filter( ( e ) => e.end > this.abs );
		if ( ! this.useEvents ) return;
		let guard = 0;
		while ( this.abs >= this.nextEventAt && guard ++ < 8 ) {

			this._spawn( this.nextEventAt );
			this.nextEventAt += 20 + this.rng.next() * 44; // 20..64 h apart: about four a week

		}

		if ( guard > 0 ) this.events = this.events.filter( ( e ) => e.end > this.abs );

	}

	_spawn( start ) {

		const busy = new Set();
		for ( const e of this.events ) for ( const p of e.ports ) busy.add( p + ':' + e.good );
		const pool = EVENTS.filter( ( t ) => t.ports.every( ( p ) => ! busy.has( p + ':' + t.good ) ) );
		if ( ! pool.length ) return null;
		let total = 0;
		for ( const t of pool ) total += t.weight;
		let r = this.rng.next() * total;
		let tpl = pool[ pool.length - 1 ];
		for ( const t of pool ) {

			r -= t.weight;
			if ( r <= 0 ) {

				tpl = t;
				break;

			}

		}

		return this.addEvent( tpl, start );

	}

	addEvent( tpl, start = this.abs, over = {} ) {

		const dur = tpl.dur[ 0 ] + this.rng.next() * ( tpl.dur[ 1 ] - tpl.dur[ 0 ] );
		const mult = over.mult ?? tpl.mult;
		const pct = Math.round( ( mult - 1 ) * 100 );
		const good = GOODS[ over.good ] ? over.good : tpl.good;
		const ports = ( over.ports || tpl.ports ).filter( ( p ) => PORTS[ p ] );
		if ( ! ports.length ) return null;
		const portName = ports.length === 1 ? PORTS[ ports[ 0 ] ].name : 'the islands';
		const text = tpl.text.split( '{pct}' ).join( ( pct >= 0 ? '+' : '' ) + pct + '%' ).split( '{good}' ).join( GOODS[ good ].name.toLowerCase() )
			.split( '{port}' ).join( portName ).split( '{rival}' ).join( over.rival || 'A rival trader' );
		const e = {
			id: this._evId ++, tpl: tpl.id, good, ports, mult,
			start, end: start + ( over.dur ?? dur ), text: text.charAt( 0 ).toUpperCase() + text.slice( 1 ),
		};
		this.events.push( e );
		const item = { t: start, text: e.text, kind: 'event', id: e.id, good, port: ports.length === 1 ? ports[ 0 ] : null };
		this.news.unshift( item );
		if ( this.news.length > MARKET.newsKeep ) this.news.length = MARKET.newsKeep;
		this._tell( { type: 'event', event: e, news: item } );
		return e;

	}

	// start an event of the named template now (tests, or another feature: a pirate raid can call it with its own text)
	forceEvent( id, over = {} ) {

		const tpl = EVENTS.find( ( t ) => t.id === id ) || CAUSES.find( ( t ) => t.id === id );
		return tpl ? this.addEvent( tpl, this.abs, over ) : null;

	}

	// a line of news that is not an event (a rival's voyage, a seizure)
	post( text, kind = 'news', meta = null ) {

		const item = { t: this.abs, text: String( text ).slice( 0, 160 ), kind };
		if ( meta && GOODS[ meta.good ] ) item.good = meta.good;
		if ( meta && PORTS[ meta.port ] ) item.port = meta.port;
		this.news.unshift( item );
		if ( this.news.length > MARKET.newsKeep ) this.news.length = MARKET.newsKeep;
		return item;

	}

	// ---- the universe server: the shared part of the market (no news, no sparklines, no generator state)

	snapshot() {

		this._ensure();
		const cells = {};
		for ( const p of PORT_IDS ) {

			cells[ p ] = {};
			for ( const g of GOOD_IDS ) {

				const c = this.cells[ p ][ g ];
				cells[ p ][ g ] = [ r4( c.x ), r4( c.w ) ];

			}

		}

		return { v: 1, abs: r4( this.abs ), cells, events: this.events.map( ( e ) => ( { ...e, ports: e.ports.slice() } ) ) };

	}

	// take another market's state (the server's): cells for known ports and goods, the events if given, its clock
	adopt( snap ) {

		if ( ! snap || typeof snap !== 'object' || ! snap.cells || typeof snap.cells !== 'object' ) return false;
		this._ensure();
		for ( const p of PORT_IDS ) {

			const src = snap.cells[ p ];
			if ( ! src || typeof src !== 'object' ) continue;
			for ( const g of GOOD_IDS ) {

				const a = src[ g ];
				if ( ! Array.isArray( a ) ) continue;
				const c = this.cells[ p ][ g ];
				c.x = num( a[ 0 ], c.x, - MARKET.xMax, MARKET.xMax );
				c.w = num( a[ 1 ], c.w, - 1, 1 );

			}

		}

		if ( typeof snap.abs === 'number' && Number.isFinite( snap.abs ) && snap.abs >= 0 ) this.abs = snap.abs;
		if ( Array.isArray( snap.events ) ) {

			const known = new Set( this.events.map( ( e ) => e.id + ':' + e.text ) );
			this.events = [];
			for ( const e of snap.events ) {

				if ( ! e || ! GOODS[ e.good ] || ! Array.isArray( e.ports ) ) continue;
				const ports = e.ports.filter( ( p ) => PORTS[ p ] );
				if ( ! ports.length ) continue;
				const ev = { id: num( e.id, this._evId ++, 1, 1e9 ), tpl: String( e.tpl || '' ), good: e.good, ports, mult: num( e.mult, 1, 0.2, 5 ), start: num( e.start, this.abs ), end: num( e.end, this.abs + 12 ), text: String( e.text || '' ).slice( 0, 160 ) };
				this.events.push( ev );
				this._evId = Math.max( this._evId, ev.id + 1 );
				if ( ! known.has( ev.id + ':' + ev.text ) ) this.news.unshift( { t: ev.start, text: ev.text, kind: 'event', id: ev.id } );

			}

			if ( this.news.length > MARKET.newsKeep ) this.news.length = MARKET.newsKeep;

		}

		return true;

	}

	// ---- save

	toJSON() {

		this._ensure();
		const cells = {};
		for ( const p of PORT_IDS ) {

			cells[ p ] = {};
			for ( const g of GOOD_IDS ) {

				const c = this.cells[ p ][ g ];
				cells[ p ][ g ] = [ r4( c.x ), r4( c.w ), packHist( c.hist, this.eq( p, g ) ) ];

			}

		}

		return {
			h: 2, abs: r4( this.abs ), next: r4( this.nextEventAt ), rng: this.rng.s, evId: this._evId, acc: r4( this._acc ), cells,
			events: this.events.map( ( e ) => ( { ...e, ports: e.ports.slice() } ) ),
			news: this.news.slice( 0, MARKET.newsKeep ).map( ( n ) => ( { ...n } ) ),
		};

	}

	fromJSON( d ) {

		if ( ! d || typeof d !== 'object' ) return false;
		this.reset( false );
		this.abs = num( d.abs, 0, 0, 1e7 );
		this.nextEventAt = num( d.next, this.abs + 12, 0, 1e7 );
		if ( typeof d.rng === 'number' && Number.isFinite( d.rng ) ) this.rng.s = d.rng >>> 0;
		this._evId = Math.max( 1, num( d.evId, 1, 1, 1e9 ) | 0 );
		this._acc = num( d.acc, 0, 0, MARKET.histStep );
		const src = d.cells && typeof d.cells === 'object' ? d.cells : {};
		for ( const p of PORT_IDS ) {

			for ( const g of GOOD_IDS ) {

				const a = src[ p ] && Array.isArray( src[ p ][ g ] ) ? src[ p ][ g ] : [];
				const c = this.cells[ p ][ g ];
				c.x = num( a[ 0 ], 0, - MARKET.xMax, MARKET.xMax );
				c.w = num( a[ 1 ], 0, - 1, 1 );
				// a wave-14 save keeps the prices themselves, a newer one the packed string
				c.hist = typeof a[ 2 ] === 'string' ? unpackHist( a[ 2 ], this.eq( p, g ) ) : Array.isArray( a[ 2 ] ) ? a[ 2 ].filter( ( v ) => typeof v === 'number' && Number.isFinite( v ) && v > 0 ).slice( - MARKET.histLen ) : [];
				if ( ! c.hist.length ) c.hist.push( r2( this.mid( p, g ) ) );

			}

		}

		this.events = [];
		for ( const e of Array.isArray( d.events ) ? d.events : [] ) {

			if ( ! e || ! GOODS[ e.good ] || ! Array.isArray( e.ports ) ) continue;
			const ports = e.ports.filter( ( p ) => PORTS[ p ] );
			if ( ! ports.length ) continue;
			this.events.push( {
				id: Number.isFinite( e.id ) && e.id >= 1 ? e.id : this._evId ++, tpl: String( e.tpl || '' ), good: e.good, ports, mult: num( e.mult, 1, 0.2, 5 ),
				start: num( e.start, this.abs ), end: num( e.end, this.abs + 12 ), text: String( e.text || '' ).slice( 0, 160 ),
			} );

		}

		this.news = [];
		for ( const n of Array.isArray( d.news ) ? d.news : [] ) {

			if ( ! n || typeof n.text !== 'string' ) continue;
			const item = { t: num( n.t, 0 ), text: n.text.slice( 0, 160 ), kind: String( n.kind || 'news' ), id: n.id };
			if ( GOODS[ n.good ] ) item.good = n.good;
			if ( PORTS[ n.port ] ) item.port = n.port;
			this.news.push( item );

		}

		this.news.length = Math.min( this.news.length, MARKET.newsKeep );
		return true;

	}

}

// One port's side of the market: the object `trade.market( 'home' )` returns.
//   price( good ) mid price; buy( good ) what the stall asks; sell( good ) what it pays; eq( good ) equilibrium
//   quoteBuy( good, n ) / quoteSell( good, n, cond ); history( good ) the sparkline prices, live one last
//   events( good? ) the active events that touch this port; goods the quote of every good
export class PortMarket {

	constructor( sim, id ) {

		this.sim = sim;
		this.id = id;
		this.info = PORTS[ id ];

	}

	get name() {

		return this.info.name;

	}

	get goods() {

		const out = {};
		for ( const g of GOOD_IDS ) out[ g ] = this.sim.quote( this.id, g );
		return out;

	}

	price( good ) {

		return this.sim.mid( this.id, good );

	}

	buy( good ) {

		return this.sim.ask( this.id, good );

	}

	sell( good ) {

		return this.sim.bid( this.id, good );

	}

	eq( good ) {

		return this.sim.eq( this.id, good ) * this.sim.ev( this.id, good );

	}

	quoteBuy( good, n ) {

		return this.sim.quoteBuy( this.id, good, n );

	}

	quoteSell( good, n, cond = 1 ) {

		return this.sim.quoteSell( this.id, good, n, cond );

	}

	history( good ) {

		const h = this.sim._cell( this.id, good ).hist.slice();
		h.push( r2( this.sim.mid( this.id, good ) ) );
		return h;

	}

	events( good = null ) {

		return this.sim.events.filter( ( e ) => e.ports.includes( this.id ) && ( ! good || e.good === good ) );

	}

}

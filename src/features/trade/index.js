import { GOODS, GOOD_IDS, PORTS, PORT_IDS, MARKET, HOLD_CRATES, BOAT_SPEED, SEA_DISTANCE, CAUSES, PORT_IDENTITY, legalAt, contrabandAt, seaDistance, syncPorts, worldPort, dockOf, identity, isFine } from './goods.js';
import { Market, clamp, num } from './market.js';
import { Ledger } from './ledger.js';
import { TradeStall, STALL_SITES, stallFront } from './stall.js';
import { TradePanel } from './panel.js';
import { HaulContracts, LICENCES, LICENCE_LOTS } from './HaulContracts.js';
import { Dues, DUES } from './Dues.js';
import { Warehouse } from './Warehouse.js';
import { FishHall } from './FishHall.js';
import { board, bestSale, bestSource, leg } from './routes.js';
import { Credit } from './Credit.js';
import { Rivals } from './Rivals.js';
import { Smuggler } from './Smuggler.js';
import { Operating, BAIT, BAIT_TUB } from './Operating.js';
import { BOATS } from '../../game/Boats.js';
import { DAY_SPEED } from '../../game/GameMode.js';

// Merchant trade between every port of the archipelago (WORLD.ports, read dynamically): Home, Pons Cove, Gull Rock,
// Saltmarsh Key and whatever islands land later. Goods are bought low at one port, carried in the boat's hold
// (crates, apart from the fish cooler), and sold high at another; every trade moves the price, prices drift back
// over in-game hours, market events shake them (some caused by the world: storms, sunk merchants, rival cargoes),
// perishable cargo loses value in the hold, and some goods are contraband at some ports (the smuggler's trade;
// src/features/customs inspects arrivals). Around it: hauling contracts and licences (HaulContracts.js), merchant
// credit and standing (Credit.js), rival merchants (Rivals.js), the smuggler contact (Smuggler.js) and operating
// costs: bait, wages, upkeep (Operating.js).
//
// Wave 15B, a better economy: every port has an identity (goods.js PORT_IDENTITY: what it makes cheap and wants
// dear); the window reads per good the best place to sell what you hold and the best place to bring it from (margin
// per crate, distance, hours at your boat's speed, pirate lanes crossed: routes.js), a trend arrow over the last day
// and the news behind a swing; the harbourmaster's board lists the five best margins from here. Rival merchants and
// the Tidemark guild's convoy move goods and prices; a bulk sale floods a market for a day. Money sinks: harbour
// dues per docking and cargo insurance (Dues.js), the Tidemark warehouse (Warehouse.js), wages and upkeep
// (Operating.js), licences that open the luxuries and bulk lots (HaulContracts.js LICENCES). The fish halls pay by
// freshness, port taste and a daily wanted species (FishHall.js; prices in game/FishStand.js FISH_HALL).
//
//   features.add( 'trade', tradeModule );        // import * as tradeModule from './features/trade/index.js'
//   const trade = features.get( 'trade' );
//   trade.update( dt )                           per frame (Features.update does it); reads app.settings.timeOfDay
//   trade.market( 'home' )                       PortMarket: price( g ) buy( g ) sell( g ) quoteBuy quoteSell history events goods
//   trade.cargo                                  { good: { qty, cond, paid, crates, kg } } what the hold carries (not consignments)
//   trade.capacity() / crates() / free()         hold size by boat x naval holdBonus, used (cargo + consignments), spare
//   trade.buy( port, good, n | 'max' ) / trade.sell( port, good, n | 'all' )     -> { ok, qty, total, avg, profit?, reason? }
//   trade.addCargo( good, qty, opts ) / trade.takeCargo( good, qty )               loot, theft, quest deliveries
//   trade.contraband( port ) -> [ { good, qty, crates, value } ]                  what customs would seize there
//   trade.open( port, kind? ) / close() / toggle( port ) / isOpen                  the window ('market' or 'smuggler')
//   trade.view( port, other? )                   plain data behind the window (rows, hold, projected profit, news, ledger)
//   trade.haul / credit / rivals / smuggler / operating     the sub-systems (see their files)
//   trade.marketSnapshot() / adoptMarketSnapshot( snap ) / onMarketChange( cb ) -> unsubscribe   the universe server
//   trade.applyRemoteTrade( { port, good, qty, side } )      a trade made by another player, relayed
//   trade.board( port, n = 5 )                   the harbourmaster's price board: the n best margins from a port
//   trade.route( from, to ) / bestSale( port, good ) / bestSource( port, good )    route maths (routes.js)
//   trade.arrive( port )                         the boat docked (harbour dues); update() does it near a dock
//   trade.dues / warehouse / fishHall            harbour dues and insurance, the Tidemark warehouse, the fish halls
//   trade.fishSale( soldFish, port ) -> $        settle a fish sale by freshness and taste (Game.sellAll / sell call it)
//   trade.fishQuote( fish, port ) -> { price, factor, fresh, eats, wanted, age }
//   trade.ledger, trade.day, trade.hour, trade.news, trade.events, trade.lights, trade.sites
//   trade.toJSON() / fromJSON( d ) / reset() / dispose()
//
// Hooks into other features (optional chaining, defaults when they are missing): hold crates x
// features.get( 'naval' ).holdBonus() (1), prices x features.get( 'story' ).priceMod( portId ) (1), market bans from
// features.get( 'customs' ).banned( port ), notoriety (customs reads it from pirates).
//
// Events emitted on `features`: cargoBought { good, qty, price (average per unit), port, total },
// cargoSold { good, qty, price, port, profit, total } (the vocabulary of Features.js), marketEvent { id, text, good,
// ports, mult } when a market event starts, and the sub-systems' own (listed in their files). Listens to shipSunk and
// weatherChanged (world-caused market events).
//
// Money goes through features.state.spend( n ) / earn( n ) (GameState). In the sandbox spend() takes nothing:
// the stalls still charge their list prices in the ledger, so the profit shown stays honest; no operating costs,
// no loans needed, licences free.

export { GOODS, GOOD_IDS, PORTS, PORT_IDS, HOLD_CRATES, STALL_SITES, PORT_IDENTITY, LICENCES };

const r2 = ( v ) => Math.round( v * 100 ) / 100;
const WHY = {
	capacity: 'Your hold is full.', money: 'Not enough money.', empty: 'You carry none of that.', qty: 'Choose a quantity.', unknown: 'Unknown goods.',
	contraband: 'Contraband here: no stall may deal in it. Find the smuggler after dark.', banned: 'The harbourmaster has banned you from trading here for now.',
	blocked: 'You defaulted on a loan here: the stall will not sell to you until you pay it.',
	licence: 'The Tidemark guild sells its luxuries to licensed merchants only: buy a coastal hauling licence (Contracts).',
};

// a sale that pushes a market this far down (log price) floods it: a 'flood' event holds the price down for a day
export const FLOOD = { push: 0.6, mult: 0.85, hours: 24 };
const ABOARD = new Set( [ 'boat', 'deck', 'seat' ] );

export function hold( boatId ) {

	if ( ! boatId ) return HOLD_CRATES.foot;
	if ( HOLD_CRATES[ boatId ] != null ) return HOLD_CRATES[ boatId ];
	const b = BOATS[ boatId ];
	return b ? Math.max( HOLD_CRATES.foot, Math.round( 8 * ( b.holdMul || 1 ) ) ) : HOLD_CRATES.foot;

}

// where a port's market is met when it has no stall prop: by the landward end of its jetty
export function factorSite( port ) {

	if ( STALL_SITES[ port ] ) return stallFront( STALL_SITES[ port ] );
	const wp = worldPort( port );
	if ( wp && wp.market ) return { x: wp.market.x, z: wp.market.z }; // a town's market square (Tidemark)
	const d = wp && wp.dock;
	if ( d && d.start && d.end ) {

		const ux = d.start.x - d.end.x, uz = d.start.z - d.end.z, l = Math.hypot( ux, uz ) || 1;
		return { x: d.start.x + ux / l * 4, z: d.start.z + uz / l * 4 };

	}

	if ( wp && wp.stand ) return { x: wp.stand.x, z: wp.stand.z };
	return dockOf( port );

}

export class Trade {

	constructor( app, features, opts = {} ) {

		this.app = app;
		this.features = features;
		this.opts = { toasts: true, ...opts };
		syncPorts();
		this.boats = BOATS;
		const quiet = opts.events === false;
		this.sim = new Market( { seed: opts.seed, noise: opts.noise, events: ! quiet } );
		this.sim.mod = ( port ) => this._priceMod( port );
		this.ledger = new Ledger();
		this.lots = []; // { good, port (bought at), qty, cond, paid } in the order they came aboard
		this.seen = {}; // port -> good -> { buy, sell, mid, t, rumour }: the last prices the player saw there
		this.compare = {}; // port -> the other port the window compares with
		this.day = 1;
		this.lastHour = null;
		this.lastPort = null; // the market opened last (a change is a crossing)
		this.openPort = null;
		this.openKind = 'market';
		this.following = false; // true while the market follows the universe server's snapshots
		this.sites = STALL_SITES;
		this.stalls = {};
		this.lights = [];
		this._removers = [];
		this._sited = new Set(); // ports with interactables
		this._since = 0;
		this._cool = {}; // world-cause cooldowns: key -> sim hour it may fire again
		const seed = Number.isFinite( opts.seed ) ? opts.seed : 20261012;
		this.credit = new Credit( this );
		this.haul = new HaulContracts( this, seed % 9973 + 1 );
		this.rivals = new Rivals( this, seed % 7919 + 1 );
		this.rivals.enabled = opts.rivals ?? ! quiet; // a quiet market (tests) has no rivals either
		this.smuggler = new Smuggler( this );
		this.operating = new Operating( this );
		this.dues = new Dues( this );
		this.warehouse = new Warehouse( this );
		this.fishHall = new FishHall( this );
		this._dockT = 0;
		this._seedRumours();
		this._offMarket = this.sim.on( ( e ) => this._onMarket( e ) );
		this.panel = new TradePanel( this );
		this._build();
		this._listen();

	}

	get state() {

		return this.features ? this.features.state : null;

	}

	get isOpen() {

		return this.openPort !== null;

	}

	_feature( name ) {

		try { return this.features && this.features.get ? this.features.get( name ) : null; } catch ( e ) { return null; }

	}

	_priceMod( port ) {

		const st = this._feature( 'story' );
		const m = st && st.priceMod ? st.priceMod( port ) : 1;
		return typeof m === 'number' && Number.isFinite( m ) && m > 0 ? m : 1;

	}

	// the stalls (a mesh each at Home and Pons), the E interactables of every port's market, the smuggler's spots
	// and Ethena's bait tub; the interactables work without a scene (tests)
	_build() {

		const app = this.app;
		if ( app && app.scene && app.terrainData && this.opts.stalls !== false ) {

			for ( const id of Object.keys( STALL_SITES ) ) {

				try {

					const stall = new TradeStall( { scene: app.scene, terrain: app.terrainData, colliders: app.colliders || null, site: STALL_SITES[ id ], variant: id } );
					this.stalls[ id ] = stall;
					this.lights.push( ...stall.lights );

				} catch ( e ) {

					console.warn( `trade: the ${ id } stall failed to build`, e );

				}

			}

		}

		if ( ! this.features || ! this.features.interactable ) return;
		this._removers.push( this.features.interactable( {
			id: 'trade:bait',
			position: { x: BAIT_TUB.x, z: BAIT_TUB.z },
			radius: 1.6,
			prompt: () => ( this.operating.free ? 'Take bait (sandbox: free)' : `Buy a tin of bait ($${ BAIT.tinPrice }) · ${ this.operating.bait } left` ),
			onInteract: () => {

				const r = this.operating.buyBait();
				this._toast( r.ok ? `Bought ${ r.qty } bait. ${ this.operating.bait } in the box.` : r.message );

			},
			when: () => this._canTrade(),
		} ) );
		this._sitePorts();

	}

	_sitePorts() {

		if ( ! this.features || ! this.features.interactable ) return;
		for ( const id of PORT_IDS ) {

			if ( this._sited.has( id ) ) continue;
			const site = factorSite( id );
			if ( ! site ) continue;
			this._sited.add( id );
			this._removers.push( this.features.interactable( {
				id: 'trade:' + id,
				position: site,
				radius: 2.8,
				prompt: () => ( this.openPort === id ? 'Leave the market stall' : `Trade at the ${ PORTS[ id ].name } market` ),
				onInteract: () => this.toggle( id ),
				when: () => this._canTrade(),
			} ) );
			const spot = this.smuggler.spot( id );
			if ( spot ) {

				this._removers.push( this.features.interactable( {
					id: 'smuggler:' + id,
					position: spot,
					radius: 2.6,
					prompt: () => ( this.openPort === id && this.openKind === 'smuggler' ? 'Leave the smuggler' : 'Deal with the smuggler' ),
					onInteract: () => ( this.openPort === id && this.openKind === 'smuggler' ? this.close() : this.open( id, 'smuggler' ) ),
					when: () => this._canTrade() && this.smuggler.here( id ),
				} ) );

			}

		}

	}

	_canTrade() {

		const m = this.app && this.app.player && this.app.player.mode;
		return ! m || m === 'walk' || m === 'deck';

	}

	// world causes of market events (E4): storms and sunk ships
	_listen() {

		const f = this.features;
		if ( ! f || ! f.on ) return;
		this._removers.push( f.on( 'shipSunk', ( e ) => this._onSunk( e || {} ) ) );
		this._removers.push( f.on( 'weatherChanged', ( e ) => this._onWeather( e || {} ) ) );
		// wave 15B: insurance claims, hijacked merchants, raids, the fish halls' clock, dockings
		this._removers.push( f.on( 'boardersWon', ( e ) => this.dues.claim( 'piracy', e && e.goods ) ) );
		this._removers.push( f.on( 'playerBoatSunk', () => this.dues.claim( 'sunk' ) ) );
		this._removers.push( f.on( 'shipPlundered', ( e ) => this._onPlundered( e || {} ) ) );
		this._removers.push( f.on( 'retaliationRaid', ( e ) => this._onRaid( e || {} ) ) );
		this._removers.push( f.on( 'fishCaught', () => this.fishHall.track() ) );
		this._removers.push( f.on( 'portVisited', ( e ) => { if ( e && PORTS[ e.port ] ) this.arrive( e.port ); } ) );

	}

	_ready( key, hours ) {

		const now = this.sim.abs;
		if ( this._cool[ key ] != null && now < this._cool[ key ] ) return false;
		this._cool[ key ] = now + hours;
		return true;

	}

	_onSunk( e ) {

		if ( this.following ) return;
		if ( e.faction === 'merchant' ) {

			const lost = this.rivals.lose( e.x, e.z );
			if ( lost && lost.good && PORTS[ lost.to ] ) {

				this.sim.forceEvent( 'merchantLost', { good: lost.good, ports: [ lost.to ] } );
				return;

			}

			// nobody we know: the nearest port goes short of something it wanted
			if ( ! this._ready( 'merchantLost', 12 ) ) return;
			const port = this.nearestPort( e.x, e.z ) || 'home';
			const wanted = GOOD_IDS.filter( ( g ) => GOODS[ g ].demand.includes( port ) && legalAt( port, g ) );
			const good = wanted.length ? wanted[ Math.floor( this.sim.rng.next() * wanted.length ) ] : 'spices';
			this.sim.forceEvent( 'merchantLost', { good, ports: [ port ] } );

		} else if ( e.faction === 'pirate' && e.byPlayer && this._ready( 'piratesSunk', 48 ) ) {

			this.sim.forceEvent( 'piratesSunk' );

		}

	}

	_onWeather( e ) {

		if ( e.kind !== 'storm' ) return;
		this.rivals.delay( 3 );
		if ( this.following || ! this._ready( 'storm', 24 ) ) return;
		this.sim.forceEvent( 'stormShoal' );
		this.sim.forceEvent( 'stormIce' );
		// and one port is closed: what it wants goes dear there
		const ports = PORT_IDS.filter( ( p ) => p !== 'home' );
		const port = ports.length ? ports[ Math.floor( this.sim.rng.next() * ports.length ) ] : null;
		const wants = port ? identity( port ).wants.filter( ( g ) => GOODS[ g ] && legalAt( port, g ) ) : [];
		if ( wants.length ) this.sim.forceEvent( 'stormPort', { good: wants[ Math.floor( this.sim.rng.next() * wants.length ) ], ports: [ port ] } );

	}

	// a merchant taken by boarders (boarding's shipPlundered): her cargo never reaches the port she was bound for
	_onPlundered( e ) {

		if ( this.following ) return;
		const nv = this._feature( 'naval' );
		const ship = nv && Array.isArray( nv.ships ) ? nv.ships.find( ( s ) => s && s.id === e.id ) : null;
		if ( ! ship || ship.faction !== 'merchant' ) return;
		const p = this.app && this.app.player && this.app.player.position;
		const lost = this.rivals.lose( p ? p.x : ship.x, p ? p.z : ship.z, { hijack: true } );
		if ( lost && lost.good && PORTS[ lost.to ] ) this.sim.forceEvent( 'hijack', { good: lost.good, ports: [ lost.to ], rival: lost.name } );

	}

	// a pirate raid burns a port's stores: what it makes goes dear there for a day or so
	_onRaid( e ) {

		if ( this.following || ! this._ready( 'raid', 24 ) ) return;
		const port = e.at === 'harbour' ? 'home' : this.nearestPort( e.x, e.z ) || 'home';
		const made = identity( port ).produces.filter( ( g ) => GOODS[ g ] && legalAt( port, g ) );
		if ( made.length ) this.sim.forceEvent( 'raid', { good: made[ Math.floor( this.sim.rng.next() * made.length ) ], ports: [ port ] } );

	}

	nearestPort( x, z ) {

		let best = null, bd = Infinity;
		for ( const id of PORT_IDS ) {

			const d = dockOf( id );
			if ( ! d || ! Number.isFinite( x ) || ! Number.isFinite( z ) ) continue;
			const k = Math.hypot( d.x - x, d.z - z );
			if ( k < bd ) { bd = k; best = id; }

		}

		return best;

	}

	// ---- time

	// hours of island time since the last call (0 when the clock is paused, rewound or jumped: a loaded save or a
	// sandbox slider must not count as hours of spoilage and recovery); the day counter turns at midnight
	_clock() {

		const s = this.app && this.app.settings;
		if ( ! s || typeof s.timeOfDay !== 'number' || ! Number.isFinite( s.timeOfDay ) ) return 0;
		const h = ( ( s.timeOfDay % 24 ) + 24 ) % 24;
		const last = this.lastHour;
		this.lastHour = h;
		if ( last === null ) return 0;
		let dh = h - last;
		if ( dh < - 12 ) dh += 24;
		if ( dh <= 0 || dh > 1.5 ) return 0;
		if ( h < last ) this.day ++;
		return dh;

	}

	get hour() {

		if ( this.lastHour !== null ) return this.lastHour;
		const s = this.app && this.app.settings;
		return s && Number.isFinite( s.timeOfDay ) ? ( ( s.timeOfDay % 24 ) + 24 ) % 24 : 12;

	}

	get time() {

		return this.sim.abs;

	}

	update( dt ) {

		if ( syncPorts() ) {

			this._seedRumours( true );
			this._sitePorts();

		}

		this.sim.spreadMul = this.credit.spreadMul();
		// follow the server only as a universe guest: the host (or a player who went offline) runs the market itself
		if ( this.following ) {

			const ns = this.app && this.app.netsync;
			if ( ! ns || ! ns.online || ns.isHost ) this.leaveMarketServer();

		}

		const dh = this._clock();
		if ( dh > 0 ) this.advance( dh );
		this._dockT += num( dt );
		if ( this._dockT > 0.5 ) {

			this._dockT = 0;
			this._docking();

		}

		if ( this.openPort ) {

			// walking away from the stall (or the smuggler leaving at dawn) closes the window
			const p = this.app && this.app.player && this.app.player.position;
			const f = this.openKind === 'smuggler' ? this.smuggler.spot( this.openPort ) : factorSite( this.openPort );
			if ( p && f && Math.hypot( p.x - f.x, p.z - f.z ) > 2.8 + 2.5 ) this.close();
			else if ( this.openKind === 'smuggler' && ! this.smuggler.here( this.openPort ) ) {

				this._toast( 'The smuggler has slipped away before dawn.' );
				this.close();

			}

			this._since += dt;
			if ( this._since > 0.5 && this.openPort ) {

				this._since = 0;
				this.panel.refresh();

			}

		}

	}

	// aboard and within DUES.arrive m of a port's dock: docked there (dues once per arrival)
	_docking() {

		const pl = this.app && this.app.player;
		const p = pl && pl.position;
		if ( ! p || ! ABOARD.has( pl.mode ) ) return;
		const bc = this.app.boatCtl;
		if ( bc && Number.isFinite( bc.speed ) && bc.speed > 3 ) return; // sailing past is not docking
		for ( const id of PORT_IDS ) {

			const d = dockOf( id );
			if ( d && Math.hypot( d.x - p.x, d.z - p.z ) < DUES.arrive ) {

				this.arrive( id );
				return;

			}

		}

	}

	arrive( port ) {

		return this.dues.arrive( port );

	}

	// let `hours` of island time pass (update() does it from the clock; tests and other features may too)
	advance( hours ) {

		hours = num( hours, 0, 0, 1e5 );
		if ( hours <= 0 ) return;
		// the sub-systems step with the market so a long jump still fires due dates in order
		let left = hours;
		while ( left > 1e-9 ) {

			const s = Math.min( left, 1 );
			this.sim.advance( s );
			this._spoil( s );
			this.rivals.advance( s );
			this.haul.advance( s );
			this.credit.advance( s );
			this.smuggler.advance( s );
			this.operating.advance( s );
			this.dues.advance( s );
			this.warehouse.advance( s );
			this.fishHall.advance( s );
			left -= s;

		}

	}

	_spoil( hours ) {

		let lost = false;
		for ( const l of this.lots ) {

			const rate = GOODS[ l.good ].perish;
			if ( rate > 0 ) l.cond *= Math.exp( - rate * hours );
			if ( l.cond < 0.03 ) {

				lost = true;
				l.qty = 0;
				this._note( `Your ${ GOODS[ l.good ].name.toLowerCase() } spoiled in the hold.`, 'cargo' );

			}

		}

		if ( lost ) this.lots = this.lots.filter( ( l ) => l.qty > 0 );

	}

	_note( text, kind = 'news' ) {

		this.sim.news.unshift( { t: this.sim.abs, text, kind } );
		if ( this.sim.news.length > MARKET.newsKeep ) this.sim.news.length = MARKET.newsKeep;
		if ( kind === 'cargo' ) this._toast( text );

	}

	_onMarket( e ) {

		if ( e.type !== 'event' ) return;
		this._toast( e.event.text );
		if ( this.features && this.features.emit ) this.features.emit( 'marketEvent', { id: e.event.id, text: e.event.text, good: e.event.good, ports: e.event.ports.slice(), mult: e.event.mult } );

	}

	_toast( text ) {

		if ( ! this.opts.toasts ) return;
		try {

			const ui = this.app && this.app.ui && this.app.ui.ui;
			if ( ui && ui.toast ) ui.toast( text, 4800 );

		} catch ( e ) { /* the window is optional */ }

	}

	// ---- hold

	holdBonus() {

		const nv = this._feature( 'naval' );
		let b = 1;
		try { b = nv && nv.holdBonus ? nv.holdBonus() : 1; } catch ( e ) { b = 1; }
		return typeof b === 'number' && Number.isFinite( b ) && b > 0 ? clamp( b, 0.25, 4 ) : 1;

	}

	capacity() {

		const s = this.state;
		return Math.floor( hold( s ? s.boat : null ) * this.holdBonus() );

	}

	crates() {

		let n = this.haul.crates();
		for ( const l of this.lots ) n += l.qty * GOODS[ l.good ].crates;
		return n;

	}

	free() {

		return this.capacity() - this.crates();

	}

	kg() {

		let k = 0;
		for ( const l of this.lots ) k += l.qty * GOODS[ l.good ].kg;
		for ( const c of this.haul.active ) k += c.qty * GOODS[ c.good ].kg;
		return k;

	}

	get cargo() {

		const out = {};
		for ( const l of this.lots ) {

			const o = out[ l.good ] || ( out[ l.good ] = { qty: 0, cond: 0, paid: 0, crates: 0, kg: 0 } );
			o.cond += l.cond * l.qty;
			o.qty += l.qty;
			o.paid += l.paid;

		}

		for ( const g in out ) {

			const o = out[ g ];
			o.cond = o.cond / o.qty;
			o.crates = o.qty * GOODS[ g ].crates;
			o.kg = o.qty * GOODS[ g ].kg;
			o.paid = r2( o.paid );

		}

		return out;

	}

	_addLot( good, port, qty, cond, paid ) {

		const l = this.lots.find( ( x ) => x.good === good && x.port === port );
		if ( l ) {

			l.cond = ( l.cond * l.qty + cond * qty ) / ( l.qty + qty );
			l.qty += qty;
			l.paid += paid;

		} else this.lots.push( { good, port, qty, cond, paid } );

	}

	// take n units of a good out of the lots, oldest first: [ { port, m, cost, cond } ] (the caller books the money)
	_removeLots( good, n ) {

		const take = [];
		let left = n;
		for ( const l of this.lots ) {

			if ( l.good !== good || left <= 0 ) continue;
			const m = Math.min( l.qty, left );
			const cost = l.paid * m / l.qty;
			take.push( { port: l.port, m, cost, cond: l.cond } );
			l.paid -= cost;
			l.qty -= m;
			left -= m;

		}

		this.lots = this.lots.filter( ( l ) => l.qty > 0 );
		return take;

	}

	// cargo that did not come from a stall: loot from a sunk ship, a reward. cond 0..1, paid = what it counts as costing.
	// Limited by the free crates unless force. Returns the units that came aboard.
	addCargo( good, qty, { cond = 1, paid = 0, port = null, force = false } = {} ) {

		const G = GOODS[ good ];
		if ( ! G ) return 0;
		let n = Math.max( 0, Math.floor( num( qty ) ) );
		if ( ! force ) n = Math.min( n, Math.floor( Math.max( 0, this.free() ) / G.crates ) );
		if ( n < 1 ) return 0;
		this._addLot( good, PORTS[ port ] ? port : this.lastPort || 'home', n, clamp( num( cond, 1 ), 0, 1 ), Math.max( 0, num( paid ) ) );
		this.panel.refresh();
		return n;

	}

	// remove cargo without selling it (a pirate takes it, a quest hands it over, customs seize it). Returns { qty, paid }.
	takeCargo( good, qty ) {

		const take = this._removeLots( good, Math.max( 0, Math.floor( num( qty ) ) ) );
		let got = 0, paid = 0;
		for ( const t of take ) {

			got += t.m;
			paid += t.cost;

		}

		this.dues.noteTaken( good, got, paid ); // a piracy claim pays on what this cost

		this.panel.refresh();
		return { qty: got, paid: r2( paid ) };

	}

	// what is contraband at a port in the hold: [ { good, qty, crates, value } ] (value at the good's base price)
	contraband( port ) {

		const out = [];
		const cargo = this.cargo;
		for ( const g of contrabandAt( port ) ) {

			const c = cargo[ g ];
			if ( c && c.qty > 0 ) out.push( { good: g, qty: c.qty, crates: c.crates, value: Math.round( c.qty * GOODS[ g ].base * c.cond ) } );

		}

		return out;

	}

	// ---- markets

	market( portId ) {

		return PORTS[ portId ] ? this.sim.port( portId ) : null;

	}

	get news() {

		return this.sim.news.map( ( n ) => ( { ...n, age: this.sim.abs - n.t } ) );

	}

	// active events with the hours left
	get events() {

		return this.sim.events.map( ( e ) => ( { ...e, left: Math.max( 0, e.end - this.sim.abs ) } ) );

	}

	forceEvent( id, over ) {

		return this.sim.forceEvent( id, over );

	}

	_seedRumours( keep = false ) {

		// before the player has seen a port they only know its usual prices (a day old)
		for ( const p of PORT_IDS ) {

			if ( keep && this.seen[ p ] ) continue;
			this.seen[ p ] = {};
			for ( const g of GOOD_IDS ) {

				const mid = this.sim.eq( p, g );
				this.seen[ p ][ g ] = { buy: r2( mid * ( 1 + MARKET.spread ) ), sell: r2( mid * ( 1 - MARKET.spread ) ), mid: r2( mid ), t: this.sim.abs - 24, rumour: true };

			}

		}

	}

	// remember the prices as seen at this port now
	_see( port ) {

		if ( ! this.seen[ port ] ) this._seedRumours( true );
		for ( const g of GOOD_IDS ) {

			const q = this.sim.quote( port, g );
			this.seen[ port ][ g ] = { buy: r2( q.buy ), sell: r2( q.sell ), mid: r2( q.mid ), t: this.sim.abs, rumour: false };

		}

	}

	// the player is at this port's stall: books a crossing from the last one, takes in the prices, hands over the
	// consignments due here, and the harbourmaster collects a defaulted debt
	visit( port ) {

		if ( ! PORTS[ port ] ) return false;
		this.ledger.arrive( this.lastPort, port, this.crates() > 0 );
		this.arrive( port ); // the harbour dues, when the docking was not seen
		this.lastPort = port;
		this._see( port );
		const got = this.haul.deliver( port );
		for ( const d of got ) this._toast( `Delivered ${ d.qty } ${ GOODS[ d.good ].name.toLowerCase() }: +$${ d.reward } and your deposit back.` );
		this.credit.visit( port );
		return true;

	}

	// hours a voyage takes the boat the player has (between two ports; Home to Pons when not given)
	voyageHours( from = null, to = null ) {

		const s = this.state;
		const id = s && s.boat ? s.boat : 'foot';
		const v = BOAT_SPEED[ id ] || 4;
		const d = from && to && from !== to ? seaDistance( from, to ) : SEA_DISTANCE;
		return d / v * DAY_SPEED;

	}

	// why the stall at a port refuses a trade right now (null: it does not)
	_refuse( port, good, side ) {

		if ( ! legalAt( port, good ) ) return 'contraband';
		const cu = this._feature( 'customs' );
		let ban = 0;
		try { ban = cu && cu.banned ? cu.banned( port ) : 0; } catch ( e ) { ban = 0; }
		if ( ban ) return 'banned';
		if ( side === 'buy' && this.credit.blocked( port ) ) return 'blocked';
		if ( side === 'buy' && this._locked( good ) ) return 'licence';
		return null;

	}

	// a luxury the guild will not sell without a licence (the campaign only)
	_locked( good ) {

		const s = this.state;
		return isFine( good ) && ! ( s && s.free ) && this.haul.licence < 1;

	}

	// the most units one purchase may take: the master licence lifts the bulk limit
	lotLimit() {

		const s = this.state;
		if ( s && s.free ) return MARKET.maxLot;
		return Math.min( MARKET.maxLot, LICENCE_LOTS[ this.haul.licence ] || MARKET.maxLot );

	}

	// ---- trading

	_fail( reason ) {

		return { ok: false, reason, message: WHY[ reason ] || reason, qty: 0, total: 0 };

	}

	buy( port, good, qty = 1 ) {

		const G = GOODS[ good ];
		if ( ! G || ! PORTS[ port ] ) return this._fail( 'unknown' );
		let want = qty === 'max' ? MARKET.maxLot : Math.floor( num( Number( qty ) ) );
		if ( want < 1 ) return this._fail( 'qty' );
		const no = this._refuse( port, good, 'buy' );
		if ( no ) return this._fail( no );
		want = Math.min( want, MARKET.maxLot );
		const fit = Math.floor( Math.max( 0, this.free() ) / G.crates );
		let n = Math.min( want, fit );
		let limited = n < want ? 'capacity' : null;
		if ( n > this.lotLimit() ) {

			n = this.lotLimit();
			limited = 'licence';

		}

		if ( n < 1 ) return this._fail( 'capacity' );
		const s = this.state;
		const purse = ! s || s.free ? Infinity : num( s.money );
		let q = this.sim.quoteBuy( port, good, n );
		while ( n > 0 && q.total > purse ) {

			n --;
			q = this.sim.quoteBuy( port, good, n );
			limited = 'money';

		}

		if ( n < 1 ) return this._fail( 'money' );
		if ( s && s.spend && ! s.spend( q.total ) ) return this._fail( 'money' );
		this.sim.applyBuy( port, good, n );
		this._addLot( good, port, n, 1, q.total );
		this.ledger.buy( n, q.total );
		this._see( port );
		const avg = r2( q.total / n );
		if ( this.features && this.features.emit ) this.features.emit( 'cargoBought', { good, qty: n, price: avg, port, total: q.total } );
		return { ok: true, good, port, qty: n, total: q.total, avg, limited };

	}

	sell( port, good, qty = 'all' ) {

		const G = GOODS[ good ];
		if ( ! G || ! PORTS[ port ] ) return this._fail( 'unknown' );
		let have = 0;
		for ( const l of this.lots ) if ( l.good === good ) have += l.qty;
		if ( have < 1 ) return this._fail( 'empty' );
		let n = qty === 'all' ? have : Math.min( have, Math.floor( num( Number( qty ) ) ) );
		if ( n < 1 ) return this._fail( 'qty' );
		const no = this._refuse( port, good, 'sell' );
		if ( no ) return this._fail( no );
		n = Math.min( n, 200 );
		// oldest cargo first
		const take = this._removeLots( good, n );
		const conds = [];
		for ( const t of take ) for ( let i = 0; i < t.m; i ++ ) conds.push( t.cond );
		const q = this.sim.quoteSell( port, good, n, conds );
		const scale = q.raw > 0 ? q.total / q.raw : 0;
		const parts = [];
		let idx = 0;
		for ( const t of take ) {

			let rev = 0;
			for ( let i = 0; i < t.m; i ++ ) rev += q.units[ idx ++ ];
			parts.push( { from: t.port, qty: t.m, revenue: rev * scale, cost: t.cost } );

		}

		const s = this.state;
		if ( q.total > 0 && s && s.earn ) s.earn( q.total );
		this.sim.applySell( port, good, n );
		this._flood( port, good, n );
		const profit = this.ledger.sale( { good, to: port, day: this.day, parts } );
		// a good trade is noticed: merchant standing (a little, never for flips at one stall)
		if ( profit > 0 && parts.some( ( p ) => p.from !== port ) ) this.credit.adjust( Math.min( 2, profit / 300 ), 'profitable sale' );
		this._see( port );
		const avg = r2( q.total / n );
		if ( this.features && this.features.emit ) this.features.emit( 'cargoSold', { good, qty: n, price: avg, port, profit: Math.round( profit ), total: q.total } );
		return { ok: true, good, port, qty: n, total: q.total, avg, profit: Math.round( profit ) };

	}

	// a bulk sale floods the market for a day (the local market only: in a universe the host floods its own on the
	// relayed trade); returns the event or null
	_flood( port, good, n ) {

		if ( this.following ) return null;
		const push = n * this.sim.impact( port, good );
		if ( push < FLOOD.push ) return null;
		if ( this.sim.events.some( ( e ) => e.good === good && e.ports.includes( port ) && e.mult < 1 ) ) return null;
		const tpl = CAUSES.find( ( t ) => t.id === 'flood' );
		// fully in at once (no three-hour ease): the stall pays less from the next sale on
		return tpl ? this.sim.addEvent( tpl, this.sim.abs - 3, { good, ports: [ port ], mult: FLOOD.mult, dur: FLOOD.hours + 3 } ) : null;

	}

	// what `n` units of a good in condition `cond` would fetch at a port at the prices last seen there (the batch
	// pushes the price down as it sells, like the real thing), after `hours` more in the hold; 0 where it is contraband
	estimate( port, good, n, cond = 1, hours = 0 ) {

		const seen = this.seen[ port ] && this.seen[ port ][ good ];
		if ( ! seen || n < 1 || ! legalAt( port, good ) ) return 0;
		const k = this.sim.impact( port, good );
		const decay = Math.exp( - GOODS[ good ].perish * hours );
		let t = 0;
		for ( let i = 0; i < n; i ++ ) t += seen.sell * Math.exp( - k * i ) * clamp( cond * decay, 0, 1 );
		return t;

	}

	// ---- the universe server

	// the shared market as plain JSON (cells, events, the market clock)
	marketSnapshot() {

		return { ...this.sim.snapshot(), rivals: this.rivals.snapshot() };

	}

	// follow the server's market: its cells and events replace ours (ports either side may be missing: ours keep
	// their state, theirs are ignored). While following, no random or world-caused events and no rival voyages start
	// here (the server runs those). opts.follow = false takes the prices once without following.
	adoptMarketSnapshot( snap, { follow = true } = {} ) {

		let ok = false;
		try { ok = this.sim.adopt( snap ); } catch ( e ) { console.warn( 'trade: bad market snapshot', e ); ok = false; }
		if ( ok && follow && snap.rivals ) this.rivals.adopt( snap.rivals ); // where the host's rivals are (display only)
		if ( ok && follow && ! this.following ) {

			this.following = true;
			this.sim.useEvents = false;
			this.rivals.enabled = false;

		}

		if ( ok ) this.panel.refresh();
		return ok;

	}

	// stop following (back to a local market)
	leaveMarketServer() {

		this.following = false;
		this.sim.useEvents = this.opts.events !== false;
		this.rivals.enabled = this.opts.rivals ?? this.opts.events !== false;

	}

	// cb( { type: 'trade', side, port, good, qty, who } | { type: 'event', event } ) for every change made here
	// (relayed trades are not told again); returns the unsubscribe function
	onMarketChange( cb ) {

		if ( typeof cb !== 'function' ) return () => {};
		return this.sim.on( ( e ) => {

			if ( e.type === 'trade' ) cb( { type: 'trade', side: e.side, port: e.port, good: e.good, qty: e.qty, who: e.who } );
			else if ( e.type === 'event' ) cb( { type: 'event', event: { ...e.event, ports: e.event.ports.slice() } } );

		} );

	}

	// another player's trade, relayed: moves the price here without telling the server again
	applyRemoteTrade( t ) {

		if ( ! t || ! PORTS[ t.port ] || ! GOODS[ t.good ] ) return false;
		const n = Math.floor( num( t.qty, 0, 0, 500 ) );
		if ( n < 1 ) return false;
		if ( t.side === 'sell' ) {

			this.sim.applySell( t.port, t.good, n, 'remote' );
			this._flood( t.port, t.good, n ); // the host floods for a guest's bulk sale too (guests follow it)

		} else this.sim.applyBuy( t.port, t.good, n, 'remote' );
		return true;

	}

	// ---- the window

	open( port, kind = 'market' ) {

		if ( ! PORTS[ port ] ) return false;
		if ( kind === 'smuggler' && ! this.smuggler.here( port ) ) return false;
		if ( kind !== 'smuggler' ) this.visit( port );
		this.openPort = port;
		this.openKind = kind === 'smuggler' ? 'smuggler' : 'market';
		// with a DOM but no HUD to put the window in, there is nothing to show: stay closed
		if ( ! this.panel.open( port, this.openKind ) && typeof document !== 'undefined' ) {

			this.openPort = null;
			return false;

		}

		return true;

	}

	close() {

		if ( this.openPort === null ) return;
		if ( this.openKind === 'market' ) this._see( this.openPort );
		this.openPort = null;
		this.openKind = 'market';
		this.panel.close();

	}

	toggle( port ) {

		if ( this.openPort === port && this.openKind === 'market' ) {

			this.close();
			return false;

		}

		return this.open( port );

	}

	// the port a market's window compares with: the player's choice, else Home <-> Pons, islets with Home
	otherFor( port ) {

		const c = this.compare[ port ];
		if ( c && c !== port && PORTS[ c ] ) return c;
		if ( port === 'home' ) return 'pons';
		return port === 'pons' || PORTS.home ? 'home' : PORT_IDS.find( ( p ) => p !== port ) || port;

	}

	setCompare( port, other ) {

		if ( PORTS[ port ] && PORTS[ other ] && other !== port ) this.compare[ port ] = other;
		this.panel.refresh();

	}

	// everything the window shows, as plain data
	// ---- route maths and the harbourmaster's board (routes.js)

	board( port, n = 5 ) {

		if ( ! this.seen[ port ] ) this._seedRumours( true );
		return board( this, port, n );

	}

	route( from, to ) {

		return PORTS[ from ] && PORTS[ to ] ? leg( this, from, to ) : null;

	}

	bestSale( port, good, opts ) {

		return PORTS[ port ] && GOODS[ good ] ? bestSale( this, port, good, opts ) : null;

	}

	bestSource( port, good ) {

		return PORTS[ port ] && GOODS[ good ] ? bestSource( this, port, good ) : null;

	}

	// ---- the fish halls

	fishQuote( fish, port = null ) {

		return this.fishHall.quote( fish, PORTS[ port ] ? port : 'home' );

	}

	// Game sold these fish at their catch value: settle freshness, taste and the wanted bonus; returns the difference
	fishSale( sold, port = null ) {

		return this.fishHall.settle( sold, PORTS[ port ] ? port : 'home' );

	}

	// the latest news that explains a swing of this good at this port (the last day)
	_why( port, good ) {

		const ev = this.sim.events.find( ( e ) => e.good === good && e.ports.includes( port ) );
		if ( ev ) return ev.text;
		const n = this.sim.news.find( ( x ) => x.good === good && ( x.port === port || x.port == null ) && this.sim.abs - x.t < 24 );
		return n ? n.text : null;

	}

	view( port, otherPort = null ) {

		const other = otherPort && PORTS[ otherPort ] && otherPort !== port ? otherPort : this.otherFor( port );
		if ( ! this.seen[ other ] || ! this.seen[ port ] ) this._seedRumours( true );
		const s = this.state;
		const cargo = this.cargo;
		const hours = this.voyageHours( port, other );
		const free = this.free();
		const money = s ? num( s.money ) : 0;
		const sandbox = !! ( s && s.free );
		const banned = this._refuse( port, 'salt', 'sell' ) === 'banned';
		const blocked = this.credit.blocked( port );
		const I = identity( port );
		const rows = [];
		let tip = null;
		for ( const g of GOOD_IDS ) {

			const G = GOODS[ g ];
			const q = this.sim.quote( port, g );
			const held = cargo[ g ] || null;
			const seen = this.seen[ other ][ g ];
			const legalHere = legalAt( port, g ), legalThere = legalAt( other, g );
			const arriving = Math.exp( - G.perish * hours );
			const margin = seen.sell * arriving - q.buy;
			const ev = this.sim.events.find( ( e ) => e.good === g && e.ports.includes( port ) );
			const fits = Math.floor( Math.max( 0, free ) / G.crates );
			const affordable = sandbox || this.sim.quoteBuy( port, g, 1 ).total <= money;
			// how many more units still pay: each unit bought lifts the price here and each one sold there pushes it down
			let room = 0, gain = 0;
			const ko = this.sim.impact( other, g ), heldUnits = held ? held.qty : 0;
			if ( legalHere && legalThere ) {

				for ( let j = 0; j < Math.min( fits, MARKET.maxLot ); j ++ ) {

					const d = seen.sell * Math.exp( - ko * ( heldUnits + j ) ) * arriving - this.sim.unitAsk( port, g, j );
					if ( d <= 0 ) break;
					room = j + 1;
					gain += d;

				}

			}

			const row = {
				id: g, name: G.name, unit: G.unit, crates: G.crates, kg: G.kg, color: G.color, perish: G.perish, cat: G.cat,
				mid: q.mid, buy: q.buy, sell: q.sell, eq: q.eq, rel: q.rel, tag: ! legalHere ? 'contraband' : q.rel < 0.88 ? 'cheap' : q.rel > 1.15 ? 'dear' : '',
				hist: this.sim.port( port ).history( g ),
				held: held ? held.qty : 0, cond: held ? held.cond : 1, paid: held ? held.paid : 0,
				legal: legalHere, legalThere,
				other: { port: other, name: PORTS[ other ].name, buy: seen.buy, sell: seen.sell, age: this.sim.abs - seen.t, rumour: seen.rumour, stale: this.sim.abs - seen.t > MARKET.staleHours, contraband: ! legalThere },
				margin, room, gain, event: ev ? { pct: Math.round( ( ev.mult - 1 ) * 100 ), text: ev.text, left: Math.max( 0, ev.end - this.sim.abs ) } : null,
				can: { buy: legalHere && ! banned && ! blocked && fits >= 1 && affordable && ! this._locked( g ), sell: !! held && legalHere && ! banned },
				// wave 15B: the port's identity, the day's trend and why, where to sell it / where to bring it from
				made: I.produces.includes( g ), wanted: I.wants.includes( g ), fine: isFine( g ), locked: this._locked( g ),
				trend: this.sim.trend( port, g ), why: this._why( port, g ),
				best: bestSale( this, port, g, held ? { cond: held.cond, cost: held.paid / Math.max( 1, held.qty ) } : {} ),
				source: legalHere ? bestSource( this, port, g ) : null,
			};
			rows.push( row );
			if ( row.can.buy && room > 0 && ( ! tip || gain / ( room * G.crates ) > tip.gain / ( tip.room * GOODS[ tip.good ].crates ) ) ) tip = { good: g, name: G.name, margin, room, gain };

		}

		// the hold sold at the other port at the last prices seen there, after the voyage
		let value = 0, cost = 0;
		for ( const g in cargo ) {

			const c = cargo[ g ];
			value += this.estimate( other, g, c.qty, c.cond, hours );
			cost += c.paid;

		}

		const warnings = [];
		for ( const g in cargo ) {

			const G = GOODS[ g ];
			if ( G.perish >= 0.01 ) warnings.push( `${ G.name } at ${ Math.round( cargo[ g ].cond * 100 ) }%, losing ${ ( G.perish * 100 ).toFixed( 1 ) }% of its value an hour` );

		}

		const hot = this.contraband( port );
		if ( hot.length ) warnings.push( `Contraband here: ${ hot.map( ( h ) => `${ h.qty } ${ GOODS[ h.good ].name.toLowerCase() }` ).join( ', ' ) }` );
		if ( banned ) warnings.push( 'Banned from trading here for now' );
		if ( blocked ) warnings.push( 'You defaulted on a loan here: the stall will not sell to you' );
		if ( free < 0 ) warnings.push( `Over capacity by ${ - free } crate${ free === -1 ? '' : 's' }: sell some before buying` );
		const rumour = this.smuggler.rumour();
		return {
			port, name: PORTS[ port ].name, title: PORTS[ port ].title, other, otherName: PORTS[ other ].name,
			ports: PORT_IDS.filter( ( p ) => p !== port ).map( ( p ) => ( { id: p, name: PORTS[ p ].name, seen: ! ( this.seen[ p ] && this.seen[ p ].salt && this.seen[ p ].salt.rumour ) } ) ),
			day: this.day, hour: this.hour, money, sandbox, banned, blocked,
			capacity: this.capacity(), used: this.crates(), consigned: this.haul.crates(), free, kg: this.kg(), boat: s && s.boat ? s.boat : null,
			voyage: hours, rows, tip,
			projected: { port: other, name: PORTS[ other ].name, value: Math.round( value ), cost: Math.round( cost ), profit: Math.round( value - cost ), has: this.lots.length > 0 },
			warnings,
			news: this.news.slice( 0, 12 ).map( ( n ) => ( { text: n.text, kind: n.kind, age: n.age, active: n.id != null && this.sim.events.some( ( e ) => e.id === n.id ) } ) ),
			events: this.events,
			rumour: rumour && PORTS[ rumour ] ? `Word on the quay: ${ this.smuggler.isNight() ? 'tonight' : 'after dark' } the smuggler meets buyers at ${ PORTS[ rumour ].name }.` : '',
			standing: this.credit.standing,
			ledger: { ...this.ledger.toJSON(), routeList: this.ledger.routeList(), net: this.ledger.net() },
			// wave 15B
			identity: { note: I.note || '', signature: ( I.signature || [] ).filter( ( g ) => GOODS[ g ] ).map( ( g ) => GOODS[ g ].name ), produces: I.produces.slice(), wants: I.wants.slice() },
			board: this.board( port, 5 ), fish: this.fishHall.board( port ), dues: this.dues.fee( port ), insurance: this.dues.quote(),
			warehouse: this.warehouse.here( port ) ? this.warehouse.view() : null, licence: this.haul.licence, lotLimit: this.lotLimit(),
			rivals: this.rivals.view(),
		};

	}

	// ---- save

	// v 2 (wave 15B): the prices seen are kept only where they are not rumours, as [ buy, sell, t ] (the middle is between
	// them); the market packs its sparklines; dues, warehouse and the fish halls are new parts. A v 1 save loads.
	toJSON() {

		const seen = {};
		for ( const p of PORT_IDS ) {

			if ( ! this.seen[ p ] ) continue;
			const row = {};
			let any = false;
			for ( const g of GOOD_IDS ) {

				const x = this.seen[ p ][ g ];
				if ( ! x || x.rumour ) continue;
				row[ g ] = [ x.buy, x.sell, r2( x.t ) ];
				any = true;

			}

			if ( any ) seen[ p ] = row;

		}

		return {
			v: 2, day: this.day, lastPort: this.lastPort, sim: this.sim.toJSON(), ledger: this.ledger.toJSON(), seen,
			lots: this.lots.map( ( l ) => ( { good: l.good, port: l.port, qty: l.qty, cond: Math.round( l.cond * 10000 ) / 10000, paid: r2( l.paid ) } ) ),
			compare: { ...this.compare }, cool: { ...this._cool },
			haul: this.haul.toJSON(), credit: this.credit.toJSON(), rivals: this.rivals.toJSON(), smuggler: this.smuggler.toJSON(), operating: this.operating.toJSON(),
			dues: this.dues.toJSON(), warehouse: this.warehouse.toJSON(), fish: this.fishHall.toJSON(),
		};

	}

	fromJSON( d ) {

		if ( ! d || typeof d !== 'object' ) return;
		this.close();
		this.sim.fromJSON( d.sim );
		this.ledger.fromJSON( d.ledger );
		this.day = Math.max( 1, num( d.day, 1, 1, 1e6 ) | 0 );
		this.lastPort = PORTS[ d.lastPort ] ? d.lastPort : null;
		this.lastHour = null; // the clock is read again: the time of a loaded world is not elapsed time
		this._seedRumours();
		const src = d.seen && typeof d.seen === 'object' ? d.seen : {};
		for ( const p of PORT_IDS ) {

			for ( const g of GOOD_IDS ) {

				const a = src[ p ] && src[ p ][ g ];
				if ( ! Array.isArray( a ) || a.length < 3 ) continue;
				// v 1: [ buy, sell, mid, t, rumour ]; v 2: [ buy, sell, t ] (seen, never a rumour)
				const old = a.length >= 4;
				const buy = num( a[ 0 ], NaN, 0, 1e6 ), sell = num( a[ 1 ], NaN, 0, 1e6 ), mid = old ? num( a[ 2 ], NaN, 0, 1e6 ) : r2( ( buy + sell ) / 2 );
				if ( ! ( buy > 0 && sell > 0 && mid > 0 ) ) continue;
				this.seen[ p ][ g ] = { buy, sell, mid, t: num( a[ old ? 3 : 2 ], this.sim.abs - 24, - 1e7, this.sim.abs ), rumour: old ? a[ 4 ] === 1 : false };

			}

		}

		this.lots = [];
		for ( const l of Array.isArray( d.lots ) ? d.lots : [] ) {

			if ( ! l || ! GOODS[ l.good ] ) continue;
			const qty = Math.floor( num( l.qty, 0, 0, 1e4 ) );
			if ( qty < 1 ) continue;
			this._addLot( l.good, PORTS[ l.port ] ? l.port : 'home', qty, clamp( num( l.cond, 1 ), 0, 1 ), Math.max( 0, num( l.paid ) ) );

		}

		this.compare = {};
		if ( d.compare && typeof d.compare === 'object' ) for ( const p in d.compare ) if ( PORTS[ p ] && PORTS[ d.compare[ p ] ] ) this.compare[ p ] = d.compare[ p ];
		this._cool = {};
		if ( d.cool && typeof d.cool === 'object' ) for ( const k in d.cool ) if ( Number.isFinite( d.cool[ k ] ) ) this._cool[ k ] = d.cool[ k ];
		// the sub-systems: a missing part (an older save) starts fresh
		this.haul.fromJSON( d.haul );
		this.credit.fromJSON( d.credit );
		this.rivals.fromJSON( d.rivals );
		this.smuggler.fromJSON( d.smuggler );
		this.operating.fromJSON( d.operating );
		this.dues.fromJSON( d.dues );
		this.warehouse.fromJSON( d.warehouse );
		this.fishHall.fromJSON( d.fish );

	}

	reset() {

		this.close();
		this.sim.reset();
		this.ledger.reset();
		this.lots = [];
		this.day = 1;
		this.lastHour = null;
		this.lastPort = null;
		this.compare = {};
		this._cool = {};
		this._seedRumours();
		this.haul.reset();
		this.credit.reset();
		this.rivals.reset();
		this.smuggler.reset();
		this.operating.reset();
		this.dues.reset();
		this.warehouse.reset();
		this.fishHall.reset();

	}

	dispose() {

		this.close();
		for ( const off of this._removers ) off();
		this._removers = [];
		this._sited.clear();
		if ( this._offMarket ) this._offMarket();
		for ( const id in this.stalls ) this.stalls[ id ].dispose();
		this.stalls = {};
		this.lights.length = 0;
		this.panel.dispose();

	}

}

export function install( app, features, opts = {} ) {

	return new Trade( app, features, opts );

}

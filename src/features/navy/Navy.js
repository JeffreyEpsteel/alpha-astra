// The navy (wave 19B): a faction based at Tidemark's naval jetty. Its ships are naval's (naval.spawn of the ShipClasses navy
// classes: one frigate, two revenue cutters; Brains.thinkNavy sails them, naval's guns, balls and damage fight for them), this
// feature gives them their orders every frame (s.navy: foe, ward, wanted, hostile, home) and keeps the books.
//
//   patrol    the trade lanes (Routes.navyLanes: the Tidemark approach and the middle of the lane from home)
//   escort    one cutter keeps station on a merchant of the trade lane (naval's trawlers), or a convoy of a sea event
//   hunt      a pirate within FLEET.foeReach of a navy ship (or of her ward) is engaged: AI vs AI broadsides; the pirate fights back
//             (her s.foe: Brains.pirateWorld) while the player is not nearer to her. You can watch, or join in.
//   the law   while you are wanted (NavyData WANTED: a wanted hull from hijack, notoriety, customs offences, low standing, or you
//             fired on the navy) a navy ship that sights you at sea hails ("Heave to!" toast), boards you if you stop (a fine,
//             paid or owed; the slate is clean for PARDON island hours) or fires if you run. Never inside the calm waters.
//   bounties  a pirate sunk by you pays BOUNTY[ class ] (more for a named captain); one the navy sank with your shot in her the
//             last BOUNTY.assist s pays a share. Owed until claimed at Tidemark: the harbourmaster's board or the navy office.
//   standing  -100..100 (NavyData STANDING): gates the jetty's chandler (better cannon: naval's heavyGuns module at CHANDLER.heavy /
//             .long; chain shot and powder cheaper by standing), brings the press gang when low (ashore at a port: sign on or pay).
//   sea events (SeaEvents.js): a convoy attacked on the horizon, a man overboard.
//
//   const navy = features.get( 'navy' );
//   navy.standing / navy.standingName() / navy.addStanding( n, why )     navy.owed / navy.claim() -> amount
//   navy.isWanted() / navy.crimes() -> { hull, level, offences, standing }   navy.fineOwed / navy.payFine()
//   navy.chandlerRows() / navy.buy( 'heavy' | 'long' | 'chain' | 'powder' ) -> { ok, price, reason }
//   navy.ships (Map id -> Ship of the navy afloat)   navy.events (SeaEvents)   navy.press / navy.resolvePress( 'sign' | 'refuse' )
//   navy.view() (the panel's model)   navy.openOffice()   isOpen / close()   update( dt ) / toJSON() / fromJSON() / reset() / dispose()
// Events: navyHail { ship, say: 'hail' | 'warn' | 'fire' | 'board' }, navyBoarded { ship, fine, paid }, navyBounty { id, name,
//   amount, assist }, navyBountyPaid { amount, count }, navyStanding { standing, delta, why }, pressGang { port, choice, fine },
//   convoyAttacked / convoySaved / convoyLost, manOverboardRescued (SeaEvents).
// Multiplayer: the host runs the navy like the other AI ships (naval.active; NavalLink sends them to the guests, who draw them
// through drawNavy). Every client tells the room whether it is wanted (world event 'navyWanted' { wanted, hostile }); the host's
// navy judges each player's boat by that, and a hail meant for a guest goes to him as world event 'navyHail' { to, say, ship }.
// Headless: install( app, features, { rand, seed, jetty: false, models: false } ).

import { mulberry32 } from '../../util/Noise.js';
import { WORLD } from '../../world/WorldLayout.js';
import { SHIP_CLASSES, NAVY_SHIPS, NAVY_CAPTAINS } from '../naval/ShipClasses.js';
import { NAVY_JETTY, navyLanes, inSafeZone, nearestIndex, makeCursor } from '../naval/Routes.js';
import { Magazine } from '../naval/Ammo.js';
import { SHOT } from '../weapons/WeaponsData.js';
import { TIDEMARK_BOARD } from '../../game/ports/TidemarkPort.js';
import { STANDING, WANTED, HOSTILE, PARDON, FLEET, BOUNTY, CHANDLER, PRESS, HAIL, clampStanding, standingName, discount, bountyFor, fineFor } from './NavyData.js';
import { drawNavy, buildJetty } from './NavyModels.js';
import { SeaEvents, ABOARD } from './SeaEvents.js';
import { NavyPanel } from './NavyPanel.js';

const SAVE_VERSION = 1;
const num = ( v, d = 0 ) => ( typeof v === 'number' && Number.isFinite( v ) ? v : d );
const CRIPPLED = 0.25; // a pirate below this has struck (boarding's prize): the navy holds its fire

export class Navy {

	constructor( app, features, opts = {} ) {

		this.app = app || {};
		this.features = features || null;
		this.opts = opts;
		this.rng = opts.rand || mulberry32( opts.seed !== undefined ? opts.seed : ( Date.now() & 0xffffff ) );
		this.time = 0;
		this.hours = 0;
		this.standing = 0;
		this.owed = 0;
		this.owedCount = 0;
		this.fineOwed = 0;
		this.pardon = null; // { until (island hours), level, offences, hull }: what a paid fine covered
		this.hostileUntil = - 1; // this.time
		this.stats = { piratesSunk: 0, assists: 0, navyKills: 0, hails: 0, boarded: 0, fines: 0, ran: 0, claimed: 0, press: 0 };
		this.ships = new Map(); // id -> Ship (ours, afloat)
		this.roles = new Map(); // id -> { role: 'frigate' | 'outer' | 'escort', lane }
		this._respawn = { frigate: 0, outer: 0, escort: 0 }; // this.time when each role may sail again
		this._assist = new Map(); // pirate id -> this.time the player last hit her
		this._fought = new Set(); // pirates whose s.foe we set (fighting back a navy ship)
		this.remote = new Map(); // peer id -> { wanted, hostile, at }
		this._fleetT = 0.5;
		this._wantT = 0;
		this._wanted = false;
		this._sentWanted = null;
		this._sentT = 0;
		this._ranWarned = new Set();
		this._hitT = - 99;
		this._pressT = PRESS.every;
		this.press = null;
		this._uid = Math.floor( this.rng() * 1e6 );
		this._n = 0;
		this._offs = [];
		this.events = new SeaEvents( this );
		this.panel = new NavyPanel( this );
		this.jetty = null;
		this._wantedFn = ( t ) => ( t && t.remote ? !! ( this.remote.get( t.remote ) || {} ).wanted : this._wanted );
		this._hostileFn = ( t ) => ( t && t.remote ? !! ( this.remote.get( t.remote ) || {} ).hostile : this.time < this.hostileUntil );

		const f = this.features;
		if ( f && typeof f.on === 'function' ) {

			this._offs.push( f.on( 'shipSunk', ( e ) => this._onSunk( e || {} ) ) );
			this._offs.push( f.on( 'cannonballImpact', ( e ) => this._onImpact( e || {} ) ) );
			this._offs.push( f.on( 'remoteWorldEvent', ( e ) => this._onRemote( e || {} ) ) );

		}

		if ( f && typeof f.interactable === 'function' ) {

			const J = NAVY_JETTY;
			const door = { x: J.office.x + 1.8, y: J.deck, z: J.z + 2.2 };
			this._offs.push( f.interactable( {
				id: 'navy-office', radius: 3.2, position: door,
				prompt: () => ( this.owed > 0 ? `Navy office · $${ this.owed } in bounties` : 'Navy office' ),
				when: () => ! this.panel.isOpen, onInteract: () => this.openOffice(),
			} ) );
			// the harbourmaster's board on Tidemark's square pays the navy's bounties too
			const B = TIDEMARK_BOARD;
			this._offs.push( f.interactable( {
				id: 'navy-claim', radius: 3.0, position: () => ( { x: B.x + Math.sin( B.yaw || 0 ) * 1.6, y: this._groundY( B.x, B.z ), z: B.z + Math.cos( B.yaw || 0 ) * 1.6 } ),
				prompt: () => `Claim navy bounties from the harbourmaster · $${ this.owed }`,
				when: () => this.owed > 0 && ! this.panel.isOpen, onInteract: () => this.claim(),
			} ) );

		}

		// the navy's looks: wrap naval's ModelSet now (naval installs first), and again in update if it was not there yet
		const nv0 = this.naval;
		if ( nv0 && nv0.models ) drawNavy( nv0.models );

		if ( opts.jetty !== false && ( this.app.scene || this.app.colliders ) ) {

			try { this.jetty = buildJetty( { scene: opts.models === false ? null : this.app.scene, colliders: this.app.colliders || null } ); } catch ( e ) { console.warn( 'navy: no jetty', e ); }

		}

	}

	// ------------------------------------------------------------------ collaborators

	get( name ) {

		return this.opts[ name ] || ( this.features && this.features.get ? this.features.get( name ) : null );

	}

	get naval() { return this.get( 'naval' ); }
	get state() { return this.features ? this.features.state : null; }
	get sandbox() { return !! ( this.features && this.features.sandbox ); }

	_groundY( x, z ) {

		const T = this.app.terrainData;
		try { return T && T.heightAt ? Math.max( 0, T.heightAt( x, z ) ) : 0; } catch ( e ) { return 0; }

	}

	_mode() {

		const p = this.app.player;
		return p && p.mode ? p.mode : 'walk';

	}

	boatPos() {

		const b = this.app.boatCtl;
		return b && b.position ? b.position : null;

	}

	playerAtSea() {

		if ( ! ABOARD.includes( this._mode() ) ) return false;
		const b = this.app.boatCtl;
		if ( ! b || ! b.position || b.moored ) return false;
		return ! inSafeZone( b.position.x, b.position.z );

	}

	toast( text, ms = 2800 ) {

		const g = this.app.game;
		if ( g && typeof g.toast === 'function' ) g.toast( text, ms );

	}

	emit( name, e ) {

		if ( this.features && typeof this.features.emit === 'function' ) this.features.emit( name, e );

	}

	marker( id, m ) {

		const wm = this.get( 'worldmap' );
		if ( ! wm ) return;
		try {

			if ( m ) wm.addMarker( { id, kind: m.kind || 'sail', x: Math.round( m.x ), z: Math.round( m.z ), label: m.label, mine: false } );
			else if ( wm.removeMarker ) wm.removeMarker( id );

		} catch ( e ) { /* the map is optional */ }

	}

	pay( amount, why ) {

		const st = this.state;
		if ( amount > 0 && st && typeof st.earn === 'function' ) st.earn( amount );
		return amount;

	}

	_hours() {

		const w = this.get( 'weather' );
		if ( w && Number.isFinite( w.hours ) && w.hours > 0 ) return w.hours;
		const s = this.app.settings;
		return s && Number.isFinite( s.timeOfDay ) ? s.timeOfDay : 12;

	}

	// ------------------------------------------------------------------ standing and the law

	addStanding( n, why = '' ) {

		if ( ! n ) return this.standing;
		const before = this.standing;
		this.standing = clampStanding( Math.round( ( this.standing + n ) * 10 ) / 10 );
		if ( this.standing !== before ) this.emit( 'navyStanding', { standing: this.standing, delta: this.standing - before, why } );
		return this.standing;

	}

	standingName() {

		return standingName( this.standing );

	}

	// what the navy holds against you now
	crimes() {

		const hj = this.get( 'hijack' ), pr = this.get( 'pirates' ), cu = this.get( 'customs' );
		let level = 0, offences = 0;
		try { level = pr && pr.notorietyLevel ? num( pr.notorietyLevel() ) : 0; } catch ( e ) { level = 0; }
		if ( cu && typeof cu.offences === 'function' ) for ( const p of WORLD.ports || [] ) try { offences += num( cu.offences( p.id ) ); } catch ( e ) { /* skip */ }
		// Meridian's police level: the cars feature answers the higher of its own heat (jacked cars, people run down, shots)
		// and the buildings' (citywreck); after a bust it is settled (cars.policeLevel 0), so the navy lets it go too
		const cw = this.get( 'citywreck' ), cars = this.get( 'cars' );
		let city = 0;
		try { city = cars && typeof cars.policeLevel === 'function' ? num( cars.policeLevel() ) : cw && cw.wanted ? num( cw.wanted() ) : 0; } catch ( e ) { city = 0; }
		return { hull: !! ( hj && hj.vessel && hj.vessel.wanted ), level, offences, standing: this.standing, city };

	}

	isWanted() {

		if ( this.time < this.hostileUntil ) return true;
		if ( this.sandbox ) return false; // (free play: only shooting at the navy makes it fight you)
		const c = this.crimes();
		const P = this.pardon;
		if ( P && this.hours < P.until ) return ( c.hull && ! P.hull ) || c.level > P.level || c.offences > P.offences;
		return c.hull || c.level >= WANTED.notoriety || c.offences >= WANTED.offences || c.standing <= WANTED.standing || c.city >= 2;

	}

	// ------------------------------------------------------------------ the fleet

	_lanes() {

		return this._laneCache || ( this._laneCache = navyLanes() );

	}

	_fleet() {

		const nv = this.naval;
		// ours that are gone (sunk, despawned, taken)
		for ( const [ id, s ] of this.ships ) {

			if ( s.alive && nv.ships.includes( s ) && SHIP_CLASSES[ s.kind ] && s.cls.navy ) continue;
			const r = this.roles.get( id );
			if ( r ) this._respawn[ r.role ] = this.time + FLEET.respawn;
			this.ships.delete( id );
			this.roles.delete( id );

		}

		const have = new Set( [ ...this.roles.values() ].map( ( r ) => r.role ) );
		const lanes = this._lanes();
		const want = [ [ 'frigate', 'frigate', lanes[ 1 ] || lanes[ 0 ] ], [ 'outer', 'revenue', lanes[ 0 ] ], [ 'escort', 'revenue', lanes[ 1 ] || lanes[ 0 ] ] ];
		// navy ships afloat that are not ours (a universe's stored ships adopted by a new host, a save): they take a free role
		for ( const s of nv.ships ) {

			if ( ! s.alive || s.puppet || ! s.cls || ! s.cls.navy || this.ships.has( s.id ) ) continue;
			const w = want.find( ( q ) => q[ 1 ] === s.kind && ! have.has( q[ 0 ] ) );
			if ( ! w ) { s.state = 'gone'; continue; }
			have.add( w[ 0 ] );
			if ( ! s.cursor && w[ 2 ] ) s.cursor = makeCursor( w[ 2 ], { index: nearestIndex( w[ 2 ], s.x, s.z ) } );
			s.navy = { foe: null, ward: null, wanted: this._wantedFn, hostile: this._hostileFn, home: NAVY_JETTY.home };
			this.ships.set( s.id, s );
			this.roles.set( s.id, { role: w[ 0 ], lane: w[ 2 ] } );

		}

		for ( const [ role, kind, lane ] of want ) {

			if ( have.has( role ) || this.time < this._respawn[ role ] || ! lane ) continue;
			this._spawn( role, kind, lane );

		}

	}

	// a navy ship on her lane at the waypoint nearest the camera that is at least FLEET.noPopIn away (no pop-in)
	_spawn( role, kind, lane ) {

		const nv = this.naval;
		const cam = ( this.app.camera && this.app.camera.position ) || this.boatPos();
		let best = - 1, bd = Infinity;
		lane.forEach( ( p, i ) => {

			const d = cam ? Math.hypot( p[ 0 ] - cam.x, p[ 1 ] - cam.z ) : 1e6;
			if ( d >= FLEET.noPopIn && d < bd ) { bd = d; best = i; }

		} );
		if ( best < 0 ) return null;
		const p = lane[ best ], nxt = best + 1 < lane.length ? best + 1 : best - 1;
		const q = lane[ nxt ];
		const id = `navy-${ this._uid }-${ ++ this._n }`;
		let s = null;
		try {

			s = nv.spawn( kind, {
				id, x: p[ 0 ], z: p[ 1 ], yaw: Math.atan2( q[ 0 ] - p[ 0 ], q[ 1 ] - p[ 1 ] ), speed: SHIP_CLASSES[ kind ].speed * 0.5,
				name: NAVY_SHIPS[ Math.floor( this.rng() * NAVY_SHIPS.length ) % NAVY_SHIPS.length ],
				captain: NAVY_CAPTAINS[ Math.floor( this.rng() * NAVY_CAPTAINS.length ) % NAVY_CAPTAINS.length ],
				state: 'patrol', route: lane, index: nxt, dir: nxt > best ? 1 : - 1,
			} );

		} catch ( e ) { return null; }

		s.navy = { foe: null, ward: null, wanted: this._wantedFn, hostile: this._hostileFn, home: NAVY_JETTY.home };
		const rounds = FLEET.ammo[ kind ];
		if ( rounds ) s.ammo = new Magazine( rounds );
		this.ships.set( id, s );
		this.roles.set( id, { role, lane } );
		return s;

	}

	// every frame: each navy ship's foe and ward; pirates fight back; a fleeing ship moors at the jetty and mends
	_orders( dt ) {

		const nv = this.naval, list = nv.ships;
		const ev = this.events.convoy;
		for ( const [ id, s ] of this.ships ) {

			if ( ! s.alive ) continue;
			const o = s.navy || ( s.navy = {} );
			o.wanted = this._wantedFn;
			o.hostile = this._hostileFn;
			o.home = NAVY_JETTY.home;
			const role = this.roles.get( id );
			// the ward: a convoy in trouble first, else a merchant of the lane nobody else escorts
			if ( role && role.role === 'escort' ) {

				if ( ev && ! ev.done && ev.ship.alive ) o.ward = ev.ship;
				else if ( ! o.ward || ! o.ward.alive || o.ward.taken || o.ward.state === 'moored' ) o.ward = this._pickWard( s );

			} else o.ward = null;

			// the foe: the nearest pirate afloat and fighting near her (or her ward); a convoy's raiders from farther
			let foe = null, fd = Infinity;
			for ( const p of list ) {

				if ( p.faction !== 'pirate' || ! p.alive || p.hpFraction < CRIPPLED || p.taken ) continue;
				const d = Math.hypot( p.x - s.x, p.z - s.z );
				const dw = o.ward ? Math.hypot( p.x - o.ward.x, p.z - o.ward.z ) : Infinity;
				const reach = p.foeBy === 'event' ? 2000 : FLEET.foeReach;
				if ( ( d < reach || dw < FLEET.foeReach ) && d < fd && ! inSafeZone( p.x, p.z ) ) { fd = d; foe = p; }

			}

			o.foe = foe;
			// moor at the jetty after running home; mend there, then back to work
			if ( s.state === 'flee' && Math.hypot( s.x - NAVY_JETTY.home.x, s.z - NAVY_JETTY.home.z ) < FLEET.moorReach ) {

				s.setState( 'moored' );
				s.speed = 0;

			}

			if ( s.state === 'moored' ) {

				s.hp = Math.min( s.maxHp, s.hp + s.maxHp * FLEET.repair * dt );
				if ( s.hp >= s.maxHp * 0.95 ) {

					s.setState( 'patrol' );
					if ( s.cursor ) s.cursor.index = nearestIndex( s.cursor.points, s.x, s.z );

				}

			}

		}

		// pirates fight back the navy ship that hunts them (while the player is not nearer: Brains.pirateWorld picks)
		const now = new Set();
		for ( const s of this.ships.values() ) {

			const p = s.navy && s.navy.foe;
			if ( ! p || ! s.alive || ( s.state !== 'hunt' && s.state !== 'broadside' ) || p.foeBy === 'event' ) continue;
			if ( Math.hypot( p.x - s.x, p.z - s.z ) > FLEET.pirateFight ) continue;
			p.foe = s;
			p.foeBy = 'navy';
			now.add( p );

		}

		for ( const p of this._fought ) if ( ! now.has( p ) && p.foeBy === 'navy' ) { p.foe = null; p.foeBy = null; }
		this._fought = now;

	}

	_pickWard( s ) {

		const taken = new Set( [ ...this.ships.values() ].map( ( q ) => q.navy && q.navy.ward ).filter( Boolean ) );
		let best = null, bd = 2500;
		for ( const m of this.naval.ships ) {

			if ( m.faction !== 'merchant' || ! m.alive || m.taken || taken.has( m ) || m.state === 'moored' ) continue;
			const d = Math.hypot( m.x - s.x, m.z - s.z );
			if ( d < bd ) { bd = d; best = m; }

		}

		return best;

	}

	// what the brains said this frame (Brains.thinkNavy s.mem.say)
	_outbox() {

		for ( const s of this.ships.values() ) {

			const m = s.mem;
			if ( ! m || ! m.say ) continue;
			const say = m.say, who = m.who;
			m.say = null;
			if ( who ) {

				const ns = this.app.netsync;
				try { if ( ns && ns.sendWorldEvent ) ns.sendWorldEvent( 'navyHail', { to: who, say, ship: s.name } ); } catch ( e ) { /* offline */ }
				continue;

			}

			this._hail( say, s.name, s );

		}

	}

	// a hail meant for us (our navy, or the host's through 'navyHail')
	_hail( say, name, ship = null ) {

		this.emit( 'navyHail', { ship: name, say } );
		if ( say === 'hail' ) {

			this.stats.hails ++;
			this.toast( HAIL.hail( name ), 4200 );

		} else if ( say === 'warn' ) this.toast( HAIL.warn( name ), 3600 );
		else if ( say === 'fire' ) {

			this.toast( HAIL.fire( name ), 3000 );
			const key = ship ? ship.id : name;
			if ( ! this._ranWarned.has( key ) ) {

				this._ranWarned.add( key );
				this.stats.ran ++;
				this.addStanding( STANDING.ran, 'ran from a hail' );

			}

		} else if ( say === 'board' ) this._boarded( name, ship );

	}

	// a boarding party came aboard: the fine (paid, else owed), the slate wiped for PARDON hours
	_boarded( name, ship = null ) {

		const c = this.crimes();
		const fine = this.sandbox ? 0 : fineFor( { level: c.level, offences: c.offences, hull: c.hull } );
		const st = this.state;
		let paid = fine === 0 || !! ( st && typeof st.spend === 'function' && st.spend( fine ) );
		if ( ! paid ) {

			this.fineOwed += fine;
			this.addStanding( STANDING.fineUnpaid, 'fine unpaid' );

		} else this.addStanding( STANDING.boarded, 'boarded quietly' );
		this.stats.boarded ++;
		this.stats.fines += paid ? fine : 0;
		this.pardon = { until: this.hours + PARDON, level: c.level, offences: c.offences, hull: c.hull };
		this.hostileUntil = - 1;
		this._wanted = false;
		this._ranWarned.clear();
		// her papers are registered: a stolen hull is no longer on the navy's list (the guards ashore may still know her)
		const hj = this.get( 'hijack' );
		if ( c.hull && hj && hj.vessel && paid ) hj.vessel.wanted = false;
		if ( ship && ship.mem ) ship.mem.boarded = true;
		this.toast( `${ HAIL.board( name ) }: ${ fine ? ( paid ? `a fine of $${ fine }, paid` : `a fine of $${ fine } you cannot pay: settle it at the navy office` ) : 'a look round, and they leave you be' }`, 4600 );
		this.emit( 'navyBoarded', { ship: name, fine, paid } );
		return { fine, paid };

	}

	// ------------------------------------------------------------------ events

	_isNavyShip( id ) {

		const nv = this.naval;
		const s = nv && nv.ships ? nv.ships.find( ( q ) => q.id === id ) : null;
		return s && s.faction === 'navy' ? s : null;

	}

	_onImpact( e ) {

		if ( e.owner !== 'player' || e.hit !== 'ship' || ! e.target || e.target === 'player' ) return;
		const nv = this.naval;
		const s = nv && nv.ships ? nv.ships.find( ( q ) => q.id === e.target ) : null;
		if ( ! s ) return;
		if ( s.faction === 'pirate' ) {

			this._assist.set( s.id, this.time );
			this.events.onPlayerHit( s.id );

		} else if ( s.faction === 'navy' ) {

			this.hostileUntil = this.time + HOSTILE;
			this._wanted = true;
			if ( this.time - this._hitT > 10 ) {

				this._hitT = this.time;
				this.addStanding( STANDING.navyHit, 'fired on the navy' );

			}

		}

	}

	_onSunk( e ) {

		if ( e.remote && ! e.byNavy ) return;
		if ( e.faction === 'pirate' ) {

			const assisted = this._assist.has( e.id ) && this.time - this._assist.get( e.id ) < BOUNTY.assist;
			this._assist.delete( e.id );
			const byNavy = e.byNavy === true || [ ...this.ships.values() ].some( ( s ) => s.navy && s.navy.foe && s.navy.foe.id === e.id );
			if ( byNavy && ! e.byPlayer ) this.stats.navyKills ++;
			if ( ! e.byPlayer && ! ( assisted && byNavy ) ) return;
			const pr = this.get( 'pirates' );
			const named = !! e.bountyId || !! ( pr && pr.roster && pr.roster.live && typeof pr.roster.live.has === 'function' && pr.roster.live.has( e.id ) );
			let amount = bountyFor( e.kind, named );
			if ( ! e.byPlayer ) {

				amount = Math.round( amount * BOUNTY.share );
				this.stats.assists ++;
				this.addStanding( STANDING.pirateHelp, 'helped the navy' );

			} else {

				this.stats.piratesSunk ++;
				this.addStanding( STANDING.pirateSunk, 'pirate sunk' );

			}

			this.owed += amount;
			this.owedCount ++;
			this.toast( `Navy bounty: $${ amount } for the ${ e.name || 'raider' } · claim it at Tidemark`, 3200 );
			this.emit( 'navyBounty', { id: e.id, name: e.name || null, amount, assist: ! e.byPlayer } );

		} else if ( e.byPlayer && e.faction === 'navy' ) {

			this.hostileUntil = this.time + HOSTILE * 2;
			this.addStanding( STANDING.navySunk, 'sank a navy ship' );

		} else if ( e.byPlayer && e.faction === 'merchant' ) this.addStanding( STANDING.merchantSunk, 'sank a merchant' );

	}

	_onRemote( e ) {

		const d = e.data || {};
		if ( e.kind === 'navyWanted' && e.from ) this.remote.set( e.from, { wanted: !! d.wanted, hostile: !! d.hostile, at: this.time } );
		else if ( e.kind === 'navyHail' ) {

			const net = this.app.net;
			const me = net && net.id;
			if ( me && d.to === me && typeof d.say === 'string' ) this._hail( d.say, String( d.ship || 'navy ship' ).slice( 0, 40 ) );

		}

	}

	// tell the room whether we are wanted (on a change, and every 15 s)
	_broadcastWanted( dt ) {

		const ns = this.app.netsync;
		if ( ! ns || typeof ns.sendWorldEvent !== 'function' || ! this.features || this.features.mode !== 'multiplayer' ) return;
		this._sentT -= dt;
		const key = `${ this._wanted }|${ this.time < this.hostileUntil }`;
		if ( key === this._sentWanted && this._sentT > 0 ) return;
		this._sentWanted = key;
		this._sentT = 15;
		try { ns.sendWorldEvent( 'navyWanted', { wanted: this._wanted, hostile: this.time < this.hostileUntil } ); } catch ( e ) { /* offline */ }

	}

	// ------------------------------------------------------------------ the office, bounties, fines, the chandler

	openOffice() {

		this.panel.open( 'office' );
		return true;

	}

	claim() {

		const n = this.owed;
		if ( ! ( n > 0 ) ) return 0;
		this.pay( n, 'navy bounty' );
		this.emit( 'navyBountyPaid', { amount: n, count: this.owedCount } );
		this.toast( `The navy pays $${ n } for ${ this.owedCount } pirate${ this.owedCount === 1 ? '' : 's' }`, 3200 );
		this.stats.claimed += n;
		this.owed = 0;
		this.owedCount = 0;
		return n;

	}

	// the harbourmaster's board at Tidemark (a notice kind 'navyBounty': the notices feature lists it with a reported patch;
	// taking it is the claim): the rates, and what is owed now
	postings( port, hours = this.hours ) {

		if ( port !== NAVY_JETTY.port ) return [];
		const day = Math.floor( num( hours ) / 24 ), expires = ( day + 1 ) * 24;
		const owed = this.owed;
		return [ {
			id: 'navy:bounties', port, day, slot: 200, kind: 'quest', type: 'navyBounty', navy: true,
			title: 'Navy bounties', client: 'The Admiralty',
			text: `The Crown pays for every raider sunk: $${ BOUNTY.sloop } a sloop, $${ BOUNTY.brigantine } a brigantine, half again for a named captain, a share when the navy finishes one you hit. ${ owed > 0 ? `You are owed $${ owed }: take this notice to be paid.` : 'Nothing owed to you yet.' }`,
			params: {}, goal: 1, reward: { money: owed, rep: 0, unlock: null }, issued: day * 24, expires, left: expires - num( hours ),
		} ];

	}

	payFine() {

		const n = this.fineOwed, st = this.state;
		if ( ! ( n > 0 ) ) return false;
		if ( ! st || typeof st.spend !== 'function' || ! st.spend( n ) ) {

			this.toast( 'Not enough money for the fine', 2000 );
			return false;

		}

		this.fineOwed = 0;
		this.addStanding( - STANDING.fineUnpaid / 2, 'fine paid' );
		this.toast( `Fine of $${ n } paid · your name is off the list`, 2800 );
		return true;

	}

	_moduleRow( id ) {

		const nv = this.naval;
		try { return nv && nv.moduleRows ? ( nv.moduleRows() || [] ).find( ( r ) => r.id === id ) || null : null; } catch ( e ) { return null; }

	}

	// the chandler's rows: { id, label, price, ok, note }
	chandlerRows() {

		const s = this.standing, off = Math.min( 0.9, discount( s ) + ( this.get( 'story' )?.discount?.( 'navy' ) || 0 ) ), free = this.sandbox;
		const open = s >= CHANDLER.open || free;
		const rows = [];
		const guns = this._moduleRow( 'heavyGuns' );
		const tier = guns ? num( guns.tier ) : 0;
		const gate = tier >= 1 ? CHANDLER.long : CHANDLER.heavy;
		const gunLabel = tier >= 1 ? 'Admiralty long guns' : 'Admiralty heavy shot';
		if ( ! guns || tier < num( guns.maxTier, 2 ) ) {

			const ok = open && ( s >= gate || free ) && !! guns && guns.canBuy !== false;
			rows.push( { id: tier >= 1 ? 'long' : 'heavy', label: gunLabel, price: guns ? num( guns.price ) : 0, ok,
				note: s >= gate || free ? ( guns && guns.reason ? guns.reason : 'Heavier guns for your battery or swivel: more damage and reach' ) : `For friends of the fleet: standing ${ gate } (you have ${ Math.round( s ) })` } );

		}

		const chain = Math.round( CHANDLER.chain.price * ( 1 - off ) ), powder = Math.round( CHANDLER.powder.price * ( 1 - off ) );
		rows.push( { id: 'chain', label: `Chain shot x${ CHANDLER.chain.pack }`, price: free ? 0 : chain, ok: open, note: off > 0 ? `${ Math.round( off * 100 ) }% off for your standing · tears sails and masts` : 'Tears sails and masts' } );
		rows.push( { id: 'powder', label: `Powder and shot x${ CHANDLER.powder.rounds }`, price: free ? 0 : powder, ok: open, note: off > 0 ? `Navy stores, ${ Math.round( off * 100 ) }% off` : 'Navy stores' } );
		if ( ! open ) for ( const r of rows ) { r.ok = false; r.note = 'The navy does not trade with rogues'; }
		return rows;

	}

	buy( id ) {

		const row = this.chandlerRows().find( ( r ) => r.id === id );
		if ( ! row ) return { ok: false, reason: 'unknown' };
		if ( ! row.ok ) return { ok: false, reason: 'standing' };
		const nv = this.naval, st = this.state;
		if ( id === 'heavy' || id === 'long' ) {

			const r = nv && nv.buyModule ? nv.buyModule( 'heavyGuns' ) : { ok: false, reason: 'no guns' };
			return { ok: !! r.ok, price: r.price || 0, reason: r.reason || null };

		}

		const free = this.sandbox || !! ( st && st.free );
		if ( id === 'chain' ) {

			const w = this.get( 'weapons' );
			if ( ! w || ! w.shot ) return { ok: false, reason: 'no guns' };
			const max = SHOT.chain.max;
			if ( ( w.shot.chain || 0 ) >= max ) return { ok: false, reason: 'full' };
			if ( ! free && ( ! st || ! st.spend( row.price ) ) ) return { ok: false, reason: 'money' };
			w.shot.chain = Math.min( max, ( w.shot.chain || 0 ) + CHANDLER.chain.pack );
			this.toast( `Chain shot x${ CHANDLER.chain.pack } · ${ w.shot.chain } aboard`, 2400 );
			return { ok: true, price: free ? 0 : row.price };

		}

		if ( id === 'powder' ) {

			const mag = nv && nv.ammo;
			if ( ! mag || ! ( mag.room > 0 ) ) return { ok: false, reason: 'full' };
			if ( ! free && ( ! st || ! st.spend( row.price ) ) ) return { ok: false, reason: 'money' };
			const added = mag.add( CHANDLER.powder.rounds );
			this.toast( `Powder and shot: ${ mag.rounds } rounds aboard`, 2400 );
			return { ok: true, price: free ? 0 : row.price, added };

		}

		return { ok: false, reason: 'unknown' };

	}

	// ------------------------------------------------------------------ the press gang

	_pressTick( dt ) {

		if ( this.press || this.sandbox ) return;
		this._pressT -= dt;
		if ( this._pressT > 0 ) return;
		this._pressT = PRESS.every;
		if ( this.standing >= PRESS.below || this._mode() !== 'walk' ) return;
		const p = this.app.player && this.app.player.position;
		if ( ! p ) return;
		const port = ( WORLD.ports || [] ).find( ( q ) => q.dock && q.dock.position && Math.hypot( q.dock.position.x - p.x, q.dock.position.z - p.z ) < PRESS.reach );
		if ( ! port || this.rng() >= PRESS.chance ) return;
		this.startPress( port.id );

	}

	startPress( port = 'tidemark' ) {

		if ( this.press ) return false;
		this.press = { port, fine: PRESS.fine };
		this.stats.press ++;
		this.toast( 'A navy press gang falls in step beside you, all smiles', 3000 );
		this.panel.open( 'press' );
		return true;

	}

	resolvePress( choice ) {

		const p = this.press;
		if ( ! p ) return false;
		this.press = null;
		if ( choice === 'sign' ) {

			this.addStanding( STANDING.pressSigned, 'signed on' );
			this.toast( 'You sign on, scrub the frigate\'s deck till sundown and are "released for good conduct" with a sore back', 4600 );

		} else {

			const st = this.state;
			const paid = !! ( st && typeof st.spend === 'function' && st.spend( p.fine ) );
			if ( ! paid ) this.fineOwed += p.fine;
			this.addStanding( STANDING.pressRefused, 'refused the press' );
			this.toast( paid ? `You decline. They decline your refusal, then accept $${ p.fine } for their trouble` : `You decline with empty pockets: $${ p.fine } is put on your account at the navy office`, 4200 );

		}

		this.emit( 'pressGang', { port: p.port, choice: choice === 'sign' ? 'sign' : 'refuse', fine: choice === 'sign' ? 0 : p.fine } );
		this.panel.close();
		return true;

	}

	// ------------------------------------------------------------------ frame

	view() {

		const w = this.get( 'weather' );
		let forecast = 'The glass is steady.';
		try { if ( w && typeof w.forecastText === 'function' ) forecast = w.forecastText( NAVY_JETTY.home.x, NAVY_JETTY.home.z ); } catch ( e ) { /* optional */ }
		return {
			standing: Math.round( this.standing ), standingName: this.standingName(), wanted: this._wanted, owed: this.owed, owedCount: this.owedCount,
			fineOwed: this.fineOwed, forecast, ships: [ ...this.ships.values() ].map( ( s ) => ( { id: s.id, kind: s.kind, name: s.name, state: s.state, role: ( this.roles.get( s.id ) || {} ).role } ) ),
		};

	}

	get isOpen() {

		return this.panel.isOpen;

	}

	close() {

		if ( this.press ) this.resolvePress( 'refuse' ); // (Escape: walking away from the press gang is a refusal)
		this.panel.close();

	}

	update( dt ) {

		if ( ! ( dt > 0 ) ) return;
		dt = Math.min( dt, 0.1 );
		this.time += dt;
		this.hours = this._hours();
		const nv = this.naval;
		if ( nv && nv.models && ! nv.models.__navy ) {

			drawNavy( nv.models );
			// a navy ship drawn before the wrap got the base loader's empty visual: naval makes her a new one
			for ( const s of nv.ships || [] ) if ( s.cls && s.cls.model === 'navy' && s.visual && ! s.visual.navyKind ) { s.visual.dispose(); s.visual = null; }

		}
		this._wantT -= dt;
		if ( this._wantT <= 0 ) {

			this._wantT = 1;
			this._wanted = this.isWanted();

		}

		this._broadcastWanted( dt );
		if ( nv && nv.active !== false && typeof nv.spawn === 'function' && Array.isArray( nv.ships ) ) {

			this._fleetT -= dt;
			if ( this._fleetT <= 0 ) {

				this._fleetT = FLEET.every;
				this._fleet();

			}

			this._orders( dt );
			this._outbox();

		} else if ( this.ships.size ) {

			this.ships.clear(); // (a guest now: the host's navy is drawn as puppets)
			this.roles.clear();

		}

		this.events.update( dt );
		this._pressTick( dt );

	}

	toJSON() {

		return {
			v: SAVE_VERSION, standing: this.standing, owed: this.owed, owedCount: this.owedCount, fineOwed: this.fineOwed,
			pardon: this.pardon, stats: { ...this.stats },
		};

	}

	fromJSON( d ) {

		if ( ! d || typeof d !== 'object' ) return;
		this.standing = clampStanding( num( d.standing ) );
		this.owed = Math.max( 0, Math.round( num( d.owed ) ) );
		this.owedCount = Math.max( 0, Math.round( num( d.owedCount ) ) );
		this.fineOwed = Math.max( 0, Math.round( num( d.fineOwed ) ) );
		const P = d.pardon;
		this.pardon = P && typeof P === 'object' && Number.isFinite( P.until ) ? { until: P.until, level: num( P.level ), offences: num( P.offences ), hull: !! P.hull } : null;
		if ( d.stats && typeof d.stats === 'object' ) for ( const k of Object.keys( this.stats ) ) this.stats[ k ] = Math.max( 0, num( d.stats[ k ] ) );

	}

	_despawn() {

		for ( const s of this.ships.values() ) if ( s.alive ) s.state = 'gone';
		this.ships.clear();
		this.roles.clear();
		for ( const p of this._fought ) if ( p.foeBy === 'navy' ) { p.foe = null; p.foeBy = null; }
		this._fought.clear();

	}

	reset() {

		this.standing = 0;
		this.owed = this.owedCount = this.fineOwed = 0;
		this.pardon = null;
		this.hostileUntil = - 1;
		this.press = null;
		for ( const k of Object.keys( this.stats ) ) this.stats[ k ] = 0;
		this._despawn();
		this.events.clear();
		this.panel.close();

	}

	dispose() {

		for ( const off of this._offs ) try { off(); } catch ( e ) { /* gone */ }
		this._offs.length = 0;
		this._despawn();
		this.events.dispose();
		this.panel.dispose();
		if ( this.jetty ) this.jetty.dispose();
		this.jetty = null;

	}

}

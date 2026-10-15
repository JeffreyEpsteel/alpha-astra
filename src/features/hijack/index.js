// Hijack feature (wave 15C, the user: "NPC ships / airplanes / all types of transport hijackable"). Every vessel afloat can be
// taken and sailed as your own:
//   at sea     a ship you crippled strikes (boarding, any faction); after the deck fight the surrender's third choice "Take the
//              ship" calls takeShip(): she becomes your boat (app.setBoat with the hull of her class, Rules.hullFor: the trawler,
//              sloop and brigantine are player hulls already), keeps her name and her damage (patched to HIJACK.minHull), her
//              cargo goes into your hold, and the boat you came in stays moored where it lies (this.left: E beside it takes her
//              back; the harbour agents can send for her: recover( id, { dock } ))
//   moored     a ship lying at a mooring or an anchorage ('moored' / 'dock': Blackwater's cove, the den moorings, the merchants
//              at the lane ends, the trawler this feature moors in Tidemark's bay) can be climbed aboard from the water (Player's
//              climb, wave 15D: canTake( ship ) / onClimb( ship )). The watch is rolled then (Rules.watchChance: night or day,
//              notoriety, Blackwater); E at the helm casts off: she is yours, or the watch wakes (the alarm: standing, a bounty,
//              Blackwater's bell, and the crew fight you on deck through boarding.board( ship, { sneak: true } ))
//   planes     the mail Petrel calls at Tidemark's bay (8-12 h) and the home harbour (15-18.30 h); her pilot walks to the tavern
//              while she lies there. E at her door while he is away: she is yours (seaplane fleet entry { stolen: true },
//              sp.takeOut( 'petrel', { at } ), aboard), a bounty and the port's standing; the mail service sends another later
//   skiffs     every port keeps a resident's skiff or canoe at its jetty: E takes it at once, for a small loss of standing
// A stolen vessel is wanted (this.vessel.wanted): her faction hunts her (merchants send the navy, the navy its own, pirates their
// avengers: pirates.retaliation.hunt, with the horizon warning), the guards of her home port know her (an offence at customs,
// standing, a bounty), the yard repaints her for a fee (repaint(): clean HIJACK.repaint.hours later) and Blackwater's fence buys
// her (stolenQuote() / sellStolen(): the stronghold market's 'sellship' row).
//
//   features.add( 'hijack', hijack );     // after naval, boarding, pirates, stronghold, seaplane, trade, customs
//   const hj = features.get( 'hijack' );
//   hj.canTake( ship ) -> bool             hj.onClimb( ship ) -> { ok, how: 'sneak' | 'board', chance? }   hj.castOff()
//   hj.takeOffer( ship ) -> { ok, sub }    hj.takeShip( ship, { how, goods, captain } ) -> { ok, hull, left, goods }
//   hj.vessel   { hull, name, kind, faction, port, at, stolen, wanted, repaintAt, laundered } | null   (the boat you sail now)
//   hj.left     [ { id, boat, name, x, z, heading, hp, at, vessel } ]   hj.recover( id, { dock } ) -> bool
//   hj.repaint( { free } ) -> { ok, price, reason }   hj.yardRow() -> row | null   hj.stolenQuote() / hj.sellStolen()
//   hj.mail { port, at, until }   hj.stealPlane()   hj.skiffs   hj.takeSkiff( id )   hj.bounty   hj.view()
//   hj.update( dt ) / toJSON() / fromJSON( d ) / reset() / dispose()
// Events: vesselTaken { id, class, by, hull, name, faction, how, x, z, port } (also a world event: the host removes the AI ship,
// the others see your new hull through the hull sync), hijackAlarm { id, name, port }, stolenSpotted { port, name },
// vesselLaundered { name, hull }, stolenSold { hull, name, price }, boatRecovered { boat, by }.
// Headless: install( app, features, { rand, seed, models: false, naval, boarding, pirates, seaplane, trade, customs, terrain } ).
// Wave 16A: the mail Petrel lies on the water at her stops in the mail livery (HIJACK.mail.liv) with "MAIL" on both sides of her
// fuselage (world/boat/Launch.js sideText on the parked plane's group); a toast when she comes in near you; her pilot is a
// resident (app.residents, or opts.residents) who comes ashore at the dock and walks to the port's tavern and back on the
// schedule (_pilotAway's hours). hj.mail.pilot { phase: 'aboard' | 'tavern' | 'back', resident, dock, tavern }; hj.view().mail
// adds { pilot, livery, lettering, drawn }. opts.drawMail (default: models) draws the plane alone (tests). The boats you left
// are pins on the maps (worldmap.addMarker 'left:<id>', kind 'boat': the minimap gets them through the world map).

import { BOATS } from '../../game/Boats.js';
import { DAY_SPEED } from '../../game/GameMode.js';
import { WORLD } from '../../world/WorldLayout.js';
import { mulberry32 } from '../../util/Noise.js';
import { CALM } from '../naval/Routes.js';
import { MERCHANT_SHIPS } from '../naval/ShipClasses.js';
import { plunderFor, RULES as BOARD_RULES } from '../boarding/BoardingData.js';
import { CAPTAINS } from '../pirates/Roster.js';
import { HIJACK, hullFor, watchChance, repaintFee, fencePrice, nearestPort, skiffSites, mailSpot, mailStop } from './Rules.js';
import { Mesh } from '../../engine/index.js';
import { mergePrepared } from '../../world/boat/GeoKit.js';
import { sideText, launchMaterial } from '../../world/boat/Launch.js';

export { HIJACK, hullFor, watchChance, repaintFee, fencePrice, nearestPort, skiffSites, mailSpot, mailStop } from './Rules.js';

const SAVE_VERSION = 1;
const ABOARD = [ 'boat', 'deck', 'seat' ];
const ON_FOOT = [ 'walk', 'swim' ];
const MOORED = new Set( [ 'moored', 'dock' ] );
const MAX_LEFT = 6;
const FAR = { x: 1e9, y: - 1e4, z: 1e9 };
const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );
const r2 = ( v ) => Math.round( v * 100 ) / 100;
const str = ( v, n = 60 ) => ( typeof v === 'string' ? v.slice( 0, n ) : '' );

// "MAIL" on the Petrel (model frame: +Z the nose, +X her left side): white letters on the flat of her fuselage between the trim
// stripe and the cabin, aft of the wing (half width there measured on Petrel.glb: 0.45 m at z -2.76, 0.65 m at z -1.2)
const PETREL_SIDE = ( z ) => 0.45 + ( z + 2.76 ) * 0.128;
let MAIL_GEO = null;
export function mailLettering() {

	if ( MAIL_GEO ) return MAIL_GEO;
	const parts = [ 1, - 1 ].map( ( side ) => sideText( HIJACK.mail.lettering || 'MAIL', { side, zFore: - 1.05, yBase: 2.08, height: 0.4, halfWidth: PETREL_SIDE } ) ).filter( Boolean );
	MAIL_GEO = parts.length ? mergePrepared( parts ) : null;
	return MAIL_GEO;

}

const hhmm = ( h ) => { const t = ( ( h % 24 ) + 24 ) % 24, H = Math.floor( t ), M = Math.round( ( t - H ) * 60 ) % 60; return `${ H }:${ String( M ).padStart( 2, '0' ) }`; };

export class Hijack {

	constructor( app, features, opts = {} ) {

		this.app = app || {};
		this.features = features || null;
		this.opts = opts;
		this.rng = opts.rand || mulberry32( opts.seed !== undefined ? opts.seed : ( Date.now() & 0xffffff ) );
		this.drawModels = opts.models !== false && !! ( this.app.scene && this.app.scene.add );
		this.drawMail = opts.drawMail ?? this.drawModels;
		this.hours = 8;
		this._lastTod = null;
		this.vessel = null;
		this.left = [];
		this.skiffs = skiffSites( this.terrain ).map( ( s ) => ( { ...s, takenUntil: - 1, view: null } ) );
		this.mail = { port: null, at: null, stop: null, until: - 1, view: null, letters: null, pilot: null, livery: HIJACK.mail.liv, lettering: HIJACK.mail.lettering };
		this._marks = new Set(); // the left boats' pins on the maps
		this._markT = 0;
		this.harbour = { ship: null, until: - 1 }; // the merchant this feature moors in Tidemark's bay
		this.sneak = null; // { ship, alarm, chance }
		this.bounty = 0;
		this.stats = { taken: 0, sneaked: 0, alarms: 0, planes: 0, skiffs: 0, sold: 0, laundered: 0, recovered: 0 };
		this._huntT = HIJACK.hunt.every;
		this._nextLeft = 1;
		this._offs = [];
		this._removers = [];

		const f = this.features;
		if ( f && f.on ) this._offs.push( f.on( 'remoteWorldEvent', ( e ) => this._onRemote( e || {} ) ) );
		if ( f && f.interactable ) this._registerInteractables();

	}

	// ------------------------------------------------------------------ collaborators

	_get( name ) {

		return this.opts[ name ] || ( this.features && this.features.get ? this.features.get( name ) : null );

	}

	get naval() { return this._get( 'naval' ); }
	get boarding() { return this._get( 'boarding' ); }
	get pirates() { return this._get( 'pirates' ); }
	get seaplane() { return this._get( 'seaplane' ); }
	get trade() { return this._get( 'trade' ); }
	get customs() { return this._get( 'customs' ); }
	get stronghold() { return this._get( 'stronghold' ); }
	get terrain() { return this.opts.terrain || this.app.terrainData || null; }
	get residents() { return this.opts.residents !== undefined ? this.opts.residents : this.app.residents || null; }
	get state() { return this.features ? this.features.state : null; }
	get sandbox() { return !! ( this.features && this.features.sandbox ); }

	get night() {

		const h = this.app.settings ? this.app.settings.timeOfDay : null;
		return typeof h === 'number' && ( h >= 20 || h < 5.5 );

	}

	_hour() {

		const h = this.app.settings ? this.app.settings.timeOfDay : null;
		return typeof h === 'number' ? ( ( h % 24 ) + 24 ) % 24 : this.hours % 24;

	}

	_mode() {

		const p = this.app.player;
		return p ? p.mode : null;

	}

	playerPos() {

		const m = this._mode(), b = this.app.boatCtl, p = this.app.player;
		if ( ABOARD.includes( m ) && b && b.position ) return b.position;
		return p && p.position ? p.position : null;

	}

	_toast( text, ms = 3200 ) {

		const g = this.app.game;
		if ( g && g.toast ) g.toast( text, ms );

	}

	_emit( name, payload ) {

		if ( this.features && this.features.emit ) this.features.emit( name, payload );

	}

	_share( kind, data ) {

		const ns = this.app.netsync;
		if ( ns && ns.sendWorldEvent ) try { ns.sendWorldEvent( kind, data ); } catch ( e ) { /* offline */ }

	}

	_by() {

		const ns = this.app.netsync;
		return ( ns && ( ns.id || ns.sessionId ) ) || 'player';

	}

	_portName( id ) {

		const p = ( WORLD.ports || [] ).find( ( q ) => q.id === id );
		return p ? p.name : String( id || '' );

	}

	// ------------------------------------------------------------------ the clock (in-game hours, as the pirates feature keeps it)

	_syncClock( dt ) {

		const s = this.app.settings;
		let dh;
		if ( s && Number.isFinite( s.timeOfDay ) ) {

			const expected = Math.max( 0, dt ) * ( Number.isFinite( s.timeSpeed ) ? s.timeSpeed : DAY_SPEED );
			if ( this._lastTod === null ) dh = 0;
			else {

				dh = ( s.timeOfDay - this._lastTod + 24 ) % 24;
				if ( dh > expected * 3 + 0.05 ) dh = Math.min( dh, expected );

			}

			this._lastTod = s.timeOfDay;

		} else dh = Math.max( 0, dt ) * DAY_SPEED;
		this.advance( dh );

	}

	advance( hours ) {

		if ( ! ( hours > 0 ) ) return;
		this.hours += hours;
		this.bounty = Math.max( 0, Math.round( this.bounty * Math.pow( 0.85, hours / 24 ) ) ); // a bounty cools by the day

	}

	// ------------------------------------------------------------------ what can be taken

	// a ship the player may climb aboard and take: afloat, of a class with a player hull, struck (the boarding prize) or lying
	// at a mooring / an anchorage
	canTake( ship ) {

		if ( ! ship || ! ship.alive || ship.taken || ! hullFor( ship.kind ) ) return false;
		if ( ship.state === 'adrift' && ship.hpFraction < ( BOARD_RULES.cripple ?? 0.25 ) ) return true;
		return MOORED.has( ship.state );

	}

	// the player climbed onto her deck from the water (wave 15D's climb): a struck ship's crew fight (boarding), a moored ship's
	// watch is rolled now and told when he casts off at the helm
	onClimb( ship ) {

		if ( ! this.canTake( ship ) ) return { ok: false, reason: 'not takeable' };
		if ( ship.state === 'adrift' ) {

			const bo = this.boarding;
			return bo && bo.board && bo.board( ship, { sneak: true } ) ? { ok: true, how: 'board' } : { ok: false, reason: 'no boarding' };

		}

		if ( this.sneak && this.sneak.ship === ship ) return { ok: true, how: 'sneak', chance: this.sneak.chance };
		const pr = this.pirates, bw = WORLD.blackwater;
		const blackwater = ship.stronghold !== undefined || !! ( bw && Math.hypot( ship.x - bw.center.x, ship.z - bw.center.z ) < bw.radius + 250 );
		const chance = watchChance( { night: this.night, level: pr && pr.notorietyLevel ? pr.notorietyLevel() : 0, blackwater } );
		this.sneak = { ship, alarm: this.rng() < chance, chance };
		this._toast( this.night ? `Aboard the ${ ship.name } · her crew sleeps · E at the helm casts off` : `Aboard the ${ ship.name } · the watch is about · E at the helm casts off`, 3600 );
		return { ok: true, how: 'sneak', chance };

	}

	_helmPoint() {

		const s = this.sneak && this.sneak.ship;
		if ( ! s || ! s.alive ) return FAR;
		const c = s.cls || { deck: 2, length: 14 };
		if ( typeof s.toWorld === 'function' ) return s.toWorld( 0, c.deck + 0.9, - c.length * 0.3, {} );
		const k = - c.length * 0.3;
		return { x: s.x + Math.sin( s.yaw ) * k, y: c.deck + 0.9, z: s.z + Math.cos( s.yaw ) * k };

	}

	// E at the helm of the ship you sneaked aboard: she is yours, or the watch wakes
	castOff() {

		const sn = this.sneak;
		if ( ! sn ) return { ok: false, reason: 'none' };
		this.sneak = null;
		const s = sn.ship;
		if ( ! s.alive || s.taken ) return { ok: false, reason: 'gone' };
		if ( sn.alarm ) return this._alarm( s );
		this.stats.sneaked ++;
		const r = this.takeShip( s, { how: 'sneaked' } );
		if ( r.ok ) this._toast( `You cast off the ${ s.name } · nobody stirred`, 3600 );
		return r;

	}

	// the watch woke: standing and a bounty at her port, Blackwater's bell, and her crew turn out on deck
	_alarm( s ) {

		this.stats.alarms ++;
		const port = s.stronghold !== undefined ? null : nearestPort( s.x, s.z );
		this._toast( `The watch wakes aboard the ${ s.name }: her crew turn out`, 3600 );
		this._standing( HIJACK.alarm.merchant, 'alarm' );
		this._addBounty( HIJACK.alarm.bounty );
		if ( port ) this._offence( port.id );
		const sh = this.stronghold;
		if ( s.stronghold !== undefined && sh && sh._hostileAct ) sh._hostileAct( 'ships' );
		this._emit( 'hijackAlarm', { id: s.id, name: s.name, port: port ? port.id : null } );
		const bo = this.boarding;
		if ( bo && bo.board && bo.board( s, { sneak: true } ) ) return { ok: false, alarm: true, fight: true };
		// nobody to fight: thrown over the side
		const p = this.app.player;
		if ( p && p.position ) {

			p.mode = 'swim';
			p.position.set( s.x + Math.cos( s.yaw ) * ( s.cls.beam * 0.5 + 2 ), 0, s.z - Math.sin( s.yaw ) * ( s.cls.beam * 0.5 + 2 ) );

		}

		return { ok: false, alarm: true, fight: false };

	}

	// boarding's third choice: what "Take the ship" would make of her
	takeOffer( ship ) {

		const hull = ship && hullFor( ship.kind );
		if ( ! hull || ship.taken ) return { ok: false, sub: 'No helm you could sail' };
		const b = BOATS[ hull ], st = this.state, cur = st && st.boat && BOATS[ st.boat ];
		return { ok: true, hull, sub: `She sails as your ${ b.name.toLowerCase() }${ cur ? `; your ${ cur.name.toLowerCase() } stays moored here` : '' }` };

	}

	// ------------------------------------------------------------------ taking a hull

	// the boat you sail now is left moored where she lies (an entry you, or an agent, can recover); null without one
	_leaveBoat() {

		const st = this.state, b = this.app.boatCtl, nv = this.naval;
		const id = st ? st.boat : null;
		if ( ! id || ! BOATS[ id ] || ! b || ! b.position || b.enabled === false ) return null;
		if ( nv && nv.playerHull && nv.playerHull.sunk ) return null; // (a wreck stays naval's)
		const h = nv && nv.playerHull && nv.playerHull.boat === id && nv.playerHull.max > 0 ? nv.playerHull.hp / nv.playerHull.max : 1;
		const v = this.vessel && this.vessel.hull === id ? this.vessel : null;
		const e = {
			id: 'left-' + this._nextLeft ++, boat: id, name: v ? v.name : BOATS[ id ].name, x: r2( b.position.x ), z: r2( b.position.z ),
			heading: r2( b.getYaw ? b.getYaw() : 0 ), hp: r2( clamp( h, 0.05, 1 ) ), at: r2( this.hours ), vessel: v ? { ...v } : null, view: null,
		};
		this.left.push( e );
		while ( this.left.length > MAX_LEFT ) this._dropView( this.left.shift() ); // (the oldest is towed off by the harbour)
		this._drawLeft( e );
		return e;

	}

	// put hull `id` under the player at `dock` (the swap App.setBoat does), with `frac` of her hull points
	_sail( id, dock, frac = 1, { helm = true } = {} ) {

		const st = this.state, app = this.app, p = app.player;
		if ( st ) st.boat = id;
		if ( typeof app.setBoat === 'function' ) app.setBoat( id, { dock } );
		const nv = this.naval;
		if ( nv && nv.playerHull ) {

			if ( typeof nv._syncBoat === 'function' ) nv._syncBoat();
			if ( nv.playerHull.boat === id ) nv.playerHull.hp = Math.max( 1, Math.round( nv.playerHull.max * clamp( frac, 0.05, 1 ) ) );

		}

		if ( helm && p && p.enterBoat ) try { p.enterBoat(); } catch ( e ) { /* the player is placed next frame */ }

	}

	// she is yours: the swap, her cargo, the wanted record and the faction's answer. how: 'boarded' | 'sneaked'
	takeShip( ship, { how = 'boarded', goods = null, captain = null } = {} ) {

		const hull = ship && hullFor( ship.kind );
		if ( ! hull || ship.taken ) return { ok: false, reason: 'hull' };
		const frac = clamp( Number.isFinite( ship.hpFraction ) ? ship.hpFraction : 1, HIJACK.minHull, 1 );
		const left = this._leaveBoat();
		this._sail( hull, { position: { x: ship.x, z: ship.z }, heading: ship.yaw }, frac );
		ship.taken = true;
		ship.state = 'gone'; // (naval removes her; the player's own hull is drawn in her place)
		if ( this.sneak && this.sneak.ship === ship ) this.sneak = null;
		if ( this.harbour.ship === ship ) { this.harbour.ship = null; this.harbour.until = this.hours + HIJACK.moored.restock; }
		// her cargo comes with her
		const cargo = Array.isArray( goods ) ? goods : ship.cls && ship.cls.loot ? plunderFor( ship.cls, this.rng ).goods : [];
		const tr = this.trade;
		let stowed = 0;
		if ( tr && tr.addCargo ) for ( const g of cargo ) stowed += tr.addCargo( g.good, g.qty, { paid: 0 } ) || 0;
		const faction = ship.faction === 'navy' ? 'navy' : ship.faction === 'pirate' ? 'pirate' : 'merchant';
		const port = faction === 'pirate' ? null : nearestPort( ship.x, ship.z );
		this.vessel = { hull, name: ship.name, kind: ship.kind, faction, port: port ? port.id : null, at: r2( this.hours ), stolen: true, wanted: ! this.sandbox, repaintAt: null, laundered: false, seen: false };
		this.stats.taken ++;
		this._consequences( faction, port ? port.id : null );
		const sh = this.stronghold;
		if ( ship.stronghold !== undefined && sh && sh.shipTaken ) sh.shipTaken( ship.stronghold );
		const ev = { id: ship.id, class: ship.kind, by: 'player', hull, name: ship.name, faction, how, x: r2( ship.x ), z: r2( ship.z ), port: port ? port.id : null, captain, stowed };
		this._emit( 'vesselTaken', ev );
		this._share( 'vesselTaken', { id: ship.id, class: ship.kind, by: this._by(), hull, name: ship.name, stronghold: ship.stronghold ?? null } );
		this._toast( `The ${ ship.name } is yours${ left ? ` · your ${ left.name.toLowerCase() } lies moored where you left her` : '' }${ stowed ? ` · ${ stowed } crate${ stowed > 1 ? 's' : '' } in her hold` : '' }`, 4600 );
		return { ok: true, hull, left, goods: cargo, stowed };

	}

	// ------------------------------------------------------------------ wanted

	_standing( n, why ) {

		const cr = this.trade && this.trade.credit;
		if ( n && cr && cr.adjust ) cr.adjust( n, why );

	}

	_addBounty( n ) {

		if ( n > 0 && ! this.sandbox ) this.bounty += n;

	}

	_offence( port ) {

		const c = this.customs;
		if ( port && c && typeof c._offence === 'function' && ! this.sandbox ) try { c._offence( port ); } catch ( e ) { /* customs is optional */ }

	}

	_consequences( kind, port ) {

		const c = HIJACK.cost[ kind ];
		if ( ! c ) return;
		const pr = this.pirates;
		if ( pr && pr._heat && ( c.heat || c.standing ) ) pr._heat( c.heat, c.standing );
		this._standing( c.merchant, 'hijack' );
		this._addBounty( c.bounty );
		if ( port && c.bounty ) this._offence( port );
		this._sendHunter( kind );

	}

	// the faction answers: the navy after a merchant or a navy hull, an avenger after a pirate (none for a resident's skiff or the
	// mail plane: the guards ashore deal with those). Returns the ship sent, or null (queued: she comes when you are at sea).
	_sendHunter( kind ) {

		const pr = this.pirates, R = pr && pr.retaliation;
		if ( ! R || ! R.hunt || this.sandbox ) return null;
		let id = null;
		if ( kind === 'pirate' ) {

			const a = R.avengerFor ? R.avengerFor( null ) : null;
			id = a ? a.id : null;

		} else if ( kind === 'merchant' || kind === 'navy' ) {

			const free = CAPTAINS.filter( ( c ) => c.type === 'patrol' && pr.ledger.isFree( c.id ) && ! pr.roster.shipOf( c.id ) );
			id = free.length ? free[ Math.floor( this.rng() * free.length ) % free.length ].id : null;

		}

		return id ? R.hunt( id, 'stolen' ) : null;

	}

	_wantedUpdate( dt ) {

		const v = this.vessel, st = this.state;
		if ( ! v ) return;
		if ( st && st.boat !== v.hull ) { this.vessel = null; return; } // traded in or lost: the record goes with her
		// the paint takes a day
		if ( v.wanted && v.repaintAt !== null && this.hours - v.repaintAt >= HIJACK.repaint.hours ) {

			v.wanted = false;
			v.laundered = true;
			this.stats.laundered ++;
			this._toast( `The ${ v.name } is clean · new paint, new papers`, 3600 );
			this._emit( 'vesselLaundered', { name: v.name, hull: v.hull } );

		}

		if ( ! v.wanted ) return;
		const pl = this.playerPos(), aboard = ABOARD.includes( this._mode() );
		// the guards of her home port know her
		if ( v.port && pl && aboard ) {

			const P = ( WORLD.ports || [] ).find( ( q ) => q.id === v.port );
			const d = P && P.dock ? Math.hypot( pl.x - P.dock.position.x, pl.z - P.dock.position.z ) : Infinity;
			if ( d < CALM.port && ! v.seen ) {

				v.seen = true;
				this._standing( HIJACK.guards.merchant, 'stolen' );
				this._addBounty( HIJACK.guards.bounty );
				this._offence( v.port );
				this._toast( `The guards at ${ this._portName( v.port ) } know the ${ v.name } · a bounty is posted on you`, 4200 );
				this._emit( 'stolenSpotted', { port: v.port, name: v.name } );

			} else if ( d > CALM.port * 2 ) v.seen = false;

		}

		// her faction keeps hunting her while she is at sea
		const pr = this.pirates;
		if ( aboard && pr && pr.playerAtSea && pr.playerAtSea() ) {

			this._huntT -= dt;
			if ( this._huntT <= 0 ) {

				this._huntT = HIJACK.hunt.every;
				const busy = pr.retaliation && pr.retaliation.active.some( ( s ) => s.alive && s.hunt );
				if ( ! busy && this.rng() < HIJACK.hunt.chance ) this._sendHunter( v.faction );

			}

		}

	}

	// the yard repaints a wanted hull: clean HIJACK.repaint.hours later
	repaint( { free = false } = {} ) {

		const v = this.vessel;
		if ( ! v || ! v.wanted ) return { ok: false, reason: 'clean' };
		if ( v.repaintAt !== null ) return { ok: false, reason: 'drying' };
		const price = free || this.sandbox ? 0 : repaintFee( v.hull );
		const st = this.state;
		if ( price > 0 && ( ! st || ! st.spend || ! st.spend( price ) ) ) return { ok: false, reason: 'money', price };
		v.repaintAt = r2( this.hours );
		this._toast( `The yard repaints the ${ v.name }${ price ? ` · $${ price }` : '' } · she will be clean in a day`, 3600 );
		return { ok: true, price };

	}

	// the yard's row for the repaint (HudPanels: report patch)
	yardRow() {

		const v = this.vessel;
		if ( ! v || ! v.wanted ) return null;
		const price = this.sandbox ? 0 : repaintFee( v.hull );
		const drying = v.repaintAt !== null;
		return {
			id: 'hijack:repaint', label: `Repaint the ${ v.name }`, price,
			note: drying ? 'The paint is drying · clean by tomorrow' : 'She is wanted: new paint and papers, clean in a day', disabled: drying,
		};

	}

	// Blackwater's fence: what he pays for the stolen hull you sail now
	stolenQuote() {

		const v = this.vessel;
		if ( ! v || ! v.stolen ) return null;
		const price = fencePrice( v.hull );
		return price > 0 ? { hull: v.hull, name: v.name, price } : null;

	}

	// sold to the fence: the money, and a skiff thrown in, moored at Blackwater's dock
	sellStolen() {

		const q = this.stolenQuote();
		if ( ! q ) return { ok: false, reason: 'noShip' };
		const p = this.app.player;
		if ( p && ABOARD.includes( p.mode ) && p.exitBoat ) try { p.exitBoat(); } catch ( e ) { /* already ashore */ }
		const st = this.state;
		if ( st && st.earn ) st.earn( q.price );
		this.vessel = null;
		const bw = WORLD.blackwater && WORLD.blackwater.dock;
		this._sail( 'skiff', bw ? { position: bw.position, heading: bw.heading } : null, 1, { helm: false } );
		this.stats.sold ++;
		this._toast( `The fence takes the ${ q.name } · +$${ q.price } · a skiff is yours at the dock`, 4200 );
		this._emit( 'stolenSold', { hull: q.hull, name: q.name, price: q.price } );
		this._share( 'stolenSold', { hull: q.hull, price: q.price } ); // (the host and the others learn the hull is gone)
		return { ok: true, total: q.price, hull: q.hull };

	}

	// ------------------------------------------------------------------ your boats left moored

	_nearestLeft( pos, reach = Infinity ) {

		let best = null, bd = reach;
		for ( const e of this.left ) {

			const d = Math.hypot( e.x - pos.x, e.z - pos.z ) - ( BOATS[ e.boat ] ? BOATS[ e.boat ].length * 0.5 : 2 );
			if ( d < bd ) { bd = d; best = e; }

		}

		return best;

	}

	// back aboard a boat you left: in place (you swam or walked to her), or delivered to a dock (an agent: { dock })
	recover( id, { dock = null } = {} ) {

		const i = this.left.findIndex( ( e ) => e.id === id );
		if ( i < 0 ) return false;
		const e = this.left[ i ];
		this.left.splice( i, 1 );
		this._dropView( e );
		this._leaveBoat(); // the one you sail now stays where she lies
		const at = dock && dock.position ? { position: dock.position, heading: dock.heading } : { position: { x: e.x, z: e.z }, heading: e.heading };
		this._sail( e.boat, at, e.hp, { helm: ! dock } );
		this.vessel = e.vessel ? { ...e.vessel, seen: false } : null;
		this.stats.recovered ++;
		this._toast( dock ? `Your ${ e.name.toLowerCase() } is moored at the dock` : `Back aboard your ${ e.name.toLowerCase() }`, 3200 );
		this._emit( 'boatRecovered', { boat: e.boat, by: dock ? 'agent' : 'player' } );
		return true;

	}

	// ------------------------------------------------------------------ the merchant moored in Tidemark's bay

	_harbourUpdate() {

		const nv = this.naval, T = WORLD.tidemark, H = this.harbour, M = HIJACK.moored;
		if ( ! nv || nv.active === false || ! nv.spawn || ! T || ! T.bay ) return;
		if ( H.ship && ( ! H.ship.alive || ! nv.ships.includes( H.ship ) ) ) H.ship = null;
		const pl = this.playerPos();
		const at = { x: T.bay.x - 45, z: T.bay.z + 35 };
		const d = pl ? Math.hypot( pl.x - at.x, pl.z - at.z ) : Infinity;
		if ( ! H.ship ) {

			if ( this.hours < H.until || d > M.range ) return;
			try {

				const s = nv.spawn( 'trawler', { id: 'hijack-tidemark', x: at.x, z: at.z, yaw: 0.6, state: 'moored', speed: 0, name: MERCHANT_SHIPS[ Math.floor( this.rng() * MERCHANT_SHIPS.length ) % MERCHANT_SHIPS.length ] } );
				s.state = 'moored';
				s.wantSpeed = 0;
				s.harbour = 'tidemark';
				H.ship = s;

			} catch ( e ) { /* naval refused */ }

		} else if ( d > M.drop && H.ship.state === 'moored' ) {

			H.ship.state = 'gone';
			H.ship = null;

		}

	}

	// ------------------------------------------------------------------ the mail plane

	_pilotAway() {

		const s = this.mail.stop;
		if ( ! s ) return false;
		const h = this._hour(), a = HIJACK.mail.ashore;
		return h >= s.from + a && h < s.to - a;

	}

	_mailUpdate() {

		const m = this.mail;
		const stop = this.hours >= m.until ? mailStop( this._hour() ) : null;
		if ( ! stop ) {

			if ( m.at ) this._mailGone();
			return;

		}

		if ( m.port !== stop.port || ! m.at ) this._mailArrive( stop );
		if ( m.at ) this._pilotUpdate();

	}

	// she lands at a stop: on the water in her livery with MAIL on her sides, her pilot at the dock, a toast if you are near
	_mailArrive( stop ) {

		const m = this.mail;
		this._mailGone();
		const at = mailSpot( stop.port, this.terrain );
		if ( ! at ) return;
		m.port = stop.port;
		m.stop = stop;
		m.at = at;
		const sp = this.seaplane;
		if ( this.drawMail && sp && sp.parkedVisual && ( sp.models || this.opts.drawMail ) ) {

			try {

				m.view = sp.parkedVisual( HIJACK.mail.af, HIJACK.mail.liv );
				m.view.place( at.x, 0, at.z, at.heading );
				const host = m.view.visual && m.view.visual.group;
				const geo = host ? mailLettering() : null;
				if ( geo ) {

					m.letters = new Mesh( geo, launchMaterial() );
					m.letters.name = 'mail-lettering';
					m.letters.castShadow = false;
					m.letters.receiveShadow = true;
					host.add( m.letters );

				}

			} catch ( e ) { m.view = null; }

		}

		this._pilotOut( stop );
		const pl = this.playerPos(), h = this._hour();
		if ( pl && Math.hypot( pl.x - at.x, pl.z - at.z ) < HIJACK.mail.notice && h - stop.from < HIJACK.mail.fresh ) {

			this._toast( `The mail Petrel is in at ${ this._portName( stop.port ) } · her pilot ashore until ${ hhmm( stop.to - HIJACK.mail.ashore ) }`, 3600 );

		}

	}

	_mailGone() {

		const m = this.mail;
		if ( m.letters && m.letters.parent ) m.letters.parent.remove( m.letters );
		m.letters = null;
		if ( m.view && m.view.dispose ) m.view.dispose();
		m.view = null;
		m.at = null;
		m.port = null;
		m.stop = null;
		this._pilotGone();

	}

	// ---- her pilot: a resident while she lies at a stop (the dock is his spot; the tavern his task while he is ashore)

	_pilotOut( stop ) {

		const m = this.mail, P = ( WORLD.ports || [] ).find( ( q ) => q.id === stop.port );
		if ( ! P || ! P.dock || ! P.dock.position ) return;
		const dock = this._landing( P ), tavern = this._tavernOf( P );
		m.pilot = { phase: 'aboard', resident: null, dock, tavern };
		const R = this.residents, D = HIJACK.mail.pilot;
		if ( R && R.add ) {

			try {

				m.pilot.resident = R.add( { id: D.id, name: D.name, character: D.character, role: 'mail', spot: { x: dock.x, z: dock.z, yaw: dock.yaw, deck: true }, lines: D.lines.slice() } );

			} catch ( e ) { m.pilot.resident = null; }

		}

	}

	_pilotUpdate() {

		const m = this.mail, p = m.pilot, s = m.stop;
		if ( ! p || ! s ) return;
		const away = this._pilotAway();
		const phase = away ? 'tavern' : this._hour() < s.from + HIJACK.mail.ashore ? 'aboard' : 'back';
		if ( phase === p.phase ) return;
		p.phase = phase;
		const r = p.resident;
		if ( ! r || ! r.setTask ) return;
		// to the tavern (indoors once there), then back to the dock (his own spot)
		if ( phase === 'tavern' && p.tavern ) r.setTask( { id: 'mail-tavern', x: p.tavern.x, z: p.tavern.z, indoors: true } );
		else r.setTask( null );

	}

	_pilotGone() {

		const m = this.mail, p = m.pilot;
		m.pilot = null;
		const R = this.residents;
		if ( p && p.resident && R && R.remove ) try { R.remove( HIJACK.mail.pilot.id ); } catch ( e ) { /* gone */ }

	}

	// a walkable spot by a port's dock (the jetty deck, the quay, the beach), else its stand
	_landing( P ) {

		const t = this.terrain, col = this.app.colliders, d = P.dock.position;
		for ( const r of [ 2, 4, 6, 9, 12, 16, 22, 30 ] ) for ( let i = 0; i < 16; i ++ ) {

			const a = i / 16 * Math.PI * 2, x = d.x + Math.sin( a ) * r, z = d.z + Math.cos( a ) * r;
			const g = Math.max( t && t.heightAt ? t.heightAt( x, z ) : - Infinity, col && col.groundHeightAt ? col.groundHeightAt( x, z, 6 ) : - Infinity );
			if ( g > 0.25 && g < 5 ) return { x, z, yaw: Math.atan2( d.x - x, d.z - z ) + Math.PI };

		}

		const st = P.stand || d;
		return { x: st.x, z: st.z, yaw: st.yaw ?? 0 };

	}

	// the port's tavern (the harbour feature's sites), else its stand
	_tavernOf( P ) {

		const hb = this._get( 'harbour' );
		const site = hb && hb.sites && Array.isArray( hb.sites.tavern ) ? hb.sites.tavern.find( ( q ) => q.port === P.id ) : null;
		if ( site && Number.isFinite( site.x ) ) return { x: site.x, z: site.z };
		return P.stand && Number.isFinite( P.stand.x ) ? { x: P.stand.x, z: P.stand.z } : null;

	}

	_mailDoor() {

		const m = this.mail;
		if ( ! m.at ) return FAR;
		const c = Math.cos( m.at.heading ), s = Math.sin( m.at.heading );
		return { x: m.at.x + 1.6 * c, y: 0.4, z: m.at.z - 1.6 * s };

	}

	// E at the mail Petrel's door while her pilot is ashore: she is yours (a stolen entry of the seaplane fleet)
	stealPlane() {

		const m = this.mail, af = HIJACK.mail.af;
		if ( ! m.at ) this._mailUpdate(); // (the clock may have moved since the last scan)
		if ( ! m.at ) return { ok: false, reason: 'none' };
		if ( ! this._pilotAway() ) {

			this._toast( 'The mail pilot is aboard', 2400 );
			return { ok: false, reason: 'pilot' };

		}

		const sp = this.seaplane;
		if ( ! sp || ! sp.fleet ) return { ok: false, reason: 'noSeaplane' };
		if ( sp.piloted ) return { ok: false, reason: 'flying' };
		if ( sp.owns && sp.owns( af ) ) {

			this._toast( 'You keep a Petrel already · the hangar would know her twin', 3000 );
			return { ok: false, reason: 'owned' };

		}

		const had = sp.fleet[ af ];
		sp.fleet[ af ] = { owned: true, stolen: true, hp: 100, fuel: 0.6, upgrades: { livery: HIJACK.mail.liv }, cargo: [] };
		const at = { x: m.at.x, z: m.at.z, heading: m.at.heading, water: true };
		const r = sp.takeOut ? sp.takeOut( af, { at } ) : { ok: true };
		if ( ! r || ! r.ok ) {

			if ( had ) sp.fleet[ af ] = had; else delete sp.fleet[ af ];
			return { ok: false, reason: 'takeOut', text: r && r.text };

		}

		if ( sp.board ) try { sp.board(); } catch ( e ) { /* the player boards with E */ }
		const port = m.port;
		m.until = this.hours + HIJACK.mail.restock;
		this._mailGone();
		this.stats.planes ++;
		this._consequences( 'mail', port );
		this._toast( `The mail Petrel is yours · a bounty is posted at ${ this._portName( port ) }`, 4200 );
		const ev = { id: 'mail-petrel', class: af, by: 'player', hull: null, airframe: af, name: 'the mail Petrel', faction: 'mail', how: 'stolen', x: r2( at.x ), z: r2( at.z ), port };
		this._emit( 'vesselTaken', ev );
		this._share( 'vesselTaken', { id: 'mail-petrel', class: af, by: this._by(), airframe: af } );
		return { ok: true, af, port };

	}

	// ------------------------------------------------------------------ the residents' skiffs

	_skiffFree( k ) {

		return this.hours >= k.takenUntil;

	}

	_nearestSkiff( pos, reach = Infinity ) {

		let best = null, bd = reach;
		for ( const k of this.skiffs ) {

			if ( ! this._skiffFree( k ) ) continue;
			const d = Math.hypot( k.x - pos.x, k.z - pos.z );
			if ( d < bd ) { bd = d; best = k; }

		}

		return best;

	}

	// a resident's skiff or canoe off a jetty: yours at once, for a little standing at that port
	takeSkiff( id ) {

		const k = this.skiffs.find( ( q ) => q.id === id );
		if ( ! k || ! this._skiffFree( k ) || ! BOATS[ k.kind ] ) return { ok: false, reason: 'none' };
		const left = this._leaveBoat();
		this._sail( k.kind, { position: { x: k.x, z: k.z }, heading: k.heading }, 1 );
		k.takenUntil = this.hours + HIJACK.skiff.restock;
		this._dropView( k );
		const name = `${ this._portName( k.port ) } ${ BOATS[ k.kind ].name.toLowerCase() }`;
		this.vessel = { hull: k.kind, name, kind: k.kind, faction: 'resident', port: k.port, at: r2( this.hours ), stolen: true, wanted: ! this.sandbox, repaintAt: null, laundered: false, seen: true };
		this.stats.skiffs ++;
		this._consequences( 'resident', k.port );
		this._toast( `You take the ${ name }${ left ? ` · your ${ left.name.toLowerCase() } stays moored` : '' }`, 3600 );
		this._emit( 'vesselTaken', { id: k.id, class: k.kind, by: 'player', hull: k.kind, name, faction: 'resident', how: 'skiff', x: r2( k.x ), z: r2( k.z ), port: k.port } );
		this._share( 'vesselTaken', { id: k.id, class: k.kind, by: this._by(), hull: k.kind } );
		return { ok: true, hull: k.kind, left };

	}

	// ------------------------------------------------------------------ models (lazy: the boat factory loads with the first one)

	_model( kind, x, z, heading, holder ) {

		if ( ! this.drawModels ) return;
		const scene = this.app.scene;
		holder.view = { model: null, dead: false };
		const v = holder.view;
		import( '../../world/boat/BoatFactory.js' ).then( ( { createBoatModel } ) => {

			if ( v.dead ) return;
			const m = createBoatModel( kind );
			m.group.position.set( x, 0, z );
			m.group.rotation.y = heading;
			if ( m.setNavLights ) m.setNavLights( false );
			scene.add( m.group );
			v.model = m;

		} ).catch( () => {} );

	}

	_drawLeft( e ) {

		this._model( e.boat, e.x, e.z, e.heading, e );

	}

	_dropView( h ) {

		const v = h && h.view;
		if ( ! v ) return;
		h.view = null;
		v.dead = true;
		if ( v.model ) {

			if ( this.app.scene && this.app.scene.remove ) this.app.scene.remove( v.model.group );
			if ( v.model.dispose ) v.model.dispose();

		}

	}

	_skiffViews() {

		if ( ! this.drawModels ) return;
		const pl = this.playerPos();
		for ( const k of this.skiffs ) {

			const want = this._skiffFree( k ) && pl && Math.hypot( pl.x - k.x, pl.z - k.z ) < HIJACK.skiff.view;
			if ( want && ! k.view ) this._model( k.kind, k.x, k.z, k.heading, k );
			else if ( ! want && k.view ) this._dropView( k );

		}

	}

	// ------------------------------------------------------------------ E prompts

	_registerInteractables() {

		const f = this.features, foot = () => ON_FOOT.includes( this._mode() );
		const pos = () => ( this.app.player && this.app.player.position ) || FAR;
		this._removers.push( f.interactable( {
			id: 'hijack-helm', radius: HIJACK.helmReach, position: () => this._helmPoint(),
			when: () => !! this.sneak && this._mode() === 'walk', prompt: () => this.sneak ? `Cast off the ${ this.sneak.ship.name }` : null,
			onInteract: () => { this.castOff(); },
		} ) );
		this._removers.push( f.interactable( {
			id: 'hijack-left', radius: 4,
			position: () => {

				const e = this._nearestLeft( pos(), 12 );
				return e ? { x: e.x, y: 0.5, z: e.z } : FAR;

			},
			when: () => foot() && !! this._nearestLeft( pos(), 12 ),
			prompt: () => {

				const e = this._nearestLeft( pos(), 12 );
				return e ? `Take back your ${ e.name.toLowerCase() }` : null;

			},
			onInteract: () => {

				const e = this._nearestLeft( pos(), 12 );
				if ( e ) this.recover( e.id );

			},
		} ) );
		this._removers.push( f.interactable( {
			id: 'hijack-skiff', radius: HIJACK.skiff.reach,
			position: () => {

				const k = this._nearestSkiff( pos(), 10 );
				return k ? { x: k.x, y: 0.4, z: k.z } : FAR;

			},
			when: () => foot() && !! this._nearestSkiff( pos(), 10 ),
			prompt: () => {

				const k = this._nearestSkiff( pos(), 10 );
				return k ? `Take the resident's ${ BOATS[ k.kind ].name.toLowerCase() }` : null;

			},
			onInteract: () => {

				const k = this._nearestSkiff( pos(), 10 );
				if ( k ) this.takeSkiff( k.id );

			},
		} ) );
		this._removers.push( f.interactable( {
			id: 'hijack-mail', radius: HIJACK.mail.reach, position: () => this._mailDoor(),
			when: () => !! this.mail.at && foot(),
			prompt: () => ( this._pilotAway() ? 'Take the mail Petrel (her pilot is at the tavern)' : 'The mail Petrel · her pilot is aboard' ),
			onInteract: () => { this.stealPlane(); },
		} ) );

	}

	// ------------------------------------------------------------------ multiplayer

	// another crew took a vessel: the host's AI ship goes (the others' puppets follow), a skiff or the mail plane is gone here too
	_onRemote( e ) {

		if ( e.kind !== 'vesselTaken' ) return;
		const d = e.data || {}, id = typeof d.id === 'string' ? d.id : '';
		if ( ! id ) return;
		const nv = this.naval;
		const s = nv && nv.ships ? nv.ships.find( ( q ) => q.id === id && q.alive ) : null;
		if ( s ) {

			s.taken = true;
			s.state = 'gone';
			const sh = this.stronghold;
			if ( s.stronghold !== undefined && sh && sh.shipTaken ) sh.shipTaken( s.stronghold, { remote: true } );

		}

		const k = this.skiffs.find( ( q ) => q.id === id );
		if ( k ) { k.takenUntil = this.hours + HIJACK.skiff.restock; this._dropView( k ); }
		if ( id === 'mail-petrel' ) { this.mail.until = this.hours + HIJACK.mail.restock; this._mailGone(); }

	}

	// ------------------------------------------------------------------ frame

	update( dt ) {

		if ( ! ( dt > 0 ) ) return;
		dt = Math.min( dt, 0.1 );
		this._syncClock( dt );
		if ( this.app.paused ) return;
		const sn = this.sneak;
		if ( sn ) {

			const p = this.app.player;
			const far = p && p.position ? Math.hypot( p.position.x - sn.ship.x, p.position.z - sn.ship.z ) > HIJACK.leaveReach : false;
			if ( ! sn.ship.alive || sn.ship.taken || far || ! MOORED.has( sn.ship.state ) ) this.sneak = null;

		}

		this._wantedUpdate( dt );
		this._harbourUpdate();
		// the left boats' pins: once a second (wave 16A; before the scan throttle, which returns early)
		this._markT -= dt;
		if ( this._markT <= 0 ) {

			this._markT = 1;
			this._leftMarks();

		}

		// (a stop just begun lands her at once: the mail plane is not left for the next scan)
		if ( ! this.mail.at && this.hours >= this.mail.until && mailStop( this._hour() ) ) this._mailUpdate();
		// wave 16C: the scans (the mail plane's stop, every skiff's distance) 4 times a second
		this._scanT = ( this._scanT || 0 ) - dt;
		if ( this._scanT > 0 ) return;
		this._scanT = 0.25;
		this._mailUpdate();
		this._skiffViews();

	}

	// the boats you left: a pin each on the maps (the world map forwards them to the minimap)
	_leftMarks() {

		const wm = this._get( 'worldmap' );
		if ( ! wm || ! wm.addMarker ) return;
		const want = new Set();
		for ( const e of this.left ) {

			const id = 'left:' + e.id;
			want.add( id );
			const key = `${ id }|${ e.x }|${ e.z }|${ e.name }`;
			if ( this._marks.has( key ) ) continue;
			for ( const k of [ ...this._marks ] ) if ( k.startsWith( id + '|' ) ) this._marks.delete( k );
			wm.addMarker( { id, kind: 'boat', icon: 'boat', x: e.x, z: e.z, label: `Your ${ ( e.name || 'boat' ).toLowerCase() } (moored)`, mine: true } );
			this._marks.add( key );

		}

		for ( const k of [ ...this._marks ] ) {

			const id = k.split( '|' )[ 0 ];
			if ( want.has( id ) ) continue;
			this._marks.delete( k );
			if ( wm.removeMarker ) wm.removeMarker( id );

		}

	}

	view() {

		const v = this.vessel;
		return {
			vessel: v ? { name: v.name, hull: v.hull, wanted: v.wanted, laundered: v.laundered, drying: v.repaintAt !== null } : null,
			bounty: this.bounty, left: this.left.map( ( e ) => ( { id: e.id, boat: e.boat, name: e.name, x: Math.round( e.x ), z: Math.round( e.z ) } ) ),
			mail: this.mail.at ? {
				port: this.mail.port, pilotAway: this._pilotAway(), pilot: this.mail.pilot ? this.mail.pilot.phase : null,
				livery: this.mail.livery, lettering: this.mail.lettering, drawn: !! this.mail.view, letters: !! this.mail.letters,
			} : null,
			sneaking: this.sneak ? this.sneak.ship.name : null,
		};

	}

	// ------------------------------------------------------------------ save

	toJSON() {

		const v = this.vessel;
		const skiffs = {};
		for ( const k of this.skiffs ) if ( k.takenUntil > this.hours ) skiffs[ k.id ] = r2( k.takenUntil );
		return {
			v: SAVE_VERSION, hours: r2( this.hours ), bounty: Math.round( this.bounty ),
			vessel: v ? { hull: v.hull, name: v.name, kind: v.kind, faction: v.faction, port: v.port, at: v.at, stolen: v.stolen, wanted: v.wanted, repaintAt: v.repaintAt, laundered: v.laundered } : null,
			left: this.left.map( ( e ) => ( { id: e.id, boat: e.boat, name: e.name, x: e.x, z: e.z, heading: e.heading, hp: e.hp, at: e.at, vessel: e.vessel ? { ...e.vessel, seen: undefined } : null } ) ),
			skiffs, mail: r2( this.mail.until ), harbour: r2( this.harbour.until ), next: this._nextLeft, stats: { ...this.stats },
		};

	}

	_vesselFrom( d ) {

		if ( ! d || typeof d !== 'object' || ! BOATS[ d.hull ] ) return null;
		const num = ( x, def = null ) => ( Number.isFinite( x ) ? x : def );
		return {
			hull: d.hull, name: str( d.name ) || BOATS[ d.hull ].name, kind: str( d.kind, 20 ), faction: str( d.faction, 12 ) || 'merchant',
			port: typeof d.port === 'string' ? d.port.slice( 0, 20 ) : null, at: num( d.at, 0 ), stolen: d.stolen !== false, wanted: !! d.wanted,
			repaintAt: num( d.repaintAt ), laundered: !! d.laundered, seen: false,
		};

	}

	fromJSON( d ) {

		if ( ! d || typeof d !== 'object' ) return;
		this.reset();
		if ( Number.isFinite( d.hours ) && d.hours >= 0 ) this.hours = d.hours;
		if ( Number.isFinite( d.bounty ) ) this.bounty = clamp( Math.round( d.bounty ), 0, 1e7 );
		this.vessel = this._vesselFrom( d.vessel );
		const list = Array.isArray( d.left ) ? d.left.slice( - MAX_LEFT ) : [];
		for ( const e of list ) {

			if ( ! e || ! BOATS[ e.boat ] || ! Number.isFinite( e.x ) || ! Number.isFinite( e.z ) ) continue;
			const x = {
				id: str( e.id, 24 ) || 'left-' + this._nextLeft ++, boat: e.boat, name: str( e.name ) || BOATS[ e.boat ].name, x: e.x, z: e.z,
				heading: Number.isFinite( e.heading ) ? e.heading : 0, hp: Number.isFinite( e.hp ) ? clamp( e.hp, 0.05, 1 ) : 1,
				at: Number.isFinite( e.at ) ? e.at : 0, vessel: this._vesselFrom( e.vessel ), view: null,
			};
			this.left.push( x );
			this._drawLeft( x );

		}

		if ( d.skiffs && typeof d.skiffs === 'object' ) for ( const k of this.skiffs ) if ( Number.isFinite( d.skiffs[ k.id ] ) ) k.takenUntil = d.skiffs[ k.id ];
		if ( Number.isFinite( d.mail ) ) this.mail.until = d.mail;
		if ( Number.isFinite( d.harbour ) ) this.harbour.until = d.harbour;
		if ( Number.isFinite( d.next ) ) this._nextLeft = Math.max( this._nextLeft, Math.round( d.next ) );
		if ( d.stats && typeof d.stats === 'object' ) for ( const k of Object.keys( this.stats ) ) if ( Number.isFinite( d.stats[ k ] ) ) this.stats[ k ] = Math.max( 0, d.stats[ k ] );

	}

	reset() {

		for ( const e of this.left ) this._dropView( e );
		this.left.length = 0;
		for ( const k of this.skiffs ) { k.takenUntil = - 1; this._dropView( k ); }
		this._mailGone();
		this.mail.until = - 1;
		this._markT = 0;
		if ( this.harbour.ship && this.harbour.ship.alive && this.harbour.ship.state === 'moored' ) this.harbour.ship.state = 'gone';
		this.harbour = { ship: null, until: - 1 };
		this.vessel = null;
		this.sneak = null;
		this.bounty = 0;
		this.hours = 8;
		this._huntT = HIJACK.hunt.every;
		this._nextLeft = 1;
		for ( const k of Object.keys( this.stats ) ) this.stats[ k ] = 0;

	}

	dispose() {

		for ( const off of this._offs ) off();
		this._offs.length = 0;
		for ( const rm of this._removers ) rm();
		this._removers.length = 0;
		for ( const e of this.left ) this._dropView( e );
		for ( const k of this.skiffs ) this._dropView( k );
		this._mailGone();
		const wm = this._get( 'worldmap' );
		if ( wm && wm.removeMarker ) for ( const k of this._marks ) wm.removeMarker( k.split( '|' )[ 0 ] );
		this._marks.clear();

	}

}

export function install( app, features, opts = {} ) {

	return new Hijack( app, features, { ...( app && app.hijackOptions ), ...opts } );

}

export default { install };

// Pirates feature: the sixteen named captains of the Unreal catalog at sea (Roster.js, through naval.spawn), their dens on the
// islands (Dens.js), retaliation raids (Retaliation.js), the persistent kill / capture ledger (Ledger.js), tier 4-5 bounties with
// search zones (SearchZones.js), notoriety and the corsair standing (Notoriety.js, a small HUD chip). Hostile boarding of the
// player's boat is boarding's (src/features/boarding/Hostile.js); this feature tags the ships it wants to board with (traits,
// mustBoard) and books the outcome. Parity rows Q4, V7-V10, V12, V18, E11 (corsair axis), U6 (den loot).
//
//   features.add( 'pirates', pirates );      // import * as pirates from './features/pirates/index.js'; add it AFTER naval, melee, boarding
//   const p = features.get( 'pirates' );
//   p.searchZones()  -> [ { id, kind: 'bounty' | 'den' | 'raid', x, z, r, label, tier?, captain? } ]   (the world map draws these)
//   p.notoriety() -> heat 0..100   p.notorietyLevel() -> 0..5 (the HUD pips)   p.standing() -> corsair standing -100..100
//   p.wanted         the Notoriety instance { level, heat, standing }   p.ledger  Ledger   p.roster.live  Map id -> Ship
//   p.dens.list      p.zones.contracts / accept( id )             p.retaliation.pending
//   p.hours / p.advance( hours )   p.view()   p.update( dt )   p.toJSON() / fromJSON( d ) / reset() / dispose()
//
// Events emitted: denRaided { id, island, name, captain, coins, goods, by: 'player' | 'remote' },
//   captainKilled { id, captain, ship, by: 'player' | 'other' | 'remote' | 'rival', how: 'sunk' | 'captured' | ... },
//   notorietyChanged { level, previous, heat, standing }, retaliationRaid { captain, id, reason, at: 'sea' | 'harbour', ... },
//   highBountyAccepted { id, target, tier, zone }, highBountyFailed { id, target, reason, by }, and from the shared vocabulary
//   bountyClaimed { id, target, reward, tier, proof, source: 'pirates' }.
// Listened to: shipSunk, prisonerTaken, crewDefeated, portVisited, playerBoatSunk, boardersRepelled / boardersWon / ransomPaid
//   (Hostile.js), remoteWorldEvent (kinds 'denRaided', 'captainKilled' from app.netsync.sendWorldEvent).
// Headless: install( app, features, { rand, seed, hud: false, doc, hudElement, naval, melee, trade, avatarFactory, terrain } ).
//
// Wave 15C: the horizon warning. A hunter coming for the player (a raid, a hijack hunt, a hostile named captain chasing, the navy
// or a bounty hunter turned on him by notoriety) is announced once when she comes within HORIZON.range of him at sea: a toast
// ("A sail on the horizon to the south-west: the Copper Gull") and a minimap / world map blip (searchZones() kind 'sail', for
// HORIZON.blip s), event sailSighted { id, name, captain, x, z, quarter }. Retaliation raids appear 560 m off (past the range).

import { mulberry32 } from '../../util/Noise.js';
import { DAY_SPEED } from '../../game/GameMode.js';
import { WORLD } from '../../world/WorldLayout.js';
import { inSafeZone, PATROLS, nearestIndex } from '../naval/Routes.js';
import { CAPTAIN_BY_ID, Roster, captainByName, factionFor } from './Roster.js';
import { Ledger } from './Ledger.js';
import { Notoriety, HEAT, STANDING } from './Notoriety.js';
import { Dens } from './Dens.js';
import { Retaliation } from './Retaliation.js';
import { SearchZones } from './SearchZones.js';

export { CAPTAINS, CAPTAIN_BY_ID, TRAITS, Roster, factionFor, captainByName, hasTrait } from './Roster.js';
export { Ledger } from './Ledger.js';
export { Notoriety, LEVELS, levelOf, HEAT, STANDING } from './Notoriety.js';
export { Dens, DEN_RULES, denSite } from './Dens.js';
export { Retaliation, RAID_RULES } from './Retaliation.js';
export { SearchZones, HB_RULES, CAPTURE_MULT } from './SearchZones.js';

const SAVE_VERSION = 1;
const REGROUP = { reach: 60, maxTime: 100, heal: 0.3 };
export const HORIZON = { range: 500, blip: 45 };
const QUARTERS = [ 'south', 'south-east', 'east', 'north-east', 'north', 'north-west', 'west', 'south-west' ];

export class Pirates {

	constructor( app, features, opts = {} ) {

		this.app = app || {};
		this.features = features || null;
		this.opts = opts;
		this.rng = opts.rand || mulberry32( opts.seed !== undefined ? opts.seed : ( Date.now() & 0xffffff ) );
		this.avatarFactory = opts.avatarFactory || null;
		this.hours = 8;
		this._lastTod = null;
		this._factionT = 0;
		this.sails = new Map(); // ship id -> { x, z, t, name, captain } the horizon warnings still on the map
		this._offs = [];
		this.ledger = new Ledger();
		const hudEl = opts.hudElement || ( this.app.ui && this.app.ui.ui ? ( this.app.ui.ui.hud || this.app.ui.ui.root ) : null );
		this.wanted = new Notoriety( { hudElement: hudEl, doc: opts.hud === false ? { createElement: null } : opts.doc } );
		this.roster = new Roster( this );
		this.dens = new Dens( this );
		this.retaliation = new Retaliation( this );
		this.zones = new SearchZones( this );

		const f = this.features;
		if ( f && f.on ) {

			this._offs.push( f.on( 'shipSunk', ( e ) => this._onShipSunk( e || {} ) ) );
			this._offs.push( f.on( 'prisonerTaken', ( e ) => this._onPrisoner( e || {} ) ) );
			this._offs.push( f.on( 'crewDefeated', ( e ) => this._onBoardingCrew( e || {} ) ) );
			this._offs.push( f.on( 'portVisited', ( e ) => this.zones.onPortVisited( e ) ) );
			this._offs.push( f.on( 'playerBoatSunk', ( e ) => this.zones.onBoatSunk( e ) ) );
			this._offs.push( f.on( 'boardersRepelled', ( e ) => this._onHostile( 'repelled', e || {} ) ) );
			this._offs.push( f.on( 'boardersWon', ( e ) => this._onHostile( 'overrun', e || {} ) ) );
			this._offs.push( f.on( 'ransomPaid', ( e ) => this._onHostile( 'ransom', e || {} ) ) );
			this._offs.push( f.on( 'remoteWorldEvent', ( e ) => this._onRemote( e || {} ) ) );

		}

	}

	// ------------------------------------------------------------------ collaborators and the world

	_get( name ) {

		return this.opts[ name ] || ( this.features && this.features.get ? this.features.get( name ) : null );

	}

	get naval() { return this._get( 'naval' ); }
	get melee() { return this._get( 'melee' ); }
	get trade() { return this._get( 'trade' ); }
	get terrain() { return this.opts.terrain || this.app.terrainData || null; }
	get state() { return this.features ? this.features.state : null; }
	get day() { return this.hours / 24; }

	get night() {

		const h = this.app.settings ? this.app.settings.timeOfDay : null;
		return typeof h === 'number' && ( h >= 20 || h < 5.5 );

	}

	get storm() {

		const w = this._get( 'weather' );
		const kind = w && ( ( w.current && w.current.kind ) || w.kind );
		return kind === 'storm';

	}

	navalActive() {

		const nv = this.naval;
		return !! ( nv && nv.active !== false && nv.spawn );

	}

	standingInfo() {

		return { notoriety: this.wanted.level, standing: this.wanted.standing };

	}

	reserved( id ) {

		return this.zones.reserved( id );

	}

	_mode() {

		const p = this.app.player;
		return p ? p.mode : null;

	}

	onFoot() {

		const m = this._mode();
		return m === 'walk' || m === 'swim';

	}

	// at the helm or aboard a boat that is under way, out of the harbours
	playerAtSea() {

		const m = this._mode(), b = this.app.boatCtl;
		if ( m !== 'boat' && m !== 'deck' && m !== 'seat' ) return false;
		if ( b && b.moored ) return false;
		const p = this.playerPos();
		return !! p && ! inSafeZone( p.x, p.z );

	}

	playerPos() {

		const m = this._mode(), b = this.app.boatCtl, p = this.app.player;
		if ( ( m === 'boat' || m === 'deck' || m === 'seat' ) && b && b.position ) return b.position;
		return p && p.position ? p.position : null;

	}

	playerDist( s ) {

		const p = this.playerPos();
		return p ? Math.hypot( p.x - s.x, p.z - s.z ) : Infinity;

	}

	groundY( x, z ) {

		const T = this.terrain;
		return T && T.heightAt ? Math.max( 0, T.heightAt( x, z ) ) : 0;

	}

	portName( id ) {

		const p = ( WORLD.ports || [] ).find( ( q ) => q.id === id );
		return p ? p.name : String( id );

	}

	islandName( id ) {

		const p = ( WORLD.ports || [] ).find( ( q ) => q.id === id );
		if ( p ) return p.name;
		const isl = ( WORLD.islands || [] ).find( ( q ) => q.id === id );
		return isl && isl.name ? isl.name : String( id ).replace( /^./, ( c ) => c.toUpperCase() );

	}

	toast( text, ms = 3000 ) {

		const g = this.app.game;
		if ( g && g.toast ) g.toast( text, ms );

	}

	earn( n ) {

		const st = this.state;
		if ( n > 0 && st && st.earn ) st.earn( n );

	}

	_emit( name, payload ) {

		if ( this.features && this.features.emit ) this.features.emit( name, payload );

	}

	_share( kind, data ) {

		const ns = this.app.netsync;
		if ( ns && ns.sendWorldEvent ) try { ns.sendWorldEvent( kind, data ); } catch ( e ) { /* offline */ }

	}

	_heat( heat, standing ) {

		const r = this.wanted.add( heat, standing );
		if ( r.changed ) this._emit( 'notorietyChanged', { level: r.level, previous: r.previous, heat: Math.round( this.wanted.heat ), standing: Math.round( this.wanted.standing ) } );
		return r;

	}

	// ------------------------------------------------------------------ events

	_captainOf( e ) {

		let c = this.roster.captainOfShipId( e.id );
		if ( ! c && typeof e.id === 'string' ) {

			const m = /^pirate-([A-Za-z]+)-\d+$/.exec( e.id );
			if ( m && CAPTAIN_BY_ID[ m[ 1 ] ] ) c = CAPTAIN_BY_ID[ m[ 1 ] ];

		}

		return c;

	}

	_onShipSunk( e ) {

		const c = this._captainOf( e );
		const byPlayer = e.byPlayer !== false;
		if ( c ) {

			const how = e.how || ( e.boarded ? 'boarded' : 'sunk' );
			if ( this.ledger.status( c.id ) === 'captured' ) return; // taken alive first: booked in _onPrisoner
			if ( this.ledger.kill( c.id, { how, by: byPlayer ? 'player' : 'other', day: this.day } ) ) {

				if ( byPlayer ) {

					this.ledger.record( c.type === 'patrol' ? 'navy' : 'sunk', { id: c.id, name: c.captain, ship: c.ship, how, day: this.day } );
					if ( c.type === 'patrol' ) this._heat( HEAT.navy, STANDING.navy );
					else if ( c.type === 'smuggler' ) this._heat( HEAT.merchant, - 3 );
					else if ( c.type === 'hunter' ) this._heat( HEAT.sunk, 0 );
					else this._heat( HEAT.sunk + HEAT.named, STANDING.sunk * 1.5 );
					this.toast( `${ c.captain } went down with the ${ c.ship }`, 3400 );
					if ( c.hostile ) this.retaliation.trigger( c.id, 'sunk' );

				}

				this._emit( 'captainKilled', { id: c.id, captain: c.captain, ship: c.ship, by: byPlayer ? 'player' : 'other', how } );
				if ( byPlayer ) this._share( 'captainKilled', { id: c.id, how } );

			}

			this.zones.onShipSunk( e, c.id );
			return;

		}

		if ( ! byPlayer ) return;
		if ( e.faction === 'pirate' ) {

			this.ledger.record( 'sunk', { name: e.name, how: e.how || 'sunk', day: this.day } );
			this._heat( HEAT.sunk, STANDING.sunk );
			if ( this.rng() < 0.5 ) this.retaliation.trigger( null, 'sunk' );

		} else if ( e.faction === 'merchant' ) {

			this.ledger.record( 'merchant', { name: e.name, day: this.day } );
			this._heat( HEAT.merchant, STANDING.merchant );

		} else if ( e.faction === 'navy' ) {

			this.ledger.record( 'navy', { name: e.name, day: this.day } );
			this._heat( HEAT.navy, STANDING.navy );

		}

		this.zones.onShipSunk( e, null );

	}

	_onPrisoner( e ) {

		const c = this._captainOf( e ) || captainByName( e.name ) || captainByName( e.ship );
		if ( c && this.ledger.capture( c.id, { day: this.day } ) ) {

			this.ledger.record( 'captured', { id: c.id, name: c.captain, ship: c.ship, day: this.day } );
			this._heat( HEAT.captured + HEAT.named, STANDING.captured );
			this._emit( 'captainKilled', { id: c.id, captain: c.captain, ship: c.ship, by: 'player', how: 'captured' } );
			this._share( 'captainKilled', { id: c.id, how: 'captured' } );
			this.zones.onCaptured( c.id );
			if ( c.hostile ) this.retaliation.trigger( c.id, 'captured' );
			return;

		}

		if ( ! c ) {

			this.ledger.record( 'captured', { name: e.name, ship: e.ship, day: this.day } );
			this._heat( HEAT.captured, STANDING.captured );

		}

	}

	_onBoardingCrew( e ) {

		const c = captainByName( e.ship );
		this.ledger.record( 'crew', { name: e.name, ship: e.ship, day: this.day } );
		this._heat( HEAT.crew, STANDING.crew );
		return c;

	}

	_onCrewBeaten( { den, name, keeper } ) {

		this.ledger.record( 'crew', { name, den: den ? den.id : undefined, day: this.day } );
		this._heat( HEAT.crew, STANDING.crew );
		return keeper;

	}

	_onDenRaided( d, res, from ) {

		this.ledger.record( 'raid', { id: d.keeper, den: d.id, value: res.coins, day: this.day } );
		this._heat( HEAT.raid, STANDING.raid );
		this._emit( 'denRaided', { ...res, by: 'player' } );
		this._share( 'denRaided', { id: d.id } );
		if ( this.ledger.isFree( d.keeper ) ) this.retaliation.trigger( d.keeper, 'raid' );
		return from;

	}

	_onHostile( kind, e ) {

		const c = this._captainOf( e ) || captainByName( e.captain ) || captainByName( e.ship );
		this.ledger.record( kind, { id: c ? c.id : undefined, name: e.captain || e.ship, value: e.amount, day: this.day } );
		if ( kind === 'repelled' ) {

			this._heat( HEAT.repelled, STANDING.repelled );
			if ( c ) this.retaliation.trigger( c.id, 'repelled' );

		} else if ( kind === 'ransom' ) this._heat( 0, STANDING.ransom );
		else this._heat( 0, STANDING.overrun );

	}

	_onCaptainEscaped( c ) {

		return c;

	}

	_onCaptainGone( id, by ) {

		const c = CAPTAIN_BY_ID[ id ];
		if ( c ) this._emit( 'captainKilled', { id, captain: c.captain, ship: c.ship, by, how: by } );

	}

	_onBountyDone() {

		this._heat( HEAT.bounty, 0 );

	}

	_emitRaid( payload ) {

		this._emit( 'retaliationRaid', payload );

	}

	_emitHighBounty( name, payload ) {

		this._emit( name, payload );

	}

	// another player's world: a den raided or a captain killed / taken stays so here too
	_onRemote( e ) {

		const d = e.data || {};
		if ( e.kind === 'denRaided' ) {

			const den = this.dens.byId( d.id );
			if ( den && this.dens.held( den ) ) {

				this.dens.raid( den, { remote: true, from: e.from } );
				this._emit( 'denRaided', { id: den.id, island: den.island, name: den.name, captain: CAPTAIN_BY_ID[ den.keeper ].captain, coins: 0, goods: [], by: 'remote' } );

			}

		} else if ( e.kind === 'captainKilled' ) {

			const c = CAPTAIN_BY_ID[ d.id ];
			if ( ! c || ! this.ledger.isFree( c.id ) ) return;
			const s = this.roster.shipOf( c.id );
			if ( s ) s.state = 'gone';
			this.ledger.kill( c.id, { how: String( d.how || 'sunk' ).slice( 0, 20 ), by: 'remote', day: this.day } );
			const k = this.zones.contracts.find( ( q ) => q.captain === c.id );
			if ( k ) this.zones._finish( k, false, 'beaten', { by: 'another crew' } );
			this.toast( `Word at sea: ${ c.captain } of the ${ c.ship } is ${ d.how === 'captured' ? 'in irons' : 'dead' }`, 3400 );
			this._emit( 'captainKilled', { id: c.id, captain: c.captain, ship: c.ship, by: 'remote', how: d.how || 'sunk' } );

		}

	}

	// ------------------------------------------------------------------ clock and ships

	advance( hours ) {

		if ( ! ( hours > 0 ) ) return;
		this.hours += hours;
		const r = this.wanted.cool( hours );
		if ( r.changed ) this._emit( 'notorietyChanged', { level: r.level, previous: r.previous, heat: Math.round( this.wanted.heat ), standing: Math.round( this.wanted.standing ) } );

	}

	// in-game hours pass as the island clock does; a jump of the clock (a load, a slider) does not count
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

	// the roster ships' faction follows notoriety and standing (a ship the player shot at stays hostile)
	_refreshFactions() {

		const info = this.standingInfo();
		for ( const [ id, s ] of this.roster.live ) {

			if ( ! s.alive || s.raid || s.highBounty || s.denGuard ) continue;
			if ( s.lastHitBy === 'player' ) { s.faction = 'pirate'; continue; }
			const want = factionFor( CAPTAIN_BY_ID[ id ], info );
			if ( want !== s.faction ) {

				s.faction = want;
				if ( want !== 'pirate' && ( s.state === 'chase' || s.state === 'broadside' ) ) s.state = 'patrol';
				if ( want === 'pirate' && s.state === 'sail' ) s.state = 'patrol';
				if ( want === 'pirate' && CAPTAIN_BY_ID[ id ].type === 'patrol' ) this.toast( `The ${ s.name } has orders to take you`, 3200 );

			}

		}

	}

	// V7 'regroup': a beaten-off pirate runs for her den mooring or the farthest patrol lane, patches up, then patrols again
	_regroup( dt ) {

		const nv = this.naval;
		if ( ! nv ) return;
		for ( const s of nv.ships ) {

			if ( ! s.alive || s.state !== 'regroup' ) continue;
			if ( ! s.regroupTo ) {

				const c = this.roster.captainOfShip( s );
				const den = c ? this.dens.list.find( ( d ) => d.keeper === c.id ) : null;
				if ( den ) s.regroupTo = { x: den.mx, z: den.mz };
				else {

					const pl = this.playerPos();
					let best = PATROLS[ 0 ][ 0 ], bd = - 1;
					for ( const r of PATROLS ) for ( const q of r ) {

						const d = pl ? Math.hypot( q[ 0 ] - pl.x, q[ 1 ] - pl.z ) : 0;
						if ( d > bd ) { bd = d; best = q; }

					}

					s.regroupTo = { x: best[ 0 ], z: best[ 1 ] };

				}

				s._regroupT = 0;

			}

			s._regroupT = ( s._regroupT || 0 ) + dt;
			const t = s.regroupTo, d = Math.hypot( t.x - s.x, t.z - s.z );
			s.want = Math.atan2( t.x - s.x, t.z - s.z );
			s.wantSpeed = 1;
			if ( d < REGROUP.reach || s._regroupT > REGROUP.maxTime ) {

				s.hp = Math.min( s.maxHp, s.hp + s.maxHp * REGROUP.heal );
				s.regroupTo = null;
				s.mustBoard = false;
				if ( s.cursor ) s.cursor.index = nearestIndex( s.cursor.points, s.x, s.z );
				s.setState ? s.setState( 'patrol' ) : ( s.state = 'patrol' );

			}

		}

	}

	_worldmap() {

		return this.features && this.features.get ? this.features.get( 'worldmap' ) : null;

	}

	// a ship hunting the player: a raid, a hijack hunt, or a hostile roster ship on his trail
	_hunter( s ) {

		if ( ! s.alive || s.faction !== 'pirate' || s.state === 'gone' || s.state === 'moored' || s.state === 'adrift' ) return false;
		if ( s.raid || s.hunt ) return true;
		return !! s.pirateId && ( s.state === 'chase' || s.alertT > 0 );

	}

	// the horizon warning: once per ship, when a hunter comes within HORIZON.range of the player at sea
	_horizon( dt ) {

		for ( const [ id, b ] of this.sails ) {

			b.t -= dt;
			const s = b.ship;
			if ( s && s.alive ) { b.x = s.x; b.z = s.z; }
			if ( b.t <= 0 || ! s || ! s.alive ) {

				this.sails.delete( id );
				this._worldmap()?.removeMarker?.( 'sail:' + id );

			}

		}

		const nv = this.naval, pl = this.playerPos();
		if ( ! nv || ! pl || ! this.playerAtSea() ) return;
		for ( const s of nv.ships ) {

			if ( s._horizonSeen || ! this._hunter( s ) ) continue;
			const d = Math.hypot( s.x - pl.x, s.z - pl.z );
			if ( d > HORIZON.range ) continue;
			s._horizonSeen = true;
			const a = Math.atan2( s.x - pl.x, s.z - pl.z ); // +z is south, +x east
			const quarter = QUARTERS[ ( Math.round( a / ( Math.PI / 4 ) ) + 8 ) % 8 ];
			this.sails.set( s.id, { ship: s, x: s.x, z: s.z, t: HORIZON.blip, name: s.name, captain: s.captain || '' } );
			this._worldmap()?.addMarker?.( { id: 'sail:' + s.id, kind: 'sail', x: s.x, z: s.z, label: `A sail: the ${ s.name }`, icon: 'skull', mine: false } );
			this.toast( `A sail on the horizon to the ${ quarter }: the ${ s.name }`, 4200 );
			this._emit( 'sailSighted', { id: s.id, name: s.name, captain: s.captain || '', x: Math.round( s.x ), z: Math.round( s.z ), quarter } );

		}

	}

	update( dt ) {

		if ( ! ( dt > 0 ) ) return;
		dt = Math.min( dt, 0.1 );
		this._syncClock( dt );
		if ( ! this.app.paused ) {

			const act = this.navalActive();
			if ( act ) this.roster.update( dt );
			this.dens.update( dt );
			this.retaliation.update( dt );
			this.zones.update( dt );
			if ( act ) this._horizon( dt );
			if ( act ) {

				this._regroup( dt );
				this._factionT -= dt;
				if ( this._factionT <= 0 ) {

					this._factionT = 5;
					this._refreshFactions();

				}

			}

		}

		this.wanted.updateHud( dt );

	}

	// ------------------------------------------------------------------ public views

	// notoriety as other features read it (customs: heat 0..100)
	notoriety() {

		return this.wanted.heat;

	}

	notorietyLevel() {

		return this.wanted.level;

	}

	standing() {

		return this.wanted.standing;

	}

	searchZones() {

		const out = [ ...this.zones.zones(), ...this.dens.zones() ];
		for ( const s of this.retaliation.active ) if ( s.alive ) out.push( { id: s.id, kind: 'raid', x: Math.round( s.x ), z: Math.round( s.z ), r: 120, label: `${ s.captain } (raid)`, captain: s.captain } );
		for ( const [ id, b ] of this.sails ) out.push( { id: 'sail:' + id, kind: 'sail', x: Math.round( b.x ), z: Math.round( b.z ), r: 40, label: `A sail: the ${ b.name }`, captain: b.captain } );
		out.push( ...( this.features?.get?.( 'stronghold' )?.zones?.() || [] ) ); // Blackwater's fort (and its batteries' reach)
		return out;

	}

	view() {

		return {
			notoriety: this.wanted.view(),
			atSea: [ ...this.roster.live.entries() ].filter( ( [ , s ] ) => s.alive ).map( ( [ id, s ] ) => ( { id, captain: s.captain, ship: s.name, state: s.state, faction: s.faction } ) ),
			ledger: { ...this.ledger.counts, named: this.ledger.namedTaken },
			dens: this.dens.list.map( ( d ) => ( { id: d.id, held: this.dens.held( d ), guards: d.guardsLeft, found: this.dens.found.has( d.id ) } ) ),
			contracts: this.zones.contracts.map( ( c ) => ( { id: c.id, captain: c.captain, tier: c.tier, state: c.state } ) ),
			raids: this.retaliation.pending.length,
		};

	}

	// ------------------------------------------------------------------ save / lifecycle

	toJSON() {

		return {
			v: SAVE_VERSION, hours: Math.round( this.hours * 100 ) / 100,
			ledger: this.ledger.toJSON(), notoriety: this.wanted.toJSON(), dens: this.dens.toJSON(),
			raids: this.retaliation.toJSON(), bounties: this.zones.toJSON(),
		};

	}

	fromJSON( d ) {

		if ( ! d || typeof d !== 'object' ) return;
		if ( Number.isFinite( d.hours ) && d.hours >= 0 ) this.hours = d.hours;
		this.ledger.fromJSON( d.ledger );
		this.wanted.fromJSON( d.notoriety );
		this.dens.fromJSON( d.dens );
		this.retaliation.fromJSON( d.raids );
		this.zones.fromJSON( d.bounties );
		this.zones._hour = null;
		// captains at sea from before the load are no longer tracked: let them go
		for ( const s of this.roster.live.values() ) if ( s.alive ) s.state = 'gone';
		this.roster.clear();

	}

	reset() {

		for ( const s of this.roster.live.values() ) if ( s.alive ) s.state = 'gone';
		this.roster.clear();
		this.sails.clear();
		this.hours = 8;
		this.ledger.reset();
		this.wanted.reset();
		this.dens.reset();
		this.retaliation.reset();
		this.zones.reset();

	}

	dispose() {

		for ( const off of this._offs ) off();
		this._offs.length = 0;
		this.dens.dispose();
		this.zones.dispose();
		this.wanted.dispose();

	}

}

export function install( app, features, opts = {} ) {

	return new Pirates( app, features, { ...( app && app.piratesOptions ), ...opts } );

}

export default { install };

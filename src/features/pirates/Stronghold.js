// The Blackwater stronghold (wave 12B): the pirates' own island far south of the home island (terrain/IslandShape.js BLACKWATER,
// src/world/islands/Blackwater.js). A feature module of its own (install() below), working with the pirates feature (notoriety,
// standing, ledger, retaliation, the clock), naval (the moored ships, the batteries' balls), melee (the guards), trade (loot and
// the black market), destruction (the breakable fort) and the world map.
//
//   features.add( 'stronghold', stronghold );   // import * as stronghold from './features/pirates/Stronghold.js' (after pirates)
//   const s = features.get( 'stronghold' );
//   s.alarm  Alarm { state: 'calm' | 'spotted' | 'alarm' }     s.batteries  Batteries (two, three guns each)   s.market  BlackMarket
//   s.holder 'pirates' | 'player'   s.claimable() -> { ok, batteries, ships, guards }   s.claim() -> loot | null
//   s.friendly() (the black flag or standing >= MARKET_RULES.standingGate, not betrayed)   s.blackFlag   s.discovered
//   s.zones() -> battery reach circles for the world map once discovered   s.view()   s.advance( hours ) (tests)
//   s.damageStructure( id, energy, by )   s.defeatGuard()   s.marketRows() / marketAction( rowId )
//   s.shipTaken( i, { remote } )   (wave 15C, the hijack feature: a cove ship taken; the fence buys stolen hulls: row 'sellship')
//   s.update( dt ) / toJSON() / fromJSON( d ) / reset() / dispose() / isOpen() / close() / wantsMouse() / lights
//
// The place: two shore batteries on the fort's headland fire at a player boat inside BATTERY_RULES.range (220 m) that is not
// flying the black flag (slow 9 s reload, naval ballistics); breaking a battery's gun platform silences it, its powder store
// explodes when hit. The watchtower's bell raises the alarm (Alarm below): a hostile boat sighted near the fort or the entrance,
// a battery firing, a shot landing on the island, a guard drawn into a fight. With the bell rung the guards (6-10 melee raiders,
// tiers 2-4, two more at night) come out and the three ships moored in the cove cast off and hunt.
// Taking it: silence both batteries, sink or cripple the moored ships, beat the guards on watch, then E at the flagstaff:
// coins, contraband cargo, a captain's ransom if one is in irons, notoriety up and corsair standing down (pirates feature). The
// brotherhood retakes it after DEN_RULES.restock in-game hours, and a retaliation raid follows.
// The other way in: the black flag ($800 at the black market) or corsair standing >= 25: the batteries hold fire, the guards
// leave you be and the fence trades (BlackMarket.js). Firing on the island tears the flag up (betrayed) until the next retake.
// Events: strongholdDiscovered {}, strongholdAlarm { state, why }, strongholdDamaged { id, kind, battery, by },
//   batterySilenced { id, why }, strongholdClaimed { coins, goods, ransom, captain, by }, strongholdRetaken {}, blackFlagBought {}.
// World events (app.netsync.sendWorldEvent): 'strongholdClaimed', 'strongholdProp' { id } (another crew broke that structure).

import { DAY_SPEED } from '../../game/GameMode.js';
import { strongholdLayout } from '../../world/islands/stronghold/Layout.js';
import { STRONGHOLD_KINDS, strongholdPlan } from '../../world/islands/stronghold/Kinds.js';
import { MarketPanel } from '../../world/islands/stronghold/Panel.js';
import { Blackwater } from '../../world/islands/Blackwater.js';
import { Raider } from '../melee/Raider.js';
import { RAIDER, tierCfg, yawToward } from '../melee/MeleeData.js';
import { CREW_TWEAK, CREW_NAMES, CREW_CHARACTERS } from '../boarding/BoardingData.js';
import { CAPTAIN_BY_ID } from './Roster.js';
import { HEAT, STANDING } from './Notoriety.js';
import { DEN_RULES } from './Dens.js';
import { Batteries, BATTERY_RULES } from './Batteries.js';
import { BlackMarket, MARKET_RULES, letIn } from './BlackMarket.js';

export { Batteries, BATTERY_RULES, batteryDecision, lineClear } from './Batteries.js';
export { BlackMarket, MARKET_RULES, letIn, buyPrice, contrabandGoods } from './BlackMarket.js';

export const STRONGHOLD_RULES = {
	discover: 460, // m from the island's centre: sighted, named on the map, the batteries' reach drawn
	watch: 300, // m from the fort / the entrance (or inside the cove): the watch sees a hostile boat
	bellDelay: 5, // s from sighting to the bell
	standDown: 120, // s without hostility before the alarm is stood down
	guardRange: 180, // m on foot from the town or the fort: the guards are on their beats
	guardsDay: 7, guardsNight: 9, guardsMax: 10,
	shipRange: 760, // m: the moored ships lie in the cove when the player is this close
	dropRange: 1300,
	restock: DEN_RULES.restock, // in-game hours before the brotherhood retakes a claimed island
	rebuild: 12, // in-game hours before a broken battery / wall is rebuilt while the pirates hold the island (player away)
	rebuildClear: 320, // m: nothing is rebuilt with the player this close
	coins: [ 1800, 700 ], // claim loot: base + up to this much more
	cargo: [ [ 'relics', 2, 3 ], [ 'powder', 2, 4 ], [ 'tobacco', 2, 3 ], [ 'rum', 2, 4 ], [ 'spices', 1, 3 ] ],
	ransomPerTier: 300, // $ for a captain in irons, per catalog tier
	heat: HEAT.raid * 2, standing: STANDING.raid * 2, // claiming it: twice a den raid
	betray: { heat: 6, standing: - 15 }, // firing on the island while it lets you in
	hostileRadius: 330, // m from the island's centre: a player's ball landing inside is an attack
	keeper: 'Brinehook', // Brinehook Bill keeps Blackwater (his band answers a claim)
	lootRadius: 4,
	tavern: { price: 15, standing: 1.5 },
};

export const ALARM_RULES = { bellDelay: STRONGHOLD_RULES.bellDelay, standDown: STRONGHOLD_RULES.standDown };

// The watch: calm -> spotted (a hostile in sight; the bell after bellDelay unless it is gone) -> alarm (the bell) -> calm after
// standDown s without hostility. raise() rings the bell at once (shots, a fight). update() returns 'bell' | 'lost' | 'standDown' | null.
export class Alarm {

	constructor( rules = ALARM_RULES ) {

		this.rules = rules;
		this.reset();

	}

	reset() {

		this.state = 'calm';
		this.t = 0;
		this.quiet = 0;
		this.rings = 0;
		this.why = null;

	}

	spot( why = 'sighted' ) {

		if ( this.state !== 'calm' ) return false;
		this.state = 'spotted';
		this.t = this.rules.bellDelay;
		this.why = why;
		return true;

	}

	// returns true when this rings the bell (it was not ringing)
	raise( why = 'attack' ) {

		this.quiet = 0;
		if ( this.state === 'alarm' ) return false;
		this.state = 'alarm';
		this.why = why;
		this.rings ++;
		return true;

	}

	update( dt, hostile ) {

		if ( this.state === 'spotted' ) {

			this.t -= dt;
			if ( this.t > 0 ) return null;
			if ( hostile ) { this.raise( this.why || 'sighted' ); return 'bell'; }
			this.state = 'calm';
			return 'lost';

		}

		if ( this.state === 'alarm' ) {

			this.quiet = hostile ? 0 : this.quiet + dt;
			if ( this.quiet >= this.rules.standDown ) {

				this.state = 'calm';
				this.quiet = 0;
				return 'standDown';

			}

		}

		return null;

	}

}

// the beats and tiers of the guards, in the order they turn out (the last ones only at night / with the bell)
const GUARD_SLOTS = [ [ 'town', 2 ], [ 'fort', 3 ], [ 'front', 3 ], [ 'town', 2 ], [ 'fort', 4 ], [ 'front', 3 ], [ 'town', 2 ], [ 'rim', 2 ], [ 'rim', 3 ], [ 'town', 3 ] ];
const GUARD_TWEAK = { flees: 0, downTime: CREW_TWEAK.downTime, loot: 0, radius: CREW_TWEAK.radius, leash: 40, lose: 46, notice: 15 };
const SHIP_NAMES = [ 'The Grey Widow', 'Cinder Jack', 'The Salt Hag' ];
const PATROL_SPEED = 1.4;
const cap = ( s ) => s.replace( /^./, ( c ) => c.toUpperCase() );

// what the guards are built with (Dens' DenHost pattern): melee's target, tokens and strikes, the stronghold's peace
class StrongholdHost {

	constructor( s ) {

		this.s = s;
		this.raiders = [];

	}

	get m() { return this.s.melee; }
	get terrain() { return this.s.terrain; }
	get colliders() { return this.m ? this.m.colliders : null; }
	// friends of the brotherhood walk the town unmolested while the bell is quiet
	get peaceful() { return !! ( this.m && this.m.peaceful ) || this.s.guardsPeaceful(); }
	rand() { return this.s.rng(); }
	target() { return this.m ? this.m.target() : { x: 0, y: 0, z: 0, valid: false }; }
	tokenFree( r ) { return this.m ? this.m.tokenFree( r ) : true; }
	takeToken( r ) { if ( this.m ) this.m.takeToken( r ); }
	releaseToken( r ) { if ( this.m ) this.m.releaseToken( r ); }
	raiderStrike( r ) { return this.m ? this.m.raiderStrike( r ) : 'missed'; }
	onWindup( r ) { if ( this.m && this.m.onWindup ) this.m.onWindup( r ); }
	onAggro( r ) { if ( this.m && this.m.onAggro ) this.m.onAggro( r ); this.s._hostileAct( 'guard' ); }
	onDefeated( r ) { this.s.defeatGuard( r ); }
	far( r ) { return this.m && this.m.far ? this.m.far( r ) : false; }

}

export class Stronghold {

	constructor( app, features, opts = {} ) {

		this.app = app || {};
		this.features = features || null;
		this.opts = opts;
		this.R = { ...STRONGHOLD_RULES, ...( opts.rules || {} ) };
		let seed = ( opts.seed ?? 4242 ) >>> 0 || 1;
		this.rng = opts.rand || ( () => ( ( seed = ( seed * 16807 ) % 2147483647 ) / 2147483647 ) );
		if ( ! opts.rand ) for ( let k = 0; k < 4; k ++ ) this.rng(); // (a small seed starts the stream near 0)
		this.L = strongholdLayout();
		this.alarm = new Alarm( { bellDelay: this.R.bellDelay, standDown: this.R.standDown } );
		this.batteries = new Batteries( this.L.batteries, { rng: this.rng, terrain: this.terrain, launch: ( m, dir, info ) => this._launch( m, dir, info ) } );
		this.market = new BlackMarket( {
			state: () => this.state, trade: () => this._get( 'trade' ), naval: () => this.naval, exploration: () => this._get( 'exploration' ),
			toast: ( t ) => this.toast( t, 3200 ),
		} );
		this.panel = new MarketPanel( this );
		this.host = new StrongholdHost( this );
		this.structs = new Map( strongholdPlan( this.terrain ).map( ( p ) => [ p.id, { ...p, def: STRONGHOLD_KINDS[ p.kind ].def, hp: STRONGHOLD_KINDS[ p.kind ].def.toughness, broken: false, brokenAt: 0 } ] ) );
		this.guards = [];
		this.ships = this.L.moorings.map( ( m, i ) => ( { i, ...m, name: SHIP_NAMES[ i % SHIP_NAMES.length ], ship: null, down: false, lastHp: null } ) );
		this._hours = 8;
		this._offs = [];
		this._removers = [];
		this.island = null;
		this.lights = [];
		this.reset();

		if ( opts.build !== false && this.app.scene && this.terrain && this.terrain.heightAt ) {

			try {

				const make = opts.islandFactory || ( ( o ) => new Blackwater( o ) );
				this.island = make( { scene: this.app.scene, terrain: this.terrain, colliders: this.app.colliders || null } );
				this.lights = this.island.lights || [];

			} catch ( e ) {

				console.warn( 'stronghold: Blackwater cannot be built', e );
				this.island = null;

			}

		}

		const f = this.features;
		if ( f && f.on ) {

			this._offs.push( f.on( 'cannonballImpact', ( e ) => this._onImpact( e || {} ) ) );
			this._offs.push( f.on( 'explosion', ( e ) => this._onExplosion( e || {} ) ) );
			this._offs.push( f.on( 'meleeHit', ( e ) => this._onMelee( e || {} ) ) );
			this._offs.push( f.on( 'propDestroyed', ( e ) => { if ( e && this.structs.has( e.id ) ) this._break( e.id, e.by || 'player', { owned: true } ); } ) );
			this._offs.push( f.on( 'propRespawned', ( e ) => { if ( e && this.structs.has( e.id ) ) this._restore( e.id ); } ) );
			this._offs.push( f.on( 'shipSunk', ( e ) => this._onShipSunk( e || {} ) ) );
			this._offs.push( f.on( 'remoteWorldEvent', ( e ) => this._onRemote( e || {} ) ) );

		}

		this._registerInteractables();

	}

	// ------------------------------------------------------------------ collaborators

	_get( name ) {

		return this.opts[ name ] || ( this.features && this.features.get ? this.features.get( name ) : null );

	}

	get pirates() { return this._get( 'pirates' ); }
	get naval() { return this._get( 'naval' ); }
	get melee() { return this._get( 'melee' ); }
	get destruction() { return this._get( 'destruction' ); }
	get terrain() { return this.opts.terrain || this.app.terrainData || null; }
	get state() { return this.features ? this.features.state : null; }
	get sandbox() { return !! ( this.features && this.features.sandbox ); }

	get hours() {

		const p = this.pirates;
		return p && Number.isFinite( p.hours ) ? p.hours : this._hours;

	}

	advance( h ) {

		if ( ! ( h > 0 ) ) return;
		const p = this.pirates;
		if ( p && p.advance ) p.advance( h ); else this._hours += h;

	}

	get night() {

		const h = this.app.settings ? this.app.settings.timeOfDay : null;
		return typeof h === 'number' && ( h >= 20 || h < 5.5 );

	}

	standing() {

		const p = this.pirates;
		return p && p.standing ? p.standing() : 0;

	}

	toast( text, ms = 3000 ) {

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

	_mode() {

		const p = this.app.player;
		return p ? p.mode : null;

	}

	onFoot() {

		const m = this._mode();
		return m === 'walk' || m === 'swim';

	}

	playerPos() {

		const m = this._mode(), b = this.app.boatCtl, p = this.app.player;
		if ( ( m === 'boat' || m === 'deck' || m === 'seat' ) && b && b.position ) return b.position;
		return p && p.position ? p.position : null;

	}

	navalActive() {

		const nv = this.naval;
		return !! ( nv && nv.active !== false && nv.spawn );

	}

	// ------------------------------------------------------------------ who is let in

	flagFlown() {

		return this.blackFlag && ! this.betrayed;

	}

	friendly() {

		if ( this.holder === 'player' ) return true;
		if ( this.betrayed ) return false;
		return letIn( { standing: this.standing(), flag: this.blackFlag }, this.market.rules );

	}

	guardsPeaceful() {

		return this.holder === 'player' || ( this.friendly() && this.alarm.state !== 'alarm' );

	}

	// an act of war against the island: the bell, and a friend who did it loses the brotherhood's welcome
	_hostileAct( why ) {

		if ( this.holder !== 'pirates' ) return false;
		if ( ! this.betrayed && this.friendly() ) {

			this.betrayed = true;
			this.blackFlag = false;
			const p = this.pirates;
			if ( p && p._heat ) p._heat( this.R.betray.heat, this.R.betray.standing );
			this.toast( 'You turned on Blackwater · the black flag will not shield you here again', 3800 );

		}

		if ( this.alarm.raise( why ) ) this._bell( why );
		return true;

	}

	_bell( why ) {

		this.toast( 'The bell rings on Blackwater', 2800 );
		this._emit( 'strongholdAlarm', { state: 'alarm', why } );
		if ( this.island ) this.island.setBell( 1 );
		// the guards on watch turn out sharp; the ships cast off in _ships
		for ( const r of this.guards ) if ( r && r.active && r.cfg ) r.cfg = { ...r.cfg, notice: 30 };
		this._castOffToast = false;

	}

	// ------------------------------------------------------------------ the batteries

	_target() {

		const b = this.app.boatCtl, nv = this.naval;
		if ( ! b || ! b.position ) return null;
		if ( nv && ( ( nv.playerHull && nv.playerHull.sunk ) || nv.sinking ) ) return null;
		const v = b.velocity || { x: 0, z: 0 };
		return { ok: true, x: b.position.x, y: 0, z: b.position.z, vx: v.x || 0, vz: v.z || 0, friendly: this.friendly() };

	}

	_launch( m, dir, info ) {

		const nv = this.naval;
		if ( ! nv ) return null;
		if ( typeof nv.launchFrom === 'function' ) return nv.launchFrom( m.x, m.y, m.z, dir, info );
		if ( typeof nv.remoteShot === 'function' ) return nv.remoteShot( [ m.x, m.y, m.z ], [ dir.x, dir.y, dir.z ], info.speed, { owner: info.owner, damage: info.damage, faction: 'pirate', big: true } );
		return null;

	}

	// ------------------------------------------------------------------ the breakable fort (destruction's props, or our own model)

	_owned( id ) {

		const d = this.destruction;
		return !! ( d && d.byId && d.byId.has && d.byId.has( id ) );

	}

	damageStructure( id, energy, by = 'player', at = null ) {

		const s = this.structs.get( id );
		if ( ! s || s.broken || ! ( energy > 0 ) ) return false;
		if ( this._owned( id ) ) {

			const d = this.destruction;
			if ( d.damage ) d.damage( id, energy, at || { x: s.x, y: s.y + 1, z: s.z }, by );
			return false;

		}

		s.hp -= energy;
		if ( s.hp <= 0 ) this._break( id, by );
		return true;

	}

	_break( id, by = 'player', { owned = false, remote = false } = {} ) {

		const s = this.structs.get( id );
		if ( ! s || s.broken ) return false;
		s.broken = true;
		s.hp = 0;
		s.brokenAt = this.hours;
		if ( this.island && ! owned ) this.island.setBroken( id, true );
		const v = this._get( 'vfx' );
		if ( s.kind === 'gunPlatform' ) this._silence( s.battery, 'platform' );
		if ( s.kind === 'powder' ) {

			const E = s.def.explosive;
			if ( v ) {

				if ( v.flash ) v.flash( s.x, s.y + 1, s.z, 2.5 );
				if ( v.splinters ) v.splinters( s.x, s.y + 1, s.z, 3 );
				if ( v.debris ) v.debris( s.x, s.y + 1, s.z, 3, 'wood' );
				if ( v.fire ) v.fire( id, s.x, s.y + 0.5, s.z, 1.6 );
				if ( v.smoke ) v.smoke( s.x, s.y + 2, s.z, 3 );

			}

			const a = this.app.audio;
			if ( a && a.explosion ) try { a.explosion( s.x, s.y, s.z ); } catch ( e ) { /* optional */ }
			// the blast: destruction breaks and throws what stands near (and our own model hears it too)
			this._emit( 'explosion', { x: s.x, y: s.y + 0.8, z: s.z, radius: E.radius, energy: E.energy, by: 'powder' } );
			this._silence( s.battery, 'powder' );
			this.toast( 'The powder store goes up', 2400 );

		}

		this._emit( 'strongholdDamaged', { id, kind: s.kind, battery: s.battery || null, by } );
		if ( by === 'player' && ! remote ) this._hostileAct( 'fort' );
		if ( ! remote && ! owned && by !== 'remote' ) this._share( 'strongholdProp', { id } );
		return true;

	}

	_silence( batteryId, why ) {

		if ( ! batteryId || ! this.batteries.silence( batteryId, why ) ) return;
		const b = this.batteries.byId( batteryId );
		if ( this.island ) this.island.setSilenced( batteryId, true );
		this._emit( 'batterySilenced', { id: batteryId, why } );
		this.toast( `${ cap( b.name ) } is silenced${ this.batteries.allSilenced() ? ' · both batteries are out' : '' }`, 3000 );

	}

	_restore( id ) {

		const s = this.structs.get( id );
		if ( ! s ) return;
		s.broken = false;
		s.hp = s.def.toughness;
		if ( this.island ) this.island.setBroken( id, false );
		const v = this._get( 'vfx' );
		if ( s.kind === 'powder' && v && v.stopFire ) v.stopFire( id );
		// a battery is back in action with its platform and its powder both whole
		if ( s.battery ) {

			const parts = [ ...this.structs.values() ].filter( ( q ) => q.battery === s.battery );
			if ( parts.every( ( q ) => ! q.broken ) && this.batteries.restore( s.battery ) && this.island ) this.island.setSilenced( s.battery, false );

		}

	}

	_near( s, x, y, z, r ) {

		return Math.hypot( s.x - x, s.z - z ) < r + ( s.r || 1 ) * 0.6 && Math.abs( ( s.y + 1.2 ) - ( y ?? s.y + 1.2 ) ) < r + 3;

	}

	_onImpact( e ) {

		if ( ! Number.isFinite( e.x ) ) return;
		const R = this.R, c = this.L.center;
		if ( e.owner === 'player' && this.holder === 'pirates' && Math.hypot( e.x - c.x, e.z - c.z ) < R.hostileRadius ) this._hostileAct( 'cannon' );
		const energy = e.energy > 0 ? e.energy : 40000;
		for ( const s of this.structs.values() ) {

			if ( s.broken || this._owned( s.id ) ) continue;
			if ( e.target === s.id ) { this.damageStructure( s.id, energy, e.owner === 'player' ? 'player' : 'other' ); continue; }
			const d = Math.hypot( s.x - e.x, s.z - e.z ) - ( s.r || 1 ) * 0.6;
			if ( d < 3.5 && Math.abs( s.y + 1 - e.y ) < 5 ) this.damageStructure( s.id, energy * 0.8 * ( 1 - Math.max( 0, d ) / 3.5 ), e.owner === 'player' ? 'player' : 'other' );

		}

	}

	_onExplosion( e ) {

		if ( ! Number.isFinite( e.x ) ) return;
		const r = e.radius || 6, E = e.energy || 120000;
		for ( const s of this.structs.values() ) {

			if ( s.broken || this._owned( s.id ) ) continue;
			const d = Math.hypot( s.x - e.x, s.z - e.z, ( s.y + 1 ) - ( e.y ?? s.y ) );
			if ( d < r ) this.damageStructure( s.id, E * ( 1 - d / r ), e.by === 'player' ? 'player' : e.by || 'explosion' );

		}

	}

	_onMelee( e ) {

		if ( ! Number.isFinite( e.x ) ) return;
		for ( const s of this.structs.values() ) {

			if ( s.broken || s.kind !== 'palisade' || this._owned( s.id ) ) continue;
			if ( this._near( s, e.x, e.y, e.z, ( e.range ?? 1.4 ) + 0.4 ) ) this.damageStructure( s.id, e.energy ?? 450, e.by || 'player' );

		}

	}

	// ------------------------------------------------------------------ the guards

	_guardCount() {

		const R = this.R;
		const n = ( this.night ? R.guardsNight : R.guardsDay ) + ( this.alarm.state === 'alarm' ? 1 : 0 );
		return Math.min( R.guardsMax, n );

	}

	_guard( i ) {

		if ( this.guards[ i ] ) return this.guards[ i ];
		const m = this.melee, p = this.pirates, factory = this.opts.avatarFactory || ( p && p.avatarFactory ) || ( m && m.avatarFactory );
		if ( ! m || ! factory || ! Array.isArray( m.raiders ) ) return null;
		const mine = this.app.avatar && this.app.avatar.character;
		const chars = CREW_CHARACTERS.filter( ( c ) => c !== mine );
		const character = chars[ ( i * 3 + 1 ) % chars.length ];
		let avatar = null;
		try { avatar = factory( { scene: this.app.scene, character, lite: true } ); } catch ( e ) { return null; }
		const route = this.L.routes[ GUARD_SLOTS[ i ][ 0 ] ];
		const r = new Raider( this.host, { id: `blackwater-guard-${ i }`, x: route[ 0 ][ 0 ], z: route[ 0 ][ 1 ], when: 'day', characters: [ character ] }, avatar );
		r.active = false;
		r.visible = false;
		this.guards[ i ] = r;
		this.host.raiders.push( r );
		if ( ! m.raiders.includes( r ) ) m.raiders.push( r );
		return r;

	}

	_putOut() {

		this.awake = true;
		if ( this.guardsLeft === null ) this.guardsLeft = this._guardCount();
		if ( ! this.melee ) return;
		let need = this.guardsLeft - this.guards.filter( ( r ) => r && r.active ).length;
		for ( let i = 0; i < GUARD_SLOTS.length && need > 0; i ++ ) {

			const r = this._guard( i );
			if ( ! r || r.active || r.beatenOut ) continue;
			need --;
			const [ beat, tier ] = GUARD_SLOTS[ i ];
			const route = this.L.routes[ beat ];
			const k = ( i * 2 ) % route.length;
			r.homeX = route[ k ][ 0 ];
			r.homeZ = route[ k ][ 1 ];
			const nx = route[ ( k + 1 ) % route.length ];
			r.homeYaw = yawToward( r.homeX, r.homeZ, nx[ 0 ], nx[ 1 ] );
			r.spawn( { name: CREW_NAMES[ ( i * 5 + 2 ) % CREW_NAMES.length ], tier } );
			r.cfg = { ...tierCfg( RAIDER, tier ), ...GUARD_TWEAK, notice: this.alarm.state === 'alarm' ? 30 : GUARD_TWEAK.notice };
			r.maxHp = r.hp = r.cfg.hp;
			r.beat = { route, i: ( k + 1 ) % route.length, dir: 1 };
			r._ground();
			r._place();

		}

	}

	// a fresh watch: the full count again, nobody beaten
	_freshWatch() {

		this.guardsLeft = null;
		this._beaten = 0;
		for ( const r of this.guards ) if ( r ) r.beatenOut = false;

	}

	_putAway() {

		this.awake = false;
		for ( const r of this.guards ) if ( r && r.active ) r.deactivate();

	}

	// the guards walk their beats: the point they keep near moves along the route while they are not fighting
	_patrol( dt ) {

		for ( const r of this.guards ) {

			if ( ! r || ! r.active || ! r.beat || ( r.state !== 'idle' && r.state !== 'patrol' ) ) continue;
			const B = r.beat, q = B.route[ B.i ];
			const dx = q[ 0 ] - r.homeX, dz = q[ 1 ] - r.homeZ, d = Math.hypot( dx, dz );
			if ( d < 1 ) {

				let n = B.i + B.dir;
				if ( n < 0 || n >= B.route.length ) { B.dir = - B.dir; n = B.i + B.dir; }
				B.i = Math.max( 0, Math.min( B.route.length - 1, n ) );
				continue;

			}

			const s = Math.min( d, PATROL_SPEED * dt );
			r.homeX += dx / d * s;
			r.homeZ += dz / d * s;
			r.homeYaw = yawToward( r.homeX, r.homeZ, q[ 0 ], q[ 1 ] );

		}

	}

	defeatGuard( r = null ) {

		if ( this.guardsLeft === null ) this.guardsLeft = this._guardCount();
		if ( this.guardsLeft <= 0 ) return false;
		this.guardsLeft --;
		this._beaten = ( this._beaten || 0 ) + 1;
		if ( r ) r.beatenOut = true;
		const p = this.pirates;
		if ( p && p._onCrewBeaten ) p._onCrewBeaten( { den: { id: 'blackwater' }, name: r ? r.name : 'a guard', keeper: this.R.keeper } );
		if ( this.guardsLeft <= 0 ) this.toast( this.claimable().ok ? 'Blackwater is undefended · claim it at the flagstaff (E)' : 'The last of the watch is down', 3600 );
		return true;

	}

	_guardsUpdate( dt, pl ) {

		const R = this.R, L = this.L;
		if ( this.holder !== 'pirates' ) { if ( this.awake ) this._putAway(); return; }
		const dTown = pl ? Math.hypot( pl.x - L.town[ 0 ].x, pl.z - L.town[ 0 ].z ) : 1e9;
		const dFort = pl ? Math.hypot( pl.x - L.fort.x, pl.z - L.fort.z ) : 1e9;
		const near = Math.min( dTown, dFort );
		if ( ! this.awake && ( ( near < R.guardRange && this.onFoot() ) || ( this.alarm.state === 'alarm' && near < R.guardRange * 2 ) ) ) this._putOut();
		else if ( this.awake && near > R.guardRange * 2.5 ) {

			this._putAway();
			// the watch regroups while you are away, unless it was beaten to the last man
			if ( this.guardsLeft > 0 ) this._freshWatch();

		}

		if ( this.awake ) {

			// more turn out at night or with the bell (beaten ones stay beaten)
			const want = this._guardCount(), beaten = this._beaten || 0;
			if ( this.guardsLeft !== null && this.guardsLeft > 0 && this.guardsLeft + beaten < want ) { this.guardsLeft = want - beaten; this._putOut(); }
			this._patrol( dt );
			// no melee feature: the watch gives up the fort when a hostile walks in
			if ( ! this.melee && dFort < 14 && this.guardsLeft > 0 && ! this.guardsPeaceful() ) while ( this.guardsLeft > 0 ) this.defeatGuard();

		}

	}

	// ------------------------------------------------------------------ the ships in the cove

	_shipsUpdate( pl ) {

		const nv = this.naval, R = this.R, c = this.L.cove;
		if ( ! nv ) return;
		const dist = pl ? Math.hypot( pl.x - c.x, pl.z - c.z ) : 1e9;
		for ( const sl of this.ships ) {

			let s = sl.ship;
			if ( s && ( ! s.alive || ! nv.ships.includes( s ) ) ) {

				if ( ! s.alive && s.state !== 'gone' ) sl.down = true;
				sl.ship = s = null;

			}

			if ( ! s ) {

				if ( sl.down || this.holder !== 'pirates' || dist > R.shipRange || ! this.navalActive() ) continue;
				const ns = nv.spawn( sl.cls, { id: `blackwater-${ sl.i }`, x: sl.x, z: sl.z, yaw: sl.yaw, state: 'moored', speed: 0, name: sl.name, captain: 'the Blackwater crew', route: this.L.sailOut.slice(), loop: false } );
				if ( ! ns ) continue;
				ns.state = 'moored';
				ns.wantSpeed = 0;
				ns.stronghold = sl.i;
				sl.ship = ns;
				sl.lastHp = ns.hp;
				continue;

			}

			// crippled (struck her colours: the boarding prize) counts as taken
			if ( ( s.hpFraction !== undefined && s.hpFraction < 0.25 ) || s.state === 'adrift' ) sl.down = true;
			const hit = sl.lastHp !== null && s.hp < sl.lastHp && s.lastHitBy === 'player';
			sl.lastHp = s.hp;
			if ( hit ) this._hostileAct( 'ships' );
			if ( s.state === 'moored' ) {

				s.wantSpeed = 0;
				if ( this.alarm.state === 'alarm' && ! this.friendly() && ! sl.down ) {

					s.setState ? s.setState( 'patrol' ) : ( s.state = 'patrol' );
					s.alertT = Math.max( s.alertT || 0, 60 );
					if ( ! this._castOffToast ) { this._castOffToast = true; this.toast( 'The ships in the cove cast off', 2600 ); }

				} else if ( dist > R.dropRange ) { s.state = 'gone'; sl.ship = null; }

			} else if ( dist > R.dropRange && s.state !== 'sinking' ) { s.state = 'gone'; sl.ship = null; }

		}

	}

	// wave 15C (the hijack feature): one of the cove's ships was taken - cut out from her mooring or boarded and sailed off. She
	// counts as down (a claim needs no more of her); a local theft is an act of war (the bell), another crew's is only booked
	shipTaken( i, { remote = false } = {} ) {

		const sl = this.ships[ i ];
		if ( ! sl ) return false;
		sl.down = true;
		sl.ship = null;
		if ( ! remote ) this._hostileAct( 'ships' );
		return true;

	}

	_onShipSunk( e ) {

		const m = typeof e.id === 'string' ? /^blackwater-(\d)$/.exec( e.id ) : null;
		if ( ! m ) return;
		const sl = this.ships[ + m[ 1 ] ];
		if ( sl ) sl.down = true;
		if ( e.byPlayer !== false ) this._hostileAct( 'ships' );

	}

	shipsLeft() {

		return this.ships.filter( ( s ) => ! s.down ).length;

	}

	// ------------------------------------------------------------------ claim, restock, retake

	claimable() {

		const total = this.batteries.list.length, silenced = this.batteries.list.filter( ( b ) => b.silenced ).length;
		const ships = this.navalActive() || this.ships.some( ( s ) => s.ship ) ? this.shipsLeft() : 0;
		const guards = this.guardsLeft === null ? this._guardCount() : this.guardsLeft;
		return { ok: this.holder === 'pirates' && silenced === total && ships === 0 && guards <= 0, batteries: `${ silenced }/${ total }`, ships, guards };

	}

	claim( { remote = false } = {} ) {

		if ( this.holder !== 'pirates' ) return null;
		if ( ! remote && ! this.claimable().ok ) return null;
		this.holder = 'player';
		this.claimedAt = this.hours;
		this.claims ++;
		this.alarm.reset();
		this._putAway();
		if ( this.island ) { this.island.setFlag( 'player' ); this.island.setBell( 0 ); }
		this.panel.close();
		if ( remote ) {

			this.toast( 'Word comes that another crew has taken Blackwater', 3200 );
			return { remote: true };

		}

		const R = this.R, rng = this.rng;
		const coins = Math.round( ( R.coins[ 0 ] + R.coins[ 1 ] * rng() ) / 10 ) * 10;
		const st = this.state;
		if ( st && st.earn ) st.earn( coins );
		// contraband from the plunder store: three lots
		const pool = R.cargo.slice(), goods = [];
		const tr = this._get( 'trade' );
		let stowed = 0;
		for ( let k = 0; k < 3 && pool.length; k ++ ) {

			const [ good, a, b ] = pool.splice( Math.floor( rng() * pool.length ) % pool.length, 1 )[ 0 ];
			const qty = a + Math.floor( rng() * ( b - a + 1 ) );
			goods.push( { good, qty } );
			if ( tr && tr.addCargo ) stowed += tr.addCargo( good, qty, { paid: 0 } ) || 0;

		}

		// a captain in irons is worth a ransom to his band (once each)
		const p = this.pirates;
		let ransom = 0, captain = null;
		const held = p && p.ledger && p.ledger.captains ? Object.keys( p.ledger.captains ).filter( ( id ) => p.ledger.captains[ id ].state === 'captured' && ! this.ransomed.has( id ) && CAPTAIN_BY_ID[ id ] ) : [];
		if ( held.length ) {

			held.sort( ( a, b ) => CAPTAIN_BY_ID[ b ].tier - CAPTAIN_BY_ID[ a ].tier );
			captain = CAPTAIN_BY_ID[ held[ 0 ] ];
			ransom = R.ransomPerTier * captain.tier;
			this.ransomed.add( captain.id );
			if ( st && st.earn ) st.earn( ransom );

		}

		if ( p ) {

			if ( p._heat ) p._heat( R.heat, R.standing ); else if ( p.wanted ) p.wanted.add( R.heat, R.standing );
			if ( p.ledger ) p.ledger.record( 'raid', { id: R.keeper, den: 'blackwater', value: coins + ransom, day: this.hours / 24 } );

		}

		const res = { coins, goods, stowed, ransom, captain: captain ? captain.captain : null, by: 'player' };
		this.toast( `Blackwater is yours · +$${ coins + ransom }${ stowed ? ` and ${ stowed } crates` : '' }${ captain ? ` (${ captain.captain }'s ransom)` : '' } · the brotherhood will be back`, 5200 );
		this._emit( 'strongholdClaimed', res );
		this._share( 'strongholdClaimed', {} );
		return res;

	}

	_retake() {

		this.holder = 'pirates';
		this.claimedAt = null;
		this.betrayed = false;
		this._freshWatch();
		this.alarm.reset();
		for ( const s of this.structs.values() ) if ( s.broken && ! this._owned( s.id ) ) this._restore( s.id );
		for ( const b of this.batteries.list ) if ( b.silenced && [ ...this.structs.values() ].filter( ( q ) => q.battery === b.id ).every( ( q ) => ! q.broken ) ) { this.batteries.restore( b.id ); if ( this.island ) this.island.setSilenced( b.id, false ); }
		for ( const sl of this.ships ) { sl.down = false; sl.lastHp = null; }
		if ( this.island ) this.island.setFlag( 'pirates' );
		this.toast( 'The brotherhood has retaken Blackwater', 3600 );
		this._emit( 'strongholdRetaken', {} );
		// and his band comes for whoever took it
		const p = this.pirates;
		if ( p && p.retaliation && ! this.sandbox ) p.retaliation.trigger( this.R.keeper, 'stronghold', { force: true } );

	}

	// while the pirates hold it, what was broken is rebuilt after a while (never under the player's nose)
	_rebuild( pl ) {

		const R = this.R, c = this.L.center;
		if ( this.holder !== 'pirates' ) return;
		if ( pl && Math.hypot( pl.x - c.x, pl.z - c.z ) < R.rebuildClear ) return;
		for ( const s of this.structs.values() ) if ( s.broken && ! this._owned( s.id ) && this.hours - s.brokenAt >= R.rebuild ) this._restore( s.id );

	}

	// ------------------------------------------------------------------ the black market and the tavern

	marketCtx() {

		const story = this.features && this.features.get ? this.features.get( 'story' ) : null;
		const powderOff = story && story.discount ? story.discount( 'powder:blackwater' ) || 0 : 0; // wave 13: The black flag's reward
		const hj = this.features && this.features.get ? this.features.get( 'hijack' ) : null;
		const stolen = hj && hj.stolenQuote ? hj.stolenQuote() : null; // wave 15C: a stolen hull the fence will buy
		return { standing: this.standing(), flag: this.flagFlown(), alarm: this.alarm.state === 'alarm', held: this.holder === 'pirates', powderOff, stolen };

	}

	marketRows() {

		const ctx = this.marketCtx(), c = this.market.canTrade( ctx );
		const wp = this.features && this.features.get ? this.features.get( 'weapons' ) : null, fa = this.features && this.features.get ? this.features.get( 'firearms' ) : null;
		// wave 18D: the fence also deals in arms (the blunderbuss, bombs, fire bottles, the axe)
		return [ ...this.market.rows( ctx ), ...( ( wp && wp.marketRows && wp.marketRows( c ) ) || [] ), ...( ( fa && fa.marketRows && fa.marketRows( c ) ) || [] ) ];

	}

	marketAction( id ) {

		const ctx = this.marketCtx(), M = this.market;
		let r = { ok: false, reason: 'unknown' };
		if ( id.startsWith( 'wpn:' ) || id.startsWith( 'gun:' ) ) { // wave 18D: the fence's arms

			const c = M.canTrade( ctx );
			const f = this.features && this.features.get ? this.features.get( id.startsWith( 'wpn:' ) ? 'weapons' : 'firearms' ) : null;
			if ( ! c.ok ) return c;
			return f && f.marketAction ? f.marketAction( id, c ) : r;

		}
		if ( id.startsWith( 'sell:' ) ) {

			r = M.sell( id.slice( 5 ), 'all', ctx );
			if ( r.ok ) this._emit( 'contrabandSold', { good: id.slice( 5 ), qty: r.qty, total: r.total, port: 'blackwater' } );

		}
		else if ( id === 'buy:powder' ) r = M.buyPowder( 1, ctx );
		else if ( id === 'buy:shot' ) r = M.buyShot( ctx );
		else if ( id === 'flag' ) {

			r = M.buyFlag( ctx );
			if ( r.ok ) { this.blackFlag = true; this._emit( 'blackFlagBought', { price: r.total } ); }

		} else if ( id === 'chart' ) r = M.buyChart( ctx );
		else if ( id.startsWith( 'crew:' ) ) r = M.hireCrew( id.slice( 5 ), ctx );
		else if ( id === 'sellship' ) {

			const c = M.canTrade( ctx ), hj = this.features && this.features.get ? this.features.get( 'hijack' ) : null;
			r = ! c.ok ? c : hj && hj.sellStolen ? hj.sellStolen() : { ok: false, reason: 'noShip' };
			if ( r.ok ) M.sold += r.total || 0;

		}

		return r;

	}

	// a round at the Rum Hole: a little standing with the brotherhood (once a day) and the talk of the place
	drink() {

		if ( this.holder !== 'pirates' || this.alarm.state === 'alarm' ) return { ok: false, reason: this.holder !== 'pirates' ? 'closed' : 'alarm' };
		const T = this.R.tavern, st = this.state;
		if ( st && st.spend && ! st.spend( T.price ) ) return { ok: false, reason: 'money' };
		const day = Math.floor( this.hours / 24 );
		let gain = 0;
		if ( this.drinkDay !== day ) {

			this.drinkDay = day;
			const p = this.pirates;
			if ( p && p._heat ) { p._heat( 0, T.standing ); gain = T.standing; }

		}

		const s = this.standing(), gate = this.market.rules.standingGate;
		this.toast( this.friendly() ? 'The Rum Hole drinks to you · the guns hold fire for friends of the brotherhood'
			: `The Rum Hole eyes you · "Fly the black flag, or earn the brotherhood's trust (${ Math.max( 0, Math.ceil( gate - s ) ) } more)"`, 4200 );
		return { ok: true, gain };

	}

	// ------------------------------------------------------------------ interactables, the map

	_registerInteractables() {

		const f = this.features;
		if ( ! f || ! f.interactable ) return;
		const L = this.L, y = ( p ) => ( this.terrain && this.terrain.heightAt ? Math.max( 0, this.terrain.heightAt( p.x, p.z ) ) : 0 );
		const front = ( b, d ) => ( { x: b.x + Math.sin( b.yaw ) * d, z: b.z + Math.cos( b.yaw ) * d } );
		const bm = L.town.find( ( b ) => b.kind === 'market' ), tv = L.town.find( ( b ) => b.kind === 'tavern' );
		const fence = front( bm, bm.d / 2 + 2.2 ), bar = front( tv, tv.d / 2 + 1.2 );
		this._removers.push( f.interactable( {
			id: 'stronghold:flag', position: () => ( { x: L.flag.x, y: y( L.flag ), z: L.flag.z } ), radius: this.R.lootRadius,
			when: () => this.holder === 'pirates' && this.onFoot() && this.claimable().ok,
			prompt: () => 'Claim Blackwater', onInteract: () => { this.claim(); },
		} ) );
		this._removers.push( f.interactable( {
			id: 'stronghold:market', position: () => ( { x: fence.x, y: y( fence ), z: fence.z } ), radius: 3,
			when: () => this.holder === 'pirates' && this.onFoot(), prompt: () => 'Black market', onInteract: () => { this.panel.open(); },
		} ) );
		this._removers.push( f.interactable( {
			id: 'stronghold:tavern', position: () => ( { x: bar.x, y: y( bar ), z: bar.z } ), radius: 3,
			when: () => this.holder === 'pirates' && this.onFoot(), prompt: () => `A round at the Rum Hole ($${ this.R.tavern.price })`, onInteract: () => { this.drink(); },
		} ) );

	}

	// the batteries' reach for the world map (pirates.searchZones adds these), once the island is known
	zones() {

		if ( ! this.discovered ) return [];
		return this.batteries.list.map( ( b ) => ( {
			id: 'battery-' + b.id, kind: 'battery', x: Math.round( b.x ), z: Math.round( b.z ), r: this.batteries.rules.range,
			label: cap( b.name ) + ( b.silenced ? ' (silenced)' : '' ), silenced: b.silenced, held: this.holder === 'pirates',
		} ) );

	}

	_discover( pl ) {

		if ( this.discovered || ! pl ) return;
		const c = this.L.center;
		if ( Math.hypot( pl.x - c.x, pl.z - c.z ) > this.R.discover ) return;
		this.discovered = true;
		const st = this.state;
		if ( st && st.discover ) st.discover( 'blackwater' );
		this.toast( 'Blackwater: a pirate island · its batteries reach about 220 m', 4200 );
		this._emit( 'strongholdDiscovered', {} );

	}

	_mapMarker() {

		if ( ! this.discovered || this._marked ) return;
		const m = this._get( 'worldmap' );
		if ( ! m || ! m.addMarker ) return;
		this._marked = true;
		m.addMarker( { id: 'blackwater-fort', kind: 'pin', x: this.L.fort.x, z: this.L.fort.z, label: 'Blackwater fort', icon: 'flag', mine: true } );

	}

	_onRemote( e ) {

		const d = e.data || {};
		if ( e.kind === 'strongholdClaimed' ) this.claim( { remote: true } );
		else if ( e.kind === 'strongholdProp' && typeof d.id === 'string' && this.structs.has( d.id ) && ! this._owned( d.id ) ) this._break( d.id, 'remote', { remote: true } );

	}

	// ------------------------------------------------------------------ the frame

	_hostilePresent( pl, t ) {

		if ( this.holder !== 'pirates' || this.friendly() || ! pl ) return false;
		const L = this.L, R = this.R;
		if ( t && ! this.onFoot() ) {

			const dF = Math.hypot( t.x - L.fort.x, t.z - L.fort.z ), dE = Math.hypot( t.x - L.entrance.x, t.z - L.entrance.z ), dC = Math.hypot( t.x - L.cove.x, t.z - L.cove.z );
			return dF < R.watch || dE < R.watch * 0.6 || dC < L.cove.r + 40;

		}

		const dF = Math.hypot( pl.x - L.fort.x, pl.z - L.fort.z ), dT = Math.hypot( pl.x - L.town[ 0 ].x, pl.z - L.town[ 0 ].z );
		return dF < 40 || ( this.alarm.state === 'alarm' && Math.min( dF, dT ) < R.guardRange );

	}

	update( dt ) {

		if ( ! ( dt > 0 ) ) return;
		dt = Math.min( dt, 0.1 );
		if ( ! this.pirates ) {

			const s = this.app.settings;
			this._hours += dt * ( s && Number.isFinite( s.timeSpeed ) ? s.timeSpeed : DAY_SPEED );

		}

		if ( this.island ) {

			// once destruction owns the props it draws them; ours stay hidden
			if ( ! this._ownChecked && this.destruction && this.destruction.built ) {

				this._ownChecked = true;
				if ( this._owned( this.L.palisade[ 0 ].id ) ) this.island.setStructuresDrawn( false );

			}

			this.island.update( dt );
			if ( this.alarm.state !== 'alarm' ) this.island.setBell( 0 );

		}

		if ( this.app.paused ) return;
		const pl = this.playerPos();
		this._discover( pl );
		this._mapMarker();
		if ( this.holder === 'player' && this.hours - this.claimedAt >= this.R.restock ) this._retake();
		this._rebuild( pl );

		const t = this._target();
		const hostile = this._hostilePresent( pl, t );
		if ( hostile && this.alarm.state === 'calm' ) this.alarm.spot( this.onFoot() ? 'intruder' : 'sighted' );
		const ev = this.alarm.update( dt, hostile );
		if ( ev === 'bell' ) this._bell( this.alarm.why );
		else if ( ev === 'standDown' ) { this.toast( 'Blackwater stands down', 2400 ); this._emit( 'strongholdAlarm', { state: 'calm', why: 'standDown' } ); }

		if ( this.holder === 'pirates' ) {

			const shots = this.batteries.update( dt, t );
			if ( shots.length && this.alarm.raise( 'battery' ) ) this._bell( 'battery' );

		}

		this._guardsUpdate( dt, pl );
		this._shipsUpdate( pl );

	}

	view() {

		return {
			holder: this.holder, alarm: this.alarm.state, discovered: this.discovered, blackFlag: this.blackFlag, betrayed: this.betrayed,
			friendly: this.friendly(), claim: this.claimable(), guardsLeft: this.guardsLeft, ships: this.ships.map( ( s ) => ( { name: s.name, down: s.down, state: s.ship ? s.ship.state : null } ) ),
			batteries: this.batteries.list.map( ( b ) => ( { id: b.id, silenced: b.silenced, reload: Math.round( b.reload * 10 ) / 10, last: b.last || null } ) ),
		};

	}

	// ------------------------------------------------------------------ panel hooks

	isOpen() {

		return this.panel.isOpen;

	}

	close() {

		this.panel.close();

	}

	wantsMouse() {

		return this.panel.isOpen;

	}

	// ------------------------------------------------------------------ save / lifecycle

	toJSON() {

		return {
			v: 1, discovered: this.discovered, blackFlag: this.blackFlag, betrayed: this.betrayed, holder: this.holder,
			claimedAt: this.claimedAt, claims: this.claims, ransomed: [ ...this.ransomed ], guardsLeft: this.guardsLeft,
			down: this.ships.map( ( s ) => s.down ), drinkDay: this.drinkDay, hours: Math.round( this._hours * 100 ) / 100,
			broken: [ ...this.structs.values() ].filter( ( s ) => s.broken && ! this._owned( s.id ) ).map( ( s ) => [ s.id, Math.round( s.brokenAt * 100 ) / 100 ] ),
			batteries: this.batteries.toJSON(),
		};

	}

	fromJSON( d ) {

		this.reset();
		if ( ! d || typeof d !== 'object' ) return;
		this.discovered = d.discovered === true;
		this.blackFlag = d.blackFlag === true;
		this.betrayed = d.betrayed === true;
		this.holder = d.holder === 'player' && Number.isFinite( d.claimedAt ) ? 'player' : 'pirates';
		this.claimedAt = this.holder === 'player' ? d.claimedAt : null;
		this.claims = Number.isFinite( d.claims ) && d.claims >= 0 ? Math.floor( d.claims ) : 0;
		if ( Array.isArray( d.ransomed ) ) for ( const id of d.ransomed ) if ( CAPTAIN_BY_ID[ id ] ) this.ransomed.add( id );
		this.guardsLeft = Number.isFinite( d.guardsLeft ) ? Math.max( 0, Math.min( this.R.guardsMax, Math.floor( d.guardsLeft ) ) ) : null;
		if ( Array.isArray( d.down ) ) this.ships.forEach( ( s, i ) => { s.down = d.down[ i ] === true; } );
		this.drinkDay = Number.isFinite( d.drinkDay ) ? d.drinkDay : null;
		if ( Number.isFinite( d.hours ) && d.hours >= 0 ) this._hours = d.hours;
		if ( Array.isArray( d.broken ) ) for ( const e of d.broken ) {

			if ( ! Array.isArray( e ) || ! this.structs.has( e[ 0 ] ) ) continue;
			const s = this.structs.get( e[ 0 ] );
			s.broken = true;
			s.hp = 0;
			s.brokenAt = Number.isFinite( e[ 1 ] ) ? e[ 1 ] : 0;
			if ( this.island ) this.island.setBroken( s.id, true );

		}

		this.batteries.fromJSON( d.batteries );
		if ( this.island ) {

			for ( const b of this.batteries.list ) this.island.setSilenced( b.id, b.silenced );
			this.island.setFlag( this.holder );

		}

	}

	reset() {

		this.discovered = false;
		this.blackFlag = false;
		this.betrayed = false;
		this.holder = 'pirates';
		this.claimedAt = null;
		this.claims = 0;
		this.ransomed = new Set();
		if ( this.guards ) this._freshWatch(); else this.guardsLeft = null;
		this._beaten = 0;
		this.awake = false;
		this.drinkDay = null;
		this._marked = false;
		this._castOffToast = false;
		this.alarm.reset();
		this.batteries.fromJSON( null );
		for ( const s of this.structs.values() ) { s.broken = false; s.hp = s.def.toughness; s.brokenAt = 0; }
		if ( this.guards ) this._putAway();
		if ( this.ships ) for ( const sl of this.ships ) {

			if ( sl.ship && sl.ship.alive ) sl.ship.state = 'gone';
			sl.ship = null;
			sl.down = false;
			sl.lastHp = null;

		}

		if ( this.island ) {

			for ( const id of this.structs.keys() ) this.island.setBroken( id, false );
			for ( const b of this.batteries.list ) this.island.setSilenced( b.id, false );
			this.island.setFlag( 'pirates' );
			this.island.setBell( 0 );

		}

		if ( this.panel ) this.panel.close();

	}

	dispose() {

		for ( const off of this._offs ) if ( off ) off();
		this._offs.length = 0;
		for ( const off of this._removers ) if ( off ) off();
		this._removers.length = 0;
		const m = this.melee;
		for ( const r of this.guards ) {

			if ( ! r ) continue;
			if ( m && Array.isArray( m.raiders ) ) {

				const i = m.raiders.indexOf( r );
				if ( i >= 0 ) m.raiders.splice( i, 1 );

			}

			if ( r.dispose ) r.dispose();

		}

		this.panel.dispose();
		if ( this.island ) this.island.dispose();

	}

}

export function install( app, features, opts = {} ) {

	return new Stronghold( app, features, { ...( app && app.strongholdOptions ), ...opts } );

}

export default { install };

// Pirate dens (Unreal PirateDenComponent / PirateDenLootComponent, parity V9): a camp on the far shore of every island but the
// home island, read from WORLD.islands each time the list grows (islands 5-8 get dens as they land), each kept by one of the
// hostile named captains, with her ship at a mooring offshore and a few guards ashore.
//
//   const d = new Dens( pirates );   d.list  d.update( dt )   d.byId( id )   d.zones() (found dens, for the world map)
//   d.defeatGuard( den )   (tests / no melee)   d.raid( den, { remote } )   d.toJSON() / fromJSON( d ) / reset() / dispose()
//
// The raid: come ashore near a held den and its guards (melee Raider instances, so the player's blows, guard and evade are
// melee's own) come at you. With them down, E at the camp loots it: coins, and cargo crates through trade.addCargo. A raided
// den restocks after RESTOCK in-game hours (longer once its keeper is dead or in irons). While the player is near a held den,
// the keeper's ship lies at the mooring (state 'moored'); she casts off and hunts when the player comes close or she is hit.
// Raiding is retaliated (Retaliation.js) and shared in multiplayer (sendWorldEvent 'denRaided').
// Wave 4: the raiders of the old home-island camp live here now. Guards fight with the keeper's tier (melee TIERS: a tier 1
// keeper's crew telegraphs slowly, a tier 4-5 keeper's is quick and flanks), one more stands watch at night, and they share
// melee's two attack tokens (the rest circle), so a den raid is the real fight the peaceful home island no longer has.
// Wave 15C: the keeper's mooring lies outside every port's calm circle (naval/Routes.js CALM.port, 250 m round each dock): on
// the small islands the camp is close to the jetty, so the mooring is pushed further out along the same line (MOOR_CLEAR m past
// the circle's edge). The camp and its fight ashore are where they were.

import { WORLD } from '../../world/WorldLayout.js';
import { Raider } from '../melee/Raider.js';
import { RAIDER, yawToward, tierCfg } from '../melee/MeleeData.js';
import { CREW_TWEAK, CREW_NAMES, CREW_CHARACTERS, RULES as BOARD_RULES } from '../boarding/BoardingData.js';
import { CAPTAINS, CAPTAIN_BY_ID } from './Roster.js';
import { inSafeZone } from '../naval/Routes.js';

const MOOR_CLEAR = 20; // m past a calm circle's edge

export const DEN_RULES = {
	restock: 72, // in-game hours before a raided den is held again
	restockOrphan: 120, // ... once its keeper is gone
	guards: [ 2, 4 ], // min / max guards (by the keeper's crew size)
	guardRange: 140, // m: guards are put out when the player is this close
	shipRange: 520, // m: the keeper's ship lies at the mooring within this
	wakeRange: 190, // m: the moored ship casts off when the player comes this close at sea
	dropRange: 760, // m: beyond this the moored ship is sent away again
	discover: 320, // m: a den is marked on the map once the player has been this close
	lootRadius: 4.5,
	coins: [ 260, 120 ], // base + per keeper tier
	cargo: BOARD_RULES.plunderCargo,
};

// the camp's rules for its guards; hp, damage and the wind-up come from the tier (CREW_TWEAK's numbers are tier 1's)
const GUARD_TWEAK = { flees: 0, downTime: CREW_TWEAK.downTime, loot: 0, radius: CREW_TWEAK.radius, leash: 32, lose: 40, notice: 16 };

// the melee tier of a keeper's guards from her catalog tier (1..5)
export const guardTier = ( keeperTier ) => ( keeperTier <= 1 ? 1 : keeperTier <= 3 ? 2 : 3 );

// the keeper of each den: the hostile captains in catalog order, round robin
const KEEPERS = CAPTAINS.filter( ( c ) => c.hostile );

// a camp on the shore facing away from the island's port (or away from the home island), and a deep mooring off it
export function denSite( island, terrain, port = null ) {

	const c = island.center, R = island.radius;
	let dx, dz;
	if ( port && port.dock && port.dock.position ) {

		dx = c.x - port.dock.position.x;
		dz = c.z - port.dock.position.z;

	} else {

		const home = WORLD.islands[ 0 ] ? WORLD.islands[ 0 ].center : { x: 0, z: 0 };
		dx = c.x - home.x;
		dz = c.z - home.z;

	}

	const l = Math.hypot( dx, dz ) || 1;
	dx /= l;
	dz /= l;
	// the mooring goes out along the line until it is clear of every calm circle (no pirate is put to sea inside one)
	const clear = ( r ) => {

		while ( r < R + 600 && inSafeZone( c.x + dx * r, c.z + dz * r, null, MOOR_CLEAR ) ) r += 10;
		return r;

	};
	if ( ! terrain || ! terrain.heightAt ) {

		const mr = clear( R + 70 );
		return { x: c.x + dx * R * 0.8, z: c.z + dz * R * 0.8, mx: c.x + dx * mr, mz: c.z + dz * mr, yaw: Math.atan2( dx, dz ) };

	}

	// walk out from the centre: the last dry point is the beach, the first deep one past it the mooring
	let shore = null;
	for ( let r = 0; r <= R * 1.8; r += 4 ) {

		const h = terrain.heightAt( c.x + dx * r, c.z + dz * r );
		if ( h > 0.6 ) shore = r;
		else if ( shore !== null && r - shore > 24 ) break;

	}

	if ( shore === null ) shore = R * 0.8;
	// a few metres up the beach, on dry ground (a bumpy shore can dip below the waterline just inside the last dry point)
	let camp = Math.max( 0, shore - 7 );
	while ( camp > 0 && terrain.heightAt( c.x + dx * camp, c.z + dz * camp ) < 0.5 ) camp -= 3;
	camp = Math.max( 0, camp );
	let moor = shore + 60;
	for ( let r = shore + 20; r <= shore + 260; r += 10 ) {

		if ( terrain.heightAt( c.x + dx * r, c.z + dz * r ) < - 5 ) { moor = r + 20; break; }

	}

	moor = clear( moor );

	return { x: c.x + dx * camp, z: c.z + dz * camp, mx: c.x + dx * moor, mz: c.z + dz * moor, yaw: Math.atan2( dx, dz ) };

}

// the owner the den guards are built with (like boarding's DeckHost): the real terrain, melee's target, token and strikes
class DenHost {

	constructor( dens ) {

		this.d = dens;
		this.raiders = [];

	}

	get m() {

		return this.d.p.melee;

	}

	get terrain() {

		return this.d.p.terrain;

	}

	get colliders() {

		return this.m ? this.m.colliders : null;

	}

	get peaceful() {

		return !! ( this.m && this.m.peaceful );

	}

	rand() {

		return this.d.p.rng();

	}

	target() {

		return this.m ? this.m.target() : { x: 0, y: 0, z: 0, valid: false };

	}

	tokenFree( r ) {

		return this.m ? this.m.tokenFree( r ) : true;

	}

	takeToken( r ) {

		if ( this.m ) this.m.takeToken( r );

	}

	releaseToken( r ) {

		if ( this.m ) this.m.releaseToken( r );

	}

	raiderStrike( r ) {

		return this.m ? this.m.raiderStrike( r ) : 'missed';

	}

	onWindup( r ) {

		if ( this.m && this.m.onWindup ) this.m.onWindup( r );

	}

	onAggro( r ) {

		if ( this.m && this.m.onAggro ) this.m.onAggro( r );

	}

	onDefeated( r ) {

		const den = this.d.list.find( ( x ) => x.guards.includes( r ) );
		if ( den ) this.d.defeatGuard( den, r );

	}

	far( r ) {

		return this.m && this.m.far ? this.m.far( r ) : false;

	}

}

export class Dens {

	constructor( pirates ) {

		this.p = pirates;
		this.list = [];
		this.host = new DenHost( this );
		this.found = new Set();
		this._islands = - 1;
		this._removers = [];
		this._lootT = 0;
		this.sync();

	}

	byId( id ) {

		return this.list.find( ( d ) => d.id === id ) || null;

	}

	// (re)build the den list when WORLD.islands has changed; keeps the state of dens that already exist
	sync() {

		const islands = WORLD.islands || [];
		if ( islands.length === this._islands ) return;
		this._islands = islands.length;
		const old = new Map( this.list.map( ( d ) => [ d.id, d ] ) );
		const out = [];
		let k = 0;
		for ( const isl of islands ) {

			if ( ! isl || ! isl.id || isl.id === 'home' || ! isl.center ) continue;
			if ( isl.den === false ) continue; // an island with its own stronghold (Blackwater) has no den camp
			const id = 'den-' + isl.id;
			if ( old.has( id ) ) { out.push( old.get( id ) ); k ++; continue; }
			const port = ( WORLD.ports || [] ).find( ( p ) => p.id === isl.id ) || null;
			const site = denSite( isl, this.p.terrain, port );
			const keeper = KEEPERS[ k ++ % KEEPERS.length ];
			const name = `${ keeper.captain }'s den`;
			out.push( {
				id, island: isl.id, name, keeper: keeper.id, x: site.x, z: site.z, mx: site.mx, mz: site.mz, yaw: site.yaw,
				guardsMax: Math.max( DEN_RULES.guards[ 0 ], Math.min( DEN_RULES.guards[ 1 ], Math.ceil( keeper.crew / 2 ) ) ),
				guardsLeft: 0, guards: [], awake: false, ship: null,
			} );

		}

		this.list = out;
		for ( const d of this.list ) if ( ! d.awake ) d.guardsLeft = d.guardsMax;
		this._registerInteractables();

	}

	_registerInteractables() {

		for ( const off of this._removers ) off();
		this._removers.length = 0;
		const f = this.p.features;
		if ( ! f || ! f.interactable ) return;
		for ( const d of this.list ) {

			this._removers.push( f.interactable( {
				id: `pirates:${ d.id }`,
				position: () => ( { x: d.x, y: this.p.groundY( d.x, d.z ), z: d.z } ),
				radius: DEN_RULES.lootRadius,
				when: () => this.held( d ) && d.guardsLeft <= 0 && this.p.onFoot(),
				prompt: () => `Loot ${ d.name }`,
				onInteract: () => { this.raid( d ); },
			} ) );

		}

	}

	// the den is stocked and guarded (not raided lately)
	held( d ) {

		const r = this.p.ledger.dens[ d.id ];
		if ( ! r ) return true;
		const keeperGone = ! this.p.ledger.isFree( d.keeper );
		return this.p.hours - r.raidedDay >= ( keeperGone ? DEN_RULES.restockOrphan : DEN_RULES.restock );

	}

	coinsFor( d ) {

		const c = CAPTAIN_BY_ID[ d.keeper ];
		return Math.round( ( DEN_RULES.coins[ 0 ] + DEN_RULES.coins[ 1 ] * ( c ? c.tier : 1 ) ) * ( 0.85 + 0.3 * this.p.rng() ) / 5 ) * 5;

	}

	// one guard down (melee's onDefeated through the host, or by hand without melee)
	defeatGuard( d, r = null ) {

		if ( d.guardsLeft <= 0 ) return;
		d.guardsLeft --;
		this.p._onCrewBeaten( { den: d, name: r ? r.name : 'a guard', keeper: d.keeper } );
		if ( d.guardsLeft <= 0 ) this.p.toast( `The camp is yours · loot ${ d.name } (E)`, 3600 );

	}

	// loot the den (the E interactable); remote: another player raided it (no loot, no retaliation here)
	raid( d, { remote = false, from = null } = {} ) {

		if ( ! d || ! this.held( d ) ) return null;
		this.p.ledger.denRaided( d.id, this.p.hours );
		this._putAway( d );
		d.guardsLeft = d.guardsMax;
		if ( remote ) {

			this.p.toast( `Word comes that ${ d.name } was raided`, 3000 );
			return { id: d.id, remote: true };

		}

		const coins = this.coinsFor( d );
		this.p.earn( coins );
		const goods = [], tr = this.p.trade;
		let stowed = 0;
		const n = 1 + Math.floor( this.p.rng() * 2 );
		for ( let i = 0; i < n; i ++ ) {

			const good = DEN_RULES.cargo[ Math.floor( this.p.rng() * DEN_RULES.cargo.length ) % DEN_RULES.cargo.length ];
			const qty = 2 + Math.floor( this.p.rng() * 3 );
			goods.push( { good, qty } );
			if ( tr && tr.addCargo ) stowed += tr.addCargo( good, qty, { paid: 0 } ) || 0;

		}

		this.found.add( d.id );
		const res = { id: d.id, island: d.island, name: d.name, keeper: d.keeper, captain: CAPTAIN_BY_ID[ d.keeper ].captain, coins, goods, stowed };
		this.p.toast( `Raided ${ d.name } · +$${ coins }${ stowed ? ` and ${ stowed } crate${ stowed > 1 ? 's' : '' }` : '' }`, 4200 );
		this.p._onDenRaided( d, res, from );
		return res;

	}

	// ---- guards

	_guard( d, i ) {

		if ( d.guards[ i ] ) return d.guards[ i ];
		const m = this.p.melee, factory = this.p.avatarFactory || ( m && m.avatarFactory );
		if ( ! m || ! factory || ! Array.isArray( m.raiders ) ) return null;
		const mine = this.p.app.avatar && this.p.app.avatar.character;
		const chars = CREW_CHARACTERS.filter( ( c ) => c !== mine );
		const character = chars[ ( i + d.id.length ) % chars.length ];
		let avatar = null;
		try { avatar = factory( { scene: this.p.app.scene, character, lite: true } ); } catch ( e ) { return null; }
		const r = new Raider( this.host, { id: `${ d.id }-guard-${ i }`, x: d.x, z: d.z, when: 'day', characters: [ character ] }, avatar );
		r.active = false;
		r.visible = false;
		d.guards[ i ] = r;
		this.host.raiders.push( r );
		if ( ! m.raiders.includes( r ) ) m.raiders.push( r );
		return r;

	}

	_putOut( d ) {

		d.awake = true;
		// one more on watch at night (a full camp only: beaten guards stay beaten)
		if ( this.p.night && d.guardsLeft === d.guardsMax ) d.guardsLeft ++;
		const n = d.guardsLeft;
		if ( ! this.p.melee ) return; // no melee: the guards give up the camp when the player arrives (see update)
		const keeper = CAPTAIN_BY_ID[ d.keeper ], tier = guardTier( keeper ? keeper.tier : 1 );
		for ( let i = 0; i < n; i ++ ) {

			const r = this._guard( d, i );
			if ( ! r ) continue;
			const a = d.yaw + ( i - ( n - 1 ) / 2 ) * 0.9;
			r.homeX = d.x - Math.sin( a ) * 3.5;
			r.homeZ = d.z - Math.cos( a ) * 3.5;
			r.homeYaw = yawToward( r.homeX, r.homeZ, d.x + Math.sin( d.yaw ) * 30, d.z + Math.cos( d.yaw ) * 30 );
			// the last guard of a strong keeper's camp is her mate: one tier up
			const t = Math.min( 4, tier + ( i === n - 1 && keeper && keeper.tier >= 4 ? 1 : 0 ) );
			r.spawn( { name: CREW_NAMES[ ( i * 3 + d.id.length ) % CREW_NAMES.length ], tier: t } );
			r.cfg = { ...tierCfg( RAIDER, t ), ...GUARD_TWEAK };
			r.maxHp = r.hp = r.cfg.hp;
			r._ground();
			r._place();

		}

	}

	_putAway( d ) {

		d.awake = false;
		for ( const r of d.guards ) if ( r && r.active ) r.deactivate();

	}

	// ---- the keeper's ship at the mooring

	_mooringRoute( d ) {

		const T = this.p.terrain;
		const pts = [ 0, 1, 2, 3 ].map( ( i ) => [ d.mx + Math.sin( d.yaw + i * Math.PI / 2 ) * 90, d.mz + Math.cos( d.yaw + i * Math.PI / 2 ) * 90 ] )
			.filter( ( q ) => ! T || T.heightAt( q[ 0 ], q[ 1 ] ) < - 4 );
		return pts.length >= 2 ? pts : null;

	}

	_ship( d, pl ) {

		const s = d.ship;
		if ( s && ( ! s.alive || ! this.p.naval || ! this.p.naval.ships.includes( s ) ) ) d.ship = null;
		const dist = pl ? Math.hypot( pl.x - d.mx, pl.z - d.mz ) : 1e9;
		if ( ! d.ship ) {

			const mine = this.p.roster.shipOf( d.keeper );
			if ( mine && mine.denGuard === d.id ) { d.ship = mine; return; }
			if ( dist > DEN_RULES.shipRange || ! this.held( d ) || ! this.p.navalActive() ) return;
			if ( ! this.p.ledger.isFree( d.keeper ) || this.p.roster.shipOf( d.keeper ) ) return;
			const route = this._mooringRoute( d );
			const ns = this.p.roster.spawn( d.keeper, { x: d.mx, z: d.mz, yaw: d.yaw + Math.PI / 2, route: route || undefined, state: 'moored', speed: 0 } );
			if ( ! ns ) return;
			ns.denGuard = d.id;
			ns.state = 'moored';
			d.ship = ns;
			return;

		}

		if ( s.state === 'moored' ) {

			s.wantSpeed = 0;
			const hit = s.hp < ( s._lastHp ?? s.hp );
			const legal = this.p.playerAtSea() && dist < DEN_RULES.wakeRange;
			if ( hit || legal ) {

				s.setState ? s.setState( 'patrol' ) : ( s.state = 'patrol' );
				s.alertT = Math.max( s.alertT || 0, 40 );
				this.p.toast( `The ${ s.name } slips her mooring`, 2600 );

			} else if ( dist > DEN_RULES.dropRange ) s.state = 'gone';

		} else if ( s.state === 'patrol' && dist > DEN_RULES.dropRange ) s.state = 'gone';

	}

	update( dt ) {

		this.sync();
		const pl = this.p.playerPos();
		for ( const d of this.list ) {

			const dist = pl ? Math.hypot( pl.x - d.x, pl.z - d.z ) : 1e9;
			if ( dist < DEN_RULES.discover && ! this.found.has( d.id ) ) {

				this.found.add( d.id );
				this.p.toast( `You spot ${ d.name } on the shore of ${ this.p.islandName( d.island ) }`, 3600 );

			}

			if ( this.held( d ) ) {

				if ( dist < DEN_RULES.guardRange && ! d.awake && this.p.onFoot() ) this._putOut( d );
				else if ( d.awake && dist > DEN_RULES.guardRange * 1.5 ) {

					this._putAway( d );
					if ( d.guardsLeft > 0 ) d.guardsLeft = d.guardsMax; // they regroup while you are away

				}

				// no melee feature: the guards run when the player walks into the camp
				if ( d.awake && ! this.p.melee && dist < 12 && d.guardsLeft > 0 ) while ( d.guardsLeft > 0 ) this.defeatGuard( d );

			}

			this._ship( d, pl );
			if ( d.ship ) d.ship._lastHp = d.ship.hp;

		}

	}

	// found dens for the world map
	zones() {

		return this.list.filter( ( d ) => this.found.has( d.id ) ).map( ( d ) => ( {
			id: d.id, kind: 'den', x: Math.round( d.x ), z: Math.round( d.z ), r: 60, label: d.name, held: this.held( d ),
			keeper: CAPTAIN_BY_ID[ d.keeper ].captain,
		} ) );

	}

	toJSON() {

		return { found: [ ...this.found ] };

	}

	fromJSON( d ) {

		this.found = new Set( d && Array.isArray( d.found ) ? d.found.filter( ( x ) => typeof x === 'string' ).slice( 0, 64 ) : [] );

	}

	reset() {

		this.found.clear();
		for ( const d of this.list ) {

			this._putAway( d );
			d.guardsLeft = d.guardsMax;
			if ( d.ship && d.ship.alive ) d.ship.state = 'gone';
			d.ship = null;

		}

	}

	dispose() {

		for ( const off of this._removers ) off();
		this._removers.length = 0;
		const m = this.p.melee;
		for ( const d of this.list ) for ( const r of d.guards ) {

			if ( ! r ) continue;
			if ( m && Array.isArray( m.raiders ) ) {

				const i = m.raiders.indexOf( r );
				if ( i >= 0 ) m.raiders.splice( i, 1 );

			}

			if ( r.dispose ) r.dispose();

		}

	}

}

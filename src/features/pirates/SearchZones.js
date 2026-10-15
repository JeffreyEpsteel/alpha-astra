// Tier 4-5 bounties with search zones (parity Q4: five tiers, search zones, informants, capture proof, failure states, rival
// hunters). The notice boards post tiers 1-3 (notices feature); the dread captains of the roster are wanted on a separate poster
// beside each board. A contract gives no position, only a search zone (a circle on the world map) that holds the captain somewhere
// inside it. Informants narrow it: calling at a port, meeting a smuggler with the 'informant' trait at sea, sinking any pirate.
// The captain is put to sea when you come within reach of her true position; she patrols there (tier 5 brings a consort sloop).
//
//   const z = new SearchZones( pirates );   z.contracts  z.active()  z.accept( id ) -> contract | null (z.lastError)   z.zones()
//   z.update( dt )   z.onShipSunk( e ) / onCaptured( captainId ) / onPortVisited( e ) / onBoatSunk( e ) / tip( why )
//   z.toJSON() / fromJSON( d ) / reset() / dispose()
//
// Proof and pay: sunk -> the reward; taken alive (boarding's prisonerTaken) -> the reward x CAPTURE_MULT. Failure: the contract
// expires, a rival hunter brings her in first (each free 'rival' captain has a small chance per in-game hour while you are not on
// her), she escapes three times, or she sinks your boat. Events (through pirates): bountyClaimed { id, target, reward, tier, proof }
// (the shared vocabulary), highBountyAccepted { id, target, tier, zone }, highBountyFailed { id, target, reason }.

import { BOARD_SITES } from '../notices/Sites.js';
import { WORLD } from '../../world/WorldLayout.js';
import { PATROLS, inSafeZone, nearHome } from '../naval/Routes.js';
import { CAPTAINS, CAPTAIN_BY_ID, hasTrait } from './Roster.js';

export const HB_RULES = {
	reward: { 4: 4000, 5: 6500 },
	life: { 4: 60, 5: 72 }, // in-game hours a contract runs (posted or taken)
	radius: { 4: 380, 5: 460 },
	minRadius: 130,
	narrow: 0.7,
	captureMult: 1.5,
	need: { 4: 1, 5: 2 }, // named captains the player must have sunk or taken first (or, for tier 4, 3 pirate ships of any kind)
	spawnReach: 420, // m from the true position at which the captain is put to sea
	dropReach: 950,
	rivalPerHour: 0.004, // chance per free rival per in-game hour that she claims a contract you are not working
	escapes: 3,
	informantReach: 130,
};

export const CAPTURE_MULT = HB_RULES.captureMult;
const TARGETS = CAPTAINS.filter( ( c ) => c.hostile && c.tier >= 4 );

export class SearchZones {

	constructor( pirates ) {

		this.p = pirates;
		this.lastError = '';
		this._removers = [];
		this.reset();
		this._registerPosters();

	}

	reset() {

		this.contracts = []; // { id, captain, tier, reward, port, posted, expires, state: 'posted' | 'active', zone, truth, tips, escapes, ship }
		this._n = 0;
		this._hour = null;
		this._tipped = new Set();

	}

	active() {

		return this.contracts.find( ( c ) => c.state === 'active' ) || null;

	}

	reserved( captainId ) {

		return this.contracts.some( ( c ) => c.state === 'active' && c.captain === captainId );

	}

	eligible( tier ) {

		const L = this.p.ledger;
		return L.namedTaken >= HB_RULES.need[ tier ] || ( tier === 4 && L.counts.sunk + L.counts.captured >= 3 );

	}

	// ---- posting

	_post( port ) {

		const taken = new Set( this.contracts.map( ( c ) => c.captain ) );
		const list = TARGETS.filter( ( c ) => this.p.ledger.isFree( c.id ) && ! taken.has( c.id ) );
		if ( ! list.length ) return null;
		const c = list[ Math.floor( this.p.rng() * list.length ) % list.length ];
		const k = {
			id: `hb-${ c.id }-${ ++ this._n }`, captain: c.id, tier: c.tier, reward: HB_RULES.reward[ c.tier ], port,
			posted: this.p.hours, expires: this.p.hours + HB_RULES.life[ c.tier ], state: 'posted',
			zone: null, truth: null, tips: 0, escapes: 0, ship: null,
		};
		this.contracts.push( k );
		return k;

	}

	_ports() {

		return Object.keys( BOARD_SITES );

	}

	_posterAt( port ) {

		const s = BOARD_SITES[ port ];
		if ( ! s ) return null;
		const side = port === 'home' ? - 1 : 1; // away from the fish stall
		return { x: s.x + Math.cos( s.yaw ) * 1.9 * side, z: s.z - Math.sin( s.yaw ) * 1.9 * side };

	}

	_registerPosters() {

		const f = this.p.features;
		if ( ! f || ! f.interactable ) return;
		for ( const port of this._ports() ) {

			const at = this._posterAt( port );
			if ( ! at ) continue;
			this._removers.push( f.interactable( {
				id: `pirates:wanted:${ port }`,
				position: () => ( { x: at.x, y: this.p.groundY( at.x, at.z ), z: at.z } ),
				radius: 2.2,
				when: () => this.p.onFoot() && !! this._forPort( port ),
				prompt: () => this._posterPrompt( port ),
				onInteract: () => this._posterUse( port ),
			} ) );

		}

	}

	_forPort( port ) {

		return this.contracts.find( ( c ) => c.state === 'active' && c.port === port ) || this.contracts.find( ( c ) => c.state === 'posted' && c.port === port ) || null;

	}

	_posterPrompt( port ) {

		const k = this._forPort( port );
		if ( ! k ) return null;
		const c = CAPTAIN_BY_ID[ k.captain ];
		if ( k.state === 'active' ) return `Wanted: ${ c.captain } · search the marked waters`;
		if ( ! this.eligible( k.tier ) ) return `Wanted (tier ${ k.tier }): ${ c.captain } · not for a newcomer`;
		return `Wanted (tier ${ k.tier }): ${ c.captain }, ${ c.ship } · $${ k.reward }`;

	}

	_posterUse( port ) {

		const k = this._forPort( port );
		if ( ! k ) return;
		const c = CAPTAIN_BY_ID[ k.captain ];
		if ( k.state === 'active' ) {

			const left = Math.max( 0, Math.round( k.expires - this.p.hours ) );
			this.p.toast( `${ c.captain }: search zone ${ Math.round( k.zone.r ) } m across the marked waters · ${ left } h left · alive pays x${ CAPTURE_MULT }`, 4200 );
			return;

		}

		if ( this.accept( k.id ) ) this.p.toast( `Contract taken: ${ c.captain } of the ${ c.ship } · the search zone is on your map (M)`, 4200 );
		else this.p.toast( this.lastError, 3200 );

	}

	accept( id ) {

		const k = this.contracts.find( ( c ) => c.id === id );
		this.lastError = '';
		if ( ! k || k.state !== 'posted' ) { this.lastError = 'That contract is gone.'; return null; }
		if ( this.active() ) { this.lastError = 'Finish the contract you hold first.'; return null; }
		if ( ! this.eligible( k.tier ) ) {

			this.lastError = `Sink or take ${ HB_RULES.need[ k.tier ] } named captain${ HB_RULES.need[ k.tier ] > 1 ? 's' : '' } first; the harbour will not trust you with this one yet.`;
			return null;

		}

		if ( ! this.p.ledger.isFree( k.captain ) ) { this.lastError = 'Someone got there first.'; return null; }
		k.state = 'active';
		k.expires = this.p.hours + HB_RULES.life[ k.tier ];
		k.truth = this._hideout( k );
		const c = CAPTAIN_BY_ID[ k.captain ];
		const r = HB_RULES.radius[ k.tier ] * ( hasTrait( c, 'cunning' ) ? 1.25 : 1 );
		k.zone = this._zoneAround( k.truth, r );
		this._tipped = new Set();
		// she may be at sea already: take her over
		const s = this.p.roster.shipOf( k.captain );
		if ( s ) { s.highBounty = k.id; k.ship = s; k.truth = { x: s.x, z: s.z }; }
		this.p._emitHighBounty( 'highBountyAccepted', { id: k.id, target: c.captain, tier: k.tier, zone: { ...k.zone } } );
		return k;

	}

	// a deep-water spot off a den mooring, an island or a patrol lane, out of the harbours
	_hideout( k ) {

		const T = this.p.terrain, rng = this.p.rng;
		const spots = [];
		for ( const d of this.p.dens.list ) spots.push( [ d.mx, d.mz ] );
		for ( const isl of WORLD.islands || [] ) if ( isl.id !== 'home' ) spots.push( [ isl.center.x + isl.radius * 1.6, isl.center.z + isl.radius * 0.4 ] );
		for ( const r of PATROLS ) for ( const q of r ) spots.push( q );
		for ( let tries = 0; tries < 40; tries ++ ) {

			const b = spots[ Math.floor( rng() * spots.length ) % spots.length ];
			const a = rng() * Math.PI * 2, d = 40 + rng() * 140;
			const x = b[ 0 ] + Math.sin( a ) * d, z = b[ 1 ] + Math.cos( a ) * d;
			if ( inSafeZone( x, z ) || nearHome( x, z ) ) continue; // (wave 15C: never in calm water or within 600 m of home)
			if ( T && T.heightAt && [ [ 0, 0 ], [ 30, 0 ], [ - 30, 0 ], [ 0, 30 ], [ 0, - 30 ] ].some( ( o ) => T.heightAt( x + o[ 0 ], z + o[ 1 ] ) > - 5 ) ) continue;
			return { x, z };

		}

		const q = PATROLS[ k.tier % PATROLS.length ][ 0 ];
		return { x: q[ 0 ], z: q[ 1 ] };

	}

	_zoneAround( t, r ) {

		const a = this.p.rng() * Math.PI * 2, d = this.p.rng() * r * 0.55;
		return { x: t.x + Math.sin( a ) * d, z: t.z + Math.cos( a ) * d, r };

	}

	// an informant's word: the circle shrinks and slides toward the truth
	tip( why = 'tip' ) {

		const k = this.active();
		if ( ! k || ! k.zone ) return false;
		const z = k.zone, t = k.truth;
		const r = Math.max( HB_RULES.minRadius, z.r * HB_RULES.narrow );
		let x = z.x + ( t.x - z.x ) * 0.5, zz = z.z + ( t.z - z.z ) * 0.5;
		const off = Math.hypot( t.x - x, t.z - zz ), lim = r * 0.55;
		if ( off > lim ) { x = t.x + ( x - t.x ) * lim / off; zz = t.z + ( zz - t.z ) * lim / off; }
		k.zone = { x, z: zz, r };
		k.tips ++;
		const c = CAPTAIN_BY_ID[ k.captain ];
		this.p.toast( `${ why }: ${ c.captain } was seen nearer ${ this._near( k.zone ) } · search zone narrowed`, 3600 );
		return true;

	}

	_near( z ) {

		let best = null, bd = Infinity;
		for ( const isl of WORLD.islands || [] ) {

			const d = Math.hypot( isl.center.x - z.x, isl.center.z - z.z ) - isl.radius;
			if ( d < bd ) { bd = d; best = isl; }

		}

		return best ? this.p.islandName( best.id ) : 'open water';

	}

	// ---- outcome

	_finish( k, ok, reason, extra = {} ) {

		const c = CAPTAIN_BY_ID[ k.captain ];
		this.contracts.splice( this.contracts.indexOf( k ), 1 );
		if ( k.ship && k.ship.alive && k.ship.highBounty === k.id ) k.ship.highBounty = null;
		if ( ok ) {

			const reward = Math.round( k.reward * ( reason === 'captured' ? CAPTURE_MULT : 1 ) );
			this.p.earn( reward );
			this.p.ledger.record( 'bounty', { id: k.captain, name: c.captain, how: reason, value: reward, day: this.p.day } );
			this.p.toast( `Bounty paid: ${ c.captain } ${ reason === 'captured' ? 'in irons' : 'at the bottom' } · +$${ reward }`, 4600 );
			this.p._emitHighBounty( 'bountyClaimed', { id: k.id, target: c.captain, reward, tier: k.tier, proof: reason, source: 'pirates' } );
			this.p._onBountyDone( k, reward );

		} else {

			this.p.ledger.record( 'bountyFailed', { id: k.captain, name: c.captain, how: reason, day: this.p.day } );
			if ( k.state === 'active' ) this.p.toast( `Contract lost (${ reason }): ${ c.captain }${ extra.by ? ` · ${ extra.by } brought her in` : '' }`, 4200 );
			this.p._emitHighBounty( 'highBountyFailed', { id: k.id, target: c.captain, reason, by: extra.by || null } );

		}

	}

	onShipSunk( e, captain ) {

		const k = this.contracts.find( ( c ) => c.state === 'active' && c.captain === captain );
		if ( k ) {

			if ( e.byPlayer === false ) this._finish( k, false, 'beaten', { by: 'someone else' } );
			else if ( ! this.p.ledger.isFree( captain ) && this.p.ledger.status( captain ) === 'captured' ) this._finish( k, true, 'captured' );
			else this._finish( k, true, 'sunk' );
			return;

		}

		// any other pirate going down loosens tongues
		if ( e.faction === 'pirate' && e.byPlayer !== false && this.active() ) this.tip( 'Survivors talk' );
		// a posted (not taken) contract on a captain who died is withdrawn
		for ( const p of this.contracts.filter( ( c ) => c.state === 'posted' && ! this.p.ledger.isFree( c.captain ) ) ) this.contracts.splice( this.contracts.indexOf( p ), 1 );

	}

	onCaptured( captain ) {

		const k = this.contracts.find( ( c ) => c.state === 'active' && c.captain === captain );
		if ( k ) this._finish( k, true, 'captured' );

	}

	onPortVisited( e ) {

		const port = e && e.port;
		if ( ! port || ! this.active() || this._tipped.has( 'port:' + port ) ) return;
		this._tipped.add( 'port:' + port );
		this.tip( `Harbour talk at ${ this.p.portName( port ) }` );

	}

	onBoatSunk( e ) {

		const k = this.active();
		if ( ! k || ! k.ship || ! k.ship.alive ) return;
		const cause = String( ( e && e.cause ) || '' );
		if ( cause.includes( k.ship.name ) ) this._finish( k, false, 'beaten', { by: CAPTAIN_BY_ID[ k.captain ].captain } );

	}

	// ---- per frame

	_hourly( hours ) {

		for ( const k of [ ...this.contracts ] ) {

			if ( this.p.hours > k.expires ) { this._finish( k, false, 'expired' ); continue; }
			if ( k.state !== 'active' ) continue;
			// rivals: only while you are not on her
			const engaged = k.ship && k.ship.alive && this.p.playerDist( k.ship ) < 600;
			if ( engaged ) continue;
			const rivals = CAPTAINS.filter( ( c ) => hasTrait( c, 'rival' ) && this.p.ledger.isFree( c.id ) );
			for ( const r of rivals ) {

				if ( this.p.rng() < HB_RULES.rivalPerHour * hours ) {

					if ( k.ship && k.ship.alive ) k.ship.state = 'gone';
					this.p.ledger.kill( k.captain, { how: 'rival', by: 'rival', day: this.p.day } );
					this._finish( k, false, 'beaten', { by: r.captain } );
					this.p._onCaptainGone( k.captain, 'rival' );
					break;

				}

			}

		}

		// fill the posters
		for ( const port of this._ports() ) if ( ! this.contracts.some( ( c ) => c.port === port ) ) this._post( port );

	}

	update( dt ) {

		const h = this.p.hours;
		if ( this._hour === null ) this._hour = h;
		if ( h - this._hour >= 1 || h < this._hour ) {

			this._hourly( Math.max( 0, h - this._hour ) );
			this._hour = h;

		}

		const k = this.active();
		if ( ! k ) return;
		const pl = this.p.playerPos();
		if ( k.ship && ( ! k.ship.alive || ! this.p.naval || ! this.p.naval.ships.includes( k.ship ) ) ) {

			if ( k.ship.escaped ) {

				k.escapes ++;
				if ( k.escapes >= HB_RULES.escapes ) { this._finish( k, false, 'escaped' ); return; }
				k.truth = this._hideout( k );
				k.zone = this._zoneAround( k.truth, HB_RULES.radius[ k.tier ] * 1.1 );
				this.p.toast( `${ CAPTAIN_BY_ID[ k.captain ].captain } slipped away · the trail starts again`, 3600 );

			}

			k.ship = null;

		}

		if ( k.ship ) {

			k.truth = { x: k.ship.x, z: k.ship.z };
			if ( pl && Math.hypot( pl.x - k.ship.x, pl.z - k.ship.z ) > HB_RULES.dropReach && k.ship.state === 'patrol' ) {

				k.ship.state = 'gone';
				k.ship = null;

			}

		} else if ( pl && this.p.playerAtSea() && this.p.navalActive() && Math.hypot( pl.x - k.truth.x, pl.z - k.truth.z ) < HB_RULES.spawnReach ) {

			this._spawnTarget( k );

		}

		// informants at sea
		const nv = this.p.naval;
		if ( pl && nv ) {

			for ( const s of nv.ships ) {

				if ( ! s.alive || ! s.traits || ! s.traits.includes( 'informant' ) || this._tipped.has( s.id ) ) continue;
				if ( Math.hypot( s.x - pl.x, s.z - pl.z ) < HB_RULES.informantReach ) {

					this._tipped.add( s.id );
					this.tip( `${ s.captain } hails you` );

				}

			}

		}

	}

	_spawnTarget( k ) {

		const t = k.truth, T = this.p.terrain;
		const route = [ 0, 1, 2, 3 ].map( ( i ) => [ t.x + Math.sin( i * Math.PI / 2 ) * 90, t.z + Math.cos( i * Math.PI / 2 ) * 90 ] )
			.filter( ( q ) => ! T || ! T.heightAt || T.heightAt( q[ 0 ], q[ 1 ] ) < - 4 );
		const s = this.p.roster.spawn( k.captain, { x: t.x, z: t.z, yaw: this.p.rng() * Math.PI * 2, route: route.length >= 2 ? route : undefined, speed: 2 } );
		if ( ! s ) return;
		s.highBounty = k.id;
		s.faction = 'pirate';
		k.ship = s;
		if ( k.tier >= 5 && this.p.naval && this.p.naval.ships.length < 8 ) {

			try {

				const e = this.p.naval.spawn( 'sloop', { x: t.x + 40, z: t.z + 30, yaw: s.yaw, route: route.length >= 2 ? route : undefined, loop: true, index: 1, speed: 2 } );
				if ( e ) e.consortOf = s.id;

			} catch ( err ) { /* the consort is optional */ }

		}

	}

	zones() {

		return this.contracts.filter( ( c ) => c.state === 'active' && c.zone ).map( ( c ) => ( {
			id: c.id, kind: 'bounty', x: Math.round( c.zone.x ), z: Math.round( c.zone.z ), r: Math.round( c.zone.r ),
			label: `Wanted: ${ CAPTAIN_BY_ID[ c.captain ].captain }`, tier: c.tier, captain: CAPTAIN_BY_ID[ c.captain ].captain,
			expires: Math.round( c.expires * 10 ) / 10,
		} ) );

	}

	toJSON() {

		return {
			n: this._n,
			contracts: this.contracts.map( ( c ) => ( {
				id: c.id, captain: c.captain, tier: c.tier, reward: c.reward, port: c.port, posted: c.posted, expires: c.expires, state: c.state,
				zone: c.zone ? { x: Math.round( c.zone.x ), z: Math.round( c.zone.z ), r: Math.round( c.zone.r ) } : null,
				truth: c.truth ? { x: Math.round( c.truth.x ), z: Math.round( c.truth.z ) } : null, tips: c.tips, escapes: c.escapes,
			} ) ),
		};

	}

	fromJSON( d ) {

		this.reset();
		if ( ! d || typeof d !== 'object' ) return;
		this._n = Number.isFinite( d.n ) ? d.n : 0;
		const ports = new Set( this._ports() );
		for ( const c of Array.isArray( d.contracts ) ? d.contracts.slice( 0, 8 ) : [] ) {

			if ( ! c || ! CAPTAIN_BY_ID[ c.captain ] || ! ports.has( c.port ) || ( c.state !== 'posted' && c.state !== 'active' ) ) continue;
			const tier = CAPTAIN_BY_ID[ c.captain ].tier;
			const pt = ( v ) => ( v && Number.isFinite( v.x ) && Number.isFinite( v.z ) ? { x: v.x, z: v.z } : null );
			const k = {
				id: String( c.id ).slice( 0, 40 ), captain: c.captain, tier, reward: HB_RULES.reward[ tier ] || 0, port: c.port,
				posted: +c.posted || 0, expires: +c.expires || 0, state: c.state, zone: null, truth: pt( c.truth ), tips: +c.tips || 0, escapes: +c.escapes || 0, ship: null,
			};
			if ( c.zone && Number.isFinite( c.zone.r ) && pt( c.zone ) ) k.zone = { ...pt( c.zone ), r: Math.max( HB_RULES.minRadius, c.zone.r ) };
			if ( k.state === 'active' && ( ! k.zone || ! k.truth ) ) continue;
			if ( k.state === 'active' && this.active() ) continue;
			this.contracts.push( k );

		}

	}

	dispose() {

		for ( const off of this._removers ) off();
		this._removers.length = 0;

	}

}

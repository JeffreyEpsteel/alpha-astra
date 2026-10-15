// The persistent pirate ledger (Unreal FishingWorldStateComponent / PirateRuntimeStateTypes, parity row V10): what became of
// every named captain, the player's kills and captures, raided dens and the counters notoriety is built from. Saved through the
// feature registry (pirates.toJSON().ledger). A captain killed stays dead; a captured one stays in irons.
//
//   const l = new Ledger();
//   l.isFree( id )  l.status( id ) -> 'free' | 'dead' | 'captured'   l.kill( id, { how, by, day } )   l.capture( id, { day } )
//   l.record( kind, data )  kinds: 'sunk' 'captured' 'raid' 'repelled' 'overrun' 'ransom' 'merchant' 'navy' 'crew' 'bounty' 'bountyFailed'
//   l.counts  { sunk, captured, raids, repelled, overrun, ransoms, merchants, navy, crew, bounties, bountiesFailed }
//   l.entries (newest last, capped)   l.toJSON() / fromJSON( d ) / reset()

import { CAPTAIN_BY_ID } from './Roster.js';

export const MAX_ENTRIES = 60;
const COUNT_OF = {
	sunk: 'sunk', captured: 'captured', raid: 'raids', repelled: 'repelled', overrun: 'overrun', ransom: 'ransoms',
	merchant: 'merchants', navy: 'navy', crew: 'crew', bounty: 'bounties', bountyFailed: 'bountiesFailed',
};
const zeroCounts = () => Object.fromEntries( Object.values( COUNT_OF ).map( ( k ) => [ k, 0 ] ) );
const str = ( v, n = 80 ) => ( typeof v === 'string' ? v.slice( 0, n ) : '' );
const num = ( v, d = 0 ) => ( typeof v === 'number' && Number.isFinite( v ) ? v : d );

export class Ledger {

	constructor() {

		this.reset();

	}

	reset() {

		this.captains = {}; // id -> { state: 'dead' | 'captured', how, by, day }   (absent: free)
		this.counts = zeroCounts();
		this.entries = [];
		this.dens = {}; // den id -> { raidedDay, raids }

	}

	status( id ) {

		const r = this.captains[ id ];
		return r ? r.state : 'free';

	}

	isFree( id ) {

		return ! this.captains[ id ];

	}

	// a named captain is dead (sunk, foundered, killed by someone else: by = 'player' | 'remote' | 'rival' ...)
	kill( id, { how = 'sunk', by = 'player', day = 0 } = {} ) {

		if ( ! CAPTAIN_BY_ID[ id ] || ! this.isFree( id ) ) return false;
		this.captains[ id ] = { state: 'dead', how: str( how, 20 ), by: str( by, 20 ), day: num( day ) };
		return true;

	}

	capture( id, { by = 'player', day = 0 } = {} ) {

		if ( ! CAPTAIN_BY_ID[ id ] || ! this.isFree( id ) ) return false;
		this.captains[ id ] = { state: 'captured', how: 'captured', by: str( by, 20 ), day: num( day ) };
		return true;

	}

	record( kind, data = {} ) {

		const c = COUNT_OF[ kind ];
		if ( c ) this.counts[ c ] ++;
		const e = { kind, day: Math.round( num( data.day ) * 100 ) / 100 };
		for ( const k of [ 'id', 'name', 'ship', 'how', 'den', 'value' ] ) if ( data[ k ] !== undefined ) e[ k ] = typeof data[ k ] === 'number' ? data[ k ] : str( String( data[ k ] ) );
		this.entries.push( e );
		if ( this.entries.length > MAX_ENTRIES ) this.entries.splice( 0, this.entries.length - MAX_ENTRIES );
		return e;

	}

	denRaided( id, day ) {

		const d = this.dens[ id ] || ( this.dens[ id ] = { raidedDay: - 1e9, raids: 0 } );
		d.raidedDay = num( day );
		d.raids ++;

	}

	// the player's tally of named captains (for tier 4-5 contract eligibility)
	get namedTaken() {

		let n = 0;
		for ( const r of Object.values( this.captains ) ) if ( r.by === 'player' ) n ++;
		return n;

	}

	toJSON() {

		return { v: 1, captains: JSON.parse( JSON.stringify( this.captains ) ), counts: { ...this.counts }, entries: this.entries.map( ( e ) => ( { ...e } ) ), dens: JSON.parse( JSON.stringify( this.dens ) ) };

	}

	fromJSON( d ) {

		this.reset();
		if ( ! d || typeof d !== 'object' ) return;
		if ( d.captains && typeof d.captains === 'object' ) {

			for ( const [ id, r ] of Object.entries( d.captains ) ) {

				if ( ! CAPTAIN_BY_ID[ id ] || ! r || ( r.state !== 'dead' && r.state !== 'captured' ) ) continue;
				this.captains[ id ] = { state: r.state, how: str( r.how, 20 ), by: str( r.by, 20 ), day: num( r.day ) };

			}

		}

		if ( d.counts && typeof d.counts === 'object' ) for ( const k of Object.keys( this.counts ) ) this.counts[ k ] = Math.max( 0, Math.round( num( d.counts[ k ] ) ) );
		if ( Array.isArray( d.entries ) ) {

			for ( const e of d.entries.slice( - MAX_ENTRIES ) ) if ( e && typeof e.kind === 'string' ) this.entries.push( { ...e, kind: str( e.kind, 20 ), day: num( e.day ) } );

		}

		if ( d.dens && typeof d.dens === 'object' ) {

			for ( const [ id, r ] of Object.entries( d.dens ) ) if ( r && typeof r === 'object' ) this.dens[ str( id, 40 ) ] = { raidedDay: num( r.raidedDay, - 1e9 ), raids: Math.max( 0, Math.round( num( r.raids ) ) ) };

		}

	}

}

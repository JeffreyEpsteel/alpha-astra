// The crew on other players' boats (wave 11; wave 20E: the wave 19C crew with lives). The skipper's posted crew rides in the
// decorated state (NetSync.decorateState, only while the state carries a boat) as one compact string:
//   crew: 'id:PSn[:look[:act]]|...'   P the post (g gunner, a angler, c cook, l lookout), S the side (p / s), n the slot;
//         look the roster GLB a tavern hand wears (left out when it is the id), act the hand's activity now when it is not
//         the post (Life: sleep, eat, drink, mend, dice, talk, fire, pump; cook / lookout at their posts)
// e.g. 'doge:gp0|pengu:gs1::sleep|s-tidemark-0-2:cp0:bonk'. No bones, no per-frame data: it changes when a hand changes post
// or activity. Every other client stands them on that boat with the crew feature's own CrewDeck (Deck.js) in a passive mode:
// the figures follow the remote boat's interpolated pose (RemotePlayers boatPos / boatQuat), and the deck's life( id ) gives
// each the activity and, off duty, the rest spot the skipper's own deck uses (Crew.restPoint: the same ring of the same hull),
// so a hand asleep under the awning there sleeps under it here. A remote crew gunner's shot (fx 'shot' with c: the gunner's
// id) plays the point gesture. Nothing is simulated for them here (no fire, no fish).
// The wave 11 form (an array of [ id, post, side, slot ], gunners and anglers of the roster only) is still read.
//
//   const cl = new CrewLink( sync );  cl.decorate( state );  cl.update( dt );  cl.fired( peerId, crewId );  cl.clear()
//   cl.members() -> the local crew as sent (the string);  cl.decks Map peer id -> { deck, key };  cl.stats { synced }
//   crewMembers( list ) -> [ { id, post, side, slot, look, act } ]   crewString( members, actOf ) -> string
// sync.opts.crewDeck: () => a CrewDeck-like { sync, update, fired, dispose } (tests; default new CrewDeck on app.scene).

import { CrewDeck } from '../crew/Deck.js';
import { restPoint } from '../crew/Crew.js';
import { CHARACTERS } from '../../game/Characters.js';
import { BOATS } from '../../game/Boats.js';

export const MAX_CREW = 8;
const POSTS = [ 'gunner', 'angler' ]; // (the wave 11 array form)
const POST_CODE = { gunner: 'g', angler: 'a', cook: 'c', lookout: 'l' };
const CODE_POST = { g: 'gunner', a: 'angler', c: 'cook', l: 'lookout' };
export const ACTS = new Set( [ 'cook', 'lookout', 'sleep', 'eat', 'drink', 'mend', 'dice', 'talk', 'fire', 'pump' ] );
const ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const ENTRY = /^([a-z0-9][a-z0-9_-]{0,31}):([gacl])([ps])([0-7])(?::([a-z0-9_-]{0,24}))?(?::([a-z]{0,8}))?$/;

// the local crew as one string ('' without anybody); actOf( id ) -> the activity or null
export function crewString( list, actOf = null ) {

	const out = [];
	for ( const m of Array.isArray( list ) ? list : [] ) {

		if ( out.length >= MAX_CREW ) break;
		if ( ! m || typeof m.id !== 'string' || ! ID.test( m.id ) || ! POST_CODE[ m.post ] ) continue;
		const look = typeof m.look === 'string' && m.look !== m.id && CHARACTERS[ m.look ] ? m.look : '';
		if ( ! CHARACTERS[ m.id ] && ! look ) continue; // (a tavern hand without a known look cannot be drawn)
		let act = null;
		try { act = actOf ? actOf( m.id ) : null; } catch ( e ) { act = null; }
		act = act && act !== 'post' && act !== m.post && ACTS.has( act ) ? act : '';
		let e = `${ m.id }:${ POST_CODE[ m.post ] }${ m.side === 'starboard' ? 's' : 'p' }${ Math.max( 0, Math.min( 7, m.slot | 0 ) ) }`;
		if ( look || act ) e += ':' + look;
		if ( act ) e += ':' + act;
		out.push( e );

	}

	return out.join( '|' );

}

// a sent crew back into CrewDeck members ([] when malformed): the string form, or the wave 11 array form
export function crewMembers( list ) {

	const out = [], seen = new Set();
	if ( typeof list === 'string' ) {

		for ( const part of list.split( '|' ) ) {

			if ( out.length >= MAX_CREW ) break;
			const r = ENTRY.exec( part );
			if ( ! r || seen.has( r[ 1 ] ) ) continue;
			const id = r[ 1 ], look = r[ 5 ] && CHARACTERS[ r[ 5 ] ] ? r[ 5 ] : CHARACTERS[ id ] ? id : null;
			if ( ! look ) continue;
			seen.add( id );
			const post = CODE_POST[ r[ 2 ] ];
			const act = r[ 6 ] && ACTS.has( r[ 6 ] ) ? r[ 6 ] : post === 'cook' || post === 'lookout' ? post : 'post';
			out.push( { id, post, side: r[ 3 ] === 's' ? 'starboard' : 'port', slot: r[ 4 ] | 0, look, act } );

		}

		return out;

	}

	if ( ! Array.isArray( list ) ) return out;
	for ( const e of list ) {

		if ( out.length >= MAX_CREW ) break;
		if ( ! Array.isArray( e ) || typeof e[ 0 ] !== 'string' || ! CHARACTERS[ e[ 0 ] ] || seen.has( e[ 0 ] ) || ! POSTS.includes( e[ 1 ] ) ) continue;
		seen.add( e[ 0 ] );
		out.push( { id: e[ 0 ], post: e[ 1 ], side: e[ 2 ] === 's' ? 'starboard' : 'port', slot: Math.max( 0, Math.min( 7, e[ 3 ] | 0 ) ) } );

	}

	return out;

}

export class CrewLink {

	constructor( sync ) {

		this.sync = sync;
		this.decks = new Map();
		this.stats = { synced: 0 };

	}

	_crew() {

		const f = this.sync.features;
		return f && f.get ? f.get( 'crew' ) : null;

	}

	// the local crew on deck as the crew feature places it (crew.members() when it offers one, else its own _members( ctx ))
	members() {

		const c = this._crew();
		if ( ! c ) return '';
		let list = null;
		try {

			if ( typeof c.members === 'function' ) list = c.members();
			else if ( typeof c._members === 'function' && typeof c.ctx === 'function' ) list = c._members( c.ctx() );

		} catch ( e ) {

			return '';

		}

		return crewString( list, typeof c.activity === 'function' ? ( id ) => c.activity( id ) : null );

	}

	// NetSync.decorateState: the crew rides with the boat
	decorate( s ) {

		if ( ! s || ! s.boat ) return s;
		const m = this.members();
		if ( m ) s.crew = m;
		return s;

	}

	_makeDeck() {

		const make = this.sync.opts && this.sync.opts.crewDeck;
		if ( make ) return make();
		const app = this.sync.app;
		if ( ! app.scene ) return null;
		return new CrewDeck( { scene: app.scene, avatarFactory: ( app.residents && app.residents.avatarFactory ) || null } );

	}

	// the deck's life( id ) for a remote boat: the activity, the rest ring off duty, the pump amidships (as the skipper's deck)
	_life( d, boatId, deckY ) {

		const byId = d.byId, n = d.members.length, B = BOATS[ boatId ];
		return ( id ) => {

			const m = byId.get( id );
			const act = m && m.act ? m.act : 'post';
			if ( act === 'post' || act === 'cook' || act === 'lookout' ) return { act: act === 'lookout' ? 'post' : act };
			if ( act === 'fire' ) return { act, fire: { x: 0, z: B ? - B.length * 0.1 : 0 } };
			const i = d.members.indexOf( m );
			if ( act === 'pump' ) return { act, spot: B && B.kind === 'ship' ? { x: 0.5 + 0.6 * ( i % 3 ), y: Number.isFinite( deckY ) ? deckY : B.deckY, z: B.length * 0.08, yaw: Math.PI / 2 } : null };
			return { act, spot: restPoint( boatId, i, n, deckY ) };

		};

	}

	update( dt ) {

		const app = this.sync.app, rp = app.remotePlayers, net = this.sync.net;
		const seen = new Set();
		if ( rp && rp.peers && net && net.online ) {

			const eye = app.camera && app.camera.position ? app.camera.position : null;
			for ( const [ id, p ] of rp.peers ) {

				const list = p.extra ? p.extra.crew : null;
				if ( ! list || ! list.length || ! p.boatState || ! p.hasPose || ! p.boatPos ) continue;
				let d = this.decks.get( id );
				const key = typeof list === 'string' ? list : JSON.stringify( list );
				if ( ! d || key !== d.key ) {

					const members = crewMembers( list );
					if ( ! members.length ) continue;
					if ( ! d ) {

						let deck = null;
						try { deck = this._makeDeck(); } catch ( e ) { deck = null; }
						if ( ! deck ) continue;
						this.decks.set( id, d = { deck, key: '', members: [], byId: new Map() } );

					}

					d.key = key;
					d.members = members;
					d.byId = new Map( members.map( ( m ) => [ m.id, m ] ) );
					d.deck.sync( members );
					this.stats.synced ++;

				}

				seen.add( id );
				const model = p.boat || null, lines = model && ( model.lines || ( model.model && model.model.lines ) );
				const deckY = lines && Number.isFinite( lines.deckY ) ? lines.deckY : null;
				const lk = `${ d.key }|${ p.boatState.id }|${ deckY }`;
				if ( d.lifeKey !== lk ) {

					d.lifeKey = lk;
					d.life = this._life( d, p.boatState.id, deckY );

				}

				d.deck.update( dt, {
					boat: { position: p.boatPos, quaternion: p.boatQuat }, boatId: p.boatState.id,
					deckY, visible: p.boatPos.y > - 50, eye, life: d.life,
				} );

			}

		}

		for ( const [ id, d ] of this.decks ) {

			if ( seen.has( id ) ) continue;
			d.deck.dispose();
			this.decks.delete( id );

		}

	}

	// a remote crew gunner fired: the point gesture on that boat
	fired( peer, crewId ) {

		const d = this.decks.get( peer );
		if ( d && typeof crewId === 'string' && d.deck.fired ) d.deck.fired( crewId );

	}

	clear() {

		for ( const d of this.decks.values() ) d.deck.dispose();
		this.decks.clear();

	}

	dispose() {

		this.clear();

	}

}

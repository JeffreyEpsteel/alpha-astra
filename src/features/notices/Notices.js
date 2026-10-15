import { DAY_SPEED } from '../../game/GameMode.js';
import {
	PORT_IDS, PORT_INFO, MAX_ACTIVE, MIN_LEFT, LOOKBACK, REP_MAX, DAY_HOURS, BOARD_SIZE, MEMORY_DROP, MEMORY_HOURS, TYPE_LABEL, UNLOCK_CHARACTERS, EVENTS,
	hash32, generateDay, standingLevel, standingInfo, eventDelta, targetMatches,
} from './NoticeData.js';
import { BOARD_SITES } from './Sites.js';
import { storyPostings } from './NoticeData.js';
import { NoticeUI } from './NoticeUI.js';
import { NoticeBoard3D } from './NoticeBoard3D.js';

// The notice boards (mini-quests and bounty contracts) of both ports, the player's accepted notices, the
// per-port standing the boards keep, and what the boards remember of the player (NPC memory).
//
//   const n = features.get( 'notices' );
//   n.board( 'home' )   -> postings on the board now: [ { ...posting, left } ]  (data: NoticeData.js)
//   n.accept( id )      -> the active notice, or null (n.lastError says why); at most MAX_ACTIVE
//   n.abandon( id )     -> bool: drops it, costs standing and the board offers fewer of that type for a day
//   n.active            -> accepted notices [ { ...posting, progress, acceptedAt, left } ]
//   n.standing( port )  -> { value, level, name, next, nextName }       n.rep -> { home, pons }
//   n.greeting( port )  -> { keeper, line, note }  what the board keeper says / remembers
//   n.advance( hours ), n.hours (the in-game clock the postings use), n.day
//   n.isOpen (bool: a board or the journal is open; the registry blocks fishing input) and n.close() (Escape)
//
// Events listened to: fishCaught, fishSold, cargoSold, portVisited, shipSunk, enemyDefeated.
// Events emitted (payloads are plain objects):
//   bountyAccepted  { id, target, tier, region: { x, z }, captain, epithet, ship, craft, port, expires, resumed? }
//                   the naval feature spawns that captain's ship near region; after a load the notices re-emit it
//                   (resumed: true) for every active bounty so a missing target can be respawned
//   bountyCancelled { id, target, reason: 'abandoned' | 'expired' | 'beaten' | 'reset' }   the target is released
//   bountyClaimed   { id, target, reward }       (Features.js vocabulary)
//   noticeAccepted  { id, type, port }           noticeCompleted { id, reward, port, type }
//   noticeFailed    { id, reason, type, port }   reason: 'abandoned' | 'expired' | 'beaten'
//   rewardUnlock    { character, id, port, source: 'notice' }   the integrator maps it to state.unlockCharacter
//   noticesRefreshed { day }                     a new in-game day: new postings
// A bounty is claimed by a shipSunk that names the target ( target | captain | name equals the bounty's target
// or captain, or bountyId equals its id ) with byPlayer not false; a matching shipSunk with byPlayer false
// (someone else got him) fails the bounty as 'beaten' without a penalty.

const SAVE_VERSION = 1;
const DEFAULT_SEED = 20261012;
const clone = ( o ) => JSON.parse( JSON.stringify( o ) );
const clamp = ( v, a, b ) => Math.max( a, Math.min( b, v ) );
const num = ( v, d = 0 ) => ( typeof v === 'number' && Number.isFinite( v ) ? v : d );
const str = ( v, max = 300 ) => ( typeof v === 'string' ? v.slice( 0, max ) : '' );

export class Notices {

	constructor( app, features ) {

		this.app = app;
		this.features = features;
		this.lastError = '';
		this._offs = [];
		this._cache = new Map();
		this.ui = null;
		this._uiFailed = false;
		this.world = null; // { home, pons } NoticeBoard3D
		this._worldState = 0; // 0 not tried, 1 tried
		this._worldT = 0;
		this._key = features.claimKey( 'KeyJ', 'notices' ); // J: the journal (active notices) from anywhere
		this._initState();
		for ( const name of EVENTS ) this._offs.push( features.on( name, ( e ) => this._onEvent( name, e ) ) );
		for ( const port of PORT_IDS ) {

			const site = BOARD_SITES[ port ];
			this._offs.push( features.interactable( {
				id: `notices:${ port }`,
				position: () => ( { x: site.x, y: this._groundY( site ), z: site.z } ),
				radius: 3.4,
				when: () => ! this.open,
				prompt: () => `Read the ${ PORT_INFO[ port ].short } notice board`,
				onInteract: () => { this.openBoard( port ); },
			} ) );

		}

	}

	// a new game's state (also reset())
	_initState() {

		const st = this.features.state;
		const qs = st && st.quests && Number.isInteger( st.quests.seed ) ? st.quests.seed : null;
		this.seed = qs === null ? DEFAULT_SEED : hash32( 'notices-seed', qs );
		const tod = this.app && this.app.settings && Number.isFinite( this.app.settings.timeOfDay ) ? this.app.settings.timeOfDay : 9.5;
		this.hours = tod;
		this._lastTod = null;
		this.rep = Object.fromEntries( PORT_IDS.map( ( p ) => [ p, 0 ] ) ); // every board's port (NoticeData PORT_IDS)
		this._active = [];
		this.taken = new Set();
		this.memory = Object.fromEntries( PORT_IDS.map( ( p ) => [ p, {} ] ) );
		this.awarded = [];
		this.snap = Object.fromEntries( PORT_IDS.map( ( p ) => [ p, {} ] ) );
		this.stats = { completed: 0, failed: 0, bounties: 0 };
		this.notes = []; // recent outcomes: { port, type, title, outcome, at }
		this._resume = false;
		this._cache.clear();
		this._ensureDay();

	}

	// the postings are a function of the seed: a shared (multiplayer) world gives every player the same one
	setSeed( seed ) {

		if ( ! Number.isInteger( seed ) ) return;
		this.seed = seed >>> 0;
		this._cache.clear();
		this._changed();

	}

	// ---------------------------------------------------------------- clock

	get day() {

		return Math.floor( this.hours / DAY_HOURS );

	}

	get hourOfDay() {

		return this.hours - this.day * DAY_HOURS;

	}

	// In-game hours pass as the island clock does (app.settings.timeOfDay, wrapping at 24). A jump of the clock
	// (a load, a slider) is not counted as time passing.
	_syncClock( dt ) {

		const s = this.app && this.app.settings;
		let dh;
		if ( s && Number.isFinite( s.timeOfDay ) ) {

			const speed = Number.isFinite( s.timeSpeed ) ? s.timeSpeed : DAY_SPEED;
			const expected = Math.max( 0, dt ) * speed;
			if ( this._lastTod === null ) dh = 0;
			else {

				dh = ( s.timeOfDay - this._lastTod + 24 ) % 24;
				if ( dh > expected * 3 + 0.05 ) dh = Math.min( dh, expected );

			}

			this._lastTod = s.timeOfDay;

		} else dh = Math.max( 0, dt ) * DAY_SPEED;

		this.advance( dh );

	}

	// move the clock on (the update does this; tests and debugging can too)
	advance( hours ) {

		if ( ! ( hours > 0 ) ) return;
		const d0 = this.day;
		this.hours += hours;
		if ( this.day !== d0 ) {

			this._ensureDay();
			this.features.emit( 'noticesRefreshed', { day: this.day } );
			this._changed();

		}

		this._expire();

	}

	// the day's standing snapshot per port (postings of a day are generated at the standing it began with)
	_ensureDay() {

		const day = this.day;
		for ( const port of PORT_IDS ) {

			const sn = this.snap[ port ];
			if ( sn[ day ] === undefined ) sn[ day ] = standingLevel( this.rep[ port ] );
			for ( const k of Object.keys( sn ) ) if ( + k < day - LOOKBACK ) delete sn[ k ];

		}

		for ( const id of [ ...this.taken ] ) if ( num( id.split( ':' )[ 1 ], day ) < day - LOOKBACK - 1 ) this.taken.delete( id );

	}

	// ---------------------------------------------------------------- the boards

	_dayList( port, day, level ) {

		const key = `${ this.seed }|${ port }|${ day }|${ level }`;
		let list = this._cache.get( key );
		if ( ! list ) {

			list = generateDay( this.seed, port, day, level );
			this._cache.set( key, list );
			if ( this._cache.size > 40 ) this._cache.delete( this._cache.keys().next().value );

		}

		return list;

	}

	_unlockBlocked( character ) {

		const st = this.features.state;
		return this.awarded.includes( character ) || this._active.some( ( n ) => n.reward.unlock === character ) || !! ( st && st.isUnlocked && st.isUnlocked( character ) );

	}

	// The postings on `port`'s board now: the oldest valid ones first, then the newer, up to the standing's board size.
	// Taken, lapsed and (after a failure) some postings of the failed type are left out. Sorted by expiry.
	board( port ) {

		if ( ! PORT_INFO[ port ] ) return [];
		this._ensureDay();
		const now = this.hours, day = this.day;
		const level = standingLevel( this.rep[ port ] ), size = BOARD_SIZE[ level ], memo = this.memory[ port ];
		const out = [];
		for ( let d = Math.max( 0, day - LOOKBACK ); d <= day && out.length < size; d ++ ) {

			const lv = this.snap[ port ][ d ];
			if ( lv === undefined ) continue;
			for ( const p of this._dayList( port, d, lv ) ) {

				if ( out.length >= size ) break;
				if ( p.expires - now < MIN_LEFT || this.taken.has( p.id ) ) continue;
				const m = memo[ p.kind === 'bounty' ? 'bounty' : p.type ];
				if ( m && m.until > now && p.roll < MEMORY_DROP[ Math.min( 3, m.n ) ] ) continue;
				const v = { ...p, reward: { ...p.reward }, left: p.expires - now };
				if ( v.reward.unlock && this._unlockBlocked( v.reward.unlock ) ) v.reward.unlock = null;
				out.push( v );

			}

		}

		// wave 13: the story's quest notices where they fit (taken through the story, not as a notice)
		const story = this.features && this.features.get ? this.features.get( 'story' ) : null;
		if ( story ) try { out.push( ...storyPostings( port, story, now ) ); } catch ( e ) { /* the story is optional */ }
		const nvy = this.features && this.features.get ? this.features.get( 'navy' ) : null; // wave 19B: navy bounties at Tidemark
		if ( nvy && nvy.postings ) try { out.push( ...nvy.postings( port, now ) ); } catch ( e ) { /* the navy is optional */ }
		out.sort( ( a, b ) => a.expires - b.expires || a.slot - b.slot );
		return out;

	}

	standing( port ) {

		return { port, ...standingInfo( this.rep[ port ] ) };

	}

	// what the board keeper says: a line for the standing, and a note when something was left hanging
	greeting( port ) {

		const keeper = PORT_INFO[ port ].keeper, level = standingLevel( this.rep[ port ] );
		const line = [
			'New face. Have a look at the board.',
			'Back again. The board has been kind to you.',
			'Always glad to see you. The good postings go to you first.',
			'The whole quay knows your name. The hard jobs are yours if you want them.',
			'The board practically writes itself around you now.',
		][ level ];
		let note = '';
		let worst = null;
		for ( const [ k, m ] of Object.entries( this.memory[ port ] ) ) if ( m.until > this.hours && ( ! worst || m.n > worst[ 1 ].n ) ) worst = [ k, m ];
		if ( worst ) note = `${ keeper } has not forgotten the ${ ( TYPE_LABEL[ worst[ 0 ] ] || worst[ 0 ] ).toLowerCase() } you left hanging: fewer of those today.`;
		const works = this.features && this.features.get ? this.features.get( 'citywreck' )?.bulletin?.( port ) : null;
		if ( works && works.length ) note = [ note, ...works ].filter( Boolean ).join( ' ' );
		return { keeper, line, note };

	}

	// ---------------------------------------------------------------- active notices

	get active() {

		return this._active.map( ( n ) => this._copy( n ) );

	}

	_copy( n ) {

		return { ...clone( n ), left: n.expires - this.hours };

	}

	_err( msg ) {

		this.lastError = msg;
		return null;

	}

	accept( id ) {

		this.lastError = '';
		if ( typeof id === 'string' && id.startsWith( 'navy:' ) ) {

			const nvy = this.features && this.features.get ? this.features.get( 'navy' ) : null;
			const p = nvy && nvy.claim ? nvy.claim() : 0;
			return p ? { id, navy: true, paid: p } : this._err( 'Nothing owed yet' );

		}
		if ( typeof id === 'string' && id.startsWith( 'story:' ) ) {

			const story = this.features && this.features.get ? this.features.get( 'story' ) : null;
			if ( ! story || ! story.acceptPosting( id ) ) return this._err( ( story && story.lastError ) || 'That notice is gone' );
			this._changed();
			return { id, story: true };

		}
		const port = typeof id === 'string' ? id.split( ':' )[ 0 ] : '';
		if ( ! PORT_INFO[ port ] ) return this._err( 'Unknown notice' );
		if ( this._active.some( ( n ) => n.id === id ) ) return this._err( 'You already took that one' );
		if ( this._active.length >= MAX_ACTIVE ) return this._err( `You can carry ${ [ 'no', 'one', 'two', 'three', 'four', 'five' ][ MAX_ACTIVE ] || MAX_ACTIVE } notices at a time` );
		const p = this.board( port ).find( ( x ) => x.id === id );
		if ( ! p ) return this._err( 'That notice is gone' );
		if ( p.kind === 'bounty' && this._active.some( ( n ) => n.target === p.target ) ) return this._err( 'You are already hunting that captain' );
		const n = clone( p );
		delete n.left;
		delete n.roll;
		n.progress = 0;
		n.acceptedAt = this.hours;
		this._active.push( n );
		this.taken.add( id );
		if ( n.kind === 'bounty' ) this.features.emit( 'bountyAccepted', this._bountyPayload( n, false ) );
		this.features.emit( 'noticeAccepted', { id, type: n.type, port } );
		this._toast( n.kind === 'bounty' ? `Contract taken: ${ n.captain }` : `Notice taken: ${ n.title }`, 2600 );
		this._changed();
		return this._copy( n );

	}

	_bountyPayload( n, resumed ) {

		const out = {
			id: n.id, target: n.target, tier: n.tier, region: { x: n.region.x, z: n.region.z },
			captain: n.captain, epithet: n.epithet, ship: n.ship, craft: n.craft, port: n.port, expires: n.expires,
		};
		if ( resumed ) out.resumed = true;
		return out;

	}

	abandon( id ) {

		const n = this._active.find( ( x ) => x.id === id );
		if ( ! n ) return false;
		this._fail( n, 'abandoned' );
		return true;

	}

	_remove( n ) {

		const i = this._active.indexOf( n );
		if ( i >= 0 ) this._active.splice( i, 1 );

	}

	_expire() {

		for ( const n of [ ...this._active ] ) if ( n.expires <= this.hours ) this._fail( n, 'expired' );

	}

	_addRep( port, v ) {

		const before = standingLevel( this.rep[ port ] );
		this.rep[ port ] = Math.round( clamp( this.rep[ port ] + v, 0, REP_MAX ) * 100 ) / 100;
		return standingLevel( this.rep[ port ] ) - before;

	}

	_remember( n ) {

		const key = n.kind === 'bounty' ? 'bounty' : n.type, memo = this.memory[ n.port ];
		const cur = memo[ key ], fresh = cur && cur.until > this.hours ? cur.n : 0;
		memo[ key ] = { n: Math.min( 3, fresh + 1 ), until: Math.round( ( this.hours + MEMORY_HOURS ) * 1000 ) / 1000 };

	}

	_note( n, outcome ) {

		this.notes.unshift( { port: n.port, type: n.type, title: n.title, outcome, at: Math.round( this.hours * 100 ) / 100 } );
		if ( this.notes.length > 6 ) this.notes.length = 6;

	}

	_fail( n, reason ) {

		this._remove( n );
		const penalty = reason === 'expired' ? ( n.kind === 'bounty' ? 4 : 2 ) : reason === 'abandoned' ? ( n.kind === 'bounty' ? 2 : 1 ) : 0;
		if ( reason !== 'beaten' ) {

			this.stats.failed ++;
			this._remember( n );

		}

		this._addRep( n.port, - penalty );
		this._note( n, reason );
		if ( n.kind === 'bounty' ) this.features.emit( 'bountyCancelled', { id: n.id, target: n.target, reason } );
		this.features.emit( 'noticeFailed', { id: n.id, reason, type: n.type, port: n.port } );
		const text = { expired: 'lapsed', abandoned: 'dropped', beaten: 'was taken by someone else' }[ reason ] || reason;
		this._toast( `${ n.kind === 'bounty' ? n.captain : n.title } ${ text }${ penalty ? ` · standing -${ penalty }` : '' }`, 3200 );
		this._changed();

	}

	_complete( n ) {

		this._remove( n );
		const rw = n.reward, st = this.features.state;
		if ( st && rw.money > 0 && typeof st.earn === 'function' ) st.earn( rw.money );
		if ( st && rw.money > 0 && typeof st.addXp === 'function' ) st.addXp( Math.round( rw.money / 4 ) );
		const up = this._addRep( n.port, rw.rep );
		this.stats.completed ++;
		if ( n.kind === 'bounty' ) this.stats.bounties ++;
		this._note( n, 'done' );
		const reward = { money: rw.money, rep: rw.rep, unlock: rw.unlock || null };
		if ( reward.unlock ) {

			if ( ! this.awarded.includes( reward.unlock ) ) this.awarded.push( reward.unlock );
			this.features.emit( 'rewardUnlock', { character: reward.unlock, id: n.id, port: n.port, source: 'notice' } );

		}

		if ( n.kind === 'bounty' ) this.features.emit( 'bountyClaimed', { id: n.id, target: n.target, reward } );
		this.features.emit( 'noticeCompleted', { id: n.id, reward, port: n.port, type: n.type } );
		const who = n.kind === 'bounty' ? `Bounty claimed: ${ n.captain }` : `${ n.title } · done`;
		this._toast( `${ who } · +$${ rw.money.toLocaleString() }`, 3600 );
		if ( up > 0 ) this._toast( `${ PORT_INFO[ n.port ].short } board: you are now ${ standingInfo( this.rep[ n.port ] ).name }`, 3600 );
		this._changed();

	}

	_onEvent( name, e ) {

		if ( ! this._active.length ) return;
		e = e && typeof e === 'object' ? e : {};
		let changed = false;
		for ( const n of [ ...this._active ] ) {

			if ( n.kind === 'bounty' ) {

				if ( name === 'shipSunk' && targetMatches( n, e ) ) {

					changed = true;
					if ( e.byPlayer === false ) this._fail( n, 'beaten' );
					else {

						n.progress = n.goal;
						this._complete( n );

					}

				}

				continue;

			}

			const d = eventDelta( n, name, e );
			if ( d <= 0 ) continue;
			n.progress = Math.min( n.goal, n.progress + d );
			changed = true;
			if ( n.progress >= n.goal ) this._complete( n );

		}

		if ( changed ) this._changed();

	}

	// ---------------------------------------------------------------- UI and world (all lazy; nothing here in node)

	_toast( text, ms ) {

		const g = this.app && this.app.game;
		try { if ( g && typeof g.toast === 'function' ) g.toast( text, ms ); } catch ( e ) { /* no HUD yet */ }

	}

	_changed() {

		if ( this._active.length ) this._getUI();
		if ( this.ui ) this.ui.refresh();

	}

	_getUI() {

		if ( this.ui || this._uiFailed ) return this.ui;
		try {

			this.ui = NoticeUI.create( this );

		} catch ( e ) {

			this._uiFailed = true;
			console.warn( 'notices: the HUD panel failed', e );

		}

		return this.ui;

	}

	get open() {

		return !! ( this.ui && this.ui.isOpen );

	}

	// the Features registry's contract: an open window blocks fishing input, Escape calls close()
	get isOpen() {

		return this.open;

	}

	close() {

		this.closeBoard();

	}

	openBoard( port ) {

		const ui = this._getUI();
		if ( ! ui ) return false;
		ui.open( 'board', port );
		return true;

	}

	toggleJournal() {

		const ui = this._getUI();
		if ( ! ui ) return false;
		if ( ui.isOpen ) ui.close();
		else {

			this.features.get?.( 'worldmap' )?.close?.();
			ui.open( 'journal', 'home' );

		}
		return true;

	}

	closeBoard() {

		if ( this.ui ) this.ui.close();

	}

	_groundY( site ) {

		const t = this.app && this.app.terrainData;
		return t && typeof t.heightAt === 'function' ? t.heightAt( site.x, site.z ) : undefined;

	}

	// what the panel and the tests read: one port's board with the player's state
	model( port ) {

		const now = this.hours;
		// the story (src/features/story): its chains in the journal, the board keeper's conversation on the board
		const story = this.features.get && this.features.get( 'story' );
		let storyHTML = '', talk = null;
		try {

			if ( story && story.journalHTML ) storyHTML = story.journalHTML();
			const keeper = story && story.keeperOf ? story.keeperOf( port ) : null;
			if ( keeper ) talk = { npc: keeper.id, name: keeper.name, work: story.hasBusiness( keeper.id ) };

		} catch ( e ) { /* the story is optional */ }

		return {
			storyHTML, talk,
			port, info: PORT_INFO[ port ], day: this.day, hours: now, max: MAX_ACTIVE,
			greeting: this.greeting( port ),
			standing: Object.fromEntries( PORT_IDS.map( ( p ) => [ p, this.standing( p ) ] ) ),
			postings: this.board( port ), active: this.active, free: this.features.sandbox === true,
		};

	}

	_buildWorld() {

		const a = this.app;
		if ( this._worldState || ! a || ! a.scene || ! a.terrainData || typeof a.terrainData.heightAt !== 'function' ) return;
		this._worldState = 1;
		this.world = {};
		for ( const port of PORT_IDS ) {

			try {

				const b = new NoticeBoard3D( { scene: a.scene, terrain: a.terrainData, colliders: a.colliders || null, site: BOARD_SITES[ port ], port } );
				b.refresh( this.board( port ) );
				this.world[ port ] = b;

			} catch ( e ) {

				console.warn( `notices: the ${ port } board failed to build`, e );

			}

		}

	}

	_updateWorld( dt ) {

		this._buildWorld();
		if ( ! this.world ) return;
		this._worldT += dt;
		if ( this._worldT < 1.5 ) return;
		this._worldT = 0;
		for ( const port of PORT_IDS ) if ( this.world[ port ] ) this.world[ port ].refresh( this.board( port ) );

	}

	_closeWhenFar() {

		const ui = this.ui, p = this.app && this.app.player && this.app.player.position;
		if ( ! ui || ! ui.isOpen || ui.view !== 'board' || ! p ) return;
		const site = BOARD_SITES[ ui.port ];
		if ( Math.hypot( p.x - site.x, p.z - site.z ) > 9 ) ui.close();

	}

	// ---------------------------------------------------------------- frame

	update( dt ) {

		this._syncClock( dt );
		if ( this._resume ) {

			this._resume = false;
			for ( const n of this._active ) if ( n.kind === 'bounty' ) this.features.emit( 'bountyAccepted', this._bountyPayload( n, true ) );

		}

		const inp = this.app && this.app.input;
		if ( this._key && inp && typeof inp.hit === 'function' && inp.hit( 'KeyJ' ) ) this.toggleJournal();
		this._updateWorld( dt );
		if ( this.ui ) {

			this._closeWhenFar();
			this.ui.update( dt );

		}

	}

	// ---------------------------------------------------------------- save

	toJSON() {

		return {
			v: SAVE_VERSION, seed: this.seed, hours: Math.round( this.hours * 1000 ) / 1000, rep: { ...this.rep },
			active: this._active.map( clone ), taken: [ ...this.taken ], memory: clone( this.memory ), awarded: [ ...this.awarded ],
			snap: clone( this.snap ), stats: { ...this.stats }, notes: clone( this.notes ),
		};

	}

	fromJSON( d ) {

		if ( ! d || typeof d !== 'object' ) return;
		this._initState();
		if ( Number.isInteger( d.seed ) ) this.seed = d.seed >>> 0;
		if ( Number.isFinite( d.hours ) && d.hours >= 0 ) this.hours = d.hours;
		for ( const port of PORT_IDS ) this.rep[ port ] = clamp( num( d.rep && d.rep[ port ] ), 0, REP_MAX );
		this._cache.clear();
		const active = [];
		for ( const raw of Array.isArray( d.active ) ? d.active : [] ) {

			const n = cleanNotice( raw );
			if ( n && active.length < MAX_ACTIVE && ! active.some( ( x ) => x.id === n.id ) ) active.push( n );

		}

		this._active = active;
		this.taken = new Set( ( Array.isArray( d.taken ) ? d.taken : [] ).filter( ( id ) => typeof id === 'string' && id.length < 40 ).slice( - 200 ) );
		for ( const n of active ) this.taken.add( n.id );
		for ( const port of PORT_IDS ) {

			const m = d.memory && d.memory[ port ] && typeof d.memory[ port ] === 'object' ? d.memory[ port ] : {};
			this.memory[ port ] = {};
			for ( const [ k, v ] of Object.entries( m ) ) {

				if ( ( k === 'bounty' || TYPE_LABEL[ k ] ) && v && Number.isFinite( v.until ) ) this.memory[ port ][ k ] = { n: clamp( Math.round( num( v.n, 1 ) ), 1, 3 ), until: v.until };

			}

			this.snap[ port ] = {};
			const sn = d.snap && d.snap[ port ] && typeof d.snap[ port ] === 'object' ? d.snap[ port ] : {};
			for ( const [ k, v ] of Object.entries( sn ) ) if ( Number.isInteger( + k ) && + k >= 0 && Number.isInteger( v ) && v >= 0 && v <= 4 ) this.snap[ port ][ k ] = v;

		}

		this.awarded = ( Array.isArray( d.awarded ) ? d.awarded : [] ).filter( ( c ) => UNLOCK_CHARACTERS.includes( c ) );
		const st = d.stats || {};
		this.stats = { completed: Math.max( 0, num( st.completed ) | 0 ), failed: Math.max( 0, num( st.failed ) | 0 ), bounties: Math.max( 0, num( st.bounties ) | 0 ) };
		this.notes = ( Array.isArray( d.notes ) ? d.notes : [] ).slice( 0, 6 ).filter( ( x ) => x && PORT_INFO[ x.port ] && typeof x.title === 'string' ).map( ( x ) => ( { port: x.port, type: str( x.type, 20 ), title: str( x.title, 80 ), outcome: str( x.outcome, 12 ), at: num( x.at ) } ) );
		this._lastTod = null;
		this._resume = this._active.some( ( n ) => n.kind === 'bounty' );
		this._ensureDay();
		this._changed();

	}

	// a new game: cancel what is running and start from nothing
	reset() {

		for ( const n of this._active ) if ( n.kind === 'bounty' ) this.features.emit( 'bountyCancelled', { id: n.id, target: n.target, reason: 'reset' } );
		this._initState();
		this._changed();

	}

	dispose() {

		for ( const off of this._offs ) try { off(); } catch ( e ) { /* already gone */ }
		this._offs = [];
		if ( this.ui ) this.ui.dispose();
		this.ui = null;
		if ( this.world ) for ( const b of Object.values( this.world ) ) b.dispose();
		this.world = null;

	}

}

// ---------------------------------------------------------------- save validation

function cleanParams( p ) {

	const out = {};
	if ( p && typeof p === 'object' ) for ( const [ k, v ] of Object.entries( p ) ) if ( [ 'string', 'number', 'boolean' ].includes( typeof v ) && k.length < 20 ) out[ k ] = typeof v === 'string' ? v.slice( 0, 40 ) : v;
	return out;

}

// an accepted notice from the save, or null when it is not one
function cleanNotice( raw ) {

	if ( ! raw || typeof raw !== 'object' ) return null;
	const port = raw.port, kind = raw.kind === 'bounty' ? 'bounty' : raw.kind === 'quest' ? 'quest' : null;
	const type = kind === 'bounty' ? 'bounty' : raw.type;
	if ( typeof raw.id !== 'string' || raw.id.length > 40 || ! PORT_INFO[ port ] || ! kind || ! TYPE_LABEL[ type ] ) return null;
	const goal = num( raw.goal ), rw = raw.reward || {};
	if ( ! ( goal > 0 ) || ! Number.isFinite( raw.expires ) ) return null;
	const n = {
		id: raw.id, port, day: Math.max( 0, num( raw.day ) | 0 ), slot: Math.max( 0, num( raw.slot ) | 0 ), kind, type,
		title: str( raw.title, 80 ), client: str( raw.client, 60 ), text: str( raw.text ), params: cleanParams( raw.params ), goal,
		reward: { money: Math.max( 0, Math.round( num( rw.money ) ) ), rep: Math.max( 0, num( rw.rep ) ), unlock: UNLOCK_CHARACTERS.includes( rw.unlock ) ? rw.unlock : null },
		issued: num( raw.issued ), expires: raw.expires, progress: clamp( num( raw.progress ), 0, goal ), acceptedAt: num( raw.acceptedAt ),
	};
	if ( kind === 'bounty' ) {

		const r = raw.region;
		if ( typeof raw.target !== 'string' || ! raw.target || ! r || ! Number.isFinite( r.x ) || ! Number.isFinite( r.z ) ) return null;
		Object.assign( n, {
			tier: clamp( Math.round( num( raw.tier, 1 ) ), 1, 3 ), target: str( raw.target, 80 ), captain: str( raw.captain, 60 ), epithet: str( raw.epithet, 40 ),
			ship: str( raw.ship, 40 ), craft: str( raw.craft, 40 ), region: { x: r.x, z: r.z, compass: str( r.compass, 20 ), distance: num( r.distance ) },
		} );

	}

	return n;

}

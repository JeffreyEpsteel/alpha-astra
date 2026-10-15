import { proceduralWave } from './Procedural.js';

// Emotes (docs/UNREAL_PARITY.md C8): a key opens a row of twelve (wave, dance, point, cheer, then wave 18E's laugh, bow, salute,
// flex, facepalm, thumbs up, sit on the ground, dance 2); 1 - 9, 0, -, = (or a tap on a button) plays one on the local avatar through the animation graph (Avatar.playMontage): the arms only while walking or
// with the rod out (the 'upper' slot over the locomotion), the whole body when standing still. Everyone else sees it:
// the emote goes out as a world event ('emote' { id }) and the other clients play it on that player's avatar.
//
//   const em = features.get( 'emotes' );
//   em.key                    the claimed key code (null when nothing was free); em.open() / em.close() / em.toggle()
//   em.play( id )             -> true | false (rate limited, busy, no avatar); ids: EMOTES
//   em.last                   { id, clip, slot, procedural } of the last local emote, or null
//   em.canEmote()             on foot, nothing modal up, not knocked down, not in a rod fight
//
// Which clip: the roster takes Wave, Dance, Point, Cheer_Clap, Laugh, Dance_2 (Rocketbox) and Sit_Ground (Kimodo), and AnimDef's
// pose clips Emote_Bow / _Salute / _Flex / _Facepalm / _ThumbsUp (AnimDef.montages of the emote's name). A character without one
// falls back to its montage's neighbour (friendlyWave, celebrate, beckon ...), then, for the wave only, to a procedural arm wave
// built on its own rig (Procedural.js). `hold`: plays until you move (sit); `still`: whole body only, refused while moving. Rate limit: one emote per RATE_LIMIT seconds per player (the sender's and,
// again, each remote player's: a flooding client cannot spam the others). Residents within RESIDENT_R answer a wave.
//
// Events: emote { id, local?, from? }  (features.emit, after it started)   world event 'emote' { id } (netsync)

export const EMOTES = [
	{ id: 'wave', label: 'Wave', montage: 'wave', fallbacks: [ 'friendlyWave' ], loop: false, reply: true },
	{ id: 'dance', label: 'Dance', montage: 'dance', fallbacks: [ 'celebrate' ], loop: true },
	{ id: 'point', label: 'Point', montage: 'point', fallbacks: [ 'beckon' ], loop: false },
	{ id: 'cheer', label: 'Cheer', montage: 'cheer', fallbacks: [ 'celebrate' ], loop: false },
	{ id: 'laugh', label: 'Laugh', montage: 'laugh', fallbacks: [ 'prankLaugh' ], loop: false },
	{ id: 'bow', label: 'Bow', montage: 'bow', fallbacks: [], loop: false },
	{ id: 'salute', label: 'Salute', montage: 'salute', fallbacks: [], loop: false },
	{ id: 'flex', label: 'Flex', montage: 'flex', fallbacks: [ 'cheer' ], loop: false },
	{ id: 'facepalm', label: 'Facepalm', montage: 'facepalm', fallbacks: [ 'disappointed' ], loop: false },
	{ id: 'thumbsUp', label: 'Thumbs up', montage: 'thumbsUp', fallbacks: [], loop: false },
	{ id: 'sit', label: 'Sit', montage: 'sitGround', fallbacks: [], loop: true, hold: true, still: true },
	{ id: 'dance2', label: 'Dance 2', montage: 'dance2', fallbacks: [ 'dance' ], loop: true },
];
export const EMOTE_IDS = EMOTES.map( ( e ) => e.id );
export const RATE_LIMIT = 2; // s between emotes (per player)
export const LOOP_SECONDS = 5; // a dance runs this long
export const HOLD_SECONDS = 30; // a held emote (sit) on another player's avatar: until their next pose moves them, at most this
export const ROW_IDLE = 4; // s: the row closes by itself
export const RESIDENT_R = 10; // m: residents this close answer a wave
export const MOVING = 0.8; // m/s: a full-body emote ends when you walk off
// no free letter exists (every one is used or claimed), so the first free of these is taken
export const KEY_CANDIDATES = [ 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9' ];
export const PICK_KEYS = [ 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal', 'BracketLeft' ]; // while the row is open: the emotes in order (without the row's own key)
const KEY_LABEL = ( code ) => ( { Minus: '-', Equal: '=' } )[ code ] || code.replace( 'Digit', '' );

const ON_FOOT = new Set( [ 'walk', 'deck' ] );
const speedOf = ( p ) => ( p && p.velocity ? Math.hypot( p.velocity.x, p.velocity.z ) : p && Number.isFinite( p.speed ) ? p.speed : 0 );

const CSS = `.em-row{position:fixed;left:50%;bottom:calc(88 * var(--tw-u, 1px));transform:translateX(-50%);display:flex;flex-wrap:wrap;justify-content:center;max-width:min(92vw,calc(560 * var(--tw-u, 1px)));gap:calc(8 * var(--tw-u, 1px));padding:calc(8 * var(--tw-u, 1px));
border-radius:calc(14 * var(--tw-u, 1px));background:var(--tw-glass, rgba(12,18,26,.62));backdrop-filter:blur(8px);z-index:30;font:500 calc(12.5 * var(--tw-u, 1px)) var(--tw-font, system-ui);color:var(--tw-ink, #eef6f8)}
.em-row[hidden]{display:none}
.em-row button{all:unset;cursor:pointer;min-width:calc(64 * var(--tw-u, 1px));min-height:44px;padding:calc(6 * var(--tw-u, 1px)) calc(10 * var(--tw-u, 1px));text-align:center;border-radius:calc(10 * var(--tw-u, 1px));background:var(--tw-fill, rgba(170,215,235,.07))}
.em-row button:hover,.em-row button:focus-visible{background:var(--tw-fill-2, rgba(170,215,235,.12));outline:2px solid var(--tw-aqua, #5fe3d4)}
.em-row kbd{display:block;font:600 calc(10.5 * var(--tw-u, 1px)) var(--tw-mono, monospace);opacity:.6}`;

export class Emotes {

	constructor( app, features ) {

		this.app = app;
		this.features = features || null;
		this.t = 0; // own clock (s): the rate limits
		this.key = null;
		for ( const k of KEY_CANDIDATES ) {

			if ( ! features || ! features.claimKey || features.claimKey( k, 'emotes' ) ) { this.key = k; break; }

		}

		this.pickKeys = PICK_KEYS.filter( ( k ) => k !== this.key ); // the row's key toggles it, so it never picks
		this.rowOpen = false;
		this._rowT = 0;
		this.el = null;
		this.last = null;
		this._lastAt = - Infinity;
		this._remoteAt = new Map(); // peer id -> clock of its last emote
		this._cur = null; // { handle, slot, t, dur } the local emote playing
		this._replies = []; // { due, ids } residents about to wave back
		this.sent = 0; this.received = 0; this.blocked = 0;
		this._off = [];
		if ( features && features.on ) this._off.push( features.on( 'remoteWorldEvent', ( e ) => this._remote( e ) ) );

	}

	// ---- gates

	_panelOpen() {

		const hud = this.app && this.app.game && this.app.game.hud;
		if ( hud && ( hud.invOpen || hud.standOpen || hud.rosterOpen || hud.catchOpen ) ) return true;
		try { return !! ( this.features && this.features.panelOpen && this.features.panelOpen() ); } catch ( e ) { return false; }

	}

	// on foot (land or a deck), nothing modal up, not knocked down, not fighting a fish
	canEmote() {

		const a = this.app, p = a && a.player;
		if ( ! p || ! ON_FOOT.has( p.mode ) ) return false;
		if ( a.paused || a.menuOpen || a.freeCam ) return false;
		if ( a.input && a.input.enabled === false ) return false;
		if ( a.avatar && a.avatar.ragdolling ) return false;
		const m = this.features && this.features.get ? this.features.get( 'melee' ) : null;
		if ( m && m.playerDown ) return false;
		const g = a.game;
		if ( g && g.fight ) return false;
		return ! this._panelOpen();

	}

	// ---- the row

	open() {

		if ( ! this.canEmote() ) return false;
		this.rowOpen = true;
		this._rowT = ROW_IDLE;
		this._dom( true );
		return true;

	}

	close() {

		this.rowOpen = false;
		this._dom( false );

	}

	toggle() {

		if ( this.rowOpen ) { this.close(); return false; }
		return this.open();

	}

	_dom( show ) {

		if ( typeof document === 'undefined' || ! document.createElement ) return;
		if ( ! this.el ) {

			if ( ! show ) return;
			try {

				if ( ! document.getElementById( 'em-style' ) ) {

					const st = document.createElement( 'style' );
					st.id = 'em-style';
					st.textContent = CSS;
					document.head.append( st );

				}

				const el = document.createElement( 'div' );
				el.className = 'em-row';
				el.setAttribute( 'role', 'toolbar' );
				el.setAttribute( 'aria-label', 'Emotes' );
				EMOTES.forEach( ( e, i ) => {

					const b = document.createElement( 'button' );
					b.type = 'button';
					b.innerHTML = `${ e.label }<kbd>${ this.pickKeys[ i ] ? KEY_LABEL( this.pickKeys[ i ] ) : '' }</kbd>`;
					b.addEventListener( 'click', () => { this.play( e.id ); this.close(); } );
					el.append( b );

				} );
				( document.querySelector( '.tw-root' ) || document.body ).append( el );
				this.el = el;

			} catch ( err ) { this.el = null; return; }

		}

		this.el.hidden = ! show;

	}

	// ---- playing

	_emote( id ) {

		return EMOTES.find( ( e ) => e.id === id ) || null;

	}

	// the montage on an avatar: the emote's own, then its neighbours, then the procedural wave; -> { handle, clip, procedural } | null
	_start( avatar, em, slot ) {

		if ( ! avatar || typeof avatar.playMontage !== 'function' ) return null;
		const opts = { slot, loop: em.loop };
		for ( const name of [ em.montage, ...em.fallbacks ] ) {

			let h = null;
			try { h = avatar.playMontage( name, opts ); } catch ( e ) { h = null; }
			if ( h && h.playing !== false ) return { handle: h, clip: name, procedural: false };

		}

		if ( em.id !== 'wave' ) return null; // the procedural arm wave only stands in for a wave
		const proc = proceduralWave( avatar );
		if ( proc ) {

			let h = null;
			try { h = avatar.playMontage( proc, { slot, loop: false } ); } catch ( e ) { h = null; }
			if ( h && h.playing !== false ) return { handle: h, clip: proc, procedural: true };

		}

		return null;

	}

	// the slot: arms only over the legs while moving or with the rod out, the whole body when standing
	_slot() {

		const a = this.app, rod = a && a.game && a.game.rod;
		const rodOut = !! ( rod && ( rod.equipped || ( rod.state && rod.state !== 'idle' && rod.state !== 'stowed' ) ) );
		return speedOf( a && a.player ) > 0.5 || rodOut ? 'upper' : 'full';

	}

	play( id ) {

		const em = this._emote( id );
		if ( ! em || ! this.canEmote() ) return false;
		if ( this.t - this._lastAt < RATE_LIMIT ) { this.blocked ++; return false; }
		const slot = this._slot();
		if ( em.still && slot !== 'full' ) return false; // sitting down while walking or with the rod out: no
		const r = this._start( this.app.avatar, em, slot );
		if ( ! r ) return false;
		this._lastAt = this.t;
		if ( this._cur && this._cur.handle && this._cur.handle.playing ) try { this._cur.handle.stop( 0.15 ); } catch ( e ) { /* gone */ }
		this._cur = { handle: r.handle, slot, t: 0, dur: em.loop && ! em.hold ? LOOP_SECONDS : Infinity };
		this.last = { id, clip: r.clip, slot, procedural: r.procedural };
		this.sent ++;
		const ns = this.app.netsync;
		if ( ns && ns.sendWorldEvent ) try { ns.sendWorldEvent( 'emote', { id } ); } catch ( e ) { /* offline */ }
		if ( this.features && this.features.emit ) this.features.emit( 'emote', { id, local: true } );
		if ( em.reply ) this._queueReplies();
		return true;

	}

	// another player's emote (never a stored replay), on their avatar; each sender has its own rate limit
	_remote( e ) {

		if ( ! e || e.kind !== 'emote' || e.replay || ! e.data ) return false;
		const em = this._emote( e.data.id );
		const from = typeof e.from === 'string' ? e.from : null;
		if ( ! em || ! from || from === 'server' ) return false;
		const last = this._remoteAt.get( from );
		if ( last !== undefined && this.t - last < RATE_LIMIT ) { this.blocked ++; return false; }
		const peer = this.app && this.app.remotePlayers && this.app.remotePlayers.peers ? this.app.remotePlayers.peers.get( from ) : null;
		if ( ! peer || ! peer.avatar ) return false;
		const slot = peer.pose && peer.pose.speed > 0.5 ? 'upper' : 'full';
		if ( em.still && slot !== 'full' ) return false;
		const r = this._start( peer.avatar, em, slot );
		if ( ! r ) return false;
		this._remoteAt.set( from, this.t );
		if ( this._remoteAt.size > 64 ) for ( const [ k, v ] of this._remoteAt ) if ( this.t - v > RATE_LIMIT ) this._remoteAt.delete( k );
		if ( em.loop && r.handle && typeof r.handle.stop === 'function' ) peer.emoteStop = { handle: r.handle, due: this.t + ( em.hold ? HOLD_SECONDS : LOOP_SECONDS ) };
		this.received ++;
		if ( this.features && this.features.emit ) this.features.emit( 'emote', { id: em.id, from } );
		return true;

	}

	// ---- residents answer a wave (an optional hook: Resident.respond( clip ) if the residents have it, else the gesture)

	_queueReplies() {

		const R = this.app && this.app.residents, p = this.app && this.app.player;
		if ( ! R || ! R.list || ! p || ! p.position ) return;
		const near = R.list.filter( ( r ) => Number.isFinite( r.x ) && ( r.state === 'idle' || r.state === 'pause' ) && ! r.gesture && Math.hypot( r.x - p.position.x, r.z - p.position.z ) < RESIDENT_R )
			.sort( ( a, b ) => Math.hypot( a.x - p.position.x, a.z - p.position.z ) - Math.hypot( b.x - p.position.x, b.z - p.position.z ) ).slice( 0, 2 );
		near.forEach( ( r, i ) => this._replies.push( { due: this.t + 0.9 + i * 0.5, r } ) );

	}

	_reply( r ) {

		if ( r.state !== 'idle' && r.state !== 'pause' ) return;
		try {

			if ( typeof r.respond === 'function' ) r.respond( 'Wave' );
			else if ( typeof r._gesture === 'function' ) r._gesture( 'Wave' );
			this.replied = ( this.replied | 0 ) + 1;

		} catch ( e ) { /* a resident without the clip */ }

	}

	// ---- frame

	update( dt ) {

		this.t += Math.max( 0, Math.min( 0.25, Number.isFinite( dt ) ? dt : 0 ) );
		const a = this.app, inp = a && a.input;
		if ( this.key && inp && typeof inp.hit === 'function' ) {

			if ( inp.hit( this.key ) ) this.toggle();
			else if ( this.rowOpen ) {

				const K = this.pickKeys;
				for ( let i = 0; i < K.length && i < EMOTES.length; i ++ ) if ( inp.hit( K[ i ] ) ) { this.play( EMOTES[ i ].id ); this.close(); break; }

			}

		}

		if ( this.rowOpen ) {

			this._rowT -= dt;
			if ( this._rowT <= 0 || ! this.canEmote() ) this.close();

		}

		const c = this._cur;
		if ( c ) {

			c.t += dt;
			const h = c.handle;
			if ( ! h || h.playing === false ) this._cur = null;
			else if ( c.t >= c.dur || ( c.slot === 'full' && speedOf( a.player ) > MOVING ) ) {

				try { h.stop( 0.25 ); } catch ( e ) { /* gone */ }
				this._cur = null;

			}

		}

		if ( this._replies.length ) {

			const keep = [];
			for ( const q of this._replies ) { if ( q.due > this.t ) keep.push( q ); else this._reply( q.r ); }
			this._replies = keep;

		}

		// a remote dance (or sit) runs its seconds, or until that player moves, then blends out
		const rp = a && a.remotePlayers && a.remotePlayers.peers;
		if ( rp ) for ( const peer of rp.values() ) if ( peer.emoteStop && ( this.t >= peer.emoteStop.due || ( peer.pose && peer.pose.speed > MOVING ) ) ) {

			try { peer.emoteStop.handle.stop( 0.25 ); } catch ( e ) { /* gone */ }
			peer.emoteStop = null;

		}

	}

	stats() {

		return { key: this.key, open: this.rowOpen, sent: this.sent, received: this.received, blocked: this.blocked, last: this.last ? this.last.id : null, replied: this.replied | 0 };

	}

	reset() {

		this.close();
		this._cur = null;
		this._replies.length = 0;

	}

	dispose() {

		for ( const off of this._off ) try { off(); } catch ( e ) { /* gone */ }
		this._off.length = 0;
		if ( this.el && this.el.parentNode ) this.el.parentNode.removeChild( this.el );
		this.el = null;

	}

}

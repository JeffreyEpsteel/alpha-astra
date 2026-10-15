import { Vector3 } from '../../engine/index.js';
import { Avatar } from '../../player/Avatar.js';
import { mulberry32 } from '../../util/Noise.js';
import { Raider } from '../melee/Raider.js';
import { RAIDER, TIERS, yawToward, wrapAngle } from '../melee/MeleeData.js';
import { BOARD_SITES, STALLS } from '../notices/Sites.js';
import {
	RULES, CREW_TWEAK, CREW_NAMES, CAPTAIN_CHARACTERS, CREW_CHARACTERS, clamp, hash,
	toLocal, toWorld, deckFor, clampDeck, hullGap, layout, tierOf, ransomFor, plunderFor,
} from './BoardingData.js';
import { Prisoner } from './Prisoner.js';
import { BoardingHud } from './BoardingHud.js';
import { Hostile } from './Hostile.js';

// Boarding: take a crippled pirate ship, fight her crew on deck, and either take the captain prisoner (ransom at the harbour) or
// plunder her. Sources: NAVAL_BRIEF C4 and WORLD_TRADE_PIRATES_BRIEF C3 / D5 of the naval fork (see BoardingData.js).
//
//   features.add( 'boarding', boarding );            // module: { install } -> the instance below; add it AFTER 'melee' and 'naval'
//   const b = features.get( 'boarding' );
//   b.phase       'idle' | 'cross-out' | 'cross-in' | 'fight' | 'surrender' | 'ret-out' | 'ret-in'
//   b.offer       the pirate ship that can be boarded now (crippled, alongside, boat slow) or null
//   b.prisoners   [ Prisoner ] (b.prisoners.length is the HUD counter)         b.stats   { boarded, captured, plundered, ... }
//   b.board( ship )     start the crossing by hand (tests, a scripted event)     b.choose( 0 | 1 )   take prisoner | plunder
//   b.handOver( port )  deliver every prisoner at 'home' | 'pons' (the E interactables call this)     b.view()   plain HUD model
//   b.toJSON() / fromJSON( d ) / reset() / dispose()       (the prisoners are saved; a fight in progress is not)
//
// The flow (all of it driven from update(), after melee and naval):
//   1. A pirate ship shot below 25 % of her hull by the player strikes her colours (state 'adrift': she lies still, stops firing and
//      no longer flees; Naval's brains leave unknown states alone). With the player's boat within 8 m of her hull and under 3 m/s,
//      the HUD offers "Board": B (claimed on the registry), or E on deck away from the helm.
//   2. A short fade is the plank. The player stands on her deck (Player mode 'walk'; this module rides the player on the ship's
//      frame and heave, and keeps him inside the bulwarks). The boat is moored where it lies (a moored boat is not a legal target).
//   3. 2 crew (sloop) or 3 (brigantine) fight on deck. They are src/features/melee Raider instances with a small deck host as owner
//      and are registered on melee.raiders, so the player's blows, guard, evade, stamina, hit numbers, tags and telegraph are all melee's.
//   4. With the crew down the captain surrenders. 1: Take prisoner (he rides in your boat's passenger seat, follows you ashore;
//      the HUD counts prisoners). 2: Plunder (coins + cargo crates through trade.addCargo). Either way you cross back and the ship
//      founders (Ship.startSinking). B during the fight retreats to the boat (the survivors stay on board for next time).
//   5. Ransom: E at the harbour "rail" beside either notice board (Hand over prisoner). A prisoner pays by tier; a bounty target taken
//      alive pays the contract x1.5 (the notices pay x1 on the shipSunk event, this module adds the rest).
//   6. Losing the melee fight (playerKnockedDown): the crew win, the ship sails off, the boat is towed home, and each prisoner you hold
//      escapes with a 65 % chance each. An escaped bounty captain is re-announced (bountyAccepted, resumed) so Naval spawns him again.
//
// Events emitted: shipCrippled { id, name }, boardingStarted { id, name, crew }, crewDefeated { id, name, ship }, captainSurrendered { id, name },
//   prisonerTaken { name, ship, tier, value, bounty }, shipPlundered { id, coins, goods }, boardingEnded { id, outcome },
//   prisonerEscaped { name }, prisonerRansomed { count, total, port }, and, from the shared vocabulary, shipSunk { id, name, faction:'pirate',
//   byPlayer:true, boarded:true ... } (at once, or for a bounty prisoner at the hand-over so the notices claim it then) plus
//   bountyCaptured { id, target, captain, tier, reward, port } at the hand-over.
// Listened to: bountyAccepted (kept, so an escaped captain can be announced again), bountyCancelled / bountyClaimed (the prisoner
//   is then worth the plain ransom), playerKnockedDown, playerBoatSunk, shipSunk (the boarded ship went down some other way).
//
// Hostile boarding (pirates boarding the player's boat) lives in Hostile.js as this.hostile, updated from update(); prisonerTaken carries the ship id.
//
// Wave 15C (hijack any vessel): every NPC ship the player cripples strikes and can be boarded - pirates, merchants and the navy
// (RULES.prizes; a merchant ships RULES.crew.trawler deck hands, a navy hull one more). The prisoner is a pirate's affair (only a
// pirate captain fetches a ransom: the option is disabled for the others). With the hijack feature installed the surrender adds
// 3 "Take the ship" (hijack.takeOffer( ship ) -> { ok, sub }): you stay aboard, hijack.takeShip( ship, { how: 'boarded', goods } )
// makes her your boat (your old one stays moored where it lies) and boardingEnded { outcome: 'taken' } follows; a pirate taken
// this way counts as beaten (shipSunk { how: 'taken', taken: true }: the ledger, a bounty). b.board( ship, { sneak: true } ) is
// the hijack feature's alarm path: the player is already on her deck (sneaked aboard), his own boat is left alone.
//
// Headless: install( app, features, { avatarFactory, hud: false, rand, seed, naval, melee, trade, notices } ) takes stubs.

const _fp = {};
const SECOND_KEYS = { 0: [ 'Digit1', 'Numpad1' ], 1: [ 'Digit2', 'Numpad2' ], 2: [ 'Digit3', 'Numpad3' ] };
const PRIZES = new Set( RULES.prizes || [ 'pirate' ] );
// a ship that can strike to the player and be boarded (a remote player's mirrored puppet never)
const isPrize = ( s ) => !! s && PRIZES.has( s.faction ) && ! s.puppet;
const FIGHT_HINT = '<kbd>LMB</kbd> attack &nbsp;·&nbsp; <kbd>RMB</kbd> guard &nbsp;·&nbsp; <kbd>Q</kbd> evade &nbsp;·&nbsp; <kbd>B</kbd> back to your boat';
const DOWN_STATES = new Set( [ 'down', 'getup', 'flee', 'gone' ] );

// the owner the crew Raiders are built with: their walkable "terrain" is the ship's deck (height of the deck, rolling and pitching
// with her; off the deck there is none), the attack token, the strike resolution and the sounds are melee's
class DeckHost {

	constructor( b ) {

		this.b = b;
		this.raiders = [];
		this.colliders = null;
		this.terrain = { heightAt: ( x, z ) => b.deckHeightAtWorld( x, z ) };

	}

	get peaceful() {

		const m = this.b.melee;
		return !! ( m && m.peaceful );

	}

	rand() {

		return this.b.rng();

	}

	target() {

		const m = this.b.melee;
		return m ? m.target() : { x: 0, y: 0, z: 0, valid: false };

	}

	tokenFree( r ) {

		const m = this.b.melee;
		return m ? m.tokenFree( r ) : true;

	}

	takeToken( r ) {

		const m = this.b.melee;
		if ( m ) m.takeToken( r );

	}

	releaseToken( r ) {

		const m = this.b.melee;
		if ( m ) m.releaseToken( r );

	}

	raiderStrike( r ) {

		const m = this.b.melee;
		return m ? m.raiderStrike( r ) : 'missed';

	}

	onWindup( r ) {

		const m = this.b.melee;
		if ( m ) m.onWindup( r );

	}

	onAggro( r ) {

		const m = this.b.melee;
		if ( m ) m.onAggro( r );

	}

	onDefeated( r ) {

		this.b._crewDown( r );

	}

	// the deck is narrow: the crew waiting for a token circle close (melee Raider 'circle')
	circleRadius() {

		return 2.4;

	}

	far() {

		return false;

	}

}

export class Boarding {

	constructor( app, features, opts = {} ) {

		this.app = app || {};
		this.features = features || null;
		this.opts = opts;
		this.enabled = opts.enabled !== false;
		this.rng = opts.rand || mulberry32( opts.seed !== undefined ? opts.seed : ( Date.now() & 0xffffff ) );
		this.avatarFactory = opts.avatarFactory || ( ( o ) => new Avatar( o ) );
		this.terrain = opts.terrain || this.app.terrainData || null;
		this.time = 0;
		this.phase = 'idle';
		this.tl = 0; // s into the current phase
		this.fade = 0;
		this.ship = null;
		this.prev = null; // the ship's pose last frame (x, z, yaw)
		this.deck = null;
		this.crew = []; // the pooled crew Raiders (kept; hidden when not on a ship)
		this.crewSpawned = 0;
		this.crewDown = 0;
		this.captain = null; // { avatar, name, character, lx, lz }
		this.deal = null; // the numbers shown at the surrender
		this.outcome = null;
		this.offer = null;
		this.prisoners = [];
		this.bountyInfo = new Map();
		this.stats = { boarded: 0, repelled: 0, captured: 0, plundered: 0, ransomed: 0, ransomTotal: 0, escaped: 0, crewDefeated: 0, taken: 0 };
		this.host = new DeckHost( this );
		this._moor = null;
		this._moverSaved = false;
		this._handing = false;
		this._tmp = { x: 0, z: 0 };
		this._offs = [];
		this._removers = [];
		this._warned = false;

		this.keyOk = this.features && this.features.claimKey ? this.features.claimKey( 'KeyB', 'boarding' ) : true;

		const hudEl = this.app.ui && this.app.ui.ui ? ( this.app.ui.ui.hud || this.app.ui.ui.root ) : ( opts.hudElement || null );
		this.hud = opts.hud === false ? null : new BoardingHud( { hud: hudEl, doc: opts.doc } );
		if ( this.hud && ! this.hud.enabled ) this.hud = null;
		if ( this.hud ) this.hud.onChoose = ( i ) => this.choose( i );
		// pirates boarding the player's boat (Hostile.js): its own panel, driven from update()
		this.hostile = opts.hostile === false ? null : new Hostile( this, {
			hud: this.hud ? new BoardingHud( { hud: hudEl, doc: opts.doc } ) : null,
			seed: ( opts.seed !== undefined ? opts.seed : Date.now() ) ^ 0x51ab,
		} );

		const f = this.features;
		if ( f && f.on ) {

			this._offs.push( f.on( 'bountyAccepted', ( e ) => this._onBountyAccepted( e ) ) );
			this._offs.push( f.on( 'bountyCancelled', ( e ) => this._onBountyGone( e ) ) );
			this._offs.push( f.on( 'bountyClaimed', ( e ) => this._onBountyGone( e ) ) );
			this._offs.push( f.on( 'playerKnockedDown', () => this._onKnockedDown() ) );
			this._offs.push( f.on( 'playerBoatSunk', () => this._onBoatSunk() ) );
			this._offs.push( f.on( 'shipSunk', ( e ) => this._onShipSunk( e ) ) );

		}

		if ( f && f.interactable ) this._registerHandOver();

	}

	// ------------------------------------------------------------------ collaborators

	get naval() {

		return this.opts.naval || ( this.features && this.features.get ? this.features.get( 'naval' ) : null );

	}

	get melee() {

		return this.opts.melee || ( this.features && this.features.get ? this.features.get( 'melee' ) : null );

	}

	get trade() {

		return this.opts.trade || ( this.features && this.features.get ? this.features.get( 'trade' ) : null );

	}

	get notices() {

		return this.opts.notices || ( this.features && this.features.get ? this.features.get( 'notices' ) : null );

	}

	get hijack() {

		return this.opts.hijack || ( this.features && this.features.get ? this.features.get( 'hijack' ) : null );

	}

	get state() {

		return this.features ? this.features.state : null;

	}

	get busy() {

		return this.phase !== 'idle';

	}

	get active() {

		const nv = this.naval;
		return this.enabled && !! nv && nv.active !== false;

	}

	get isOpen() {

		return false;

	}

	close() {

		// Escape does not dismiss the surrender: it is a choice (1 / 2)

	}

	wantsMouse() {

		return false;

	}

	_toast( text, ms = 3000 ) {

		const g = this.app.game;
		if ( g && g.toast ) g.toast( text, ms );

	}

	_emit( name, payload ) {

		if ( this.features && this.features.emit ) this.features.emit( name, payload );

	}

	_earn( n ) {

		const st = this.state;
		if ( st && st.earn && n > 0 ) st.earn( n );
		const a = this.app.audio;
		if ( a && a.coin && n > 0 ) try { a.coin(); } catch ( e ) { /* no audio */ }

	}

	_sfx( bank, opts ) {

		const m = this.melee;
		if ( m && m.sfx ) m.sfx( bank, opts );

	}

	// ------------------------------------------------------------------ deck geometry (the ship's frame)

	_pose( s = this.ship ) {

		return { x: s.x, z: s.z, yaw: s.yaw };

	}

	_deckY( lx, lz, s = this.ship ) {

		s.finalPose( _fp );
		// stepped decks (the navy frigate's quarterdeck and forecastle, ShipClasses decks): the one under lz, else the main deck
		let deck = s.cls.deck;
		if ( s.cls.decks ) for ( const d of s.cls.decks ) if ( lz >= d.z0 && lz < d.z1 ) { deck = d.y; break; }
		return _fp.y + deck + 0.05 + lz * Math.sin( _fp.pitch ) + lx * Math.sin( _fp.roll );

	}

	// the deck's height at a world point, or -50 where there is no deck (the crew's "terrain")
	deckHeightAtWorld( x, z ) {

		const s = this.ship;
		if ( ! s || ! this.deck ) return - 50;
		const l = toLocal( this._pose( s ), x, z, this._tmp );
		const q = ( l.x / this.deck.hb ) ** 2 + ( l.z / this.deck.hl ) ** 2;
		if ( q > 1.12 ) return - 50;
		return this._deckY( l.x, l.z, s );

	}

	// ------------------------------------------------------------------ crippled ships

	// deck hands by class (a ship or a class id); a navy hull ships one more
	_crewFor( k ) {

		const kind = typeof k === 'string' ? k : k && k.kind;
		return ( RULES.crew[ kind ] || 2 ) + ( k && typeof k === 'object' && k.faction === 'navy' ? 1 : 0 );

	}

	_cripple( dt, nv ) {

		for ( const s of nv.ships ) {

			if ( ! isPrize( s ) || ! s.alive ) continue;
			if ( s.state === 'adrift' ) {

				s.adriftT = ( s.adriftT || 0 ) + dt;
				if ( s.adriftT > RULES.adriftLife && this.ship !== s ) this._founder( s );
				continue;

			}

			if ( s.state === 'boarded' ) continue;
			if ( s.hpFraction < RULES.cripple && s.lastHitBy === 'player' && ! s.repelled ) this._strikeColours( s );

		}

	}

	_strikeColours( s ) {

		s.state = 'adrift';
		s.stateTime = 0;
		s.fleeAt = - 1; // the brain's flee rule is hp <= fleeAt: never again
		s.wantSpeed = 0;
		s.want = s.yaw;
		s.adriftT = 0;
		if ( ! s.boarding ) {

			const n = this._crewFor( s );
			s.boarding = { crewLeft: n, crewTotal: n };

		}

		this._toast( s.faction === 'pirate' ? `The ${ s.name } has struck her colours · pull alongside to board` : `The ${ s.name } heaves to and strikes · pull alongside to board`, 4200 );
		this._emit( 'shipCrippled', { id: s.id, name: s.name } );

	}

	// a ship nobody boarded founders after a while: the player beat her, so the sinking counts for him
	_founder( s ) {

		this._sink( s, { emit: true, how: 'foundered' } );

	}

	// start her sinking and say so. For a bounty ship that is held (a prisoner), the claim waits for the hand-over.
	_sink( s, { emit = true, how = 'sunk', coins = 0 } = {} ) {

		if ( ! s.alive ) return;
		s.startSinking();
		const nv = this.naval;
		if ( nv ) {

			if ( nv.stats ) { nv.stats.shipsSunk ++; if ( s.faction === 'pirate' ) nv.stats.piratesSunk ++; }
			if ( s.bounty && nv.bounties ) nv.bounties.delete( s.bounty.id );

		}

		if ( emit ) this._emit( 'shipSunk', this._sunkPayload( s, { coins, how } ) );

	}

	_sunkPayload( s, { coins = 0, how = 'sunk' } = {} ) {

		const bt = s.bounty;
		const ev = { id: s.id, name: bt ? bt.target : s.name, faction: s.faction, x: s.x, z: s.z, byPlayer: true, kind: s.kind, loot: coins, boarded: true, how };
		if ( bt ) Object.assign( ev, { target: bt.target, captain: bt.captain, bountyId: bt.id, shipName: s.name } );
		return ev;

	}

	// ------------------------------------------------------------------ the offer

	_findOffer( nv ) {

		const p = this.app.player, b = this.app.boatCtl;
		if ( ! p || ! b || ! b.position ) return null;
		if ( p.mode !== 'boat' && p.mode !== 'deck' && p.mode !== 'seat' ) return null;
		if ( nv.playerHull && nv.playerHull.sunk ) return null;
		const sp = Number.isFinite( b.speed ) ? b.speed : ( b.velocity ? Math.hypot( b.velocity.x, b.velocity.z ) : 0 );
		if ( sp > RULES.slow ) return null;
		let best = null, bd = Infinity;
		for ( const s of nv.ships ) {

			if ( ! isPrize( s ) || ! s.alive || s.state !== 'adrift' || s.hpFraction >= RULES.cripple ) continue;
			const gap = hullGap( s.cls, this._pose( s ), b.position.x, b.position.z );
			if ( gap <= RULES.range && gap < bd ) { bd = gap; best = s; }

		}

		return best;

	}

	// ------------------------------------------------------------------ the crossing

	// start the crossing to a crippled ship by hand. Returns false if it cannot be done now. sneak: the player is on her deck
	// already (the hijack feature's alarm: the crew wake), his own boat is not touched
	board( ship, { sneak = false } = {} ) {

		if ( this.phase !== 'idle' || ! ship || ! ship.alive || ! this.app.player || ( ! sneak && ! this.app.boatCtl ) ) return false;
		this.ship = ship;
		this.deck = deckFor( ship.cls );
		this.phase = 'cross-out';
		this.tl = 0;
		this.outcome = null;
		this.sneak = !! sneak;
		this._wasState = ship.state; // (a sneaked-aboard ship the player retreats from lies at her mooring again)
		if ( ! sneak ) this._moorBoat();
		if ( ! ship.boarding ) {

			const n = this._crewFor( ship );
			ship.boarding = { crewLeft: n, crewTotal: n };

		}

		return true;

	}

	_moorBoat() {

		const b = this.app.boatCtl;
		if ( ! b || this._moor ) return;
		this._moor = { moored: !! b.moored };
		if ( b.mooring && b.position ) {

			this._moor.ax = b.mooring.anchor.x;
			this._moor.az = b.mooring.anchor.z;
			this._moor.heading = b.mooring.heading;
			b.mooring.anchor.set( b.position.x, 0, b.position.z );
			b.mooring.heading = b.getYaw ? b.getYaw() : 0;

		}

		b.driven = false;
		b.throttle = 0;
		b.moored = true; // a moored, undriven boat is not a target (Naval)

	}

	_unmoorBoat() {

		const b = this.app.boatCtl, m = this._moor;
		this._moor = null;
		if ( ! b || ! m ) return;
		b.moored = m.moored;
		if ( b.mooring && m.ax !== undefined ) {

			b.mooring.anchor.set( m.ax, 0, m.az );
			b.mooring.heading = m.heading;

		}

	}

	_crewRaider( i ) {

		if ( this.crew[ i ] ) return this.crew[ i ];
		const mine = this.app.avatar && this.app.avatar.character;
		const chars = CREW_CHARACTERS.filter( ( c ) => c !== mine );
		const character = chars[ ( i + hash( 'crew' ) ) % chars.length ];
		const avatar = this.avatarFactory( { scene: this.app.scene, character, lite: true } );
		const slot = { id: `bd-crew-${ i }`, x: 0, z: 0, when: 'day', characters: [ character ] };
		const r = new Raider( this.host, slot, avatar );
		r.active = false;
		r.visible = false;
		this.crew[ i ] = r;
		this.host.raiders.push( r );
		const m = this.melee;
		if ( m && Array.isArray( m.raiders ) && ! m.raiders.includes( r ) ) m.raiders.push( r );
		return r;

	}

	_spawnCrew( lay, n ) {

		const pose = this._pose();
		const used = new Set();
		for ( let i = 0; i < Math.max( n, this.crew.length ); i ++ ) {

			if ( i >= n ) {

				if ( this.crew[ i ] && this.crew[ i ].active ) this.crew[ i ].deactivate();
				continue;

			}

			const r = this._crewRaider( i );
			const w = toWorld( pose, lay.crew[ i ].x, lay.crew[ i ].z, {} );
			r.homeX = w.x;
			r.homeZ = w.z;
			r.homeYaw = yawToward( w.x, w.z, pose.x, pose.z );
			let name = CREW_NAMES[ Math.floor( this.rng() * CREW_NAMES.length ) % CREW_NAMES.length ];
			for ( let k = 0; k < 8 && used.has( name ); k ++ ) name = CREW_NAMES[ Math.floor( this.rng() * CREW_NAMES.length ) % CREW_NAMES.length ];
			used.add( name );
			// wave 4: the crew of a tougher ship (a tier 3 bounty) fight a tier up; they share melee's two tokens and circle
			const t = tierOf( this.ship );
			r.spawn( { name, tier: t } );
			r.cfg = { ...RAIDER, ...CREW_TWEAK, ...( t >= 3 ? TIERS[ 3 ] : { tier: t } ) };
			r.maxHp = r.hp = r.cfg.hp;
			r.yaw = r.homeYaw;
			r._ground();
			r._place();

		}

		this.crewSpawned = n;
		this.crewDown = 0;

	}

	_makeCaptain( lay ) {

		const s = this.ship, bt = s.bounty;
		const name = bt ? bt.captain : ( s.captain || ( s.faction === 'pirate' ? 'the captain' : `the master of the ${ s.name }` ) );
		const mine = this.app.avatar && this.app.avatar.character;
		const chars = CAPTAIN_CHARACTERS.filter( ( c ) => c !== mine );
		const character = chars[ hash( name ) % chars.length ];
		const avatar = this.avatarFactory( { scene: this.app.scene, character, lite: true } );
		this.captain = { avatar, name, character, lx: lay.captain.x, lz: lay.captain.z, action: 'swagger', pos: new Vector3(), yaw: 0 };
		this._placeCaptain();

	}

	_placeCaptain( dt = 0 ) {

		const c = this.captain, s = this.ship;
		if ( ! c || ! s ) return;
		const w = toWorld( this._pose( s ), c.lx, c.lz, {} );
		c.pos.set( w.x, this._deckY( c.lx, c.lz, s ), w.z );
		const p = this.app.player;
		if ( p ) c.yaw = yawToward( w.x, w.z, p.position.x, p.position.z );
		if ( c.avatar && c.avatar.update ) {

			c.avatar.update( dt, { position: c.pos, yaw: c.yaw, mode: 'walk', speed: 0, vy: 0, grounded: true, diving: false, frame: null, action: c.action } );

		}

	}

	// the fade is half done: step onto her deck
	_doCross() {

		const s = this.ship, p = this.app.player, b = this.app.boatCtl;
		if ( p.mode === 'boat' && p.leaveHelm ) p.leaveHelm();
		const pose = this._pose( s );
		const from = this.sneak || ! b || ! b.position ? p.position : b.position; // (sneaked aboard: where he stands)
		const bl = toLocal( pose, from.x, from.z, {} );
		let n = this.melee && this.melee.enabled ? ( s.boarding ? s.boarding.crewLeft : this._crewFor( s ) ) : 0;
		// wave 19C: the brave hands of the skipper's crew cross with the skipper; each holds one defender off the fight
		const cw = ! this.sneak && this.features && this.features.get ? this.features.get( 'crew' ) : null;
		const party = cw && typeof cw.boardingParty === 'function' ? cw.boardingParty( s, n ) : null;
		if ( party && party.held > 0 ) n = Math.max( 0, n - party.held );
		const lay = layout( this.deck, bl, n );
		s.state = 'boarded';
		s.wantSpeed = 0;
		s.want = s.yaw;
		this.prev = { ...pose };

		const w = toWorld( pose, lay.arrive.x, lay.arrive.z, {} );
		p.mode = 'walk';
		p.seat = null;
		p.action = null;
		p._seatT = undefined;
		p.position.set( w.x, this._deckY( lay.arrive.x, lay.arrive.z ), w.z );
		if ( p.velocity ) p.velocity.set( 0, 0, 0 );
		p.yaw = yawToward( w.x, w.z, pose.x, pose.z );
		p.pitch = - 0.05;
		p.grounded = true;
		p.armInit = false;
		p.camInit = false;
		p._camY = null;
		const m = this.melee;
		if ( m && m.rodAway ) m.rodAway( true );
		this._installMover();

		this._spawnCrew( lay, n );
		this._makeCaptain( lay );
		this.stats.boarded ++;
		this._toast( n ? `Boarding the ${ s.name } · ${ n } of the crew stand against you` : `Boarding the ${ s.name }`, 3200 );
		this._emit( 'boardingStarted', { id: s.id, name: s.name, crew: n } );

	}

	// melee's evade dash is limited to dry ground (terrain height > -0.6): on a deck it moves along the deck instead
	_installMover() {

		const m = this.melee;
		if ( ! m || this._moverSaved ) return;
		this._moverSaved = true;
		m.movePlayer = ( dx, dz ) => this._deckMove( dx, dz );

	}

	_removeMover() {

		if ( ! this._moverSaved ) return;
		this._moverSaved = false;
		const m = this.melee;
		if ( m ) delete m.movePlayer;

	}

	_deckMove( dx, dz ) {

		const p = this.app.player;
		if ( ! p || ! this.ship ) return false;
		p.position.x += dx;
		p.position.z += dz;
		this._confinePlayer();
		return true;

	}

	_confinePlayer() {

		const p = this.app.player, s = this.ship;
		const pose = this._pose( s );
		const l = toLocal( pose, p.position.x, p.position.z, {} );
		const c = clampDeck( this.deck, l.x, l.z, {} );
		const w = toWorld( pose, c.x, c.z, {} );
		p.position.x = w.x;
		p.position.z = w.z;
		p.position.y = this._deckY( c.x, c.z, s );
		if ( p.velocity ) p.velocity.y = 0;
		p.grounded = true;

	}

	// carry the player, the crew and the captain with the ship from last frame's pose to this one, then hold them on the deck
	_ride( dt ) {

		const s = this.ship, p = this.app.player;
		const now = this._pose( s ), prev = this.prev || now;
		const dyaw = wrapAngle( now.yaw - prev.yaw );
		if ( now.x !== prev.x || now.z !== prev.z || dyaw !== 0 ) {

			const l = {}, w = {};
			const move = ( o, kx, kz ) => {

				toLocal( prev, o[ kx ], o[ kz ], l );
				toWorld( now, l.x, l.z, w );
				o[ kx ] = w.x;
				o[ kz ] = w.z;

			};

			if ( p.mode === 'walk' ) { move( p.position, 'x', 'z' ); p.yaw += dyaw; }
			for ( const r of this.crew ) {

				if ( ! r.active ) continue;
				move( r, 'x', 'z' );
				move( r, 'homeX', 'homeZ' );
				r.yaw += dyaw;
				r.homeYaw += dyaw;

			}

		}

		this.prev = now;
		if ( p.mode === 'walk' ) this._confinePlayer();
		for ( const r of this.crew ) {

			if ( ! r.active ) continue;
			r._ground();
			r._place();

		}

		this._placeCaptain( dt );

	}

	// ------------------------------------------------------------------ the fight and the surrender

	_crewDown( r ) {

		this.crewDown ++;
		this.stats.crewDefeated ++;
		if ( this.ship && this.ship.boarding ) this.ship.boarding.crewLeft = Math.max( 0, this.ship.boarding.crewLeft - 1 );
		this._toast( `${ r.name } is down`, 1800 );
		this._emit( 'crewDefeated', { id: r.spawnId, name: r.name, ship: this.ship ? this.ship.name : '' } );

	}

	_crewAlive() {

		let n = 0;
		for ( const r of this.crew ) if ( r.active && ! DOWN_STATES.has( r.state ) ) n ++;
		return n;

	}

	_surrender() {

		const s = this.ship, c = this.captain;
		this.phase = 'surrender';
		this.tl = 0;
		const tier = tierOf( s );
		const bt = s.bounty;
		const plunder = plunderFor( s.cls, this.rng );
		const ransom = ransomFor( tier, this.rng );
		let reward = 0;
		if ( bt ) {

			const nt = this.notices;
			const n = nt && nt.active ? nt.active.find( ( x ) => x.kind === 'bounty' && x.id === bt.id ) : null;
			reward = n && n.reward ? n.reward.money : 0;

		}

		const hj = this.hijack;
		const take = hj && typeof hj.takeOffer === 'function' ? hj.takeOffer( s ) : null;
		this.deal = { tier, ransom, plunder, bounty: !! bt && reward > 0, reward, take };
		if ( c ) c.action = 'disappointed';
		if ( this.melee && this.melee.releaseToken ) for ( const r of this.crew ) this.melee.releaseToken( r );
		this._toast( `${ c ? c.name : 'The captain' } throws down the cutlass`, 3200 );
		this._emit( 'captainSurrendered', { id: s.id, name: c ? c.name : '' } );

	}

	_choiceModel() {

		const d = this.deal, c = this.captain, s = this.ship;
		if ( ! d ) return null;
		const full = this.prisoners.length >= RULES.maxPrisoners;
		const pirate = ! s || s.faction === 'pirate';
		const prisonerSub = ! pirate ? 'Only a pirate captain fetches a ransom' : full ? 'Your boat has no room for another prisoner'
			: d.bounty ? `The bounty x${ RULES.bountyMult } on delivery (about $${ Math.round( d.reward * RULES.bountyMult ) })` : `Ransom about $${ d.ransom } when you hand him over at the harbour`;
		const options = [
			{ key: '1', label: 'Take prisoner', sub: prisonerSub, disabled: full || ! pirate },
			{ key: '2', label: 'Plunder', sub: `About $${ d.plunder.coins } and ${ d.plunder.goods.reduce( ( a, g ) => a + g.qty, 0 ) } crates of cargo` },
		];
		// wave 15C: with the hijack feature, she can be yours
		const take = d.take;
		if ( take ) options.push( { key: '3', label: 'Take the ship', sub: take.sub || 'Her helm is yours; your boat stays moored here', disabled: ! take.ok } );
		return {
			title: `${ c ? c.name : 'The captain' } surrenders`,
			lines: [ `The crew of the ${ s ? s.name : 'ship' } is beaten.`, take && take.ok ? 'Take her, or she goes down once you have left her.' : 'The ship will go down once you have left her.' ],
			options,
		};

	}

	// 0: take prisoner, 1: plunder, 2: take the ship (with the hijack feature) - keys 1 / 2 / 3 or the buttons
	choose( i ) {

		if ( this.phase !== 'surrender' || ! this.deal ) return false;
		if ( i === 0 ) {

			if ( this.ship && this.ship.faction !== 'pirate' ) {

				this._toast( 'Only a pirate captain fetches a ransom' );
				return false;

			}

			if ( this.prisoners.length >= RULES.maxPrisoners ) {

				this._toast( 'No room for another prisoner in your boat' );
				return false;

			}

			this._beginReturn( 'prisoner' );
			return true;

		}

		if ( i === 1 ) {

			this._beginReturn( 'plunder' );
			return true;

		}

		if ( i === 2 && this.deal.take ) {

			const t = this.hijack && this.hijack.takeOffer ? this.hijack.takeOffer( this.ship ) : null;
			if ( ! t || ! t.ok ) {

				if ( t && t.sub ) this._toast( t.sub );
				return false;

			}

			this._beginReturn( 'take' );
			return true;

		}

		return false;

	}

	retreat() {

		if ( this.phase !== 'fight' ) return false;
		const m = this.melee;
		if ( m && m.playerDown ) return false;
		this._beginReturn( 'retreat' );
		return true;

	}

	// ------------------------------------------------------------------ the return

	_beginReturn( outcome ) {

		this.outcome = outcome;
		this.phase = 'ret-out';
		this.tl = 0;

	}

	_hideCrew() {

		const m = this.melee;
		for ( const r of this.crew ) {

			if ( r.active ) r.deactivate();
			if ( m && m.releaseToken ) m.releaseToken( r );

		}

	}

	// the player owns a boat to step back into (none: he swam out to a moored ship and goes back into the water)
	_hasBoat() {

		const st = this.state, b = this.app.boatCtl;
		return !! b && b.enabled !== false && ( ! st || st.boat !== null );

	}

	_stepBack() {

		const p = this.app.player, b = this.app.boatCtl;
		if ( ! p || p.mode !== 'walk' ) return;
		if ( ! this._hasBoat() ) {

			// over the side, into the water beside her
			const s = this.ship;
			if ( s ) {

				const w = toWorld( this._pose( s ), s.cls.beam * 0.5 + 2, 0, {} );
				p.position.set( w.x, 0, w.z );

			}

			p.mode = 'swim';
			if ( p.velocity ) p.velocity.set( 0, 0, 0 );
			p.camInit = false;
			p._camY = null;
			return;

		}

		if ( p.boardBoat && b ) {

			p.boardBoat();
			if ( p.deckYaw !== undefined && b.getYaw ) p.yaw = p.deckYaw + b.getYaw() + Math.PI;

		} else if ( b && b.position ) p.position.copy( b.position );

		p.armInit = false;
		p.camInit = false;
		p._camY = null;

	}

	_doReturn() {

		const s = this.ship, outcome = this.outcome;
		this._hideCrew();
		this._removeMover();
		if ( outcome === 'take' ) {

			// she is yours: you stay aboard; your boat stays moored where it lies (its anchor is set there already)
			this._moor = null;
			this._take( s );
			this._emit( 'boardingEnded', { id: s.id, outcome: 'taken' } );
			this.ship = null;
			this.deck = null;
			this.deal = null;
			this.prev = null;
			this.sneak = false;
			return;

		}

		this._stepBack();
		this._unmoorBoat();
		const sneak = this.sneak;
		this.sneak = false;
		if ( outcome === 'prisoner' ) this._takePrisoner( s );
		else if ( outcome === 'plunder' ) this._plunder( s );
		else if ( outcome === 'retreat' ) {

			if ( s.alive && sneak && ( this._wasState === 'moored' || this._wasState === 'dock' ) ) s.state = this._wasState;
			else if ( s.alive ) { s.state = 'adrift'; s.adriftT = 0; }
			this._dropCaptain();

		}

		this._emit( 'boardingEnded', { id: s.id, outcome } );
		this.ship = null;
		this.deck = null;
		this.deal = null;
		this.prev = null;

	}

	_dropCaptain() {

		const c = this.captain;
		this.captain = null;
		if ( c && c.avatar && c.avatar.dispose ) c.avatar.dispose();

	}

	_takePrisoner( s ) {

		const d = this.deal, c = this.captain, bt = s.bounty;
		const data = {
			id: s.id, name: c.name, ship: s.name, kind: s.kind, tier: d.tier, value: d.ransom, character: c.character,
			bountyId: bt ? bt.id : null, target: bt ? bt.target : null, bountyInfo: bt ? this.bountyInfo.get( bt.id ) || null : null,
		};
		this.prisoners.push( new Prisoner( data, c.avatar ) );
		this.captain = null; // the avatar belongs to the prisoner now
		this.stats.captured ++;
		this._toast( `${ c.name } is bound in your boat · hand him over at the harbour${ bt ? ' for the bounty' : '' }`, 4800 );
		this._emit( 'prisonerTaken', { id: s.id, name: c.name, ship: s.name, tier: d.tier, value: d.ransom, bounty: !! bt } );
		// a bounty prisoner is claimed at the hand-over; the ship still goes down now
		this._sink( s, { emit: ! bt, how: 'captured' } );

	}

	// "Take the ship": her cargo (the plunder's goods) comes with her; a pirate taken counts as beaten (the ledger, a bounty)
	_take( s ) {

		const d = this.deal, c = this.captain;
		this._dropCaptain();
		const hj = this.hijack;
		const r = hj && hj.takeShip ? hj.takeShip( s, { how: 'boarded', goods: d ? d.plunder.goods.map( ( g ) => ( { ...g } ) ) : [], captain: c ? c.name : null } ) : null;
		if ( ! r || ! r.ok ) {

			// (nothing took her after all: back to the boat; she lies adrift and founders in time)
			this._stepBack();
			this._unmoorBoat();
			if ( s.alive ) { s.state = 'adrift'; s.adriftT = 0; }
			return;

		}

		this.stats.taken ++;
		if ( s.faction === 'pirate' ) {

			const nv = this.naval;
			if ( s.bounty && nv && nv.bounties ) nv.bounties.delete( s.bounty.id );
			this._emit( 'shipSunk', { ...this._sunkPayload( s, { how: 'taken' } ), taken: true } );

		}

	}

	_plunder( s ) {

		const d = this.deal;
		this._earn( d.plunder.coins );
		const tr = this.trade;
		let crates = 0;
		if ( tr && tr.addCargo ) for ( const g of d.plunder.goods ) crates += tr.addCargo( g.good, g.qty, { paid: 0 } ) || 0;
		const want = d.plunder.goods.reduce( ( a, g ) => a + g.qty, 0 );
		this.stats.plundered ++;
		this._toast( `Plundered the ${ s.name } · +$${ d.plunder.coins }${ crates ? ` and ${ crates } crate${ crates > 1 ? 's' : '' } of cargo` : want ? ' · no room in the hold for the cargo' : '' }`, 4200 );
		this._emit( 'shipPlundered', { id: s.id, coins: d.plunder.coins, goods: d.plunder.goods.map( ( g ) => ( { ...g } ) ), stowed: crates } );
		this._dropCaptain();
		this._sink( s, { emit: true, how: 'plundered', coins: d.plunder.coins } );

	}

	// ------------------------------------------------------------------ losing, aborting

	_onKnockedDown() {

		// the prisoners hold their chance first
		for ( const pr of [ ...this.prisoners ] ) if ( this.rng() < RULES.escapeChance ) this._escape( pr );
		if ( this.phase === 'idle' ) return;
		if ( this.phase === 'fight' || this.phase === 'surrender' || this.phase === 'cross-in' || this.phase === 'ret-out' ) this._defeat();

	}

	// the crew won: the ship sails off, the boat is towed home (the player wakes at the pier: melee)
	_defeat() {

		const s = this.ship;
		this._hideCrew();
		this._removeMover();
		this._dropCaptain();
		if ( s ) {

			s.repelled = true;
			s.state = 'flee';
			s.stateTime = 0;
			if ( s.bounty ) s.fleeAt = 0; else delete s.fleeAt;
			s.boarding = null;

		}

		this._unmoorBoat();
		const b = this.app.boatCtl;
		if ( b && b.reset ) b.reset();
		this.stats.repelled ++;
		this._toast( 'Driven off the deck · your boat was towed home', 4200 );
		if ( s ) this._emit( 'boardingEnded', { id: s.id, outcome: 'repelled' } );
		this._clearRun();

	}

	// something took the ground from under the boarding (the ship sank, the player left walk mode)
	_abort( why ) {

		const s = this.ship;
		this._hideCrew();
		this._removeMover();
		this._dropCaptain();
		this._stepBack();
		this._unmoorBoat();
		if ( s ) this._emit( 'boardingEnded', { id: s.id, outcome: 'aborted', why } );
		this._clearRun();

	}

	_clearRun() {

		this.phase = 'idle';
		this.tl = 0;
		this.fade = 0;
		this.ship = null;
		this.deck = null;
		this.deal = null;
		this.prev = null;
		this.offer = null;
		this.outcome = null;
		this.sneak = false;

	}

	_onBoatSunk() {

		if ( this.phase === 'idle' ) return;
		const s = this.ship;
		this._hideCrew();
		this._removeMover();
		this._dropCaptain();
		this._moor = null; // the boat is gone; nothing to release
		if ( s && s.alive ) { s.state = 'adrift'; s.adriftT = 0; }
		this._clearRun();

	}

	_onShipSunk( e ) {

		if ( this.phase === 'idle' || ! this.ship || ! e || e.id !== this.ship.id || e.boarded ) return;
		// she went down under the boarders (some other ship's guns): back to the boat
		this._abort( 'ship sunk' );

	}

	// ------------------------------------------------------------------ prisoners

	_onBountyAccepted( e ) {

		if ( ! e || typeof e !== 'object' || e.id === undefined ) return;
		this.bountyInfo.set( String( e.id ), { ...e, region: e.region ? { ...e.region } : e.region } );

	}

	// the contract lapsed or was claimed another way: the prisoner is worth the plain ransom
	_onBountyGone( e ) {

		if ( this._handing || ! e || e.id === undefined ) return;
		const id = String( e.id );
		for ( const pr of this.prisoners ) {

			if ( pr.data.bountyId !== id ) continue;
			pr.data.bountyId = null;
			pr.data.target = null;
			pr.data.bountyInfo = null;
			this._toast( `The bounty on ${ pr.name } lapsed · he will fetch the plain ransom`, 3600 );

		}

		this.bountyInfo.delete( id );

	}

	_escape( pr ) {

		const i = this.prisoners.indexOf( pr );
		if ( i < 0 ) return;
		this.prisoners.splice( i, 1 );
		this.stats.escaped ++;
		const d = pr.data;
		pr.dispose();
		this._toast( `${ d.name } slipped his bonds and got away`, 4200 );
		this._emit( 'prisonerEscaped', { name: d.name, bounty: !! d.bountyId } );
		// a bounty captain at large is announced again so the sea spawns him anew
		const info = d.bountyId ? ( d.bountyInfo || this.bountyInfo.get( d.bountyId ) ) : null;
		if ( info ) this._emit( 'bountyAccepted', { ...info, resumed: true } );

	}

	_updatePrisoners( dt ) {

		if ( ! this.prisoners.length ) return;
		const ctx = { player: this.app.player, boat: this.app.boatCtl, boatId: this.state ? this.state.boat : null, terrain: this.terrain, hold: this.phase !== 'idle' };
		for ( const pr of this.prisoners ) pr.update( dt, ctx );

	}

	// ------------------------------------------------------------------ the hand-over (ransom)

	_registerHandOver() {

		for ( const port of [ 'home', 'pons' ] ) {

			const site = BOARD_SITES[ port ], stall = STALLS[ port ];
			if ( ! site || ! stall ) continue;
			// two metres beyond the notice board, away from the fish buyer's stall: out of PoorGoat's talking range, so his E does not win
			let dx = site.x - stall.x, dz = site.z - stall.z;
			const l = Math.hypot( dx, dz ) || 1;
			dx /= l;
			dz /= l;
			const x = site.x + dx * 2.2, z = site.z + dz * 2.2;
			const remove = this.features.interactable( {
				id: `boarding:handover:${ port }`,
				position: () => ( { x, y: this.terrain ? this.terrain.heightAt( x, z ) : 0, z } ),
				radius: 2.4,
				when: () => this.prisoners.length > 0 && this.phase === 'idle',
				prompt: () => this._handOverPrompt( port ),
				onInteract: () => { this.handOver( port ); },
			} );
			this._removers.push( remove );

		}

	}

	// the money a prisoner brings now: the plain ransom, or the bounty x1.5 when the contract is still open
	_payout( pr ) {

		const d = pr.data;
		if ( d.bountyId ) {

			const n = this._bountyNotice( d.bountyId );
			if ( n && n.reward ) return { base: n.reward.money, bonus: Math.round( n.reward.money * ( RULES.bountyMult - 1 ) ), bounty: true };

		}

		return { base: d.value, bonus: 0, bounty: false };

	}

	_bountyNotice( id ) {

		const nt = this.notices;
		if ( ! nt || ! nt.active ) return null;
		return nt.active.find( ( x ) => x.kind === 'bounty' && x.id === id ) || null;

	}

	_handOverPrompt( port ) {

		if ( ! this.prisoners.length ) return null;
		const total = this.prisoners.reduce( ( a, pr ) => {

			const v = this._payout( pr );
			return a + v.base + v.bonus;

		}, 0 );
		const who = this.prisoners.length === 1 ? this.prisoners[ 0 ].name : `${ this.prisoners.length } prisoners`;
		return `Hand over ${ who } · $${ total }`;

	}

	// deliver every prisoner. Returns { count, total } or null when there is nothing to hand over.
	handOver( port = 'home' ) {

		if ( ! this.prisoners.length || this.phase !== 'idle' ) return null;
		this._handing = true;
		const pp = this.app.player ? this.app.player.position : { x: 0, z: 0 }, px = pp.x, pz = pp.z;
		let ransom = 0, bonus = 0, claimed = 0;
		const list = [ ...this.prisoners ];
		this.prisoners.length = 0;
		for ( const pr of list ) {

			const d = pr.data, v = this._payout( pr );
			if ( v.bounty ) {

				// the notices pay the contract on the shipSunk below; the rest of the x1.5 is paid here
				claimed += v.base;
				bonus += v.bonus;
				this._emit( 'bountyCaptured', { id: d.bountyId, target: d.target, captain: d.name, tier: d.tier, reward: Math.round( v.base * RULES.bountyMult ), port } );
				this._emit( 'shipSunk', {
					id: d.id, name: d.target, target: d.target, captain: d.name, bountyId: d.bountyId, shipName: d.ship, faction: 'pirate', byPlayer: true,
					kind: d.kind, x: px, z: pz, loot: 0, boarded: true, captured: true, how: 'delivered',
				} );

			} else ransom += v.base;
			pr.dispose();

		}

		this._handing = false;
		const money = ransom + bonus;
		this._earn( money );
		this.stats.ransomed += list.length;
		this.stats.ransomTotal += money + claimed;
		const total = money + claimed;
		this._toast( `Handed over ${ list.length === 1 ? list[ 0 ].name : `${ list.length } prisoners` } · +$${ total }${ claimed ? ` (bounty x${ RULES.bountyMult })` : ' ransom' }`, 4200 );
		this._emit( 'prisonerRansomed', { count: list.length, total, port } );
		return { count: list.length, total };

	}

	// ------------------------------------------------------------------ input

	_input() {

		const a = this.app, inp = a.input, p = a.player;
		if ( ! inp || ! inp.hit || inp.enabled === false || a.paused || a.menuOpen || a.freeCam ) return;
		const ph = this.phase;
		const ho = this.hostile;
		if ( ho && ho.busy ) {

			if ( ho.phase === 'boarded' ) {

				for ( const i of [ 0, 1 ] ) if ( SECOND_KEYS[ i ].some( ( k ) => inp.hit( k ) ) ) { ho.choose( i ); break; }

			} else if ( ho.phase === 'fight' && SECOND_KEYS[ 0 ].some( ( k ) => inp.hit( k ) ) ) ho.rally();
			return;

		}

		if ( ph === 'idle' ) {

			if ( ! this.offer ) return;
			const keyB = this.keyOk && inp.hit( 'KeyB' );
			// on deck away from the helm (nothing else has the prompt) E boards too
			const keyE = p && p.mode === 'deck' && ! p.prompt && ! p.busy && inp.hit( 'KeyE' );
			if ( keyB || keyE ) this.board( this.offer );

		} else if ( ph === 'surrender' ) {

			for ( const i of [ 0, 1, 2 ] ) if ( SECOND_KEYS[ i ].some( ( k ) => inp.hit( k ) ) ) { this.choose( i ); break; }

		} else if ( ph === 'fight' ) {

			if ( this.keyOk && inp.hit( 'KeyB' ) ) this.retreat();

		}

	}

	// ------------------------------------------------------------------ frame

	update( dt ) {

		if ( ! ( dt > 0 ) ) return;
		dt = Math.min( dt, 0.1 );
		this.time += dt;
		this._updatePrisoners( dt );
		if ( this.app.paused ) {

			this._hudFrame( dt );
			return;

		}

		const nv = this.naval;
		if ( this.enabled && nv && nv.active !== false ) {

			if ( this.phase === 'idle' ) {

				this._cripple( dt, nv );
				this.offer = this.hostile && this.hostile.busy ? null : this._findOffer( nv );

			}

			this._input();
			this._phases( dt );

		} else {

			this.offer = null;
			if ( this.phase !== 'idle' ) this._abort( 'naval off' );

		}

		if ( this.hostile ) this.hostile.update( dt );

		this._hudFrame( dt );

	}

	_phases( dt ) {

		const s = this.ship, p = this.app.player;
		if ( this.phase !== 'idle' ) {

			// the ship under the boarders went away
			if ( this.phase !== 'ret-in' && ( ! s || ! s.alive ) ) { this._abort( 'ship gone' ); return; }
			this.tl += dt;

		}

		switch ( this.phase ) {

			case 'cross-out':
				this.fade = clamp( this.tl / RULES.fadeOut, 0, 1 );
				if ( this.tl >= RULES.fadeOut ) {

					this._doCross();
					if ( this.phase === 'cross-out' ) { this.phase = 'cross-in'; this.tl = 0; }

				}

				break;
			case 'cross-in':
				this._ride( dt );
				this.fade = 1 - clamp( this.tl / RULES.fadeIn, 0, 1 );
				if ( this.tl >= RULES.fadeIn ) {

					this.phase = 'fight';
					this.tl = 0;
					this.fade = 0;
					if ( this.crewSpawned === 0 ) this._surrender();

				}

				break;
			case 'fight': {

				this._ride( dt );
				const m = this.melee;
				if ( p.mode !== 'walk' && ! ( m && m.playerDown ) ) { this._abort( 'left the deck' ); break; }
				if ( this._crewAlive() === 0 && this.crewDown >= this.crewSpawned ) this._surrender();
				break;

			}

			case 'surrender':
				this._ride( dt );
				break;
			case 'ret-out':
				this._ride( dt );
				this.fade = clamp( this.tl / RULES.fadeOut, 0, 1 );
				if ( this.tl >= RULES.fadeOut ) {

					this._doReturn();
					this.phase = 'ret-in';
					this.tl = 0;

				}

				break;
			case 'ret-in':
				this.fade = 1 - clamp( this.tl / RULES.fadeIn, 0, 1 );
				if ( this.tl >= RULES.fadeIn ) { this._clearRun(); }
				break;
			default:
				break;

		}

	}

	// the HUD's plain model (also what the tests read)
	view() {

		let prompt = '';
		if ( this.phase === 'idle' && this.offer ) {

			const n = this.offer.boarding ? this.offer.boarding.crewLeft : this._crewFor( this.offer );
			prompt = `<kbd>B</kbd>Board the ${ this.offer.name } · ${ n ? `${ n } crew` : 'no crew left' }`;

		} else if ( this.phase === 'fight' ) prompt = FIGHT_HINT;
		return {
			phase: this.phase, prompt, fade: this.fade,
			choice: this.phase === 'surrender' ? this._choiceModel() : null,
			prisoners: this.prisoners.map( ( pr ) => ( { name: pr.name, value: pr.data.value, bounty: !! pr.data.bountyId } ) ),
		};

	}

	_hudFrame( dt ) {

		if ( this.hud ) this.hud.update( dt, this.view() );

	}

	// ------------------------------------------------------------------ save

	toJSON() {

		return {
			v: 1,
			prisoners: this.prisoners.map( ( pr ) => ( { ...pr.data, bountyInfo: pr.data.bountyInfo ? JSON.parse( JSON.stringify( pr.data.bountyInfo ) ) : null } ) ),
			stats: { ...this.stats },
		};

	}

	fromJSON( d ) {

		if ( ! d || typeof d !== 'object' ) return;
		for ( const pr of this.prisoners ) pr.dispose();
		this.prisoners.length = 0;
		const str = ( v, def = '' ) => ( typeof v === 'string' ? v.slice( 0, 80 ) : def );
		const list = Array.isArray( d.prisoners ) ? d.prisoners.slice( 0, RULES.maxPrisoners ) : [];
		for ( const x of list ) {

			if ( ! x || typeof x !== 'object' || typeof x.name !== 'string' ) continue;
			const data = {
				id: str( x.id, 'ship' ), name: str( x.name ), ship: str( x.ship ), kind: x.kind === 'brigantine' ? 'brigantine' : 'sloop',
				tier: clamp( Math.round( x.tier ) || 1, 1, 3 ), value: Number.isFinite( x.value ) ? clamp( Math.round( x.value ), 0, 100000 ) : RULES.ransom[ 1 ],
				character: CAPTAIN_CHARACTERS.includes( x.character ) ? x.character : CAPTAIN_CHARACTERS[ 0 ],
				bountyId: typeof x.bountyId === 'string' ? x.bountyId : null, target: typeof x.target === 'string' ? x.target : null,
				bountyInfo: x.bountyInfo && typeof x.bountyInfo === 'object' ? x.bountyInfo : null,
			};
			if ( data.bountyId && data.bountyInfo ) this.bountyInfo.set( data.bountyId, data.bountyInfo );
			const avatar = this.avatarFactory( { scene: this.app.scene, character: data.character, lite: true } );
			this.prisoners.push( new Prisoner( data, avatar ) );

		}

		if ( d.stats && typeof d.stats === 'object' ) {

			for ( const k of Object.keys( this.stats ) ) if ( Number.isFinite( d.stats[ k ] ) ) this.stats[ k ] = Math.max( 0, d.stats[ k ] );

		}

	}

	// a new game: no prisoners, no boarding, a clean ledger
	reset() {

		if ( this.phase !== 'idle' ) this._abort( 'reset' );
		for ( const pr of this.prisoners ) pr.dispose();
		this.prisoners.length = 0;
		this.bountyInfo.clear();
		this.stats = { boarded: 0, repelled: 0, captured: 0, plundered: 0, ransomed: 0, ransomTotal: 0, escaped: 0, crewDefeated: 0, taken: 0 };
		this.offer = null;
		if ( this.hostile ) this.hostile.reset();

	}

	dispose() {

		for ( const off of this._offs ) off();
		this._offs.length = 0;
		for ( const rm of this._removers ) rm();
		this._removers.length = 0;
		this._removeMover();
		this._unmoorBoat();
		this._dropCaptain();
		for ( const r of this.crew ) if ( r ) r.dispose();
		this.crew.length = 0;
		this.host.raiders.length = 0;
		for ( const pr of this.prisoners ) pr.dispose();
		this.prisoners.length = 0;
		if ( this.hud ) this.hud.dispose();
		this.hud = null;
		if ( this.hostile ) this.hostile.dispose();
		this.hostile = null;

	}

}

export function install( app, features, options = {} ) {

	return new Boarding( app, features, { ...( app && app.boardingOptions ), ...options } );

}

export { RULES };

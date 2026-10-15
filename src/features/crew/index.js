// Crew feature (wave 10): hired roster characters posted aboard as gunners or anglers.
//
//   features.add( 'crew', crew );        // import * as crew from './features/crew/index.js' (after naval)
//   const c = features.get( 'crew' );
//   c.posts                     { id: 'gunner' | 'angler' }   (the hired characters posted aboard, in posting order)
//   c.berths()                  crew berths of the current hull (Boats.js `berths`, else Crew.BERTHS)
//   c.setPost( id, 'off' | 'gunner' | 'angler' ) -> { ok, reason, text }   a toast says what happened; emits crewPosted { id, post }
//   c.rows() -> Crew.rows (per character: hired, playing, post, side, choices [ { post, label, on, enabled, why } ])
//   c.postHtml( id ) -> HTML of the Off / Gunner / Angler control for a crew card ('' for the played or an unhired one)
//   c.berthNote() -> 'Crew berths on the lobster boat: 1 of 2 taken' (the Crew tab's note)
//   c.bindPosts( root, rerender )   wires the controls inside `root` (rerender() after a change)
//   c.hudLine()                 the gunners' line ('Gunners: Pepe (port, ready) · Doge (stbd, 3.2 s)') or null
//   c.update( dt ) / toJSON() / fromJSON( d ) / reset() / dispose()
//
// Gunners: while the skipper is aboard (helm, deck or a seat), each gunner works one broadside - the first the side facing the
// nearest hostile pirate, the second the other - and fires it through naval.crewFire (the player's own fire path) with a
// reload x1.6 and a spread x1.5: only at a hostile pirate in the gun's reach and swing, never at a merchant, never in or into
// the peaceful home waters, never at a crippled / struck pirate (the boarding prize), never the side the skipper aims by hand.
// A small line under the naval HUD names them and their reload while a pirate is in sight.
// Anglers: while the boat is at sea (not moored, not within 70 m of a port's dock, afloat) and slow (under 2.5 m/s, or at
// anchor; trolling under 4 m/s at half rate), each lands a fish every 45-90 s (richer water sooner) with the species and the
// weight rolls of the player's own catch (Bites.pickSpecies / rollWeight at the water off the rail: a reef angler catches reef
// fish), into the cooler if it fits, through the game's catch entry point (game.landCatch when Game.js has it, else the same
// steps: state.addFish, contracts.onCatch, fishCaught { ..., crew: id, x, z }) so it counts for quests and the career; a cast
// takes a bait like the skipper's (trade's operating.useBait; a bare hook is slower; free in the sandbox) and the crafting
// feature's bait goes with the catch (its fishCaught listener). A toast: "Pengu landed a 1.3 kg Jade snapper".
// On deck: CrewDeck (Deck.js) stands each one at a deck point of the hull, riding the boat's pose.
//
// Wave 19C, a crew with lives (Life.js, Banter.js):
//   c.member( id )              the life record: morale, rest, food, skills { gunnery, angling, sailing, repair }, traits, level
//   c.activity( id )            'post' | 'cook' | 'sleep' | 'eat' | 'drink' | 'mend' | 'dice' | 'talk' | 'fire' | 'pump' (null: not aboard)
//   c.speedFactor()             1 .. 1.06: the best sailor on duty trims her (Game multiplies maxThrust; root patch)
//   c.wagesPerDay()             the tavern hands' daily wages (trade's Operating adds them to the bill; root patch)
//   c.boardingParty( ship, n ) -> { held, ids }   the brave hands cross with the skipper; each holds one defender (boarding patch)
//   c.hireables( port ) / c.hire( id, port ) / c.fetch( id, port ) / c.dismiss( id )   the tavern's hands for hire (a week's
//                               list per port, the keeper vouches), a drunk hand found at a tavern, a hand let go
//   c.tavernHtml( port, keeper ) / c.tavernAct( act, id, port ) -> { ok, text }   the tavern window's Hands tab (harbour patch)
//   c.lifeHtml( id ) / c.handsHtml()   the crew tab at Ethena's: level, traits, mood and skills; the tavern hands' cards (HUD patch)
// Life aboard: the ship's day (Life.dutyAt: watches, meals, a leisure hour, the evening off, sleep under the awning), battle
// stations when a hostile is in sight, every hand to the buckets when she burns (they douse naval.fireState themselves, the
// repair skill making each bucket count) and to the pump when she floods (on top of naval's own crew pump, under fire too).
// Morale moves with wages, food, rest, storms, hits, victories and losses; fed up (10 or less) a hand leaves at the next port
// (a tavern hand signs off, a roster hand goes ashore until the mood mends); a drunkard in port of an evening may stay at the
// tavern until fetched. Banter: a speech bubble over the speaker on events (Banter.js cooldowns: never spammy).
// Events emitted: crewHired { id, name, port, price }, crewQuit { id, name, port }, crewDrunk { id, port }, crewFetched { id, port },
// crewBanter { id, kind, text }, crewLevel { id, level }.

import { BOATS } from '../../game/Boats.js';
import { CLIPS, portraitUrl } from '../../game/Characters.js';
import { habitatAt } from '../../game/Bites.js';
import { WORLD } from '../../world/WorldLayout.js';
import { rotateByQuat } from '../naval/Ballistics.js';
import { Vector3 } from '../../engine/index.js';
import { Crew, CREW_RULES, POST_LABELS, berthsOf, anglerRate, restPoint } from './Crew.js';
import { CrewDeck } from './Deck.js';
import { LIFE, TRAITS, SKILLS, SKILL_LABELS, has, levelOf, moraleEvent, tickLife, dutyAt, grow, sailingBonus, repairPower, moodWord, sailorsFor, vouch, OFF_DUTY } from './Life.js';
import { Banter } from './Banter.js';
import { FLOOD } from '../naval/Flood.js';

export { Crew, CREW_RULES, BERTHS, POSTS, POST_LABELS, berthsOf, deckPoint, restPoint, anglerRate, catchInterval } from './Crew.js';
export { CrewDeck } from './Deck.js';
export * as Life from './Life.js';
export { Banter, LINES, COOLDOWN } from './Banter.js';

const ABOARD = [ 'boat', 'deck', 'seat' ];
const LINE_OUT = 6; // m off the rail: where an angler's line is (the habitat, the splash)

const CSS = `
.cw-post { display: flex; gap: 2px; padding: 2px; border-radius: 999px; background: var(--tw-fill, rgba(255, 255, 255, 0.06)); align-self: stretch; }
.cw-post button { flex: 1; font: 600 var(--tw-fs-xs, 11px) var(--tw-font, system-ui, sans-serif); color: var(--tw-ink-2, #c8d3db); background: none; border: 0; border-radius: 999px; padding: 3px 6px; cursor: pointer; }
.cw-post button:hover:not(:disabled) { color: var(--tw-ink, #fff); }
.cw-post button.is-on { background: var(--tw-fill-2, rgba(255, 255, 255, 0.16)); color: var(--tw-ink, #fff); box-shadow: inset 0 0 0 1px var(--tw-line-2, rgba(255, 255, 255, 0.25)); }
.cw-post button:disabled { opacity: 0.38; cursor: default; }
.cw-post-label { font-size: var(--tw-fs-xs, 11px); color: var(--tw-ink-3, #9fb0bd); letter-spacing: 0.08em; text-transform: uppercase; }
.cw-gunners { position: fixed; left: var(--nv-left, 18px); bottom: calc(var(--nv-bottom, 96px) - 24px); z-index: 20; pointer-events: none; display: none;
	font: 600 11.5px var(--tw-mono, ui-monospace, monospace); color: var(--tw-ink, #e9eef2); text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7); white-space: nowrap; }
.cw-gunners.is-on { display: block; }
.cw-post { flex-wrap: wrap; }
.cw-life { display: flex; flex-direction: column; gap: 3px; font-size: var(--tw-fs-xs, 11px); color: var(--tw-ink-2, #c8d3db); }
.cw-life-top { display: flex; justify-content: space-between; gap: 6px; }
.cw-life-top b { color: var(--tw-ink, #fff); }
.cw-traits { display: flex; flex-wrap: wrap; gap: 3px; }
.cw-trait { padding: 1px 6px; border-radius: 999px; background: var(--tw-fill-2, rgba(255, 255, 255, 0.12)); color: var(--tw-ink, #fff); cursor: default; }
.cw-mood { height: 4px; border-radius: 2px; background: var(--tw-fill, rgba(255, 255, 255, 0.08)); overflow: hidden; }
.cw-mood i { display: block; height: 100%; background: var(--tw-aqua, #5fd4c8); }
.cw-mood.is-low i { background: #e0795b; }
.cw-skills { display: grid; grid-template-columns: 1fr 1fr; gap: 0 8px; color: var(--tw-ink-3, #9fb0bd); }
.cw-hands h3 { margin: 10px 0 6px; font-size: var(--tw-fs-sm, 12px); }
.cw-bubbles { position: fixed; inset: 0; pointer-events: none; z-index: 19; }
.cw-bubble { position: absolute; transform: translate(-50%, -100%); max-width: 220px; padding: 5px 9px; border-radius: 10px; background: rgba(250, 247, 238, 0.94);
	color: #1d2228; font: 600 12px var(--tw-font, system-ui, sans-serif); line-height: 1.3; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35); transition: opacity 0.3s; white-space: normal; text-align: center; }
.cw-bubble::after { content: ''; position: absolute; left: 50%; bottom: -5px; margin-left: -5px; border: 5px solid transparent; border-bottom: 0; border-top-color: rgba(250, 247, 238, 0.94); }
.cw-bubble small { display: block; font-weight: 500; color: #57606a; font-size: 10.5px; }
`;
const BUBBLE_S = 3.6; // s a speech bubble stays
const DOUSE_EVERY = 6; // s: each firefighter's bucket run (the skipper's channel: 3 s for 0.4); a fire grows 0.15 in that time
const REACT = 3; // s before the crew are at the fire
const TAB = 6; // $ a drunk hand's bar tab when fetched
const WHALE_S = 240; // s between two whale calls
const _pv = new Vector3();
// a world point to pixels of a w x h view (null behind the camera, off screen or farther than a bubble reads)
function project( camera, p, w, h ) {

	if ( ! camera || ! camera.matrixWorldInverse || ! camera.projectionMatrix ) return null;
	_pv.set( p.x, p.y, p.z ).applyMatrix4( camera.matrixWorldInverse );
	if ( _pv.z >= - 0.1 || _pv.length() > 90 ) return null;
	_pv.applyMatrix4( camera.projectionMatrix );
	if ( _pv.x < - 1.1 || _pv.x > 1.1 || _pv.y < - 1.1 || _pv.y > 1.1 ) return null;
	return { x: ( _pv.x * 0.5 + 0.5 ) * w, y: ( 0.5 - _pv.y * 0.5 ) * h };

}
const esc = ( v ) => String( v == null ? '' : v ).replace( /[&<>"']/g, ( c ) => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ c ] ) );
const money = ( v ) => '$' + Math.round( v );

let cssDone = false;

export function install( app, features, opts = {} ) {

	return new CrewFeature( app, features, opts );

}

export class CrewFeature {

	constructor( app, features, opts = {} ) {

		this.app = app || {};
		this.features = features || null;
		this.crew = new Crew( { rng: opts.rng || Math.random } );
		const scene = opts.scene !== undefined ? opts.scene : this.app.scene || null;
		this.deck = opts.deck === false || ! scene ? null : ( opts.deck || new CrewDeck( {
			scene, avatarFactory: opts.avatarFactory || ( this.app.residents && this.app.residents.avatarFactory ) || null,
			rodFactory: opts.rodFactory || null,
		} ) );
		this.doc = opts.doc !== undefined ? opts.doc : ( typeof document !== 'undefined' ? document : null );
		this.line = null;
		this._lineText = '';
		this._membersKey = '';
		this._spot = { x: 0, z: 0 };
		this.landed = []; // this session's crew catches (tests, the debug panel): { id, species, kg }
		// wave 19C: life aboard
		this.banter = new Banter( { rng: opts.rng || Math.random } );
		this.rng = opts.rng || Math.random;
		this.time = 0; // s of play (banter cooldowns)
		this.day = 0; // ship's days (the island clock's midnights; a tavern's hands change weekly)
		this._lastHour = null;
		this._acts = new Map(); // id -> activity this frame
		this._alarm = false;
		this._fire = { on: false, t: 0, acc: 0 };
		this._seen = new Set(); // naval ship ids the lookout has called
		this._whaleT = - Infinity;
		this._drunkDay = new Map(); // id -> the day he last went ashore for one more
		this._hitT = - Infinity;
		this._levels = new Map();
		this.said = []; // the last lines (tests): { id, kind, text }
		this.bubbles = []; // { el, id, t }
		this._pt = new Vector3();
		this._removers = [];
		this._build();
		this._listen();

	}

	_build() {

		const doc = this.doc;
		if ( ! doc || ! doc.createElement || ! doc.body ) return;
		if ( ! cssDone ) {

			const st = doc.createElement( 'style' );
			st.textContent = CSS;
			( doc.head || doc.body ).append( st );
			cssDone = true;

		}

		this.line = doc.createElement( 'div' );
		this.line.className = 'cw-gunners';
		doc.body.append( this.line );
		this.bubbleRoot = doc.createElement( 'div' );
		this.bubbleRoot.className = 'cw-bubbles';
		doc.body.append( this.bubbleRoot );

	}

	// ---------------------------------------------------------------- the save's view

	get state() {

		return ( this.features && this.features.state ) || ( this.app.game && this.app.game.state ) || null;

	}

	ctx() {

		const st = this.state;
		// the hull in play: App.boatId (the sandbox hands out boats without writing state.boat), else the save's
		const boat = ( this.app && this.app.boatId ) || ( st ? st.boat || null : null );
		return { boat, unlocked: st && Array.isArray( st.unlocked ) ? st.unlocked : [], character: st ? st.character : null };

	}

	get posts() {

		return Object.fromEntries( this.crew.posts );

	}

	// the posted members (netsync replicates them to the other players)
	members() {

		return this._members( this.ctx() );

	}

	berths() {

		return berthsOf( this.ctx().boat );

	}

	rows() {

		return this.crew.rows( this.ctx() );

	}

	setPost( id, post ) {

		const ctx = this.ctx();
		const was = this.crew.postOf( id );
		const r = this.crew.setPost( id, post, ctx );
		const name = this.crew.nameOf( id );
		const row = this.crew.rows( ctx ).find( ( x ) => x.id === id );
		const why = row && row.choices.find( ( c ) => c.post === post );
		const as = { gunner: 'a gunner', angler: 'an angler', cook: 'the cook', lookout: 'the lookout' };
		r.text = r.ok
			? ( post === 'off' ? `${ name } is off duty` : `${ name } is posted as ${ as[ post ] || post }` )
			: ( why && why.why ) || 'Not possible';
		if ( r.ok && ! r.same && was !== post ) {

			this._toast( r.text, 1800 );
			if ( this.features && this.features.emit ) this.features.emit( 'crewPosted', { id, post } );

		} else if ( ! r.ok ) this._toast( r.text, 2200 );
		return r;

	}

	berthNote() {

		const ctx = this.ctx(), n = berthsOf( ctx.boat ), b = BOATS[ ctx.boat ];
		if ( ! b ) return 'No boat: buy one at Captain Roid\'s yard to take a crew out';
		if ( n <= 0 ) return `The ${ b.name.toLowerCase() } has no crew berths`;
		return `Crew berths on the ${ b.name.toLowerCase() }: ${ this.crew.posts.size } of ${ n } taken`;

	}

	postHtml( id ) {

		const row = this.rows().find( ( r ) => r.id === id );
		if ( ! row || ! row.hired || row.playing ) return '';
		const btns = row.choices.map( ( c ) => `<button type="button" class="${ c.on ? 'is-on' : '' }" data-crew-post="${ c.post }" data-crew-id="${ id }"${ c.enabled || c.on ? '' : ' disabled' }${ c.why ? ` title="${ c.why.replace( /"/g, '&quot;' ) }"` : '' }>${ c.label }</button>` ).join( '' );
		return `<span class="cw-post-label">Post</span><div class="cw-post" role="group" aria-label="Post ${ row.name }">${ btns }</div>`;

	}

	bindPosts( root, rerender = null ) {

		if ( ! root || ! root.querySelectorAll ) return;
		for ( const b of root.querySelectorAll( '[data-crew-dismiss]' ) ) {

			b.onclick = () => {

				this.dismiss( b.dataset.crewDismiss );
				if ( rerender ) rerender();

			};

		}

		for ( const b of root.querySelectorAll( '[data-crew-post]' ) ) {

			b.onclick = () => {

				this.setPost( b.dataset.crewId, b.dataset.crewPost );
				if ( rerender ) rerender();

			};

		}

	}

	hudLine() {

		return this.crew.hudLine( this._naval(), this.ctx() );

	}

	// ---------------------------------------------------------------- frame

	_naval() {

		const f = this.features;
		return f && f.get ? f.get( 'naval' ) : null;

	}

	_toast( text, ms = 2400 ) {

		const g = this.app.game;
		if ( g && typeof g.toast === 'function' ) g.toast( text, ms );

	}

	_aboard() {

		const p = this.app.player;
		return !! p && ABOARD.includes( p.mode );

	}

	// at sea: the boat afloat and loose (not moored), clear of every port's dock
	_atSea( b, nv ) {

		if ( ! b || ! b.position || b.enabled === false || b.moored ) return false;
		if ( ! this.ctx().boat ) return false;
		if ( nv && ( nv.playerHull && nv.playerHull.sunk || nv.sinking ) ) return false;
		if ( b.position.y < - 50 ) return false; // (a wrecked boat waits far below)
		for ( const p of WORLD.ports || [] ) {

			const d = p.dock && p.dock.position;
			if ( d && Math.hypot( b.position.x - d.x, b.position.z - d.z ) < CREW_RULES.portRadius ) return false;

		}

		return true;

	}

	// the side of the boat facing the nearest hostile pirate in sight (null: none)
	_nearSide( b, nv ) {

		if ( ! nv || ! nv.ships || ! b || ! b.position || ! b.quaternion ) return null;
		const reach = typeof nv.sightRange === 'function' ? nv.sightRange() : 400;
		let best = null, bd = Infinity;
		for ( const s of nv.ships ) {

			if ( ! s.alive || s.faction !== 'pirate' ) continue;
			const d = Math.hypot( s.x - b.position.x, s.z - b.position.z );
			if ( d < bd && d <= reach ) { bd = d; best = s; }

		}

		if ( ! best ) return null;
		const n = rotateByQuat( b.quaternion, { x: 1, y: 0, z: 0 } );
		return ( best.x - b.position.x ) * n.x + ( best.z - b.position.z ) * n.z >= 0 ? 'port' : 'starboard';

	}

	// the water off the rail where the anglers' lines are: Game.habitatAtPoint (the player's own weights), else Bites.habitatAt
	_habitat( b ) {

		const n = rotateByQuat( b.quaternion, { x: 1, y: 0, z: 0 } );
		const x = b.position.x + n.x * LINE_OUT, z = b.position.z + n.z * LINE_OUT;
		this._spot.x = x;
		this._spot.z = z;
		const T = this.app.terrainData;
		const depth = T && T.heightAt ? Math.max( 0, - T.heightAt( x, z ) ) : 20;
		const g = this.app.game;
		if ( g && typeof g.habitatAtPoint === 'function' ) {

			try { return g.habitatAtPoint( x, z, depth ); } catch ( e ) { /* the plain weights below */ }

		}

		const reef = WORLD.reef;
		const reefDist = reef ? Math.hypot( x - reef.center.x, z - reef.center.z ) - reef.radius : 999;
		return habitatAt( { depth, reefDist, pierDist: 999 } );

	}

	// a bait for the next cast: trade's operating (one per cast; a bare hook's slower factor when out; 1 in the sandbox)
	_bait() {

		const f = this.features, tr = f && f.get ? f.get( 'trade' ) : null;
		try {

			const k = tr && tr.operating && typeof tr.operating.useBait === 'function' ? tr.operating.useBait() : 1;
			return Number.isFinite( k ) && k > 0 ? k : 1;

		} catch ( e ) {

			return 1;

		}

	}

	// the game's catch entry point: Game.landCatch when it exists, else the same steps as Game.updateFight's catch
	_land( c ) {

		const g = this.app.game, st = g && g.state;
		if ( ! st || typeof st.addFish !== 'function' ) return false;
		const where = { habitat: c.habitat, aboard: true, by: c.id, x: this._spot.x, z: this._spot.z };
		if ( typeof g.landCatch === 'function' ) g.landCatch( c.species, c.kg, where );
		else {

			const hour = this._hour();
			st.addFish( c.species, c.kg, hour, { habitat: c.habitat, aboard: true } );
			const info = st.lastCatch;
			try { if ( g.contracts && g.contracts.onCatch ) g.contracts.onCatch( info ); } catch ( e ) { /* the quests are the game's */ }
			if ( this.features && this.features.emit ) this.features.emit( 'fishCaught', { species: c.species, kg: c.kg, value: info ? info.value : 0, habitat: c.habitat, aboard: true, crew: c.id, x: this._spot.x, z: this._spot.z } );

		}

		this.landed.push( { id: c.id, species: c.species, kg: c.kg } );
		if ( this.landed.length > 50 ) this.landed.shift();
		return true;

	}

	_hour() {

		const g = this.app.game;
		const h = g && Number.isFinite( g.hour ) ? g.hour : this.app.settings ? this.app.settings.timeOfDay : 12;
		return Number.isFinite( h ) ? h : 12;

	}

	update( dt ) {

		if ( ! ( dt > 0 ) ) return;
		dt = Math.min( dt, 0.25 );
		const ctx = this.ctx();
		// the played character leaves the post; a smaller hull sends the last posted ashore
		for ( const d of this.crew.sync( ctx ) ) {

			const name = this.crew.nameOf( d.id );
			const boat = BOATS[ ctx.boat ];
			this._toast( d.why === 'playing' ? `${ name } leaves the ${ d.post }'s post: you are playing them now` : `${ name } went ashore: no berth on the ${ boat ? boat.name.toLowerCase() : 'boat' }`, 2600 );

		}

		const b = this.app.boatCtl, nv = this._naval();
		const atSea = this._atSea( b, nv );
		const aboard = this._aboard();
		this.time += dt;
		// life aboard: the hour's activity of each hand, morale / rest / food, fire and flood, the lookout, quitting, the tavern
		this._life( dt, ctx, b, nv, atSea, aboard );

		// gunners: sides by the nearest hostile, then each tries his broadside
		const gunners = this.crew.gunners( ctx );
		if ( gunners.length ) {

			this.crew.assignSides( this._nearSide( b, nv ), ctx );
			for ( const f of this.crew.tickGunners( dt, { aboard: aboard && atSea, naval: nv, ctx } ) ) if ( this.deck ) this.deck.fired( f.id );

		}

		// anglers
		if ( this.crew.anglers( ctx ).length && b && b.position && b.quaternion ) {

			const speed = Number.isFinite( b.speed ) ? b.speed : b.velocity ? Math.hypot( b.velocity.x, b.velocity.z ) : 0;
			const rate = anglerRate( { atSea, speed, anchored: !! b.anchored } );
			let h = null;
			const st = this.state;
			const out = this.crew.tickAnglers( dt, {
				rate, hour: this._hour(), ctx,
				habitat: () => h || ( h = this._habitat( b ) ),
				fits: ( kg ) => ! st || typeof st.fits !== 'function' || st.fits( kg ),
				bait: () => this._bait(),
				onDuty: ( id ) => this._onDuty( id ),
			} );
			for ( const c of out ) {

				if ( c.full ) {

					this._toast( c.text, 2600 );
					continue;

				}

				if ( this._land( c ) ) {

					this._toast( c.text, 3000 );
					if ( this.deck ) this.deck.caught( c.id );
					// the angler's own catch cheers him; the others a little
					for ( const id of this.crew.aboard( ctx ) ) moraleEvent( this.crew.member( id ), id === c.id ? 'catch' : 'shipCatch' );
					if ( this.rng() < 0.5 ) this._say( 'catch', [ c.id ], c.id );

				}

			}

		}

		this._updateDeck( dt, ctx, b, nv );
		this._updateLine( aboard, b, nv, ctx );
		this._updateBubbles( dt );

	}

	_members( ctx ) {

		const out = [], look = ( id ) => this.crew.lookOf( id );
		this.crew.gunners( ctx ).forEach( ( id, i ) => out.push( { id, post: 'gunner', side: this.crew.sides.get( id ) || ( i ? 'starboard' : 'port' ), slot: i, look: look( id ) } ) );
		this.crew.anglers( ctx ).forEach( ( id, i ) => out.push( { id, post: 'angler', side: i % 2 ? 'starboard' : 'port', slot: i, look: look( id ) } ) );
		for ( const p of [ 'cook', 'lookout' ] ) for ( const id of this.crew._of( p, ctx ) ) out.push( { id, post: p, side: 'port', slot: 0, look: look( id ) } );
		return out;

	}

	_updateDeck( dt, ctx, b, nv ) {

		if ( ! this.deck ) return;
		const members = this._members( ctx );
		const key = members.map( ( m ) => `${ m.id }:${ m.post }:${ m.side }:${ m.slot }:${ m.look }` ).join( '|' );
		if ( key !== this._membersKey ) {

			this._membersKey = key;
			this.deck.sync( members );

		}

		const visible = !! ( ctx.boat && b && b.position && b.enabled !== false && b.position.y > - 50 && ! ( nv && nv.playerHull && nv.playerHull.sunk ) );
		const lines = b && b.model && b.model.lines;
		const deckY = lines && Number.isFinite( lines.deckY ) ? lines.deckY : null;
		const cam = this.app.camera;
		// off duty they gather at the rest spot (a ring aft), at the pump amidships, on the bucket run to the fire
		const B = BOATS[ ctx.boat ], n = members.length;
		const life = ( id ) => {

			const act = this._acts.get( id ) || 'post';
			if ( act === 'post' || act === 'cook' ) return { act };
			if ( act === 'fire' ) return { act, fire: nv && nv.fireState ? nv.fireState.at : { x: 0, z: 0 } };
			const i = members.findIndex( ( m ) => m.id === id );
			if ( act === 'pump' ) return { act, spot: B && B.kind === 'ship' ? { x: 0.5 + 0.6 * ( i % 3 ), y: Number.isFinite( deckY ) ? deckY : B.deckY, z: B.length * 0.08, yaw: Math.PI / 2 } : null };
			return { act, spot: restPoint( ctx.boat, i, n, deckY ) };

		};
		this.deck.update( dt, {
			boat: b, boatId: ctx.boat, deckY, visible, eye: cam && cam.position ? cam.position : null,
			reloading: ( side ) => !! ( nv && nv.reloadLeft && nv.reloadLeft[ side ] > 0 ),
			life,
		} );

	}

	// "Gunners: ..." under the naval HUD while aboard with a pirate in sight
	_updateLine( aboard, b, nv, ctx ) {

		let text = '';
		if ( aboard && nv && this.crew.gunners( ctx ).length && this._nearSide( b, nv ) ) text = this.crew.hudLine( nv, ctx ) || '';
		this._lineText = text;
		if ( ! this.line ) return;
		this.line.classList.toggle( 'is-on', !! text );
		if ( text && this.line.textContent !== text ) this.line.textContent = text;

	}

	toJSON() {

		return { ...this.crew.toJSON(), day: this.day };

	}

	fromJSON( d ) {

		this.crew.fromJSON( d );
		this.day = d && Number.isFinite( d.day ) ? Math.max( 0, d.day | 0 ) : 0;
		this._membersKey = '';
		this._levels.clear();
		this._acts.clear();

	}

	reset() {

		this.crew.reset();
		this._membersKey = '';
		this.landed.length = 0;
		this.day = 0;
		this._lastHour = null;
		this._acts.clear();
		this._levels.clear();
		this._seen.clear();
		this._drunkDay.clear();
		this._fire.on = false;
		this.banter.reset();
		for ( const x of this.bubbles ) x.el.remove();
		this.bubbles.length = 0;
		if ( this.deck ) this.deck.sync( [] );

	}

	dispose() {

		for ( const r of this._removers ) r();
		this._removers.length = 0;
		if ( this.deck ) this.deck.dispose();
		if ( this.line ) this.line.remove();
		if ( this.bubbleRoot ) this.bubbleRoot.remove();
		this.line = null;
		this.bubbleRoot = null;

	}

	// ================================================================ life aboard (wave 19C)

	member( id ) {

		return this.crew.member( id );

	}

	activity( id ) {

		return this._acts.get( id ) || null;

	}

	// an angler fishes while on his watch (or with no life ticked yet: no boat, a test)
	_onDuty( id ) {

		const a = this._acts.get( id );
		return ! a || a === 'post';

	}

	_free() {

		const st = this.state;
		return !! ( ( this.features && this.features.sandbox ) || ( st && st.free ) );

	}

	_storm() {

		const w = this.features && this.features.get ? this.features.get( 'weather' ) : null;
		if ( ! w ) return false;
		const k = w.current && w.current.kind ? w.current.kind : w.kind;
		return k === 'storm';

	}

	// the port whose dock the boat lies by (null at sea)
	_portAt( b ) {

		if ( ! b || ! b.position ) return null;
		for ( const p of WORLD.ports || [] ) {

			const d = p.dock && p.dock.position;
			if ( d && Math.hypot( b.position.x - d.x, b.position.z - d.z ) < CREW_RULES.portRadius ) return p.id;

		}

		return null;

	}

	_portName( id ) {

		const p = ( WORLD.ports || [] ).find( ( x ) => x.id === id );
		return p ? p.name : id;

	}

	// game hours lived since the last frame (the island clock); a midnight counts a ship's day
	_hours() {

		const h = this._hour();
		if ( this._lastHour === null ) {

			this._lastHour = h;
			return 0;

		}

		let d = h - this._lastHour;
		const prev = this._lastHour;
		this._lastHour = h;
		if ( d < 0 ) {

			d += 24;
			this.day ++;

		}

		if ( prev < 6 && h >= 6 && d < 1 ) this._dawn = true;
		return d > 6 ? 0 : d; // a jump (a load, the clock set by hand) is not lived through

	}

	_life( dt, ctx, b, nv, atSea, skipperAboard ) {

		const dh = this._hours();
		const hour = this._hour();
		const ids = this.crew.aboard( ctx );
		const sunk = !! ( nv && ( nv.sinking || ( nv.playerHull && nv.playerHull.sunk ) ) );
		const afloat = !! ( ctx.boat && b && b.position && b.position.y > - 50 && ! sunk );
		const fire = afloat && !! ( nv && nv.fireState && nv.fireState.burning );
		const flood = afloat && !! ( nv && nv.floodState && nv.floodState.level > 0 );
		const alarm = afloat && atSea && !! this._nearSide( b, nv );
		const storm = this._storm();
		const cook = ids.find( ( id ) => this.crew.postOf( id ) === 'cook' );
		const speed = b ? ( Number.isFinite( b.speed ) ? b.speed : b.velocity ? Math.hypot( b.velocity.x, b.velocity.z ) : 0 ) : 0;
		this._acts.clear();
		this._alarm = alarm;
		let best = 0;
		ids.forEach( ( id, i ) => {

			const m = this.crew.member( id ), post = this.crew.postOf( id );
			// with fire and water both, every other hand pumps
			const d = dutyAt( hour, m, { alarm, fire: fire && ( ! flood || i % 2 === 0 ), flood, post, slot: i, day: this.day, id } );
			this._acts.set( id, d.act );
			if ( dh > 0 ) {

				tickLife( m, dh, { activity: d.act, storm, atSea, cookFed: !! cook && cook !== id } );
				if ( atSea && speed > 2 && d.duty ) grow( m, 'sailing', LIFE.xp.sailHour * dh );

			}

			if ( atSea && d.duty && ! ( storm && has( m, 'seasick' ) ) ) best = Math.max( best, sailingBonus( m ) );
			this._levelCheck( id, m );

		} );
		this._speed = skipperAboard ? 1 + best : 1;

		// a roster hand who walked off gets his mood back ashore
		if ( dh > 0 ) for ( const [ id, m ] of this.crew.life ) {

			if ( ! m.ashore ) continue;
			tickLife( m, dh, { ashore: true } );
			if ( m.morale >= LIFE.backAt ) {

				m.ashore = false;
				m.leaving = false;
				this._toast( `${ this.crew.nameOf( id ) } is ready to sail with you again`, 2600 );

			}

		}

		if ( this._dawn ) {

			this._dawn = false;
			if ( ids.length ) this._say( 'dawn', ids );

		}

		this._fireWork( dt, ids, nv, fire );
		this._pumpWork( dt, ids, nv, flood, alarm );
		const look = ids.find( ( id ) => this.crew.postOf( id ) === 'lookout' && this._acts.get( id ) === 'post' );
		if ( look && atSea ) this._lookout( look, b, nv );

		// in port: the fed-up ones leave; of an evening a drunkard may slip ashore for one more
		const port = afloat ? this._portAt( b ) : null;
		if ( port ) {

			for ( const id of ids ) {

				const m = this.crew.member( id );
				if ( m.leaving ) this._quit( id, port );
				else if ( has( m, 'drunkard' ) && hour >= 20 && ! alarm && this._drunkDay.get( id ) !== this.day ) {

					this._drunkDay.set( id, this.day );
					if ( this.rng() < LIFE.drunkChance ) {

						m.absent = { port };
						this._say( 'drunk', [ id ], id );
						this._toast( `${ this.crew.nameOf( id ) } slipped ashore for one more at the ${ this._portName( port ) } tavern`, 3200 );
						this._emit( 'crewDrunk', { id, port } );

					}

				}

			}

		}

	}

	_levelCheck( id, m ) {

		const lv = levelOf( m ), was = this._levels.get( id );
		this._levels.set( id, lv );
		if ( was !== undefined && lv > was ) {

			this._toast( `${ this.crew.nameOf( id ) } is now level ${ lv }`, 2400 );
			this._emit( 'crewLevel', { id, level: lv } );

		}

	}

	// every hand off the guns to the buckets: each bucket knocks the fire down by his repair skill
	_fireWork( dt, ids, nv, fire ) {

		const F = this._fire;
		if ( ! fire ) {

			F.on = false;
			return;

		}

		const crew = ids.filter( ( id ) => this._acts.get( id ) === 'fire' );
		if ( ! F.on ) {

			F.on = true;
			F.t = 0;
			F.acc = 0;
			for ( const id of ids ) moraleEvent( this.crew.member( id ), 'fire' );
			this._say( 'fire', crew.length ? crew : ids, crew.find( ( id ) => has( this.crew.member( id ), 'brave' ) ) );

		}

		F.t += dt;
		if ( ! crew.length || F.t < REACT ) return;
		F.acc += dt;
		if ( F.acc < DOUSE_EVERY ) return;
		F.acc -= DOUSE_EVERY;
		let amount = 0;
		for ( const id of crew ) {

			const m = this.crew.member( id );
			amount += 0.06 + 0.12 * repairPower( m ); // three green hands just beat a growing fire, one old hand holds it
			grow( m, 'repair', LIFE.xp.douse );

		}

		const left = nv.fireState.douse( amount );
		if ( left > 0 ) return;
		// out: naval's own path stops the flames and says so
		if ( typeof nv.fireDoused === 'function' ) nv.fireDoused();
		else if ( nv.fireState.extinguish ) nv.fireState.extinguish();
		F.on = false;
		this._say( 'fireOut', crew );

	}

	// the pump: on top of naval's own crew pump (which stops with an enemy in range), skill makes each stroke count
	_pumpWork( dt, ids, nv, flood, alarm ) {

		if ( ! flood ) return;
		const crew = ids.filter( ( id ) => this._acts.get( id ) === 'pump' );
		if ( ! crew.length ) return;
		let rate = 0;
		for ( const id of crew ) {

			const m = this.crew.member( id );
			rate += FLOOD.crewPump * ( 0.75 * repairPower( m ) + ( alarm ? 1 : 0 ) );
			grow( m, 'repair', LIFE.xp.pumpSecond * dt );

		}

		const fs = nv.floodState;
		fs.level = Math.max( 0, fs.level - rate * dt );
		if ( ! this._floodSaid ) {

			this._floodSaid = true;
			this._say( 'flood', crew );

		}

		if ( fs.level <= 0 ) this._floodSaid = false;

	}

	// the lookout calls the sails coming into sight (farther for a sharp-eyed one) and a whale at the surface
	_lookout( id, b, nv ) {

		const m = this.crew.member( id ), name = this.crew.nameOf( id );
		const sharp = has( m, 'sharpEyed' );
		if ( nv && nv.ships && b && b.position && b.quaternion ) {

			const range = ( typeof nv.sightRange === 'function' ? nv.sightRange() : 400 ) * ( sharp ? 1.35 : 1.15 );
			for ( const s of nv.ships ) {

				if ( ! s.alive || this._seen.has( s.id ) ) continue;
				if ( Math.hypot( s.x - b.position.x, s.z - b.position.z ) > range ) continue;
				if ( this._seen.size > 200 ) this._seen.clear();
				this._seen.add( s.id );
				const what = s.faction === 'pirate' ? 'a pirate' : s.faction === 'navy' ? 'a navy ship' : 'a merchant';
				this._toast( `${ name } (lookout): sail ho! ${ what } off the ${ this._quarter( b, s.x, s.z ) }`, 3200 );
				this._say( 'sail', [ id ], id );
				if ( this.deck ) this.deck.gesture( id, CLIPS.pointOut );
				return;

			}

		}

		const wb = this.app.whale && this.app.whale.brain;
		if ( wb && wb.position && wb.state === 'surface' && this.time - this._whaleT > WHALE_S && b && b.position
			&& Math.hypot( wb.position.x - b.position.x, wb.position.z - b.position.z ) < ( sharp ? 500 : 350 ) ) {

			this._whaleT = this.time;
			this._toast( `${ name } (lookout): whale! off the ${ this._quarter( b, wb.position.x, wb.position.z ) }`, 3000 );
			this._say( 'whale', [ id ], id );
			if ( this.deck ) this.deck.gesture( id, CLIPS.pointOut );

		}

	}

	_quarter( b, x, z ) {

		const f = rotateByQuat( b.quaternion, { x: 0, y: 0, z: 1 } ), l = rotateByQuat( b.quaternion, { x: 1, y: 0, z: 0 } );
		const dx = x - b.position.x, dz = z - b.position.z, d = Math.hypot( dx, dz ) || 1;
		const ahead = ( dx * f.x + dz * f.z ) / d, port = dx * l.x + dz * l.z >= 0;
		if ( ahead > 0.7 ) return 'bow';
		if ( ahead < - 0.7 ) return 'stern';
		return port ? 'port beam' : 'starboard beam';

	}

	// fed up: a tavern hand signs off here, a roster hand goes ashore until the mood mends
	_quit( id, port ) {

		const name = this.crew.nameOf( id ), sailor = this.crew.sailors.has( id );
		this._say( 'quit', [ id ], id );
		if ( sailor ) this.crew.dismiss( id );
		else {

			const m = this.crew.member( id );
			this.crew.setPost( id, 'off', this.ctx() );
			m.ashore = true;
			m.leaving = false;

		}

		this._toast( `${ name } has had enough and leaves the ship at ${ this._portName( port ) }`, 3600 );
		this._emit( 'crewQuit', { id, name, port } );

	}

	speedFactor() {

		return Number.isFinite( this._speed ) ? this._speed : 1;

	}

	wagesPerDay() {

		if ( this._free() ) return 0;
		let w = 0;
		for ( const s of this.crew.sailors.values() ) w += s.wage || 0;
		return w;

	}

	// the brave hands cross with the skipper; each holds one of her crew off the fight
	boardingParty( ship = null, n = 0 ) {

		const ids = this.crew.aboard( this.ctx() ).filter( ( id ) => has( this.crew.member( id ), 'brave' ) && this._acts.get( id ) !== 'fire' && this._acts.get( id ) !== 'pump' ).slice( 0, Math.max( 0, n | 0 ) );
		if ( ids.length ) {

			const names = ids.map( ( id ) => this.crew.nameOf( id ) );
			this._toast( `${ names.join( ' and ' ) } ${ ids.length > 1 ? 'cross' : 'crosses' } with you: ${ ids.length } of her crew held off`, 3000 );
			this._say( 'board', ids, ids[ 0 ] );

		}

		return { held: ids.length, ids };

	}

	// ---------------------------------------------------------------- the tavern's hands

	_week() {

		return Math.floor( this.day / 7 );

	}

	hireables( port ) {

		return sailorsFor( port, this._week() ).filter( ( s ) => ! this.crew.sailors.has( s.id ) && ! this.crew.gone.has( s.id ) && ! this.app.netsync?.handTaken?.( s.id ) );

	}

	hire( id, port ) {

		const s = this.hireables( port ).find( ( x ) => x.id === id );
		if ( ! s ) return { ok: false, text: 'Signed on with another ship already' };
		if ( this.crew.sailors.size >= LIFE.maxHands ) return { ok: false, text: `Your crew list is full (${ LIFE.maxHands } hands)` };
		const st = this.state, free = this._free();
		if ( ! free && st && typeof st.spend === 'function' && ! st.spend( s.price ) ) return { ok: false, text: `${ s.name } asks ${ money( s.price ) } to sign on` };
		this.crew.hire( s, this.day );
		moraleEvent( this.crew.member( s.id ), 'hired' );
		const text = `${ s.name } signs on${ free ? '' : ` for ${ money( s.price ) } and ${ money( s.wage ) } a day` }: post them from the crew list`;
		this._toast( text, 3000 );
		this._emit( 'crewHired', { id: s.id, name: s.name, port, price: free ? 0 : s.price } );
		this._say( 'hired', [ s.id ], s.id );
		return { ok: true, text };

	}

	// a drunk hand found at this port's tavern: pay his tab and he comes back aboard
	fetch( id, port ) {

		const m = this.crew.life.get( id );
		if ( ! m || ! m.absent || ( port && m.absent.port !== port ) ) return { ok: false, text: 'Not here' };
		const st = this.state;
		if ( ! this._free() && st && typeof st.spend === 'function' && ! ( this.features?.get?.( 'story' )?.discount?.( 'tab' ) >= 1 ) && ! st.spend( TAB ) ) return { ok: false, text: `The keeper wants the ${ money( TAB ) } tab settled first` };
		m.absent = null;
		moraleEvent( m, 'fetched' );
		const text = `${ this.crew.nameOf( id ) } is back aboard, a little green`;
		this._toast( text, 2400 );
		this._emit( 'crewFetched', { id, port: port || null } );
		return { ok: true, text };

	}

	dismiss( id ) {

		const name = this.crew.nameOf( id );
		if ( ! this.crew.dismiss( id ) ) return { ok: false, text: 'Not a hired hand' };
		const text = `${ name } signs off`;
		this._toast( text, 2200 );
		return { ok: true, text };

	}

	tavernAct( act, id, port ) {

		if ( act === 'crew-hire' ) return this.hire( id, port );
		if ( act === 'crew-fetch' ) return this.fetch( id, port );
		return null;

	}

	tavernHtml( port, keeper = 'The keeper' ) {

		let h = '';
		const drunk = [ ...this.crew.life ].filter( ( [ , m ] ) => m.absent && m.absent.port === port );
		if ( drunk.length ) {

			h += '<h3>Your crew, here</h3>';
			h += drunk.map( ( [ id ] ) => `<div class="hb-row"><div><b>${ esc( this.crew.nameOf( id ) ) }</b><small>Asleep under a table. ${ esc( keeper ) } kept an eye on them.</small></div>
				<span class="hb-price">${ money( TAB ) } tab</span><button class="hb-btn is-small" data-act="crew-fetch" data-id="${ esc( id ) }">Bring aboard</button></div>` ).join( '' );

		}

		h += '<h3>Hands for hire</h3>';
		const list = this.hireables( port ), full = this.crew.sailors.size >= LIFE.maxHands, free = this._free();
		h += list.length ? list.map( ( s ) => {

			const traits = s.traits.map( ( t ) => TRAITS[ t ].label ).join( ', ' );
			return `<div class="hb-row"><div><b>${ esc( s.name ) } · ${ esc( traits ) }</b><small>${ esc( vouch( s, keeper ) ) }.</small>
				<small>${ SKILL_LABELS[ s.special ] } ${ s.skills[ s.special ] } · ${ free ? 'no wage in the sandbox' : `${ money( s.wage ) } a day` }</small></div>
				<span class="hb-price">${ free ? 'Free' : money( s.price ) }</span><button class="hb-btn is-small" data-act="crew-hire" data-id="${ esc( s.id ) }"${ full ? ' disabled' : '' }>Hire</button></div>`;

		} ).join( '' ) : '<div class="hb-empty">Nobody is looking for a berth this week.</div>';
		h += `<div class="hb-empty">${ this.crew.sailors.size } of ${ LIFE.maxHands } hands signed on · new faces every week</div>`;
		return h;

	}

	// ---------------------------------------------------------------- the crew tab

	lifeHtml( id ) {

		const m = this.crew.member( id );
		if ( ! m ) return '';
		const sk = SKILLS.map( ( k ) => `<span>${ SKILL_LABELS[ k ] } ${ Math.round( m.skills[ k ] ) }</span>` ).join( '' );
		const tr = m.traits.map( ( t ) => `<span class="cw-trait" title="${ esc( TRAITS[ t ].note ) }">${ TRAITS[ t ].label }</span>` ).join( '' );
		const where = m.ashore ? 'Ashore: left the ship, the mood mending' : m.absent ? `Drunk at the ${ esc( this._portName( m.absent.port ) ) } tavern` : m.leaving ? 'Fed up: leaves at the next port' : '';
		const act = this._acts.get( id );
		return `<div class="cw-life"><div class="cw-life-top"><span>Level <b>${ levelOf( m ) }</b></span><span>${ moodWord( m.morale ) }${ act && act !== 'post' ? ` · ${ act }` : '' }</span></div>
			<div class="cw-mood${ m.morale < 35 ? ' is-low' : '' }" title="Morale ${ Math.round( m.morale ) }"><i style="width:${ Math.round( m.morale ) }%"></i></div>
			${ tr ? `<div class="cw-traits">${ tr }</div>` : '' }<div class="cw-skills">${ sk }</div>${ where ? `<div>${ where }</div>` : '' }</div>`;

	}

	handsHtml() {

		if ( ! this.crew.sailors.size ) return '';
		const cards = [ ...this.crew.sailors.values() ].map( ( s ) => `<div class="gm-crew-card">
			<div class="gm-crew-face"><img src="${ portraitUrl( s.look ) }" alt="" draggable="false"></div>
			<div class="gm-crew-name"><span>${ esc( s.name ) }</span></div>
			<div class="gm-crew-tag">Signed on at ${ esc( this._portName( s.port ) ) } · ${ this._free() ? 'no wage' : `${ money( s.wage ) } a day` }</div>
			${ this.lifeHtml( s.id ) }${ this.postHtml( s.id ) }
			<button class="gm-btn" data-crew-dismiss="${ esc( s.id ) }">Let go</button></div>` ).join( '' );
		return `<div class="cw-hands"><h3>Hired hands</h3><div class="gm-crew">${ cards }</div></div>`;

	}

	// ---------------------------------------------------------------- banter

	_emit( name, data ) {

		if ( this.features && this.features.emit ) this.features.emit( name, data );

	}

	// a line from one of `ids` (default: the hands aboard and awake)
	_say( kind, ids = null, prefer = null ) {

		const list = ( ids || this.crew.aboard( this.ctx() ) ).filter( ( id ) => this.crew.present( id ) && this._acts.get( id ) !== 'sleep' );
		const r = this.banter.say( kind, list.map( ( id ) => ( { id, name: this.crew.nameOf( id ), member: this.crew.member( id ) } ) ), { now: this.time, prefer } );
		if ( ! r ) return null;
		this.said.push( r );
		if ( this.said.length > 20 ) this.said.shift();
		this._emit( 'crewBanter', { id: r.id, kind: r.kind, text: r.text } );
		this._bubble( r );
		return r;

	}

	_bubble( r ) {

		const root = this.bubbleRoot;
		if ( ! root || ! this.doc ) return;
		const el = this.doc.createElement( 'div' );
		el.className = 'cw-bubble';
		el.style.display = 'none';
		el.innerHTML = `${ esc( r.text ) }<small>${ esc( r.name ) }</small>`;
		root.append( el );
		this.bubbles.push( { el, id: r.id, t: BUBBLE_S } );
		while ( this.bubbles.length > 2 ) this.bubbles.shift().el.remove();

	}

	_updateBubbles( dt ) {

		if ( ! this.bubbles.length ) return;
		const cam = this.app.camera, w = globalThis.innerWidth || 1280, h = globalThis.innerHeight || 720;
		for ( let i = this.bubbles.length - 1; i >= 0; i -- ) {

			const x = this.bubbles[ i ];
			x.t -= dt;
			if ( x.t <= 0 ) {

				x.el.remove();
				this.bubbles.splice( i, 1 );
				continue;

			}

			const p = this.deck && this.deck.headOf( x.id, this._pt ) ? project( cam, this._pt, w, h ) : null;
			if ( ! p ) {

				x.el.style.display = 'none';
				continue;

			}

			x.el.style.display = '';
			x.el.style.left = p.x.toFixed( 1 ) + 'px';
			x.el.style.top = p.y.toFixed( 1 ) + 'px';
			x.el.style.opacity = x.t < 0.4 ? ( x.t / 0.4 ).toFixed( 2 ) : '1';

		}

	}

	// ---------------------------------------------------------------- the events the crew feel

	_listen() {

		const f = this.features;
		if ( ! f || typeof f.on !== 'function' ) return;
		const on = ( n, fn ) => {

			const r = f.on( n, ( e ) => fn( e || {} ) );
			if ( typeof r === 'function' ) this._removers.push( r );

		};
		const hands = () => this.crew.aboard( this.ctx() );
		const all = () => [ ...new Set( [ ...hands(), ...this.crew.sailors.keys() ] ) ];
		const each = ( list, kind ) => { for ( const id of list ) moraleEvent( this.crew.member( id ), kind ); };
		on( 'wagesPaid', () => { each( all(), 'wagesPaid' ); if ( this.rng() < 0.5 ) this._say( 'paid' ); } );
		on( 'wagesMissed', () => { each( all(), 'wagesMissed' ); this._say( 'unpaid' ); } );
		on( 'crewDeserted', () => each( all(), 'deserted' ) );
		on( 'crewReturned', () => each( all(), 'returned' ) );
		on( 'shipSunk', ( e ) => {

			if ( e.faction !== 'pirate' || ! e.byPlayer ) return;
			each( hands(), 'victory' );
			this._say( 'win' );

		} );
		on( 'boardersRepelled', () => { each( hands(), 'victory' ); this._say( 'win' ); } );
		on( 'boardersWon', () => { each( hands(), 'boarded' ); this._say( 'loss' ); } );
		on( 'playerBoatSunk', () => { each( hands(), 'sunk' ); this._say( 'loss' ); } );
		on( 'playerBoatDamaged', ( e ) => {

			if ( e.cause === 'fire' || this.time - this._hitT < 3 ) return;
			this._hitT = this.time;
			each( hands(), 'hit' );
			this._say( 'hit' );

		} );
		on( 'weatherChanged', ( e ) => {

			if ( e.kind !== 'storm' ) return;
			each( hands(), 'storm' );
			this._say( 'storm' );

		} );
		on( 'fishCaught', ( e ) => {

			if ( e.crew || e.by || ! ( e.aboard || this._aboard() ) ) return; // the crew's own catches are counted where they land
			each( hands(), 'shipCatch' );
			if ( this.rng() < 0.35 ) this._say( 'shipCatch' );

		} );
		on( 'sailSighted', () => {

			const ctx = this.ctx(), look = this.crew._of( 'lookout', ctx )[ 0 ] || null;
			this._say( 'sail', null, look );

		} );

	}

}

export default { install };

import { Vector3 } from '../../engine/index.js';
import { Avatar } from '../../player/Avatar.js';
import { WORLD } from '../../world/WorldLayout.js';
import { mulberry32 } from '../../util/Noise.js';
import {
	PLAYER, RAIDER, CLOCK, SLOTS, RAIDER_NAMES, CAPTAIN_NAMES, TOKENS, TRAINING_POST, THROW, FEEL, PRACTICE,
	clamp, facingDot, yawToward, crossed, hoursForward, isNight,
} from './MeleeData.js';
import { Raider } from './Raider.js';
import { Dummy } from './Dummy.js';
import { Rocks } from './Rocks.js';
import { Practice } from './Practice.js';
import { pickLock, assistYaw, LOCK } from './LockOn.js';
import { inPeace } from './Peace.js';
import { PlayerCombat } from './PlayerCombat.js';
import { CombatAudio } from './CombatAudio.js';
import { MeleeHud } from './MeleeHud.js';
import { Telegraph } from './Telegraph.js';
import { RAIDER_ARMS } from '../weapons/WeaponsData.js';
import { GunAudio } from '../firearms/GunAudio.js';

// On-foot melee: the player's blows, guard, parry and evade against every Raider (den guards, boarding crews, slot camps),
// a soft lock-on, the shared attack tokens and the training post.
//
//   features.add( 'melee', melee );     // module: { install } -> the instance below
//   const m = features.get( 'melee' );  // { update, dispose, toJSON, fromJSON, reset, raiders, playerHp, wantsMouse(), playerAction }
//
// Wave 4: the home island and its bay are peaceful (Peace.js: m.peaceful is true there, so no raider picks a fight; the old
// east-beach camp is abandoned, props only). Raiders live at the pirate dens (pirates/Dens.js puts its guards on m.raiders)
// and on boarded decks (boarding). The slot camp below still runs when options.slots gives it slots (tests, sandbox arenas).
//   m.lock          the soft lock-on target (nearest enemy in the facing cone, sticky); the camera eases onto it so A / D
//                   strafe round him (settings.lockAssist === false turns the pull off); a subtle reticle marks him
//   m.tokens        at most TOKENS.max (2) raiders swing at once; the rest circle and flank (Raider 'circle')
//   m.dummy         the training post on the harbour beach (Dummy.js): hit it, E to spar (it swings back, never hurts)
//   Controller: RT attack, LT guard / parry (Gamepad.js maps them to the mouse buttons), RB evade while in a fight.
//   Defeat: with the death feature installed, playerDied { cause: 'melee', x, y, z, by } and the death feature respawns the
//   player; without it the old pier wake-up. playerRespawned (death) ends the knockdown at once.
//
// The slot raiders (options.slots, e.g. MeleeData SLOTS): two camp by day, two more at night
// (19:00 - 05:30), and now and then a named captain moves in (35 % each dawn). A beaten raider is back one in-game
// day later. They notice the player inside 12 m, close in, wind up for 0.6 s (red ring on the ground, "!" over the
// head), strike, and stand open for 0.8 s. At 0 hp a raider is knocked down, then gets up and flees or stays down
// and is dragged off. They never leave a 30 m leash of their camp.
//
// The player (PlayerCombat.js):
//   Left mouse   attack (rod stowed, a raider within 6 m). wantsMouse() tells the game the click is melee's.
//   Right mouse  hold to guard (rod stowed): frontal blows are blocked, each chips 0.15 stamina; raised just before the
//                blow (the ring turns gold) it parries: nothing lost, the raider reels open for a punish.
//                Wave 5: only with an enemy or the training post in reach (GUARD.reach, or a raider closing in): outside a
//                fight RMB does nothing. Toggle mode (input.guardToggle / settings.guardMode 'toggle', the Access option):
//                a press raises it, the next lowers it. It drops on its own when the window loses focus or the pointer
//                lock goes (input.releases), a panel opens, the rod comes out, the fight ends, the player goes down, or
//                no enemy has been in reach for GUARD.idle s; a button still held through such a drop needs a fresh press.
//   Q            evade: 2 m dash, 0.25 s of i-frames, 0.2 stamina (claimed through features.claimKey)
//   Stamina is app.player.stamina (0..1, Player.js): swing 0.08, evade 0.2, block 0.15, guard 0.1 / s.
//   Health 100 here (melee.playerHp). At 0: knocked down for 3 s, 10 % of the cash carried is lost
//   (features.state.spend), the player wakes at the nearest pier.
//
// What the game must wire (everything else is self-contained):
//   1. features.update( dt ) each frame after player.update (this module moves the camera feel, the HUD and the telegraph).
//   2. Game.avatarAction(): `const ma = features.get( 'melee' ).playerAction; if ( ma ) return ma;` FIRST (before the
//      launched / tumble check): 'swing' | 'hit' | 'knockdown' | 'getUp' | null.
//   3. Game's rod input: skip `rod.startWindup()` / `strike()` while `melee.wantsMouse()` is true (it is only ever true
//      with the rod stowed, or mid-fight).
//   4. Optional: melee.guarding (bool) for a guard pose, melee.stateInfo() for debugging.
//
// Events (features.emit): enemyDefeated { id, name, kind: 'raider', captain, x, z }, playerKnockedDown { by, byId, kind, cashLost },
// (wave 12E) practiceStarted { count }, practiceEnded { result: 'won' | 'lost' | 'left' }, rockThrown { by, x, z }.
// Headless: install( app, features, { avatarFactory, audio, hud: false, fx: false, rand, seed } ) takes stubs.
//
// Wave 12E, combat you can feel (the regression gate is test/feature-combat-play.mjs, a scripted fight at 60 Hz):
//   m.hitstop( s )     a blow that lands freezes both fighters (the melee sim: the player's combat, every raider, the rocks)
//                      for 70-90 ms; m.timeScale is 0 then (App may scale the avatar / world with it: see the report)
//   m.slowmo( s, k )   a parry: 0.3 s at 0.4 speed (m.timeScale 0.4)
//   the guard          RMB held with the rod away always raises the stance (no enemy needed); it drains stamina only in a fight
//   the thrower        with 3+ raiders on the player one hangs back and throws rocks (Raider 'hang' / 'throw', Rocks.js)
//   the practice fight E at the weapon rack beside the training post (Practice.js): two practice raiders, no death
//   HUD                the lock-on reticle carries the locked raider's health and his wind-up as a ring filling to the blow;
//                      a shield / parry flash on a blocked blow; the screen edge flashes when hit and pulses at low health
//
// Wave 18D (the arsenal; src/features/weapons):
//   m.weaponStats()    the melee weapon in hand (features.get( 'weapons' ).meleeStats(): cutlass, boarding axe, belaying pin,
//                      harpoon; null = the paddle) for PlayerCombat's swing
//   gunmen             a raider with a blunderbuss (Raider.weapon) holds the thrower's role whenever he fights: he hangs back,
//                      the ring marks where he aims, and m.raiderShot( r, at ) fires: out of the ring or a dodge and it misses,
//                      the guard takes some of it (PlayerCombat: r.shot), beyond RAIDER_ARMS.blunderbuss.range it falls short
//   smoke              features.get( 'weapons' ).hidden( x, z ) (a smoke pot's cloud): raiders lose the player inside it

const _o = new Vector3(), _d = new Vector3(), _h = new Vector3();
const CREATE_D2 = 150 * 150; // m^2: raiders are created (their GLB loads) once the player is this close to a camp
const UPDATE_D2 = 170 * 170;
const FAR_D2 = 80 * 80; // beyond this a raider out of combat holds its pose
const FIXED = 1 / 30;
// the guard's reach (wave 5): a target this close (m), or a raider closing in this close, counts as "in a fight" for the
// guard (wave 12E: the stance itself comes up whenever RMB is held with the rod away); a toggled guard drops after `idle` s
// with neither
export const GUARD = { reach: 8, aggroReach: 12, idle: 3 };
const PIERS = () => {

	const P = WORLD.pier, out = [ { x: P.x, z: P.zStart + 5, yaw: Math.PI } ];
	const dk = WORLD.pons && WORLD.pons.dock;
	if ( dk ) {

		const dx = dk.end.x - dk.start.x, dz = dk.end.z - dk.start.z, l = Math.hypot( dx, dz ) || 1;
		out.push( { x: dk.start.x + dx / l * 3, z: dk.start.z + dz / l * 3, yaw: yawToward( 0, 0, dx, dz ) } );

	}

	return out;

};

export class Melee {

	constructor( app, features, options = {} ) {

		this.app = app;
		this.features = features;
		this.options = options;
		this.enabled = options.enabled !== false;
		this.peacefulOpt = !! options.peaceful; // raiders ignore the player (sandbox option)
		this.zoneOn = options.peaceZone !== false; // the peaceful home waters (Peace.js)
		this.inPeace = false;
		this.lockOn = options.lockOn !== false;
		this.lock = null;
		this.lockPlayerOnDown = options.lockPlayer !== false;
		this.autoStow = options.autoStow !== false;
		this.terrain = options.terrain || app.terrainData || ( app.terrain && app.terrain.heightAt ? app.terrain : null );
		this.colliders = options.colliders !== undefined ? options.colliders : ( app.colliders || null );
		this.player = app.player;
		this.rand = options.rand || mulberry32( options.seed !== undefined ? options.seed : ( Date.now() & 0xffffff ) );
		this.avatarFactory = options.avatarFactory || ( ( o ) => new Avatar( o ) );
		this.audio = options.audio || new CombatAudio( app.audio );
		this._audioReady = false;
		this.time = 0;
		this.hours = 0; // in-game hours since the module started
		this.hour = null; // the island clock now (null: unknown)
		this._lastHour = null;
		this.tokens = new Set(); // raiders holding an attack token (TOKENS.max at most)
		this.tokenGap = 0;
		this.sched = [];
		this._target = { x: 0, y: 0, z: 0, valid: false };
		this._lmb = false;
		this._rmb = false;
		this._guardUp = false; // the guard as the buttons and the rules want it (combat.guardHeld)
		this._guardBlock = false; // hold mode: RMB was held through a forced drop, a fresh press is needed
		this._guardFar = 0; // s with no enemy in the guard's reach
		this._guardRel = undefined; // input.releases last seen
		this._wasEngaged = false;
		this._nearest = null;
		this.hintT = 0;
		this.hintText = '';
		this.hintShown = false;
		this.kills = 0;
		this.captain = { active: false };
		// no camp on the home island any more: slots only when asked for (MeleeData SLOTS is the old layout)
		this.slots = ( Array.isArray( options.slots ) ? options.slots : [] ).map( ( s ) => ( { ...s, raider: null, respawnLeft: 0 } ) );
		this.list = []; // every Raider created
		this.combat = new PlayerCombat( this );
		this._offs = [];
		this._rb = false;
		this.stopT = 0; // s of hitstop left (real time)
		this.slowT = 0; // s of the parry's slow motion left (real time)
		this.slowK = 1;
		this.stops = 0; // hitstops so far (tests)
		this.simTime = 0; // the melee sim's own clock (hitstop / slow motion applied)
		this.rocks = new Rocks( { scene: options.fx === false ? null : app.scene } );
		this.gunAudio = options.gunAudio || null; // the gunmen's reports (made on the first shot: GunAudio over app.audio)

		// the captain may already be camped when the game starts
		if ( options.captain !== undefined ) this.captain.active = !! options.captain;
		else this.captain.active = this.rand() < CLOCK.captainChance;

		// Q is ours (features.claimKey keeps two features from sharing it)
		this.keyOk = features && features.claimKey ? features.claimKey( 'KeyQ', 'melee' ) : true;

		const hudEl = app.ui && app.ui.ui ? ( app.ui.ui.hud || app.ui.ui.root ) : ( options.hudElement || null );
		this.hud = options.hud === false ? null : new MeleeHud( { hud: hudEl, camera: app.camera, doc: options.doc } );
		this.fx = options.fx === false ? null : this._makeFx();
		this._pBase = new WeakMap(); // the player avatar's materials -> base emissive
		this._pFlashing = false;

		// the training post (the melee tutorial in the peaceful harbour)
		this.dummy = options.dummy === false ? null : new Dummy( this, { scene: options.fx === false ? null : app.scene, terrain: this.terrain, mesh: options.fx !== false } );
		if ( this.dummy && features && features.interactable ) {

			const d = this.dummy;
			this._offs.push( features.interactable( {
				id: 'melee:training-post', position: () => ( { x: d.x, y: d.y, z: d.z } ), radius: 3,
				when: () => this.enabled && this.player && this.player.mode === 'walk',
				prompt: () => ( d.sparring ? 'Stop sparring' : 'Spar at the training post' ),
				onInteract: () => this.spar( ! d.sparring ),
			} ) );

		}

		// the practice fight: E at the weapon rack beside the post
		this.practice = options.practice === false ? null : new Practice( this, { scene: options.fx === false ? null : app.scene, terrain: this.terrain, mesh: options.fx !== false } );
		if ( this.practice && features && features.interactable ) {

			const pf = this.practice;
			this._offs.push( features.interactable( {
				id: 'melee:practice-fight', position: () => pf.rack, radius: PRACTICE.rackRadius,
				when: () => this.enabled && this.player && this.player.mode === 'walk' && this.combat.state !== 'down',
				prompt: () => ( pf.active ? 'Stop the practice fight' : 'Practice fight (wooden swords)' ),
				onInteract: () => ( pf.active ? pf.stop( 'left' ) : pf.start() ),
			} ) );

		}

		// the death feature respawned the player: the knockdown is over
		if ( features && features.on ) this._offs.push( features.on( 'playerRespawned', () => this._respawned() ) );

	}

	// E at the training post: start / stop sparring (the rod goes away; tips the first time)
	spar( on = true ) {

		const d = this.dummy;
		if ( ! d ) return false;
		d.spar( on );
		if ( on ) {

			this.rodAway( false );
			if ( ! this._sparTip ) {

				this._sparTip = true;
				this.hintT = 7;
				this.hintText = 'Sparring · raise the guard (<kbd>RMB</kbd>) as the ring turns <b>gold</b> to parry · <kbd>Q</kbd> to dodge · <kbd>E</kbd> to stop';

			}

		}

		return d.sparring;

	}

	_respawned() {

		const c = this.combat;
		if ( c.state === 'down' ) {

			c.state = 'free';
			c.t = 0;
			c.fade = 0;
			c.respawned = true;
			c.hurtInv = 1.5;

		}

		c.hp = c.maxHp;
		this.lock = null;

	}

	get peaceful() {

		return this.peacefulOpt || this.inPeace;

	}

	set peaceful( v ) {

		this.peacefulOpt = !! v;

	}

	get token() {

		for ( const r of this.tokens ) return r;
		return null;

	}

	// raiders and the training post: everything the player's swing and the lock can find
	targets() {

		if ( ! this.dummy ) return this.list;
		const out = this.list.slice();
		out.push( this.dummy );
		return out;

	}

	_makeFx() {

		try {

			return new Telegraph( { scene: this.app.scene } );

		} catch ( e ) {

			console.warn( 'melee: telegraph unavailable', e );
			return null;

		}

	}

	// ---- public surface

	get raiders() {

		return this.list;

	}

	get playerHp() {

		return this.combat.hp;

	}

	get playerAction() {

		return this.enabled ? this.combat.action : null;

	}

	get guarding() {

		return this.combat.guarding;

	}

	get playerDown() {

		return this.combat.state === 'down';

	}

	// is the left mouse button melee's right now (so the fishing input should stay out of it)?
	wantsMouse() {

		if ( ! this.enabled ) return false;
		if ( this._gunDrawn() ) return this.combat.state !== 'free'; // a drawn pistol / musket owns the click (firearms fires it)
		if ( this.combat.state !== 'free' ) return true; // mid-swing, hurt, evading, knocked down: the click is the fight's
		return this.canSwing();

	}

	// may a left click start a swing now: on foot, the rod away, a raider within engage range
	// a drawn firearm (src/features/firearms): no swing, the left button shoots
	_gunDrawn() {

		const fa = this.features && this.features.get ? this.features.get( 'firearms' ) : null;
		if ( fa && fa.drawn ) return true;
		// (wave 18D) a throwable or the swivel gun in hand: the left button is the weapons feature's too
		const w = this.features && this.features.get ? this.features.get( 'weapons' ) : null;
		try { return !! ( w && w.ownsMouse && w.ownsMouse() ); } catch ( e ) { return false; }

	}

	canSwing() {

		if ( this._gunDrawn() ) return false;
		// a swing is always allowed with the rod away (the peaceful home island only stops NPCs attacking you): it lands on
		// a raider, the training post or a breakable prop when one is in reach, else it is a swing at the air
		return !! ( this.enabled && this._canAct() && this.rodStowed() );

	}

	setEnabled( on ) {

		this.enabled = !! on;
		if ( ! on ) for ( const r of this.list ) if ( r.active ) r.deactivate();

	}

	// the sandbox option (the home waters are peaceful whatever this says)
	setPeaceful( on ) {

		this.peacefulOpt = !! on;

	}

	stateInfo() {

		return {
			hp: this.combat.hp, state: this.combat.state, guarding: this.combat.guarding, stamina: this.combat.stamina,
			hour: this.hour, captain: this.captain.active, kills: this.kills, peaceful: this.peaceful, tokens: this.tokens.size,
			lock: this.lock ? this.lock.name : null, sparring: !! ( this.dummy && this.dummy.sparring ),
			raiders: this.list.filter( ( r ) => r.active ).map( ( r ) => ( { id: r.id, name: r.name, state: r.state, hp: r.hp, x: +r.x.toFixed( 1 ), z: +r.z.toFixed( 1 ) } ) ),
		};

	}

	// ---- player / world queries (also the PlayerCombat host surface)

	rodStowed() {

		const g = this.app.game, rod = g && g.rod;
		return ! rod || ! rod.equipped;

	}

	_panelOpen() {

		const hud = this.app.game && this.app.game.hud;
		return !! ( hud && ( hud.invOpen || hud.standOpen || hud.rosterOpen || hud.catchOpen ) );

	}

	_canAct() {

		const a = this.app, p = this.player, inp = a.input;
		if ( ! p || p.mode !== 'walk' ) return false;
		if ( a.paused || a.menuOpen || a.freeCam ) return false;
		if ( inp && inp.enabled === false ) return false;
		return ! this._panelOpen();

	}

	target() {

		return this._target;

	}

	_updateTarget() {

		const p = this.player, t = this._target;
		if ( ! p ) { t.valid = false; return; }
		t.x = p.position.x;
		t.y = p.position.y;
		t.z = p.position.z;
		t.yaw = p.yaw; // flankers work round behind him
		// raiders only go for a player on foot and standing, and not one they cannot see for the smoke (a smoke pot, wave 18D)
		t.valid = this.enabled && p.mode === 'walk' && this.combat.state !== 'down' && ! this.app.paused && ! this._inSmoke( t.x, t.z );

	}

	_inSmoke( x, z ) {

		const w = this.features && this.features.get ? this.features.get( 'weapons' ) : null;
		try { return !! ( w && w.hidden && w.hidden( x, z ) ); } catch ( e ) { return false; }

	}

	// the melee weapon in hand (the weapons feature), or null: the paddle (PlayerCombat SWING)
	weaponStats() {

		const w = this.features && this.features.get ? this.features.get( 'weapons' ) : null;
		try { return w && w.meleeStats ? w.meleeStats() : null; } catch ( e ) { return null; }

	}

	_raiderWithin( range ) {

		const p = this.player.position;
		let best = null, bd = range * range;
		for ( const r of this.targets() ) {

			if ( ! r.targetable ) continue;
			const d2 = ( r.x - p.x ) ** 2 + ( r.z - p.z ) ** 2;
			if ( d2 <= bd ) { bd = d2; best = r; }

		}

		return best;

	}

	engaged() {

		const p = this.player.position;
		for ( const r of this.list ) if ( r.inCombat && ( r.x - p.x ) ** 2 + ( r.z - p.z ) ** 2 < 25 * 25 ) return true;
		return false;

	}

	lineOfSight( ax, ay, az, bx, by, bz ) {

		const c = this.colliders;
		if ( ! c || ! c.raycast ) return true;
		_o.set( ax, ay, az );
		_d.set( bx - ax, by - ay, bz - az );
		const len = _d.length();
		if ( len < 1e-3 ) return true;
		_d.multiplyScalar( 1 / len );
		return c.raycast( _o, _d, len ) >= len - 0.25;

	}

	// ---- attack tokens: at most TOKENS.max raiders swing at once, wind-ups start TOKENS.gap s apart

	tokenFree( r ) {

		if ( this.tokens.has( r ) ) return true;
		// a raider that is no longer fighting gives his token back (a host forgot, he was put away)
		let cap = Math.min( TOKENS.max, r.cfg && r.cfg.tokens ? r.cfg.tokens : TOKENS.max );
		for ( const q of this.tokens ) {

			if ( ! q.active || ! ( q.inCombat || q.state === 'windup' || q.state === 'strike' || q.state === 'throw' ) ) { this.tokens.delete( q ); continue; }
			// wave 12E: a holder of a lower cap keeps it for everyone (a tier 1 crowd takes strict turns)
			if ( q.cfg && q.cfg.tokens ) cap = Math.min( cap, q.cfg.tokens );

		}

		return this.tokens.size < cap && this.tokenGap <= 0;

	}

	takeToken( r ) {

		if ( this.tokens.has( r ) ) return;
		this.tokens.add( r );
		if ( this.tokens.size > 1 ) this.tokenGap = TOKENS.gap; // the next wind-up waits a beat
		else this.tokenGap = Math.max( this.tokenGap, 0 );

	}

	releaseToken( r ) {

		if ( this.tokens.delete( r ) ) this.tokenGap = Math.max( this.tokenGap, TOKENS.after );

	}

	far( r ) {

		if ( r.inCombat ) return false;
		const p = this.player.position;
		return ( r.x - p.x ) ** 2 + ( r.z - p.z ) ** 2 > FAR_D2;

	}

	// ---- effects

	sfx( bank, opts = {} ) {

		try { return this.audio && this.audio.play ? this.audio.play( bank, opts ) : false; } catch ( e ) { return false; }

	}

	pop( text, at, kind ) {

		if ( this.hud ) this.hud.pop( text, at, kind );

	}

	// a CameraFeel kick; `fallback` when this CameraFeel does not know `type` (kick returns false)
	kick( type, fallback = null ) {

		const f = this.app.cameraFeel;
		if ( ! f || ! f.kick ) return;
		if ( f.kick( type ) === false && fallback ) f.kick( fallback );

	}

	// a one-shot on the player's avatar through the animation graph (Avatar.playMontage); the old action API
	// (playerAction -> Game.avatarAction) keeps working without it
	montage( name, opts = {} ) {

		const av = this.app.avatar;
		try { return av && typeof av.playMontage === 'function' ? av.playMontage( name, opts ) || true : false; } catch ( e ) { return false; }

	}

	stopMontage( slot = null, blendOut = 0.2 ) {

		const av = this.app.avatar;
		try { if ( av && typeof av.stopMontage === 'function' ) av.stopMontage( slot, blendOut ); } catch ( e ) { /* the graph is optional */ }

	}

	hasDeath() {

		return !! ( this.features && this.features.get && this.features.get( 'death' ) );

	}

	// ---- the feel (wave 12E)

	// freeze both fighters for s (real) seconds: the player's combat, every raider and the rocks stand still
	hitstop( s = FEEL.hitstop ) {

		if ( ! ( s > 0 ) ) return;
		this.stopT = Math.max( this.stopT, Math.min( 0.2, s ) );
		this.stops ++;

	}

	// the parry's slow motion: s real seconds at k speed
	slowmo( s = FEEL.slowT, k = FEEL.slowK ) {

		if ( this.app.settings && this.app.settings.reduceMotion ) k = Math.max( k, 0.7 ); // milder, never off: it is the timing cue
		this.slowT = Math.max( this.slowT, s );
		this.slowK = clamp( k, 0.05, 1 );

	}

	// how fast the fight runs right now: 0 in a hitstop, 0.4 in the parry's slow motion, else 1 (App / Avatar may follow it)
	get timeScale() {

		return this.stopT > 0 ? 0 : this.slowT > 0 ? this.slowK : 1;

	}

	// the HUD's flash: 'block' (the shield), 'parry' (gold), 'hurt' (the screen edge)
	flash( kind ) {

		if ( this.hud && this.hud.flash ) this.hud.flash( kind );

	}

	// dust / sparks at a contact: 'hit' (dust off the body), 'block' (sparks off the guard), 'parry' (a bright spark burst)
	puff( kind, at ) {

		const vfx = this.features && this.features.get ? this.features.get( 'vfx' ) : null;
		if ( ! vfx || ! at ) return;
		try {

			if ( kind === 'hit' ) { if ( vfx.dust ) vfx.dust( at.x, at.y, at.z, 0.07 ); }
			else if ( kind === 'rock' ) { if ( vfx.debris ) vfx.debris( at.x, at.y, at.z, 0.08, 'stone' ); else if ( vfx.dust ) vfx.dust( at.x, at.y, at.z, 0.06 ); }
			else {

				if ( vfx.debris ) vfx.debris( at.x, at.y, at.z, kind === 'parry' ? 0.12 : 0.07, 'metal' );
				if ( kind === 'parry' && vfx.flash ) vfx.flash( at.x, at.y, at.z, 0.12, 0, 1, 0 );

			}

		} catch ( e ) { /* the vfx are optional */ }

	}

	// a thrower's rock leaves his hand toward `at` (Raider 'throw' calls this on its owner of the role)
	throwRock( r, at ) {

		const s = r.scale || 1;
		const from = { x: r.x + r.fx * 0.35, y: r.y + 1.75 * s, z: r.z + r.fz * 0.35 };
		const src = {
			ranged: true, kind: 'rock', name: r.name, spawnId: r.spawnId, practiceFight: !! r.practiceFight, practice: !! r.practice,
			cfg: { damage: Math.max( 1, Math.round( r.cfg.damage * THROW.damage ) ) }, x: from.x, z: from.z, thrower: r,
		};
		const rock = this.rocks.launch( from, at, src );
		this.sfx( 'hookSwing', { at: from, rate: 1.2, gain: 0.6 } );
		this.emit( 'rockThrown', { by: r.spawnId, x: at.x, z: at.z } );
		return rock;

	}

	// a gunman's blast (wave 18D): aimed at `at` (the ring, set until the last 0.3 s of his aim); it reaches the player when he
	// is still within 1.6 m of the ring and inside the gun's range with a clear line, else it tears up the ground there
	raiderShot( r, at ) {

		const A = RAIDER_ARMS.blunderbuss, s = r.scale || 1;
		const from = { x: r.x + r.fx * 0.5, y: r.y + 1.35 * s, z: r.z + r.fz * 0.5 };
		const p = this.player.position, c = this.combat;
		const dx = ( at ? at.x : p.x ) - from.x, dz = ( at ? at.z : p.z ) - from.z, dl = Math.hypot( dx, dz ) || 1;
		const dir = { x: dx / dl, y: - 0.05, z: dz / dl };
		const vfx = this.features && this.features.get ? this.features.get( 'vfx' ) : null;
		try {

			if ( vfx && vfx.flash ) vfx.flash( from.x, from.y, from.z, 0.8, dir.x, dir.y, dir.z );
			if ( vfx && vfx.smoke ) vfx.smoke( from.x, from.y, from.z, 0.9, dir.x, dir.y, dir.z );

		} catch ( e ) { /* the vfx are optional */ }

		if ( ! this.gunAudio && this.app.audio ) this.gunAudio = new GunAudio( this.app.audio );
		try { if ( this.gunAudio ) this.gunAudio.report( 'blunderbuss', { at: from, gain: 1 } ); } catch ( e ) { /* optional */ }
		this.emit( 'gunFired', { weapon: 'blunderbuss', x: from.x, y: from.y, z: from.z, dir, by: r.spawnId } );
		const d = Math.hypot( p.x - r.x, p.z - r.z );
		const off = at ? Math.hypot( p.x - at.x, p.z - at.z ) : 0;
		const clear = this.lineOfSight( from.x, from.y, from.z, p.x, p.y + 1.1, p.z );
		if ( ! this._target.valid || c.state === 'down' || d > A.range || off > 1.6 || ! clear ) {

			if ( at ) this.puff( 'rock', { x: at.x, y: ( this.terrain ? this.terrain.heightAt( at.x, at.z ) : p.y ) + 0.1, z: at.z } );
			r.outcome = 'missed';
			return 'missed';

		}

		// the shot spreads with the distance: full at 4 m, half at the gun's range
		const k = d <= 4 ? 1 : 1 - 0.5 * ( d - 4 ) / Math.max( 1, A.range - 4 );
		const src = {
			ranged: true, shot: true, kind: 'gunman', name: r.name, spawnId: r.spawnId, practiceFight: false, practice: false,
			cfg: { damage: Math.max( 1, Math.round( r.cfg.damage * A.damage * k ) ) }, x: r.x, z: r.z, thrower: r,
		};
		const out = c.takeStrike( src );
		r.outcome = out;
		return out;

	}

	// a rock reached the player's body
	_rockHit( rock ) {

		if ( rock.passed ) return false;
		const c = this.combat, src = rock.src;
		if ( ! this._target.valid || c.state === 'down' ) { rock.passed = true; return false; }
		// it came from where it flew in
		const v = Math.hypot( rock.vx, rock.vz ) || 1;
		src.x = rock.x - rock.vx / v * 2;
		src.z = rock.z - rock.vz / v * 2;
		const out = c.takeStrike( src );
		rock.outcome = out;
		if ( src.thrower ) src.thrower.outcome = out;
		if ( out === 'dodged' || out === 'ignored' || out === 'missed' ) { rock.passed = true; return false; } // it flies on past
		this.puff( 'rock', rock );
		return true;

	}

	// a practice raider yields / the player yields (the practice fight)
	onYield( r ) {

		if ( this.practice ) this.practice.onYield( r );

	}

	practiceLost( r ) {

		if ( this.practice ) this.practice.lost( r );

	}

	// the thrower: with THROW.crowd raiders on the player one of them (the farthest, not mid-swing) hangs back and throws;
	// fewer than that and he rejoins the melee. Boarding crews and den guards share melee.raiders, so they do it too.
	_roles() {

		const p = this.player.position;
		let n = 0, thrower = null, far = null, fd = - 1;
		for ( const r of this.list ) {

			if ( ! r.active || ! r.visible || ! r.aggro || r.hp <= 0 || r.yielded || r.state === 'down' || r.state === 'getup' || r.state === 'flee' || r.state === 'gone' || r.state === 'return' ) {

				if ( r.role ) r.role = null;
				continue;

			}

			if ( ! r.inCombat ) continue;
			const d2 = ( r.x - p.x ) ** 2 + ( r.z - p.z ) ** 2;
			if ( d2 > 25 * 25 ) continue;
			// a gunman (wave 18D) always fights from range: the thrower's role is his whenever he is in the fight
			if ( r.weapon === 'blunderbuss' ) {

				if ( r.role !== 'thrower' && this._target.valid ) {

					r.role = 'thrower';
					r.roleBy = this;
					r.sinceAttack = Math.min( r.sinceAttack, THROW.every * 0.5 );

				}

				continue;

			}

			n ++;
			if ( r.role === 'thrower' ) thrower = r;
			else if ( d2 > fd && r.state !== 'windup' && r.state !== 'strike' && ! this.tokens.has( r ) ) { fd = d2; far = r; }

		}

		if ( n >= THROW.crowd && this._target.valid ) {

			if ( ! thrower && far ) {

				far.role = 'thrower';
				far.roleBy = this;
				far.sinceAttack = Math.min( far.sinceAttack, THROW.every * 0.5 ); // a beat before the first rock

			}

		} else if ( thrower ) thrower.role = null;

	}

	toast( text, ms = 2600 ) {

		const g = this.app.game;
		if ( g && g.toast ) g.toast( text, ms );

	}

	emit( name, payload ) {

		if ( this.features && this.features.emit ) this.features.emit( name, payload );

	}

	// put the rod away (a fight, a knockdown); not while a fish is on
	rodAway( force = false ) {

		const g = this.app.game, rod = g && g.rod;
		if ( ! rod || ! rod.equipped ) return false;
		if ( g.fight && ! force ) return false;
		if ( g.cancelLine ) g.cancelLine( true );
		if ( rod.equip ) rod.equip( false );
		return true;

	}

	// move the player along the ground by ( dx, dz ): the evade dash. Stays out of deep water and solid geometry
	movePlayer( dx, dz ) {

		const p = this.player.position, t = this.terrain;
		let nx = p.x + dx, nz = p.z + dz;
		if ( t ) {

			const ok = ( x, z ) => t.heightAt( x, z ) > - 0.6;
			if ( ! ok( nx, nz ) ) {

				if ( ok( nx, p.z ) ) nz = p.z;
				else if ( ok( p.x, nz ) ) nx = p.x;
				else return false;

			}

		}

		const c = this.colliders;
		if ( c && c.resolveCapsule ) {

			_h.set( nx, p.y, nz );
			c.resolveCapsule( _h, 0.4, 1.7, 0.4 );
			nx = _h.x;
			nz = _h.z;

		}

		p.x = nx;
		p.z = nz;
		if ( t ) {

			const g = t.heightAt( nx, nz );
			if ( g > p.y ) p.y = g;

		}

		return true;

	}

	// keep the player's controls still while knocked down (Player.launched = no control, velocity held at 0)
	lockPlayer() {

		const p = this.player;
		if ( ! this.lockPlayerOnDown || ! p ) return;
		if ( typeof p.launched === 'number' ) p.launched = Math.max( p.launched, 0.08 );
		if ( p.velocity ) { p.velocity.x = 0; p.velocity.z = 0; }

	}

	respawnPoint() {

		const p = this.player.position;
		let best = null, bd = Infinity;
		for ( const c of PIERS() ) {

			const d = Math.hypot( c.x - p.x, c.z - p.z );
			if ( d < bd ) { bd = d; best = c; }

		}

		return best;

	}

	// the knocked-down player wakes at the nearest pier
	respawnPlayer() {

		// the death feature respawns the player (PlayerCombat already sent playerDied at the blow when it saw it; a direct
		// call lands here): no pier wake-up then
		if ( this.features?.get?.( 'death' ) ) {

			if ( ! this.combat.deathMode ) {

				const q = this.player.position;
				this.features.emit( 'playerDied', { cause: 'melee', by: this.combat.downBy?.name, x: q.x, y: q.y, z: q.z } );

			}

			return null;

		}

		const p = this.player, pt = this.respawnPoint();
		if ( ! p || ! pt ) return null;
		let y = this.terrain ? this.terrain.heightAt( pt.x, pt.z ) : 0;
		const c = this.colliders;
		if ( c && c.groundHeightAt ) {

			const g = c.groundHeightAt( pt.x, pt.z, y + 4 );
			if ( Number.isFinite( g ) ) y = Math.max( y, g );

		}

		p.position.set( pt.x, y, pt.z );
		if ( p.velocity ) p.velocity.set( 0, 0, 0 );
		p.yaw = pt.yaw;
		if ( typeof p.grounded === 'boolean' ) p.grounded = true;
		// the spring-arm camera starts from the new place instead of sweeping across the island
		if ( 'armInit' in p ) p.armInit = false;
		if ( 'camInit' in p ) p.camInit = false;
		if ( '_camY' in p ) p._camY = null;
		const lost = this.combat.lostCash;
		this.toast( lost > 0 ? `Knocked out · you wake at the pier · lost $${ lost }` : 'Knocked out · you wake at the pier', 3600 );
		return pt;

	}

	loseCash() {

		const f = this.features, st = f && f.state;
		if ( f?.get?.( 'death' ) ) return 0; // the sea chest (death feature) takes the purse
		if ( ! st || ( f.sandbox ) || ! Number.isFinite( st.money ) ) return 0;
		const loss = Math.floor( st.money * PLAYER.cashLoss );
		if ( loss > 0 && st.spend && st.spend( loss ) ) return loss;
		return 0;

	}

	tauntNearby( by ) {

		const p = this.player.position;
		for ( const r of this.list ) if ( r.active && r.visible && ( r.x - p.x ) ** 2 + ( r.z - p.z ) ** 2 < 14 * 14 ) r.taunt();

	}

	// ---- the raiders' hooks

	onAggro( r ) {

		if ( ! this.hintShown ) {

			this.hintShown = true;
			this.hintT = 8;
			this.hintText = '<kbd>LMB</kbd> attack &nbsp;·&nbsp; <kbd>RMB</kbd> guard, raise it as the ring turns gold to parry &nbsp;·&nbsp; <kbd>Q</kbd> evade';

		}

	}

	onWindup( r ) {

		// the tell: a short bright tick the moment the wind-up starts (the amber flash and the ring go with it)
		this.sfx( 'tell', { at: { x: r.x, y: r.y + 1.5, z: r.z }, gain: r.practice ? 0.5 : 0.8 } );
		// the whoosh starts early enough that its peak lands on the contact
		const bank = r.kind === 'captain' ? 'hookSwing' : 'paddleSwing';
		const lead = this.audio && this.audio.lead ? this.audio.lead( bank ) : 0.1;
		const sid = r.strikeCount;
		this.sched.push( {
			t: Math.max( 0, r.cfg.windup - lead ),
			fn: () => {

				if ( r.state === 'windup' && r.strikeCount === sid ) this.sfx( bank, { at: { x: r.x, y: r.y + 1.2, z: r.z }, rate: r.kind === 'captain' ? 0.95 : 0.88, gain: 0.85 } );

			},
		} );
		// a blow is coming at a player who has the rod out: it goes away (unless a fish is on)
		if ( this.autoStow && this.target().valid && ! r.practice ) {

			const p = this.player.position;
			if ( Math.hypot( p.x - r.x, p.z - r.z ) < 6 && ! this.rodStowed() && this.rodAway( false ) ) this.toast( 'Rod away · fight!', 1600 );

		}

	}

	// the raider's blow arrives (end of his wind-up): did it reach the player, and was it blocked / dodged?
	raiderStrike( r ) {

		const c = this.combat, p = this.player.position;
		if ( ! this._target.valid || c.state === 'down' ) return 'missed';
		const d = Math.hypot( p.x - r.x, p.z - r.z );
		if ( d > r.cfg.hitRange ) return 'missed';
		if ( facingDot( r.yaw, r.x, r.z, p.x, p.z ) < r.cfg.cone ) return 'missed';
		if ( ! this.lineOfSight( r.x, r.y + 1.1, r.z, p.x, p.y + 1.1, p.z ) ) return 'missed';
		return c.takeStrike( r );

	}

	onDefeated( r ) {

		const slot = this.slots.find( ( s ) => s.raider === r );
		if ( slot ) slot.respawnLeft = CLOCK.respawnHours;
		if ( r.kind === 'captain' ) this.captain.active = false;
		this.kills ++;
		this.combat.lastKill = r;
		let loot = 0;
		const f = this.features, st = f && f.state;
		if ( st && st.earn && ! f.sandbox ) {

			loot = r.cfg.loot;
			st.earn( loot );

		}

		this.toast( loot > 0 ? `${ r.name } is down · +$${ loot }` : `${ r.name } is down`, 2400 );
		this.emit( 'enemyDefeated', { id: r.spawnId, name: r.name, kind: 'raider', captain: r.kind === 'captain', x: r.x, z: r.z } );
		this.sfx( 'paddleHit', { at: { x: r.x, y: r.y + 0.5, z: r.z }, gain: 1, rate: 0.75 } );

	}

	// ---- slots: who camps, who is back

	_wantSlot( s ) {

		if ( s.when === 'day' ) return true;
		if ( s.when === 'night' ) return this.hour !== null ? isNight( this.hour ) : false;
		return this.captain.active;

	}

	_alive( r ) {

		return !! ( r && r.active && r.state !== 'gone' );

	}

	_character( s ) {

		const mine = this.app.avatar && this.app.avatar.character;
		const other = s.characters.filter( ( c ) => c !== mine ), from = other.length ? other : s.characters;
		return from[ Math.floor( this.rand() * from.length ) % from.length ];

	}

	_name( s ) {

		const pool = s.when === 'captain' ? CAPTAIN_NAMES : RAIDER_NAMES;
		const taken = new Set( this.list.filter( ( r ) => r.active ).map( ( r ) => r.name ) );
		const free = pool.filter( ( n ) => ! taken.has( n ) );
		const from = free.length ? free : pool;
		return from[ Math.floor( this.rand() * from.length ) % from.length ];

	}

	_spawnSlot( s ) {

		let r = s.raider;
		if ( ! r ) {

			const avatar = this.avatarFactory( { scene: this.app.scene, character: this._character( s ), lite: true } );
			r = new Raider( this, s, avatar );
			s.raider = r;
			this.list.push( r );

		}

		r.spawn( { name: this._name( s ) } );
		return r;

	}

	_syncSlots() {

		const p = this.player.position;
		for ( const s of this.slots ) {

			if ( s.respawnLeft > 0 ) continue;
			const r = s.raider, alive = this._alive( r );
			const d2 = ( s.x - p.x ) ** 2 + ( s.z - p.z ) ** 2;
			if ( this._wantSlot( s ) ) {

				// appear only out of sight of the player: never inside the clear radius, never before the camp is near enough to load
				if ( ! alive && d2 > CLOCK.spawnClear ** 2 && d2 < CREATE_D2 && this.enabled ) this._spawnSlot( s );

			} else if ( alive && ! r.busy && d2 > CLOCK.spawnClear ** 2 ) r.deactivate(); // night is over (the captain was beaten elsewhere)

		}

	}

	// ---- the island clock

	_tickClock( dt ) {

		const st = this.app.settings, h = st && typeof st.timeOfDay === 'number' && Number.isFinite( st.timeOfDay ) ? ( ( st.timeOfDay % 24 ) + 24 ) % 24 : null;
		let adv = 0;
		if ( h !== null ) {

			if ( this._lastHour !== null ) {

				adv = hoursForward( this._lastHour, h );
				if ( adv > 0.5 + dt * 0.1 ) adv = 0; // the player set the clock: a jump is not time passing
				const cs = this._captainSlot();
				if ( cs && adv > 0 && crossed( this._lastHour, h, CLOCK.captainRollHour ) && ! this.captain.active && cs.respawnLeft <= 0 && this.rand() < CLOCK.captainChance ) this.captain.active = true;

			}

			if ( adv === 0 && st.timeSpeed === 0 ) adv = dt * CLOCK.realFallback; // a stopped clock: respawns still tick at the 40-minute day's pace
			this._lastHour = h;
			this.hour = h;

		} else adv = dt * CLOCK.realFallback;

		this.hours += adv;
		if ( adv > 0 ) for ( const s of this.slots ) if ( s.respawnLeft > 0 ) s.respawnLeft = Math.max( 0, s.respawnLeft - adv );

	}

	_captainSlot() {

		return this.slots.find( ( s ) => s.when === 'captain' );

	}

	// ---- input: the mouse and Q

	_input( dt = 0 ) {

		const a = this.app, inp = a.input, c = this.combat;
		const can = !! inp && this._canAct();
		const gun = this._gunDrawn(); // (a drawn gun, a throwable or the swivel owns the mouse)
		const lmb = can && ! gun && !! inp.mouseDown, rmb = can && ! gun && !! inp.rightDown;
		const lDown = lmb && ! this._lmb, rDown = rmb && ! this._rmb;
		this._lmb = lmb;
		this._rmb = rmb;
		c.guardHeld = this._guardInput( dt, can, rmb, rDown );
		if ( ! can || ! this.enabled ) return;
		// the left button: a swing when the rod is away and a raider is close (or a swing is already going)
		if ( lDown && this.canSwing() ) c.attackPress();
		const padDodge = this._padDodge() && ( !! this.lock || this.engaged() );
		if ( ( this.keyOk && inp.hit && inp.hit( 'KeyQ' ) ) || padDodge ) {

			const p = this.player, fx = - Math.sin( p.yaw ), fz = - Math.cos( p.yaw ), rx = Math.cos( p.yaw ), rz = - Math.sin( p.yaw );
			let wx = 0, wz = 0;
			if ( inp.down( 'KeyW' ) ) { wx += fx; wz += fz; }
			if ( inp.down( 'KeyS' ) ) { wx -= fx; wz -= fz; }
			if ( inp.down( 'KeyD' ) ) { wx += rx; wz += rz; }
			if ( inp.down( 'KeyA' ) ) { wx -= rx; wz -= rz; }
			c.evadePress( wx, wz, p.yaw );

		}

	}

	// RMB -> the guard wanted this frame (hold or toggle, only near an enemy, the forced drops: see the header)
	_guardInput( dt, can, rmb, rDown ) {

		const inp = this.app.input, c = this.combat;
		const rel = inp && typeof inp.releases === 'number' ? inp.releases : 0;
		const lost = this._guardRel !== undefined && rel !== this._guardRel; // blur / the pointer lock went
		this._guardRel = rel;
		const engaged = this.engaged();
		const ended = this._wasEngaged && ! engaged; // the fight is over
		this._wasEngaged = engaged;
		const reach = can && this.enabled && this._guardReach();
		this._guardFar = reach ? 0 : this._guardFar + dt;
		const toggle = this._guardToggle();
		// wave 12E: held, the stance is always up (no enemy needed: "the guard stance is always visible while RMB is held");
		// the forced drops stay (focus / pointer lock lost, the rod out, knocked down), and a toggled guard still drops after
		// GUARD.idle s with nobody near (it would otherwise stay up forever)
		const forced = lost || ! can || ! this.enabled || ! this.rodStowed() || c.state === 'down' || ( toggle && ( ended || ( this._guardUp && this._guardFar > GUARD.idle ) ) );
		if ( forced ) {

			if ( this._guardUp || lost ) this._guardBlock = rmb;
			this._guardUp = false;

		}

		if ( toggle ) {

			// a press raises it, the next lowers it
			if ( rDown && ! forced ) {

				this._guardUp = ! this._guardUp;
				if ( this._guardUp ) this._guardFar = 0; // the idle drop counts from the click

			}

		} else {

			if ( ! rmb ) this._guardBlock = false;
			this._guardUp = ! forced && rmb && ! this._guardBlock;

		}

		return this._guardUp;

	}

	_guardToggle() {

		const inp = this.app.input, st = this.app.settings;
		return !! ( ( inp && inp.guardToggle ) || ( st && st.guardMode === 'toggle' ) );

	}

	// an enemy or the training post within GUARD.reach, or a raider closing in within GUARD.aggroReach
	_guardReach() {

		if ( ! this.player ) return false;
		return this._raiderWithin( GUARD.reach ) !== null || this._raiderAggro( GUARD.aggroReach );

	}

	// the right bumper (RB) is the evade on a pad while fighting (it is sprint otherwise: a dodge while sprinting is fine)
	_padDodge() {

		const gp = this.app.gamepad;
		let pad = null;
		try { pad = gp && gp._pad ? gp._pad() : null; } catch ( e ) { pad = null; }
		const b = pad && pad.buttons ? pad.buttons[ 5 ] : null;
		const down = !! ( b && ( b.pressed || b.value > 0.5 ) );
		const edge = down && ! this._rb;
		this._rb = down;
		return edge;

	}

	// the soft lock-on: only in a fight (or sparring), on foot with the rod away; the camera eases onto the target
	_updateLock( dt ) {

		const p = this.player;
		const d = this.dummy, sparring = !! ( d && d.sparring && Math.hypot( d.x - p.position.x, d.z - p.position.z ) < LOCK.keepRange );
		if ( ! this.lockOn || ! this.enabled || ! this._canAct() || ! this.rodStowed() || this.combat.state === 'down' || ! ( sparring || this.engaged() ) ) {

			this.lock = null;
			return;

		}

		this.lock = pickLock( { x: p.position.x, z: p.position.z, yaw: p.yaw }, this.targets(), this.lock );
		const st = this.app.settings;
		if ( this.lock && ! ( st && st.lockAssist === false ) && this.combat.state !== 'evade' ) p.yaw = assistYaw( p.yaw, p.position, this.lock, dt );
		// the strafe blend space of the animation graph (wave 4 Avatar.setLocomotion), while locked
		const av = this.app.avatar;
		if ( this.lock && av && typeof av.setLocomotion === 'function' && p.velocity ) {

			const fx = - Math.sin( p.yaw ), fz = - Math.cos( p.yaw ), rx = - fz, rz = fx;
			try { av.setLocomotion( { speed: p.velocity.x * fx + p.velocity.z * fz, strafe: p.velocity.x * rx + p.velocity.z * rz, turn: 0, grounded: p.grounded !== false, combat: true } ); } catch ( e ) { /* the graph is optional */ }

		}

	}

	// ---- per frame

	update( dt ) {

		if ( ! ( dt > 0 ) || ! this.player ) return;
		dt = Math.min( dt, 0.1 );
		const a = this.app;
		this.time += dt;
		if ( ! this._audioReady && a.audio && a.audio.ctx && this.audio.preload ) {

			this._audioReady = true;
			this.audio.preload();

		}

		if ( a.paused ) return;
		this._tickClock( dt );
		const pp = this.player.position;
		this.inPeace = this.zoneOn && inPeace( pp.x, pp.z );
		this._updateTarget();
		if ( this.enabled ) this._syncSlots();
		this._input( dt );
		this._updateLock( dt );
		if ( this.enabled ) this._roles();

		// the fight's own time: a hitstop freezes it, the parry's slow motion runs it at slowK (both counted in real time)
		let sim = dt;
		if ( this.stopT > 0 ) {

			const f = Math.min( this.stopT, sim );
			this.stopT -= f;
			sim -= f;

		}

		if ( this.slowT > 0 ) {

			const f = Math.min( this.slowT, sim );
			this.slowT -= f;
			sim = sim - f + f * this.slowK;

		}

		this.simTime += sim;
		if ( this.tokenGap > 0 ) this.tokenGap -= sim;
		if ( this.practice ) this.practice.update( dt );

		const n = sim > 0 ? Math.max( 1, Math.ceil( sim / FIXED ) ) : 0, h = n ? sim / n : 0;
		const p = this.player.position;
		const env = this._rockEnv || ( this._rockEnv = {
			player: null, ground: ( x, z ) => ( this.terrain ? this.terrain.heightAt( x, z ) : 0 ), hit: ( rk ) => this._rockHit( rk ), land: ( rk ) => this.puff( 'rock', rk ),
		} );
		env.player = this._target.valid ? p : null;
		for ( let i = 0; i < n; i ++ ) {

			if ( this.enabled ) this.combat.update( h );
			for ( const r of this.list ) {

				if ( ! r.active ) continue;
				if ( ! r.busy && ( r.x - p.x ) ** 2 + ( r.z - p.z ) ** 2 > UPDATE_D2 ) continue;
				r.update( h );

			}

			if ( this.rocks.list.length ) this.rocks.update( h, env );
			if ( this.dummy && this.enabled ) this.dummy.update( h );

			for ( let k = this.sched.length - 1; k >= 0; k -- ) {

				const s = this.sched[ k ];
				s.t -= h;
				if ( s.t <= 0 ) {

					this.sched.splice( k, 1 );
					s.fn();

				}

			}

		}

		this._frameFx( dt );

	}

	_frameFx( dt ) {

		const c = this.combat;
		const d = this.dummy, shown = d && ( d.sparring || d.state !== 'idle' ) ? this.targets() : this.list;
		if ( this.fx ) this.fx.update( shown, this.time );
		this._playerFlash( c.hurtFlash );
		if ( this.hintT > 0 ) this.hintT -= dt;
		let hint = this.hintT > 0 ? this.hintText : '';
		if ( ! hint && this.enabled && this.target().valid && ! this.rodStowed() && this._raiderAggro( 12 ) ) hint = 'Press <kbd>R</kbd> to put the rod away and fight';
		if ( this.hud ) {

			const p = this.player.position;
			const calm = this.app.settings && this.app.settings.reduceMotion;
			// the low-health edge pulses (a steady glow with reduce motion)
			const low = c.hp > 0 && c.hp < c.maxHp * PLAYER.lowHp ? ( calm ? 0.2 : 0.16 + 0.16 * Math.sin( this.time * Math.PI * 2 * FEEL.lowPulse ) ) : 0;
			// the health bar only in a fight: engaged, down, or a few seconds after the last blow traded
			this.hud.update( dt, {
				raiders: shown, player: { x: p.x, z: p.z }, hp: c.hp, maxHp: c.maxHp, guarding: c.guarding, hint, lock: this.lock,
				showPlayer: this.engaged() || c.state === 'down' || ( c.sinceCombat < PLAYER.combatLinger && ! ( d && d.sparring && ! this.engaged() && c.hp >= c.maxHp ) ),
				fade: c.fade, hurt: c.hurtFlash * ( calm ? 0.4 : 0.85 ) + low, low: low > 0,
				guardFlash: c.guardFlash, guardKind: c.guardFlashKind, slow: this.slowT > 0,
			} );

		}

	}

	_raiderAggro( range ) {

		const p = this.player.position;
		for ( const r of this.list ) if ( r.inCombat && r.aggro && ( r.x - p.x ) ** 2 + ( r.z - p.z ) ** 2 <= range * range ) return true;
		return false;

	}

	// a red glow on the player's avatar while the hurt flash lasts (the emissive of each material, on top of its own)
	_playerFlash( k ) {

		const av = this.app.avatar, m = av && av.model;
		if ( ! m || ! m.materials ) return;
		if ( k <= 0.003 && ! this._pFlashing ) return;
		this._pFlashing = k > 0.003;
		const a = this._pFlashing ? k : 0;
		for ( const mat of m.materials ) {

			if ( ! mat || ! mat.emissive || typeof mat.emissive.r !== 'number' ) continue;
			let b = this._pBase.get( mat );
			if ( ! b ) { b = [ mat.emissive.r, mat.emissive.g, mat.emissive.b ]; this._pBase.set( mat, b ); }
			try { mat.emissive = [ b[ 0 ] + 0.9 * a, b[ 1 ] + 0.16 * a, b[ 2 ] + 0.1 * a ]; } catch ( e ) { /* keep going */ }

		}

	}

	// ---- save

	toJSON() {

		const slots = {};
		for ( const s of this.slots ) if ( s.respawnLeft > 0 ) slots[ s.id ] = Math.round( s.respawnLeft * 100 ) / 100;
		return { v: 1, hp: Math.round( this.combat.hp ), kills: this.kills, captain: this.captain.active, slots };

	}

	fromJSON( d ) {

		if ( ! d || typeof d !== 'object' ) return;
		if ( Number.isFinite( d.hp ) ) this.combat.hp = clamp( Math.round( d.hp ), 1, this.combat.maxHp );
		if ( Number.isFinite( d.kills ) ) this.kills = Math.max( 0, Math.floor( d.kills ) );
		if ( typeof d.captain === 'boolean' ) this.captain.active = d.captain;
		const saved = d.slots && typeof d.slots === 'object' ? d.slots : {};
		for ( const s of this.slots ) {

			const v = saved[ s.id ];
			s.respawnLeft = Number.isFinite( v ) ? clamp( v, 0, CLOCK.respawnHours ) : 0;
			if ( s.respawnLeft > 0 && s.raider && s.raider.active ) s.raider.deactivate();

		}

	}

	// a new game: everyone is back, the player is whole
	reset() {

		this.kills = 0;
		this.tokens.clear();
		this.lock = null;
		if ( this.dummy ) this.dummy.spar( false );
		this.sched.length = 0;
		this.hours = 0;
		this._lastHour = null;
		this.combat.reset();
		this.captain.active = this.options.captain !== undefined ? !! this.options.captain : this.rand() < CLOCK.captainChance;
		for ( const s of this.slots ) {

			s.respawnLeft = 0;
			if ( s.raider && s.raider.active ) s.raider.deactivate();

		}

		this._lmb = this._rmb = false;
		this._guardUp = this._guardBlock = false;
		this._guardFar = 0;
		this.stopT = this.slowT = 0;
		this.rocks.clear();
		if ( this.practice ) {

			this.practice.stop( 'left' );
			for ( const r of this.practice.partners ) r.deactivate();
			this.practice.leaveT = 0;

		}

	}

	dispose() {

		for ( const r of this.list ) r.dispose();
		this.list.length = 0;
		if ( this.hud ) this.hud.dispose();
		if ( this.fx ) this.fx.dispose();
		if ( this.dummy ) this.dummy.dispose();
		this.rocks.dispose();
		if ( this.practice ) this.practice.dispose();
		for ( const off of this._offs ) if ( typeof off === 'function' ) off();
		this._offs.length = 0;
		this.sched.length = 0;

	}

}

// options (all optional; Features.add passes none, so app.meleeOptions can carry them): enabled, peaceful, autoStow,
// lockPlayer, captain (force the captain roll), seed, slots (a slot camp, e.g. SLOTS), peaceZone (false: no home peace),
// lockOn (false: no soft lock), dummy (false: no training post), plus the test stubs avatarFactory / audio / hud / fx / terrain / colliders
export function install( app, features, options = {} ) {

	return new Melee( app, features, { ...( app && app.meleeOptions ), ...options } );

}

export { PLAYER, RAIDER, CLOCK, SLOTS, TOKENS, TRAINING_POST, THROW, FEEL, PRACTICE };

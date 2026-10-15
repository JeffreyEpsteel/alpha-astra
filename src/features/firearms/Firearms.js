import { Matrix4, Vector3 } from '../../engine/index.js';
import { inPeace } from '../melee/Peace.js';
import { mulberry32 } from '../../util/Noise.js';
import { G } from '../../core/Globals.js';
import { WEAPONS, ORDER, POUCH, HEADSHOT, MAGNET, DEG, SLOT_OF, POSE_OF, LINE, damageAt, spreadRad, spreadDir, forwardOf, maxRange, clamp, angleBetween, barrelsOf, cartridgesFor } from './FirearmsData.js';
import { resolveShot } from './Hitscan.js';
import { GunAudio } from './GunAudio.js';
import { WeaponMesh } from './WeaponMesh.js';
import { GunHud, coneToPx } from './GunHud.js';
import { gunPoses } from './GunPose.js';

// Firearms (wave 9B): a flintlock pistol and a musket bought from Ethena Prosper at the chandlery, fired at raiders, boarding
// crews, pirate decks and breakable props. One ball a load; powder and ball come in cartridge pouches (consumable).
//
//   const fa = features.get( 'firearms' );
//   fa.drawn            a gun is in hand (drawing, ready or reloading): the touch snapshot and Game read it
//   fa.weapon           'pistol' | 'musket' | null (the one in hand)        fa.owned   { pistol, musket }   fa.shots   cartridges
//   fa.loaded           { pistol, musket }: a ball is down the barrel       fa.aiming  RMB held      fa.phase   see below
//   fa.wantsMouse()     true while drawn: Game leaves the left button alone (the rod does not cast)
//   fa.playerAction     'hold' while drawn (the arms' pose: Avatar's upper-body hold over the locomotion), else null
//   fa.cycle()          G: draw the pistol -> the musket (when owned) -> holster.   fa.draw( id ) / fa.holster()
//   fa.fire()           LMB: one hitscan shot (see Hitscan.js) -> the hit or { refused }
//   fa.reload()         R: a cartridge from the pouch, WEAPONS[ id ].reload seconds (holstering stops it, nothing used)
//   fa.buy( 'pistol' | 'musket' | 'pouch' )   fa.shopRows()  HTML rows for Ethena's Gear tab (data-gun buttons)
//   fa.toJSON() / fromJSON( d ) / reset() / dispose()      saved as the feature's part of the save (Features.toJSON)
//
// Phases: 'holstered' -> 'drawing' (WEAPONS.draw s) -> 'ready' <-> 'reloading'. Peace: inside the home island's peaceful zone
// (melee/Peace.js) a shot is only fired when it would hit the training post; anything else: "Not here".
// Damage goes through the target's own takeHit (melee Raider / Dummy: hit reactions, flinch, defeat, loot and enemyDefeated stay
// melee's); a shot during a wind-up interrupts it like a parry (Raider.parried()). Headshots x1.6 (Raider.headPosition).
// Pirate ships: a ball into the deck box kills one of the crew when the ship exposes them (ship.boarding.crewLeft, ship.crew),
// else 2 hull damage (naval's own Ship.damage; a sinking goes through naval._onSunk). Props: destruction.damage / impulse.
// Feel: vfx flash + smoke at the muzzle, a synthesised report (GunAudio), cameraFeel 'recoil', the 'shoot' / 'reload' montages
// (fallback: the 'strike' / 'inspect' clips on the upper body), reload clacks.
// Events: gunFired { weapon, x, y, z, dir, by: 'player' }, gunHit { weapon, kind, x, y, z, target, damage, head, killed },
//   crewShot { id, name, left }, gunBought { id, price }; world event 'gunshot' to the other players (they see and hear it).
// Headless: install( app, features, { audio, mesh: false, rand, seed } ).
//
// Wave 12E (shooting you can feel): GunHud.js draws a crosshair while a gun is drawn (its gap is the cone right now: wider on
// the move and just after a shot, tight while aiming), a hit marker (another on a head shot), a kill confirmation, the
// reload ring and "R to reload" while empty. Aim magnetism: a shot whose aim finds nobody but passes within MAGNET.deg of
// a raider's chest at MAGNET.range m or less snaps onto it. The pistol fires on the move with a small spread penalty
// (moveSpread), the musket slows the walk to x0.7. A kill freezes the fight for a beat (melee.hitstop) with a heavy kick;
// a ball into a thrower's wind-up stops it like a parry; a musket ball knocks an unarmoured raider down (Raider.takeHit).
// The practice raiders at the training post are wooden swords only (no shooting them).
//
// Wave 18D (the arsenal): duelling pistols (two quick shots, both to reload, a cartridge a barrel; the second goes out as
// 'duelling_l' so the universe gate lets it through), a long rifle (x3.2 sight zoom, the scope ring in GunHud), a blunderbuss
// (nine pellets in a wide cone, each hit shoves the man back: Raider.shove), a harpoon gun (a line: a raider is dragged in, a
// small hull hauled closer, a big ship holds it until the line parts, a big fish (app.reef.fish) is hauled in and landed:
// fishHarpooned { species, kg }; R reels it home, no cartridge). fa.drawSlot( 'side' | 'long' ) (weapons' keys 2 / 3) draws
// the next owned gun of that slot. Chandlery rows: the legal guns (WEAPONS[ id ].vendor !== 'blackmarket'); fa.marketRows() /
// fa.marketAction( id ) are the fence's (the blunderbuss). Events: gunHarpoon { kind, target, x, y, z }, lineParted { kind }.

export const AIM = { ease: 10 }; // 1/s: the zoom eases in and out
const RELOAD_CUES = [ [ 0.06, 'half' ], [ 0.24, 'pour' ], [ 0.5, 'ram' ], [ 0.62, 'ram' ], [ 0.9, 'cock' ] ];
const CHEST = 1.35; // m above the feet: where the ball leaves (third person)
const RECOIL_T = 0.35; // s the recoil pose and the after-shot lockout last

export class Firearms {

	constructor( app, features, options = {} ) {

		this.app = app || {};
		this.features = features || null;
		this.options = options;
		this.enabled = options.enabled !== false;
		this.rand = options.rand || mulberry32( options.seed !== undefined ? options.seed : ( Date.now() & 0xffffff ) );
		this.audio = options.audio || new GunAudio( this.app.audio );
		this.mesh = options.mesh === false ? null : this._makeMesh();
		this.owned = Object.fromEntries( ORDER.map( ( id ) => [ id, false ] ) );
		this.loaded = Object.fromEntries( ORDER.map( ( id ) => [ id, false ] ) );
		this.balls = {}; // id -> balls left in a multi-barrel gun (the duelling pair); loaded[ id ] while any is left
		this.line = null; // the harpoon gun's line out: { kind, target, x, y, z, t, fish }
		this.shots = 0;
		this.sel = null; // the weapon drawn last (G draws it again)
		this.phase = 'holstered';
		this.t = 0;
		this.aiming = false;
		this.aimK = 0;
		this.recoil = 0;
		this.after = 0; // s left of the after-shot lockout
		this.sched = [];
		this.stats = { fired: 0, hits: 0, heads: 0, kills: 0, refused: 0 };
		this.last = null; // the last shot's result (tests, debugging)
		this._lmb = false;
		this._fovBase = null;
		this._prev = null; // the player's position last frame (the musket's walking pace)
		this._tips = {};
		this._offs = [];
		this.keyOk = features && features.claimKey ? features.claimKey( 'KeyG', 'firearms' ) : true;
		if ( features && features.on ) this._offs.push( features.on( 'remoteWorldEvent', ( e ) => this._remote( e ) ) );
		this.speed = 0; // m/s over the ground (the walking spread)
		this.marker = null; // the last hit marker: 'hit' | 'head' | 'kill'
		const hudEl = this.app.ui && this.app.ui.ui ? ( this.app.ui.ui.hud || this.app.ui.ui.root ) : ( options.hudElement || null );
		this.hud = options.hud === false ? null : new GunHud( { hud: hudEl, doc: options.doc } );

	}

	_makeMesh() {

		try {

			return this.app.scene ? new WeaponMesh( { scene: this.app.scene } ) : null;

		} catch ( e ) {

			console.warn( 'firearms: no weapon mesh', e );
			return null;

		}

	}

	// ---- public surface

	get drawn() {

		return this.phase === 'drawing' || this.phase === 'ready' || this.phase === 'reloading';

	}

	get weapon() {

		return this.drawn ? this.sel : null;

	}

	get ready() {

		return this.phase === 'ready' && this.after <= 0;

	}

	get playerAction() {

		const p = this.app.player;
		return this.drawn && p && p.mode !== 'swim' && p.mode !== 'boat' ? 'hold' : null;

	}

	wantsMouse() {

		return !! ( this.enabled && this.drawn );

	}

	has( id ) {

		return !! this.owned[ id ];

	}

	anyOwned() {

		return ORDER.some( ( id ) => this.owned[ id ] );

	}

	status() {

		return { phase: this.phase, weapon: this.weapon, owned: { ...this.owned }, loaded: { ...this.loaded }, shots: this.shots, aiming: this.aiming, stats: { ...this.stats } };

	}

	// ---- helpers

	get state() {

		return this.features ? this.features.state : null;

	}

	get sandbox() {

		return !! ( this.features && this.features.sandbox );

	}

	_get( name ) {

		try { return this.features && this.features.get ? this.features.get( name ) : null; } catch ( e ) { return null; }

	}

	toast( text, ms = 2200 ) {

		const g = this.app.game;
		if ( g && g.toast ) g.toast( text, ms );

	}

	_tip( key, text, ms = 3600 ) {

		if ( this._tips[ key ] ) return;
		this._tips[ key ] = true;
		this.toast( text, ms );

	}

	emit( name, payload ) {

		if ( this.features && this.features.emit ) this.features.emit( name, payload );

	}

	// the aim pose this gun borrows ('pistol' | 'musket')
	poseKind( id = this.sel ) {

		return POSE_OF[ id ] || 'pistol';

	}

	// the gun poses built on the local avatar's rig (GunPose.js), or null (a rig without them: the rod-hold overlay carries the arms)
	_poses() {

		const av = this.app.avatar;
		return av && av.model ? gunPoses( av ) : null;

	}

	// the arms while drawn (wave 17B): the aim pose of the drawn gun as an upper-body loop over the locomotion, started again
	// after the fire / reload one-shots and anything else that took the overlay (an emote); dropped when holstered
	_aimPose() {

		const av = this.app.avatar, gp = this._poses();
		const want = this.drawn && gp && this.sel && this.phase !== 'reloading' ? gp.aim[ this.poseKind() ] : null;
		const h = this._aimH;
		if ( h && ( ! want || h.clip !== want ) ) {

			if ( h.handle.playing ) try { h.handle.stop( 0.2 ); } catch ( e ) { /* gone */ }
			this._aimH = null;

		}

		if ( ! want || ( this._aimH && this._aimH.handle.playing ) ) return;
		this._aimH = null;
		const g = av && av.graph;
		if ( g && g.upperBusy ) return; // a one-shot (the shot, the reload, an emote) owns the arms: back after it
		try {

			const handle = av.playMontage( want, { slot: 'upper', loop: true, blendIn: 0.15, blendOut: 0.2 } );
			if ( handle && handle.playing !== false ) this._aimH = { clip: want, handle };

		} catch ( e ) { /* optional */ }

	}

	_montage( name, fallback, opts ) {

		const av = this.app.avatar;
		if ( ! av || typeof av.playMontage !== 'function' ) return null;
		try {

			let h = av.playMontage( name, opts );
			if ( ( ! h || h.playing === false ) && fallback ) h = av.playMontage( fallback, opts );
			return h && h.playing !== false ? ( h.name || name ) : null;

		} catch ( e ) {

			return null;

		}

	}

	_panelOpen() {

		const hud = this.app.game && this.app.game.hud;
		if ( hud && ( hud.invOpen || hud.standOpen || hud.rosterOpen || hud.catchOpen ) ) return true;
		try { return !! ( this.features && this.features.panelOpen && this.features.panelOpen() ); } catch ( e ) { return false; }

	}

	// on foot (land or a deck), nothing modal up, not knocked down
	_canAct() {

		const a = this.app, p = a.player, inp = a.input;
		if ( ! this.enabled || ! p || ( p.mode !== 'walk' && p.mode !== 'deck' ) ) return false;
		if ( a.paused || a.menuOpen || a.freeCam ) return false;
		if ( inp && inp.enabled === false ) return false;
		if ( a.avatar && a.avatar.ragdolling ) return false;
		const m = this._get( 'melee' );
		if ( m && m.playerDown ) return false;
		return ! this._panelOpen();

	}

	// ---- draw / holster

	cycle() {

		if ( ! this.anyOwned() ) {

			this.toast( 'No firearm · Ethena Prosper sells pistols and muskets at the chandlery', 2800 );
			return null;

		}

		if ( ! this.drawn ) return this.draw( this.sel && this.owned[ this.sel ] ? this.sel : ORDER.find( ( id ) => this.owned[ id ] ) );
		const i = ORDER.indexOf( this.sel );
		const next = ORDER.slice( i + 1 ).find( ( id ) => this.owned[ id ] );
		if ( next ) return this.draw( next );
		this.holster();
		return null;

	}

	// keys 2 / 3 (the weapons feature): the next owned gun of that slot ('side' | 'long'), from the one in hand; past the last
	// one of the slot it holsters. null when nothing of that slot is owned
	drawSlot( kind ) {

		const list = ORDER.filter( ( id ) => SLOT_OF[ id ] === kind && this.owned[ id ] );
		if ( ! list.length ) return null;
		if ( ! this.drawn || SLOT_OF[ this.sel ] !== kind ) return this.draw( list.includes( this.sel ) ? this.sel : list[ 0 ] );
		const i = list.indexOf( this.sel );
		if ( i >= 0 && i < list.length - 1 ) return this.draw( list[ i + 1 ] );
		this.holster();
		return 'holstered';

	}

	draw( id ) {

		const w = WEAPONS[ id ];
		if ( ! w || ! this.owned[ id ] ) return null;
		if ( ! this._canAct() ) return null;
		const g = this.app.game, rod = g && g.rod;
		if ( rod && rod.equipped ) {

			if ( g.fight ) {

				this.toast( 'Not with a fish on the line', 1800 );
				return null;

			}

			if ( g.cancelLine ) g.cancelLine( true );
			if ( rod.equip ) rod.equip( false );

		}

		this._stopReload();
		this.sel = id;
		this.phase = 'drawing';
		this.t = 0;
		this.after = 0;
		this.audio.click( 'half', { gain: 0.6 } );
		const load = this.loaded[ id ] ? 'loaded' : w.harpoon ? 'R to reel in' : 'empty · R to load';
		this.toast( w.noAmmo ? `${ w.name } · ${ load }` : `${ w.name } · ${ load } · ${ this.shots } cartridge${ this.shots === 1 ? '' : 's' }`, 2000 );
		this._tip( 'controls', 'LMB fire · RMB aim · R reload · G next gun / holster', 4200 );
		if ( w.scope ) this._tip( 'scope', 'RMB looks down the long sight · hold still for a true shot', 3200 );
		return id;

	}

	holster( silent = false ) {

		if ( ! this.drawn ) return false;
		this._stopReload();
		if ( this.line ) this._lineHome( true );
		this.phase = 'holstered';
		this.t = 0;
		this.aiming = false;
		if ( ! silent ) this.audio.click( 'half', { gain: 0.4 } );
		return true;

	}

	// ---- reload

	reload() {

		if ( ! this.drawn || ! this.sel ) return false;
		const w = WEAPONS[ this.sel ];
		if ( this.phase !== 'ready' ) return false;
		const full = this.loaded[ this.sel ] && ( barrelsOf( w ) <= 1 || ( this.balls[ this.sel ] || 0 ) >= barrelsOf( w ) );
		if ( full ) {

			this._tip( 'loaded', `The ${ w.name.toLowerCase() } is already loaded`, 1600 );
			return false;

		}

		if ( cartridgesFor( w ) > 0 && this.shots <= 0 && ! this.sandbox ) {

			this.toast( 'No cartridges · Ethena Prosper sells pouches at the chandlery', 2600 );
			return false;

		}

		this.phase = 'reloading';
		this.t = 0;
		this.aiming = false;
		this.sched.length = 0;
		for ( const [ f, kind ] of RELOAD_CUES ) this.sched.push( { t: f * w.reload, fn: () => this.audio.click( kind, { gain: 0.7 } ) } );
		// the gun down at the waist and the ramrod (GunPose.js, timed to the reload), else the older shoot / inspect montages
		const gp = this._poses();
		this.lastMontage = gp ? this._montage( gp.reload, 'inspect', { slot: 'upper', rate: 1 / w.reload, blendIn: 0.12, blendOut: 0.2 } ) : this._montage( 'reload', 'inspect', { slot: 'upper', blendIn: 0.12, blendOut: 0.2 } );
		return true;

	}

	_stopReload() {

		if ( this.phase === 'reloading' ) {

			this.phase = 'ready';
			const av = this.app.avatar;
			try { if ( av && av.stopMontage ) av.stopMontage( 'upper', 0.15 ); } catch ( e ) { /* optional */ }

		}

		this.sched.length = 0;

	}

	_finishReload() {

		const id = this.sel, w = WEAPONS[ id ];
		if ( w && w.harpoon ) this._lineHome( true ); // the harpoon reeled home is the load
		// a cartridge a barrel (the pair: both, or what the pouch still holds)
		const want = w ? cartridgesFor( w ) - ( barrelsOf( w ) > 1 ? ( this.balls[ id ] || 0 ) : 0 ) : 1;
		const used = this.sandbox ? want : Math.min( want, this.shots );
		if ( ! this.sandbox ) this.shots = Math.max( 0, this.shots - used );
		if ( w && barrelsOf( w ) > 1 ) this.balls[ id ] = Math.min( barrelsOf( w ), ( this.balls[ id ] || 0 ) + Math.max( 1, used ) );
		this.loaded[ id ] = true;
		this.phase = 'ready';
		this.t = 0;
		this.sched.length = 0;
		if ( this.shots === 0 && ! this.sandbox ) this._tip( 'lastShot', 'That was your last cartridge', 2000 );

	}

	// ---- the shot

	// the aim ray: from the camera along its forward, starting level with the player (nothing between the camera and him counts)
	aimRay() {

		const a = this.app, cam = a.camera, p = a.player;
		if ( ! cam || ! cam.position || ! cam.quaternion || ! p ) return null;
		const o = { x: cam.position.x, y: cam.position.y, z: cam.position.z };
		const d = forwardOf( cam.quaternion );
		const cx = p.position.x - o.x, cy = p.position.y + CHEST - o.y, cz = p.position.z - o.z;
		const tMin = Math.max( 0, cx * d.x + cy * d.y + cz * d.z );
		return { o, d, tMin };

	}

	_ctx() {

		const a = this.app, m = this._get( 'melee' ), nv = this._get( 'naval' ), bd = this._get( 'boarding' );
		const p = a.player && a.player.position;
		let targets = [];
		try { targets = m ? ( m.targets ? m.targets() : m.raiders || [] ) : []; } catch ( e ) { targets = []; }
		const td = a.terrainData || ( a.terrain && a.terrain.heightAt ? a.terrain : null );
		const col = a.colliders;
		return {
			targets,
			ships: nv && Array.isArray( nv.ships ) ? nv.ships : [],
			// the ship under the player's feet (a boarded deck) never stops his own shots
			skipShip: ( s ) => !! ( ( bd && bd.ship === s ) || ( p && s.cls && Math.hypot( s.x - p.x, s.z - p.z ) < ( s.cls.length || 12 ) * 0.5 && Math.abs( p.y - ( ( s.pose && s.pose.y ) || 0 ) - ( s.cls.sheer || 1 ) ) < 2.5 ) ),
			props: this._get( 'destruction' ),
			world: col && col.raycast ? ( o, d, len ) => col.raycast( o, d, len ) : null,
			groundAt: td ? ( x, z ) => td.heightAt( x, z ) : null,
			seaLevel: G.seaLevel && Number.isFinite( G.seaLevel.value ) ? G.seaLevel.value : 0,
		};

	}

	fire() {

		if ( ! this.drawn || ! this.sel ) return { refused: 'holstered' };
		const w = WEAPONS[ this.sel ];
		if ( ! this.ready ) return { refused: this.phase };
		if ( ! this.loaded[ this.sel ] ) {

			this.audio.click( 'dry', { gain: 0.8 } );
			this.toast( w.harpoon ? 'The harpoon is out · R to reel it in' : this.shots > 0 || this.sandbox ? 'Empty · R to reload' : 'Empty · no cartridges left: Ethena Prosper sells pouches', 1800 );
			this.after = 0.25;
			return { refused: 'empty' };

		}

		const ray = this.aimRay();
		if ( ! ray ) return { refused: 'noCamera' };
		const { o, d, tMin } = ray;
		const tMax = tMin + maxRange( w );
		const ctx = this._ctx();
		const p = this.app.player.position;
		const peace = inPeace( p.x, p.z );
		const aimed = resolveShot( ctx, o, d, tMin, tMax );
		// the practice raiders fight with wooden swords: no shooting them, anywhere
		if ( aimed && aimed.kind === 'raider' && aimed.target && aimed.target.practiceFight ) {

			this.stats.refused ++;
			this.toast( 'Wooden swords only · it is a practice fight', 1800 );
			this.after = 0.3;
			return { refused: 'practice' };

		}

		if ( peace && aimed && aimed.kind === 'raider' && aimed.target && aimed.target.kind !== 'dummy' ) {

			// the peaceful home island: a shot at a person who is not a raider or the training post is refused; shots at the
			// water, the sand, props and the post go off as anywhere (user 2026-10-13: "shooting does not work" was this gate)
			this.stats.refused ++;
			this.toast( this._tips.peace ? 'Not here' : 'Not here · the home island is peaceful (the training post is fair game)', 2200 );
			this._tips.peace = true;
			this.after = 0.3;
			return { refused: 'peace' };

		}

		// aim magnetism: the aim finds nobody, but a raider's chest is within MAGNET.deg: the ball goes for him
		let base = d;
		if ( ! ( aimed && aimed.kind === 'raider' ) && ! peace ) {

			const snap = this._magnet( ctx, o, d, tMin );
			if ( snap ) base = snap;

		}

		// one ball, or a fistful (the blunderbuss: every pellet its own draw in the cone; the result is the first that hit)
		const pellets = Math.max( 1, Math.floor( w.pellets || 1 ) );
		const half = this.spreadNow();
		let dir = null, hit = null;
		const res = { weapon: this.sel, dir: null, hit: null, damage: 0, head: false, killed: false, pellets: [] };
		for ( let i = 0; i < pellets; i ++ ) {

			const di = spreadDir( base, half, this.rand(), this.rand() );
			const hi = resolveShot( ctx, o, di, tMin, tMax );
			if ( ! dir || ( hi && ! hit ) ) { dir = di; hit = hi; }
			if ( pellets > 1 ) res.pellets.push( hi ? hi.kind : null );
			if ( ! hi ) continue;
			const r = this._apply( w, hi, hi.t - tMin, ctx );
			if ( ! res.hit || ( hi.kind === 'raider' && res.hit !== 'raider' ) ) { res.hit = hi.kind; res.x = hi.x; res.y = hi.y; res.z = hi.z; }
			res.damage += r.damage;
			res.head = res.head || r.head;
			res.killed = res.killed || r.killed;
			if ( w.harpoon ) this._lineOut( w, hi, r );

		}

		res.dir = dir;
		const fired = this.sel;
		// the duelling pair: the second barrel is still loaded after the first shot (a short beat between them)
		if ( barrelsOf( w ) > 1 ) {

			this.balls[ fired ] = Math.max( 0, ( this.balls[ fired ] ?? barrelsOf( w ) ) - 1 );
			this.loaded[ fired ] = this.balls[ fired ] > 0;

		} else this.loaded[ fired ] = false;
		this.after = barrelsOf( w ) > 1 && this.loaded[ fired ] ? Math.max( w.between || 0.2, 0.05 ) : RECOIL_T;
		this.recoil = 1;
		this.stats.fired ++;
		if ( w.harpoon && ! this.line ) this._lineOut( w, null, null, o, dir, tMin );
		this.magnet = base !== d;
		res.magnet = this.magnet;
		// the pair's second pistol goes out under its own name (the universe gate counts each pistol's reload)
		const wire = barrelsOf( w ) > 1 && ! this.loaded[ fired ] ? WEAPONS[ fired + '_l' ] || w : w;
		this._shotFx( wire, dir, hit, w );
		this.last = res;
		if ( res.hit === 'raider' && res.damage > 0 ) {

			this.marker = res.killed ? 'kill' : res.head ? 'head' : 'hit';
			if ( this.hud ) this.hud.mark( this.marker );
			if ( res.killed ) {

				// a kill: the fight stops for a beat and the camera takes the weight
				const m = this._get( 'melee' );
				try { if ( m && m.hitstop ) m.hitstop( 0.09 ); } catch ( e ) { /* optional */ }
				const cf = this.app.cameraFeel;
				try { if ( cf && cf.kick ) cf.kick( 'meleeHeavy', { scale: 0.7 } ); } catch ( e ) { /* optional */ }

			}

		}

		return res;

	}

	// the cone right now (rad): the weapon's, wider on the move and right after a shot, tighter while aiming
	spreadNow() {

		const w = this.sel ? WEAPONS[ this.sel ] : null;
		if ( ! w ) return 0;
		const p = this.app.player;
		const move = p && p.mode === 'walk' ? clamp( this.speed / 2.7, 0, 1 ) : 0;
		return spreadRad( w, this.aiming, move, this.recoil );

	}

	// the raider whose chest the aim passes closest to, within MAGNET.deg and MAGNET.range (and a clear line): the unit
	// direction to his chest, else null
	_magnet( ctx, o, d, tMin ) {

		let best = null, ba = MAGNET.deg * DEG;
		const to = { x: 0, y: 0, z: 0 };
		for ( const r of ctx.targets || [] ) {

			if ( ! r || ! r.targetable || r.kind === 'dummy' || r.practiceFight ) continue;
			const cx = r.x, cy = r.y + MAGNET.chest * ( r.scale || 1 ), cz = r.z;
			to.x = cx - o.x; to.y = cy - o.y; to.z = cz - o.z;
			const len = Math.hypot( to.x, to.y, to.z );
			if ( len < 1e-3 || len - tMin > MAGNET.range ) continue;
			to.x /= len; to.y /= len; to.z /= len;
			const a = angleBetween( d, to );
			if ( a > ba ) continue;
			// nothing between: the ball along the snapped line must find him first
			const h = resolveShot( ctx, o, to, tMin, len + 1 );
			if ( ! h || h.target !== r ) continue;
			ba = a;
			best = { x: to.x, y: to.y, z: to.z };

		}

		return best;

	}

	// what the ball does where it lands; dist from the player (m)
	_apply( w, hit, dist, ctx ) {

		const vfx = this._get( 'vfx' ), out = { damage: 0, head: false, killed: false };
		const k = damageAt( w, dist ) / w.damage; // 0..1 of the ball's punch left
		const at = { x: hit.x, y: hit.y, z: hit.z };
		switch ( hit.kind ) {

			case 'raider': {

				const r = hit.target;
				const dmg = Math.round( w.damage * k * ( hit.head ? HEADSHOT : 1 ) );
				if ( dmg <= 0 ) break;
				const windup = r.state === 'windup' || r.state === 'throw';
				let rr = null;
				try { rr = r.takeHit( dmg ); } catch ( e ) { rr = null; }
				if ( ! rr ) break;
				// a ball in the middle of his wind-up stops it like a parry would (open for a punish)
				if ( windup && ! rr.killed && r.targetable && typeof r.parried === 'function' ) r.parried();
				// the blunderbuss: the shot shoves him back along the line of fire
				if ( w.knock && ! rr.killed && typeof r.shove === 'function' ) {

					const p = this.app.player && this.app.player.position;
					if ( p ) try { r.shove( r.x - p.x, r.z - p.z, w.knock * k ); } catch ( e ) { /* optional */ }

				}

				out.damage = rr.dealt;
				out.head = !! hit.head;
				out.killed = !! rr.killed;
				this.stats.hits ++;
				if ( out.head ) this.stats.heads ++;
				if ( out.killed ) this.stats.kills ++;
				const m = this._get( 'melee' );
				if ( m && m.pop ) {

					let hp = null;
					try { hp = r.headPosition ? r.headPosition( new Vector3() ) : null; } catch ( e ) { hp = null; }
					if ( ! hp ) hp = new Vector3( r.x, r.y + 1.8, r.z );
					try { m.pop( out.head ? `HEADSHOT ${ rr.dealt }` : String( rr.dealt ), hp, out.head || rr.punish ? 'punish' : 'dmg' ); } catch ( e ) { /* the HUD is optional */ }

				}

				if ( vfx && vfx.dust ) vfx.dust( at.x, at.y, at.z, 0.08 );
				this.emit( 'gunHit', { weapon: w.id, kind: 'raider', ...at, target: r.spawnId || r.id, damage: rr.dealt, head: out.head, killed: out.killed } );
				break;

			}

			case 'ship': {

				const s = hit.target;
				if ( vfx && vfx.splinters ) vfx.splinters( at.x, at.y, at.z, 0.15 + 0.15 * k );
				if ( hit.part === 'deck' && s.faction === 'pirate' && k > 0 ) {

					const b = s.boarding;
					let left = null;
					if ( b && b.crewLeft > 0 ) left = b.crewLeft = b.crewLeft - 1;
					else if ( Number.isFinite( s.crew ) && s.crew > 0 ) left = s.crew = s.crew - 1;
					if ( left !== null ) {

						out.killed = true;
						this.stats.kills ++;
						this.toast( left > 0 ? `A pirate on the ${ s.name } goes down · ${ left } left aboard` : `The last of the ${ s.name }'s crew goes down`, 2200 );
						this.emit( 'crewShot', { id: s.id, name: s.name, left } );

					} else {

						out.damage = 2;
						let sunk = false;
						try { sunk = s.damage( 2, { part: 'hull', by: 'player' } ); } catch ( e ) { sunk = false; }
						const nv = this._get( 'naval' );
						if ( sunk && nv && typeof nv._onSunk === 'function' ) nv._onSunk( s, true );

					}

					this.stats.hits ++;

				}

				this.emit( 'gunHit', { weapon: w.id, kind: 'ship', part: hit.part, ...at, target: s.id, damage: out.damage, killed: out.killed } );
				break;

			}

			case 'prop': {

				const d = ctx.props, e = w.energy * k;
				if ( d && e > 0 ) {

					try {

						if ( typeof d.damage === 'function' && hit.target ) d.damage( hit.target, e, at, 'player' );
						else if ( d.impulse ) d.impulse( at.x, at.y, at.z, 0.4, e );

					} catch ( err ) { /* the props are optional */ }

				}

				this.emit( 'gunHit', { weapon: w.id, kind: 'prop', ...at, target: hit.target, damage: 0 } );
				break;

			}

			case 'water':
				if ( vfx && vfx.splash ) vfx.splash( at.x, at.y, at.z, 0.1 );
				this.emit( 'gunHit', { weapon: w.id, kind: 'water', ...at } );
				break;

			default: // the ground, a wall, a rock
				if ( vfx ) {

					if ( vfx.dust ) vfx.dust( at.x, at.y, at.z, 0.12 );
					else if ( vfx.debris ) vfx.debris( at.x, at.y, at.z, 0.15, 'dirt' );

				}

				this.emit( 'gunHit', { weapon: w.id, kind: hit.kind, ...at } );

		}

		return out;

	}

	// the muzzle: from the gun in the hand, else in front of the chest
	muzzle( dir ) {

		const m = this.mesh && this.mesh.muzzle ? this.mesh.muzzle( {} ) : null;
		if ( m ) return m;
		const p = this.app.player.position;
		return { x: p.x + dir.x * 0.6, y: p.y + CHEST + dir.y * 0.6, z: p.z + dir.z * 0.6 };

	}

	// w: the gun as the wire names it (the pair's second pistol: duelling_l); feel: the gun in hand (its montage, its kick)
	_shotFx( w, dir, hit, feel = w ) {

		const mz = this.muzzle( dir ), vfx = this._get( 'vfx' );
		if ( vfx ) {

			if ( vfx.flash ) vfx.flash( mz.x, mz.y, mz.z, w.flash, dir.x, dir.y, dir.z );
			if ( vfx.smoke ) vfx.smoke( mz.x, mz.y, mz.z, w.smoke, dir.x, dir.y, dir.z );

		}

		this.audio.report( w.report, { gain: 1 } );
		const cf = this.app.cameraFeel;
		if ( cf && cf.kick ) try { cf.kick( 'recoil', { scale: w.kick } ); } catch ( e ) { /* optional */ }
		const gp = this._poses();
		this.lastMontage = gp ? this._montage( gp.fire[ this.poseKind( feel.id ) ] || gp.fire.pistol, 'strike', { slot: 'upper', blendIn: 0.03, blendOut: 0.1 } ) : this._montage( 'shoot', 'strike', { slot: 'upper', rate: 1.6, blendIn: 0.03, blendOut: 0.2 } );
		this.emit( 'gunFired', { weapon: feel.id, x: mz.x, y: mz.y, z: mz.z, dir: { x: dir.x, y: dir.y, z: dir.z }, by: 'player' } );
		const ns = this.app.netsync;
		const r2 = ( v ) => Math.round( v * 100 ) / 100;
		try {

			if ( ns && ns.sendWorldEvent ) ns.sendWorldEvent( 'gunshot', { weapon: w.id, x: r2( mz.x ), y: r2( mz.y ), z: r2( mz.z ), dx: r2( dir.x ), dy: r2( dir.y ), dz: r2( dir.z ), hit: hit ? { kind: hit.kind, x: r2( hit.x ), y: r2( hit.y ), z: r2( hit.z ) } : null } );

		} catch ( e ) { /* single player */ }

	}

	// another player's shot: the flash, the smoke, the report where it was fired, the splash or dust where it landed
	_remote( e ) {

		if ( ! e || e.kind !== 'gunshot' || e.replay || ! e.data ) return;
		const d = e.data, w = WEAPONS[ d.weapon ] || WEAPONS.pistol, vfx = this._get( 'vfx' );
		if ( ! [ d.x, d.y, d.z ].every( Number.isFinite ) ) return;
		if ( vfx ) {

			if ( vfx.flash ) vfx.flash( d.x, d.y, d.z, w.flash, d.dx || 0, d.dy || 0, d.dz || 0 );
			if ( vfx.smoke ) vfx.smoke( d.x, d.y, d.z, w.smoke, d.dx || 0, d.dy || 0, d.dz || 0 );
			const h = d.hit;
			if ( h && [ h.x, h.y, h.z ].every( Number.isFinite ) ) {

				if ( h.kind === 'water' && vfx.splash ) vfx.splash( h.x, h.y, h.z, 0.1 );
				else if ( h.kind === 'ship' && vfx.splinters ) vfx.splinters( h.x, h.y, h.z, 0.2 );
				else if ( vfx.dust ) vfx.dust( h.x, h.y, h.z, 0.1 );

			}

		}

		this.audio.report( w.report, { at: { x: d.x, y: d.y, z: d.z } } );

	}

	// ---- the harpoon gun's line

	// the harpoon went out: what it struck takes the line (hit: the resolved shot or null, a miss: it flies to the line's reach)
	_lineOut( w, hit, r, o = null, dir = null, tMin = 0 ) {

		const p = this.app.player && this.app.player.position;
		if ( ! p ) return;
		if ( ! hit ) {

			const reach = Math.min( LINE.reach, maxRange( w ) ) + tMin;
			this.line = { kind: 'miss', target: null, x: o.x + dir.x * reach, y: o.y + dir.y * reach, z: o.z + dir.z * reach, t: 0 };
			return;

		}

		const L = { kind: hit.kind, target: hit.target || null, x: hit.x, y: hit.y, z: hit.z, t: 0, fish: null };
		if ( hit.kind === 'raider' && ( ! r || r.killed || ! hit.target || hit.target.kind === 'dummy' ) ) L.kind = 'stuck';
		if ( hit.kind === 'water' ) {

			const f = this._bigFishNear( hit.x, hit.y, hit.z, 3 );
			if ( f ) { L.kind = 'fish'; L.fish = f; }

		}

		if ( hit.kind === 'ship' && hit.target && hit.target.cls && hit.target.cls.length > LINE.shipMax ) L.kind = 'holdShip';
		this.line = L;
		this.emit( 'gunHarpoon', { kind: L.kind, target: L.target && ( L.target.spawnId || L.target.id ) || null, x: L.x, y: L.y, z: L.z } );

	}

	// the nearest big fish (app.reef.fish: FishSchools, length >= LINE.bigFish m) within r m of a point: { schools, i, kg, species }
	_bigFishNear( x, y, z, r ) {

		const fs = this.app.reef && this.app.reef.fish;
		if ( ! fs || ! fs.pos || ! fs.size || ! Array.isArray( fs.groups ) ) return null;
		let best = null, bd = r * r;
		for ( const g of fs.groups ) {

			if ( ! g || ! g.sp || ! g.active ) continue;
			for ( let i = g.offset; i < g.offset + g.count; i ++ ) {

				if ( fs.size[ i ] < LINE.bigFish ) continue;
				const dx = fs.pos[ i * 3 ] - x, dy = fs.pos[ i * 3 + 1 ] - y, dz = fs.pos[ i * 3 + 2 ] - z;
				const d2 = dx * dx + dy * dy * 0.25 + dz * dz;
				if ( d2 < bd ) { bd = d2; best = { schools: fs, i, group: g, species: g.sp.model, kg: Math.round( 12 * fs.size[ i ] ** 3 * 10 ) / 10 }; }

			}

		}

		return best;

	}

	// the line comes home (reloading reels it in; holstering lets it go)
	_lineHome( silent = false ) {

		const L = this.line;
		this.line = null;
		if ( L && ! silent ) this.audio.click( 'ram', { gain: 0.5 } );

	}

	// per frame while the line is out: haul what it holds toward the player, land a fish, part on a big ship or a long pull
	_lineUpdate( dt ) {

		const L = this.line, p = this.app.player && this.app.player.position;
		if ( ! L || ! p ) return;
		L.t += dt;
		const toward = ( x, z ) => { const dx = p.x - x, dz = p.z - z, d = Math.hypot( dx, dz ) || 1; return { x: dx / d, z: dz / d, d }; };
		switch ( L.kind ) {

			case 'raider': {

				const r = L.target;
				if ( ! r || ! r.targetable ) { L.kind = 'stuck'; break; }
				const u = toward( r.x, r.z );
				if ( u.d < 1.8 || L.t > 0.7 ) { L.kind = 'stuck'; break; }
				if ( typeof r.shove === 'function' ) try { r.shove( u.x, u.z, LINE.raiderPull * dt / 0.6 ); } catch ( e ) { /* optional */ }
				L.x = r.x; L.z = r.z;
				break;

			}

			case 'ship': {

				const s = L.target;
				if ( ! s || s.alive === false ) { this._part( 'ship' ); break; }
				const u = toward( s.x, s.z );
				if ( u.d < ( s.cls ? s.cls.length * 0.5 + 3 : 6 ) || L.t > LINE.hold * 2 ) { L.kind = 'stuck'; break; }
				const step = LINE.shipHaul * dt;
				if ( typeof s.shift === 'function' ) s.shift( u.x * step, u.z * step );
				L.x += u.x * step; L.z += u.z * step;
				break;

			}

			case 'holdShip':
				if ( L.t > LINE.hold ) this._part( 'ship' );
				else if ( L.target ) { L.x = L.target.x; L.z = L.target.z; }
				break;

			case 'fish': {

				const f = L.fish, P = f.schools.pos, i = f.i;
				const u = toward( P[ i * 3 ], P[ i * 3 + 2 ] );
				const step = Math.min( u.d, LINE.haul * dt );
				P[ i * 3 ] += u.x * step;
				P[ i * 3 + 2 ] += u.z * step;
				L.x = P[ i * 3 ]; L.y = P[ i * 3 + 1 ]; L.z = P[ i * 3 + 2 ];
				if ( u.d < 3 ) {

					// landed: the fish is yours (the game adds it to the cooler on fishHarpooned); it swims back to its school's home
					this.toast( `Harpooned a ${ f.species } · ${ f.kg } kg`, 2600 );
					this.emit( 'fishHarpooned', { species: f.species, kg: f.kg, x: L.x, z: L.z } );
					const g = f.group;
					if ( g && g.home ) { P[ i * 3 ] = g.home.x; P[ i * 3 + 2 ] = g.home.z; }
					L.kind = 'stuck';
					this.stats.fish = ( this.stats.fish || 0 ) + 1;

				} else if ( L.t > 12 ) this._part( 'fish' );
				break;

			}

			default: // stuck in a prop / the ground / a beaten man, or a miss: it waits for R to reel it home
				break;

		}

	}

	_part( kind ) {

		this.line = { ...( this.line || {} ), kind: 'parted' };
		this.toast( kind === 'fish' ? 'The fish tore free' : 'The line parts', 1800 );
		this.emit( 'lineParted', { kind } );
		this.audio.click( 'dry', { gain: 0.8 } );

	}

	// ---- the shop (Ethena Prosper's Gear tab)

	price( id ) {

		return id === 'pouch' ? POUCH.price : WEAPONS[ id ] && ! WEAPONS[ id ].hidden ? WEAPONS[ id ].price : null;

	}

	buy( id ) {

		const st = this.state, free = !! ( st && st.free );
		const price = this.price( id );
		if ( price === null ) return { ok: false, why: 'unknown' };
		if ( id !== 'pouch' && this.owned[ id ] ) return { ok: false, why: 'owned' };
		if ( id === 'pouch' && this.shots >= POUCH.max ) {

			this.toast( 'Your pouch is full', 1600 );
			return { ok: false, why: 'full' };

		}

		if ( ! free ) {

			if ( ! st || ! st.spend || ! st.spend( price ) ) {

				this.toast( 'Not enough money', 1600 );
				return { ok: false, why: 'money' };

			}

		}

		if ( id === 'pouch' ) {

			this.shots = Math.min( POUCH.max, this.shots + POUCH.count );
			this.toast( `${ POUCH.count } cartridges · ${ this.shots } in the pouch`, 1800 );

		} else {

			this.owned[ id ] = true;
			this.loaded[ id ] = true; // sold loaded
			if ( barrelsOf( WEAPONS[ id ] ) > 1 ) this.balls[ id ] = barrelsOf( WEAPONS[ id ] );
			if ( ! this.sel ) this.sel = id;
			this.toast( `Bought the ${ WEAPONS[ id ].name.toLowerCase() } · G to draw it${ this.shots || this.sandbox ? '' : ' · it needs cartridges too' }`, 3200 );

		}

		this.emit( 'gunBought', { id, price: free ? 0 : price } );
		try { if ( st && st.save ) st.save(); } catch ( e ) { /* saved later */ }
		return { ok: true };

	}

	// the chandlery rows (HudPanels renderShop, Gear tab): data-gun="pistol" | "musket" | "pouch" buttons call buy( id )
	shopRows() {

		const st = this.state || {}, free = !! st.free, money = Number.isFinite( st.money ) ? st.money : 0;
		const btn = ( id, label ) => `<button class="gm-btn" data-gun="${ id }" ${ ! free && this.price( id ) > money ? 'disabled' : '' }>${ free ? 'Free' : label }</button>`;
		let html = '';
		for ( const id of ORDER ) {

			const w = WEAPONS[ id ];
			if ( w.vendor === 'blackmarket' ) continue; // the fence's (marketRows)
			const act = this.owned[ id ] ? '<span class="gm-have">Owned</span>' : btn( id, `$${ w.price }` );
			html += `<div class="gm-shop-row"><span>${ w.name }<small>${ w.desc }</small></span>${ act }</div>`;

		}

		const full = this.shots >= POUCH.max;
		html += `<div class="gm-shop-row"><span>${ POUCH.name } · ${ POUCH.count }<small>Powder and ball, one per load · you carry ${ this.shots }</small></span>${ full ? '<span class="gm-have">Full</span>' : btn( 'pouch', `$${ POUCH.price }` ) }</div>`;
		return html;

	}

	// the fence's rows on Blackwater (Stronghold.marketRows appends them): { id: 'gun:<id>', label, price, ok, why }
	marketRows( trade = { ok: true } ) {

		const st = this.state || {}, free = !! st.free, money = Number.isFinite( st.money ) ? st.money : 0;
		const rows = [];
		for ( const id of ORDER ) {

			const w = WEAPONS[ id ];
			if ( w.vendor !== 'blackmarket' ) continue;
			const owned = !! this.owned[ id ];
			const ok = !! ( trade && trade.ok ) && ! owned && ( free || money >= w.price );
			rows.push( { id: 'gun:' + id, label: w.name, price: free ? 0 : w.price, ok, why: owned ? 'owned' : trade && ! trade.ok ? trade.reason || trade.why || 'unwelcome' : ok ? null : 'money' } );

		}

		return rows;

	}

	marketAction( rowId ) {

		if ( typeof rowId !== 'string' || ! rowId.startsWith( 'gun:' ) ) return { ok: false, reason: 'unknown' };
		const id = rowId.slice( 4 );
		if ( ! WEAPONS[ id ] || WEAPONS[ id ].vendor !== 'blackmarket' ) return { ok: false, reason: 'unknown' };
		return this.buy( id );

	}

	// ---- per frame (after the player, the camera feel and the game)

	update( dt ) {

		if ( ! ( dt > 0 ) ) return;
		dt = Math.min( dt, 0.1 );
		const a = this.app;
		if ( a.paused ) return;
		this._autoHolster();
		this._input( dt );
		if ( this.after > 0 ) this.after = Math.max( 0, this.after - dt );
		this.recoil = Math.max( 0, this.recoil - dt / RECOIL_T );
		this.t += dt;
		const w = this.sel ? WEAPONS[ this.sel ] : null;
		if ( this.phase === 'drawing' && w && this.t >= w.draw ) {

			this.phase = 'ready';
			this.t = 0;

		}

		if ( this.phase === 'reloading' && w ) {

			for ( let k = this.sched.length - 1; k >= 0; k -- ) {

				const s = this.sched[ k ];
				if ( this.t >= s.t ) {

					this.sched.splice( k, 1 );
					s.fn();

				}

			}

			if ( this.t >= w.reload ) this._finishReload();

		}

		if ( this.line ) this._lineUpdate( dt );
		this._pace( w, dt );
		this._zoom( dt, w );
		this._aimPose();
		this._placeMesh();
		this._hud( dt, w );

	}

	// the crosshair, the markers, the reload ring and the empty cue (GunHud)
	_hud( dt, w ) {

		if ( ! this.hud ) return;
		const cam = this.app.camera, h = this.hud.root && this.hud.root.clientHeight ? this.hud.root.clientHeight : ( typeof window !== 'undefined' ? window.innerHeight : 720 );
		const drawn = this.drawn && !! w && this._canAct();
		this.hud.update( dt, {
			drawn, aiming: this.aiming, scope: !! ( w && w.scope && this.aimK > 0.5 ), gap: drawn ? 3 + coneToPx( this.spreadNow(), cam && cam.fov, h ) : 0,
			reload: this.phase === 'reloading' && w ? this.t / w.reload : - 1,
			empty: drawn && this.phase === 'ready' && ! this.loaded[ this.sel ], noShots: this.shots <= 0 && ! this.sandbox,
		} );

	}

	// leave the gun in its holster when the player can no longer hold it (swimming, at the helm, the rod out, knocked down)
	_autoHolster() {

		if ( ! this.drawn ) return;
		const a = this.app, p = a.player, rod = a.game && a.game.rod;
		const m = this._get( 'melee' );
		if ( ! p || ( p.mode !== 'walk' && p.mode !== 'deck' ) || ( rod && rod.equipped ) || a.freeCam || ( m && m.playerDown ) || ( a.avatar && a.avatar.ragdolling ) ) this.holster( true );

	}

	_input() {

		const inp = this.app.input;
		const can = !! inp && this._canAct();
		const lmb = can && !! inp.mouseDown;
		const lDown = lmb && ! this._lmb;
		this._lmb = lmb;
		this.aiming = !! ( can && this.drawn && this.phase !== 'reloading' && inp.rightDown );
		if ( ! can ) return;
		if ( this.keyOk && inp.hit && inp.hit( 'KeyG' ) ) this.cycle();
		if ( ! this.drawn ) return;
		if ( inp.hit && inp.hit( 'KeyR' ) ) this.reload();
		if ( lDown ) this.fire();

	}

	// the musket shouldered: the walk is a little slower (the part of this frame's step past the factor is taken back)
	_pace( w, dt = 0 ) {

		const p = this.app.player;
		if ( ! p || ! p.position ) return;
		const q = p.position;
		const prev = this._prev;
		// the pace over the ground (the walking spread), smoothed a little
		if ( prev && dt > 0 ) {

			const v = Math.hypot( q.x - prev.x, q.z - prev.z ) / dt;
			this.speed += ( ( v < 30 ? v : 0 ) - this.speed ) * Math.min( 1, dt * 12 );

		}
		if ( prev && this.drawn && w && w.walk < 1 && p.mode === 'walk' && p.grounded !== false && ! ( p.launched > 0 ) ) {

			const dx = q.x - prev.x, dz = q.z - prev.z;
			if ( dx * dx + dz * dz < 1 ) {

				q.x -= dx * ( 1 - w.walk );
				q.z -= dz * ( 1 - w.walk );

			}

		}

		this._prev = { x: q.x, y: q.y, z: q.z };

	}

	// RMB: a 1.3x zoom through the camera's fov, eased; the camera feel's own kicks stay on top; restored on release
	_zoom( dt, w ) {

		const cam = this.app.camera;
		const want = this.aiming && w ? 1 : 0;
		this.aimK += ( want - this.aimK ) * ( 1 - Math.exp( - dt * AIM.ease ) );
		if ( Math.abs( this.aimK - want ) < 0.002 ) this.aimK = want;
		if ( ! cam || ! Number.isFinite( cam.fov ) || typeof cam.updateProjectionMatrix !== 'function' ) return;
		const cf = this.app.cameraFeel, ui = this.app.ui;
		const kick = cf && Number.isFinite( cf.fovKick ) ? cf.fovKick : 0;
		const slider = ui && ui.s && Number.isFinite( ui.s.fov ) ? ui.s.fov : null;
		if ( this.aimK > 0 ) {

			if ( this._fovBase === null ) this._fovBase = slider ?? ( cf && cf.baseFov ? cf.baseFov() : cam.fov - kick );
			const base = slider ?? this._fovBase;
			const zoom = 1 + ( ( w ? w.zoom : 1.3 ) - 1 ) * this.aimK;
			cam.fov = base / zoom + kick;
			cam.updateProjectionMatrix();

		} else if ( this._fovBase !== null ) {

			cam.fov = ( slider ?? this._fovBase ) + kick;
			cam.updateProjectionMatrix();
			this._fovBase = null;

		}

	}

	_placeMesh() {

		if ( ! this.mesh ) return;
		const av = this.app.avatar;
		let anchor = null;
		if ( av && av.visible !== false && av.handMatrix ) {

			if ( ! this._handM ) this._handM = new Matrix4();
			try { anchor = av.handMatrix( this._handM ); } catch ( e ) { anchor = null; }

		}

		// with the gun poses the barrel sits straight ahead in the aim (GunPose hold), else the rod-hold pitch (WeaponMesh.HOLD)
		const gp = anchor ? this._poses() : null;
		this.mesh.update( { kind: this.sel, visible: this.drawn, anchor, camera: this.app.camera, recoil: this.recoil, hold: gp && this.sel ? gp.hold[ this.poseKind() ] : null, line: this.drawn ? this.line : null } );

	}

	// ---- save

	toJSON() {

		const balls = {};
		for ( const id in this.balls ) if ( this.owned[ id ] && this.balls[ id ] > 0 ) balls[ id ] = this.balls[ id ];
		return { v: 1, owned: ORDER.filter( ( id ) => this.owned[ id ] ), loaded: ORDER.filter( ( id ) => this.loaded[ id ] ), shots: this.shots, sel: this.sel, balls };

	}

	fromJSON( d ) {

		if ( ! d || typeof d !== 'object' ) return;
		const ids = ( list ) => new Set( Array.isArray( list ) ? list.filter( ( id ) => WEAPONS[ id ] ) : [] );
		const own = ids( d.owned ), ld = ids( d.loaded );
		for ( const id of ORDER ) {

			this.owned[ id ] = own.has( id );
			this.loaded[ id ] = own.has( id ) && ld.has( id );

		}

		this.balls = {};
		for ( const id of ORDER ) {

			const n = barrelsOf( WEAPONS[ id ] );
			if ( n > 1 && this.loaded[ id ] ) this.balls[ id ] = d.balls && Number.isFinite( d.balls[ id ] ) ? clamp( Math.floor( d.balls[ id ] ), 1, n ) : n;

		}

		this.line = null;
		this.shots = Number.isFinite( d.shots ) ? clamp( Math.floor( d.shots ), 0, POUCH.max ) : 0;
		this.sel = WEAPONS[ d.sel ] && this.owned[ d.sel ] ? d.sel : ORDER.find( ( id ) => this.owned[ id ] ) || null;
		this.holster( true );

	}

	reset() {

		this.holster( true );
		for ( const id of ORDER ) { this.owned[ id ] = false; this.loaded[ id ] = false; }
		this.balls = {};
		this.line = null;
		this.shots = 0;
		this.sel = null;
		this.aimK = 0;
		this.recoil = 0;
		this.after = 0;
		this._tips = {};
		this.stats = { fired: 0, hits: 0, heads: 0, kills: 0, refused: 0 };

	}

	dispose() {

		this.holster( true );
		this.aimK = 0;
		this._zoom( 1, null );
		if ( this.hud ) this.hud.dispose();
		if ( this.mesh ) this.mesh.dispose();
		this.mesh = null;
		for ( const off of this._offs ) if ( typeof off === 'function' ) off();
		this._offs.length = 0;

	}

}

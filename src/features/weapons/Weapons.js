import { Matrix4, Quaternion, Vector3 } from '../../engine/index.js';
import { loadGLB } from '../../engine/loaders/GLTF.js';
import { G } from '../../core/Globals.js';
import { mulberry32 } from '../../util/Noise.js';
import { inPeace } from '../melee/Peace.js';
import { forwardOf } from '../firearms/FirearmsData.js';
import { hitShip } from '../firearms/Hitscan.js';
import { gunPoses } from '../firearms/GunPose.js';
import { rotateByQuat } from '../naval/Ballistics.js';
import {
	MELEE, MELEE_ORDER, THROWN, THROWN_ORDER, SHOT, SHOT_ORDER, SLOTS, CYCLE_KEY, RAIDER_ARMS,
	GRAVITY, throwVelocity, arcPoints, blastFactor, clamp,
} from './WeaponsData.js';
import { ModelBank, RADIUS } from './WeaponModels.js';
import { weaponPoses, WEAPON_CLIPS, ATTACK_OF, HOLD_OF, THROW_RELEASE, ALT_ATTACK } from './WeaponPose.js';
import { WeaponAudio } from './WeaponAudio.js';
import { Props, ArcPreview } from './WeaponVisuals.js';

// The arsenal (wave 18D): the melee weapons beyond the paddle, the throwables, the swivel gun from the deck and the cannon shot
// kinds, with the quick slots that tie them to the firearms feature.
//
//   const w = features.get( 'weapons' );
//   w.melee        the melee weapon carried (MELEE: paddle, cutlass, axe, pin, harpoon); melee's swing reads w.meleeStats()
//   w.hand         what is in the hand: 'melee' | 'thrown' | 'swivel' | null (a drawn gun is the firearms feature's)
//   w.thrown       { bomb, firebottle, smoke } counts       w.thrownSel   the one keys 4 / the touch button put in hand
//   w.shot         { chain, grape } rounds                 w.shotSel     'round' | 'chain' | 'grape' (the player's guns)
//   w.slot( kind ) keys 1-4: 'melee' (cycles the owned melee weapons, draws it), 'side' / 'long' (firearms.drawSlot), 'thrown'
//                  (cycles the throwables you carry; on your own deck with a swivel gun: man the swivel first)
//   w.cycle()      the touch Weapon button / key 0: the next of everything you own
//   w.throwNow()   LMB with a throwable in hand: it leaves the hand THROW_RELEASE s into the Wpn_Throw montage
//   w.fireSwivel() LMB at the swivel: naval.fire( the side you look at ) (naval's own powder and shot)
//   w.hidden( x, z )  inside a smoke pot's cloud (melee: the raiders lose the player there)
//   w.ownsMouse()  the left button is ours (a throwable or the swivel in hand): melee does not swing, the rod does not cast
//   w.buy( id ) / w.shopRows() (Ethena Prosper's Gear tab: data-wpn buttons) / w.marketRows( trade ) / w.marketAction( 'wpn:<id>' )
//   w.update( dt ) / toJSON() / fromJSON( d ) / reset() / dispose()
//
// Throwables fly the WeaponsData arc (gravity, the ground, the sea, props, ships, people) with the arc previewed while in hand:
//   bomb        fuse THROWN.bomb.fuse s from the throw, bounces and rolls; the blast: 'explosion' { x, y, z, radius, energy, by }
//               (destruction breaks props, vfx draws it), raiders inside take damage x blastFactor and are thrown down,
//               hulls inside take THROWN.bomb.hull, the thrower too if he stands in it. In the sea the fuse drowns.
//   firebottle  shatters where it lands: a fire pool (vfx.fire) that burns whoever stands in it; on a deck it sets the ship
//               alight (naval.igniteShip, else its Fire through naval's internals: see the report)
//   smoke       a cloud for THROWN.smoke.time s: hidden( x, z ) inside it
//   harpoon     the melee harpoon thrown (key 4 lists it when owned): damage on what it strikes, then the line pulls it home
//               over MELEE.harpoon.throw.pull s (the paddle is in hand meanwhile)
// Chain / grape shot: keys 1-3 at the helm pick round / chain / grape; each player's ball (cannonFired by 'player') takes one
//   of the chosen kind from the stock; when it strikes a ship (cannonballImpact) chain tears sails and mast (Ship.damage parts
//   'sails' / 'mast'), grape sweeps the crew (ship.boarding.crewLeft / ship.crew). All through naval's public Ship API.
// Raiders: Raider.weapon ('cutlass' | 'blunderbuss', WeaponsData.raiderLoadout) is drawn in their hand (the Props), the
//   gunmen's aim pose built on their rig (GunPose).
// Events: weaponBought { id, price }, thrown { kind, x, y, z }, blast { x, y, z, radius, by }, fireStarted (naval's, on a deck),
//   shotChosen { kind }, crewShot { id, name, left }; world event 'thrown' { kind, ev: 'blast' | 'fire' | 'smoke' | 'splash', x, y, z }
//   (the other players see and hear it; props are synced by destruction's own propDestroyed).

const CHEST = 1.35;
const SUBSTEP = 0.25; // m a projectile moves per collision test
const FIRE_TICK = 0.5; // s between a fire pool's burns
const SMOKE_PUFF = 0.3; // s between a cloud's puffs
const _m = new Matrix4(), _r = new Matrix4(), _q = new Quaternion(), _v = new Vector3();

export class Weapons {

	constructor( app, features, options = {} ) {

		this.app = app || {};
		this.features = features || null;
		this.options = options;
		this.enabled = options.enabled !== false;
		this.rand = options.rand || mulberry32( options.seed !== undefined ? options.seed : ( Date.now() & 0xffffff ) );
		this.audio = options.audio || new WeaponAudio( this.app.audio );
		this.bank = options.mesh === false ? null : new ModelBank( { loader: options.glb === false ? null : loadGLB } );
		const scene = options.mesh === false ? null : this.app.scene || null;
		this.props = new Props( { scene, bank: this.bank } );
		this.arc = new ArcPreview( { scene } );
		this._initState();
		this._offs = [];
		this._tips = {};
		this._lmb = false;
		this.keys = {};
		if ( features && features.claimKey ) {

			// 1-4 are the emotes' only while their row is open (they check it first): the slots stand down then (see _input)
			this.keys.cycle = features.claimKey( CYCLE_KEY, 'weapons' );

		} else this.keys.cycle = true;
		if ( features && features.on ) {

			this._offs.push( features.on( 'cannonFired', ( e ) => this._onCannon( e ) ) );
			this._offs.push( features.on( 'cannonballImpact', ( e ) => this._onImpact( e ) ) );
			this._offs.push( features.on( 'remoteWorldEvent', ( e ) => this._remote( e ) ) );

		}

	}

	_initState() {

		this.owned = Object.fromEntries( MELEE_ORDER.map( ( id ) => [ id, id === 'paddle' ] ) );
		this.melee = 'paddle';
		this.hand = null;
		this.thrown = Object.fromEntries( THROWN_ORDER.map( ( id ) => [ id, 0 ] ) );
		this.thrownSel = null; // 'bomb' | 'firebottle' | 'smoke' | 'harpoon'
		this.shot = { chain: 0, grape: 0 };
		this.shotSel = 'round';
		this.flying = []; // projectiles
		this.fires = []; // fire pools
		this.clouds = []; // smoke clouds
		this.pending = null; // a throw between the press and the release
		this.harpoonOut = null; // the thrown harpoon (its projectile) until it is home
		this.shotQueue = []; // the kinds of the player's balls in flight
		this.stats = { thrown: 0, blasts: 0, fires: 0, smokes: 0, blastHits: 0, chainHits: 0, grapeHits: 0, swivel: 0 };
		this._seq = 0;
		this._holdH = null;

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

	_send( kind, data ) {

		const ns = this.app.netsync;
		try { if ( ns && ns.sendWorldEvent ) ns.sendWorldEvent( kind, data ); } catch ( e ) { /* single player */ }

	}

	_gun() {

		return this._get( 'firearms' );

	}

	_gunDrawn() {

		const fa = this._gun();
		return !! ( fa && fa.drawn );

	}

	_panelOpen() {

		const hud = this.app.game && this.app.game.hud;
		if ( hud && ( hud.invOpen || hud.standOpen || hud.rosterOpen || hud.catchOpen ) ) return true;
		try { return !! ( this.features && this.features.panelOpen && this.features.panelOpen() ); } catch ( e ) { return false; }

	}

	// on foot (land or a deck), nothing modal, not knocked down
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

	_poses() {

		const av = this.app.avatar;
		return av && av.model ? weaponPoses( av ) : null;

	}

	_stowRod() {

		const g = this.app.game, rod = g && g.rod;
		if ( ! rod || ! rod.equipped ) return true;
		if ( g.fight ) { this.toast( 'Not with a fish on the line', 1800 ); return false; }
		if ( g.cancelLine ) g.cancelLine( true );
		if ( rod.equip ) rod.equip( false );
		return true;

	}

	// ---- public surface

	ownsMouse() {

		return !! ( this.enabled && ( this.hand === 'thrown' || this.hand === 'swivel' ) && this._canAct() );

	}

	wantsMouse() {

		return this.ownsMouse();

	}

	// the melee weapon for PlayerCombat's swing (null: the paddle, PLAYER's own numbers)
	meleeStats() {

		if ( this._gunDrawn() ) return null;
		const id = this.meleeNow();
		if ( id === 'paddle' ) return null;
		const w = MELEE[ id ];
		const posed = !! this._poses();
		return { ...w, montage: posed ? ATTACK_OF[ id ] : 'swing', chain: posed ? ALT_ATTACK[ id ] || null : null, slot: 'upper', rate: 1 };

	}

	// the melee weapon in hand now (the harpoon is out on its line: the paddle meanwhile)
	meleeNow() {

		return this.melee === 'harpoon' && this.harpoonOut ? 'paddle' : this.melee;

	}

	hidden( x, z ) {

		for ( const c of this.clouds ) {

			const r = THROWN.smoke.radius * Math.min( 1, 0.4 + c.t / 2 );
			if ( c.t < c.time && ( x - c.x ) ** 2 + ( z - c.z ) ** 2 < r * r ) return true;

		}

		return false;

	}

	// what slot 4 offers: the throwables you carry, the harpoon when it is yours and home
	throwables() {

		const out = THROWN_ORDER.filter( ( id ) => this.thrown[ id ] > 0 );
		if ( this.owned.harpoon && ! this.harpoonOut ) out.push( 'harpoon' );
		return out;

	}

	// your own deck with a swivel gun: the slot 4 / the touch button mans it
	canSwivel() {

		const p = this.app.player, nv = this._get( 'naval' );
		return !! ( p && p.mode === 'deck' && nv && nv.active !== false && nv.playerGun && nv.playerGun.owned && this.app.boatCtl && this.app.boatCtl.position && ! ( nv.playerHull && nv.playerHull.sunk ) );

	}

	// ---- the slots

	slot( kind ) {

		if ( ! this._canAct() ) return null;
		switch ( kind ) {

			case 'melee': {

				const fa = this._gun();
				if ( fa && fa.drawn ) fa.holster();
				const list = MELEE_ORDER.filter( ( id ) => this.owned[ id ] && ! ( id === 'harpoon' && this.harpoonOut ) );
				if ( this.hand === 'melee' ) {

					const i = list.indexOf( this.melee );
					if ( i >= 0 && i < list.length - 1 ) this.melee = list[ i + 1 ];
					else { this.hand = null; this.toast( 'Weapon away', 900 ); return 'away'; }

				} else if ( ! list.includes( this.melee ) ) this.melee = list[ 0 ] || 'paddle';
				if ( ! this._stowRod() ) return null;
				this.hand = 'melee';
				this.audio.whoosh( 0.2 );
				this.toast( MELEE[ this.melee ].name, 1100 );
				this._tip( 'melee', 'LMB strike · RMB guard · 1 next weapon / put it away', 3400 );
				return this.melee;

			}

			case 'side':
			case 'long': {

				const fa = this._gun();
				const r = fa && fa.drawSlot ? fa.drawSlot( kind ) : null;
				if ( r === null ) {

					this.toast( kind === 'side' ? 'No sidearm · Ethena Prosper sells pistols' : 'No long gun · Ethena Prosper sells muskets and rifles', 2200 );
					return null;

				}

				if ( r !== 'holstered' ) this.hand = null;
				return r;

			}

			case 'thrown': {

				const fa = this._gun();
				// on your own deck: the swivel gun first, then the throwables
				if ( this.canSwivel() && this.hand !== 'swivel' && this.hand !== 'thrown' ) {

					if ( fa && fa.drawn ) fa.holster();
					this.hand = 'swivel';
					this.toast( 'The swivel gun · LMB fires the side you look at', 2000 );
					return 'swivel';

				}

				const list = this.throwables();
				if ( ! list.length ) {

					if ( this.hand === 'swivel' ) { this.hand = null; return 'away'; }
					this.toast( 'Nothing to throw · smoke pots at the chandlery, powder bombs at Blackwater', 2400 );
					return null;

				}

				if ( this.hand === 'thrown' ) {

					const i = list.indexOf( this.thrownSel );
					if ( i >= 0 && i < list.length - 1 ) this.thrownSel = list[ i + 1 ];
					else { this.hand = null; return 'away'; }

				} else this.thrownSel = list.includes( this.thrownSel ) ? this.thrownSel : list[ 0 ];
				if ( fa && fa.drawn ) fa.holster();
				if ( ! this._stowRod() ) return null;
				this.hand = 'thrown';
				const name = this.thrownSel === 'harpoon' ? 'Harpoon (thrown)' : THROWN[ this.thrownSel ].name;
				this.toast( this.thrownSel === 'harpoon' ? name : `${ name } · ${ this.thrown[ this.thrownSel ] } left`, 1300 );
				this._tip( 'throw', 'Aim with the view · the dots show the arc · LMB throws · 4 next / away', 3600 );
				return this.thrownSel;

			}

			default:
				return null;

		}

	}

	// the touch Weapon button / key 0: the next of everything owned (melee -> guns -> throwables -> empty hands)
	cycle() {

		const fa = this._gun();
		const order = [];
		for ( const id of MELEE_ORDER ) if ( this.owned[ id ] ) order.push( [ 'melee', id ] );
		if ( fa ) for ( const id of ( fa.constructor && fa.owned ? Object.keys( fa.owned ) : [] ) ) if ( fa.owned[ id ] ) order.push( [ 'gun', id ] );
		if ( this.canSwivel() ) order.push( [ 'swivel', 'swivel' ] );
		for ( const id of this.throwables() ) order.push( [ 'thrown', id ] );
		const cur = fa && fa.drawn ? [ 'gun', fa.sel ] : this.hand === 'melee' ? [ 'melee', this.melee ] : this.hand === 'thrown' ? [ 'thrown', this.thrownSel ] : this.hand === 'swivel' ? [ 'swivel', 'swivel' ] : null;
		const i = cur ? order.findIndex( ( o ) => o[ 0 ] === cur[ 0 ] && o[ 1 ] === cur[ 1 ] ) : - 1;
		const next = order[ i + 1 ] || null;
		if ( ! this._canAct() ) return null;
		if ( fa && fa.drawn && ( ! next || next[ 0 ] !== 'gun' ) ) fa.holster();
		if ( ! next ) { this.hand = null; this.toast( 'Empty hands', 900 ); return 'away'; }
		if ( ! this._stowRod() ) return null;
		switch ( next[ 0 ] ) {

			case 'melee': this.melee = next[ 1 ]; this.hand = 'melee'; this.toast( MELEE[ next[ 1 ] ].name, 1100 ); break;
			case 'gun': this.hand = null; fa.draw( next[ 1 ] ); break;
			case 'swivel': this.hand = 'swivel'; this.toast( 'The swivel gun', 1200 ); break;
			default: this.thrownSel = next[ 1 ]; this.hand = 'thrown'; this.toast( next[ 1 ] === 'harpoon' ? 'Harpoon (thrown)' : THROWN[ next[ 1 ] ].name, 1100 );

		}

		return next[ 1 ];

	}

	// ---- throwing

	// where a throw leaves the hand and where it goes: { from, vel, speed } (the camera's look, lofted)
	aimThrow( kind = this.thrownSel ) {

		const a = this.app, cam = a.camera, p = a.player;
		if ( ! cam || ! cam.quaternion || ! p ) return null;
		const d = forwardOf( cam.quaternion );
		const harpoon = kind === 'harpoon';
		const speed = harpoon ? MELEE.harpoon.throw.speed : ( THROWN[ kind ] ? THROWN[ kind ].speed : 12 );
		const from = this._handPoint() || { x: p.position.x + d.x * 0.4, y: p.position.y + CHEST + 0.2, z: p.position.z + d.z * 0.4 };
		const vel = throwVelocity( d, speed, harpoon ? 0.08 : undefined );
		return { from, vel, speed };

	}

	_handPoint() {

		const av = this.app.avatar;
		if ( ! av || av.visible === false || ! av.handMatrix ) return null;
		try { if ( ! av.handMatrix( _m ) ) return null; } catch ( e ) { return null; }
		return { x: _m.elements[ 12 ], y: _m.elements[ 13 ], z: _m.elements[ 14 ] };

	}

	_groundAt() {

		const td = this.app.terrainData || ( this.app.terrain && this.app.terrain.heightAt ? this.app.terrain : null );
		return td ? ( x, z ) => td.heightAt( x, z ) : null;

	}

	get seaLevel() {

		return G.seaLevel && Number.isFinite( G.seaLevel.value ) ? G.seaLevel.value : 0;

	}

	throwNow() {

		if ( this.hand !== 'thrown' || ! this.thrownSel || this.pending ) return { refused: this.pending ? 'busy' : 'empty' };
		const kind = this.thrownSel;
		if ( kind !== 'harpoon' && ! ( this.thrown[ kind ] > 0 ) ) return { refused: 'none' };
		if ( kind === 'harpoon' && ( this.harpoonOut || ! this.owned.harpoon ) ) return { refused: 'out' };
		const p = this.app.player;
		if ( kind === 'harpoon' && p && typeof p.stamina === 'number' ) {

			if ( p.stamina < MELEE.harpoon.throw.stamina ) { this.toast( 'Too tired', 900 ); return { refused: 'tired' }; }
			p.stamina -= MELEE.harpoon.throw.stamina;

		}

		const wp = this._poses(), av = this.app.avatar;
		if ( wp && av && av.playMontage ) {

			try { av.playMontage( kind === 'harpoon' ? WEAPON_CLIPS.throwHarpoon : WEAPON_CLIPS.throw, { slot: 'upper', blendIn: 0.06, blendOut: 0.2 } ); } catch ( e ) { /* optional */ }

		}

		this.pending = { kind, t: 0 };
		this.audio.whoosh( kind === 'harpoon' ? 0.8 : 0.5 );
		return { kind };

	}

	// the release: the projectile leaves along the aim of this instant
	_release( kind ) {

		const aim = this.aimThrow( kind );
		if ( ! aim ) return null;
		if ( kind !== 'harpoon' && ! this.sandbox ) this.thrown[ kind ] = Math.max( 0, this.thrown[ kind ] - 1 );
		const pr = {
			id: 'w' + ( ++ this._seq ), kind, x: aim.from.x, y: aim.from.y, z: aim.from.z, vx: aim.vel.x, vy: aim.vel.y, vz: aim.vel.z,
			t: 0, rest: false, done: false, fuse: kind === 'bomb' ? THROWN.bomb.fuse : Infinity, ship: null, local: null, stuck: null,
			spin: 0, home: 0,
		};
		this.flying.push( pr );
		this.stats.thrown ++;
		if ( kind === 'harpoon' ) this.harpoonOut = pr;
		if ( kind === 'bomb' ) this.audio.hiss( aim.from, 0.6 );
		this.emit( 'thrown', { kind, x: pr.x, y: pr.y, z: pr.z } );
		// the hand is empty of that kind: the next one, or nothing
		if ( kind === 'harpoon' || ! ( this.thrown[ kind ] > 0 ) ) {

			const list = this.throwables();
			if ( list.length && kind !== 'harpoon' ) this.thrownSel = list[ 0 ];
			else this.hand = null;

		}

		return pr;

	}

	// one projectile's flight for dt: gravity, then what it meets along the step
	_fly( pr, dt ) {

		const ground = this._groundAt(), sea = this.seaLevel;
		if ( pr.stuck ) return this._stuck( pr, dt );
		if ( pr.rest ) {

			// a bomb or a pot rolling to a stop
			const k = Math.exp( - dt * 6 );
			pr.vx *= k; pr.vz *= k;
			pr.x += pr.vx * dt; pr.z += pr.vz * dt;
			const g = ground ? ground( pr.x, pr.z ) : - Infinity;
			pr.y = Math.max( Number.isFinite( g ) ? g : - Infinity, sea ) + ( RADIUS[ pr.kind ] || 0.05 );
			if ( Number.isFinite( g ) && g < sea ) this._water( pr );
			return;

		}

		const sp = Math.hypot( pr.vx, pr.vy, pr.vz );
		const n = Math.max( 1, Math.ceil( sp * dt / SUBSTEP ) ), h = dt / n;
		for ( let i = 0; i < n && ! pr.done && ! pr.rest && ! pr.stuck; i ++ ) {

			const ax = pr.x, ay = pr.y, az = pr.z;
			pr.vy -= GRAVITY * h;
			const bx = ax + pr.vx * h, by = ay + pr.vy * h, bz = az + pr.vz * h;
			const hit = this._sweep( pr, ax, ay, az, bx, by, bz );
			if ( hit ) { this._contact( pr, hit ); continue; }
			pr.x = bx; pr.y = by; pr.z = bz;
			const g = ground ? ground( bx, bz ) : - Infinity;
			const r = RADIUS[ pr.kind ] || 0.05;
			if ( by - r <= sea && ( ! Number.isFinite( g ) || g < sea ) ) { pr.y = sea; this._water( pr ); return; }
			if ( Number.isFinite( g ) && by - r <= g ) { pr.y = g + r; this._contact( pr, { kind: 'ground', x: bx, y: g, z: bz, nx: 0, ny: 1, nz: 0 } ); }

		}

	}

	// the first thing along a step: a raider, a ship, a prop, a wall ( { kind, target, x, y, z, nx, ny, nz } | null )
	_sweep( pr, ax, ay, az, bx, by, bz ) {

		const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot( dx, dy, dz );
		if ( len < 1e-6 ) return null;
		const d = { x: dx / len, y: dy / len, z: dz / len }, o = { x: ax, y: ay, z: az };
		let best = null;
		const take = ( t, h ) => { if ( t >= 0 && t <= len && ( ! best || t < best.t ) ) best = { t, ...h }; };
		// people: only what shatters or stabs stops on them (a bomb bounces off at his feet)
		if ( pr.kind === 'firebottle' || pr.kind === 'harpoon' ) {

			const m = this._get( 'melee' );
			let list = [];
			try { list = m ? ( m.targets ? m.targets() : m.raiders || [] ) : []; } catch ( e ) { list = []; }
			for ( const r of list ) {

				if ( ! r || ! r.targetable ) continue;
				const s = r.scale || 1, cx = r.x - ax, cy = r.y + 0.9 * s - ay, cz = r.z - az;
				const t = cx * d.x + cy * d.y + cz * d.z;
				if ( t < - 0.5 || t > len + 0.5 ) continue;
				const px = cx - d.x * t, py = ( cy - d.y * t ) / 1.6, pz = cz - d.z * t;
				if ( px * px + py * py + pz * pz < ( 0.4 * s ) ** 2 ) take( Math.max( 0, t ), { kind: 'raider', target: r } );

			}

		}

		const nv = this._get( 'naval' );
		if ( nv && Array.isArray( nv.ships ) ) {

			for ( const s of nv.ships ) {

				const h = hitShip( s, o, d, 0, len );
				if ( h ) take( h.t, { kind: 'ship', target: s, part: h.part } );

			}

		}

		const props = this._get( 'destruction' );
		if ( props && props.raycastSegment ) {

			try {

				const h = props.raycastSegment( ax, ay, az, bx, by, bz );
				if ( h && Number.isFinite( h.t ) ) take( h.t * len, { kind: 'prop', target: h.id } );

			} catch ( e ) { /* no props */ }

		}

		const col = this.app.colliders;
		if ( col && col.raycast ) {

			try {

				const dist = col.raycast( _v.set( ax, ay, az ), new Vector3( d.x, d.y, d.z ), len );
				if ( Number.isFinite( dist ) && dist > 0.02 && dist < len - 1e-3 ) take( dist, { kind: 'wall' } );

			} catch ( e ) { /* no colliders */ }

		}

		if ( ! best ) return null;
		best.x = ax + d.x * best.t; best.y = ay + d.y * best.t; best.z = az + d.z * best.t;
		best.dir = d;
		return best;

	}

	_contact( pr, hit ) {

		const k = pr.kind;
		pr.x = hit.x; pr.y = Math.max( hit.y, pr.y ); pr.z = hit.z;
		if ( k === 'firebottle' ) return this._shatter( pr, hit );
		if ( k === 'harpoon' ) return this._harpoonHit( pr, hit );
		// a bomb on a deck rides the ship until it goes off; on the ground / a prop / a wall it bounces, then rolls
		if ( hit.kind === 'ship' && k === 'bomb' ) {

			pr.stuck = { ship: hit.target, local: this._shipLocal( hit.target, hit ) };
			this.audio.thud( hit );
			return;

		}

		const b = THROWN[ k ] ? THROWN[ k ].bounce : 0.3;
		if ( hit.kind === 'ground' ) {

			if ( pr.vy < 0 ) pr.vy = - pr.vy * b;
			pr.vx *= 0.35; pr.vz *= 0.35; // (the ground takes most of the way: it stops near the preview's ring)
			if ( Math.abs( pr.vy ) < 1.2 ) { pr.rest = true; pr.vy = 0; }

		} else {

			// off a wall / a prop / a man: back the way it came, slowed
			pr.vx *= - b; pr.vz *= - b; pr.vy *= b;
			pr.x -= hit.dir.x * 0.1; pr.z -= hit.dir.z * 0.1;

		}

		if ( k === 'bomb' && ! pr.thudded ) { pr.thudded = true; this.audio.thud( hit ); }
		// a smoke pot comes alight where it first lands
		if ( k === 'smoke' && ! pr.lit ) this._smoke( pr );

	}

	_water( pr ) {

		const vfx = this._get( 'vfx' );
		try { if ( vfx && vfx.splash ) vfx.splash( pr.x, this.seaLevel, pr.z, pr.kind === 'harpoon' ? 0.12 : 0.15 ); } catch ( e ) { /* optional */ }
		if ( pr.kind === 'harpoon' ) {

			pr.stuck = { water: true };
			pr.y = this.seaLevel;
			return;

		}

		// the sea puts the fuse / the flame / the pot out
		pr.done = true;
		this._send( 'thrown', { kind: pr.kind, ev: 'splash', x: r2( pr.x ), y: r2( this.seaLevel ), z: r2( pr.z ) } );
		if ( pr.kind === 'bomb' ) this._tip( 'wetFuse', 'The sea drowned the fuse', 1600 );

	}

	_stuck( pr, dt ) {

		const s = pr.stuck;
		if ( s.ship && s.local ) {

			const sh = s.ship;
			const c = Math.cos( sh.yaw ), sn = Math.sin( sh.yaw );
			pr.x = sh.x + s.local.x * c + s.local.z * sn;
			pr.z = sh.z - s.local.x * sn + s.local.z * c;
			pr.y = ( sh.pose ? sh.pose.y : 0 ) + s.local.y;

		} else if ( s.raider && s.raider.active ) {

			pr.x = s.raider.x; pr.z = s.raider.z; pr.y = s.raider.y + 1;

		}

		// the harpoon: the line pulls it home after a beat
		if ( pr.kind === 'harpoon' ) {

			pr.home += dt;
			if ( pr.home >= MELEE.harpoon.throw.pull ) this._harpoonHome( pr );

		}

	}

	// a world point in a ship's frame (as naval's Ship.toWorld inverse)
	_shipLocal( s, p ) {

		const dx = p.x - s.x, dz = p.z - s.z, sn = Math.sin( s.yaw ), cs = Math.cos( s.yaw );
		return { x: dx * cs - dz * sn, y: p.y - ( s.pose ? s.pose.y : 0 ), z: dx * sn + dz * cs };

	}

	// ---- the bomb

	_blast( pr ) {

		const B = THROWN.bomb, at = { x: pr.x, y: pr.y, z: pr.z };
		pr.done = true;
		this.stats.blasts ++;
		this.audio.blast( at, 1 );
		const cf = this.app.cameraFeel, p = this.app.player && this.app.player.position;
		const dp = p ? Math.hypot( p.x - at.x, p.y + 1 - at.y, p.z - at.z ) : Infinity;
		try { if ( cf && cf.kick && dp < 30 ) cf.kick( 'meleeHeavy', { scale: clamp( 1.4 - dp / 20, 0.2, 1.4 ) } ); } catch ( e ) { /* optional */ }
		// destruction breaks the props in reach and vfx draws it from this event
		this.emit( 'explosion', { x: at.x, y: at.y, z: at.z, radius: B.radius, energy: B.energy, by: 'player' } );
		this.emit( 'blast', { x: at.x, y: at.y, z: at.z, radius: B.radius, by: 'player' } );
		this._send( 'thrown', { kind: 'bomb', ev: 'blast', x: r2( at.x ), y: r2( at.y ), z: r2( at.z ) } );
		const vfx = this._get( 'vfx' );
		try { if ( vfx && vfx.explosion && ! this.features ) vfx.explosion( at.x, at.y, at.z, 1, 'dirt' ); } catch ( e ) { /* optional */ }
		const peace = inPeace( at.x, at.z );
		// the people in reach
		const m = this._get( 'melee' );
		let list = [];
		try { list = m ? ( m.targets ? m.targets() : m.raiders || [] ) : []; } catch ( e ) { list = []; }
		for ( const r of list ) {

			if ( ! r || ! r.targetable || r.kind === 'dummy' || r.practiceFight ) continue;
			if ( peace && ! r.inCombat ) continue; // (the home waters: nobody but a raider who came looking for it)
			const d = Math.hypot( r.x - at.x, r.y + 0.9 - at.y, r.z - at.z );
			const k = blastFactor( d, B.radius );
			if ( k <= 0 ) continue;
			let res = null;
			try { res = r.takeHit( Math.round( B.damage * k ), { guardBreak: true } ); } catch ( e ) { res = null; }
			if ( ! res ) continue;
			this.stats.blastHits ++;
			if ( ! res.killed ) {

				if ( typeof r.shove === 'function' ) r.shove( r.x - at.x, r.z - at.z, 2.5 * k );
				if ( k > 0.4 && typeof r.knockDown === 'function' && ! ( r.cfg && r.cfg.armored ) ) r.knockDown();

			}

			try { if ( m.pop ) m.pop( String( res.dealt ), { x: r.x, y: r.y + 1.9, z: r.z }, 'punish' ); } catch ( e ) { /* the HUD is optional */ }

		}

		// hulls in reach (a bomb on a deck: the full charge)
		const nv = this._get( 'naval' );
		if ( nv && Array.isArray( nv.ships ) ) {

			for ( const s of nv.ships ) {

				if ( ! s || s.alive === false ) continue;
				const half = s.cls ? Math.max( s.cls.length, s.cls.beam ) / 2 : 6;
				const d = Math.max( 0, Math.hypot( s.x - at.x, s.z - at.z ) - half * 0.6 );
				const k = pr.stuck && pr.stuck.ship === s ? 1 : blastFactor( d, B.radius );
				if ( k <= 0 ) continue;
				let sunk = false;
				try { sunk = s.damage( B.hull * k, { part: 'hull', by: 'player' } ); } catch ( e ) { sunk = false; }
				if ( sunk && typeof nv._onSunk === 'function' ) nv._onSunk( s, true );

			}

		}

		// the thrower too, if he stands in it
		if ( p && dp < B.radius ) this._hurtPlayer( Math.round( B.damage * 0.6 * blastFactor( dp, B.radius ) ), 'Your own powder bomb', at );

	}

	_hurtPlayer( dmg, name, at ) {

		const m = this._get( 'melee' ), c = m && m.combat;
		if ( ! c || ! ( dmg > 0 ) || c.state === 'down' ) return;
		try { c._damage( { name, kind: 'blast', spawnId: null, cfg: { damage: dmg }, x: at.x, z: at.z }, dmg, 'hit' ); } catch ( e ) { /* optional */ }

	}

	// ---- the fire bottle

	_shatter( pr, hit ) {

		pr.done = true;
		const at = { x: hit.x, y: hit.y, z: hit.z };
		this.audio.shatter( at );
		if ( hit.kind === 'ship' && hit.target ) {

			// a deck: the ship is alight
			const s = hit.target, nv = this._get( 'naval' );
			let lit = false;
			try {

				if ( nv && typeof nv.igniteShip === 'function' ) lit = !! nv.igniteShip( s, at, 'firebottle' );
				else if ( nv && typeof nv._igniteShip === 'function' ) lit = !! nv._igniteShip( s, this._shipLocal( s, at ), 'firebottle' );
				else if ( s.fire && s.fire.ignite ) lit = !! s.fire.ignite( this._shipLocal( s, at ) );

			} catch ( e ) { lit = false; }

			if ( lit ) { this.toast( `The ${ s.name || 'ship' } is alight`, 2000 ); this.stats.fires ++; }
			this._send( 'thrown', { kind: 'firebottle', ev: 'fire', x: r2( at.x ), y: r2( at.y ), z: r2( at.z ) } );
			return;

		}

		const id = 'wfire-' + pr.id;
		const y = hit.kind === 'ground' ? hit.y : at.y;
		this.fires.push( { id, x: at.x, y, z: at.z, t: 0, tick: 0, time: THROWN.firebottle.time } );
		this.emit( 'firePool', { id, x: at.x, y, z: at.z, by: 'player' } ); // (citywreck: the building it splashed is alight)
		this.stats.fires ++;
		const vfx = this._get( 'vfx' );
		try { if ( vfx && vfx.fire ) vfx.fire( id, at.x, y, at.z, 0.6 ); } catch ( e ) { /* optional */ }
		// the raider it struck is splashed with it
		if ( hit.kind === 'raider' && hit.target && ! hit.target.practiceFight ) try { hit.target.takeHit( THROWN.firebottle.burn, {} ); } catch ( e ) { /* gone */ }
		this._send( 'thrown', { kind: 'firebottle', ev: 'fire', x: r2( at.x ), y: r2( y ), z: r2( at.z ) } );

	}

	_burnTick( f ) {

		const F = THROWN.firebottle, m = this._get( 'melee' );
		let list = [];
		try { list = m ? m.raiders || [] : []; } catch ( e ) { list = []; }
		for ( const r of list ) {

			if ( ! r || ! r.targetable || r.practiceFight ) continue;
			if ( ( r.x - f.x ) ** 2 + ( r.z - f.z ) ** 2 > F.radius * F.radius ) continue;
			try { r.takeHit( Math.round( F.burn * FIRE_TICK ), {} ); } catch ( e ) { /* gone */ }

		}

		const p = this.app.player && this.app.player.position;
		if ( p && ( p.x - f.x ) ** 2 + ( p.z - f.z ) ** 2 < F.radius * F.radius ) this._hurtPlayer( Math.round( F.burn * FIRE_TICK * 0.5 ), 'The fire', f );
		const d = this._get( 'destruction' );
		try { if ( d && d.impulse ) d.impulse( f.x, f.y + 0.4, f.z, F.radius * 0.6, 300 ); } catch ( e ) { /* optional */ }

	}

	// ---- the smoke pot

	_smoke( pr ) {

		pr.lit = true;
		this.clouds.push( { x: pr.x, y: pr.y, z: pr.z, t: 0, puff: 0, time: THROWN.smoke.time, pot: pr } );
		this.stats.smokes ++;
		this.audio.hiss( pr, 1.2 );
		this._send( 'thrown', { kind: 'smoke', ev: 'smoke', x: r2( pr.x ), y: r2( pr.y ), z: r2( pr.z ) } );

	}

	// ---- the thrown harpoon

	_harpoonHit( pr, hit ) {

		const H = MELEE.harpoon.throw;
		this.audio.thud( hit );
		const vfx = this._get( 'vfx' );
		switch ( hit.kind ) {

			case 'raider': {

				const r = hit.target;
				if ( r.practiceFight || ( inPeace( r.x, r.z ) && r.kind !== 'dummy' && ! r.inCombat ) ) break;
				let res = null;
				try { res = r.takeHit( H.damage, { from: { x: pr.x - hit.dir.x, z: pr.z - hit.dir.z } } ); } catch ( e ) { res = null; }
				const m = this._get( 'melee' );
				if ( res && m && m.pop ) try { m.pop( res.blocked ? 'BLOCKED' : String( res.dealt ), { x: r.x, y: r.y + 1.9, z: r.z }, res.blocked ? 'block' : 'dmg' ); } catch ( e ) { /* optional */ }
				if ( res && ! res.blocked && ! res.killed ) pr.stuck = { raider: r };
				break;

			}

			case 'prop': {

				const d = this._get( 'destruction' );
				try { if ( d && d.damage ) d.damage( hit.target, H.damage * 30, hit, 'player' ); } catch ( e ) { /* optional */ }
				break;

			}

			case 'ship':
				try { if ( vfx && vfx.splinters ) vfx.splinters( hit.x, hit.y, hit.z, 0.12 ); } catch ( e ) { /* optional */ }
				pr.stuck = { ship: hit.target, local: this._shipLocal( hit.target, hit ) };
				break;

			default:
				try { if ( vfx && vfx.dust ) vfx.dust( hit.x, hit.y, hit.z, 0.08 ); } catch ( e ) { /* optional */ }

		}

		if ( ! pr.stuck ) pr.stuck = { ground: true };
		pr.vx = pr.vy = pr.vz = 0;

	}

	_harpoonHome( pr ) {

		pr.done = true;
		if ( this.harpoonOut === pr ) this.harpoonOut = null;
		this.audio.whoosh( 0.3 );
		this._tip( 'harpoonBack', 'The harpoon is back in hand', 1400 );

	}

	// ---- the swivel gun from the deck

	fireSwivel() {

		const nv = this._get( 'naval' ), b = this.app.boatCtl, cam = this.app.camera;
		if ( ! this.canSwivel() || ! nv || typeof nv.fire !== 'function' ) return { refused: 'noGun' };
		const d = cam && cam.quaternion ? forwardOf( cam.quaternion ) : { x: 0, y: 0, z: - 1 };
		const q = b.quaternion || { x: 0, y: 0, z: 0, w: 1 };
		const local = rotateByQuat( { x: - q.x, y: - q.y, z: - q.z, w: q.w }, d );
		const side = local.x >= 0 ? 'port' : 'starboard'; // the boat frame's +X is port (naval util sideSign)
		let ok = false;
		try { ok = !! nv.fire( side ); } catch ( e ) { ok = false; }
		if ( ok ) this.stats.swivel ++;
		return ok ? { side } : { refused: 'reloading', side };

	}

	// ---- the cannon shot kinds

	chooseShot( kind ) {

		if ( ! SHOT[ kind ] ) return false;
		if ( kind !== 'round' && ! ( this.shot[ kind ] > 0 ) && ! this.sandbox ) {

			this.toast( `No ${ SHOT[ kind ].name.toLowerCase() } aboard · ${ SHOT[ kind ].vendor === 'blackmarket' ? 'the Blackwater fence sells it' : 'Ethena Prosper sells it' }`, 2400 );
			return false;

		}

		this.shotSel = kind;
		this.toast( kind === 'round' ? 'Round shot' : `${ SHOT[ kind ].name } · ${ this.sandbox ? 'free' : this.shot[ kind ] + ' left' }`, 1500 );
		this.emit( 'shotChosen', { kind } );
		return true;

	}

	_onCannon( e ) {

		if ( ! e || e.by !== 'player' ) return;
		let kind = this.shotSel;
		if ( kind !== 'round' ) {

			if ( this.sandbox ) { /* free */ } else if ( this.shot[ kind ] > 0 ) this.shot[ kind ] --;
			else kind = 'round';
			if ( ! this.sandbox && this.shot[ this.shotSel ] <= 0 && this.shotSel !== 'round' ) {

				this.toast( `That was the last ${ SHOT[ this.shotSel ].name.toLowerCase() } · round shot now`, 2000 );
				this.shotSel = 'round';

			}

		}

		this.shotQueue.push( { kind, t: 0 } );
		if ( this.shotQueue.length > 24 ) this.shotQueue.shift();

	}

	_onImpact( e ) {

		if ( ! e || e.owner !== 'player' ) return;
		const q = this.shotQueue.shift();
		if ( ! q || q.kind === 'round' || e.hit !== 'ship' ) return;
		const nv = this._get( 'naval' );
		const s = nv && Array.isArray( nv.ships ) ? nv.ships.find( ( x ) => x.id === e.target ) : null;
		if ( ! s || s.alive === false ) return;
		this.applyShot( q.kind, s, e );

	}

	// chain: the canvas and the mast; grape: the crew (exported for the tests: the naval-free path)
	applyShot( kind, s, at = null ) {

		const nv = this._get( 'naval' );
		let sunk = false;
		if ( kind === 'chain' ) {

			const C = SHOT.chain;
			this.stats.chainHits ++;
			try {

				sunk = s.damage( C.sails, { part: 'sails', by: 'player' } );
				if ( ! sunk && s.lastHit && s.lastHit.broke ) this.emit( 'sectionBroken', { id: s.id, section: 'sails' } );
				if ( ! sunk && s.sections && ( ! s.sections.has || s.sections.has( 'mast' ) ) ) {

					sunk = s.damage( C.mast, { part: 'mast', by: 'player' } );
					const lh = s.lastHit;
					if ( ! sunk && lh && lh.broke ) this.emit( 'sectionBroken', { id: s.id, section: 'mast' } );
					if ( ! sunk && lh && lh.mastFell && nv && typeof nv._shipMastFell === 'function' ) nv._shipMastFell( s, at ? this._shipLocal( s, at ) : { x: 0, y: 0, z: 0 } );

				}

			} catch ( err ) { /* a ship without sections */ }

		} else if ( kind === 'grape' ) {

			const n = SHOT.grape.crew;
			this.stats.grapeHits ++;
			const b = s.boarding;
			let left = null;
			if ( b && b.crewLeft > 0 ) left = b.crewLeft = Math.max( 0, b.crewLeft - n );
			else if ( Number.isFinite( s.crew ) && s.crew > 0 ) left = s.crew = Math.max( 0, s.crew - n );
			else if ( Number.isFinite( s.hands ) && s.hands > 0 ) left = s.hands = Math.max( 0, s.hands - n );
			if ( left !== null ) {

				this.toast( left > 0 ? `Grape sweeps the ${ s.name }'s deck · ${ left } left standing` : `The ${ s.name }'s deck is swept clean`, 2000 );
				this.emit( 'crewShot', { id: s.id, name: s.name, left } );

			}

		}

		if ( sunk && nv && typeof nv._onSunk === 'function' ) nv._onSunk( s, true );
		return sunk;

	}

	// ---- another player's throwables: the effect where it happened (props come through destruction's own events)
	_remote( e ) {

		if ( ! e || e.kind !== 'thrown' || e.replay || ! e.data ) return;
		const d = e.data, vfx = this._get( 'vfx' );
		if ( ! [ d.x, d.y, d.z ].every( Number.isFinite ) ) return;
		const at = { x: d.x, y: d.y, z: d.z };
		try {

			if ( d.ev === 'blast' ) { if ( vfx && vfx.explosion ) vfx.explosion( d.x, d.y, d.z, 1, 'dirt' ); this.audio.blast( at, 1 ); }
			else if ( d.ev === 'fire' ) { if ( vfx && vfx.flash ) vfx.flash( d.x, d.y + 0.3, d.z, 0.4, 0, 1, 0 ); this.audio.shatter( at ); }
			else if ( d.ev === 'smoke' ) { if ( vfx && vfx.smoke ) vfx.smoke( d.x, d.y + 0.5, d.z, 1.5, 0, 1, 0 ); }
			else if ( d.ev === 'splash' ) { if ( vfx && vfx.splash ) vfx.splash( d.x, d.y, d.z, 0.15 ); }

		} catch ( err ) { /* optional */ }

	}

	// ---- the shop

	price( id ) {

		if ( MELEE[ id ] && id !== 'paddle' ) return MELEE[ id ].price;
		if ( THROWN[ id ] ) return THROWN[ id ].price;
		if ( SHOT[ id ] && SHOT[ id ].price ) return SHOT[ id ].price;
		return null;

	}

	vendorOf( id ) {

		return ( MELEE[ id ] || THROWN[ id ] || SHOT[ id ] || {} ).vendor || null;

	}

	buy( id ) {

		const st = this.state, free = !! ( st && st.free );
		const price = this.price( id );
		if ( price === null ) return { ok: false, why: 'unknown' };
		if ( MELEE[ id ] && this.owned[ id ] ) return { ok: false, why: 'owned' };
		const T = THROWN[ id ], S = SHOT[ id ];
		if ( T && this.thrown[ id ] >= T.max ) { this.toast( 'You cannot carry more', 1600 ); return { ok: false, why: 'full' }; }
		if ( S && this.shot[ id ] >= S.max ) { this.toast( 'The locker is full', 1600 ); return { ok: false, why: 'full' }; }
		if ( ! free && ( ! st || ! st.spend || ! st.spend( price ) ) ) {

			this.toast( 'Not enough money', 1600 );
			return { ok: false, why: 'money' };

		}

		if ( MELEE[ id ] ) {

			this.owned[ id ] = true;
			this.melee = id;
			this.toast( `Bought the ${ MELEE[ id ].name.toLowerCase() } · ${ this.app?.input?.touchMode ? 'Weapon draws it' : '1 to draw it' }`, 2600 );

		} else if ( T ) {

			this.thrown[ id ] = Math.min( T.max, this.thrown[ id ] + T.pack );
			this.toast( `${ T.name } x${ T.pack } · ${ this.thrown[ id ] } carried · ${ this.app?.input?.touchMode ? 'Weapon takes one in hand' : '4 to take one in hand' }`, 2600 );

		} else {

			this.shot[ id ] = Math.min( S.max, this.shot[ id ] + S.pack );
			this.toast( `${ S.name } x${ S.pack } · ${ this.shot[ id ] } aboard · ${ this.app?.input?.touchMode ? 'at the helm the Shot button loads it' : 'at the helm 1 / 2 / 3 picks the shot' }`, 3000 );

		}

		this.emit( 'weaponBought', { id, price: free ? 0 : price } );
		try { if ( st && st.save ) st.save(); } catch ( e ) { /* saved later */ }
		return { ok: true };

	}

	// Ethena Prosper's Gear tab (HudPanels renderShop): the legal arsenal, data-wpn buttons call buy( id )
	shopRows() {

		const st = this.state || {}, free = !! st.free, money = Number.isFinite( st.money ) ? st.money : 0;
		const btn = ( id, label ) => `<button class="gm-btn" data-wpn="${ id }" ${ ! free && this.price( id ) > money ? 'disabled' : '' }>${ free ? 'Free' : label }</button>`;
		let html = '';
		for ( const id of MELEE_ORDER ) {

			const w = MELEE[ id ];
			if ( w.vendor !== 'chandlery' ) continue;
			html += `<div class="gm-shop-row"><span>${ w.name }<small>${ w.desc }</small></span>${ this.owned[ id ] ? '<span class="gm-have">Owned</span>' : btn( id, `$${ w.price }` ) }</div>`;

		}

		for ( const id of THROWN_ORDER ) {

			const t = THROWN[ id ];
			if ( t.vendor !== 'chandlery' ) continue;
			html += `<div class="gm-shop-row"><span>${ t.name } x${ t.pack }<small>${ t.desc } · you carry ${ this.thrown[ id ] }</small></span>${ this.thrown[ id ] >= t.max ? '<span class="gm-have">Full</span>' : btn( id, `$${ t.price }` ) }</div>`;

		}

		for ( const id of SHOT_ORDER ) {

			const s = SHOT[ id ];
			if ( s.vendor !== 'chandlery' ) continue;
			html += `<div class="gm-shop-row"><span>${ s.name } x${ s.pack }<small>${ s.desc } · ${ this.shot[ id ] } aboard</small></span>${ this.shot[ id ] >= s.max ? '<span class="gm-have">Full</span>' : btn( id, `$${ s.price }` ) }</div>`;

		}

		return html;

	}

	// the Blackwater fence's rows (Stronghold.marketRows appends them; trade: BlackMarket.canTrade( ctx ))
	marketRows( trade = { ok: true } ) {

		const st = this.state || {}, free = !! st.free, money = Number.isFinite( st.money ) ? st.money : 0;
		const rows = [];
		const push = ( id, label, full, owned = false ) => {

			const price = this.price( id );
			const ok = !! ( trade && trade.ok ) && ! full && ! owned && ( free || money >= price );
			rows.push( { id: 'wpn:' + id, label, price: free ? 0 : price, ok, why: owned ? 'owned' : trade && ! trade.ok ? trade.reason || 'unwelcome' : full ? 'full' : ok ? null : 'money' } );

		};

		for ( const id of MELEE_ORDER ) if ( MELEE[ id ].vendor === 'blackmarket' ) push( id, MELEE[ id ].name, false, !! this.owned[ id ] );
		for ( const id of THROWN_ORDER ) if ( THROWN[ id ].vendor === 'blackmarket' ) push( id, `${ THROWN[ id ].name } x${ THROWN[ id ].pack }`, this.thrown[ id ] >= THROWN[ id ].max );
		for ( const id of SHOT_ORDER ) if ( SHOT[ id ].vendor === 'blackmarket' ) push( id, `${ SHOT[ id ].name } x${ SHOT[ id ].pack }`, this.shot[ id ] >= SHOT[ id ].max );
		return rows;

	}

	marketAction( rowId, trade = { ok: true } ) {

		if ( typeof rowId !== 'string' || ! rowId.startsWith( 'wpn:' ) ) return { ok: false, reason: 'unknown' };
		const id = rowId.slice( 4 );
		if ( this.vendorOf( id ) !== 'blackmarket' ) return { ok: false, reason: 'unknown' };
		if ( trade && ! trade.ok ) return { ok: false, reason: trade.reason || 'unwelcome' };
		return this.buy( id );

	}

	// ---- per frame

	update( dt ) {

		if ( ! ( dt > 0 ) ) return;
		dt = Math.min( dt, 0.1 );
		if ( this.app.paused ) return;
		this._auto();
		this._input();
		if ( this.pending ) {

			this.pending.t += dt;
			if ( this.pending.t >= THROW_RELEASE ) {

				const kind = this.pending.kind;
				this.pending = null;
				this._release( kind );

			}

		}

		this._step( dt );
		this._holdPose();
		this._draw();

	}

	// put things away when they cannot be held (a gun drawn, the rod out, swimming, at the helm, knocked down)
	_auto() {

		const p = this.app.player, rod = this.app.game && this.app.game.rod;
		if ( ! this.hand ) {

			// a swing with nothing in hand draws the melee weapon (it shows for the fight)
			const m = this._get( 'melee' );
			if ( m && m.combat && ( m.combat.state === 'swing' || m.combat.guarding ) && this._canAct() && ! this._gunDrawn() ) this.hand = 'melee';
			return;

		}

		const away = ! p || ( p.mode !== 'walk' && p.mode !== 'deck' ) || ( rod && rod.equipped ) || this._gunDrawn() || this.app.freeCam;
		if ( away || ( this.hand === 'swivel' && ! this.canSwivel() ) ) { this.hand = null; this.pending = null; }

	}

	_input() {

		const inp = this.app.input, p = this.app.player;
		if ( ! inp || ! inp.hit ) return;
		const lmb = !! inp.mouseDown;
		const lDown = lmb && ! this._lmb;
		this._lmb = lmb;
		const busy = this._busyDigits(); // (every frame: it remembers the emote row's last state)
		// at the helm: 1 / 2 / 3 pick the shot (when there are guns to load)
		if ( p && p.mode === 'boat' && ! busy ) {

			const nv = this._get( 'naval' );
			if ( nv && nv.playerGun && nv.playerGun.owned ) for ( let i = 0; i < SHOT_ORDER.length; i ++ ) if ( inp.hit( SLOTS[ i ].key ) ) this.chooseShot( SHOT_ORDER[ i ] );
			return;

		}

		if ( ! this._canAct() ) return;
		if ( ! busy ) {

			for ( const s of SLOTS ) if ( inp.hit( s.key ) ) this.slot( s.kind );
			if ( this.keys.cycle && inp.hit( CYCLE_KEY ) ) this.cycle();

		}

		if ( lDown && this.hand === 'thrown' ) this.throwNow();
		else if ( lDown && this.hand === 'swivel' ) this.fireSwivel();

	}

	// 1-4 belong to someone else right now: the emote row is open, a boarding choice is up, the seaplane's panel key
	_busyDigits() {

		// the emote row (Digit5) picks with 1-9, 0, - and =: while it is open, and on the frame a pick closed it (the emotes
		// feature may update before this one), the digits are its own
		const em = this._get( 'emotes' );
		const open = !! ( em && em.rowOpen ), was = this._emoteOpen;
		this._emoteOpen = open;
		if ( open || was ) return true;
		const bd = this._get( 'boarding' );
		if ( bd && ( ( bd.phase && bd.phase !== 'idle' ) || ( bd.hostile && bd.hostile.busy ) ) ) return true;
		const p = this.app.player;
		return !! ( p && ( p.mode === 'plane' || p.mode === 'seaplane' ) );

	}

	_step( dt ) {

		for ( const pr of this.flying ) {

			if ( pr.done ) continue;
			pr.t += dt;
			if ( pr.kind === 'bomb' ) {

				pr.fuse -= dt;
				if ( pr.fuse <= 0 ) { this._blast( pr ); continue; }

			}

			this._fly( pr, dt );
			// a smoke pot burns out with its cloud; a resting bottle cannot be (it shatters); a harpoon that missed comes home
			if ( pr.kind === 'harpoon' && ! pr.stuck && pr.t > 3 ) this._harpoonHome( pr );
			if ( pr.kind === 'smoke' && pr.lit && pr.t > THROWN.smoke.time + 1 ) pr.done = true;
			if ( pr.kind === 'smoke' && pr.rest && ! pr.lit ) this._smoke( pr );

		}

		this.flying = this.flying.filter( ( pr ) => ! pr.done );
		const vfx = this._get( 'vfx' );
		for ( const f of this.fires ) {

			f.t += dt;
			f.tick += dt;
			if ( f.tick >= FIRE_TICK ) { f.tick -= FIRE_TICK; this._burnTick( f ); }
			if ( f.t >= f.time ) try { if ( vfx && vfx.stopFire ) vfx.stopFire( f.id ); } catch ( e ) { /* optional */ }

		}

		this.fires = this.fires.filter( ( f ) => f.t < f.time );
		for ( const c of this.clouds ) {

			c.t += dt;
			c.puff += dt;
			if ( c.pot && ! c.pot.done ) { c.x = c.pot.x; c.y = c.pot.y; c.z = c.pot.z; }
			if ( c.puff >= SMOKE_PUFF && c.t < c.time ) {

				c.puff = 0;
				const r = THROWN.smoke.radius * Math.min( 1, 0.4 + c.t / 2 ) * 0.6;
				const a = this.rand() * Math.PI * 2, d = this.rand() * r;
				try { if ( vfx && vfx.smoke ) vfx.smoke( c.x + Math.cos( a ) * d, c.y + 0.3, c.z + Math.sin( a ) * d, 1.1, 0, 0.6, 0 ); } catch ( e ) { /* optional */ }

			}

		}

		this.clouds = this.clouds.filter( ( c ) => c.t < c.time );
		for ( const q of this.shotQueue ) q.t += dt;
		while ( this.shotQueue.length && this.shotQueue[ 0 ].t > 10 ) this.shotQueue.shift();

	}

	// the arms while a weapon is in hand: its hold pose as an upper-body loop (back after a swing, a throw, a guard)
	_holdPose() {

		const av = this.app.avatar, wp = this._poses();
		const p = this.app.player;
		let want = null;
		if ( wp && p && ( p.mode === 'walk' || p.mode === 'deck' ) && ! this._gunDrawn() ) {

			if ( this.hand === 'melee' ) want = HOLD_OF[ this.meleeNow() ] === 'pole' ? WEAPON_CLIPS.holdPole : WEAPON_CLIPS.hold1h;
			else if ( this.hand === 'thrown' ) want = WEAPON_CLIPS.throwReady;

		}

		const h = this._holdH;
		if ( h && ( ! want || h.clip !== want ) ) {

			if ( h.handle.playing ) try { h.handle.stop( 0.2 ); } catch ( e ) { /* gone */ }
			this._holdH = null;

		}

		if ( ! want || ( this._holdH && this._holdH.handle.playing ) ) return;
		this._holdH = null;
		const g = av && av.graph;
		if ( g && g.upperBusy ) return; // a swing, a guard, a throw, an emote owns the arms: back after it
		try {

			const handle = av.playMontage( want, { slot: 'upper', loop: true, blendIn: 0.15, blendOut: 0.2 } );
			if ( handle && handle.playing !== false ) this._holdH = { clip: want, handle };

		} catch ( e ) { /* optional */ }

	}

	// the meshes: what is in the player's hand, the raiders' arms, the projectiles; the throw's arc
	_draw() {

		const P = this.props;
		const av = this.app.avatar, wp = this._poses();
		// the player's hand
		let id = null, hk = null;
		if ( this.hand === 'melee' ) { id = this.meleeNow(); hk = HOLD_OF[ id ] || 'oneHand'; }
		else if ( this.hand === 'thrown' && this.thrownSel && ! ( this.pending && this.pending.t >= THROW_RELEASE ) ) { id = this.thrownSel; hk = id === 'harpoon' ? 'thrown' : 'thrown'; }
		if ( id && av && av.visible !== false && av.handMatrix && wp ) {

			let ok = false;
			try { ok = !! av.handMatrix( _m ); } catch ( e ) { ok = false; }
			if ( ok ) {

				const hq = wp.hold[ hk ];
				_r.makeRotationFromQuaternion( _q.set( hq[ 0 ], hq[ 1 ], hq[ 2 ], hq[ 3 ] ) );
				P.place( 'player', id, _m.multiply( _r ) );

			}

		}

		// the raiders' cutlasses and blunderbusses
		const m = this._get( 'melee' );
		let list = [];
		try { list = m ? m.raiders || [] : []; } catch ( e ) { list = []; }
		for ( const r of list ) {

			if ( ! r || ! r.weapon || ! r.active || ! r.visible || ! r.avatar || ! r.model || r.state === 'gone' ) continue;
			const ra = r.avatar;
			if ( ! ra.handMatrix || ( m.far && m.far( r ) ) ) continue;
			const arms = RAIDER_ARMS[ r.weapon ];
			let hq = null;
			if ( r.weapon === 'blunderbuss' ) { const gp = gunPoses( ra ); hq = gp ? gp.hold.musket : null; }
			else { const rp = weaponPoses( ra ); hq = rp ? rp.hold.idle : null; }
			if ( ! hq ) continue;
			try { if ( ! ra.handMatrix( _m ) ) continue; } catch ( e ) { continue; }
			_r.makeRotationFromQuaternion( _q.set( hq[ 0 ], hq[ 1 ], hq[ 2 ], hq[ 3 ] ) );
			P.place( 'raider:' + r.id, arms.model, _m.multiply( _r ) );

		}

		// the projectiles: turned along their flight
		for ( const pr of this.flying ) {

			if ( pr.done ) continue;
			const sp = Math.hypot( pr.vx, pr.vy, pr.vz );
			if ( pr.kind === 'harpoon' && sp > 0.5 ) _q.setFromUnitVectors( _v.set( 0, 0, 1 ), new Vector3( pr.vx / sp, pr.vy / sp, pr.vz / sp ) );
			else if ( pr.kind === 'harpoon' ) { /* stuck: keep the last turn */ } else _q.setFromAxisAngle( _v.set( 1, 0, 0 ), pr.t * 9 );
			if ( pr.kind === 'harpoon' && pr.q ) { if ( sp > 0.5 ) pr.q.copy( _q ); else _q.copy( pr.q ); } else if ( pr.kind === 'harpoon' ) pr.q = _q.clone();
			P.placeAt( 'fly:' + pr.id, pr.kind, pr.x, pr.y, pr.z, _q );

		}

		P.end();
		// the arc while a throwable is in hand
		if ( this.hand === 'thrown' && this.thrownSel && this._canAct() && ! this.pending ) {

			const aim = this.aimThrow();
			if ( aim ) {

				const pts = arcPoints( aim.from, aim.vel, { groundAt: this._groundAt(), seaLevel: this.seaLevel, step: 0.05, maxT: 3 } );
				const k = this.thrownSel;
				this.arc.show( pts, k === 'bomb' ? THROWN.bomb.radius : k === 'smoke' ? THROWN.smoke.radius * 0.5 : k === 'firebottle' ? THROWN.firebottle.radius : 0.4 );

			}

		} else if ( this.arc.shown ) this.arc.hide();

	}

	// ---- save

	toJSON() {

		return {
			v: 1, owned: MELEE_ORDER.filter( ( id ) => this.owned[ id ] && id !== 'paddle' ), melee: this.melee,
			thrown: { ...this.thrown }, shot: { ...this.shot }, shotSel: this.shotSel,
		};

	}

	fromJSON( d ) {

		if ( ! d || typeof d !== 'object' ) return;
		this._clearWorld();
		const own = new Set( Array.isArray( d.owned ) ? d.owned.filter( ( id ) => MELEE[ id ] ) : [] );
		for ( const id of MELEE_ORDER ) this.owned[ id ] = id === 'paddle' || own.has( id );
		this.melee = MELEE[ d.melee ] && this.owned[ d.melee ] ? d.melee : 'paddle';
		for ( const id of THROWN_ORDER ) this.thrown[ id ] = d.thrown && Number.isFinite( d.thrown[ id ] ) ? clamp( Math.floor( d.thrown[ id ] ), 0, THROWN[ id ].max ) : 0;
		for ( const id of [ 'chain', 'grape' ] ) this.shot[ id ] = d.shot && Number.isFinite( d.shot[ id ] ) ? clamp( Math.floor( d.shot[ id ] ), 0, SHOT[ id ].max ) : 0;
		this.shotSel = SHOT[ d.shotSel ] ? d.shotSel : 'round';
		this.hand = null;

	}

	_clearWorld() {

		const vfx = this._get( 'vfx' );
		for ( const f of this.fires ) try { if ( vfx && vfx.stopFire ) vfx.stopFire( f.id ); } catch ( e ) { /* optional */ }
		this.flying = [];
		this.fires = [];
		this.clouds = [];
		this.pending = null;
		this.harpoonOut = null;
		this.shotQueue = [];

	}

	reset() {

		this._clearWorld();
		if ( this._holdH && this._holdH.handle.playing ) try { this._holdH.handle.stop( 0.1 ); } catch ( e ) { /* gone */ }
		this._initState();
		this._tips = {};
		this.arc.hide();

	}

	dispose() {

		this._clearWorld();
		this.props.dispose();
		this.arc.dispose();
		if ( this.bank ) this.bank.dispose();
		for ( const off of this._offs ) if ( typeof off === 'function' ) off();
		this._offs.length = 0;

	}

}

const r2 = ( v ) => Math.round( v * 100 ) / 100;

// Death (wave 4): one feature for every way the run can end. The cut goes black with a cause line, you wake at Jade
// Landing (WORLD.start) on foot with full health, and what you carried waits in "your sea chest" where you fell (on the
// sea floor at sea), marked on the world map and the minimap for you alone.
//
//   features.add( 'death', death );   // import * as death from './features/death/index.js'
//   const d = features.get( 'death' );
//   d.kill( cause, { x, y, z, text, by } ) -> bool     end the run now (false while a death is already playing); emits
//                               playerDied unless it came from another module's playerDied
//   d.dying                     { t, cause, title, x, y, z, aboard, respawned } | null while the cut plays (DURATION s)
//   d.crate                     { x, y, z, ageH, cause, loot: { fish, cargo, money } } | null   one at a time
//   d.claim() -> bool           the chest back into your hands (E beside it; diving when it is on the sea floor)
//   d.update( dt ) / toJSON() / fromJSON( d ) / reset() / dispose()
//   d.pump( dt )                the cut on its own clock: while features.update is not running (the game is paused by the
//                               welcome guide or a menu) a requestAnimationFrame loop calls it, so the cut always ends
//
// Causes: 'melee' (the melee module's knockout: it emits playerDied and lets this feature respawn you), 'seaplane' (a
// piloted crash, Seaplane.js), 'boarding' (boardersWon: pirates took your deck), 'sunk' (your boat went down while a
// hostile boarding party held her: playerBoatSunk { boarded }), 'lost' (thrown overboard with no land within
// LOST_RANGE: "no way out"), 'drowned' (wave 22B: Breath.js, below). Anything else may emit playerDied { cause, x, y, z,
// text? } and is handled the same way.
//
// Breath (wave 22B): d.breath (Breath.js) runs while the head is under water (headUnder: swimming with the eyes under the
// surface, or trapped under an upturned hull: features.get( 'capsize' ).trapped( player )); never in a vehicle, at the helm,
// on a deck or wading. ~30 s of air (x breath.bonus; sprint-swimming burns it 1.6 times as fast), the ring near the centre
// (BreathRing.js, contextual), amber with a closing vignette in the last 8 s, then 6 s of damage (the melee hit points fall
// towards 1) and the end: 'drowned'. Surfacing refills the lungs in ~4 s. Crew and townsfolk never drown.
//   d.breathless()  true while the air is out (the damage is running)
// Events: breathLow { left } (8 s of air left, once per dive), breathOut {} (the damage starts): sfx patch.
//
// The chest (campaign; the sandbox keeps everything): the fish inventory, the cargo crates (trade) and the money above
// KEEP. A new death replaces an unclaimed chest (its contents are lost); it expires after EXPIRE_HOURS in-game hours.
// Multiplayer: the chest is local state (yours only); wrecks are naval's world events.
//
// Events: playerDied { cause, x, y, z, text } (emitted for the causes found here; listened to for the others),
// playerRespawned { cause, x, y, z, towed }, crateClaimed { fish, cargo, money }, crateExpired { lost }.
// Listens: playerDied, playerBoatSunk, boardersWon. Map marker: worldmap.addMarker( { id: 'sea-chest', kind: 'death' } ).

import { WORLD } from '../../world/WorldLayout.js';
import { strip, stow, isEmpty, clean, summary } from './Belongings.js';
import { ClaimSpot } from './Spot.js';
import { DeathOverlay } from './Overlay.js';
import { makeChestMesh } from './Crate.js';
import { Breath } from './Breath.js';
import { BreathRing } from './BreathRing.js';

export { Breath, BREATH } from './Breath.js';

export const KEEP = 100; // $ that stays in your pocket
export const EXPIRE_HOURS = 48; // in-game hours (2 days)
export const LOST_RANGE = 300; // m: thrown overboard with no land this close is the end (450 until wave 12: the new islands leave no water that far from land)
export const LOST_AFTER = 5; // s in the water before "lost at sea"
export const FADE_IN = 0.7, RESPAWN_AT = 1.4, FADE_OUT_AT = 2.7, DURATION = 3.5; // s of the cut
const MARKER_ID = 'sea-chest';
const SAVE_V = 1;

const PUMP_AFTER = 150; // ms without features.update before the cut drives itself (the game is paused)
const finite = ( ...v ) => v.every( Number.isFinite );
// Player.js SWIM_EYE (EYE 1.62 x 0.1): the eyes above the swimmer's float point
export const SWIM_EYE = 0.162;

// is the player's head under water now? (swimming only: walking, wading, decks, the helm and every vehicle never drown)
export function headUnder( app, features ) {

	const p = app && app.player;
	if ( ! p || p.mode !== 'swim' || ! p.position ) return false;
	const get = ( n ) => { try { return features && features.get ? features.get( n ) : null; } catch ( e ) { return null; } };
	const cars = get( 'cars' );
	if ( cars && cars.driving ) return false;
	const water = Number.isFinite( p.waterH ) ? p.waterH : 0;
	if ( ! p.floating && p.position.y + SWIM_EYE < water - 0.05 ) return true;
	const cap = get( 'capsize' );
	try { return !! ( cap && cap.trapped && cap.trapped( p ) ); } catch ( e ) { return false; }

}
const clock = () => ( typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now() );

// the cause line of the cut
export function causeTitle( cause, e = {} ) {

	switch ( cause ) {

		case 'melee': return e.by ? `Knocked out by ${ e.by }` : 'Knocked out';
		case 'seaplane': return e.text || 'The seaplane went down';
		case 'boarding': return e.by ? `${ e.by }'s boarders took the deck` : 'Boarders took the deck';
		case 'sunk': return 'You went down with your boat';
		case 'lost': return 'Lost at sea';
		case 'drowned': return 'Drowned';
		default: return e.text || 'You died';

	}

}

// is there land (or a dock) within r metres of (x, z)? 24 bearings, every r / 8 metres
export function landWithin( terrain, x, z, r = LOST_RANGE ) {

	if ( ! terrain || ! terrain.heightAt ) return true; // (no map: never strand anyone)
	if ( terrain.heightAt( x, z ) > 0.2 ) return true;
	for ( const port of WORLD.ports || [] ) {

		const d = port && port.dock && port.dock.position;
		if ( d && Math.hypot( d.x - x, d.z - z ) < r ) return true;

	}

	const steps = 8;
	for ( let i = 1; i <= steps; i ++ ) {

		const d = r * i / steps;
		for ( let a = 0; a < 24; a ++ ) {

			const ang = ( a / 24 ) * Math.PI * 2;
			if ( terrain.heightAt( x + Math.sin( ang ) * d, z + Math.cos( ang ) * d ) > 0.2 ) return true;

		}

	}

	return false;

}

export class Death {

	constructor( app, features, opts = {} ) {

		this.app = app || {};
		this.features = features || null;
		this.enabled = opts.enabled ?? true;
		this.dying = null;
		this.crate = null;
		this.stats = { deaths: 0, claimed: 0, expired: 0 };
		this._lost = null; // { t } counting down after an overboard far from land
		this._self = false; // our own playerDied is not a request
		this._mk = { wm: null, key: '' };
		this._mesh = null;
		this.overlay = null;
		this._overlayTried = false;
		this._offs = [];
		this._now = opts.now || clock; // ms (tests pass their own)
		this._raf = opts.raf !== undefined ? opts.raf : ( typeof requestAnimationFrame === 'function' ? ( fn ) => requestAnimationFrame( fn ) : null );
		this._ticked = - Infinity; // when update() last ran (ms)
		this._pumping = false;
		this._disposed = false;
		this.breath = new Breath();
		this._ring = null;
		this._ringTried = false;
		this._time = 0;
		const f = this.features;
		if ( f && f.on ) {

			this._offs.push( f.on( 'playerDied', ( e ) => {

				// another module's death (melee, the seaplane): handled here, not announced a second time
				if ( ! this._self ) this.kill( ( e && e.cause ) || 'unknown', e || {}, { announce: false } );

			} ) );
			this._offs.push( f.on( 'playerBoatSunk', ( e ) => this._onBoatSunk( e || {} ) ) );
			this._offs.push( f.on( 'boardersWon', ( e ) => this.kill( 'boarding', { by: e && ( e.captain || e.ship ) } ) ) );

		}

		this.spot = new ClaimSpot( this.app, f, {
			id: 'sea-chest',
			position: () => ( this.crate ? { x: this.crate.x, y: this.crate.y + 0.5, z: this.crate.z } : null ),
			prompt: () => ( this.crate ? `Open your sea chest (${ summary( this.crate.loot ) })` : null ),
			onClaim: () => this.claim(),
			radius: 2.6, reach: 3.2,
		} );

	}

	get sandbox() {

		return !! ( this.features && this.features.sandbox );

	}

	// ------------------------------------------------------------------ dying

	kill( cause = 'unknown', e = {}, { announce = true } = {} ) {

		if ( ! this.enabled || this.dying ) return false;
		const p = this.app.player;
		const pp = p && p.position ? p.position : { x: 0, y: 0, z: 0 };
		const x = finite( e.x ) ? e.x : pp.x, z = finite( e.z ) ? e.z : pp.z, y = finite( e.y ) ? e.y : pp.y;
		const aboard = !! ( p && [ 'boat', 'deck', 'seat' ].includes( p.mode ) );
		const title = causeTitle( cause, e );
		this.dying = { t: 0, cause, title, x, y, z, aboard, respawned: false };
		this._lost = null;
		this.stats.deaths ++;
		// what you carried goes into the chest where you fell (a new death replaces the old chest)
		let sub = 'You wake at Jade Landing.';
		if ( ! this.sandbox ) {

			const loot = strip( this.features, { fish: true, cargo: true, money: true, keep: KEEP } );
			this._dropCrate( x, y, z, loot, cause );
			if ( this.crate ) sub = `You wake at Jade Landing. Your sea chest lies where you fell (${ summary( loot ) }).`;

		} else sub = 'You wake at Jade Landing. Sandbox: you keep everything.';

		this._ensureOverlay();
		if ( this.overlay ) this.overlay.show( title, sub );
		this._ticked = this._now();
		this._startPump();
		if ( announce && this.features && this.features.emit ) {

			this._self = true;
			try { this.features.emit( 'playerDied', { cause, x, y, z, text: title } ); } finally { this._self = false; }

		}

		return true;

	}

	_onBoatSunk( e ) {

		if ( ! e.aboard ) return;
		if ( e.boarded ) {

			this.kill( 'sunk', { x: e.x, z: e.z } );
			return;

		}

		// overboard far from any land: a few seconds in the water, then the end (unless you climb out somewhere)
		const p = this.app.player, q = p && p.position;
		if ( q && ! landWithin( this.app.terrainData, q.x, q.z ) ) this._lost = { t: LOST_AFTER };

	}

	_dropCrate( x, y, z, loot, cause ) {

		this._removeCrate();
		if ( isEmpty( loot ) ) return;
		// at sea: down on the floor; ashore: on the ground (a jetty deck counts)
		const T = this.app.terrainData, C = this.app.colliders;
		const floor = T && T.heightAt ? T.heightAt( x, z ) : y;
		let cy = floor;
		if ( floor < - 0.3 ) cy = floor;
		else if ( C && C.groundHeightAt ) {

			const g = C.groundHeightAt( x, z, ( Number.isFinite( y ) ? y : floor ) + 2 );
			if ( Number.isFinite( g ) ) cy = Math.max( floor, g );

		}

		this.crate = { x, y: cy, z, ageH: 0, cause, loot: clean( loot ) };
		this._buildMesh();
		this._syncMarker( true );

	}

	_buildMesh() {

		if ( this._mesh ) this._mesh.dispose();
		this._mesh = null;
		const c = this.crate;
		if ( ! c || ! this.app.scene ) return;
		try {

			this._mesh = makeChestMesh( this.app.scene );
			if ( this._mesh ) this._mesh.place( c.x, c.y, c.z, ( c.x * 0.37 + c.z * 0.11 ) % ( Math.PI * 2 ) );

		} catch ( e ) {

			console.warn( 'death: sea chest mesh failed', e );
			this._mesh = null;

		}

	}

	_removeCrate() {

		if ( this._mesh ) this._mesh.dispose();
		this._mesh = null;
		this.crate = null;
		this._syncMarker( true );

	}

	claim() {

		const c = this.crate;
		if ( ! c ) return false;
		const what = summary( c.loot );
		const got = stow( this.features, c.loot );
		this._removeCrate();
		this.stats.claimed ++;
		if ( this.features && this.features.emit ) this.features.emit( 'crateClaimed', got );
		const g = this.app.game;
		if ( g && g.toast ) g.toast( `Your sea chest: ${ what } recovered`, 3200 );
		if ( this.app.audio && this.app.audio.coin && got.money ) try { this.app.audio.coin(); } catch ( e ) { /* sound */ }
		return true;

	}

	// ------------------------------------------------------------------ waking at Jade Landing

	_startPoint() {

		const s = WORLD.start || { position: { x: 0, y: 0, z: 0 }, yaw: 0 };
		const x = s.position.x, z = s.position.z;
		const T = this.app.terrainData, C = this.app.colliders;
		let y = T && T.heightAt ? T.heightAt( x, z ) : s.position.y || 0;
		// (the landing deck stands over the start: land on it, not under it)
		if ( C && C.groundHeightAt ) {

			const g = C.groundHeightAt( x, z, 50 );
			if ( Number.isFinite( g ) ) y = Math.max( y, g );

		}

		return { x, y: y + 0.05, z, yaw: s.yaw || 0 };

	}

	_respawn() {

		const d = this.dying, app = this.app, p = app.player, pt = this._startPoint();
		if ( p ) {

			try {

				if ( p.mode === 'plane' && p.exitVehicle ) p.exitVehicle( pt.x, pt.y, pt.z, pt.yaw, 'walk' );
				if ( p.mode === 'boat' && p.leaveHelm ) p.leaveHelm();
				if ( p.mode === 'ride' ) p.ride = null;

			} catch ( e ) { /* the teleport below still happens */ }

			p.mode = 'walk';
			if ( p.position && p.position.set ) p.position.set( pt.x, pt.y, pt.z );
			if ( p.velocity && p.velocity.set ) p.velocity.set( 0, 0, 0 );
			p.yaw = pt.yaw;
			if ( 'stamina' in p ) p.stamina = 1;
			if ( 'floating' in p ) p.floating = true;
			if ( typeof p.grounded === 'boolean' ) p.grounded = true;
			// the spring-arm camera starts from the new place instead of sweeping across the sea
			if ( 'armInit' in p ) p.armInit = false;
			if ( 'camInit' in p ) p.camInit = false;
			if ( '_camY' in p ) p._camY = null;

		}

		// full health (the melee module keeps the player's hit points)
		const mel = this.features && this.features.get ? this.features.get( 'melee' ) : null;
		const c = mel && mel.combat;
		if ( c && Number.isFinite( c.maxHp ) ) c.hp = c.maxHp;

		// you died aboard a boat that is still afloat (or left her hull up: wave 22B): she is towed back to her berth
		let towed = false;
		const b = app.boatCtl, nv = this.features && this.features.get ? this.features.get( 'naval' ) : null;
		const wrecked = !! ( nv && ( nv.sinking || nv.wreck ) );
		this.breath.reset();
		if ( d && ( d.aboard || ( b && b.capsized ) ) && b && b.enabled !== false && ! wrecked && b.reset ) {

			b.driven = false;
			b.reset();
			towed = true;

		}

		d.respawned = true;
		if ( this.features && this.features.emit ) this.features.emit( 'playerRespawned', { cause: d.cause, x: pt.x, y: pt.y, z: pt.z, towed } );
		const g = app.game;
		if ( towed && g && g.toast ) g.toast( 'Your boat was towed back to her berth', 3200 );

	}

	_lockPlayer() {

		const p = this.app.player;
		if ( ! p ) return;
		if ( typeof p.launched === 'number' ) p.launched = Math.max( p.launched, 0.08 );
		if ( p.velocity ) {

			p.velocity.x = 0;
			p.velocity.z = 0;

		}

	}

	// ------------------------------------------------------------------ frame

	// the cut: black, the respawn under it, the fade back (from update, or from the pump while the game is paused)
	pump( dt ) {

		const d = this.dying;
		if ( ! d || ! ( dt > 0 ) ) return;
		d.t += dt;
		this._lockPlayer();
		if ( ! d.respawned && d.t >= RESPAWN_AT ) this._respawn();
		const a = d.t < FADE_IN ? d.t / FADE_IN : d.t < FADE_OUT_AT ? 1 : 1 - ( d.t - FADE_OUT_AT ) / ( DURATION - FADE_OUT_AT );
		if ( this.overlay ) this.overlay.set( a );
		if ( d.t >= DURATION ) {

			this.dying = null;
			if ( this.overlay ) this.overlay.hide();

		}

	}

	// App skips features.update while the game is paused (the welcome guide, the pause menu): an animation-frame loop
	// keeps the cut going then, so the screen never stays black and the respawn still happens
	_startPump() {

		if ( this._pumping || ! this._raf ) return;
		this._pumping = true;
		let last = this._now();
		const tick = () => {

			if ( ! this.dying || this._disposed ) {

				this._pumping = false;
				return;

			}

			const t = this._now();
			const dt = Math.min( 0.1, Math.max( 0, ( t - last ) / 1000 ) );
			last = t;
			if ( t - this._ticked > PUMP_AFTER ) this.pump( dt );
			this._raf( tick );

		};

		this._raf( tick );

	}

	update( dt ) {

		if ( ! ( dt > 0 ) ) return;
		this._ticked = this._now();
		this.pump( dt );
		this._breathe( dt );

		// overboard far out: the end, unless you reached the shore or something picked you up
		if ( this._lost && ! this.dying ) {

			const p = this.app.player;
			this._lost.t -= dt;
			if ( ! p || p.mode !== 'swim' || ( p.position && landWithin( this.app.terrainData, p.position.x, p.position.z, 60 ) ) ) this._lost = null;
			else if ( this._lost.t <= 0 ) {

				this._lost = null;
				this.kill( 'lost' );

			}

		}

		// the chest: the tide takes it after two in-game days
		const c = this.crate;
		if ( c ) {

			const sp = this.app.settings && Number.isFinite( this.app.settings.timeSpeed ) ? Math.max( 0, this.app.settings.timeSpeed ) : 0;
			c.ageH += dt * sp;
			if ( c.ageH >= EXPIRE_HOURS ) {

				const lost = summary( c.loot );
				this._removeCrate();
				this.stats.expired ++;
				if ( this.features && this.features.emit ) this.features.emit( 'crateExpired', { lost } );
				const g = this.app.game;
				if ( g && g.toast ) g.toast( 'The tide took your sea chest', 3200 );

			} else {

				this.spot.update();
				if ( this._mesh ) this._mesh.update( dt );

			}

		}

		this._syncMarker();

	}

	// ------------------------------------------------------------------ breath (wave 22B)

	breathless() {

		return this.breath.air <= 0;

	}

	_breathe( dt ) {

		this._time += dt;
		const b = this.breath, app = this.app;
		const under = ! this.dying && this.enabled && headUnder( app, this.features );
		const inp = app.player && app.player.input;
		const sprint = !! ( inp && inp.down && ( inp.down( 'ShiftLeft' ) || inp.down( 'ShiftRight' ) ) );
		const ev = b.update( dt, { under, sprint } );
		const f = this.features;
		if ( ev === 'warn' && f && f.emit ) f.emit( 'breathLow', { left: Math.round( b.left ) } );
		if ( ev === 'empty' && f && f.emit ) f.emit( 'breathOut', {} );
		// drowning: the hit points slip towards 1 (the melee module keeps them), then the end
		if ( b.drowning > 0 ) {

			const mel = f && f.get ? f.get( 'melee' ) : null, c = mel && mel.combat;
			if ( c && Number.isFinite( c.maxHp ) && Number.isFinite( c.hp ) ) c.hp = Math.max( 1, Math.min( c.hp, Math.round( c.maxHp * ( 1 - 0.95 * b.hurt ) ) ) );

		}

		if ( ev === 'drowned' ) this.kill( 'drowned' );
		// (the ring is decoration: it never stops the breath, the cut or the chest)
		try {

			const r = this._ensureRing();
			if ( r ) r.set( this.dying ? { show: false, frac: 1, tone: 'ok', vignette: 0, pulse: 0 } : b.ring(), this._time );

		} catch ( e ) {

			if ( ! this._ringFailed ) console.warn( 'death: the breath ring failed', e );
			this._ringFailed = true;
			this._ring = null;

		}

	}

	_ensureRing() {

		if ( this._ring || this._ringTried ) return this._ring;
		const ui = this.app.ui && this.app.ui.ui;
		if ( ! ui || this._ringFailed ) return null; // (the UI may come up after the features: try again next frame)
		this._ringTried = true;
		const parent = ui.hud || ui.root;
		if ( parent ) this._ring = new BreathRing( parent );
		return this._ring;

	}

	_ensureOverlay() {

		if ( this.overlay || this._overlayTried ) return this.overlay;
		this._overlayTried = true;
		// on the UI root, not the HUD layer: above every panel and the welcome guide, and seen in photo mode too
		const ui = this.app.ui && this.app.ui.ui;
		const parent = ui && ( ui.root || ui.hud );
		if ( parent ) this.overlay = new DeathOverlay( parent );
		return this.overlay;

	}

	_syncMarker( force = false ) {

		const f = this.features, wm = f && f.get ? f.get( 'worldmap' ) : null;
		const c = this.crate;
		const key = c ? `${ c.x }|${ c.z }` : '';
		if ( ! force && wm === this._mk.wm && key === this._mk.key ) return;
		if ( this._mk.wm && this._mk.wm !== wm && this._mk.wm.removeMarker ) this._mk.wm.removeMarker( MARKER_ID );
		this._mk.wm = wm;
		this._mk.key = key;
		if ( ! wm || ! wm.addMarker ) return;
		if ( c ) wm.addMarker( { id: MARKER_ID, kind: 'death', x: c.x, z: c.z, label: 'Your sea chest', icon: 'chest', mine: true } );
		else wm.removeMarker( MARKER_ID );

	}

	// ------------------------------------------------------------------ save

	toJSON() {

		const c = this.crate;
		const r = ( v ) => Math.round( v * 100 ) / 100;
		return { v: SAVE_V, crate: c ? { x: r( c.x ), y: r( c.y ), z: r( c.z ), ageH: r( c.ageH ), cause: c.cause, loot: clean( c.loot ) } : null, stats: { ...this.stats } };

	}

	fromJSON( d ) {

		if ( ! d || typeof d !== 'object' ) return;
		this._removeCrate();
		const c = d.crate;
		if ( c && typeof c === 'object' && finite( c.x, c.y, c.z ) ) {

			const loot = clean( c.loot );
			if ( ! isEmpty( loot ) ) {

				this.crate = { x: c.x, y: c.y, z: c.z, ageH: Math.max( 0, Number.isFinite( c.ageH ) ? c.ageH : 0 ), cause: typeof c.cause === 'string' ? c.cause : 'unknown', loot };
				this._buildMesh();

			}

		}

		if ( d.stats && typeof d.stats === 'object' ) for ( const k of Object.keys( this.stats ) ) if ( Number.isFinite( d.stats[ k ] ) ) this.stats[ k ] = Math.max( 0, d.stats[ k ] );
		this._syncMarker( true );

	}

	reset() {

		this._removeCrate();
		this.dying = null;
		this._lost = null;
		this.breath.reset();
		if ( this.overlay ) this.overlay.hide();
		this.stats = { deaths: 0, claimed: 0, expired: 0 };

	}

	dispose() {

		this._disposed = true;
		for ( const off of this._offs ) off();
		this._offs.length = 0;
		this.spot.dispose();
		if ( this._mesh ) this._mesh.dispose();
		this._mesh = null;
		if ( this.overlay ) this.overlay.dispose();
		this.overlay = null;
		if ( this._ring ) this._ring.dispose();
		this._ring = null;

	}

}

export function install( app, features, opts = {} ) {

	return new Death( app, features, opts );

}

export default { install };

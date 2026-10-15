import { Vector3 } from '../../engine/index.js';
import { RotorFlight } from './Flight.js';
import { HelicopterVisual, buildHelipad } from './Model.js';
import { RemotePlanes } from '../seaplane/Remote.js';
import { RotorAudio } from './Audio.js';
import { HelicopterHUD } from './HUD.js';
import { RotorSystems } from './Systems.js';
import { HelicopterCockpit } from './Cockpit.js';

export const HOME = Object.freeze( { x: 18, z: - 68, yaw: 0 } );
export const CONTROLS = 'W/S forward/back · A/D turn · ,/. strafe · Shift rise/start · C descend · Space hover/brake · V cockpit · O turbine · U avionics · Y position hold · N nav · ; landing light · 3 systems · E exit after landing';
export const COCKPIT_KEYS = Object.freeze( { KeyO: 'engine', KeyU: 'master', KeyY: 'hold', KeyN: 'nav', Semicolon: 'landing', Digit3: 'panel' } );
const finitePose = p => Array.isArray( p ) && p.length === 4 && p.every( Number.isFinite ) && Math.abs( p[ 0 ] ) < 50000 && Math.abs( p[ 2 ] ) < 50000 && p[ 1 ] > - 100 && p[ 1 ] < 1200;
const _door = new Vector3(), _exit = new Vector3();
const clamp = ( v, a, b ) => Math.max( a, Math.min( b, v ) );

export class Helicopter {

	constructor( app, features, opts = {} ) {
		this.app = app || {}; this.features = features; this.opts = opts;
		this.piloted = false; this.owned = true; this.hp = 100; this._sinceExit = 1; this._driven = false; this._offs = [];
		this.touch = { active: false, forward: 0, strafe: 0, yaw: 0, lift: 0, brake: false };
		this.stats = { flights: 0, landings: 0, hardLandings: 0 };
		this._pads = new Map(); this.homeSlot = 0; this._slotOwner = null;
		this.home = this._padAt( 0 ); this.homeY = this.home.y;
		this.flight = new RotorFlight( {
			groundAt: ( x, z, maxY ) => this.groundAt( x, z, maxY ),
			waterAt: ( x, z ) => this.waterAt( x, z ),
			collide: ( p, r, h ) => this.app.colliders?.resolveCapsule?.( p, r, h, 0.08 ) || false,
		} );
		this.flight.place( HOME.x, this.homeY, HOME.z, HOME.yaw );
		this.systems = new RotorSystems( this.flight ); this.lights = this.systems.lights;
		this.lastLanding = [ HOME.x, this.homeY, HOME.z, HOME.yaw ];
		this.visual = opts.render === false || ! this.app.scene ? null : new HelicopterVisual( this.app.scene );
		// Reuse the tested interpolation/lifecycle, with rotorcraft visuals instead of plane assets.
		this.remote = new RemotePlanes( { models: this.visual ? { create: () => new HelicopterVisual( this.app.scene ) } : null } );
		this.audio = new RotorAudio( this.app );
		this.hud = opts.hud === false ? null : new HelicopterHUD();
		this.cockpit = new HelicopterCockpit( this, { canvas: opts.canvas } );
		const f = this.flight;
		this.vehicle = {
			kind: 'helicopter', quaternion: f.quaternion, seat: [ .2, .96, - .2 ], eye: [ .2, 1.96, - .05 ], focus: [ 0, 1.5, - 0.6 ], chase: 16,
			toWorld: ( l, out ) => f.toWorld( l, out ), drive: dt => this.drive( dt ), exit: () => this.exit(),
			prompt: () => this.canExit() ? 'Leave helicopter' : null, speed: () => f.velocity.length(), heading: () => f.yaw, seaLevel: () => this.waterAt( f.position.x, f.position.z ),
		};
		if ( features?.interactable ) {
			this._offs.push( features.interactable( { id: 'helicopter-door', radius: 3,
				position: () => f.toWorld( [ 1.35, 0.2, 0.65 ], _door ), when: () => ! this.piloted && this._onFoot() && this._sinceExit > 0.6 && ( f.grounded || f.onWater ),
				prompt: () => this.hp > 0 ? 'Fly coastal rescue helicopter · free' : 'Helicopter damaged · service at home helipad', onInteract: () => this.board(),
			} ) );
			this._offs.push( features.interactable( { id: 'helicopter-service', radius: 3,
				position: () => ( { x: this.home.x + 6.9, y: this.home.y, z: this.home.z } ), when: () => ! this.piloted && this._onFoot(),
				prompt: () => 'Recover / repair rescue helicopter · free', onInteract: () => this.recall(),
			} ) );
		}
		if ( features?.on ) this._offs.push( features.on( 'playerDied', () => { if ( this.piloted ) { this.piloted = false; this.systems.stop( true ); this.cockpit.close(); Object.assign( f.controls, { forward: 0, strafe: 0, yaw: 0, lift: 0 } ); } } ) );
		this._syncVisual( 0 );
	}

	_onFoot() { return [ 'walk', 'deck', 'swim' ].includes( this.app.player?.mode ); }
	blocked( ignoreOwn = false ) {
		const app = this.app, ui = app.ui?.ui || app.ui, hud = app.game?.hud;
		let otherPanel = false;
		if ( ignoreOwn && this.features?.list ) { for ( const entry of this.features.list.values() ) { const i = entry.instance; if ( i && i !== this && ( typeof i.isOpen === 'function' ? i.isOpen() : i.isOpen ) ) { otherPanel = true; break; } } }
		else otherPanel = !! this.features?.panelOpen?.();
		return !! ( app.menuOpen || app.menu?.open || app.freeCam || ui?._start || ui?.helpOpen || ui?.panelOpen || ui?.photoMode || app.chat?.isOpen || hud?.invOpen || hud?.standOpen || hud?.rosterOpen || hud?.catchOpen || otherPanel || ( ! ignoreOwn && this.cockpit?.open ) );
	}
	_emit( kind, data = {} ) { this.features?.emit?.( kind, { id: 'helicopter', ...data } ); }
	_toast( text, ms = 4200 ) { this.app.game?.toast?.( text, ms ); }
	_save() { try { this.features?.state?.save?.(); } catch { /* autosave retries */ } }
	_meridian() { return this.opts.meridian || this.app.meridian || this.features?.get?.( 'meridian' ); }
	_padAt( slot ) {
		slot = Math.max( 0, Math.min( 15, slot | 0 ) );
		if ( this._pads.has( slot ) ) return this._pads.get( slot );
		// Up to sixteen pilots (the room cap), with 18 m rotor clearance. Pads are
		// materialized only for occupied slots, identically on every connected client.
		const x = HOME.x + ( slot % 4 ) * 18, z = HOME.z - Math.floor( slot / 4 ) * 18;
		let y = - Infinity;
		for ( const dx of [ - 7, 0, 7 ] ) for ( const dz of [ - 7, 0, 7 ] ) y = Math.max( y, this.app.terrainData?.heightAt?.( x + dx, z + dz ) ?? 0 );
		y = Math.max( 1, y + 0.18 );
		const box = this.app.colliders?.addBox?.( new Vector3( x, y - 0.2, z ), new Vector3( 6.7, 0.2, 6.7 ), 0, { walkable: true, solid: true, tag: 'helicopter-pad-' + slot } ) || null;
		const visual = this.opts.render === false || ! this.app.scene ? null : buildHelipad( this.app.scene, x, y, z );
		const pad = { x, y, z, slot, box, visual }; this._pads.set( slot, pad ); return pad;
	}
	_assignHome( states = [] ) {
		const id = this.features?.get?.( 'netsync' )?.id || this.app.net?.id;
		if ( ! id || this.piloted || this._slotOwner === id ) return;
		// Reserve once when joining. Existing peer reservations win, so a later join
		// never reshuffles an aircraft somebody has parked. Flight/save locations survive.
		const occupied = new Set( states.filter( s => s?.id !== id ).map( s => s?.helicopter?.homeSlot ).filter( Number.isInteger ) );
		let hash = 2166136261; for ( const c of id ) hash = Math.imul( hash ^ c.charCodeAt( 0 ), 16777619 );
		let slot = ( hash >>> 0 ) % 16;
		for ( let n = 0; n < 16 && occupied.has( slot ); n ++ ) slot = ( slot + 1 ) % 16;
		const old = this.home; this.homeSlot = slot; this.home = this._padAt( slot ); this.homeY = this.home.y; this._slotOwner = id;
		if ( this.flight.grounded && Math.hypot( this.flight.position.x - old.x, this.flight.position.z - old.z ) < 6 ) {
			this.flight.place( this.home.x, this.home.y, this.home.z, HOME.yaw ); this.lastLanding = [ this.home.x, this.home.y, this.home.z, HOME.yaw ];
		}
	}

	groundAt( x, z, maxY = Infinity ) {
		if ( this.opts.groundAt ) return this.opts.groundAt( x, z, maxY );
		let y = this.app.terrainData?.heightAt?.( x, z ) ?? 0;
		for ( const pad of this._pads.values() ) if ( pad.y <= maxY && Math.abs( x - pad.x ) <= 6.7 && Math.abs( z - pad.z ) <= 6.7 ) y = Math.max( y, pad.y );
		const floor = this.app.colliders?.groundHeightAt?.( x, z, maxY, 0 );
		if ( Number.isFinite( floor ) ) y = Math.max( y, floor );
		// Meridian requires the entire skid footprint within a roof surface. Ignore its
		// thin roof slabs at the edge, where the native walker floor query includes the center only.
		const m = this._meridian();
		if ( m?.landingSurfaceAt ) {
			const center = m.landingSurfaceAt( x, z, maxY, 0 );
			if ( center && Math.abs( y - center.y ) < 0.3 && ! m.landingSurfaceAt( x, z, maxY, 1.8 ) ) y = this.app.terrainData?.heightAt?.( x, z ) ?? 0;
		}
		return y;
	}
	waterAt( x, z ) { return this.opts.waterAt ? this.opts.waterAt( x, z ) : 0; }

	board() {
		const p = this.app.player, f = this.flight;
		if ( this.piloted || ! this._onFoot() || this.hp <= 0 || ! f.grounded || ! p?.enterVehicle ) return false;
		f.toWorld( [ 1.35, 0.2, 0.65 ], _door );
		if ( p.position && ( Math.hypot( p.position.x - _door.x, p.position.z - _door.z ) > 4 || Math.abs( p.position.y - _door.y ) > 3 ) ) return false;
		if ( p.enterVehicle( this.vehicle ) === false ) return false;
		this.piloted = true; this.systems.begin(); this._driven = false; this.touch.active = false;
		this._toast( 'Coastal rescue helicopter · ' + CONTROLS, 9000 ); this._emit( 'helicopterEntered' ); return true;
	}

	canExit() { return this.piloted && ( this.flight.grounded || this.flight.onWater ) && this.flight.velocity.length() < 1.5; }

	exit() {
		if ( ! this.canExit() ) { if ( this.piloted ) this._toast( 'Land and stop before leaving the helicopter.' ); return false; }
		const f = this.flight, p = this.app.player;
		// Try both doors and then fore/aft; refuse an exit if every side is over a roof edge or inside a wall.
		let spot = null;
		for ( const l of [ [ 2.4, 0, 0.5 ], [ - 2.4, 0, 0.5 ], [ 0, 0, 3 ], [ 0, 0, - 3 ] ] ) {
			f.toWorld( l, _exit );
			const floor = this.app.colliders?.groundHeightAt?.( _exit.x, _exit.z, f.position.y + 0.4 ) ?? - Infinity;
			const ground = Math.max( this.app.terrainData?.heightAt?.( _exit.x, _exit.z ) ?? 0, floor );
			if ( f.onWater ) { spot = { x: _exit.x, y: this.waterAt( _exit.x, _exit.z ) - 0.2, z: _exit.z, water: true }; break; }
			if ( Math.abs( ground - f.position.y ) > 0.55 ) continue;
			const test = new Vector3( _exit.x, ground + 0.03, _exit.z );
			if ( this.app.colliders?.resolveCapsule?.( test, 0.35, 1.75, 0.3 ) && Math.hypot( test.x - _exit.x, test.z - _exit.z ) > 0.6 ) continue;
			spot = { x: test.x, y: ground + 0.03, z: test.z }; break;
		}
		if ( ! spot ) { this._toast( 'Move farther from the roof edge to leave safely.' ); return false; }
		this.piloted = false; this._sinceExit = 0; this.systems.stop( true ); this.systems.session = false; this.cockpit.close(); this.touch.active = false;
		Object.assign( f.controls, { forward: 0, strafe: 0, yaw: 0, lift: 0, brake: true } );
		p?.exitVehicle?.( spot.x, spot.y, spot.z, f.yaw + Math.PI / 2, spot.water ? 'swim' : 'walk', spot.water ? this.waterAt( spot.x, spot.z ) : null );
		this._emit( 'helicopterExited' ); this._save(); return true;
	}

	_input() {
		const inp = this.app.input, d = code => !! inp?.down?.( code );
		if ( this.blocked() || inp?.enabled === false ) return { forward: 0, strafe: 0, yaw: 0, lift: 0, brake: true };
		if ( this.touch.active ) return { forward: clamp( this.touch.forward || 0, - 1, 1 ), strafe: clamp( this.touch.strafe || 0, - 1, 1 ), yaw: clamp( this.touch.yaw || 0, - 1, 1 ), lift: clamp( this.touch.lift || 0, - 1, 1 ), brake: !! this.touch.brake };
		const result = { forward: + d( 'KeyW' ) - d( 'KeyS' ), strafe: + d( 'Period' ) - d( 'Comma' ), yaw: + d( 'KeyA' ) - d( 'KeyD' ), lift: + ( d( 'ShiftLeft' ) || d( 'ShiftRight' ) ) - d( 'KeyC' ), brake: d( 'Space' ) };
		if ( typeof navigator !== 'undefined' && navigator.getGamepads ) {
			const pad = Array.from( navigator.getGamepads() || [] ).find( g => g?.connected );
			if ( pad ) {
				const axis = n => Math.abs( pad.axes[ n ] || 0 ) > 0.16 ? pad.axes[ n ] : 0, button = n => pad.buttons[ n ]?.value || 0;
				result.forward = result.forward || - axis( 1 ); result.strafe = result.strafe || axis( 0 ); result.yaw = result.yaw || - axis( 2 ); result.lift = result.lift || button( 7 ) - button( 6 ); result.brake ||= button( 0 ) > 0.5;
			}
		}
		return result;
	}

	_keys() {
		if ( ! this.piloted ) return;
		const input = this.app.input;
		if ( this.blocked( true ) ) return;
		if ( input?.hit?.( 'Digit3' ) ) { this.act( 'panel' ); return; }
		if ( this.cockpit.open || input?.enabled === false ) return;
		for ( const [ key, id ] of Object.entries( COCKPIT_KEYS ) ) if ( key !== 'Digit3' && input?.hit?.( key ) ) this.act( id );
		if ( ! this.systems.running && ! this.systems.starting && ( input?.down?.( 'ShiftLeft' ) || input?.down?.( 'ShiftRight' ) || this.touch.active && this.touch.lift > 0 ) ) this.systems.start( this.hp );
	}
	act( id, source = 'panel' ) {
		if ( ! this.piloted || this.blocked( true ) || ( this.cockpit.open && source !== 'tray' && id !== 'panel' ) ) return false;
		const s = this.systems; let result = { ok: true, why: '' };
		if ( id === 'panel' ) { this.cockpit.toggle(); return true; }
		if ( id === 'engine' ) result = s.running || s.starting ? s.stop() : s.start( this.hp );
		else if ( id === 'master' ) {
			if ( s.master && ! this.flight.grounded ) result = { ok: false, why: 'Land before switching off the battery and avionics.' };
			else { s.master = ! s.master; if ( ! s.master ) s.stop( true ); result.why = 'Battery / avionics ' + ( s.master ? 'on.' : 'off.' ); }
		} else if ( id === 'hold' ) result = s.toggleHold();
		else if ( [ 'nav', 'landing', 'search', 'cabin' ].includes( id ) ) { s[ id ] = ! s[ id ]; result.why = id + ' light ' + ( s[ id ] ? 'selected' : 'off' ) + ( ! s.master ? ' · switch on avionics for power.' : '.' ); }
		else if ( id === 'ack' ) { s.ack(); result.why = 'Warning acknowledged · active caution remains displayed.'; }
		else return false;
		s.syncLights(); this.cockpit.elapsed = 1; if ( result.why ) this._toast( result.why );
		return result.ok;
	}
	drive( dt ) { if ( ! this.piloted ) return; this._driven = true; this._keys(); Object.assign( this.flight.controls, this.systems.applyHold( this._input() ) ); this._step( dt ); }
	_validateRestoredSupport() {
		const saved = this._pendingSupport;
		if ( ! saved ) return;
		this._pendingSupport = null;
		const f = this.flight;
		// A caller may already have started a new flight after loading. This check
		// applies only to the unchanged cold parking pose restored by fromJSON.
		if ( Math.hypot( f.position.x - saved[ 0 ], f.position.y - saved[ 1 ], f.position.z - saved[ 2 ] ) > 0.1 || f.velocity.length() > 0.1 ) return;
		const support = this.groundAt( saved[ 0 ], saved[ 2 ], saved[ 1 ] + 0.4 );
		if ( Number.isFinite( support ) && Math.abs( support - saved[ 1 ] ) <= 0.6 ) {
			// The roof may have been repaired by a later feature since place() ran.
			// Re-establish cold ground contact without manufacturing a landing event.
			f.place( saved[ 0 ], support, saved[ 2 ], saved[ 3 ] );
			this.lastLanding = [ saved[ 0 ], support, saved[ 2 ], saved[ 3 ] ]; return;
		}
		// Every feature has now restored its data, including citywreck's later
		// destruction stages. Recover unsupported saved parking silently and retain
		// its condition rather than letting a nonexistent roof cause a new crash.
		f.place( this.home.x, this.home.y, this.home.z, HOME.yaw );
		this.lastLanding = [ this.home.x, this.home.y, this.home.z, HOME.yaw ];
	}
	_step( dt ) {
		this._validateRestoredSupport();
		const f = this.flight; this.systems.update( dt, { piloted: this.piloted, hp: this.hp } ); f.update( dt );
		for ( const e of f.drainEvents() ) {
			const at = { x: f.position.x, y: f.position.y, z: f.position.z };
			if ( e.type === 'takeoff' ) { this.stats.flights ++; this._emit( 'helicopterTookOff', at ); }
			if ( e.type === 'landed' ) {
				this.stats.landings ++;
				const damage = Math.max( 0, ( e.sink - 4 ) * 10 ) + Math.max( 0, ( e.speed - 12 ) * 3 );
				if ( damage ) { this.hp = Math.max( 0, this.hp - damage ); this.stats.hardLandings ++; this.audio.crunch( Math.min( 1, damage / 50 ), at.x, at.y, at.z, false ); this._toast( 'Hard landing · helicopter condition ' + Math.round( this.hp ) + '%' ); }
				this._emit( 'helicopterLanded', { ...at, sink: e.sink, damage } );
			} else if ( e.type === 'impact' ) {
				const damage = Math.max( 0, e.speed - 4 ) * 2.5; this.hp = Math.max( 0, this.hp - damage );
				this.audio.crunch( Math.min( 1, damage / 50 ), at.x, at.y, at.z, false ); this._emit( 'helicopterDamaged', { ...at, damage } );
			} else if ( e.type === 'ditched' ) { this.hp = 0; this._toast( 'Helicopter ditched · E to leave · recover at the home helipad.' ); this._emit( 'helicopterDitched', at ); }
		}
		if ( f.grounded ) this.lastLanding = [ f.position.x, f.position.y, f.position.z, f.yaw ];
		if ( this.hp <= 0 ) this.systems.stop( true );
	}

	_syncVisual( dt ) {
		const f = this.flight; this.visual?.setPose( f.position, f.quaternion ); this.visual?.spin( dt, f.rpm, f );
		this.visual?.setLights( this.systems.lightsMask ); this.systems.syncLights();
		this.audio.update( dt, { running: f.engineOn, cranking: f.starter, rpm: f.rpm, airspeed: f.velocity.length(), x: f.position.x, y: f.position.y + 2, z: f.position.z, inside: this.piloted && this.app.player?.view === 'first' } );
	}
	update( dt ) {
		this._sinceExit += dt;
		if ( ! this._driven ) { this._keys(); this._step( dt ); } this._driven = false;
		this._syncVisual( dt );
		const peers = this.app.remotePlayers?.peers;
		if ( peers ) this.updateRemote( [ ...peers ].map( ( [ id, p ] ) => ( { id, helicopter: p.extra?.helicopter } ) ), { complete: true } );
		this.remote.update( dt );
		this.hud?.update( this );
		this.cockpit.update( dt );
	}

	_parkHome() {
		this._pendingSupport = null;
		this.systems.reset(); this.cockpit.close();
		this.hp = 100; this.flight.place( this.home.x, this.home.y, this.home.z, HOME.yaw ); this.lastLanding = [ this.home.x, this.home.y, this.home.z, HOME.yaw ];
		this._syncVisual( 0 );
	}
	recall() {
		if ( this.piloted ) return false;
		this._parkHome(); this._emit( 'helicopterRecovered' ); this._toast( 'Rescue helicopter serviced and returned to the helipad. E at the cabin to fly.' ); this._save(); return true;
	}
	marker() { return { x: this.flight.position.x, z: this.flight.position.z, heading: this.flight.yaw, label: 'Rescue helicopter' }; }
	view() { return { name: 'Coastal rescue helicopter', piloted: this.piloted, hp: Math.round( this.hp ), altitude: Math.round( this.flight.position.y ), agl: Math.round( this.flight.agl ), speed: Math.round( Math.hypot( this.flight.velocity.x, this.flight.velocity.z ) * 3.6 ), verticalSpeed: this.flight.velocity.y, rpm: this.flight.rpm, grounded: this.flight.grounded, systems: this.systems.toJSON(), running: this.systems.running, starting: this.systems.starting > 0, hold: !! this.systems.hold, warnings: this.systems.warnings.slice(), home: { x: this.home.x, y: this.home.y, z: this.home.z }, controls: CONTROLS }; }
	hidesDriver() { return this.piloted && this.app.player?.view === 'first'; }
	isOpen() { return !! this.cockpit.open; }
	close() { this.cockpit.close(); }
	wantsMouse() { return this.piloted; }
	decorateState( out ) {
		const f = this.flight, p = f.position, q = f.quaternion;
		out.helicopter = { p: [ p.x, p.y, p.z ], q: [ q.x, q.y, q.z, q.w ], rpm: f.rpm, piloted: this.piloted, homeSlot: this.homeSlot, lights: this.systems.lightsMask };
		return out;
	}
	updateRemote( states, { complete = false } = {} ) {
		if ( ! states ) return;
		const list = states instanceof Map ? [ ...states ].map( ( [ id, s ] ) => ( { id, helicopter: s?.helicopter || s?.state?.helicopter || s?.extra?.helicopter } ) ) : states;
		this._assignHome( list ); this.remote.localId = this._slotOwner;
		const fresh = [];
		// Colyseus state messages contain only changed peers. Absence means removal
		// only for an explicit full membership snapshot (feature.update's peer map).
		if ( complete ) {
			const present = new Set( list.map( s => s?.id ) );
			for ( const [ id, r ] of this.remote.peers ) if ( ! present.has( id ) ) { r.visual?.dispose(); this.remote.peers.delete( id ); }
		}
		for ( const s of list ) {
			const h = s?.helicopter;
			if ( s?.id === this._slotOwner ) continue;
			if ( ! s?.id || ! h || ! Array.isArray( h.p ) || h.p.length !== 3 || ! Array.isArray( h.q ) || h.q.length !== 4 || ! [ ...h.p, ...h.q ].every( Number.isFinite ) || h.p.some( v => Math.abs( v ) > 50000 ) || ! Number.isFinite( Math.hypot( ...h.q ) ) || Math.hypot( ...h.q ) < 0.5 ) {
				const old = this.remote.peers.get( s?.id ); old?.visual?.dispose(); this.remote.peers.delete( s?.id ); continue;
			}
			if ( Number.isInteger( h.homeSlot ) && h.homeSlot >= 0 && h.homeSlot < 16 ) this._padAt( h.homeSlot );
			fresh.push( { id: s.id, plane: { p: h.p, q: h.q, thr: clamp( h.rpm || 0, 0, 1 ), af: 'helicopter' } } );
		}
		this.remote.ingest( fresh );
		for ( const s of list ) { const r = this.remote.peers.get( s?.id ); if ( r ) { r.lights = Number.isFinite( s.helicopter?.lights ) ? clamp( Math.round( s.helicopter.lights ), 0, 15 ) : 0; r.visual?.setLights?.( r.lights ); if ( r.visual ) r.visual.remoteRPM = clamp( s.helicopter?.rpm || 0, 0, 1 ); } }
	}
	toJSON() { return { v: 1, hp: this.hp, homeSlot: this.homeSlot, pose: this.flight.grounded ? [ this.flight.position.x, this.flight.position.y, this.flight.position.z, this.flight.yaw ] : this.lastLanding.slice(), stats: { ...this.stats }, systems: this.systems.toJSON() }; }
	fromJSON( data ) {
		if ( ! data || typeof data !== 'object' ) return;
		if ( this.app.player?.vehicle === this.vehicle ) this.app.player.exitVehicle?.( this.home.x + 2.4, this.home.y + 0.03, this.home.z, 0, 'walk' );
		this.piloted = false; this.hp = Number.isFinite( data.hp ) ? clamp( data.hp, 0, 100 ) : 100;
		this.systems.fromJSON( data.systems ); this.cockpit.close();
		if ( Number.isInteger( data.homeSlot ) && data.homeSlot >= 0 && data.homeSlot < 16 ) { this.homeSlot = data.homeSlot; this.home = this._padAt( data.homeSlot ); this.homeY = this.home.y; }
		const pose = finitePose( data.pose ) ? data.pose.slice() : [ this.home.x, this.home.y, this.home.z, HOME.yaw ];
		this.flight.place( ...pose ); this.lastLanding = pose;
		// Feature restoration is ordered: citywreck may restore collapsed roofs
		// after this method. Validate parking immediately before the first step.
		this._pendingSupport = pose.slice();
		for ( const k of Object.keys( this.stats ) ) if ( Number.isFinite( data.stats?.[ k ] ) ) this.stats[ k ] = Math.max( 0, Math.floor( data.stats[ k ] ) );
		this._syncVisual( 0 );
	}
	reset() {
		if ( this.app.player?.vehicle === this.vehicle ) this.app.player.exitVehicle?.( this.home.x + 2.4, this.home.y + 0.03, this.home.z, 0, 'walk' );
		// App.startSession resets features BEFORE restoring loaded feature data.
		// This path must never save, emit recovery events or show service notifications.
		this.piloted = false; this.touch.active = false; this._driven = false; this._sinceExit = 1;
		Object.assign( this.flight.controls, { forward: 0, strafe: 0, yaw: 0, lift: 0, brake: false } );
		this.stats = { flights: 0, landings: 0, hardLandings: 0 }; this._parkHome(); this.remote.dispose(); this.hud?.update( this );
	}
	dispose() {
		this._offs.forEach( off => off?.() ); this.remote.dispose(); this.cockpit.dispose(); this.visual?.dispose(); this.audio.dispose(); this.hud?.dispose();
		for ( const light of this.lights ) this.app.localLights?.remove?.( light );
		for ( const pad of this._pads.values() ) {
			pad.visual?.dispose();
			if ( pad.box && this.app.colliders?.boxes ) { const i = this.app.colliders.boxes.indexOf( pad.box ); if ( i >= 0 ) this.app.colliders.boxes.splice( i, 1 ); }
		}
		this._pads.clear();
	}
}

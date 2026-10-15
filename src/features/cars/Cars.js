// The cars feature (wave 21B): Meridian's traffic, parked cars, the police, and every car drivable. See index.js for the
// contract; CarData.js the numbers, CarPhysics.js the handling, CarCollide.js the solid world, RoadGraph.js / Traffic.js
// the city's traffic, CarRender.js the instanced looks, CarAudio.js the sound, DealerPanel.js the showroom.

import { Quaternion, Vector3, Color } from '../../engine/index.js';
import { MERIDIAN, cityPlan } from '../../world/islands/meridian/CityPlan.js';
import { KINDS, SALE_KINDS, TRAFFIC, DAMAGE, WANTED, DEALER, TRAFFIC_MIX, PARKED_MIX, stageOf, impactDamage, wantedLevel, phoneScale, rngFor, pickWeighted, paintFor, hashStr } from './CarData.js';
import { CarBody, quatYPR } from './CarPhysics.js';
import { CarWorld, carCircles } from './CarCollide.js';
import { RoadGraph } from './RoadGraph.js';
import { Traffic } from './Traffic.js';
import { CarAudio } from './CarAudio.js';
import { DealerPanel } from './DealerPanel.js';
import { Mirror, encodeSnapshot } from './CarNet.js';
import { CarCockpit } from './CarCockpit.js';
import { drivetrain } from './CarSystems.js';

const SAVE_VERSION = 1;
const FAR = { x: 1e9, y: - 1e4, z: 1e9 };
const ON_FOOT = [ 'walk', 'deck', 'swim' ];
const MAX_PHYS = 8; // loose cars simulated at once (the rest settle where they are)
const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );
const r2 = ( v ) => Math.round( v * 100 ) / 100;
const _v = { x: 0, y: 0, z: 0 };

export class Cars {

	constructor( app, features, opts = {} ) {

		this.app = app || {};
		this.features = features || null;
		this.opts = opts;
		this.rng = opts.rand || rngFor( opts.seed !== undefined ? opts.seed : ( Date.now() & 0xffffff ) );
		this.scale = opts.scale ?? phoneScale();
		this.T = { ...TRAFFIC, ...( opts.traffic || {} ) };
		this.plan = opts.plan || null; // (lazy: the meridian handle's plan, else cityPlan())
		this.time = 0;
		this.records = []; // every car that is not in the traffic: parked (streamed), idle, own, wrecks, pursuers, the driven one
		this.parked = { live: new Map(), taken: new Map(), at: null, t: 0, spots: null };
		this.drive = null; // the record the player drives
		this.heat = 0;
		this.level = 0;
		this.cityLevel = 0; // citywreck's wanted level (buildings)
		this.graceT = 0; // s after a bust while the police leave you be
		this.coolT = 0;
		this.bustT = 0;
		this.stats = { taken: 0, jacked: 0, wrecked: 0, exploded: 0, busted: 0, pedestrians: 0, bought: 0, crashes: 0 };
		this.touch = { active: false, steer: 0, throttle: 0, brake: 0, handbrake: false, horn: false }; // TouchControls writes these (20D)
		this.lightsOn = null; // null: automatic (night)
		this._nextId = 1;
		this._driven = false;
		this._tip = false;
		this._door = null; this._doorT = - 1;
		this._knocked = new Map();
		this._fx = new Map();
		this._offs = [];
		this._removers = [];
		this._seeded = false;
		this._trafT = 0;
		this._sinceExit = Infinity; // s since the player got out (the door prompt waits half a second)
		this.remote = new Map(); // peer id -> the car a remote player drives (state 'remote')
		this.remoteOwned = new Map(); // peer id -> [ records ]: the cars a remote player owns, parked (state 'remote', locked)
		this.active = false;
		// multiplayer (wave 22A, netsync/CarLink.js): 'solo' | 'host' (runs the traffic and the police for everybody) | 'puppet'
		// (draws the host's cars from its snapshots: this.mirror); netViewers / netTargets: the guests near the city and the
		// wanted ones ( { id, x, z, vx, vz, level } ), set by CarLink on the host
		this.netRole = 'solo';
		this.mirror = new Mirror( this );
		this.netViewers = [];
		this.netTargets = [];
		this.siren = false; // a police car you drive: H twice quickly (the touch cluster's Siren)
		this._localNear = false;

		this.world = new CarWorld( opts.colliders !== undefined ? opts.colliders : this.app.colliders || null, {
			terrain: opts.terrain !== undefined ? opts.terrain : this.app.terrainData || null,
			roadHeight: ( x, z ) => this._roadHeight( x, z ),
			destruction: () => this._get( 'destruction' ),
		} );
		this.graph = new RoadGraph( this.cityPlan.roads, { signal: this.T.signal } );
		this.traffic = new Traffic( this.graph, {
			rng: this.rng, T: this.T,
			groundY: ( x, z ) => this._roadY( x, z ),
			onHonk: ( c ) => this._honked( c ),
		} );
		this.audio = new CarAudio( this.app );
		this.panel = new DealerPanel( this );
		this.cockpit = new CarCockpit( this );
		this.render = null;
		if ( opts.render !== false && this.app.scene && this.app.scene.add ) {

			import( './CarRender.js' ).then( ( m ) => { if ( ! this._disposed ) this.render = new m.CarRender( this.app.scene ); } ).catch( ( e ) => console.warn( 'cars: no render', e ) );

		}

		// the driven car's headlamps (LocalLights sources: installFeatures hands them to the scene)
		this.lights = [ 1, - 1 ].map( ( s ) => ( {
			id: 'car-head-' + ( s > 0 ? 'l' : 'r' ), kind: 'car', position: new Vector3(), dir: new Vector3( 0, 0, 1 ), color: new Color( 1, 0.92, 0.78 ),
			intensity: 70, range: 42, enabled: false, cosInner: Math.cos( 0.2 ), cosOuter: Math.cos( 0.55 ), side: s, update() { /* moved by the feature */ },
		} ) );

		this.quaternion = new Quaternion();
		this.vehicle = {
			kind: 'car',
			quaternion: this.quaternion,
			seat: [ 0.38, 0.32, - 0.15 ], eye: [ 0.38, 1.22, - 0.1 ], focus: [ 0, 1.3, 0 ], chase: 7.5,
			toWorld: ( l, out ) => {

				const b = this.drive && this.drive.body;
				if ( ! b ) return out;
				b.toWorld( l.x ?? l[ 0 ], l.y ?? l[ 1 ], l.z ?? l[ 2 ], _v );
				out.x = _v.x; out.y = _v.y; out.z = _v.z;
				return out;

			},
			drive: ( dt ) => this._drive( dt ),
			exit: () => this.exit(),
			prompt: () => ( this.drive && this.drive.body && Math.abs( this.drive.body.speed ) < 3 ? 'Get out' : null ),
			speed: () => ( this.drive && this.drive.body ? Math.abs( this.drive.body.speed ) : 0 ),
			heading: () => ( this.drive && this.drive.body ? this.drive.body.yaw : 0 ),
			seaLevel: () => - 1000,
		};

		const f = this.features;
		if ( f && f.on ) {

			this._offs.push( f.on( 'roadBlocked', ( e ) => this.traffic.block( edgesOf( e ) ) ) );
			this._offs.push( f.on( 'roadCleared', ( e ) => this.traffic.unblock( edgesOf( e ) ) ) );
			// (whose blast it was decides whether the wrecks count against the player: the law, _staged)
			this._offs.push( f.on( 'explosion', ( e ) => { if ( ! this._selfBlast ) this.blast( e.x, e.y, e.z, e.radius || 6, e.energy || 100000, 'explosion', e.by === 'player' ); } ) );
			this._offs.push( f.on( 'cannonballImpact', ( e ) => { if ( e && e.hit !== 'water' ) this.blast( e.x, e.y, e.z, 3, e.energy || 40000, 'cannon', e.owner === 'player' ); } ) );
			this._offs.push( f.on( 'remoteWorldEvent', ( e ) => this._onRemote( e || {} ) ) );
			// 21C: the damage you do to the city's buildings has its own wanted level; the police answer the higher of the two
			this._offs.push( f.on( 'cityWanted', ( e ) => { this.cityLevel = clamp( ( e && e.level ) | 0, 0, 5 ); } ) );
			// a gun fired in the city with a patrol in sight (the firearms feature's shot; the navy's and the pirates' own guns are theirs)
			this._offs.push( f.on( 'gunFired', ( e ) => { if ( e && e.by === 'player' && this._localNear && Number.isFinite( e.x ) && this._policeNear( e.x, e.z, WANTED.sight ) ) this._addHeat( WANTED.gain.shot, 'shot' ); } ) );
			// a collapse's debris falls on the cars below
			this._offs.push( f.on( 'cityDebris', ( e ) => { if ( e && ! e.remote ) this.blast( e.x, e.y, e.z, e.radius || 6, Math.min( e.energy || 0, 400000 ), 'debris' ); } ) );

		}

		if ( f && f.interactable ) {

			this._removers.push( f.interactable( {
				id: 'car-door', radius: 2.6,
				position: () => { const d = this._doorCandidate(); return d ? d.door : FAR; },
				when: () => ! this.drive && this._onFoot() && this._sinceExit > 0.5 && !! this._doorCandidate(), // (not the E that got you out)
				prompt: () => { const d = this._doorCandidate(); return d ? this._doorPrompt( d.rec ) : null; },
				onInteract: () => { const d = this._doorCandidate(); if ( d ) this.enter( d.rec ); },
			} ) );
			this._removers.push( f.interactable( {
				id: 'car-dealer', radius: DEALER.reach,
				position: () => this.dealerSpot(),
				when: () => ! this.drive,
				prompt: () => 'Meridian Motors · cars for sale',
				onInteract: () => this.panel.open(),
			} ) );

		}

	}

	// ------------------------------------------------------------------ collaborators

	_get( name ) {

		return this.opts[ name ] || ( this.features && this.features.get ? this.features.get( name ) : null );

	}

	get cityPlan() {

		if ( ! this.plan ) {

			const m = this._meridian();
			this.plan = ( m && m.plan ) || cityPlan();

		}

		return this.plan;

	}

	_meridian() {

		return this.opts.meridian || this.app.meridian || ( this.features && this.features.get ? this.features.get( 'meridian' ) : null ) || null;

	}

	_roadHeight( x, z ) {

		if ( this.opts.roadHeight ) return this.opts.roadHeight( x, z );
		const m = this._meridian();
		if ( m && m.roadHeight ) return m.roadHeight( x, z );
		// (no builder handle yet: the island's terrain tile knows its graded roads: MeridianTerrain.roadHeight)
		const t = this.world.terrain, tile = t && t._outerTiles ? t._outerTiles.find( ( q ) => q.id === MERIDIAN.id ) : null;
		if ( tile && tile.roadHeight && Math.abs( x - MERIDIAN.center.x ) < 900 && Math.abs( z - MERIDIAN.center.z ) < 900 ) return tile.roadHeight( x, z );
		return null;

	}

	_roadY( x, z ) {

		const r = this._roadHeight( x, z );
		if ( Number.isFinite( r ) ) return r;
		const t = this.world.terrain;
		return t && t.heightAt && ! this.opts.flatRoads ? t.heightAt( x, z ) : null;

	}

	get state() { return this.features ? this.features.state : null; }
	get sandbox() { return !! ( this.features && this.features.sandbox ); }
	get driving() { return !! this.drive; }

	// the driver is not drawn in a car (the cabins are too small for the islanders; App patch: avatar.visible)
	hidesDriver() { return !! this.drive; }

	isOpen() { return this.panel.isOpen || this.cockpit.isOpen; }
	close() { this.panel.close(); this.cockpit.close(); }
	wantsMouse() { return this.cockpit.firstPerson && !! this.cockpit.hover; }
	cockpitAct( id ) { return this.cockpit.act( id ); }

	_toast( text, ms = 3000 ) {

		const g = this.app.game;
		if ( g && g.toast ) g.toast( text, ms );

	}

	_emit( name, payload ) {

		if ( this.features && this.features.emit ) this.features.emit( name, payload );

	}

	_share( kind, data ) {

		const ns = this.app.netsync;
		if ( ns && ns.sendWorldEvent ) try { ns.sendWorldEvent( kind, data ); } catch ( e ) { /* offline */ }

	}

	_onFoot() {

		const p = this.app.player;
		return !! p && ON_FOOT.includes( p.mode );

	}

	playerPos() {

		if ( this.drive ) return this.drive;
		const p = this.app.player;
		return p && p.position ? p.position : null;

	}

	get night() {

		const h = this.app.settings ? this.app.settings.timeOfDay : null;
		return typeof h === 'number' && ( h >= 19.5 || h < 6 );

	}

	// ------------------------------------------------------------------ records

	_record( kind, { x = 0, y = 0, z = 0, yaw = 0, color = null, state = 'idle', driver = false, id = null, hp = null } = {} ) {

		const spec = KINDS[ kind ] || KINDS.sedan;
		const maxHp = 100 * spec.tough;
		const rec = {
			id: id || 'c' + ( this._nextId ++ ), kind: KINDS[ kind ] ? kind : 'sedan', spec, color: color ?? paintFor( kind, this.rng() ),
			x, y, z, yaw, pitch: 0, roll: 0, quat: { x: 0, y: 0, z: 0, w: 1 }, bump: 0, steer: 0, spin: 0, speed: 0,
			state, driver, own: false, body: null, ai: null, hp: hp ?? maxHp, maxHp, stage: 0, lights: false,
			fuseT: 0, charT: 0, resumeT: 0, idleT: 0, spot: null, pursue: null,
		};
		quatYPR( rec.yaw, 0, 0, rec.quat );
		return rec;

	}

	_bodyFor( rec ) {

		if ( ! rec.body ) {

			rec.body = new CarBody( rec.spec, { x: rec.x, y: rec.y, z: rec.z, yaw: rec.yaw } );
			const v = rec.ai ? rec.ai.v : rec.speed || 0;
			rec.body.vx = Math.sin( rec.yaw ) * v;
			rec.body.vz = Math.cos( rec.yaw ) * v;

		}

		return rec.body;

	}

	_syncFromBody( rec ) {

		const b = rec.body;
		if ( ! b ) return;
		rec.x = b.x; rec.y = b.y; rec.z = b.z;
		rec.yaw = b.yaw; rec.pitch = b.pitch; rec.roll = b.roll;
		rec.steer = b.steer; rec.spin = b.spin; rec.bump = b.bump; rec.speed = b.speed;

	}

	// a traffic car (or a parked one) knocked loose: it becomes a free body
	_loosen( rec ) {

		if ( rec.state === 'traffic' ) this.traffic.remove( rec );
		if ( rec.state === 'parked' ) this._unpark( rec );
		this._bodyFor( rec );
		rec.ai = null;
		if ( ! this.records.includes( rec ) ) this.records.push( rec );
		if ( rec.state === 'traffic' || rec.state === 'parked' ) rec.state = 'idle';
		rec.resumeT = 4;
		return rec;

	}

	_unpark( rec ) {

		if ( rec.spot !== null && this.parked.live.get( rec.spot ) === rec ) {

			this.parked.live.delete( rec.spot );
			this.parked.taken.set( rec.spot, this.time + 3600 );
			this._parkedGone( rec.spot );

		}

		rec.spot = null;

	}

	_drop( rec ) {

		const i = this.records.indexOf( rec );
		if ( i >= 0 ) this.records.splice( i, 1 );
		if ( rec.state === 'traffic' ) this.traffic.remove( rec );
		this._stopFx( rec );

	}

	// ------------------------------------------------------------------ getting in and out

	// the car door nearest the player on foot (a parked car, an idle one, your own, a traffic car that is stopped)
	_doorCandidate() {

		if ( this._doorT === this.time && this._doorFrame === this._frame ) return this._door;
		this._doorT = this.time;
		this._doorFrame = this._frame;
		this._door = null;
		const p = this.app.player;
		if ( ! p || ! p.position || this.drive ) return null;
		let best = null, bd = 2.6;
		const test = ( rec ) => {

			if ( rec.stage >= 3 || rec.state === 'wreck' || rec.state === 'player' ) return;
			if ( Math.abs( rec.x - p.position.x ) > 9 || Math.abs( rec.z - p.position.z ) > 9 ) return;
			if ( rec.state === 'traffic' && rec.ai && rec.ai.v > 2 ) return;
			// another player's car (driven and stopped, or parked): its door answers, locked; the host's cars when stopped
			if ( ( rec.state === 'remote' || rec.state === 'mirror' ) && Math.abs( rec.speed || 0 ) > 2 ) return;
			if ( rec.state === 'pursuit' && rec.body && Math.abs( rec.body.speed ) > 2 ) return;
			const S = rec.spec;
			const c = Math.cos( rec.yaw ), s = Math.sin( rec.yaw );
			const lx = S.wid / 2 + 0.55, lz = S.seat[ 2 ];
			const dx = rec.x + lx * c + lz * s, dz = rec.z - lx * s + lz * c;
			const d = Math.hypot( dx - p.position.x, dz - p.position.z );
			if ( d < bd ) { bd = d; best = { rec, door: { x: dx, y: rec.y + 0.2, z: dz } }; }

		};
		for ( const r of this.records ) test( r );
		for ( const r of this.traffic.cars ) test( r );
		for ( const r of this.mirror.records.values() ) test( r );
		for ( const r of this.remote.values() ) test( r );
		for ( const list of this.remoteOwned.values() ) for ( const r of list ) test( r );
		this._door = best;
		return best;

	}

	_doorPrompt( rec ) {

		const name = rec.spec.name.toLowerCase();
		if ( rec.state === 'remote' ) return `${ rec.ownerName || 'Another player' }'s ${ name } · locked`;
		if ( rec.own ) return `Drive your ${ name }`;
		if ( rec.driver ) return rec.kind === 'police' ? 'Take the police car' : `Take the ${ name } (the driver gets out)`;
		return `Take the ${ name }`;

	}

	// get in and drive: your own car, any parked or idle one, or a stopped one with its driver thrown out (wanted)
	enter( rec ) {

		const p = this.app.player;
		if ( ! rec || this.drive || ! p || ! p.enterVehicle ) return { ok: false, reason: 'cannot' };
		if ( rec.stage >= 3 || rec.state === 'wreck' ) return { ok: false, reason: 'wreck' };
		// another player's car is his: refused (wave 22A)
		if ( rec.state === 'remote' ) {

			this._toast( `That is ${ rec.ownerName || 'another player' }'s car · it is locked`, 2400 );
			this._emit( 'carRefused', { id: rec.id, owner: rec.owner || null } );
			return { ok: false, reason: 'owned' };

		}

		// one of the host's cars (a guest): it becomes this client's own record, and the host's goes
		if ( rec.state === 'mirror' ) rec = this._fromMirror( rec );
		const was = rec.state, how = rec.own ? 'own' : rec.driver ? 'jack' : was === 'parked' ? 'parked' : 'idle';
		if ( was === 'traffic' ) this.traffic.remove( rec );
		if ( was === 'parked' ) this._unpark( rec );
		rec.ai = null;
		if ( ! this.records.includes( rec ) ) this.records.push( rec );
		this._bodyFor( rec );
		rec.body.vx = rec.body.vz = 0;
		// the law: a driver thrown out, a car alarm, a police car seen taken
		if ( how === 'jack' ) {

			this.stats.jacked ++;
			this._addHeat( WANTED.gain.jack + ( rec.kind === 'police' ? WANTED.gain.police : 0 ), 'jack' );
			this._toast( rec.kind === 'police' ? 'The officer scrambles out · the city will want you for this' : 'The driver scrambles out and runs', 3200 );
			this._scare( rec.x, rec.z, 14 );
			this._emit( 'carJacked', { id: rec.id, kind: rec.kind, x: r2( rec.x ), z: r2( rec.z ) } );

		} else if ( how === 'parked' || ( how === 'idle' && ! rec.own && ! rec.mine ) ) {

			// a stranger's car: a crime only when the police know of it (the alarm within a patrol's earshot, the taking
			// within its sight); with nobody about the alarm whoops and that is all
			if ( this.rng() < WANTED.alarmChance ) {

				this._toast( 'A car alarm whoops', 2000 );
				if ( this._policeNear( rec.x, rec.z, WANTED.earshot ) ) this._addHeat( WANTED.gain.alarm, 'alarm' );

			}

			if ( this._policeNear( rec.x, rec.z, WANTED.witness ) ) this._addHeat( WANTED.gain.parked, 'seen' );

		}

		rec.driver = false;
		rec.state = 'player';
		rec.mine = true; // (taken: no alarm when you get back in)
		this.drive = rec;
		rec.engineOn ??= true;
		rec.parkBrake ??= false;
		this._hornPulse = 0; this._horn = this._hornWas = false;
		this.stats.taken ++;
		const S = rec.spec, v = this.vehicle;
		v.seat = S.seat; v.eye = S.eye; v.chase = S.chase; v.focus = [ 0, Math.min( 2.2, S.hgt * 0.85 ), 0 ];
		this._syncQuat( rec );
		p.enterVehicle( v );
		this.cockpit.setRecord( rec );
		this._emit( 'carEntered', { id: rec.id, kind: rec.kind, own: rec.own, how } );
		if ( ! this._tip ) {

			this._tip = true;
			this._toast( 'W/S drive · A/D steer · Space handbrake · H horn · L lamps · V camera · 3 dashboard · E exit', 4600 );

		}

		return { ok: true, how };

	}

	_fromMirror( m ) {

		const key = this.mirror.take( m );
		const rec = this._record( m.kind, { x: m.x, y: m.y, z: m.z, yaw: m.yaw, color: m.color, state: 'idle', driver: !! m.driver } );
		rec.stage = Math.min( 2, m.stage | 0 );
		rec.hp = rec.maxHp * [ 1, 0.6, 0.35 ][ rec.stage ];
		this.records.push( rec );
		if ( key ) this._share( 'carTaken', { id: key } );
		return rec;

	}

	exit( { force = false } = {} ) {

		const rec = this.drive, p = this.app.player;
		if ( ! rec ) return false;
		const b = rec.body;
		if ( ! force && b && Math.abs( b.speed ) > 3 ) {

			this._toast( 'Slow down to get out', 1600 );
			return false;

		}

		this.drive = null;
		this.cockpit.setRecord( null );
		this._hornPulse = 0; this._horn = this._hornWas = false;
		this._sinceExit = 0;
		this.siren = false;
		rec.state = rec.stage >= 4 ? 'wreck' : 'idle';
		rec.lights = false;
		for ( const l of this.lights ) l.enabled = false;
		this.audio.update( 0, { on: false } );
		if ( p && p.exitVehicle ) {

			const S = rec.spec, c = Math.cos( rec.yaw ), s = Math.sin( rec.yaw );
			const lx = S.wid / 2 + 0.7, lz = S.seat[ 2 ];
			const x = rec.x + lx * c + lz * s, z = rec.z - lx * s + lz * c;
			const g = this.world.ground( x, z, rec.y + 1.5 );
			if ( g < - 0.6 ) p.exitVehicle( x, - 0.2, z, rec.yaw, 'swim', 0 );
			else p.exitVehicle( x, Math.max( g, rec.y - 0.5 ), z, rec.yaw + Math.PI / 2, 'walk' );

		}

		this._emit( 'carExited', { id: rec.id, kind: rec.kind } );
		return true;

	}

	// ------------------------------------------------------------------ driving

	_input() {

		const inp = this.app.input, f = this.features;
		const out = { throttle: 0, brake: 0, steer: 0, handbrake: false, horn: false };
		if ( f && f.panelOpen && f.panelOpen() ) return out;
		const d = ( c ) => !! ( inp && inp.down && inp.down( c ) );
		out.throttle = d( 'KeyW' ) || d( 'ArrowUp' ) ? 1 : 0;
		out.brake = d( 'KeyS' ) || d( 'ArrowDown' ) ? 1 : 0;
		out.steer = ( d( 'KeyA' ) || d( 'ArrowLeft' ) ? 1 : 0 ) - ( d( 'KeyD' ) || d( 'ArrowRight' ) ? 1 : 0 );
		out.handbrake = d( 'Space' );
		out.horn = d( 'KeyH' );
		const t = this.touch;
		if ( t && t.active ) {

			out.throttle = Math.max( out.throttle, clamp( t.throttle || 0, 0, 1 ) );
			out.brake = Math.max( out.brake, clamp( t.brake || 0, 0, 1 ) );
			if ( t.steer ) out.steer = clamp( t.steer, - 1, 1 );
			out.handbrake = out.handbrake || !! t.handbrake;
			out.horn = out.horn || !! t.horn;

		}

		const pad = padNow();
		if ( pad ) {

			if ( Math.abs( pad.steer ) > 0.05 ) out.steer = - pad.steer;
			out.throttle = Math.max( out.throttle, pad.throttle );
			out.brake = Math.max( out.brake, pad.brake );

		}

		return out;

	}

	// the player's car: called by Player.updatePlane before it places the camera (and by update() when it did not run)
	_drive( dt ) {

		const rec = this.drive;
		if ( ! rec ) return;
		this._driven = true;
		const b = this._bodyFor( rec );
		const input = this.app.input;
		if ( input?.hit?.( 'Digit3' ) && ! this.cockpit.blocked() ) {

			if ( this.cockpit.isOpen ) this.cockpit.close(); else this.cockpit.open();

		}
		const inp = { ...( this.opts.input ? this.opts.input() : this._input() ) };
		inp.engineOn = rec.engineOn !== false && rec.stage < 4 && rec.hp > 0;
		if ( ! inp.engineOn ) inp.throttle = 0;
		if ( rec.parkBrake ) { inp.handbrake = true; inp.throttle = 0; inp.brake = 0; }
		inp.horn = inp.horn || this._hornPulse > 0;
		this._hornPulse = Math.max( 0, ( this._hornPulse || 0 ) - dt );
		this._horn = !! inp.horn;
		// a police car's siren: the horn twice within 0.4 s
		if ( inp.horn && ! this._hornWas ) {

			if ( rec.kind === 'police' && this.time - ( this._hornAt ?? - 9 ) < 0.4 ) this.toggleSiren();
			this._hornAt = this.time;

		}

		this._hornWas = !! inp.horn;
		this._stepBody( rec, dt, inp );
		this._syncQuat( rec );
		// in the sea: the car is lost, you swim
		const g = this.world.ground( b.x, b.z, b.y + 1 );
		if ( g < - 0.8 && b.y < - 0.6 ) {

			this._toast( 'The car sinks · you swim clear', 3000 );
			this.exit( { force: true } );
			rec.state = 'wreck';
			rec.hp = 0;
			rec.stage = 4;
			rec.sunk = true;
			rec.charT = 20;
			return;

		}

		this._pedestrians( rec, dt );

	}

	// one physical car's step: the solid world, the other cars, its impacts
	_stepBody( rec, dt, input ) {

		const b = this._bodyFor( rec );
		const others = this._near( rec, 14 );
		const self = this;
		const world = {
			ground: ( x, z, y ) => self.world.ground( x, z, y ),
			collide: ( body, h ) => {

				const hits = self.world.collide( body, h );
				for ( const o of others ) self._contact( rec, o, hits );
				return hits;

			},
		};
		b.step( dt, input, world );
		this._syncFromBody( rec );
		for ( const e of b.impacts ) {

			const dmg = impactDamage( e.speed, rec.spec.tough );
			if ( dmg > 0 ) this.damage( rec, dmg, e.what );
			if ( e.speed > 2.5 ) {

				this.audio.crash( Math.min( 1, e.speed / 18 ), e.x, rec.y + 0.6, e.z );
				if ( rec === this.drive ) {

					this.stats.crashes ++;
					const cf = this.app.cameraFeel;
					if ( cf && cf.kick ) try { cf.kick( 'hit', { scale: Math.min( 2, e.speed / 10 ) } ); } catch ( err ) { /* optional */ }

				}

			}

		}

	}

	// cars within r of a record (traffic and the rest), for contacts
	_near( rec, r ) {

		const out = [];
		const scan = ( o ) => { if ( o !== rec && Math.abs( o.x - rec.x ) < r && Math.abs( o.z - rec.z ) < r ) out.push( o ); };
		for ( const o of this.traffic.cars ) scan( o );
		for ( const o of this.records ) scan( o );
		// the other players' cars and the host's puppets are solid too (immovable here: their own machines move them)
		for ( const o of this.mirror.records.values() ) scan( o );
		for ( const o of this.remote.values() ) scan( o );
		for ( const list of this.remoteOwned.values() ) for ( const o of list ) scan( o );
		return out;

	}

	// two cars touching: circles along each; push apart, trade momentum, dent both
	_contact( rec, o, hits ) {

		const b = rec.body, S = rec.spec, O = o.spec;
		const ca = b._circles || ( b._circles = carCircles( S ) ), cb = o._circ || ( o._circ = carCircles( O ) );
		const fa = { x: Math.sin( b.yaw ), z: Math.cos( b.yaw ) }, fb = { x: Math.sin( o.yaw ), z: Math.cos( o.yaw ) };
		let best = null;
		for ( const [ za, ra ] of ca ) for ( const [ zb, rb ] of cb ) {

			const ax = b.x + fa.x * za, az = b.z + fa.z * za, bx = o.x + fb.x * zb, bz = o.z + fb.z * zb;
			const dx = ax - bx, dz = az - bz, d = Math.hypot( dx, dz ), pen = ra + rb - d;
			if ( pen > 0 && ( ! best || pen > best.pen ) ) best = { pen, nx: d > 1e-4 ? dx / d : 1, nz: d > 1e-4 ? dz / d : 0, x: ( ax + bx ) / 2, z: ( az + bz ) / 2 };

		}

		if ( ! best ) return;
		const fixed = o.state === 'remote' || o.state === 'mirror';
		const m1 = S.mass, m2 = O.mass * ( o.body ? 1 : fixed ? 6 : 1.5 );
		const ov0 = o.ai ? o.ai.v : fixed ? o.speed || 0 : 0;
		const ov = o.body ? { x: o.body.vx, z: o.body.vz } : { x: fb.x * ov0, z: fb.z * ov0 };
		const vrel = ( b.vx - ov.x ) * best.nx + ( b.vz - ov.z ) * best.nz;
		const share = fixed ? 1 : o.body || vrel < - 1.5 ? m2 / ( m1 + m2 ) : 1;
		b.x += best.nx * best.pen * share;
		b.z += best.nz * best.pen * share;
		if ( vrel >= 0 ) return;
		const j = - ( 1.2 ) * vrel / ( 1 / m1 + 1 / m2 );
		b.vx += best.nx * j / m1;
		b.vz += best.nz * j / m1;
		// the other car: shoved loose when hit hard enough
		if ( ! o.body && vrel < - 1.5 && ( o.state === 'traffic' || o.state === 'parked' || o.state === 'idle' || o.state === 'pursuit' ) ) this._loosen( o );
		if ( o.body ) {

			o.body.vx -= best.nx * j / m2;
			o.body.vz -= best.nz * j / m2;
			o.body.x -= best.nx * best.pen * ( 1 - share );
			o.body.z -= best.nz * best.pen * ( 1 - share );

		}

		const sp = - vrel;
		if ( sp > 1 ) {

			hits.push( { speed: sp, x: best.x, z: best.z, nx: best.nx, nz: best.nz, what: 'car', id: o.id } );
			const dmg = impactDamage( sp, O.tough );
			if ( dmg > 0 && rec === this.drive ) o.byPlayer = true; // (a wreck the player's car made counts against him; a pursuer's ramming does not)
			if ( dmg > 0 ) this.damage( o, dmg, 'car' );
			if ( rec === this.drive && sp > 3 ) {

				if ( o.kind === 'police' && ( o.driver || o.state === 'pursuit' ) ) this._addHeat( WANTED.gain.police, 'ramPolice' );
				else if ( o.driver && this._policeNear( o.x, o.z, WANTED.witness ) ) this._addHeat( WANTED.gain.ram, 'ram' );

			}

		}

	}

	_syncQuat( rec ) {

		quatYPR( rec.yaw, rec.pitch, rec.roll, rec.quat );
		if ( rec === this.drive ) this.quaternion.set( rec.quat.x, rec.quat.y, rec.quat.z, rec.quat.w );

	}

	// ------------------------------------------------------------------ the townsfolk in the road (no violence: they dive aside)

	_citizens() {

		const tl = this._get( 'townlife' );
		if ( this.opts.citizens ) return this.opts.citizens();
		if ( ! tl || ! tl.sims ) return [];
		return Object.values( tl.sims ).filter( Boolean );

	}

	_pedestrians( rec, dt ) {

		const b = rec.body, sp = Math.abs( b.speed );
		if ( sp < 1.5 ) return;
		const fx = Math.sin( b.yaw ), fz = Math.cos( b.yaw ), S = rec.spec;
		for ( const sim of this._citizens() ) {

			for ( const c of sim.list || [] ) {

				if ( c.hidden || Math.abs( c.x - b.x ) > 30 || Math.abs( c.z - b.z ) > 30 ) continue;
				const dx = c.x - b.x, dz = c.z - b.z;
				const df = ( dx * fx + dz * fz ) * Math.sign( b.speed || 1 ), dl = Math.abs( dx * fz - dz * fx );
				const last = this._knocked.get( c.id ) || - 99;
				// in the car's path: they run
				if ( df > 0 && df < sp * 1.6 + S.len / 2 && dl < S.wid / 2 + 1.2 && this.time - last > 3 ) {

					if ( sim.alarm ) try { sim.alarm( c.x, c.z, 6, 2.5 ); } catch ( e ) { /* optional */ }
					this._knocked.set( c.id, this.time - 2.5 );

				}

				// struck: knocked aside (a shove off the car's side), and the law minds
				if ( Math.abs( df ) < S.len / 2 + 0.3 && dl < S.wid / 2 + 0.35 && sp > DAMAGE.pedestrian && this.time - last > 2.9 ) {

					const side = ( dx * fz - dz * fx ) >= 0 ? 1 : - 1;
					c.x += fz * side * 2.2 + fx * 0.6; c.z += - fx * side * 2.2 + fz * 0.6;
					this._knocked.set( c.id, this.time );
					this.stats.pedestrians ++;
					this._addHeat( WANTED.gain.pedestrian, 'pedestrian' );
					this.damage( rec, 1.5, 'pedestrian' );
					this._emit( 'pedestrianHit', { id: c.id, name: c.name, x: r2( c.x ), z: r2( c.z ), speed: r2( sp ), by: 'player' } );
					this.audio.crash( 0.25, c.x, b.y + 0.8, c.z );

				}

			}

		}

	}

	// townsfolk near a point run for cover
	_scare( x, z, r ) {

		for ( const sim of this._citizens() ) if ( sim.alarm ) try { sim.alarm( x, z, 20, r ); } catch ( e ) { /* optional */ }

	}

	// a free car (a pursuer, one knocked loose) bowling at the player on foot
	_hitPlayer( rec ) {

		const p = this.app.player, b = rec.body;
		if ( ! p || ! p.position || ! this._onFoot() || ! b || Math.abs( b.speed ) < 4 ) return;
		const dx = p.position.x - b.x, dz = p.position.z - b.z;
		if ( dx * dx + dz * dz > ( rec.spec.len / 2 + 0.4 ) ** 2 || Math.abs( p.position.y - b.y ) > 2 ) return;
		if ( this.time - ( this._hitT || - 9 ) < 2 ) return;
		this._hitT = this.time;
		const d = Math.hypot( dx, dz ) || 1;
		p.position.x += dx / d * 1.6; p.position.z += dz / d * 1.6;
		this._emit( 'playerKnockedDown', { by: 'car', x: p.position.x, z: p.position.z } );

	}

	// ------------------------------------------------------------------ damage, fire, the powder keg

	damage( rec, hp, cause = 'hit' ) {

		if ( ! rec || ! ( hp > 0 ) || rec.stage >= 4 || rec.state === 'remote' || rec.state === 'mirror' ) return rec ? rec.stage : 0;
		rec.hp = Math.max( 0, rec.hp - hp );
		const before = rec.stage;
		rec.stage = stageOf( rec.hp / rec.maxHp );
		if ( rec.stage !== before ) this._staged( rec, before, cause );
		return rec.stage;

	}

	_staged( rec, before, cause ) {

		if ( rec.stage >= 3 && before < 3 && rec === this.drive ) this._toast( 'The engine is on fire · get out!', 3200 );
		if ( rec.stage >= 3 && rec.state === 'traffic' ) {

			// the driver bails out of a burning car
			this._loosen( rec );
			rec.driver = false;
			this._scare( rec.x, rec.z, 12 );

		}

		if ( rec.stage >= 4 ) {

			rec.fuseT = DAMAGE.fuse;
			this.stats.wrecked ++;
			if ( rec.state === 'traffic' ) this._loosen( rec );
			if ( rec !== this.drive ) rec.state = 'wreck';
			rec.driver = false;
			// the law minds the wrecks the player made of others' cars (the one he took, his blasts, the fires they lit), not
			// his own car (bought: his to wreck), the traffic's own pile-ups, a pursuer's ramming, falling rubble or a pirate's ball
			if ( ( this.drive === rec || rec.byPlayer ) && ! rec.own ) this._addHeat( rec.kind === 'police' ? WANTED.gain.police : WANTED.gain.wreck, 'wreck', rec );
			this._emit( 'carWrecked', { id: rec.id, kind: rec.kind, x: r2( rec.x ), z: r2( rec.z ), cause } );

		}

		this._emit( 'carDamaged', { id: rec.id, kind: rec.kind, stage: rec.stage, previous: before, cause } );

	}

	// an area hit (explosions, cannon): cars within radius take damage by distance, the near ones are thrown
	// byPlayer: the player's own blast (a bomb, his gun, his car's wreck going up): the wrecks it makes are his doing
	blast( x, y, z, radius, energy, cause = 'explosion', byPlayer = false ) {

		if ( ! Number.isFinite( x ) || ! ( radius > 0 ) ) return 0;
		let n = 0;
		const R = radius * 1.6;
		for ( const rec of [ ...this.traffic.cars, ...this.records ] ) {

			const d = Math.hypot( rec.x - x, rec.z - z );
			if ( d > R || rec.state === 'remote' ) continue;
			const k = ( 1 - d / R ) ** 2;
			const dmg = energy / 1400 * k;
			if ( dmg < 0.5 ) continue;
			n ++;
			if ( byPlayer ) rec.byPlayer = true;
			this.damage( rec, dmg, cause );
			if ( k > 0.25 && rec.state !== 'player' ) {

				this._loosen( rec );
				const b = rec.body, dd = d || 1;
				b.vx += ( rec.x - x ) / dd * 8 * k; b.vz += ( rec.z - z ) / dd * 8 * k;
				b.vy = 3 * k; b.grounded = false;

			}

		}

		return n;

	}

	_explode( rec ) {

		const D = DAMAGE.explosion;
		this.stats.exploded ++;
		rec.charT = DAMAGE.charred;
		rec.exploded = true;
		const x = rec.x, y = rec.y + 0.6, z = rec.z;
		if ( this.drive === rec ) {

			this.exit( { force: true } );
			this._emit( 'playerKnockedDown', { by: 'carExplosion', x, z } );

		} else {

			const p = this.app.player;
			if ( p && p.position && this._onFoot() && Math.hypot( p.position.x - x, p.position.z - z ) < D.hurt ) this._emit( 'playerKnockedDown', { by: 'carExplosion', x, z } );

		}

		const vfx = this._get( 'vfx' );
		if ( vfx && vfx.explosion ) try { vfx.explosion( x, y, z, 1.2 ); } catch ( e ) { /* optional */ }
		this.audio.crash( 1, x, y, z );
		this._scare( x, z, 40 );
		this._selfBlast = true;
		this._emit( 'explosion', { x, y, z, radius: D.radius, energy: D.energy, by: 'car' } );
		this._selfBlast = false;
		this._emit( 'carExploded', { id: rec.id, kind: rec.kind, x: r2( x ), z: r2( z ) } );
		this._share( 'carExploded', { x: r2( x ), y: r2( y ), z: r2( z ) } );
		const dest = this._get( 'destruction' );
		if ( dest && dest.impulse ) try { dest.impulse( x, y, z, D.radius, D.energy ); } catch ( e ) { /* optional */ }
		// the cars round it (a chain of powder kegs; the player's doing when the keg was his)
		this.blast( x, y, z, D.radius, D.energy * 0.6, 'explosion', !! ( rec.byPlayer || rec.mine ) );

	}

	_damageTick( dt ) {

		for ( const rec of [ ...this.records ] ) {

			if ( rec.stage === 3 ) this.damage( rec, DAMAGE.burn * dt * rec.spec.tough, 'fire' );
			if ( rec.stage >= 4 && ! rec.exploded && ! rec.sunk ) {

				rec.fuseT -= dt;
				if ( rec.fuseT <= 0 ) this._explode( rec );

			} else if ( rec.exploded || rec.sunk ) {

				rec.charT -= dt;
				if ( rec.charT <= 0 ) {

					if ( rec.own ) this._toast( `Your ${ rec.spec.name.toLowerCase() } is a write-off`, 3000 );
					this._drop( rec );

				}

			}

		}

	}

	// smoke from a smashed engine, fire from a burning or blown car
	_effects( dt, view ) {

		const vfx = this._get( 'vfx' );
		if ( ! vfx ) return;
		for ( const rec of this.records ) {

			const live = rec.stage >= 2 && ! rec.sunk && ( ! rec.exploded || rec.charT > DAMAGE.charred - 25 );
			const near = view && Math.abs( rec.x - view.x ) < 300 && Math.abs( rec.z - view.z ) < 300;
			const key = 'car:' + rec.id;
			if ( ! live || ! near ) { this._stopFx( rec ); continue; }
			const S = rec.spec, fx = Math.sin( rec.yaw ), fz = Math.cos( rec.yaw );
			const hx = rec.x + fx * S.len * 0.35, hz = rec.z + fz * S.len * 0.35, hy = rec.y + S.hgt * 0.7;
			let e = this._fx.get( key );
			if ( ! e ) this._fx.set( key, e = { t: 0, fire: false } );
			e.t -= dt;
			if ( e.t <= 0 ) {

				e.t = 0.3;
				if ( vfx.smoke ) try { vfx.smoke( hx, hy, hz, rec.stage >= 3 ? 0.7 : 0.35, 0, 1, 0 ); } catch ( err ) { /* optional */ }

			}

			if ( rec.stage >= 3 && vfx.fire ) {

				try { vfx.fire( key, hx, hy - 0.2, hz, rec.exploded ? 0.9 : 0.55 ); } catch ( err ) { /* optional */ }
				e.fire = true;

			}

		}

	}

	_stopFx( rec ) {

		const key = 'car:' + rec.id, e = this._fx.get( key );
		if ( ! e ) return;
		const vfx = this._get( 'vfx' );
		if ( e.fire && vfx && vfx.stopFire ) try { vfx.stopFire( key ); } catch ( err ) { /* optional */ }
		this._fx.delete( key );

	}

	// ------------------------------------------------------------------ the law

	_addHeat( n, why, rec = null ) {

		if ( ! ( n > 0 ) || this.sandbox && this.opts.lawInSandbox === false ) return;
		this.heat = Math.min( 100, this.heat + n );
		this.coolT = 0;
		this._levelCheck( why );
		void rec;

	}

	_levelCheck( why = '' ) {

		const lv = wantedLevel( this.heat );
		if ( lv === this.level ) return;
		const prev = this.level;
		this.level = lv;
		if ( lv > prev ) this._toast( lv === 1 ? 'The city police want a word with you' : `Wanted · level ${ lv }`, 2600 );
		else if ( lv === 0 ) this._toast( 'The police lost interest', 2400 );
		this._emit( 'carWanted', { level: lv, previous: prev, heat: Math.round( this.heat ), why } );
		this._share( 'carWanted', { level: lv } );

	}

	_policeNear( x, z, r ) {

		for ( const c of this.traffic.cars ) if ( c.kind === 'police' && Math.abs( c.x - x ) < r && Math.abs( c.z - z ) < r && Math.hypot( c.x - x, c.z - z ) < r ) return c;
		for ( const c of this.records ) if ( c.kind === 'police' && c.state === 'pursuit' && Math.hypot( c.x - x, c.z - z ) < r ) return c;
		for ( const c of this.mirror.records.values() ) if ( c.kind === 'police' && c.driver && Math.abs( c.x - x ) < r && Math.abs( c.z - z ) < r && Math.hypot( c.x - x, c.z - z ) < r ) return c;
		return null;

	}

	_lawUpdate( dt, pos ) {

		if ( ! pos ) return;
		// a known face: the navy's wanted list and a pirate's notoriety reach the city's police when one sees you
		if ( this.heat < 20 && this._policeNear( pos.x, pos.z, 60 ) ) {

			const nv = this._get( 'navy' ), pr = this._get( 'pirates' );
			let known = false;
			try { known = ( nv && nv.isWanted && nv.isWanted() ) || ( pr && pr.notorietyLevel && pr.notorietyLevel() >= 4 ); } catch ( e ) { known = false; }
			if ( known ) { this.heat = 20; this._levelCheck( 'known' ); }

		}

		const puppet = this.netRole === 'puppet';
		// the police cars after somebody: the host's own pursuers, or (a guest) the host's ones as puppets
		const pursuers = puppet ? [] : this.records.filter( ( r ) => r.state === 'pursuit' );
		const chasers = puppet ? [ ...this.mirror.records.values() ].filter( ( r ) => r.pursuit && r.kind === 'police' ) : pursuers;
		this.graceT = Math.max( 0, this.graceT - dt );
		const near = this._localNear;
		// the city's police keep to the city: away from Meridian (at sea, on another island) the chase is over for you and the
		// heat cools as if out of sight; nothing is spawned, nobody is busted
		if ( ! near ) {

			this.bustT = 0;
			if ( this.heat > 0 ) {

				this.coolT = Math.max( this.coolT + dt, WANTED.cool );
				this.heat = Math.max( 0, this.heat - WANTED.decay * dt );
				this._levelCheck( 'away' );

			}

		} else if ( this.heat > 0 ) {

			const seen = chasers.some( ( r ) => Math.hypot( r.x - pos.x, r.z - pos.z ) < WANTED.sight );
			if ( seen ) this.coolT = 0;
			else this.coolT += dt;
			if ( this.coolT > WANTED.cool ) this.heat = Math.max( 0, this.heat - WANTED.decay * dt );
			this._levelCheck( 'cool' );

		}

		// the chase runs on the host (or alone): police cars sent after the wanted players, each after the nearest one
		if ( ! puppet ) {

			const targets = this._targets( pos );
			if ( ! targets.length || ! this.active ) {

				for ( const r of pursuers ) {

					r.pursue.calm = ( r.pursue.calm || 0 ) + dt;
					if ( r.pursue.calm > 6 || ! this.active ) { r.state = 'idle'; r.driver = true; r.resumeT = 2; r.pursue = null; }

				}

			} else {

				let level = 0, top = targets[ 0 ];
				for ( const t of targets ) if ( t.level > level ) { level = t.level; top = t; }
				const want = Math.max( 0, Math.round( ( WANTED.pursuers[ level ] || 0 ) * ( this.scale < 1 ? 0.5 : 1 ) + ( level && this.scale < 1 ? 0.5 : 0 ) ) );
				if ( pursuers.length < want ) {

					let best = null, bd = 450;
					for ( const c of this.traffic.cars ) {

						if ( c.kind !== 'police' ) continue;
						const d = Math.hypot( c.x - top.x, c.z - top.z );
						if ( d < bd ) { bd = d; best = c; }

					}

					if ( ! best ) best = this._spawnTraffic( 'police', top, 140, 320 );
					if ( best ) this._toPursuit( best );

				}

				for ( const r of pursuers ) {

					// the target: the nearest wanted player (looked at again every 2 s)
					const P = r.pursue;
					P.calm = 0;
					P.pick = ( P.pick || 0 ) - dt;
					let t = P.pick > 0 ? targets.find( ( q ) => q.id === P.target ) : null;
					if ( ! t ) {

						P.pick = 2;
						let bd = Infinity;
						for ( const q of targets ) { const d = Math.hypot( q.x - r.x, q.z - r.z ); if ( d < bd ) { bd = d; t = q; } }
						P.target = t.id;

					}

					this._pursue( r, dt, t );

				}

			}

		}

		// busted: stopped with a police car alongside (each player judges his own, from the police cars he sees)
		if ( near && this.policeLevel() > 0 ) {

			const B = WANTED.bust, me = this.drive;
			const slow = me ? Math.abs( me.body.speed ) < B.slow : true;
			const close = chasers.some( ( r ) => Math.hypot( r.x - pos.x, r.z - pos.z ) < ( me ? B.range : B.onFoot ) + ( me ? 0 : 1 ) );
			this.bustT = slow && close ? this.bustT + dt : Math.max( 0, this.bustT - dt * 2 );
			if ( this.bustT > B.time ) this.bust();

		} else this.bustT = 0;

	}

	// the wanted players the police may chase: the local one in the city, and (on the host) the guests CarLink reports
	_targets( pos ) {

		const out = this._targetList || ( this._targetList = [] );
		out.length = 0;
		const lv = this.policeLevel();
		if ( lv > 0 && this._localNear && pos ) {

			const b = this.drive && this.drive.body;
			out.push( { id: 'local', x: pos.x, z: pos.z, vx: b ? b.vx : 0, vz: b ? b.vz : 0, level: lv } );

		}

		if ( this.netRole === 'host' ) for ( const t of this.netTargets ) if ( t && t.level > 0 && this._nearCity( t ) ) out.push( t );
		return out;

	}

	_nearCity( p ) {

		const c = MERIDIAN.center;
		return !! p && Math.hypot( p.x - c.x, p.z - c.z ) < MERIDIAN.radius + this.T.active;

	}

	_toPursuit( rec ) {

		if ( rec.state === 'traffic' ) this.traffic.remove( rec );
		this._bodyFor( rec );
		rec.ai = null;
		rec.state = 'pursuit';
		rec.driver = true;
		rec.lights = true;
		rec.pursue = { wp: null, t: 0, stuck: 0, back: 0, calm: 0 };
		if ( ! this.records.includes( rec ) ) this.records.push( rec );
		return rec;

	}

	// the pursuer's driving: along the roads while far (the route's next node), straight at you when near
	_pursue( rec, dt, pos ) {

		const P = rec.pursue, b = this._bodyFor( rec );
		const tx0 = pos.x + ( pos.vx || 0 ) * 0.6, tz0 = pos.z + ( pos.vz || 0 ) * 0.6;
		const d = Math.hypot( tx0 - b.x, tz0 - b.z );
		let tx = tx0, tz = tz0;
		P.t -= dt;
		if ( d > 70 ) {

			if ( P.t <= 0 || ! P.wp ) {

				P.t = 2;
				const from = this.graph.at( b.x, b.z ), to = this.graph.at( pos.x, pos.z );
				const fe = from && this.graph.edges.get( from.edge ), te = to && this.graph.edges.get( to.edge );
				const fn = fe ? ( from.dir > 0 ? fe.b : fe.a ) : null, tn = te ? te.a : null;
				const path = fn && tn ? this.graph.route( fn, tn ) : null;
				const n = this.graph.nodes.get( fn );
				P.wp = n ? { x: n.x, z: n.z } : null;
				if ( n && Math.hypot( n.x - b.x, n.z - b.z ) < 12 && path && path.length ) {

					const e = this.graph.edges.get( path[ 0 ].edge );
					const nn = this.graph.nodes.get( path[ 0 ].dir > 0 ? e.b : e.a );
					P.wp = { x: nn.x, z: nn.z };

				}

			}

			if ( P.wp ) { tx = P.wp.x; tz = P.wp.z; }

		}

		let err = Math.atan2( tx - b.x, tz - b.z ) - b.yaw;
		err = Math.atan2( Math.sin( err ), Math.cos( err ) );
		const inp = { throttle: 0, brake: 0, steer: clamp( err * 1.8, - 1, 1 ), handbrake: false };
		if ( P.back > 0 ) {

			// unsticking: back off with the wheel the other way
			P.back -= dt;
			inp.brake = 1; inp.steer = - inp.steer;

		} else {

			inp.throttle = d < 9 ? 0.25 : Math.abs( err ) > 1.2 ? 0.45 : 1;
			if ( Math.abs( err ) > 1.6 && b.speed > 9 ) { inp.throttle = 0; inp.brake = 1; }
			P.stuck = Math.abs( b.speed ) < 1 && inp.throttle > 0.3 ? P.stuck + dt : 0;
			if ( P.stuck > 2 ) { P.back = 1.3; P.stuck = 0; }

		}

		this._stepBody( rec, dt, inp );
		this._syncQuat( rec );
		this._hitPlayer( rec );

	}

	// caught: a fine by level, the heat gone, out of the car
	// the level the police answer: the cars' heat or the buildings' (citywreck), none for a while after a bust
	policeLevel() {

		return this.graceT > 0 ? 0 : Math.max( this.level, this.cityLevel || 0 );

	}

	bust() {

		const lv = Math.max( 1, this.policeLevel() ), B = WANTED.bust;
		const fine = this.sandbox ? 0 : B.fine * lv;
		const st = this.state;
		let paid = 0;
		if ( fine && st ) {

			paid = Math.min( fine, Math.max( 0, st.money || 0 ) );
			if ( paid && st.spend ) st.spend( paid );

		}

		this.stats.busted ++;
		if ( this.drive ) this.exit( { force: true } );
		this.heat = 0;
		this.bustT = 0;
		this.graceT = 60;
		this._levelCheck( 'busted' );
		for ( const r of this.records ) if ( r.state === 'pursuit' ) { r.state = 'idle'; r.pursue = null; r.resumeT = 3; }
		this._toast( fine ? `Busted · a $${ paid } fine` : 'Busted · let off with a warning', 3600 );
		this._emit( 'cityBusted', { level: lv, fine: paid } );
		return { ok: true, fine: paid };

	}

	// ------------------------------------------------------------------ traffic upkeep

	_spawnTraffic( kind, pos, rMin, rMax, bus = null, viewers = null ) {

		for ( let t = 0; t < 10; t ++ ) {

			const at = bus ? this._busStart( bus ) : this.traffic.randomLane();
			if ( ! at ) return null;
			const L = this.graph.lane( at.edge, at.dir, at.k );
			const p = this.graph.pointOn( L, at.s, {} );
			const d = pos ? Math.hypot( p.x - pos.x, p.z - pos.z ) : rMin;
			if ( ! bus && ( d < rMin || d > rMax ) ) continue;
			if ( ! bus && viewers && viewers.length > 1 && viewers.some( ( v ) => Math.hypot( p.x - v.x, p.z - v.z ) < rMin ) ) continue;
			if ( this.traffic.occupied( p.x, p.z, 12 ) ) continue;
			const rec = this._record( kind, { x: p.x, z: p.z, state: 'traffic', driver: true } );
			rec.lights = this.night;
			if ( ! this.traffic.add( rec, at, { bus } ) ) return null;
			return rec;

		}

		return null;

	}

	// the bus loop: the junctions with lights, in order round the city centre
	busLoop() {

		if ( this._loop ) return this._loop;
		const c = MERIDIAN.center;
		const sig = [ ...this.graph.nodes.values() ].filter( ( n ) => n.signal );
		const pool = sig.length >= 4 ? sig : [ ...this.graph.nodes.values() ].filter( ( n ) => n.out.length >= 3 );
		pool.sort( ( a, b ) => Math.atan2( a.z - c.z, a.x - c.x ) - Math.atan2( b.z - c.z, b.x - c.x ) );
		this._loop = pool.map( ( n ) => n.id ).filter( ( id, i ) => i % Math.max( 1, Math.floor( pool.length / 6 ) ) === 0 );
		return this._loop;

	}

	_busStart( stops ) {

		const n = this.graph.nodes.get( stops[ Math.floor( this.rng() * stops.length ) % stops.length ] );
		if ( ! n || ! n.out.length ) return null;
		const e = n.out[ Math.floor( this.rng() * n.out.length ) % n.out.length ];
		const dir = e.b === n.id ? 1 : - 1; // arriving at the stop
		if ( e.oneWay && dir < 0 ) return null;
		const L = this.graph.lane( e.id, dir, 0 );
		return { edge: e.id, dir, k: 0, s: L.len * 0.5 };

	}

	// viewers: [ { x, z } ] the players in the city (the local one first; on the host the guests too): cars are spawned out of
	// sight of all of them, round each in turn, and go when they are far from every one
	_trafficUpkeep( viewers ) {

		if ( ! Array.isArray( viewers ) ) viewers = [ viewers ];
		if ( ! viewers.length ) return;
		const T = this.T, sc = this.scale * ( viewers.length > 1 ? Math.min( 2, 1 + 0.5 * ( viewers.length - 1 ) ) : 1 );
		const want = { cars: Math.round( T.cars * sc ), buses: Math.max( 1, Math.round( T.buses * sc ) ), police: Math.max( 1, Math.round( T.police * sc ) ) };
		const far = ( c ) => viewers.every( ( v ) => Math.abs( c.x - v.x ) > T.drop || Math.abs( c.z - v.z ) > T.drop || Math.hypot( c.x - v.x, c.z - v.z ) > T.drop );
		// the far ones go
		for ( const c of [ ...this.traffic.cars ] ) if ( far( c ) ) this.traffic.remove( c );
		let cars = 0, buses = 0, police = 0;
		for ( const c of this.traffic.cars ) { if ( c.kind === 'bus' ) buses ++; else if ( c.kind === 'police' ) police ++; else cars ++; }
		const first = ! this._seeded;
		this._seeded = true;
		const rMin = first ? 20 : T.spawnMin, n0 = first ? 400 : 3;
		let made = 0;
		while ( made < n0 && ( cars < want.cars || buses < want.buses || police < want.police ) ) {

			made ++;
			let kind, bus = null;
			if ( buses < want.buses ) { kind = 'bus'; bus = this.busLoop(); buses ++; } else if ( police < want.police ) { kind = 'police'; police ++; } else { kind = pickWeighted( TRAFFIC_MIX, this.rng() ); if ( kind === 'police' ) kind = 'sedan'; cars ++; }
			this._upk = ( ( this._upk || 0 ) + 1 ) % viewers.length;
			this._spawnTraffic( kind, viewers[ this._upk ], rMin, T.spawnMax, bus, viewers );

		}

	}

	// ------------------------------------------------------------------ parked cars (streamed round the player)

	_spots() {

		if ( this.parked.spots ) return this.parked.spots;
		const fill = this.T.fill * Math.max( 0.5, this.scale );
		const out = [];
		( this.cityPlan.parking || [] ).forEach( ( p, i ) => {

			if ( p.kind === 'garage' ) return; // (inside the garage buildings: their own colliders)
			const r = rngFor( hashStr( 'park' + i ) );
			if ( r() > fill ) return;
			const kind = pickWeighted( PARKED_MIX, r() );
			// a kerb bay faces the way the traffic beside it runs (right-hand: the kerb on the car's right; +X is a car's left)
			let yaw = p.yaw;
			const e = p.edge && this.graph.edges.get( p.edge ), A = e && this.graph.nodes.get( e.a );
			if ( e && A ) {

				const t = ( p.x - A.x ) * e.dx + ( p.z - A.z ) * e.dz;
				const ox = p.x - A.x - e.dx * t, oz = p.z - A.z - e.dz * t;
				if ( ox * Math.cos( yaw ) - oz * Math.sin( yaw ) > 0 ) yaw += Math.PI;

			}

			out.push( { i, x: p.x, z: p.z, yaw, kind, color: paintFor( kind, r() ) } );

		} );
		this.parked.spots = out;
		return out;

	}

	_parkedUpdate( pos, dt ) {

		const P = this.parked;
		P.t -= dt;
		if ( P.t > 0 && P.at && Math.hypot( pos.x - P.at.x, pos.z - P.at.z ) < 15 ) return;
		P.t = 0.5;
		P.at = { x: pos.x, z: pos.z };
		const R = this.T.parkedDraw * ( this.scale < 1 ? 0.65 : 1 );
		for ( const [ i, until ] of P.taken ) if ( this.time > until ) P.taken.delete( i );
		const keep = new Set();
		for ( const s of this._spots() ) {

			if ( Math.abs( s.x - pos.x ) > R || Math.abs( s.z - pos.z ) > R || Math.hypot( s.x - pos.x, s.z - pos.z ) > R ) continue;
			if ( P.taken.has( s.i ) ) continue;
			keep.add( s.i );
			if ( P.live.has( s.i ) ) continue;
			// someone else's car stands there (yours, one left behind)
			if ( this.records.some( ( r ) => r.state !== 'parked' && Math.abs( r.x - s.x ) < 4 && Math.abs( r.z - s.z ) < 4 ) ) continue;
			const rec = this._record( s.kind, { x: s.x, z: s.z, yaw: s.yaw, color: s.color, state: 'parked', id: 'p:' + s.i } );
			rec.y = this.world.ground( s.x, s.z, 200 );
			rec.spot = s.i;
			quatYPR( rec.yaw, 0, 0, rec.quat );
			P.live.set( s.i, rec );
			this.records.push( rec );

		}

		for ( const [ i, rec ] of [ ...P.live ] ) if ( ! keep.has( i ) && rec.state === 'parked' ) { P.live.delete( i ); this._drop( rec ); }

	}

	// ------------------------------------------------------------------ free cars (knocked loose, abandoned, pursuers off duty)

	_idleUpdate( dt, pos ) {

		let phys = 0;
		for ( const rec of [ ...this.records ] ) {

			if ( rec.state !== 'idle' && rec.state !== 'wreck' ) continue;
			const b = rec.body;
			if ( b && ( Math.hypot( b.vx, b.vz ) > 0.05 || ! b.grounded ) && phys < MAX_PHYS ) {

				phys ++;
				this._stepBody( rec, dt, { throttle: 0, brake: rec.driver ? 1 : 0, steer: 0, handbrake: ! rec.driver } );
				this._syncQuat( rec );
				this._hitPlayer( rec );

			} else if ( b ) { b.vx = b.vz = 0; }

			// a driver back on the road once the car has stopped and is fit to drive
			if ( rec.state === 'idle' && rec.driver ) {

				rec.resumeT -= dt;
				if ( rec.resumeT <= 0 && ( ! b || Math.abs( b.speed ) < 0.3 ) ) {

					const at = rec.stage < 2 ? this.graph.at( rec.x, rec.z ) : null;
					const L = at && this.graph.lane( at.edge, at.dir, at.k );
					const ok = L && at.d < 3.2 && Math.cos( Math.atan2( L.dx, L.dz ) - rec.yaw ) > 0.7;
					const i = this.records.indexOf( rec );
					if ( ok && i >= 0 ) {

						this.records.splice( i, 1 );
						rec.body = null;
						rec.state = 'traffic';
						rec.ai = null;
						this.traffic.add( rec, at );
						if ( this.traffic.onHonk ) this._honked( rec );

					} else if ( ! ok ) rec.driver = false; // (the driver walks off: an empty car left in the road)

				}

			}

			// abandoned cars far away (from every player in the city) are towed (yours never)
			const vs = this._viewers && this._viewers.length ? this._viewers : pos ? [ pos ] : [];
			if ( ! rec.own && rec.state === 'idle' && vs.length && vs.every( ( v ) => Math.hypot( rec.x - v.x, rec.z - v.z ) > this.T.drop ) ) this._drop( rec );

		}

	}

	_honked( c ) {

		const v = this.playerPos();
		if ( v && Math.hypot( c.x - v.x, c.z - v.z ) < 140 ) this.audio.honk( c.x, c.y + 1, c.z, c.kind );

	}

	// ------------------------------------------------------------------ per frame

	update( dt ) {

		dt = Math.min( Math.max( Number.isFinite( dt ) ? dt : 0, 0 ), 0.1 );
		this.time += dt;
		this._sinceExit += dt;
		this._frame = ( this._frame || 0 ) + 1;
		const p = this.app.player;
		// something else took the player out of the car (a respawn, a rescue)
		if ( this.drive && p && ( p.mode !== 'plane' || p.vehicle !== this.vehicle ) ) {

			const rec = this.drive;
			this.drive = null;
			rec.state = rec.stage >= 4 ? 'wreck' : 'idle';
			for ( const l of this.lights ) l.enabled = false;

		}

		if ( this.drive && ! this._driven ) this._drive( dt );
		this._driven = false;
		globalThis.__hyptileDriving = !! this.drive; // (UI patch: H is the horn in a car, not the settings panel)
		const pos = this.playerPos();
		this._localNear = !! pos && ( this._nearCity( pos ) || !! this.opts.alwaysActive );
		// the host runs the traffic while anybody is in the city (itself or a guest); a guest runs none (the host's puppets)
		const puppet = this.netRole === 'puppet';
		const guests = this.netRole === 'host' ? this.netViewers.filter( ( v ) => this._nearCity( v ) ) : [];
		this.active = this._localNear || guests.length > 0;
		const viewers = this._viewers || ( this._viewers = [] );
		viewers.length = 0;
		if ( this._localNear ) viewers.push( pos );
		for ( const g of guests ) viewers.push( g );
		const night = this.night;
		if ( this.active && ! puppet ) {

			this._trafT -= dt;
			if ( this._trafT <= 0 ) { this._trafT = 0.5; this._trafficUpkeep( viewers ); }
			const obstacles = this._obstacles( viewers[ 0 ] );
			this.traffic.update( dt, { time: this.time, viewer: viewers[ 0 ], obstacles } );
			for ( const t of this.traffic.cars ) {

				t.lights = night;
				t.spin += ( t.speed / t.spec.r ) * dt;
				quatYPR( t.yaw, 0, 0, t.quat );

			}

		} else if ( this.traffic.cars.length ) {

			for ( const t of [ ...this.traffic.cars ] ) this.traffic.remove( t );
			this._seeded = false;

		}

		if ( puppet ) this.mirror.update( dt );
		else if ( this._shadow && this._shadow.records.size ) this._shadow.update( dt );
		if ( this._localNear ) this._parkedUpdate( pos, dt );

		this._idleUpdate( dt, pos );
		this._lawUpdate( dt, pos );
		this._damageTick( dt );
		this._effects( dt, pos );
		this._lightsUpdate( night );
		this._audioUpdate( dt );
		this.cockpit.update( dt );
		this._draw( pos, night );
		this._remoteAge( dt );
		this._flushGone();

	}

	// what the traffic must not drive into: the player (in a car or on foot), the free cars, the wrecks
	_obstacles( pos ) {

		const out = [];
		const p = this.app.player;
		if ( this.drive ) {

			const r = this.drive;
			out.push( { id: r.id, x: r.x, z: r.z, len: r.spec.len, wid: r.spec.wid, speed: Math.abs( r.speed ), kind: 'player' } );

		} else if ( p && p.position ) out.push( { id: 'player', x: p.position.x, z: p.position.z, len: 0.6, wid: 0.8, speed: 0, kind: 'pedestrian', static: true } );
		for ( const r of this.records ) {

			if ( r.state === 'parked' || r === this.drive ) continue;
			if ( Math.abs( r.x - pos.x ) > 400 || Math.abs( r.z - pos.z ) > 400 ) continue;
			out.push( { id: r.id, x: r.x, z: r.z, len: r.spec.len, wid: r.spec.wid, speed: Math.abs( r.speed ), kind: r.stage >= 4 ? 'wreck' : 'obstacle', static: Math.abs( r.speed ) < 0.3 } );

		}

		// the other players' cars (the host's traffic waits behind a guest's car as behind its own player's)
		const other = ( r ) => out.push( { id: r.id, x: r.x, z: r.z, len: r.spec.len, wid: r.spec.wid, speed: Math.abs( r.speed || 0 ), kind: 'player', static: Math.abs( r.speed || 0 ) < 0.3 } );
		for ( const r of this.remote.values() ) other( r );
		for ( const list of this.remoteOwned.values() ) for ( const r of list ) other( r );
		return out;

	}

	_lightsUpdate( night ) {

		const r = this.drive;
		const on = !! r && ( this.lightsOn !== null ? this.lightsOn : night ) && r.stage < 4;
		if ( r ) r.lights = on;
		for ( const l of this.lights ) {

			l.enabled = on;
			if ( ! on ) continue;
			const S = r.spec;
			r.body.toWorld( l.side * ( S.wid / 2 - 0.3 ), 0.7, S.len / 2 + 0.1, l.position );
			const yaw = r.yaw, pitch = r.pitch + 0.08;
			l.dir.set( Math.sin( yaw ) * Math.cos( pitch ), - Math.sin( pitch ), Math.cos( yaw ) * Math.cos( pitch ) );

		}

	}

	// L in the car (App patch): the headlamps on / off / automatic
	toggleLights() {

		this.lightsOn = this.lightsOn === null ? ! this.night : this.lightsOn ? false : null;
		return this.lightsOn;

	}

	// the siren and beacons of a police car you drive (everybody sees and hears them)
	toggleSiren() {

		if ( ! this.drive || this.drive.kind !== 'police' ) return false;
		this.siren = ! this.siren;
		this._toast( this.siren ? 'Siren on' : 'Siren off', 1200 );
		return this.siren;

	}

	_audioUpdate( dt ) {

		const r = this.drive;
		let siren = null, sd = 400;
		const v = this.playerPos();
		const wail = ( c ) => {

			const d = Math.hypot( c.x - v.x, c.z - v.z );
			if ( d < sd ) { sd = d; siren = { x: c.x, y: c.y + 1.5, z: c.z }; }

		};
		if ( v ) {

			for ( const c of this.records ) if ( c.state === 'pursuit' ) wail( c );
			for ( const c of this.mirror.records.values() ) if ( c.pursuit ) wail( c );
			for ( const c of this.remote.values() ) if ( c.siren ) wail( c );
			if ( this.drive && this.siren ) wail( this.drive );

		}

		if ( r && r.body ) {

			const b = r.body, inp = b.input || {};
			const engine = drivetrain( r );
			this.audio.update( dt, { on: engine.engineOn, rpm: engine.rpm / 6500, throttle: inp.throttle || 0, slip: b.slip, horn: !! this._horn, x: r.x, y: r.y + 0.8, z: r.z, siren } );
			if ( this._horn && this.time - ( this._hornScare || - 9 ) > 1 ) {

				this._hornScare = this.time;
				const fx = Math.sin( r.yaw ), fz = Math.cos( r.yaw );
				this._scare( r.x + fx * 10, r.z + fz * 10, 6 );

			}

		} else this.audio.update( dt, { on: false, siren } );

	}

	_draw( pos, night ) {

		if ( ! this.render ) return;
		const list = this._drawList || ( this._drawList = [] );
		list.length = 0;
		const R = this.T.drawFar;
		const add = ( r ) => { if ( pos && ( Math.abs( r.x - pos.x ) > R || Math.abs( r.z - pos.z ) > R ) ) return; list.push( r ); };
		for ( const r of this.traffic.cars ) add( r );
		for ( const r of this.records ) {

			if ( ! r.body ) quatYPR( r.yaw, r.pitch, r.roll, r.quat ); // (a car set down by hand, a loaded one)
			add( r );

		}

		for ( const r of this.mirror.records.values() ) add( r );
		for ( const r of this.remote.values() ) add( r );
		for ( const l of this.remoteOwned.values() ) for ( const r of l ) add( r );
		this.render.draw( list, { night, beacon: this.beacons(), time: this.time } );

	}

	// the police beacons flash: a chase on, a wanted player, a player's siren
	beacons() {

		if ( this.policeLevel() > 0 || this.siren ) return true;
		for ( const r of this.records ) if ( r.state === 'pursuit' ) return true;
		for ( const r of this.mirror.records.values() ) if ( r.pursuit ) return true;
		for ( const r of this.remote.values() ) if ( r.siren ) return true;
		return false;

	}

	// ------------------------------------------------------------------ the dealer

	dealerSpot() {

		if ( this._dealer ) return this._dealer;
		const plan = this.cityPlan;
		const g = ( plan.buildings || [] ).find( ( b ) => b.style === 'garage' );
		let x, z, yaw = 0;
		if ( g ) {

			yaw = g.yaw || 0;
			x = g.x + Math.sin( yaw ) * ( g.d / 2 + 2.5 );
			z = g.z + Math.cos( yaw ) * ( g.d / 2 + 2.5 );

		} else {

			const m = plan.port && plan.port.market;
			x = m ? m.x - 30 : MERIDIAN.center.x;
			z = m ? m.z : MERIDIAN.center.z;

		}

		const y = this.world.ground( x, z, 300 );
		this._dealer = { x, y: Number.isFinite( y ) ? y : 0, z, yaw };
		return this._dealer;

	}

	owned() {

		return this.records.filter( ( r ) => r.own );

	}

	_kerbNearDealer() {

		const d = this.dealerSpot();
		const spots = ( this.cityPlan.parking || [] ).filter( ( p ) => p.kind === 'street' ).map( ( p ) => ( { p, d: Math.hypot( p.x - d.x, p.z - d.z ) } ) ).sort( ( a, b ) => a.d - b.d );
		for ( const { p } of spots ) {

			if ( this.records.some( ( r ) => r.state !== 'parked' && Math.hypot( r.x - p.x, r.z - p.z ) < 4 ) ) continue;
			// a parked car there gives way
			for ( const [ i, rec ] of this.parked.live ) if ( Math.hypot( rec.x - p.x, rec.z - p.z ) < 4 ) { this.parked.live.delete( i ); this.parked.taken.set( i, this.time + 7200 ); this._drop( rec ); this._parkedGone( i ); }
			return p;

		}

		return { x: d.x + 6, z: d.z + 6, yaw: d.yaw };

	}

	_nearDealer( rec, r = 60 ) {

		const d = this.dealerSpot();
		return Math.hypot( rec.x - d.x, rec.z - d.z ) < r;

	}

	buy( kind ) {

		const K = KINDS[ kind ];
		if ( ! K || ! K.sale ) return { ok: false, text: 'Not for sale' };
		if ( this.owned().length >= DEALER.maxOwned ) return { ok: false, text: `Six cars is all the city will let you park` };
		const price = this.sandbox ? 0 : K.price;
		const st = this.state;
		if ( price > 0 && ( ! st || ! st.spend || ! st.spend( price ) ) ) return { ok: false, text: 'Not enough money' };
		const at = this._kerbNearDealer();
		const rec = this._record( kind, { x: at.x, z: at.z, yaw: at.yaw || 0, state: 'idle', id: 'own:' + ( this._nextId ++ ) } );
		rec.y = this.world.ground( at.x, at.z, 300 );
		rec.own = true;
		rec.mine = true;
		quatYPR( rec.yaw, 0, 0, rec.quat );
		this.records.push( rec );
		this.stats.bought ++;
		this._emit( 'carBought', { id: rec.id, kind, price } );
		this._toast( `Your ${ K.name.toLowerCase() } waits at the kerb outside`, 3200 );
		return { ok: true, id: rec.id, price, text: `Bought · the ${ K.name.toLowerCase() } is at the kerb` };

	}

	repair( id ) {

		const rec = this.records.find( ( r ) => r.id === id && r.own );
		if ( ! rec || rec.stage >= 4 ) return { ok: false, text: 'Nothing to repair' };
		if ( ! this._nearDealer( rec ) ) return { ok: false, text: 'Bring it to the showroom' };
		const price = this.sandbox ? 0 : Math.round( ( rec.maxHp - rec.hp ) * DEALER.repairPerHp );
		const st = this.state;
		if ( price > 0 && ( ! st || ! st.spend || ! st.spend( price ) ) ) return { ok: false, text: 'Not enough money' };
		rec.hp = rec.maxHp;
		rec.stage = 0;
		this._stopFx( rec );
		return { ok: true, price, text: 'Good as new' };

	}

	sell( id ) {

		const rec = this.records.find( ( r ) => r.id === id && r.own );
		if ( ! rec || rec === this.drive ) return { ok: false, text: 'Get out of it first' };
		if ( ! this._nearDealer( rec ) ) return { ok: false, text: 'Bring it to the showroom' };
		const value = Math.round( rec.spec.price * DEALER.tradeIn * ( rec.hp / rec.maxHp ) );
		const st = this.state;
		if ( value && st && st.earn ) st.earn( value );
		this._drop( rec );
		this._emit( 'carSold', { kind: rec.kind, price: value } );
		return { ok: true, price: value, text: `Sold for $${ value }` };

	}

	// shipping a car to another island: only where there are roads (none yet: cars stay in Meridian)
	ship( id, to ) {

		const roads = this.opts.roadsOn ? this.opts.roadsOn( to ) : false;
		if ( ! roads ) return { ok: false, text: 'No roads there · cars stay in Meridian' };
		return { ok: false, text: 'The ferry does not take cars yet' };

	}

	dealerView() {

		const st = this.state, money = st ? st.money || 0 : 0, free = this.sandbox;
		const full = this.owned().length >= DEALER.maxOwned;
		return {
			money, free,
			sale: SALE_KINDS.map( ( k ) => {

				const K = KINDS[ k ];
				return { kind: k, name: K.name, price: free ? 0 : K.price, note: `${ Math.round( K.top * 3.6 * 0.8 ) } km/h · ${ K.mass } kg`, canBuy: ! full && ( free || money >= K.price ) };

			} ),
			owned: this.owned().map( ( r ) => {

				const d = this.dealerSpot(), dist = Math.hypot( r.x - d.x, r.z - d.z );
				const near = dist < 60;
				const repair = free ? 0 : Math.round( ( r.maxHp - r.hp ) * DEALER.repairPerHp );
				return {
					id: r.id, name: r.spec.name, where: near ? 'at the showroom' : `${ Math.round( dist ) } m away`, condition: r.stage >= 4 ? 'a wreck' : `${ Math.round( r.hp / r.maxHp * 100 ) } %`,
					repair, canRepair: near && r.hp < r.maxHp && r.stage < 4 && ( free || money >= repair ), value: Math.round( r.spec.price * DEALER.tradeIn * ( r.hp / r.maxHp ) ), canSell: near && r !== this.drive,
				};

			} ),
			ferry: 'The ferry takes no cars: Tidemark and home have no roads, so your cars stay in Meridian.',
		};

	}

	// ------------------------------------------------------------------ multiplayer (netsync/CarLink.js calls these)

	// the state's extras while you play (the server passes them to the others; Protocol MAX_EXTRA):
	//   car { k, c, p: [ x, y, z ], q: [ yaw, pitch, roll ], s, st, d, l, h, sr }   the car you drive (sr: its siren)
	//   cw  the police level you answer to, while wanted in the city (the host's police chase you)
	//   oc  [ [ kind, colour, x, z, yaw, stage ] ]   your cars parked in the city (the others see them, locked)
	decorateState( out ) {

		if ( ! out ) return out;
		const r = this.drive;
		if ( r ) {

			// (lean: 15 times a second to everybody; flat roads send the yaw alone, the flags only while on)
			const yaw = r2( Math.atan2( Math.sin( r.yaw ), Math.cos( r.yaw ) ) ), pitch = r2( r.pitch ), roll = r2( r.roll );
			const c = out.car = { k: r.kind, c: r.color, p: [ r2( r.x ), r2( r.y ), r2( r.z ) ], q: pitch || roll ? [ yaw, pitch, roll ] : [ yaw ], s: r2( r.speed ), st: r2( r.steer ) };
			if ( r.stage ) c.d = r.stage;
			if ( r.lights ) c.l = 1;
			if ( this._horn ) c.h = 1;
			if ( this.siren ) c.sr = 1;

		}

		const lv = this.policeLevel();
		if ( lv > 0 && this._localNear ) out.cw = lv;
		const r1 = ( v ) => Math.round( v * 10 ) / 10;
		const oc = [];
		for ( const o of this.records ) if ( o.own && o !== r && o.stage < 4 && oc.length < DEALER.maxOwned && this._nearCity( o ) ) oc.push( [ o.kind, o.color, r1( o.x ), r1( o.z ), r2( o.yaw ), o.stage ] );
		if ( oc.length ) out.oc = oc;
		return out;

	}

	// the other players' cars: an array of { id, car, name?, oc? } (or a Map id -> state); drawn as instances, locked
	updateRemote( states ) {

		const list = states instanceof Map ? [ ...states ].map( ( [ id, s ] ) => ( { id, ...s } ) ) : Array.isArray( states ) ? states : [];
		for ( const s of list ) {

			if ( ! s || s.id == null ) continue;
			const c = s.car;
			if ( c && KINDS[ c.k ] && Array.isArray( c.p ) ) {

				let r = this.remote.get( s.id );
				if ( ! r || r.kind !== c.k ) this.remote.set( s.id, r = this._record( c.k, { state: 'remote', id: 'remote:' + s.id, color: c.c } ) );
				r.owner = s.id;
				if ( s.name ) r.ownerName = String( s.name ).slice( 0, 24 );
				r.color = Number.isFinite( c.c ) ? c.c : r.color;
				r.x = c.p[ 0 ]; r.y = c.p[ 1 ]; r.z = c.p[ 2 ];
				if ( Array.isArray( c.q ) ) { r.yaw = c.q[ 0 ] || 0; r.pitch = c.q[ 1 ] || 0; r.roll = c.q[ 2 ] || 0; }
				r.speed = c.s || 0; r.steer = c.st || 0; r.stage = c.d || 0; r.lights = !! c.l; r.seen = 0; r.siren = !! c.sr && c.k === 'police';
				// the horn: one honk as it starts
				if ( c.h && ! r.hornWas ) this.audio.honk( r.x, r.y + 1, r.z, r.kind );
				r.hornWas = !! c.h;
				quatYPR( r.yaw, r.pitch, r.roll, r.quat );

			}

			if ( 'oc' in s ) {

				const want = Array.isArray( s.oc ) ? s.oc.slice( 0, DEALER.maxOwned ) : [];
				const have = this.remoteOwned.get( s.id ) || [];
				const next = [];
				want.forEach( ( o, i ) => {

					if ( ! Array.isArray( o ) || ! KINDS[ o[ 0 ] ] || ! [ o[ 2 ], o[ 3 ], o[ 4 ] ].every( Number.isFinite ) ) return;
					let r = have[ i ];
					if ( ! r || r.kind !== o[ 0 ] ) r = this._record( o[ 0 ], { state: 'remote', id: `remoteOwn:${ s.id }:${ i }`, color: o[ 1 ] } );
					r.owner = s.id;
					if ( s.name ) r.ownerName = String( s.name ).slice( 0, 24 );
					if ( Number.isFinite( o[ 1 ] ) ) r.color = o[ 1 ];
					if ( r.x !== o[ 2 ] || r.z !== o[ 3 ] || ! r.placed ) {

						r.x = o[ 2 ]; r.z = o[ 3 ]; r.yaw = o[ 4 ];
						r.y = this.world.ground( r.x, r.z, 300 );
						if ( ! Number.isFinite( r.y ) ) r.y = 0;
						r.placed = true;
						quatYPR( r.yaw, 0, 0, r.quat );

					}

					r.stage = clamp( o[ 5 ] | 0, 0, 3 );
					r.speed = 0;
					r.seen = 0;
					next.push( r );

				} );
				if ( next.length ) this.remoteOwned.set( s.id, next );
				else this.remoteOwned.delete( s.id );

			}

		}

	}

	// a player stopped driving (or left): his car goes at once
	dropRemote( id, { owned = false } = {} ) {

		this.remote.delete( id );
		if ( owned ) this.remoteOwned.delete( id );

	}

	_remoteAge( dt ) {

		for ( const [ id, r ] of this.remote ) {

			r.seen = ( r.seen || 0 ) + dt;
			r.spin += ( r.speed / r.spec.r ) * dt;
			if ( r.seen > 2 ) this.remote.delete( id );

		}

		for ( const [ id, l ] of this.remoteOwned ) {

			let stale = true;
			for ( const r of l ) { r.seen = ( r.seen || 0 ) + dt; if ( r.seen <= 4 ) stale = false; }
			if ( stale ) this.remoteOwned.delete( id );

		}

	}

	// 'solo' | 'host' | 'puppet' (CarLink): a guest drops its own traffic and police (the host's are drawn instead)
	setNetRole( role ) {

		if ( role === this.netRole ) return;
		this.netRole = role;
		if ( this._shadow ) this._shadow.clear();
		if ( role === 'puppet' ) {

			for ( const t of [ ...this.traffic.cars ] ) this.traffic.remove( t );
			for ( const r of [ ...this.records ] ) if ( r.state === 'pursuit' ) this._drop( r );
			this._seeded = false;

		} else this.mirror.clear();
		if ( role !== 'host' ) { this.netViewers = []; this.netTargets = []; }

	}

	// the host: what the guests near the city get (CarNet.js); null when nobody needs it
	netSnapshot( viewers = this.netViewers, { key = true } = {} ) {

		const vs = ( viewers || [] ).filter( ( v ) => this._nearCity( v ) );
		if ( this.netRole === 'puppet' || ! vs.length ) return null;
		// (the guests' view, kept here: deltas against it)
		if ( ! this._shadow ) this._shadow = new Mirror( this );
		return encodeSnapshot( this, vs, { key, shadow: this._shadow } );

	}

	// a guest: the host's snapshot, age s after it was sent
	applySnapshot( snap, age = 0 ) {

		if ( this.netRole !== 'puppet' ) return 0;
		return this.mirror.apply( snap, age );

	}

	// are the host's police after somebody? (CarLink sends faster then)
	chasing() {

		return this.records.some( ( r ) => r.state === 'pursuit' );

	}

	// a parked car leaves its spot on this client (taken, knocked loose, blown away, a bought car's kerb): the others' copy goes
	_parkedGone( i ) {

		const q = this._goneOut || ( this._goneOut = [] );
		if ( q.length < 40 ) q.push( 'p:' + i );

	}

	_flushGone() {

		const q = this._goneOut;
		if ( ! q || ! q.length ) return;
		// (one world event for a whole blast: the server's event budget is 10 a second)
		this._share( 'carTaken', q.length === 1 ? { id: q[ 0 ] } : { ids: q.slice( 0, 40 ) } );
		q.length = 0;

	}

	_onRemote( e ) {

		const d = e.data || {};
		if ( e.kind === 'carTaken' ) {

			const ids = Array.isArray( d.ids ) ? d.ids : [ d.id ];
			for ( const id of ids ) {

				if ( typeof id !== 'string' ) continue;
				if ( id.startsWith( 'p:' ) ) {

					const i = Number( id.slice( 2 ) );
					if ( ! Number.isInteger( i ) ) continue;
					const rec = this.parked.live.get( i );
					if ( rec && rec !== this.drive && rec.state === 'parked' ) { this.parked.live.delete( i ); this._drop( rec ); }
					this.parked.taken.set( i, this.time + 3600 );

				} else if ( id.startsWith( 't:' ) || id.startsWith( 'f:' ) ) {

					// a guest took one of the host's cars: it is his now
					if ( this.netRole === 'puppet' ) { this.mirror.records.delete( id ); continue; }
					const rid = id.startsWith( 't:' ) ? 'c' + id.slice( 2 ) : id.slice( 2 );
					const t = this.traffic.cars.find( ( c ) => c.id === rid );
					if ( t ) this.traffic.remove( t );
					const r = this.records.find( ( c ) => c.id === rid && ! c.own && c !== this.drive );
					if ( r ) this._drop( r );

				}

			}

		} else if ( e.kind === 'carExploded' && ! e.replay ) {

			const vfx = this._get( 'vfx' );
			if ( vfx && vfx.explosion && Number.isFinite( d.x ) ) try { vfx.explosion( d.x, d.y || 0, d.z, 1.2 ); } catch ( err ) { /* optional */ }

		}

	}

	// ------------------------------------------------------------------ save

	toJSON() {

		return {
			v: SAVE_VERSION, heat: Math.round( this.heat ),
			owned: this.owned().filter( ( r ) => r.stage < 4 ).map( ( r ) => ( { id: r.id, kind: r.kind, color: r.color, x: r2( r.x ), y: r2( r.y ), z: r2( r.z ), yaw: r2( r.yaw ), hp: r2( r.hp ), island: 'meridian', engineOn: r.engineOn !== false, parkBrake: !! r.parkBrake } ) ),
		};

	}

	fromJSON( d ) {

		if ( ! d || typeof d !== 'object' ) return;
		for ( const r of this.owned() ) if ( r !== this.drive ) this._drop( r );
		this.heat = clamp( Number( d.heat ) || 0, 0, 100 );
		this.level = wantedLevel( this.heat );
		for ( const o of Array.isArray( d.owned ) ? d.owned.slice( 0, DEALER.maxOwned ) : [] ) {

			if ( ! o || ! KINDS[ o.kind ] || ! Number.isFinite( o.x ) || ! Number.isFinite( o.z ) ) continue;
			const rec = this._record( o.kind, { x: o.x, y: Number.isFinite( o.y ) ? o.y : 0, z: o.z, yaw: Number( o.yaw ) || 0, color: Number.isFinite( o.color ) ? o.color : null, state: 'idle', id: typeof o.id === 'string' ? o.id.slice( 0, 40 ) : null } );
			rec.own = true;
			rec.mine = true;
			rec.engineOn = o.engineOn !== false;
			rec.parkBrake = o.parkBrake === true;
			if ( Number.isFinite( o.hp ) ) { rec.hp = clamp( o.hp, 1, rec.maxHp ); rec.stage = stageOf( rec.hp / rec.maxHp ); }
			quatYPR( rec.yaw, 0, 0, rec.quat );
			this.records.push( rec );
			const n = Number( String( rec.id ).replace( /\D/g, '' ) );
			if ( Number.isFinite( n ) && n >= this._nextId ) this._nextId = n + 1;

		}

	}

	reset() {

		if ( this.drive ) this.exit( { force: true } );
		for ( const r of [ ...this.records ] ) this._drop( r );
		for ( const c of [ ...this.traffic.cars ] ) this.traffic.remove( c );
		this.parked.live.clear();
		this.parked.taken.clear();
		this.parked.at = null;
		this.heat = 0;
		this.level = 0;
		this._seeded = false;

	}

	dispose() {

		this._disposed = true;
		for ( const f of this._offs ) try { f(); } catch ( e ) { /* ignore */ }
		for ( const f of this._removers ) try { f(); } catch ( e ) { /* ignore */ }
		this._offs.length = this._removers.length = 0;
		for ( const r of this.records ) this._stopFx( r );
		this.audio.dispose();
		this.panel.dispose();
		this.cockpit.dispose();
		if ( this.render ) this.render.dispose();

	}

}

function edgesOf( e ) {

	if ( ! e ) return [];
	if ( Array.isArray( e.edges ) ) return e.edges;
	if ( Array.isArray( e.ids ) ) return e.ids;
	return e.edge ? [ e.edge ] : [];

}

function padNow() {

	if ( typeof navigator === 'undefined' || ! navigator.getGamepads ) return null;
	let p = null;
	try { for ( const g of navigator.getGamepads() ) if ( g && g.connected ) { p = g; break; } } catch ( e ) { return null; }
	if ( ! p ) return null;
	const dz = ( v ) => ( Math.abs( v || 0 ) < 0.15 ? 0 : v );
	const bv = ( i ) => ( p.buttons[ i ] ? p.buttons[ i ].value || ( p.buttons[ i ].pressed ? 1 : 0 ) : 0 );
	return { steer: dz( p.axes[ 0 ] ), throttle: bv( 7 ), brake: bv( 6 ) };

}

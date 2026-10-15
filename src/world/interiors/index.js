import { Vector3 } from '../../engine/index.js';
import { Vendor } from '../../game/Vendor.js';
import { characterUrl } from '../../game/Characters.js';
import { Interiors } from './Interiors.js';
import { INTERIORS } from './Rooms.js';

// The interiors feature (wave 19E): walk into the Tide & Tankard, Marlow's chandlery and the harbourmaster's office at
// Tidemark, the Rum Hole at Blackwater, the Upturned Keel and Ethena's store at home. The doors are open doorways in the
// shells (the towns cut them: village/Buildings.js buildHouse openDoor, interiors/Shells.js openCottage); the rooms load on
// approach and unload after (Interiors.js). Inside: the closer third-person camera that stays in the room (player.indoor:
// Player.springArm asks it; without that patch this corrects the camera after the player's update), the sea, wind and
// pier beds muffled (a low-pass this feature puts between those SoundScape beds and their bus), the room's local lights.
// People: the barkeep behind each bar (E: the tavern window, harbour feature), a clerk behind each shop counter (a Vendor
// in app.game.vendors: E opens the shop), the notice board in the office (E: notices.openBoard), the seats published for
// townlife (seatsFor). A destroyed building (Tidemark's shell smoking, or a propDestroyed / buildingDestroyed with the
// room's id) hides its interior, bars its door and puts the player out on the step; respawned / mended, both come back.
//
//   features.add( 'interiors', interiorsModule )          (after harbour, notices and townlife)
//   const it = features.get( 'interiors' )
//   it.rooms (Interiors) · it.inside -> room | null · it.muffle 0..1 · it.seatsFor( port, { tavern }? ) -> [ seat ] (world:
//   { id, interior, port, x, y (seat height), z, h, floor, yaw }) · it.door( id ) · it.enter( id ) (puts the player inside)
//   it.setDestroyed( id, on ) · it.servesSite( site, p ) (the tavern window stays open at the bar)
// Events emitted: interiorEntered { id, port }, interiorLeft { id, port }, interiorEjected { id, port }.

const EJECT_TOAST = { 'tidemark.tavern': 'The Tide & Tankard is burning: everybody out!', 'blackwater.rumhole': 'Smoke in the Rum Hole! Out you go.' };
const BARKEEP = {
	'tidemark.tavern': { character: 'bonk', name: 'the barman' },
	'blackwater.rumhole': { character: 'pepe', name: 'One-Eyed Sal' },
	'home.keel': { rocketbox: 'joe', name: 'the barman' },
};
const RUM_SITE = { port: 'blackwater', name: 'The Rum Hole', keeper: null };

const base = () => {

	try {

		return ( import.meta.env && import.meta.env.BASE_URL ) || '/';

	} catch ( e ) {

		return '/';

	}

};

function figure( spec, opts ) {

	const character = ! spec ? null : spec.rocketbox
		? { url: base() + 'models/characters/' + spec.rocketbox + '.glb', idle: 'idle_neutral_01', talk: 'gestic_talk_relaxed_01', greet: 'wave_01' }
		: { url: characterUrl( spec.character ), idle: 'Idle_Breathe', talk: 'Talk', greet: 'Wave' };
	return new Vendor( { ...opts, character: globalThis.__noCharacters ? null : character } );

}

export class InteriorsFeature {

	constructor( app, features, opts = {} ) {

		this.app = app;
		this.features = features;
		this.lights = []; // (the rooms' lights come and go with them: straight into app.localLights)
		this.rooms = opts.rooms || new Interiors( {
			scene: app && app.scene, colliders: app && app.colliders, lights: app && app.localLights,
			meshes: opts.meshes ?? !! ( app && app.scene && app.engine ),
		} );
		this.muffle = 0;
		this.inside = null;
		this._removers = [];
		this._bound = new Set();
		this._staff = new Map(); // room id -> { vendor, shop }
		this._poll = 0;
		this._armUsed = false;
		this._v = new Vector3();
		this._bindRooms();
		if ( features && features.on ) {

			const on = ( name, fn ) => { const off = features.on( name, fn ); if ( typeof off === 'function' ) this._removers.push( off ); };
			on( 'propDestroyed', ( e ) => this._byEvent( e, true ) );
			on( 'propRespawned', ( e ) => this._byEvent( e, false ) );
			on( 'buildingDestroyed', ( e ) => this._byEvent( e, true ) );
			on( 'buildingRespawned', ( e ) => this._byEvent( e, false ) );

		}

	}

	get list() {

		return this.rooms.list;

	}

	// ------------------------------------------------------------------ the rooms' E spots

	_bindRooms() {

		this.rooms.bind();
		const F = this.features;
		for ( const room of this.rooms.list ) {

			if ( this._bound.has( room.id ) ) continue;
			this._bound.add( room.id );
			if ( ! F || ! F.interactable ) continue;
			const inRoom = () => this.rooms.inside === room && ( ! this.app || ! this.app.player || this.app.player.mode === 'walk' );
			if ( room.def.service === 'tavern' && room.R.staff ) {

				const st = this.rooms.staff( room );
				this._removers.push( F.interactable( {
					id: 'interior:' + room.id, position: () => st.at, radius: st.r,
					prompt: () => ( this._site( room ) && this._harbour() && this._harbour().panel && this._harbour().panel.isOpen && this._harbour().openSite === this._site( room ) ? 'Leave the bar' : 'Order at the bar' ),
					onInteract: () => this.toggleBar( room ),
					when: inRoom,
				} ) );

			}

			if ( room.R.board ) {

				const b = this.rooms.world( room, room.R.board.x, room.R.board.z );
				this._removers.push( F.interactable( {
					id: 'interior:' + room.id + ':board', position: () => ( { x: b.x, y: room.floorY, z: b.z } ), radius: 1.6,
					prompt: () => 'Read the notices',
					onInteract: () => { const n = F.get && F.get( 'notices' ); if ( n && n.openBoard ) n.openBoard( room.def.port ); },
					when: inRoom,
				} ) );

			}

		}

	}

	_harbour() {

		return this.features && this.features.get ? this.features.get( 'harbour' ) : null;

	}

	// the bar's own copy of the port's tavern site: the window's close-distance counts from the bar, not the porch
	_site( room ) {

		if ( room._site ) return room._site;
		const hb = this._harbour();
		const st = this.rooms.staff( room );
		if ( ! hb || ! st ) return null;
		const orig = ( hb.sites && hb.sites.tavern || [] ).find( ( s ) => s.port === room.def.port );
		room._site = { ...( orig || RUM_SITE ), name: room.def.name, port: room.def.port, x: st.at.x, z: st.at.z, interior: room.id };
		return room._site;

	}

	toggleBar( room ) {

		const hb = this._harbour(), site = this._site( room );
		if ( ! hb || ! site || ! hb.panel ) return false;
		if ( hb.panel.isOpen && hb.openSite === site ) {

			hb.close();
			return false;

		}

		hb.openSite = site;
		return hb.panel.show( site, 'menu' );

	}

	servesSite( site, p ) {

		return !! ( site && site.interior && this.rooms.inside && this.rooms.inside.id === site.interior );

	}

	// ------------------------------------------------------------------ staff (loaded with the room)

	_staffIn( room ) {

		if ( this._staff.has( room.id ) || ! room.R.staff || ! this.app || ! this.app.scene ) return;
		const st = this.rooms.staff( room );
		const pos = new Vector3( st.x, st.y, st.z );
		let v = null, shop = false;
		if ( room.def.shop ) {

			const S = room.def.shop;
			v = figure( { character: S.character }, { name: S.name, kind: 'shop', position: pos, yaw: st.yaw, radius: 2.2, greeting: S.greeting, idle: S.idle } );
			const inRange = v.inRange.bind( v );
			v.inRange = ( p ) => this.rooms.inside === room && inRange( p ); // (never through the wall)
			const list = this.app.game && this.app.game.vendors;
			if ( Array.isArray( list ) ) {

				list.push( v );
				shop = true;

			}

		} else if ( room.def.service === 'tavern' ) {

			const B = BARKEEP[ room.id ] || {};
			v = figure( B, { name: B.name || 'the barman', kind: 'figure', position: pos, yaw: st.yaw, radius: 0 } );
			v.inRange = () => false;

		}

		if ( ! v ) return;
		this.app.scene.add( v.group );
		this._staff.set( room.id, { vendor: v, shop } );

	}

	_staffOut( room ) {

		const s = this._staff.get( room.id );
		if ( ! s ) return;
		const v = s.vendor;
		if ( v.group.parent ) v.group.parent.remove( v.group );
		const list = this.app && this.app.game && this.app.game.vendors;
		if ( s.shop && Array.isArray( list ) ) {

			const i = list.indexOf( v );
			if ( i >= 0 ) list.splice( i, 1 );
			const hud = this.app.game.hud;
			if ( hud && hud.standOpen && hud.vendor === v && hud.closeStand ) hud.closeStand();

		}

		this._staff.delete( room.id );

	}

	// ------------------------------------------------------------------ per frame

	update( dt ) {

		const app = this.app, p = app && app.player;
		if ( this.rooms.list.length < INTERIORS.length ) this._bindRooms();
		const viewer = p ? ( app.freeCam && app.camera ? { x: app.camera.position.x, y: app.camera.position.y, z: app.camera.position.z } : p.position ) : null;
		const before = this.inside;
		// destroyed / mended (Tidemark's shells: smoking is destroyed), polled twice a second
		this._poll -= dt;
		if ( this._poll <= 0 ) {

			this._poll = 0.5;
			this._pollDamage();

		}

		const inside = this.rooms.update( dt, viewer );
		this.inside = inside;
		for ( const room of this.rooms.list ) {

			if ( room.loaded ) this._staffIn( room );
			else this._staffOut( room );

		}

		// the figures that are not in the game's vendor list
		const look = p && p.mode === 'walk' ? p.position : null;
		for ( const [ id, s ] of this._staff ) if ( ! s.shop ) s.vendor.update( dt, this.rooms.inside && this.rooms.inside.id === id ? look : null );
		if ( inside !== before ) {

			const F = this.features;
			if ( before && F && F.emit ) F.emit( 'interiorLeft', { id: before.id, port: before.def.port } );
			if ( inside ) {

				if ( F && F.emit ) F.emit( 'interiorEntered', { id: inside.id, port: inside.def.port } );
				const now = performance.now();
				if ( ! inside._toastAt || now - inside._toastAt > 60000 ) {

					inside._toastAt = now;
					if ( app && app.game && app.game.toast ) app.game.toast( inside.def.name, 1800 );

				}

			}

		}

		// the camera (Player.springArm calls player.indoor.arm when patched; else the camera is pulled in here)
		if ( p ) {

			if ( inside && ! app.freeCam ) {

				if ( ! p.indoor || p.indoor.room !== inside ) p.indoor = {
					room: inside,
					pivot: ( v ) => { v.y = Math.min( v.y, this.rooms.pivotTop( inside ) ); return v; },
					arm: ( pivot, dir, dist ) => { this._armUsed = true; return this.rooms.probe( pivot, dir, dist, inside ); },
				};
				if ( ! this._armUsed && p.view === 'third' && p.mode === 'walk' && app.camera && p.armPivot ) this._pullCamera( app.camera, p.armPivot, inside );

			} else if ( p.indoor ) p.indoor = null;

		}

		this._armUsed = false;
		// the outside muffled (sea, wind, the pier) while indoors
		const want = inside ? 1 : 0;
		this.muffle += ( want - this.muffle ) * ( 1 - Math.exp( - dt * 4 ) );
		this._audio();

	}

	// (without the Player patch) the arm's pivot under the ceiling, the camera along the same line from it, stopped by the room
	_pullCamera( cam, pivot, room ) {

		const v = this._v.copy( cam.position ).sub( pivot );
		const d = v.length();
		if ( d < 1e-3 ) return;
		v.multiplyScalar( 1 / d );
		const P = this._p || ( this._p = new Vector3() );
		P.copy( pivot );
		P.y = Math.min( P.y, this.rooms.pivotTop( room ) );
		const t = this.rooms.probe( P, v, d, room );
		cam.position.copy( P ).addScaledVector( v, t );

	}

	// ------------------------------------------------------------------ destroyed / mended

	_pollDamage() {

		const tm = this.app && this.app.ports && this.app.ports.tidemark;
		if ( ! tm || ! tm.damage || ! tm.buildings ) return;
		for ( const b of tm.buildings ) {

			if ( ! b.interior ) continue;
			const smoking = tm.damage.state( b.id ) === 'smoking';
			const room = this.rooms.byId.get( b.interior );
			if ( room && room._byDamage !== smoking ) {

				room._byDamage = smoking;
				this.setDestroyed( b.interior, smoking );

			}

		}

	}

	_byEvent( e, on ) {

		if ( ! e || typeof e.id !== 'string' ) return;
		for ( const room of this.rooms.list ) {

			const short = room.id.split( '.' )[ 1 ];
			if ( e.id === room.id || e.id === short || e.building === room.id ) this.setDestroyed( room.id, on );

		}

	}

	setDestroyed( id, on ) {

		const room = this.rooms.byId.get( id );
		if ( ! room ) return false;
		const wasIn = this.rooms.inside === room || ( this.app && this.app.player && this.rooms.contains( room, this.app.player.position.x, this.app.player.position.y, this.app.player.position.z, 0.1 ) );
		const changed = this.rooms.setDestroyed( id, on );
		if ( on ) {

			this._staffOut( room );
			if ( wasIn ) this.eject( room );

		}

		return changed;

	}

	// out onto the step in front of the doorway, facing away from it
	eject( room ) {

		const p = this.app && this.app.player;
		if ( ! p ) return false;
		const d = this.rooms.door( room );
		const g = p.groundAt ? p.groundAt( d.x, d.z, room.floorY + 0.6 ) : room.floorY;
		p.position.set( d.x, Number.isFinite( g ) ? g : room.floorY, d.z );
		if ( p.velocity ) p.velocity.set( 0, 0, 0 );
		p.yaw = d.yawOut;
		p.mode = p.mode === 'walk' || p.mode === 'swim' ? 'walk' : p.mode;
		p.indoor = null;
		p.armInit = false;
		const hb = this._harbour();
		if ( hb && hb.panel && hb.panel.isOpen && hb.openSite && hb.openSite.interior === room.id ) hb.close();
		if ( this.app.game && this.app.game.toast ) this.app.game.toast( EJECT_TOAST[ room.id ] || `${ room.def.name } is on fire: out!`, 2600 );
		if ( this.features && this.features.emit ) this.features.emit( 'interiorEjected', { id: room.id, port: room.def.port } );
		this.rooms.inside = null;
		return true;

	}

	// ------------------------------------------------------------------ for others

	// opts.tavern: only the taverns' rooms (where townlife's tavern-goers go when the patio is full)
	seatsFor( port, opts = {} ) {

		const out = [];
		for ( const room of this.rooms.list ) if ( room.def.port === port && ! room.destroyed && ( ! opts.tavern || room.def.service === 'tavern' ) ) out.push( ...this.rooms.seats( room ) );
		return out;

	}

	door( id ) {

		const room = this.rooms.byId.get( id );
		return room ? this.rooms.door( room ) : null;

	}

	// puts the player inside a room (tests, captures, a story beat)
	enter( id ) {

		const s = this.rooms.enter( id ), p = this.app && this.app.player;
		if ( ! s || ! p ) return s;
		p.position.set( s.x, s.y, s.z );
		if ( p.velocity ) p.velocity.set( 0, 0, 0 );
		p.yaw = s.yaw;
		p.mode = 'walk';
		p.armInit = false;
		return s;

	}

	// ------------------------------------------------------------------ the muffle: a low-pass between the outdoor beds and their bus

	_audio() {

		const a = this.app && this.app.audio;
		if ( ! a || ! a.ctx || ! a.ambAbove ) return;
		if ( ! this._mf ) {

			if ( this.muffle < 0.01 ) return; // (wired the first time it is needed)
			try {

				const c = a.ctx, lp = c.createBiquadFilter(), g = c.createGain();
				lp.type = 'lowpass';
				lp.frequency.value = 20000;
				lp.Q.value = 0.6;
				lp.connect( g );
				g.connect( a.ambAbove );
				const nodes = [ a.surfPan, a.windLP, a.pierPan ].filter( Boolean );
				for ( const n of nodes ) {

					n.disconnect( a.ambAbove );
					n.connect( lp );

				}

				this._mf = { lp, g, nodes, a };

			} catch ( e ) {

				this._mf = { failed: true };

			}

		}

		const M = this._mf;
		if ( M.failed ) return;
		const t = M.a.ctx.currentTime, k = this.muffle;
		M.lp.frequency.setTargetAtTime( 20000 * Math.pow( 700 / 20000, k ), t, 0.08 );
		M.g.gain.setTargetAtTime( 1 - 0.55 * k, t, 0.08 );

	}

	reset() {

		for ( const room of this.rooms.list ) if ( room.destroyed ) this.setDestroyed( room.id, false );

	}

	dispose() {

		for ( const off of this._removers ) try { off(); } catch ( e ) { /* gone */ }
		this._removers = [];
		for ( const room of this.rooms.list ) this._staffOut( room );
		this.rooms.dispose();
		const M = this._mf;
		if ( M && ! M.failed ) try {

			for ( const n of M.nodes ) {

				n.disconnect( M.lp );
				n.connect( M.a.ambAbove );

			}

			M.g.disconnect();

		} catch ( e ) { /* the context is gone */ }

		this._mf = null;
		if ( this.app && this.app.player ) this.app.player.indoor = null;

	}

}

export function install( app, features, opts = {} ) {

	return new InteriorsFeature( app, features, opts );

}

export { Interiors };

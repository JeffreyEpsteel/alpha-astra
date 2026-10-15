// Wrecks: the player's sunk boat lies on the sea floor where she went down, with her hold (the cargo crates, and the fish
// when you were aboard) waiting for a diver, until Captain Roid raises her (naval.salvage). Other players' wrecks arrive as
// world events and are drawn too (no loot, no marker: those belong to their owners).
//
//   const wrecks = new Wrecks( { app, features, scene, makeModel } );   // naval owns one (naval.wrecks)
//   wrecks.own                   { id, boat, name, x, y, z, yaw, roll, pitch, loot, abandoned } | null (one at a time)
//   wrecks.create( { boat, x, z, yaw, list, loot } ) -> record   a new wreck (an older one of yours is gone, contents too)
//   wrecks.claimLoot() -> bool   E beside it (diving): the hold back aboard you (cargo crates past the hold's room come too)
//   wrecks.salvaged() -> record | null    raised: removed (its loot goes back to you), the others are told
//   wrecks.abandon()             the owner traded the boat away: no salvage any more; the wreck stays while it holds loot
//   wrecks.remote                Map id -> record of other players' wrecks (remoteWorldEvent 'wreck' / 'wreckSalvaged')
//   wrecks.update( dt ) / toJSON() / fromJSON( d ) / reset() / dispose()
//
// Shared through app.netsync.sendWorldEvent( 'wreck', { id, boat, name, x, y, z, yaw, roll, pitch } ) and
// ( 'wreckSalvaged', { id } ). The hull is lost on its owner's machine (the hits land there) and announced from it.
// Marker on the maps (worldmap.addMarker, this player only): id 'wreck', kind 'wreck', cleared when salvaged / emptied.
// Events: wreckLooted { boat, fish, cargo } (naval emits wreckSalvaged).

import { BOATS } from '../../game/Boats.js';
import { LAYERS } from '../../core/SceneRenderer.js';
import { strip, stow, isEmpty, clean, summary, empty } from '../death/Belongings.js';
import { ClaimSpot } from '../death/Spot.js';

export const WRECK_EVENT = 'wreck';
export const WRECK_GONE_EVENT = 'wreckSalvaged';
export const SALVAGE_SHARE = 0.25; // of the boat's price
const MARKER_ID = 'wreck';
const MAX_REMOTE = 12;
const BUBBLE_RANGE = 160; // m from the camera

export { strip, stow };

// what Captain Roid asks to raise boat `id` (rounded to $10, at least $150)
export function salvageCostFor( id ) {

	const b = BOATS[ id ];
	return Math.max( 150, Math.round( ( b ? b.price || 0 : 600 ) * SALVAGE_SHARE / 10 ) * 10 );

}

function boatName( id ) {

	return ( BOATS[ id ] && BOATS[ id ].name ) || 'boat';

}

// how a hull settles at (x, z): on the floor (half buried in the sand), listed hard to one side, bow down a little;
// in shallow water she still ends below the surface where she can
export function floorPose( terrain, x, z, boatId, list = 1 ) {

	const b = BOATS[ boatId ] || {};
	const floor = terrain && terrain.heightAt ? terrain.heightAt( x, z ) : - 12;
	const draft = Number.isFinite( b.draft ) ? b.draft : 0.8;
	const y = Math.min( floor + draft * 0.35, - 0.6 );
	return { y, roll: ( list < 0 ? - 1 : 1 ) * 0.62, pitch: - 0.09 };

}

const finite = ( ...v ) => v.every( Number.isFinite );

export class Wrecks {

	constructor( { app = {}, features = null, scene = null, makeModel = null } = {} ) {

		this.app = app || {};
		this.features = features;
		this.scene = scene;
		this.makeModel = makeModel; // ( boatId ) -> model { group, ready? }; default createBoatModel when there is a scene
		this.own = null;
		this.remote = new Map();
		this._mk = { wm: null, key: '' };
		this._bubbleT = 0;
		this._offs = [];
		if ( features && features.on ) this._offs.push( features.on( 'remoteWorldEvent', ( e ) => this._onRemote( e ) ) );
		this.spot = new ClaimSpot( this.app, features, {
			id: 'wreck-hold',
			position: () => {

				const w = this.own;
				return w && ! isEmpty( w.loot ) ? { x: w.x, y: w.y + 0.8, z: w.z } : null;

			},
			prompt: () => ( this.own && ! isEmpty( this.own.loot ) ? `Recover the hold of the ${ this.own.name } (${ summary( this.own.loot ) })` : null ),
			onClaim: () => this.claimLoot(),
			radius: 4.5, reach: 4,
		} );

	}

	get terrain() {

		return this.app.terrainData || null;

	}

	_tag() {

		const st = this.features && this.features.state;
		const n = st && typeof st.name === 'string' && st.name.trim() ? st.name.trim().replace( /[^\w-]/g, '' ).slice( 0, 12 ) : 'me';
		return `${ n || 'me' }-${ Date.now().toString( 36 ) }`;

	}

	create( { boat, x, z, yaw = 0, list = 1, loot = null, abandoned = false } ) {

		if ( ! BOATS[ boat ] || ! finite( x, z ) ) return null;
		if ( this.own ) this._clearOwn( true ); // one at a time: the older wreck (and what she held) is lost
		const pose = floorPose( this.terrain, x, z, boat, list );
		const w = {
			id: this._tag(), boat, name: boatName( boat ), x, z, y: pose.y, yaw: Number.isFinite( yaw ) ? yaw : 0, roll: pose.roll, pitch: pose.pitch,
			loot: loot ? clean( loot ) : empty(), abandoned: !! abandoned,
		};
		this.own = w;
		this._mesh( w );
		this._syncMarker( true );
		this._send( WRECK_EVENT, this._public( w ) );
		return w;

	}

	// the hold back to you (diving beside her); an abandoned wreck with nothing left is gone
	claimLoot() {

		const w = this.own;
		if ( ! w || isEmpty( w.loot ) ) return false;
		const what = summary( w.loot );
		const got = stow( this.features, w.loot );
		w.loot = empty();
		this._emit( 'wreckLooted', { boat: w.boat, fish: got.fish, cargo: got.cargo } );
		this._toast( `Recovered from the ${ w.name }: ${ what }`, 3600 );
		if ( w.abandoned ) this._clearOwn( false );
		else this._syncMarker( true );
		return true;

	}

	// raised by the yard: the wreck goes, its hold comes back with her
	salvaged() {

		const w = this.own;
		if ( ! w ) return null;
		if ( ! isEmpty( w.loot ) ) stow( this.features, w.loot );
		w.loot = empty();
		this._clearOwn( false );
		this._send( WRECK_GONE_EVENT, { id: w.id } );
		return w;

	}

	abandon() {

		const w = this.own;
		if ( ! w || w.abandoned ) return;
		w.abandoned = true;
		if ( isEmpty( w.loot ) ) this._clearOwn( false );
		else this._syncMarker( true );

	}

	_clearOwn( lost ) {

		const w = this.own;
		if ( ! w ) return;
		this._unmesh( w );
		this.own = null;
		this._syncMarker( true );
		if ( lost ) this._send( WRECK_GONE_EVENT, { id: w.id } );

	}

	_public( w ) {

		const r = ( v ) => Math.round( v * 100 ) / 100;
		return { id: w.id, boat: w.boat, name: w.name, x: r( w.x ), y: r( w.y ), z: r( w.z ), yaw: r( w.yaw ), roll: r( w.roll ), pitch: r( w.pitch ) };

	}

	// ---- other players' wrecks
	_onRemote( e ) {

		if ( ! e || typeof e !== 'object' ) return;
		const d = e.data && typeof e.data === 'object' ? e.data : null;
		if ( ! d || typeof d.id !== 'string' ) return;
		if ( this.own && d.id === this.own.id ) return; // our own, replayed by the universe
		if ( e.kind === WRECK_EVENT ) {

			if ( ! BOATS[ d.boat ] || ! finite( d.x, d.z ) ) return;
			const old = this.remote.get( d.id );
			if ( old ) this._unmesh( old );
			if ( ! old && this.remote.size >= MAX_REMOTE ) {

				const first = this.remote.keys().next().value;
				this._unmesh( this.remote.get( first ) );
				this.remote.delete( first );

			}

			const pose = floorPose( this.terrain, d.x, d.z, d.boat );
			const w = {
				id: d.id, boat: d.boat, name: boatName( d.boat ), x: d.x, z: d.z, y: Number.isFinite( d.y ) ? d.y : pose.y,
				yaw: Number.isFinite( d.yaw ) ? d.yaw : 0, roll: Number.isFinite( d.roll ) ? d.roll : pose.roll, pitch: Number.isFinite( d.pitch ) ? d.pitch : pose.pitch,
				owner: e.from || null, remote: true,
			};
			this.remote.set( d.id, w );
			this._mesh( w );

		} else if ( e.kind === WRECK_GONE_EVENT ) {

			const w = this.remote.get( d.id );
			if ( w ) {

				this._unmesh( w );
				this.remote.delete( d.id );

			}

		}

	}

	// ---- meshes: the boat's own model, settled on the floor
	_mesh( w ) {

		if ( ! this.scene ) return;
		const token = w._token = {};
		const make = this.makeModel
			? Promise.resolve( this.makeModel( w.boat ) )
			: import( '../../world/boat/BoatFactory.js' ).then( ( m ) => m.createBoatModel( w.boat ) );
		make.then( ( model ) => {

			if ( ! model || ! model.group ) return;
			if ( w._token !== token ) {

				if ( model.dispose ) model.dispose();
				return;

			}

			w._model = model;
			const g = model.group;
			const lite = () => g.traverse && g.traverse( ( o ) => {

				if ( o.material ) for ( const m of Array.isArray( o.material ) ? o.material : [ o.material ] ) m.underwaterLighting = 'lite';
				// (as App.setBoat does for the boat you sail: the trap and glass draw with the transparent pass)
				if ( o.isMesh && ( o.name === 'boat-trap' || o.name === 'boat-glass' ) && o.layers ) o.layers.set( LAYERS.TRANSPARENT );

			} );
			lite();
			if ( model.ready && model.ready.then ) model.ready.then( lite ).catch( () => {} );
			if ( g.rotation ) g.rotation.order = 'YXZ';
			g.position.set( w.x, w.y, w.z );
			if ( g.rotation ) g.rotation.set( w.pitch, w.yaw, w.roll );
			if ( model.setThrottle ) try { model.setThrottle( 0 ); model.setPropellerRPM && model.setPropellerRPM( 0 ); } catch ( e ) { /* decoration */ }
			this.scene.add( g );

		} ).catch( ( e ) => console.warn( 'wreck model failed', e ) );

	}

	_unmesh( w ) {

		if ( ! w ) return;
		w._token = null;
		const m = w._model;
		w._model = null;
		if ( m && m.group && this.scene ) this.scene.remove( m.group );
		if ( m && m.dispose ) try { m.dispose(); } catch ( e ) { /* gone anyway */ }

	}

	// ---- the map marker (this player only), re-sent when the world map appears or the wreck changes
	_syncMarker( force = false ) {

		const f = this.features, wm = f && f.get ? f.get( 'worldmap' ) : null;
		const w = this.own;
		const key = w ? `${ w.id }|${ w.abandoned }|${ isEmpty( w.loot ) }` : '';
		if ( ! force && wm === this._mk.wm && key === this._mk.key ) return;
		if ( this._mk.wm && this._mk.wm.removeMarker && ( this._mk.wm !== wm || ! w ) ) this._mk.wm.removeMarker( MARKER_ID );
		this._mk.wm = wm;
		this._mk.key = key;
		if ( ! wm || ! wm.addMarker ) return;
		if ( w ) wm.addMarker( { id: MARKER_ID, kind: 'wreck', x: w.x, z: w.z, label: `Wreck of the ${ w.name }`, icon: 'wreck', mine: true } );
		else wm.removeMarker( MARKER_ID );

	}

	update( dt ) {

		this.spot.update();
		this._syncMarker();
		// a thin stream of bubbles from the hulls near the camera
		this._bubbleT -= dt;
		if ( this._bubbleT > 0 ) return;
		this._bubbleT = 2.5 + Math.random() * 1.5;
		const f = this.features, v = f && f.get ? f.get( 'vfx' ) : null;
		const cam = this.app.camera && this.app.camera.position;
		if ( ! v || typeof v.bubbles !== 'function' || ! cam ) return;
		const each = ( w ) => {

			if ( w && Math.hypot( w.x - cam.x, w.z - cam.z ) < BUBBLE_RANGE ) v.bubbles( w.x + ( Math.random() - 0.5 ) * 2, w.y + 1, w.z + ( Math.random() - 0.5 ) * 2, 0.35 );

		};
		each( this.own );
		for ( const w of this.remote.values() ) each( w );

	}

	// ---- save (our own wreck only)
	toJSON() {

		const w = this.own;
		return w ? { ...this._public( w ), loot: clean( w.loot ), abandoned: !! w.abandoned } : null;

	}

	fromJSON( d ) {

		if ( this.own ) {

			this._unmesh( this.own );
			this.own = null;

		}

		if ( d && typeof d === 'object' && BOATS[ d.boat ] && finite( d.x, d.z ) ) {

			const pose = floorPose( this.terrain, d.x, d.z, d.boat );
			this.own = {
				id: typeof d.id === 'string' ? d.id : this._tag(), boat: d.boat, name: boatName( d.boat ), x: d.x, z: d.z,
				y: Number.isFinite( d.y ) ? d.y : pose.y, yaw: Number.isFinite( d.yaw ) ? d.yaw : 0,
				roll: Number.isFinite( d.roll ) ? d.roll : pose.roll, pitch: Number.isFinite( d.pitch ) ? d.pitch : pose.pitch,
				loot: clean( d.loot ), abandoned: !! d.abandoned,
			};
			this._mesh( this.own );

		}

		this._syncMarker( true );

	}

	reset() {

		if ( this.own ) this._unmesh( this.own );
		this.own = null;
		for ( const w of this.remote.values() ) this._unmesh( w );
		this.remote.clear();
		this._syncMarker( true );

	}

	dispose() {

		for ( const off of this._offs ) off();
		this._offs.length = 0;
		this.spot.dispose();
		this.reset();

	}

	_send( kind, data ) {

		const ns = this.app.netsync;
		try { if ( ns && ns.sendWorldEvent ) ns.sendWorldEvent( kind, data ); } catch ( e ) { /* offline */ }

	}

	_emit( name, e ) {

		const f = this.features;
		if ( f && f.emit ) f.emit( name, e );

	}

	_toast( text, ms ) {

		const g = this.app.game;
		if ( g && g.toast ) g.toast( text, ms );

	}

}

import { WORLD } from '../../world/WorldLayout.js';
import { FogGrid, worldBounds, revealRadius, FOG_CELL, questPinMarker, questPinId, parkedAirframes } from './MapLogic.js';
import { WorldMap } from '../../ui/WorldMap.js';
import { iconFor } from '../../game/Minimap.js';
import { questJournalModel } from '../../ui/QuestJournal.js';

// The world map (feature module): a full-screen chart in the minimap's style (src/ui/WorldMap.js draws it) with
// every island and port, the player, the boat, the seaplane, the other players, the stalls and the yard, the notice
// boards, bounty targets and pirates, the raider camp and a waypoint. Islands not yet discovered (GameState
// `discovered`) are faint silhouettes with a "?"; the sea the player has not been near stays under a coarse fog
// (cells revealed around the player, kept in the save; the sandbox shows everything).
//
//   features.add( 'worldmap', worldmap );   // import * as worldmap from './features/worldmap/index.js'
//   const m = features.get( 'worldmap' );
//   m.open() / close() / toggle() / isOpen     the overlay (M; Escape closes; gamepad D-pad left)
//   m.waypoint -> { x, z } | null              m.setWaypoint( { x, z } | null )  (also on the minimap, with its rim arrow)
//   m.fog (FogGrid), m.bounds, m.discovered( islandId ), m.wantsMouse()
//   m.addMarker( { id, kind, x, z, label, icon, mine } ) / m.removeMarker( id ) / m.markers (Map id -> marker)
//                                              a generic pin on both maps (the world map and the minimap) with a distance
//                                              readout: kind 'death' | 'wreck' | 'pin' (badge colour), icon an ICON name
//                                              ('chest', 'wreck', 'flag'...) or an svg string; mine: this player's own (not
//                                              shared; all markers are local). Same id again moves / relabels it. Not saved:
//                                              their owners re-add them after a load.
//   m.update( dt ) / toJSON() / fromJSON( d ) / reset() / dispose()
//
// Wave 13C: the legend (src/ui/WorldMap.js, rows from MapLogic.legendRows) names every badge: ports, the airstrip (Tidemark
// discovered), the pirate island and its battery reach (Blackwater discovered), wrecks, the sea chest, parked planes, quest
// pins, the boat and its crew. Undiscovered islands are a "?" until discovered (MapLogic.discoveryState); Tidemark's terrain is
// baked from its own tile. Two more kinds of generic marker come from here:
//   quest pins   features 'questPin' { id, x, z, label } (the story feature: a step naming a place) puts a 'quest' pin on both
//                maps, 'questPinClear' { id } removes it; they are kept in the save (m.pins), so a loaded game still shows
//                them (the story feature raising questPin again just moves the same pin)
//   parked planes  every owned airframe standing at its base other than the one out (seaplane.fleet / seaplane.base( id )): the
//                Kestrel on the airstrip's pad, the seaplanes at the ramp; 'parked:<id>' markers kept in step every half second
// Opening frees the mouse (pointer lock off) and blocks the rod (isOpen / wantsMouse through the registry); the
// world keeps running (nothing pauses, single player or not). While it is open the map takes W A S D / arrows (pan),
// + / - (zoom) and C (back to the player) so the player stands still. Event: waypointChanged { waypoint }.

const SAVE_VERSION = 1;
const REVEAL_EVERY = 0.25; // s
const ARRIVE = 15; // m: a waypoint this close is reached and cleared

export class WorldMapFeature {

	constructor( app, features ) {

		this.app = app || {};
		this.features = features || null;
		this.bounds = worldBounds( WORLD, this.app.terrainData );
		this.fog = new FogGrid( this.bounds, FOG_CELL );
		this.waypoint = null;
		this.selectedQuest = null;
		this.trackedQuest = null;
		this._questT = 0;
		this.markers = new Map();
		this.pins = new Map(); // quest id -> marker (saved)
		this._parked = new Set(); // ids of the parked-plane markers
		this._parkT = 0;
		this.off = [];
		this._mmMarks = { mm: null, sent: new Map() }; // what the minimap was given: id -> signature
		this.ui = null;
		this._uiFailed = false;
		this._t = 0;
		this._mmSent = { mm: null, wp: undefined };
		// M is the map's (Shift+M stays with the sound: App's mute)
		this.keyOk = features && features.claimKey ? features.claimKey( 'KeyM', 'worldmap' ) : true;
		// the keys go through a window capture listener added now, at install, so it runs before the pause
		// menu's (created later): an Escape that closes the map never also opens the menu
		this._onKey = ( e ) => this._key( e );
		if ( typeof window !== 'undefined' && window.addEventListener ) window.addEventListener( 'keydown', this._onKey, { capture: true } );
		if ( features && features.on ) {

			this.off.push( features.on( 'questPin', ( e ) => this.pinQuest( e ) ) );
			this.off.push( features.on( 'questPinClear', ( e ) => this.clearQuestPin( e && e.id ) ) );

		}

	}

	// a quest step's place as a pin on both maps (the same id again moves / relabels it)
	questRows() { return questJournalModel( this.app, this.features ).rows; }

	selectQuest( id ) {

		if ( id !== null && ! this.questRows().some( ( r ) => r.id === id ) ) return false;
		this.selectedQuest = id;
		return true;

	}

	trackQuest( id ) {

		if ( id !== null && ! this.selectQuest( id ) ) return false;
		this.trackedQuest = id;
		this.reconcileQuests();
		return true;

	}

	reconcileQuests( rows = this.questRows() ) {

		if ( this.selectedQuest && ! rows.some( ( q ) => q.id === this.selectedQuest ) ) this.selectedQuest = null;
		const q = rows.find( ( r ) => r.id === this.trackedQuest );
		if ( ! q ) this.trackedQuest = null;
		if ( q?.target ) this.addMarker( { id: 'journal-target', kind: 'quest', icon: 'quest', ...q.target, label: `Tracked: ${ q.title } · ${ q.target.label }` } );
		else this.removeMarker( 'journal-target' );

	}

	showQuest( id ) {

		const q = this.questRows().find( ( r ) => r.id === id );
		if ( ! q?.target || ! this.open() ) return false;
		this.trackQuest( id );
		this.ui.focusOn( q.target, q.title );
		return true;

	}

	clearTrackedQuest() {

		this.trackQuest( null );
		if ( this.ui?.targetEl ) this.ui.targetEl.hidden = true;

	}

	pinQuest( e ) {

		const m = questPinMarker( e );
		if ( ! m ) return false;
		this.pins.set( m.id, m );
		return this.addMarker( m );

	}

	clearQuestPin( id ) {

		if ( id === undefined || id === null ) return false;
		const key = questPinId( id );
		const had = this.pins.delete( key );
		return this.removeMarker( key ) || had;

	}

	// the airframes parked at their bases, as markers (only while their island is discovered)
	_syncParked() {

		const sp = this.features && this.features.get ? this.features.get( 'seaplane' ) : null;
		const want = new Map();
		for ( const p of parkedAirframes( sp, ( id ) => this.discovered( id ) ) ) want.set( 'parked:' + p.id, p );
		for ( const id of [ ...this._parked ] ) if ( ! want.has( id ) ) {

			this._parked.delete( id );
			this.removeMarker( id );

		}

		for ( const [ id, p ] of want ) {

			this._parked.add( id );
			this.addMarker( { id, kind: 'parked', icon: 'plane', x: p.x, z: p.z, label: `${ p.name } (parked)`, mine: false } );

		}

	}

	get sandbox() {

		return !! ( this.features && this.features.sandbox );

	}

	get isOpen() {

		return !! ( this.ui && this.ui.isOpen );

	}

	wantsMouse() {

		return this.isOpen;

	}

	open() {

		const ui = this._ensureUI();
		const opened = ui ? ui.open() : false;
		if ( opened ) this.features?.get?.( 'notices' )?.closeBoard?.();
		return opened;

	}

	close() {

		if ( this.ui ) this.ui.close();

	}

	toggle() {

		return this.isOpen ? ( this.close(), false ) : this.open();

	}

	// home is always charted; the sandbox charts everything
	discovered( id ) {

		if ( id === 'home' || this.sandbox ) return true;
		const st = this.features && this.features.state;
		return !! ( st && Array.isArray( st.discovered ) && st.discovered.includes( id ) );

	}

	setWaypoint( p ) {

		const wp = p && Number.isFinite( p.x ) && Number.isFinite( p.z ) ? { x: p.x, z: p.z } : null;
		const same = wp === this.waypoint || ( wp && this.waypoint && wp.x === this.waypoint.x && wp.z === this.waypoint.z );
		if ( same ) return;
		this.waypoint = wp;
		this._syncMinimap();
		if ( this.features && this.features.emit ) this.features.emit( 'waypointChanged', { waypoint: wp ? { ...wp } : null } );

	}

	// ---- generic markers (the sea chest, wrecks): both maps, with a distance readout
	addMarker( m ) {

		if ( ! m || m.id === undefined || m.id === null || ! Number.isFinite( m.x ) || ! Number.isFinite( m.z ) ) return false;
		const id = String( m.id );
		this.markers.set( id, {
			id, kind: typeof m.kind === 'string' && /^[\w-]+$/.test( m.kind ) ? m.kind : 'pin', x: m.x, z: m.z,
			label: typeof m.label === 'string' ? m.label : '', icon: typeof m.icon === 'string' ? m.icon : 'flag', mine: m.mine !== false,
		} );
		this._syncMinimapMarkers();
		return true;

	}

	removeMarker( id ) {

		const had = this.markers.delete( String( id ) );
		if ( had ) this._syncMinimapMarkers();
		return had;

	}

	_syncMinimapMarkers() {

		const mm = this.app.game && this.app.game.minimap;
		if ( ! mm || typeof mm.addMarker !== 'function' ) return;
		const S = this._mmMarks;
		if ( S.mm !== mm ) {

			S.mm = mm;
			S.sent = new Map();

		}

		for ( const [ id ] of S.sent ) if ( ! this.markers.has( id ) ) {

			mm.removeMarker( id );
			S.sent.delete( id );

		}

		for ( const [ id, m ] of this.markers ) {

			const sig = `${ m.kind }|${ m.x }|${ m.z }|${ m.label }|${ m.icon }`;
			if ( S.sent.get( id ) === sig ) continue;
			mm.addMarker( m );
			S.sent.set( id, sig );

		}

	}

	// the world map's own marker list (src/ui/WorldMap.js _collect) gets ours appended, labelled with the distance
	_collectMarkers( list ) {

		if ( ! this.markers.size ) return;
		const p = this.app.player && this.app.player.position;
		for ( const m of this.markers.values() ) {

			const d = p ? Math.hypot( m.x - p.x, m.z - p.z ) : null;
			const far = d === null ? '' : d >= 1000 ? `${ ( d / 1000 ).toFixed( d >= 10000 ? 0 : 1 ) } km` : `${ Math.round( d ) } m`;
			list.push( { key: 'pin:' + m.id, kind: m.kind + ( m.id === 'journal-target' ? ' is-tracked' : '' ), icon: iconFor( m.icon ), x: m.x, z: m.z, label: m.label ? ( far ? `${ m.label } · ${ far }` : m.label ) : far, minor: m.kind === 'parked', edge: m.kind !== 'parked', rot: null, hot: m.kind === 'death' } );

		}

	}

	// the minimap is built lazily with the HUD: send it the waypoint whenever either changes
	_syncMinimap() {

		const mm = this.app.game && this.app.game.minimap;
		if ( ! mm || typeof mm.setWaypoint !== 'function' ) return;
		if ( this._mmSent.mm === mm && this._mmSent.wp === this.waypoint ) return;
		mm.setWaypoint( this.waypoint );
		this._mmSent.mm = mm;
		this._mmSent.wp = this.waypoint;

	}

	_ensureUI() {

		if ( this.ui || this._uiFailed ) return this.ui;
		const ui = this.app.ui && this.app.ui.ui;
		if ( ! ui || typeof document === 'undefined' || ! document.head ) return null;
		try {

			this.ui = new WorldMap( ui.hud || ui.root, this.app, this );
			// our generic markers ride on the map's own collection pass (the drawing stays in WorldMap.js)
			const own = this.ui._collect;
			if ( typeof own === 'function' ) this.ui._collect = ( list ) => {

				own.call( this.ui, list );
				try { this._collectMarkers( list ); } catch ( e ) { /* markers are extras */ }

			};

		} catch ( e ) {

			console.warn( 'world map UI failed', e );
			this._uiFailed = true;

		}

		return this.ui;

	}

	_key( e ) {

		if ( this.keyOk === false && ! this.isOpen ) return;
		const t = e.target;
		if ( t && ( t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable ) ) return;
		const ui = this._ensureUI();
		if ( ui ) ui.key( e );

	}

	update( dt ) {

		const app = this.app, p = app.player;
		this._ensureUI();
		this._questT -= dt;
		if ( this._questT <= 0 ) { this._questT = 0.5; this.reconcileQuests(); }

		// the fog lifts around the player (not from the free camera)
		this._t -= dt;
		if ( this._t <= 0 && p && p.position && ! app.freeCam ) {

			this._t = REVEAL_EVERY;
			const camY = app.camera && app.camera.position ? app.camera.position.y : 0;
			this.fog.reveal( p.position.x, p.position.z, revealRadius( p.mode, Math.max( p.position.y || 0, camY ) ) );

		}

		// a waypoint reached is cleared
		if ( this.waypoint && p && p.position && Math.hypot( p.position.x - this.waypoint.x, p.position.z - this.waypoint.z ) < ARRIVE ) {

			this.setWaypoint( null );
			const g = app.game;
			if ( g && g.toast ) g.toast( 'Waypoint reached', 1800 );

		}

		this._parkT -= dt;
		if ( this._parkT <= 0 ) {

			this._parkT = 0.5;
			this._syncParked();

		}

		this._syncMinimap();
		this._syncMinimapMarkers();
		if ( this.ui ) this.ui.update( dt );

	}

	toJSON() {

		const wp = this.waypoint;
		const pins = [ ...this.pins.values() ].map( ( m ) => ( { id: m.id.slice( 6 ), x: Math.round( m.x * 10 ) / 10, z: Math.round( m.z * 10 ) / 10, label: m.label } ) );
		return { v: SAVE_VERSION, fog: this.fog.toJSON(), wp: wp ? { x: Math.round( wp.x * 10 ) / 10, z: Math.round( wp.z * 10 ) / 10 } : null, selectedQuest: this.selectedQuest, trackedQuest: this.trackedQuest, ...( pins.length ? { pins } : {} ) };

	}

	fromJSON( d ) {

		if ( ! d || typeof d !== 'object' ) return;
		this.fog.fromJSON( d.fog );
		const questId = ( v ) => typeof v === 'string' && /^(story|notice|contract):.{1,100}$/.test( v ) ? v : null;
		this.selectedQuest = questId( d.selectedQuest );
		this.trackedQuest = questId( d.trackedQuest );
		this.removeMarker( 'journal-target' );
		this._questT = 0; // resolve after every feature has restored its save
		for ( const id of [ ...this.pins.keys() ] ) this.clearQuestPin( id.slice( 6 ) );
		if ( Array.isArray( d.pins ) ) for ( const p of d.pins.slice( 0, 24 ) ) this.pinQuest( p );
		const wp = d.wp;
		this.setWaypoint( wp && Number.isFinite( wp.x ) && Number.isFinite( wp.z ) ? wp : null );

	}

	reset() {

		this.close();
		this.fog.clear();
		this.selectedQuest = this.trackedQuest = null;
		this.removeMarker( 'journal-target' );
		this.setWaypoint( null );
		for ( const id of [ ...this.pins.keys() ] ) this.clearQuestPin( id.slice( 6 ) );
		for ( const id of [ ...this._parked ] ) this.removeMarker( id );
		this._parked.clear();

	}

	dispose() {

		for ( const f of this.off ) try { f(); } catch ( e ) { /* ignore */ }
		this.off.length = 0;
		if ( typeof window !== 'undefined' && window.removeEventListener ) window.removeEventListener( 'keydown', this._onKey, { capture: true } );
		if ( this.ui ) this.ui.dispose();
		this.ui = null;

	}

}

export function install( app, features ) {

	return new WorldMapFeature( app, features );

}

export { FogGrid, MapView, worldBounds, edgeClamp, niceScale, pickWaypoint, revealRadius, compass, FOG_CELL } from './MapLogic.js';

export default { install };

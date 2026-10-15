import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WorldMapFeature } from '../src/features/worldmap/index.js';
import { MapView } from '../src/features/worldmap/MapLogic.js';
import { WorldMap } from '../src/ui/WorldMap.js';
import { QuestJournal, questJournalModel, questJournalHTML } from '../src/ui/QuestJournal.js';
import { NoticeUI } from '../src/features/notices/NoticeUI.js';
import { Notices } from '../src/features/notices/Notices.js';
import { PORT_INFO } from '../src/features/notices/NoticeData.js';
import { STAND } from '../src/game/FishStand.js';

function rig() {

	const active = [ { id: 'voyage', title: 'A voyage', step: 'Meet the dockhand', frac: 0, where: 'Pons Cove' } ];
	let target = { x: 700, z: - 800, label: 'Dockhand' };
	const story = { journal: () => ( { active, entries: [], offers: [] } ), pinOf: () => target };
	const notices = { hours: 10, notes: [], active: [ { id: 'home:0:1', title: 'Visit Pons', type: 'visitPort', kind: 'quest', params: { port: 'pons' }, goal: 1, progress: 0, expires: 20, port: 'home' } ], closeBoard() { this.closed = true; } };
	const contracts = { active: [ { id: 'firstCatch', kind: 'intro', title: 'First catch', text: 'Catch a fish', goal: 1, progress: 0, done: false } ] };
	const minimap = { markers: new Map(), addMarker( m ) { this.markers.set( m.id, m ); }, removeMarker( id ) { this.markers.delete( id ); }, setWaypoint() {} };
	const app = { game: { contracts, minimap }, player: { position: { x: 0, z: 0 } } };
	const registry = new Map( [ [ 'story', story ], [ 'notices', notices ] ] );
	const features = { get: ( id ) => registry.get( id ), on: () => () => {}, claimKey: () => true, emit() {} };
	app.features = features;
	const map = new WorldMapFeature( app, features ); registry.set( 'worldmap', map );
	return { app, map, story, active, notices, contracts, minimap, features, moveTarget: ( p ) => { target = p; } };

}

test( 'selection, explicit tracking, live step target and untrack clean both maps', () => {

	const r = rig();
	assert.equal( r.map.selectQuest( 'missing' ), false );
	assert.equal( r.map.selectQuest( 'story:voyage' ), true );
	assert.equal( r.map.markers.has( 'journal-target' ), false, 'selection alone does not silently start tracking' );
	r.map.trackQuest( 'story:voyage' );
	assert.equal( r.map.markers.get( 'journal-target' ).x, 700 );
	assert.equal( r.minimap.markers.get( 'journal-target' ).z, - 800 );
	r.moveTarget( { x: 420, z: 90, label: 'Next step' } ); r.map.reconcileQuests();
	assert.equal( r.map.markers.get( 'journal-target' ).x, 420 );
	r.moveTarget( null ); r.map.reconcileQuests();
	assert.equal( r.map.markers.has( 'journal-target' ), false, 'step without fixed place clears old marker' );
	assert.equal( r.map.trackedQuest, 'story:voyage', 'quest remains tracked through location-free steps' );
	r.map.clearTrackedQuest();
	assert.equal( r.map.trackedQuest, null );
	assert.equal( r.minimap.markers.has( 'journal-target' ), false );

} );

test( 'completed, abandoned and expired objectives cannot leave a tracked target', () => {

	const r = rig(); r.map.trackQuest( 'story:voyage' );
	r.active.splice( 0 ); r.map.reconcileQuests();
	assert.equal( r.map.selectedQuest, null ); assert.equal( r.map.trackedQuest, null );
	assert.equal( r.map.markers.has( 'journal-target' ), false );
	r.map.trackQuest( 'notice:home:0:1' );
	r.notices.hours = 21; r.map.reconcileQuests();
	assert.equal( r.map.trackedQuest, null ); assert.equal( r.map.selectedQuest, null );

} );

test( 'target semantics use real destinations and only show a fishing hand-in when ready', () => {

	const r = rig();
	let rows = questJournalModel( r.app, r.features ).rows;
	assert.deepEqual( rows.find( ( q ) => q.id.startsWith( 'notice:' ) ).target, { ...PORT_INFO.pons.anchor, label: PORT_INFO.pons.name } );
	assert.equal( rows.find( ( q ) => q.id === 'contract:firstCatch' ).target, null );
	assert.match( questJournalHTML( questJournalModel( r.app, r.features ), 'contract:firstCatch', null ), /no fixed map location/ );
	assert.match( questJournalHTML( { ...questJournalModel( r.app, r.features ) }, 'contract:firstCatch', null ), /data-qj-map disabled/ );
	Object.assign( r.contracts.active[ 0 ], { done: true, progress: 1 } );
	rows = questJournalModel( r.app, r.features ).rows;
	const target = rows.find( ( q ) => q.id === 'contract:firstCatch' ).target;
	assert.equal( target.x, STAND.x ); assert.equal( target.z, STAND.z );
	r.map.trackQuest( 'contract:firstCatch' ); r.contracts.active.splice( 0 ); r.map.reconcileQuests();
	assert.equal( r.map.trackedQuest, null );

} );

test( 'show on map focuses objective and closes journal; no destination does not open a map', () => {

	const r = rig();
	const ui = { isOpen: false, open() { this.isOpen = true; return true; }, focusOn( p ) { this.focus = p; }, close() { this.isOpen = false; } };
	r.map.ui = ui;
	assert.equal( r.map.showQuest( 'contract:firstCatch' ), false ); assert.equal( ui.isOpen, false );
	assert.equal( r.map.showQuest( 'story:voyage' ), true );
	assert.equal( ui.focus.x, 700 ); assert.equal( r.notices.closed, true );
	assert.equal( r.map.trackedQuest, 'story:voyage' );
	const view = new MapView( { x0: - 2000, x1: 2000, z0: - 2000, z1: 2000 } ); view.setSize( 1000, 700 );
	const actual = { view, _render() { this.rendered = true; } };
	assert.equal( WorldMap.prototype.focusOn.call( actual, { x: 700, z: - 800 } ), true );
	assert.equal( view.cx, 700 ); assert.equal( view.cz, - 800 ); assert.equal( actual.rendered, true );
	assert.equal( WorldMap.prototype.focusOn.call( actual, { x: NaN, z: 0 } ), false );

} );

test( 'save compatibility, reset, malformed selection and restored stale objective', () => {

	const r = rig(); r.map.trackQuest( 'story:voyage' );
	const saved = JSON.parse( JSON.stringify( r.map.toJSON() ) );
	const loaded = rig(); loaded.map.fromJSON( saved ); loaded.map.reconcileQuests();
	assert.equal( loaded.map.selectedQuest, 'story:voyage' ); assert.equal( loaded.map.trackedQuest, 'story:voyage' );
	assert.equal( loaded.map.markers.get( 'journal-target' ).x, 700 );
	loaded.map.fromJSON( { v: 1, wp: { x: 12, z: 25 } } );
	assert.equal( loaded.map.selectedQuest, null ); assert.equal( loaded.map.trackedQuest, null );
	assert.deepEqual( loaded.map.waypoint, { x: 12, z: 25 } );
	loaded.map.fromJSON( { selectedQuest: {}, trackedQuest: 'story:removed' } ); loaded.map.reconcileQuests();
	assert.equal( loaded.map.trackedQuest, null );
	loaded.map.trackQuest( 'story:voyage' ); loaded.map.reset();
	assert.equal( loaded.map.markers.has( 'journal-target' ), false );

} );

test( 'journal buttons select, track, untrack and switch to the map without a browser dependency', () => {

	const r = rig(), owner = { close() { this.closed = true; } };
	const journal = new QuestJournal( { app: r.app, features: r.features }, owner );
	journal.render = () => {};
	const click = ( attr, value ) => journal.click( { target: { closest: () => ( { hasAttribute: ( a ) => a === attr, dataset: { qjSelect: value } } ) } } );
	click( 'data-qj-select', 'story:voyage' ); assert.equal( r.map.selectedQuest, 'story:voyage' );
	click( 'data-qj-track' ); assert.equal( r.map.trackedQuest, 'story:voyage' );
	click( 'data-qj-track' ); assert.equal( r.map.trackedQuest, null );
	r.map.ui = { open: () => true, focusOn() {} };
	click( 'data-qj-map' ); assert.equal( owner.closed, true );
	const model = questJournalModel( r.app, r.features ); model.rows[ 0 ].title = '<img onerror="bad">';
	assert.doesNotMatch( questJournalHTML( model, 'story:voyage', null ), /<img/ );

} );

test( 'actual journal keyboard handler consumes Escape before pause and J closes once', () => {

	const listeners = [];
	class Element {

		constructor() { this.classList = { add() {}, remove() {}, toggle() {} }; }
		append() {} addEventListener() {} removeEventListener() {} querySelectorAll() { return []; }
	}
	globalThis.document = { createElement: () => new Element(), getElementById: () => null, head: new Element() };
	globalThis.window = { addEventListener: ( name, fn ) => listeners.push( fn ), removeEventListener() {} };
	try {

		const n = { active: [], app: {}, features: { get: () => null } };
		const ui = new NoticeUI( n, { root: new Element() } ); ui.view = 'journal'; ui.isOpen = true;
		let prevent = 0, stop = 0, immediate = 0;
		const key = ( code, repeat = false ) => ui._key( { code, repeat, preventDefault() { prevent ++; }, stopPropagation() { stop ++; }, stopImmediatePropagation() { immediate ++; } } );
		key( 'Escape', true );
		assert.equal( ui.isOpen, false ); assert.equal( prevent, 1 ); assert.equal( stop, 1 ); assert.equal( immediate, 1 );
		key( 'Escape' ); assert.equal( prevent, 1, 'closed journal must leave Escape to other panels' );
		ui.isOpen = true; key( 'KeyJ', true ); assert.equal( ui.isOpen, true );
		key( 'KeyJ' ); assert.equal( ui.isOpen, false );
		const map = { close() { this.closed = true; } };
		Notices.prototype.toggleJournal.call( { _getUI: () => ( { isOpen: false, open() {} } ), features: { get: () => map } } );
		assert.equal( map.closed, true, 'opening journal closes map' );

	} finally { delete globalThis.document; delete globalThis.window; }

} );

// Plain-node test of exploration (src/features/exploration): treasure caches on the real heightmap (shore chests above
// the tideline of every island, wreck strongboxes in diving depth, the fallen chest under the inverted landmark),
// discovery, the once-only claim through the E interactable, the chart scrap, the save; the spyglass (G levels, the
// zoomed fov handed back, slowed look, labels for ports and ships, spotting a cache in the middle of the glass, Escape,
// not while swimming); the heading ribbon (headings, marks). No GPU, no DOM.
// usage: node test/feature-exploration.mjs
globalThis.location = globalThis.location || { search: '' };
const { Features } = await import( '../src/features/Features.js' );
const ex = await import( '../src/features/exploration/index.js' );
const { cacheSites, LOOT } = await import( '../src/features/exploration/Treasure.js' );
const { spyTargets, project, ZOOMS, SPOT_SECONDS } = await import( '../src/features/exploration/Spyglass.js' );
const { headingOf, wrapDelta, ribbonMarks } = await import( '../src/features/exploration/HeadingRibbon.js' );
const inv = await import( '../src/features/inverted/index.js' );
const { TerrainData } = await import( '../src/world/TerrainData.js' );
const { WORLD } = await import( '../src/world/WorldLayout.js' );
const { Vector3, PerspectiveCamera } = await import( '../src/engine/index.js' );

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};
const T = new TerrainData();

// ---- the sites
const lm = inv.invertedLayout( WORLD ).find( ( s ) => s.landmark );
const sites = cacheSites( WORLD, T, { landmark: lm } );
{

	const shore = sites.filter( ( s ) => s.kind === 'shore' ), wreck = sites.filter( ( s ) => s.kind === 'wreck' ), fallen = sites.filter( ( s ) => s.kind === 'fallen' );
	ok( shore.length === WORLD.islands.length, `a shore chest on every island (${ shore.length } / ${ WORLD.islands.length })` );
	ok( shore.every( ( s ) => s.y > 1.2 && s.y < 3 && Math.abs( T.heightAt( s.x, s.z ) - s.y ) < 1e-6 ), 'all above the tideline, on the ground' );
	ok( wreck.length >= 1 && wreck.every( ( s ) => s.y < - 4 && s.y > - 9 ), `${ wreck.length } wreck strongboxes in 4 - 9 m of water` );
	ok( fallen.length === 1, 'the fallen chest under the landmark' );
	ok( new Set( sites.map( ( s ) => s.id ) ).size === sites.length && sites.every( ( s ) => s.money > 0 ), 'unique ids, finite loot' );
	const again = cacheSites( WORLD, T, { landmark: lm } );
	ok( JSON.stringify( again ) === JSON.stringify( sites ), 'deterministic (every client agrees)' );
	ok( sites.reduce( ( a, s ) => a + s.money, 0 ) < 10000, 'the total is finite and modest: $' + sites.reduce( ( a, s ) => a + s.money, 0 ) );

}

// ---- the feature
function make( mode = 'campaign', extra = {} ) {

	const toasts = [], keys = new Set(), hits = new Set();
	const camera = new PerspectiveCamera( 60, 16 / 9, 0.1, 2000 );
	camera.position.set( 50, 3, - 60 );
	const st = { money: 0, earned: 0, earn( a ) { this.money += a; return this.money; } };
	const app = {
		mode, settings: { timeOfDay: 12 },
		scene: { children: [], add( o ) { this.children.push( o ); }, remove() {} },
		camera, cameraWaterHeight: 0,
		player: { position: new Vector3( 50, 2, - 60 ), mode: 'walk' },
		terrainData: T, game: { toast: ( s ) => toasts.push( s ), state: st },
		input: { sensitivity: 1, hit: ( k ) => hits.has( k ), down: ( k ) => keys.has( k ) },
		...extra,
	};
	const features = new Features( app );
	Object.defineProperty( features, 'state', { get: () => st } );
	const i = features.add( 'inverted', inv );
	const e = features.add( 'exploration', ex );
	const press = ( k ) => { hits.add( k ); features.update( 0.016 ); hits.clear(); };
	return { app, features, e, i, toasts, press, st };

}

const run = ( m, s, dt = 0.05 ) => { for ( let k = 0; k < s / dt; k ++ ) m.features.update( dt ); };

{

	const m = make();
	run( m, 0.2 );
	const tr = m.e.treasure;
	ok( tr.sites && tr.sites.length === sites.length && tr.group && m.app.scene.children.includes( tr.group ), 'sites made on the first update, chests in the scene' );
	const s = tr.sites.find( ( q ) => q.kind === 'shore' );
	m.app.player.position.set( s.x + 30, s.y, s.z );
	run( m, 0.5 );
	ok( ! tr.found.has( s.id ), 'not noticed from 30 m on foot' );
	m.app.player.position.set( s.x + 8, s.y, s.z );
	run( m, 0.5 );
	ok( tr.found.has( s.id ) && m.toasts.some( ( x ) => /glint/i.test( x ) ), 'noticed from 8 m (a glint)' );
	ok( tr.markers().some( ( k ) => k.id === 'treasure-' + s.id && ! k.claimed ), 'now on the world map markers' );
	m.app.player.position.set( s.x + 1, s.y, s.z );
	const near = m.features.nearestInteractable( m.app.player.position );
	ok( near && near.id === 'treasure-' + s.id && /Dig/.test( near.prompt() ), 'E: dig up the chest' );
	near.onInteract();
	ok( tr.claimed.has( s.id ) && m.st.money === s.money && tr.trinkets.includes( s.trinket ), `claimed once: $${ s.money } and the ${ s.trinket }` );
	ok( tr.claim( s.id ) === null && m.st.money === s.money, 'a second claim pays nothing' );
	ok( ! m.features.nearestInteractable( m.app.player.position ), 'no prompt on an opened chest' );
	ok( tr.found.size === 2, 'the chart scrap marks the next cache' );
	const d = JSON.parse( JSON.stringify( m.features.toJSON() ) );
	const n = make();
	n.features.fromJSON( d );
	run( n, 0.2 );
	ok( n.e.treasure.claimed.has( s.id ) && n.e.treasure.found.size === 2 && n.e.treasure.trinkets.length === 1, 'found, claimed and trinkets are saved' );
	n.app.player.position.set( s.x + 1, s.y, s.z );
	ok( ! n.features.nearestInteractable( n.app.player.position ), 'a loaded claimed chest stays shut to you' );
	n.features.reset();
	ok( n.e.treasure.claimed.size === 0, 'a new game restocks the caches' );
	// a wreck is not seen from the shore, but is when diving close
	const w = tr.sites.find( ( q ) => q.kind === 'wreck' );
	m.app.player.mode = 'swim';
	m.app.player.position.set( w.x + 2, - 2, w.z );
	run( m, 0.5 );
	ok( tr.found.has( w.id ), 'diving by the wreck shows its strongbox' );
	m.app.player.position.set( w.x, w.y + 0.8, w.z );
	const wn = m.features.nearestInteractable( m.app.player.position );
	ok( wn && /strongbox/.test( wn.prompt() ), 'down at it: pry it open' );

}

// ---- the spyglass
{

	const m = make();
	run( m, 0.2 );
	const sg = m.e.spyglass, cam = m.app.camera;
	cam.fov = 60; cam.updateProjectionMatrix();
	m.press( 'KeyG' );
	ok( sg.level === 1 && Math.abs( cam.fov - 60 / ZOOMS[ 0 ] ) < 1e-9, `G: x${ ZOOMS[ 0 ] } (fov ${ cam.fov })` );
	ok( m.app.input.sensitivity < 1, 'mouse look slowed while zoomed' );
	m.press( 'KeyG' );
	ok( sg.level === 2 && Math.abs( cam.fov - 60 / ZOOMS[ 1 ] ) < 1e-9, `G again: x${ ZOOMS[ 1 ] }` );
	m.press( 'KeyG' );
	ok( sg.level === 0 && cam.fov === 60 && m.app.input.sensitivity === 1, 'a third time: lowered, fov and look handed back' );
	// labels: look at Pons from the home harbour
	const pons = WORLD.ports.find( ( p ) => p.id === 'pons' );
	cam.position.set( 55, 4, 30 );
	cam.lookAt( pons.stand.x, 6, pons.stand.z );
	cam.updateMatrixWorld();
	m.press( 'KeyG' );
	run( m, 0.1 );
	ok( sg.labels.some( ( l ) => l.kind === 'port' && l.label === pons.name && l.dist > 500 ), `Pons labelled in the glass (${ sg.labels.map( ( l ) => l.label ).join( ', ' ) })` );
	const pr = project( cam, { x: pons.stand.x, y: 6, z: pons.stand.z } );
	ok( pr && Math.abs( pr.x - 0.5 ) < 0.01 && Math.abs( pr.y - 0.5 ) < 0.01, 'project: the target in the middle of the view' );
	ok( project( cam, { x: 55, y: 4, z: - 500 } ) === null, 'project: behind the camera is null' );
	// ships from the naval API
	m.features.list.set( 'naval', { module: {}, instance: { ships: [ { x: 300, z: 280, name: 'Black Gull', faction: 'pirate', state: 'patrol' } ] } } );
	const tg = spyTargets( m.app, m.features, m.e.treasure );
	ok( tg.some( ( x ) => x.kind === 'ship' && x.label === 'Black Gull' && x.faction === 'pirate' ), 'ships come from naval.ships' );
	ok( tg.some( ( x ) => x.kind === 'wreck' ), 'wrecks are listed' );
	m.features.list.delete( 'naval' );
	m.e.spyglass.close();
	// spotting an unknown cache: hold it in the middle of the glass
	const tr = m.e.treasure;
	const c = tr.sites.find( ( q ) => ! tr.found.has( q.id ) && q.kind === 'shore' );
	m.app.player.position.set( c.x + 300, 3, c.z + 300 );
	cam.position.set( c.x + 300, 6, c.z + 300 );
	cam.lookAt( c.x, c.y + 0.5, c.z );
	cam.updateMatrixWorld();
	m.press( 'KeyG' );
	run( m, SPOT_SECONDS + 0.3 );
	ok( tr.found.has( c.id ) && sg.spotted === 1 && m.toasts.some( ( x ) => /Spotted/.test( x ) ), 'held in the glass: spotted and charted' );
	m.features.closePanels();
	ok( sg.level === 0, 'Escape (closePanels) lowers it' );
	m.app.player.mode = 'swim';
	m.press( 'KeyG' );
	ok( sg.level === 0, 'not while swimming' );
	const other = new Features( {} );
	other.claimKey( 'KeyG', 'someone' );
	const blocked = other.add( 'exploration', ex );
	ok( blocked.spyglass.keyOk === false, 'a taken key is reported, not fought over' );

}

// ---- the ribbon
{

	ok( headingOf( 0, - 1 ) === 0 && Math.abs( headingOf( 1, 0 ) - 90 ) < 1e-9 && Math.abs( headingOf( 0, 1 ) - 180 ) < 1e-9 && Math.abs( headingOf( - 1, 0 ) - 270 ) < 1e-9, 'headings: N -z, E +x, S +z, W -x' );
	ok( wrapDelta( 350, 10 ) === 20 && wrapDelta( 10, 350 ) === - 20, 'deltas wrap through north' );
	const marks = ribbonMarks( 350, [ { id: 'a', deg: 10 }, { id: 'b', deg: 200 }, { id: 'c', deg: 300 } ] );
	ok( marks.length === 2 && marks.find( ( x ) => x.id === 'a' ).offset > 0 && marks.find( ( x ) => x.id === 'c' ).offset < 0, 'only what is inside the strip, on the right side' );
	const m = make();
	const r = m.e.ribbon;
	run( m, 0.1 );
	ok( ! r.visible, 'hidden on land' );
	m.app.player.mode = 'boat';
	m.app.boatCtl = { position: new Vector3( 60, 0, 40 ), quaternion: { x: 0, y: 0, z: 0, w: 1 } };
	m.app.camera.position.set( 60, 3, 40 );
	m.app.camera.lookAt( 60, 3, 140 );
	m.app.camera.updateMatrixWorld();
	run( m, 0.3 );
	ok( r.visible && Math.abs( r.heading - 180 ) < 0.5, `afloat: shown, looking south reads ${ r.heading.toFixed( 1 ) }` );
	ok( r.marks.some( ( x ) => x.kind === 'bow' && Math.abs( x.offset ) < 0.01 ), 'the bow mark (hull +z = south) sits under the centre' );

}

console.log( fails ? `\n${ fails } exploration check(s) FAILED` : '\nall exploration checks passed' );
process.exit( fails ? 1 : 0 );

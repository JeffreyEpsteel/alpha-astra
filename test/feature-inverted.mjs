// Plain-node test of the inverted layer (src/features/inverted): the layout (a landmark visible from the home harbour
// and Pons Cove, islets clear of the far plane, one over an Inverted Isles port when it exists), the procedural mesh,
// the looks (void, yellow) and the haze link that never compounds, opt-in, the Easter-egg trigger, multiplayer
// sharing, the save. No GPU.
// usage: node test/feature-inverted.mjs
globalThis.location = globalThis.location || { search: '' };
const { Features } = await import( '../src/features/Features.js' );
const inv = await import( '../src/features/inverted/index.js' );
const { invertedLayout, rootPool, proximity, elevationFrom, visibleFrom, SPIRE } = await import( '../src/features/inverted/Layout.js' );
const { Islets } = await import( '../src/features/inverted/Islets.js' );
const { PRESETS, lookFor, HazeLink } = await import( '../src/features/inverted/Look.js' );
const { WORLD } = await import( '../src/world/WorldLayout.js' );
const { Vector3 } = await import( '../src/engine/index.js' );

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};

const port = ( id ) => WORLD.ports.find( ( p ) => p.id === id );

// ---- layout
{

	const L = invertedLayout( WORLD );
	const lm = L.filter( ( s ) => s.landmark );
	ok( lm.length === 1 && L.length >= 4, `one landmark and a few islets (${ L.length })` );
	for ( const id of [ 'home', 'pons' ] ) {

		const p = port( id );
		const e = elevationFrom( lm[ 0 ], p.stand.x, p.stand.z, 3 );
		ok( visibleFrom( lm[ 0 ], p.stand.x, p.stand.z, 3 ), `the landmark's beacon is ${ e.toFixed( 1 ) } deg up from ${ id } and inside the far plane` );

	}

	ok( L.every( ( s ) => s.y - ( s.landmark ? SPIRE : 0 ) > 120 ), 'everything hangs well above masts and hills (> 120 m)' );
	const pool = rootPool( L );
	ok( pool.r > 20 && Math.hypot( pool.x - lm[ 0 ].x, pool.z - lm[ 0 ].z ) < 1, 'the root pool lies under the landmark' );
	ok( proximity( L, lm[ 0 ].x, lm[ 0 ].z ) === 1 && proximity( L, 5000, 5000 ) === 0, 'proximity: 1 under an islet, 0 far away' );
	const W2 = { ...WORLD, ports: [ ...WORLD.ports, { id: 'inverted', name: 'Inverted Isles', center: { x: - 900, z: 900 } } ] };
	ok( invertedLayout( W2 ).some( ( s ) => s.id === 'over-inverted' && s.x === - 900 ), 'an Inverted Isles port gets an islet of its own (WORLD.ports read at call time)' );

}

// ---- mesh
{

	const isl = new Islets( invertedLayout( WORLD ) );
	const pos = isl.geometry.attributes.position.array;
	let finite = true;
	for ( let i = 0; i < pos.length; i ++ ) if ( ! Number.isFinite( pos[ i ] ) ) { finite = false; break; }
	ok( isl.triangles > 1500 && isl.triangles < 20000 && finite, `one mesh, ${ isl.triangles } triangles, all finite` );
	const sw = isl.geometry.attributes.aSway.array, gl = isl.geometry.attributes.aGlow.array;
	let swaying = 0, glowing = 0;
	for ( let i = 2; i < sw.length; i += 3 ) if ( sw[ i ] > 0 ) swaying ++;
	for ( let i = 0; i < gl.length; i ++ ) if ( gl[ i ] > 0 ) glowing ++;
	ok( swaying > 1000 && glowing > 0, `roots and crowns sway (${ swaying } vertices), the beacon glows (${ glowing })` );
	isl.setGold( 2 );
	ok( isl.material.uniforms.gold.value === 1, 'gold is clamped to 0..1' );

}

// ---- looks and the haze link
{

	ok( lookFor().alpha === 0 && lookFor().haze === 1, 'off: no veil, haze untouched' );
	const near = lookFor( { enabled: true, proximity: 1 } ), far = lookFor( { enabled: true, proximity: 0 } );
	ok( near.alpha > far.alpha && far.alpha > 0 && near.haze > 1, 'the void deepens under the islets and never fully goes while on' );
	const y = lookFor( { enabled: true, proximity: 0.3, egg: 1 } );
	ok( y.gold === 1 && y.top[ 0 ] > y.top[ 2 ] * 3 && y.haze === PRESETS.yellow.haze, 'egg: the yellow preset (gold sky, golden islets)' );
	const app = { haze: { density: { value: 1.6 } } };
	const h = new HazeLink();
	h.apply( app, 1.25 );
	ok( Math.abs( app.haze.density.value - 2.0 ) < 1e-9, 'haze multiplied from its base' );
	h.apply( app, 1.25 ); h.apply( app, 1.25 );
	ok( Math.abs( app.haze.density.value - 2.0 ) < 1e-9, 'repeated frames do not compound' );
	app.haze.density.value = 0.8; // the weather wrote a new absolute value
	h.apply( app, 1.25 );
	ok( Math.abs( app.haze.density.value - 1.0 ) < 1e-9, 'a value written by someone else becomes the new base' );
	h.apply( app, 1 );
	ok( Math.abs( app.haze.density.value - 0.8 ) < 1e-9 && h.last === null, 'released: the base is handed back once' );
	app.haze.density.value = 1.1;
	h.apply( app, 1 );
	ok( app.haze.density.value === 1.1, 'idle: hands off' );

}

// ---- the feature
function make( mode = 'campaign', param = null, extra = {} ) {

	const toasts = [], sent = [];
	const app = {
		mode, settings: { timeOfDay: 23 },
		scene: { children: [], add( o ) { this.children.push( o ); }, remove() {} },
		camera: { position: new Vector3( 50, 3, - 70 ) }, cameraWaterHeight: 0,
		player: { position: new Vector3( 50, 2, - 70 ), mode: 'walk' },
		haze: { density: { value: 1.6 } },
		game: { toast: ( s ) => toasts.push( s ) },
		netsync: { sendWorldEvent: ( kind, data ) => sent.push( { kind, data } ) },
		...extra,
	};
	const features = new Features( app );
	const i = features.add( 'inverted', { install: ( a, f ) => new inv.Inverted( a, f, { param } ) } );
	return { app, features, i, toasts, sent };

}

const run = ( m, s, dt = 0.1 ) => { for ( let k = 0; k < s / dt; k ++ ) m.features.update( dt ); };

{

	const m = make();
	run( m, 2 );
	ok( ! m.i.enabled && ! m.i.islets && m.app.haze.density.value === 1.6, 'opt-in: off by default, nothing built, haze untouched' );
	m.i.setEnabled( true );
	run( m, 1 );
	ok( m.i.islets && m.i.islets.mesh.visible && m.app.scene.children.length === 2, 'enabled: islets and veil added to the scene' );
	ok( m.app.haze.density.value > 1.6, 'the void raises the haze' );
	ok( m.i.markers().length === 1 && m.i.markers()[ 0 ].kind === 'landmark', 'the landmark is exposed for the world map' );
	m.i.setEnabled( false );
	run( m, 1 );
	ok( ! m.i.islets.mesh.visible && ! m.i.veil.mesh.visible && Math.abs( m.app.haze.density.value - 1.6 ) < 1e-9, 'disabled: hidden and the haze handed back' );

	// URL
	ok( make( 'campaign', '' ).i.enabled && ! make( 'campaign', '0' ).i.enabled, '?inverted turns it on, ?inverted=0 off' );

	// unlock at an Inverted Isles port (added to WORLD.ports like the islands worker will)
	WORLD.ports.push( { id: 'inverted', name: 'Inverted Isles', center: { x: - 900, z: 900 } } );
	const u = make();
	u.features.emit( 'portVisited', { port: 'pons' } );
	ok( ! u.i.enabled, 'an ordinary port does not turn it on' );
	u.features.emit( 'portVisited', { port: 'inverted' } );
	ok( u.i.enabled && u.i.unlocked && u.toasts.length === 1, 'reaching the Inverted Isles turns the sky over (one tip)' );
	WORLD.ports.pop();

}

// ---- the Easter egg
{

	const m = make();
	m.i.setEnabled( true );
	m.features.emit( 'fishCaught', { species: 'cod', kg: 2 } );
	ok( m.i.eggT === 0, 'a catch away from the spire does nothing' );
	m.app.player.position.set( m.i.pool.x + 10, 0.5, m.i.pool.z );
	m.app.settings.timeOfDay = 14;
	m.features.emit( 'fishCaught', { species: 'cod', kg: 2 } );
	ok( m.i.eggT === 0, 'under the spire by day: nothing' );
	m.app.settings.timeOfDay = 23.5;
	m.features.emit( 'fishCaught', { species: 'cod', kg: 2 } );
	ok( m.i.eggT === inv.EGG_SECONDS && m.i.eggFound === 1, 'under the spire at night: the yellow world' );
	ok( m.sent.length === 1 && m.sent[ 0 ].kind === 'invertedEgg', 'shared with the crew as a world event' );
	run( m, 10 );
	ok( m.i.egg > 0.99 && m.i.look.gold > 0.99 && m.i.islets.material.uniforms.gold.value > 0.99, 'eased in: gold sky and islets' );
	run( m, inv.EGG_SECONDS + 10, 0.25 );
	ok( m.i.egg === 0 && m.i.look.gold === 0, 'it fades back after five minutes' );
	const e = make();
	e.i.setEnabled( true );
	e.app.player.position.set( e.i.layout[ 1 ].x, 0.5, e.i.layout[ 1 ].z );
	e.app.settings.timeOfDay = 12;
	e.features.emit( 'fishCaught', { species: 'upsidedowneel', kg: 1 } );
	ok( e.i.eggT > 0, 'an upside-down eel under any islet finds it too' );
	const r = make();
	r.features.emit( 'remoteWorldEvent', { kind: 'invertedEgg', data: {}, from: 'x' } );
	run( r, 10 );
	ok( r.i.egg > 0.99 && r.i.eggFound === 0 && r.sent.length === 0, 'a crewmate\'s egg shows here, not counted, not re-sent' );
	const c = make( 'campaign' );
	ok( c.i.setPreset( 'yellow' ) === false, 'presets are Sandbox only' );
	const s = make( 'sandbox' );
	ok( s.i.setPreset( 'yellow' ) && s.i.enabled, 'Sandbox: a forced preset' );
	run( s, 1 );
	ok( s.i.look.gold === 1, 'forced yellow applies at once' );

}

// ---- save
{

	const m = make();
	m.i.setEnabled( true ); m.i.unlocked = true; m.i.eggFound = 2;
	const d = JSON.parse( JSON.stringify( m.features.toJSON() ) );
	const n = make();
	n.features.fromJSON( d );
	ok( n.i.enabled && n.i.unlocked && n.i.eggFound === 2, 'enabled, unlocked and eggs found are saved' );
	n.features.reset();
	ok( ! n.i.enabled && n.i.eggFound === 0, 'a new game starts with it off' );
	n.i.dispose();

}

console.log( fails ? `\n${ fails } inverted check(s) FAILED` : '\nall inverted checks passed' );
process.exit( fails ? 1 : 0 );

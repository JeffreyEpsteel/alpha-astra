// Plain-node test of the night feature (src/features/night): the night curve against the sky's ramp, the
// phases and their event, the lamp ramp, the firefly / plankton / beam patterns, the budgets and the low preset,
// the disturbance packing, and the feature on a stand-in app: hidden and idle by day, plankton stirred by the boat,
// the bobber, ships and splashes, halos on the lamps, the lighthouse flash, the bobber's lantern light. No GPU.
// usage: node test/feature-night.mjs
globalThis.location = globalThis.location || { search: '' };
const { Features } = await import( '../src/features/Features.js' );
const nightMod = await import( '../src/features/night/index.js' );
const C = await import( '../src/features/night/NightCurve.js' );
const { MAX_STIR } = await import( '../src/features/night/Plankton.js' );
const { HALO, POOL, SPRITE, FLOAT, STREAK } = await import( '../src/features/night/Glow.js' );
const { Vector3, Color } = await import( '../src/engine/index.js' );
const { G } = await import( '../src/core/Globals.js' );
const { sunDirectionFromTime } = await import( '../src/sky/Sky.js' ).catch( () => ( {} ) );

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};
const near = ( a, b, e = 1e-6 ) => Math.abs( a - b ) <= e;

// ---------------------------------------------------------------------------------------------- the curve
{

	ok( C.nightFromHour( 12 ) === 0 && C.nightFromHour( 9.5 ) === 0, 'noon and the morning are day (0)' );
	ok( C.nightFromHour( 0 ) === 1 && C.nightFromHour( 23 ) === 1, 'midnight and 23:00 are deep night (1)' );
	let mono = true, prev = - 1;
	for ( let h = 12; h <= 24; h += 0.05 ) { const n = C.nightFromHour( h ); if ( n < prev - 1e-9 ) mono = false; prev = n; }
	ok( mono, 'the dusk ramp only rises from noon to midnight' );
	let maxStep = 0;
	for ( let h = 0; h < 24; h += 1 / 60 ) maxStep = Math.max( maxStep, Math.abs( C.nightFromHour( h + 1 / 60 ) - C.nightFromHour( h ) ) );
	ok( maxStep < 0.05, `smooth: no jump above 0.05 per game minute (${ maxStep.toFixed( 4 ) })` );
	const dusk = C.nightFromHour( 18.9 );
	ok( dusk > 0 && dusk < 1, `dusk is a ramp (18:54 -> ${ dusk.toFixed( 2 ) })` );
	if ( sunDirectionFromTime ) {

		let worst = 0;
		for ( let h = 0; h < 24; h += 0.25 ) {

			const y = sunDirectionFromTime( h ).y;
			worst = Math.max( worst, Math.abs( C.smooth( - y, 0.02, 0.18 ) - C.nightFromHour( h ) ) );

		}

		ok( worst < 0.02, `matches the sky's own G.night ramp (Sky.sunDirectionFromTime, worst ${ worst.toFixed( 4 ) })` );

	}

	ok( C.phaseOf( 12 ) === 'day' && C.phaseOf( 0 ) === 'night' && C.phaseOf( 18.7 ) === 'dusk' && C.phaseOf( 5.6 ) === 'dawn', 'phases: day / night / dusk / dawn' );
	ok( C.lampsOn( 0 ) === 0 && C.lampsOn( 1 ) === 1 && C.lampsOn( 0.45 ) > 0 && C.lampsOn( 0.45 ) < 1, 'lamps ramp in with the LocalLights curve' );
	ok( near( C.ease( 0, 1, 0.6, 0.6 ), 1 - Math.exp( - 1 ), 1e-9 ) && C.ease( 0.3, 1, 0 ) === 0.3, 'ease: first order, no step on dt 0' );

	let lo = 1, hi = 0, flashes = 0, was = false;
	for ( let t = 0; t < 20; t += 0.01 ) {

		const b = C.fireflyBlink( t, 3 );
		lo = Math.min( lo, b ); hi = Math.max( hi, b );
		const on = b > 0.5;
		if ( on && ! was ) flashes ++;
		was = on;

	}

	ok( lo >= 0.05 && hi > 0.9 && flashes >= 4 && flashes <= 11, `fireflies: an ember and a flash every 2-5 s (${ flashes } in 20 s)` );
	let pk = 0;
	for ( let t = 0; t < 5; t += 0.005 ) pk = Math.max( pk, C.planktonFlash( t, 7 ) );
	ok( pk > 0.6 && pk <= 1, `plankton cells flash (peak ${ pk.toFixed( 2 ) })` );
	ok( near( C.beamFacing( 0, 10, 0 ), 1 ) && near( C.beamFacing( 0, - 10, 0 ), 1 ), 'beam: both beams (angle and angle + PI) face along +X / -X at angle 0' );
	ok( C.beamFacing( 0, 0, 10 ) < 1e-6, 'beam: nothing at right angles' );
	ok( near( C.beamFacing( Math.PI / 2, 0, - 10 ), 1, 1e-9 ), 'beam: rotation.y turns +X toward -Z (GullRock convention)' );

	ok( C.BUDGET.low.plankton < C.BUDGET.normal.plankton && C.BUDGET.low.lights <= C.BUDGET.normal.lights && C.BUDGET.low.halos < C.BUDGET.normal.halos, 'the low preset draws less' );
	ok( C.isLowPreset( { settings: { quality: 'low' } } ) && C.isLowPreset( { settings: {}, qs: new URLSearchParams( 'lowFx' ) } ) && C.isLowPreset( { settings: { renderScale: 0.5 } } ), 'low preset: settings, ?lowFx, a low render scale' );
	ok( ! C.isLowPreset( { settings: { renderScale: 1 }, qs: new URLSearchParams( '' ) } ) && ! C.isLowPreset( null ), 'not low by default' );

	const items = [ { x: 10, z: 0 }, { x: 1, z: 0 }, { x: 5, z: 0 }, { x: 300, z: 0 } ];
	const nn = C.nearest( items, 0, 0, 2, 100 );
	ok( nn.length === 2 && nn[ 0 ].x === 1 && nn[ 1 ].x === 5, 'nearest: the n nearest within range, nearest first' );
	ok( C.nearest( items, 0, 0, 10, 100 ).length === 3, 'nearest: the range cuts' );

	const out = new Float32Array( 4 * 4 );
	const k = C.packDisturbances( [ { x: 0, z: 0, r: 1, s: 0.2 }, { x: 5, z: 0, r: 2, s: 1 }, { x: 0, z: 0, r: 1, s: 0 }, { x: 900, z: 0, r: 1, s: 1 } ], 0, 0, 4, out );
	ok( k === 2 && out[ 0 ] === 5 && out[ 3 ] === 1 && near( out[ 7 ], 0.2, 1e-6 ) && out[ 11 ] === 0 && out[ 10 ] === 1, 'packDisturbances: strongest first, dead and far skipped, the rest zeroed' );

}

// ---------------------------------------------------------------------------------------------- stand-ins

function makeApp( extra = {} ) {

	const scene = { children: [], add( o ) { this.children.push( o ); }, remove( o ) { this.children = this.children.filter( ( c ) => c !== o ); } };
	const lights = { sources: [], enabled: true, strength: 1, add( s ) { this.sources.push( s ); return s; }, remove( s ) { this.sources = this.sources.filter( ( c ) => c !== s ); } };
	// a dock lantern over the water, a village lantern on land, a window, a boat nav light, the lighthouse lamp
	lights.add( { position: new Vector3( 50, 3, 50 ), color: new Color( 1, 0.72, 0.42 ), intensity: 7.5, range: 11, kind: 'lantern', flicker: 0.08 } );
	lights.add( { position: new Vector3( - 20, 6, 0 ), color: new Color( 1, 0.72, 0.42 ), intensity: 7.5, range: 11, kind: 'lantern' } );
	lights.add( { position: new Vector3( - 22, 5, 3 ), color: new Color( 1, 0.8, 0.5 ), intensity: 1, range: 6, kind: 'window' } );
	lights.add( { position: new Vector3( 5, 3, 5 ), color: new Color( 1, 0.06, 0.03 ), intensity: 1.4, range: 8, kind: 'boatNav', update() {} } );
	lights.add( { position: new Vector3( 5, 2, 5 ), color: new Color( 1, 0.84, 0.62 ), intensity: 0.9, range: 5, kind: 'boatDome', update() {} } );
	const lampLight = { position: new Vector3( - 400, 40, 0 ), color: new Color( 1, 0.86, 0.58 ), intensity: 36, range: 80, kind: 'lantern' };
	lights.add( lampLight );
	const veg = { records: { shrubs: [], bananas: [] } };
	for ( let i = 0; i < 40; i ++ ) veg.records.shrubs.push( { x: - 30 + i * 2, y: 4, z: 6 } );
	const app = {
		mode: 'sandbox', settings: { timeOfDay: 12, renderScale: 1 }, qs: new URLSearchParams( '' ),
		sky: {}, scene, localLights: lights,
		camera: { position: new Vector3( 0, 3, 0 ) }, cameraWaterHeight: 0,
		terrainData: { heightAt: ( x, z ) => ( x < - 10 && x > - 60 ? 4 : - 8 ) },
		village: { path: { samples: Array.from( { length: 40 }, ( _, i ) => ( { p: new Vector3( - 40 + i, 4, 4 ) } ) ) }, sidePaths: [] },
		vegetation: veg,
		boatCtl: { position: new Vector3( 4, 0, 4 ), velocity: new Vector3( 5, 0, 0 ), speed: 5 },
		game: { rod: { state: 'floating', bobber: new Vector3( 8, 0, - 6 ) }, bite: null, fight: null },
		player: { mode: 'boat', position: new Vector3( 4, 1, 4 ) },
		ports: { gull: { lighthouse: { x: - 400, z: 0, y: 20, lampY: 40 }, _y: 40, lampLight, beams: { rotation: { y: 0 }, visible: true } } },
		...extra,
	};
	return app;

}

function make( extra = {}, ships = [] ) {

	const app = makeApp( extra );
	const features = new Features( app );
	features.add( 'naval', { install: () => ( { ships } ) } );
	features.add( 'weather', { install: () => ( { rainIntensity: 0, current: { rain: 0 } } ) } );
	const n = features.add( 'night', nightMod );
	if ( n && n.lights ) for ( const l of n.lights ) app.localLights.add( l );
	return { app, features, n };

}

const setNight = ( v ) => { G.night.value = v; };
const run = ( ctx, seconds, dt = 1 / 30 ) => { for ( let t = 0; t < seconds; t += dt ) ctx.features.update( dt ); };
const instances = ( glow ) => {

	const out = [];
	for ( let i = 0; i < glow.geometry.instanceCount; i ++ ) out.push( { p: glow.pos.array.slice( i * 4, i * 4 + 4 ), c: glow.col.array.slice( i * 4, i * 4 + 4 ) } );
	return out;

};

// ---------------------------------------------------------------------------------------------- the feature
{

	setNight( 0 );
	const ctx = make();
	const { n, app } = ctx;
	ok( !! n && typeof n.update === 'function', 'installs through the registry' );
	ok( !! n.glow && !! n.plankton && app.scene.children.length === 2, 'two meshes in the scene (glow and plankton)' );
	ok( n.lights.length === C.BUDGET.normal.lights && n.lights.every( ( l ) => l.enabled === false ), 'pooled local lights, all off by day' );
	run( ctx, 1 );
	ok( n.nightFactor === 0 && n.phase === 'day' && ! n.active, 'daylight: factor 0, phase day, idle' );
	ok( ! n.glow.mesh.visible && ! n.plankton.mesh.visible, 'daylight: nothing drawn' );
	ok( n.swarms === null, 'daylight: the swarms are not even built' );

	// dusk to night
	const phases = [];
	ctx.features.on( 'nightPhase', ( e ) => phases.push( e.phase ) );
	app.settings.timeOfDay = 18.6;
	setNight( 0.6 );
	run( ctx, 0.2 );
	ok( n.nightFactor > 0.55, 'the factor follows the sky (a big change is taken at once)' );
	app.settings.timeOfDay = 23;
	setNight( 1 );
	run( ctx, 3 );
	ok( n.nightFactor > 0.99 && n.isNight(), `deep night: factor ${ n.nightFactor.toFixed( 3 ) }` );
	ok( phases.join( ',' ) === 'dusk,night', `nightPhase events: ${ phases.join( ',' ) }` );
	ok( n.active && n.plankton.mesh.visible && n.plankton.geometry.instanceCount === C.BUDGET.normal.plankton, 'night: plankton drawn with the normal budget' );

	// stirrings: the moving boat and the bobber
	const st = n.plankton.stir;
	const packed = [];
	for ( let i = 0; i < MAX_STIR; i ++ ) if ( st[ i * 4 + 3 ] > 0 ) packed.push( [ st[ i * 4 ], st[ i * 4 + 1 ], st[ i * 4 + 2 ], st[ i * 4 + 3 ] ] );
	ok( packed.some( ( d ) => d[ 0 ] === 4 && d[ 1 ] === 4 && d[ 3 ] > 1 ), 'the moving boat stirs the plankton' );
	ok( packed.some( ( d ) => d[ 0 ] === 8 && d[ 1 ] === - 6 && near( d[ 3 ], 0.22 ) ), 'the floating bobber stirs a faint ring' );
	app.game.bite = { phase: 'take' };
	run( ctx, 0.1 );
	ok( Array.from( { length: MAX_STIR }, ( _, i ) => i ).some( ( i ) => st[ i * 4 ] === 8 && st[ i * 4 + 3 ] > 1 ), 'a take lights the water round the bobber' );
	ctx.features.emit( 'cannonballImpact', { x: 20, y: 0, z: 0, hit: 'water', energy: 2 } );
	run( ctx, 0.1 );
	ok( Array.from( { length: MAX_STIR }, ( _, i ) => i ).some( ( i ) => st[ i * 4 ] === 20 && st[ i * 4 + 3 ] > 0.5 ), 'a cannonball splash stirs the water' );
	run( ctx, 3 );
	ok( ! Array.from( { length: MAX_STIR }, ( _, i ) => i ).some( ( i ) => st[ i * 4 ] === 20 && st[ i * 4 + 3 ] > 0 ), '... and fades after a few seconds' );
	app.game.bite = null;

	// glows
	run( ctx, 0.1 );
	const g = instances( n.glow );
	ok( n.glow.mesh.visible && g.length > 0, `night: glows drawn (${ g.length } instances)` );
	const at = ( x, z, mode ) => g.filter( ( i ) => near( i.p[ 0 ], x, 1e-3 ) && near( i.p[ 2 ], z, 1e-3 ) && i.c[ 3 ] === mode );
	ok( at( 50, 50, HALO ).length === 1, 'a halo on the dock lantern' );
	ok( at( 50, 50, POOL ).length === 1, 'the dock lantern lays a pool on the water' );
	ok( at( - 20, 0, HALO ).length === 1 && at( - 20, 0, POOL ).length === 0, 'the land lantern: a halo, no pool' );
	ok( at( 5, 5, HALO ).length === 1, 'a halo on the boat nav light' );
	ok( g.filter( ( i ) => near( i.p[ 0 ], 5 ) && near( i.p[ 1 ], 2 ) ).length === 0, 'no halo on the cabin dome' );
	ok( at( - 400, 0, HALO ).length >= 1, 'the lighthouse lamp glows' );
	const streaks = g.filter( ( i ) => i.c[ 3 ] === STREAK );
	ok( streaks.length > 4 && streaks.every( ( i ) => Math.abs( i.p[ 1 ] ) <= Math.PI + 1e-6 ), `the beams lay streaks on the water (${ streaks.length }, angles in -PI..PI)` );
	ok( at( 8, - 6, FLOAT ).length === 1, 'the bobber carries a lantern glint' );
	ok( g.filter( ( i ) => i.c[ 3 ] === SPRITE ).length > 0, 'fireflies over the shrubs by the path' );
	ok( n.swarms.length > 0 && n.swarms.length <= 80, `firefly swarms built from the vegetation (${ n.swarms.length })` );

	// the lighthouse flash: a beam pointing straight at the camera
	const before = at( - 400, 0, HALO ).length;
	app.ports.gull.beams.rotation.y = 0; // +X from the lighthouse at x -400 points at the camera at x 0
	run( ctx, 0.05 );
	const flash = instances( n.glow ).filter( ( i ) => near( i.p[ 0 ], - 400 ) && i.c[ 3 ] === HALO );
	ok( flash.length === 2 && Math.max( ...flash.map( ( i ) => i.p[ 3 ] ) ) > 10, 'the flash: a big halo when a beam sweeps over you' );
	app.ports.gull.beams.rotation.y = Math.PI / 2;
	run( ctx, 0.05 );
	ok( instances( n.glow ).filter( ( i ) => near( i.p[ 0 ], - 400 ) && i.c[ 3 ] === HALO ).length === 1 && before >= 1, '... and only the steady lamp otherwise' );

	// local lights: the bobber's lantern
	ok( n.lights[ 0 ].enabled && near( n.lights[ 0 ].position.x, 8 ) && near( n.lights[ 0 ].position.z, - 6 ), 'the bobber lantern light is on at the bobber' );
	app.game.rod.state = 'idle';
	run( ctx, 0.05 );
	ok( ! n.lights[ 0 ].enabled && instances( n.glow ).filter( ( i ) => near( i.p[ 0 ], 8 ) && i.c[ 3 ] === FLOAT ).length === 0, 'no lantern once the line is in' );

	// rain keeps the fireflies down
	ctx.features.get( 'weather' ).rainIntensity = 1;
	run( ctx, 0.05 );
	ok( instances( n.glow ).filter( ( i ) => i.c[ 3 ] === SPRITE ).length === 0, 'no fireflies in the rain' );

	// back to day: hidden, lights off
	app.settings.timeOfDay = 10;
	setNight( 0 );
	run( ctx, 4 );
	ok( n.nightFactor < 0.01 && ! n.active && ! n.glow.mesh.visible && ! n.plankton.mesh.visible && n.lights.every( ( l ) => ! l.enabled ), 'morning: fades out, hidden, lights off' );
	ok( phases[ phases.length - 1 ] === 'day', 'the phase event reports day' );
	ctx.features.dispose();
	ok( app.scene.children.length === 0, 'dispose takes the meshes out of the scene' );

}

// ---------------------------------------------------------------------------------------------- ships, low preset, off
{

	setNight( 1 );
	const ship = { x: 30, z: 30, yaw: 0, speed: 4, state: 'sail', alive: true, cls: { length: 16, beam: 6, sheer: 3.4, mast: 11 }, pose: { y: 0 } };
	const ctx = make( {}, [ ship ] );
	run( ctx, 0.5 );
	const n = ctx.n;
	const g = instances( n.glow );
	ok( g.filter( ( i ) => i.p[ 1 ] > 10 && near( i.p[ 0 ], 30 ) ).length === 1, 'a ship carries a masthead light halo' );
	ok( g.some( ( i ) => i.c[ 0 ] > i.c[ 1 ] * 5 && i.p[ 0 ] < 30 ) && g.some( ( i ) => i.c[ 1 ] > i.c[ 0 ] * 5 && i.p[ 0 ] > 30 ), 'red to port, green to starboard (heading +Z)' );
	ok( n.lights.slice( 1 ).some( ( l ) => l.enabled && near( l.position.x, 30 ) ), 'a pooled masthead local light follows the nearest ship' );
	const st = n.plankton.stir;
	ok( Array.from( { length: MAX_STIR }, ( _, i ) => i ).some( ( i ) => st[ i * 4 ] === 30 && st[ i * 4 + 2 ] > 5 ), 'a sailing ship stirs the plankton along her hull' );
	ctx.n.stir( - 5, 5, 2, 1, 1 );
	run( ctx, 0.05 );
	ok( Array.from( { length: MAX_STIR }, ( _, i ) => i ).some( ( i ) => st[ i * 4 ] === - 5 ), 'n.stir() lights the water for other features' );
	ctx.features.dispose();

	const low = make( { settings: { timeOfDay: 23, quality: 'low' } } );
	run( low, 0.3 );
	ok( low.n.low && low.n.plankton.geometry.instanceCount === C.BUDGET.low.plankton && low.n.lights.length === C.BUDGET.low.lights, 'low preset: the low budget' );
	low.features.dispose();

	const off = make( { qs: new URLSearchParams( 'noNight' ) } );
	run( off, 0.3 );
	ok( ! off.n.glow && ! off.n.plankton && off.n.nightFactor > 0.9, '?noNight: no meshes, the factor still runs' );
	off.features.dispose();

	const bare = new Features( { settings: { timeOfDay: 0 } } );
	const b = bare.add( 'night', nightMod );
	setNight( NaN );
	bare.update( 0.1 );
	ok( b && near( b.nightFactor, 1, 1e-3 ) && ! b.glow, 'no sky, no scene: the factor comes from the clock' );
	bare.dispose();
	setNight( 0 );

}

console.log( fails ? `\n${ fails } FAILED` : '\nall night checks passed' );
process.exit( fails ? 1 : 0 );

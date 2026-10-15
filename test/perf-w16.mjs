// Plain-node test of the wave 16C performance pass (docs/PERF.md "Wave 16C"): the "wave 15 world" CPU scenario is
// deterministic, naval's awake-ship cap holds (and changes nothing without one), the quality tiers and the phone profile
// hand out their budgets (ships, vegetation reach, the phone's vegetation memory), the vegetation's distance bands
// (VegType.setReach: the far cut and windows; 1 = as built), the phones' half of the tiles' plants and coarser grass
// masks, the trade window writes the DOM only on a change, and the cockpit skips a redraw that would draw the same face.
// No GPU (a stub device for the textures the scatter reads), no DOM (tools/perf/fake-dom.mjs).
//   node test/perf-w16.mjs
import { spawnSync } from 'node:child_process';

globalThis.GPUShaderStage ??= { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
globalThis.GPUTextureUsage ??= { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 };
globalThis.GPUBufferUsage ??= { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512 };
globalThis.GPUMapMode ??= { READ: 1, WRITE: 2 };
const { GPU, DEFAULT_LIMITS } = await import( '../src/engine/gpu/GPU.js' );
{

	// a stub device (as test/water-domain.mjs): anything not listed answers with a callable stand-in
	const any = () => new Proxy( function () {}, { get: ( t, k ) => ( k === 'then' ? undefined : k === Symbol.toPrimitive ? () => 0 : any() ), apply: () => any() } );
	const base = {
		limits: DEFAULT_LIMITS, features: new Set(),
		createShaderModule: ( d ) => ( { ...d, getCompilationInfo: async () => ( { messages: [] } ) } ),
		createTexture: ( d ) => ( { ...d, destroy() {}, createView: () => ( {} ) } ),
		createBuffer: ( d ) => ( { ...d, destroy() {}, getMappedRange: () => new ArrayBuffer( d.size ), unmap() {} } ),
		lost: new Promise( () => {} ), addEventListener() {},
		queue: { writeBuffer() {}, writeTexture() {}, submit() {}, onSubmittedWorkDone: async () => {} },
	};
	GPU.device = new Proxy( base, { get: ( t, k ) => ( k in t ? t[ k ] : any() ) } );
	GPU.limits = DEFAULT_LIMITS;
	GPU.queue = base.queue;
	GPU.samplers = new Proxy( {}, { get: () => ( {} ) } );

}

const E = await import( '../src/engine/index.js' );
const { Features } = await import( '../src/features/Features.js' );
const { Naval } = await import( '../src/features/naval/Naval.js' );
const { PATROLS } = await import( '../src/features/naval/Routes.js' );
const { TerrainData } = await import( '../src/world/TerrainData.js' );
const { Quality, TIERS, MOBILE, PHONE_BUDGET, mobileTier } = await import( '../src/core/Quality.js' );
const { VegType } = await import( '../src/world/vegetation/InstanceLOD.js' );
const { VegSite, scatterVegetation, buildGrassMask } = await import( '../src/world/vegetation/Scatter.js' );
const { SCENARIOS, VIEW_SET } = await import( '../tools/perf/scenarios.js' );
const { WORLD } = await import( '../src/world/WorldLayout.js' );
const tradeModule = await import( '../src/features/trade/index.js' );
const { GOOD_IDS } = await import( '../src/features/trade/goods.js' );
const { GameState } = await import( '../src/game/GameState.js' );
const { makeDoc } = await import( '../tools/perf/fake-dom.mjs' );
const { Flight } = await import( '../src/features/seaplane/Flight.js' );
const { Pilot } = await import( '../src/features/seaplane/Pilot.js' );
const { Systems } = await import( '../src/features/seaplane/Systems.js' );
const { spec } = await import( '../src/features/seaplane/Airframes.js' );
const { Cockpit, panelSnapshot, faceKey } = await import( '../src/features/seaplane/Cockpit.js' );

let fails = 0, passes = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else { passes ++; console.log( 'ok  ', msg ); }

};
const section = ( s ) => console.log( '\n== ' + s );
const store = () => {

	const m = new Map();
	return { getItem: ( k ) => m.has( k ) ? m.get( k ) : null, setItem: ( k, v ) => m.set( k, v ), removeItem: ( k ) => m.delete( k ) };

};
const terrain = new TerrainData();

// ================================================================================================ 1. the scenarios
section( '1. the wave 15 world CPU scenario and the three views' );
{

	const run = ( extra = [] ) => spawnSync( process.execPath, [ 'tools/perf/cpu-scenarios.mjs', '--frames=600', '--repeat=1', '--no-alloc', '--scenario=wave15', ...extra ], { encoding: 'utf8', timeout: 240000 } );
	const fp = ( r ) => ( /"fingerprint":"([-\d.]+)"/.exec( r.stdout || '' ) || [] )[ 1 ];
	const a = run(), b = run();
	const stats = JSON.parse( ( /wave15: \d+ frames, [\d.]+ s wall, (\{.*\}), heap/.exec( a.stdout || '' ) || [ 0, '{}' ] )[ 1 ] );
	ok( a.status === 0 && fp( a ) && fp( a ) === fp( b ), `wave15 runs and is deterministic (${ fp( a ) }, ${ fp( b ) })` );
	ok( stats.ships >= 12 && stats.residents > 40 && stats.rivals > 0 && /waiting|inbound|alongside|ride|tow/.test( stats.rescue ), `the world: ${ stats.ships } ships, ${ stats.residents } residents, rivals sailing, a rescue ${ stats.rescue }` );
	const rows = ( r ) => new Set( ( r.stdout || '' ).split( '\n' ).map( ( l ) => l.split( /\s+/ )[ 0 ] ) );
	ok( [ 'naval', 'trade', 'hijack', 'rescue', 'agents', 'pirates', 'crew', 'residents' ].every( ( m ) => rows( a ).has( m ) ), 'ms per module: naval, trade, hijack, rescue, agents, pirates, crew, residents' );
	const c = run( [ '--cap=6' ] );
	const cs = JSON.parse( ( /wave15: \d+ frames, [\d.]+ s wall, (\{.*\}), heap/.exec( c.stdout || '' ) || [ 0, '{}' ] )[ 1 ] );
	ok( c.status === 0 && cs.asleep > 0 && cs.ships - cs.asleep <= 6 + 2, `--cap=6: ${ cs.asleep } of ${ cs.ships } ships asleep at most` );
	// (wave 19A added Tidemark's square between the quay and the cove)
	ok( [ 'homeBay', 'tidemarkQuay', 'blackwaterCove' ].every( ( id ) => VIEW_SET.includes( id ) ) && VIEW_SET.every( ( id ) => SCENARIOS[ id ] && SCENARIOS[ id ].place.kind === 'walk' ), 'the views: the home bay, Tidemark\'s quay, Blackwater\'s cove, on foot' );
	const bw = WORLD.blackwater && WORLD.blackwater.dock.position, sc = SCENARIOS.blackwaterCove.place;
	ok( bw && Math.hypot( bw.x - sc.x, bw.z - sc.z ) < 1 && sc.at === 'blackwater', 'Blackwater\'s view stands on its dock (WORLD.blackwater, re-read by the runner)' );

}

// ================================================================================================ 2. naval's awake cap
section( '2. naval: the awake-ship cap' );
function navalWorld( cap, { bountyFar = true, frames = 900 } = {} ) {

	const state = new GameState( store() );
	state.boat = 'lobster';
	const app = {
		mode: 'campaign', settings: { timeOfDay: 12 }, terrainData: terrain, query: null, spray: null, scene: null, audio: null,
		boatCtl: { position: new E.Vector3( 40, 0, 520 ), quaternion: new E.Quaternion(), velocity: new E.Vector3(), driven: true, moored: false },
		boat: { dimensions: { length: 8.2, beam: 2.9, draft: 0.85, freeboard: 0.9 } },
		camera: { position: new E.Vector3( 40, 4, 510 ), quaternion: new E.Quaternion(), fov: 60, aspect: 16 / 9 },
		player: { mode: 'boat', position: new E.Vector3( 40, 1, 520 ) },
		input: { hit: () => false, keys: new Set() }, game: { state, toast() {} }, cameraFeel: { kick() {} },
	};
	const features = new Features( app );
	const naval = features.add( 'naval', { install: ( a, f ) => new Naval( a, f, { seed: 7, hud: false, models: false, settings: { autoSpawn: false } } ) } );
	// 16 ships on the four patrol loops, four to a loop, spread round it
	for ( let i = 0; i < 16; i ++ ) {

		const pts = PATROLS[ i % 4 ], k = Math.floor( i / 4 ) * Math.max( 1, Math.floor( pts.length / 4 ) ) % pts.length, n = ( k + 1 ) % pts.length;
		const s = naval.spawn( i % 3 ? 'sloop' : 'trawler', { x: pts[ k ][ 0 ], z: pts[ k ][ 1 ], yaw: Math.atan2( pts[ n ][ 0 ] - pts[ k ][ 0 ], pts[ n ][ 1 ] - pts[ k ][ 1 ] ), route: pts, loop: true, index: n, speed: 3, state: 'patrol' } );
		if ( bountyFar && i === 15 ) s.bounty = { id: 'perf-bounty' };

	}

	if ( cap !== null ) naval.setShipCap( cap );
	const seen = { maxAsleep: 0, badSleeper: 0, awakeOver: 0, bountySlept: 0 };
	const start = new Map( naval.ships.map( ( s ) => [ s, [ s.x, s.z ] ] ) );
	for ( let f = 0; f < frames; f ++ ) {

		features.update( 1 / 60 );
		let asleep = 0, awakeEligible = 0;
		for ( const s of naval.ships ) {

			if ( s._sleep ) {

				asleep ++;
				if ( ! ( s.dist > naval.settings.drawRange ) || ! [ 'patrol', 'sail', 'moored' ].includes( s.state ) ) seen.badSleeper ++;
				if ( s.bounty ) seen.bountySlept ++;

			} else if ( s.dist > naval.settings.drawRange && ! s.bounty ) awakeEligible ++;

		}

		seen.maxAsleep = Math.max( seen.maxAsleep, asleep );
		// past the start-up: more awake than the cap only while nothing else may sleep
		if ( f > 30 && cap !== null && naval.ships.length - asleep > cap && awakeEligible > 0 ) seen.awakeOver ++;

	}

	let fp = 0, moved = 0;
	for ( const s of naval.ships ) {

		fp += s.x * 1.3 + s.z * 1.7 + s.yaw;
		const p = start.get( s );
		if ( p && Math.hypot( s.x - p[ 0 ], s.z - p[ 1 ] ) > 20 ) moved ++;

	}

	return { naval, seen, fp: fp.toFixed( 6 ), moved, n: naval.ships.length };

}
{

	const none = navalWorld( null ), inf = navalWorld( Infinity );
	ok( none.fp === inf.fp && none.seen.maxAsleep === 0 && inf.seen.maxAsleep === 0, `no cap (Infinity, the default): every ship every frame, the same sea (${ none.fp })` );
	const six = navalWorld( 6 );
	ok( six.seen.maxAsleep > 0 && six.seen.awakeOver === 0, `cap 6: up to ${ six.seen.maxAsleep } of ${ six.n } ships asleep; never more awake than 6 while one could sleep` );
	ok( six.seen.badSleeper === 0, 'sleepers are past the draw range, patrolling / sailing / moored' );
	ok( six.seen.bountySlept === 0, 'a bounty (mission) ship never sleeps' );
	ok( six.moved >= none.moved - 1 && six.naval.ships.every( ( s ) => Number.isFinite( s.x ) && Number.isFinite( s.z ) ), `sleepers still sail (4 Hz steps): ${ six.moved } of ${ six.n } moved over 15 s (${ none.moved } without the cap)` );
	six.naval.setShipCap( Infinity );
	for ( let f = 0; f < 30; f ++ ) six.naval.update( 1 / 60 );
	ok( six.naval.ships.every( ( s ) => ! s._sleep ), 'the cap lifted: everyone wakes' );

}

// ================================================================================================ 3. budgets per profile
section( '3. Quality: the budgets per tier and on a phone' );
{

	const mk = () => {

		const naval = { cap: null, setShipCap( n ) { this.cap = n; } };
		const types = [ { k: null, setReach( k ) { this.k = k; } }, { k: null, setReach( k ) { this.k = k; } } ];
		return { settings: { renderScale: 1 }, vegetation: { types }, features: { get: ( n ) => ( n === 'naval' ? naval : null ) }, naval, types };

	};
	const want = { low: [ 8, 0.55 ], medium: [ 12, 0.75 ], high: [ Infinity, 1 ], ultra: [ Infinity, 1 ] };
	for ( const tier of Object.keys( want ) ) {

		const app = mk();
		new Quality( app, { storage: store(), query: new URLSearchParams( '?quality=' + tier ), device: {}, mobile: null } );
		ok( app.naval.cap === want[ tier ][ 0 ] && app.types.every( ( t ) => Math.abs( t.k - want[ tier ][ 1 ] ) < 1e-9 ), `${ tier }: ${ want[ tier ][ 0 ] } ships awake, vegetation reach ${ want[ tier ][ 1 ] }` );

	}

	const phone = mk();
	new Quality( phone, { storage: store(), query: new URLSearchParams( '?quality=low' ), device: { mobile: true, phone: true }, mobile: MOBILE.phone } );
	ok( phone.naval.cap === 6 && Math.abs( phone.types[ 0 ].k - 0.55 * 0.8 ) < 1e-9, `a phone at Low: 6 ships, reach ${ ( 0.55 * 0.8 ).toFixed( 2 ) }` );
	ok( mobileTier( TIERS.medium, MOBILE.phone ).ships === 6 && mobileTier( TIERS.high, MOBILE.tablet ).ships === Infinity, 'mobileTier: phones cap at 6 whatever the tier; tablets keep the tier\'s' );
	ok( PHONE_BUDGET.vegTiles === 0.5 && PHONE_BUDGET.leafAtlas === 512 && PHONE_BUDGET.grassMaskTexel === 4, 'the phone budget: half the tiles\' plants, a 512 px leaf atlas, 4 m grass masks' );

}

// ================================================================================================ 4. the vegetation's bands
section( '4. vegetation: distance bands (VegType.setReach)' );
{

	const geo = () => {

		const g = new E.BufferGeometry();
		g.setAttribute( 'position', new E.BufferAttribute( new Float32Array( 9 ), 3 ) );
		return g;

	};
	const mat = { name: 'stub' };
	// 3000 trees in a line out to 3 km, like the far crowns; the camera at the start
	const recs = [];
	for ( let i = 0; i < 3000; i ++ ) recs.push( { x: i, y: 0, z: 0, s: 1, yaw: 0, la: 0, l: 1, H: 10, seed: ( i * 0.618 ) % 1 } );
	const canopy = new VegType( 'canopy', recs, {
		nearRange: 65, margin: 10, sortNear: true, sortFar: true, farRefresh: 16,
		near: [ { geometry: geo(), material: mat, name: 'near' } ], far: { parts: [ { geometry: geo(), material: mat, name: 'far' } ], fade: [ 2600, 2800 ] },
	} );
	const cam = new E.Vector3( 0, 2, 0 );
	canopy.update( cam, true );
	const all = canopy.far.count;
	ok( all === 3000 && canopy.setReach( 1 ) === false && canopy.far.meshes[ 0 ].drawParams[ 2 ] === 2800, 'as built (reach 1): every crown in the far buffer, the 2600 - 2800 m window' );
	canopy.setReach( 0.5 );
	canopy.update( cam, true );
	const p = canopy.far.meshes[ 0 ].drawParams;
	ok( p[ 1 ] === 1300 && p[ 2 ] === 1400 && p[ 0 ] === 65 && canopy.far.count >= 1400 && canopy.far.count <= 1420, `reach 0.5: the window 1300 - 1400 m, ${ canopy.far.count } crowns drawn (none past the cut), the near switch kept` );
	canopy.setReach( 1 );
	canopy.update( cam, true );
	ok( canopy.far.count === 3000 && canopy.far.meshes[ 0 ].drawParams[ 2 ] === 2800, 'back to 1: all of them again' );
	// a palm-like type (near + far that leaves the near ones out) and a fading understory
	const palms = new VegType( 'palms', recs, {
		nearRange: 120, margin: 10, refreshDistance: 6, farExcludeNear: true, sortNear: true,
		near: [ { geometry: geo(), material: mat, name: 'palm' } ], far: { parts: [ { geometry: geo(), material: mat, name: 'palm-far' } ], fade: [ 2600, 2800 ] },
	} );
	palms.update( cam, true );
	const n0 = palms.near.count, f0 = palms.far.count;
	palms.setReach( 0.5 );
	palms.update( cam, true );
	ok( palms.nearRange === 84 && palms.near.count < n0 && palms.far.count < f0 && palms.far.count > 1200, `palms at 0.5: near range 84 m (max 0.7 of it), ${ palms.near.count } near, ${ palms.far.count } far (was ${ n0 } / ${ f0 })` );
	const under = new VegType( 'understory', recs.map( ( r ) => ( { ...r, qr: 150 } ) ), { fade: [ 120, 140 ], margin: 10, sortNear: true, near: [ { geometry: geo(), material: mat, name: 'under' } ] } );
	under.update( cam, true );
	const u0 = under.near.count;
	under.setReach( 0.4 );
	under.update( cam, true );
	ok( u0 === 150 && under.near.count === 105 && under.near.meshes[ 0 ].drawParams[ 2 ] === 98, `the fading understory at 0.4: the window x0.7 (84 - 98 m), ${ under.near.count } filled (was ${ u0 })` );

}

// ================================================================================================ 5. phones: the tiles' plants and the masks
section( '5. phones: half the tiles\' plants, 4 m grass masks' );
{

	const full = scatterVegetation( new VegSite( terrain, {} ) );
	const maskFull = buildGrassMask( new VegSite( terrain, {} ) );
	globalThis.__phoneBudget = { ...PHONE_BUDGET };
	const half = scatterVegetation( new VegSite( terrain, {} ) );
	const maskHalf = buildGrassMask( new VegSite( terrain, {} ) );
	delete globalThis.__phoneBudget;
	const home = scatterVegetation( new VegSite( terrain, {} ), 99, { tiles: false } );
	const KINDS = Object.keys( home ).filter( ( k ) => Array.isArray( home[ k ] ) );
	const sum = ( r, a ) => KINDS.reduce( ( s, k ) => s + r[ k ].length - ( a ? home[ k ].length : 0 ), 0 );
	ok( KINDS.every( ( k ) => JSON.stringify( half[ k ].slice( 0, home[ k ].length ) ) === JSON.stringify( home[ k ] ) ), 'the home island\'s plants are untouched on a phone' );
	const tf = sum( full, true ), th = sum( half, true );
	ok( th > tf * 0.4 && th < tf * 0.6, `the tiles keep about half: ${ th } of ${ tf } plants` );
	const key = ( r ) => r.x + ',' + r.z;
	const fullSet = new Set( KINDS.flatMap( ( k ) => full[ k ].map( key ) ) );
	ok( KINDS.every( ( k ) => half[ k ].every( ( r ) => fullSet.has( key( r ) ) ) ), 'and only plants the desktop has (the same places, a fixed half)' );
	ok( maskHalf.res === maskFull.res / 2 && maskHalf.tiles.width * 2 === maskFull.tiles.width && maskHalf.tiles.tiles.every( ( t ) => Math.abs( t.texel - 4 ) < 0.05 ), `grass masks at 4 m: ${ maskHalf.res }^2 + ${ maskHalf.tiles.width } x ${ maskHalf.tiles.height } (desktop ${ maskFull.res }^2 + ${ maskFull.tiles.width } x ${ maskFull.tiles.height })` );
	const mb = ( m ) => ( m.res * m.res * 4 + m.tiles.width * m.tiles.height * 4 ) / 1048576;
	ok( mb( maskHalf ) < mb( maskFull ) / 3.5, `grass mask memory ${ mb( maskFull ).toFixed( 1 ) } -> ${ mb( maskHalf ).toFixed( 1 ) } MB` );

}

// ================================================================================================ 6. the trade window
section( '6. the trade window writes only on a change' );
{

	const state = new GameState( store() );
	state.money = 5000;
	state.boat = 'cutter';
	const app = { settings: { timeOfDay: 9.5 }, game: { state }, player: { mode: 'walk', position: { x: 0, y: 2, z: 0 } } };
	const features = new Features( app );
	const trade = tradeModule.install( app, features, { noise: 0, events: false, seed: 3, toasts: false } );
	const dom = makeDoc(), d = dom.doc;
	const P = trade.panel;
	// the window's fields as build() / buildMarket() would find them (the fake DOM does not parse HTML)
	const el = ( tag = 'div' ) => d.createElement( tag );
	P.el = el();
	P.isOpen = true;
	P.port = 'home';
	P.kind = 'market';
	P.tab = 'market';
	P._f = {};
	for ( const n of [ 'title', 'sub', 'body', 'capbar', 'cap', 'kg', 'proj', 'warn', 'msg', 'tick', 'board', 'filter', 'cmp', 'othername' ] ) P._f[ n ] = el();
	P._f.capbar.firstElementChild = el( 'span' );
	P._rows = {};
	for ( const g of GOOD_IDS ) {

		const f = { el: el() };
		for ( const n of [ 'meta', 'why', 'trend', 'buy', 'tag', 'sell', 'cond', 'otherbox', 'other', 'note', 'age', 'held', 'heldv', 'line', 'dot', 'eq' ] ) f[ n ] = el();
		f.buttons = [ 'buy', 'buy', 'buy', 'sell', 'sell', 'sell' ].map( ( act ) => { const b = el( 'button' ); b.dataset.act = act; return b; } );
		P._rows[ g ] = f;

	}

	P._cmpKey = P._boardKey = P._filterKey = '';
	const writes = () => { const c = dom.counts; return c.text + c.html + c.style + c.cls + c.attr + c.prop; };
	dom.reset();
	P.refresh();
	const first = writes();
	dom.reset();
	P.refresh();
	const second = writes();
	ok( first > GOOD_IDS.length * 15 && second === 0, `a refresh writes ${ first } values; the next one, nothing changed, writes ${ second } (it rewrote all ${ first } before)` );
	const r0 = P._rows[ GOOD_IDS[ 0 ] ];
	ok( r0.buy.textContent.startsWith( '$' ) && r0.line.getAttribute( 'points' ).split( ' ' ).length > 1 && P._f.cap.textContent.endsWith( 'crates' ), 'the fields carry the values (price, sparkline, hold)' );
	trade.buy( 'home', GOOD_IDS.find( ( g ) => trade.view( 'home' ).rows.find( ( r ) => r.id === g && r.can.buy ) ), 1 );
	dom.reset();
	P.refresh();
	const third = writes();
	ok( third > 0 && third < first / 3, `after a purchase only what moved is written (${ third })` );
	trade.dispose && trade.dispose();

}

// ================================================================================================ 7. the cockpit
section( '7. the cockpit: no redraw of the same face' );
{

	const calls = { n: 0 };
	const ctx = new Proxy( {}, { get: ( o, k ) => ( k in o ? o[ k ] : () => { calls.n ++; return k === 'getImageData' ? { data: new Uint8ClampedArray( 4 ) } : undefined; } ), set: ( o, k, v ) => { o[ k ] = v; return true; } } );
	const canvas = { width: 1, height: 1, getContext: () => ctx };
	const f = new Flight( spec( 'jade' ) );
	f.place( 0, 0, 0 );
	const pilot = new Pilot();
	const sp = { af: 'jade', flight: f, pilot, systems: new Systems( f, pilot ), hp: 100, piloted: true, app: {}, visual: null };
	const cp = new Cockpit( sp, { canvas } );
	sp.app = cp.app = { player: { view: 'first' }, input: { locked: true, mouseDown: false } };
	cp.update( 0.1 );
	const r0 = cp.redraws;
	for ( let i = 0; i < 20; i ++ ) cp.update( 0.1 );
	ok( r0 === 1 && cp.redraws === 1 && cp.skipped >= 15, `moored, engine off: ${ cp.skipped } timed redraws skipped, the face drawn once` );
	const a = panelSnapshot( sp, null );
	ok( faceKey( a ) === faceKey( { ...a } ) && faceKey( a ) !== faceKey( { ...a, airspeed: a.airspeed + 0.5 } ) && faceKey( a ) === faceKey( { ...a, airspeed: a.airspeed + 0.001 } ), 'faceKey: equal faces equal; a needle\'s move is a new face, float noise is not' );
	f.velocity.set( 0, 0, 20 );
	cp.update( 0.1 );
	ok( cp.redraws === 2, 'the speed changes: drawn again' );

}

console.log( `\n${ passes } passed, ${ fails } failed` );
process.exit( fails ? 1 : 0 );

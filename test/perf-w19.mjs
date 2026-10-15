// Plain-node test of the wave 19A pass (docs/PERF.md "Wave 19A"): the budgets per tier (the townsfolk drawn as full avatars,
// the phone budget's terrain / character / impostor numbers, Quality handing the body cap to townlife), the phones' half-float
// terrain textures (the height atlas and the shore field: format, bytes, accuracy), the "wave 18 town" CPU scenario
// (deterministic, the townsfolk and the drawn cutlass in it), Tidemark's square view, the wet sand (the terrain shader's band
// composes; the tile meshes bake it: darker and glossier near the waterline, dry above ~1.5 m), and the phone memory of the
// last headless run when there is one (tools/perf/out/perf-phone-w19.json: every view <= 387 MB).
// No GPU (a stub device for the textures), no DOM.
//   node test/perf-w19.mjs
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

globalThis.GPUShaderStage ??= { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
globalThis.GPUTextureUsage ??= { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 };
globalThis.GPUBufferUsage ??= { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512 };
globalThis.GPUMapMode ??= { READ: 1, WRITE: 2 };
const { GPU, DEFAULT_LIMITS } = await import( '../src/engine/gpu/GPU.js' );
const written = [];
{

	// a stub device (as test/perf-w16.mjs): textures are records, writes are counted
	const any = () => new Proxy( function () {}, { get: ( t, k ) => ( k === 'then' ? undefined : k === Symbol.toPrimitive ? () => 0 : any() ), apply: () => any() } );
	const base = {
		limits: DEFAULT_LIMITS, features: new Set(),
		createShaderModule: ( d ) => ( { ...d, getCompilationInfo: async () => ( { messages: [] } ) } ),
		createTexture: ( d ) => ( { ...d, destroy() {}, createView: () => ( {} ) } ),
		createBuffer: ( d ) => ( { ...d, destroy() {}, getMappedRange: () => new ArrayBuffer( d.size ), unmap() {} } ),
		lost: new Promise( () => {} ), addEventListener() {},
		queue: { writeBuffer() {}, writeTexture( dst, data ) { written.push( data ); }, submit() {}, onSubmittedWorkDone: async () => {} },
	};
	GPU.device = new Proxy( base, { get: ( t, k ) => ( k in t ? t[ k ] : any() ) } );
	GPU.limits = DEFAULT_LIMITS;
	GPU.queue = base.queue;
	GPU.samplers = new Proxy( {}, { get: () => ( {} ) } );

}

const { TIERS, MOBILE, PHONE_BUDGET, mobileTier, Quality } = await import( '../src/core/Quality.js' );
const { sharedHeightTexture, toHalfArray, TerrainGPU } = await import( '../src/world/TerrainGPU.js' );
const { fromHalfFloat } = await import( '../src/engine/math/DataUtils.js' );
const { TERRAIN_WGSL } = await import( '../src/world/Terrain.js' );
const { terrainGeometry, WET_REACH, ROUGH_DRY } = await import( '../src/world/islands/town/TerrainMesh.js' );
const { blackwaterLandGeometry } = await import( '../src/world/islands/BlackwaterMesh.js' );
const { TerrainData } = await import( '../src/world/TerrainData.js' );
const { ensureTidemark } = await import( '../src/world/islands/town/TidemarkTerrain.js' );
const { ensureBlackwater } = await import( '../src/world/islands/BlackwaterTerrain.js' );
const { SCENARIOS, VIEW_SET, parsePerfQuery, validateScenario, isNested } = await import( '../tools/perf/scenarios.js' );
const { at: tidemarkAt, SQUARE } = await import( '../src/world/islands/town/Layout.js' );

let fails = 0, passes = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else { passes ++; console.log( 'ok  ', msg ); }

};
const section = ( s ) => console.log( '\n== ' + s );

// ================================================================================================ 1. budgets per tier
section( '1. the budgets per tier' );
{

	const bodies = Object.fromEntries( Object.entries( TIERS ).map( ( [ k, t ] ) => [ k, t.townBodies ] ) );
	ok( bodies.low === 12 && bodies.medium === 16 && bodies.high === 24 && bodies.ultra === 24, `townsfolk drawn as avatars per tier: ${ JSON.stringify( bodies ) } (High / Ultra as wave 18 left them)` );
	const phone = mobileTier( TIERS.low, MOBILE.phone ), phoneMed = mobileTier( TIERS.medium, MOBILE.phone ), tablet = mobileTier( TIERS.high, MOBILE.tablet );
	ok( phone.townBodies === 8 && phoneMed.townBodies === 8 && tablet.townBodies === 24, `phones 8 at Low and Medium (${ phone.townBodies }, ${ phoneMed.townBodies }), tablets keep the tier's (${ tablet.townBodies })` );
	ok( phone.ships === 6 && phone.shadowSize === 512 && phone.draw < TIERS.low.draw, 'the phone keeps wave 16C\'s trims (6 ships awake, 512 px cascades, shorter draw distance)' );
	ok( PHONE_BUDGET.halfTerrain === true && PHONE_BUDGET.sunShadow === 256, 'phone budget: half-float terrain textures, a 256-cell heightfield sun shadow' );
	ok( PHONE_BUDGET.charTexture === 192 && PHONE_BUDGET.impostorFrame === 40 && PHONE_BUDGET.textureMax === 512 && PHONE_BUDGET.propTexture === 256, `phone budget: character maps ${ PHONE_BUDGET.charTexture } px, impostor frames ${ PHONE_BUDGET.impostorFrame } px, props as before` );
	// Quality hands the cap to townlife (and leaves a feature without one alone)
	const town = { bodyCap: 24 };
	const feats = new Map( [ [ 'townlife', town ] ] );
	const app = { settings: {}, features: { get: ( n ) => feats.get( n ) } };
	const q = new Quality( app, { storage: null, query: new URLSearchParams( '?quality=medium' ), mobile: null } );
	ok( town.bodyCap === 16, `Medium: townlife.bodyCap ${ town.bodyCap }` );
	q.setTier( 'high', { save: false } );
	ok( town.bodyCap === 24, `High: townlife.bodyCap ${ town.bodyCap } (unchanged from wave 18)` );
	const qp = new Quality( app, { storage: null, query: new URLSearchParams( '' ), mobile: MOBILE.phone } );
	ok( qp.tier === 'low' && town.bodyCap === 8, `a phone: ${ qp.tier }, townlife.bodyCap ${ town.bodyCap }` );
	feats.delete( 'townlife' );
	let threw = false;
	try { q.apply(); } catch ( e ) { threw = true; }
	ok( ! threw, 'no townlife: apply() is fine' );

}

// ================================================================================================ 2. half-float terrain
section( '2. the phones\' half-float terrain textures' );
{

	const vals = new Float32Array( [ 0, 0.37, - 0.05, 1.5, 12.34, 63.9, 120.5, 305.77, - 90, 1e4, 1e-6, - 2.25 ] );
	const h = toHalfArray( vals );
	const back = Array.from( h, fromHalfFloat );
	const err = ( i ) => Math.abs( back[ i ] - vals[ i ] );
	const bound = ( v ) => { const a = Math.abs( v ); if ( a < 6.1e-5 ) return 3e-8; return Math.pow( 2, Math.floor( Math.log2( a ) ) - 10 ) / 2 + 1e-9; }; // half an ulp: rounded to nearest
	ok( Array.from( vals ).every( ( v, i ) => err( i ) <= bound( v ) ), `rounded to nearest: ${ Array.from( vals ).map( ( v, i ) => `${ v } -> ${ +back[ i ].toFixed( 4 ) }` ).join( ', ' ) }` );
	ok( err( 1 ) < 0.0002 && err( 3 ) < 0.0005 && err( 5 ) <= 0.016 && err( 7 ) <= 0.125 && back[ 9 ] === 1e4, 'the shore (< 0.5 mm), the towns and meadows (<= 1.6 cm below 64 m), the 300 m peak (<= 12.5 cm), the 1e4 "no shore" value exact' );
	// the textures: r32float off phones, r16float with the phone budget (half the bytes)
	const res = 64;
	const a = sharedHeightTexture( new Float32Array( res * res ).fill( 1.25 ), res );
	globalThis.__phoneBudget = { ...PHONE_BUDGET };
	written.length = 0;
	const b = sharedHeightTexture( new Float32Array( res * res ).fill( 1.25 ), res );
	ok( a.format === 'r32float' && b.format === 'r16float', `terrainHeights: ${ a.format } on a desktop, ${ b.format } on a phone` );
	const up = written.find( ( d ) => d && d.byteLength !== undefined );
	ok( up && up.byteLength === res * res * 2 && new Uint16Array( up.buffer || up, up.byteOffset || 0, res * res )[ 7 ] === 0x3d00, `the phone upload: ${ up && up.byteLength } bytes of half floats (1.25 = 0x3d00)` );
	// the shore field (setShoreField without the tiles: the domain's field)
	const fake = { tiles: { shore: [] }, shoreTexture: { width: 1, height: 1, format: 'rgba32float', destroy() { this.destroyed = true; } }, uniforms: { fields: { shoreRes: { value: 1 } } } };
	const f = { res: 8, data: new Float32Array( 8 * 8 * 4 ).fill( 0.5 ) };
	TerrainGPU.prototype.setShoreField.call( fake, f );
	ok( fake.shoreTexture.format === 'rgba16float' && fake.uniforms.fields.shoreRes.value === 8, `terrainShoreField on a phone: ${ fake.shoreTexture.format }` );
	delete globalThis.__phoneBudget;
	const fake2 = { tiles: { shore: [] }, shoreTexture: { width: 1, height: 1, format: 'rgba32float', destroy() {} }, uniforms: { fields: { shoreRes: { value: 1 } } } };
	TerrainGPU.prototype.setShoreField.call( fake2, f );
	ok( fake2.shoreTexture.format === 'rgba32float', `terrainShoreField on a desktop: ${ fake2.shoreTexture.format } (unchanged)` );

}

// ================================================================================================ 3. the wave 18 town scenario
section( '3. the "wave 18 town" CPU scenario and Tidemark\'s square view' );
{

	const run = () => spawnSync( process.execPath, [ 'tools/perf/cpu-scenarios.mjs', '--frames=300', '--repeat=1', '--no-alloc', '--scenario=wave18' ], { encoding: 'utf8', timeout: 300000 } );
	const fp = ( r ) => ( /"fingerprint":"([-\d.]+)"/.exec( r.stdout || '' ) || [] )[ 1 ];
	const a = run(), b = run();
	const stats = JSON.parse( ( /wave18: \d+ frames, [\d.]+ s wall, (\{.*\}), heap/.exec( a.stdout || '' ) || [ 0, '{}' ] )[ 1 ] );
	ok( a.status === 0 && fp( a ) && fp( a ) === fp( b ), `wave18 runs and is deterministic (${ fp( a ) }, ${ fp( b ) })` );
	ok( stats.townsfolk > 40 && stats.bodies > 0 && stats.hand === 'melee:cutlass' && stats.ships >= 12, `the town: ${ stats.townsfolk } townsfolk, ${ stats.bodies } with bodies, hand ${ stats.hand }, ${ stats.ships } ships` );
	const rows = new Set( ( a.stdout || '' ).split( '\n' ).map( ( l ) => l.split( /\s+/ )[ 0 ] ) );
	ok( [ 'townlife', 'weapons', 'firearms', 'melee', 'naval', 'trade', 'residents' ].every( ( m ) => rows.has( m ) ), 'ms per module: townlife, weapons, firearms, melee, naval, trade, residents' );
	const s = SCENARIOS.tidemarkSquare;
	ok( s && VIEW_SET.includes( 'tidemarkSquare' ) && parsePerfQuery( 'views' ).includes( 'tidemarkSquare' ) && ! parsePerfQuery( 'every' ).includes( 'tidemarkSquare' ), 'tidemarkSquare is a view (in --perf=views, not in every)' );
	ok( validateScenario( s ).length === 0 && s.time === 12 && s.weapon === 'cutlass', 'the square at noon with a cutlass drawn, valid' );
	const c = tidemarkAt( ( SQUARE.u0 + SQUARE.u1 ) / 2, ( SQUARE.v0 + SQUARE.v1 ) / 2 );
	ok( Math.hypot( s.place.x - c.x, s.place.z - c.z ) < ( SQUARE.u1 - SQUARE.u0 ), `it stands in the square (${ Math.hypot( s.place.x - c.x, s.place.z - c.z ).toFixed( 1 ) } m from its centre)` );
	ok( isNested( 'tris:opaque' ) && isNested( 'draws:opaque' ) && ! isNested( 'feature:townlife' ), 'triangles per pass are counted like the draws (nested, not summed)' );

}

// ================================================================================================ 4. wet sand
section( '4. wet sand' );
{

	const S = TERRAIN_WGSL.surface;
	const i = ( re ) => S.search( re );
	ok( i( /let reach = / ) > 0 && i( /let band = / ) > i( /let reach = / ) && i( /let damp = max\(.*band/ ) > i( /let band = / ), 'the terrain: the band is declared, then the damp sand takes it' );
	ok( /terrainShoreSample\( xz \)\.yz/.test( S ) && /mix\( 1\.2, 1\.6,/.test( S ), 'its reach follows the shore field\'s exposure (1.2 m sheltered .. 1.6 m exposed)' );
	ok( i( /rough = mix\( rough, mix\( mix\( 0\.45, 0\.2, band \* band \)/ ) > i( /let band = / ), 'and glosses it (roughness 0.45 -> 0.2 toward the water, 0.14 under the swash)' );
	ok( /fn terrainShoreSample\( xz: vec2f \) -> vec4f/.test( readFileSync( new URL( '../src/world/TerrainGPU.js', import.meta.url ), 'utf8' ) ) && /fn sat\(/.test( readFileSync( new URL( '../src/engine/render/wgsl/common.js', import.meta.url ), 'utf8' ) ), 'what it calls exists (TerrainGPU terrainShoreSample, common sat)' );
	// the tiles: vertex colour and roughness baked
	const t = new TerrainData();
	const lum = ( c, v ) => c[ v * 3 ] * 0.2126 + c[ v * 3 + 1 ] * 0.7152 + c[ v * 3 + 2 ] * 0.0722;
	const check = ( name, g, tile ) => {

		const p = g.getAttribute( 'position' ).array, c = g.getAttribute( 'color' ).array, a = g.getAttribute( 'aux' ).array;
		const wet = { n: 0, l: 0, r: 0 }, dry = { n: 0, l: 0, r: 0 };
		for ( let v = 0; v < p.length / 3; v ++ ) {

			const x = p[ v * 3 ], h = p[ v * 3 + 1 ], z = p[ v * 3 + 2 ];
			const ii = Math.round( ( x - tile.x0 ) / tile.texel ), jj = Math.round( ( z - tile.z0 ) / tile.texel ), k = jj * tile.n + ii;
			if ( tile.sand[ k ] < 200 || tile.rock[ k ] > 20 || tile.path[ k ] > 20 ) continue;
			const o = h > 0.08 && h < 0.4 ? wet : h > WET_REACH + 0.4 && h < WET_REACH + 3 ? dry : null;
			if ( ! o ) continue;
			o.n ++; o.l += lum( c, v ); o.r += a[ v * 4 ];

		}

		for ( const o of [ wet, dry ] ) { o.l /= o.n || 1; o.r /= o.n || 1; }
		ok( wet.n > 10 && dry.n > 10 && wet.l < dry.l * 0.75 && wet.r < 0.6 && Math.abs( dry.r - ROUGH_DRY ) < 1e-6, `${ name }: sand 0.1 - 0.4 m up ${ ( wet.l / dry.l * 100 ).toFixed( 0 ) } % as bright as the dry sand, roughness ${ wet.r.toFixed( 2 ) } (dry ${ dry.r.toFixed( 2 ) }; ${ wet.n } / ${ dry.n } vertices)` );

	};
	const tm = ensureTidemark( t ), bw = ensureBlackwater( t );
	check( 'Tidemark', terrainGeometry( tm, { step: 2, floor: - 4 } ), tm );
	check( 'Blackwater (black sand)', blackwaterLandGeometry( bw, { step: 2, floor: - 4 } ), bw );

}

// ================================================================================================ 5. the phone memory (last run)
section( '5. the phone GPU memory of the last headless run' );
{

	const f = new URL( '../tools/perf/out/perf-phone-w19.json', import.meta.url );
	if ( ! existsSync( f ) ) console.log( 'skip  no tools/perf/out/perf-phone-w19.json (docs/PERF.md "Wave 19A" makes it)' );
	else {

		const r = JSON.parse( readFileSync( f, 'utf8' ) );
		const rows = Object.entries( r.scenarios ).map( ( [ id, s ] ) => [ id, s.memory && s.memory.total ] );
		ok( rows.length >= 4 && rows.every( ( [ , mb ] ) => mb > 0 && mb <= 387 ), `every view <= 387 MB (wave 12's target): ${ rows.map( ( [ id, mb ] ) => `${ id } ${ mb }` ).join( ', ' ) }` );
		const peak = Math.max( ...Object.values( r.scenarios ).map( ( s ) => s.memory.peak ) );
		ok( peak < 480, `the peak ${ peak } MB stays clear of the ~507 MB that ended the iPhone tab in wave 9` );

	}

}

console.log( fails ? `\n${ fails } FAILED, ${ passes } passed` : `\nall ${ passes } wave 19A perf tests passed` );
process.exit( fails ? 1 : 0 );

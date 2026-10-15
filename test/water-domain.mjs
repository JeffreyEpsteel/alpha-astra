// Wave 13A: the sea and the plants reach Tidemark (the terrain tile beyond the 2048 m heightmap). The GPU height texture
// carries the tiles under the domain (the WGSL lookup's maths checked on the CPU), the shore field has the tiles' own
// fields (non-empty on Tidemark's beaches), the breakers and the shore simulation have Tidemark's beaches, the grass and
// the trees are planted on the tile (clear of the town, the strip, the roads and the river), the IslandKit stand-ins step
// back, the water / terrain / grass shaders compose with no new binding, the extra GPU memory of the two tiles stays under 9 MB, and the
// home island's data (heights, shore field, breaker stations, plants, grass mask) are bit-identical.
//   node test/water-domain.mjs                 checks (no GPU: a stub device)
//   node test/water-domain.mjs --dawn=<dir>    also compiles the shaders and runs terrainHeightAt / terrainShoreSample on
//                                              the GPU (a copy of node_modules/webgpu/dist/win32-x64 + vulkan-1.dll, see
//                                              tools/perf/README.md; --backend=vulkan is implied)
import { createRequire } from 'node:module';
import { join } from 'node:path';

const DAWN = ( process.argv.find( ( a ) => a.startsWith( '--dawn=' ) ) || '' ).slice( 7 );
if ( DAWN ) {

	const { create, globals } = createRequire( import.meta.url )( join( DAWN, 'dawn.node' ) );
	Object.assign( globalThis, globals );
	Object.defineProperty( globalThis, 'navigator', { value: { gpu: create( [ 'backend=vulkan' ] ) }, configurable: true } );
	globalThis.location = { search: '' };

}

globalThis.GPUShaderStage ??= { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
globalThis.GPUTextureUsage ??= { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 };
globalThis.GPUBufferUsage ??= { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512 };
globalThis.GPUMapMode ??= { READ: 1, WRITE: 2 };

const { GPU, DEFAULT_LIMITS } = await import( '../src/engine/gpu/GPU.js' );
await import( '../src/engine/render/Frame.js' );
const uploads = []; // the stub queue's texture writes: { label, origin, size, data }
if ( DAWN ) await GPU.init( { headless: true } );
else {

	// a stub device: anything not listed answers with a callable stand-in
	const any = () => new Proxy( function () {}, { get: ( t, k ) => ( k === 'then' ? undefined : k === Symbol.toPrimitive ? () => 0 : any() ), apply: () => any() } );
	const base = {
		limits: DEFAULT_LIMITS, features: new Set(),
		createShaderModule: ( d ) => ( { ...d, getCompilationInfo: async () => ( { messages: [] } ) } ),
		createTexture: ( d ) => ( { ...d, destroy() {}, createView: () => ( {} ) } ),
		createBuffer: ( d ) => ( { ...d, destroy() {}, getMappedRange: () => new ArrayBuffer( d.size ), unmap() {} } ),
		lost: new Promise( () => {} ), addEventListener() {},
		queue: { writeBuffer() {}, writeTexture: ( dst, data, layout, size ) => uploads.push( { label: dst.texture.label, origin: dst.origin, size, data, offset: layout.offset } ), submit() {}, onSubmittedWorkDone: async () => {} },
	};
	GPU.device = new Proxy( base, { get: ( t, k ) => ( k in t ? t[ k ] : any() ) } );
	GPU.limits = DEFAULT_LIMITS;
	GPU.queue = base.queue;
	GPU.samplers = new Proxy( {}, { get: () => ( {} ) } );

}

const { TerrainData } = await import( '../src/world/TerrainData.js' );
const { TerrainGPU, terrainWGSL } = await import( '../src/world/TerrainGPU.js' );
const { computeShoreField } = await import( '../src/world/ShoreField.js' );
const { WORLD } = await import( '../src/world/WorldLayout.js' );
const TT = await import( '../src/world/terrain/TerrainTiles.js' );
const { VegSite, scatterVegetation, buildGrassMask } = await import( '../src/world/vegetation/Scatter.js' );
const { buildStations, withTileStations } = await import( '../src/ocean/Breakers.js' );
const { scatterTrees } = await import( '../src/world/islands/town/Vegetation.js' );
const { airstripRects, rectOut } = await import( '../src/world/islands/town/TidemarkTerrain.js' );
const { TIDEMARK: I } = await import( '../src/world/terrain/IslandShape.js' );

let fails = 0, n = 0;
const ok = ( c, msg, info = '' ) => {

	n ++;
	if ( ! c ) { fails ++; console.log( 'FAIL', msg, info ); } else console.log( 'ok  ', msg, info );

};
const sameBits = ( a, b ) => {

	if ( a.length !== b.length ) return false;
	const A = new Uint32Array( a.buffer, a.byteOffset, a.length ), B = new Uint32Array( b.buffer, b.byteOffset, b.length );
	for ( let k = 0; k < A.length; k ++ ) if ( A[ k ] !== B[ k ] ) return false;
	return true;

};

let t0 = performance.now();
const T = new TerrainData();
console.log( 'TerrainData', ( performance.now() - t0 ).toFixed( 0 ), 'ms' );
const tiles = TT.terrainTiles( T );
const tm = tiles.find( ( t ) => t.id === 'tidemark' );
ok( !! tm && tm.n === 661 && tm.texel === 2 && tm.x0 === 1060 && tm.z0 === - 720, 'TerrainData has Tidemark\'s tile beyond the domain', tm && `${ tm.n } nodes, ${ tm.texel } m, at ${ tm.x0 }, ${ tm.z0 }` );
const tile = tm.src;

// ---------------------------------------------------------------- 1. heights: the atlas under the domain
const L = TT.heightAtlasLayout( T );
const strip = TT.buildHeightStrip( L );
ok( L.width === 2048 && L.mainRows === 2048 && L.stripRows === Math.ceil( tiles.reduce( ( s, t ) => s + t.n * t.n, 0 ) / 2048 ), 'height atlas: the domain\'s 2048 x 2048 texels, Tidemark\'s nodes in ' + L.stripRows + ' rows under them' );
const beachRuns = TT.tileBeaches( T );
const probes = [];
for ( const r of beachRuns.filter( ( q ) => q.tile === 'tidemark' ) ) for ( let k = 0; k < r.pts.length; k += 37 ) {

	const [ x, z, nx, nz ] = r.pts[ k ];
	for ( const d of [ - 30, - 6, 0, 4, 15, 60 ] ) probes.push( [ x + nx * d, z + nz * d ] );

}

for ( let k = 0; k < 400; k ++ ) probes.push( [ tile.x0 + ( ( k * 0.6180339 ) % 1 ) * 1318, tile.z0 + ( ( k * 0.7548776 ) % 1 ) * 1318 ] );
let worst = 0;
for ( const [ x, z ] of probes ) worst = Math.max( worst, Math.abs( TT.stripHeightAt( L, strip, x, z ) - tile.heightAt( x, z ) ) );
ok( worst < 1e-4, 'the shader\'s tile lookup (on the CPU) returns Tidemark\'s heights at its beaches, shallows and hills', probes.length + ' points, worst ' + worst.toExponential( 2 ) );
const beach0 = beachRuns[ 0 ].pts[ 100 ];
ok( Math.abs( TT.stripHeightAt( L, strip, beach0[ 0 ], beach0[ 1 ] ) ) < 0.6 && TT.stripHeightAt( L, strip, beach0[ 0 ] + beach0[ 2 ] * 30, beach0[ 1 ] + beach0[ 3 ] * 30 ) < - 0.5, 'at a Tidemark beach the lookup gives the waterline, 30 m out the shallows', TT.stripHeightAt( L, strip, beach0[ 0 ] + beach0[ 2 ] * 30, beach0[ 1 ] + beach0[ 3 ] * 30 ).toFixed( 2 ) + ' m' );
ok( TT.stripHeightAt( L, strip, 3000, 0 ) === - 90 && TT.stripHeightAt( L, strip, 0, 0 ) === - 90, 'off every tile: the open-ocean floor (-90 m)' );
const wgsl = terrainWGSL( L );
ok( /fn terrainTileHeight\(/.test( wgsl ) && /if \( outside \) \{ return terrainTileHeight\( xz \); \}/.test( wgsl ) && /terrainTileLoad\( L \+ 662 \)/.test( wgsl ) && wgsl.includes( 'vec2i( L % 2048, 2048 + L / 2048 )' ), 'WGSL: terrainHeightAt falls through to the tile lookup outside the domain (the same index maths)' );
const plain = terrainWGSL( null );
ok( ! /terrainTile/.test( plain.replace( /fn terrainOnTile[\s\S]*?\n}\n/, '' ) ), 'WGSL without tiles: the one-domain code (no tile branch)' );

// ---------------------------------------------------------------- 2. shore fields
t0 = performance.now();
const field = computeShoreField( T, { res: 512, swellDir: [ WORLD.swellDir.x, WORLD.swellDir.y ] } );
const fieldCopy = new Float32Array( field.data );
const gpu = new TerrainGPU( T, field );
console.log( 'shore field + TerrainGPU', ( performance.now() - t0 ).toFixed( 0 ), 'ms', JSON.stringify( gpu.timings, ( k, v ) => ( typeof v === 'number' ? Math.round( v ) : v ) ) );
ok( sameBits( field.data, fieldCopy ), 'the home shore field is untouched by the packing' );
ok( gpu.heightTexture.width === 2048 && gpu.heightTexture.height === 2048 + L.stripRows && gpu.shoreTexture.width === 512 && gpu.shoreTexture.height === 512 + Math.ceil( TT.shoreTileLayout( tiles ).reduce( ( s, t ) => s + t.n * t.n, 0 ) / 512 ), 'GPU: height atlas ' + gpu.heightTexture.width + ' x ' + gpu.heightTexture.height + ', shore field ' + gpu.shoreTexture.width + ' x ' + gpu.shoreTexture.height );
if ( ! DAWN ) {

	const hu = uploads.filter( ( u ) => u.label === 'terrainHeights' );
	const dom = hu.find( ( u ) => u.origin.y === 0 ), st = hu.find( ( u ) => u.origin.y === 2048 );
	ok( dom && dom.size.width === 2048 && dom.size.height === 2048 && dom.data === T.heights.buffer && dom.offset === T.heights.byteOffset, 'the domain\'s texels upload straight from TerrainData.heights (bit-identical)' );
	ok( st && st.size.height === L.stripRows && sameBits( new Float32Array( st.data, 0, 661 * 661 ), tile.heights ), 'the strip holds Tidemark\'s nodes as they are' );
	const su = uploads.filter( ( u ) => u.label === 'terrainShoreField' ).pop();
	ok( su && sameBits( new Float32Array( su.data, 0, 512 * 512 * 4 ), field.data ), 'the shore texture\'s domain rows are the home field, bit for bit' );

}

const tf = gpu._tileShore.find( ( f ) => f.id === 'tidemark' );
let finite = 0, wet = 0;
for ( let k = 0; k < tf.data.length; k += 4 ) { if ( tf.data[ k ] < 1e5 ) finite ++; if ( Math.hypot( tf.data[ k + 1 ], tf.data[ k + 2 ] ) > 0.05 ) wet ++; }
ok( finite > 330 * 330 * 0.6 && wet > 330 * 330 * 0.4, 'Tidemark\'s shore field is filled (arrival times, wave directions)', `${ finite } timed, ${ wet } with a direction of ${ 330 * 330 } cells` );
// at the exposed beaches the waves run shoreward; the lee shore is calm
let toShore = 0, cnt = 0, lee = 0, leeN = 0;
for ( const r of beachRuns.filter( ( q ) => q.tile === 'tidemark' ) ) for ( let k = 0; k < r.pts.length; k += 6 ) {

	const [ x, z, nx, nz ] = r.pts[ k ];
	const s = gpu.shoreSampleAt( x + nx * 25, z + nz * 25 );
	const e = Math.hypot( s[ 1 ], s[ 2 ] );
	if ( e > 0.3 ) { toShore += ( - s[ 1 ] * nx - s[ 2 ] * nz ) / e > 0.3 ? 1 : 0; cnt ++; }
	if ( nz < - 0.8 ) { lee += e; leeN ++; }

}

ok( cnt > 100 && toShore / cnt > 0.9, 'on Tidemark\'s exposed beaches the waves run toward the shore', `${ toShore } of ${ cnt } stations` );
ok( leeN === 0 || lee / leeN < 0.15, 'its lee (north) shore is calm', leeN ? ( lee / leeN ).toFixed( 2 ) : 'none' );
// the stream's mouth: the shore field's calm
const [ mu, mv ] = I.river.pts[ I.river.pts.length - 1 ];
const [ mx, mz ] = tile.world( mu, mv );
const ms = gpu.shoreSampleAt( mx, mz );
ok( ms && ms[ 0 ] < 1e5 && Math.hypot( ms[ 1 ], ms[ 2 ] ) <= 1, 'the stream\'s mouth lies in the field', ms && `T ${ ms[ 0 ].toFixed( 0 ) } s, exposure ${ Math.hypot( ms[ 1 ], ms[ 2 ] ).toFixed( 2 ) }` );
const sw = TT.tileShoreWGSL( L.shore );
ok( /fn terrainTileShore\(/.test( sw ) && /vec2i\( L % R, R \+ L \/ R \)/.test( sw ) && wgsl.includes( 'terrainParams.shoreRes > 1.5 && terrainOnTile( xz )' ), 'WGSL: terrainShoreSample reads the tile\'s field from the rows under the home field' );

// ---------------------------------------------------------------- 3. breakers and the shore simulation's beaches
const main = buildStations( T );
const st = withTileStations( main, T, ( x, z ) => gpu.shoreSampleAt( x, z ) );
ok( sameBits( st.data.subarray( 0, main.data.length ), main.data ), 'breakers: the main beach\'s stations are unchanged (first in the buffer)', main.count + ' stations' );
const tileSt = [];
let gaps = 0;
for ( let k = main.count; k < st.count; k ++ ) {

	const nx = st.data[ k * 4 + 2 ], nz = st.data[ k * 4 + 3 ];
	if ( nx === 0 && nz === 0 ) { gaps ++; continue; }
	tileSt.push( [ st.data[ k * 4 ], st.data[ k * 4 + 1 ], nx, nz ] );

}

const onShore = tileSt.filter( ( [ x, z, nx, nz ] ) => Math.abs( T.heightAt( x, z ) ) < 0.8 && T.heightAt( x + nx * 20, z + nz * 20 ) < - 0.3 && T.heightAt( x - nx * 8, z - nz * 8 ) > 0 ).length;
ok( tileSt.length > 600 && gaps === st.runs && onShore / tileSt.length > 0.9, 'Tidemark\'s beaches get breaker stations on the waterline, facing the sea, one gap station per beach', `${ tileSt.length } stations on ${ st.runs } beaches, ${ onShore } checked` );
ok( beachRuns.length > st.runs, 'the lee beach gets no breakers', `${ beachRuns.length } beaches, ${ st.runs } exposed` );
const bayBeach = beachRuns.some( ( r ) => r.pts.some( ( [ x, z ] ) => {

	const [ u, v ] = tile.local( x, z );
	return Math.hypot( u - I.bay[ 0 ], v - I.bay[ 1 ] ) < I.bay[ 2 ] + 25;

} ) );
ok( bayBeach, 'the bay\'s beach is one of them' );
const town = beachRuns.every( ( r ) => r.pts.every( ( [ x, z ] ) => {

	const [ u, v ] = tile.local( x, z );
	return rectOut( u, v, I.quay.u1, I.quay.u0, I.quay.v0, I.quay.v1 ) > 3 && rectOut( u, v, I.pier.u1, I.pier.u0, I.pier.v - 4, I.pier.v + 4 ) > 3;

} ) );
ok( town, 'no beach along the quay or under the pier' );
ok( beachRuns.every( ( r ) => r.size >= 200 && r.size <= 480 ), 'each beach has a shore-simulation region (200 - 480 m)' );

// ---------------------------------------------------------------- 4. vegetation
t0 = performance.now();
const site = new VegSite( T, {} );
const recs = scatterVegetation( site );
const tScatter = performance.now() - t0;
const home = scatterVegetation( new VegSite( T, {} ), 99, { tiles: false } );
const KINDS = [ 'palms', 'trees', 'bananas', 'shrubs', 'youngPalms', 'ferns', 'monsteras', 'elephantEars', 'heliconias', 'strelitzias' ];
ok( KINDS.every( ( k ) => JSON.stringify( recs[ k ].slice( 0, home[ k ].length ) ) === JSON.stringify( home[ k ] ) ) && recs.villagePalms === home.villagePalms, 'the home island\'s plants are bit-identical (first in every list)', `scatter ${ tScatter.toFixed( 0 ) } ms` );
const added = Object.fromEntries( KINDS.map( ( k ) => [ k, recs[ k ].slice( home[ k ].length ).filter( ( r ) => tile.contains( r.x, r.z ) ) ] ) );
const c = recs.tileCounts.tidemark;
ok( c.trees > 400 && c.palms > 60 && c.shrubs > 300 && c.ferns > 1000 && added.trees.length === c.trees, 'Tidemark is planted: woodland, palms, shrubs, ferns', JSON.stringify( c ) );
const inTile = ( r ) => tile.contains( r.x, r.z );
const all = KINDS.flatMap( ( k ) => added[ k ] );
ok( all.every( inTile ) && all.every( ( r ) => tile.heightAt( r.x, r.z ) > 1.5 && Math.abs( r.y - tile.heightAt( r.x, r.z ) ) < 1.5 ), 'every Tidemark plant stands on the tile\'s land, on the ground', all.length + ' plants' );
const strip2 = airstripRects();
const clear = all.every( ( r ) => {

	const [ u, v ] = tile.local( r.x, r.z );
	if ( strip2.some( ( R ) => rectOut( u, v, R[ 0 ], R[ 1 ], R[ 2 ], R[ 3 ] ) < 1 ) ) return false;
	if ( rectOut( u, v, I.pads[ 0 ][ 0 ], I.pads[ 0 ][ 1 ], I.pads[ 0 ][ 2 ], I.pads[ 0 ][ 3 ] ) < 1 ) return false;
	return tile.maskAt( r.x, r.z ).river <= 0.05;

} );
ok( clear, 'none on the airstrip, the town terrace or in the stream' );
ok( [ ...added.trees, ...added.palms ].every( ( r ) => tile.pathDistance( r.x, r.z ) > 2 ), 'trees and palms keep off the roads' );
const beachPalms = added.palms.filter( ( r ) => r.y < 6 ).length;
ok( beachPalms > 40, 'palms at the back of the beaches', beachPalms + ' below 6 m' );
ok( TT.isVegetated( tm ), 'the tile is marked as covered by the instanced vegetation' );

// the IslandKit stand-ins step back: only the street palms
const parts = [];
const veg = scatterTrees( { tile, colliders: null, add: ( g ) => parts.push( g ), addFar: ( g ) => parts.push( g ) } );
ok( veg.real && veg.trees === 0 && veg.palms === veg.street && veg.street >= 8 && veg.street <= 10, 'town/Vegetation: the stand-ins step back, the palms along the streets stay', JSON.stringify( veg ) );

// grass masks
t0 = performance.now();
const mask = buildGrassMask( site );
const tMask = performance.now() - t0;
const homeMask = buildGrassMask( site, { tiles: false } );
ok( sameBits( new Uint32Array( mask.data.buffer ), new Uint32Array( homeMask.data.buffer ) ) && mask.res === homeMask.res, 'the home grass mask is bit-identical', `${ tMask.toFixed( 0 ) } ms` );
const TMk = mask.tiles;
const tmm = TMk.tiles.find( ( m ) => m.id === 'tidemark' );
let meadow = 0, dune = 0, onStrip = 0;
for ( let j = 0; j < tmm.n; j ++ ) for ( let i = 0; i < tmm.n; i ++ ) {

	const o = ( j * TMk.width + tmm.u0 + i ) * 4;
	if ( TMk.data[ o + 1 ] > 8 ) meadow ++;
	if ( TMk.data[ o ] > 8 ) dune ++;
	const x = tmm.x0 + ( i + 0.5 ) * tmm.texel, z = tmm.z0 + ( j + 0.5 ) * tmm.texel;
	if ( ( TMk.data[ o ] | TMk.data[ o + 1 ] ) > 8 && tile.graded( x, z ) === 1 ) onStrip ++;

}

ok( meadow > 20000 && dune > 500 && onStrip === 0, 'Tidemark\'s grass: meadow on the open ground, dune grass behind the beaches, none on the runway', `${ meadow } meadow, ${ dune } dune texels (2 m)` );

// ---------------------------------------------------------------- 5. phone memory: the extra GPU bytes
const extra = {
	heights: 2048 * L.stripRows * 4,
	shore: 512 * ( gpu.shoreTexture.height - 512 ) * 16,
	grassMask: TMk.width * TMk.height * 4,
	breakers: ( st.count - main.count ) * ( 16 + 6 * 16 ),
};
const total = Object.values( extra ).reduce( ( a, b ) => a + b, 0 );
// (wave 21: three tiles with Meridian, the biggest island; phones halve the heights and the shore field, wave 19A)
ok( total < 18 * 1024 * 1024, 'the three tiles cost under 18 MB of GPU memory', JSON.stringify( Object.fromEntries( Object.entries( extra ).map( ( [ k, v ] ) => [ k, ( v / 1048576 ).toFixed( 2 ) + ' MB' ] ) ) ) );

// ---------------------------------------------------------------- 6. the shaders compose (no new binding)
{

	const { ShaderModule, composeShader } = await import( '../src/engine/gpu/Shader.js' );
	const { buildMeshShader } = await import( '../src/engine/render/MeshShader.js' );
	const { OceanFFT } = await import( '../src/ocean/OceanFFT.js' );
	const { CDLOD } = await import( '../src/core/CDLOD.js' );
	const { WaterSurface } = await import( '../src/ocean/WaterSurface.js' );
	const { WaterMaterial } = await import( '../src/ocean/WaterMaterial.js' );
	const { ShoreWaves } = await import( '../src/ocean/ShoreWaves.js' );
	const { Texture } = await import( '../src/engine/gpu/Texture.js' );
	const { setShadowMap } = await import( '../src/engine/render/wgsl/lighting.js' );
	const sky = { module: new ShaderModule( { name: 'skyStubDomain', code: /* wgsl */`
fn skyRadiance( dir: vec3f, withSun: bool ) -> vec3f { return mix( vec3f( 0.8, 0.9, 1.0 ), vec3f( 0.2, 0.35, 0.8 ), clamp( dir.y, 0.0, 1.0 ) ); }
fn skyRadianceWithClouds( dir: vec3f, withSun: bool ) -> vec3f { return skyRadiance( dir, withSun ); }
fn skyReflectionRadiance( dir: vec3f ) -> vec3f { return skyRadiance( dir, false ); }
` } ) };
	const fft = new OceanFFT( DAWN ? null : null );
	const tex = new Texture( { width: 4, height: 4, format: 'rgba16float' } );
	const depthTex = new Texture( { width: 4, height: 4, format: 'depth32float' } );
	const foamTexture = new Texture( { width: 4, height: 4, format: 'rgba16float', mips: true } );
	setShadowMap( new Texture( { width: 4, height: 4, depth: 4, dimension: '2d-array', format: 'depth32float' } ) );
	const layout = [ { name: 'position', wgsl: 'vec3f', location: 0 }, { name: 'nodeData', wgsl: 'vec4f', location: 1, instanced: true } ];
	const compose = ( terrain ) => {

		const surface = new WaterSurface( { fft, cdlod: new CDLOD( { gridSize: 32, leafSize: 8, levels: 12, minY: - 25, maxY: 25 } ), foamTexture } );
		surface.terrain = terrain;
		surface.shore = new ShoreWaves( terrain );
		const wm = new WaterMaterial( { surface, sky, sceneCopy: { texture: tex, depthTexture: depthTex } } );
		wm.pipelineKey();
		const src = buildMeshShader( wm, layout, { kind: 'main', late: true } );
		return composeShader( { modules: src.modules, bindings: src.bindings, code: src.code, defines: src.defines, stage: 'render', label: 'water-domain' } );

	};
	const count = ( c, vis ) => {

		const r = { uniform: 0, texture: 0, storage: 0 };
		for ( const d of [ ...c.group0.described, ...c.bindings.described ] ) if ( d.layout.visibility & vis ) {

			if ( d.layout.buffer?.type === 'uniform' ) r.uniform ++; else if ( d.layout.texture ) r.texture ++; else if ( d.layout.buffer ) r.storage ++;

		}

		return r;

	};
	const withTiles = compose( gpu );
	// the same terrain with the one-domain WGSL (what the water bound before)
	const oneDomain = Object.assign( Object.create( Object.getPrototypeOf( gpu ) ), gpu );
	oneDomain.module = new ShaderModule( { name: 'terrain', deps: gpu.module.deps, uniforms: gpu.uniforms, bindings: gpu.module.bindings, code: terrainWGSL( null ) } );
	const before = compose( oneDomain );
	const body = withTiles.code.replace( /\/\/[^\n]*/g, '' );
	const bal = ( ch ) => body.split( ch ).length - 1;
	ok( bal( '{' ) === bal( '}' ) && bal( '(' ) === bal( ')' ), 'the water shader composes with the tile branches (balanced)', ( withTiles.code.length - before.code.length ) + ' WGSL bytes more' );
	ok( /fn terrainTileHeight\(/.test( withTiles.code ) && /fn terrainTileShore\(/.test( withTiles.code ) && /fn terrainTileNormalRock\(/.test( withTiles.code ), 'it carries the tile height, normal and shore lookups' );
	const fa = count( withTiles, GPUShaderStage.FRAGMENT ), fb = count( before, GPUShaderStage.FRAGMENT ), va = count( withTiles, GPUShaderStage.VERTEX ), vb = count( before, GPUShaderStage.VERTEX );
	ok( JSON.stringify( fa ) === JSON.stringify( fb ) && JSON.stringify( va ) === JSON.stringify( vb ), 'no new binding or uniform buffer in the water (vertex / fragment)', JSON.stringify( { vertex: va, fragment: fa } ) );

	// the grass field: Tidemark's cells, its mask texture, the tile branch in the vertex shader
	const { GrassField } = await import( '../src/world/vegetation/GrassField.js' );
	const grass = new GrassField( { terrain: T, mask } );
	const gl = [ [ 'position', 'vec3f' ], [ 'normal', 'vec3f' ], [ 'aSlot', 'vec4f' ], [ 'aBlade', 'vec4f' ], [ 'aSide', 'vec4f' ], [ 'iCell', 'vec4f', true ] ].map( ( [ name, w, inst ], location ) => ( { name, wgsl: w, location, instanced: !! inst } ) );
	const gsrc = buildMeshShader( grass.material, gl, { kind: 'main' } );
	const gc = composeShader( { modules: gsrc.modules, bindings: gsrc.bindings, code: gsrc.code, defines: gsrc.defines, stage: 'render', label: 'grass-domain' } );
	const tcell = grass.tileCells[ 0 ];
	const occupied = tcell ? tcell.flags.reduce( ( a, b ) => a + b, 0 ) : 0;
	ok( grass.heightTex === gpu.heightTexture && grass.maskTilesTex && grass.maskTilesTex.width === TMk.width && occupied > 1000 && /grassTileHeight\( xz \)/.test( gc.code ) && /grassTileMask\( xz, tileK \)/.test( gc.code ), 'grass: the shared height atlas, Tidemark\'s mask texture and ' + occupied + ' grass cells, the tile branch in the vertex shader' );
	// a camera on Tidemark's meadow: tile cells fill the levels
	{

		const E = await import( '../src/engine/index.js' );
		let best = null;
		for ( let c = 0; c < tcell.flags.length && ! best; c ++ ) if ( tcell.flags[ c ] && tcell.minY[ c ] > 6 ) best = c;
		const cx = tcell.x0 + ( best % tcell.n + 0.5 ) * 8, cz = tcell.z0 + ( Math.floor( best / tcell.n ) + 0.5 ) * 8;
		const cam = new E.PerspectiveCamera( 60, 1.6, 0.1, 2000 );
		cam.position.set( cx, tile.heightAt( cx, cz ) + 1.7, cz );
		cam.lookAt( cx + 30, tile.heightAt( cx, cz ), cz + 10 );
		cam.updateMatrixWorld();
		grass.update( cam );
		const lv = grass.levels.map( ( l ) => l.count );
		const tagged = grass.levels.every( ( l ) => Array.from( { length: l.count }, ( _, k ) => l.arr[ k * 4 + 2 ] ).every( ( v ) => v === 1 ) );
		ok( lv[ 0 ] + lv[ 1 ] + lv[ 2 ] > 20 && tagged, 'standing on Tidemark\'s meadow the grass draws its cells (tagged tile 1)', JSON.stringify( lv ) );
		cam.position.set( 20, 12, - 200 ); cam.lookAt( 20, 8, - 260 ); cam.updateMatrixWorld();
		grass.update( cam );
		ok( grass.levels.every( ( l ) => Array.from( { length: l.count }, ( _, k ) => l.arr[ k * 4 + 2 ] ).every( ( v ) => v === 0 ) ), 'at home the cells are the domain\'s (tag 0)', JSON.stringify( grass.levels.map( ( l ) => l.count ) ) );

	}

	if ( DAWN ) {

		const gm = GPU.device.createShaderModule( { code: gc.code } );
		const gi = ( await gm.getCompilationInfo() ).messages.filter( ( x ) => x.type === 'error' );
		ok( gi.length === 0, 'Dawn compiles the grass shader with the tile branch', gi.map( ( e ) => e.lineNum + ': ' + e.message ).slice( 0, 3 ).join( ' | ' ) );

		// compile the water, then run the terrain lookups on the GPU at Tidemark and at home
		const { createShaderModule } = await import( '../src/engine/gpu/Shader.js' );
		const m = createShaderModule ? GPU.device.createShaderModule( { code: withTiles.code } ) : null;
		const info = m ? await m.getCompilationInfo() : { messages: [] };
		const errs = info.messages.filter( ( x ) => x.type === 'error' );
		ok( errs.length === 0, 'Dawn compiles the water shader with the tile branches', errs.map( ( e ) => e.lineNum + ': ' + e.message ).slice( 0, 3 ).join( ' | ' ) );
		const { ComputeKernel } = await import( '../src/engine/gpu/Compute.js' );
		const { StorageBuffer } = await import( '../src/engine/gpu/Texture.js' );
		const { readBuffer } = await import( '../src/engine/gpu/Readback.js' );
		const pts = [ ...probes.slice( 0, 240 ), [ 10, - 60 ], [ 55, - 100 ], [ - 300, - 400 ], [ 900, 900 ] ];
		const P = new StorageBuffer( { count: pts.length, type: 'vec4f', data: new Float32Array( pts.flatMap( ( [ x, z ] ) => [ x, z, 0, 0 ] ) ) } );
		const O = new StorageBuffer( { count: pts.length, type: 'vec4f' } );
		const k = new ComputeKernel( { label: 'tile lookups', modules: [ gpu.module ], bindings: { pIn: { storage: P, access: 'read' }, pOut: { storage: O, access: 'read_write' } }, workgroupSize: [ 64, 1, 1 ], code: /* wgsl */`
@compute @workgroup_size( WG_X ) fn main( @builtin( global_invocation_id ) gid: vec3u ) {
	if ( gid.x >= ${ pts.length }u ) { return; }
	let xz = pIn[ gid.x ].xy;
	let s = terrainShoreSample( xz );
	pOut[ gid.x ] = vec4f( terrainHeightAt( xz ), s.x, length( s.yz ), terrainNormalAt( xz ).y );
}` } );
		GPU.beginFrame(); k.dispatch( Math.ceil( pts.length / 64 ) ); GPU.submit();
		const r = new Float32Array( await readBuffer( O.getGPU(), pts.length * 16 ) );
		let wh = 0, ws = 0;
		pts.forEach( ( [ x, z ], i ) => {

			wh = Math.max( wh, Math.abs( r[ i * 4 ] - T.heightAt( x, z ) ) );
			const s = gpu.shoreSampleAt( x, z );
			if ( s && s[ 0 ] < 1e5 ) ws = Math.max( ws, Math.abs( r[ i * 4 + 1 ] - s[ 0 ] ) / Math.max( 1, s[ 0 ] ) );

		} );
		ok( wh < 2e-3, 'on the GPU terrainHeightAt returns Tidemark\'s heights (and the home island\'s)', 'worst ' + wh.toExponential( 2 ) + ' m' );
		ok( ws < 1e-5, 'on the GPU terrainShoreSample returns Tidemark\'s shore field', 'worst rel ' + ws.toExponential( 2 ) );

	}

}

console.log( `${ n - fails } / ${ n } ok` );
process.exit( fails ? 1 : 0 );

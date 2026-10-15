// Plain-node audit of the iOS / WebKit path (wave 7: the game never started on an iPhone 17 Pro): the device request stays
// within what the adapter offers (the spec defaults on WebKit), optional features are optional, shaders bind only what
// their entry points reach, compute kernels fit the default limits, the phone's memory trims, and the error card / ?diag.
// No GPU: the device is a stub. The real-device check is `node test/engine-smoke.mjs --limits=default` (Dawn).
import { readFileSync } from 'node:fs';

globalThis.GPUShaderStage ??= { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
globalThis.GPUTextureUsage ??= { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 };
globalThis.GPUBufferUsage ??= { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512 };

const { GPU, DEFAULT_LIMITS, WANT_LIMITS, clampLimits, textureBytes, sampleTypeOf } = await import( '../src/engine/gpu/GPU.js' );
const { composeShader, ShaderModule, entryPoints, stageOverruns } = await import( '../src/engine/gpu/Shader.js' );
const { Texture, capImage } = await import( '../src/engine/gpu/Texture.js' );
await import( '../src/engine/render/Frame.js' ); // (registers the frame uniforms of group 0)

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};
const src = ( f ) => readFileSync( new URL( '../' + f, import.meta.url ), 'utf8' );

// a device stub: records what is made
function stubDevice( limits = DEFAULT_LIMITS ) {

	const made = { layouts: [], modules: [], pipelines: [], querySets: 0 };
	return {
		made, limits, features: new Set(),
		createBindGroupLayout: ( d ) => ( made.layouts.push( d ), { ...d, isLayout: true } ),
		createPipelineLayout: ( d ) => d,
		createShaderModule: ( d ) => ( made.modules.push( d ), { ...d, getCompilationInfo: async () => ( { messages: [] } ) } ),
		createComputePipelineAsync: async ( d ) => ( made.pipelines.push( d ), {} ),
		createRenderPipelineAsync: async ( d ) => ( made.pipelines.push( d ), {} ),
		createSampler: ( d ) => d,
		createBuffer: ( d ) => ( { ...d, destroy() {} } ),
		createTexture: ( d ) => ( { ...d, destroy() {}, createView: () => ( {} ) } ),
		createQuerySet: () => ( made.querySets ++, {} ),
		lost: new Promise( () => {} ),
		addEventListener() {},
		queue: { writeBuffer() {}, writeTexture() {}, submit() {} },
	};

}

// ---- 1. the device request: never above the adapter, nothing above the defaults on a defaults-only adapter (WebKit)
{

	const asked = clampLimits( DEFAULT_LIMITS );
	ok( Object.keys( asked ).length === 0, 'a defaults-only adapter (iOS): no limit asked above the spec defaults' );
	const big = { ...DEFAULT_LIMITS, maxSampledTexturesPerShaderStage: 48, maxStorageBuffersPerShaderStage: 10, maxBufferSize: 4294967296, maxComputeWorkgroupStorageSize: 32768 };
	const a2 = clampLimits( big );
	ok( a2.maxSampledTexturesPerShaderStage === 32 && a2.maxBufferSize === WANT_LIMITS.maxBufferSize && a2.maxComputeWorkgroupStorageSize === 32768, 'a desktop adapter: the wanted limits, clamped to it' );
	ok( Object.entries( a2 ).every( ( [ k, v ] ) => v <= big[ k ] ), 'every asked limit <= the adapter' );
	const mid = { ...DEFAULT_LIMITS, maxSampledTexturesPerShaderStage: 20 };
	ok( clampLimits( mid ).maxSampledTexturesPerShaderStage === 20, 'an in-between adapter: its own value' );
	// nothing else in src asks for limits or features
	const gpuSrc = src( 'src/engine/gpu/GPU.js' );
	ok( /requestAdapter\(\s*\)/.test( gpuSrc ) && /requestAdapter\(\s*\{\s*powerPreference/.test( gpuSrc ), 'requestAdapter: high-performance first, then no options (Safari may return null)' );
	ok( /alphaMode:\s*'opaque'/.test( gpuSrc ) && /getPreferredCanvasFormat\(\)/.test( gpuSrc ), 'canvas: opaque, the preferred format' );

}

// ---- 2. GPU.init with a fake WebKit: null for high-performance, defaults only, requestDevice failing once
{

	const calls = [];
	let first = true;
	const dev = stubDevice();
	const adapter = {
		limits: DEFAULT_LIMITS, features: new Set( [ 'timestamp-query' ] ), info: { vendor: 'apple', architecture: 'common-3' },
		requestDevice: async ( d ) => {

			calls.push( d );
			if ( first ) { first = false; throw new Error( 'refused' ); }
			return dev;

		},
	};
	const reqs = [];
	const saved = globalThis.navigator;
	Object.defineProperty( globalThis, 'navigator', { value: { gpu: { requestAdapter: async ( o ) => ( reqs.push( o ), o ? null : adapter ), getPreferredCanvasFormat: () => 'bgra8unorm' } }, configurable: true } );
	const warn = console.warn;
	console.warn = () => {};
	await GPU.init( { headless: true, features: 'none' } );
	console.warn = warn;
	ok( reqs.length === 2 && reqs[ 0 ] && reqs[ 0 ].powerPreference === 'high-performance' && reqs[ 1 ] === undefined, 'adapter: retried without options after null' );
	ok( calls.length === 2 && Object.keys( calls[ 0 ].requiredLimits ).length === 0 && ! calls[ 1 ].requiredLimits, 'device: nothing above the defaults; a refused request retried with no limits' );
	ok( ! GPU.hasTimestamp && GPU.features.size === 0, 'features none: no timestamp-query (?features=none)' );
	ok( GPU.adapterInfo && GPU.adapterInfo.vendor === 'apple' && /apple/.test( GPU.describe() ), 'adapter info in GPU.describe() (the error card)' );
	// the allocation counter
	const m0 = GPU.memory.total;
	GPU.device.createTexture( { size: [ 1024, 1024 ], format: 'rgba8unorm', mipLevelCount: 11 } );
	GPU.device.createBuffer( { size: 4096 } );
	ok( GPU.memory.total - m0 === textureBytes( { size: [ 1024, 1024 ], format: 'rgba8unorm', mipLevelCount: 11 } ) + 4096, 'GPU.memory counts createTexture / createBuffer' );
	ok( Math.abs( textureBytes( { size: { width: 1024, height: 1024 }, format: 'rgba8unorm', mipLevelCount: 11 } ) / 1048576 - 5.33 ) < 0.01, 'a 1024 px rgba8 texture with mips: 5.3 MB' );
	// errors reach the card's listener
	const seen = [];
	const off = GPU.onError( ( e ) => seen.push( e ) );
	GPU.reportError( 'pipeline', 'too many textures', 'water main' );
	off();
	ok( seen.length === 1 && seen[ 0 ].label === 'water main', 'GPU.onError gets pipeline / device errors' );
	Object.defineProperty( globalThis, 'navigator', { value: saved, configurable: true } );

}

// ---- 3. float32 textures: unfilterable without the feature (sampling them 'linear' is invalid on WebKit)
{

	GPU.hasFloat32Filterable = false;
	ok( sampleTypeOf( 'r32float' ) === 'unfilterable-float' && sampleTypeOf( 'rgba32float' ) === 'unfilterable-float', 'r32float / rgba32float are unfilterable without float32-filterable' );
	GPU.hasFloat32Filterable = true;
	ok( sampleTypeOf( 'r32float' ) === 'float', '... and filterable with it' );
	GPU.hasFloat32Filterable = false;
	// no source forces a filterable sample type on a 32-bit float texture
	const files = [ 'src/world/TerrainGPU.js', 'src/world/vegetation/GrassField.js', 'src/ocean/WaterQuery.js', 'src/ocean/ShoreSim.js', 'src/ocean/WakeSim.js', 'src/ocean/OceanFFT.js' ];
	let forced = [];
	for ( const f of files ) {

		let t = '';
		try { t = src( f ); } catch ( e ) { continue; }
		for ( const m of t.matchAll( /format:\s*'(r|rg|rgba)32float'[^\n]*sampleType:\s*'float'/g ) ) forced.push( f + ': ' + m[ 0 ].slice( 0, 60 ) );

	}

	ok( forced.length === 0, 'no 32-bit float texture is declared filterable by hand' + ( forced.length ? ': ' + forced.join( '; ' ) : '' ) );

}

// ---- 4. shaders bind only what an entry point reaches (unused module textures count against no per-stage limit)
{

	GPU.device = stubDevice();
	GPU.limits = DEFAULT_LIMITS;
	const tex = new Texture( { width: 4, height: 4, format: 'rgba8unorm' } );
	const many = {};
	for ( let i = 0; i < 20; i ++ ) many[ 'big' + i ] = { texture: tex };
	const mod = new ShaderModule( { name: 'many', bindings: many, code: Array.from( { length: 20 }, ( _, i ) => `fn useBig${ i }( uv: vec2f ) -> vec4f { return textureSampleLevel( big${ i }, smpLinearClamp, uv, 0.0 ); }` ).join( '\n' ) } );
	const c = composeShader( { modules: [ mod ], stage: 'compute', label: 'audit', code: '@compute @workgroup_size( 8 ) fn main() { let a = useBig3( vec2f( 0.0 ) ) + useBig7( vec2f( 0.5 ) ); }' } );
	const entries = c.bindings.layout.entries;
	ok( entries.length === 2 && entries.map( ( e ) => e.binding ).join() === '3,7', 'compute: only the 2 reached of 20 module textures are in the layout (binding numbers kept)' );
	ok( /@binding\(7\) var big7/.test( c.code ) && /fn useBig7/.test( c.code ) && ! /big19|useBig19/.test( c.code ), 'the source sent to the browser has no unreached functions or their bindings (stripUnreached)' );
	ok( entryPoints( '@vertex fn vs() {} @fragment fn fs() {} @compute @workgroup_size( 8, 8 ) fn main() {}' ).map( ( e ) => e.name ).join() === 'vs,fs,main', 'entry points of every stage are found' );
	const over = stageOverruns( Array.from( { length: 17 }, ( _, i ) => [ 't' + i, { visibility: 2, texture: {} } ] ), DEFAULT_LIMITS );
	ok( over.length === 1 && over[ 0 ].stage === 'fragment' && over[ 0 ].count === 17, 'a group over a per-stage limit is named (the warning before the device error)' );

}

// ---- 5. compute kernels within the defaults: mip chains write at most 4 storage textures, the SH reduction fits 16 KiB
{

	const { ComputeMips } = await import( '../src/ocean/ComputeMips.js' );
	for ( const [ res, max ] of [ [ 512, 4 ], [ 256, 4 ], [ 32, 4 ], [ 512, 8 ] ] ) {

		GPU.device = stubDevice();
		GPU.limits = { ...DEFAULT_LIMITS, maxStorageTexturesPerShaderStage: max };
		const t = new Texture( { width: res, height: res, depth: 6, dimension: 'cube', format: 'rgba16float', mips: true, usage: [ 'sample', 'storage' ] } );
		const mips = new ComputeMips( t, 'audit' );
		const outs = mips.stages.map( ( s ) => ( s.kernel.source.match( /texture_storage_2d_array/g ) || [] ).length );
		const levels = mips.stages.reduce( ( n, s, i ) => n + outs[ i ], 0 );
		const wg = mips.stages.map( ( s ) => s.kernel.workgroupSize[ 0 ] * s.kernel.workgroupSize[ 1 ] );
		ok( outs.every( ( n ) => n <= max ) && levels === t.mipLevelCount - 1 && wg.every( ( n ) => n <= 256 ), `ComputeMips ${ res } px, limit ${ max }: ${ mips.stages.length } stages write ${ outs.join( '+' ) } levels (all ${ t.mipLevelCount - 1 }), <= 256 threads` );

	}

	const fft = src( 'src/ocean/OceanFFT.js' );
	const binds = [ ...fft.matchAll( /bindings:\s*\{([^}]*level\( tex[^}]*)\}/g ) ].map( ( m ) => ( m[ 1 ].match( /level\( tex/g ) || [] ).length );
	ok( binds.length === 2 && binds.every( ( n ) => n <= 4 ), `ocean mip kernels write ${ binds.join( ' and ' ) } storage textures (<= 4)` );
	const env = src( 'src/sky/Environment.js' );
	ok( /SH_WG = [^;]*maxComputeWorkgroupStorageSize[^;]*\? 128 : 64/.test( env ) && /array<array<vec3f, 9>, \$\{ SH_WG \}>/.test( env ), 'Env SH: 64 threads (9 KiB) when the device has the default 16 KiB of workgroup memory' );
	const uw = src( 'src/ocean/UnderwaterLighting.js' );
	ok( /dimension: '2d-array'/.test( uw ) && ! /uwWaves0|uwLevel1/.test( uw ), 'underwater light maps: one 2-layer array each (2 sampled textures instead of 4 in every lit shader)' );

}

// ---- 6. timestamp queries are optional (Profiler, Bench)
{

	GPU.device = stubDevice();
	GPU.hasTimestamp = false;
	const { Profiler } = await import( '../src/core/Profiler.js' );
	const p = new Profiler( null, { enabled: true } );
	p.track( 'x', {} );
	ok( ! p.enabled && GPU.device.made.querySets === 0, 'Profiler without timestamp-query: off, no query set' );
	const bench = src( 'src/core/Bench.js' );
	ok( /this\.enabled = GPU\.hasTimestamp;[\s\S]{0,200}if \( ! this\.enabled \) return;[\s\S]{0,80}createQuerySet/.test( bench ), 'Bench: the query set only with timestamp-query' );
	const all = [ 'src/core/Profiler.js', 'src/core/Bench.js' ].map( src ).join( '' );
	ok( ( all.match( /createQuerySet/g ) || [] ).length === 2, 'query sets are made only by the Profiler and the Bench' );

}

// ---- 7. the phone's memory trims
{

	const q = src( 'src/core/Quality.js' );
	ok( /phone: \{[^}]*textureMax: 512/.test( q ), 'phones decode textures at 512 px at most (the roster: 299 -> 75 MB)' );
	const img = capImage( { data: new Uint8Array( 4096 * 2048 * 4 ).fill( 200 ), width: 4096, height: 2048 }, 512 );
	ok( img.width === 512 && img.height === 256 && img.data[ 7 ] === 200, 'capImage: 4096 x 2048 -> 512 x 256, box filtered' );
	ok( capImage( { data: new Uint8Array( 16 ), width: 2, height: 2 }, undefined ).width === 2, 'capImage: no cap (desktop) leaves the image' );
	// at most two images decode at once on a phone
	const { decodeImage } = await import( '../src/engine/loaders/GLTF.js' );
	let now = 0, peak = 0;
	globalThis.__assetImageCap = 512;
	globalThis.__assetImage = async () => {

		now ++;
		peak = Math.max( peak, now );
		await new Promise( ( r ) => setTimeout( r, 5 ) );
		now --;
		return { data: new Uint8Array( 4 ), width: 1, height: 1 };

	};
	await Promise.all( Array.from( { length: 9 }, () => decodeImage( new Uint8Array( 4 ), 'image/png' ) ) );
	ok( peak === 2, `phone: ${ peak } images decoding at once (9 asked)` );
	delete globalThis.__assetImageCap;
	delete globalThis.__assetImage;
	ok( /canvas\.width = Math\.max\( 1, Math\.floor\( w \* dpr \) \)/.test( src( 'src/engine/Engine.js' ) ) && /const dpr = this\.renderScale;/.test( src( 'src/engine/Engine.js' ) ), 'the canvas is CSS pixels x render scale (a 3x phone never renders at its device pixel ratio)' );

}

// ---- 8. visibility: the error card, ?diag, the stage log, a frame that throws
{

	const main = src( 'src/main.js' ), ui = src( 'src/ui/UI.js' ), eng = src( 'src/engine/Engine.js' );
	ok( /showFatal\(/.test( ui ) && /data-a="copy"/.test( ui ) && /export async function showDiagPage/.test( ui ), 'UI: the error card (Copy, Reload, Continue) and the ?diag page' );
	ok( /\[\?&\]diag\\b/.test( main ) && /showDiagPage\(\)/.test( main ), 'main.js: ?diag shows the WebGPU check instead of the game' );
	ok( /GPU\.onError\(/.test( main ) && /unhandledrejection/.test( main ) && /STALL_MS = 45000/.test( main ), 'main.js: GPU errors, rejected promises and a 45 s stall reach the card' );
	ok( /errorLog\.push\( 'stage'/.test( main ) && /hyptile-island\.boot/.test( main ), 'main.js: every stage in the error log and a breadcrumb for a start that killed the tab' );
	ok( /onFrameError/.test( eng ) && /catch \( e \)/.test( eng ), 'Engine: a frame that throws reports and the loop goes on' );
	ok( /try \{ app\.input\.requestLock\(\); \}/.test( main ), 'the start overlay: pointer lock guarded (iOS has none)' );
	const input = src( 'src/core/Input.js' );
	ok( /requestPointerLock\?\.\(\)\?\.catch\?\./.test( input ) && /! el \|\| ! el\.requestFullscreen/.test( input ), 'Input: pointer lock and fullscreen calls are guarded' );

}

// ---- 9. the compile queue (wave 7b: the iPhone stopped at 'Compiling shaders… 113 / 282'): one at a time on phones, each
// named before it starts, a hung compile skipped after the timeout (a late result revives it), the page never waits
{

	const dev = stubDevice();
	let hang = null;
	const order = [];
	dev.createRenderPipelineAsync = ( d ) => {

		order.push( 'start ' + d.label );
		if ( d.label === 'hangs' ) return new Promise( ( r ) => { hang = r; } );
		return new Promise( ( r ) => setTimeout( () => r( { label: d.label } ), 2 ) );

	};
	GPU.device = dev;
	GPU.compileConcurrency = 1;
	GPU.compileTimeout = 60;
	const named = [];
	GPU.onCompileStart = ( label ) => { named.push( label ); order.push( 'named ' + label ); };
	const before = GPU.pipelineStats.timedOut;
	const seen = [];
	const off = GPU.onError( ( e ) => seen.push( e ) );
	const warn = console.error;
	console.error = () => {};
	const hs = [ 'a', 'hangs', 'b', 'c' ].map( ( label ) => GPU.renderPipeline( { label } ) );
	let active = 0;
	const peek = setInterval( () => { active = Math.max( active, GPU._active ); }, 1 );
	const t0 = Date.now();
	await GPU.pipelinesReady();
	clearInterval( peek );
	console.error = warn;
	off();
	ok( named.join() === 'a,hangs,b,c' && order.indexOf( 'named hangs' ) < order.indexOf( 'start hangs' ), 'each pipeline is named before its compile starts (the card and the breadcrumb show the one compiling)' );
	ok( active <= 1, 'phones: one compile at a time' );
	ok( hs[ 1 ].failed && hs[ 1 ].timedOut && ! hs[ 1 ].pipeline && hs[ 0 ].pipeline && hs[ 2 ].pipeline && hs[ 3 ].pipeline, 'a compile that hangs is skipped after the timeout; the next ones still compile' );
	ok( GPU.pipelineStats.timedOut === before + 1 && seen.some( ( e ) => e.kind === 'pipeline' && e.label === 'hangs' && /did not compile within/.test( e.message ) ), 'the timeout reaches the error card, naming the pipeline' );
	ok( Date.now() - t0 < 2000, 'pipelinesReady does not wait for a hung compile' );
	hang( { label: 'late' } );
	await new Promise( ( r ) => setTimeout( r, 5 ) );
	ok( hs[ 1 ].pipeline && ! hs[ 1 ].failed, 'a compile that finishes after its timeout is used from then on' );
	ok( GPU.ready( hs[ 2 ] ) === hs[ 2 ].pipeline, 'ready() returns the compiled pipeline' );
	GPU.onCompileStart = null;
	GPU.compileConcurrency = Infinity;
	GPU.compileTimeout = 30000;
	const main = src( 'src/main.js' );
	ok( /GPU\.compileConcurrency = 1;/.test( main ) && /GPU\.compileTimeout = mobile \? 12000 : 30000;/.test( main ) && /GPU\.lazyPipelines = mobile;/.test( main ), 'main.js: phones / WebKit compile one at a time, 12 s each, the loading frame only what it draws' );
	ok( /crumb\( \{ compiling: label, compileIndex: index \} \)/.test( main ), 'main.js: the pipeline compiling now is in the boot breadcrumb' );
	ok( /const all = this\.precompiling && ! GPU\.lazyPipelines;/.test( src( 'src/engine/render/MeshRenderer.js' ) ), 'MeshRenderer: lazy pipelines precompile only what the view draws' );

}

console.log( fails ? `${ fails } failed` : 'all passed' );
process.exit( fails ? 1 : 0 );

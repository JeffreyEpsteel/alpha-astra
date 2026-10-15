// Plain-node test of the lamps on the sea (wave 10C): the water shader takes the LocalLights block (up to 8 point /
// spot lights, slot 0 = the flashlight) in one loop, skipped by a uniform branch when nothing is lit, the phone
// variant keeps only the glint, the sum is clamped, and the composed WGSL is structurally sound.
// No GPU by default (a stub device); `node test/water-lights.mjs --dawn` also compiles every variant with Dawn.
const DAWN = process.argv.includes( '--dawn' );
if ( DAWN ) await import( './headless.mjs' );
globalThis.GPUShaderStage ??= { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
globalThis.GPUTextureUsage ??= { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 };
globalThis.GPUBufferUsage ??= { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512 };

const { GPU, DEFAULT_LIMITS } = await import( '../src/engine/gpu/GPU.js' );
await import( '../src/engine/render/Frame.js' ); // (registers the frame uniforms of group 0)
if ( DAWN ) await GPU.init( { headless: true } );
else {

	GPU.device = {
		limits: DEFAULT_LIMITS, features: new Set(),
		createBindGroupLayout: ( d ) => d, createPipelineLayout: ( d ) => d,
		createShaderModule: ( d ) => ( { ...d, getCompilationInfo: async () => ( { messages: [] } ) } ),
		createComputePipeline: () => ( {} ), createComputePipelineAsync: async () => ( {} ), createRenderPipelineAsync: async () => ( {} ),
		createSampler: ( d ) => d, createBuffer: ( d ) => ( { ...d, destroy() {} } ), createBindGroup: ( d ) => d,
		createTexture: ( d ) => ( { ...d, destroy() {}, createView: () => ( {} ) } ),
		lost: new Promise( () => {} ), addEventListener() {},
		queue: { writeBuffer() {}, writeTexture() {}, submit() {} },
	};
	GPU.limits = DEFAULT_LIMITS;

}

const { ShaderModule, composeShader } = await import( '../src/engine/gpu/Shader.js' );
const { buildMeshShader } = await import( '../src/engine/render/MeshShader.js' );
const { OceanFFT } = await import( '../src/ocean/OceanFFT.js' );
const { CDLOD } = await import( '../src/core/CDLOD.js' );
const { WaterSurface } = await import( '../src/ocean/WaterSurface.js' );
const { WaterMaterial } = await import( '../src/ocean/WaterMaterial.js' );
const { Texture } = await import( '../src/engine/gpu/Texture.js' );
const { setShadowMap } = await import( '../src/engine/render/wgsl/lighting.js' );

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};

const sky = { module: new ShaderModule( { name: 'skyStubLamps', code: /* wgsl */`
fn skyRadiance( dir: vec3f, withSun: bool ) -> vec3f { return mix( vec3f( 0.8, 0.9, 1.0 ), vec3f( 0.2, 0.35, 0.8 ), clamp( dir.y, 0.0, 1.0 ) ); }
fn skyRadianceWithClouds( dir: vec3f, withSun: bool ) -> vec3f { return skyRadiance( dir, withSun ); }
fn skyReflectionRadiance( dir: vec3f ) -> vec3f { return skyRadiance( dir, false ); }
` } ) };
const fft = new OceanFFT( null );
const cdlod = new CDLOD( { gridSize: 32, leafSize: 8, levels: 12, minY: - 25, maxY: 25 } );
// textures are only described here (created lazily on the device)
const tex = new Texture( { width: 4, height: 4, format: 'rgba16float' } );
const depthTex = new Texture( { width: 4, height: 4, format: 'depth32float' } );
const foamTexture = new Texture( { width: 4, height: 4, format: 'rgba16float', mips: true } );
setShadowMap( new Texture( { width: 4, height: 4, depth: 4, dimension: '2d-array', format: 'depth32float' } ) );
const layout = [ { name: 'position', wgsl: 'vec3f', location: 0 }, { name: 'nodeData', wgsl: 'vec4f', location: 1, instanced: true } ];

function compose( setup ) {

	const surface = new WaterSurface( { fft, cdlod, foamTexture } );
	const wm = new WaterMaterial( { surface, sky, sceneCopy: { texture: tex, depthTexture: depthTex } } );
	setup( wm );
	wm.pipelineKey(); // builds the WGSL
	const src = buildMeshShader( wm, layout, { kind: 'main', late: true } );
	return composeShader( { modules: src.modules, bindings: src.bindings, code: src.code, defines: src.defines, stage: 'render', label: 'water-lights' } );

}

// structural checks: balanced brackets outside comments, no preprocessor left, every called helper defined
function structure( code, label ) {

	const body = code.replace( /\/\/[^\n]*/g, '' );
	const count = ( ch ) => body.split( ch ).length - 1;
	ok( count( '{' ) === count( '}' ) && count( '(' ) === count( ')' ) && count( '[' ) === count( ']' ), `${ label }: braces, parentheses and brackets balance` );
	ok( ! /^\s*#(if|else|endif)/m.test( body ), `${ label }: no preprocessor lines left` );
	for ( const f of [ 'waterLocalLights', 'waterLampClamp', 'localLightsSpotProfile', '_waterDGGX', '_waterVSmithGGX', 'fresnelDielectric' ] ) {

		if ( new RegExp( `\\b${ f }\\s*\\(` ).test( body.replace( new RegExp( `fn\\s+${ f }\\b`, 'g' ), '' ) ) ) ok( new RegExp( `fn\\s+${ f }\\s*\\(` ).test( body ), `${ label }: ${ f } is defined where it is called` );

	}

}

async function dawnCompile( code, label ) {

	if ( ! DAWN ) return;
	const m = GPU.device.createShaderModule( { code, label } );
	const info = await m.getCompilationInfo();
	const errs = info.messages.filter( ( x ) => x.type === 'error' );
	if ( errs.length ) console.log( errs.map( ( e ) => `${ e.lineNum }:${ e.linePos } ${ e.message }` ).join( '\n' ) );
	ok( errs.length === 0, `${ label }: Dawn compiles the water shader` );

}

const saved = globalThis.__phoneBudget;

// ---- 1. desktop: the full loop, both media
{

	globalThis.__phoneBudget = null;
	const c = compose( () => {} );
	const code = c.code;
	const fnBody = ( code.match( /fn waterLocalLights\([\s\S]*?\n}\n/ ) || [ '' ] )[ 0 ];
	ok( fnBody.length > 0, 'waterLocalLights is in the composed water shader' );
	ok( /for \( var i = 0; i < n; i\+\+ \)/.test( fnBody ) && /min\( localLights\.count, 16 \)/.test( fnBody ), 'a single loop over at most 16 lights from the localLights block' );
	ok( ( fnBody.match( /\bfor\s*\(/g ) || [] ).length === 1, 'exactly one loop' );
	ok( /if \( localLights\.count <= 0 && localLights\.flashOn < 0\.5 \) \{ return o; \}/.test( fnBody ), 'uniform early-out: no lamp lit and the flashlight off' );
	ok( /localLights\.pos\[ i \]/.test( fnBody ) && /localLights\.col\[ i \]/.test( fnBody ) && /localLights\.dir\[ i \]/.test( fnBody ), 'reads pos / col / dir of the block' );
	ok( /localLightsSpotProfile\( dot\( - L, sd\.xyz \), c\.w, sd\.w \)/.test( fnBody ), 'flashlight / spot cone through localLightsSpotProfile' );
	ok( /sat\( 1\.0 - x \* x \)/.test( fnBody ) && /d2 \+ 0\.15/.test( fnBody ), 'smooth range window and the inverse-square falloff of lighting.js' );
	ok( /\( NdL \* 0\.5 \+ 0\.5 \) \* WATER_LAMP_WRAP/.test( fnBody ), 'wrapped diffuse on the wave normal' );
	ok( /_waterDGGX\( NdH, a2 \) \* _waterVSmithGGX\( NdL, NdV, a2 \) \* fresnelDielectric\( VdH/.test( fnBody ) && /max\( alpha2, WATER_LAMP_A2_MIN \)/.test( fnBody ), 'GGX glint with a roughness floor' );
	ok( /fn waterLampClamp\(/.test( code ) && /2\.0 \* max\( dot\( skyTerm/.test( code ), 'the lamp sum is clamped to ~2x the sky / key light term' );
	ok( /waterLocalLights\( pos, N, V, alpha2 \)/.test( code ) && /lampLit = waterLampClamp\(/.test( code ), 'above water: lamps after the sun / sky terms' );
	ok( /waterLocalLights\( pos, - N, Td, alpha2 \)/.test( code ) && /0\.3 \* \( 1\.0 - F \)/.test( code ), 'below water: the lamps light the surface from below at 0.3x' );
	ok( c.bindings.names.includes( 'localLights' ), 'the localLights uniform block is bound to the water pipeline' );
	ok( c.bindings.names.includes( 'mat' ) && /lampTint/.test( code ), 'lampTint in the material block' );
	ok( ! /fn hookLocalLights[^{]*\{[^}]*for \(/.test( code ), 'the standard hook stays compiled out for the water (IS_WATER)' );
	structure( code, 'desktop' );
	await dawnCompile( code, 'desktop' );

}

// ---- 2. phone: the loop with the glint only
{

	globalThis.__phoneBudget = { marine: true };
	const code = compose( () => {} ).code;
	const fnBody = ( code.match( /fn waterLocalLights\([\s\S]*?\n}\n/ ) || [ '' ] )[ 0 ];
	ok( /for \( var i = 0; i < n; i\+\+ \)/.test( fnBody ) && ! /o\.diffuse \+=/.test( fnBody ) && /o\.spec \+=/.test( fnBody ), 'phone: same loop, specular term only' );
	structure( code, 'phone' );
	await dawnCompile( code, 'phone' );

}

// ---- 3. switched off: no lamp code, no localLights binding
{

	globalThis.__phoneBudget = null;
	const c = compose( ( wm ) => { wm.localLights = false; } );
	ok( ! /waterLocalLights\(/.test( c.code ) && ! c.bindings.names.includes( 'localLights' ), 'material.localLights = false: no lamp code or binding' );
	structure( c.code, 'off' );
	await dawnCompile( c.code, 'off' );

}

globalThis.__phoneBudget = saved;
console.log( fails ? `${ fails } FAILED` : 'all ok' );
process.exit( fails ? 1 : 0 );

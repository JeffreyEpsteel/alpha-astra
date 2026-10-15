// The WebGPU device and the per-frame command encoder.
//
// Everything GPU-side goes through this singleton: `GPU.device`, `GPU.queue`, the shared samplers
// and `GPU.encoder` (one command encoder per frame, submitted by `GPU.submit()`). Systems record
// their compute dispatches and render passes into the current encoder in call order.
//
// Ordering note: queue.writeBuffer() calls land before the frame's command buffer runs, so a buffer
// range written twice in one frame keeps only the last value for every pass. Anything that changes
// between passes of a frame needs its own buffer (or its own offset).

// The WebGPU spec's default limits: what every adapter offers and what Safari / Chrome on iOS
// (WebKit) often report as adapter.limits. ?limits=default (and tools/perf/headless.mjs --limits=default)
// requests a device with exactly these, so a desktop run fails where a phone would.
export const DEFAULT_LIMITS = {
	maxTextureDimension1D: 8192, maxTextureDimension2D: 8192, maxTextureDimension3D: 2048, maxTextureArrayLayers: 256,
	maxBindGroups: 4, maxBindGroupsPlusVertexBuffers: 24, maxBindingsPerBindGroup: 1000,
	maxDynamicUniformBuffersPerPipelineLayout: 8, maxDynamicStorageBuffersPerPipelineLayout: 4,
	maxSampledTexturesPerShaderStage: 16, maxSamplersPerShaderStage: 16, maxStorageBuffersPerShaderStage: 8,
	maxStorageTexturesPerShaderStage: 4, maxUniformBuffersPerShaderStage: 12,
	maxUniformBufferBindingSize: 65536, maxStorageBufferBindingSize: 134217728,
	minUniformBufferOffsetAlignment: 256, minStorageBufferOffsetAlignment: 256,
	maxVertexBuffers: 8, maxBufferSize: 268435456, maxVertexAttributes: 16, maxVertexBufferArrayStride: 2048,
	maxInterStageShaderVariables: 16, maxColorAttachments: 8, maxColorAttachmentBytesPerSample: 32,
	maxComputeWorkgroupStorageSize: 16384, maxComputeInvocationsPerWorkgroup: 256,
	maxComputeWorkgroupSizeX: 256, maxComputeWorkgroupSizeY: 256, maxComputeWorkgroupSizeZ: 64, maxComputeWorkgroupsPerDimension: 65535,
};

// what the engine asks for above the defaults (each clamped to the adapter: requestDevice rejects anything higher);
// every system must still work with the defaults (test/feature-ios.mjs, engine-smoke --limits=default)
export const WANT_LIMITS = {
	maxSampledTexturesPerShaderStage: 32,
	maxSamplersPerShaderStage: 16,
	maxStorageBuffersPerShaderStage: 10,
	maxStorageTexturesPerShaderStage: 8,
	maxComputeWorkgroupStorageSize: 32768,
	maxColorAttachmentBytesPerSample: 64,
	maxStorageBuffersInVertexStage: 4,
	maxStorageBuffersInFragmentStage: 8,
	maxStorageTexturesInFragmentStage: 4,
	maxBindingsPerBindGroup: 1000,
	maxBufferSize: 1024 * 1024 * 1024,
	maxStorageBufferBindingSize: 512 * 1024 * 1024,
};

export const OPTIONAL_FEATURES = [ 'float32-filterable', 'timestamp-query', 'rg11b10ufloat-renderable', 'float32-blendable', 'shader-f16', 'clip-distances' ];

const _search = () => ( typeof location !== 'undefined' && location && location.search ) || '';

// the device limits to request: WANT_LIMITS (plus extra) clamped to the adapter, only those above the defaults
export function clampLimits( adapterLimits, extra = {} ) {

	const want = { ...WANT_LIMITS, ...extra };
	const out = {};
	for ( const k in want ) {

		const have = adapterLimits[ k ];
		if ( typeof have !== 'number' ) continue;
		const v = Math.min( want[ k ], have );
		if ( DEFAULT_LIMITS[ k ] === undefined || v > DEFAULT_LIMITS[ k ] ) out[ k ] = v;

	}

	return out;

}

// bytes of a texture descriptor (all mips and layers; formats not in the table count 4 bytes a texel)
export function textureBytes( d ) {

	const s = d.size || {};
	const arr = Array.isArray( s ) || ( s && typeof s.length === 'number' );
	const w = ( arr ? s[ 0 ] : s.width ) || 1, h = ( arr ? s[ 1 ] : s.height ) || 1;
	const z = ( arr ? s[ 2 ] : s.depthOrArrayLayers ) || 1;
	const bpp = ( FORMAT_INFO[ d.format ] || { bytes: 4 } ).bytes * ( d.sampleCount || 1 );
	const is3d = d.dimension === '3d';
	let total = 0;
	for ( let m = 0; m < ( d.mipLevelCount || 1 ); m ++ ) total += Math.max( 1, w >> m ) * Math.max( 1, h >> m ) * ( is3d ? Math.max( 1, z >> m ) : z ) * bpp;
	return total;

}

export const GPU = {

	device: null,
	queue: null,
	adapter: null,
	adapterInfo: null,
	context: null,
	canvas: null,
	format: 'bgra8unorm',
	features: new Set(),
	limits: null,
	requestedLimits: null, // the clamped set asked of requestDevice
	limitsMode: 'adapter', // 'default': the spec defaults only (?limits=default)
	hasTimestamp: false,
	hasFloat32Filterable: false,
	encoder: null,
	frame: 0,
	samplers: null,
	_submitHooks: [],
	// GPU allocation totals (createBuffer / createTexture sizes minus destroyed ones; the canvas is not counted)
	memory: { buffers: 0, textures: 0, bufferCount: 0, textureCount: 0, peak: 0, get total() { return this.buffers + this.textures; } },
	// device / pipeline / shader / validation errors for the on-screen error card (main.js): fn( { kind, message, label } )
	_errorFns: new Set(),
	errors: [],

	onError( fn ) {

		this._errorFns.add( fn );
		return () => this._errorFns.delete( fn );

	},

	reportError( kind, message, label = '' ) {

		const e = { kind, message: String( message || '' ), label, frame: this.frame, t: Date.now() };
		this.errors.push( e );
		if ( this.errors.length > 40 ) this.errors.shift();
		for ( const fn of this._errorFns ) {

			try { fn( e ); } catch ( err ) { /* the reporter must never throw into the GPU path */ }

		}

	},

	// limits: 'adapter' | 'default' (null: ?limits=default in the URL picks it); features: 'auto' | 'none' (?features=none)
	async init( { canvas = null, requiredLimits = {}, headless = false, limits: limitsMode = null, features: featureMode = null } = {} ) {

		if ( typeof navigator === 'undefined' || ! navigator.gpu ) throw new Error( 'WebGPU is not available in this browser.' );
		// Safari may return null (or throw) for 'high-performance': retry without options
		let adapter = null;
		try { adapter = await navigator.gpu.requestAdapter( { powerPreference: 'high-performance' } ); } catch ( e ) { adapter = null; }
		if ( ! adapter ) {

			try { adapter = await navigator.gpu.requestAdapter(); } catch ( e ) { adapter = null; }

		}

		if ( ! adapter ) throw new Error( 'No WebGPU adapter found.' );
		this.adapter = adapter;
		this.adapterInfo = adapter.info || null;
		if ( ! this.adapterInfo && typeof adapter.requestAdapterInfo === 'function' ) {

			try { this.adapterInfo = await adapter.requestAdapterInfo(); } catch ( e ) { /* older browsers only */ }

		}

		const search = _search();
		this.limitsMode = limitsMode || ( /[?&]limits=default\b/.test( search ) ? 'default' : 'adapter' );
		const limits = this.limitsMode === 'default' ? {} : clampLimits( adapter.limits, requiredLimits );
		this.requestedLimits = limits;

		const noFeatures = ( featureMode || ( /[?&]features=none\b/.test( search ) ? 'none' : 'auto' ) ) === 'none';
		// (skipFeatures: optional features a platform's driver advertises but cannot build pipelines with; main.js fills it)
		const requiredFeatures = noFeatures ? [] : OPTIONAL_FEATURES.filter( ( f ) => adapter.features.has( f ) && ! this.skipFeatures.has( f ) );
		this.features = new Set( requiredFeatures );
		this.hasTimestamp = this.features.has( 'timestamp-query' );
		this.hasFloat32Filterable = this.features.has( 'float32-filterable' );

		let device;
		try {

			device = await adapter.requestDevice( { requiredFeatures, requiredLimits: limits } );

		} catch ( e ) {

			// a limit the adapter lists but the device refuses: the spec defaults always work
			console.warn( 'requestDevice with limits failed, retrying with the defaults:', e && e.message );
			this.requestedLimits = {};
			device = await adapter.requestDevice( { requiredFeatures } );

		}

		this.device = device;
		this.queue = device.queue;
		this.limits = device.limits;
		this._countAllocations( device );
		device.lost.then( ( info ) => {

			console.error( 'WebGPU device lost:', info.reason || '', info.message );
			// 'destroyed' is an own device.destroy() (the game never calls it): anything else ends the game
			if ( info.reason !== 'destroyed' ) this.reportError( 'lost', `The GPU device was lost (${ info.reason || 'unknown' }): ${ info.message || '' }` );

		} );
		if ( device.addEventListener ) device.addEventListener( 'uncapturederror', ( e ) => {

			const err = e.error || {};
			const kind = typeof GPUOutOfMemoryError !== 'undefined' && err instanceof GPUOutOfMemoryError ? 'out-of-memory'
				: typeof GPUValidationError !== 'undefined' && err instanceof GPUValidationError ? 'validation'
					: typeof GPUInternalError !== 'undefined' && err instanceof GPUInternalError ? 'internal' : 'error';
			const msg = String( err.message || err ).split( '\n' ).slice( 0, 6 ).join( '\n' );
			console.error( 'WebGPU:', msg );
			this.reportError( kind, msg );

		} );

		if ( canvas && ! headless ) {

			this.canvas = canvas;
			this.context = canvas.getContext( 'webgpu' );
			if ( ! this.context ) throw new Error( 'The canvas has no WebGPU context.' );
			this.format = navigator.gpu.getPreferredCanvasFormat();
			this.context.configure( { device, format: this.format, alphaMode: 'opaque', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST } );

		}

		this._createSamplers();
		return this;

	},

	// Sum what createBuffer / createTexture allocate (destroy() subtracts): GPU.memory, the phone budget, and the live
	// totals per label (digits folded: 'char12' -> 'char#'; no references to the objects) for GPU.memTop().
	_countAllocations( device ) {

		const mem = this.memory;
		const sizes = this._sizes = new WeakMap();
		const byLabel = this._byLabel = new Map();
		const cb = device.createBuffer, ct = device.createTexture;
		const add = ( key, n, obj, label ) => {

			mem[ key ] += n;
			if ( mem.total > mem.peak ) mem.peak = mem.total;
			const k = ( key === 'buffers' ? 'buffer ' : 'texture ' ) + String( label || '(no label)' ).replace( /\d+/g, '#' ).slice( 0, 60 );
			const e = byLabel.get( k ) || { n: 0, c: 0 };
			e.n += n;
			e.c ++;
			byLabel.set( k, e );
			sizes.set( obj, { key, n, k } );

		};

		try {

			device.createBuffer = function ( d ) {

				const b = cb.call( this, d );
				add( 'buffers', ( d && d.size ) || 0, b, d && d.label );
				mem.bufferCount ++;
				return b;

			};

			device.createTexture = function ( d ) {

				const t = ct.call( this, d );
				add( 'textures', textureBytes( d || {} ), t, d && d.label );
				mem.textureCount ++;
				return t;

			};

			for ( const C of [ globalThis.GPUBuffer, globalThis.GPUTexture ] ) {

				if ( ! C || ! C.prototype || C.prototype.__hiCounted ) continue;
				const destroy = C.prototype.destroy;
				C.prototype.destroy = function () {

					const s = GPU._sizes && GPU._sizes.get( this );
					if ( s ) {

						GPU._sizes.delete( this );
						mem[ s.key ] -= s.n;
						mem[ s.key === 'buffers' ? 'bufferCount' : 'textureCount' ] --;
						const e = GPU._byLabel.get( s.k );
						if ( e ) { e.n -= s.n; e.c --; if ( e.c <= 0 ) GPU._byLabel.delete( s.k ); }

					}

					return destroy.call( this );

				};

				C.prototype.__hiCounted = true;

			}

		} catch ( e ) {

			console.warn( 'GPU allocation counter unavailable', e );

		}

	},

	// the biggest live allocations: [ { label: 'texture char#', mb, count } ] (kind: 'texture' | 'buffer' | null for both)
	memTop( count = 5, kind = null ) {

		if ( ! this._byLabel ) return [];
		return [ ...this._byLabel ].filter( ( [ k ] ) => ! kind || k.startsWith( kind ) ).sort( ( a, b ) => b[ 1 ].n - a[ 1 ].n ).slice( 0, count )
			.map( ( [ label, e ] ) => ( { label, mb: Math.round( e.n / 104857.6 ) / 10, count: e.c } ) );

	},

	memTopText( count = 25, kind = null ) {

		return this.memTop( count, kind ).map( ( e ) => `  ${ e.mb.toFixed( 1 ).padStart( 7 ) } MB  x${ e.count }  ${ e.label }` ).join( '\n' );

	},

	// adapter, features, limits and memory as text (the error card and ?diag)
	describe() {

		const i = this.adapterInfo || {};
		const mb = ( n ) => ( n / 1048576 ).toFixed( 1 ) + ' MB';
		const m = this.memory;
		const lines = [
			`adapter: ${ [ i.vendor, i.architecture, i.device, i.description ].filter( Boolean ).join( ' · ' ) || 'unknown' }`,
			`features: ${ [ ...this.features ].join( ', ' ) || 'none' }`,
			`limits: ${ this.limitsMode }${ this.requestedLimits ? ' · asked ' + JSON.stringify( this.requestedLimits ) : '' }`,
			`GPU memory: ${ mb( m.total ) } (buffers ${ mb( m.buffers ) } in ${ m.bufferCount }, textures ${ mb( m.textures ) } in ${ m.textureCount }; peak ${ mb( m.peak ) })`,
		];
		if ( this.canvas ) lines.push( `canvas: ${ this.canvas.width }x${ this.canvas.height } ${ this.format }` );
		return lines.join( '\n' );

	},

	_createSamplers() {

		const d = this.device;
		const s = ( desc ) => d.createSampler( desc );
		const lin = { magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear' };
		this.samplers = {
			linearRepeat: s( { ...lin, addressModeU: 'repeat', addressModeV: 'repeat', addressModeW: 'repeat' } ),
			linearClamp: s( { ...lin, addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' } ),
			linearMirror: s( { ...lin, addressModeU: 'mirror-repeat', addressModeV: 'mirror-repeat', addressModeW: 'mirror-repeat' } ),
			anisoRepeat: s( { ...lin, addressModeU: 'repeat', addressModeV: 'repeat', addressModeW: 'repeat', maxAnisotropy: 8 } ),
			// 4x: the terrain detail texture (grazing views of the beach; 8x costs ~0.5 ms more at 1440p)
			aniso4Repeat: s( { ...lin, addressModeU: 'repeat', addressModeV: 'repeat', addressModeW: 'repeat', maxAnisotropy: 4 } ),
			anisoClamp: s( { ...lin, addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', maxAnisotropy: 8 } ),
			nearestClamp: s( { magFilter: 'nearest', minFilter: 'nearest', mipmapFilter: 'nearest', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' } ),
			nearestRepeat: s( { magFilter: 'nearest', minFilter: 'nearest', mipmapFilter: 'nearest', addressModeU: 'repeat', addressModeV: 'repeat', addressModeW: 'repeat' } ),
			shadow: s( { magFilter: 'linear', minFilter: 'linear', compare: 'less', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' } ),
		};

	},

	// Start recording a frame. Anything recorded before the first beginFrame() also works: the
	// encoder is created on demand.
	beginFrame() {

		this.frame ++;
		return this.getEncoder();

	},

	getEncoder() {

		if ( ! this.encoder ) this.encoder = this.device.createCommandEncoder();
		return this.encoder;

	},

	// Submit everything recorded so far. Hooks run right after the submit (readback mapping).
	submit() {

		if ( ! this.encoder ) return;
		const hooks = this._submitHooks;
		this._submitHooks = [];
		for ( const h of hooks ) if ( h.before ) h.before( this.encoder );
		this.queue.submit( [ this.encoder.finish() ] );
		this.encoder = null;
		for ( const h of hooks ) if ( h.after ) h.after();

	},

	onSubmit( before, after ) {

		this._submitHooks.push( { before, after } );

	},

	// ---- pipelines
	// Pipelines compile asynchronously: the browser compiles them in parallel on worker threads, and a
	// pipeline created synchronously would stall the GPU process (and with it the page) at first use.
	// Handles are { pipeline, label }; `pipeline` is null until the compile finishes. Users that must
	// run this frame (compute, post) call ready( handle ), which falls back to a synchronous create.
	skipFeatures: new Set(), // optional features not to request (see requestDevice)
	_pending: new Set(),
	syncCompiles: [], // labels of pipelines needed before their async compile finished (diagnostics)
	// compile progress for the loader and the error card: started = the pipeline(s) compiling NOW (a hang names its culprit)
	pipelineStats: { requested: 0, done: 0, failed: 0, timedOut: 0, last: '', started: '', startedAt: 0, active: new Set() },
	// How many compiles run at once (Infinity: all at once, the desktop browsers' worker threads) and how long one may take
	// before it is skipped (failed, non-fatal; a late result still revives it). main.js sets 1 / 12 s on phones and WebKit:
	// on an iPhone the loader stopped at 'Compiling shaders… 113 / 282' with nothing moving (wave 7).
	compileConcurrency: Infinity,
	compileTimeout: 30000,
	// phones (main.js): the loading frame compiles only the mesh pipelines its view draws; the rest when first in view
	lazyPipelines: false,
	onCompileStart: null, // ( label, index, desc ) before each compile starts (main.js: the boot breadcrumb)
	onCompileEnd: null, // ( label, index, handle ) when it finished, failed or timed out
	moduleSource: new WeakMap(), // GPUShaderModule -> WGSL (Shader.js; sizes for --trace-compile)
	_queue: [],
	_active: 0,
	_compileIndex: 0,

	renderPipeline( desc ) {

		return this._async( desc, 'render' );

	},

	computePipeline( desc ) {

		return this._async( desc, 'compute' );

	},

	_async( desc, kind ) {

		const h = { pipeline: null, label: desc.label, desc, kind, failed: false, index: this.pipelineStats.requested };
		this.pipelineStats.requested ++;
		let resolve;
		const p = new Promise( ( r ) => { resolve = r; } ).finally( () => this._pending.delete( p ) );
		this._pending.add( p );
		this._queue.push( { h, resolve } );
		// started after the current task: a kernel dispatched right after it was made (a one-off bake) compiles once,
		// synchronously, instead of twice
		Promise.resolve().then( () => this._pump() );
		return h;

	},

	_pump() {

		while ( this._active < this.compileConcurrency && this._queue.length ) this._compile( this._queue.shift() );

	},

	_compile( { h, resolve } ) {

		const st = this.pipelineStats;
		const label = h.label || '';
		const finish = () => {

			st.done ++;
			st.last = label;
			st.active.delete( h );
			if ( this.onCompileEnd ) try { this.onCompileEnd( label, h.index, h ); } catch ( e ) { /* diagnostics only */ }
			this._active --;
			resolve();
			// one macrotask between compiles when they are queued: the page (the loader, the stall timer) keeps running
			if ( this._queue.length ) {

				if ( this.compileConcurrency === Infinity ) this._pump();
				else setTimeout( () => this._pump(), 0 );

			}

		};

		this._active ++;
		st.active.add( h );
		if ( h.pipeline ) { finish(); return; } // compiled synchronously meanwhile (ready())
		st.started = label;
		st.startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
		this._compileIndex ++;
		if ( this.onCompileStart ) try { this.onCompileStart( label, h.index, h.desc ); } catch ( e ) { /* diagnostics only */ }
		const desc = h.desc;
		const create = h.kind === 'render' ? this.device.createRenderPipelineAsync : this.device.createComputePipelineAsync;
		let settled = false, timer = 0;
		const ms = this.compileTimeout;
		if ( ms > 0 && ms < Infinity ) timer = setTimeout( () => {

			if ( settled ) return;
			settled = true;
			h.failed = true;
			h.timedOut = true;
			st.failed ++;
			st.timedOut ++;
			const msg = `did not compile within ${ ( ms / 1000 ).toFixed( 0 ) } s: skipped (#${ h.index } of the compile queue)`;
			console.error( `WebGPU: pipeline "${ label }" ${ msg }` );
			this.reportError( 'pipeline', msg, label );
			finish();

		}, ms );
		let started;
		try { started = create.call( this.device, desc ); } catch ( e ) { started = Promise.reject( e ); }
		Promise.resolve( started ).then( ( pipeline ) => {

			// a compile that finished after its timeout still counts: the pass works again from the next frame
			if ( h.timedOut ) { h.pipeline = pipeline; h.failed = false; return; }
			if ( settled ) return;
			settled = true;
			clearTimeout( timer );
			if ( ! h.pipeline ) h.pipeline = pipeline;
			h.desc = null;
			finish();

		}, ( e ) => {

			if ( settled ) return;
			settled = true;
			clearTimeout( timer );
			h.failed = true;
			st.failed ++;
			const msg = String( ( e && e.message ) || e ).split( '\n' ).slice( 0, 6 ).join( '\n' );
			console.error( `WebGPU: pipeline "${ label }" failed: ${ msg }` );
			this.reportError( 'pipeline', msg, label );
			finish();

		} );

	},

	// the pipeline now (synchronous compile when the async one has not finished)
	ready( h ) {

		if ( h.pipeline || h.failed ) return h.pipeline;
		this.syncCompiles.push( h.label );
		try {

			h.pipeline = h.kind === 'render' ? this.device.createRenderPipeline( h.desc ) : this.device.createComputePipeline( h.desc );

		} catch ( e ) {

			h.failed = true;
			this.reportError( 'pipeline', String( ( e && e.message ) || e ), h.label );

		}

		return h.pipeline;

	},

	// resolves when every pipeline requested so far has compiled
	async pipelinesReady() {

		while ( this._pending.size ) await Promise.all( [ ...this._pending ] );

	},

	// A compute or render pass on the frame encoder.
	computePass( label, fn, timestampWrites ) {

		const pass = this.getEncoder().beginComputePass( { label, timestampWrites } );
		fn( pass );
		pass.end();

	},

};

// Texture format helpers ------------------------------------------------------------------------

const FORMAT_INFO = {
	r8unorm: { bytes: 1, sample: 'float' },
	rg8unorm: { bytes: 2, sample: 'float' },
	rgba8unorm: { bytes: 4, sample: 'float' },
	'rgba8unorm-srgb': { bytes: 4, sample: 'float' },
	bgra8unorm: { bytes: 4, sample: 'float' },
	r16float: { bytes: 2, sample: 'float' },
	rg16float: { bytes: 4, sample: 'float' },
	rgba16float: { bytes: 8, sample: 'float' },
	rg11b10ufloat: { bytes: 4, sample: 'float' },
	r32float: { bytes: 4, sample: 'unfilterable-float' },
	rg32float: { bytes: 8, sample: 'unfilterable-float' },
	rgba32float: { bytes: 16, sample: 'unfilterable-float' },
	r32uint: { bytes: 4, sample: 'uint' },
	rg32uint: { bytes: 8, sample: 'uint' },
	rgba32uint: { bytes: 16, sample: 'uint' },
	r32sint: { bytes: 4, sample: 'sint' },
	r8uint: { bytes: 1, sample: 'uint' },
	rgba8uint: { bytes: 4, sample: 'uint' },
	depth32float: { bytes: 4, sample: 'depth' },
	depth24plus: { bytes: 4, sample: 'depth' },
	'depth24plus-stencil8': { bytes: 4, sample: 'depth' },
};

export function formatInfo( format ) {

	const i = FORMAT_INFO[ format ];
	if ( ! i ) throw new Error( 'Unknown texture format ' + format );
	return i;

}

// sample type of a format for bind group layouts (32-bit float formats are filterable with the feature)
export function sampleTypeOf( format ) {

	const t = formatInfo( format ).sample;
	if ( t === 'unfilterable-float' && GPU.hasFloat32Filterable ) return 'float';
	return t;

}

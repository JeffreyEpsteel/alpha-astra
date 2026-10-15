import { PlaneGeometry, Mesh } from '../engine/index.js';
import { GPU, Texture, StorageBuffer, ShaderModule, Material, generateMipmaps, commonModule } from '../engine/webgpu.js';
import { LAYERS } from '../core/SceneRenderer.js';
import { STRIDE } from '../features/vfx/VfxPool.js';
import { buildVfxAtlas, ATLAS_GRID } from './VfxAtlas.js';

// GPU side of the VFX set (src/features/vfx): one instanced draw of camera-facing quads whose spawn state lives in
// a storage buffer (VfxPool's Float32Array mirror, uploaded in coalesced dirty runs; nothing per particle per
// frame). The vertex shader moves each particle in closed form from its spawn state (VfxPool.motionAt is the CPU
// twin: gravity / buoyancy and drag toward the wind), lands or kills it on its floor, sizes, orients and lights it.
//
// Looks (VfxPool.LOOK): SMOKE and WATER are alpha-blended and lit by the sun and the sky (smoke may carry a fire
// glow from below), SOLID (splinters, chunks) is lit with the atlas bevel, GLOW (flashes, flames, embers) is pure
// addition: premultiplied blending with alpha 0, so both kinds share one pipeline and one draw. Orientations:
// BILLBOARD (rotating), STREAK (stretched along the motion), FLAT (lying on the water, its corners riding the waves
// when the water query is there) and UPRIGHT (a vertical sheet facing the camera: splash columns, flames).
// Soft intersections against the opaque depth copy, a far fade, a light haze toward the horizon colour; radiance in
// scene units like the rest of the late pass (exposure is applied by the post chain).
//
//   const fx = new VfxParticles( { pool, query, sceneCopy } ); scene.add( fx.mesh );
//   fx.sync();   once per frame after the spawns: uploads the dirty slots, sets the clock and the instance count

const fl = ( x ) => {

	const s = String( x );
	return /[.e]/.test( s ) ? s : s + '.0';

};

export class VfxParticles {

	constructor( { pool, query = null, sceneCopy = null, maxDistance = 900 } = {} ) {

		this.pool = pool;
		this.buffer = new StorageBuffer( { label: 'vfxParticles', count: pool.capacity * ( STRIDE / 4 ), type: 'vec4f' } );
		const atlas = buildVfxAtlas();
		this.atlas = new Texture( { label: 'vfxAtlas', width: atlas.size, height: atlas.size, format: 'rgba8unorm', mips: true, usage: [ 'sample', 'copyDst', 'render' ], data: atlas.data, sampler: 'linearClamp' } );
		this.atlas.getGPU();
		generateMipmaps( this.atlas );

		const hasQuery = !! ( query && query.module );
		const soft = !! ( sceneCopy && sceneCopy.depthTexture );
		const waterAt = ( xz ) => hasQuery ? `waterQueryHeightAtXZ( ${ xz } )` : 'frame.seaLevel';
		const G = fl( 1 / ATLAS_GRID );

		const helpers = new ShaderModule( {
			name: 'vfxCommon',
			deps: [ commonModule ],
			code: /* wgsl */`
// position after t seconds: dv/dt = acc - k v  (see VfxPool.motionAt)
fn vfxPos( p0: vec3f, v0: vec3f, acc: vec3f, k: f32, t: f32 ) -> vec3f {
	let kt = k * t;
	var E1: f32;
	var G2: f32;
	if ( kt < 0.01 ) {
		E1 = t - k * t * t * 0.5 + k * k * t * t * t / 6.0;
		G2 = t * t * 0.5 - k * t * t * t / 6.0;
	} else {
		E1 = ( 1.0 - exp( - kt ) ) / k;
		G2 = ( t - E1 ) / k;
	}
	return p0 + v0 * E1 + acc * G2;
}
fn vfxVel( v0: vec3f, acc: vec3f, k: f32, t: f32 ) -> vec3f {
	let kt = k * t;
	let E1 = select( ( 1.0 - exp( - kt ) ) / max( k, 1e-6 ), t, kt < 1e-4 );
	return v0 * exp( - kt ) + acc * E1;
}
// Henyey-Greenstein phase (1/sr)
fn vfxPhase( cosT: f32, g: f32 ) -> f32 { return ( ( 1.0 - g * g ) / ( 4.0 * PI ) ) / pow( max( 1.0 + g * g - cosT * 2.0 * g, 1e-4 ), 1.5 ); }
`,
		} );

		const textures = { vfxAtlas: this.atlas };
		if ( soft ) textures.vfxSceneDepth = { texture: () => sceneCopy.depthTexture };

		const mat = new Material( {
			name: 'VfxParticles',
			modules: hasQuery ? [ helpers, query.module ] : [ helpers ],
			lit: false,
			transparent: true,
			depthWrite: false,
			depthTest: true,
			side: 'double',
			blending: 'premultiplied',
			underwaterLighting: 'none',
			receiveShadows: false,
			defines: { VFX_SOFT: soft ? 1 : 0 },
			uniforms: {
				now: [ 'f32', 0 ], // the pool clock (s)
				intensity: [ 'f32', 1 ],
				maxDistance: [ 'f32', maxDistance ],
				haze: [ 'f32', 1 / 1800 ], // 1/m: how fast far particles take the horizon colour
			},
			storage: { vfxData: this.buffer },
			textures,
			varyings: {
				vUV: 'vec2f',
				vCol: 'vec4f', // radiance (premultiplied later), opacity
				vInfo: 'vec4f', // sprite, look, life fraction, half size (m)
			},
			vertex: /* wgsl */`
	let base = v.instance * 6u;
	let d0 = vfxData[ base ];
	let d1 = vfxData[ base + 1u ];
	let d2 = vfxData[ base + 2u ];
	let d3 = vfxData[ base + 3u ];
	let d4 = vfxData[ base + 4u ];
	let d5 = vfxData[ base + 5u ];
	let age = mat.now - d0.w;
	let life = max( d1.w, 1e-3 );
	let u = clamp( age / life, 0.0, 1.0 );
	var alive = age >= 0.0 && age < life;
	let t = max( age, 0.0 );
	let k = d2.w;
	var p = vfxPos( d0.xyz, d1.xyz, d2.xyz, k, t );
	var vel = vfxVel( d1.xyz, d2.xyz, k, t );
	let lookF = d5.y;
	let look = floor( lookF + 0.001 );
	let glowAmt = fract( lookF );
	let sprite = floor( d5.x + 0.5 );
	let orient = floor( d5.z + 0.5 );
	let floorMode = floor( d5.w + 0.001 );
	let seed = fract( d5.w );
	let floorY = d3.z;
	var spinT = t;
	// the floor: DIE (into the water), REST (lands: the time of landing by bisection, then it lies still)
	if ( p.y < floorY ) {
		if ( floorMode > 0.5 && floorMode < 1.5 ) {
			alive = false;
		} else if ( floorMode > 1.5 ) {
			var lo = 0.0;
			var hi = t;
			for ( var i = 0; i < 10; i++ ) {
				let mid = ( lo + hi ) * 0.5;
				if ( vfxPos( d0.xyz, d1.xyz, d2.xyz, k, mid ).y < floorY ) { hi = mid; } else { lo = mid; }
			}
			p = vfxPos( d0.xyz, d1.xyz, d2.xyz, k, hi );
			p.y = floorY + 0.02;
			vel = vec3f( 0.0 );
			spinT = hi;
		} else {
			p.y = floorY;
			vel.y = max( vel.y, 0.0 );
		}
	}

	// size: s0 -> s1, eased out
	let e = 1.0 - ( 1.0 - u ) * ( 1.0 - u );
	let s = mix( d3.x, d3.y, e );
	let toCam = frame.cameraPos - p;
	let dist = max( length( toCam ), 0.05 );
	let Vd = toCam / dist;
	// never thinner than ~1.2 px: a far splinter or spark keeps its weight by fading instead of vanishing
	let pixel = dist * 2.0 / ( frame.proj[ 1 ][ 1 ] * frame.resolution.y );
	let size = max( s, pixel * 1.2 );
	var cover = ( s / size ) * ( s / size );
	let rot = seed * TWO_PI + d3.w * spinT;
	let cr = cos( rot );
	let sr = sin( rot );
	let right = normalize( cross( vec3f( 0.0, 1.0, 0.0 ), Vd ) + vec3f( 1e-5, 0.0, 0.0 ) );
	let up = cross( Vd, right );
	var ax = right * cr + up * sr;
	var ay = up * cr - right * sr;
	var hx = size;
	var hy = size;
	let corner = v.position.xy; // the plane is 2 x 2
	var world = vec3f( 0.0 );
	if ( orient > 1.5 && orient < 2.5 ) {
		// FLAT: lying on the water (its corners ride the waves)
		let fx = vec2f( cr, sr );
		let fz = vec2f( - sr, cr );
		let q = p.xz + fx * ( corner.x * size ) + fz * ( corner.y * size );
		let dy = d0.y - frame.seaLevel;
		let onSea = abs( dy ) < 0.6;
		let wy = select( p.y, ${ waterAt( 'q' ) } + max( dy, 0.04 ), onSea );
		world = vec3f( q.x, wy, q.y );
	} else {
		if ( orient > 0.5 && orient < 1.5 ) {
			// STREAK: along the motion seen from here, stretched by 1/30 s of travel
			let vPerp = vel - Vd * dot( vel, Vd );
			let sp = length( vPerp );
			if ( sp > 0.05 ) {
				ay = vPerp / sp;
				ax = normalize( cross( Vd, ay ) );
				hy = size + sp * ( 1.0 / 60.0 );
				cover = cover * size / hy;
			}
		} else if ( orient > 2.5 ) {
			// UPRIGHT: a vertical sheet turned to the camera (columns, flames), leaning a little with the motion
			let side = normalize( cross( vec3f( 0.0, 1.0, 0.0 ), Vd ) + vec3f( 1e-5, 0.0, 0.0 ) );
			let lean = clamp( dot( vel, side ) * 0.04, -0.35, 0.35 );
			ax = side;
			ay = normalize( vec3f( 0.0, 1.0, 0.0 ) + side * lean );
		}
		world = p + ax * ( corner.x * hx ) + ay * ( corner.y * hy );
	}

	// opacity over life per look
	var a = d4.w * cover;
	var col = d4.rgb;
	let sun = frame.sunColor;
	let sky = frame.skyIrradiance;
	let cosT = dot( - Vd, frame.sunDir );
	if ( look < 0.5 ) {
		// SMOKE: soft, multiply scattering grey; fire-lit from below while it is young
		a = a * smoothstep( 0.0, 0.06, u ) * ( 1.0 - smoothstep( 0.35, 1.0, u ) );
		col = d4.rgb * ( sun * ( 0.3 * INV_PI + vfxPhase( cosT, 0.45 ) * 0.5 ) + sky ) + vec3f( 1.0, 0.42, 0.12 ) * ( glowAmt * 0.8 * pow( 1.0 - u, 4.0 ) );
	} else if ( look < 1.5 ) {
		// GLOW: radiance, burning out
		a = a * pow( 1.0 - u, 1.3 ) * smoothstep( 0.0, 0.02, u + 0.01 );
		col = d4.rgb;
	} else if ( look < 2.5 ) {
		// WATER: white water and mist, bright with the sky, glowing when backlit
		a = a * smoothstep( 0.0, 0.05, u ) * ( 1.0 - smoothstep( 0.55, 1.0, u ) );
		col = d4.rgb * ( sun * ( 0.35 * INV_PI + vfxPhase( cosT, 0.7 ) * 0.6 ) + sky * 1.1 );
	} else {
		// SOLID: a lit chip (the bevel comes from the atlas); fades over the last part of its life
		a = a * ( 1.0 - smoothstep( 0.85, 1.0, u ) );
		col = d4.rgb * ( sun * ( ( max( frame.sunDir.y, 0.0 ) * 0.6 + 0.25 ) * INV_PI ) + sky * 0.75 );
	}

	// far: fade out and take the horizon colour; very near the eye: big puffs would fill the screen
	let haze = 1.0 - exp( - dist * mat.haze );
	col = select( mix( col, frame.horizonColor * ( d4.r + d4.g + d4.b ) * 0.33, haze * 0.6 ), col * ( 1.0 - haze * 0.5 ), look > 0.5 && look < 1.5 );
	a = a * smoothstep( mat.maxDistance, mat.maxDistance * 0.6, dist ) * smoothstep( 0.2, 0.2 + size * 1.5, dist ) * mat.intensity;
	alive = alive && a > 1e-4;

	o.vUV = corner;
	o.vCol = vec4f( col, a );
	o.vInfo = vec4f( sprite, look, u, size );
	v.useWorld = true;
	v.worldPos = select( vec3f( 0.0, -1e5, 0.0 ), world, alive );
	v.worldNormal = Vd;
	v.prevWorldPos = v.worldPos - vel * frame.dt;
`,
			output: /* wgsl */`
	let uv = in.vs.vUV;
	let info = in.vs.vInfo;
	// (rounded: the interpolated index wobbles around its integer, which would flip between cells)
	let sprite = floor( info.x + 0.5 );
	let cell = vec2f( sprite - ${ fl( ATLAS_GRID ) } * floor( sprite / ${ fl( ATLAS_GRID ) } + 0.01 ), floor( sprite / ${ fl( ATLAS_GRID ) } + 0.01 ) );
	let auv = ( cell + vec2f( uv.x * 0.5 + 0.5, 0.5 - uv.y * 0.5 ) ) * ${ G };
	let tx = textureSample( vfxAtlas, smpLinearClamp, auv );
	let look = floor( info.y + 0.5 );
	let u = info.z;
	var soft = 1.0;
#if VFX_SOFT
	// soft intersections with the opaque scene (reversed-Z depth, exact texel loads)
	let dsz = vec2f( textureDimensions( vfxSceneDepth ) );
	let qd = vec2i( clamp( in.pixel * frame.invResolution, vec2f( 0.0 ), vec2f( 0.9999 ) ) * dsz );
	let sceneZ = - viewDepth( textureLoad( vfxSceneDepth, qd, 0 ) );
	let posViewZ = ( frame.view * vec4f( in.P, 1.0 ) ).z;
	soft = select( sat( ( posViewZ - sceneZ ) / ( info.w * 0.6 + 0.05 ) ), 1.0, look > 2.5 );
#endif
	var rgb = vec3f( 0.0 );
	var aOut = 0.0;
	if ( look < 0.5 ) {
		// smoke: eroded from its thin edges as it ages, denser parts a little darker
		let erode = u * 0.5;
		let dens = sat( ( tx.r - erode ) / ( 1.0 - erode ) );
		aOut = in.vs.vCol.w * dens * soft;
		rgb = in.vs.vCol.rgb * ( 1.08 - tx.g * 0.25 ) * aOut;
	} else if ( look < 1.5 ) {
		// glow: added light, alpha 0 (what is behind stays, its motion too); the hot core goes white
		let e = tx.r + tx.g * 1.5;
		let c = in.vs.vCol.rgb;
		rgb = mix( c, vec3f( max( c.r, max( c.g, c.b ) ) ), tx.g * 0.3 ) * ( e * in.vs.vCol.w * soft );
		aOut = 0.0;
	} else if ( look < 2.5 ) {
		let erode = u * 0.4;
		let dens = sat( ( tx.r - erode ) / ( 1.0 - erode ) );
		aOut = in.vs.vCol.w * dens * soft;
		rgb = in.vs.vCol.rgb * ( 0.9 + tx.g * 0.15 ) * aOut;
	} else {
		let cov = smoothstep( 0.35, 0.65, tx.r );
		aOut = in.vs.vCol.w * cov;
		rgb = in.vs.vCol.rgb * ( 0.5 + tx.g * 0.9 ) * aOut;
	}
	if ( aOut < 0.002 && max( rgb.r, max( rgb.g, rgb.b ) ) < 1e-4 ) { discard; }
	r.color = vec4f( rgb, aOut );
`,
		} );

		const geo = new PlaneGeometry( 2, 2 );
		geo.instanceCount = 0;
		this.geometry = geo;
		this.material = mat;
		this.u = mat.uniforms;
		this.mesh = new Mesh( geo, mat );
		this.mesh.name = 'VfxParticles';
		this.mesh.frustumCulled = false;
		this.mesh.castShadow = false;
		this.mesh.receiveShadow = false;
		this.mesh.renderOrder = 21;
		this.mesh.layers.set( LAYERS.TRANSPARENT );
		this.mesh.visible = false;
		this.uploads = 0; // runs uploaded (stats)
		this._upload = ( a, b ) => {

			const d = this.pool.data;
			GPU.queue.writeBuffer( this.buffer.getGPU(), a * STRIDE * 4, d.buffer, d.byteOffset + a * STRIDE * 4, ( b - a ) * STRIDE * 4 );
			this.uploads ++;

		};

	}

	sync() {

		const pool = this.pool;
		pool.flushDirty( this._upload );
		this.u.now.value = pool.now;
		this.geometry.instanceCount = pool.drawCount;
		this.mesh.visible = pool.drawCount > 0;

	}

	dispose() {

		try {

			if ( this.mesh.parent ) this.mesh.parent.remove( this.mesh );
			if ( this.geometry.dispose ) this.geometry.dispose();

		} catch ( e ) { /* already gone */ }

		this.mesh.visible = false;

	}

}

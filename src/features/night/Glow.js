import { Material } from '../../engine/render/Material.js';
import { Mesh } from '../../engine/scene/Mesh.js';
import { PlaneGeometry, InstancedBufferAttribute } from '../../engine/geometry/index.js';
import { LAYERS } from '../../engine/render/SceneRenderer.js';

// The night's glows: one instanced draw of additive sprites filled on the CPU each frame (lantern and
// running-light halos, fireflies, the lighthouse lamp and its flash, the bobber's lantern, light lying on
// the water). Each instance is two vec4s:
//   gPos = ( x, y, z, radius m )       gCol = ( r, g, b radiance, mode )
// modes: HALO a camera-facing glow pulled a little toward the camera (the lamp's housing does not cut it),
//        SPRITE camera-facing, not pulled (fireflies), POOL a disc lying on the water (its corners follow the
//        waves), STREAK an ellipse on the water three times as long as wide along angle gPos.y (the beam's
//        sweep), FLOAT camera-facing at gPos.y above the water surface.
// A sprite never gets smaller than ~2.5 px: farther away it grows and dims so its total light is kept (the
// harbour's lamps read as points across the bay). Drawn after the water in the late pass, depth tested
// (hulls, walls and hills hide them), no depth write, alpha 0 (pure addition: neither the motion vectors nor
// the water mask behind change).
//
//   const glow = new Glow( { query, count: 512 } ); scene.add( glow.mesh );
//   glow.begin(); glow.push( x, y, z, radius, r, g, b, mode ); ... glow.end();
export const HALO = 0, POOL = 1, SPRITE = 2, FLOAT = 3, STREAK = 4;

export class Glow {

	constructor( { query = null, count = 512 } = {} ) {

		this.max = count;
		this.n = 0;
		const hasQuery = !! ( query && query.module );
		const waterAt = ( xz ) => hasQuery ? `waterQueryHeightAtXZ( ${ xz } )` : 'frame.seaLevel';

		const mat = new Material( {
			name: 'NightGlow',
			modules: hasQuery ? [ query.module ] : [],
			lit: false,
			transparent: true,
			depthWrite: false,
			depthTest: true,
			side: 'double',
			blending: 'premultiplied',
			velocityWeight: 0,
			underwaterLighting: 'none',
			receiveShadows: false,
			attributes: { gPos: 'vec4f', gCol: 'vec4f' },
			varyings: { vGlowCol: 'vec4f', vGlowUV: 'vec2f' }, // radiance + mode, quad corner
			vertex: /* wgsl */`
	let P = v.gPos;
	let C = v.gCol;
	let mode = C.w;
	let corner = v.position.xy; // plane is 2 x 2
	let onWater = ( mode > 0.5 && mode < 1.5 ) || mode > 3.5;
	var c = P.xyz;
	if ( mode > 2.5 && mode < 3.5 ) { c.y = ${ waterAt( 'c.xz' ) } + P.y; }
	let toCam = frame.cameraPos - c;
	let dist = max( length( toCam ), 0.05 );
	let Vd = toCam / dist;
	// at least ~2.5 px across: farther away the sprite grows and dims (its light is kept)
	let pixel = dist * 2.0 / ( frame.proj[ 1 ][ 1 ] * frame.resolution.y );
	let size = max( P.w, pixel * 2.5 );
	let k = P.w / size;
	var world = c;
	if ( onWater ) {
		// light lying on the water: a disc (POOL) or an ellipse along angle P.y (STREAK)
		let aspect = select( 1.0, 3.0, mode > 3.5 );
		let ang = select( 0.0, P.y, mode > 3.5 );
		let ax = vec2f( cos( ang ), sin( ang ) );
		let ay = vec2f( - ax.y, ax.x );
		let q = c.xz + ax * ( corner.x * size * aspect ) + ay * ( corner.y * size );
		world = vec3f( q.x, ${ waterAt( 'q' ) } + 0.08, q.y );
	} else {
		// halos are pulled toward the camera so the lamp's own housing does not cut them
		let pull = select( 0.0, min( P.w * 0.6, dist * 0.5 ), mode < 0.5 );
		let right = normalize( cross( vec3f( 0.0, 1.0, 0.0 ), Vd ) + vec3f( 1e-5, 0.0, 0.0 ) );
		let up = cross( Vd, right );
		world = c + Vd * pull + right * ( corner.x * size ) + up * ( corner.y * size );
	}
	o.vGlowCol = vec4f( C.rgb * ( k * k ), mode + k * 0.1 ); // (k rides in the fraction: sharpness)
	o.vGlowUV = corner;
	v.useWorld = true;
	v.worldPos = select( vec3f( 0.0, -1e5, 0.0 ), world, P.w > 0.0 );
	v.worldNormal = select( Vd, vec3f( 0.0, 1.0, 0.0 ), onWater );
	v.prevWorldPos = v.worldPos;
`,
			// halo: a hot core and a faint wide skirt (the core broadens, energy kept, when the sprite is at its
			// minimum size); light on the water: a broad soft disc
			surface: /* wgsl */`
	let q = in.vs.vGlowUV;
	let r2 = dot( q, q );
	if ( r2 >= 1.0 ) { discard; }
	let mf = in.vs.vGlowCol.w;
	let mode = floor( mf + 0.01 );
	let k = clamp( ( mf - mode ) * 10.0, 0.0, 1.0 );
	let edge = 1.0 - r2;
	let a = mix( 4.0, 22.0, k );
	let halo = exp( - r2 * a ) * ( a / 22.0 ) + exp( - r2 * 4.5 ) * 0.07 * edge;
	let pool = exp( - r2 * 2.5 ) * edge;
	let onWater = ( mode > 0.5 && mode < 1.5 ) || mode > 3.5;
	s.albedo = in.vs.vGlowCol.rgb * select( halo, pool, onWater );
	s.emissive = vec3f( 0.0 );
	s.alpha = 0.0;
`,
			output: 'r.color = vec4f( s.albedo, 0.0 );',
		} );

		// unlit: no scene lighting hooks (as the water), so their textures do not count against the vertex stage's
		// 16 sampled textures next to the water query's own
		mat.lightingHooks = false;

		const geo = new PlaneGeometry( 2, 2 );
		this.pos = new InstancedBufferAttribute( new Float32Array( count * 4 ), 4 );
		this.col = new InstancedBufferAttribute( new Float32Array( count * 4 ), 4 );
		geo.setAttribute( 'gPos', this.pos );
		geo.setAttribute( 'gCol', this.col );
		geo.instanceCount = 0;
		this.geometry = geo;
		this.material = mat;
		this.mesh = new Mesh( geo, mat );
		this.mesh.name = 'NightGlow';
		this.mesh.frustumCulled = false;
		this.mesh.castShadow = false;
		this.mesh.receiveShadow = false;
		this.mesh.renderOrder = 23;
		this.mesh.layers.set( LAYERS.TRANSPARENT );
		this.mesh.visible = false;

	}

	begin() {

		this.n = 0;

	}

	// false once the pool is full
	push( x, y, z, radius, r, g, b, mode = HALO ) {

		if ( this.n >= this.max || ! ( radius > 0 ) || ! ( r + g + b > 1e-5 ) ) return this.n < this.max;
		const o = this.n * 4;
		const p = this.pos.array, c = this.col.array;
		p[ o ] = x; p[ o + 1 ] = y; p[ o + 2 ] = z; p[ o + 3 ] = radius;
		c[ o ] = r; c[ o + 1 ] = g; c[ o + 2 ] = b; c[ o + 3 ] = mode;
		this.n ++;
		return true;

	}

	end() {

		const n = this.n;
		this.geometry.instanceCount = n;
		this.mesh.visible = n > 0;
		if ( n > 0 ) for ( const a of [ this.pos, this.col ] ) {

			if ( a.clearUpdateRanges ) a.clearUpdateRanges();
			if ( a.addUpdateRange ) a.addUpdateRange( 0, n * 4 );
			a.needsUpdate = true;

		}

	}

	hide() {

		this.n = 0;
		this.geometry.instanceCount = 0;
		this.mesh.visible = false;

	}

	dispose() {

		try {

			if ( this.mesh.parent ) this.mesh.parent.remove( this.mesh );
			if ( this.geometry.dispose ) this.geometry.dispose();
			if ( this.material.dispose ) this.material.dispose();

		} catch ( e ) { /* already gone */ }

		this.mesh.visible = false;

	}

}

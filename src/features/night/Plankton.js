import { Material } from '../../engine/render/Material.js';
import { Mesh } from '../../engine/scene/Mesh.js';
import { PlaneGeometry } from '../../engine/geometry/index.js';
import { ShaderModule } from '../../engine/gpu/Shader.js';
import { LAYERS } from '../../engine/render/SceneRenderer.js';
import { Vector2, Vector3, Vector4 } from '../../engine/math/index.js';

export const MAX_STIR = 16; // stirrings packed per frame (boats, ships, the bobber, splashes, a swimmer)

// Bioluminescent plankton (dinoflagellates): blue-green sparkles and a milky glow wherever the water is
// stirred at night. One instanced draw, procedural like AirMotes / RainFX: each instance is a cell fixed in
// the water (a hash of its index) in a box that wraps round the camera, drifting with the surface. How much
// a cell lights up is read on the GPU from what stirs the water there:
//   the wake simulation (foam and the propeller's aeration: boat wakes and moving hulls), the beach's surf
//   simulation (ShoreSim foam), the breaking shore waves everywhere else (ShoreWaves foam / breaking / swash
//   in the shallows: the reef's surf), plus up to MAX_STIR stirrings from the CPU (x, z, radius, strength):
//   hulls, the bobber and the bites, splashes, a swimmer, cannonball impacts.
// Most cells are sparkles (a flash with a fast rise and a slow decay, ~2 cm, at least ~1.5 px wide with
// their light kept); one in five is a soft patch of glow lying on the water. Cells where nothing stirs the
// water collapse off-screen before the water height is solved, so the cost scales with what glows.
// Additive (alpha 0: the motion vectors and the water mask behind are kept), depth tested, late pass.
//
//   const pk = new Plankton( { query, wake, shoreSim, shore, terrain, count } ); scene.add( pk.mesh );
//   pk.stir: Float32Array( MAX_STIR * 4 ) filled by the caller, then
//   pk.update( dt, camera, { strength, count, box, windDrift } )
export class Plankton {

	constructor( { query = null, wake = null, shoreSim = null, shore = null, terrain = null, count = 6144, box = 64 } = {} ) {

		this.max = count;
		this.box = box;
		this.stir = new Float32Array( MAX_STIR * 4 );
		const has = {
			query: !! ( query && query.module ),
			wake: !! ( wake && wake.module ),
			shoreSim: !! ( shoreSim && shoreSim.module ),
			terrain: !! ( terrain && terrain.module ),
		};
		has.surf = has.terrain && !! ( shore && shore.module );
		this.has = has;

		const hash = new ShaderModule( { name: 'nightPlanktonHash', code: /* wgsl */`
fn nightHash3( n: f32 ) -> vec3f { return fract( sin( vec3f( n, n + 17.13, n + 43.71 ) ) * vec3f( 43758.5453, 22578.1459, 19642.3490 ) ); }
` } );
		const modules = [ hash ];
		if ( has.query ) modules.push( query.module );
		if ( has.wake ) modules.push( wake.module );
		if ( has.shoreSim ) modules.push( shoreSim.module );
		if ( has.terrain ) modules.push( terrain.module );
		if ( has.surf ) modules.push( shore.module );
		const waterAt = ( xz ) => has.query ? `waterQueryHeightAtXZ( ${ xz } )` : 'frame.seaLevel';

		const mat = new Material( {
			name: 'NightPlankton',
			modules,
			lit: false,
			transparent: true,
			depthWrite: false,
			depthTest: true,
			side: 'double',
			blending: 'premultiplied',
			velocityWeight: 0,
			underwaterLighting: 'none',
			receiveShadows: false,
			uniforms: {
				camPos: [ 'vec3f', new Vector3() ],
				strength: [ 'f32', 0 ],
				drift: [ 'vec2f', new Vector2() ], // the surface drift of the whole pattern, wrapped to the box (m)
				box: [ 'f32', box ],
				stir: [ `vec4f[${ MAX_STIR }]`, Array.from( { length: MAX_STIR }, () => new Vector4( 0, 0, 1, 0 ) ) ],
			},
			varyings: { vPlCol: 'vec4f', vPlUV: 'vec2f' }, // radiance + kind (1 = glow patch), quad corner
			vertex: /* wgsl */`
	let id = f32( v.instance );
	let h = nightHash3( id * 0.7131 + 0.37 );
	let h2 = nightHash3( id * 1.3917 + 5.1 );
	let h3 = nightHash3( id * 2.7193 + 9.4 );
	let Bx = mat.box;
	// a cell fixed in the water, wrapped round the camera
	let local = ( fract( h.xz + ( mat.drift - mat.camPos.xz ) / Bx ) - 0.5 ) * Bx;
	let xz = mat.camPos.xz + local;
	let isGlow = h.y < 0.2;

	// ---- how stirred the water is here
	var ag = 0.0;
	for ( var i = 0; i < ${ MAX_STIR }; i++ ) {
		let d = mat.stir[ i ];
		let sq = ( xz - d.xy ) / max( d.z, 0.05 );
		ag += d.w * sat( 1.0 - dot( sq, sq ) );
	}
${ has.wake ? `	let wk = wakeSample( xz );
	ag += wk.w * 1.6 + wakeAeration( xz ) * 0.7;
` : '' }${ has.shoreSim ? `	ag += shoreSimSample( xz ).x * 1.3;
` : '' }${ has.terrain ? `	let ground = terrainHeightAt( xz );
	let depth = frame.seaLevel - ground;
` : `	let depth = 50.0;
` }${ has.surf ? `	if ( depth > 0.05 && depth < 7.0 ) {
		let sh = shoreEvaluateNoNormal( xz, depth, ground );
		ag += max( sh.foam, sh.breaking ) * 1.1 + sh.swashFoam * 0.5;
	}
` : '' }	ag = min( ag, 2.5 ) * smoothstep( 0.02, 0.2, depth );

	// ---- light: sparkles flash (a fast rise, a slow decay, each cell its own period); glow patches breathe.
	// Weak stirring lights fewer cells rather than dimmer ones.
	let per = mix( 0.6, 2.4, h2.x );
	let ph = fract( frame.time / per + h2.y );
	let flash = exp( - ph * 7.0 ) * smoothstep( 0.0, 0.04, ph );
	let lumS = ( 0.12 + 2.4 * flash ) * select( 0.0, 1.0, h3.x < ag * 0.9 );
	let lumG = ag * ( 0.75 + 0.25 * sin( frame.time * 1.3 + h2.z * 6.2832 ) ) * 0.5;
	let edge = smoothstep( Bx * 0.5, Bx * 0.36, max( abs( local.x ), abs( local.y ) ) );
	let lum = select( lumS, lumG, isGlow ) * mat.strength * edge;
	let lit = lum > 0.002;

	// ---- where: on the surface (the water height is solved only for lit cells)
	let corner = v.position.xy; // plane is 2 x 2
	var world = vec3f( xz.x, frame.seaLevel, xz.y );
	var k = 1.0;
	var Vd = vec3f( 0.0, 1.0, 0.0 );
	if ( lit ) {
		if ( isGlow ) {
			// a patch lying on the water, its corners following the waves
			let r = mix( 0.35, 0.8, h3.y ) * ( 0.8 + min( ag, 1.0 ) * 0.4 );
			let q = xz + corner * r;
			world = vec3f( q.x, ${ waterAt( 'q' ) } + 0.06, q.y );
		} else {
			let c = vec3f( xz.x, ${ waterAt( 'xz' ) } + 0.03, xz.y );
			let toCam = frame.cameraPos - c;
			let dist = max( length( toCam ), 0.05 );
			Vd = toCam / dist;
			let r = mix( 0.012, 0.03, h3.y );
			let pixel = dist * 2.0 / ( frame.proj[ 1 ][ 1 ] * frame.resolution.y );
			let size = max( r, pixel * 1.5 );
			k = r / size;
			let right = normalize( cross( vec3f( 0.0, 1.0, 0.0 ), Vd ) + vec3f( 1e-5, 0.0, 0.0 ) );
			let up = cross( Vd, right );
			world = c + right * ( corner.x * size ) + up * ( corner.y * size );
		}
	}

	// blue-green (Noctiluca ~475 nm); a sparkle's light is kept when it is drawn larger than it is
	let tint = mix( vec3f( 0.12, 0.62, 1.0 ), vec3f( 0.2, 1.0, 0.85 ), h2.z * 0.6 );
	let gain = select( 9.0 * k * k, 0.16, isGlow );
	o.vPlCol = vec4f( tint * ( lum * gain ), select( 0.0, 1.0, isGlow ) );
	o.vPlUV = corner;
	v.useWorld = true;
	v.worldPos = select( vec3f( 0.0, -1e5, 0.0 ), world, lit );
	v.worldNormal = Vd;
	v.prevWorldPos = v.worldPos;
`,
			surface: /* wgsl */`
	let q = in.vs.vPlUV;
	let r2 = dot( q, q );
	if ( r2 >= 1.0 ) { discard; }
	let g = select( exp( - r2 * 6.0 ), exp( - r2 * 2.2 ) * ( 1.0 - r2 ), in.vs.vPlCol.w > 0.5 );
	s.albedo = in.vs.vPlCol.rgb * g;
	s.emissive = vec3f( 0.0 );
	s.alpha = 0.0;
`,
			output: 'r.color = vec4f( s.albedo, 0.0 );',
		} );

		// unlit: no scene lighting hooks (as the water), so their textures do not count against the vertex stage's
		// 16 sampled textures next to the water query's own
		mat.lightingHooks = false;

		const geo = new PlaneGeometry( 2, 2 );
		geo.instanceCount = 0;
		this.geometry = geo;
		this.material = mat;
		this.u = mat.uniforms;
		this.mesh = new Mesh( geo, mat );
		this.mesh.name = 'NightPlankton';
		this.mesh.frustumCulled = false;
		this.mesh.castShadow = false;
		this.mesh.receiveShadow = false;
		this.mesh.renderOrder = 22;
		this.mesh.layers.set( LAYERS.TRANSPARENT );
		this.mesh.visible = false;

	}

	// strength 0..1 (0 hides it), count instances (<= max), box (m), windDrift { x, y } surface drift (m/s);
	// waterHeight: the water at the camera (not drawn from under the water)
	update( dt, camera, { strength = 0, count = this.max, box = this.box, windDrift = null, waterHeight = 0 } = {} ) {

		const n = Math.max( 0, Math.min( this.max, Math.round( count ) ) );
		const visible = strength > 0.002 && n > 0 && !! camera && camera.position.y > waterHeight - 0.05;
		this.mesh.visible = visible;
		this.geometry.instanceCount = visible ? n : 0;
		if ( ! visible ) return;
		const u = this.u;
		u.camPos.value.copy( camera.position );
		u.strength.value = strength;
		if ( box !== u.box.value ) u.box.value = box;
		if ( windDrift ) {

			const d = u.drift.value;
			d.x = ( d.x + windDrift.x * dt ) % box;
			d.y = ( d.y + windDrift.y * dt ) % box;

		}

		const s = this.stir, arr = u.stir.value;
		for ( let i = 0; i < MAX_STIR; i ++ ) arr[ i ].set( s[ i * 4 ], s[ i * 4 + 1 ], s[ i * 4 + 2 ], s[ i * 4 + 3 ] );

	}

	hide() {

		this.mesh.visible = false;
		this.geometry.instanceCount = 0;

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

import { Material } from '../../engine/render/Material.js';
import { Mesh } from '../../engine/scene/Mesh.js';
import { PlaneGeometry } from '../../engine/geometry/index.js';
import { ShaderModule } from '../../engine/gpu/Shader.js';
import { LAYERS } from '../../engine/render/SceneRenderer.js';
import { Vector2, Vector3 } from '../../engine/math/index.js';

const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );

// Rain streaks around the camera: one instanced draw of camera-facing quads stretched along the fall
// direction (fall speed plus the wind's slant). Like AirMotes / MarineSnow the drops are procedural (a hash of
// the instance) in a box that wraps around the camera: no simulation, no CPU work beyond a few uniforms.
// Density follows the rain intensity by drawing fewer instances (the drops thin out one by one, no pop);
// each streak is at least ~1.3 px wide, lit per drop by the sky (plus the sun when looking toward it, the
// forward lobe that makes rain glow against a low sun), drawn premultiplied in the late pass and owning its
// own motion vector (the same trick as the air motes) so the temporal resolve does not smear it.
// Not drawn with the camera under water. Cost: one draw, a few thousand quads.
//
//   const rain = new RainFX( { count: 7000 } ); scene.add( rain.mesh );
//   rain.update( dt, camera, { rain: 0..1, windSpeed, windDir: { x, y }, waterHeight, sunMix: 0..1, shelter: 0..1 } )
export class RainFX {

	constructor( { count = 7000, box = 28, height = 16 } = {} ) {

		this.count = count;
		this.box = box;
		this.height = height;

		const hash = new ShaderModule( { name: 'rainHash', code: /* wgsl */`
fn rainHash3( n: f32 ) -> vec3f { return fract( sin( vec3f( n, n + 17.13, n + 43.71 ) ) * vec3f( 43758.5453, 22578.1459, 19642.3490 ) ); }
// Henyey-Greenstein phase (1/sr)
fn rainPhase( cosT: f32, g: f32 ) -> f32 { return ( ( 1.0 - g * g ) / ( 4.0 * PI ) ) / pow( max( 1.0 + g * g - cosT * 2.0 * g, 1e-4 ), 1.5 ); }
` } );

		const mat = new Material( {
			name: 'Rain',
			modules: [ hash ],
			lit: false,
			transparent: true,
			depthWrite: true,
			depthTest: true,
			side: 'double',
			blending: 'premultiplied',
			defines: { VELOCITY_OPAQUE: 1 },
			uniforms: {
				camPos: [ 'vec3f', new Vector3() ],
				drift: [ 'vec2f', new Vector2() ], // wind drift of the whole pattern, wrapped to the box (m)
				windV: [ 'vec2f', new Vector2() ], // horizontal drop velocity (m/s)
				box: [ 'f32', box ],
				height: [ 'f32', height ],
				streak: [ 'f32', 0.45 ], // streak length (m)
				strength: [ 'f32', 0.4 ], // opacity of a streak
				sunMix: [ 'f32', 1 ], // how much the sun reaches the drops (0 under a dark sky)
			},
			varyings: { vRainCol: 'vec4f', vRainUV: 'vec2f' }, // radiance + opacity, quad corner
			vertex: /* wgsl */`
	let id = f32( v.instance );
	let h = rainHash3( id * 0.7131 + 0.37 );
	let h2 = rainHash3( id * 1.3917 + 5.1 );
	let Bx = mat.box;
	let Hy = mat.height;

	// ---- where: x / z wrapped around the camera (drifting with the wind), y falling through a window
	// that spans 0.62 H above the camera and 0.38 H below it
	let speed = mix( 7.5, 10.5, h2.x );
	let local = ( fract( h.xz + ( mat.drift - mat.camPos.xz ) / Bx ) - 0.5 ) * Bx;
	let u = ( h.y * Hy - speed * frame.time - mat.camPos.y ) / Hy;
	let yRel = ( fract( u + 0.38 ) - 0.38 ) * Hy;
	let p = vec3f( mat.camPos.x + local.x, mat.camPos.y + yRel, mat.camPos.z + local.y );

	// ---- the streak: along the fall direction, facing the camera
	let vel = vec3f( mat.windV.x, - speed, mat.windV.y );
	let dirW = normalize( vel );
	let toCam = frame.cameraPos - p;
	let dist = max( length( toCam ), 0.05 );
	let Vd = toCam / dist;
	let len = mat.streak * mix( 0.75, 1.25, h2.y );
	let pixel = dist * 2.0 / ( frame.proj[ 1 ][ 1 ] * frame.resolution.y );
	let wid = max( 0.007, pixel * 1.3 );
	let side = normalize( cross( dirW, Vd ) + vec3f( 1e-5, 0.0, 0.0 ) );

	// ---- light: sky irradiance, plus the sun's forward lobe when looking toward it
	let cosT = - dot( Vd, frame.sunDir );
	let sun = frame.sunColor * ( rainPhase( cosT, 0.62 ) * 0.9 * mat.sunMix );
	let col = frame.skyIrradiance * vec3f( 1.5, 1.55, 1.7 ) + sun;

	// ---- fades: box edges (before the wrap), right in front of the lens, far, at the window's ends
	let edge = smoothstep( Bx * 0.5, Bx * 0.38, max( abs( local.x ), abs( local.y ) ) );
	let vert = smoothstep( 0.62 * Hy, 0.5 * Hy, yRel ) * smoothstep( - 0.38 * Hy, - 0.26 * Hy, yRel );
	let fade = edge * vert * smoothstep( Bx * 0.5, Bx * 0.3, dist ) * smoothstep( 0.35, 1.3, dist );
	let a = mat.strength * ( 0.6 + 0.4 * h.z ) * fade;

	let corner = v.position.xy; // plane is 2 x 2
	let world = p + side * ( corner.x * wid ) + dirW * ( corner.y * len * 0.5 );
	o.vRainCol = vec4f( col, a );
	o.vRainUV = corner;
	v.useWorld = true;
	v.worldPos = select( vec3f( 0.0, -1e5, 0.0 ), world, a > 2e-4 );
	v.worldNormal = Vd;
	// own motion over the last frame (the template adds the camera's)
	v.prevWorldPos = v.worldPos - vel * frame.dt;
`,
			// a soft streak: gaussian across, rounded off at the ends; only its core writes depth
			surface: /* wgsl */`
	let uvq = in.vs.vRainUV;
	let across = exp( uvq.x * uvq.x * - 3.0 );
	let along = 1.0 - pow( abs( uvq.y ), 4.0 );
	let g = across * along;
	let a = min( in.vs.vRainCol.w * g, 1.0 );
	if ( g < 0.3 || a < 0.004 ) { discard; }
	s.albedo = in.vs.vRainCol.rgb * a;
	s.emissive = vec3f( 0.0 );
	s.alpha = a;
`,
			output: 'r.color = vec4f( s.albedo, s.alpha );',
		} );

		const geo = new PlaneGeometry( 2, 2 );
		geo.instanceCount = 0;
		this.geometry = geo;
		this.material = mat;
		this.u = mat.uniforms;
		this.mesh = new Mesh( geo, mat );
		this.mesh.name = 'Rain';
		this.mesh.frustumCulled = false;
		this.mesh.castShadow = false;
		this.mesh.receiveShadow = false;
		this.mesh.renderOrder = 22;
		this.mesh.layers.set( LAYERS.TRANSPARENT );
		this.mesh.visible = false;
		this.density = 0; // 0..1 as drawn (rain intensity after shelter)

	}

	update( dt, camera, { rain = 0, windSpeed = 0, windDir = null, waterHeight = 0, sunMix = 1, shelter = 0 } = {} ) {

		const dens = clamp( rain * ( 1 - clamp( shelter, 0, 1 ) ), 0, 1 );
		this.density = dens;
		const n = dens > 0.01 ? Math.max( 1, Math.ceil( this.count * dens ) ) : 0;
		this.geometry.instanceCount = n;
		const visible = n > 0 && !! camera && camera.position.y > waterHeight - 0.02;
		this.mesh.visible = visible;
		if ( ! visible ) return;
		const u = this.u;
		u.camPos.value.copy( camera.position );
		const sp = Math.min( Math.max( windSpeed, 0 ) * 0.35, 7 );
		const dx = windDir ? windDir.x : 0, dz = windDir ? windDir.y : 0;
		u.windV.value.set( dx * sp, dz * sp );
		const d = u.drift.value;
		d.x = ( d.x + dx * sp * dt ) % this.box;
		d.y = ( d.y + dz * sp * dt ) % this.box;
		u.strength.value = 0.3 + 0.3 * dens;
		u.streak.value = 0.3 + 0.16 * dens;
		u.sunMix.value = clamp( sunMix, 0, 1 );

	}

	dispose() {

		try {

			if ( this.mesh.parent ) this.mesh.parent.remove( this.mesh );
			if ( this.geometry.dispose ) this.geometry.dispose();

		} catch ( e ) { /* already gone */ }

		this.mesh.visible = false;

	}

}

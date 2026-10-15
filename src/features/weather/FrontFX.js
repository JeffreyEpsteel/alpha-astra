import { Material } from '../../engine/render/Material.js';
import { Mesh } from '../../engine/scene/Mesh.js';
import { PlaneGeometry } from '../../engine/geometry/index.js';
import { ShaderModule } from '../../engine/gpu/Shader.js';
import { LAYERS } from '../../engine/render/SceneRenderer.js';
import { Vector2, Vector4 } from '../../engine/math/index.js';
import { FRONT, edgeOffset } from './Fronts.js';

// The storm front seen from afar (wave 19B): one instanced draw of vertical quads strung along the front's line (Fronts.js),
// centred on the point of the line nearest the camera: a dark cloud bank over the band (its top ragged, its base merging into
// the rain), a grey rain curtain under it from the sea up into the cloud (streaks drifting down), and a waterspout when the
// front carries one (a camera-facing funnel from the cloud base to a ring of spray). A strike lights the bank where it fell.
// The line, its wobble and the spout are the same numbers the weather's gameplay uses, so the wall stands where the squall is.
// Phones (or ?lowFx) string fewer, longer segments and draw no streak detail. Unlit, premultiplied, no depth writes; it fades
// out when the camera is close to the wall or under the band (the weather's own rain takes over there).
//
//   const fx = new FrontFX( { segments: 40 } ); scene.add( fx.mesh );
//   fx.update( dt, camera, front | null, A, { strength, inside 0..1, spout: { x, z, r, life } | null, flash: { amount, x, z } | null } )

const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );

export class FrontFX {

	constructor( { segments = 40, segLength = 160, lite = false } = {} ) {

		this.segments = segments;
		this.segLength = segLength;
		const noise = new ShaderModule( { name: 'frontNoise', code: /* wgsl */`
fn frHash( p: vec2f ) -> f32 { return fract( sin( dot( p, vec2f( 127.1, 311.7 ) ) ) * 43758.5453 ); }
fn frNoise( p: vec2f ) -> f32 {
	let i = floor( p ); let f = fract( p ); let u = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( frHash( i ), frHash( i + vec2f( 1.0, 0.0 ) ), u.x ), mix( frHash( i + vec2f( 0.0, 1.0 ) ), frHash( i + vec2f( 1.0, 1.0 ) ), u.x ), u.y );
}
fn frFbm( p: vec2f ) -> f32 { return 0.55 * frNoise( p ) + 0.3 * frNoise( p * 2.07 + 13.1 ) + 0.15 * frNoise( p * 4.31 + 7.7 ); }
` } );

		const mat = new Material( {
			name: 'StormFront',
			modules: [ noise ],
			lit: false,
			transparent: true,
			depthWrite: false,
			depthTest: true,
			side: 'double',
			blending: 'premultiplied',
			velocityWeight: 0,
			underwaterLighting: 'none',
			receiveShadows: false,
			defines: { FRONT_LITE: lite ? 1 : 0 },
			uniforms: {
				center: [ 'vec2f', new Vector2( FRONT.center.x, FRONT.center.z ) ],
				dir: [ 'vec2f', new Vector2( 0, 1 ) ],
				lat: [ 'vec2f', new Vector2( - 1, 0 ) ],
				ph: [ 'vec2f', new Vector2() ], // the wobble's phases
				edge: [ 'f32', 0 ], // the leading edge's offset along dir (m)
				vCam: [ 'f32', 0 ], // the camera's lateral place on the line (m)
				wob: [ 'f32', FRONT.wobble ],
				seg: [ 'f32', segLength ],
				n: [ 'f32', segments ],
				strength: [ 'f32', 0 ],
				inside: [ 'f32', 0 ],
				flash: [ 'vec2f', new Vector2() ], // amount, lateral place
				spout: [ 'vec4f', new Vector4() ], // x, z, radius, life (0: none)
			},
			varyings: { vFrUV: 'vec2f', vFrK: 'vec4f' }, // uv; kind, end fade, lateral place, distance
			vertex: /* wgsl */`
	let N = u32( mat.n );
	let i = v.instance;
	let corner = v.position.xy; // plane is 2 x 2
	var world = vec3f( 0.0 );
	var kind = 2.0;
	var uvq = vec2f( corner.x, corner.y * 0.5 + 0.5 );
	var fade = 1.0;
	var vLat = 0.0;
	if ( i < 2u * N ) {

		let layer = select( 0.0, 1.0, i >= N );
		let j = f32( i % N );
		let half = mat.n * 0.5;
		vLat = mat.vCam + ( j - half + 0.5 + corner.x * 0.5 ) * mat.seg; // (edge to edge: no overlap, no seams)
		let wob = mat.wob * ( 0.6 * sin( vLat / 520.0 + mat.ph.x ) + 0.4 * sin( vLat / 210.0 + mat.ph.y ) );
		let back = select( 280.0, 120.0, layer > 0.5 ); // the bank stands over the band, the curtain near its front
		let u = mat.edge + wob - back;
		let base = mat.center + mat.dir * u + mat.lat * vLat;
		let t = corner.y * 0.5 + 0.5;
		let y0 = select( 260.0, - 4.0, layer > 0.5 );
		let y1 = select( 1300.0, 560.0, layer > 0.5 );
		world = vec3f( base.x, mix( y0, y1, t ), base.y );
		uvq = vec2f( ( j + corner.x * 0.5 + 0.5 ) * mat.seg / 160.0, t );
		kind = layer;
		fade = 1.0 - smoothstep( 0.4, 1.0, abs( vLat - mat.vCam ) / ( half * mat.seg ) );

	} else {

		// the waterspout: a camera-facing funnel 700 m tall
		let c = vec3f( mat.spout.x, 0.0, mat.spout.y );
		let toCam = frame.cameraPos - c;
		let side = normalize( vec3f( toCam.z, 0.0, - toCam.x ) + vec3f( 1e-5, 0.0, 0.0 ) );
		let t = corner.y * 0.5 + 0.5;
		world = c + side * ( corner.x * 120.0 ) + vec3f( 0.0, t * 700.0, 0.0 );
		fade = mat.spout.w;

	}

	let dist = length( world - frame.cameraPos );
	o.vFrUV = uvq;
	o.vFrK = vec4f( kind, fade, vLat, dist );
	v.useWorld = true;
	v.worldPos = select( vec3f( 0.0, -1e5, 0.0 ), world, mat.strength > 1e-3 ); // (per instance: a per-vertex cut would tear the quads)
	v.worldNormal = vec3f( 0.0, 1.0, 0.0 );
	v.prevWorldPos = v.worldPos;
`,
			surface: /* wgsl */`
	let uvq = in.vs.vFrUV;
	let kind = in.vs.vFrK.x;
	let dist = in.vs.vFrK.w;
	let sky = frame.skyIrradiance;
	let lum = max( dot( sky, vec3f( 0.3, 0.55, 0.15 ) ), 1e-4 );
	// storm cloud and rain are grey, not sky blue: the sky's light, mostly desaturated
	let grey = mix( vec3f( lum ) * vec3f( 0.96, 0.98, 1.03 ), sky, 0.3 );
	// far: into the horizon haze, and gone past ~15 km; close: gone (the wall would be a flat sheet), and under the band
	let haze = smoothstep( 2500.0, 13000.0, dist );
	var a = in.vs.vFrK.y * mat.strength * smoothstep( 15000.0, 10000.0, dist ) * smoothstep( 120.0, 650.0, dist ) * ( 1.0 - mat.inside );
	var col = vec3f( 0.0 );
	if ( kind < 0.5 ) {

		// the cloud bank: billows, a ragged top, a dark base, lit a little from above
		let b = frFbm( vec2f( uvq.x * 0.9, uvq.y * 2.6 - frame.time * 0.004 ) );
		// (lower toward the strip's ends: the bank tapers off instead of stopping)
		let top = ( 0.5 + 0.32 * frNoise( vec2f( uvq.x * 0.35, 3.0 ) ) + 0.12 * frNoise( vec2f( uvq.x * 1.7, 9.0 ) ) ) * ( 0.45 + 0.55 * in.vs.vFrK.y );
		a *= smoothstep( top, top - 0.16, uvq.y ) * smoothstep( 0.0, 0.1, uvq.y ) * ( 0.82 + 0.18 * b );
		col = grey * mix( 0.16, 0.62, uvq.y * ( 0.55 + 0.65 * b ) );
		col += frame.sunColor * ( 0.045 * smoothstep( top - 0.3, top, uvq.y ) * ( 0.5 + 0.5 * b ) * max( frame.sunDir.y, 0.0 ) );
		// a strike inside it
		let fl = mat.flash.x * exp( - abs( in.vs.vFrK.z - mat.flash.y ) / 650.0 ) * ( 0.4 + 0.6 * b );
		col += vec3f( 0.75, 0.8, 1.0 ) * fl * 2.5 * lum;

	} else if ( kind < 1.5 ) {

		// the rain curtain: a grey sheet, denser in drifting columns falling slowly, thinning to the cloud above
		var n = frFbm( vec2f( uvq.x * 6.0, uvq.y * 3.0 + frame.time * 0.35 ) );
#if !FRONT_LITE
		n = 0.6 * n + 0.4 * frNoise( vec2f( uvq.x * 55.0, uvq.y * 4.0 + frame.time * 1.4 ) );
#endif
		a *= ( 0.42 + 0.42 * n ) * smoothstep( 1.0, 0.7, uvq.y );
		col = grey * mix( 0.42, 0.26, uvq.y ) * ( 0.85 + 0.3 * n );

	} else {

		// the spout: a funnel narrowing from the cloud base to the sea, a twist along it, a spray ring at its foot
		let x = abs( uvq.x );
		let hw = mix( 0.035, 0.55, pow( uvq.y, 2.4 ) ) * ( 0.9 + 0.2 * frNoise( vec2f( uvq.y * 18.0 - frame.time * 2.0, 1.0 ) ) );
		let fs = smoothstep( hw, hw * 0.55, x ) * smoothstep( 1.0, 0.82, uvq.y );
		let spray = smoothstep( 0.22, 0.0, uvq.y ) * smoothstep( 0.35, 0.05, x ) * 0.6;
		a *= max( fs * 0.85, spray );
		col = grey * mix( 0.24, 0.45, spray );

	}

	col = mix( col, frame.horizonColor * 0.55, haze * 0.75 );
	a = clamp( a, 0.0, 0.97 );
	if ( a < 0.003 ) { discard; }
	s.albedo = col * a;
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
		this.mesh.name = 'StormFront';
		this.mesh.frustumCulled = false;
		this.mesh.castShadow = false;
		this.mesh.receiveShadow = false;
		this.mesh.renderOrder = 21;
		this.mesh.layers.set( LAYERS.TRANSPARENT );
		this.mesh.visible = false;
		this._flash = 0;

	}

	update( dt, camera, front, A, { strength = 1, inside = 0, spout = null, flash = null } = {} ) {

		const u = this.u;
		const on = !! front && !! camera && camera.position.y > - 0.5;
		this.mesh.visible = on;
		if ( ! on ) { this.geometry.instanceCount = 0; return; }
		const N = this.segments;
		this.geometry.instanceCount = 2 * N + ( spout && spout.life > 0.01 ? 1 : 0 );
		u.dir.value.set( front.dir.x, front.dir.z );
		u.lat.value.set( front.lat.x, front.lat.z );
		u.ph.value.set( front.p1, front.p2 );
		u.edge.value = edgeOffset( front, A );
		const dx = camera.position.x - FRONT.center.x, dz = camera.position.z - FRONT.center.z;
		// the camera's lateral place, snapped to whole segments (the strip does not swim as the camera moves)
		const v = dx * front.lat.x + dz * front.lat.z;
		u.vCam.value = Math.round( v / this.segLength ) * this.segLength;
		u.strength.value = clamp( strength, 0, 1 );
		u.inside.value = clamp( inside, 0, 1 );
		if ( flash && flash.amount > 0 ) {

			this._flash = Math.max( this._flash, flash.amount );
			u.flash.value.y = ( flash.x - FRONT.center.x ) * front.lat.x + ( flash.z - FRONT.center.z ) * front.lat.z;

		}

		this._flash = Math.max( 0, this._flash - dt * 4 );
		u.flash.value.x = this._flash;
		if ( spout ) u.spout.value.set( spout.x, spout.z, spout.r, spout.life );
		else u.spout.value.set( 0, 0, 0, 0 );

	}

	dispose() {

		try {

			if ( this.mesh.parent ) this.mesh.parent.remove( this.mesh );
			if ( this.geometry.dispose ) this.geometry.dispose();

		} catch ( e ) { /* already gone */ }

		this.mesh.visible = false;

	}

}

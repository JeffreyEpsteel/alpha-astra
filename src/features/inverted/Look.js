// The inverted layer's sky: the "dark void" over the islets and the yellow Easter-egg world, done without engine
// edits through two existing knobs:
//   haze   app.haze.density (AirHaze): multiplied while a look is on (HazeLink keeps the base value it found, so the
//          weather, which writes the density absolutely, and the settings slider stay in charge of the base)
//   veil   a camera-centred dome drawn in the transparent pass: a gradient from the horizon to the zenith that tints
//          the sky and whatever stands beyond ~1.5 km (dark navy for the void, gold for the yellow preset)
// The scene's exposure is not touched (the weather treats any other writer's exposure as its new base).
//
//   PRESETS.off / void / yellow            lookFor( { enabled, proximity, egg } ) -> a blended look
//   const veil = new Veil(); scene.add( veil.mesh ); veil.apply( look );     new HazeLink().apply( app, look.haze )

import { Mesh } from '../../engine/scene/Mesh.js';
import { SphereGeometry } from '../../engine/geometry/index.js';
import { Material } from '../../engine/render/Material.js';
import { LAYERS } from '../../engine/render/SceneRenderer.js';
import { Vector3 } from '../../engine/math/index.js';

const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );

// top / horizon: linear colours of the veil; alpha at the zenith and at the horizon; below: alpha under the horizon
// (the far sea); gold: the islets' golden tint; haze: the haze density multiplier
export const PRESETS = {
	off: { top: [ 0, 0, 0 ], horizon: [ 0, 0, 0 ], alpha: 0, horizonAlpha: 0, below: 0, gold: 0, haze: 1 },
	void: { top: [ 0.004, 0.006, 0.018 ], horizon: [ 0.05, 0.06, 0.085 ], alpha: 0.72, horizonAlpha: 0.06, below: 0.02, gold: 0, haze: 1.25 },
	yellow: { top: [ 1.0, 0.68, 0.08 ], horizon: [ 1.0, 0.82, 0.3 ], alpha: 0.62, horizonAlpha: 0.38, below: 0.22, gold: 1, haze: 1.6 },
};

const lerp = ( a, b, t ) => a + ( b - a ) * t;
const lerp3 = ( a, b, t ) => [ lerp( a[ 0 ], b[ 0 ], t ), lerp( a[ 1 ], b[ 1 ], t ), lerp( a[ 2 ], b[ 2 ], t ) ];

export function blendLook( a, b, t ) {

	t = clamp( t, 0, 1 );
	return {
		top: lerp3( a.top, b.top, t ), horizon: lerp3( a.horizon, b.horizon, t ),
		alpha: lerp( a.alpha, b.alpha, t ), horizonAlpha: lerp( a.horizonAlpha, b.horizonAlpha, t ), below: lerp( a.below, b.below, t ),
		gold: lerp( a.gold, b.gold, t ), haze: lerp( a.haze, b.haze, t ),
	};

}

// enabled: the layer is on; proximity 0..1 (Layout.proximity: how much sky the islets fill); egg 0..1 the yellow
// preset's weight (it covers the whole world while it lasts). The void never goes fully away while the layer is on.
export function lookFor( { enabled = false, proximity = 0, egg = 0 } = {} ) {

	if ( ! enabled ) return blendLook( PRESETS.off, PRESETS.off, 0 );
	const v = blendLook( PRESETS.off, PRESETS.void, 0.35 + 0.65 * clamp( proximity, 0, 1 ) );
	return blendLook( v, PRESETS.yellow, egg );

}

// multiplies app.haze.density without owning it: the value found there is the base unless it is the one written
// here last time (then nobody else moved it)
export class HazeLink {

	constructor() {

		this.base = null;
		this.last = null;

	}

	apply( app, mul ) {

		const d = app && app.haze && app.haze.density;
		if ( ! d || ! Number.isFinite( d.value ) ) return false;
		const idle = Math.abs( mul - 1 ) < 1e-3;
		if ( idle && this.last === null ) return false;
		if ( this.last === null || Math.abs( d.value - this.last ) > 1e-6 ) this.base = d.value;
		if ( idle ) {

			// hand the base back once and let go
			d.value = this.base;
			this.last = null;
			return true;

		}

		d.value = this.last = this.base * mul;
		return true;

	}

	release( app ) {

		this.apply( app, 1 );

	}

}

export const VEIL_RADIUS = 1500; // m: inside the 2 km far plane; things farther away are tinted

export class Veil {

	constructor() {

		this.material = new Material( {
			name: 'InvertedVeil',
			lit: false,
			transparent: true,
			depthWrite: false,
			depthTest: true,
			side: 'double',
			blending: 'normal',
			velocityWeight: 0,
			underwaterLighting: 'none',
			receiveShadows: false,
			uniforms: {
				top: [ 'vec3f', new Vector3() ], horizon: [ 'vec3f', new Vector3() ],
				alphaTop: [ 'f32', 0 ], alphaHorizon: [ 'f32', 0 ], alphaBelow: [ 'f32', 0 ], radius: [ 'f32', VEIL_RADIUS ],
			},
			varyings: { vDir: 'vec3f' },
			vertex: /* wgsl */`
	let d = normalize( v.position );
	o.vDir = d;
	v.useWorld = true;
	v.worldPos = frame.cameraPos + d * mat.radius;
	v.worldNormal = - d;
	v.prevWorldPos = v.worldPos;
`,
			surface: /* wgsl */`
	let d = normalize( in.vs.vDir );
	let up = smoothstep( 0.0, 0.75, d.y );
	let col = mix( mat.horizon, mat.top, up );
	var a = mix( mat.alphaHorizon, mat.alphaTop, smoothstep( 0.02, 0.55, d.y ) );
	if ( d.y < 0.0 ) { a = mix( mat.alphaHorizon, mat.alphaBelow, smoothstep( 0.0, -0.08, d.y ) ); }
	if ( a < 0.002 ) { discard; }
	s.albedo = col;
	s.alpha = a;
`,
			output: 'r.color = vec4f( s.albedo, s.alpha );',
		} );
		this.geometry = new SphereGeometry( 1, 32, 16 );
		this.mesh = new Mesh( this.geometry, this.material );
		this.mesh.name = 'InvertedVeil';
		this.mesh.frustumCulled = false;
		this.mesh.castShadow = false;
		this.mesh.receiveShadow = false;
		this.mesh.renderOrder = 21;
		this.mesh.layers.set( LAYERS.TRANSPARENT );
		this.mesh.visible = false;

	}

	apply( look, underwater = false ) {

		const u = this.material.uniforms;
		u.top.value.set( look.top[ 0 ], look.top[ 1 ], look.top[ 2 ] );
		u.horizon.value.set( look.horizon[ 0 ], look.horizon[ 1 ], look.horizon[ 2 ] );
		u.alphaTop.value = look.alpha;
		u.alphaHorizon.value = look.horizonAlpha;
		u.alphaBelow.value = look.below;
		this.mesh.visible = ! underwater && ( look.alpha > 0.003 || look.horizonAlpha > 0.003 );

	}

	dispose() {

		try {

			if ( this.mesh.parent ) this.mesh.parent.remove( this.mesh );
			if ( this.geometry.dispose ) this.geometry.dispose();

		} catch ( e ) { /* already gone */ }

	}

}

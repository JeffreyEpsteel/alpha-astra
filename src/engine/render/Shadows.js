import { Texture } from '../gpu/Texture.js';
import { ShadowUniforms, setShadowMap } from './wgsl/lighting.js';
import { createViewUniforms, setFrameCamera } from './Frame.js';
import { Matrix4, Vector3, Vector4 } from '../math/index.js';

// Cascaded sun shadow maps (replaces three's CSMShadowNode + SunShadowFilter).
//
// Cascades are fitted to bounding spheres of slices of the main camera frustum (stable under
// rotation) and snapped to their texel grid (no shimmer when moving). Near cascade every frame,
// the next every 2nd, the rest every 4th; a cascade's matrix only changes when its map is rendered.
// Depth is standard (0 near .. 1 far) with an orthographic projection; the lighting module samples
// it with PCSS on the near cascade and a 5-tap PCF elsewhere; the soft level (Medium and up, wave 18F) adds a lighter
// PCSS on the second cascade and bilinear comparison taps (setSoft, `periods`).
//
// Perf (src/core/Quality.js): setSize( texels ) re-makes the map, setReach( m ) moves the last split (the middle
// one follows), and each cascade skips casters smaller than about a texel (their shadow is a blur of 1-2 texels).
// The sun "moved" test compares with the sun of the last full refit, not of the last frame, and only a jump (0.3°)
// counts: at low frame rates the per-frame step of the day's sun exceeded the old 1e-4 rad threshold and every
// cascade re-rendered every frame (at 24 fps: 3 shadow passes a frame instead of 1.75).

const _corners = [];
for ( let i = 0; i < 8; i ++ ) _corners.push( new Vector3() );
const _center = new Vector3();
const _up = new Vector3( 0, 1, 0 );
const _inv = new Matrix4();
const _tmp = new Vector3();
const _tmp4 = new Vector4();

export class SunShadows {

	constructor( { size = 2048, splits = [ 10, 60, 400 ], lightMargin = 200, normalBias = [ 0.015, 0.06, 0.3 ], bias = 0.00002, pcssCascades = 1 } = {} ) {

		this.size = size;
		this.splits = splits;
		this.count = splits.length;
		this.lightMargin = lightMargin;
		this.normalBias = normalBias;
		this._softAuto = true; // until setSoft(): follows the refit periods Quality sets (see `periods`)
		this._periods = splits.map( ( _, i ) => i === 0 ? 1 : i === 1 ? 2 : 4 );
		this.texture = new Texture( { label: 'sunShadowMap', width: size, height: size, depth: this.count, dimension: '2d-array', format: 'depth32float', usage: [ 'sample', 'render' ] } );
		setShadowMap( this.texture );
		this.cascades = splits.map( ( _, i ) => ( {
			camera: {
				matrixWorld: new Matrix4(), matrixWorldInverse: new Matrix4(), projectionMatrix: new Matrix4(),
				near: 0, far: 1, reversedDepth: false, updateMatrixWorld() {}, isCamera: true, isShadowCamera: true,
			},
			block: createViewUniforms( 'shadowView' + i ),
			viewProj: new Matrix4(),
			radius: 0,
			dirty: true,
		} ) );
		this.enabled = true;
		this.layerMask = 0xffffffff;
		this.frame = 0;
		this.lastSun = new Vector3( 0, - 2, 0 );
		this.baseSplits = splits.slice();
		this.minTexels = 0.75; // casters with a bounding radius under this many texels are skipped
		const U = ShadowUniforms.fields;
		U.count.value = this.count;
		U.mapSize.value = size;
		U.bias.value = bias;
		U.pcssCascades.value = pcssCascades;
		U.enabled.value = 1;
		this._autoSoft();

	}

	// how often each cascade re-renders (frames). Quality (src/core/Quality.js apply) sets [ 1, 2, 4 ] on Medium and up,
	// [ 1, 4, 8 ] on Low and tablets, [ 1, 6, 12 ] on phones: until setSoft() is called the filter level follows it
	get periods() { return this._periods; }
	set periods( v ) {

		this._periods = v;
		this._autoSoft();

	}

	_autoSoft() {

		if ( ! this._softAuto ) return;
		const p = this._periods;
		ShadowUniforms.fields.soft.value = ! globalThis.__phoneBudget && p && p[ 1 ] <= 2 ? 1 : 0;

	}

	// filter level (wave 18F): 0 = the filters as before (5-tap PCF, contact hardening on the near cascade), 1 = soft
	// (bilinear taps, contact hardening on the second cascade too, a wider PCF beyond); null = follow the tier again
	setSoft( level ) {

		this._softAuto = level === null || level === undefined;
		if ( this._softAuto ) this._autoSoft();
		else ShadowUniforms.fields.soft.value = level > 0 ? 1 : 0;

	}

	get soft() { return ShadowUniforms.fields.soft.value; }

	// strength of the golden hour rim light on characters (lighting.js CHARACTER_RIM; 0 = off)
	get rim() { return ShadowUniforms.fields.rim.value; }
	set rim( v ) { ShadowUniforms.fields.rim.value = v; }

	// seam blend band (m) at view distance d (SoftCSMShadowNode: max( 0.25 e^2, 0.25 e ) of the normalized
	// break e, times the shadow distance): 2.5 m at the 10 m seam, 15 m at 60 m, 100 m fade-out at 400 m
	_margin( d ) {

		const far = this.splits[ this.count - 1 ];
		const e = d / far;
		return Math.max( 0.25 * e * e, 0.25 * e ) * far;

	}

	// Fit cascade i to the view-distance slice [ near, far ] of `camera`, widened by half the seam blend
	// bands so the overlapping cascades both cover them.
	_fit( i, camera, sunDir ) {

		const c = this.cascades[ i ];
		const x = i === 0 ? 0 : this.splits[ i - 1 ];
		const y = this.splits[ i ];
		const mN = this._margin( x ), mF = this._margin( y );
		const near = Math.max( camera.near, x - mN * 0.5 );
		const far = i === this.count - 1 ? y : y + mF * 0.5;
		ShadowUniforms.fields.blend.value[ i ] = new Vector4( x, y, mN, mF );
		// slice corners in world space (perspective: scale the unit frustum by distance)
		const tanY = Math.tan( camera.fov * Math.PI / 360 );
		const tanX = tanY * camera.aspect;
		let k = 0;
		for ( const d of [ near, far ] ) for ( const sx of [ - 1, 1 ] ) for ( const sy of [ - 1, 1 ] ) {

			_corners[ k ++ ].set( sx * tanX * d, sy * tanY * d, - d ).applyMatrix4( camera.matrixWorld );

		}

		// bounding sphere of the slice: centre on the axis, radius to the farthest corner
		const zc = Math.min( far, ( near + far ) / 2 * ( 1 + tanX * tanX + tanY * tanY ) );
		_center.set( 0, 0, - zc ).applyMatrix4( camera.matrixWorld );
		let r = 0;
		for ( const p of _corners ) r = Math.max( r, p.distanceTo( _center ) );
		r = Math.ceil( r * 16 ) / 16; // quantised: the texel size stays fixed while the camera turns
		c.radius = r;

		// light view looking along -sunDir, snapped to texels
		const cam = c.camera;
		const L = sunDir;
		const up = Math.abs( L.y ) > 0.99 ? _tmp.set( 1, 0, 0 ) : _up;
		cam.matrixWorld.lookAt( L, new Vector3( 0, 0, 0 ), up ); // rotation only: z axis = sunDir
		_inv.copy( cam.matrixWorld ).invert();
		const texel = 2 * r / this.size;
		const ls = _tmp4.set( _center.x, _center.y, _center.z, 1 ).applyMatrix4( _inv );
		ls.x = Math.round( ls.x / texel ) * texel;
		ls.y = Math.round( ls.y / texel ) * texel;
		const back = r + this.lightMargin;
		// eye = snapped centre moved back toward the sun
		const eye = new Vector3( ls.x, ls.y, ls.z + back ).applyMatrix4( cam.matrixWorld );
		cam.matrixWorld.setPosition( eye );
		cam.matrixWorldInverse.copy( cam.matrixWorld ).invert();
		const n = 0.1, f = back + r;
		cam.near = n;
		cam.far = f;
		orthoStandardZ( cam.projectionMatrix, - r, r, r, - r, n, f );
		c.viewProj.multiplyMatrices( cam.projectionMatrix, cam.matrixWorldInverse );

		const U = ShadowUniforms.fields;
		U.matrices.value[ i ] = c.viewProj.clone();
		U.cascades.value[ i ] = new Vector4( far, texel, this.normalBias[ i ] ?? 0.05, f - n );

	}

	// Decide which cascades re-render this frame and fit them. Returns the list of indices.
	update( camera, sunDir ) {

		this.frame ++;
		ShadowUniforms.fields.enabled.value = this.enabled && sunDir.y > - 0.05 ? 1 : 0;
		if ( ! this.enabled ) return [];
		camera.updateMatrixWorld();
		const sunMoved = this.lastSun.angleTo( sunDir ) > 5e-3; // a jump (time slider, the clock): the periodic refits follow the slow drift
		if ( sunMoved ) this.lastSun.copy( sunDir ); // (the reference only moves on a full refit)
		const out = [];
		for ( let i = 0; i < this.count; i ++ ) {

			if ( sunMoved || this.cascades[ i ].dirty || ( this.frame + i ) % this.periods[ i ] === 0 ) {

				this._fit( i, camera, sunDir );
				this.cascades[ i ].dirty = false;
				out.push( i );

			}

		}

		return out;

	}

	// shadow map resolution (texels per side); the next update refits and re-renders every cascade
	setSize( size ) {

		size = Math.max( 256, size | 0 );
		if ( size === this.size ) return;
		this.size = size;
		this.texture.resize( size, size ); // (the cascades stay its layers)
		ShadowUniforms.fields.mapSize.value = size;
		for ( const c of this.cascades ) c.dirty = true;

	}

	// how far the shadows reach (m): the last split; the middle split keeps its share of the default layout
	setReach( far ) {

		const b = this.baseSplits;
		far = Math.max( b[ 0 ] * 3, Math.min( b[ b.length - 1 ] * 1.5, far ) );
		const k = far / b[ b.length - 1 ];
		const next = b.map( ( v, i ) => ( i === 0 ? v : i === b.length - 1 ? far : Math.max( b[ 0 ] * 2, v * Math.sqrt( k ) ) ) );
		if ( next.every( ( v, i ) => v === this.splits[ i ] ) ) return;
		this.splits = next;
		for ( const c of this.cascades ) c.dirty = true;

	}

	render( scene, meshRenderer, indices ) {

		for ( const i of indices ) {

			const c = this.cascades[ i ];
			const texel = 2 * c.radius / this.size;
			setFrameCamera( c.camera, this.size, this.size, { block: c.block } );
			meshRenderer.render( scene, {
				label: 'shadow cascade ' + i,
				kind: 'depth',
				camera: c.camera,
				frameBlock: c.block,
				depthView: this.texture.view( { dimension: '2d', baseArrayLayer: i, arrayLayerCount: 1 } ),
				depthFormat: 'depth32float',
				clearDepth: 1,
				depthCompare: 'less-equal',
				layerMask: this.layerMask,
				depthBias: 2,
				depthBiasSlopeScale: 1.5,
				minRadius: texel * this.minTexels,
			} );

		}

	}

}

// orthographic projection, WebGPU clip z in [0, 1] with 0 at the near plane
export function orthoStandardZ( m, left, right, top, bottom, near, far ) {

	const w = 1 / ( right - left ), h = 1 / ( top - bottom ), p = 1 / ( far - near );
	m.set(
		2 * w, 0, 0, - ( right + left ) * w,
		0, 2 * h, 0, - ( top + bottom ) * h,
		0, 0, - p, - near * p,
		0, 0, 0, 1,
	);
	return m;

}

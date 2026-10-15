// Ground decals (docs/UNREAL_PARITY.md W6): puddles that gather after rain and dry out again, and footprints that the
// player leaves on the sand (fading, washed out by the waves and the rain).
//
//   puddleSites( terrain, colliders, { centres, rng } ) -> [ { x, y, z, r, seed, nx, nz } ]   flat, open ground (pure)
//   const p = new Puddles( sites );  p.update( dt, rain 0..1 )  p.wet 0..1  p.mesh
//   const f = new Footprints( { capacity } );  f.update( dt, { player, terrain, colliders, rain } )  f.count  f.mesh
//   onSand( terrain, colliders, x, y, z ) -> bool
//
// Both are one instanced draw each in the transparent pass: puddles are a dark, mirror-smooth lit film (the sky's
// reflection is what reads); footprints darken the sand under them (premultiplied black, like the contact shadows).
// Each decal lies on the local slope (two height differences per site, baked into the instance data).

import { Mesh } from '../../engine/scene/Mesh.js';
import { PlaneGeometry, InstancedBufferAttribute } from '../../engine/geometry/index.js';
import { Material } from '../../engine/render/Material.js';
import { LAYERS } from '../../engine/render/SceneRenderer.js';
import { Vector2 } from '../../engine/math/index.js';

const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );

export const FILL_SECONDS = 100; // steady rain to full puddles
export const DRY_SECONDS = 420; // full puddles drying out after the rain stops

function slopeAt( T, x, z ) {

	const e = 0.6;
	return [ ( T.heightAt( x + e, z ) - T.heightAt( x - e, z ) ) / ( 2 * e ), ( T.heightAt( x, z + e ) - T.heightAt( x, z - e ) ) / ( 2 * e ) ];

}

// flat open ground near the given centres: off the beach (puddles there would be the sea's), clear of buildings and
// decks (nothing solid within 1.5 m above), slope under ~4 degrees, spaced apart
export function puddleSites( T, colliders = null, { centres = [], rng = Math.random, max = 40, tries = 900 } = {} ) {

	const out = [];
	if ( ! T || ! centres.length ) return out;
	for ( let k = 0; k < tries && out.length < max; k ++ ) {

		const c = centres[ k % centres.length ];
		const a = rng() * Math.PI * 2, d = Math.sqrt( rng() ) * c.r;
		const x = c.x + Math.cos( a ) * d, z = c.z + Math.sin( a ) * d;
		const h = T.heightAt( x, z );
		if ( h < 2.2 || h > 40 ) continue;
		const [ nx, nz ] = slopeAt( T, x, z );
		if ( Math.hypot( nx, nz ) > 0.07 ) continue;
		if ( colliders && typeof colliders.groundHeightAt === 'function' && colliders.groundHeightAt( x, z, h + 1.5 ) > h + 0.05 ) continue;
		if ( colliders && blockedAt( colliders, x, z, h ) ) continue;
		const r = 0.6 + rng() * 1.2;
		if ( out.some( ( q ) => Math.hypot( q.x - x, q.z - z ) < q.r + r + 1.5 ) ) continue;
		out.push( { x, y: h, z, r, seed: rng(), nx, nz } );

	}

	return out;

}

// something solid standing at ( x, z ) at ground height (walls, poles, rocks)
function blockedAt( C, x, z, y ) {

	for ( const c of C.cylinders || [] ) if ( c.yMin < y + 1 && c.yMax > y && Math.hypot( x - c.x, z - c.z ) < c.radius + 0.8 ) return true;
	for ( const b of C.boxes || [] ) {

		if ( ! b.solid || b.bottom > y + 1 || b.top < y ) continue;
		const dx = x - b.center.x, dz = z - b.center.z;
		const cs = Math.cos( b.rotY || 0 ), sn = Math.sin( b.rotY || 0 );
		const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
		if ( Math.abs( lx ) < b.half.x + 0.8 && Math.abs( lz ) < b.half.z + 0.8 ) return true;

	}

	return false;

}

// ---------------------------------------------------------------------------------------------- puddles

export class Puddles {

	constructor( sites ) {

		this.sites = sites;
		this.wet = 0;
		const n = Math.max( 1, sites.length );
		const geo = new PlaneGeometry( 2, 2 );
		this.pA = new InstancedBufferAttribute( new Float32Array( n * 4 ), 4 ); // x, y, z, radius
		this.pB = new InstancedBufferAttribute( new Float32Array( n * 4 ), 4 ); // slope x, slope z, seed, -
		sites.forEach( ( s, i ) => {

			this.pA.array.set( [ s.x, s.y, s.z, s.r ], i * 4 );
			this.pB.array.set( [ s.nx, s.nz, s.seed, 0 ], i * 4 );

		} );
		geo.setAttribute( 'pA', this.pA );
		geo.setAttribute( 'pB', this.pB );
		geo.instanceCount = sites.length;
		this.material = new Material( {
			name: 'Puddles',
			side: 'double', // (the plane's xy is laid on the ground's xz: its winding faces down)
			transparent: true,
			depthWrite: false,
			blending: 'normal',
			velocityWeight: 0,
			roughness: 0.03,
			metalness: 0,
			color: [ 0.05, 0.055, 0.06 ],
			uniforms: { wet: [ 'f32', 0 ], rain: [ 'f32', 0 ] },
			attributes: { pA: 'vec4f', pB: 'vec4f' },
			varyings: { vPud: 'vec4f' },
			vertex: /* wgsl */`
	let A = v.pA; let B = v.pB;
	let q = v.position.xy * A.w;
	o.vPud = vec4f( v.position.xy, B.z, A.w );
	v.useWorld = true;
	v.worldPos = vec3f( A.x + q.x, A.y + q.x * B.x + q.y * B.y + 0.018, A.z + q.y );
	v.worldNormal = vec3f( 0.0, 1.0, 0.0 );
	v.prevWorldPos = v.worldPos;
`,
			surface: /* wgsl */`
	let P = in.vs.vPud;
	let ang = atan2( P.y, P.x );
	// a ragged edge: the puddle grows from its deepest point as the ground gets wetter
	let edge = 0.6 + 0.07 * sin( ang * 2.0 + P.z * 20.0 ) + 0.05 * sin( ang * 3.0 + P.z * 33.0 ) + 0.025 * sin( ang * 7.0 + P.z * 41.0 );
	let r = length( P.xy ) / max( edge, 0.2 );
	let fill = sqrt( mat.wet );
	let a = smoothstep( fill, fill - 0.18, r ) * smoothstep( 0.02, 0.15, mat.wet );
	if ( a < 0.01 ) { discard; }
	// rain rings: a few expanding ripples tilt the normal while it rains
	let w = in.P.xz * 3.1;
	let ring = sin( length( fract( w ) - 0.5 ) * 40.0 - frame.time * 9.0 ) * mat.rain * 0.08;
	s.normal = normalize( vec3f( ring, 1.0, ring * 0.7 ) );
	s.alpha = a * 0.85;
`,
		} );
		this.mesh = new Mesh( geo, this.material );
		this.mesh.name = 'Puddles';
		this.mesh.frustumCulled = false;
		this.mesh.castShadow = false;
		this.mesh.receiveShadow = true;
		this.mesh.renderOrder = - 1;
		this.mesh.layers.set( LAYERS.TRANSPARENT );
		this.mesh.visible = false;

	}

	update( dt, rain = 0 ) {

		rain = clamp( rain, 0, 1 );
		if ( rain > 0.05 ) this.wet = Math.min( 1, this.wet + dt * rain / ( FILL_SECONDS * 0.6 ) );
		else this.wet = Math.max( 0, this.wet - dt / DRY_SECONDS );
		const u = this.material.uniforms;
		u.wet.value = this.wet;
		u.rain.value = rain;
		this.mesh.visible = this.wet > 0.02 && this.sites.length > 0;

	}

	dispose() {

		if ( this.mesh.parent ) this.mesh.parent.remove( this.mesh );

	}

}

// ---------------------------------------------------------------------------------------------- footprints

export const STRIDE = 0.72; // m between prints (one foot, then the other)
export const LIFE = 90; // s a print lasts on dry sand

// on the sand: walking on the ground (no deck under the feet) on the beach band above the waterline
export function onSand( T, colliders, x, y, z ) {

	if ( ! T ) return false;
	const h = T.heightAt( x, z );
	if ( h < - 0.2 || h > 3.2 ) return false;
	if ( y - h > 0.25 ) return false;
	if ( colliders && typeof colliders.groundHeightAt === 'function' && colliders.groundHeightAt( x, z, y + 0.3 ) > h + 0.1 ) return false;
	return true;

}

export class Footprints {

	constructor( { capacity = 96 } = {} ) {

		this.capacity = capacity;
		this.count = 0; // prints laid so far (the ring holds the last `capacity`)
		this.t = 0;
		this._last = null;
		this._foot = 1;
		const geo = new PlaneGeometry( 2, 2 );
		this.fA = new InstancedBufferAttribute( new Float32Array( capacity * 4 ), 4 ); // x, y, z, yaw
		this.fB = new InstancedBufferAttribute( new Float32Array( capacity * 4 ).fill( - 1e6 ), 4 ); // birth, life, slope x, slope z
		geo.setAttribute( 'fA', this.fA );
		geo.setAttribute( 'fB', this.fB );
		geo.instanceCount = 0;
		this.geometry = geo;
		this.material = new Material( {
			name: 'Footprints',
			side: 'double',
			lit: false,
			transparent: true,
			blending: 'premultiplied',
			depthWrite: false,
			velocityWeight: 0,
			receiveShadows: false,
			uniforms: { now: [ 'f32', 0 ], size: [ 'vec2f', new Vector2( 0.06, 0.135 ) ] },
			attributes: { fA: 'vec4f', fB: 'vec4f' },
			varyings: { vFoot: 'vec4f' },
			vertex: /* wgsl */`
	let A = v.fA; let B = v.fB;
	let q0 = v.position.xy * mat.size;
	let cy = cos( A.w ); let sy = sin( A.w );
	let q = vec2f( q0.x * cy + q0.y * sy, - q0.x * sy + q0.y * cy );
	let age = mat.now - B.x;
	o.vFoot = vec4f( v.position.xy, clamp( 1.0 - age / max( B.y, 0.01 ), 0.0, 1.0 ), 0.0 );
	v.useWorld = true;
	let alive = age >= 0.0 && age < B.y;
	v.worldPos = select( vec3f( 0.0, -1e5, 0.0 ), vec3f( A.x + q.x, A.y + q.x * B.z + q.y * B.w + 0.012, A.z + q.y ), alive );
	v.worldNormal = vec3f( 0.0, 1.0, 0.0 );
	v.prevWorldPos = v.worldPos;
`,
			surface: /* wgsl */`
	let F = in.vs.vFoot;
	// a sole (front) and a heel (back), soft edged
	let sole = length( vec2f( F.x * 1.0, ( F.y - 0.28 ) * 1.55 ) );
	let heel = length( vec2f( F.x * 1.15, ( F.y + 0.55 ) * 2.2 ) );
	let m = max( smoothstep( 0.95, 0.6, sole ), smoothstep( 0.95, 0.55, heel ) );
	let a = m * 0.4 * F.z * F.z;
	if ( a < 0.004 ) { discard; }
	s.albedo = vec3f( 0.0 );
	s.emissive = vec3f( 0.0 );
	s.alpha = a;
`,
		} );
		this.mesh = new Mesh( geo, this.material );
		this.mesh.name = 'Footprints';
		this.mesh.frustumCulled = false;
		this.mesh.castShadow = false;
		this.mesh.receiveShadow = false;
		this.mesh.renderOrder = - 1;
		this.mesh.layers.set( LAYERS.TRANSPARENT );

	}

	// lay one print (left / right of the walking line); life shortens near the waterline and in the rain
	add( x, y, z, yaw, { terrain = null, rain = 0 } = {} ) {

		const i = this.count % this.capacity;
		const side = this._foot = - this._foot;
		const px = x + Math.cos( yaw ) * 0.11 * side, pz = z - Math.sin( yaw ) * 0.11 * side;
		const h = terrain ? terrain.heightAt( px, pz ) : y;
		const s = terrain ? slopeAt( terrain, px, pz ) : [ 0, 0 ];
		const wave = h < 0.6 ? 0.12 : 1; // the swash takes the low ones in seconds
		const life = LIFE * wave * ( 1 - 0.75 * clamp( rain, 0, 1 ) );
		this.fA.array.set( [ px, h, pz, yaw ], i * 4 );
		this.fB.array.set( [ this.t, life, s[ 0 ], s[ 1 ] ], i * 4 );
		this.fA.needsUpdate = true;
		this.fB.needsUpdate = true;
		this.count ++;
		this.geometry.instanceCount = Math.min( this.count, this.capacity );
		return i;

	}

	alive() {

		let n = 0;
		const B = this.fB.array;
		for ( let i = 0; i < Math.min( this.count, this.capacity ); i ++ ) if ( this.t - B[ i * 4 ] < B[ i * 4 + 1 ] ) n ++;
		return n;

	}

	update( dt, { player = null, terrain = null, colliders = null, rain = 0 } = {} ) {

		this.t += Math.max( 0, dt );
		this.material.uniforms.now.value = this.t;
		const p = player;
		if ( ! p || ! p.position || p.mode !== 'walk' ) { this._last = null; return; }
		const x = p.position.x, y = p.position.y, z = p.position.z;
		if ( ! onSand( terrain, colliders, x, y, z ) ) { this._last = null; return; }
		if ( ! this._last ) { this._last = { x, z }; return; }
		const dx = x - this._last.x, dz = z - this._last.z, d = Math.hypot( dx, dz );
		if ( d < STRIDE ) return;
		if ( d > STRIDE * 6 ) { this._last = { x, z }; return; } // a teleport, not a walk
		this.add( x, y, z, Math.atan2( dx, dz ), { terrain, rain } );
		this._last = { x, z };

	}

	dispose() {

		if ( this.mesh.parent ) this.mesh.parent.remove( this.mesh );

	}

}

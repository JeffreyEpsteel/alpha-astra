import { Group, Mesh, Vector3, Color, BufferGeometry, Float32BufferAttribute } from '../../engine/index.js';
import { Material } from '../../engine/render/Material.js';
import { ShaderModule } from '../../engine/gpu/Shader.js';
import { LAYERS } from '../../engine/render/SceneRenderer.js';
import { prepare, mergePrepared, box, cylinder, sphere, rod, mat4 } from '../boat/GeoKit.js';
import { createPropMaterial } from '../../game/GameMaterials.js';
import { WORLD } from '../WorldLayout.js';
import { ISLETS_BY_ID, isletWorld } from '../terrain/IslandShape.js';
import { buildJetty } from './Jetty.js';
import { WOOD, STONE, rng, frameAt, palm, lantern, cullParts } from './IslandKit.js';

// The Inverted Isles, far to the south-west (terrain/IslandShape.js ISLES_5_8 'inverted'): the Unreal game's
// inverted world (TASKS.md milestone 2: suspended islands overhead, hanging roots, upward waterfalls, huge
// inverted silhouettes on the horizon) over a low sand atoll and its calm lagoon (WORLD.inverted.lagoon; a
// seaplane can land in it, boats come in through the dredged gap in the ring).
//
// Above the lagoon float SKY_ISLES: upside-down islands, their grassy ground facing the sea with trees hanging
// from it, their rocky underside a jagged cone pointing at the sky; roots dangle and sway beneath them. Water
// falls upward: columns rise from the lagoon into the two largest isles and sheets pour off the rims into the
// sky (a scrolling transparent material, no particles).
//
//   const isles = new InvertedIsles( { scene, terrain, colliders } );
//   isles.group, isles.lights, isles.update( dt )   isles.sky: [ { x, y, z, r } ] (world, y = the ground face)
//   isles.lagoon (WORLD.inverted.lagoon)   isles.falls: number of waterfalls   isles.roots: number of roots
//
// Cost: the sky isles, their roots and trees are ONE merged mesh (~20 k triangles, sway in the vertex shader)
// and the falls one transparent mesh, both drawn out to FAR (they are meant to be seen on the horizon from the
// main island); the atoll's props (jetty, palms, markers) are culled beyond NEAR. Nothing up there collides:
// the lowest root tip stays far above head height over the lagoon.

const I = ISLETS_BY_ID.inverted;
const D = WORLD.inverted.dock;
const NEAR = 700;
const FAR = 3000;

// the suspended isles in island coordinates: [ u, v, height of the ground face, radius, yaw ]
export const SKY_ISLES = [
	[ 10, 0, 88, 34, 0.3 ], [ - 58, 42, 58, 18, 1.7 ], [ 52, - 48, 68, 22, 4.1 ], [ - 34, - 58, 108, 14, 2.6 ], [ 76, 52, 122, 26, 5.3 ],
	[ - 92, - 8, 84, 9, 0.9 ], [ 20, 74, 46, 6, 2.2 ], [ 104, - 16, 96, 7, 3.4 ], [ - 10, - 96, 136, 8, 1.1 ], [ 46, 18, 150, 5, 0.5 ],
];

const lin = ( hex ) => new Color().set( hex );

const fallModule = new ShaderModule( {
	name: 'upwardFalls',
	code: /* wgsl */`
fn ufHash( p: vec2f ) -> f32 { return fract( sin( dot( p, vec2f( 127.1, 311.7 ) ) ) * 43758.5453 ); }
fn ufNoise( p: vec2f ) -> f32 {
	let i = floor( p ); let f = fract( p ); let u = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( ufHash( i ), ufHash( i + vec2f( 1.0, 0.0 ) ), u.x ), mix( ufHash( i + vec2f( 0.0, 1.0 ) ), ufHash( i + vec2f( 1.0, 1.0 ) ), u.x ), u.y );
}
`,
} );

export class InvertedIsles {

	constructor( { scene, terrain, colliders = null, material = null } ) {

		this.terrain = terrain;
		this.material = material || createPropMaterial( 'invertedAtoll' );
		this.group = new Group();
		this.group.name = 'InvertedIsles';
		scene.add( this.group );
		this.lights = [];
		this.center = new Vector3( I.x, 0, I.z );
		this.lagoon = WORLD.inverted.lagoon;

		// the atoll: jetty, palms, channel markers, a cairn
		const P = [];
		const add = ( g, o ) => P.push( prepare( g, o ) );
		this.jetty = buildJetty( { D, terrain, add, colliders, tag: 'inverted', seed: 47, lanterns: 1 } );
		this.lights.push( ...this.jetty.lights );
		this._atoll( add, colliders );
		const near = new Mesh( mergePrepared( P ), this.material );
		near.name = 'InvertedAtollProps';
		near.castShadow = true;
		this.group.add( near );

		// the sky isles, roots and hanging trees: the sway rides on aux.w (0 at the attachment .. 1 at the tip)
		this.skyMaterial = createPropMaterial( 'invertedSky', {
			vertex: /* wgsl */`
	let sw = v.aux.w;
	if ( sw > 0.0 ) {
		let ph = frame.time * 0.55 + v.position.x * 0.045 + v.position.z * 0.06;
		v.position.x += sin( ph ) * sw * 0.9;
		v.position.z += cos( ph * 0.83 + 1.3 ) * sw * 0.7;
	}
`,
		} );
		this.skyMaterial.underwaterLighting = 'none';
		const S = [];
		this.sky = [];
		this.roots = 0;
		for ( let k = 0; k < SKY_ISLES.length; k ++ ) this._skyIsle( S, SKY_ISLES[ k ], k );
		const sky = new Mesh( mergePrepared( S ), this.skyMaterial );
		sky.name = 'InvertedSkyIsles';
		sky.castShadow = true;
		this.group.add( sky );
		this.skyMesh = sky;

		// the upward waterfalls
		this._fallsMesh();
		this.parts = [ { object: near, dist: NEAR }, { object: sky, dist: FAR }, { object: this.fallsMesh, dist: FAR } ];

	}

	_atoll( add, colliders ) {

		const t = this.terrain, rnd = rng( 1777 );
		// palms on the ring where it is widest and driest, leaning toward the lagoon
		let n = 0;
		for ( let k = 0; k < 2000 && n < 26; k ++ ) {

			const a = rnd() * Math.PI * 2;
			const f = 0.84 + rnd() * 0.12;
			const u = Math.cos( a ) * I.ru * f, v = Math.sin( a ) * I.rv * f;
			if ( Math.abs( v - D.v ) < 10 && u < - 90 ) continue; // the jetty foot
			if ( Math.abs( v - I.channel[ 0 ] ) < 16 && u < - 80 ) continue; // the channel
			const [ x, z ] = isletWorld( I, u, v );
			const h = t.heightAt( x, z );
			if ( h < 1.0 ) continue;
			palm( add, x, h - 0.1, z, 5.5 + rnd() * 4, rnd, 0.15 + rnd() * 0.3 );
			if ( colliders ) colliders.addCylinder( x, z, 0.25, h - 0.5, h + 3, { tag: 'invertedPalm' } );
			n ++;

		}

		this.palms = n;
		// channel markers at the mouth of the gap: a red and a green post with a small light each
		const [ cv, hw, cu0 ] = I.channel;
		for ( const [ side, col ] of [ [ - 1, 0xb23a2e ], [ 1, 0x2f8a4a ] ] ) {

			const [ x, z ] = isletWorld( I, cu0 + 30, cv + side * ( hw + 3 ) );
			const g = t.heightAt( x, z );
			const len = 3.4 - g;
			add( cylinder( 0.14, 0.16, len, 8 ), { color: col, rough: 0.6, matrix: mat4( x, g + len / 2, z ) } );
			add( box( 0.5, 0.5, 0.06 ), { color: col, rough: 0.6, matrix: mat4( x, 3.1, z, 0, Math.atan2( I.ax, I.az ), 0 ) } );
			this.lights.push( lantern( add, x, 3.55, z, { intensity: 4, range: 9, color: side < 0 ? new Color( 1.0, 0.25, 0.15 ) : new Color( 0.3, 1.0, 0.45 ) } ) );
			if ( colliders ) colliders.addCylinder( x, z, 0.2, g - 0.5, 3.4, { tag: 'invertedMarker' } );

		}

		// a cairn by the jetty foot looking up at the isles, driftwood on the ring
		const [ cx, cz ] = isletWorld( I, - 124, - 18 );
		const cy = t.heightAt( cx, cz );
		let y = 0;
		for ( let k = 0; k < 6; k ++ ) {

			const r = 0.55 - k * 0.07, h = 0.22 + rnd() * 0.06;
			add( cylinder( r * 0.9, r, h, 7 ), { ...STONE( [ 0x8a8378, 0x9a9387, 0x7b746a ][ k % 3 ] ), matrix: mat4( cx, cy + y + h / 2, cz, 0, rnd() * 2, 0 ) } );
			y += h;

		}

		if ( colliders ) colliders.addCylinder( cx, cz, 0.6, cy - 0.3, cy + y, { tag: 'invertedCairn' } );
		for ( let k = 0; k < 9; k ++ ) {

			const a = rnd() * Math.PI * 2;
			const [ x, z ] = isletWorld( I, Math.cos( a ) * I.ru * 0.9, Math.sin( a ) * I.rv * 0.9 );
			const h = t.heightAt( x, z );
			if ( h < 0.3 ) continue;
			add( cylinder( 0.12, 0.16, 2.2 + rnd() * 2, 6 ), { ...WOOD( 0x9a8f80, { rough: 1 } ), matrix: mat4( x, h + 0.1, z, Math.PI / 2, rnd() * 3, 0 ) } );

		}

	}

	// one suspended isle: the body (ground face down, rock cone up), its roots and its hanging trees
	_skyIsle( S, [ u, v, y, R, yaw ], k ) {

		const [ x, z ] = isletWorld( I, u, v );
		const rnd = rng( 811 + k * 97 );
		this.sky.push( { x, y, z, r: R } );
		const g = isleGeometry( R, rnd );
		S.push( prepare( g, { rough: 0.92, matrix: mat4( x, y, z, 0, yaw, 0 ) } ) );
		// secondary spires on the shoulders of the bigger isles, leaning out (a broken, crystalline crown)
		for ( let q = 0, ns = R > 12 ? 2 + Math.floor( rnd() * 3 ) : 0; q < ns; q ++ ) {

			const a = rnd() * Math.PI * 2, rr = R * ( 0.3 + rnd() * 0.25 ), r2 = R * ( 0.22 + rnd() * 0.14 );
			const sg = isleGeometry( r2, rnd, 14 );
			S.push( prepare( sg, { rough: 0.92, matrix: mat4( x + Math.cos( a ) * rr, y + R * ( 0.25 + rnd() * 0.25 ), z + Math.sin( a ) * rr, Math.sin( a ) * 0.35, rnd() * 6, - Math.cos( a ) * 0.35 ) } ) );

		}

		// roots from the ground face, long and thin, swaying; the longest under the big isles
		const nRoots = Math.round( 5 + R * 0.75 );
		const dome = 0.22 * R;
		for ( let q = 0; q < nRoots; q ++ ) {

			const a = rnd() * Math.PI * 2, rr = Math.sqrt( rnd() ) * R * 0.85;
			const sx = x + Math.cos( a ) * rr, sz = z + Math.sin( a ) * rr;
			const sy = y - dome * ( 1 - ( rr / R ) ** 2 ) + 0.3;
			const L = Math.min( R * ( 0.35 + rnd() * 1.0 ), y - 22 ); // never lower than ~20 m over the sea
			const segs = 5;
			let p = new Vector3( sx, sy, sz );
			let r0 = 0.12 + R * 0.012 + rnd() * 0.12;
			for ( let s = 0; s < segs; s ++ ) {

				const nP = new Vector3( p.x + ( rnd() - 0.5 ) * L * 0.08, p.y - L / segs, p.z + ( rnd() - 0.5 ) * L * 0.08 );
				const r1 = r0 * 0.7;
				const gr = prepare( rod( p, nP, r0, 5, r1 ), { color: s < 2 ? 0x5b4a39 : 0x6e5e4a, rough: 0.95 } );
				swayWeights( gr, sy, L );
				S.push( gr );
				p = nP; r0 = r1;

			}

			this.roots ++;

		}

		// trees hanging upside down from the ground face (dark cones pointing at the sea), a few per isle
		const nTrees = R > 12 ? Math.round( R * 0.35 ) : R > 7 ? 1 : 0;
		for ( let q = 0; q < nTrees; q ++ ) {

			const a = rnd() * Math.PI * 2, rr = Math.sqrt( rnd() ) * R * 0.7;
			const tx = x + Math.cos( a ) * rr, tz = z + Math.sin( a ) * rr;
			const ty = y - dome * ( 1 - ( rr / R ) ** 2 ) + 0.2;
			const h = 4 + rnd() * 5, cr = 1.4 + rnd() * 1.2;
			const trunk = prepare( cylinder( 0.18, 0.12, h * 0.45, 6 ), { color: 0x4d3f32, rough: 0.95, matrix: mat4( tx, ty - h * 0.22, tz ) } );
			swayWeights( trunk, ty, h * 5 );
			S.push( trunk );
			for ( let c = 0; c < 2; c ++ ) {

				const crown = prepare( cylinder( cr * ( 1 - c * 0.3 ), 0, h * 0.6, 7 ), { color: [ 0x2a4a2a, 0x335a30, 0x23402a ][ ( q + c ) % 3 ], rough: 0.85, matrix: mat4( tx, ty - h * 0.42 - c * h * 0.25 - h * 0.3, tz, 0, rnd() * 3, 0 ) } );
				swayWeights( crown, ty, h * 5 );
				S.push( crown );

			}

		}

	}

	// columns of water rising from the lagoon into the two biggest isles, and sheets pouring up off the rims
	_fallsMesh() {

		const pos = [], uv = [], fall = [], idx = [];
		const strip = ( rows, seed ) => {

			// rows: [ { a: Vector3, b: Vector3, f } ] from the start of the flow to its end; a -> b across
			const base = pos.length / 3;
			let along = 0;
			for ( let i = 0; i < rows.length; i ++ ) {

				const r = rows[ i ];
				if ( i > 0 ) along += r.a.distanceTo( rows[ i - 1 ].a );
				const w = r.a.distanceTo( r.b );
				pos.push( r.a.x, r.a.y, r.a.z, r.b.x, r.b.y, r.b.z );
				uv.push( 0, along, w, along );
				fall.push( r.f, seed, r.f, seed );
				if ( i > 0 ) {

					const q = base + ( i - 1 ) * 2;
					idx.push( q, q + 1, q + 2, q + 1, q + 3, q + 2 );

				}

			}

		};

		let n = 0;
		// the columns: rings of quads round a vertical axis, narrowing as the water falls up
		for ( const k of [ 0, 1 ] ) {

			const s = this.sky[ k ];
			const top = s.y - 0.22 * s.r + 0.5;
			const segs = 14, rings = 12;
			for ( let j = 0; j < segs; j ++ ) {

				const a0 = j / segs * Math.PI * 2, a1 = ( j + 1 ) / segs * Math.PI * 2;
				const rows = [];
				for ( let i = 0; i <= rings; i ++ ) {

					const f = i / rings, y = - 0.3 + ( top + 0.3 ) * f;
					const rad = 2.6 - 1.2 * f + 0.25 * Math.sin( f * 9 + k );
					rows.push( { a: new Vector3( s.x + Math.cos( a0 ) * rad, y, s.z + Math.sin( a0 ) * rad ), b: new Vector3( s.x + Math.cos( a1 ) * rad, y, s.z + Math.sin( a1 ) * rad ), f } );

				}

				strip( rows, k * 0.37 + j * 0.011 );

			}

			n ++;

		}

		// rim sheets: off the edge of an isle, curving out and up into the sky, widening and thinning
		const rnd = rng( 4091 );
		for ( const k of [ 0, 0, 2, 4, 4, 1 ] ) {

			const s = this.sky[ k ];
			const a = rnd() * Math.PI * 2;
			const ox = Math.cos( a ), oz = Math.sin( a );
			const px = - oz, pz = ox;
			const L = 26 + rnd() * 26, W0 = 2.5 + rnd() * 2.5;
			const rows = [];
			for ( let i = 0; i <= 14; i ++ ) {

				const f = i / 14;
				const out = s.r * 0.96 + f * f * L * 0.35;
				const y = s.y + 0.4 + f * L;
				const w = W0 * ( 1 + f * 1.6 );
				const cx = s.x + ox * out, cz = s.z + oz * out;
				rows.push( { a: new Vector3( cx - px * w / 2, y, cz - pz * w / 2 ), b: new Vector3( cx + px * w / 2, y, cz + pz * w / 2 ), f } );

			}

			strip( rows, 0.5 + rnd() );
			n ++;

		}

		this.falls = n;
		const geo = new BufferGeometry();
		geo.setAttribute( 'position', new Float32BufferAttribute( pos, 3 ) );
		geo.setAttribute( 'uv', new Float32BufferAttribute( uv, 2 ) );
		geo.setAttribute( 'aFall', new Float32BufferAttribute( fall, 2 ) );
		geo.setIndex( idx );
		geo.computeVertexNormals();
		geo.computeBoundingBox();
		geo.computeBoundingSphere();
		this.fallsMaterial = new Material( {
			name: 'invertedFalls', lit: false, transparent: true, blending: 'normal', depthWrite: false, side: 'double', velocityWeight: 0,
			underwaterLighting: 'none', receiveShadows: false, modules: [ fallModule ],
			attributes: { aFall: 'vec2f' }, varyings: { vFall: 'vec2f' },
			vertex: 'o.vFall = v.aFall;',
			surface: /* wgsl */`
	// flowing UP: the pattern scrolls toward larger 'along'; streaks stretched along the flow
	let f = in.vs.vFall.x;
	let seed = in.vs.vFall.y;
	let t = frame.time;
	let q = vec2f( in.uv.x * 1.3 + seed * 17.0, in.uv.y * 0.11 - t * 0.9 );
	let n1 = ufNoise( q );
	let n2 = ufNoise( q * vec2f( 2.7, 3.3 ) + vec2f( 4.7, - t * 0.6 ) );
	let streak = smoothstep( 0.3, 0.85, n1 * 0.6 + n2 * 0.4 );
	let ends = smoothstep( 0.0, 0.05, f ) * ( 1.0 - smoothstep( 0.62, 1.0, f ) );
	let light = frame.skyIrradiance * 1.6 + frame.sunColor * max( frame.sunDir.y, 0.0 ) * 0.3;
	s.albedo = mix( vec3f( 0.42, 0.62, 0.66 ), vec3f( 0.92, 0.97, 1.0 ), streak ) * light;
	s.alpha = ( 0.18 + 0.62 * streak ) * ends;
`,
		} );
		const mesh = new Mesh( geo, this.fallsMaterial );
		mesh.name = 'InvertedFalls';
		mesh.castShadow = false;
		mesh.receiveShadow = false;
		mesh.layers.set( LAYERS.TRANSPARENT );
		this.group.add( mesh );
		this.fallsMesh = mesh;

	}

	update() {

		this.distance = cullParts( this.center, this.parts );

	}

}

// the body of a suspended isle at the origin: a shallow dome (the ground, facing down) out to the rim at y = 0,
// then a jagged rock cone up to ~1.3 R; vertex colours: grass and soil below, banded rock above
export function isleGeometry( R, rnd, segs = 30 ) {

	const nb = 4, nt = 10;
	const dome = 0.22 * R, Ht = R * ( 1.15 + rnd() * 0.35 );
	const leanX = ( rnd() - 0.5 ) * 0.35 * R, leanZ = ( rnd() - 0.5 ) * 0.35 * R;
	const ph = [ rnd() * 6.28, rnd() * 6.28, rnd() * 6.28 ];
	const lobe = ( a, f ) => 1 + 0.22 * Math.sin( a * 3 + ph[ 0 ] ) + 0.12 * Math.sin( a * 5 + ph[ 1 ] + f * 3 ) + 0.08 * Math.sin( a * 11 + ph[ 2 ] + f * 9 );
	const GRASS = lin( 0x3f5a2c ), GRASS2 = lin( 0x56703a ), SOIL = lin( 0x5a4632 ), ROCK = lin( 0x6d675e ), ROCK2 = lin( 0x4f4a44 ), PALE = lin( 0x8f877b );
	const pos = [], col = [], uv = [], idx = [];
	const rows = [];
	// bottom: centre to rim (the dome), then the body from the rim to the tip
	for ( let i = 0; i <= nb; i ++ ) rows.push( { r: i / nb, y: - dome * ( 1 - ( i / nb ) ** 2 ), part: 0, f: 0 } );
	for ( let i = 1; i <= nt; i ++ ) {

		const f = i / nt;
		rows.push( { r: Math.pow( 1 - f, 0.8 ) * ( 1 - 0.1 * f ), y: f * Ht, part: 1, f } );

	}

	const c = new Color();
	for ( let i = 0; i < rows.length; i ++ ) {

		const rw = rows[ i ];
		for ( let j = 0; j <= segs; j ++ ) {

			const a = ( j % segs ) / segs * Math.PI * 2;
			const jag = rw.part ? 1 + ( rnd() - 0.5 ) * 0.4 * Math.min( 1, rw.f * 1.6 ) : 1 + ( rnd() - 0.5 ) * 0.04;
			const rad = R * rw.r * lobe( a, rw.f ) * jag;
			const lx = rw.part ? leanX * rw.f * rw.f : 0, lz = rw.part ? leanZ * rw.f * rw.f : 0;
			const y = rw.y + ( rw.part ? ( rnd() - 0.5 ) * R * 0.05 : 0 );
			pos.push( Math.cos( a ) * rad + lx, y, Math.sin( a ) * rad + lz );
			if ( ! rw.part ) c.copy( GRASS ).lerp( GRASS2, 0.5 + 0.5 * Math.sin( a * 4 + rw.r * 5 ) ).lerp( SOIL, rw.r > 0.9 ? 0.6 : 0 );
			else if ( rw.f < 0.12 ) c.copy( SOIL ).lerp( ROCK, rw.f / 0.12 );
			else {

				const band = 0.5 + 0.5 * Math.sin( y * 0.9 + Math.sin( a * 2 ) * 0.6 );
				c.copy( ROCK ).lerp( ROCK2, band * 0.7 ).lerp( PALE, Math.max( 0, rw.f - 0.75 ) * 2 );

			}

			col.push( c.r, c.g, c.b );
			uv.push( j / segs * R * 6, y );

		}

	}

	const W = segs + 1;
	for ( let i = 0; i < rows.length - 1; i ++ ) for ( let j = 0; j < segs; j ++ ) {

		const a = i * W + j, b = a + 1, d = a + W, e = d + 1;
		// outward-facing winding: the dome faces down, the cone faces out / up
		idx.push( a, d, b, b, d, e );

	}

	// close the seam (the duplicated column shares positions; normals are averaged below)
	const g = new BufferGeometry();
	g.setAttribute( 'position', new Float32BufferAttribute( pos, 3 ) );
	g.setAttribute( 'color', new Float32BufferAttribute( col, 3 ) );
	g.setAttribute( 'uv', new Float32BufferAttribute( uv, 2 ) );
	g.setIndex( idx );
	g.computeVertexNormals();
	// weld the seam normals (column 0 and column segs are the same points)
	const nrm = g.attributes.normal;
	for ( let i = 0; i < rows.length; i ++ ) {

		const p = i * W, q = p + segs;
		const nx = nrm.getX( p ) + nrm.getX( q ), ny = nrm.getY( p ) + nrm.getY( q ), nz = nrm.getZ( p ) + nrm.getZ( q );
		const l = Math.hypot( nx, ny, nz ) || 1;
		nrm.setXYZ( p, nx / l, ny / l, nz / l );
		nrm.setXYZ( q, nx / l, ny / l, nz / l );
		// keep the seam positions identical too (the jitter differed)
		g.attributes.position.setXYZ( q, g.attributes.position.getX( p ), g.attributes.position.getY( p ), g.attributes.position.getZ( p ) );

	}

	return g;

}

// aux.w (the sway weight) of a prepared, world-placed geometry: 0 at yTop .. 1 at yTop - len
function swayWeights( g, yTop, len ) {

	const p = g.attributes.position, a = g.attributes.aux;
	for ( let i = 0; i < p.count; i ++ ) a.array[ i * 4 + 3 ] = Math.max( 0, Math.min( 1, ( yTop - p.getY( i ) ) / len ) );

}

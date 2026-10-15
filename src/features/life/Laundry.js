// Laundry lines for the out-islands (docs/UNREAL_PARITY.md W6): the home village already strings three lines that sway
// on the GPU (Village.js laundryLine); this hangs a couple more beside the Pons Cove huts. Two poles, a sagging line
// and a row of cloths that swing and flutter with the wind (frame.windDir / frame.windSpeed), pinned along their top.
//
//   laundrySites( terrain ) -> [ { a: [ x, y, z ], b: [ x, y, z ] } ]   pole tops (pure)
//   const l = new Laundry( sites );  scene.add( l.mesh );  l.triangles

import { Mesh } from '../../engine/scene/Mesh.js';
import { Material } from '../../engine/render/Material.js';
import { Soup } from '../inverted/Islets.js';
import { PONS_HUTS } from '../../world/PonsCove.js';
import { ponsWorld } from '../../world/terrain/IslandShape.js';

const CLOTH = [ [ 0.92, 0.9, 0.85 ], [ 0.75, 0.25, 0.2 ], [ 0.27, 0.5, 0.72 ], [ 0.9, 0.75, 0.3 ], [ 0.48, 0.72, 0.58 ], [ 0.85, 0.55, 0.65 ] ];
const POLE = [ 0.4, 0.3, 0.2 ], ROPE = [ 0.55, 0.47, 0.33 ];

// beside each Pons hut, on the seaward side, a 4.5 m line between two 2.3 m poles (island frame u inland, v across)
export function laundrySites( T ) {

	const out = [];
	for ( const [ u, v ] of PONS_HUTS ) {

		const [ ax, az ] = ponsWorld( u - 6.5, v - 2.5 ), [ bx, bz ] = ponsWorld( u - 6.5, v + 2.0 );
		const ga = T ? T.heightAt( ax, az ) : 0, gb = T ? T.heightAt( bx, bz ) : 0;
		if ( ga < 0.4 || gb < 0.4 ) continue; // not in the surf
		out.push( { a: [ ax, ga + 2.1, az ], b: [ bx, gb + 2.1, bz ] } );

	}

	return out;

}

export class Laundry {

	constructor( sites, { seed = 5 } = {} ) {

		const S = new Soup();
		let s = seed >>> 0;
		const R = () => ( s = ( Math.imul( s, 1664525 ) + 1013904223 ) >>> 0 ) / 4294967296;
		for ( const { a, b } of sites ) {

			// poles (square posts) from the ground up to the line
			for ( const p of [ a, b ] ) {

				const w = 0.05, y0 = p[ 1 ] - 2.5, y1 = p[ 1 ] + 0.1;
				const c = [ [ - w, - w ], [ w, - w ], [ w, w ], [ - w, w ] ];
				for ( let i = 0; i < 4; i ++ ) {

					const [ x0, z0 ] = c[ i ], [ x1, z1 ] = c[ ( i + 1 ) % 4 ];
					S.quad( [ p[ 0 ] + x0, y0, p[ 2 ] + z0 ], [ p[ 0 ] + x1, y0, p[ 2 ] + z1 ], [ p[ 0 ] + x1, y1, p[ 2 ] + z1 ], [ p[ 0 ] + x0, y1, p[ 2 ] + z0 ], POLE );

				}

			}

			// the line: a thin ribbon with a sag; the cloths hang from it
			const L = Math.hypot( b[ 0 ] - a[ 0 ], b[ 2 ] - a[ 2 ] );
			const at = ( t ) => [ a[ 0 ] + ( b[ 0 ] - a[ 0 ] ) * t, a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * t - 0.18 * 4 * t * ( 1 - t ), a[ 2 ] + ( b[ 2 ] - a[ 2 ] ) * t ];
			for ( let k = 0; k < 8; k ++ ) {

				const p0 = at( k / 8 ), p1 = at( ( k + 1 ) / 8 );
				S.quad( p0, p1, [ p1[ 0 ], p1[ 1 ] - 0.015, p1[ 2 ] ], [ p0[ 0 ], p0[ 1 ] - 0.015, p0[ 2 ] ], ROPE );

			}

			let t = 0.08;
			while ( t < 0.9 ) {

				const w = ( 0.45 + R() * 0.4 ) / L, hgt = 0.5 + R() * 0.45;
				const col = CLOTH[ Math.floor( R() * CLOTH.length ) ];
				const seed2 = R();
				const n = 3; // rows: the swing grows toward the hem
				for ( let j = 0; j < n; j ++ ) {

					const v0 = j / n, v1 = ( j + 1 ) / n;
					const q = ( tt, vv ) => {

						const p = at( tt );
						return [ p[ 0 ], p[ 1 ] - 0.02 - vv * hgt, p[ 2 ] ];

					};

					// sway: along = depth below the line (0 pinned .. 1 hem), seed, amplitude (m)
					const sw = ( p ) => [ clamp01( ( at( t )[ 1 ] - 0.02 - p[ 1 ] ) / hgt ), seed2, 0.18 ];
					S.quad( q( t, v0 ), q( t + w, v0 ), q( t + w, v1 ), q( t, v1 ), col, sw );

				}

				t += w + 0.04 / L + R() * 0.08;

			}

		}

		this.triangles = S.triangles;
		this.geometry = S.geometry();
		this.material = new Material( {
			name: 'Laundry',
			vertexColors: true,
			side: 'double',
			roughness: 0.85,
			attributes: { aSway: 'vec3f', aGlow: 'f32' },
			vertex: /* wgsl */`
	let sw = v.aSway;
	if ( sw.z > 0.0 ) {
		let w = vec2f( frame.windDir.x, frame.windDir.y );
		let k = sw.x * sw.z * clamp( 0.3 + frame.windSpeed * 0.09, 0.3, 1.6 );
		let t = frame.time * ( 1.6 + sw.y ) + sw.y * 6.28 + v.position.x * 0.9 + v.position.z * 0.7;
		v.position += vec3f( w.x, 0.0, w.y ) * k * ( 0.7 + 0.3 * sin( t ) ) + vec3f( 0.0, 0.25, 0.0 ) * k * sw.x * ( 0.6 + 0.4 * sin( t * 2.3 ) ) + vec3f( - w.y, 0.0, w.x ) * k * 0.25 * sin( t * 3.1 );
	}
`,
		} );
		this.mesh = new Mesh( this.geometry, this.material );
		this.mesh.name = 'Laundry';
		this.mesh.frustumCulled = false;
		this.mesh.castShadow = true;

	}

	dispose() {

		if ( this.mesh.parent ) this.mesh.parent.remove( this.mesh );

	}

}

function clamp01( v ) {

	return v < 0 ? 0 : v > 1 ? 1 : v;

}

// Which end of each fleet hull is the bow: the pointed end is narrower than the transom.
//   node test/hull-ends.mjs
import { readFileSync } from 'node:fs';
import { parseGLB } from '../src/engine/loaders/GLTF.js';
for ( const n of [ 'SM_MarshSkiff', 'SM_Outrigger', 'SM_SailCutter', 'SM_CabinLaunch' ] ) {
	const b = readFileSync( `public/models/fleet/${ n }.glb` );
	const g = parseGLB( b.buffer.slice( b.byteOffset, b.byteOffset + b.byteLength ) );
	let zmin = 1e9, zmax = - 1e9; const pts = [];
	for ( const m of g.meshes ) for ( const p of m ) {
		const P = p.attributes.POSITION.array;
		for ( let i = 0; i < P.length; i += 3 ) { pts.push( [ P[ i ], P[ i + 1 ], P[ i + 2 ] ] ); zmin = Math.min( zmin, P[ i + 2 ] ); zmax = Math.max( zmax, P[ i + 2 ] ); }
	}
	const width = ( z0, z1 ) => { let w = 0; for ( const [ x, y, z ] of pts ) if ( z >= z0 && z <= z1 && y < 0.4 && y > - 0.1 ) w = Math.max( w, Math.abs( x ) ); return w; };
	const L = zmax - zmin;
	console.log( n, 'z', zmin.toFixed( 2 ), zmax.toFixed( 2 ), ' half-width near -Z end', width( zmin, zmin + L * 0.12 ).toFixed( 2 ), ' near +Z end', width( zmax - L * 0.12, zmax ).toFixed( 2 ) );
}

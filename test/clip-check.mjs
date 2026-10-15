// How much each bone moves away from its rest pose in a clip (degrees), to spot clips that leave the
// arms at the rest A-pose (missing or unbaked channels).   node test/clip-check.mjs <glb> <clip> [clip...]
import { readFileSync } from 'node:fs';
import { parseGLB } from '../src/engine/loaders/GLTF.js';
const [ file, ...clips ] = process.argv.slice( 2 );
const b = readFileSync( file );
const g = parseGLB( b.buffer.slice( b.byteOffset, b.byteOffset + b.byteLength ) );
const bones = [ 'spine_02', 'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r', 'upperarm_l', 'lowerarm_l', 'hand_l', 'head' ];
const ang = ( a, b ) => 2 * Math.acos( Math.min( 1, Math.abs( a[ 0 ] * b[ 0 ] + a[ 1 ] * b[ 1 ] + a[ 2 ] * b[ 2 ] + a[ 3 ] * b[ 3 ] ) ) ) * 180 / Math.PI;
for ( const name of clips ) {
	const a = g.animations.find( ( x ) => x.name === name );
	if ( ! a ) { console.log( name, 'MISSING' ); continue; }
	const row = [];
	for ( const bn of bones ) {
		const ni = g.nodes.findIndex( ( n ) => n.name === bn );
		const ch = a.channels.find( ( c ) => c.node === ni && c.path === 'rotation' );
		if ( ! ch ) { row.push( `${ bn }:none` ); continue; }
		const rest = g.nodes[ ni ].r;
		let mx = 0, mean = 0; const n = ch.times.length;
		for ( let k = 0; k < n; k ++ ) { const d = ang( rest, Array.from( ch.values.slice( k * 4, k * 4 + 4 ) ) ); mx = Math.max( mx, d ); mean += d / n; }
		row.push( `${ bn }:${ mean.toFixed( 0 ) }/${ mx.toFixed( 0 ) }` );
	}
	console.log( name.padEnd( 16 ), a.duration.toFixed( 2 ) + 's', row.join( '  ' ) );
}

// The rod (weapon_r socket) of a clip frame by frame, from the exported GLB: shaft elevation above horizontal (0 forward, 90 up,
// > 90 tip behind the head), the socket position, the elbows, the left hand and the head, in model space (+Y up, +Z forward).
//   node test/clip-rod.mjs <glb> <clip> [step seconds = 0.0333]
import { readFileSync } from 'node:fs';
import { parseGLB } from '../src/engine/loaders/GLTF.js';
import { clipFK } from './clip-fk.mjs';
const [ file, clip, stepArg ] = process.argv.slice( 2 );
const b = readFileSync( file );
const g = parseGLB( b.buffer.slice( b.byteOffset, b.byteOffset + b.byteLength ) );
if ( ! g.animations.some( ( x ) => x.name === clip ) ) { console.log( 'no clip', clip, g.animations.map( ( x ) => x.name ).join( ' ' ) ); process.exit( 1 ); }
const fk = clipFK( g ), step = + ( stepArg || 1 / 30 );
const f = ( W, n ) => { const m = W[ fk.index( n ) ]; return `(${ m[ 12 ].toFixed( 2 ) } ${ m[ 13 ].toFixed( 2 ) } ${ m[ 14 ].toFixed( 2 ) })`; };
console.log( clip, fk.duration( clip ).toFixed( 2 ) + 's' );
for ( let t = 0; t <= fk.duration( clip ) + 1e-6; t += step ) {

	const W = fk.world( clip, t );
	console.log( t.toFixed( 3 ), 'elev', fk.rodElevation( clip, t, W ).toFixed( 0 ).padStart( 4 ), 'grip', f( W, 'weapon_r' ), 'elbR', f( W, 'lowerarm_r' ), 'elbL', f( W, 'lowerarm_l' ), 'handL', f( W, 'hand_l' ), 'head', f( W, 'head' ) );

}

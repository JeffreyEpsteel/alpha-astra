// Prints the structure of a GLB (nodes, skins, primitives, materials, images, clips): node test/glb-info.mjs <file.glb> ...
import { readFileSync } from 'node:fs';
import { parseGLB } from '../src/engine/loaders/GLTF.js';
for ( const file of process.argv.slice( 2 ) ) {
	const buf = readFileSync( file );
	const g = parseGLB( buf.buffer.slice( buf.byteOffset, buf.byteOffset + buf.byteLength ) );
	console.log( '==', file.split( /[\/]/ ).pop(), ( buf.length / 1e6 ).toFixed( 2 ) + ' MB' );
	console.log( ' nodes', g.nodes.length, 'roots', g.roots.map( ( i ) => g.nodes[ i ].name ), 'skins', g.skins.map( ( s ) => s.joints.length ) );
	const meshNode = g.nodes.find( ( n ) => n.mesh !== undefined );
	for ( const m of g.meshes ) {
		for ( const p of m ) {
			const P = p.attributes.POSITION.array; let mn = [ 1e9, 1e9, 1e9 ], mx = [ - 1e9, - 1e9, - 1e9 ];
			for ( let i = 0; i < P.length; i += 3 ) for ( let c = 0; c < 3; c ++ ) { mn[ c ] = Math.min( mn[ c ], P[ i + c ] ); mx[ c ] = Math.max( mx[ c ], P[ i + c ] ); }
			console.log( '  prim mat', g.materials[ p.material ]?.name, 'verts', P.length / 3, 'tris', p.indices ? p.indices.length / 3 : '?', 'bbox', mn.map( ( x ) => x.toFixed( 2 ) ), mx.map( ( x ) => x.toFixed( 2 ) ), 'joints', !! p.attributes.JOINTS_0 );
		}
	}
	console.log( ' materials', g.materials.map( ( m ) => `${ m.name }${ m.pbrMetallicRoughness?.baseColorTexture ? '[tex]' : '' }` ).join( ', ' ) );
	console.log( ' images', g.images.map( ( im ) => im.mimeType + ' ' + ( im.bytes.length / 1e3 ).toFixed( 0 ) + 'k' ).join( ', ' ) );
	console.log( ' anims', g.animations.map( ( a ) => `${ a.name } ${ a.duration.toFixed( 2 ) }s/${ a.channels.length }ch` ).join( ', ' ) );
	const names = g.nodes.map( ( n ) => n.name );
	console.log( ' has weapon_r', names.includes( 'weapon_r' ), 'head', names.includes( 'head' ), 'mesh node', meshNode && meshNode.name );
}

// Forward kinematics of a glTF clip on the CPU (no GPU): the world matrices of every node at a time, and the rod socket's
// shaft elevation. Shared by test/clip-rod.mjs (a printout per frame) and test/avatar-overlay.mjs (the cast timing contract).
//   const fk = clipFK( gltf ); const W = fk.world( 'Fishing_Cast', 0.09 ); fk.rodElevation( 'Fishing_Cast', 0.09 ) // degrees
// Model space of the exported GLBs: +Y up, the character faces +Z. Elevation 0 = the shaft points forward, 90 = up, > 90 = tip behind.
const mul = ( A, B ) => { const o = new Array( 16 ).fill( 0 ); for ( let c = 0; c < 4; c ++ ) for ( let r = 0; r < 4; r ++ ) for ( let k = 0; k < 4; k ++ ) o[ c * 4 + r ] += A[ k * 4 + r ] * B[ c * 4 + k ]; return o; };
const compose = ( t, q ) => { const [ x, y, z, w ] = q; return [ 1 - 2 * ( y * y + z * z ), 2 * ( x * y + z * w ), 2 * ( x * z - y * w ), 0, 2 * ( x * y - z * w ), 1 - 2 * ( x * x + z * z ), 2 * ( y * z + x * w ), 0, 2 * ( x * z + y * w ), 2 * ( y * z - x * w ), 1 - 2 * ( x * x + y * y ), 0, t[ 0 ], t[ 1 ], t[ 2 ], 1 ]; };

function sample( ch, t ) {

	const T = ch.times, V = ch.values, w = ch.path === 'rotation' ? 4 : 3, n = T.length;
	if ( t <= T[ 0 ] || n === 1 ) return Array.from( V.slice( 0, w ) );
	if ( t >= T[ n - 1 ] ) return Array.from( V.slice( ( n - 1 ) * w, n * w ) );
	let k = 0;
	while ( k < n - 2 && T[ k + 1 ] <= t ) k ++;
	const f = ( t - T[ k ] ) / ( T[ k + 1 ] - T[ k ] );
	const A = V.slice( k * w, ( k + 1 ) * w ), B = V.slice( ( k + 1 ) * w, ( k + 2 ) * w );
	if ( w === 3 ) return Array.from( A, ( x, i ) => x + ( B[ i ] - x ) * f );
	const s = A[ 0 ] * B[ 0 ] + A[ 1 ] * B[ 1 ] + A[ 2 ] * B[ 2 ] + A[ 3 ] * B[ 3 ] < 0 ? - 1 : 1;
	const q = Array.from( A, ( x, i ) => x * ( 1 - f ) + B[ i ] * s * f );
	const l = Math.hypot( ...q );
	return q.map( ( x ) => x / l );

}

export function clipFK( gltf ) {

	const N = gltf.nodes.length, parent = new Int32Array( N ).fill( - 1 );
	gltf.nodes.forEach( ( n, i ) => n.children.forEach( ( c ) => { parent[ c ] = i; } ) );
	const order = [];
	const visit = ( i ) => { order.push( i ); gltf.nodes[ i ].children.forEach( visit ); };
	gltf.roots.forEach( visit );
	const index = ( name ) => gltf.nodes.findIndex( ( x ) => x.name === name );
	const world = ( clipName, t ) => {

		const a = gltf.animations.find( ( x ) => x.name === clipName );
		if ( ! a ) throw new Error( 'no clip ' + clipName );
		const loc = gltf.nodes.map( ( n ) => ( { t: Array.from( n.t ), r: Array.from( n.r ) } ) );
		for ( const ch of a.channels ) if ( ch.path !== 'scale' ) loc[ ch.node ][ ch.path === 'rotation' ? 'r' : 't' ] = sample( ch, t );
		const W = new Array( N );
		for ( const i of order ) {

			const M = compose( loc[ i ].t, loc[ i ].r );
			W[ i ] = parent[ i ] < 0 ? M : mul( W[ parent[ i ] ], M );

		}

		return W;

	};

	const rodElevation = ( clipName, t, W = world( clipName, t ) ) => {

		const m = W[ index( 'weapon_r' ) ];
		return Math.atan2( m[ 9 ], m[ 10 ] ) * 180 / Math.PI; // the socket's +Z (the shaft): up = y, forward = +z

	};

	return { world, rodElevation, index, duration: ( name ) => gltf.animations.find( ( x ) => x.name === name ).duration };

}

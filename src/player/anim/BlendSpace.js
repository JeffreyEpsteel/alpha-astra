// Blend spaces for the animation graph (AnimDef.spaces): sample weights from the locomotion inputs.
//
//   polar: columns by direction (deg, + = right of the facing, -180..180), each column a speed axis of samples; the idle
//          sample is shared at speed 0. Weights = speed-linear inside the two columns around the direction, then
//          direction-linear between them (a polar grid, like a UE 2D blend space laid out on direction x speed).
//   1d:    samples on a speed axis (the first one usually at 0).
//
//   const bs = prepareSpace( def.spaces.ground, ( clip ) => model.clips.has( clip ) );
//   spaceWeights( bs, { forward, strafe, speed }, out ) -> out: [ { key, clip, reverse, w, speed } ] (w sums to 1)

// columns sorted by direction, samples sorted by speed, missing clips dropped (a character without a derived clip keeps
// the rest of the space)
export function prepareSpace( def, has = () => true ) {

	if ( def.kind === '1d' ) {

		const samples = def.samples.filter( ( [ c ] ) => has( c ) ).map( ( [ clip, speed ] ) => ( { clip, speed, reverse: false, key: clip } ) ).sort( ( a, b ) => a.speed - b.speed );
		return { kind: '1d', def, samples };

	}

	const columns = def.columns.map( ( c ) => ( {
		dir: c.dir <= - 180 ? 180 : c.dir,
		reverse: !! c.reverse,
		samples: c.samples.filter( ( [ clip ] ) => has( clip ) ).map( ( [ clip, speed ] ) => ( { clip, speed, reverse: !! c.reverse, key: clip + ( c.reverse ? '<' : '' ) } ) ).sort( ( a, b ) => a.speed - b.speed ),
	} ) ).filter( ( c ) => c.samples.length ).sort( ( a, b ) => a.dir - b.dir );
	return { kind: 'polar', def, columns, idle: has( def.idle ) ? def.idle : null };

}

// 1D weights of speed s over points [ 0 (idle), ...samples ]: pushes { sample, w } (idle as sample null)
function axis( samples, s, idle, scale, push ) {

	if ( ! samples.length ) return push( null, scale );
	if ( s <= 0 || ( idle && s <= 0 ) ) return push( null, scale );
	let lo = 0, loS = null;
	for ( const sm of samples ) {

		if ( s <= sm.speed ) {

			const f = ( s - lo ) / Math.max( 1e-6, sm.speed - lo );
			push( loS, scale * ( 1 - f ) );
			push( sm, scale * f );
			return;

		}

		lo = sm.speed; loS = sm;

	}

	push( loS, scale ); // beyond the fastest sample: it plays faster

}

const _acc = new Map();

export function spaceWeights( bs, { forward = 0, strafe = 0, speed = 0 }, out = [] ) {

	out.length = 0;
	_acc.clear();
	const idleKey = bs.kind === 'polar' ? bs.idle : null;
	const push = ( sm, w ) => {

		if ( w <= 1e-6 ) return;
		if ( ! sm ) {

			if ( ! idleKey ) return;
			const e = _acc.get( idleKey ) || { key: idleKey, clip: idleKey, reverse: false, w: 0, speed: 0, idle: true };
			e.w += w;
			_acc.set( idleKey, e );
			return;

		}

		const e = _acc.get( sm.key ) || { key: sm.key, clip: sm.clip, reverse: sm.reverse, w: 0, speed: sm.speed, idle: false };
		e.w += w;
		_acc.set( sm.key, e );

	};

	if ( bs.kind === '1d' ) {

		const S = bs.samples;
		if ( ! S.length ) return out;
		// the first sample is the floor (idle at 0)
		if ( speed <= S[ 0 ].speed ) push( S[ 0 ], 1 );
		else axis( S.slice( 1 ), speed, null, 1, ( sm, w ) => push( sm || S[ 0 ], w ) );

	} else {

		const C = bs.columns;
		if ( ! C.length ) { push( null, 1 ); } else {

			const s = Math.max( 0, speed );
			// direction from the components (forward when standing or when the split is unknown)
			const dir = Math.hypot( forward, strafe ) > 1e-3 ? Math.atan2( strafe, forward ) * 180 / Math.PI : 0;
			let i1 = C.findIndex( ( c ) => c.dir >= dir );
			let c0, c1, f;
			if ( i1 === - 1 ) { c0 = C[ C.length - 1 ]; c1 = C[ 0 ]; const span = c1.dir + 360 - c0.dir; f = span > 0 ? ( dir - c0.dir ) / span : 0; } else if ( i1 === 0 ) {

				c1 = C[ 0 ]; c0 = C[ C.length - 1 ];
				const span = c1.dir - ( c0.dir - 360 );
				f = span > 0 ? ( dir - ( c0.dir - 360 ) ) / span : 1;

			} else { c0 = C[ i1 - 1 ]; c1 = C[ i1 ]; f = ( dir - c0.dir ) / Math.max( 1e-6, c1.dir - c0.dir ); }

			if ( c0 === c1 ) f = 1;
			f = Math.max( 0, Math.min( 1, f ) );
			axis( c0.samples, s, bs.idle, 1 - f, push );
			axis( c1.samples, s, bs.idle, f, push );

		}

	}

	let W = 0;
	for ( const e of _acc.values() ) W += e.w;
	for ( const e of _acc.values() ) { e.w /= W || 1; out.push( e ); }
	return out;

}

// the label of a speed from [ [ below, label ], ... ]
export function speedLabel( labels, s ) {

	for ( const [ lim, name ] of labels ) if ( s < lim ) return name;
	return labels.length ? labels[ labels.length - 1 ][ 1 ] : 'move';

}

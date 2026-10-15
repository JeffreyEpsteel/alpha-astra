// Wave 18A: the time of day colour grade (PostFX's final pass, before the existing warmth / saturation / contrast and
// ACES). Three looks blended by the sun: day (a light split tone: cool shadows, warm highlights), golden hour (amber
// highlights, teal shadows, a little more saturation) and night (a blue scotopic shift of the dark tones, a blue lift
// that keeps silhouettes readable, desaturated shadows; lamps keep their colour). Every tint has unit luminance, so
// the grade moves hues, not brightness, apart from the night lift (a monotonic floor: test/visuals-grade.mjs).
//
//   gradeWeights( sunY, night ) -> { golden, night }   (sunY: the true sun's direction .y; night: G.night)
//   GRADE_WGSL: fn gradeApply( c: vec3f, golden: f32, night: f32, strength: f32 ) -> vec3f
//   gradeApplyJS( [ r, g, b ], golden, night, strength ) -> [ r, g, b ]   the same maths (tests)

export const GRADE = {
	shadow: { day: [ 0.97, 1.0, 1.04 ], golden: [ 0.9, 1.0, 1.12 ], night: [ 0.78, 0.95, 1.32 ] },
	highlight: { day: [ 1.03, 1.0, 0.95 ], golden: [ 1.12, 1.0, 0.82 ], night: [ 0.96, 0.99, 1.06 ] }, // (night: moonlit mid tones a touch cool)
	split: [ - 3.0, 1.5 ], // log2 luminance / mid grey: shadows below, highlights above (smooth between)
	goldenSaturation: 0.1, // extra saturation at golden hour
	nightDesaturate: 0.35, // dark tones at night lose this much colour (rods)
	lift: 0.32, // night floor (x k, fading above k: monotonic while < 1)
	liftK: 0.02,
	liftTint: [ 0.55, 0.78, 1.4 ],
};

const smooth = ( a, b, x ) => {

	const t = Math.min( 1, Math.max( 0, ( x - a ) / ( b - a ) ) );
	return t * t * ( 3 - 2 * t );

};

// golden: the sun from just under the horizon to ~20 deg; night as the app sets it (G.night)
export function gradeWeights( sunY, night ) {

	const y = Number.isFinite( sunY ) ? sunY : 1;
	const golden = smooth( - 0.06, 0.03, y ) * ( 1 - smooth( 0.14, 0.36, y ) );
	return { golden, night: Math.min( 1, Math.max( 0, Number.isFinite( night ) ? night : 0 ) ) };

}

const v3 = ( a ) => `vec3f( ${ a.map( ( x ) => x.toFixed( 4 ) ).join( ', ' ) } )`;

export const GRADE_WGSL = /* wgsl */`
fn gradeLum( c: vec3f ) -> f32 { return dot( c, vec3f( 0.2126, 0.7152, 0.0722 ) ); }
fn gradeUnit( t: vec3f ) -> vec3f { return t / gradeLum( t ); }
fn gradeApply( cIn: vec3f, golden: f32, night: f32, strength: f32 ) -> vec3f {
	var c = max( cIn, vec3f( 0.0 ) );
	if ( strength <= 0.0 ) { return c; }
	let wDay = ( 1.0 - golden ) * ( 1.0 - night );
	let wGold = golden * ( 1.0 - night );
	let l = gradeLum( c );
	let s = smoothstep( ${ GRADE.split[ 0 ].toFixed( 2 ) }, ${ GRADE.split[ 1 ].toFixed( 2 ) }, log2( max( l, 1e-6 ) / 0.18 ) );
	let sh = gradeUnit( ${ v3( GRADE.shadow.day ) } ) * wDay + gradeUnit( ${ v3( GRADE.shadow.golden ) } ) * wGold + gradeUnit( ${ v3( GRADE.shadow.night ) } ) * night;
	let hi = gradeUnit( ${ v3( GRADE.highlight.day ) } ) * wDay + gradeUnit( ${ v3( GRADE.highlight.golden ) } ) * wGold + gradeUnit( ${ v3( GRADE.highlight.night ) } ) * night;
	c = c * mix( vec3f( 1.0 ), mix( sh, hi, s ), strength );
	// saturation around the pixel's own luminance (kept): richer at golden hour, rod vision at night
	let satK = 1.0 + strength * ( ${ GRADE.goldenSaturation.toFixed( 3 ) } * wGold - ${ GRADE.nightDesaturate.toFixed( 3 ) } * night * ( 1.0 - s ) );
	c = max( mix( vec3f( l ), c, satK ), vec3f( 0.0 ) );
	// the night floor: blue, fading out above k (silhouettes against the sky stay readable)
	let k = ${ GRADE.liftK.toFixed( 4 ) };
	c += gradeUnit( ${ v3( GRADE.liftTint ) } ) * ( strength * night * ${ GRADE.lift.toFixed( 3 ) } * k * k / ( l + k ) );
	return c;
}
`;

const lum = ( c ) => c[ 0 ] * 0.2126 + c[ 1 ] * 0.7152 + c[ 2 ] * 0.0722;
const unit = ( t ) => { const L = lum( t ); return t.map( ( x ) => x / L ); };

export function gradeApplyJS( cIn, golden, night, strength = 1 ) {

	let c = cIn.map( ( x ) => Math.max( 0, x ) );
	if ( strength <= 0 ) return c;
	const wDay = ( 1 - golden ) * ( 1 - night ), wGold = golden * ( 1 - night );
	const l = lum( c );
	const s = smooth( GRADE.split[ 0 ], GRADE.split[ 1 ], Math.log2( Math.max( l, 1e-6 ) / 0.18 ) );
	const mixw = ( key ) => [ 0, 1, 2 ].map( ( i ) => unit( GRADE[ key ].day )[ i ] * wDay + unit( GRADE[ key ].golden )[ i ] * wGold + unit( GRADE[ key ].night )[ i ] * night );
	const sh = mixw( 'shadow' ), hi = mixw( 'highlight' );
	c = c.map( ( x, i ) => x * ( 1 + ( sh[ i ] + ( hi[ i ] - sh[ i ] ) * s - 1 ) * strength ) );
	const sat = 1 + strength * ( GRADE.goldenSaturation * wGold - GRADE.nightDesaturate * night * ( 1 - s ) );
	c = c.map( ( x ) => Math.max( 0, l + ( x - l ) * sat ) );
	const k = GRADE.liftK, lt = unit( GRADE.liftTint );
	return c.map( ( x, i ) => x + lt[ i ] * strength * night * GRADE.lift * k * k / ( l + k ) );

}

// What a seaplane strike means (wave 10, "I want the crash to actually happen ... and the possibility of our character to
// survive"), pure logic: the node test pins the table. From a Flight event (Flight.js: a float / keel arrival on the
// water `touch { surface, sink, speed, pitch, roll }`, or a part striking something `strike { part, surface, speed, sink,
// nose, side }`, surface 'water' | 'ground' | 'ship' | 'object' (a building, a rock) | 'prop' (a destruction prop: never a
// "direct collision")) to one of four outcomes:
//   'scrape'  nothing to speak of (beaching at a walk, a float brushing the water)
//   'rough'   a rough landing: hull damage, a float sprung (list and drag until repaired), a splash and a bang; the
//             pilot stays aboard
//   'wreck'   the plane breaks up (Wreck.js): wings off, the tail or a float torn away, the fuselage afloat a minute or
//             two; the pilot is thrown clear, stunned and hurt, alive
//   'death'   a direct collision: nose first into terrain / a cliff / a ship / a building above CRASH.direct, or anything
//             above CRASH.fatal: playerDied { cause: 'seaplane' }
//
//   assess( event, hp ) -> { severity, damage (hull %), hurt (pilot health), sprung ('L' | 'R' | null), text, part, surface, speed }
//   throwPoint( { x, z, yaw }, side, { seaLevel, groundAt, jetty } ) -> { x, y, z, mode: 'swim' | 'walk', dist }
//   wreckParts( event, severity, rand ) -> [ part names the wreck sheds ]
// The 'L' / 'R' names follow the model frame: L = port = +X (Flight GEOM, the Blender nodes WingL / FloatL).
// Wave 12 (airframes): assess( event, hp, { rough, landplane } ): `rough` (spec.rough: the Petrel's fragile floats 0.8,
// the Albatross's hull 1.5, x1.15 a floats upgrade tier) scales the arrival thresholds roughSink / wreckSink /
// attitudeSink; a land plane (the Kestrel) lands on the ground by the same sink bands and any arrival on the water
// faster than CRASH.landWater is a wreck (the wheels dig in).

export const SEVERITY = [ 'none', 'scrape', 'rough', 'wreck', 'death' ];

export const CRASH = {
	// float / keel arrivals on the water (vertical speed, m/s)
	roughSink: 3, // from here a rough landing (below: a landing; the brief said ~2.5, but an unflared power-off touchdown
	// in this flight model arrives at ~2.8 m/s, the existing 'gentle landing' test: that must stay a landing)
	wreckSink: 6, // from here the struts fold: a wreck
	attitudeSink: 1.5, // nose down past 8 deg or a wing down past 25 deg at more than this: a float / wingtip digs in (wreck)
	// parts in the water (closing speed, m/s)
	dip: 4, // slower than this a part brushing the water is a scrape
	tipWreck: 12, // a wingtip / the tail / the fin into the water: a rough landing below, a wreck above
	noseWreck: 8, // the nose or the propeller digging in
	// the ground and things
	beach: 6, // a float keel on the ground: beaching below, aground (a wreck) above
	objectRough: 10, // a ship / prop / building clipped below this: a rough landing (a bent wingtip), above: a wreck
	direct: 25, // nose first into terrain, a cliff, a ship or a building above this: fatal
	noseFirst: 0.5, // cos of the angle between the nose and the motion that still counts as nose first (60 deg)
	fatal: 40, // anything above this: fatal
	// consequences
	roughDamage: [ 10, 70 ], // hull % lost from the bottom to the top of the rough sink band
	dipDamage: 15, // a part dipped or clipped (rough)
	hurt: [ 15, 70 ], // the pilot's health lost by a wreck, from a slow one to one just under `fatal`
	stun: 0.8, // s of black-out when thrown clear
	throwDist: [ 4.6, 6.2 ], // m from the fuselage's centre line (the floats reach 1.75 m, the hull 0.72)
	clearOf: 2.4, // m: the hull's half width with the floats and a margin (the thrown pilot lands outside it)
	afloat: [ 60, 120 ], // s the fuselage floats before it sinks
	sinkTime: 14, // s from awash to gone
	smoke: 40, // s of engine smoke
	fire: 20, // s of fire on a ground wreck (then smoke)
	recovery: 600, // $ Captain Roid's crew charges to raise and tow the wreck (on top of the repair; free in the sandbox)
	landWater: 3, // m/s: a land plane arriving on the water faster than this (along or down) is wrecked
};

const STRUCK = { wingtip: 'A wingtip', propeller: 'The propeller', nose: 'The nose', tail: 'The tail', fin: 'The fin', tailplane: 'The tailplane', float: 'A float' };
const WHAT = { ground: 'the ground', ship: 'a ship', object: 'something solid', prop: 'a crate', water: 'the water' };
const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );

function result( severity, e, extra = {} ) {

	return { severity, damage: 0, hurt: 0, sprung: null, text: '', part: e.part || ( e.type === 'touch' ? 'float' : '' ), surface: e.surface || 'water', speed: e.speed || 0, ...extra };

}

// the pilot's health lost in a wreck at closing speed v
export function wreckHurt( v ) {

	const [ lo, hi ] = CRASH.hurt;
	return Math.round( lo + ( hi - lo ) * clamp( ( v - CRASH.noseWreck ) / ( CRASH.fatal - CRASH.noseWreck ), 0, 1 ) );

}

export function assess( e, hp = 100, opts = {} ) {

	if ( ! e || ( e.type !== 'touch' && e.type !== 'strike' ) ) return result( 'none', e || {} );
	const k = Number.isFinite( opts.rough ) && opts.rough > 0 ? opts.rough : 1;
	const C = k === 1 ? CRASH : { ...CRASH, roughSink: CRASH.roughSink * k, wreckSink: CRASH.wreckSink * k, attitudeSink: CRASH.attitudeSink * k };
	const surface = e.surface || 'water';
	if ( e.type === 'touch' ) {

		const sink = Math.max( 0, e.sink || 0 ), fwd = Math.abs( e.speed || 0 ), v = Math.hypot( sink, fwd );
		const lowSide = ( e.roll ?? 0 ) >= 0 ? 'R' : 'L'; // a positive roll is the starboard wing down
		if ( opts.landplane ) {

			// wheels: the ground is its runway, the water a wreck
			if ( surface === 'water' ) {

				if ( fwd > C.landWater || sink > C.landWater ) return result( v > C.fatal ? 'death' : 'wreck', e, { speed: v, hurt: wreckHurt( Math.max( sink * 2.5, v * 0.6 ) ), damage: hp, text: 'The wheels dug into the water' } );
				return result( 'none', e, { speed: v } );

			}

			const att = ( e.pitch ?? 0 ) < - 10 || Math.abs( e.roll ?? 0 ) > 25;
			if ( sink >= C.wreckSink || ( att && sink > C.attitudeSink ) ) return result( v > C.fatal ? 'death' : 'wreck', e, { speed: v, hurt: wreckHurt( Math.max( sink * 2.5, v * 0.6 ) ), damage: hp, text: sink >= C.wreckSink ? 'The undercarriage collapsed' : 'A wing went in on touchdown' } );
			if ( sink >= C.roughSink ) {

				const [ d0, d1 ] = C.roughDamage;
				const damage = Math.round( d0 + ( d1 - d0 ) * ( sink - C.roughSink ) / ( C.wreckSink - C.roughSink ) );
				if ( damage >= hp ) return result( 'wreck', e, { speed: v, hurt: wreckHurt( sink * 2.5 ), damage: hp, text: 'The hard landing broke a gear leg' } );
				return result( 'rough', e, { speed: v, damage, text: 'Hard landing: the gear is bent' } );

			}

			return result( 'none', e, { speed: v } );

		}

		if ( surface !== 'water' ) {

			if ( sink > 2 || fwd > 8 ) return result( v > C.fatal ? 'death' : 'wreck', e, { speed: v, hurt: wreckHurt( v ), damage: hp, text: 'The floats hit the ground' } );
			return result( 'none', e, { speed: v } );

		}

		const attitude = ( e.pitch ?? 0 ) < - 8 || Math.abs( e.roll ?? 0 ) > 25;
		if ( sink >= C.wreckSink || ( attitude && sink > C.attitudeSink ) ) {

			const text = sink >= C.wreckSink ? 'The seaplane hit the water too hard' : Math.abs( e.roll ?? 0 ) > 25 ? 'A wing went in on touchdown' : 'The floats dug in nose first';
			return result( v > C.fatal ? 'death' : 'wreck', e, { speed: v, hurt: wreckHurt( Math.max( sink * 2.5, v * 0.6 ) ), damage: hp, text } );

		}

		if ( sink >= C.roughSink ) {

			const [ d0, d1 ] = C.roughDamage;
			const damage = Math.round( d0 + ( d1 - d0 ) * ( sink - C.roughSink ) / ( C.wreckSink - C.roughSink ) );
			if ( damage >= hp ) return result( 'wreck', e, { speed: v, hurt: wreckHurt( sink * 2.5 ), damage: hp, text: 'The hard landing broke a float strut' } );
			return result( 'rough', e, { speed: v, damage, sprung: lowSide, text: 'Hard landing: a float is sprung' } );

		}

		return result( 'none', e, { speed: v } );

	}

	// a strike
	const v = Math.max( 0, e.speed || 0 ), part = e.part || 'nose';
	const who = STRUCK[ part ] || `The ${ part }`;
	const noseFirst = ( part === 'nose' || part === 'propeller' ) && ( e.nose ?? 1 ) >= C.noseFirst;
	const wreck = ( text ) => result( 'wreck', e, { speed: v, hurt: wreckHurt( v ), damage: hp, text } );
	if ( v > C.fatal ) return result( 'death', e, { speed: v, damage: hp, text: surface === 'water' ? 'The seaplane went into the sea at full speed' : `The seaplane flew into ${ WHAT[ surface ] || 'something' }` } );
	if ( ( surface === 'ground' || surface === 'ship' || surface === 'object' ) && noseFirst && v > C.direct ) return result( 'death', e, { speed: v, damage: hp, text: `Nose first into ${ WHAT[ surface ] || 'something' }` } );
	if ( surface === 'ground' ) {

		if ( part === 'float' ) return v > C.beach ? wreck( 'The seaplane ran aground' ) : result( 'scrape', e );
		return wreck( part === 'propeller' ? 'The propeller struck the ground' : `${ who } hit the ground` );

	}

	if ( surface === 'ship' || surface === 'object' || surface === 'prop' ) {

		if ( v < C.dip ) return result( 'scrape', e );
		if ( v < C.objectRough ) return result( 'rough', e, { damage: C.dipDamage, text: `${ who } clipped ${ WHAT[ surface ] }` } );
		return wreck( `${ who } hit ${ WHAT[ surface ] }` );

	}

	// the water
	if ( v < C.dip ) return result( 'scrape', e );
	const limit = part === 'nose' || part === 'propeller' ? C.noseWreck : C.tipWreck;
	if ( v < limit ) return result( 'rough', e, { damage: C.dipDamage, text: `${ who } dipped into the water` } );
	return wreck( part === 'wingtip' ? 'A wingtip caught the water' : `${ who } dug into the water` );

}

// the parts a wreck sheds: both wings always; the tail or a float (the tail after a tail-first or fast hit, else the
// float on the side that hit); the propeller after a nose / propeller strike or a fast one
export function wreckParts( e = {}, severity = 'wreck', rand = Math.random ) {

	const parts = [ 'wingL', 'wingR' ];
	const part = e.part || '', v = e.speed || Math.hypot( e.sink || 0, e.speed || 0 );
	const tailHit = part === 'tail' || part === 'fin' || part === 'tailplane';
	const side = e.side > 0 ? 'L' : e.side < 0 ? 'R' : ( ( e.roll ?? 0 ) > 0 ? 'R' : ( e.roll ?? 0 ) < 0 ? 'L' : ( rand() < 0.5 ? 'L' : 'R' ) );
	if ( tailHit || v > 22 || severity === 'death' ) parts.push( 'tail' );
	if ( ! tailHit || severity === 'death' ) parts.push( 'float' + side );
	if ( part === 'nose' || part === 'propeller' || v > 18 ) parts.push( 'prop' );
	return parts;

}

// where a pilot thrown clear lands: beside the cabin (port side first, the door's), outside the hull and the floats, in
// the water ('swim', just under the surface) or on the ground ('walk'); a point up a cliff or inside a building is
// skipped for the other side / a little further. o: { x, z, yaw } (the fuselage, heading in the boat convention),
// env: { seaLevel, groundAt( x, z ), jetty( x, z ) -> { x, y, z } | null, solidAt( x, y, z ) -> bool }
export function throwPoint( o, side = 1, env = {}, rand = Math.random ) {

	const sea = Number.isFinite( env.seaLevel ) ? env.seaLevel : 0;
	const groundAt = env.groundAt || ( () => - Infinity );
	const s = Math.sin( o.yaw || 0 ), c = Math.cos( o.yaw || 0 );
	const [ d0, d1 ] = CRASH.throwDist;
	const base = Math.max( o.y ?? sea, sea );
	let best = null;
	for ( const sd of [ side >= 0 ? 1 : - 1, side >= 0 ? - 1 : 1 ] ) {

		for ( const k of [ 0, 0.5, 1, 1.6 ] ) {

			const d = d0 + ( d1 - d0 ) * ( k > 1 ? 1 : k ) * ( 0.8 + 0.2 * rand() ) + ( k > 1 ? 1.5 : 0 );
			const along = 0.6 + ( rand() - 0.5 ) * 1.2;
			// model +X (port) in the world for heading yaw: ( cos, 0, -sin ); forward ( sin, 0, cos )
			const x = o.x + c * sd * d + s * along, z = o.z - s * sd * d + c * along;
			const g = groundAt( x, z );
			if ( g > base + 2.5 ) continue; // up a cliff face: not there
			const jp = env.jetty ? env.jetty( x, z ) : null;
			let pt;
			if ( jp && Math.hypot( jp.x - x, jp.z - z ) < 2.5 ) pt = { x: jp.x, y: jp.y, z: jp.z, mode: 'walk' };
			else if ( g > sea - 1.1 ) pt = { x, y: Math.max( g, sea - 1.1 ), z, mode: 'walk' };
			else pt = { x, y: sea - 0.2, z, mode: 'swim' };
			if ( env.solidAt && env.solidAt( pt.x, pt.y + 0.9, pt.z ) ) continue;
			pt.dist = Math.hypot( pt.x - o.x, pt.z - o.z );
			best = pt;
			break;

		}

		if ( best ) break;

	}

	// nowhere sensible (boxed in): straight up beside the wreck, into the water / onto its ground
	if ( ! best ) {

		const x = o.x + c * d1, z = o.z - s * d1, g = groundAt( x, z );
		best = g > sea - 1.1 ? { x, y: g, z, mode: 'walk' } : { x, y: sea - 0.2, z, mode: 'swim' };
		best.dist = d1;

	}

	return best;

}

// a point's lateral / longitudinal offset from the fuselage (model frame): for the tests and the clear-of-hull check
export function hullOffset( o, x, z ) {

	const s = Math.sin( o.yaw || 0 ), c = Math.cos( o.yaw || 0 ), dx = x - o.x, dz = z - o.z;
	return { side: dx * c - dz * s, along: dx * s + dz * c };

}

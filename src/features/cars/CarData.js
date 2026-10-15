// Numbers of the cars feature (src/features/cars): the seven kinds (looks, handling, prices), the damage stages, the city's
// wanted level and the traffic budgets. Plain data and pure helpers: no engine, no DOM, no game state.
//
// Handling (CarPhysics.js): accel m/s^2 off the line, top m/s, brake m/s^2, grip (x g of lateral grip), steer (rad of
// lock), wb wheelbase, track (between the wheel centres), r wheel radius, mass kg, tough (x 100 hit points).
// Model frame: +Z forward, +Y up, +X the car's left; origin on the ground under the middle of the wheelbase (the GLBs of
// tools/cars/build_cars.py). seat / eye: the driver's floor (the avatar's feet) and eye, left-hand drive.

export const KINDS = {
	sedan: { name: 'Sedan', glb: 'cars/sedan.glb', len: 4.6, wid: 1.8, hgt: 1.45, wb: 2.72, track: 1.5, r: 0.33, mass: 1350, accel: 4.6, top: 44, rev: 7, brake: 9, grip: 1.0, steer: 0.6, tough: 1, price: 4200, sale: true, seat: [ 0.38, 0.32, - 0.15 ], eye: [ 0.38, 1.22, - 0.1 ], chase: 7.5 },
	taxi: { name: 'Taxi', glb: 'cars/taxi.glb', len: 4.7, wid: 1.8, hgt: 1.65, wb: 2.78, track: 1.5, r: 0.33, mass: 1400, accel: 4.4, top: 42, rev: 7, brake: 9, grip: 0.98, steer: 0.6, tough: 1.05, price: 5200, sale: true, seat: [ 0.38, 0.32, - 0.15 ], eye: [ 0.38, 1.22, - 0.1 ], chase: 7.5, paint: 0xf2b11c },
	police: { name: 'Police car', glb: 'cars/police.glb', len: 4.8, wid: 1.84, hgt: 1.63, wb: 2.8, track: 1.52, r: 0.34, mass: 1550, accel: 5.6, top: 50, rev: 8, brake: 10, grip: 1.08, steer: 0.62, tough: 1.4, price: 0, sale: false, seat: [ 0.38, 0.34, - 0.1 ], eye: [ 0.38, 1.24, - 0.05 ], chase: 7.8, paint: 0xf1f1ef },
	pickup: { name: 'Pickup', glb: 'cars/pickup.glb', len: 5.3, wid: 1.95, hgt: 1.78, wb: 3.2, track: 1.6, r: 0.39, mass: 1900, accel: 4.2, top: 40, rev: 7, brake: 8.5, grip: 0.95, steer: 0.56, tough: 1.35, price: 5600, sale: true, seat: [ 0.4, 0.42, 0.05 ], eye: [ 0.4, 1.45, 0.1 ], chase: 8.2 },
	van: { name: 'Delivery van', glb: 'cars/van.glb', len: 5.1, wid: 1.98, hgt: 2.35, wb: 3.1, track: 1.62, r: 0.36, mass: 2300, accel: 3.6, top: 36, rev: 6, brake: 8, grip: 0.88, steer: 0.55, tough: 1.3, price: 6400, sale: true, seat: [ 0.42, 0.4, 1.2 ], eye: [ 0.42, 1.55, 1.25 ], chase: 9 },
	sports: { name: 'Sports car', glb: 'cars/sports.glb', len: 4.35, wid: 1.92, hgt: 1.18, wb: 2.55, track: 1.58, r: 0.34, mass: 1250, accel: 7.6, top: 62, rev: 8, brake: 11, grip: 1.18, steer: 0.62, tough: 0.85, price: 16500, sale: true, seat: [ 0.4, 0.24, - 0.35 ], eye: [ 0.4, 1.0, - 0.3 ], chase: 7 },
	bus: { name: 'City bus', glb: 'cars/bus.glb', len: 11, wid: 2.5, hgt: 3.05, wb: 6.2, track: 2.0, r: 0.5, mass: 11000, accel: 2.2, top: 24, rev: 4, brake: 6, grip: 0.75, steer: 0.62, tough: 3, price: 0, sale: false, seat: [ 0.75, 0.75, 4.3 ], eye: [ 0.75, 2.2, 4.4 ], chase: 15, paint: 0x1f7350 },
};
export const KIND_IDS = Object.keys( KINDS );
export const SALE_KINDS = KIND_IDS.filter( ( k ) => KINDS[ k ].sale );

// civilian paint (sRGB hex); taxis, police cars and buses keep their own (KINDS.paint)
export const PAINTS = [ 0x8e1b1b, 0x1d3f7a, 0x2b2b2e, 0xd8d8d4, 0x6f7479, 0x2f5e3a, 0xb8862d, 0x5a2a5e, 0x9fb4c4, 0x7b4a2a, 0xc4c0b2, 0x1f6f78 ];
// what the city drives (weights), the parked ones too
export const TRAFFIC_MIX = { sedan: 0.42, taxi: 0.16, pickup: 0.14, van: 0.14, sports: 0.06, police: 0.08 };
export const PARKED_MIX = { sedan: 0.5, pickup: 0.16, van: 0.16, sports: 0.08, taxi: 0.1 };

export const G = 9.81;

// damage: hit points 100 x tough; the stage by the fraction left. 0 whole, 1 dented, 2 smoking, 3 burning (it burns down at
// burn hp/s), 4 a wreck: it explodes `fuse` s later (a powder keg: an explosion event), then lies charred for `charred` s
export const DAMAGE = {
	stages: [ 0.75, 0.45, 0.2, 0 ], // stage k while the fraction > stages[ k ]: 0 above 0.75, 1 above 0.45, 2 above 0.2, 3 above 0
	minImpact: 3.2, // m/s along the normal: below this a bump is free
	perImpact: 2.1, // hp per (m/s over minImpact)^1.5
	burn: 2.2,
	fuse: 4,
	charred: 90,
	explosion: { radius: 7.5, energy: 160000, hurt: 5 }, // m, J (the destruction feature's scale), m: the player knocked down within it
	pedestrian: 2.5, // m/s: faster than this a townsperson in the way is knocked aside
};

export function stageOf( frac, D = DAMAGE ) {

	if ( ! ( frac > 0 ) ) return 4;
	for ( let k = 0; k < 3; k ++ ) if ( frac > D.stages[ k ] ) return k;
	return 3;

}

// the hit points an impact at `speed` m/s (along the normal) costs a car of toughness `tough`
export function impactDamage( speed, tough = 1, D = DAMAGE ) {

	const over = Math.abs( speed ) - D.minImpact;
	return over > 0 ? D.perImpact * Math.pow( over, 1.5 ) / Math.max( 0.3, tough ) : 0;

}

// the city's wanted level (like the navy's at sea): heat 0..100, a level per 20; the police answer with level cars (max).
// Heat is for crimes the police know of: a driver thrown out (jack), a police car taken, somebody run down, a shot fired or
// another's car wrecked with a police car in sight, a stranger's car taken within a patrol's sight or its alarm within one's
// earshot. Honest driving, crashing your own car, driving it into the sea or taking a car you bought cost nothing.
export const WANTED = {
	gain: { jack: 26, parked: 6, alarm: 10, pedestrian: 12, police: 18, wreck: 14, explosion: 10, ram: 4, shot: 8 },
	alarmChance: 0.3, // a parked car's alarm goes off when it is taken
	earshot: 160, // m: a police car this near hears that alarm
	witness: 90, // m: a police car this near sees a parked car taken
	decay: 2.5, // heat / s once out of sight for `cool` s
	cool: 12,
	sight: 130, // m: a police car this near keeps the heat on
	pursuers: [ 0, 1, 2, 2, 3, 4 ], // police cars that chase per level
	bust: { range: 7, slow: 1.6, time: 2.6, fine: 300, onFoot: 3.5 }, // stopped this close this long: busted, fined x level
};

export function wantedLevel( heat ) {

	return heat > 0 ? Math.min( 5, Math.ceil( heat / 20 ) ) : 0;

}

// traffic budgets (desktop; phones a third): moving cars round the player, parked spots filled, the draw radii
export const TRAFFIC = {
	cars: 90, buses: 3, police: 3, fill: 0.42, // moving cars, buses on their loop, police on patrol; share of parking spots filled
	spawnMin: 90, spawnMax: 300, drop: 380, // m from the player: spawn out of sight, drop beyond
	near: 220, slowTick: 0.25, // m: nearer cars tick every frame, the rest every slowTick s
	parkedDraw: 230, drawFar: 600, // m
	active: 420, // m beyond MERIDIAN.radius: traffic runs while the player is this near the island
	turnSpeed: 7, minGap: 2.2, headway: 1.1, accel: 2.6, decel: 4.5, panic: 9,
	honkAfter: 2.8, rerouteAfter: 7, busStop: 7,
	signal: { green: 14, amber: 3, allRed: 1.5 },
};

export function phoneScale() {

	return globalThis.__phoneBudget ? 1 / 3 : 1;

}

// the dealer: a markup over KINDS.price for nothing, a trade in share of the price, the delivery to the lot
export const DEALER = { tradeIn: 0.45, repairPerHp: 18, reach: 3.2, maxOwned: 6 };

// a little seeded RNG (no shared state) and weighted picks
export function rngFor( seed ) {

	let a = ( seed >>> 0 ) || 1;
	return () => {

		a = ( a + 0x6D2B79F5 ) >>> 0;
		let t = a;
		t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
		t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}

export function pickWeighted( mix, r ) {

	let sum = 0;
	for ( const k in mix ) sum += mix[ k ];
	let x = r * sum;
	for ( const k in mix ) {

		x -= mix[ k ];
		if ( x <= 0 ) return k;

	}

	return Object.keys( mix )[ 0 ];

}

export function paintFor( kind, r ) {

	const K = KINDS[ kind ];
	return K && K.paint !== undefined ? K.paint : PAINTS[ Math.floor( r * PAINTS.length ) % PAINTS.length ];

}

export function hashStr( s ) {

	let h = 2166136261;
	for ( let i = 0; i < s.length; i ++ ) h = Math.imul( h ^ s.charCodeAt( i ), 16777619 );
	return h >>> 0;

}

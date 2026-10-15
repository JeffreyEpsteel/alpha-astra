// The hangar's airframes and their upgrades (wave 12, "I would also want more airplane options and upgradeability"),
// pure data and pure functions: the node test composes and flies them.
//
//   AIRFRAMES.jade / petrel / albatross / kestrel   { id, name, price, cls (upgrade price factor), seats, crates (a
//                                                   built-in bay), litres, rough (rough-landing / wreck threshold
//                                                   factor), hull, land, base ('ramp' | 'strip'), model, livery,
//                                                   cockpit (its panel layout in Panels.js) }
//   AIRFRAME_IDS                                    in hangar order (the Jade first: it is the plane of the old saves)
//   UPGRADES                                        the hangar rows: { id, name, tiers, price: [ per tier ], not: [ ids ] }
//   LIVERIES                                        four paint schemes (material colours: main, trim; null: the GLB's)
//   spec( id, upgrades, cargo ) -> Flight spec      the base SPEC with the airframe and the fitted upgrades composed,
//                                                   the cargo's mass and centre of gravity on top (pure: fresh objects)
//   upgradePrice( id, key, tier ) -> $              by airframe class; capacity( id, upgrades ) -> crates
//   defaultUpgrades() / cleanUpgrades( d )          the save form { engine, floats, tank, flaps, pod, armour, lights,
//                                                   search, radio, livery }
//
// The models (tools/seaplane/build_seaplane.py --variant) share the Jade's cabin, panel and eye point exactly, so the
// cockpit (Cockpit.js) and the wreck parts (node names WingL / WingR / Tail / FloatL / FloatR / Propeller) work on
// every airframe: the Albatross's FloatL / FloatR are its wingtip floats, the Kestrel's its main gear legs.

import { SPEC, GEOM, SECTIONS } from './Flight.js';

const DEG = Math.PI / 180;

export const AIRFRAMES = {
	jade: { id: 'jade', name: 'Jade', sub: 'High-wing floatplane: the all-rounder', price: 18000, cls: 1, seats: 4, crates: 0, litres: 300, rough: 1, hull: false, land: false, base: 'ramp', model: 'models/seaplane/Seaplane.glb', cockpit: 'jade' },
	petrel: { id: 'petrel', name: 'Petrel', sub: 'Light bush floatplane: short runs, tight turns', price: 11000, cls: 0.6, seats: 2, crates: 0, litres: 160, rough: 0.8, hull: false, land: false, base: 'ramp', model: 'models/seaplane/Petrel.glb', cockpit: 'petrel' },
	albatross: { id: 'albatross', name: 'Albatross', sub: 'Twin-engine flying boat: fast, heavy, a cargo bay', price: 42000, cls: 2.2, seats: 4, crates: 6, litres: 900, rough: 1.5, hull: true, land: false, base: 'ramp', model: 'models/seaplane/Albatross.glb', cockpit: 'albatross' },
	kestrel: { id: 'kestrel', name: 'Kestrel', sub: 'Land plane on fixed wheels: flies from the airstrip', price: 16000, cls: 1, seats: 4, crates: 0, litres: 280, rough: 1, hull: false, land: true, base: 'strip', model: 'models/seaplane/Kestrel.glb', cockpit: 'kestrel' },
};
export const AIRFRAME_IDS = Object.keys( AIRFRAMES );

export const UPGRADES = [
	{ id: 'engine', name: 'Engine', tiers: 3, price: [ 2400, 3800, 5600 ], note: '+15 % thrust a tier, faster spool, a thirstier burn' },
	{ id: 'floats', name: 'Floats', tiers: 2, price: [ 1800, 3200 ], note: 'Rough water: higher landing limits, less drag at the hump' },
	{ id: 'tank', name: 'Long-range tank', tiers: 1, price: [ 1600 ], note: '+60 % fuel' },
	{ id: 'flaps', name: 'STOL flaps', tiers: 1, price: [ 2200 ], note: 'A third notch: shorter takeoffs, slower approaches' },
	{ id: 'pod', name: 'Cargo pod', tiers: 1, price: [ 1500 ], not: [ 'albatross' ], note: 'Two crates under the fuselage (+8 % drag)' },
	{ id: 'armour', name: 'Armour', tiers: 1, price: [ 2800 ], note: '+50 % hull points, +6 % mass' },
	{ id: 'lights', name: 'Landing lights', tiers: 1, price: [ 900 ], note: 'A brighter, wider pair' },
	{ id: 'search', name: 'Searchlight', tiers: 1, price: [ 1200 ], note: 'Hold ; to sweep it where you look' },
	{ id: 'radio', name: 'Radio', tiers: 1, price: [ 1400 ], note: 'The map shows ships and wrecks within 600 m' },
	{ id: 'livery', name: 'Livery', tiers: 3, price: [ 400, 400, 400 ], paint: true, note: 'Four paint schemes' },
];
export const UPGRADE_IDS = UPGRADES.map( ( u ) => u.id );
export const RADIO_RANGE = 600;
export const POD_CRATES = 2;

// sRGB colours (Model.js converts them): the main (jade) and trim (cream) materials
export const LIVERIES = [
	{ id: 'factory', name: 'Factory', main: null, trim: null },
	{ id: 'harbour', name: 'Harbour red', main: [ 0.66, 0.12, 0.09 ], trim: [ 0.95, 0.92, 0.85 ] },
	{ id: 'navy', name: 'Navy and gold', main: [ 0.08, 0.17, 0.38 ], trim: [ 0.93, 0.74, 0.22 ] },
	{ id: 'sunflower', name: 'Sunflower', main: [ 0.96, 0.74, 0.12 ], trim: [ 0.14, 0.14, 0.15 ] },
];

export function defaultUpgrades() {

	return { engine: 0, floats: 0, tank: 0, flaps: 0, pod: 0, armour: 0, lights: 0, search: 0, radio: 0, livery: 0 };

}

export function cleanUpgrades( d ) {

	const u = defaultUpgrades();
	if ( ! d || typeof d !== 'object' ) return u;
	for ( const U of UPGRADES ) {

		const v = d[ U.id ];
		if ( Number.isFinite( v ) ) u[ U.id ] = Math.max( 0, Math.min( U.tiers, Math.round( v ) ) );
		else if ( v === true ) u[ U.id ] = 1;

	}

	return u;

}

export function upgradeFits( id, key ) {

	const U = UPGRADES.find( ( u ) => u.id === key );
	return !! U && ! ( U.not && U.not.includes( id ) );

}

// what tier `tier` (1..) of an upgrade costs on this airframe (a repaint: tier = the scheme)
export function upgradePrice( id, key, tier = 1 ) {

	const A = AIRFRAMES[ id ] || AIRFRAMES.jade, U = UPGRADES.find( ( u ) => u.id === key );
	if ( ! U ) return 0;
	const p = U.paint ? U.price[ 0 ] : U.price[ Math.max( 0, Math.min( U.tiers, tier ) - 1 ) ];
	return Math.round( p * ( U.paint ? 1 : A.cls ) / 50 ) * 50;

}

// crates the airframe carries with these upgrades (the Albatross's bay, a pod on the others)
export function capacity( id, upgrades = {} ) {

	const A = AIRFRAMES[ id ] || AIRFRAMES.jade;
	return A.crates + ( upgrades.pod && upgradeFits( id, 'pod' ) ? POD_CRATES : 0 );

}

// ---------------------------------------------------------------- the airframes' geometry and base specs

const surf = ( name ) => SPEC.surfaces.find( ( s ) => s.name === name );

function strikeFor( span, extra = [] ) {

	const tip = span / 2 - 0.05;
	return [ [ 'wingtip', tip, 3.25, 0.3 ], [ 'wingtip', - tip, 3.25, 0.3 ], ...extra ];

}

const JADE_STRIKE_BODY = GEOM.strike.filter( ( s ) => s[ 0 ] !== 'wingtip' );

// the Petrel: smaller floats (x 1.2; the afterbody 85 % of the Jade's, the forebody 97 %: her bows reach to under the
// propeller, as the Jade's do), an 11.6 m wing, a smaller propeller. With the bows cut back to 85 % too she was launched
// off a crest at 20 m/s on a wind sea and came down nose first on the next one (the propeller 0.9 m ahead of the bows):
// the longer forebody carries the nose up through the hump and on the chop (tools/seaplane/build_seaplane.py fz()).
const PETREL_Z = ( z ) => z * ( z >= 0 ? 0.97 : 0.85 );
const PETREL_GEOM = {
	...GEOM,
	probes: [ [ 1.2, 2.5 ], [ - 1.2, 2.5 ], [ 1.2, - 2.55 ], [ - 1.2, - 2.55 ] ],
	floats: [ 1.2, - 1.2 ].map( ( x ) => ( { x, side: Math.sign( x ), y0: 0, beam: 0.7, top: 0.58, step: - 0.25, fore: 2.4, len: 0.68, sections: SECTIONS.map( ( [ z, af, r ] ) => [ PETREL_Z( z ), af, r ] ), rudder: true } ) ),
	keels: [ 1.2, - 1.2 ].flatMap( ( x ) => [ [ x, 0.3, 3.35 ], [ x, 0, 0.7 ], [ x, 0, - 0.25 ], [ x, 0.22, - 3.15 ] ] ),
	strike: strikeFor( 11.6, [ [ 'propeller', 0, 1.2, 3.85 ], [ 'nose', 0, 2.2, 4.0 ], [ 'tail', 0, 1.95, - 6.4 ], [ 'fin', 0, 4.1, - 6.2 ], [ 'tailplane', 2.0, 2.55, - 5.6 ], [ 'tailplane', - 2.0, 2.55, - 5.6 ] ] ),
	engines: [ [ 0, 1.95, 3.6 ] ],
	props: [ GEOM.prop ],
	propRadius: 1.0,
	span: 11.6,
	floatX: 1.2,
};

// the Albatross: a boat hull (centre, 2 m beam, the keel at y 0) with wingtip floats clear of the water at rest, a
// 19 m wing with two engines in nacelles at x +-2.7
const HULL = [];
for ( let z = 4.0; z >= - 4.45; z -= 0.75 ) {

	const bow = Math.max( 0, ( z - 2.4 ) / 1.6 ), aft = Math.max( 0, ( - z - 1.6 ) / 2.9 );
	HULL.push( [ Math.round( z * 100 ) / 100, 1 - 0.55 * bow - 0.35 * aft, 0.5 * bow * bow + 0.35 * aft ] );

}

const ALBATROSS_GEOM = {
	...GEOM,
	com: [ 0, 1.6, - 0.1 ],
	probes: [ [ 1.0, 3.0 ], [ - 1.0, 3.0 ], [ 1.0, - 3.6 ], [ - 1.0, - 3.6 ] ],
	floats: [
		{ x: 0, side: 0, y0: 0, beam: 2.0, top: 1.35, step: - 0.6, fore: 2.6, len: 0.75, sections: HULL, rudder: true },
		...[ 7.2, - 7.2 ].map( ( x ) => ( { x, side: Math.sign( x ), y0: 0.95, beam: 0.36, top: 1.5, step: - 9, fore: - 9, len: 0.6, sections: [ [ 0.7, 0.6, 0.1 ], [ 0.1, 1, 0 ], [ - 0.5, 0.7, 0.05 ] ], rudder: false } ) ),
	],
	keels: [ [ 0, 0.4, 3.9 ], [ 0.6, 0.05, 1.2 ], [ - 0.6, 0.05, 1.2 ], [ 0.6, 0.08, - 1.2 ], [ - 0.6, 0.08, - 1.2 ], [ 0, 0.5, - 4.3 ] ],
	strike: strikeFor( 19, [ [ 'propeller', 2.7, 1.95, 2.75 ], [ 'propeller', - 2.7, 1.95, 2.75 ], [ 'nose', 0, 1.25, 4.5 ], [ 'tail', 0, 1.7, - 7.4 ], [ 'fin', 0, 4.7, - 7.3 ], [ 'tailplane', 3.2, 3.0, - 6.8 ], [ 'tailplane', - 3.2, 3.0, - 6.8 ] ] ),
	engines: [ [ 2.7, 3.05, 2.3 ], [ - 2.7, 3.05, 2.3 ] ],
	props: [ [ 2.7, 3.05, 2.75 ], [ - 2.7, 3.05, 2.75 ] ],
	prop: [ 2.7, 3.05, 2.75 ],
	propRadius: 1.12,
	door: [ 1.05, 1.0, 0.3 ],
	span: 19,
	length: 12.4,
	floatX: 7.2,
};

// the Kestrel: the Jade on a fixed tricycle gear (the wheels' contact at y 0, the mains just behind the centre of mass)
const KESTREL_GEOM = {
	...GEOM,
	com: [ 0, 1.75, 0.1 ],
	floats: [ { x: 0, side: 0, y0: 0.05, beam: 1.4, top: 1.6, step: - 9, fore: - 9, len: 1.0, sections: [ [ 2.8, 0.6, 0 ], [ 1.0, 1, 0 ], [ - 0.4, 1, 0 ], [ - 2.0, 0.6, 0.5 ] ], rudder: false } ],
	keels: [],
	wheels: [ { x: 0, y: 0, z: 3.0, steer: true, brake: false }, { x: 1.3, y: 0, z: - 0.35, steer: false, brake: true }, { x: - 1.3, y: 0, z: - 0.35, steer: false, brake: true } ],
	strike: strikeFor( GEOM.span, JADE_STRIKE_BODY ),
	door: [ 1.0, 0.3, 1.0 ],
	floatX: 1.3,
};

const BASE = {
	jade: () => ( { ...SPEC, geom: GEOM } ),
	petrel: () => ( {
		...SPEC, geom: PETREL_GEOM,
		mass: 980, inertia: [ 2100, 3000, 1600 ], maxThrust: 6200, pitchSpeed: 43, spoolUp: 0.55, discArea: Math.PI,
		surfaces: [
			{ ...surf( 'wingL' ), pos: [ 2.9, 3.25, 0.6 ], area: 9.6, ar: 8.2, cl0: 0.42, dcl: 1.9 },
			{ ...surf( 'wingR' ), pos: [ - 2.9, 3.25, 0.6 ], area: 9.6, ar: 8.2, cl0: 0.42, dcl: - 1.9 },
			{ ...surf( 'tail' ), area: 3.6 },
			{ ...surf( 'fin' ), area: 1.9 },
		],
		dragArea: 1.15, sideArea: 4.4, controlRate: 6,
		// twice the Jade's planing lift on her short forebody (PETREL_GEOM fore 2.4): with the Jade's she rode the hump
		// 11 deg nose down and dug the propeller into any head swell before she reached the step
		planing: 0.022,
		waterRudder: { ...SPEC.waterRudder, z: - 3.3 },
		fuelMinutes: 20,
	} ),
	albatross: () => ( {
		...SPEC, geom: ALBATROSS_GEOM,
		mass: 4300, inertia: [ 15000, 26000, 17000 ], maxThrust: 21000, pitchSpeed: 98, spoolUp: 0.9, spoolDown: 1.2,
		thrustPoint: ALBATROSS_GEOM.engines[ 0 ], discArea: 2 * Math.PI * 1.12 * 1.12,
		surfaces: [
			{ ...surf( 'wingL' ), pos: [ 4.6, 3.3, 0.5 ], area: 23, ar: 9.5, cl0: 0.4, incidence: 5 * DEG },
			{ ...surf( 'wingR' ), pos: [ - 4.6, 3.3, 0.5 ], area: 23, ar: 9.5, cl0: 0.4, incidence: 5 * DEG },
			{ ...surf( 'tail' ), pos: [ 0, 3.0, - 6.6 ], area: 8.6, incidence: 4.5 * DEG, slip: 0.2 },
			{ ...surf( 'fin' ), pos: [ 0, 3.7, - 6.9 ], area: 4.6, slip: 0.1 },
		],
		dragArea: 2.0, dragPoint: [ 0, 1.4, 0.2 ], sideArea: 11, sidePoint: [ 0, 1.6, - 1.6 ],
		heaveDamp: 2200, sideK: 900, planing: 0.009,
		waterRudder: { area: 0.3, slope: 3.0, max: 30 * DEG, z: - 4.5 },
		groundK: 520000, groundC: 52000,
		fuelMinutes: 38,
	} ),
	kestrel: () => ( {
		...SPEC, geom: KESTREL_GEOM,
		mass: 1500, inertia: [ 3600, 5800, 3000 ], maxThrust: 4300, pitchSpeed: 80,
		dragArea: 0.95, sideArea: 4.6,
		gearK: 80000, gearC: 7000, rollMu: 0.03, brakeMu: 0.75, noseSteer: 0.5,
		fuelMinutes: 26,
		land: true,
	} ),
};

// cargo stations (model frame): where the crates ride
const CARGO_AT = { pod: [ 0, 0.95, 0.3 ], bay: [ 0, 1.0, - 1.3 ] };

// cargo: [ { good, qty, kg (per unit), crates (per unit) } ] (Seaplane.js keeps it); mass and centre of gravity shift
export function cargoMass( cargo = [] ) {

	let kg = 0, crates = 0;
	for ( const c of cargo || [] ) if ( c && c.qty > 0 ) {

		kg += c.qty * ( c.kg || 30 );
		crates += c.qty * ( c.crates || 1 );

	}

	return { kg, crates };

}

export function spec( id = 'jade', upgrades = {}, cargo = [] ) {

	const A = AIRFRAMES[ id ] || AIRFRAMES.jade;
	const u = cleanUpgrades( upgrades );
	const s = BASE[ A.id ]();
	s.id = A.id;
	s.name = A.name;
	s.seats = A.seats;
	s.upgrades = u;
	s.landplane = !! A.land;
	s.hull = !! A.hull;
	// engine tiers: +15 % thrust each, a faster spool, a thirstier burn
	const e = u.engine;
	s.maxThrust *= 1 + 0.15 * e;
	s.spoolUp *= 1 - 0.12 * e;
	let minutes = s.fuelMinutes / ( 1 + 0.12 * e );
	// floats / hull / gear: rough water (higher thresholds), less drag at the hump
	s.rough = A.rough * ( 1 + 0.15 * u.floats );
	s.humpDrag = 1 - 0.12 * u.floats;
	// the long-range tank
	s.litres = A.litres * ( u.tank ? 1.6 : 1 );
	if ( u.tank ) minutes *= 1.6;
	s.fuelMinutes = minutes;
	// STOL flaps: a third notch and a little more lift per notch
	s.flaps = { ...SPEC.flaps, notches: u.flaps ? 3 : 2, dcl: SPEC.flaps.dcl * ( u.flaps ? 1.15 : 1 ) };
	// the cargo pod (drag) / the bay
	s.crates = capacity( A.id, u );
	if ( u.pod && upgradeFits( A.id, 'pod' ) ) s.dragArea *= 1.08;
	// armour
	s.hullPoints = u.armour ? 1.5 : 1;
	if ( u.armour ) s.mass *= 1.06;
	s.lights = { pair: !! u.lights, search: !! u.search };
	s.radio = !! u.radio;
	s.livery = u.livery;
	// the load: mass, inertia and the centre of gravity (a small pitch trim change: aft crates raise the nose)
	const load = cargoMass( cargo );
	s.cargoKg = load.kg;
	s.cargoCrates = load.crates;
	const g = s.geom;
	if ( load.kg > 0 ) {

		const at = A.crates ? CARGO_AT.bay : CARGO_AT.pod;
		const m0 = s.mass, m1 = m0 + load.kg;
		const com = g.com.map( ( c, i ) => ( c * m0 + at[ i ] * load.kg ) / m1 );
		s.geom = { ...g, com };
		s.inertia = s.inertia.map( ( v ) => v * m1 / m0 );
		s.mass = m1;

	}

	return s;

}

// A cockpit of its own for every airframe (wave 14A, "I want the cockpits to be different for every plane"): pure
// data that Cockpit.js draws, hit-tests and casts rays against. Every model shares the Jade's panel housing (GEOM.panel,
// 1.22 x 0.40 m), so each face keeps its 3.05 : 1 shape; the pixel size, the paint, the instruments and their places
// differ. The attitude indicator stays in front of the left seat on every panel.
//
//   LAYOUTS.jade / petrel / albatross / kestrel
//     { id, name, w, h        the face texture in px (within 1024 x 512)
//       theme                 { paint, glow (the bare paint's share of the night glow), grain ('lines' | 'crackle' |
//                               'wrinkle' | 'grain'), grainColor, face, bezel, ring (a bezel rim or null), ink, dim,
//                               needle, hub, plate, plateInk, lampOff, lampInk, placard, placardInk, screen, screenInk, font }
//       items                 [ { id?, kind, x, y, w, h, label?, key?, act?, ... } ] in draw order (px)
//       controls              the items with a label: the hover / click targets (unique ids; act: Seaplane.act( id ))
//       strip                 [ [ key, label ] ] the chase-view strip's extra cells
//       dials }               how many round gauges
//   layoutFor( af ) -> layout (AIRFRAMES[ af ].cockpit; the Jade's for anything unknown)
//
// Kinds. Round (cx, cy, r): asi att alt rpm hdg vsi tc (turn coordinator) ftrim (float / hull trim) erpm oil (eng).
// Boxes: tape (vertical airspeed) compass (wet compass card) ff (fuel flow, eng) gs (ground speed) lamp (lamp: stall
// warn fuel start ap rudder out brake) bar (bar: fuel | hull) flaps / trim (drawn; their halves are 'hit' items) radio
// switch (state: master nav landing ap parkBrake) engine feather (eng) gear plate (title) placard (lines). One placard
// (or, on the Petrel and the Kestrel, the radio screen) is marked `bail`: it prints the bail-out hint (Seaplane.bailHint).

import { AIRFRAMES } from './Airframes.js';

// id -> [ tooltip, key, clickable ]
const CTL = {
	master: [ 'Master switch (battery)', 'U', true ],
	engine: [ 'Engine start / stop', 'O', true ],
	nav: [ 'Navigation lights', 'N', true ],
	landing: [ 'Landing light', ';', true ],
	ap: [ 'Autopilot: wings level, altitude hold', 'Y', true ],
	warn: [ 'Master warning: click to silence', '', true ],
	flapsUp: [ 'Flaps up', '[', true ],
	flapsDown: [ 'Flaps down', ']', true ],
	trimDown: [ 'Trim: nose down', '-', true ],
	trimUp: [ 'Trim: nose up', '=', true ],
	map: [ 'Radio: open the world map', 'M', true ],
	brake: [ 'Parking brake (hold B for the wheel brakes)', 'B', true ],
	feather1: [ 'Port engine: feather / restart', '', true ],
	feather2: [ 'Starboard engine: feather / restart', '', true ],
	asi: [ 'Airspeed (m/s, knots)' ],
	att: [ 'Attitude: pitch and bank' ],
	alt: [ 'Altimeter (m above the sea)' ],
	rpm: [ 'Engine rpm and throttle' ],
	hdg: [ 'Heading' ],
	vsi: [ 'Vertical speed (m/s)' ],
	fuel: [ 'Fuel' ],
	hull: [ 'Hull condition' ],
	stallLamp: [ 'Stall warning' ],
	fuelLamp: [ 'Fuel low' ],
	startLamp: [ 'Starter engaged' ],
	apLamp: [ 'Autopilot engaged' ],
	rudderLamp: [ 'Water rudder down (on the water)' ],
	brakeLamp: [ 'Wheel brakes set' ],
	ftrim: [ 'Float trim: the attitude on the water (green: on the step)' ],
	tc: [ 'Turn coordinator: rate of turn (the 2 min mark) and slip' ],
	tape: [ 'Airspeed tape (m/s, knots)' ],
	compass: [ 'Wet compass (heading)' ],
	gs: [ 'Ground speed (knots, m/s)' ],
	gear: [ 'Landing gear: fixed, down and locked (three green)' ],
	rpm1: [ 'Port engine rpm and throttle' ],
	rpm2: [ 'Starboard engine rpm and throttle' ],
	oil1: [ 'Port engine oil pressure' ],
	oil2: [ 'Starboard engine oil pressure' ],
	ff1: [ 'Port engine fuel flow' ],
	ff2: [ 'Starboard engine fuel flow' ],
	out1: [ 'Port engine out' ],
	out2: [ 'Starboard engine out' ],
};

export const DIAL_KINDS = [ 'asi', 'att', 'alt', 'rpm', 'hdg', 'vsi', 'tc', 'ftrim', 'erpm', 'oil' ];

const B = ( x, y, w, h ) => ( { x, y, w, h } );
const D = ( cx, cy, r ) => ( { cx, cy, r, x: cx - r, y: cy - r, w: r * 2, h: r * 2 } );

// a control (labelled: hover / click) and a decoration (drawn only)
function C( id, kind, box, extra = {} ) {

	const [ label = id, key = '', act = false ] = CTL[ id ] || [];
	return { id, kind, ...box, label, key, act, ...extra };

}

const deco = ( kind, box, extra = {} ) => ( { kind, ...box, ...extra } );

// the flap lever and the trim wheel: drawn whole, clicked by halves (up / nose down on top)
function lever( kind, x, y, w, h ) {

	const top = Math.floor( h / 2 );
	const [ a, b ] = kind === 'flaps' ? [ 'flapsUp', 'flapsDown' ] : [ 'trimDown', 'trimUp' ];
	return [ deco( kind, B( x, y, w, h ) ), C( a, 'hit', B( x, y, w, top ) ), C( b, 'hit', B( x, y + top, w, h - top ) ) ];

}

// n boxes in a row (or a column)
const row = ( x, y, w, h, gap, n ) => Array.from( { length: n }, ( _, i ) => B( x + i * ( w + gap ), y, w, h ) );
const col = ( x, y, w, h, gap, n ) => Array.from( { length: n }, ( _, i ) => B( x, y + i * ( h + gap ), w, h ) );

function lamps( boxes, set ) {

	return set.map( ( [ id, lamp, extra ], i ) => C( id, 'lamp', boxes[ i ], { lamp, ...extra } ) );

}

const SW = {
	master: ( b ) => C( 'master', 'switch', b, { state: 'master', text: 'MASTER' } ),
	nav: ( b ) => C( 'nav', 'switch', b, { state: 'nav', text: 'NAV', sub: 'lights' } ),
	landing: ( b ) => C( 'landing', 'switch', b, { state: 'landing', text: 'LAND', sub: 'light' } ),
	ap: ( b ) => C( 'ap', 'switch', b, { state: 'ap', text: 'AUTO', sub: 'pilot' } ),
	brake: ( b ) => C( 'brake', 'switch', b, { state: 'parkBrake', text: 'P.BRAKE', sub: 'park' } ),
};

const BASE_LAMPS = [ [ 'stallLamp', 'stall' ], [ 'warn', 'warn' ], [ 'fuelLamp', 'fuel' ], [ 'startLamp', 'start' ], [ 'apLamp', 'ap' ] ];

const THEMES = {
	// cream enamel, brass bezel rims, the dark faces of today's six-pack
	jade: {
		paint: '#e6dcc2', glow: 0.3, grain: 'lines', grainColor: 'rgba(120,96,52,0.07)',
		face: '#14181b', bezel: '#07090a', ring: '#b48f3e', ink: '#eef2ee', dim: '#7d8a86', needle: '#eef2ee', hub: '#2a2f33',
		plate: '#171b1e', plateInk: '#eef2ee', lampOff: '#16191b', lampInk: '#4b5357',
		placard: '#d3c6a4', placardInk: '#3b3122', screen: '#0c2a20', screenInk: '#7dffc4',
		font: '"Segoe UI", system-ui, sans-serif',
	},
	// grey crackle finish, black bezels, white needles, a nixie-orange radio
	petrel: {
		paint: '#5f6569', glow: 0.55, grain: 'crackle', grainColor: 'rgba(30,34,37,0.55)',
		face: '#0f1113', bezel: '#020303', ring: null, ink: '#ffffff', dim: '#9aa3a8', needle: '#ffffff', hub: '#d8dcde',
		plate: '#24282b', plateInk: '#f4f4f4', lampOff: '#1b1e20', lampInk: '#5d666b',
		placard: '#3e4347', placardInk: '#e9e9e4', screen: '#1f0d04', screenInk: '#ff9a3c',
		font: '"Trebuchet MS", "Segoe UI", sans-serif',
	},
	// a wide dark wrinkle-finish panel, steel bezels, luminous cream markings, an amber radio
	albatross: {
		paint: '#1a1d20', glow: 1, grain: 'wrinkle', grainColor: 'rgba(255,255,255,0.035)',
		face: '#0b0e10', bezel: '#050607', ring: null, ink: '#f2ecd8', dim: '#8a8676', needle: '#f6e6a6', hub: '#3a3f44',
		plate: '#121517', plateInk: '#f2ecd8', lampOff: '#121416', lampInk: '#4a4f52',
		placard: '#262b2f', placardInk: '#cfc7ae', screen: '#231504', screenInk: '#ffc04a',
		font: '"Bahnschrift", "Arial Narrow", system-ui, sans-serif',
	},
	// a compact tan panel, bronze rims, a blue LCD radio
	kestrel: {
		paint: '#b39b74', glow: 0.35, grain: 'grain', grainColor: 'rgba(70,46,20,0.08)',
		face: '#16181a', bezel: '#0a0b0b', ring: '#6e5838', ink: '#f3f0e6', dim: '#8c8a80', needle: '#ffffff', hub: '#c46a1c',
		plate: '#2a241c', plateInk: '#f3efe2', lampOff: '#1d1a16', lampInk: '#5d554a',
		placard: '#8f7a57', placardInk: '#1e150a', screen: '#0b1a2c', screenInk: '#8fd3ff',
		font: 'Verdana, "Segoe UI", sans-serif',
	},
};

function finish( L ) {

	L.controls = L.items.filter( ( i ) => i.label );
	L.dials = L.items.filter( ( i ) => DIAL_KINDS.includes( i.kind ) ).length;
	L.strip = L.strip || [];
	return L;

}

// ---------------------------------------------------------------- the Jade: today's face on cream enamel
function jade() {

	const R = 70, X = [ 88, 243, 398 ], Y = [ 84, 248 ];
	const lampBoxes = row( 484, 12, 82, 44, 6, 6 );
	const sw = row( 484, 222, 84, 102, 6, 5 );
	return finish( {
		id: 'jade', name: 'Jade', w: 1024, h: 336, theme: THEMES.jade,
		items: [
			C( 'asi', 'asi', D( X[ 0 ], Y[ 0 ], R ) ),
			C( 'att', 'att', D( X[ 1 ], Y[ 0 ], R ) ),
			C( 'alt', 'alt', D( X[ 2 ], Y[ 0 ], R ) ),
			C( 'rpm', 'rpm', D( X[ 0 ], Y[ 1 ], R ) ),
			C( 'hdg', 'hdg', D( X[ 1 ], Y[ 1 ], R ) ),
			C( 'vsi', 'vsi', D( X[ 2 ], Y[ 1 ], R ) ),
			...lamps( lampBoxes, [ ...BASE_LAMPS, [ 'rudderLamp', 'rudder' ] ] ),
			deco( 'placard', B( 488, 209, 518, 11 ), { lines: [ 'JADE  ·  VNE 70 m/s  ·  FLAPS 1 BELOW 35 m/s  ·  4 SEATS' ], px: 9, bail: true } ),
			C( 'fuel', 'bar', B( 488, 66, 60, 142 ), { bar: 'fuel' } ),
			C( 'hull', 'bar', B( 556, 66, 60, 142 ), { bar: 'hull' } ),
			...lever( 'flaps', 630, 66, 72, 142 ),
			...lever( 'trim', 716, 66, 92, 142 ),
			C( 'map', 'radio', B( 822, 66, 184, 142 ), { brand: 'NAVCOM' } ),
			SW.master( sw[ 0 ] ),
			C( 'engine', 'engine', sw[ 1 ], { text: 'ENGINE' } ),
			SW.nav( sw[ 2 ] ),
			SW.landing( sw[ 3 ] ),
			SW.ap( sw[ 4 ] ),
			C( 'ftrim', 'ftrim', D( 974, 273, 38 ), { text: 'FLOATS' } ),
		],
	} );

}

// ---------------------------------------------------------------- the Petrel: a bush plane's grey crackle panel
function petrel() {

	const sw = row( 670, 176, 52, 128, 4, 5 );
	return finish( {
		id: 'petrel', name: 'Petrel', w: 960, h: 315, theme: THEMES.petrel,
		items: [
			C( 'asi', 'asi', D( 82, 84, 62 ), { max: 60, bands: { white: [ 13, 28 ], green: [ 17, 42 ], amber: [ 42, 52 ], red: 52 } } ),
			C( 'att', 'att', D( 228, 84, 70 ) ),
			C( 'alt', 'alt', D( 374, 84, 62 ) ),
			C( 'rpm', 'rpm', D( 82, 240, 56 ) ),
			C( 'compass', 'compass', B( 166, 180, 124, 50 ) ),
			C( 'oil1', 'oil', D( 198, 274, 28 ), { label: 'Oil pressure' } ),
			C( 'ff1', 'ff', B( 234, 248, 56, 52 ), { label: 'Fuel flow (L/h)' } ),
			C( 'vsi', 'vsi', D( 374, 240, 56 ) ),
			...lamps( col( 458, 10, 78, 36, 8, 6 ), [ ...BASE_LAMPS, [ 'rudderLamp', 'rudder' ] ] ),
			deco( 'placard', B( 458, 274, 78, 32 ), { lines: [ 'PETREL', '2 SEATS' ], px: 11 } ),
			C( 'fuel', 'bar', B( 548, 10, 54, 150 ), { bar: 'fuel' } ),
			C( 'hull', 'bar', B( 608, 10, 54, 150 ), { bar: 'hull' } ),
			...lever( 'flaps', 668, 10, 64, 150 ),
			...lever( 'trim', 738, 10, 80, 150 ),
			C( 'map', 'radio', B( 824, 10, 126, 150 ), { brand: 'BUSH COM', bail: true } ),
			C( 'ftrim', 'ftrim', D( 604, 238, 52 ), { text: 'FLOATS' } ),
			SW.master( sw[ 0 ] ),
			C( 'engine', 'engine', sw[ 1 ], { text: 'ENGINE' } ),
			SW.nav( sw[ 2 ] ),
			SW.landing( sw[ 3 ] ),
			SW.ap( sw[ 4 ] ),
		],
	} );

}

// ---------------------------------------------------------------- the Albatross: a wide dark panel, two engine columns
function engineColumn( n, x ) {

	const side = n === 1 ? 'PORT' : 'STBD', cx = x + 62;
	return [
		deco( 'plate', B( x, 4, 124, 328 ), { title: `ENG ${ n }  ·  ${ side }` } ),
		C( 'rpm' + n, 'erpm', D( cx, 78, 46 ), { eng: n } ),
		C( 'oil' + n, 'oil', D( x + 40, 172, 30 ), { eng: n } ),
		C( 'ff' + n, 'ff', B( x + 78, 146, 42, 52 ), { eng: n } ),
		C( 'out' + n, 'lamp', B( x + 6, 210, 112, 32 ), { lamp: 'out', eng: n } ),
		C( 'feather' + n, 'feather', B( x + 6, 250, 112, 78 ), { eng: n } ),
	];

}

function albatross() {

	const X = [ 70, 196, 322 ], Y = [ 70, 196 ], R = 56;
	const sw = row( 12, 266, 70, 64, 6, 5 );
	return finish( {
		id: 'albatross', name: 'Albatross', w: 1024, h: 336, theme: THEMES.albatross,
		items: [
			C( 'asi', 'asi', D( X[ 0 ], Y[ 0 ], R ), { max: 100, bands: { white: [ 20, 40 ], green: [ 26, 62 ], amber: [ 62, 75 ], red: 75 } } ),
			C( 'att', 'att', D( X[ 1 ], Y[ 0 ], R ) ),
			C( 'alt', 'alt', D( X[ 2 ], Y[ 0 ], R ) ),
			C( 'tc', 'tc', D( X[ 0 ], Y[ 1 ], R ) ),
			C( 'hdg', 'hdg', D( X[ 1 ], Y[ 1 ], R ) ),
			C( 'vsi', 'vsi', D( X[ 2 ], Y[ 1 ], R ) ),
			SW.master( sw[ 0 ] ),
			C( 'engine', 'engine', sw[ 1 ], { text: 'ENGINES', label: 'Engines start / stop (both)' } ),
			SW.nav( sw[ 2 ] ),
			SW.landing( sw[ 3 ] ),
			SW.ap( sw[ 4 ] ),
			...engineColumn( 1, 394 ),
			...engineColumn( 2, 524 ),
			...lamps( row( 656, 8, 56, 34, 5, 6 ), [ ...BASE_LAMPS, [ 'rudderLamp', 'rudder' ] ] ),
			C( 'fuel', 'bar', B( 658, 50, 50, 150 ), { bar: 'fuel' } ),
			C( 'hull', 'bar', B( 714, 50, 50, 150 ), { bar: 'hull' } ),
			...lever( 'flaps', 770, 50, 60, 150 ),
			...lever( 'trim', 836, 50, 70, 150 ),
			C( 'map', 'radio', B( 912, 50, 106, 150 ), { brand: 'HF 2' } ),
			C( 'ftrim', 'ftrim', D( 714, 270, 54 ), { text: 'HULL', label: 'Hull trim: the attitude on the water (green: on the step)' } ),
			deco( 'placard', B( 786, 214, 230, 114 ), { lines: [ 'ALBATROSS  ·  TWIN FLYING BOAT', 'ENGINE OUT: RUDDER TO THE LIVE ONE', 'FEATHER THE DEAD ENGINE', 'VMC 30 m/s  ·  VNE 75 m/s' ], px: 12, bail: true } ),
		],
		strip: [ [ 'rpm1', 'Eng 1' ], [ 'rpm2', 'Eng 2' ] ],
	} );

}

// ---------------------------------------------------------------- the Kestrel: a compact tan panel, gear and brakes
function kestrel() {

	const sw = row( 542, 214, 54, 74, 4, 6 );
	return finish( {
		id: 'kestrel', name: 'Kestrel', w: 896, h: 294, theme: THEMES.kestrel,
		items: [
			C( 'tape', 'tape', B( 12, 12, 72, 248 ) ),
			deco( 'placard', B( 12, 266, 72, 20 ), { lines: [ 'KESTREL' ], px: 11 } ),
			C( 'att', 'att', D( 170, 78, 64 ) ),
			C( 'alt', 'alt', D( 316, 78, 64 ) ),
			C( 'hdg', 'hdg', D( 170, 218, 60 ) ),
			C( 'rpm', 'rpm', D( 316, 218, 60 ) ),
			...lamps( row( 398, 10, 76, 36, 6, 6 ), [ ...BASE_LAMPS, [ 'brakeLamp', 'brake' ] ] ),
			C( 'vsi', 'vsi', D( 452, 108, 50 ) ),
			C( 'gs', 'gs', B( 400, 170, 104, 36 ) ),
			C( 'fuel', 'bar', B( 514, 54, 50, 152 ), { bar: 'fuel' } ),
			C( 'hull', 'bar', B( 570, 54, 50, 152 ), { bar: 'hull', text: 'AIRFRAME' } ),
			...lever( 'flaps', 626, 54, 60, 152 ),
			...lever( 'trim', 692, 54, 70, 152 ),
			C( 'map', 'radio', B( 768, 54, 118, 152 ), { brand: 'COM 1', bail: true } ),
			C( 'gear', 'gear', B( 400, 214, 136, 74 ) ),
			SW.master( sw[ 0 ] ),
			C( 'engine', 'engine', sw[ 1 ], { text: 'ENGINE' } ),
			SW.nav( sw[ 2 ] ),
			SW.landing( sw[ 3 ] ),
			SW.ap( sw[ 4 ] ),
			SW.brake( sw[ 5 ] ),
		],
		strip: [ [ 'gear', 'Gear' ], [ 'gs', 'GS' ] ],
	} );

}

export const LAYOUTS = { jade: jade(), petrel: petrel(), albatross: albatross(), kestrel: kestrel() };
export const THEME = THEMES;

export function layoutFor( af ) {

	const A = AIRFRAMES[ af ];
	return LAYOUTS[ A && A.cockpit ] || LAYOUTS[ af ] || LAYOUTS.jade;

}

// the control under a face pixel (canvas px of that layout)
export function controlAt( layout, px, py ) {

	for ( const c of layout.controls ) if ( px >= c.x && px <= c.x + c.w && py >= c.y && py <= c.y + c.h ) return c;
	return null;

}

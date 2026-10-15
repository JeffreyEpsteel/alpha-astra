// The ship classes of the naval feature. Geometry comes from the fork's NavalShips manifest
// (Assets/NavalShips/manifest.json) and the exported GLBs (public/models/ships/*_v2.glb):
//   GLB frame: +X forward (bow), +Y up, origin at the waterline centre of the hull; the model is turned
//   by -PI/2 about Y to meet the game's boat frame (+Z forward, +X port), see Models.js.
//
// length / beam / draft / sheer / deck / mast are metres of the hull (keel at -draft, sheer top and main
// deck above the waterline, mast top). mass (kg, as Boats.js gives the player's hulls of the same class: collisions).
// speed (m/s), accel / decel (m/s^2) and turn (rad/s at full way) are
// the kinematics; hp the hull points; stations the guns of both broadsides (boat frame: forward offset z,
// beam offset x, height y; the manifest's broadside stations are at +-2.4 m forward and 2.1 / 2.9 / 2.5 m out).
//
// Pirates: sight is the detect radius by day (m), engage the range where they close to a broadside,
// lose the range where they give up, fleeAt the hull fraction where they run, shot = ballistic spread
// (rad, one sigma), damage per ball, reload seconds per side, traverse the half arc (rad) a gun can
// swivel from the beam.

import { DEG } from './util.js';

const stations = ( zs, beamX, deckY ) => zs.flatMap( ( z ) => [ { side: 'port', x: beamX, y: deckY + 0.55, z }, { side: 'starboard', x: - beamX, y: deckY + 0.55, z } ] );

export const SHIP_CLASSES = {
	trawler: {
		id: 'trawler', label: 'Merchant trawler', faction: 'merchant', glb: 'models/ships/trawler_v2.glb',
		length: 16.4, beam: 6.0, draft: 1.65, sheer: 3.48, deck: 2.4, mast: 11.2,
		speed: 4.2, accel: 0.45, decel: 0.7, turn: 0.22,
		mass: 42000, hp: 140, guns: 0, stations: [],
		sight: 0, engage: 0, lose: 0, fleeAt: 0.4, shot: 0, damage: 0, reload: 0, traverse: 0,
		loot: { crates: 3, value: [ 35, 70 ] },
	},
	sloop: {
		id: 'sloop', label: 'Black Flag sloop', faction: 'pirate', glb: 'models/ships/sloop_v2.glb',
		length: 14.4, beam: 5.2, draft: 1.4, sheer: 3.21, deck: 2.2, mast: 11.9,
		speed: 7.2, accel: 1.0, decel: 1.2, turn: 0.5,
		mass: 26000, hp: 120, guns: 2, stations: stations( [ - 2.4, 2.4 ], 2.1, 2.2 ),
		sight: 380, engage: 140, lose: 720, fleeAt: 0.28, shot: 0.017, damage: 26, reload: 5.2, traverse: 24 * DEG,
		loot: { crates: 2, value: [ 60, 110 ] },
	},
	brigantine: {
		id: 'brigantine', label: 'Two-masted brigantine', faction: 'pirate', glb: 'models/ships/brigantine_v2.glb',
		length: 20, beam: 6.8, draft: 1.9, sheer: 3.73, deck: 2.6, mast: 15.2,
		speed: 6.2, accel: 0.7, decel: 0.9, turn: 0.32,
		mass: 64000, hp: 260, guns: 3, stations: stations( [ - 4.2, 0, 4.2 ], 2.9, 2.6 ),
		sight: 440, engage: 150, lose: 800, fleeAt: 0.16, shot: 0.014, damage: 30, reload: 6.4, traverse: 22 * DEG,
		loot: { crates: 3, value: [ 90, 160 ] },
	},
	// wave 16A: the harbour launch the rescue sends (features/rescue). No GLB yet: model 'launch' is procedural
	// (world/boat/Launch.js LaunchVisual; the rescue feature hands it to naval's ModelSet). An open boat ~9 m with a wheel
	// aft (helm: where the coxswain stands, wheel: its hub), a lamp on a short mast (lamp: the light's place, boat frame),
	// fast, no guns. hull: the player boat she becomes when taken (Boats.js 'launch', hijack Rules.hullFor).
	launch: {
		id: 'launch', label: 'Harbour launch', faction: 'navy', glb: null, model: 'launch', hull: 'launch', lettering: 'HARBOUR',
		length: 9, beam: 2.8, draft: 0.7, sheer: 1.1, deck: 0.45, mast: 3.3,
		speed: 9, accel: 1.4, decel: 1.8, turn: 0.5,
		mass: 5200, hp: 60, guns: 0, stations: [],
		sight: 0, engage: 0, lose: 0, fleeAt: 0.3, shot: 0, damage: 0, reload: 0, traverse: 0,
		loot: { crates: 0, value: [ 0, 0 ] },
		helm: { x: 0, z: - 2.5 }, wheel: { x: 0, y: 1.55, z: - 2.02 }, lamp: { x: 0, y: 3.42, z: - 1.32 },
	},
	// wave 19B: the navy (features/navy; Brains.thinkNavy sails every class with navy: true). Wave 19F: their own GLBs
	// (public/models/navy/*.glb, tools/navy/build_navy_ships.py): model 'navy' with navyGlb (navy/NavyModels.js loads it as the
	// class's template in naval's ModelSet; glb stays null so SHIP_KINDS keeps the three pirate / merchant hulls). base / scale:
	// the fallback look if that GLB fails (the base class's GLB scaled, in navy dress). Measured on the GLBs (boat frame): the
	// frigate's main (gun) deck 3.4 m, the raised quarterdeck 4.6 m aft of z -6.8 and the forecastle 4.35 m forward of z 9.2
	// (decks), the waist rail 4.75 m, the sides 3.8 m out at the guns; two tiers of three guns a side (the lower tier's ports
	// at 2.48 m on the white strake, the upper's at 4.0 m in the waist) and the double wheel on the quarterdeck (helm: where
	// the coxswain stands, wheel: its hub). The revenue cutter: deck 1.95 m, rail 2.7 m, a gun a side aft and forward of the
	// mast in ports at 2.42 m, the wheel aft. hull: what a taken one sails as.
	frigate: {
		id: 'frigate', label: 'Navy frigate', faction: 'navy', navy: true, glb: null, navyGlb: 'models/navy/frigate.glb', model: 'navy', base: 'brigantine', scale: 1.3, hull: 'brigantine',
		length: 27.5, beam: 7.9, draft: 2.6, sheer: 4.75, deck: 3.4, mast: 27.1,
		speed: 5.6, accel: 0.45, decel: 0.7, turn: 0.19,
		mass: 140000, hp: 520, guns: 6,
		stations: [ ...stations( [ - 5.4, 0, 5.4 ], 3.3, 3.45 ), ...stations( [ - 5.4, 0, 5.4 ], 3.3, 1.93 ) ],
		sight: 520, engage: 170, lose: 950, fleeAt: 0.14, shot: 0.013, damage: 32, reload: 7.4, traverse: 20 * DEG,
		loot: { crates: 2, value: [ 60, 120 ] },
		helm: { x: 0, z: - 11.45 }, wheel: { x: 0, y: 5.62, z: - 10.7 },
		decks: [ { z0: - 13.75, z1: - 6.8, y: 4.6 }, { z0: - 6.8, z1: 9.2, y: 3.4 }, { z0: 9.2, z1: 13.75, y: 4.35 } ],
	},
	revenue: {
		id: 'revenue', label: 'Navy revenue cutter', faction: 'navy', navy: true, glb: null, navyGlb: 'models/navy/revenue.glb', model: 'navy', base: 'sloop', scale: 1.05, hull: 'sloop',
		length: 15, beam: 5.2, draft: 1.6, sheer: 2.7, deck: 1.95, mast: 16.6,
		speed: 7.8, accel: 1.1, decel: 1.3, turn: 0.55,
		mass: 29000, hp: 160, guns: 2,
		stations: [ { side: 'port', x: 1.95, y: 2.42, z: - 3.0 }, { side: 'starboard', x: - 1.95, y: 2.42, z: - 3.0 }, { side: 'port', x: 1.6, y: 2.42, z: 4.0 }, { side: 'starboard', x: - 1.6, y: 2.42, z: 4.0 } ],
		sight: 460, engage: 140, lose: 820, fleeAt: 0.26, shot: 0.016, damage: 24, reload: 5.0, traverse: 24 * DEG,
		loot: { crates: 1, value: [ 30, 60 ] },
		helm: { x: 0, z: - 6.2 }, wheel: { x: 0, y: 2.9, z: - 5.6 },
	},
};

// the navy's classes (features/navy spawns them; Brains.think hands them to thinkNavy)
export const NAVY_KINDS = Object.keys( SHIP_CLASSES ).filter( ( k ) => SHIP_CLASSES[ k ].navy === true );

// the classes with a GLB (naval's ModelSet loads them); the procedural ones (cls.model) are drawn by their own builder
export const SHIP_KINDS = Object.keys( SHIP_CLASSES ).filter( ( k ) => !! SHIP_CLASSES[ k ].glb );
export const PROCEDURAL_KINDS = Object.keys( SHIP_CLASSES ).filter( ( k ) => ! SHIP_CLASSES[ k ].glb && SHIP_CLASSES[ k ].model );

export const PIRATE_CAPTAINS = [ 'Mad Meg Orrow', 'One-Eye Pell', 'Black Tam', 'Salt Annick', 'Captain Vane', 'Rook Delacroix', 'Old Bess Harrow', 'Tobias Grim', 'Sable Jory', 'Dread Hallam' ];
export const PIRATE_SHIPS = [ 'Black Gull', 'Salt Widow', 'Grey Cormorant', 'Hollow Tide', 'Red Kestrel', 'The Gannet\'s Debt', 'Night Heron', 'Drowned Lantern', 'Ashen Wake', 'Sable Petrel' ];
export const NAVY_SHIPS = [ 'HMS Resolute', 'HMS Tidemark', 'HMS Vigilant', 'HMS Kestrel', 'HMS Steadfast', 'HMS Heron', 'HMS Warden', 'HMS Gannet' ];
export const NAVY_CAPTAINS = [ 'Captain Ashby', 'Commander Vell', 'Lieutenant Corran', 'Captain Merrow', 'Commander Hale-Ivory', 'Lieutenant Sedge' ];
export const MERCHANT_SHIPS = [ 'Margit & Sons', 'Pons Packet', 'Gull Harbour Hauler', 'Brine & Barley', 'Tidewater Pride', 'Patient Mary' ];

// loot crate value roll, coins
export function lootValue( cls, rng ) {

	const [ a, b ] = cls.loot.value;
	return Math.round( a + ( b - a ) * rng() );

}

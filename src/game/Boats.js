// The boats of Hyptile Island. You start on foot; boats are bought at Ethena's boat yard by the
// boathouse and the one you own is moored at the pier head (WORLD.boatDock). One boat at a time:
// buying another trades the old one in at TRADE_IN of its price.
//
// Four hulls come from the fishing workspace's FishingFleet (tools/roster/convert-boat.py -> GLB,
// kind 'fleet', boat frame +Z forward / +X port / y = 0 at the design waterline, built at runtime by
// world/boat/FleetBoatModel.js); the lobster boat is Tidewater's procedural BoatModel (kind 'procedural').
//
//   BOATS[ id ] = { name, price, kind, glb?, length, beam, draft, deckY, freeboard, mass, maxThrust, pitchSpeed,
//                   fuelMul, holdMul, helm: { x, z }, board: { x, z }, seats: [ { x, z, yaw } ], drive, description }
// seats: where a passenger sits (boat frame, yaw 0 facing the bow); drive: how the helm clips look
// ('row' oars, 'paddle' a paddle, 'tiller' an outboard / tiller, 'wheel' a wheelhouse).
// fuelMul / holdMul scale the gear tank / hold of Gear.js; stats come out of GameState.stats.
// slots: the hull's module slots (features/naval/Modules.js), one entry per slot, by kind: 'hull' (armour plating),
// 'arms' (swivel gun, heavier guns, quick reload), 'drive' (oars / engine / rigging), 'hold' (extra hold, fish well),
// 'deck' (lantern rig, spyglass and charts). Bigger hulls carry more; see slotsOf( id ).
//
// Ships (kind 'ship', after the five small boats): the naval fork's three vessels (Assets/NavalShips, GLBs in
// public/models/ships, built at runtime by world/boat/ShipBoatModel.js; ShipClasses.js of the naval feature has
// their AI twins). Extra fields:
//   shipClass   id in features/naval/ShipClasses.js (the same hull as the pirate / merchant ships)
//   hull        SimpleHullLines options (wlBeam, flare, sheerRise, shell) measured on the GLB
//   mirror      the GLB is mirrored left-right (the brigantine: its ship's boat stood in the pier-side boarding opening)
//   helmDeckY   height of the deck the wheel stands on (the stern platform) when it is not `deckY`
//   hp          hull points of the player's ship (the small boats get 40 + 0.07 mass, see naval hullMaxFor)
//   broadside   built-in battery of swivel guns on the rails: { z: [ stations along the hull ], x: the pintle's
//               distance from the centre line, y: barrel height above the deck, level: gun level 1..3 of naval
//               GUN_LEVELS }; guns per side = z.length. A ship without one (the trawler) can still buy the swivel
//               gun like a small boat.
//   berth       { x, z } metres added to WORLD.boatDock for the moored ship (it is wider than the pier head
//               allows at the lobster boat's spot); see berthOf( id )

export const TRADE_IN = 0.6;

export const BOATS = {
	skiff: {
		name: 'Marsh skiff', price: 650, kind: 'fleet', glb: 'models/fleet/SM_MarshSkiff.glb',
		length: 4.13, beam: 1.79, draft: 0.22, deckY: 0.31, freeboard: 0.62,
		mass: 420, maxThrust: 2400, pitchSpeed: 6.5, fuelMul: 0.5, holdMul: 0.7,
		helm: { x: 0, z: - 0.15 }, board: { x: 0, z: - 0.15 }, seats: [ { x: 0, z: - 0.91, yaw: 0 } ], drive: 'row',
		description: 'A flat, stable sage-green skiff rowed from the thwart. Slow, cheap and fine for the bay.',
		slots: [ 'hull', 'arms', 'drive', 'hold', 'deck' ],
	},
	canoe: {
		name: 'Outrigger canoe', price: 1200, kind: 'fleet', glb: 'models/fleet/SM_Outrigger.glb',
		length: 4.53, beam: 2.97, draft: 0.22, deckY: 0.31, freeboard: 0.66,
		mass: 520, maxThrust: 3600, pitchSpeed: 8, fuelMul: 0.6, holdMul: 0.8,
		helm: { x: 0, z: - 0.15 }, board: { x: 0, z: - 0.15 }, seats: [ { x: 0, z: - 0.91, yaw: 0 } ], drive: 'paddle',
		description: 'Tarred hull with a float out to starboard: it hardly rolls. Paddled; quick enough to reach the reef.',
		slots: [ 'hull', 'arms', 'drive', 'hold', 'deck' ],
	},
	cutter: {
		name: 'Sail cutter', price: 2600, kind: 'fleet', glb: 'models/fleet/SM_SailCutter.glb',
		length: 4.48, beam: 1.97, draft: 0.3, deckY: 0.31, freeboard: 0.7,
		mass: 640, maxThrust: 5200, pitchSpeed: 9.5, fuelMul: 0.8, holdMul: 1.0,
		helm: { x: 0, z: - 0.15 }, board: { x: 0, z: - 0.15 }, seats: [ { x: 0, z: - 0.91, yaw: 0 } ], drive: 'tiller',
		description: 'Blue-hulled cutter with a canvas sail and an engine for the calms. Sea-kindly, good hold.',
		slots: [ 'hull', 'arms', 'arms', 'drive', 'hold', 'deck' ],
	},
	launch: {
		name: 'Cabin launch', price: 4500, kind: 'fleet', glb: 'models/fleet/SM_CabinLaunch.glb',
		length: 4.63, beam: 2.02, draft: 0.28, deckY: 0.31, freeboard: 0.7,
		mass: 760, maxThrust: 7800, pitchSpeed: 11, fuelMul: 1.0, holdMul: 1.3,
		helm: { x: 0, z: - 0.15 }, board: { x: 0, z: - 0.15 }, seats: [ { x: 0, z: - 0.91, yaw: 0 } ], drive: 'tiller',
		description: 'Oxblood launch with a small wheelhouse. Fast, dry and ready for deep water.',
		slots: [ 'hull', 'arms', 'arms', 'drive', 'hold', 'deck' ],
	},
	lobster: {
		name: 'Lobster boat', price: 9000, kind: 'procedural',
		length: 8.2, beam: 2.9, draft: 0.85, deckY: 0.35, freeboard: 0.9,
		mass: 3200, maxThrust: 26000, pitchSpeed: 16, fuelMul: 1.5, holdMul: 2.0,
		helm: { x: - 0.55, z: 0.22 }, board: { x: 0, z: - 1.75 }, seats: [ { x: 0.86, z: 0.45, yaw: Math.PI / 2 } ], drive: 'wheel',
		description: 'The 8 m Downeast workboat: wheelhouse, radar, hauler and the biggest hold on the island.',
		slots: [ 'hull', 'arms', 'arms', 'drive', 'hold', 'hold', 'deck' ],
	},

	// ---- ships. Dimensions and decks from the manifest of the fork's NavalShips (hull_length_m, max_beam_m,
	// keel_z_m, main_deck_top_z_m, stern_deck_top_z_m, helm.mesh_root_x_m); freeboard = the sheer amidships.
	trawler: {
		name: 'Merchant trawler', price: 22000, kind: 'ship', shipClass: 'trawler', glb: 'models/ships/trawler_v2.glb',
		length: 16.4, beam: 6.0, draft: 1.65, deckY: 2.4, freeboard: 3.24,
		hull: { wlBeam: 0.82, flare: 0.6, sheerRise: 0.14, shell: 0.2 },
		mass: 42000, maxThrust: 21000, pitchSpeed: 7.5, fuelMul: 2.5, holdMul: 4.0, hp: 520,
		helm: { x: 0, z: - 5.7 }, helmDeckY: 3.0, board: { x: - 2.1, z: 0 }, seats: [ { x: 1.3, z: - 0.1, yaw: Math.PI / 2 }, { x: - 1.3, z: - 0.1, yaw: - Math.PI / 2 } ], drive: 'wheel',
		berth: { x: 1.5, z: 0 },
		description: 'A 16 m working trawler: wheelhouse aft, derrick and net drum, and a hold that swallows a day of catch. Slow and steady.',
		slots: [ 'hull', 'arms', 'arms', 'drive', 'hold', 'hold', 'deck', 'deck' ],
	},
	sloop: {
		name: 'Black Flag sloop', price: 36000, kind: 'ship', shipClass: 'sloop', glb: 'models/ships/sloop_v2.glb',
		length: 14.4, beam: 5.2, draft: 1.4, deckY: 2.2, freeboard: 3.0,
		hull: { wlBeam: 0.81, flare: 0.5, sheerRise: 0.06, shell: 0.2 },
		mass: 26000, maxThrust: 42000, pitchSpeed: 11.5, fuelMul: 2.0, holdMul: 2.6, hp: 420,
		helm: { x: 0, z: - 5.0 }, helmDeckY: 2.9, board: { x: - 1.8, z: 0 }, seats: [ { x: 1.3, z: 3.6, yaw: Math.PI / 2 }, { x: - 1.3, z: 3.6, yaw: - Math.PI / 2 } ], drive: 'wheel',
		broadside: { z: [ - 2.4, 2.4 ], x: 2.4, y: 1.2, level: 2 },
		berth: { x: 1.1, z: 0 },
		description: 'A fast fore-and-aft sloop of 14 m with two guns a side. Quick off the wind, light on cargo.',
		slots: [ 'hull', 'arms', 'arms', 'drive', 'hold', 'hold', 'deck', 'deck' ],
	},
	brigantine: {
		name: 'Two-masted brigantine', price: 62000, kind: 'ship', shipClass: 'brigantine', glb: 'models/ships/brigantine_v2.glb',
		length: 20, beam: 6.8, draft: 1.9, deckY: 2.6, freeboard: 3.4,
		hull: { wlBeam: 0.835, flare: 0.55, sheerRise: 0.08, shell: 0.2 }, mirror: true,
		mass: 64000, maxThrust: 48000, pitchSpeed: 9.5, fuelMul: 3.0, holdMul: 6.0, hp: 760,
		helm: { x: 0, z: - 7.2 }, helmDeckY: 3.4, board: { x: - 2.6, z: 0 }, seats: [ { x: 1.6, z: 0.2, yaw: Math.PI / 2 }, { x: - 1.6, z: 0.2, yaw: - Math.PI / 2 } ], drive: 'wheel',
		broadside: { z: [ - 3.9, - 2.1, 2.1, 3.9 ], x: 3.2, y: 1.2, level: 3 },
		berth: { x: 1.9, z: 0 },
		description: 'The flagship: 20 m, two masts, four guns a side and the deepest hold afloat. Heavy to turn.',
		slots: [ 'hull', 'arms', 'arms', 'arms', 'drive', 'hold', 'hold', 'deck', 'deck' ],
	},
};

export const BOAT_IDS = Object.keys( BOATS );

// what the yard pays for your current boat when you buy another
export function tradeInValue( id ) {

	const b = BOATS[ id ];
	return b ? Math.round( b.price * TRADE_IN ) : 0;

}

// price to move from boat `from` (or none) to boat `to`
export function upgradePrice( from, to ) {

	const b = BOATS[ to ];
	if ( ! b ) return Infinity;
	return Math.max( 0, b.price - tradeInValue( from ) );

}

// guns per side of the built-in battery of a boat (0 for the small boats and the trawler)
export function gunsOf( id ) {

	const b = BOATS[ id ];
	return b && b.broadside ? b.broadside.z.length : 0;

}

// the module slots of a hull (kinds, one per slot; none on foot or for an unknown id)
export function slotsOf( id ) {

	const b = BOATS[ id ];
	return b && Array.isArray( b.slots ) ? b.slots : [];

}

// where the moored boat sits: WORLD.boatDock plus the class's berth offset ( { x, z } metres, 0 for the small boats )
export function berthOf( id ) {

	const b = BOATS[ id ];
	return b && b.berth ? b.berth : { x: 0, z: 0 };

}

export function boatUrl( b ) {

	let base = '/';
	try {

		base = ( import.meta.env && import.meta.env.BASE_URL ) || '/';

	} catch ( e ) { /* node */ }

	return base + b.glb;

}

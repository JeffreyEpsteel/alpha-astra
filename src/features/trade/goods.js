import { WORLD } from '../../world/WorldLayout.js';

// Merchant trade: the static tables. Plain data, no engine and no DOM, so the market model, the panel and the
// tests all read the same numbers.
//
// Every port in WORLD.ports has a market (read dynamically: syncPorts() adds the ports that land later). Each port
// has an identity (PORT_IDENTITY, wave 15B): the goods it produces (cheap there, and its stall restocks them as the
// price push fades) and the goods it wants (dear there, and the demand fills up as you sell: every unit sold pushes
// the price down until the market recovers). Home makes fish, rope and lamp oil (and ice, salt, rum, tools); Pons
// Cove timber and resin; Gull Rock salt, guano and lamp wicks; Saltmarsh Key reeds, eels and dyes; West Haven cloth
// and iron; the Shrine incense and carvings; Quiet Shoal pearls and shells; the Inverted Isles glass and strange
// fruit; Tidemark is the big market (everything at a fair price, bigger swings, and the luxuries: wine, silk, clocks);
// Blackwater (the pirates' town, no stall: src/features/pirates/BlackMarket.js) deals in powder and stolen goods.
// A "unit" of a good is what you buy and sell (a block, a sack, a coil...); it fills `crates` slots of the hold.
//
//   GOODS[ id ]   { name, unit, base ($ per unit at a price of 1.0), crates, kg, perish (fraction of value lost per
//                   in-game hour in the hold), depth (units that move the price by a factor e at a port of size 1),
//                   recover (hours for a trade's price push to fade by a factor e), color, note,
//                   cat (category), tags ('fine': a licensed luxury), origin / demand (port ids that make / want it,
//                   derived from PORT_IDENTITY) }
//   PORT_IDENTITY[ port ]     { size, swing (drift scale), fee (dues scale), hub, signature, produces, wants, eats, note }
//   LEGALITY[ good ]          { port: 'contraband', default } where a good may not be traded openly (smuggler only)
//   REGION[ port ][ good ]    price multiplier of the port (cheap where it is made, dear where it is wanted)
//   HOLD_CRATES[ boat ]       crates of cargo a boat carries, independent from the fish cooler (no boat: on foot)
//   EVENTS                    market event templates (storms, festivals, gluts); CAUSES the world-caused ones

export const PORT_IDS = [ 'home', 'pons', 'gull', 'key' ];

export const PORTS = {
	home: { id: 'home', name: 'Home', title: 'Home harbour market', size: 1.4 },
	pons: { id: 'pons', name: 'Pons Cove', title: 'Pons Cove market', size: 1.0 },
	gull: { id: 'gull', name: 'Gull Rock', title: 'Gull Rock lighthouse store', size: 0.6 },
	key: { id: 'key', name: 'Saltmarsh Key', title: 'Saltmarsh Key landing', size: 0.75 },
};

// what each port makes and wants (the economy's map; wave 15B). produces / wants drive REGION, the goods' origin /
// demand, the hauling boards and the panel's "made here" / "wanted here" tags; signature is what the port is known for;
// eats: the fish species its fish hall pays a little more for (FishStand.js FISH_HALL). size: the market's depth
// (a bigger port moves less per crate), swing: its drift (Tidemark's prices wander more), fee: the harbour dues scale.
export const PORT_IDENTITY = {
	home: {
		name: 'Home', title: 'Home harbour market', size: 1.4, swing: 1, fee: 0,
		signature: [ 'fish', 'rope', 'oil' ], produces: [ 'fish', 'rope', 'oil', 'ice', 'salt', 'rum', 'tools' ],
		wants: [ 'timber', 'resin', 'coconuts', 'spices', 'pearls', 'iron', 'wine', 'silk', 'fruit', 'reeds', 'tobacco', 'powder' ],
		eats: [ 'grouper', 'redSnapper', 'yellowtail' ], note: 'The home harbour: rope walk, ice house, lamp-oil press and the smithy.',
	},
	pons: {
		name: 'Pons Cove', title: 'Pons Cove market', size: 1.0, swing: 1, fee: 0.8,
		signature: [ 'timber', 'resin' ], produces: [ 'timber', 'resin', 'coconuts', 'spices', 'pearls', 'cloth', 'tobacco' ],
		wants: [ 'rope', 'rum', 'salt', 'ice', 'guano', 'iron', 'reeds', 'wine', 'carvings', 'fruit' ],
		eats: [ 'mullet', 'jack', 'parrot' ], note: 'Palm groves and the boat-builders\' resin.',
	},
	gull: {
		name: 'Gull Rock', title: 'Gull Rock lighthouse store', size: 0.6, swing: 1, fee: 0.6,
		signature: [ 'salt', 'guano', 'wicks' ], produces: [ 'salt', 'guano', 'wicks', 'powder' ],
		wants: [ 'oil', 'timber', 'rope', 'tools', 'cloth', 'ice', 'iron', 'saltfish', 'fish', 'rum', 'coconuts', 'tobacco', 'clocks' ],
		eats: [ 'grunt', 'sergeant', 'tarpon' ], note: 'The light burns oil all night; the keepers twist wicks and dig guano.',
	},
	key: {
		name: 'Saltmarsh Key', title: 'Saltmarsh Key landing', size: 0.75, swing: 1, fee: 0.7,
		signature: [ 'reeds', 'eels', 'dyes' ], produces: [ 'reeds', 'eels', 'dyes', 'oil', 'saltfish', 'salt', 'pearls', 'tobacco' ],
		wants: [ 'tools', 'cloth', 'ice', 'rope', 'wicks', 'glass', 'spices', 'timber', 'clocks' ],
		eats: [ 'mullet', 'needlefish', 'barracuda' ], note: 'Reed beds, eel traps and dye vats on the flats.',
	},
	haven: {
		name: 'West Haven', title: 'West Haven exchange', size: 0.85, swing: 1, fee: 0.8,
		signature: [ 'cloth', 'iron' ], produces: [ 'cloth', 'iron' ],
		wants: [ 'dyes', 'resin', 'eels', 'timber', 'carvings', 'wine', 'silk', 'clocks', 'glass' ],
		eats: [ 'tuna', 'mahi', 'grouper' ], note: 'Looms and a foundry: sailcloth and pig iron.',
	},
	shrine: {
		name: 'The Shrine', title: 'The Shrine almonry', size: 0.6, swing: 1, fee: 0.5,
		signature: [ 'incense', 'carvings' ], produces: [ 'incense', 'carvings' ],
		wants: [ 'wicks', 'shells', 'dyes', 'oil', 'fish', 'fruit', 'wine' ],
		eats: [ 'angel', 'tang', 'chromis' ], note: 'The monks burn incense and carve driftwood; pilgrims buy both.',
	},
	shoal: {
		name: 'Quiet Shoal', title: 'Quiet Shoal divers\' hut', size: 0.5, swing: 1, fee: 0.5,
		signature: [ 'pearls', 'shells' ], produces: [ 'pearls', 'shells' ],
		wants: [ 'reeds', 'rope', 'tools', 'ice', 'rum', 'saltfish' ],
		eats: [ 'silverside', 'silverminnow', 'glassperch' ], note: 'Divers: pearls and painted shells, and nothing else grows.',
	},
	inverted: {
		name: 'The Inverted Isles', title: 'Inverted Isles bazaar', size: 0.7, swing: 1.2, fee: 0.7,
		signature: [ 'glass', 'fruit' ], produces: [ 'glass', 'fruit' ],
		wants: [ 'wicks', 'shells', 'incense', 'fish', 'silk', 'salt', 'iron' ],
		eats: [ 'upsidedowneel', 'lanterncarp', 'rootfin' ], note: 'Glass blown from the lagoon sand, and fruit that grows upside down.',
	},
	tidemark: {
		name: 'Tidemark', title: 'Tidemark market hall', size: 2.2, swing: 1.6, fee: 1.5, hub: true,
		signature: [ 'wine', 'silk', 'clocks' ], produces: [ 'wine', 'silk', 'clocks' ],
		wants: [ 'fish', 'eels', 'dyes', 'iron', 'incense', 'carvings', 'shells', 'glass', 'fruit', 'reeds', 'wicks', 'resin' ],
		eats: [ 'wrasse', 'redSnapper', 'tuna', 'crookedcod' ], note: 'The big market: everything at a fair price, bigger swings, and the mainland\'s luxuries.',
	},
	// wave 21: Meridian, the city: workshops and glassworks, and a rich city's appetite for the luxuries and the catch
	meridian: {
		name: 'Meridian', title: 'Meridian exchange', size: 2.0, swing: 1.3, fee: 1.6,
		signature: [ 'tools', 'glass' ], produces: [ 'tools', 'glass', 'ice' ],
		wants: [ 'wine', 'silk', 'clocks', 'fish', 'eels', 'timber', 'rum', 'fruit', 'pearls', 'tobacco', 'spices', 'coconuts' ],
		eats: [ 'tuna', 'mahi', 'redSnapper' ], note: 'The city: workshops and glassworks, and money for the finer things.',
	},
	// no stall: the pirates' fence sells these (BlackMarket.js); listed so the goods have an origin and the panel can say so
	blackwater: {
		name: 'Blackwater', market: false, size: 0.6, swing: 1, fee: 0,
		signature: [ 'powder', 'plunder' ], produces: [ 'powder', 'plunder', 'relics' ], wants: [], eats: [],
		note: 'The pirates\' town: powder and stolen goods cheap, for those the brotherhood lets in.',
	},
};

// the ports with a stall (Blackwater's fence is the pirates' own)
const marketIdentity = ( id ) => PORT_IDENTITY[ id ] && PORT_IDENTITY[ id ].market !== false ? PORT_IDENTITY[ id ] : null;

export const GOODS = {
	ice: { name: 'Block ice', unit: 'block', base: 16, crates: 1, kg: 40, perish: 0.03, depth: 30, recover: 4, color: '#9fd8ee', note: 'Cut at the Home ice house. Melts in the hold; packed round the cooler it keeps the catch fresh.', cat: 'provisions', tags: [ 'perishable' ] },
	salt: { name: 'Sea salt', unit: 'sack', base: 10, crates: 1, kg: 30, perish: 0, depth: 44, recover: 7, color: '#e9e4d4', note: 'Raked from the Home pans and the Gull Rock flats.', cat: 'provisions', tags: [] },
	rope: { name: 'Hemp rope', unit: 'coil', base: 22, crates: 1, kg: 25, perish: 0.0015, depth: 30, recover: 7, color: '#c9a86a', note: 'Twisted at the Home rope walk.', cat: 'naval', tags: [] },
	rum: { name: 'Cane rum', unit: 'cask', base: 34, crates: 1, kg: 35, perish: 0, depth: 22, recover: 8, color: '#b5642f', note: 'Distilled at Home; Pons drinks it.', cat: 'luxury', tags: [ 'drink' ] },
	timber: { name: 'Palm timber', unit: 'bundle', base: 40, crates: 2, kg: 90, perish: 0.001, depth: 18, recover: 9, color: '#8a6a43', note: 'Felled on Pons. Bulky: two crates a bundle.', cat: 'raw', tags: [ 'bulky' ] },
	coconuts: { name: 'Coconuts', unit: 'sack', base: 11, crates: 1, kg: 28, perish: 0.005, depth: 38, recover: 5, color: '#6e8a3c', note: 'Pons groves. They keep a few days.', cat: 'provisions', tags: [ 'perishable' ] },
	spices: { name: 'Spices', unit: 'chest', base: 58, crates: 1, kg: 14, perish: 0.001, depth: 15, recover: 10, color: '#d9812b', note: 'Traders drop them at Pons first.', cat: 'luxury', tags: [] },
	pearls: { name: 'Pearls', unit: 'pouch', base: 120, crates: 1, kg: 2, perish: 0, depth: 11, recover: 13, color: '#f0eaf6', note: 'Quiet Shoal and Pons divers. Small, dear, and the market is thin.', cat: 'luxury', tags: [ 'valuable' ] },
	cloth: { name: 'Sailcloth', unit: 'bolt', base: 30, crates: 1, kg: 20, perish: 0, depth: 26, recover: 8, color: '#e6dcc0', note: 'Woven in the West Haven looms and the Pons lofts. Every harbour mends sails.', cat: 'naval', tags: [] },
	tools: { name: 'Iron tools', unit: 'crate', base: 48, crates: 1, kg: 45, perish: 0, depth: 20, recover: 9, color: '#7d8a90', note: 'Forged at Home. The islets have no smithy.', cat: 'manufactured', tags: [ 'heavy' ] },
	oil: { name: 'Lamp oil', unit: 'cask', base: 26, crates: 1, kg: 32, perish: 0, depth: 26, recover: 7, color: '#d8b24a', note: 'Pressed at Home and rendered at Saltmarsh Key. The Gull Rock light burns it every night.', cat: 'provisions', tags: [] },
	saltfish: { name: 'Salt fish', unit: 'barrel', base: 24, crates: 1, kg: 40, perish: 0.004, depth: 30, recover: 6, color: '#b9a184', note: 'Cured at Saltmarsh Key from the flats catch.', cat: 'provisions', tags: [ 'perishable' ] },
	guano: { name: 'Guano', unit: 'sack', base: 9, crates: 1, kg: 35, perish: 0, depth: 40, recover: 6, color: '#cfc6a8', note: 'Dug on Gull Rock. The Pons farms pay for it.', cat: 'raw', tags: [] },
	tobacco: { name: 'Tobacco', unit: 'bale', base: 44, crates: 1, kg: 22, perish: 0.0005, depth: 18, recover: 9, color: '#8c5a32', note: 'Pons leaf. Banned at Home and on Gull Rock, so it fetches a fortune there after dark.', cat: 'luxury', tags: [ 'restricted' ] },
	powder: { name: 'Black powder', unit: 'keg', base: 70, crates: 1, kg: 25, perish: 0, depth: 14, recover: 11, color: '#3a3a3a', note: 'Kept on Gull Rock for the signal guns; Blackwater sells it cheap. Contraband anywhere else.', cat: 'munitions', tags: [ 'restricted', 'dangerous' ] },
	relics: { name: 'Sunken relics', unit: 'chest', base: 160, crates: 1, kg: 18, perish: 0, depth: 9, recover: 14, color: '#c9a25a', note: 'Salvage from the wrecks. No harbour may buy them: only the smuggler deals.', cat: 'contraband', tags: [ 'contraband', 'valuable' ] },
	// wave 15B: the islands' own goods
	fish: { name: 'Iced fish', unit: 'box', base: 18, crates: 1, kg: 30, perish: 0.02, depth: 30, recover: 5, color: '#8fb8c8', note: 'The Home boats\' catch packed in ice. Sell it fast: it turns in a day.', cat: 'provisions', tags: [ 'perishable' ] },
	resin: { name: 'Gum resin', unit: 'cask', base: 20, crates: 1, kg: 25, perish: 0, depth: 28, recover: 7, color: '#c7882e', note: 'Tapped on Pons. Every yard caulks with it.', cat: 'naval', tags: [] },
	wicks: { name: 'Lamp wicks', unit: 'bundle', base: 12, crates: 1, kg: 6, perish: 0, depth: 36, recover: 6, color: '#efe3c2', note: 'Twisted by the Gull Rock keepers in the long nights.', cat: 'provisions', tags: [] },
	reeds: { name: 'Thatch reeds', unit: 'bale', base: 8, crates: 2, kg: 30, perish: 0.003, depth: 40, recover: 6, color: '#b8b062', note: 'Cut on the Saltmarsh Key flats. Bulky: two crates a bale.', cat: 'raw', tags: [ 'bulky' ] },
	eels: { name: 'Smoked eels', unit: 'barrel', base: 28, crates: 1, kg: 30, perish: 0.006, depth: 24, recover: 7, color: '#6c5a3e', note: 'Trapped and smoked at Saltmarsh Key. Tidemark eats them by the barrel.', cat: 'provisions', tags: [ 'perishable' ] },
	dyes: { name: 'Marsh dyes', unit: 'jar', base: 46, crates: 1, kg: 10, perish: 0, depth: 18, recover: 9, color: '#3b4f9e', note: 'Indigo from the Key\'s vats. The West Haven looms want every jar.', cat: 'manufactured', tags: [] },
	iron: { name: 'Pig iron', unit: 'pig', base: 36, crates: 1, kg: 90, perish: 0, depth: 22, recover: 9, color: '#5d5f63', note: 'Cast at the West Haven foundry. Heavy.', cat: 'raw', tags: [ 'heavy' ] },
	incense: { name: 'Temple incense', unit: 'box', base: 40, crates: 1, kg: 5, perish: 0.0008, depth: 18, recover: 10, color: '#a0546b', note: 'Rolled at the Shrine.', cat: 'luxury', tags: [] },
	carvings: { name: 'Driftwood carvings', unit: 'crate', base: 64, crates: 1, kg: 20, perish: 0, depth: 14, recover: 11, color: '#9a7b5a', note: 'The Shrine monks\' work. Tidemark collectors pay well.', cat: 'manufactured', tags: [] },
	shells: { name: 'Painted shells', unit: 'sack', base: 14, crates: 1, kg: 12, perish: 0, depth: 34, recover: 6, color: '#f2c7b8', note: 'Quiet Shoal. Pilgrims leave them at the Shrine.', cat: 'manufactured', tags: [] },
	glass: { name: 'Lagoon glass', unit: 'crate', base: 52, crates: 1, kg: 22, perish: 0.002, depth: 16, recover: 10, color: '#7fd6c4', note: 'Blown in the Inverted Isles. A little breaks every voyage.', cat: 'manufactured', tags: [ 'fragile' ] },
	fruit: { name: 'Strange fruit', unit: 'basket', base: 30, crates: 1, kg: 18, perish: 0.015, depth: 20, recover: 6, color: '#d65a8a', note: 'Grows upside down on the Inverted Isles. Spoils within two days.', cat: 'provisions', tags: [ 'perishable' ] },
	wine: { name: 'Mainland wine', unit: 'cask', base: 75, crates: 1, kg: 40, perish: 0, depth: 16, recover: 10, color: '#7a2438', note: 'Landed at Tidemark. The guild sells it to licensed merchants only.', cat: 'luxury', tags: [ 'fine', 'drink' ] },
	silk: { name: 'Silk', unit: 'bolt', base: 110, crates: 1, kg: 6, perish: 0, depth: 12, recover: 12, color: '#e7b6d8', note: 'Landed at Tidemark. Licensed merchants only.', cat: 'luxury', tags: [ 'fine', 'valuable' ] },
	clocks: { name: 'Brass clocks', unit: 'case', base: 150, crates: 1, kg: 15, perish: 0, depth: 9, recover: 13, color: '#c9a03c', note: 'Mainland clockwork, landed at Tidemark. Licensed merchants only; the market is thin.', cat: 'luxury', tags: [ 'fine', 'valuable' ] },
	plunder: { name: 'Stolen goods', unit: 'bundle', base: 60, crates: 1, kg: 20, perish: 0, depth: 12, recover: 10, color: '#6b4a6e', note: 'Fenced at Blackwater. Contraband everywhere: only the smuggler and the pirates deal.', cat: 'contraband', tags: [ 'contraband' ] },
};

export const GOOD_IDS = Object.keys( GOODS );

// origin / demand of every good, from the identities (a port that lands later adds itself in syncPorts)
function linkIdentity() {

	for ( const g of GOOD_IDS ) {

		GOODS[ g ].origin = [];
		GOODS[ g ].demand = [];

	}

	for ( const p in PORT_IDENTITY ) {

		const I = PORT_IDENTITY[ p ];
		for ( const g of I.produces ) if ( GOODS[ g ] && ! GOODS[ g ].origin.includes( p ) ) GOODS[ g ].origin.push( p );
		for ( const g of I.wants ) if ( GOODS[ g ] && ! GOODS[ g ].demand.includes( p ) ) GOODS[ g ].demand.push( p );

	}

}

linkIdentity();

// where a good may not be bought or sold at the stall: the smuggler's trade, and customs seize it on arrival
export const LEGALITY = {
	tobacco: { home: 'contraband', gull: 'contraband', default: 'legal' },
	powder: { gull: 'legal', default: 'contraband' },
	relics: { default: 'contraband' },
	plunder: { default: 'contraband' },
};

export function legalAt( port, good ) {

	const L = LEGALITY[ good ];
	if ( ! L ) return true;
	const v = L[ port ] !== undefined ? L[ port ] : L.default;
	return v !== 'contraband';

}

// goods that are contraband at a port
export function contrabandAt( port ) {

	return GOOD_IDS.filter( ( g ) => ! legalAt( port, g ) );

}

// a luxury the Tidemark guild sells to licensed merchants only (trade.buy checks the hauling licence in the campaign)
export const isFine = ( good ) => !! ( GOODS[ good ] && GOODS[ good ].tags.includes( 'fine' ) );

// regional price multiplier: where a good is made it is cheap, where it is wanted it is dear. The four first ports
// keep their tuned rows (wave 3); every other cell is derived from PORT_IDENTITY (stable between sessions).
export const REGION = {
	home: { ice: 0.74, salt: 0.78, rope: 0.78, rum: 0.84, timber: 1.30, coconuts: 1.36, spices: 1.26, pearls: 1.36, cloth: 1.06, tools: 0.8, oil: 0.88, saltfish: 1.0, guano: 1.05, tobacco: 1.42, powder: 1.45, relics: 1.5 },
	pons: { ice: 1.34, salt: 1.30, rope: 1.30, rum: 1.34, timber: 0.78, coconuts: 0.72, spices: 0.80, pearls: 0.72, cloth: 0.8, tools: 1.02, oil: 1.12, saltfish: 1.12, guano: 1.3, tobacco: 0.76, powder: 1.35, relics: 1.5 },
	gull: { ice: 1.38, salt: 0.8, rope: 1.28, rum: 1.36, timber: 1.42, coconuts: 1.3, spices: 1.1, pearls: 1.0, cloth: 1.3, tools: 1.32, oil: 1.48, saltfish: 1.28, guano: 0.6, tobacco: 1.5, powder: 0.68, relics: 1.5 },
	key: { ice: 1.4, salt: 0.84, rope: 1.24, rum: 1.12, timber: 1.24, coconuts: 1.02, spices: 1.22, pearls: 0.86, cloth: 1.26, tools: 1.34, oil: 0.66, saltfish: 0.66, guano: 1.12, tobacco: 0.86, powder: 1.42, relics: 1.5 },
};

// a port that lands later (islands 5-8): its market is derived from the goods' origin / demand and a hash of its
// id, so it is stable between sessions without a table entry
const hash = ( s ) => {

	let h = 2166136261;
	for ( let i = 0; i < s.length; i ++ ) h = Math.imul( h ^ s.charCodeAt( i ), 16777619 );
	return h >>> 0;

};

export function deriveRegion( port, into = {} ) {

	const I = marketIdentity( port );
	let h = hash( port );
	for ( const g of GOOD_IDS ) {

		const G = GOODS[ g ];
		h = Math.imul( h ^ ( h >>> 13 ), 0x5bd1e995 ) >>> 0;
		const r = ( h % 1000 ) / 1000;
		if ( into[ g ] > 0 ) continue; // a tuned cell stays
		let v;
		if ( G.tags.includes( 'contraband' ) ) v = 1.5;
		else if ( G.origin.includes( port ) ) v = 0.64 + r * 0.1; // made here: cheap
		else if ( G.demand.includes( port ) ) v = 1.3 + r * 0.16; // wanted here: dear
		else if ( I && I.hub ) v = 0.98 + r * 0.18; // the big market has everything at a fair price
		else if ( I && G.origin.length && G.origin.every( ( o ) => PORT_IDENTITY[ o ] && PORT_IDENTITY[ o ].hub ) ) v = 1.22 + r * 0.12; // a hub's import: rare and dear away from it
		else v = I ? 1.0 + r * 0.2 : 0.82 + r * 0.5; // neither made nor wanted: shipped in, a little over the base
		into[ g ] = Math.round( v * 100 ) / 100;

	}

	return into;

}

for ( const p of PORT_IDS ) deriveRegion( p, REGION[ p ] );

// add any WORLD.ports entry that has no market yet (mutates PORT_IDS / PORTS / REGION in place, so every importer
// sees it); returns true when something was added
export function syncPorts() {

	let added = false;
	const list = Array.isArray( WORLD.ports ) ? WORLD.ports : [];
	for ( const wp of list ) {

		if ( ! wp || typeof wp.id !== 'string' || ! wp.id ) continue;
		if ( ! PORTS[ wp.id ] ) {

			const I = marketIdentity( wp.id );
			const name = typeof wp.name === 'string' && wp.name ? wp.name : I ? I.name : wp.id;
			PORTS[ wp.id ] = { id: wp.id, name, title: I && I.title ? I.title : `${ name } market`, size: I ? I.size : 0.8 };
			added = true;

		}

		if ( ! REGION[ wp.id ] ) REGION[ wp.id ] = deriveRegion( wp.id );
		if ( ! PORT_IDS.includes( wp.id ) ) {

			PORT_IDS.push( wp.id );
			added = true;

		}

	}

	return added;

}

// a port's identity (an empty one for a port without a table entry)
export function identity( port ) {

	return marketIdentity( port ) || { name: PORTS[ port ] ? PORTS[ port ].name : port, size: 0.8, swing: 1, fee: 1, signature: [], produces: GOOD_IDS.filter( ( g ) => GOODS[ g ].origin.includes( port ) ), wants: GOOD_IDS.filter( ( g ) => GOODS[ g ].demand.includes( port ) ), eats: [], note: '' };

}

syncPorts();

// the WORLD.ports entry of a market (null for a port without one)
export function worldPort( id ) {

	return ( WORLD.ports || [] ).find( ( p ) => p && p.id === id ) || null;

}

// where a port's boats tie up, as { x, z } (home: the pier head berth)
export function dockOf( id ) {

	const wp = worldPort( id );
	const d = wp && wp.dock && wp.dock.position;
	if ( d ) return { x: d.x, z: d.z };
	if ( id === 'home' ) return { x: WORLD.boatDock.position.x, z: WORLD.boatDock.position.z };
	return null;

}

// sea distance between two ports' docks, metres: the straight line plus a tenth for rounding headlands and reefs
// (Home to Pons: about 700 m)
export function seaDistance( a, b ) {

	if ( a === b ) return 0;
	const p = dockOf( a ), q = dockOf( b );
	if ( ! p || ! q ) return SEA_DISTANCE;
	return Math.hypot( p.x - q.x, p.z - q.z ) * 1.1;

}

// market tuning
export const MARKET = {
	spread: 0.035, // the stall buys 3.5% under and sells 3.5% over the middle price
	xMax: 1.0, // the trade push on the log price is held within +-1.0 (a factor of 2.7)
	noiseTau: 22, // hours: the slow drift around the equilibrium returns to it with this time constant
	noiseStd: 0.07, // stationary spread of that drift (log price), about 7%
	histStep: 2, // hours between the points of the sparkline
	histLen: 24, // points kept (two days)
	warmHours: 48, // hours simulated before day 1 so the sparklines already have a past
	maxLot: 60, // most units in one purchase
	newsKeep: 24,
	staleHours: 24, // a price seen longer ago than this is flagged as stale in the panel
};

// crates of cargo by boat id (BOATS in game/Boats.js); the cooler's kilograms are a separate matter
export const HOLD_CRATES = { foot: 2, skiff: 4, canoe: 5, cutter: 8, launch: 11, lobster: 20, sloop: 16, trawler: 30, brigantine: 44 }; // the ships carry the most

// typical speed in m/s, only used to estimate the voyage (and so the spoilage) in the panel
export const BOAT_SPEED = { foot: 0.9, skiff: 2.4, canoe: 3.0, cutter: 5.0, launch: 7.5, lobster: 9.0, sloop: 8.5, trawler: 6.5, brigantine: 7.5 };

// sea distance between Home and Pons, metres (the straight line is about 635 m; boats go round the reef)
export const SEA_DISTANCE = 700;

// market events: a few per in-game week. mult scales the price at the named ports while the event lasts (it
// eases in over 3 h and out over the last 6 h); dur is [ min, max ] hours; {pct} is filled from mult.
export const EVENTS = [
	{ id: 'wreck', text: 'Storm wrecked a supply ship: timber {pct} at Home', good: 'timber', ports: [ 'home' ], mult: 1.6, dur: [ 28, 44 ], weight: 1.2 },
	{ id: 'festival', text: 'Festival at Pons: rum demand {pct} at Pons', good: 'rum', ports: [ 'pons' ], mult: 1.5, dur: [ 18, 30 ], weight: 1.2 },
	{ id: 'saltGlut', text: 'Salt pans overflowing, a glut: salt {pct} at Home', good: 'salt', ports: [ 'home' ], mult: 0.6, dur: [ 24, 40 ], weight: 1 },
	{ id: 'heat', text: 'Heat wave, everyone wants ice: ice {pct} at both ports', good: 'ice', ports: [ 'home', 'pons' ], mult: 1.7, dur: [ 18, 28 ], weight: 1 },
	{ id: 'pearlBed', text: 'Divers found a rich bed: pearls {pct} at Pons', good: 'pearls', ports: [ 'pons' ], mult: 0.65, dur: [ 24, 40 ], weight: 0.8 },
	{ id: 'boatyard', text: 'Boatyard rush: rope {pct} at Home', good: 'rope', ports: [ 'home' ], mult: 1.45, dur: [ 20, 34 ], weight: 1 },
	{ id: 'spiceShip', text: 'Spice ship in the harbour, a glut: spices {pct} at Home', good: 'spices', ports: [ 'home' ], mult: 0.65, dur: [ 20, 32 ], weight: 0.8 },
	{ id: 'curing', text: 'Curing season at Pons: salt {pct} at Pons', good: 'salt', ports: [ 'pons' ], mult: 1.4, dur: [ 24, 36 ], weight: 1 },
	{ id: 'copra', text: 'Copra schooner unloads, a glut: coconuts {pct} at Home', good: 'coconuts', ports: [ 'home' ], mult: 0.7, dur: [ 20, 32 ], weight: 0.9 },
	{ id: 'gale', text: 'Gale warning, Pons boards up: timber {pct} at Pons', good: 'timber', ports: [ 'pons' ], mult: 1.5, dur: [ 18, 30 ], weight: 0.9 },
	{ id: 'dinner', text: 'Governor\'s dinner at Home: spices {pct} at Home', good: 'spices', ports: [ 'home' ], mult: 1.5, dur: [ 16, 26 ], weight: 0.8 },
	{ id: 'longNight', text: 'Long nights at the light: lamp oil {pct} on Gull Rock', good: 'oil', ports: [ 'gull' ], mult: 1.5, dur: [ 20, 34 ], weight: 0.8 },
	{ id: 'flatsRun', text: 'A big run on the flats: salt fish {pct} at Saltmarsh Key', good: 'saltfish', ports: [ 'key' ], mult: 0.65, dur: [ 20, 30 ], weight: 0.8 },
	{ id: 'planting', text: 'Planting season: guano {pct} at Pons', good: 'guano', ports: [ 'pons' ], mult: 1.55, dur: [ 24, 40 ], weight: 0.8 },
	{ id: 'sailLoft', text: 'Sail loft fire at Pons: sailcloth {pct} at Pons', good: 'cloth', ports: [ 'pons' ], mult: 1.6, dur: [ 20, 32 ], weight: 0.6 },
	{ id: 'smithy', text: 'The Home smithy is cold for a week: iron tools {pct} at Home', good: 'tools', ports: [ 'home' ], mult: 1.45, dur: [ 24, 40 ], weight: 0.6 },
	// wave 15B: the islands' own news (Tidemark swings the most)
	{ id: 'vintage', text: 'A bad vintage on the mainland: wine {pct} at Tidemark', good: 'wine', ports: [ 'tidemark' ], mult: 1.7, dur: [ 24, 44 ], weight: 0.7 },
	{ id: 'silkShip', text: 'A silk ship landed at Tidemark, a glut: silk {pct} there', good: 'silk', ports: [ 'tidemark' ], mult: 0.55, dur: [ 20, 34 ], weight: 0.7 },
	{ id: 'clockFair', text: 'Clock fair in Tidemark: brass clocks {pct} there', good: 'clocks', ports: [ 'tidemark' ], mult: 1.6, dur: [ 18, 30 ], weight: 0.5 },
	{ id: 'fishFair', text: 'Fish fair in the Tidemark hall: iced fish {pct} there', good: 'fish', ports: [ 'tidemark' ], mult: 1.7, dur: [ 12, 22 ], weight: 0.8 },
	{ id: 'forgeStrike', text: 'The West Haven foundry is on strike: pig iron {pct} there', good: 'iron', ports: [ 'haven' ], mult: 1.6, dur: [ 24, 40 ], weight: 0.6 },
	{ id: 'loomGlut', text: 'The West Haven looms ran all week, a glut: sailcloth {pct} there', good: 'cloth', ports: [ 'haven' ], mult: 0.65, dur: [ 20, 32 ], weight: 0.6 },
	{ id: 'pilgrims', text: 'Pilgrims at the Shrine: lamp wicks {pct} there', good: 'wicks', ports: [ 'shrine' ], mult: 1.6, dur: [ 18, 30 ], weight: 0.7 },
	{ id: 'shellBed', text: 'Divers found a rich bed: pearls {pct} at Quiet Shoal', good: 'pearls', ports: [ 'shoal' ], mult: 0.6, dur: [ 24, 40 ], weight: 0.6 },
	{ id: 'kilnCrack', text: 'The glass kilns cracked in the Inverted Isles: lagoon glass {pct} there', good: 'glass', ports: [ 'inverted' ], mult: 1.55, dur: [ 20, 34 ], weight: 0.6 },
	{ id: 'fruitFall', text: 'The strange fruit ripened all at once: strange fruit {pct} at the Inverted Isles', good: 'fruit', ports: [ 'inverted' ], mult: 0.6, dur: [ 14, 24 ], weight: 0.6 },
	{ id: 'eelRun', text: 'The eel traps are empty: smoked eels {pct} at Tidemark', good: 'eels', ports: [ 'tidemark' ], mult: 1.5, dur: [ 20, 32 ], weight: 0.6 },
	{ id: 'reedRot', text: 'Rot in the reed beds: thatch reeds {pct} at Saltmarsh Key', good: 'reeds', ports: [ 'key' ], mult: 1.5, dur: [ 20, 34 ], weight: 0.6 },
];

// events with a cause in the world (weather, a sunk ship, a rival's cargo): never drawn at random, started by
// trade/index.js from features events with forceEvent( id, { ports, good? } )
export const CAUSES = [
	{ id: 'stormShoal', text: 'Storm closes the shoals: salt fish {pct} everywhere', good: 'saltfish', ports: [ 'home', 'pons', 'gull', 'key' ], mult: 1.35, dur: [ 10, 18 ], weight: 0, cause: 'storm' },
	{ id: 'stormIce', text: 'Storm cuts the ice runs: ice {pct} at the islets', good: 'ice', ports: [ 'gull', 'key' ], mult: 1.4, dur: [ 10, 18 ], weight: 0, cause: 'storm' },
	{ id: 'merchantLost', text: 'A merchant went down with her cargo: {good} {pct} at {port}', good: 'spices', ports: [ 'home' ], mult: 1.45, dur: [ 20, 36 ], weight: 0, cause: 'shipSunk' },
	{ id: 'piratesSunk', text: 'Pirates sunk off the islands, the lanes are safe: powder {pct} at Gull Rock', good: 'powder', ports: [ 'gull' ], mult: 0.8, dur: [ 16, 28 ], weight: 0, cause: 'shipSunk' },
	{ id: 'rivalGlut', text: '{rival} unloaded a hold of {good}: {good} {pct} at {port}', good: 'rum', ports: [ 'pons' ], mult: 0.8, dur: [ 12, 20 ], weight: 0, cause: 'rival' },
	{ id: 'seizure', text: 'Customs burned a seized cargo of {good}: {good} {pct} at {port}', good: 'tobacco', ports: [ 'pons' ], mult: 1.3, dur: [ 12, 24 ], weight: 0, cause: 'customs' },
	// wave 15B
	{ id: 'stormPort', text: 'A storm closed {port}: {good} {pct} there', good: 'rope', ports: [ 'pons' ], mult: 1.4, dur: [ 12, 20 ], weight: 0, cause: 'storm' },
	{ id: 'convoy', text: 'A merchant convoy landed {good} at {port}: {good} {pct}', good: 'cloth', ports: [ 'tidemark' ], mult: 0.8, dur: [ 12, 22 ], weight: 0, cause: 'rival' },
	{ id: 'raid', text: 'Pirates raided {port} and burned the {good}: {good} {pct} there', good: 'reeds', ports: [ 'key' ], mult: 1.5, dur: [ 18, 30 ], weight: 0, cause: 'raid' },
	{ id: 'flood', text: 'A big load of {good} flooded {port}: {good} {pct} for a day', good: 'salt', ports: [ 'home' ], mult: 0.85, dur: [ 24, 24 ], weight: 0, cause: 'player' },
	{ id: 'hijack', text: '{rival} was taken at sea with her {good}: {good} {pct} at {port}', good: 'spices', ports: [ 'home' ], mult: 1.4, dur: [ 18, 30 ], weight: 0, cause: 'shipSunk' },
];

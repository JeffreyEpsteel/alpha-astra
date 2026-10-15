import { FISH, FISH_IDS } from '../../game/FishTable.js';
import { WORLD } from '../../world/WorldLayout.js';
import { L } from '../story/Lang.js';

// Notice board data and generation (pure: no DOM, no engine state; the Notices class and the tests use it).
//
// Each port has a board with 4 to 6 postings. A posting is generated per port per in-game day from a seed
// (generateDay), so the same save shows the same board; it lives until its expiry (in in-game hours) and
// the board lists the oldest still-valid postings first, so postings stay put until taken or lapsed.
//
// Posting types and the shared events that drive them (see src/features/Features.js):
//   catchSpecies  fishCaught { species }              catch N of a species
//   catchWeight   fishCaught { kg, species }          land one fish over X kg (any species or one)
//   catchHabitat  fishCaught { habitat }              catch N fish in a habitat (reef, deep, pier, bay, shallows)
//   deliverCargo  cargoSold { port, qty }             sell N units of cargo at the other port
//   sellFish      fishSold { total, port }            sell $X of fish at the issuing port
//   visitPort     portVisited { port }                reach the other port
//   sinkPirate    shipSunk { faction: 'pirate' }      sink N pirate ships
//   shoreRaider   enemyDefeated                       defeat N shore raiders
//   bounty        shipSunk { target | bountyId }      sink the named captain (tier 1..3, last known region)
//
// A posting: { id 'port:day:slot', port, day, slot, kind 'quest' | 'bounty', type, title, client, text, params, goal,
//              reward { money, rep, unlock }, issued, expires, roll, tier?, target?, captain?, epithet?, ship?,
//              craft?, region? { x, z, compass, distance } }

export const PORT_IDS = [ 'home', 'pons', 'tidemark' ];
export const PORT_INFO = {
	home: { id: 'home', name: 'Hyptile Harbour', short: 'Hyptile', keeper: 'Harbourmaster Orla', other: 'pons', anchor: { x: WORLD.boatDock.position.x, z: WORLD.boatDock.position.z } },
	pons: { id: 'pons', name: 'Pons Cove', short: 'Pons', keeper: 'Dockhand Tiber', other: 'home', anchor: { x: WORLD.pons.dock.position.x, z: WORLD.pons.dock.position.z } },
	// the town island (wave 12): its board sends errands and cargo back to the home harbour
	tidemark: { id: 'tidemark', name: 'Tidemark', short: 'Tidemark', keeper: 'Harbourmaster Osric', other: 'home', anchor: { x: WORLD.tidemark.dock.position.x, z: WORLD.tidemark.dock.position.z } },
};

export const MAX_ACTIVE = 3; // notices accepted at once
export const CANDIDATES = 9; // postings generated per port per day (the board shows the first 4..6 that are valid)
export const MIN_LEFT = 2; // hours: the board hides a posting about to lapse
export const LOOKBACK = 2; // days of earlier postings that can still be on the board
export const REP_MAX = 100;
export const DAY_HOURS = 24;

// the board's standing per port (its own reputation: PoorGoat's sales rep in GameState.rep is separate)
export const STANDING = [
	{ min: 0, name: 'Newcomer' }, { min: 12, name: 'Known' }, { min: 30, name: 'Regular' }, { min: 55, name: 'Trusted' }, { min: 80, name: 'Renowned' },
];
export const BOARD_SIZE = [ 4, 4, 5, 5, 6 ]; // postings listed at standing level 0..4
export const TIER_NAMES = [ '', 'Harbour nuisance', 'Open-sea corsair', 'Notorious captain' ];
export const TYPE_LABEL = {
	catchSpecies: 'Catch', catchWeight: 'Big catch', catchHabitat: 'Fishing trip', deliverCargo: 'Cargo run', sellFish: 'Market day',
	visitPort: 'Errand', sinkPirate: 'Sink a raider', shoreRaider: 'Shore watch', bounty: 'Wanted', story: 'Quest', navyBounty: 'Navy bounty',
};
// drop chance of a posting of a type the player failed or abandoned (by how many times in the last day)
export const MEMORY_DROP = [ 0, 0.55, 0.8, 0.95 ];
export const MEMORY_HOURS = 24;
// characters the board can offer for a job well done (the 'buy' characters of Characters.js)
export const UNLOCK_CHARACTERS = [ 'pepe', 'bonk', 'clown' ];

const BOUNTY_BASE = [ 0, 320, 900, 2400 ];
const BOUNTY_REP = [ 0, 6, 11, 18 ];
const BOUNTY_LIFE = [ 0, 32, 40, 48 ]; // hours a bounty stays up
const BOUNTY_RANGE = [ null, [ 250, 650 ], [ 650, 1300 ], [ 1300, 2200 ] ]; // m from the harbour
// tier weights by standing level 0..4: bounties get higher tiers as the board trusts you
const TIER_WEIGHTS = [ [ 1, 0, 0 ], [ 0.8, 0.2, 0 ], [ 0.5, 0.4, 0.1 ], [ 0.25, 0.45, 0.3 ], [ 0.1, 0.4, 0.5 ] ];
const NON_RAIDERS = new Set( [ 'animal', 'wildlife', 'fish', 'shark', 'gull' ] );
// the bounty numbers by tier, for the balance pass (story/Balance.js reads them; the board uses the constants above)
export const BOUNTY_TIERS = { base: BOUNTY_BASE, rep: BOUNTY_REP, life: BOUNTY_LIFE, range: BOUNTY_RANGE };

// ---------------------------------------------------------------- small helpers

export function hash32( ...parts ) {

	const s = parts.join( '|' );
	let h = 2166136261;
	for ( let i = 0; i < s.length; i ++ ) {

		h ^= s.charCodeAt( i );
		h = Math.imul( h, 16777619 );

	}

	h ^= h >>> 16; h = Math.imul( h, 2246822507 ); h ^= h >>> 13; h = Math.imul( h, 3266489909 ); h ^= h >>> 16;
	return h >>> 0;

}

// mulberry32: () => [0, 1)
export function rng( seed ) {

	let a = seed >>> 0;
	return () => {

		a = ( a + 0x6D2B79F5 ) >>> 0;
		let t = a;
		t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
		t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}

const num = ( v, d = 0 ) => ( typeof v === 'number' && Number.isFinite( v ) ? v : d );
const int = ( r, a, b ) => a + Math.floor( r() * ( b - a + 1 ) );
const pick = ( r, list ) => list[ Math.floor( r() * list.length ) % list.length ];
const round5 = ( v ) => Math.max( 5, Math.round( v / 5 ) * 5 );
const plural = ( name, n ) => ( n === 1 || /fish$/i.test( name ) || /mahi-mahi$/i.test( name ) ? name : name + 's' );
const s = ( n ) => ( n === 1 ? '' : 's' );

function weighted( r, entries ) {

	let total = 0;
	for ( const [ , w ] of entries ) total += w;
	let x = r() * total;
	for ( const [ v, w ] of entries ) {

		x -= w;
		if ( x <= 0 ) return v;

	}

	return entries[ entries.length - 1 ][ 0 ];

}

export function fill( text, tokens ) {

	return String( text ).replace( /\{(\w+)\}/g, ( m, k ) => ( tokens[ k ] !== undefined ? String( tokens[ k ] ) : m ) );

}

export function standingLevel( rep ) {

	let lv = 0;
	for ( let i = 0; i < STANDING.length; i ++ ) if ( num( rep ) >= STANDING[ i ].min ) lv = i;
	return lv;

}

export function standingInfo( rep ) {

	const value = Math.max( 0, Math.min( REP_MAX, num( rep ) ) );
	const level = standingLevel( value );
	const next = STANDING[ level + 1 ] || null;
	return { value, level, name: STANDING[ level ].name, next: next ? next.min : null, nextName: next ? next.name : null };

}

const WINDS = [ 'north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west' ];

// north is -z (the island lies to the north, the open sea to the south), east is +x
export function compassWord( dx, dz ) {

	const a = Math.atan2( dx, - dz );
	return WINDS[ Math.round( ( ( a + Math.PI * 2 ) % ( Math.PI * 2 ) ) / ( Math.PI / 4 ) ) % 8 ];

}

export function fmtDistance( m ) {

	return m < 1000 ? `${ Math.max( 50, Math.round( m / 50 ) * 50 ) } m` : `${ ( m / 1000 ).toFixed( 1 ) } km`;

}

// hours left -> '14 h', '40 min'
export function fmtLeft( hours ) {

	if ( hours <= 0 ) return 'lapsed';
	if ( hours < 1 ) return `${ Math.max( 1, Math.round( hours * 60 ) ) } min`;
	return `${ hours < 10 ? ( Math.round( hours * 2 ) / 2 ) : Math.round( hours ) } h`;

}

// the sea around the islands: conservative boxes, not the true coastlines (the naval feature nudges to open water)
export function openWater( x, z ) {

	if ( Math.abs( x ) > 2300 || Math.abs( z ) > 2300 ) return false;
	if ( z < - 20 && Math.abs( x ) < 760 ) return false; // the main island
	if ( Math.hypot( x - 620, z - 560 ) < 220 ) return false; // Pons Cove and its reef
	if ( Math.hypot( x - WORLD.tidemark.center.x, z - WORLD.tidemark.center.z ) < WORLD.tidemark.radius + 40 ) return false; // Tidemark
	return true;

}

// last known region of a target: a point `tier`-scaled metres from the port's harbour, in open water
export function pickRegion( r, port, tier ) {

	const a = PORT_INFO[ port ].anchor, [ d0, d1 ] = BOUNTY_RANGE[ tier ];
	for ( let i = 0; i < 16; i ++ ) {

		const th = r() * Math.PI * 2, d = d0 + r() * ( d1 - d0 );
		const dx = Math.sin( th ) * d, dz = - Math.cos( th ) * d;
		if ( openWater( a.x + dx, a.z + dz ) ) return regionOf( a, dx, dz );

	}

	return regionOf( a, 0, d0 + 0.5 * ( d1 - d0 ) ); // due south

}

function regionOf( a, dx, dz ) {

	// everything is derived from the rounded point, so the compass word and the distance always agree with x, z
	const x = Math.round( a.x + dx ), z = Math.round( a.z + dz );
	return { x, z, compass: compassWord( x - a.x, z - a.z ), distance: Math.round( Math.hypot( x - a.x, z - a.z ) / 10 ) * 10 };

}

// ---------------------------------------------------------------- authored postings
// Hand-written clients and lines per type (port: who posts it, null = either port). Tokens: {n} {s} {species}
// {kg} {fish} {habitat} {port} {total}.

export const SCRIPTS = {
	catchSpecies: [
		{ port: 'home', client: 'Auntie Venn, net shed', text: 'Saturday fry-up for the whole quay. {n} {species}, and I will make it worth the trip.' },
		{ port: 'home', client: 'Cook Barlow, the Salty Plate', text: 'Kitchen is bare. Land {n} {species} and I pay over the odds.' },
		{ port: 'home', client: 'Old Pell, the smokehouse', text: 'The smoker is running cold. {n} {species}, and mind you do not bruise them.' },
		{ port: 'pons', client: 'Maribel, cove stall', text: 'The cove wants {n} {species} for the evening grill. Cash on the table.' },
		{ port: 'pons', client: 'Granddad Rho', text: 'My knees say rain and my belly says fish. {n} {species}, and I will pay.' },
		{ port: null, client: 'A schoolmaster\'s note', text: 'The class is drawing fish from life. Please bring {n} {species}, whole.' },
		{ port: 'tidemark', client: 'Brine, the Tide & Tankard', text: 'The kitchen wants {n} {species} for the fish supper. Land them and the first round is mine.' },
	],
	catchWeight: [
		{ port: 'home', client: 'Harbourmaster Orla', text: 'The board wants a trophy. Land a {fish} over {kg} kg and your name goes up beside it.' },
		{ port: 'home', client: 'Gaffer Dunn', text: 'I have a round of drinks riding on it: a {fish} over {kg} kg. Prove me right.' },
		{ port: 'pons', client: 'Maribel, cove stall', text: 'Boasting night at the cove. Bring in a {fish} over {kg} kg and drink free.' },
		{ port: 'pons', client: 'Dockhand Tiber', text: 'The lads say the water is empty. Show them a {fish} over {kg} kg.' },
		{ port: 'tidemark', client: 'Wenna, net-mender', text: 'The boatyard swears nothing big swims in the bay. Bring a {fish} over {kg} kg to the quay.' },
	],
	catchHabitat: [
		{ port: 'home', client: 'Cook Barlow, the Salty Plate', text: 'Lunch rush. {n} fish {habitat}, any kind, and I will cover your fuel.' },
		{ port: 'home', client: 'Auntie Venn, net shed', text: 'Bring me {n} fish {habitat}. I am not fussy, only hungry.' },
		{ port: 'pons', client: 'Granddad Rho', text: 'Something for the pot, {habitat}: {n} fish of any kind.' },
		{ port: 'pons', client: 'Maribel, cove stall', text: 'The stall is empty. Bring {n} fish {habitat} and we have a deal.' },
		{ port: 'tidemark', client: 'Brine, the Tide & Tankard', text: 'Supper for the whole tavern: {n} fish {habitat}, any kind.' },
	],
	deliverCargo: [
		{ port: 'home', client: 'Merchant Corwin Tell', text: '{port} is short of everything. Sell {n} units of cargo there and I top up your takings.' },
		{ port: 'home', client: 'Chandler Okoro', text: 'Crates for {port}, as many as the hold carries: {n} units sold over there.' },
		{ port: 'pons', client: 'Dockhand Tiber', text: '{port} pays well for what we grow. Sell {n} units of cargo there and come back richer.' },
		{ port: 'pons', client: 'Maribel, cove stall', text: 'Take {n} units across to {port} and sell them. The cove remembers who helps.' },
		{ port: 'tidemark', client: 'Harbourmaster Osric', text: 'Timber goes out, rope comes in. Sell {n} units of cargo at {port} and the wharf pays a bonus.' },
	],
	sellFish: [
		{ port: 'home', client: 'PoorGoat, fish buyer', text: 'Quiet week. Sell ${total} of fish over at my stand and I add a bonus.' },
		{ port: 'home', client: 'Harbourmaster Orla', text: 'The harbour fund is thin. Bring ${total} of fish to market and we all eat.' },
		{ port: 'pons', client: 'Pons, fish market', text: 'Sell me ${total} of fish and I will throw something in on top.' },
		{ port: 'pons', client: 'Maribel, cove stall', text: 'The cove needs trade. Put ${total} of fish through the market.' },
		{ port: 'tidemark', client: 'Harbourmaster Osric', text: 'The fish hall is quiet. Put ${total} of fish through it and the town adds a bonus.' },
	],
	visitPort: [
		{ port: 'home', client: 'Harbourmaster Orla', text: 'A word for the {port} dockhand. No reply needed; just show your face there. Watch the horizon on the way.' },
		{ port: 'home', client: 'Auntie Venn, net shed', text: 'My sister keeps the stall at {port}. Look in on her, and tell me if the sea is quiet.' },
		{ port: 'pons', client: 'Granddad Rho', text: 'Tell the {port} lot we are still here. Sail over and be seen.' },
		{ port: 'pons', client: 'Dockhand Tiber', text: 'Fetch news from {port}: reach the quay and you are done. They say there is trouble on the water.' },
		{ port: 'tidemark', client: 'Tobiah, boatwright', text: 'A letter for {port}. Sail it across and show your face on the quay.' },
	],
	sinkPirate: [
		{ port: 'home', client: 'Harbourmaster Orla', text: 'Raiders keep running down the merchantmen. Sink {n} pirate ship{s} and the board pays.' },
		{ port: 'home', client: 'Merchant Corwin Tell', text: 'My sloop was boarded last week. Put {n} of those corsairs on the bottom.' },
		{ port: 'pons', client: 'Dockhand Tiber', text: 'A black sail off the cove again. Sink {n} pirate ship{s}.' },
		{ port: 'pons', client: 'Maribel, cove stall', text: 'The fishing fleet will not leave harbour. Sink {n} raiding ship{s}, please.' },
		{ port: 'tidemark', client: 'Harbourmaster Osric', text: 'Raiders work the outer bay when the moon is dark. Sink {n} pirate ship{s}.' },
	],
	shoreRaider: [
		{ port: 'home', client: 'PoorGoat, fish buyer', text: 'Somebody is pinching my ice at night. Drive off {n} shore raider{s}.' },
		{ port: 'home', client: 'Cook Barlow, the Salty Plate', text: 'Raiders came up the beach again. Defeat {n} of them before they find the stores.' },
		{ port: 'pons', client: 'Maribel, cove stall', text: 'Cutthroats on the sand at dusk. Defeat {n} shore raider{s}.' },
		{ port: 'pons', client: 'Granddad Rho', text: 'They took my nets. Settle it with {n} of them, would you?' },
		{ port: 'tidemark', client: 'Tobiah, boatwright', text: 'Cutthroats broke into the boatyard shed. Defeat {n} shore raider{s}.' },
	],
};

const BOUNTY_CLIENTS = { home: [ 'Harbourmaster Orla', 'Constable Fenwick' ], pons: [ 'Dockhand Tiber', 'Maribel, cove stall' ], tidemark: [ 'Harbourmaster Osric', 'Brine, the Tide & Tankard' ] };
const BOUNTY_TEXT = [
	null,
	[
		'{captain} cuts nets from the moorings and robs crab pots by night, working out of {craft}.',
		'{captain} has been shaking down the dinghy men for "harbour dues", from {craft}.',
		'Somebody keeps stealing lanterns off the quay, and everyone says {captain}. Slips away in {craft}.',
	],
	[
		'{captain} boards trading sloops between the islands and leaves the crews adrift. Sails {craft}.',
		'The merchants will not sail until {captain} is dealt with. Last seen aboard {craft}.',
		'{captain} raids the fishing fleet for its catch and its fuel, aboard {craft}.',
	],
	[
		'{captain} has burned three merchantmen this season and answers to no flag. Sails {craft}.',
		'Every harbour on the chart has a price on {captain}, who sails {craft}. Do not go in cheap.',
		'{captain} holds the sea lanes to ransom from {craft}. Many have tried.',
	],
];
const CRAFT = [ '', 'a patched skiff', 'a fast sloop', 'a black-sailed brigantine' ];

const GIVEN = [
	'Gully', 'Nettle', 'Barnaby', 'Odo', 'Tarn', 'Hob', 'Skerry', 'Dagger', 'Wick', 'Brine', 'Cutter', 'Pike', 'Moll', 'Rusk', 'Sable', 'Jory',
	'Fenn', 'Hessa', 'Orrin', 'Quill', 'Tamsin', 'Ezra', 'Bellamy', 'Silas', 'Corvo', 'Dorrit', 'Ketch', 'Lark', 'Mabry', 'Piet', 'Ragna', 'Yorick',
];
const SURNAMES = [
	'Marrow', 'Blackwater', 'Gallows', 'Sorrel', 'Thorne', 'Drownwell', 'Crabbe', 'Hollis', 'Vane', 'Scupper', 'Lowtide', 'Rooke', 'Sallow', 'Tarnish',
	'Greaves', 'Mudge', 'Calloway', 'Fisk', 'Grimsby', 'Ketteridge', 'Wrack', 'Spindle', 'Haggard', 'Kestrel', 'Dunmore', 'Rask', 'Ironside',
	'Penhallow', 'Strake', 'Bilge', 'Cormorant', 'Teague',
];
const EPITHETS = [
	null,
	[ 'the Tide Rat', 'the Net Thief', 'the Dock Weasel', 'the Shallow Fox', 'the Mud Gull', 'Two-Oar', 'the Crab Pincher', 'the Lantern Snuffer' ],
	[ 'the Gale Wolf', 'Saltbeard', 'the Reef Shark', 'the Black Gull', 'the Drowned Fox', 'the Squall', 'Red Anchor', 'the Storm Crow' ],
	[ 'the Sea Widow', 'the Horizon Eater', 'Hangman of the Reach', 'the Crimson Tide', 'the Deepwater King', 'Ironhull', 'the Last-Light Thief', 'the Kraken\'s Cousin' ],
];
const SHIP_A = [ 'Rusty', 'Hollow', 'Salt', 'Grim', 'Pale', 'Black', 'Crooked', 'Wet', 'Sorry', 'Lucky' ];
const SHIP_B = [ 'Gull', 'Widow', 'Mercy', 'Pennant', 'Heron', 'Crown', 'Barnacle', 'Lantern', 'Fortune', 'Maid' ];

// ---------------------------------------------------------------- quest makers
// each returns { params, goal, title, tokens, money, unlockRoll? } for one posting of the type

const HABITAT_PHRASE = { reef: 'off the reef', deep: 'from the deep water', pier: 'off the pier', bay: 'in the bay', shallows: 'in the shallows' };
// deep water is where it lives: other habitats are at most a stray (the Unreal set gives fractional weights)
const FISH_ONLY_DEEP = ( id ) => { const h = FISH[ id ].habitat; return ( h.deep || 0 ) >= 0.5 && Math.max( h.reef || 0, h.pier || 0, h.shallows || 0, h.bay || 0 ) < 0.3; };

const MAKERS = {

	catchSpecies( r, c ) {

		const ids = FISH_IDS.filter( ( id ) => FISH[ id ].rarity >= 0.3 && id !== 'tarpon' && ( c.level > 0 || ! FISH_ONLY_DEEP( id ) ) );
		const id = weighted( r, ids.map( ( k ) => [ k, FISH[ k ].rarity ] ) );
		const f = FISH[ id ], mid = ( f.kg[ 0 ] + f.kg[ 1 ] ) / 2;
		const n = mid < 0.3 ? int( r, 4, 6 ) : mid < 1 ? int( r, 3, 5 ) : mid < 4 ? int( r, 2, 4 ) : int( r, 1, 2 );
		return {
			params: { species: id }, goal: n, title: `Catch ${ n } ${ plural( f.name, n ).toLowerCase() }`,
			tokens: { n, species: plural( f.name, n ).toLowerCase() }, money: 25 + n * f.price * mid * 1.3,
		};

	},

	catchWeight( r, c ) {

		if ( r() < 0.4 ) {

			const kg = [ 2, 3, 4, 6, 8 ][ Math.min( 4, c.level + int( r, 0, 1 ) ) ];
			return { params: { kg }, goal: 1, title: `Land a fish over ${ kg } kg`, tokens: { kg, fish: 'fish' }, money: 40 + 15 * kg };

		}

		const ids = FISH_IDS.filter( ( id ) => FISH[ id ].kg[ 1 ] >= 2.5 && id !== 'tarpon' && ( c.level > 0 || ! FISH_ONLY_DEEP( id ) ) );
		const id = pick( r, ids ), f = FISH[ id ];
		const kg = Math.round( ( f.kg[ 0 ] + ( f.kg[ 1 ] - f.kg[ 0 ] ) * ( 0.4 + 0.08 * c.level ) ) * 2 ) / 2;
		return { params: { kg, species: id }, goal: 1, title: `Land a ${ f.name.toLowerCase() } over ${ kg } kg`, tokens: { kg, fish: f.name.toLowerCase() }, money: 40 + f.price * kg * 1.8 };

	},

	catchHabitat( r, c ) {

		const habitat = pick( r, c.level > 0 ? [ 'reef', 'deep', 'pier', 'bay', 'shallows' ] : [ 'reef', 'pier', 'bay', 'shallows' ] );
		const n = habitat === 'deep' ? int( r, 2, 3 ) : int( r, 3, 5 );
		return { params: { habitat }, goal: n, title: `Catch ${ n } fish ${ HABITAT_PHRASE[ habitat ] }`, tokens: { n, habitat: HABITAT_PHRASE[ habitat ] }, money: 20 + n * ( habitat === 'deep' ? 28 : habitat === 'reef' ? 12 : 9 ) };

	},

	deliverCargo( r, c ) {

		const n = int( r, 3, 10 ) + 2 * c.level, port = PORT_INFO[ c.port ].other;
		return { params: { port }, goal: n, title: `Sell ${ n } cargo at ${ PORT_INFO[ port ].short }`, tokens: { n, port: PORT_INFO[ port ].name }, money: 100 + n * 14 };

	},

	sellFish( r, c ) {

		const total = [ 60, 90, 130, 180, 240, 320 ][ Math.min( 5, c.level + int( r, 0, 1 ) ) ];
		return { params: { port: c.port }, goal: total, title: `Sell $${ total } of fish at ${ PORT_INFO[ c.port ].short }`, tokens: { total }, money: 20 + 0.3 * total };

	},

	visitPort( r, c ) {

		const port = PORT_INFO[ c.port ].other;
		return { params: { port }, goal: 1, title: `Make way to ${ PORT_INFO[ port ].short }`, tokens: { port: PORT_INFO[ port ].name }, money: 70 };

	},

	sinkPirate( r, c ) {

		const n = c.level >= 2 && r() < 0.5 ? 2 : 1;
		return { params: {}, goal: n, title: `Sink ${ n } pirate ship${ s( n ) }`, tokens: { n, s: s( n ) }, money: 230 * n, unlock: n >= 2 ? 'pepe' : null };

	},

	shoreRaider( r, c ) {

		const n = int( r, 1, Math.min( 3, 1 + c.level ) );
		return { params: {}, goal: n, title: `Drive off ${ n } shore raider${ s( n ) }`, tokens: { n, s: s( n ) }, money: 60 * n + 20, unlock: n >= 3 ? 'pepe' : null };

	},

};

// quest types and their weight by standing level (combat is off the board for newcomers)
const TYPE_WEIGHT = {
	catchSpecies: () => 3, catchWeight: () => 1.5, catchHabitat: () => 2, sellFish: () => 2, deliverCargo: () => 1.6, visitPort: () => 1,
	sinkPirate: ( lv ) => ( lv >= 1 ? 1.2 : 0 ), shoreRaider: ( lv ) => ( lv >= 1 ? 1.2 : 0 ),
};
export const QUEST_TYPES = Object.keys( TYPE_WEIGHT );

function chooseTypes( r, level, count ) {

	const out = [];
	while ( out.length < count ) {

		const pool = QUEST_TYPES.filter( ( t ) => TYPE_WEIGHT[ t ]( level ) > 0 );
		const left = [ ...pool ];
		while ( left.length && out.length < count ) {

			const t = weighted( r, left.map( ( k ) => [ k, TYPE_WEIGHT[ k ]( level ) ] ) );
			left.splice( left.indexOf( t ), 1 );
			out.push( t );

		}

	}

	return out;

}

function bountyCount( r, level ) {

	const x = r();
	switch ( level ) {

		case 0: return x < 0.6 ? 1 : 0;
		case 1: return 1;
		case 2: return x < 0.5 ? 1 : 2;
		case 3: return 2;
		default: return x < 0.5 ? 2 : 3;

	}

}

function makeBounty( r, c, tier ) {

	const captain = `${ pick( r, GIVEN ) } ${ pick( r, SURNAMES ) }`, epithet = pick( r, EPITHETS[ tier ] );
	const ship = `${ pick( r, SHIP_A ) } ${ pick( r, SHIP_B ) }`;
	const region = pickRegion( r, c.port, tier );
	const text = fill( pick( r, BOUNTY_TEXT[ tier ] ), { captain, craft: CRAFT[ tier ] } );
	return {
		tier, captain, epithet, ship, craft: CRAFT[ tier ], region, target: `${ captain }, ${ epithet }`,
		client: pick( r, BOUNTY_CLIENTS[ c.port ] ), text, title: `Wanted: ${ captain }`,
		money: BOUNTY_BASE[ tier ] * ( 0.85 + 0.3 * r() ) * c.scale,
	};

}

// ---------------------------------------------------------------- the day's postings

// generateDay( seed, port, day, level ) -> up to CANDIDATES postings, the best board first. Deterministic.
export function generateDay( seed, port, day, level = 0 ) {

	if ( ! PORT_INFO[ port ] ) return [];
	level = Math.max( 0, Math.min( STANDING.length - 1, level | 0 ) );
	const r = rng( hash32( 'notices', seed, port, day ) );
	const ctx = { port, level, scale: 1 + 0.07 * level };
	const nb = bountyCount( r, level );
	const tiers = [];
	for ( let i = 0; i < nb; i ++ ) tiers.push( weighted( r, TIER_WEIGHTS[ level ].map( ( w, k ) => [ k + 1, w ] ) ) );
	const quests = chooseTypes( r, level, CANDIDATES - nb ).map( ( type ) => ( { type, ...MAKERS[ type ]( r, ctx ) } ) );
	const bounties = tiers.map( ( tier ) => makeBounty( r, ctx, tier ) );

	// a board of four shows three errands and a bounty, five and six add one more of each
	const order = [];
	let q = 0, b = 0;
	while ( q < quests.length || b < bounties.length ) {

		if ( q < quests.length ) order.push( { quest: quests[ q ++ ] } );
		if ( b < bounties.length && ( order.length % 3 === 2 || q >= quests.length ) ) order.push( { bounty: bounties[ b ++ ] } );

	}

	const issued = day * DAY_HOURS;
	return order.map( ( o, slot ) => {

		const common = { id: `${ port }:${ day }:${ slot }`, port, day, slot, issued, roll: Math.round( r() * 1e4 ) / 1e4 };
		const unlockRoll = r();
		if ( o.bounty ) {

			const bt = o.bounty;
			const unlock = bt.tier === 3 ? 'clown' : bt.tier === 2 && unlockRoll < 0.35 ? 'bonk' : null;
			return {
				...common, kind: 'bounty', type: 'bounty', title: bt.title, client: bt.client, text: bt.text, params: {}, goal: 1,
				reward: { money: round5( bt.money ), rep: BOUNTY_REP[ bt.tier ], unlock },
				expires: issued + BOUNTY_LIFE[ bt.tier ] + int( r, - 4, 6 ),
				tier: bt.tier, target: bt.target, captain: bt.captain, epithet: bt.epithet, ship: bt.ship, craft: bt.craft, region: bt.region,
			};

		}

		const qu = o.quest, money = round5( Math.max( 25, qu.money * ctx.scale ) );
		const script = pickScript( r, qu.type, port );
		return {
			...common, kind: 'quest', type: qu.type, title: qu.title, client: script.client, text: fill( script.text, qu.tokens ),
			params: qu.params, goal: qu.goal,
			reward: { money, rep: 2 + Math.round( money / 120 ), unlock: qu.unlock && unlockRoll < 0.3 ? qu.unlock : null },
			expires: issued + int( r, 18, 36 ),
		};

	} );

}

function pickScript( r, type, port ) {

	const list = SCRIPTS[ type ].filter( ( x ) => x.port === port || x.port === null );
	return pick( r, list.length ? list : SCRIPTS[ type ] );

}

// ---------------------------------------------------------------- progress rules

const norm = ( v ) => ( typeof v === 'string' ? v.trim().toLowerCase() : '' );

// does this shipSunk payload name the bounty's target?
export function targetMatches( n, e ) {

	if ( ! e || typeof e !== 'object' ) return false;
	if ( e.bountyId !== undefined && e.bountyId === n.id ) return true;
	const t = norm( n.target ), c = norm( n.captain );
	if ( ! t ) return false;
	for ( const v of [ e.target, e.captain, e.name ] ) {

		const x = norm( v );
		if ( x && ( x === t || x === c ) ) return true;

	}

	return false;

}

// how much progress an event adds to a quest (0 = none). Bounties are handled by Notices (claimed or beaten).
export function eventDelta( n, name, e ) {

	const p = n.params || {};
	e = e && typeof e === 'object' ? e : {};
	switch ( n.type ) {

		case 'catchSpecies': return name === 'fishCaught' && e.species === p.species ? 1 : 0;
		case 'catchWeight': return name === 'fishCaught' && num( e.kg ) >= p.kg && ( ! p.species || e.species === p.species ) ? 1 : 0;
		case 'catchHabitat': return name === 'fishCaught' && e.habitat === p.habitat ? 1 : 0;
		case 'deliverCargo': return name === 'cargoSold' && e.port === p.port && ( ! p.good || e.good === p.good ) ? Math.max( 0, Math.floor( num( e.qty, 1 ) ) ) : 0;
		case 'sellFish': return name === 'fishSold' && ( ! p.port || e.port === p.port ) ? Math.max( 0, num( e.total ) ) : 0;
		case 'visitPort': return name === 'portVisited' && e.port === p.port ? 1 : 0;
		case 'sinkPirate': return name === 'shipSunk' && e.faction === 'pirate' && e.byPlayer !== false ? 1 : 0;
		case 'shoreRaider': return name === 'enemyDefeated' && ! NON_RAIDERS.has( norm( e.kind ) ) ? 1 : 0;
		default: return 0;

	}

}

// the events a notice listens to
export const EVENTS = [ 'fishCaught', 'fishSold', 'cargoSold', 'portVisited', 'shipSunk', 'enemyDefeated' ];

// progress as text: '2 / 4' or '$40 / $150'
export function progressText( n ) {

	const money = n.type === 'sellFish';
	const f = ( v ) => ( money ? `$${ Math.round( v ) }` : String( Math.round( v ) ) );
	return `${ f( Math.min( n.progress, n.goal ) ) } / ${ f( n.goal ) }`;

}

// 'Last seen 900 m south-east of Hyptile Harbour'
export function regionText( n ) {

	if ( ! n.region ) return '';
	return `${ fmtDistance( n.region.distance ) } ${ n.region.compass } of ${ PORT_INFO[ n.port ].name }`;

}

// ---------------------------------------------------------------- quest notices (wave 13: the story's chains on the boards)
// A board pins the story's wave 13 quests where they fit: the posting is taken through the story (story.acceptPosting),
// not as a notice (it does not count against MAX_ACTIVE). While a chain cannot be taken (gated, running, done and not due
// again) its notice is not up. Hold the line recurs: the story offers it again a day after it was done.
//
// Notices.js wiring (the notices owner adds it):
//   board( port ), before `out.sort( ... )`:
//       const story = this.features.get && this.features.get( 'story' );
//       if ( story ) try { out.push( ...storyPostings( port, story, now ) ); } catch ( e ) { /* the story is optional */ }
//   accept( id ), first line after `this.lastError = '';`:
//       if ( typeof id === 'string' && id.startsWith( 'story:' ) ) {
//           const story = this.features.get && this.features.get( 'story' );
//           if ( ! story || ! story.acceptPosting( id ) ) return this._err( ( story && story.lastError ) || 'That notice is gone' );
//           this._changed(); return { id, story: true };
//       }
export const QUEST_NOTICES = [
	{ chain: 'ferryToTidemark', ports: [ 'home' ], client: 'PoorGoat, fish buyer', title: 'A ferry to Tidemark', text: 'Wanted: somebody to sail east to Tidemark, sell a catch at the fish hall and find out who is buying. Ask at my stand.' },
	{ chain: 'learnToFight', ports: [ 'home' ], client: 'Ethena Prosper, chandlery', title: 'Learn to fight', text: 'Win a practice fight at the training post and land one pistol shot in it. A pouch of cartridges for anyone who manages both.' },
	{ chain: 'blackwaterRumours', ports: [ 'home', 'tidemark' ], client: 'Brine, the Tide & Tankard', title: 'Rumours from Blackwater', text: 'Talk in the tavern of a pirate town south of the reef. Scout it quietly, silence a gun, take it: the board pays for each.' },
	{ chain: 'longWayRound', ports: [ 'tidemark' ], client: 'Brine, the Tide & Tankard', title: 'The long way round', text: 'A bet on the bar: nobody flies the Kestrel to the home island and back in one piece. Prove it wrong.' },
	{ chain: 'holdTheLine', ports: [ 'tidemark' ], client: 'Harbourmaster Osric', title: 'Hold the line', text: 'A pirate sloop raids the bay when the moon is dark. Sink or cripple her before she wrecks the waterfront.' },
];
// wave 16: Mayday, Letters of marque, The salt road (StoryData.W16_CHAINS), on the same boards after the wave 13 ones
export const W16_NOTICES = [
	{ chain: 'mayday', ports: [ 'tidemark', 'home' ], client: 'Harbourmaster Osric', title: 'Mayday', text: 'Carry flares. Fire one when you are adrift and the harbour launch comes; answer the next red flare you see. The harbour pays, and remembers.' },
	{ chain: 'lettersOfMarque', ports: [ 'tidemark' ], client: 'Harbourmaster Osric, for the council', title: 'Letters of marque', text: 'The council will license captains against the brotherhood: take a pirate hull, turn her, and bring a named captain to book.' },
	{ chain: 'saltRoad', ports: [ 'home', 'tidemark' ], client: 'Ethena Prosper, for the trade guild', title: 'The salt road', text: 'The guild takes members who make routes pay: three profitable runs on the board\'s best loads, a licence, a bulk lot in the Tidemark warehouse.' },
];

// wave 20C: the lines of StoryW20 (the navy lieutenant, the Tide & Tankard, Wren on the porch, Old Pepe's storm fronts) and their
// follow-ups, posted once their first chain is done (Convoy duty only for a captain who handed the deserter over: the story's gate)
export const W20_NOTICES = [
	{ chain: 'kingsWater', ports: [ 'tidemark', 'home' ], client: 'Lieutenant Hale, the naval jetty', title: 'Navy business', text: 'Captains wanted for convoy work, a raider hunt and dispatches by air. Report to the naval jetty at Tidemark.' },
	{ chain: 'diceNight', ports: [ 'tidemark' ], client: 'Brine, the Tide & Tankard', title: 'Dice night', text: 'Lost: one sailor, last seen leaving with the dice winners. Also wanted: a steady pair of fists, and a captain who does not mind weather.' },
	{ chain: 'wrensPast', ports: [ 'tidemark' ], client: 'Wren Calloway, on the porch', title: 'Wren\'s past', text: 'Former navy helm seeks a berth and one storm. Ask on the Tide & Tankard porch.' },
	{ chain: 'chasingTheLine', ports: [ 'home' ], client: 'Old Pepe, weather prophet', title: 'Chasing the line', text: 'Somebody young, with a boat and a plane, to go and look at the storm lines up close. Ask on the bench by the plaza.' },
	{ chain: 'convoyDuty', ports: [ 'tidemark' ], client: 'Lieutenant Hale, the naval jetty', title: 'Convoy duty', text: 'Another convoy is due through the lanes. Bring her through and collect the Crown\'s bounty.' },
	{ chain: 'stormRun', ports: [ 'tidemark' ], client: 'Brine, the Tide & Tankard', title: 'Another stormy night', text: 'Casks for Pons, same arrangement as before. Wait for weather.' },
	{ chain: 'frontLine', ports: [ 'home', 'tidemark' ], client: 'Old Pepe, weather prophet', title: 'Another line', text: 'Another storm line is coming. Fly up and look at its lightning for an old man.' },
];

// the quest notices on `port`'s board now (story: the story feature; hours: the board's clock): board-card shaped
export function storyPostings( port, story, hours = 0 ) {

	if ( ! story || typeof story.canAccept !== 'function' ) return [];
	const day = Math.floor( num( hours ) / DAY_HOURS ), out = [];
	[ ...QUEST_NOTICES, ...W16_NOTICES, ...W20_NOTICES ].forEach( ( q, i ) => {

		if ( ! q.ports.includes( port ) ) return;
		const c = typeof story.chain === 'function' ? story.chain( q.chain ) : null;
		if ( ! c || ! story.canAccept( q.chain ) ) return;
		const r = c.reward || {};
		const money = r.money || [ ...( c.steps || [] ) ].reduce( ( a, s ) => a + num( s.payout && s.payout.money ), 0 );
		const expires = ( day + 1 ) * DAY_HOURS; // pinned afresh each day
		out.push( {
			id: `story:${ q.chain }`, port, day, slot: 100 + i, kind: 'quest', type: 'story', story: true, chain: q.chain,
			title: L( q.title ), client: L( q.client ), text: L( q.text ), params: {}, goal: 1,
			reward: { money, rep: num( r.rep && r.rep[ port ] ), unlock: null }, issued: day * DAY_HOURS, expires, left: expires - num( hours ),
		} );

	} );
	return out;

}

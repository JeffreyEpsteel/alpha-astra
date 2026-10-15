// Data and pure helpers of the boarding feature (src/features/boarding): every number that tunes it, the deck geometry of a
// pirate ship in her own frame, the ransom and plunder tables. No engine, no DOM, no game state.
//
// Lineage: the naval fork's NAVAL_BRIEF C4 / WORLD_TRADE_PIRATES_BRIEF D5 ("board from an adjacent vessel, melee on deck, steal
// cargo, repel boarders, ransom or sink them", "board and capture the captain for the bigger payout") and its prisoner transport /
// ransom / boarding plank work (UpsideDownFishing/Source/.../Naval: PiratePrisonerTransportComponent, PirateBoardingPlank). Here the
// plank is a short fade and a step across; the prisoner rides in the player's boat; the ransom is paid at the harbour.
//
// Ship frame (Naval Ship.js): +Z forward, +X port, yaw about +Y; world = pose + R( yaw ) * local with
//   x = px + lx cos( yaw ) + lz sin( yaw ),  z = pz - lx sin( yaw ) + lz cos( yaw ).

export const RULES = {
	cripple: 0.25, // hull fraction below which a pirate strikes her colours and drifts
	range: 8, // m from the player's boat to the pirate hull to be offered the crossing
	slow: 3, // m/s: the boat must be under way no faster than this
	adriftLife: 200, // s a crippled ship lies there before she founders on her own
	maxPrisoners: 2,
	fadeOut: 0.45, fadeIn: 0.55, // s: the crossing (a plank, in effect) is a short fade
	// crew on deck by class; the captain stands back until they are down
	crew: { sloop: 2, brigantine: 3, trawler: 1 }, // (a merchant's deck hands; a navy hull ships one more: Boarding._crewFor)
	prizes: [ 'pirate', 'merchant', 'navy' ], // wave 15C: the factions whose crippled ships strike to the player and can be boarded
	// ransom paid at the harbour by tier (1 sloop, 2 brigantine, 3 the named brigantine captains), +-spread at capture
	ransom: [ 0, 240, 520, 1100 ],
	ransomSpread: 0.15,
	bountyMult: 1.5, // a bounty target taken alive pays the contract x this (the notices pay x1, boarding adds the rest)
	escapeChance: 0.65, // each prisoner, when the player loses a melee fight
	plunderCargo: [ 'rum', 'spices', 'pearls', 'rope' ],
};

// the crew fight like the shore raiders (melee/MeleeData.js RAIDER) with a few differences: lighter, no flight, no loot of their own
export const CREW_TWEAK = { hp: 80, damage: 14, windup: 0.7, speed: 2.1, flees: 0, downTime: 3.5, loot: 0, notice: 18, leash: 60, lose: 60, radius: 0.4, armored: false };

export const CREW_NAMES = [ 'Gannet Tom', 'Bilge Kit', 'Cutlass Ann', 'Tarry Wil', 'Sprat', 'Dredge Jo', 'Marlin Pike', 'Hob', 'Black Nell', 'Kelp Ruth' ];
export const CAPTAIN_CHARACTERS = [ 'heptyle', 'bravile', 'clown', 'pepe', 'bonk', 'doge', 'pengu' ];
export const CREW_CHARACTERS = [ 'bonk', 'doge', 'pengu', 'pepe', 'clown' ];

export const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );
export const wrap = ( a ) => Math.atan2( Math.sin( a ), Math.cos( a ) );

// small string hash (character choice by captain name)
export function hash( s ) {

	let h = 2166136261;
	for ( let i = 0; i < s.length; i ++ ) h = Math.imul( h ^ s.charCodeAt( i ), 16777619 );
	return h >>> 0;

}

// ---- geometry -----------------------------------------------------------------------------------

export function toLocal( pose, X, Z, out = {} ) {

	const dx = X - pose.x, dz = Z - pose.z, c = Math.cos( pose.yaw ), s = Math.sin( pose.yaw );
	out.x = dx * c - dz * s;
	out.z = dx * s + dz * c;
	return out;

}

export function toWorld( pose, lx, lz, out = {} ) {

	const c = Math.cos( pose.yaw ), s = Math.sin( pose.yaw );
	out.x = pose.x + lx * c + lz * s;
	out.z = pose.z - lx * s + lz * c;
	return out;

}

// the walkable deck of a class: an ellipse inside the bulwarks (half length, half beam)
export function deckFor( cls ) {

	return { hl: Math.max( 2, cls.length * 0.5 - 1.1 ), hb: Math.max( 1, cls.beam * 0.5 - 0.45 ) };

}

// ellipse value: < 1 inside the deck, 1 on its edge
export function deckQ( d, lx, lz ) {

	return ( lx / d.hb ) ** 2 + ( lz / d.hl ) ** 2;

}

export const insideDeck = ( d, lx, lz, margin = 1 ) => deckQ( d, lx, lz ) <= margin * margin;

// pull a local point back inside the deck, radially (a little inside the edge)
export function clampDeck( d, lx, lz, out = {} ) {

	const q = Math.sqrt( deckQ( d, lx, lz ) );
	const k = q > 0.97 ? 0.97 / q : 1;
	out.x = lx * k;
	out.z = lz * k;
	return out;

}

// metres from a world point to the hull rectangle of a ship (0 inside it)
export function hullGap( cls, pose, X, Z ) {

	const l = toLocal( pose, X, Z, {} );
	const ex = Math.max( 0, Math.abs( l.x ) - cls.beam * 0.5 ), ez = Math.max( 0, Math.abs( l.z ) - cls.length * 0.5 );
	return Math.hypot( ex, ez );

}

// the starting places on deck: the player arrives at the rail on the side of his boat, the crew at the far end, the captain aft
export function layout( d, boatLocal, count ) {

	const side = boatLocal.x >= 0 ? 1 : - 1;
	const zf = boatLocal.z > 0 ? - 1 : 1; // the crew start on the other half of the deck
	const arrive = clampDeck( d, side * d.hb * 0.92, clamp( boatLocal.z, - d.hl * 0.5, d.hl * 0.5 ) );
	const spots = [ [ 0, 0.55 ], [ - side * 0.45, 0.2 ], [ side * 0.35, 0.8 ] ];
	const crew = [];
	for ( let i = 0; i < count; i ++ ) {

		const [ fx, fz ] = spots[ i % spots.length ];
		crew.push( clampDeck( d, fx * d.hb, zf * fz * d.hl ) );

	}

	const captain = clampDeck( d, 0, - d.hl * 0.78 );
	return { side, arrive, crew, captain };

}

// ---- value --------------------------------------------------------------------------------------

// 1 sloop, 2 brigantine, or the bounty's own tier
export function tierOf( ship ) {

	if ( ship && ship.bounty && Number.isFinite( ship.bounty.tier ) ) return clamp( Math.round( ship.bounty.tier ), 1, 3 );
	return ship && ship.kind === 'brigantine' ? 2 : 1;

}

export function ransomFor( tier, rand ) {

	const base = RULES.ransom[ clamp( Math.round( tier ) || 1, 1, 3 ) ];
	const f = 1 + ( ( typeof rand === 'function' ? rand() : 0.5 ) * 2 - 1 ) * RULES.ransomSpread;
	return Math.round( base * f / 5 ) * 5;

}

// coins and cargo from a plundered hull: the coins are the ship class's crate values (as when she is sunk by gunfire), the cargo
// a few crates of dear goods for the hold ( trade.addCargo )
export function plunderFor( cls, rand ) {

	const [ a, b ] = cls.loot.value;
	let coins = 0;
	for ( let i = 0; i < cls.loot.crates; i ++ ) coins += Math.round( a + ( b - a ) * rand() );
	const goods = [];
	const pool = RULES.plunderCargo;
	let crates = cls.loot.crates;
	while ( crates > 0 ) {

		const good = pool[ Math.floor( rand() * pool.length ) % pool.length ];
		const qty = Math.min( crates, 1 + Math.floor( rand() * 2 ) );
		const e = goods.find( ( g ) => g.good === good );
		if ( e ) e.qty += qty; else goods.push( { good, qty } );
		crates -= qty;

	}

	return { coins, goods };

}

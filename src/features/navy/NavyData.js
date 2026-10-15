// The navy's numbers (wave 19B): no engine, no DOM.
//
// Standing with the navy runs -100 .. 100 (a new captain starts at 0): up for pirates sunk (by you, or by the navy with your
// help), convoys saved, men pulled out of the water, a boarding taken quietly; down for shooting at the navy, sinking it or a
// merchant, running from a hail, unpaid fines, refusing the press gang. It gates the naval jetty's chandler and sets its prices.
// The navy wants you (it hails, boards, fires if you run) while: your hull is a wanted one (hijack), your notoriety is at
// WANTED.notoriety or more (pirates), you have WANTED.offences customs offences anywhere, your standing is at WANTED.standing or
// lower, or you fired on the navy (hostile, HOSTILE s). A boarding party's fine pardons you for PARDON island hours.

export const STANDING = {
	min: - 100, max: 100,
	pirateSunk: 6, pirateHelp: 3, convoySaved: 8, rescue: 5, boarded: 2, pressSigned: 8,
	navyHit: - 12, navySunk: - 45, merchantSunk: - 15, ran: - 8, fineUnpaid: - 10, pressRefused: - 2,
};

export const STANDING_LEVELS = [
	{ at: - 100, name: 'Enemy of the Crown' },
	{ at: - 40, name: 'A known rogue' },
	{ at: - 10, name: 'Watched' },
	{ at: 10, name: 'Neutral' },
	{ at: 25, name: 'Friend of the fleet' },
	{ at: 50, name: 'Honorary officer' },
];

export const WANTED = { notoriety: 3, offences: 2, standing: - 40 };
export const HOSTILE = 150; // s the navy fights you after you fired on it
export const PARDON = 6; // island hours a paid fine keeps you clear (new crimes break it)

export const FLEET = {
	frigates: 1, cutters: 2,
	every: 2, // s between fleet checks
	respawn: 240, // s after a navy ship is lost (sunk or gone)
	noPopIn: 380, // m: never spawned closer to the camera than this
	foeReach: 650, // m: a navy ship takes on a pirate this close to her (or to her ward)
	pirateFight: 900, // m: a pirate fights back the navy ship hunting her while the player is not nearer
	moorReach: 70, // m from the jetty: a fleeing ship moors there
	repair: 0.03, // of her hull a second at the jetty
	ammo: { frigate: 72, revenue: 30 },
};

// navy bounties (paid at Tidemark: the harbourmaster's board and the navy office): by the class of the pirate; a named captain
// (pirates' roster or a notice bounty) pays BOUNTY.named times more; a pirate the navy sank with your shot in her the last
// BOUNTY.assist s pays BOUNTY.share of it
export const BOUNTY = { sloop: 160, brigantine: 380, other: 120, named: 1.5, share: 0.5, assist: 90 };

export const FINE = { base: 120, perLevel: 60, hull: 380, offence: 40 };

// the naval jetty's chandler: better cannon (naval's heavyGuns module, gated by standing) and chain shot (weapons' locker),
// cheaper the better your standing; powder and shot at the navy's price
export const CHANDLER = {
	open: - 10, // standing to be served at all
	heavy: 25, long: 50, // standing for the heavy shot / the long guns
	discountMax: 0.4, // off chain shot and powder at standing 100 (none at 0 and below)
	chain: { pack: 6, price: 54 },
	powder: { rounds: 12, price: 60 },
};

export const PRESS = { below: - 15, chance: 0.35, fine: 150, every: 300, reach: 140 }; // s between press-gang chances, m from a dock

export const EVENTS = {
	first: 120, every: [ 200, 380 ], // s between sea events (the first after FIRST)
	convoy: { reward: 450, standing: STANDING.convoySaved, far: [ 650, 900 ], pirates: [ 1, 2 ], hold: 150, lose: 1800 },
	overboard: { reward: 120, far: [ 260, 520 ], reach: 5, life: 360, flareEvery: 30 },
};

export const HAIL = {
	hail: ( ship ) => `"Heave to!" The ${ ship } orders you to stop your boat`,
	warn: ( ship ) => `The ${ ship }: "Heave to or we open fire!"`,
	fire: ( ship ) => `The ${ ship } opens fire!`,
	board: ( ship ) => `A boarding party from the ${ ship } comes aboard`,
};

export const clampStanding = ( v ) => Math.max( STANDING.min, Math.min( STANDING.max, v ) );

export function standingName( v ) {

	let name = STANDING_LEVELS[ 0 ].name;
	for ( const l of STANDING_LEVELS ) if ( v >= l.at ) name = l.name;
	return name;

}

// the chandler's discount at a standing (0 .. CHANDLER.discountMax)
export function discount( standing ) {

	return Math.max( 0, Math.min( 1, standing / 100 ) ) * CHANDLER.discountMax;

}

// the bounty for a pirate ship of class `kind` (named: a captain of the roster or a notice's target)
export function bountyFor( kind, named = false ) {

	const base = BOUNTY[ kind ] ?? BOUNTY.other;
	return Math.round( base * ( named ? BOUNTY.named : 1 ) );

}

// the boarding party's fine: notoriety level, offences, a wanted hull
export function fineFor( { level = 0, offences = 0, hull = false } = {} ) {

	return Math.round( FINE.base + FINE.perLevel * Math.max( 0, level ) + FINE.offence * Math.max( 0, offences ) + ( hull ? FINE.hull : 0 ) );

}

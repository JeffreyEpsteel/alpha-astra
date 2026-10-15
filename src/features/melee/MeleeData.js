// Data and pure helpers of the on-foot melee feature (src/features/melee): every number that tunes the
// fight, the shore raiders' camps and names, and the small angle / clock functions the logic and the
// tests share. No engine, no DOM.
//
// Lineage: the naval fork's browser prototype (Fishing_Browser_Prototype_20261011_v2) fought a shore
// raider with a 0.7 s wind-up, a 0.12 s strike, a 0.8 s recovery, 18 damage, 34 per player hit, guard that
// chips 15 stamina and a dodge with 0.25 s of i-frames; the Unreal game's HyptileMelee had a 0.3 s contact
// (the Melee_Paddle clip), a range / cone / line-of-sight test, a down state and a 3 s recovery. Both are
// kept here, scaled to this game's stamina (0..1, owned by Player.js).
//
// Yaw convention everywhere: Player.yaw, 0 faces -Z; forward = ( -sin yaw, -cos yaw ).

// ---- the player -----------------------------------------------------------------------------------------

export const PLAYER = {
	maxHp: 100,
	// attack (left mouse button, rod stowed, a raider within `engageRange`): contact 0.3 s after the press
	// (the Melee_Paddle clip), ready again at `attackTotal`; a press inside the last `attackBuffer` s queues the next swing
	// wave 12E (the play harness, test/feature-combat-play.mjs): 24 a blow (30 on a punish) puts a tier 1 raider down in 3-4
	// swings and a tier 3 in 6-8 (was 34 / 51: tier 3 fell in 3-4, tier 1 in 2-3)
	attackDamage: 24, attackRange: 2.6, attackCone: 0.5, // cone: dot( facing, direction to target ) >= 0.5 (60 degrees)
	attackContact: 0.3, attackTotal: 0.62, attackStamina: 0.08, attackBuffer: 0.3,
	whiffTotal: 0.78, // a swing that found nothing: a swish and a slightly longer recovery (the dodge still cancels it)
	punishBonus: 1.25, // damage multiplier on a raider in its recovery
	engageRange: 6,
	// guard (hold the right mouse button, rod stowed): blocks frontal hits, each one chips stamina; holding it
	// costs `guardDrain` per second on top of Player's own regeneration
	blockCone: 0.3, blockChip: 0.15, guardDrain: 0.1, guardMin: 0.02,
	// evade (Q): a quick dash, i-frames from its first frame
	// (wave 12E: i-frames 0.3 s, so a dodge anywhere in the last 0.25 s of a wind-up is safe; the swing's recovery after its
	// contact can be cancelled into it, a press before the contact is queued for the contact)
	evadeDist: 2.0, evadeTime: 0.2, evadeInvuln: 0.3, evadeCooldown: 0.45, evadeStamina: 0.18,
	// being hit
	hurtTime: 0.6, hurtInvuln: 0.5,
	// at 0 hp: Knockdown for `fallTime`, then the player wakes at the nearest pier and gets up (GetUp_Front) until `downTime`
	downTime: 3.0, fallTime: 1.2, cashLoss: 0.1,
	regenDelay: 8, regen: 3, // hp per second after `regenDelay` s without a raider on the player
	// the guard's timing (wave 4): a press `lateWindow`..`lateWindow + parryWindow` s before the blow lands parries it (no
	// damage, no stamina, the raider staggers `parryStagger` s open to a punish); a press later than that is a late block that
	// still lets `chip` of the damage through; a guard held from earlier is a plain block (stamina only)
	// wave 12E: the parry is any raise within the last 0.2 s before the blow (the harness raises it 1 frame - 0.2 s early; the
	// window is 0.22 so a 0.2 s raise rounded up to the next 60 Hz frame still counts); a guard that comes up inside the
	// blow's own step (sub-frame: the test's direct calls, a long frame) is late
	parryWindow: 0.22, lateWindow: 0.012, chip: 0.3, parryRefund: 0.04,
	lowHp: 0.3, // share of maxHp under which the screen edge pulses
	practiceYield: 0.1, // a practice fight stops with the player at this share of his health ("You're down - try again")
	combatLinger: 3, // s the health bar stays up after the last blow traded
};

// ---- difficulty by tier (wave 4). A raider's cfg is RAIDER (tier 2) with its tier's overrides; den guards take the tier of
// their keeper, boarding crews that of the ship. Tier 1 telegraphs slowly and never flanks; tier 3 is quick and works round
// behind the player while the others keep him busy.
// Wave 12E: `tokens` is how many may swing at once while a raider of that tier is one of them (tier 1 crowds take strict
// turns, so "block, then two swings" fits between their blows); `armored`: a plain blow does not stop his wind-up (only a
// parry or a ball does). Telegraphs are 0.55 s or longer (0.52 was too short to read).
export const TIERS = {
	1: { tier: 1, hp: 80, damage: 12, windup: 0.8, recover: 0.95, gap: 0.6, speed: 2.3, flank: 0, loot: 8, tokens: 1 },
	2: { tier: 2 },
	3: { tier: 3, hp: 160, damage: 20, windup: 0.6, recover: 0.75, gap: 0.35, speed: 2.8, flank: 0.8, stagger: 0.45, armored: true, loot: 20 },
	4: { tier: 4, hp: 200, damage: 24, windup: 0.55, recover: 0.65, gap: 0.3, speed: 2.9, flank: 1, stagger: 0.4, armored: true, loot: 32 },
};

export function tierCfg( base, tier ) {

	const t = TIERS[ Math.max( 1, Math.min( 4, Math.round( tier ) || 2 ) ) ];
	return { ...base, ...t };

}

// ---- the attack tokens: at most `max` raiders swing at once, and two wind-ups never start closer than `gap` s apart, so
// a crowd takes turns (the others circle and flank: Raider 'circle')
export const TOKENS = { max: 2, gap: 0.5, after: 0.3 };

// ---- the raiders ----------------------------------------------------------------------------------------

export const RAIDER = {
	hp: 110, damage: 16,
	notice: 12, // m: a camped raider spots the player inside this
	lose: 26, // m: an approaching raider gives up beyond this (after loseTime s)
	loseTime: 3,
	leash: 30, // m from the camp: further and he walks back
	hitRange: 2.4, startRange: 2.1, // the strike reaches hitRange; he starts a wind-up inside startRange
	cone: 0.34, // the strike needs dot( his facing, direction to the player ) >= 0.34 (70 degrees)
	noticeTime: 0.5,
	windup: 0.68, // the telegraph: red ring on the ground + "!" over the head; the swing's contact is its last instant
	strike: 0.12,
	recover: 0.8, // the punish window
	stagger: 0.55, // Hit_Reaction after a hit outside his recovery
	gap: 0.35, // s after a recovery before the next wind-up may begin
	speed: 2.5, walkSpeed: 0.9, returnSpeed: 2.2, fleeSpeed: 3.2, // m/s (the player jogs 2.7 and sprints 4.6)
	turnRate: 5, lockTime: 0.15, // rad/s while winding up; he stops tracking the last lockTime s
	downTime: 2.5, // s a knocked-down raider stays down before he gets up (wave 12E; was 5)
	outTime: 6, // ... and a beaten one who does not get up lies there this much longer before he is dragged off
	getUpTime: 2.4, fleeTime: 7, tauntTime: 3, healRate: 30, // hp/s while walking back to camp
	flees: 0.6, // chance a beaten raider gets up and runs instead of staying down
	armored: false, // a wind-up cannot be interrupted by a hit
	scale: 1, radius: 0.45,
	loot: 12, // island dollars (campaign only)
	tier: 2,
	// waiting for a token he holds a ring round the player and circles (wave 4): radius `circle` (+-0.6), at `circleSpeed`
	// m/s sideways, spread from the others by `spread` rad; `flank` 0..1 pulls his spot round behind the player
	circle: 4.2, circleSpeed: 1.5, spread: 1.1, flank: 0.4,
	commit: 2.5, // s he may take to close in once he holds a token before he gives it back
	parryStagger: 1.0, // s open after his blow is parried
	tokens: 2, // see TIERS
	knockdownDamage: 60, // a single blow this heavy (a musket ball) knocks an unarmoured raider off his feet
};

export const CAPTAIN = {
	...RAIDER,
	hp: 220, damage: 24, windup: 0.55, recover: 0.7, stagger: 0.35, speed: 2.9,
	armored: true, flees: 0, downTime: 4, outTime: 9, scale: 1.1, loot: 60, tier: 4, flank: 0.6, parryStagger: 0.8,
};

// ---- the rock thrower (wave 12E): with three or more raiders on the player one of them hangs back and throws rocks, a
// telegraphed ranged blow (the ring marks where it lands) the guard blocks, so guarding matters at range too
export const THROW = {
	crowd: 3, // raiders on the player before one becomes the thrower
	hang: 8.5, // m he keeps from the player
	windup: 0.9, // s: the telegraph (rock raised, "!" over his head, the ring at the player's feet)
	every: 3.4, // s between throws
	speed: 15, // m/s over the ground
	gravity: 9.8,
	damage: 0.6, // share of his tier's melee damage
	chip: 0.08, // stamina a blocked rock costs
	radius: 0.55, // m: a rock this close to the player's body hits him
	ring: 0.9, // m: the landing ring's radius
};

// ---- feel (wave 12E): hitstop (both fighters freeze), the parry's slow motion, the hurt / low-health edge
export const FEEL = {
	hitstop: 0.07, heavyStop: 0.09, killStop: 0.09, // s (real time)
	slowT: 0.3, slowK: 0.4, // the parry: 0.3 s at 0.4 speed
	lowPulse: 1.3, // Hz the low-health edge pulses
};

// ---- the practice fight at the training post (wave 12E): two tier 1 practice raiders with wooden swords, no death
export const PRACTICE = {
	count: 2, tier: 1, spawn: 6, // m from the player
	rackDx: 2.6, rackDz: 0.6, rackRadius: 1.7, // the weapon rack beside the post (E there: "Practice fight")
	yieldHp: 1, // a practice raider yields at this
	leave: 4, // s after the fight before they walk off
	names: [ 'Sparring Sam', 'Sparring Sue' ],
	characters: [ 'bonk', 'doge', 'pengu', 'pepe' ],
};

// in-game hours (the island clock, app.settings.timeOfDay)
export const CLOCK = {
	respawnHours: 24, // a beaten raider is back after one in-game day
	nightFrom: 19, nightTo: 5.5, // more raiders camp at night
	captainRollHour: 6, // each dawn: maybe a captain moves in
	captainChance: 0.35,
	spawnClear: 25, // m: nothing appears or vanishes inside this distance of the player
	realFallback: 24 / 2400, // hours per real second when the clock is stopped (the 40-minute day)
};

// ---- the abandoned camp ---------------------------------------------------------------------------------
// Wave 4: the home island is peaceful (Peace.js), so nobody camps here any more. CAMP / SLOTS stay as the abandoned
// camp's layout (src/features/destruction/Sites.js puts its lean-to, crates and barrels round them) and as a ready slot set
// for tests and sandbox arenas (Melee options.slots). The raiders live at the pirate dens on the outer islands
// (src/features/pirates/Dens.js: guards by day, one more at night, the keeper's tier) and the pirate ships on the shoals.
// The east beach, east of the boathouse (92.5, -57.5) and the boat yard (90..110, -40..-10): dry sand 0.5 - 2 m
// above the sea, 35+ m from every village building, Ethena, Captain Roid and the pier. The camp faces the water.
// `when`: day = camps all day, night = only between nightFrom and nightTo, captain = the occasional named one.

export const CAMP = { x: 127, z: -71, radius: 14 };

export const SLOTS = [
	{ id: 'r1', x: 122, z: - 70, when: 'day', characters: [ 'bonk', 'doge' ] },
	{ id: 'r2', x: 130, z: - 66, when: 'day', characters: [ 'doge', 'pengu' ] },
	{ id: 'r3', x: 118, z: - 77, when: 'night', characters: [ 'pengu', 'pepe' ] },
	{ id: 'r4', x: 136, z: - 73, when: 'night', characters: [ 'pepe', 'clown' ] },
	{ id: 'cap', x: 127, z: - 77, when: 'captain', characters: [ 'heptyle', 'bravile' ] },
];

// the training post on the harbour beach, west of the pier foot (dry sand, clear of the stall, the houses and the spawn):
// a sparring dummy that swings back slowly and never hurts (Dummy.js)
export const TRAINING_POST = { x: 41, z: - 55, yaw: 0, radius: 0.35, reach: 2.3 };

export const RAIDER_NAMES = [
	'Rusty Gil', 'Dredge', 'Knot', 'Sandy Mick', 'Pike', 'Barnacle Bo', 'Slick Ned', 'Tar Joe', 'Gull Eye', 'Kelp',
	'Hooky Sam', 'Bilge', 'Marl', 'Ropey Dan',
];
export const CAPTAIN_NAMES = [ 'Captain Brinewick', 'Captain Saltbeard', 'Captain Gall', 'Captain Drift', 'Captain Stormjaw' ];

// ---- helpers --------------------------------------------------------------------------------------------

export const wrapAngle = ( a ) => Math.atan2( Math.sin( a ), Math.cos( a ) );
export const clamp = ( v, lo, hi ) => ( v < lo ? lo : v > hi ? hi : v );

// the yaw that faces from ( x0, z0 ) toward ( x1, z1 )
export const yawToward = ( x0, z0, x1, z1 ) => Math.atan2( - ( x1 - x0 ), - ( z1 - z0 ) );

// forward as ( x, z ) for a yaw
export const forwardX = ( yaw ) => - Math.sin( yaw );
export const forwardZ = ( yaw ) => - Math.cos( yaw );

// cosine of the angle between a facing yaw and the direction from ( x0, z0 ) to ( x1, z1 ); 1 when on top of it
export function facingDot( yaw, x0, z0, x1, z1 ) {

	const dx = x1 - x0, dz = z1 - z0, d = Math.hypot( dx, dz );
	if ( d < 1e-6 ) return 1;
	return ( forwardX( yaw ) * dx + forwardZ( yaw ) * dz ) / d;

}

export const isNight = ( hour ) => {

	const h = ( ( hour % 24 ) + 24 ) % 24;
	return h >= CLOCK.nightFrom || h < CLOCK.nightTo;

};

// hours moved forward from a to b on a 24 h clock (0 when a === b, never negative)
export const hoursForward = ( a, b ) => ( ( ( b - a ) % 24 ) + 24 ) % 24;

// does the clock pass `mark` going forward from a to b (a < b in clock terms, wrapping at 24)?
export function crossed( a, b, mark ) {

	const d = hoursForward( a, b );
	if ( d <= 0 ) return false;
	return hoursForward( a, mark ) <= d && hoursForward( a, mark ) > 0;

}

// small seeded generator for tests (the runtime uses util/Noise mulberry32 the same way)
export function seeded( seed ) {

	let a = seed >>> 0;
	return () => {

		a = a + 0x6D2B79F5 >>> 0;
		let t = a;
		t = Math.imul( t ^ t >>> 15, t | 1 );
		t ^= t + Math.imul( t ^ t >>> 7, t | 61 );
		return ( ( t ^ t >>> 14 ) >>> 0 ) / 4294967296;

	};

}

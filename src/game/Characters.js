// The playable roster of Hyptile Island: the eight rigged characters from the fishing workspace
// (JadeFisher v03 48-bone rig, converted by tools/roster), each one GLB with the same clip set.
//
// Unlocks: Hyptile is yours from the start; the others are bought from Ethena for island dollars or
// earned by finishing a quest at PoorGoat's (see Contracts.js: a quest's `unlock` names a character).
//
//   CHARACTERS[ id ] = { name, tagline, glb, portrait, height, unlock: { kind: 'start' | 'buy' | 'quest', cost?, quest? } }
//   characterUrl( id ), portraitUrl( id ): with the Vite base path
//   canUnlock( state, id ) / unlockCost( id )

export const CLIPS = {
	idle: 'Idle_Breathe', walk: 'Walk_InPlace', run: 'Run_InPlace', jump: 'Jump', wave: 'Wave',
	cast: 'Fishing_Cast', hold: 'Fishing_Hold', reel: 'Fishing_Reel', strike: 'Fishing_Strike', fight: 'Fishing_Fight', castCharge: 'Fishing_Charge',
	swimIdle: 'Swim_Idle', swim: 'Swim_Forward', swimFast: 'Swim_Fast',
	helm: 'Helm_Idle', seated: 'Seated_Idle', celebrate: 'Catch_Celebrate', disappointed: 'Catch_Disappointed',
	talk: 'Talk', dance: 'Dance', lookAround: 'Look_Around', cheer: 'Cheer_Clap',
	// phase 2: residents, seats and rowing, falls and the prank (tools/roster/build.ps1 clip list)
	friendlyWave: 'Friendly_Wave', beckon: 'Beckon', chat: 'Chat_Gesture', sweep: 'Sweep_Work', inspect: 'Inspect_Catch',
	offer: 'Offer_Finger', prankLaugh: 'Prank_Laugh', tumble: 'Airborne_Tumble', laugh: 'Laugh', shrug: 'Shrug', point: 'Point', swagger: 'Swagger_Idle',
	rowForward: 'Row_Forward', rowBackward: 'Row_Backward', paddleLeft: 'Paddle_Left', paddleRight: 'Paddle_Right',
	sitDown: 'Sit_Down', standUp: 'Stand_Up', steerLeft: 'Steer_Left', steerRight: 'Steer_Right', boardLow: 'Board_Low', disembarkLow: 'Disembark_Low',
	fall: 'Fall_Loop', landSoft: 'Land_Soft', stumble: 'Stumble', knockdown: 'Knockdown', getUp: 'GetUp_Back', getUpFront: 'GetUp_Front', hit: 'Hit_Reaction', swing: 'Melee_Paddle',
	// wave 18E, the animation library (tools/roster/README.md "Animation library"): way of life (Rocketbox mocap; the chair clips sit on
	// a 0.45 m seat at the root, Sit_Chair ends on Sit_Chair_Idle's first frame, Stand_From_Chair starts on it), pose clips baked into
	// the GLBs (Lean_Wall: a wall 0.25 m behind the root; Carry_Box / Crouch_Walk loop with the walk), locomotion and emote takes
	sitChair: 'Sit_Chair', sitChairIdle: 'Sit_Chair_Idle', standFromChair: 'Stand_From_Chair', leanWall: 'Lean_Wall', drink: 'Drink', eat: 'Eat',
	carryBox: 'Carry_Box', kneelWork: 'Kneel_Work', crouch: 'Crouch', talkGroup: 'Talk_Group', clap: 'Clap', pointOut: 'Point_Out', hammer: 'Hammer',
	fishNet: 'Fish_Net', drunkWalk: 'Drunk_Walk', lampLight: 'Lamp_Light', crouchWalk: 'Crouch_Walk', walkTired: 'Walk_Tired',
	turnLeft: 'Turn_Left', turnRight: 'Turn_Right', dance2: 'Dance_2', sitGround: 'Sit_Ground',
	// wave 19D, the combat takes (NVIDIA Kimodo through tools/roster/kimodo-combat; AnimDef montages cutlassSlashR ... taunt; the weapon
	// attacks reach them through src/features/weapons/WeaponPose.js)
	swordSlashR: 'Sword_Slash_R', swordSlashL: 'Sword_Slash_L', swordThrust: 'Sword_Thrust', axeChop: 'Axe_Chop',
	harpoonThrust: 'Harpoon_Thrust', harpoonThrow: 'Harpoon_Throw', throwOverhand: 'Throw_Overhand',
	clubSwing: 'Club_Swing', dodgeRoll: 'Dodge_Roll', taunt: 'Taunt',
};
// the wave 19D combat takes (each in all eight GLBs; test/feature-anim-combat.mjs)
export const COMBAT_CLIPS = [ 'Sword_Slash_R', 'Sword_Slash_L', 'Sword_Thrust', 'Axe_Chop', 'Harpoon_Thrust', 'Harpoon_Throw', 'Throw_Overhand',
	'Club_Swing', 'Dodge_Roll', 'Taunt' ];
// the clips every roster GLB had in phase 1 (tests check these; the phase 2 ones are optional per build)
export const CORE_CLIPS = [ 'Idle_Breathe', 'Walk_InPlace', 'Run_InPlace', 'Jump', 'Wave', 'Fishing_Cast', 'Fishing_Hold', 'Fishing_Reel', 'Fishing_Strike', 'Swim_Idle', 'Swim_Forward', 'Swim_Fast', 'Helm_Idle', 'Seated_Idle', 'Catch_Celebrate', 'Catch_Disappointed', 'Talk', 'Dance', 'Look_Around', 'Cheer_Clap' ];

// reference speeds of the in-place locomotion clips (m/s): the playback rate scales with the real speed (residents, raiders).
// walk / run: the planted foot's speed measured on the GLB (src/player/anim/ClipTools.js strideSpeed, test/feature-anim.mjs):
// walk 1.12 (the Kimodo-derived take; the pelvis-ratio estimate was 0.92), run 2.03 (was 2.17, which slid the feet).
// The player avatar does not use these: its blend space measures every sample itself (src/player/anim/AnimGraph.js).
export const CLIP_SPEED = { walk: 1.1, run: 2.0, swim: 1.0, swimFast: 1.8, carry: 1.1, crouchWalk: 0.67, walkTired: 0.5, drunkWalk: 0.6 }; // (wave 18E takes: strideSpeed on the GLB, test/feature-anim-library.mjs)

export const CHARACTERS = {
	hyptile: { name: 'Hyptile', tagline: 'The island\'s own fisher. Calm hands, long cast.', height: 1.6, unlock: { kind: 'start' } },
	pepe: { name: 'Pepe', tagline: 'Feels good, man. Fishes best at golden hour.', height: 1.6, unlock: { kind: 'buy', cost: 350 } },
	doge: { name: 'Doge', tagline: 'Much reef. Very snapper. Wow.', height: 1.6, unlock: { kind: 'quest', quest: 'reefRun' } },
	bonk: { name: 'BONK', tagline: 'Orange, loud and always first on the pier.', height: 1.6, unlock: { kind: 'buy', cost: 800 } },
	pengu: { name: 'PENGU', tagline: 'Night fisher. Never cold, never late.', height: 1.6, unlock: { kind: 'quest', quest: 'nightShift' } },
	clown: { name: 'The Clown', tagline: 'Plaid trousers, purple shoes, a nose for tarpon.', height: 1.72, unlock: { kind: 'buy', cost: 1500 } },
	bravile: { name: 'Bravile', tagline: 'Hyptile\'s cousin with the golden quiff. Deep-water bold.', height: 1.67, unlock: { kind: 'quest', quest: 'deepWater' } },
	heptyle: { name: 'Heptyle', tagline: 'The strong-jawed cousin. Chases records.', height: 1.67, unlock: { kind: 'quest', quest: 'recordHunter' } },
};

export const CHARACTER_IDS = Object.keys( CHARACTERS );
export const DEFAULT_CHARACTER = 'hyptile';

function base() {

	try {

		return ( import.meta.env && import.meta.env.BASE_URL ) || '/';

	} catch ( e ) {

		return '/';

	}

}

export function characterUrl( id ) {

	return base() + 'models/roster/' + ( CHARACTERS[ id ] ? id : DEFAULT_CHARACTER ) + '.glb';

}

export function portraitUrl( id ) {

	return base() + 'ui/roster/' + ( CHARACTERS[ id ] ? id : DEFAULT_CHARACTER ) + '.png';

}

export function unlockCost( id ) {

	const c = CHARACTERS[ id ];
	return c && c.unlock.kind === 'buy' ? c.unlock.cost : 0;

}

// a one-line account of how a locked character is earned
export function unlockText( id ) {

	const c = CHARACTERS[ id ];
	if ( ! c ) return '';
	const u = c.unlock;
	if ( u.kind === 'start' ) return 'Yours from the start';
	if ( u.kind === 'buy' ) return `Hire for $${ u.cost } at Ethena's`;
	return 'Earned by finishing one of PoorGoat\'s quests';

}

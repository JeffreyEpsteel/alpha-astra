// The residents of Hyptile Island: who stands (or wanders) where, what they do with their hands
// and what they say when you press E. Residents.js builds an Avatar per entry.
//
//   { id, name, character (a Characters.js roster id),
//     spot: { x, z, yaw, deck? }            a fixed place (yaw: faces -Z at 0, like Player.yaw;
//                                           deck: stand on a walkable collider such as the pier)
//     patrol: [ { x, z }, ... ]             or a loop walked node to node (speed m/s, pause s at each)
//     base: clip                            the loop played while idle (default Idle_Breathe)
//     gestures: [ clip, ... ]               the random idle gestures (one-shots, or short loops)
//     lines: [ ... ]                        what they say, in turn
//     prank: true, launch: { x, z }         the clown: second E within PRANK_WINDOW shoves the player
//                                           in `launch` (horizontal, toward the water)
//     scale                                 1 = adult; the kids are smaller
//     face: id                              yaw toward that resident's spot (chatting pairs) }
//
// Heights are not stored: every spot and patrol node is placed on the ground at runtime
// (terrain.heightAt / colliders.groundHeightAt). The coordinates below keep clear of the
// village footprints (Village._layout: cottages, sheds, the stall, the boathouse, the beach
// props) and the two traders (FishStand STAND, Chandlery CHANDLERY).

// clips the rebuilt roster GLBs carry beyond the original Characters.js CLIPS set, and what to
// play instead on a GLB that does not have them yet
export const GESTURE_FALLBACK = {
	Friendly_Wave: 'Wave', Beckon: 'Wave', Chat_Gesture: 'Talk', Sweep_Work: 'Idle_Breathe',
	Inspect_Catch: 'Look_Around', Offer_Finger: 'Wave', Prank_Laugh: 'Cheer_Clap', Laugh: 'Cheer_Clap',
	Shrug: 'Talk', Point: 'Wave', Swagger_Idle: 'Idle_Breathe', Airborne_Tumble: 'Jump',
	Fishing_Hold: 'Idle_Breathe', Fishing_Reel: 'Idle_Breathe', Seated_Idle: 'Idle_Breathe',
	// wave 18E's way-of-life clips (Characters.js), until every roster GLB carries them
	Sit_Chair: 'Sit_Down', Sit_Down: 'Seated_Idle', Sit_Chair_Idle: 'Seated_Idle', Stand_From_Chair: 'Stand_Up', Stand_Up: 'Idle_Breathe',
	Lean_Wall: 'Swagger_Idle', Drink: 'Chat_Gesture', Eat: 'Inspect_Catch', Carry_Box: 'Walk_InPlace', Kneel_Work: 'Crouch',
	Crouch: 'Inspect_Catch', Talk_Group: 'Chat_Gesture', Clap: 'Cheer_Clap', Point_Out: 'Point', Sweep: 'Sweep_Work', Hammer: 'Kneel_Work',
	Fish_Net: 'Kneel_Work', Drunk_Walk: 'Walk_InPlace', Lamp_Light: 'Point',
};

// clips that loop (played for LOOP_GESTURE_S seconds as a gesture); everything else is a one-shot
export const LOOP_CLIPS = new Set( [
	'Idle_Breathe', 'Walk_InPlace', 'Run_InPlace', 'Fishing_Hold', 'Fishing_Reel', 'Swim_Idle', 'Swim_Forward',
	'Swim_Fast', 'Helm_Idle', 'Seated_Idle', 'Talk', 'Dance', 'Look_Around', 'Chat_Gesture', 'Sweep_Work',
	'Airborne_Tumble', 'Laugh', 'Swagger_Idle', 'Fall_Loop',
	'Sit_Chair_Idle', 'Lean_Wall', 'Talk_Group', 'Kneel_Work', 'Crouch', 'Sweep', 'Hammer', 'Fish_Net', 'Carry_Box', 'Drunk_Walk', 'Drink', 'Eat',
] );

export const PATROL_SPEED = 0.6; // m/s
export const PATROL_PAUSE = [ 2.5, 4.5 ]; // s at each node
export const GESTURE_EVERY = [ 6, 14 ]; // s between idle gestures
export const LOOP_GESTURE_S = 4; // s a looping gesture (Chat_Gesture, Laugh, Sweep_Work) runs
export const TALK_S = 4; // s of the talk loop after an interaction
export const LOOK_RADIUS = 8; // m: turn toward the player inside this
export const LOOK_CLAMP = Math.PI / 3; // ±60° from the spot yaw
export const PRANK_WINDOW = 10; // s: the second E that gets you shoved
export const COMMUTE_SPEED = 1.05; // m/s: walking to work, home, the tavern (the schedules)

export const RESIDENTS = [
	{
		id: 'pepeSweeper', name: 'Pepe', character: 'pepe',
		role: 'dockworker', home: 'B',
		patrol: [ { x: 35.3, z: - 111.5 }, { x: 40.5, z: - 108.4 }, { x: 47.0, z: - 110.8 }, { x: 44.5, z: - 115.5 } ],
		gestures: [ 'Sweep_Work', 'Sweep_Work', 'Shrug', 'Friendly_Wave' ],
		lines: [
			'Sand. Every morning, sand. Feels good, man.',
			'The plaza was clean an hour ago. Then the gulls.',
			'Golden hour is the time to cast. Not to sweep.',
			'Ethena pays me in snapper. I am not complaining.',
		],
	},
	{
		id: 'dogePier', name: 'Doge', character: 'doge',
		role: 'fisher', home: 'D',
		spot: { x: 50.0, z: 36.8, yaw: Math.PI, deck: true },
		base: 'Fishing_Hold',
		gestures: [ 'Inspect_Catch', 'Fishing_Reel', 'Shrug', 'Look_Around' ],
		lines: [
			'Much wait. Very patience. Wow.',
			'The snapper sit under the pier head. They know.',
			'Such tide. The fish bite when it turns.',
			'Do not step on my line, friend.',
		],
	},
	{
		id: 'bonkBoathouse', name: 'BONK', character: 'bonk',
		role: 'dockworker', home: 'E',
		patrol: [ { x: 82.0, z: - 50.5 }, { x: 74.0, z: - 50.0 }, { x: 77.0, z: - 49.0 } ],
		base: 'Swagger_Idle',
		gestures: [ 'Swagger_Idle', 'Point', 'Friendly_Wave', 'Cheer_Clap' ],
		lines: [
			'First on the pier. Every day. Nobody beats BONK.',
			'That boathouse? Mine, one day. The boat too.',
			'You want a race to the reef? I will wait for you there.',
			'Loud? I am not loud. The sea is quiet.',
		],
	},
	{
		id: 'penguBeach', name: 'PENGU', character: 'pengu',
		role: 'fisher', home: 'F', schedule: 'nightFisher',
		patrol: [ { x: 12.0, z: - 50.0 }, { x: 24.0, z: - 49.0 }, { x: 30.0, z: - 52.5 } ],
		gestures: [ 'Look_Around', 'Point', 'Shrug', 'Look_Around' ],
		lines: [
			'Night is the time. The water goes glass and the big ones come in.',
			'Cold? This is a warm island. I was built for worse.',
			'Watch the swell line out there. Something turned under it.',
			'Never late. The fish are the ones who keep me waiting.',
		],
	},
	{
		id: 'bravileChat', name: 'Bravile', character: 'bravile',
		role: 'tavern', home: 'G',
		spot: { x: 68.4, z: - 100.6, yaw: 0 }, face: 'heptyleChat',
		base: 'Chat_Gesture',
		gestures: [ 'Shrug', 'Point', 'Laugh', 'Chat_Gesture' ],
		lines: [
			'Deep water, that is where the stories are. Heptyle only chases numbers.',
			'My cousin thinks a record is a fish. A record is a story.',
			'Take the boat past the reef some time. Past it. You will see.',
			'The quiff? It is the wind. Always the wind.',
		],
	},
	{
		id: 'heptyleChat', name: 'Heptyle', character: 'heptyle',
		role: 'tavern', home: 'G',
		spot: { x: 70.2, z: - 101.6, yaw: 0 }, face: 'bravileChat',
		base: 'Chat_Gesture',
		gestures: [ 'Point', 'Shrug', 'Laugh', 'Chat_Gesture' ],
		lines: [
			'Eleven kilos. The tarpon. Bravile will tell you it was nine.',
			'Records are kept at PoorGoat\'s. Ask him who holds the most.',
			'Strong jaw, strong line. That is the whole secret.',
			'He talks about deep water. I fish it.',
		],
	},
	{
		id: 'clownCabin', name: 'The Clown', character: 'clown',
		role: 'smuggler', home: 'I', schedule: 'prankster',
		// on the sand between the pier foot and the sea-blue stilt hut S1 (67.8, -64.6), facing the
		// pier; the water (z ≈ -43) is 7 m down the slope behind whoever stands in front of him
		spot: { x: 59.5, z: - 49.5, yaw: Math.PI / 2 },
		base: 'Swagger_Idle',
		gestures: [ 'Beckon', 'Laugh', 'Offer_Finger', 'Swagger_Idle' ],
		lines: [
			'Hey, come closer, I have something for you.',
			'Plaid trousers, purple shoes, and a nose for tarpon. And for suckers.',
			'The cabin is not mine. Nothing is mine. Everything is funny.',
			'Worth it. Every time.',
		],
		prank: true, launch: { x: 0.2, z: 1 },
	},
	{
		id: 'kidHyp', name: 'Lil\' Hyp', character: 'hyptile', scale: 0.72,
		role: 'child', home: 'L',
		patrol: [ { x: 8.0, z: - 121.0 }, { x: 12.0, z: - 118.0 }, { x: 4.0, z: - 115.5 } ],
		gestures: [ 'Cheer_Clap', 'Point', 'Dance', 'Friendly_Wave' ],
		lines: [
			'When I am big I will cast past the reef. Past the whale!',
			'The clown shoved Tiny in the sea. It was so funny.',
			'Did you see a shark? I saw a shark. It was a log.',
			'Race you to the pier!',
		],
	},
	{
		id: 'kidHyp2', name: 'Tiny Hyp', character: 'hyptile', scale: 0.62,
		role: 'child', home: 'L',
		spot: { x: 24.0, z: - 143.0, yaw: Math.PI },
		gestures: [ 'Dance', 'Friendly_Wave', 'Look_Around', 'Cheer_Clap' ],
		lines: [
			'I can see the whole bay from up here. And your boat. It is small.',
			'Do not talk to the clown. Do NOT.',
			'Gran says the tide is a clock. I think it is a slide.',
			'I danced for the gulls. They did not care.',
		],
	},
	{
		id: 'oldPepe', name: 'Old Pepe', character: 'pepe',
		role: 'tavern', home: 'K',
		spot: { x: 47.0, z: - 147.0, yaw: 2.4 },
		gestures: [ 'Look_Around', 'Point', 'Shrug', 'Wave' ],
		lines: [
			'Swell from the south-west. Rain by dark, mark me.',
			'I built cottage L. Twice. The first one the wind took.',
			'The reef was twice this size when I was young. So was I.',
			'Fish the morning. The afternoon is for sitting here.',
		],
	},
];

// ------------------------------------------------------------------ harbour life (v3, WP-E)
// The harbour feature (src/features/harbour) gives everyone a day: role (harbour/Roles.js: fisher, merchant,
// dockworker, tavern, child, smuggler, guard), home (a cottage of HOMES: indoors at night), schedule (a named
// schedule of Roles.js SCHEDULES instead of the role's own), work (loop stations walked during work hours;
// residents with a spot or a patrol work there instead), service ('tavern' | 'crafting' | 'trade': E on them
// opens it), dice (offers the no-wager dice round), port (default 'home').

// the cottages of Village._layout (centre, yaw, depth, porch depth, door offset): the door is on the local
// +z face; HOMES[ id ].door is the point in front of it (at the foot of the porch steps)
const COTTAGES = {
	A: [ 13.5, - 106.5, 0.12, 5.0, 2.1 ], B: [ 26.5, - 112.0, - 0.08, 4.5, 0 ], C: [ 62.5, - 106.0, - 0.1, 5.8, 2.2 ],
	D: [ 79.0, - 110.5, - 0.18, 5.0, 1.9, - 0.6 ], E: [ 96.0, - 115.5, - 0.3, 4.6, 0 ], F: [ - 3.0, - 125.0, 0.22, 5.0, 1.9 ],
	G: [ 16.5, - 130.0, 0.1, 5.6, 2.2 ], H: [ 57.5, - 128.5, - 0.05, 5.2, 2.0 ], I: [ 75.5, - 132.5, - 0.2, 4.6, 0 ],
	J: [ 96.5, - 135.0, - 0.32, 5.0, 1.9 ], K: [ 3.5, - 151.0, 0.18, 5.2, 2.0 ], L: [ 30.5, - 149.0, 0.04, 5.6, 2.3 ],
	M: [ 55.0, - 152.5, - 0.06, 4.8, 0 ], N: [ 78.5, - 156.0, - 0.22, 5.0, 1.9 ],
};

export function doorOf( x, z, yaw, d, porch = 0, doorX = 0 ) {

	const lz = d / 2 + porch + 0.8, c = Math.cos( yaw ), s = Math.sin( yaw );
	return { x: x + doorX * c + lz * s, z: z - doorX * s + lz * c, yaw: yaw + Math.PI };

}

export const HOMES = {};
for ( const [ id, [ x, z, yaw, d, porch, doorX ] ] of Object.entries( COTTAGES ) ) HOMES[ id ] = { id, x, z, door: doorOf( x, z, yaw, d, porch, doorX || 0 ) };

// the home harbour's shared places: the tavern (cottage C, "The Upturned Keel"), its patio, the plaza where
// people eat, the harbour mouth the smugglers watch, and the workshop bench by the boathouse (crafting)
export const TAVERN_HOME = { id: 'home', name: 'The Upturned Keel', building: 'C', door: HOMES.C.door, x: HOMES.C.door.x, z: HOMES.C.door.z };
export const PLACES = {
	patio: [ { x: 57.6, z: - 95.8 }, { x: 60.6, z: - 95.2 }, { x: 64.2, z: - 95.2 }, { x: 66.8, z: - 96.8 } ],
	plaza: [ { x: 35.5, z: - 104.5 }, { x: 47.5, z: - 104.0 }, { x: 45.0, z: - 118.0 }, { x: 34.0, z: - 117.0 }, { x: 38.5, z: - 106.5 }, { x: 46.5, z: - 109.8 } ],
	mouth: [ { x: 106.0, z: - 63.0 }, { x: 110.0, z: - 61.5 } ],
	workshop: { x: 86.6, z: - 51.4, yaw: 2.2 },
};

const PI = Math.PI;
// the home harbour's working folk (the naval fork's names: story/StoryData.js NPCS matches them by id)
export const HARBOUR_FOLK = [
	{
		id: 'fin', name: 'Fin', character: 'hyptile', scale: 1.04, role: 'fisher', home: 'H',
		spot: { x: 53.5, z: - 70.5, yaw: 0 },
		work: [
			{ x: 56.0, z: - 14.0, yaw: - PI / 2, base: 'Fishing_Hold', gestures: [ 'Fishing_Reel', 'Inspect_Catch' ], dwell: 60 },
			{ x: 56.0, z: 4.0, yaw: - PI / 2, base: 'Fishing_Hold', gestures: [ 'Fishing_Reel', 'Look_Around' ], dwell: 60 },
			{ x: 53.5, z: - 70.5, yaw: 0.9, base: 'Idle_Breathe', gestures: [ 'Inspect_Catch', 'Talk' ], dwell: 10, makes: 'bait' },
		],
		gestures: [ 'Inspect_Catch', 'Shrug', 'Look_Around' ],
		lines: [
			'Up before the gulls. Line in the water before the sun.',
			'PoorGoat buys the snapper. The little ones I cut for bait.',
			'Bran sells my bait at the boathouse bench. Ask him.',
			'Tide turns at the pier head. That is when they bite.',
		],
	},
	{
		id: 'mara', name: 'Mara', character: 'pengu', scale: 0.96, role: 'merchant', home: 'J', service: 'trade',
		spot: { x: 59.6, z: - 75.4, yaw: 1.69 },
		work: [
			{ x: 59.6, z: - 75.4, yaw: 1.69, base: 'Talk', gestures: [ 'Point', 'Shrug', 'Inspect_Catch' ], dwell: 45 },
			{ x: 61.5, z: - 80.5, yaw: 2.6, base: 'Idle_Breathe', gestures: [ 'Inspect_Catch' ], dwell: 12, makes: 'coin' },
		],
		gestures: [ 'Point', 'Shrug', 'Chat_Gesture' ],
		lines: [
			'Rope and rum go out, timber and spice come in. Simple.',
			'Buy low here, sell dear at Pons. Everyone knows. Few do it.',
			'Prices move when you trade. Do not empty my stall in one go.',
			'Ice melts in a hold. Sell it first.',
		],
	},
	{
		id: 'bran', name: 'Bran', character: 'heptyle', scale: 1.02, role: 'dockworker', home: 'N', service: 'crafting',
		spot: { x: 88.6, z: - 53.6, yaw: 1.0 },
		work: [
			{ x: 88.6, z: - 53.6, yaw: 1.0, base: 'Idle_Breathe', gestures: [ 'Inspect_Catch', 'Sweep_Work', 'Shrug' ], dwell: 45, makes: 'rope', work: true },
			{ x: 66.5, z: - 53.0, yaw: 2.4, base: 'Idle_Breathe', gestures: [ 'Inspect_Catch', 'Sweep_Work' ], dwell: 25, work: true },
		],
		gestures: [ 'Inspect_Catch', 'Shrug', 'Point' ],
		lines: [
			'Bring me fish and goods, I will make you bait, lures and patch kits.',
			'A patch kit in the locker has saved more boats than prayers.',
			'Coconut husk makes fair rope. Pons has the coconuts.',
			'That hull of yours sings when it is hurt. Listen to it.',
		],
	},
	{
		id: 'rook', name: 'Rook', character: 'bonk', scale: 1.06, role: 'guard', home: 'M',
		spot: { x: 45.0, z: - 66.0, yaw: PI },
		work: [
			{ x: 45.0, z: - 66.0, base: 'Idle_Breathe', gestures: [ 'Look_Around' ], dwell: 6 },
			{ x: 60.0, z: - 58.0, base: 'Idle_Breathe', gestures: [ 'Look_Around', 'Point' ], dwell: 6 },
			{ x: 78.0, z: - 60.0, base: 'Idle_Breathe', gestures: [ 'Look_Around' ], dwell: 8 },
			{ x: 62.0, z: - 88.0, base: 'Idle_Breathe', gestures: [ 'Look_Around' ], dwell: 6 },
			{ x: 45.0, z: - 90.0, base: 'Idle_Breathe', gestures: [ 'Look_Around', 'Shrug' ], dwell: 6 },
		],
		gestures: [ 'Look_Around', 'Point' ],
		lines: [
			'Harbour watch. Keep your cannons cold inside the moorings.',
			'Black sails off the reef last week. Keep your eyes open.',
			'The clown? Not a crime. Yet.',
			'Quiet night, quiet harbour. That is how I like it.',
		],
	},
	{
		id: 'nell', name: 'Nell', character: 'pepe', scale: 0.95, role: 'tavern', schedule: 'innkeeper', home: 'C', service: 'tavern', dice: true,
		spot: { x: 61.2, z: - 98.4, yaw: PI - 0.1 },
		work: [
			{ x: 61.2, z: - 98.4, yaw: PI - 0.1, base: 'Idle_Breathe', gestures: [ 'Chat_Gesture', 'Laugh', 'Point' ], dwell: 40 },
			{ x: 57.6, z: - 97.2, base: 'Sweep_Work', gestures: [ 'Sweep_Work', 'Shrug' ], dwell: 14, work: true },
			{ x: 65.6, z: - 97.4, base: 'Sweep_Work', gestures: [ 'Sweep_Work', 'Look_Around' ], dwell: 14, work: true },
		],
		gestures: [ 'Chat_Gesture', 'Laugh', 'Point' ],
		lines: [
			'Welcome to the Upturned Keel. Stew is hot, dice are free.',
			'Sit, eat. A full belly casts straighter.',
			'Rumours cost a drink. The good ones cost two.',
			'No wagers at my table. We roll for the joy of it.',
		],
	},
	{
		id: 'silt', name: 'Silt', character: 'bravile', scale: 0.98, role: 'smuggler', home: 'A',
		spot: { x: 106.0, z: - 63.0, yaw: PI },
		work: [
			{ x: 106.0, z: - 63.0, yaw: PI, base: 'Idle_Breathe', gestures: [ 'Look_Around', 'Shrug' ], dwell: 50 },
			{ x: 110.0, z: - 61.5, yaw: PI * 0.8, base: 'Idle_Breathe', gestures: [ 'Look_Around', 'Point' ], dwell: 40 },
		],
		gestures: [ 'Shrug', 'Look_Around', 'Swagger_Idle' ],
		lines: [
			'Nice night for it. For what? For nothing. Move along.',
			'Customs counts crates. Nobody counts pockets.',
			'I watch the harbour mouth. Someone has to.',
			'You did not see me. I did not see you. Good.',
		],
	},
];

// the named people of the other ports; their spots are found on land near the port's stand at runtime
export const PORT_FOLK = [
	{
		id: 'tavi', name: 'Tavi', port: 'pons', character: 'doge', scale: 0.97, role: 'tavern', schedule: 'innkeeper', service: 'tavern', dice: true,
		near: [ 5, 11 ], base: 'Idle_Breathe', gestures: [ 'Chat_Gesture', 'Laugh', 'Friendly_Wave' ],
		lines: [
			'Pons pours the best rum on the water. Ask anyone. Ask me.',
			'Sit. Roll the dice with me. Nothing on it but pride.',
			'The minnows run under the dock at dawn, the old folk say.',
			'Sailors talk when they drink. I listen.',
		],
	},
	{
		id: 'iona', name: 'Iona', port: 'pons', character: 'heptyle', scale: 0.95, role: 'merchant',
		near: [ 7, 14 ], base: 'Talk', gestures: [ 'Point', 'Inspect_Catch', 'Shrug' ],
		lines: [
			'Timber and pearls leave Pons cheap. Home pays well for both.',
			'A broker hears every price. Today I hear rope is dear.',
			'Bring me spices from the traders and I will remember you.',
			'Coin talks. Mostly it says "more".',
		],
	},
	{
		id: 'pip', name: 'Pip', port: 'pons', character: 'hyptile', scale: 0.8, role: 'tavern',
		near: [ 6, 13 ], base: 'Chat_Gesture', gestures: [ 'Laugh', 'Point', 'Chat_Gesture' ],
		lines: [
			'Once a ship sailed upside down past the Inverted Isles. True story.',
			'I tell stories for a coin. This one was free.',
			'The lighthouse keeper on Gull Rock never sleeps. Never!',
			'Ask me about the eel that swims on its back.',
		],
	},
];

// people of any port beyond the named ones (population by port size): names and short lines per role
export const FOLK_NAMES = [ 'Ada', 'Baz', 'Cora', 'Dov', 'Edda', 'Fen', 'Gil', 'Hana', 'Ivo', 'Juno', 'Kai', 'Lio', 'Moss', 'Nia', 'Oki', 'Pell', 'Quill', 'Rue', 'Sami', 'Tam', 'Uma', 'Vik', 'Wren', 'Yara' ];
export const FOLK_CHARACTERS = [ 'hyptile', 'pepe', 'doge', 'bonk', 'pengu', 'bravile', 'heptyle' ];
export const ROLE_LINES = {
	fisher: [ 'Good water today. Or bad. Ask me after.', 'Mending nets is half of fishing.', 'Dawn and dusk. The rest is waiting.' ],
	merchant: [ 'Everything has a price. Even this advice.', 'Carry what the other port lacks.', 'Buy, sail, sell. Repeat.' ],
	dockworker: [ 'Crates do not carry themselves.', 'Tar, rope, planks. Every day.', 'Mind the lines on the dock.' ],
	tavern: [ 'Evening is for stories.', 'One more round, then home.', 'Heard the reef is busy this week.' ],
	child: [ 'Race you to the water!', 'I found a shell shaped like a boat.', 'Mum says do not talk to sailors. Oops.' ],
	smuggler: [ 'Nothing to see here.', 'Keep walking, friend.', 'Night is the honest time.' ],
	guard: [ 'Keep the peace and we will get along.', 'Watch the harbour mouth at night.', 'All quiet. For now.' ],
};

// yaw (faces -Z at 0) that looks from (ax, az) toward (bx, bz)
export function yawToward( ax, az, bx, bz ) {

	return Math.atan2( - ( bx - ax ), - ( bz - az ) );

}

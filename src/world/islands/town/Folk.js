import { SPOTS, FACE, at } from './Layout.js';
import { NAVY_JETTY } from '../../../features/naval/Routes.js';

// Tidemark's named residents (the harbour feature's PORT_FOLK format, world/residents/ResidentData.js): the tavern keeper
// of the Tide & Tankard (service 'tavern', the dice), the harbourmaster, a net-mender and the boatwright. The harbour
// feature fills the port up to its population (WORLD.ports tidemark size 2: nine) with generated fishers, dockworkers, a
// child, a merchant, a guard and a smuggler, every one on a role schedule. `at` is each one's own spot in the town (the
// harbour feature places PORT_FOLK by `near` rings round the stand; with the one-line patch in the report it uses `at`).
//
//   TIDEMARK_FOLK            the entries (port 'tidemark')
//   registerTidemarkFolk( PORT_FOLK )   adds them once (idempotent); Ports calls it so the harbour feature finds them

// the yaw (Player.yaw: -Z at 0) that looks from island (u, v) toward (tu, tv)
const look = ( u, v, tu, tv ) => {

	const a = at( u, v ), b = at( tu, tv );
	return Math.atan2( - ( b.x - a.x ), - ( b.z - a.z ) );

};

export const TIDEMARK_FOLK = [
	{
		id: 'brine', name: 'Brine', port: 'tidemark', character: 'doge', scale: 1.0, role: 'tavern', schedule: 'innkeeper', service: 'tavern', dice: true,
		near: [ 40, 48 ], at: { x: SPOTS.keeper.x, z: SPOTS.keeper.z }, base: 'Idle_Breathe', gestures: [ 'Chat_Gesture', 'Laugh', 'Friendly_Wave' ],
		lines: [
			'The Tide & Tankard: the only roof east of the Key that does not leak. Mostly.',
			'Sit. Dice? Nothing on it but pride.',
			'Planes land behind the chapel now. The goats have not forgiven them.',
			'Pirates raid the outer bay when the moon is dark. Keep your lamps lit.',
		],
	},
	{
		id: 'osric', name: 'Osric', port: 'tidemark', character: 'heptyle', scale: 0.98, role: 'merchant',
		near: [ 30, 38 ], at: at( - 147, 22 ), base: 'Talk', gestures: [ 'Point', 'Inspect_Catch', 'Shrug' ],
		lines: [
			'Harbourmaster. Moor at the pier head, not on my wharf.',
			'Timber goes out, rope comes in. That is Tidemark.',
			'Mind the berth: three fathoms at the head, nothing under the wharf.',
		],
	},
	{
		id: 'wenna', name: 'Wenna', port: 'tidemark', character: 'pengu', scale: 0.92, role: 'fisher',
		near: [ 16, 24 ], at: at( - 136, - 24 ), base: 'Idle_Breathe', gestures: [ 'Inspect_Catch', 'Fishing_Reel', 'Shrug' ],
		// wave 18B: mending nets at the quay's edge, then sorting the catch by her door (clips through GESTURE_FALLBACK)
		work: [
			{ ...at( - 153, - 25 ), yaw: FACE + Math.PI, base: 'Fish_Net', gestures: [ 'Inspect_Catch', 'Look_Around' ], dwell: 70 },
			{ ...at( - 136, - 24 ), yaw: FACE, base: 'Idle_Breathe', gestures: [ 'Inspect_Catch', 'Shrug' ], dwell: 20, makes: 'bait' },
		],
		lines: [
			'Nets do not mend themselves. Neither do fishermen.',
			'Reef fish sell best here. Hana pays a fifth over.',
			'The stream runs clear after rain. The mullet like it.',
		],
	},
	{
		id: 'tobiah', name: 'Tobiah', port: 'tidemark', character: 'hyptile', scale: 0.96, role: 'dockworker',
		near: [ 12, 20 ], at: at( - 134, - 98 ), base: 'Idle_Breathe', gestures: [ 'Sweep_Work', 'Inspect_Catch' ],
		// wave 18B: at the hull in the shed with a hammer, then planing at the slip
		work: [
			{ ...at( - 134, - 95.5 ), yaw: look( - 134, - 95.5, - 134, - 102 ), base: 'Hammer', gestures: [ 'Inspect_Catch', 'Shrug' ], dwell: 50, work: true },
			{ ...at( - 129.5, - 109 ), yaw: look( - 129.5, - 109, - 136, - 109 ), base: 'Kneel_Work', gestures: [ 'Inspect_Catch' ], dwell: 30, work: true },
		],
		lines: [
			'Boatwright. That hull in the shed will float by spring.',
			'Who broke my shed doors? Again?',
			'Oak for the keel, palm for nothing.',
		],
	},
	{
		// Lieutenant Hale (the story's navy lieutenant, StoryW20 HALE_SPOT: a few steps along the naval jetty from the
		// office door); the watch's schedule keeps a resident with a spot of his own on it through the working hours.
		// His quest talk comes through the story (Game.updateResidents: story.talkTo first); these lines are for when
		// the Crown has no work
		id: 'hale', name: 'Lieutenant Hale', port: 'tidemark', character: 'pengu', scale: 1.0, role: 'guard',
		near: [ 40, 48 ], at: { x: Math.round( ( NAVY_JETTY.office.x + 6 ) * 100 ) / 100, z: Math.round( ( NAVY_JETTY.z + 1.2 ) * 100 ) / 100, deck: true },
		base: 'Idle_Breathe', gestures: [ 'Point', 'Look_Around', 'Shrug' ],
		lines: [
			'Two cutters and a frigate for a whole sea. We manage.',
			'Convoys run the lanes at dawn. The raiders know it too.',
			'Bounties are paid at the office. Bring proof, not stories.',
			'Keep your lamps lit past the roads. The frigate will find you faster.',
		],
	},
];

export function registerTidemarkFolk( list ) {

	if ( ! Array.isArray( list ) ) return 0;
	let n = 0;
	for ( const d of TIDEMARK_FOLK ) if ( ! list.some( ( q ) => q.id === d.id ) ) {

		list.push( d );
		n ++;

	}

	return n;

}

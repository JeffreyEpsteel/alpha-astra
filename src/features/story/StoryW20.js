import { WORLD } from '../../world/WorldLayout.js';
import { SPOTS as TOWN_SPOTS, at as townAt } from '../../world/islands/town/Layout.js';
import { strongholdLayout } from '../../world/islands/stronghold/Layout.js';
import { NAVY_JETTY } from '../naval/Routes.js';

// Wave 20C: a quest line per wave 19 system, voiced by the people already there (pure data plus the small runtime hooks Story
// calls; StoryData merges the chains, people and items into CHAINS / NPCS / ITEMS):
//
//   kingsWater      Lieutenant Hale at the naval jetty (the navy): save a convoy under attack (start: 'convoy' asks the navy's sea
//                   events for one), sink a named pirate, fly his dispatches to Hyptile Harbour and hand them to Orla, then the
//                   court-martial: hand the deserter Tom Garrow over (navy standing up, notoriety down) or say he slipped away
//                   (navy standing down, notoriety and corsair standing up, Garrow signs on with you). Follow-up: convoyDuty
//                   (only for a captain who handed him over; the board posts it).
//   diceNight       Brine of the Tide & Tankard (harbour, interiors, crew): a hand of yours (start: 'missing' sends one off: crew
//                   life's absent) went to Blackwater's Rum Hole with the dice winners; the back-table brawl inside the tavern (start:
//                   'brawl': melee's practice fight, armed when you walk in); a storm-night run of his casks past the cutters to
//                   Pons (a navy boarding pours them away: back to the storm step). Follow-up: stormRun (repeats).
//   wrensPast       Wren Calloway, a sailor for hire on the tavern porch (crew life): signs on free (start: 'hireWren'), the wreck of
//                   her cutter off Gull Rock, one storm with her aboard; she comes home brave and no longer seasick (her sailing cap
//                   goes from 60 to 100: reward.crewTrait).
//   chasingTheLine  Old Pepe, the weather prophet (storm fronts): meet a front at sea, ride its squall, fly within 400 m of its
//                   lightning (or see a waterspout up close). Follow-up: frontLine (repeats).
//
// New step / chain keys (Story.js runs them): step.choices [ { id, label, said, effect: { navy, heat: [ heat, corsair ] } } ] on a
// talk step (the player picks one: progress.path), step.dwell s (a check must hold that long), step.start 'convoy' | 'missing' |
// 'brawl' | 'hireWren', step text {who}; chain.thanksBy / reward.paths { path: { ...reward } } (added to the reward),
// fail.then 'retry' + fail.from (back to that step), gate { path: [ chain, option ] }; reward.crewTrait { id, remove, add,
// skills }, reward.sailor (a hand signs on free), reward.navy n (standing), reward.heat [ heat, corsair ] (pirates' notoriety).

const r2 = ( v ) => Math.round( v * 100 ) / 100;
const ISLAND = ( id ) => { const i = WORLD.islands.find( ( x ) => x.id === id ); return i ? { x: i.center.x, z: i.center.z, r: i.radius } : null; };
const GULL = ISLAND( 'gull' ) || { x: - 560, z: 200, r: 120 };
const PORT = ( id ) => WORLD.ports.find( ( p ) => p.id === id ) || null;
const standOf = ( id, d ) => { const p = PORT( id ); return p && p.stand ? { x: p.stand.x, z: p.stand.z } : d; };
const HOME_STAND = standOf( 'home', { x: 50, z: - 75 } );
const PONS_STAND = standOf( 'pons', { x: 620, z: 560 } );
const TM = WORLD.tidemark || { center: { x: 1720, z: - 60 }, dock: { position: { x: 1924, z: 21 } } };
const TM_PIER = { x: TM.dock.position.x, z: TM.dock.position.z };
const ABOARD = [ 'boat', 'deck', 'seat' ];

// on the naval jetty, a few steps along from the navy office's door (the office keeps its own E prompt)
export const HALE_SPOT = { x: r2( NAVY_JETTY.office.x + 6 ), y: NAVY_JETTY.deck, z: r2( NAVY_JETTY.z + 1.2 ) };
// on the Tide & Tankard's porch, beside Brine's spot by the steps
export const WREN_SPOT = townAt( - 126.6, 33.4 );
// where the cutter Merlin went down: open water south of Gull Rock (test/feature-quests-w20.mjs checks the depth)
export const WRECK = { x: GULL.x + 140, z: GULL.z + 330, r: 130 };
// Blackwater's black market (the Rum Hole's street): the fence's counter
export function rumSpot() {

	const L = strongholdLayout(), bm = L.town.find( ( b ) => b.kind === 'market' );
	return bm ? { x: r2( bm.x ), z: r2( bm.z ) } : { x: L.center.x, z: L.center.z };

}

// the tavern hands the story signs on (Crew.hire records: saved with the crew's sailors, so their traits survive a save)
export const WREN = { id: 'story-wren', name: 'Wren Calloway', look: 'bravile', port: 'tidemark', traits: [ 'seasick', 'sharpEyed' ], skills: { gunnery: 10, angling: 5, sailing: 35, repair: 10 }, wage: 9, watch: 'day', price: 0 };
export const GARROW = { id: 'story-garrow', name: 'Tom Garrow', look: 'bonk', port: 'tidemark', traits: [ 'brave' ], skills: { gunnery: 40, angling: 5, sailing: 10, repair: 15 }, wage: 10, watch: 'day', price: 0 };
export const POT_BOY = 'Dov, Brine\'s pot boy'; // who is missing when you have no hands of your own
export const BRAWL = { reach: 14, retry: 20 }; // m from Brine's spot without interiors; s before a lost brawl can start again
export const CONVOY_RETRY = 45; // s between the convoy step's asks while the sea has none

export const W20_NPCS = {
	hale: { name: 'Lieutenant Hale', role: 'Navy lieutenant, the naval jetty', port: 'tidemark', at: 'spot', spot: () => HALE_SPOT, pin: () => HALE_SPOT },
	wren: { name: 'Wren Calloway', role: 'Sailor for hire, the Tide & Tankard', port: 'tidemark', at: 'spot', spot: () => WREN_SPOT, pin: () => WREN_SPOT,
		hidden: ( story ) => crewHas( story, WREN.id ) }, // aboard with you: no longer on the porch
};

export const W20_ITEMS = {
	haleCommendation: { name: 'Hale\'s commendation', text: 'A lieutenant\'s letter: the naval jetty\'s chandler knocks a tenth off for you.', perk: { 'off:navy': 0.1 } },
	garrowsKnife: { name: 'Garrow\'s clasp knife', text: 'A deserter\'s thanks. The brotherhood knows the knife.', perk: {} },
	tankardTab: { name: 'A tab at the Tide & Tankard', text: 'Brine\'s thanks: a quarter off at his bar, and your hands\' bar tabs are on the house.', perk: { 'off:tavern:tidemark': 0.25, 'off:tab': 1 } },
	stormGlass: { name: 'Old Pepe\'s storm glass', text: 'When the crystals cloud, a front is coming. The weather bothers you a little less.', perk: { weatherCalm: 0.05 } },
};

// ---------------------------------------------------------------- tests on events and the world (ctx: Story._evCtx / _checkCtx)

const feat = ( c, name ) => ( c && c.features && c.features.get ? c.features.get( name ) : null );
const mode = ( c ) => ( c && c.player ? c.player.mode : null );
const atSea = ( c ) => { const m = mode( c ); return m === 'plane' || ABOARD.includes( m ); };
const weatherOf = ( c ) => feat( c, 'weather' );
const stormy = ( c ) => {

	const w = weatherOf( c );
	if ( ! w ) return false;
	const local = w.local || {};
	return [ 'rain', 'storm' ].includes( w.kind ) || !! local.under || ( local.squall || 0 ) > 0.2;

};
const crewOf = ( c ) => { const f = feat( c, 'crew' ); return f && f.crew ? f.crew : null; };
export function crewHas( story, id ) {

	const cr = crewOf( story );
	return !! ( cr && cr.sailors && cr.sailors.has && cr.sailors.has( id ) );

}
// with you: signed on, not walked off, not asleep under a tavern table
const withYou = ( c, id ) => { const cr = crewOf( c ); return !! ( cr && cr.sailors && cr.sailors.has( id ) && ( ! cr.present || cr.present( id ) ) ); };
const near = ( c, q, r ) => !! ( c && c.player && q && Math.hypot( c.player.x - q.x, c.player.z - q.z ) <= r );

const named = ( e, c ) => ( c.event === 'captainKilled' ? e.by === 'player' : true ); // a bounty claimed is a named captain brought to book
const planeStrike = ( e, c ) => mode( c ) === 'plane' && Number.isFinite( e.distanceKm ) && e.distanceKm <= 0.4;
const spoutSeen = ( c ) => { const w = weatherOf( c ), s = w && w.spout; return !! ( s && s.life > 0.05 && atSea( c ) && near( c, s, 500 ) ); };
const squallRide = ( c ) => { const w = weatherOf( c ); return !! ( w && w.local && ( w.local.squall || 0 ) >= 0.3 && atSea( c ) ); };
const stormNightOut = ( c ) => ABOARD.includes( mode( c ) ) && !! c.story && c.story.night() && stormy( c ) && near( c, TM_PIER, 1400 );
const missingFound = ( e, c ) => {

	const p = c.story && c.story.progress.diceNight, who = p && p.v ? p.v.who : null;
	if ( c.event === 'crewFetched' ) return !! who && e.id === who;
	return e.id === 'blackwater.rumhole';

};

const talk = ( npc, text, say, response = null ) => ( { id: 'talk', text, talk: npc, say, response } );

// ---------------------------------------------------------------- the chains

export const W20_CHAINS = {

	kingsWater: {
		title: 'Navy business', giver: 'hale', port: 'tidemark', region: 'tidemark', requires: [ { feature: 'navy' }, { discovered: 'tidemark' } ],
		offer: 'Two cutters and a frigate for a whole sea. I need a captain who can hold a convoy together, sink a named raider and fly my dispatches to the home harbour. Do that and the fleet will know your name.',
		accept: 'Convoy, raider, dispatches.',
		accepted: 'Convoys get jumped past the lanes. When you see one under attack, go in: raiders run from a hull that means it.',
		remind: 'A convoy saved, a named raider sunk, my dispatches in Orla\'s hands. Then back here.',
		thanks: 'Done, and done well.',
		thanksBy: {
			hand: 'Garrow will face the court. It is the law, and you kept it. The fleet owes you; I have written it down.',
			free: 'Slipped away, you say. In the night. I shall write that the sea took him. Do not make me write it twice.',
		},
		steps: [
			{ id: 'convoy', text: 'Save a merchant convoy under attack at sea (hit her raiders, or be close when they are beaten)', on: 'convoySaved', match: { is: { helped: true } }, start: 'convoy',
				pin: ( story ) => { const p = story && story.progress.kingsWater, v = p && p.v; return v && Number.isFinite( v.cx ) ? { x: v.cx, z: v.cz, label: 'Convoy under attack' } : null; } },
			{ id: 'hunt', text: 'Sink a named pirate captain (a roster captain, or a wanted notice)', on: [ 'captainKilled', 'bountyClaimed' ], match: { test: named } },
			{ id: 'fly', text: 'Fly the dispatches to Hyptile Harbour: land a seaplane in the home bay', on: 'planeLanded', match: { near: { ...HOME_STAND, r: 650 } }, pin: { ...HOME_STAND, label: 'Hyptile Harbour' } },
			talk( 'orla', 'Hand the dispatches to Harbourmaster Orla', 'Navy dispatches, by air? Hale is in a hurry. And one of his men jumped ship here: Tom Garrow. He is in my boathouse, begging not to go back. I will not decide it for you.', 'Dispatches, from Lieutenant Hale.' ),
			{ id: 'court', text: 'Decide Tom Garrow\'s fate with Lieutenant Hale', talk: 'hale', say: 'Orla\'s seal. Good. And Garrow? Somebody saw him on your island. Tell me straight, captain.',
				choices: [
					{ id: 'hand', label: 'He is in Orla\'s boathouse. Send your men.', said: 'Then he will have a fair court. More than he gave his shipmates.', effect: { navy: 10, heat: [ - 10, - 4 ] } },
					{ id: 'free', label: 'Never saw him. He must have slipped away.', said: 'Must he. Very well. The navy will remember this answer, captain.', effect: { navy: - 12, heat: [ 8, 6 ] } },
				] },
		],
		reward: {
			money: 400, xp: 140, rep: { tidemark: 6 }, disposition: 4,
			paths: {
				hand: { item: 'haleCommendation', disposition: 6, journal: 'Navy business: a convoy saved, a named raider sunk, dispatches flown to Orla. You handed the deserter Garrow to the court-martial: the navy trusts you, the brotherhood less.' },
				free: { item: 'garrowsKnife', sailor: GARROW, disposition: - 10, journal: 'Navy business: a convoy saved, a named raider sunk, dispatches flown to Orla. You let the deserter Garrow slip away; he signed on with you. The navy remembers, the brotherhood approves.' },
			},
		},
	},

	convoyDuty: {
		title: 'Convoy duty', giver: 'hale', port: 'tidemark', region: 'tidemark', requires: [ { feature: 'navy' }, { path: [ 'kingsWater', 'hand' ] } ], repeat: { days: 2 },
		offer: 'Another convoy is due through the lanes. Bring her through, then collect what the Crown owes you at the office.',
		accept: 'Another convoy.', accepted: 'Same as before. Stay close, shoot straight.',
		remind: 'The convoy will not wait on you.', thanks: 'She is in. The guild sends its thanks; I send the Crown\'s.',
		steps: [
			{ id: 'convoy', text: 'Save a merchant convoy under attack at sea (hit her raiders, or be close when they are beaten)', on: 'convoySaved', match: { is: { helped: true } }, start: 'convoy',
				pin: ( story ) => { const p = story && story.progress.convoyDuty, v = p && p.v; return v && Number.isFinite( v.cx ) ? { x: v.cx, z: v.cz, label: 'Convoy under attack' } : null; } },
			{ id: 'claim', text: 'Claim your navy bounties at Tidemark (the navy office or the harbourmaster\'s board)', on: 'navyBountyPaid', pin: { x: HALE_SPOT.x, z: HALE_SPOT.z, label: 'Navy office' } },
		],
		reward: { money: 250, xp: 60, rep: { tidemark: 2 }, navy: 4, disposition: 2, journal: 'Convoy duty: another convoy brought through for Lieutenant Hale.' },
	},

	diceNight: {
		title: 'Dice night', giver: 'brine', port: 'tidemark', region: 'tidemark', requires: { discovered: 'tidemark' },
		offer: 'Bad night. Dice till dawn, a fight at the back table, and somebody went off to Blackwater with the winners. One of yours, I think. Find them, help me throw the back-table lot out, and there is a little job for the next stormy night.',
		accept: 'I will find them.',
		accepted: 'The winners drink it at the Rum Hole on Blackwater. Look under the tables.',
		remind: 'Found them yet? Then the back table, then the casks.',
		thanks: 'Found, fought and run past the cutters. You drink here on the house now. Not too much.',
		steps: [
			{ id: 'missing', text: 'Find {who} at the Rum Hole on Blackwater (walk in, or ask at the black market)', on: [ 'crewFetched', 'interiorEntered' ], match: { test: missingFound },
				check: ( c ) => mode( c ) === 'walk' && near( c, rumSpot(), 60 ), start: 'missing', pin: () => ( { ...rumSpot(), label: 'The Rum Hole' } ) },
			{ id: 'brawl', text: 'Settle the back-table brawl in the Tide & Tankard: walk in and win the fight', on: 'practiceEnded', match: { test: ( e, c ) => e.result === 'won' && !! c.story && c.story._brawlOn( 'diceNight' ) },
				start: 'brawl', pin: { x: TOWN_SPOTS.keeper.x, z: TOWN_SPOTS.keeper.z, label: 'The Tide & Tankard' } },
			{ id: 'storm', text: 'Put to sea from Tidemark with Brine\'s casks on a stormy night (rain or a squall, after dark)', check: stormNightOut, pin: { ...TM_PIER, label: 'Tidemark pier' } },
			{ id: 'run', text: 'Land the casks at Pons Cove without being boarded by the navy', on: 'portVisited', match: { port: 'pons' }, pin: { ...PONS_STAND, label: 'Pons Cove' } },
			talk( 'brine', 'Tell Brine the casks are in', 'Well? Did the cutters see you?', 'Not a lantern on us.' ),
		],
		fail: { on: 'navyBoarded', steps: [ 'run' ], then: 'retry', from: 'storm', text: 'The cutter\'s men poured Brine\'s casks over the side: he will load more on the next stormy night' },
		reward: { money: 320, xp: 120, rep: { tidemark: 5 }, item: 'tankardTab', disposition: 8,
			journal: 'Dice night: your hand fetched from the Rum Hole, the back-table brawl won, Brine\'s casks run to Pons past the cutters. A quarter off at the Tide & Tankard, and the bar tabs are on the house.' },
	},

	stormRun: {
		title: 'Another stormy night', giver: 'brine', port: 'tidemark', region: 'tidemark', requires: { chain: 'diceNight' }, repeat: { days: 2 },
		offer: 'More casks, same arrangement. Wait for weather, go dark, land them at Pons.',
		accept: 'Same arrangement.', accepted: 'Lanterns out past the pier head.',
		remind: 'The casks are still in my cellar.', thanks: 'Pons has its casks; you have your cut.',
		steps: [
			{ id: 'storm', text: 'Put to sea from Tidemark with Brine\'s casks on a stormy night (rain or a squall, after dark)', check: stormNightOut, pin: { ...TM_PIER, label: 'Tidemark pier' } },
			{ id: 'run', text: 'Land the casks at Pons Cove without being boarded by the navy', on: 'portVisited', match: { port: 'pons' }, pin: { ...PONS_STAND, label: 'Pons Cove' } },
		],
		fail: { on: 'navyBoarded', steps: [ 'run' ], then: 'retry', from: 'storm', text: 'The cutter\'s men poured Brine\'s casks over the side: he will load more on the next stormy night' },
		reward: { money: 220, xp: 50, rep: { tidemark: 1 }, disposition: 2 },
	},

	wrensPast: {
		title: 'Wren\'s past', giver: 'wren', port: 'tidemark', region: 'tidemark', requires: [ { feature: 'crew' }, { discovered: 'tidemark' } ],
		offer: 'I steered the cutter Merlin, best helm in the fleet. Then a storm put her on the rocks off Gull Rock, and I have been green at sea ever since. Sign me on. Take me back out there, through one storm. Either I come back a sailor, or I stay ashore for good.',
		accept: 'Sign on. We go together.',
		accepted: 'My sea bag is packed. It has been packed for two years.',
		remind: 'Gull Rock, then weather. I will not ask twice.',
		thanks: 'I did not heave once. Not once. Give me the helm in the next blow, captain.',
		steps: [
			{ id: 'sign', text: 'Sign Wren on (a free berth on your crew list: six hands at most)', check: ( c ) => crewHas( c.story, WREN.id ), start: 'hireWren' },
			{ id: 'wreck', text: 'Sail Wren to where the Merlin went down, south of Gull Rock', check: ( c ) => ABOARD.includes( mode( c ) ) && near( c, WRECK, WRECK.r ) && withYou( c, WREN.id ), pin: { ...WRECK, label: 'The Merlin\'s wreck' } },
			{ id: 'storm', text: 'Ride out a storm at sea with Wren aboard (half a minute in the weather)', check: ( c ) => ABOARD.includes( mode( c ) ) && stormy( c ) && withYou( c, WREN.id ), dwell: 30 },
			{ id: 'home', text: 'Bring Wren back into port', on: 'portVisited' },
		],
		fail: { on: 'crewQuit', match: { is: { id: WREN.id } }, then: 'fail', text: 'Wren signed off and went ashore for good' },
		reward: { xp: 100, rep: { tidemark: 2 }, crewTrait: { id: WREN.id, remove: [ 'seasick' ], add: [ 'brave' ], skills: { sailing: 15 } }, disposition: 15,
			journal: 'Wren\'s past: back to the Merlin\'s wreck and through a storm. Wren is no longer seasick (her sailing can grow to 100, not 60) and she is brave now.' },
	},

	chasingTheLine: {
		title: 'Chasing the line', giver: 'oldPepe', port: 'home', region: 'sea', requires: [ { feature: 'weather' }, { feature: 'seaplane' }, { any: [ { chain: 'rainByDark' }, { discovered: 'tidemark' } ] } ],
		offer: 'Forty years I read the sky from this bench. Now the fronts come in lines, black as tar, lightning walking under them. Somebody young should go and look. Meet one at sea, ride its squall, and get close to its lightning in that flying machine of yours. Or find me a waterspout. Then come and tell me.',
		accept: 'I will chase it.',
		accepted: 'The harbourmaster and the plane\'s radio read the forecast. Go when the sky turns the colour of a bruise.',
		remind: 'Not yet? The next line is coming. My knees say so.',
		thanks: 'That close, and you came back to tell it. Take my storm glass: when the crystals cloud, a front is coming.',
		steps: [
			{ id: 'meet', text: 'Be at sea, aboard or flying, when a storm front reaches you', on: 'frontArrived', match: { test: ( e, c ) => atSea( c ) } },
			{ id: 'squall', text: 'Ride the squall at the front\'s edge for half a minute, at sea', check: squallRide, dwell: 30 },
			{ id: 'strike', text: 'Fly within 400 m of a lightning strike, or see a waterspout from within 500 m', on: 'lightningStrike', match: { test: planeStrike }, check: spoutSeen, dwell: 3 },
			talk( 'oldPepe', 'Tell Old Pepe what you saw', 'Well? Did the sky do what I said?', 'Lightning close enough to smell.' ),
		],
		reward: { money: 260, xp: 120, rep: { home: 3 }, item: 'stormGlass', disposition: 10,
			journal: 'Chasing the line: a storm front met at sea, its squall ridden, its lightning seen from the air. Old Pepe gave you his storm glass.' },
	},

	frontLine: {
		title: 'Another line', giver: 'oldPepe', port: 'home', region: 'sea', requires: [ { feature: 'weather' }, { chain: 'chasingTheLine' } ], repeat: { days: 1 },
		offer: 'There is another line coming. Go up and look at it for me. My knees cannot.',
		accept: 'Up I go.', accepted: 'Close, but not too close.',
		remind: 'The line is still out there.', thanks: 'Ha! Close enough to smell. Good.',
		steps: [
			{ id: 'strike', text: 'Fly within 400 m of a lightning strike, or see a waterspout from within 500 m', on: 'lightningStrike', match: { test: planeStrike }, check: spoutSeen, dwell: 3 },
		],
		reward: { money: 180, xp: 40, rep: { home: 1 }, disposition: 2 },
	},

};

// ---------------------------------------------------------------- rumours (harbour/Tavern.js pool: story.rumours( port )) and notices

// what the tavern regulars say about a line before it is taken (only while its giver would offer it)
export const W20_RUMOURS = {
	kingsWater: { text: 'The navy lieutenant at the naval jetty is short of captains. Convoys keep getting jumped past the lanes.', at: () => HALE_SPOT },
	diceNight: { text: 'Brine had a rough dice night at the Tide & Tankard. Somebody went off to Blackwater with the winnings.', at: () => TOWN_SPOTS.keeper },
	wrensPast: { text: 'The woman on the Tide & Tankard porch steered navy cutters once, they say. Will not set foot on a deck now.', at: () => WREN_SPOT },
	chasingTheLine: { text: 'Old Pepe has been staring at the sky all week. Says the storm lines come in black, with lightning under them.', at: () => HOME_STAND },
};

// ---------------------------------------------------------------- runtime hooks (Story.js calls these; story: the Story)

// a step begins (accepted, advanced to, or a save resumed mid-step)
export function w20Start( story, id, s, resume ) {

	const p = story.progress[ id ];
	if ( ! p ) return;
	p.v = p.v || {};
	if ( s.start === 'convoy' ) { story._convoyT = 0; askConvoy( story, id ); }
	else if ( s.start === 'missing' && ! resume ) sendMissing( story, id );
	else if ( s.start === 'brawl' ) { if ( ! resume ) delete p.v.brawl; story._brawlT = 0; }
	else if ( s.start === 'hireWren' ) hire( story, WREN, false );

}

// the navy's sea events: a convoy under attack near the player (only at sea; the tick asks again)
function askConvoy( story, id ) {

	const nv = story._feature( 'navy' ), ev = nv && nv.events;
	if ( ! ev || ev.convoy || typeof ev.startConvoy !== 'function' ) return false;
	if ( typeof nv.playerAtSea === 'function' && ! nv.playerAtSea() ) return false;
	let ok = false;
	try { ok = !! ev.startConvoy(); } catch ( e ) { ok = false; }
	return ok;

}

// one of your hands went with the winners: a crew hand (aboard) is now asleep at Blackwater; nobody to send: Brine's pot boy
function sendMissing( story, id ) {

	const p = story.progress[ id ], cf = story._feature( 'crew' ), cr = cf && cf.crew;
	let who = null;
	if ( cr && cr.sailors && cr.member ) {

		const ids = [ ...cr.sailors.keys() ].filter( ( k ) => ! cr.present || cr.present( k ) );
		const posted = cr.posts ? [ ...cr.posts.keys() ].filter( ( k ) => ! cr.present || cr.present( k ) ) : [];
		who = ids.find( ( k ) => k !== WREN.id && k !== GARROW.id ) || ids[ 0 ] || posted[ 0 ] || null;
		if ( who ) {

			const m = cr.member( who );
			if ( m ) m.absent = { port: 'blackwater' };

		}

	}

	p.v.who = who || '';
	p.v.whoName = who && cr && cr.nameOf ? String( cr.nameOf( who ) ).slice( 0, 40 ) : POT_BOY;
	story._toast( `${ p.v.whoName } ${ story.L( 'went off to the Rum Hole on Blackwater with the dice winners' ) }`, 3600 );

}

// a hand signs on free (Wren, Garrow): through the crew's own hire so the save keeps them; false when the list is full
export function hire( story, rec, toast = true ) {

	const cf = story._feature( 'crew' ), cr = cf && cf.crew;
	if ( ! cr || typeof cr.hire !== 'function' ) return false;
	if ( cr.sailors && cr.sailors.has( rec.id ) ) return true;
	let ok = false;
	try { ok = !! cr.hire( { ...rec, traits: [ ...rec.traits ], skills: { ...rec.skills } }, cf.day | 0 ); } catch ( e ) { ok = false; }
	if ( ok ) {

		if ( cr.gone && cr.gone.delete ) cr.gone.delete( rec.id );
		story.features.emit( 'crewHired', { id: rec.id, name: rec.name, port: rec.port, price: 0, source: 'story' } );
		if ( toast ) story._toast( `${ rec.name } ${ story.L( 'signs on with you: post them from the crew list' ) }`, 3200 );

	}

	return ok;

}

// a reward that changes a hand: traits off / on, skill points (the crew record and the sailor's saved traits both)
export function crewTrait( story, t ) {

	const cf = story._feature( 'crew' ), cr = cf && cf.crew;
	if ( ! cr || ! t || ! t.id ) return false;
	const m = cr.member ? cr.member( t.id ) : null, s = cr.sailors && cr.sailors.get ? cr.sailors.get( t.id ) : null;
	if ( ! m ) return false;
	for ( const rec of [ m, s ] ) {

		if ( ! rec ) continue;
		rec.traits = rec.traits.filter( ( x ) => ! ( t.remove || [] ).includes( x ) );
		for ( const x of t.add || [] ) if ( ! rec.traits.includes( x ) ) rec.traits.push( x );

	}

	for ( const [ k, n ] of Object.entries( t.skills || {} ) ) {

		if ( ! Number.isFinite( n ) || ! ( k in m.skills ) ) continue;
		m.skills[ k ] = Math.min( 100, ( m.skills[ k ] || 0 ) + n );
		if ( s && s.skills ) s.skills[ k ] = Math.min( 100, ( s.skills[ k ] || 0 ) + n );

	}

	return true;

}

// a choice's or a reward's effect on the navy and the brotherhood
export function standingEffect( story, fx ) {

	if ( ! fx ) return;
	const nv = story._feature( 'navy' );
	if ( fx.navy && nv && typeof nv.addStanding === 'function' ) try { nv.addStanding( fx.navy, 'story' ); } catch ( e ) { /* the navy is optional */ }
	const [ heat = 0, corsair = 0 ] = fx.heat || [];
	const pr = story._feature( 'pirates' );
	if ( ( heat || corsair ) && pr ) {

		try {

			if ( typeof pr._heat === 'function' ) pr._heat( heat, corsair );
			else if ( pr.wanted && typeof pr.wanted.add === 'function' ) pr.wanted.add( heat, corsair );

		} catch ( e ) { /* the pirates are optional */ }

	}

}

// per frame: the convoy step asks again while the sea has none; the brawl starts when you walk into the Tide & Tankard
export function w20Tick( story, dt ) {

	for ( const id of Object.keys( story.progress ) ) {

		const s = story._step( id );
		if ( ! s || ! s.start ) continue;
		if ( s.start === 'convoy' ) {

			story._convoyT = ( story._convoyT || 0 ) - dt;
			if ( story._convoyT <= 0 ) { story._convoyT = CONVOY_RETRY; askConvoy( story, id ); }

		} else if ( s.start === 'brawl' ) tickBrawl( story, id, dt );
		else if ( s.start === 'hireWren' && ! crewHas( story, WREN.id ) ) {

			story._hireT = ( story._hireT || 0 ) - dt;
			if ( story._hireT <= 0 ) { story._hireT = 5; hire( story, WREN, false ); }

		}

	}

}

function inTavern( story ) {

	const it = story._feature( 'interiors' );
	if ( it && it.rooms ) return !! ( it.inside && it.inside.id === 'tidemark.tavern' );
	const p = story.player; // no interiors: the porch and the steps
	return !! ( p && p.mode === 'walk' && Math.hypot( p.position.x - TOWN_SPOTS.keeper.x, p.position.z - TOWN_SPOTS.keeper.z ) <= BRAWL.reach );

}

function tickBrawl( story, id, dt ) {

	const p = story.progress[ id ];
	if ( ! p || ( p.v && p.v.brawl ) ) return;
	story._brawlT = Math.max( 0, ( story._brawlT || 0 ) - dt );
	if ( story._brawlT > 0 || ! inTavern( story ) ) return;
	const m = story._feature( 'melee' ), pf = m && m.practice;
	p.v = p.v || {};
	if ( ! pf || typeof pf.start !== 'function' ) {

		// no melee to fight with: the back-table lot leave when they see you
		story._toast( story.L( 'The back-table lot take one look at you and leave' ), 2800 );
		story._advance( id );
		story._changed();
		return;

	}

	if ( pf.active ) return;
	let ok = false;
	// (melee patch: Practice.start( opts ) skips its own "Practice fight" toast for opts.toast === false; ignored until then)
	try { ok = pf.start( { toast: false, brawl: 'tidemark.tavern' } ) !== false; } catch ( e ) { ok = false; }
	if ( ! ok ) return;
	p.v.brawl = 1;
	story._toast( story.L( 'A chair flies: the back table wants a fight · fists and cudgels, nobody dies' ), 3600 );

}

// events the wave 20 steps care about beyond their own `on`
export function w20Event( story, name, e ) {

	if ( name === 'convoyAttacked' ) {

		for ( const id of Object.keys( story.progress ) ) {

			const s = story._step( id );
			if ( ! s || s.start !== 'convoy' ) continue;
			const p = story.progress[ id ];
			p.v = p.v || {};
			if ( Number.isFinite( e.x ) && Number.isFinite( e.z ) ) { p.v.cx = Math.round( e.x ); p.v.cz = Math.round( e.z ); }
			story._pin( id );

		}

	} else if ( name === 'practiceEnded' ) {

		// lost (or walked off): thrown out on your ear; walk back in to try again
		for ( const id of Object.keys( story.progress ) ) {

			const s = story._step( id ), p = story.progress[ id ];
			if ( ! s || s.start !== 'brawl' || ! p.v || ! p.v.brawl || e.result === 'won' ) continue;
			delete p.v.brawl;
			story._brawlT = BRAWL.retry;
			story._toast( story.L( 'Thrown out on your ear. Walk back in when you are ready' ), 3000 );

		}

	}

}

// the missing hand is found (the step is done however it was found): back aboard, nothing owed
export function w20StepDone( story, id, s ) {

	const p = story.progress[ id ];
	if ( ! s || ! p ) return;
	if ( s.start === 'missing' ) {

		const who = p.v && p.v.who, cf = story._feature( 'crew' ), cr = cf && cf.crew;
		const m = who && cr && cr.life && cr.life.get ? cr.life.get( who ) : null;
		if ( m && m.absent ) m.absent = null;
		story._toast( `${ ( p.v && p.v.whoName ) || story.L( POT_BOY ) } ${ story.L( 'is found asleep under a dice table and hauled back' ) }`, 3200 );

	}

}

// tavern talk that points at a line nobody has taken yet ({ id: 'quest:<chain>', kind: 'quest', text, x, z, chain })
export function w20Rumours( story, port = null ) {

	const out = [];
	for ( const [ chain, r ] of Object.entries( W20_RUMOURS ) ) {

		if ( ! story.chains[ chain ] || ! story.canAccept( chain ) ) continue;
		const q = r.at();
		out.push( { id: 'quest:' + chain, kind: 'quest', chain, port, text: story.L( r.text ), x: q ? r2( q.x ) : undefined, z: q ? r2( q.z ) : undefined } );

	}

	return out;

}

// every player-facing wave 20 string (the Romanian table's checklist: test/feature-quests-w20.mjs); notices: NoticeData.W20_NOTICES
export const W20_WORDS = [
	'Quest', 'done', 'failed', 'Talk to', 'work', 'About', 'Any work?', 'Not now.', 'the missing hand', 'signs on', 'Choose what to say',
	'went off to the Rum Hole on Blackwater with the dice winners', 'signs on with you: post them from the crew list',
	'The back-table lot take one look at you and leave', 'A chair flies: the back table wants a fight · fists and cudgels, nobody dies',
	'Thrown out on your ear. Walk back in when you are ready', 'is found asleep under a dice table and hauled back', POT_BOY,
	'Convoy under attack', 'Hyptile Harbour', 'Navy office', 'The Rum Hole', 'The Tide & Tankard', 'Tidemark pier', 'Pons Cove', 'The Merlin\'s wreck',
];

export function w20Strings( notices = [] ) {

	const out = new Set( W20_WORDS );
	const add = ( v ) => { if ( typeof v === 'string' && v.trim() ) out.add( v ); };
	for ( const c of Object.values( W20_CHAINS ) ) {

		for ( const k of [ 'title', 'offer', 'accept', 'accepted', 'remind', 'thanks', 'after' ] ) add( c[ k ] );
		for ( const v of Object.values( c.thanksBy || {} ) ) add( v );
		add( c.reward && c.reward.journal );
		for ( const pth of Object.values( ( c.reward && c.reward.paths ) || {} ) ) add( pth.journal );
		if ( c.fail ) add( c.fail.text );
		for ( const s of c.steps ) {

			for ( const k of [ 'text', 'say', 'response', 'ready', 'missing' ] ) add( s[ k ] );
			if ( s.pin && typeof s.pin === 'object' ) add( s.pin.label );
			for ( const o of s.choices || [] ) { add( o.label ); add( o.said ); }

		}

	}

	for ( const n of Object.values( W20_NPCS ) ) { add( n.name ); add( n.role ); }
	for ( const it of Object.values( W20_ITEMS ) ) { add( it.name ); add( it.text ); }
	for ( const r of Object.values( W20_RUMOURS ) ) add( r.text );
	for ( const n of notices ) { add( n.title ); add( n.client ); add( n.text ); }
	return [ ...out ];

}

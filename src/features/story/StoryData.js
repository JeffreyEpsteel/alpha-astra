import { FISH } from '../../game/FishTable.js';
import { WORLD } from '../../world/WorldLayout.js';
import { SPOTS as TOWN_SPOTS, at as townAt } from '../../world/islands/town/Layout.js';
import { strongholdLayout } from '../../world/islands/stronghold/Layout.js';
import { TRAINING_POST } from '../melee/MeleeData.js';
import { W20_CHAINS, W20_NPCS, W20_ITEMS } from './StoryW20.js';

// The story's data (pure: no DOM, no engine state): the people who give and take quests, the items a chain can
// give, and the quest chains themselves. Story.js runs them; Dialogue.js turns them into conversations.
//
// Sources (D:\fishing game, read-only):
//   UpsideDownFishing/Data/Quests.csv + Dialogue.csv     the Pons minnows chain (catch three, deliver three) with Pons'
//                                                         lines, rewards 60 coins / 45 XP / +10 Pons reputation and the
//                                                         Reinforced Fishing Line unlock (Upgrades.csv: 50 coins, Pons
//                                                         reputation 10); TASKS.md notes the second chain was never written
//   Forks/Fishing_Naval_20261007/scripts/author-world-*.py the fork's 30+ mini-quests (catch / hand-in per Unreal fish,
//                                                         cargo for the family pier, trade, discover, reputation, board,
//                                                         watch and survive, bounty reports) and its harbour folk
//                                                         (Bran, Iona, Mara, Fin, Tavi, Rook, Pip)
//   Forks/.../docs/WORLD_TRADE_PIRATES_BRIEF.md C2-C5     mini-quest shape, NPC memory, consequences
//   Forks/.../World/PlayerWorldStateComponent.cpp          disposition per encounter: good trade +2, rescued +10,
//                                                         prank -3, harbour attack -25
//
// A chain: { title, giver (NPCS id), port (the giver's port: a hostile port refuses its work), region (journal group:
//   home | pons | gull | key | sea), requires (gates, see Story.gate), offer / accept / accepted / remind / thanks / after
//   (the giver's lines), steps: [ step ], reward: { money, xp, rep: { port: n }, unlock (character), item, unlockItem,
//   disposition (giver), rescue (npc id: a rescue the npc remembers), flag } }
// A step: { id, text (the journal line; {species} / {n} filled in) } and one of
//   on: event | [ events ], match: { ... }, goal, count: 'qty' | 'total' | 'kg' | 'value'   progress from the event bus
//   deliver: { species, alt, any, minKg, night }, goal, at: npc                              hand fish over (dialogue)
//   talk: npc, say, response                                                                 speak to someone
//   reach: { x, z, r, aboard, night, port }                                                  be somewhere (polled)
//   check: ( ctx ) => bool                                                                   a state to reach (polled;
//                                                                                            ctx { state, story, rep, features, player })
//   (wave 13) a step may also carry: pin { x, z, label } (the map pin while it is current: questPin / questPinClear),
//   payout { money, xp, rep } (paid when the step is done: one chain, several payouts), clean { within: s, on, match,
//   already( ctx ), text } (the payout waits `within` s and is forfeited if that event comes first: the chain goes on),
//   start: 'raid' (Story arms the Tidemark raid when the step begins), limit: s (the chain fails if the step is not done
//   in time), reach.mode [ player modes ] (e.g. [ 'plane' ]).
// (wave 13) a chain may carry: fail { on, match, goal, steps: [ step ids ], then: 'fail' | 'restart', text } (the chain fails
//   or starts over), repeat { days } (offered again that many in-game days after it was done: the board recurs it),
//   journal (the line the journal keeps once it is done), and its reward: item (perks: 'off:<key>' discounts read by
//   story.discount, gunnerFee), flags [ 'open:<key>' ] (story.opens), seaplane [ { airframe, key, tier } ] (fitted free),
//   merchant n (trade.credit standing), repairTown port, cartridges n (pouches into firearms.shots).
// match keys: species / alt (lists; alt is used when none of species is in the fish table: the Unreal species are added by
//   another module and may be missing; with neither, any fish), fallback { ...keys } (only applies when species fell back),
//   habitat, minKg, aboard, night, dawnDusk, port, faction, byPlayer, good, kind, onWater, near { x, z, r } (payload x / z,
//   else the player), notInPort, weather. deliver takes species / alt / fallback / any / minKg / night the same way.

export const NPCS = {
	// the people at the boards and stalls (reached from the board panel, PoorGoat's / Pons' quest tabs and Roid's Talk tab)
	orla: { name: 'Harbourmaster Orla', role: 'Harbourmaster', port: 'home', at: 'board' },
	joe: { name: 'PoorGoat', role: 'Fish buyer', port: 'home', at: 'board', vendor: 'PoorGoat' },
	tiber: { name: 'Dockhand Tiber', role: 'Dockhand', port: 'pons', at: 'board' },
	pons: { name: 'Pons', role: 'Fish market and tavern', port: 'pons', at: 'board', vendor: 'Pons' },
	roid: { name: 'Captain Roid', role: 'Boat yard', port: 'home', at: 'roid' },
	// keepers of the far islands (E at their door: Story registers the spots)
	ansel: { name: 'Keeper Ansel', role: 'Lighthouse keeper', port: 'gull', at: 'lighthouse' },
	sal: { name: 'Old Sal', role: 'Marsh fisher', port: 'key', at: 'hut' },
	// the residents (src/world/residents/ResidentData.js ids)
	pepeSweeper: { name: 'Pepe', role: 'Plaza sweeper', port: 'home', character: 'pepe' },
	dogePier: { name: 'Doge', role: 'Pier angler', port: 'home', character: 'doge' },
	bonkBoathouse: { name: 'BONK', role: 'Boathouse regular', port: 'home', character: 'bonk' },
	penguBeach: { name: 'PENGU', role: 'Night fisher', port: 'home', character: 'pengu' },
	bravileChat: { name: 'Bravile', role: 'Deep-water talker', port: 'home', character: 'bravile' },
	heptyleChat: { name: 'Heptyle', role: 'Record chaser', port: 'home', character: 'heptyle' },
	clownCabin: { name: 'The Clown', role: 'Prankster', port: 'home', character: 'clown' },
	kidHyp: { name: 'Lil\' Hyp', role: 'Harbour kid', port: 'home', character: 'hyptile' },
	kidHyp2: { name: 'Tiny Hyp', role: 'Harbour kid', port: 'home', character: 'hyptile' },
	oldPepe: { name: 'Old Pepe', role: 'Weather prophet', port: 'home', character: 'pepe' },
	// the naval fork's harbour folk: matched by name when a resident of that name is added (Residents ids may differ)
	fin: { name: 'Fin', role: 'Fisherman', port: 'home', match: 'fin' },
	mara: { name: 'Mara', role: 'Merchant', port: 'home', match: 'mara' },
	tavi: { name: 'Tavi', role: 'Innkeeper', port: 'pons', match: 'tavi' },
	iona: { name: 'Iona', role: 'Broker', port: 'pons', match: 'iona' },
	bran: { name: 'Bran', role: 'Boatwright', port: 'home', match: 'bran' },
	rook: { name: 'Rook', role: 'Caretaker', port: 'home', match: 'rook' },
	pip: { name: 'Pip', role: 'Storyteller', port: 'pons', match: 'pip' },
	// wave 13: Tidemark's tavern keeper and harbourmaster (harbour residents from world/islands/town/Folk.js: same ids), the
	// Blackwater fence (a spot beside his counter) and Ethena Prosper (a spot beside her chandlery stall)
	brine: { name: 'Brine', role: 'Tavern keeper, the Tide & Tankard', port: 'tidemark', pin: () => ( { x: TOWN_SPOTS.keeper.x, z: TOWN_SPOTS.keeper.z } ) },
	osric: { name: 'Harbourmaster Osric', role: 'Harbourmaster', port: 'tidemark', pin: () => townAt( - 147, 22 ) },
	fence: { name: 'The fence', role: 'Blackwater black market', port: 'blackwater', at: 'spot', spot: () => fenceSpot(), pin: () => fenceSpot() },
	ethena: { name: 'Ethena Prosper', role: 'Chandler', port: 'home', at: 'spot', spot: () => ETHENA_SPOT, pin: () => ETHENA_SPOT },
	// wave 16: the Tidemark fisher of Mayday (a harbour resident of world/islands/town/Folk.js: same id), the castaway
	wenna: { name: 'Wenna', role: 'Fisher', port: 'tidemark', match: 'wenna' },
};

// beside Ethena's stall, on the side away from her bait tub (src/game/Chandlery.js CHANDLERY { 85.5, -60.5, yaw -1.9 }, local
// x 4.2 / z 1.2: clear of her own sale prompt, 3.2 m round her)
export const ETHENA_SPOT = { x: 83.0, z: - 56.9 };

// two and a half metres along the black market's front from the fence's own prompt (Stronghold.js: front( bm, d / 2 + 2.2 ))
export function fenceSpot() {

	const L = strongholdLayout(), bm = L.town.find( ( b ) => b.kind === 'market' );
	if ( ! bm ) return { x: L.center.x, z: L.center.z };
	const d = bm.d / 2 + 2.2, fx = bm.x + Math.sin( bm.yaw ) * d, fz = bm.z + Math.cos( bm.yaw ) * d;
	return { x: Math.round( ( fx + Math.cos( bm.yaw ) * 2.6 ) * 100 ) / 100, z: Math.round( ( fz - Math.sin( bm.yaw ) * 2.6 ) * 100 ) / 100 };

}

// the vendor whose Quests tab shows a person's chains (HudPanels lists game.contracts.active; Contracts.js asks the story)
export const VENDOR_NPC = { PoorGoat: 'joe', Pons: 'pons' };
// who keeps each port's word (consequences reach them; the board keepers)
export const KEEPERS = { home: 'orla', pons: 'tiber', gull: 'ansel', key: 'sal', tidemark: 'osric' };
// who buys fish at each port (a sale is a good trade with them)
export const BUYERS = { home: 'joe', pons: 'pons' };

export const ITEMS = {
	reinforcedLine: { name: 'Reinforced Fishing Line', text: 'A sturdier line: the catch window is a little wider.', perk: { lineWindow: 0.08 }, price: 50 },
	luckyFloat: { name: 'Doge\'s lucky float', text: 'Much luck. Bites come a touch sooner.', perk: { biteSpeed: 0.05 } },
	oilskin: { name: 'Old Pepe\'s oilskin', text: 'Rain off your back: the weather bothers you less.', perk: { weatherCalm: 0.1 } },
	keeperChart: { name: 'Keeper\'s chart', text: 'Ansel\'s chart of the reefs and the lanes the raiders use.', perk: {} },
	marshLantern: { name: 'Marsh lantern', text: 'Sal\'s lantern: night catches come a little easier.', perk: { nightBite: 0.05 } },
	// wave 13 rewards: discounts and waivers other features read through story.discount( key ) / story.perk( name )
	tidemarkFavour: { name: 'Marlow\'s favour', text: 'A friend of Brine\'s: Tidemark\'s chandlery knocks 10 % off.', perk: { 'off:chandler:tidemark': 0.1 } },
	kestrelVoucher: { name: 'Hangar voucher', text: 'The Tidemark airstrip hangar sells you the Kestrel at 20 % off.', perk: { 'off:kestrel': 0.2 } },
	brotherhoodMark: { name: 'Brotherhood mark', text: 'Blackwater\'s fence sells powder to a brother a quarter cheaper.', perk: { 'off:powder:blackwater': 0.25 } },
	gunnerWaiver: { name: 'Tidemark mooring pass', text: 'The town waives the post fee for your gunners.', perk: { gunnerFee: 1 } },
	// wave 16 rewards: story.perk( 'marque' ) (a pirate hull taken is a lawful prize), story.discount( 'dues' )
	letterOfMarque: { name: 'Letter of marque', text: 'Signed by the Tidemark council: a pirate ship you take is a lawful prize, not a wanted vessel.', perk: { marque: 1 } },
	guildSeal: { name: 'Trade guild seal', text: 'The guild seal: harbour offices halve your dues.', perk: { 'off:dues': 0.5 } },
};

const P = ( id ) => WORLD.ports.find( ( p ) => p.id === id ) || null;
const ISLAND = ( id ) => { const i = WORLD.islands.find( ( x ) => x.id === id ); return i ? { x: i.center.x, z: i.center.z, r: i.radius } : null; };
const REEF = { x: WORLD.reef.center.x, z: WORLD.reef.center.z, r: WORLD.reef.radius + 10 };
const GULL = ISLAND( 'gull' ) || { x: - 560, z: 200, r: 120 };
const KEY = ISLAND( 'key' ) || { x: 740, z: 70, r: 110 };
const PONS = ISLAND( 'pons' ) || { x: 620, z: 560, r: 140 };

const catchStep = ( id, text, match, goal = 1 ) => ( { id, text, on: 'fishCaught', match, goal } );
const talk = ( npc, text, say, response = null ) => ( { id: 'talk', text, talk: npc, say, response } );

export const CHAINS = {

	// ---------------------------------------------------------------- the home island
	sweeperLunch: {
		title: 'Pepe\'s lunch', giver: 'pepeSweeper', port: 'home', region: 'home',
		offer: 'Ethena pays me in snapper, man, but this week she forgot. Bring me a yellowtail snapper and I will sweep your name into the sand. Nicely.',
		accept: 'One snapper, coming up.', accepted: 'Feels good, man. Off the reef, dawn or dusk: that is when they bite.',
		remind: 'Still no snapper? The plaza is clean. My belly is not.',
		thanks: 'Golden. Like the hour. You are a good one.',
		steps: [
			catchStep( 'catch', 'Catch a {species}', { species: [ 'yellowtail' ] } ),
			{ id: 'deliver', text: 'Give Pepe the {species}', deliver: { species: [ 'yellowtail' ] }, goal: 1, at: 'pepeSweeper', ready: 'Is that a snapper? For me?', response: 'Lunch is served.', missing: 'No snapper in your cooler, man. The gulls get everything.' },
		],
		reward: { money: 45, xp: 30, rep: { home: 3 }, disposition: 6 },
	},

	pierPatience: {
		title: 'Much patience', giver: 'dogePier', port: 'home', region: 'home',
		offer: 'Much wait. Very patience. Prove it: three fish off this pier, then come tell me. Wow.',
		accept: 'Three off the pier.', accepted: 'Do not step on my line, friend.',
		remind: 'Such counting. How many off the pier now?',
		thanks: 'Three. From my pier. Such respect. Take my float: it is lucky. Very lucky.',
		steps: [
			catchStep( 'catch', 'Catch three fish off the pier', { habitat: 'pier' }, 3 ),
			talk( 'dogePier', 'Tell Doge', 'Three? From my pier? Wow.', 'Three off the pier, as promised.' ),
		],
		reward: { money: 40, xp: 35, rep: { home: 2 }, item: 'luckyFloat', disposition: 8 },
	},

	reefRace: {
		title: 'Race to the reef', giver: 'bonkBoathouse', port: 'home', region: 'home', requires: { boat: true },
		offer: 'A race to the reef. Take your boat out there and land something on it. BONK will be waiting. BONK is always first.',
		accept: 'You are on.', accepted: 'Go! BONK is already there. In spirit.',
		remind: 'BONK is still waiting. BONK does not wait well.',
		thanks: 'Second. You came second. But you came. Respect.',
		steps: [
			{ id: 'sail', text: 'Take your boat to the reef, west of the pier', reach: { ...REEF, aboard: true } },
			catchStep( 'catch', 'Land a reef fish from your boat', { habitat: 'reef', aboard: true } ),
			talk( 'bonkBoathouse', 'Tell BONK who won', 'You? Won? Loud words. BONK likes loud.', 'I beat you to it.' ),
		],
		reward: { money: 60, xp: 40, rep: { home: 2 }, disposition: 5 },
	},

	glassWater: {
		title: 'Glass water', giver: 'penguBeach', port: 'home', region: 'home',
		offer: 'Night is the time. The water goes glass and the big ones come in. Two fish from a boat after dark, and I will believe you have the stomach for it.',
		accept: 'Two at night, from a boat.', accepted: 'Half seven to six. Never late.',
		remind: 'Night has not come yet for you. It will.',
		thanks: 'You were out there in the dark. Good. Now you understand.',
		steps: [
			catchStep( 'catch', 'Catch two fish from a boat after dark', { night: true, aboard: true }, 2 ),
			talk( 'penguBeach', 'Tell PENGU', 'Glass, was it not? The water.', 'The water went glass.' ),
		],
		reward: { money: 70, xp: 45, rep: { home: 2 }, disposition: 6 },
	},

	pastTheReef: {
		title: 'Past the reef', giver: 'bravileChat', port: 'home', region: 'sea', requires: { boat: true },
		offer: 'Take the boat past the reef some time. Past it. Out where the chart goes blue. Land something worth a story, over four kilos.',
		accept: 'Past the reef, then.', accepted: 'Heptyle will say it was luck. It is never luck.',
		remind: 'The blue is south. Past the drop-off. Go.',
		thanks: 'Now that is a story. Heptyle will hate it.',
		steps: [
			{ id: 'sail', text: 'Sail south past the drop-off', reach: { x: 0, z: 760, r: 180, aboard: true } },
			catchStep( 'catch', 'Land a deep-water fish over 4 kg', { habitat: 'deep', minKg: 4 } ),
			talk( 'bravileChat', 'Tell Bravile the story', 'Go on. From the start. Slowly.', 'You will not believe the size of it.' ),
		],
		reward: { money: 120, xp: 70, rep: { home: 3 }, disposition: 8 },
	},

	elevenKilos: {
		title: 'Eleven kilos', giver: 'heptyleChat', port: 'home', region: 'home',
		offer: 'Eleven kilos. The tarpon. Bravile says nine. Bring in anything over eight kilos and we settle who is the liar.',
		accept: 'Over eight kilos.', accepted: 'Strong jaw, strong line. That is the whole secret.',
		remind: 'Eight kilos. Not seven point nine.',
		thanks: 'Ha! Bravile owes me a drink. And you a share of it.',
		steps: [
			catchStep( 'catch', 'Land any fish over 8 kg', { minKg: 8 } ),
			talk( 'heptyleChat', 'Show Heptyle the weight', 'Let me see the scale. Hmm. Hmm!', 'Read it and weep.' ),
		],
		reward: { money: 110, xp: 60, rep: { home: 2 }, disposition: 6 },
	},

	noHardFeelings: {
		title: 'No hard feelings', giver: 'clownCabin', port: 'home', region: 'home', requires: { any: [ { career: [ 'pranks', '>=', 1 ] }, { mem: [ 'pranks', '>=', 1 ] } ] },
		offer: 'Still damp? HAH. No hard feelings. Bring me a fish, a proper one, over two kilos, and we are square. I might even crew for you.',
		accept: 'Fine. One fish. No tricks.', accepted: 'No tricks. Probably.',
		remind: 'Two kilos. I can wait. I am very patient for a clown.',
		thanks: 'Square! Worth it. Every time. I am in your crew now, and I promise nothing.',
		steps: [
			{ id: 'deliver', text: 'Bring the clown a fish over 2 kg', deliver: { any: true, minKg: 2 }, goal: 1, at: 'clownCabin', ready: 'Ooh, that one. Hand it over. Slowly.', response: 'Here. No tricks.', missing: 'That is not a fish over two kilos. That is a disappointment.' },
		],
		reward: { xp: 40, unlock: 'clown', disposition: 15 },
	},

	sharkOrLog: {
		title: 'Shark or log', giver: 'kidHyp', port: 'home', region: 'home',
		offer: 'Did you see a shark? I saw a shark. Tiny says it was a log. Catch something with teeth and show me! A barracuda! Or a jack!',
		accept: 'Something with teeth.', accepted: 'BIG teeth!',
		remind: 'Did you get one? Did it bite you?',
		thanks: 'TEETH. I knew it. I am telling Tiny.',
		steps: [
			catchStep( 'catch', 'Catch a barracuda or a jack', { species: [ 'barracuda', 'jack' ] } ),
			talk( 'kidHyp', 'Show Lil\' Hyp the teeth', 'Show me show me show me!', 'Look at these teeth.' ),
		],
		reward: { money: 25, xp: 30, rep: { home: 1 }, disposition: 10 },
	},

	rainByDark: {
		title: 'Rain by dark', giver: 'oldPepe', port: 'home', region: 'home',
		offer: 'Swell from the south-west. Rain by dark, mark me. You do not believe me? Be out in it when it comes, catch a fish in the rain, and tell me who was right.',
		accept: 'I will be out in it.', accepted: 'Take a coat. No, you will not. Nobody does.',
		remind: 'Not yet? It is coming. My knees know.',
		thanks: 'Wet as a herring, and right as rain. Take my oilskin. I have three.',
		steps: [
			catchStep( 'catch', 'Catch a fish in the rain or a storm', { weather: [ 'rain', 'storm' ] } ),
			talk( 'oldPepe', 'Tell Old Pepe he was right', 'Well? Who was right?', 'You were right.' ),
		],
		reward: { money: 50, xp: 40, item: 'oilskin', disposition: 8 },
	},

	harbourWatch: {
		title: 'Harbour watch', giver: 'orla', port: 'home', region: 'home', requires: { rep: [ 'home', '>=', 10 ] },
		offer: 'Raiders keep coming up the beach after dark. Drive off two of them and the harbour owes you.',
		accept: 'Two raiders.', accepted: 'Block, dodge, then hit back. And come back in one piece.',
		remind: 'The beach is still not safe.',
		thanks: 'The night watch sleeps easier. So do I.',
		steps: [
			{ id: 'fight', text: 'Drive off two shore raiders', on: 'enemyDefeated', match: { kind: [ 'raider' ] }, goal: 2 },
			talk( 'orla', 'Report to Harbourmaster Orla', 'Well?', 'The beach is clear.' ),
		],
		reward: { money: 160, xp: 60, rep: { home: 5 }, disposition: 6 },
	},

	reliableHands: {
		title: 'A reliable pair of hands', giver: 'orla', port: 'home', region: 'home',
		offer: 'The board needs people who finish what they take. Complete three notices, at any port, then come and see me.',
		accept: 'Three notices.', accepted: 'Finish them. Do not just take them.',
		remind: 'Three notices, finished. Not dropped.',
		thanks: 'Reliable. That word goes next to your name now.',
		steps: [
			{ id: 'notices', text: 'Complete three notices from a board', on: 'noticeCompleted', goal: 3 },
			talk( 'orla', 'Report to Harbourmaster Orla', 'Three done. I saw.', 'All three, done.' ),
		],
		reward: { money: 120, xp: 50, rep: { home: 4 }, flag: 'trusted', disposition: 8 },
	},

	spiceForThePot: {
		title: 'Spice for the harbour pot', giver: 'orla', port: 'home', region: 'home',
		offer: 'The harbour cook wants something warmer in the pot. Bring two chests of spices across from Pons and sell them at the market here.',
		accept: 'Two chests of spices.', accepted: 'Pons gets the spice ships first. Buy there.',
		remind: 'The pot is still bland.',
		thanks: 'The whole quay smells of it. Thank you.',
		steps: [
			{ id: 'sell', text: 'Sell two chests of spices at the Hyptile market', on: 'cargoSold', match: { good: 'spices', port: 'home' }, count: 'qty', goal: 2 },
			talk( 'orla', 'Tell Harbourmaster Orla', 'I can smell it from here.', 'The spices are in.' ),
		],
		reward: { money: 90, xp: 30, rep: { home: 4 }, disposition: 4 },
	},

	marketRegular: {
		title: 'Market regular', giver: 'joe', port: 'home', region: 'home', requires: { rep: [ 'home', '>=', 15 ] },
		offer: 'Quiet week. Put three hundred dollars of fish over my counter and I will have a word with Pepe about crewing for you.',
		accept: 'Three hundred dollars.', accepted: 'Fresh ones. I can tell.',
		remind: 'Keep them coming.',
		thanks: 'Pepe says yes. He says it feels good, man. He says that about everything.',
		steps: [
			{ id: 'sell', text: 'Sell $300 of fish at PoorGoat\'s stand', on: 'fishSold', match: { port: 'home' }, count: 'total', goal: 300 },
			talk( 'joe', 'Talk to PoorGoat', 'That is a good week, that is.', 'Three hundred, as promised.' ),
		],
		reward: { money: 80, xp: 50, unlock: 'pepe', disposition: 6 },
	},

	boathouseDreams: {
		title: 'The boathouse', giver: 'bonkBoathouse', port: 'home', region: 'sea', requires: [ { boat: true }, { rep: [ 'home', '>=', 30 ] } ],
		offer: 'That boathouse? Mine, one day. You have a boat already. Sink one pirate with it and BONK crews for you. Loud. First.',
		accept: 'One pirate.', accepted: 'Aim low. Hit the water line. BONK read that somewhere.',
		remind: 'The pirates are south. BONK is here. Go.',
		thanks: 'BONK is in your crew. First on the pier, first on the deck.',
		steps: [
			{ id: 'sink', text: 'Sink a pirate ship', on: 'shipSunk', match: { faction: 'pirate', byPlayer: true }, goal: 1 },
			talk( 'bonkBoathouse', 'Tell BONK', 'BONK heard a bang. Was that you?', 'That was me.' ),
		],
		reward: { money: 150, xp: 80, unlock: 'bonk', disposition: 10 },
	},

	firstHull: {
		title: 'A hull of your own', giver: 'roid', port: 'home', region: 'home',
		offer: 'Every captain needs a hull. Buy one from my yard, any one, then tell me how she handles.',
		accept: 'I will pick one.', accepted: 'Pick with your feet, not your purse.',
		remind: 'The yard is right here. The boats will not buy themselves.',
		thanks: 'She suits you. Treat her kindly and she will bring you home.',
		steps: [
			{ id: 'own', text: 'Buy a boat at Captain Roid\'s yard', check: ( c ) => !! ( c.state && c.state.boat ) },
			talk( 'roid', 'Tell Captain Roid how she handles', 'How does she handle?', 'She handles well.' ),
		],
		reward: { money: 50, xp: 40, rep: { home: 2 }, disposition: 5 },
	},

	teethForTheHull: {
		title: 'Teeth for the hull', giver: 'roid', port: 'home', region: 'sea', requires: { boat: true },
		offer: 'Pirates sail the deep water south of here. Put one on the bottom and I will know you can defend what I sold you.',
		accept: 'One pirate, on the bottom.', accepted: 'Fit a gun first. I sell those too.',
		remind: 'South. Deep water. Black sails.',
		thanks: 'One less black sail. The yard will remember it.',
		steps: [
			{ id: 'sink', text: 'Sink a pirate ship', on: 'shipSunk', match: { faction: 'pirate', byPlayer: true }, goal: 1 },
			talk( 'roid', 'Report to Captain Roid', 'I heard the guns from the sand.', 'She is on the bottom.' ),
		],
		reward: { money: 200, xp: 80, rep: { home: 5 }, disposition: 8 },
	},

	salvageRights: {
		title: 'Salvage rights', giver: 'roid', port: 'home', region: 'sea', requires: { chain: 'teethForTheHull' },
		offer: 'Sunk ships leave crates. Fish a hundred dollars of salvage out of the water. The yard takes a cut. No. Keep it. I like you.',
		accept: 'A hundred in salvage.', accepted: 'Crates float for a while. Not forever.',
		remind: 'The crates sink if you dawdle.',
		thanks: 'A salvager and a captain. Good.',
		steps: [
			{ id: 'loot', text: 'Collect $100 of salvage', on: 'lootCollected', count: 'value', goal: 100 },
			talk( 'roid', 'Report to Captain Roid', 'What did the sea give you?', 'A hold full of crates.' ),
		],
		reward: { money: 100, xp: 50, disposition: 5 },
	},

	// ---------------------------------------------------------------- Pons Cove (the Unreal game's chain first)
	ponsMinnows: {
		title: 'Minnows for Pons', giver: 'pons', port: 'pons', region: 'pons',
		offer: 'The tavern is short on Silver Minnows. Bring me three and I will make the trip worthwhile.',
		accept: 'I will catch them.', accepted: 'Three Silver Minnows. Small fish, specific problem.',
		remind: 'Three Silver Minnows. Small fish, specific problem.',
		thanks: 'Good. The workshop will sell you a Reinforced Fishing Line now.',
		after: 'The line is unlocked. Buying it is still your decision.',
		steps: [
			catchStep( 'catch', 'A Silver Request: catch three {species}', { species: [ 'silverminnow' ], alt: [ 'silverside' ] }, 3 ),
			{ id: 'deliver', text: 'Minnows for Pons: deliver three {species} to Pons', deliver: { species: [ 'silverminnow' ], alt: [ 'silverside' ] }, goal: 3, at: 'pons', ready: 'You found all three. Hand them over when you are ready.', response: 'Here are the minnows.', missing: 'You do not have all three minnows in cargo.' },
		],
		reward: { money: 60, xp: 45, rep: { pons: 10 }, unlockItem: 'reinforcedLine', disposition: 6 },
	},

	ponsLanterns: {
		title: 'Lanterns in the hold', giver: 'pons', port: 'pons', region: 'pons', requires: { chain: 'ponsMinnows' },
		offer: 'An evening meal deserves a little glow. Lantern carp wake when the sky goes dark. Two of them, for the evening pot.',
		accept: 'Two lantern carp.', accepted: 'After dark. They hide from the sun.',
		remind: 'The evening pot is still waiting for its glow.',
		thanks: 'Look at them shine in the pot. The tavern will be full tonight.',
		steps: [
			catchStep( 'catch', 'Catch two {species} after dark', { species: [ 'lanterncarp' ], night: true }, 2 ),
			{ id: 'deliver', text: 'Bring two {species} to Pons', deliver: { species: [ 'lanterncarp' ], night: true }, goal: 2, at: 'pons', ready: 'Two in the hold? Bring them before the pot comes off the fire.', response: 'For the evening pot.', missing: 'Not in your hold. The pot will not wait all night.' },
		],
		reward: { money: 110, xp: 60, rep: { pons: 8 }, disposition: 6 },
	},

	ponsEels: {
		title: 'An unusual line', giver: 'pons', port: 'pons', region: 'pons', requires: { chain: 'ponsLanterns' },
		offer: 'The dockside anglers swear there is an eel out there that swims belly-up. Land me one and the salt barrel is yours to fill.',
		accept: 'One strange eel.', accepted: 'Long, odd, and the wrong way up. You will know it.',
		remind: 'No eel yet? The anglers are laughing at me.',
		thanks: 'The wrong way up! I owe the anglers an apology. And you this.',
		steps: [
			catchStep( 'catch', 'Land an {species}', { species: [ 'upsidedowneel' ], alt: [ 'needlefish' ] } ),
			{ id: 'deliver', text: 'Bring the {species} to Pons', deliver: { species: [ 'upsidedowneel' ], alt: [ 'needlefish' ] }, goal: 1, at: 'pons', ready: 'That is it. Belly up. Hand it here.', response: 'Here it is.', missing: 'Where is it? You did not sell it, did you?' },
		],
		reward: { money: 120, xp: 60, rep: { pons: 8 }, disposition: 8 },
	},

	ponsMarketDay: {
		title: 'Market day at Pons', giver: 'pons', port: 'pons', region: 'pons',
		offer: 'The market is quiet. Put two hundred dollars of fish over my counter and the cove will know your name.',
		accept: 'Two hundred dollars.', accepted: 'The lights look brighter when the sky above us turns black.',
		remind: 'Keep the fish coming.',
		thanks: 'A busy counter is a happy cove.',
		steps: [
			{ id: 'sell', text: 'Sell $200 of fish at the Pons market', on: 'fishSold', match: { port: 'pons' }, count: 'total', goal: 200 },
			talk( 'pons', 'Talk to Pons', 'That was a day.', 'Two hundred, sold.' ),
		],
		reward: { money: 60, xp: 40, rep: { pons: 4 }, disposition: 4 },
	},

	harbourNews: {
		title: 'News from the harbour', giver: 'tiber', port: 'pons', region: 'pons',
		offer: 'Fetch news from Hyptile Harbour. Reach the quay over there, then come back and tell me what you saw.',
		accept: 'I will bring news.', accepted: 'Watch the horizon on the way.',
		remind: 'No news yet?',
		thanks: 'Good news, mostly. That is rare out here.',
		steps: [
			{ id: 'visit', text: 'Reach Hyptile Harbour', on: 'portVisited', match: { port: 'home' } },
			talk( 'tiber', 'Bring the news to Tiber', 'Well? What is the word across the water?', 'The harbour is busy and well.' ),
		],
		reward: { money: 70, xp: 30, rep: { pons: 4 }, disposition: 4 },
	},

	familyPierRope: {
		title: 'Rope for the family pier', giver: 'tiber', port: 'pons', region: 'pons',
		offer: 'The family pier needs new lines. Bring three coils of rope from the Hyptile rope walk and sell them at our market.',
		accept: 'Three coils of rope.', accepted: 'Hemp, not that cheap stuff.',
		remind: 'The pier is still tied up with string.',
		thanks: 'Tied up securely. The spare berth is open again.',
		steps: [
			{ id: 'sell', text: 'Sell three coils of rope at Pons', on: 'cargoSold', match: { good: 'rope', port: 'pons' }, count: 'qty', goal: 3 },
			talk( 'tiber', 'Tell Tiber', 'I saw the coils go by.', 'The rope is in.' ),
		],
		reward: { money: 90, xp: 30, rep: { pons: 5 }, disposition: 4 },
	},

	familySaltBox: {
		title: 'Refill the family salt box', giver: 'tiber', port: 'pons', region: 'pons',
		offer: 'The family salt box has scraped bottom, and the catch will not keep. Three sacks of salt from the Hyptile pans, sold here.',
		accept: 'Three sacks of salt.', accepted: 'Curing season waits for nobody.',
		remind: 'The fish are spoiling while we talk.',
		thanks: 'The catch keeps another week. Thank you.',
		steps: [
			{ id: 'sell', text: 'Sell three sacks of salt at Pons', on: 'cargoSold', match: { good: 'salt', port: 'pons' }, count: 'qty', goal: 3 },
			talk( 'tiber', 'Tell Tiber', 'Salt! At last.', 'The salt box is full.' ),
		],
		reward: { money: 80, xp: 30, rep: { pons: 5 }, disposition: 4 },
	},

	brinehookReport: {
		title: 'The hunt report', giver: 'tiber', port: 'pons', region: 'sea', requires: { rep: [ 'pons', '>=', 10 ] },
		offer: 'The merchants will not sail until the wanted ones are dealt with. Claim a bounty from any board, then report the hunt to me.',
		accept: 'One bounty.', accepted: 'Bring the proof, not a story.',
		remind: 'The lanes are still not safe.',
		thanks: 'The merchants will sail tomorrow. Because of you.',
		steps: [
			{ id: 'bounty', text: 'Claim a bounty contract', on: 'bountyClaimed', goal: 1 },
			talk( 'tiber', 'Report the hunt to Tiber', 'Is it done?', 'The captain is dealt with.' ),
		],
		reward: { money: 150, xp: 60, rep: { pons: 6 }, disposition: 8 },
	},

	knownAtThePier: {
		title: 'Known around the family pier', giver: 'tiber', port: 'pons', region: 'pons', requires: { chain: 'ponsMinnows' },
		offer: 'Help with catches and deliveries until the cove knows your name. Then come back and we will talk about real work.',
		accept: 'I will make a name here.', accepted: 'Names are earned one fish at a time.',
		remind: 'The cove does not know you well enough yet.',
		thanks: 'Everybody on the pier knows you now. Even the gulls.',
		steps: [
			{ id: 'rep', text: 'Reach Pons reputation 25', check: ( c ) => c.rep( 'pons' ) >= 25 },
			talk( 'tiber', 'Talk to Tiber', 'They talk about you in the tavern.', 'I hear the cove knows me.' ),
		],
		reward: { money: 100, xp: 40, flag: 'ponsFriend', disposition: 10 },
	},

	// ---------------------------------------------------------------- Gull Rock
	lampOil: {
		title: 'Oil for the lamp', giver: 'ansel', port: 'gull', region: 'gull', requires: { discovered: 'gull' },
		offer: 'The lamp burns fish oil and the supply boat is late again. Bring me three fish, any kind, and the light stays on.',
		accept: 'Three fish for the lamp.', accepted: 'Any kind. The lamp is not fussy. I am.',
		remind: 'The lamp is guttering.',
		thanks: 'She will burn till the supply boat comes. Thank you, sailor.',
		steps: [
			{ id: 'deliver', text: 'Bring Keeper Ansel three fish', deliver: { any: true }, goal: 3, at: 'ansel', ready: 'Fish? Bless you. Pass them through.', response: 'Three fish for the lamp.', missing: 'Three fish, sailor. Your hold says otherwise.' },
		],
		reward: { money: 90, xp: 40, rep: { gull: 8 }, disposition: 8 },
	},

	keepTheLight: {
		title: 'Keep the light', giver: 'ansel', port: 'gull', region: 'gull', requires: { chain: 'lampOil' },
		offer: 'My eyes are not what they were. Be here on the rock after dark, watch the light turn, and tell me it turns true.',
		accept: 'I will watch after dark.', accepted: 'From the jetty is fine. The beam crosses it every turn.',
		remind: 'After dark, on the rock. The light must turn true.',
		thanks: 'True, you say. Good. Take my chart; it is no use to an old man who stays home.',
		steps: [
			{ id: 'watch', text: 'Be on Gull Rock after dark', reach: { ...GULL, r: GULL.r + 20, night: true } },
			talk( 'ansel', 'Tell Keeper Ansel how the light turns', 'Well? Does she turn true?', 'She turns true.' ),
		],
		reward: { money: 80, xp: 50, rep: { gull: 5 }, item: 'keeperChart', disposition: 6 },
	},

	copperGull: {
		title: 'The Copper Gull', giver: 'ansel', port: 'gull', region: 'sea', requires: [ { chain: 'lampOil' }, { rep: [ 'gull', '>=', 8 ] } ],
		offer: 'Raiders took my nephew\'s sloop off this rock. If you put one of them on the bottom near here, the others might let him go.',
		accept: 'I will find them.', accepted: 'They lurk in the lee of the rock. Watch your hull.',
		remind: 'My nephew is still out there.',
		thanks: 'He is home. Soaked and ashamed, but home. I will not forget this.',
		steps: [
			{ id: 'sink', text: 'Sink a pirate ship near Gull Rock', on: 'shipSunk', match: { faction: 'pirate', byPlayer: true, near: { x: GULL.x, z: GULL.z, r: 700 } }, goal: 1 },
			talk( 'ansel', 'Tell Keeper Ansel', 'I saw the smoke from the gallery.', 'The raiders are scattered.' ),
		],
		reward: { money: 220, xp: 90, rep: { gull: 10, home: 3 }, rescue: 'ansel', disposition: 15 },
	},

	gullCount: {
		title: 'Counting gulls', giver: 'ansel', port: 'gull', region: 'gull', requires: [ { chain: 'lampOil' }, { feature: 'seaplane' } ],
		offer: 'The gulls nest on the far ledges where no boat can land. Fly over and set down on the water off the rock; I want to know how many there are.',
		accept: 'I will fly out.', accepted: 'Land soft. They spook.',
		remind: 'Still no count?',
		thanks: 'More than last year. Good. The rock is alive.',
		steps: [
			{ id: 'land', text: 'Land a seaplane on the water near Gull Rock', on: 'planeLanded', match: { onWater: true, near: { x: GULL.x, z: GULL.z, r: 600 } } },
			talk( 'ansel', 'Give Keeper Ansel the count', 'How many?', 'Hundreds. On every ledge.' ),
		],
		reward: { money: 120, xp: 60, rep: { gull: 4 }, disposition: 5 },
	},

	// ---------------------------------------------------------------- Saltmarsh Key
	flatsShallows: {
		title: 'Flats in the shallows', giver: 'sal', port: 'key', region: 'key', requires: { discovered: 'key' },
		offer: 'The flats out front are full of fish nobody bothers with. Catch three in the shallows round the key and I will show you a trick.',
		accept: 'Three from the shallows.', accepted: 'Wade out. Cast short.',
		remind: 'The flats are right there.',
		thanks: 'The trick? Fish where nobody else does. That is the whole trick.',
		steps: [
			catchStep( 'catch', 'Catch three fish in the shallows round Saltmarsh Key', { habitat: 'shallows', near: { x: KEY.x, z: KEY.z, r: KEY.r + 120 } }, 3 ),
			talk( 'sal', 'Tell Old Sal', 'Well, flats fisher?', 'Three from the shallows.' ),
		],
		reward: { money: 70, xp: 40, rep: { key: 6 }, disposition: 6 },
	},

	smokerMullet: {
		title: 'Mullet for the smoker', giver: 'sal', port: 'key', region: 'key', requires: { discovered: 'key' },
		offer: 'My smoker is cold. Two striped mullet, and the hut will smell right again.',
		accept: 'Two mullet.', accepted: 'Shallows, daytime. They jump.',
		remind: 'The smoker is still cold.',
		thanks: 'There. Smell that. That is home.',
		steps: [
			{ id: 'deliver', text: 'Bring Old Sal two {species}', deliver: { species: [ 'mullet' ] }, goal: 2, at: 'sal', ready: 'Mullet! Hand them here.', response: 'For the smoker.', missing: 'Two mullet. Not one. Not none.' },
		],
		reward: { money: 60, xp: 30, rep: { key: 5 }, disposition: 6 },
	},

	rootsBeneath: {
		title: 'Roots beneath the ripples', giver: 'sal', port: 'key', region: 'key', requires: { chain: 'flatsShallows' },
		offer: 'There is a blunt little fish that hides under the mangrove roots. Old family recipe needs two. Find them for me.',
		accept: 'Two from the roots.', accepted: 'Cast in close. Lose a hook or two. Worth it.',
		remind: 'Under the roots. Close in.',
		thanks: 'Just like my mother made. Take the lantern; I am too old for night fishing now.',
		steps: [
			catchStep( 'catch', 'Catch two {species} under the mangroves', { species: [ 'rootfin' ], fallback: { habitat: 'shallows', near: { x: KEY.x, z: KEY.z, r: KEY.r + 120 } } }, 2 ),
			talk( 'sal', 'Tell Old Sal', 'Did the roots give them up?', 'Two, from the roots.' ),
		],
		reward: { money: 80, xp: 40, rep: { key: 6 }, item: 'marshLantern', disposition: 8 },
	},

	glassShoals: {
		title: 'See-through shoals', giver: 'sal', port: 'key', region: 'key', requires: { chain: 'flatsShallows' },
		offer: 'At dawn and dusk the water fills with fish you can see through. Bring me word of one, caught, and I will believe the old stories.',
		accept: 'One glass fish.', accepted: 'Look for the shimmer, not the fish.',
		remind: 'Dawn or dusk. Look for the shimmer.',
		thanks: 'So the stories are true. Hm. Hm!',
		steps: [
			catchStep( 'catch', 'Catch a {species} at dawn or dusk', { species: [ 'glassperch' ], dawnDusk: true } ),
			talk( 'sal', 'Tell Old Sal', 'Could you see through it?', 'Clear as glass.' ),
		],
		reward: { money: 100, xp: 50, rep: { key: 6 }, disposition: 6 },
	},

	// ---------------------------------------------------------------- the open sea
	driftingDinghy: {
		title: 'The drifting dinghy', giver: 'orla', port: 'home', region: 'sea', requires: { boat: true },
		offer: 'A fisherman\'s dinghy broke its tow last night. The current takes everything south-east. Find him, and bring word back.',
		accept: 'I will find him.', accepted: 'South-east, a kilometre out. Hurry.',
		remind: 'He is still out there.',
		thanks: 'Towed home and warming by the stove. You saved a life today.',
		steps: [
			{ id: 'find', text: 'Find the drifting dinghy south-east of the harbour', reach: { x: 260, z: 1000, r: 90, aboard: true } },
			talk( 'orla', 'Report to Harbourmaster Orla', 'Did you find him?', 'Found him, cold but alive.' ),
		],
		reward: { money: 120, xp: 50, rep: { home: 5 }, rescue: 'orla', disposition: 10 },
	},

	crookedSupper: {
		title: 'A crooked supper', giver: 'heptyleChat', port: 'home', region: 'sea', requires: { boat: true },
		offer: 'They say there is a cod out in the deep, bent by currents pulling two ways at once. A crooked cod. I want to see one. Then eat it.',
		accept: 'One crooked cod.', accepted: 'Deep water. Heavy line.',
		remind: 'Still no cod?',
		thanks: 'Crooked as Bravile\'s stories. Delicious.',
		steps: [
			catchStep( 'catch', 'Catch a {species}', { species: [ 'crookedcod' ], alt: [ 'grouper' ], fallback: { habitat: 'deep' } } ),
			{ id: 'deliver', text: 'Bring Heptyle the {species}', deliver: { species: [ 'crookedcod' ], alt: [ 'grouper' ] }, goal: 1, at: 'heptyleChat', ready: 'Is that it? Give it here.', response: 'Supper.', missing: 'You sold it? To PoorGoat? Unbelievable.' },
		],
		reward: { money: 130, xp: 60, rep: { home: 2 }, disposition: 8 },
	},

	merchantEscort: {
		title: 'Clear the lanes', giver: 'orla', port: 'home', region: 'sea', requires: [ { boat: true }, { rep: [ 'home', '>=', 20 ] } ],
		offer: 'Two merchantmen were boarded this week. Sink two pirate ships and the lanes between here and Pons open again.',
		accept: 'Two pirates.', accepted: 'They hunt in pairs at dusk. Mind that.',
		remind: 'The lanes are still closed.',
		thanks: 'The merchants are sailing. Both ports owe you.',
		steps: [
			{ id: 'sink', text: 'Sink two pirate ships', on: 'shipSunk', match: { faction: 'pirate', byPlayer: true }, goal: 2 },
			talk( 'orla', 'Report to Harbourmaster Orla', 'Two? I saw one burn from here.', 'Both on the bottom.' ),
		],
		reward: { money: 300, xp: 100, rep: { home: 6, pons: 4 }, disposition: 10 },
	},

	wingsOverWater: {
		title: 'Wings over water', giver: 'bravileChat', port: 'home', region: 'sea', requires: { feature: 'seaplane' },
		offer: 'You can fly that thing? Take off, cross to Pons Cove and set her down on the water there. Then tell me what the islands look like from up there.',
		accept: 'To Pons by air.', accepted: 'Heptyle is scared of heights. Do not tell him I told you.',
		remind: 'Up, over, and down on the water at Pons.',
		thanks: 'Small, from up there? Everything is. Except deep water.',
		steps: [
			{ id: 'up', text: 'Take off in the seaplane', on: 'planeTookOff' },
			{ id: 'down', text: 'Land on the water at Pons Cove', on: 'planeLanded', match: { onWater: true, near: { x: PONS.x, z: PONS.z, r: 500 } } },
			talk( 'bravileChat', 'Tell Bravile', 'Well? What does it look like?', 'Like a map somebody spilled.' ),
		],
		reward: { money: 150, xp: 70, rep: { home: 2, pons: 2 }, disposition: 8 },
	},

	clearTheWreckage: {
		title: 'Clear the wreckage', giver: 'orla', port: 'home', region: 'sea', requires: { feature: 'destruction' },
		offer: 'Old wreckage and rotten pilings out on the shoals are a danger to every hull. Break up three pieces out there. Not in my harbour, mind.',
		accept: 'Three pieces, away from the harbour.', accepted: 'Anything in a harbour stays standing. Clear?',
		remind: 'The shoals are still cluttered.',
		thanks: 'Clean water. Thank you.',
		steps: [
			{ id: 'break', text: 'Break up three props away from the harbours', on: 'propDestroyed', match: { notInPort: true }, goal: 3 },
			talk( 'orla', 'Report to Harbourmaster Orla', 'Done?', 'The shoals are clear.' ),
		],
		reward: { money: 90, xp: 40, rep: { home: 2 }, disposition: 4 },
	},

};

// ---------------------------------------------------------------- wave 13: the quest lines that tie the new content together
// Tidemark (the town island, the airstrip), Blackwater (the pirate stronghold and its black market), the seaplane hangars, the
// practice fight. Positions come from WORLD.tidemark / the stronghold layout / MeleeData, read when this module loads.

const TM = WORLD.tidemark || { center: { x: 1720, z: - 60 }, radius: 440, bay: { x: 1996, z: 58, radius: 150 }, dock: { position: { x: 1924, z: 21 } }, airstrip: { x: 1561, z: 56 } };
const TM_PORT = WORLD.ports.find( ( p ) => p.id === 'tidemark' ) || null;
const TM_STAND = TM_PORT && TM_PORT.stand ? { x: TM_PORT.stand.x, z: TM_PORT.stand.z } : { x: TM.center.x, z: TM.center.z };
const TM_PIER = { x: TM.dock.position.x, z: TM.dock.position.z };
const TM_BAY = { x: TM.bay.x, z: TM.bay.z, r: TM.bay.radius };
const TM_STRIP = { x: TM.airstrip.x, z: TM.airstrip.z };
const HOME_ISLAND = ISLAND( 'home' ) || { x: 0, z: - 330, r: 560 };
const BW = strongholdLayout();
const HOME_STAND = P( 'home' ) && P( 'home' ).stand ? { x: P( 'home' ).stand.x, z: P( 'home' ).stand.z } : { x: 50, z: - 75 };
export const RAID_ID = 'tidemark-raider'; // the raiding sloop Story spawns through naval.spawn (Hold the line)
export const RAID_PROPS = 6; // props broken in Tidemark before the raid is lost

const svc = ( c, name ) => ( c && c.features && c.features.get ? c.features.get( name ) : null );
const seaplane = ( c ) => svc( c, 'seaplane' );
const stronghold = ( c ) => svc( c, 'stronghold' );
const isKestrel = ( e, c ) => { const sp = seaplane( c ); return ( e && e.airframe ) === 'kestrel' || !! ( sp && sp.af === 'kestrel' ); };
const hotAtHome = ( c ) => { const t = svc( c, 'trade' ); try { return t && t.contraband ? t.contraband( 'home' ).reduce( ( a, h ) => a + h.qty, 0 ) : 0; } catch ( err ) { return 0; } };
// past the home harbour's customs with contraband aboard: waved through (papers, a bribe, a search that missed the hidden
// compartment) or ashore at home with it still in the hold (no launch came out)
const smuggled = ( e, c ) => {

	if ( c.event === 'portVisited' ) return e.port === 'home' && hotAtHome( c ) > 0;
	return e.port === 'home' && ! e.found && ! e.dumped && ( !! e.papers || !! e.bribed || hotAtHome( c ) > 0 );

};

export const W13_CHAINS = {

	ferryToTidemark: {
		title: 'A ferry to Tidemark', giver: 'joe', port: 'home', region: 'tidemark',
		offer: 'Quiet week, friend. Over east there is a whole town, Tidemark, and Hana\'s fish hall there pays over the odds for reef fish. Sail across, put five fish over her counter, and ask Brine at the Tide & Tankard who is buying. Then we both know.',
		accept: 'Five fish at Tidemark.', accepted: 'East past the Key, then keep going. Fresh ones, mind. Hana can tell.',
		remind: 'Still here? Tidemark is east. Big quay, stone pier, smells of tar.',
		thanks: 'PoorGoat sent you? Then tell him the town buys everything that floats. The market booth will take your contracts now, and Marlow at the chandlery knocks a tenth off for a friend of mine.',
		steps: [
			{ id: 'sail', text: 'Sail to Tidemark and step ashore', on: 'portVisited', match: { port: 'tidemark' }, check: ( c ) => !! ( c.state && Array.isArray( c.state.discovered ) && c.state.discovered.includes( 'tidemark' ) ), pin: { ...TM_STAND, label: 'Tidemark' } },
			{ id: 'sell', text: 'Sell five fish at the Tidemark fish hall', on: 'fishSold', match: { near: { ...TM_STAND, r: 60 } }, count: 'count', goal: 5, pin: { ...TM_STAND, label: 'Hana\'s fish hall' } },
			talk( 'brine', 'Ask Brine at the Tide & Tankard who is buying', 'PoorGoat\'s friend? Sit down. What does the old goat want to know?', 'PoorGoat wants to know who is buying.' ),
		],
		reward: { money: 120, xp: 60, rep: { tidemark: 6, home: 2 }, item: 'tidemarkFavour', flags: [ 'open:haul:tidemark' ], disposition: 6,
			journal: 'Tidemark: Hana\'s fish hall pays for reef fish, Brine keeps the Tide & Tankard, the market booth takes your delivery contracts and Marlow\'s chandlery knocks 10 % off.' },
	},

	wings: {
		title: 'Wings', giver: 'roid', port: 'home', region: 'tidemark', requires: { chain: 'ferryToTidemark' },
		offer: 'Boats are my trade, but the sky is quicker. Take a plane out, buy one or take yours from the hangar, set her down in Tidemark\'s bay and taxi her to the stone pier. If she floats at the pier, you can fly.',
		accept: 'Down in Tidemark\'s bay.', accepted: 'Land into the wind. Then slow, slow, to the pier. A plane on water is a bad boat.',
		remind: 'Tidemark\'s bay, then the pier. Listen to her floats; they tell you before they complain.',
		thanks: 'Heard you on the radio: at the pier, upright. The airstrip hangar owes me a favour. The Kestrel is a fifth off for you, and they will fit her the bigger engine.',
		steps: [
			{ id: 'plane', text: 'Buy a plane at the hangar, or take yours out', on: 'seaplaneBought', check: ( c ) => { const sp = seaplane( c ); return !! ( sp && sp.owned && ! sp.lost ); } },
			{ id: 'land', text: 'Land in Tidemark\'s bay', on: 'planeLanded', match: { near: { x: TM_BAY.x, z: TM_BAY.z, r: TM_BAY.r + 110 } }, pin: { x: TM_BAY.x, z: TM_BAY.z, label: 'Tidemark bay' } },
			{ id: 'taxi', text: 'Taxi to the Tidemark pier', check: ( c ) => { const sp = seaplane( c ); const m = sp && sp.piloted && sp.marker ? sp.marker() : null; return !! ( m && Math.hypot( m.x - TM_PIER.x, m.z - TM_PIER.z ) <= 45 ); }, pin: { ...TM_PIER, label: 'Tidemark pier' } },
		],
		reward: { money: 150, xp: 70, rep: { tidemark: 3 }, item: 'kestrelVoucher', flags: [ 'open:engine:strip' ], disposition: 6,
			journal: 'Wings: set down in Tidemark\'s bay and taxied to the pier. The airstrip hangar sells the Kestrel at 20 % off and lists her engine upgrade.' },
	},

	longWayRound: {
		title: 'The long way round', giver: 'brine', port: 'tidemark', region: 'tidemark', requires: { chain: 'wings' },
		offer: 'Planes behind the chapel, goats in a sulk, and a bet on the bar: nobody flies the Kestrel to the home island and back in one piece. Prove the bar wrong. Nothing on it but pride. Well, pride and a paint job.',
		accept: 'There and back, in one piece.', accepted: 'Off the strip, over the home island, back down on the strip. Bend her and the bet starts again.',
		remind: 'The bar is still betting against you. Mostly me.',
		thanks: 'Not a scratch? The bar pays up: a fresh coat of paint and the radio the hangar was keeping back. Drinks are on the goats.',
		steps: [
			{ id: 'up', text: 'Take off from the Tidemark airstrip in the Kestrel', on: 'planeTookOff', match: { near: { ...TM_STRIP, r: 400 }, test: isKestrel }, pin: { ...TM_STRIP, label: 'Tidemark airstrip' } },
			{ id: 'over', text: 'Fly over the home island', reach: { ...HOME_ISLAND, mode: [ 'plane' ] }, pin: { x: HOME_ISLAND.x, z: HOME_ISLAND.z, label: 'Hyptile Island' } },
			{ id: 'back', text: 'Land the Kestrel back on the Tidemark airstrip', on: 'planeLanded', match: { near: { ...TM_STRIP, r: 300 }, onWater: false, test: isKestrel }, pin: { ...TM_STRIP, label: 'Tidemark airstrip' } },
			talk( 'brine', 'Collect the bet from Brine', 'Well? In one piece?', 'In one piece. Pay up.' ),
		],
		fail: { on: [ 'planeCrashed', 'planeBailedOut' ], steps: [ 'over', 'back' ], then: 'restart', text: 'The Kestrel came down hard: the bet starts again from the airstrip' },
		reward: { money: 100, xp: 90, rep: { tidemark: 4 }, seaplane: [ { airframe: 'kestrel', key: 'radio', tier: 1 }, { airframe: 'kestrel', key: 'livery', tier: 2 } ], disposition: 8,
			journal: 'The long way round: the Kestrel to the home island and back without a scratch. Brine\'s bar paid in navy-and-gold paint and the radio.' },
	},

	blackwaterRumours: {
		title: 'Rumours from Blackwater', giver: 'brine', port: 'tidemark', region: 'blackwater', requires: { any: [ { flag: 'blackwaterRumour' }, { chain: 'ferryToTidemark' } ] },
		offer: 'Rumours come up the stairs with the fishermen: a pirate town on the island south of the reef, guns on the cliffs, a fence who buys what customs seizes. The board pays to know if it is true. Look from the sea first, quietly. Then, if you are mad, silence a gun. If you are very mad, take the place.',
		accept: 'I will take a look.', accepted: 'Quietly. If their bell rings, they know your sail.',
		remind: 'Blackwater, south of the reef. Quiet first, then loud.',
		thanks: 'You took Blackwater? The bar will not believe it. I barely do.',
		steps: [
			{ id: 'scout', text: 'Scout Blackwater from the sea without raising the alarm', on: 'strongholdDiscovered', check: ( c ) => { const s = stronghold( c ); return !! ( s && s.discovered ); },
				payout: { money: 150, xp: 30 }, clean: { within: 120, on: 'strongholdAlarm', match: { is: { state: 'alarm' } }, already: ( c ) => { const s = stronghold( c ); return !! ( s && s.alarm && s.alarm.state === 'alarm' ); }, text: 'The bell rang: no scouting fee, but the work goes on' },
				pin: { x: BW.center.x, z: BW.center.z, label: 'Blackwater' } },
			{ id: 'battery', text: 'Silence one of Blackwater\'s shore batteries', on: 'batterySilenced', check: ( c ) => { const s = stronghold( c ); return !! ( s && s.batteries && Array.isArray( s.batteries.list ) && s.batteries.list.some( ( b ) => b.silenced ) ); },
				payout: { money: 250, xp: 40 }, pin: { x: BW.batteries[ 0 ].x, z: BW.batteries[ 0 ].z, label: 'Blackwater battery' } },
			{ id: 'claim', text: 'Claim Blackwater at its flagstaff', on: 'strongholdClaimed', check: ( c ) => { const s = stronghold( c ); return !! ( s && s.holder === 'player' ); },
				payout: { money: 400, xp: 60 }, pin: { x: BW.flag.x, z: BW.flag.z, label: 'Blackwater flagstaff' } },
		],
		reward: { xp: 60, rep: { tidemark: 5, home: 3 }, disposition: 6,
			journal: 'Blackwater: scouted from the sea, a battery silenced and the island claimed. The brotherhood will want it back.' },
	},

	blackFlag: {
		title: 'The black flag', giver: 'fence', port: 'blackwater', region: 'blackwater', requires: { corsair: 10 },
		offer: 'You have a name, and not the kind harbourmasters like. Good. Fly our flag, sell me three crates the customs men would weep over, and run one past the home harbour\'s launch. Then you are one of us. Merchants will spit when you pass. Let them.',
		accept: 'The flag, three crates, one run.', accepted: 'The flag first. Eight hundred, no haggling. I do not haggle with friends; I do not have any.',
		remind: 'Flag, crates, customs. In that order, if you like breathing.',
		thanks: 'Past the launch with it? Ha. Powder is cheaper for a brother now. Do not let the merchants see you smile.',
		steps: [
			{ id: 'flag', text: 'Buy the black flag from the fence', on: 'blackFlagBought', check: ( c ) => { const s = stronghold( c ); return !! ( s && s.blackFlag ); }, pin: { ...fenceSpot(), label: 'The fence' } },
			{ id: 'sell', text: 'Sell three crates of contraband at the black market', on: 'contrabandSold', match: { is: { port: 'blackwater' } }, count: 'qty', goal: 3, pin: { ...fenceSpot(), label: 'The black market' } },
			{ id: 'smuggle', text: 'Smuggle contraband past the home harbour\'s customs', on: [ 'customsInspected', 'portVisited' ], match: { test: smuggled }, pin: { ...HOME_STAND, label: 'Hyptile Harbour' } },
		],
		reward: { xp: 80, item: 'brotherhoodMark', merchant: - 10, disposition: 10,
			journal: 'The black flag: flown, three crates sold to the fence, one run past the home customs. Powder is cheaper at Blackwater; the merchants trust you less.' },
	},

	holdTheLine: {
		title: 'Hold the line', giver: 'osric', port: 'tidemark', region: 'tidemark', requires: { discovered: 'tidemark' }, repeat: { days: 1 },
		offer: 'A pirate sloop works the outer bay when the moon is dark. She means to shoot up my pier and strip the wharf. Be in the bay when she comes and put her on the bottom, or knock the fight out of her, before she breaks six things on my waterfront.',
		accept: 'I will hold the line.', accepted: 'She comes in from the east. Moor clear of the pier head, not on my wharf.',
		remind: 'The pier is still standing. Keep it that way.',
		thanks: 'The pier stands. The town mends what she broke by morning, and your gunners moor free here: no post fee.',
		steps: [
			{ id: 'arm', text: 'Be in Tidemark\'s bay when the raiders come', reach: { x: TM_BAY.x, z: TM_BAY.z, r: 700 }, pin: { x: TM_BAY.x, z: TM_BAY.z, label: 'Tidemark bay' } },
			{ id: 'fight', text: 'Sink or cripple the raiding sloop before she breaks six props', on: [ 'shipSunk', 'shipCrippled' ], match: { is: { id: RAID_ID } }, start: 'raid', limit: 900, pin: { ...TM_PIER, label: 'The raid' } },
			talk( 'osric', 'Report to Harbourmaster Osric', 'I saw her strike. Well?', 'She will not be back.' ),
		],
		fail: { on: 'propDestroyed', match: { is: { port: 'tidemark' } }, goal: RAID_PROPS, steps: [ 'fight' ], then: 'fail', text: 'The raiders broke the waterfront and sailed off with the wharf\'s goods' },
		reward: { money: 300, xp: 90, rep: { tidemark: 8 }, repairTown: 'tidemark', item: 'gunnerWaiver', disposition: 8,
			journal: 'Hold the line: the raiding sloop beaten off Tidemark\'s pier. The town mended itself and waives your gunners\' post fee. Osric posts it again when the raiders return.' },
	},

	learnToFight: {
		title: 'Learn to fight', giver: 'ethena', port: 'home', region: 'home',
		offer: 'Rope and reels I can sell you. Sense, I cannot. Go to the training post on the beach: win a practice fight, then put one pistol ball in the post. Come back and I will fill your pouch.',
		accept: 'A fight and a shot.', accepted: 'Watch the post\'s arm. When it glows, block or step aside. Then hit back.',
		remind: 'The post is on the beach. It does not bite. Much.',
		thanks: 'Both? Good hands. Here, a pouch of cartridges on the house. And remember: block as the blow lands, not before. That is a parry.',
		steps: [
			{ id: 'practice', text: 'Win a practice fight at the training post (E at the weapon rack)', on: 'practiceEnded', match: { is: { result: 'won' } }, pin: { x: TRAINING_POST.x, z: TRAINING_POST.z, label: 'Training post' } },
			{ id: 'pistol', text: 'Hit the training post with a pistol shot', on: 'gunHit', match: { is: { weapon: 'pistol', target: 'training-post' } }, pin: { x: TRAINING_POST.x, z: TRAINING_POST.z, label: 'Training post' } },
			talk( 'ethena', 'Tell Ethena Prosper', 'Well? Did the post win?', 'I won the fight, and the post has a hole in it.' ),
		],
		reward: { xp: 40, rep: { home: 2 }, cartridges: 1, disposition: 6,
			journal: 'The parry: block just as the blow lands (the amber cue), not before. The attacker staggers, open for a punish. Ethena filled the pouch.' },
	},

};

Object.assign( CHAINS, W13_CHAINS );

// ---------------------------------------------------------------- wave 16: three more quest lines
// Mayday (Osric: flares, a flare when adrift, the launch's ride, then another captain's flare: a castaway Story puts in the
// water off Tidemark, `start: 'castaway'`, pulled aboard with E: castawayRescued), Letters of marque (Osric, after Rumours
// from Blackwater: a pirate hull taken and sold or repainted, a named captain hunted down) and The salt road (Ethena for the
// trade guild: three runs of the harbourmaster's best routes at a profit, a hauling licence, a bulk lot in Tidemark's
// warehouse). New reward kinds (Story._grantMore): launchFree n (the harbour launch charges nothing for n in-game days),
// items letterOfMarque (perk marque: a pirate hull taken is no wanted vessel) and guildSeal (perk 'off:dues': half the dues).
export const CASTAWAY = { id: 'wenna', name: 'Wenna', reach: 9, flareEvery: 45 }; // the Tidemark fisher who went over the side
export const BULK_LOT = 10; // units stored at once: a bulk lot for the salt road
export const ROUTE_TOP = 3; // a buy counts as a run of "the board's best routes" when the good is among the board's top three

// where Wenna is in the water: 550 m out from Tidemark's bay, a little south of the line from the town (deep water, -90 m)
export function castawaySpot() {

	const bay = TM.bay, c = TM.center;
	const dx = bay.x - c.x, dz = bay.z - c.z, l = Math.hypot( dx, dz ) || 1, ux = dx / l, uz = dz / l, a = 0.3, d = 550;
	const cs = Math.cos( a ), sn = Math.sin( a );
	return { x: Math.round( bay.x + ( ux * cs - uz * sn ) * d ), z: Math.round( bay.z + ( ux * sn + uz * cs ) * d ) };

}

const rescue = ( c ) => svc( c, 'rescue' );
const tradeOf = ( c ) => svc( c, 'trade' );
const TM_WAREHOUSE = { ...TM_STAND, label: 'Tidemark warehouse' };

export const W16_CHAINS = {

	mayday: {
		title: 'Mayday', giver: 'osric', port: 'tidemark', region: 'tidemark', requires: { discovered: 'tidemark' },
		offer: 'Every season somebody runs out of fuel past the outer marks and waits for a miracle. Do not wait. Carry flares, and when you are adrift, fire one: my launch answers. Then learn the other side of it: when you see red over the water, you go.',
		accept: 'Flares, and the launch.', accepted: 'Ethena sells them by the three, the agents too. Hold F when you are in trouble, not before.',
		remind: 'Flares in the locker? Good. Now get yourself in trouble. Carefully.',
		thanks: 'Wenna is home and swearing at her outboard. You did right by her. For a week my launch is yours for nothing: tell the coxswain I said so.',
		steps: [
			{ id: 'flares', text: 'Buy a pack of flares (Ethena\'s chandlery or a harbour agent)', on: 'flaresBought', check: ( c ) => { const r = rescue( c ); return !! ( r && r.flares > 0 ); } },
			{ id: 'fire', text: 'Fire a flare when you are adrift (hold F)', on: 'flareFired', match: { is: { by: 'player' } } },
			{ id: 'ride', text: 'Ride the harbour launch to the dock', on: 'rescueDelivered', match: { is: { dest: 'dock' } } },
			{ id: 'answer', text: 'A red flare off Tidemark: pull the castaway aboard', on: 'castawayRescued', start: 'castaway', pin: () => ( { ...castawaySpot(), label: 'Red flare' } ) },
			talk( 'osric', 'Tell Harbourmaster Osric Wenna is safe', 'That was a flare off the outer marks. Well?', 'Wenna is safe. Her outboard is not.' ),
		],
		reward: { money: 180, xp: 90, rep: { tidemark: 6 }, launchFree: 7, rescue: 'wenna', disposition: 8,
			journal: 'Mayday: flares in the locker, fired adrift, a ride in on the harbour launch, and Wenna pulled out of the water off Tidemark. Osric\'s launch answers free for a week.' },
	},

	lettersOfMarque: {
		title: 'Letters of marque', giver: 'osric', port: 'tidemark', region: 'blackwater', requires: { chain: 'blackwaterRumours' },
		offer: 'Blackwater taught the brotherhood to fear your sail. The council would rather buy that than fight it. Cripple one of their ships and take her, turn her into coin or paint her honest, then hunt down one of their named captains. Do that, and I sign you a letter: their hulls become lawful prizes.',
		accept: 'A prize, a sale, a captain.', accepted: 'Cripple her, board her, take her. The fence at Blackwater buys hulls, or the yard repaints them. The captains you will find on the bounty boards.',
		remind: 'A pirate hull taken, sold or painted, and a captain brought to book. Then the letter.',
		thanks: 'Signed and sealed. With this, a pirate hull you take is a prize, not a theft: no hunters, no guards at the quay. Do not lose it.',
		steps: [
			{ id: 'take', text: 'Cripple a pirate ship and take her (Take the ship)', on: 'vesselTaken', match: { is: { faction: 'pirate' } } },
			{ id: 'sell', text: 'Sell her to the Blackwater fence, or have the yard repaint her', on: [ 'stolenSold', 'vesselLaundered' ], pin: () => ( { ...fenceSpot(), label: 'The fence' } ) },
			{ id: 'hunt', text: 'Hunt down a named pirate captain (a bounty notice)', on: [ 'captainKilled', 'bountyClaimed' ], match: { test: ( e, c ) => ( c.event === 'captainKilled' ? e.by === 'player' : e.source === 'pirates' ) } },
			talk( 'osric', 'Collect the letter from Harbourmaster Osric', 'The council heard. Well, captain?', 'A prize taken, a captain brought to book.' ),
		],
		reward: { money: 350, xp: 120, rep: { tidemark: 6, home: 2 }, item: 'letterOfMarque', disposition: 8,
			journal: 'Letters of marque: a pirate hull taken and turned, a named captain hunted down. Osric\'s letter makes a pirate ship a lawful prize: taking one makes you no wanted man.' },
	},

	saltRoad: {
		title: 'The salt road', giver: 'ethena', port: 'home', region: 'tidemark', requires: { discovered: 'tidemark' },
		offer: 'The trade guild wants proof a captain can make a route pay before it lets them in. Run the harbourmaster\'s best routes three times and sell at a profit, buy a hauling licence, then put a bulk lot in the Tidemark warehouse. I sit on the guild\'s bench. I will vouch for you.',
		accept: 'Three runs, a licence, a bulk lot.', accepted: 'The board in any market lists the best loads. Buy one of the top three there, sell where it says, at a profit. Three times.',
		remind: 'The guild counts runs, not stories. Three, at a profit.',
		thanks: 'The guild has you on its roll. Show the seal at any harbour office: they halve your dues.',
		steps: [
			{ id: 'runs', text: 'Run one of the board\'s best routes at a profit (buy a top-three load, sell it where the board says)', on: 'routeRun', goal: 3 },
			{ id: 'licence', text: 'Buy a hauling licence (any market\'s Contracts)', on: 'licenceBought', check: ( c ) => { const t = tradeOf( c ); return !! ( t && t.haul && t.haul.licence >= 1 ); } },
			{ id: 'bulk', text: `Store a bulk lot (${ BULK_LOT } or more) in the Tidemark warehouse`, on: 'warehouseStored', match: { test: ( e ) => ( Number( e.qty ) || 0 ) >= BULK_LOT }, pin: TM_WAREHOUSE },
			talk( 'ethena', 'Tell Ethena Prosper', 'Well? Does the guild have a new member?', 'Three runs, a licence, and a bulk lot in Tidemark.' ),
		],
		reward: { money: 200, xp: 100, rep: { tidemark: 4, home: 3 }, item: 'guildSeal', merchant: 5, disposition: 8,
			journal: 'The salt road: three profitable runs on the board\'s best routes, a hauling licence and a bulk lot in the Tidemark warehouse. The guild seal halves your harbour dues.' },
	},

};

Object.assign( CHAINS, W16_CHAINS );

// wave 20C: a line per wave 19 system (StoryW20.js: the navy, the Tide & Tankard, a sailor with a past, the storm fronts)
Object.assign( NPCS, W20_NPCS );
Object.assign( ITEMS, W20_ITEMS );
Object.assign( CHAINS, W20_CHAINS );
export { W20_CHAINS };

// one errand per port beyond the first four (WORLD.ports is read when the story starts: islands added later get theirs)
export function errandChains( ports = WORLD.ports ) {

	const out = {};
	for ( const p of ports ) {

		if ( [ 'home', 'pons', 'gull', 'key' ].includes( p.id ) ) continue;
		out[ `errand_${ p.id }` ] = {
			title: `A letter for ${ p.name }`, giver: 'orla', port: 'home', region: 'sea', dynamic: true,
			offer: `A letter for ${ p.name }. No reply needed: land there, so they know the harbour still sails.`,
			accept: 'I will carry it.', accepted: 'Keep it dry.', remind: `${ p.name } is still waiting for the letter.`,
			thanks: 'Delivered. The islands are closer than they look.',
			steps: [
				{ id: 'visit', text: `Land at ${ p.name }`, on: 'portVisited', match: { port: p.id } },
				talk( 'orla', 'Report to Harbourmaster Orla', 'Did it arrive dry?', 'Delivered, and dry.' ),
			],
			reward: { money: 90, xp: 40, rep: { home: 2, [ p.id ]: 4 }, disposition: 3 },
		};

	}

	return out;

}

// ---------------------------------------------------------------- helpers shared with Story / Dialogue / the tests

// the species ids of a list that are in the fish table now (the Unreal species may not be)
export function presentSpecies( list ) {

	return ( list || [] ).filter( ( id ) => !! FISH[ id ] );

}

// the species a step / match means now: its own list when any is in the table, else alt (may be empty: no species rule)
export function resolveSpecies( m ) {

	if ( ! m || ! m.species ) return null;
	const own = presentSpecies( m.species );
	if ( own.length ) return own;
	const alt = presentSpecies( m.alt );
	return alt.length ? alt : [];

}

// a match / deliver rule as it applies now: the species resolved, and the fallback keys merged in when they fell back
export function effectiveMatch( m ) {

	if ( ! m ) return {};
	const out = { ...m };
	delete out.alt;
	delete out.fallback;
	if ( ! m.species ) return out;
	const own = presentSpecies( m.species );
	if ( own.length ) {

		out.species = own;
		return out;

	}

	Object.assign( out, m.fallback || {} );
	const alt = presentSpecies( m.alt );
	if ( alt.length ) out.species = alt;
	else delete out.species;
	return out;

}

// 'Silver Minnows' / 'striped mullet' for a step's text ({species})
export function speciesLabel( m, n = 2 ) {

	const ids = resolveSpecies( m );
	if ( ! ids || ! ids.length ) {

		if ( m && m.species && m.species.length ) return prettyId( m.species[ 0 ], n );
		return n === 1 ? 'fish' : 'fish';

	}

	const names = ids.map( ( id ) => plural( FISH[ id ].name, n ) );
	return names.length > 1 ? `${ names.slice( 0, - 1 ).join( ', ' ) } or ${ names[ names.length - 1 ] }` : names[ 0 ];

}

function plural( name, n ) {

	return n === 1 || /fish$/i.test( name ) || /mahi-mahi$/i.test( name ) ? name : name + 's';

}

// 'silverminnow' -> 'Silver Minnow' (a species the table does not have yet: the Unreal names)
const UNREAL_NAMES = { silverminnow: 'Silver Minnow', rootfin: 'Rootfin', lanterncarp: 'Lantern Carp', upsidedowneel: 'Upside-Down Eel', glassperch: 'Glass Perch', crookedcod: 'Crooked Cod' };
function prettyId( id, n ) {

	return plural( UNREAL_NAMES[ id ] || id, n );

}

export const HARBOUR_RADIUS = 140; // m from a port's stand or dock that counts as its harbour (consequences)

// the port whose harbour holds (x, z), or null
export function portAt( x, z, ports = WORLD.ports ) {

	if ( ! Number.isFinite( x ) || ! Number.isFinite( z ) ) return null;
	let best = null, bd = HARBOUR_RADIUS;
	for ( const p of ports ) {

		for ( const q of [ p.stand, p.dock && p.dock.position ] ) {

			if ( ! q ) continue;
			const d = Math.hypot( x - q.x, z - q.z );
			if ( d < bd ) { bd = d; best = p.id; }

		}

	}

	return best;

}

// the nearest port to (x, z) (any distance), 'home' when unknown
export function nearestPort( x, z, ports = WORLD.ports ) {

	if ( ! Number.isFinite( x ) || ! Number.isFinite( z ) ) return 'home';
	let best = 'home', bd = Infinity;
	for ( const p of ports ) {

		const q = p.stand || ( p.dock && p.dock.position );
		if ( ! q ) continue;
		const d = Math.hypot( x - q.x, z - q.z );
		if ( d < bd ) { bd = d; best = p.id; }

	}

	return best;

}

export function portName( id ) {

	const p = WORLD.ports.find( ( x ) => x.id === id ) || WORLD.islands.find( ( x ) => x.id === id ); // Blackwater is an island, not a port
	return p && p.name ? p.name : id;

}

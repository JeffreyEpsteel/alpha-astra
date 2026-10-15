// Plain-node tests of the story (src/features/story): quest chains on the real Features registry and a real GameState
// on a stub app (no DOM, no GPU). Covers the data, the rules, chains driven by events / hand-ins / talks / places /
// states, gates, conversations, NPC memory (gifts, debts, rescues, pranks), consequences (grudges, hostility, amends,
// priceMod), Roid's topics, the vendors' Quests rows through Contracts, the journal and board hooks of the notices,
// and the save round trip.
//   node test/feature-story.mjs
import { Features } from '../src/features/Features.js';
import * as story from '../src/features/story/index.js';
import * as notices from '../src/features/notices/index.js';
import { CHAINS, NPCS, ITEMS, KEEPERS, VENDOR_NPC, errandChains, speciesLabel, effectiveMatch, portAt, nearestPort } from '../src/features/story/StoryData.js';
import { gate, matches, fishFits, pickFish, compare, isNight } from '../src/features/story/Rules.js';
import { buildModel, GREET, TOPICS } from '../src/features/story/Dialogue.js';
import { dialogueHTML, journalHTML } from '../src/features/story/DialogueUI.js';
import { blankMemory, cleanMemory, moodWord } from '../src/features/story/Memory.js';
import { HOSTILE } from '../src/features/story/Story.js';
import { Contracts } from '../src/game/Contracts.js';
import { GameState } from '../src/game/GameState.js';
import { CHARACTERS } from '../src/game/Characters.js';
import { FISH } from '../src/game/FishTable.js';
import { WORLD } from '../src/world/WorldLayout.js';
import { RESIDENTS } from '../src/world/residents/ResidentData.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};
const memStorage = ( m = new Map() ) => ( { getItem: ( k ) => m.get( k ) ?? null, setItem: ( k, v ) => m.set( k, v ) } );
const HOME = WORLD.ports.find( ( p ) => p.id === 'home' );
const PONS = WORLD.ports.find( ( p ) => p.id === 'pons' );

function rig( { tod = 12, withNotices = false, at = HOME.stand } = {} ) {

	const st = new GameState( memStorage() );
	st.money = 100;
	const toasts = [];
	const player = { position: { x: at.x, y: 1, z: at.z }, mode: 'walk' };
	const app = { game: { state: st, toast: ( t ) => toasts.push( t ) }, settings: { timeOfDay: tod, timeSpeed: 0.01 }, mode: 'campaign', player };
	const f = new Features( app );
	const nb = withNotices ? f.add( 'notices', notices ) : null;
	const s = f.add( 'story', story );
	const ev = [];
	for ( const name of [ 'questAccepted', 'questStep', 'questCompleted', 'questAbandoned', 'reputationChanged', 'rewardUnlock', 'storyItem' ] ) f.on( name, ( e ) => ev.push( { name, ...e } ) );
	const catchFish = ( species, kg = 1, where = {} ) => {

		const tod = app.settings.timeOfDay;
		st.addFish( species, kg, tod, { habitat: where.habitat || 'bay', aboard: !! where.aboard } );
		f.emit( 'fishCaught', { species, kg, value: 10, habitat: where.habitat || 'bay', aboard: !! where.aboard } );

	};
	return { st, app, f, s, nb, ev, toasts, player, catchFish, count: ( n ) => ev.filter( ( e ) => e.name === n ).length };

}

// ---------------------------------------------------------------- the data
{

	const ids = Object.keys( CHAINS );
	ok( ids.length >= 30, `${ ids.length } authored quest chains (30+)` );
	const regions = new Set( ids.map( ( id ) => CHAINS[ id ].region ) );
	ok( [ 'home', 'pons', 'gull', 'key', 'sea' ].every( ( r ) => regions.has( r ) ), 'chains at home, Pons, Gull Rock, Saltmarsh Key and the open sea' );
	ok( ids.every( ( id ) => NPCS[ CHAINS[ id ].giver ] ), 'every giver is a story person' );
	ok( ids.every( ( id ) => CHAINS[ id ].steps.every( ( s ) => ( ! s.talk || NPCS[ s.talk ] ) && ( ! s.at || NPCS[ s.at ] ) ) ), 'every talk / hand-in names a story person' );
	ok( ids.every( ( id ) => CHAINS[ id ].steps.every( ( s ) => !! ( s.on || s.deliver || s.talk || s.reach || s.check ) ) ), 'every step has a way to finish' );
	ok( ids.every( ( id ) => { const r = CHAINS[ id ].reward || {}; return ( ! r.unlock || CHARACTERS[ r.unlock ] ) && ( ! r.item || ITEMS[ r.item ] ) && ( ! r.unlockItem || ITEMS[ r.unlockItem ] ); } ), 'rewards name real characters and items' );
	ok( ids.every( ( id ) => { const r = CHAINS[ id ].requires; return ! r || ! JSON.stringify( r ).includes( '"chain"' ) || [].concat( r ).every( ( q ) => ! q.chain || CHAINS[ q.chain ] ); } ), 'chain gates name real chains' );
	ok( CHAINS.ponsMinnows.reward.money === 60 && CHAINS.ponsMinnows.reward.xp === 45 && CHAINS.ponsMinnows.reward.rep.pons === 10 && CHAINS.ponsMinnows.reward.unlockItem === 'reinforcedLine', 'Pons minnows: the Unreal rewards (60 coins, 45 XP, +10 Pons, Reinforced Fishing Line)' );
	ok( RESIDENTS.every( ( r ) => NPCS[ r.id ] ), 'every resident is a story person' );
	ok( Object.values( KEEPERS ).every( ( k ) => NPCS[ k ] ) && Object.values( VENDOR_NPC ).every( ( k ) => NPCS[ k ] ), 'keepers and vendors are story people' );
	const extra = errandChains( [ ...WORLD.ports, { id: 'inverted', name: 'The Inverted Isles', stand: { x: 0, z: 2000 } } ] );
	ok( extra.errand_inverted && extra.errand_inverted.steps[ 0 ].match.port === 'inverted' && ! extra.errand_home, 'an errand for every port beyond the first four (read dynamically)' );
	ok( speciesLabel( { species: [ 'silverminnow' ], alt: [ 'silverside' ] }, 3 ) === ( FISH.silverminnow ? `${ FISH.silverminnow.name }s` : `${ FISH.silverside.name }s` ), 'the Unreal species fall back to the table\'s alt' );
	ok( speciesLabel( { species: [ 'rootfin' ] }, 2 ).length > 0 && ( FISH.rootfin || effectiveMatch( CHAINS.rootsBeneath.steps[ 0 ].match ).habitat === 'shallows' ), 'a species without alt uses its fallback rule' );
	ok( portAt( HOME.stand.x, HOME.stand.z ) === 'home' && portAt( 0, 1500 ) === null && nearestPort( PONS.stand.x + 300, PONS.stand.z ) === 'pons', 'harbour lookups' );

}

// ---------------------------------------------------------------- rules
{

	ok( compare( 3, '>=', 3 ) && ! compare( 2, '>', 2 ) && compare( 1, '!=', 2 ), 'compare' );
	ok( isNight( 22 ) && isNight( 3 ) && ! isNight( 12 ), 'night is 19:30 to 6' );
	ok( matches( { species: [ 'yellowtail' ] }, { species: 'yellowtail' } ) && ! matches( { species: [ 'yellowtail' ] }, { species: 'tuna' } ), 'species match' );
	ok( matches( { habitat: 'reef', aboard: true }, { habitat: 'reef', aboard: true } ) && ! matches( { habitat: 'reef', aboard: true }, { habitat: 'reef', aboard: false } ), 'habitat + aboard' );
	ok( matches( { night: true }, {}, { night: true } ) && ! matches( { night: true }, {}, { night: false } ), 'night from the context' );
	ok( matches( { faction: 'pirate', byPlayer: true }, { faction: 'pirate', byPlayer: true } ) && ! matches( { faction: 'pirate', byPlayer: true }, { faction: 'pirate', byPlayer: false } ), 'faction + byPlayer' );
	ok( matches( { near: { x: 0, z: 0, r: 10 } }, { x: 3, z: 4 } ) && ! matches( { near: { x: 0, z: 0, r: 10 } }, { x: 30, z: 4 } ) && matches( { near: { x: 0, z: 0, r: 10 } }, {}, { player: { x: 1, z: 1 } } ), 'near: the payload, else the player' );
	ok( matches( { notInPort: true }, { x: 0, z: 1500 } ) && ! matches( { notInPort: true }, { x: HOME.stand.x, z: HOME.stand.z } ), 'notInPort' );
	ok( matches( { weather: [ 'rain', 'storm' ] }, {}, { weather: 'rain' } ) && ! matches( { weather: [ 'rain' ] }, {}, { weather: 'clear' } ), 'weather' );
	ok( fishFits( { any: true, minKg: 2 }, { species: 'tuna', kg: 3 } ) && ! fishFits( { any: true, minKg: 2 }, { species: 'tuna', kg: 1 } ), 'deliver minKg' );
	ok( fishFits( { species: [ 'lanterncarp' ], alt: [], night: true }, { species: FISH.lanterncarp ? 'lanterncarp' : 'tuna', kg: 1, caughtAt: 23 } ) && ! fishFits( { species: [ 'mullet' ], night: true }, { species: 'mullet', kg: 1, caughtAt: 12 } ), 'deliver night uses the catch time' );
	ok( pickFish( { species: [ 'mullet' ] }, [ { id: 1, species: 'mullet', value: 9 }, { id: 2, species: 'mullet', value: 3 }, { id: 3, species: 'tuna', value: 1 } ], 1 )[ 0 ] === 2, 'hand-ins take the cheapest fitting fish' );
	const r = rig();
	const ctx = r.s.ctx( 'orla' );
	ok( ! gate( { boat: true }, ctx ) && gate( { boat: false }, ctx ) && gate( null, ctx ), 'boat gate' );
	ok( ! gate( { rep: [ 'home', '>=', 10 ] }, ctx ), 'rep gate closed at 0' );
	r.st.addRep( 'home', 12 );
	ok( gate( { rep: [ 'home', '>=', 10 ] }, r.s.ctx( 'orla' ) ), 'rep gate opens' );
	ok( gate( { any: [ { boat: true }, { rep: [ 'home', '>=', 1 ] } ] }, ctx ) && ! gate( { not: { rep: [ 'home', '>=', 1 ] } }, ctx ) && gate( { feature: 'story' }, ctx ) && ! gate( { feature: 'seaplane' }, ctx ), 'any / not / feature gates' );
	ok( gate( { discovered: 'home' }, ctx ) && ! gate( { discovered: 'gull' }, ctx ), 'discovered gate' );

}

// ---------------------------------------------------------------- a fetch chain end to end (Pepe's lunch)
{

	const r = rig();
	ok( r.s.offers( 'pepeSweeper' ).includes( 'sweeperLunch' ), 'Pepe offers his lunch' );
	ok( r.s.talkTo( 'pepeSweeper' ) === true, 'a resident with work opens a conversation' );
	let m = r.s.current.model;
	const offer = m.choices.find( ( c ) => c.id === 'offer:sweeperLunch' );
	ok( !! offer && m.choices[ m.choices.length - 1 ].kind === 'bye', 'the offer is a choice; goodbye is last' );
	m = r.s.choose( 'pepeSweeper', 'offer:sweeperLunch' );
	ok( m.line === CHAINS.sweeperLunch.offer && m.choices[ 0 ].id === 'accept:sweeperLunch', 'the pitch, then accept' );
	m = r.s.choose( 'pepeSweeper', 'accept:sweeperLunch' );
	ok( r.s.isActive( 'sweeperLunch' ) && m.said === CHAINS.sweeperLunch.accepted && r.count( 'questAccepted' ) === 1, 'accepted: running, the giver answers, questAccepted' );
	r.catchFish( 'tuna' );
	ok( r.s.progress.sweeperLunch.step === 0, 'the wrong fish does not count' );
	r.catchFish( 'yellowtail', 1.2 );
	ok( r.s.progress.sweeperLunch.step === 1 && r.count( 'questStep' ) === 1, 'the snapper moves the chain to the hand-in' );
	ok( /Give Pepe/.test( r.s.stepText( 'sweeperLunch' ) ) && /1 \/ 1 in the hold/.test( r.s.stepText( 'sweeperLunch' ) ), 'step text with the hold count' );
	const money = r.st.money, xp = r.st.xp, rep = r.st.rep.home || 0;
	m = r.s.dialogue( 'pepeSweeper' );
	const turn = m.choices.find( ( c ) => c.id === 'turnin:sweeperLunch' );
	ok( !! turn && m.line === CHAINS.sweeperLunch.steps[ 1 ].ready, 'the hand-in is ready; he asks for it' );
	m = r.s.choose( 'pepeSweeper', 'turnin:sweeperLunch' );
	ok( r.s.isDone( 'sweeperLunch' ) && m.said.startsWith( CHAINS.sweeperLunch.thanks ), 'handed in: done, thanks' );
	ok( r.st.money === money + 45 && r.st.xp >= xp + 30 && ( r.st.rep.home || 0 ) >= rep + 3, 'rewards: money, xp, home reputation' );
	ok( ! r.st.inventory.some( ( f ) => f.species === 'yellowtail' ) && r.count( 'questCompleted' ) === 1, 'the fish left the hold; questCompleted' );
	ok( r.s.memoryOf( 'pepeSweeper' ).met && r.s.memoryOf( 'pepeSweeper' ).disposition > 5, 'Pepe remembers: met, warmer' );
	ok( r.s.talkTo( 'pepeSweeper' ) === false && r.s.memoryOf( 'pepeSweeper' ).talks === 2, 'nothing left to discuss: the resident says his own line (talks still counted)' );
	ok( r.s.talkTo( 'kidHyp2' ) === false && r.s.memoryOf( 'kidHyp2' ).met, 'a resident without chains keeps their own lines, but remembers you' );

}

// ---------------------------------------------------------------- the Unreal chain (Pons minnows), its workshop and the next link
{

	const r = rig( { at: PONS.stand } );
	r.st.discovered.push( 'pons' );
	ok( r.s.accept( 'ponsMinnows', 'pons' ), 'Pons minnows accepted' );
	const sp = FISH.silverminnow ? 'silverminnow' : 'silverside';
	for ( let i = 0; i < 3; i ++ ) r.catchFish( sp, 0.05 );
	ok( r.s.progress.ponsMinnows.step === 1, 'three minnows caught' );
	r.st.takeFish( [ r.st.inventory[ 0 ].id ] );
	let m = r.s.dialogue( 'pons' );
	ok( m.choices.some( ( c ) => c.id === 'ask:ponsMinnows' ) && ! m.choices.some( ( c ) => c.id === 'turnin:ponsMinnows' ), 'two in the hold: not ready' );
	m = r.s.choose( 'pons', 'ask:ponsMinnows' );
	ok( m.line === CHAINS.ponsMinnows.steps[ 1 ].missing, 'Pons: "You do not have all three minnows in cargo."' );
	r.catchFish( sp, 0.05 );
	m = r.s.choose( 'pons', 'turnin:ponsMinnows' );
	ok( r.s.isDone( 'ponsMinnows' ) && ( r.st.rep.pons || 0 ) >= 10 && r.s.unlocks.includes( 'reinforcedLine' ), 'delivered: +10 Pons, the line is for sale' );
	m = r.s.dialogue( 'pons' );
	ok( m.choices.some( ( c ) => c.id === 'topic:buyLine' ) && m.choices.some( ( c ) => c.id === 'offer:ponsLanterns' ), 'the workshop line and the next link (Lanterns) are on offer' );
	r.st.money = 10;
	m = r.s.choose( 'pons', 'topic:buyLine' );
	ok( ! r.s.items.includes( 'reinforcedLine' ) && /Not enough coin/.test( m.said ), 'buying it is still your decision (and your money)' );
	r.st.money = 80;
	r.s.choose( 'pons', 'topic:buyLine' );
	ok( r.s.items.includes( 'reinforcedLine' ) && r.st.money === 30 && r.s.perk( 'lineWindow' ) > 0, 'bought: $50, its perk counts' );

}

// ---------------------------------------------------------------- talk, place, state and event steps
{

	const r = rig();
	r.s.accept( 'pierPatience' );
	for ( let i = 0; i < 3; i ++ ) r.catchFish( 'grunt', 0.4, { habitat: 'pier' } );
	const m = r.s.dialogue( 'dogePier' );
	ok( m.line === CHAINS.pierPatience.steps[ 1 ].say && m.choices[ 0 ].label === CHAINS.pierPatience.steps[ 1 ].response, 'a talk step: his opener and your answer' );
	r.s.choose( 'dogePier', 'turnin:pierPatience' );
	ok( r.s.isDone( 'pierPatience' ) && r.s.items.includes( 'luckyFloat' ), 'talked: done, Doge\'s float' );

	ok( ! r.s.canAccept( 'firstHull' ) === false, 'Roid\'s hull chain is open on foot' );
	r.s.accept( 'firstHull' );
	r.s.update( 1 );
	ok( r.s.progress.firstHull.step === 0, 'no boat yet: waiting' );
	r.st.boat = 'skiff';
	r.s.update( 1 );
	ok( r.s.progress.firstHull.step === 1 && r.s.memoryOf( 'roid' ).notes.firstBoat === 'skiff', 'owning a boat finishes the state step; Roid notes the first boat' );

	ok( r.s.canAccept( 'reefRace' ), 'a boat opens BONK\'s race' );
	r.s.accept( 'reefRace' );
	r.player.position.x = WORLD.reef.center.x; r.player.position.z = WORLD.reef.center.z;
	r.s.update( 1 );
	ok( r.s.progress.reefRace.step === 0, 'at the reef on foot does not count (aboard)' );
	r.player.mode = 'boat';
	r.s.update( 1 );
	ok( r.s.progress.reefRace.step === 1, 'at the reef in the boat: the place step is done' );
	r.catchFish( 'parrot', 1, { habitat: 'reef', aboard: true } );
	ok( r.s.progress.reefRace.step === 2, 'a reef fish from the boat' );

	r.s.accept( 'marketRegular' ); // gated by rep: refused at first
	ok( ! r.s.isActive( 'marketRegular' ) && r.s.lastError === 'Not yet', 'rep-gated chains refuse early' );
	r.st.addRep( 'home', 20 );
	r.s.accept( 'marketRegular' );
	r.f.emit( 'fishSold', { count: 4, total: 180, port: 'home' } );
	r.f.emit( 'fishSold', { count: 2, total: 90, port: 'pons' } );
	r.f.emit( 'fishSold', { count: 3, total: 130, port: 'home' } );
	ok( r.s.progress.marketRegular.step === 1 && /\$/.test( CHAINS.marketRegular.steps[ 0 ].text ), 'counted by sale total at the right port' );
	r.s.choose( 'joe', 'turnin:marketRegular' );
	ok( r.ev.some( ( e ) => e.name === 'rewardUnlock' && e.character === 'pepe' && e.source === 'story' ), 'a crew unlock goes out as rewardUnlock' );
	ok( r.s.memoryOf( 'joe' ).trades === 2, 'PoorGoat remembers the sales at his stand' );

	ok( ! r.s.canAccept( 'ponsLanterns' ) && ! r.s.canAccept( 'ponsEels' ) && r.s.offers( 'pons' ).includes( 'ponsMinnows' ), 'Pons\' later links wait for the first' );
	ok( ! r.s.offers( 'clownCabin' ).length, 'the clown has nothing until he pranked you' );
	r.f.emit( 'residentPrank', { id: 'clownCabin' } );
	ok( r.s.offers( 'clownCabin' ).includes( 'noHardFeelings' ) && r.s.memoryOf( 'clownCabin' ).pranks === 1, 'after a prank: "No hard feelings"' );

	r.s.accept( 'pastTheReef' );
	ok( r.s.abandon( 'pastTheReef' ) && ! r.s.progress.pastTheReef && r.s.canAccept( 'pastTheReef' ) && r.count( 'questAbandoned' ) === 1, 'dropping a chain frees it again' );

}

// ---------------------------------------------------------------- consequences: grudges, hostility, amends, prices
{

	const r = rig();
	ok( r.s.priceMod( 'home' ) === 1 && ! r.s.hostile( 'home' ), 'neutral port: priceMod 1' );
	r.f.emit( 'shipSunk', { id: 'm1', name: 'Saltwind', faction: 'merchant', x: HOME.dock.position.x + 200, z: HOME.dock.position.z + 200, byPlayer: true } );
	ok( r.s.hostile( 'home' ) && r.s.rep( 'home' ) <= HOSTILE && r.s.priceMod( 'home' ) > 1, 'sinking a merchantman near home: hostile, prices rise' );
	ok( r.s.memoryOf( 'orla' ).attacks === 1 && r.s.memoryOf( 'orla' ).disposition < 0, 'the harbourmaster remembers the attack' );
	ok( ! r.s.canAccept( 'reliableHands' ) && r.s.offers( 'pepeSweeper' ).length === 0, 'a hostile port refuses its work' );
	let m = r.s.dialogue( 'orla' );
	ok( m.line.startsWith( 'Nothing for you' ) && m.choices.some( ( c ) => c.id === 'topic:amends' ) && ! m.choices.some( ( c ) => c.kind === 'offer' ), 'hostile talk: only amends' );
	r.st.money = 1000;
	m = r.s.choose( 'orla', 'topic:amends' );
	ok( ! r.s.hostile( 'home' ) && r.st.money === 1000 - 120 && r.s.offers( 'orla' ).length > 0, 'amends paid: the harbour talks again' );
	r.f.emit( 'shipSunk', { id: 'p1', faction: 'pirate', x: PONS.dock.position.x, z: PONS.dock.position.z + 300, byPlayer: true } );
	ok( ( r.st.rep.pons || 0 ) >= 1 && r.s.memoryOf( 'tiber' ).notes.pirates === 1, 'a pirate sunk near Pons: a little Pons reputation' );
	r.f.emit( 'propDestroyed', { id: 'crate', kind: 'crate', x: HOME.stand.x, z: HOME.stand.z, by: 'player' } );
	r.f.emit( 'propDestroyed', { id: 'crate2', kind: 'crate', x: 0, z: 1500, by: 'player' } );
	ok( r.s.grudge.home === 2 && r.s.memoryOf( 'orla' ).pranks === 1, 'smashing harbour props is remembered; open-sea props are not' );
	r.f.emit( 'playerBoatSunk', { cause: 'pirates' } );
	r.f.emit( 'bountyClaimed', { id: 'home:1:2', target: 'x', reward: {} } );
	ok( r.s.memoryOf( 'roid' ).notes.sinks === 1 && r.s.memoryOf( 'roid' ).notes.bounties === 1 && /tow rope/.test( r.s.dialogue( 'roid' ).line ), 'Roid remembers your sinking and brings it up' );
	// grudges fade by the day
	r.s.update( 1 );
	r.s._ownDay += 1;
	r.s.update( 1 );
	ok( ! r.s.grudge.home, 'grudges fade with the days' );

}

// ---------------------------------------------------------------- memory: gifts, debts, rescues, save
{

	const r = rig();
	r.catchFish( 'grunt', 0.3 );
	r.catchFish( 'tuna', 8 );
	let m = r.s.dialogue( 'sal' );
	ok( m.choices.some( ( c ) => c.id === 'gift' ), 'a gift is offered when the hold has fish' );
	r.s.choose( 'sal', 'gift' );
	ok( r.s.memoryOf( 'sal' ).gifts === 1 && r.st.inventory.length === 1 && r.st.inventory[ 0 ].species === 'tuna', 'the cheapest fish was given' );
	ok( ! r.s.dialogue( 'sal' ).choices.some( ( c ) => c.id === 'gift' ), 'one gift a day' );
	r.st.money = 5;
	m = r.s.dialogue( 'joe' );
	ok( m.choices.some( ( c ) => c.id === 'topic:lend' ), 'broke: PoorGoat offers to front you $50' );
	r.s.choose( 'joe', 'topic:lend' );
	ok( r.st.money === 55 && r.s.memoryOf( 'joe' ).debt === 60 && /\$60/.test( r.s.dialogue( 'joe' ).line ), 'a debt PoorGoat brings up' );
	r.s.update( 1 );
	r.s._ownDay += 5;
	r.s.update( 1 );
	ok( r.s.memoryOf( 'joe' ).notes.debtLate === 1 && r.s.memoryOf( 'joe' ).disposition < 0, 'a late debt sours him' );
	r.st.money = 100;
	r.s.choose( 'joe', 'topic:repay' );
	ok( r.s.memoryOf( 'joe' ).debt === 0 && r.st.money === 40, 'repaid' );

	r.st.discovered.push( 'gull' );
	r.st.boat = 'skiff';
	r.s.accept( 'lampOil' );
	for ( let i = 0; i < 3; i ++ ) r.catchFish( 'grunt', 0.3 );
	r.s.choose( 'ansel', 'turnin:lampOil' );
	r.st.addRep( 'gull', 10 );
	r.s.accept( 'copperGull' );
	const g = WORLD.islands.find( ( i ) => i.id === 'gull' ).center;
	r.f.emit( 'shipSunk', { id: 'p9', faction: 'pirate', x: g.x + 200, z: g.z, byPlayer: true } );
	r.s.choose( 'ansel', 'turnin:copperGull' );
	ok( r.s.isDone( 'copperGull' ) && r.s.memoryOf( 'ansel' ).rescues === 1 && /nephew/.test( r.s.dialogue( 'ansel' ).line ), 'a rescue the keeper remembers and mentions' );

	r.s.accept( 'pierPatience' );
	r.catchFish( 'grunt', 0.3, { habitat: 'pier' } );
	r.s.grudge.pons = 7;
	const saved = JSON.parse( JSON.stringify( r.s.toJSON() ) );
	const r2 = rig();
	r2.s.fromJSON( saved );
	ok( JSON.stringify( r2.s.toJSON() ) === JSON.stringify( saved ), 'save round trip' );
	ok( r2.s.isDone( 'copperGull' ) && r2.s.progress.pierPatience.n === 1 && r2.s.memoryOf( 'ansel' ).rescues === 1 && r2.s.grudge.pons === 7, 'progress, memory and grudges survive a load' );
	r2.s.fromJSON( { progress: { nope: { s: 'done' }, errand_future: { s: 'done' }, ponsMinnows: { s: 'active', step: 99 } }, memory: { ghost: {}, orla: { disposition: 900, notes: { x: 1 } } }, items: [ 'luckyFloat', 'fake' ] } );
	ok( ! r2.s.progress.nope && r2.s.progress.errand_future && ! r2.s.progress.ponsMinnows && ! r2.s.memory.ghost && r2.s.memoryOf( 'orla' ).disposition === 100 && J( r2.s.items ) === J( [ 'luckyFloat' ] ), 'bad save data is cleaned' );
	r2.s.reset();
	ok( ! Object.keys( r2.s.progress ).length && ! Object.keys( r2.s.memory ).length, 'reset: a new game' );
	ok( cleanMemory( null ) === null && blankMemory().disposition === 0 && moodWord( 50 ) === 'warm', 'memory helpers' );

}

function J( o ) { return JSON.stringify( o ); }

// ---------------------------------------------------------------- Roid's Talk tab, the Quests tab, the journal, the notice board
{

	const r = rig( { withNotices: true } );
	let topics = r.s.roidTopics();
	ok( topics.some( ( t ) => t.id === 'story:offer:firstHull' ), 'Roid\'s Talk tab lists his work' );
	let a = r.s.roidAsk( 'story:offer:firstHull' );
	ok( a.lines[ 0 ] === CHAINS.firstHull.offer && r.s.roidTopics().some( ( t ) => t.id === 'story:accept:firstHull' ), 'asking: the pitch, then an accept topic' );
	a = r.s.roidAsk( 'story:accept:firstHull' );
	ok( r.s.isActive( 'firstHull' ) && a.lines[ 0 ] === CHAINS.firstHull.accepted && r.s.roidTopics().some( ( t ) => t.id === 'story:ask:firstHull' ), 'accepted from Roid\'s tab' );

	const contracts = new Contracts( r.st );
	r.app.game.contracts = contracts;
	r.s.update( 0.6 );
	ok( contracts.story === r.s, 'the story hooks itself into the contracts' );
	const rows = contracts.active.filter( ( q ) => q.kind === 'chain' );
	ok( rows.some( ( q ) => q.id === 'story:joe:spiceForThePot' ) === false && rows.every( ( q ) => q.id.startsWith( 'story:joe:' ) ), 'at home only PoorGoat\'s chains show at the stand' );
	r.st.addRep( 'home', 20 );
	const row = contracts.active.find( ( q ) => q.id === 'story:joe:marketRegular' );
	ok( !! row && row.done && row.reward.unlock === 'pepe', 'PoorGoat\'s chain on his Quests tab (with its crew unlock)' );
	ok( contracts.deliver( row.id ) === null && r.s.current && r.s.current.npc === 'joe', 'its button opens PoorGoat\'s conversation (no double reward)' );
	ok( contracts.active.filter( ( q ) => q.kind !== 'chain' ).length >= 3, 'the old board is still there' );

	const model = r.nb.model( 'home' );
	ok( model.talk && model.talk.npc === 'orla' && /Quests ·/.test( model.storyHTML ) && /A hull of your own/.test( model.storyHTML ), 'the board offers Orla; the journal lists the running chain' );
	const j = r.s.journal();
	ok( j.active.length === 1 && j.offers.length > 0 && j.regions.home.total > 10 && j.total >= 30, 'journal model' );
	ok( /Harbourmaster Orla/.test( journalHTML( j ) ) || /has work/.test( journalHTML( j ) ), 'journal html' );
	const html = dialogueHTML( buildModel( r.s, 'orla' ) );
	ok( /Harbourmaster Orla/.test( html ) && /data-choice="bye"/.test( html ) && ! /undefined/.test( html ), 'dialogue html' );
	ok( Object.keys( GREET ).every( ( k ) => NPCS[ k ] ) && Object.keys( TOPICS ).every( ( k ) => k === '*' || NPCS[ k ] ), 'authored lines belong to story people' );
	// the far keepers' doors are interactables
	ok( r.f.nearestInteractable( { x: WORLD.ports.find( ( p ) => p.id === 'gull' ).stand.x + Math.cos( WORLD.ports.find( ( p ) => p.id === 'gull' ).stand.yaw ) * 5, y: 0, z: WORLD.ports.find( ( p ) => p.id === 'gull' ).stand.z - Math.sin( WORLD.ports.find( ( p ) => p.id === 'gull' ).stand.yaw ) * 5 } )?.id === 'story:ansel', 'Keeper Ansel has a door at Gull Rock' );

}

// ---------------------------------------------------------------- the night chain and its hand-in
{

	const r = rig( { tod: 22, at: PONS.stand } );
	r.st.discovered.push( 'pons' );
	r.s.progress.ponsMinnows = { s: 'done', at: 0, end: 0 };
	r.s.accept( 'ponsLanterns' );
	const sp = FISH.lanterncarp ? 'lanterncarp' : null;
	if ( sp ) {

		r.catchFish( sp, 1 );
		r.app.settings.timeOfDay = 12;
		r.catchFish( sp, 1 );
		ok( r.s.progress.ponsLanterns.step === 0 && r.s.progress.ponsLanterns.n === 1, 'only the night catch counts' );

	} else ok( true, 'lantern carp not in the fish table yet (fish worker): skipped' );

}

console.log( fails ? `\n${ fails } FAILED` : '\nall story tests passed' );
process.exit( fails ? 1 : 0 );

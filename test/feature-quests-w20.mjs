// Plain-node tests of the wave 20 quest lines (src/features/story/StoryW20.js): Navy business (Lieutenant Hale: a convoy, a named
// raider, dispatches by seaplane, the court-martial choice), Dice night (Brine: the missing hand, the brawl in the Tide & Tankard,
// the storm-night run past the cutters), Wren's past (a sailor for hire whose quest lifts her seasick sailing cap) and Chasing the
// line (Old Pepe: a storm front met at sea, its squall, its lightning from the air), plus the follow-ups the boards post. Real
// Features registry, GameState, notices and crew records (crew/Crew.js); stub navy, pirates, weather, melee, interiors and
// seaplane. Each line completes in a scripted run, the choice branches, saves round-trip mid-quest, the rumours point at the
// givers and every new string has its Romanian.
//   node test/feature-quests-w20.mjs
import { Features } from '../src/features/Features.js';
import * as story from '../src/features/story/index.js';
import * as notices from '../src/features/notices/index.js';
import { CHAINS, NPCS, ITEMS } from '../src/features/story/StoryData.js';
import { W20_CHAINS, W20_NPCS, W20_RUMOURS, WREN, GARROW, WRECK, HALE_SPOT, POT_BOY, rumSpot, w20Strings } from '../src/features/story/StoryW20.js';
import { RO } from '../src/features/story/W20Text.js';
import { L } from '../src/features/story/Lang.js';
import { setLang } from '../src/i18n/index.js';
import { W20_NOTICES, storyPostings } from '../src/features/notices/NoticeData.js';
import { Crew } from '../src/features/crew/Crew.js';
import { skillCap } from '../src/features/crew/Life.js';
import { GameState } from '../src/game/GameState.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { WORLD } from '../src/world/WorldLayout.js';

let fails = 0, passes = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else { passes ++; console.log( 'ok  ', msg ); }

};
const memStorage = ( m = new Map() ) => ( { getItem: ( k ) => m.get( k ) ?? null, setItem: ( k, v ) => m.set( k, v ) } );
const HOME = WORLD.ports.find( ( p ) => p.id === 'home' ).stand;
const TM_PIER = WORLD.tidemark.dock.position;
const stub = ( obj ) => ( { install: () => obj } );
const MAIN = [ 'kingsWater', 'diceNight', 'wrensPast', 'chasingTheLine' ];
const FOLLOW = [ 'convoyDuty', 'stormRun', 'frontLine' ];

function rig( { mode = 'campaign', money = 1000, hands = [] } = {} ) {

	const st = new GameState( memStorage() );
	st.setMode( mode );
	st.money = money;
	const toasts = [];
	const player = { position: { x: HOME.x, y: 1, z: HOME.z }, mode: 'walk' };
	const app = { game: { state: st, toast: ( t ) => toasts.push( t ) }, settings: { timeOfDay: 12, timeSpeed: 0.01 }, mode, player };
	const f = new Features( app );
	const navy = { standing: 0, convoyAsks: 0, atSea: true, events: { convoy: null, startConvoy() { navy.convoyAsks ++; return true; } },
		playerAtSea: () => navy.atSea, addStanding( n ) { navy.standing += n; } };
	const pirates = { heat: 0, corsair: 0, _heat( h, s ) { pirates.heat += h; pirates.corsair += s; return { changed: false }; } };
	const weather = { kind: 'clear', local: { squall: 0, under: false, rain: 0 }, spout: null };
	const melee = { practice: { active: false, starts: 0, start() { melee.practice.active = true; melee.practice.starts ++; return true; } } };
	const interiors = { rooms: {}, inside: null };
	const crewF = { crew: new Crew(), day: 0 };
	for ( const h of hands ) crewF.crew.hire( h, 0 );
	f.add( 'navy', stub( navy ) );
	f.add( 'pirates', stub( pirates ) );
	f.add( 'weather', stub( weather ) );
	f.add( 'melee', stub( melee ) );
	f.add( 'interiors', stub( interiors ) );
	f.add( 'crew', stub( crewF ) );
	f.add( 'seaplane', stub( { owned: true } ) );
	const s = f.add( 'story', story );
	const ev = [];
	for ( const name of [ 'questAccepted', 'questStep', 'questCompleted', 'questFailed', 'questPin', 'questPinClear', 'crewHired' ] ) f.on( name, ( e ) => ev.push( { ...e, name } ) );
	const count = ( n, fn = () => true ) => ev.filter( ( e ) => e.name === n && fn( e ) ).length;
	const moveTo = ( q, m = 'walk' ) => { player.position.x = q.x; player.position.z = q.z; player.mode = m; };
	const run = ( secs, dt = 0.5 ) => { for ( let t = 0; t < secs; t += dt ) s.update( dt ); };
	return { st, app, f, s, navy, pirates, weather, melee, interiors, crewF, crew: crewF.crew, ev, count, toasts, player, moveTo, run };

}

const stepOf = ( r, id ) => ( r.s.progress[ id ] ? r.s.progress[ id ].step : - 1 );
const stepId = ( r, id ) => { const x = r.s._step( id ); return x ? x.id : null; };
const ADA = { id: 's-tidemark-0-0', name: 'Ada Kell', look: 'pepe', port: 'tidemark', traits: [ 'lucky' ], skills: { gunnery: 5, angling: 30, sailing: 5, repair: 5 }, wage: 8, watch: 'day' };

// ---------------------------------------------------------------- the data
{

	ok( [ ...MAIN, ...FOLLOW ].every( ( id ) => CHAINS[ id ] === W20_CHAINS[ id ] ), 'four lines and three follow-ups, all in CHAINS' );
	ok( MAIN.every( ( id ) => W20_CHAINS[ id ].steps.length >= 3 && W20_CHAINS[ id ].steps.length <= 5 ), 'each line has 3 to 5 steps' );
	const givers = { kingsWater: 'hale', diceNight: 'brine', wrensPast: 'wren', chasingTheLine: 'oldPepe' };
	ok( MAIN.every( ( id ) => W20_CHAINS[ id ].giver === givers[ id ] && NPCS[ givers[ id ] ] ), 'givers: Lieutenant Hale, Brine, Wren Calloway, Old Pepe (the people already there)' );
	ok( Object.keys( W20_NPCS ).every( ( k ) => NPCS[ k ] && typeof NPCS[ k ].spot === 'function' && NPCS[ k ].port === 'tidemark' ), 'Hale and Wren have their own spots at Tidemark' );
	ok( [ ...MAIN, ...FOLLOW ].every( ( id ) => [ 'offer', 'accept', 'accepted', 'remind', 'thanks' ].every( ( k ) => typeof W20_CHAINS[ id ][ k ] === 'string' && W20_CHAINS[ id ][ k ].length > 5 ) ), 'every chain has its giver\'s lines' );
	ok( [ ...MAIN, ...FOLLOW ].every( ( id ) => W20_CHAINS[ id ].steps.every( ( x ) => !! ( x.on || x.talk || x.reach || x.check || x.deliver ) ) ), 'every step has a way to finish' );
	ok( MAIN.every( ( id ) => W20_CHAINS[ id ].reward.journal || Object.values( W20_CHAINS[ id ].reward.paths || {} ).every( ( p ) => p.journal ) ), 'every line leaves a journal line (per path for the court-martial)' );
	ok( [ 'haleCommendation', 'garrowsKnife', 'tankardTab', 'stormGlass' ].every( ( k ) => ITEMS[ k ] ), 'the new items exist' );
	const T = new TerrainData();
	ok( T.heightAt( WRECK.x, WRECK.z ) < - 5, `the Merlin's wreck is in open water south of Gull Rock (${ T.heightAt( WRECK.x, WRECK.z ).toFixed( 0 ) } m)` );
	ok( W20_NOTICES.every( ( n ) => W20_CHAINS[ n.chain ] && n.ports.length ) && FOLLOW.every( ( id ) => W20_NOTICES.some( ( n ) => n.chain === id ) ), 'the boards post every line and every follow-up' );
	ok( MAIN.every( ( id ) => W20_RUMOURS[ id ] && W20_RUMOURS[ id ].at() ), 'a tavern rumour points at each line\'s giver' );
	// every new player-facing string has its Romanian (comma-below letters, no cedillas)
	const all = w20Strings( W20_NOTICES ), missing = all.filter( ( x ) => ! RO[ x ] );
	ok( all.length > 100 && missing.length === 0, `${ all.length } wave 20 strings, every one in Romanian ${ missing.slice( 0, 2 ).join( ' | ' ) }` );
	ok( ! Object.values( RO ).some( ( v ) => /[şţŞŢ]/.test( v ) ) && Object.values( RO ).some( ( v ) => /[șț]/.test( v ) ), 'Romanian uses ș / ț (comma below), never the cedilla forms' );
	ok( Object.keys( RO ).every( ( k ) => ( k.match( /\{who\}/g ) || [] ).length === ( RO[ k ].match( /\{who\}/g ) || [] ).length ), 'templates keep their {who}' );
	setLang( 'ro', { persist: false } );
	const ro = L( 'Navy business' );
	setLang( 'en', { persist: false } );
	ok( ro === 'Treburile marinei' && L( 'Navy business' ) === 'Navy business', 'Lang.L: Romanian when the player picked it, English otherwise' );

}

// ---------------------------------------------------------------- 1. Navy business: the hand-over path
{

	const r = rig();
	ok( ! r.s.canAccept( 'kingsWater' ), 'Navy business waits for Tidemark (campaign)' );
	r.st.discover( 'tidemark' );
	ok( r.s.offers( 'hale' ).includes( 'kingsWater' ) && r.s.accept( 'kingsWater', 'hale' ), 'then Hale offers it; accepted' );
	ok( r.navy.convoyAsks === 1 && stepId( r, 'kingsWater' ) === 'convoy', 'the convoy step asks the navy\'s sea events for a convoy' );
	r.run( 46 );
	ok( r.navy.convoyAsks >= 2, 'no convoy at sea yet: it asks again' );
	r.f.emit( 'convoyAttacked', { id: 'c1', name: 'Salt Wren', x: 900, z: 400 } );
	ok( r.count( 'questPin', ( e ) => e.id === 'quest:kingsWater' && e.x === 900 && e.z === 400 ) >= 1, 'the map pins the convoy under attack' );
	r.f.emit( 'convoySaved', { name: 'Salt Wren', helped: false, reward: 0 } );
	ok( stepId( r, 'kingsWater' ) === 'convoy', 'saved by the navy alone does not count' );
	r.f.emit( 'convoySaved', { name: 'Salt Wren', helped: true, reward: 450 } );
	ok( stepId( r, 'kingsWater' ) === 'hunt', 'helped her: the hunt' );
	r.f.emit( 'captainKilled', { id: 'x', captain: 'Red Annis', by: 'other' } );
	ok( stepId( r, 'kingsWater' ) === 'hunt', 'a captain someone else sank does not count' );
	r.f.emit( 'captainKilled', { id: 'x', captain: 'Red Annis', by: 'player' } );
	ok( stepId( r, 'kingsWater' ) === 'fly', 'a named captain sunk: the dispatches' );
	r.f.emit( 'planeLanded', { id: 'petrel', onWater: true, x: TM_PIER.x, z: TM_PIER.z } );
	ok( stepId( r, 'kingsWater' ) === 'fly', 'landing at Tidemark is not the home harbour' );
	r.f.emit( 'planeLanded', { id: 'petrel', onWater: true, x: HOME.x, z: HOME.z + 150 } );
	ok( stepId( r, 'kingsWater' ) === 'talk' && r.s.pendingAt( 'orla' ).length === 1, 'landed in the home bay: Orla takes the dispatches' );
	ok( r.s.turnIn( 'kingsWater', 'orla' ) && stepId( r, 'kingsWater' ) === 'court', 'Orla tells of the deserter: the court-martial at the jetty' );
	// a save mid-quest, at the choice
	const json = JSON.parse( JSON.stringify( r.s.toJSON() ) );
	const r2 = rig();
	r2.st.discover( 'tidemark' );
	r2.s.fromJSON( json );
	ok( stepId( r2, 'kingsWater' ) === 'court' && JSON.stringify( r2.s.toJSON() ) === JSON.stringify( json ), 'saved and loaded at the choice: the same step (fromJSON( toJSON() ) round-trips)' );
	ok( ! r.s.turnIn( 'kingsWater', 'hale' ) && /Choose/.test( r.s.lastError ), 'a choice step is not a plain hand-in' );
	const m = r.s.dialogue( 'hale' );
	const picks = m.choices.filter( ( c ) => c.kind === 'pick' );
	ok( picks.length === 2 && picks.some( ( c ) => c.id === 'pick:kingsWater:hand' ) && picks.some( ( c ) => c.id === 'pick:kingsWater:free' ), 'Hale\'s conversation offers both answers' );
	const money0 = r.st.money;
	r.s.choose( 'hale', 'pick:kingsWater:hand' );
	ok( r.s.isDone( 'kingsWater' ) && r.s.pathOf( 'kingsWater' ) === 'hand', 'handed him over: done, path "hand"' );
	ok( r.navy.standing === 10 && r.pirates.heat === - 10 && r.pirates.corsair === - 4, 'navy standing +10, notoriety down, the brotherhood thinks less of you' );
	ok( r.st.money - money0 === 400 && r.s.items.includes( 'haleCommendation' ) && ! r.s.items.includes( 'garrowsKnife' ), 'reward: $400 and Hale\'s commendation' );
	ok( r.s.entries.some( ( e ) => e.id === 'kingsWater' && /handed the deserter/.test( e.text ) ), 'the journal says what you chose' );
	ok( r.s.discount( 'navy' ) === 0.1, 'the commendation: a tenth off at the navy chandler (story.discount( \'navy\' ))' );
	ok( r.s.canAccept( 'convoyDuty' ) && storyPostings( 'tidemark', r.s, 0 ).some( ( p ) => p.id === 'story:convoyDuty' ), 'the follow-up, Convoy duty, is posted at Tidemark' );
	const saved = JSON.parse( JSON.stringify( r.s.toJSON() ) );
	const r3 = rig();
	r3.s.fromJSON( saved );
	ok( r3.s.pathOf( 'kingsWater' ) === 'hand' && r3.s.isDone( 'kingsWater' ), 'the path survives a save' );

}

// ---------------------------------------------------------------- 2. Navy business: the slip-away path (the branch)
{

	const r = rig();
	r.st.discover( 'tidemark' );
	r.s.accept( 'kingsWater', 'hale' );
	r.s.progress.kingsWater.step = 4; // at the court-martial
	const d = r.s.decide( 'kingsWater', 'free', 'hale' );
	ok( d && d.done && r.s.pathOf( 'kingsWater' ) === 'free', 'said he slipped away: done, path "free"' );
	ok( r.navy.standing === - 12 && r.pirates.heat === 8 && r.pirates.corsair === 6, 'navy standing -12, notoriety up, the brotherhood approves' );
	ok( r.crew.sailors.has( GARROW.id ) && r.count( 'crewHired', ( e ) => e.id === GARROW.id ) === 1 && r.s.items.includes( 'garrowsKnife' ), 'Garrow signs on with you (free) and leaves you his knife' );
	ok( ! r.s.canAccept( 'convoyDuty' ) && ! storyPostings( 'tidemark', r.s, 0 ).some( ( p ) => p.id === 'story:convoyDuty' ), 'Hale has no more convoy work for you' );
	ok( r.s.memoryOf( 'hale' ).disposition < 0, 'and he remembers it' );

}

// ---------------------------------------------------------------- 3. Dice night: the missing hand, the brawl, the storm run
{

	const r = rig( { hands: [ ADA ] } );
	r.st.discover( 'tidemark' );
	ok( r.s.accept( 'diceNight', 'brine' ), 'Brine\'s Dice night accepted' );
	const ada = r.crew.member( ADA.id );
	ok( ada.absent && ada.absent.port === 'blackwater' && r.s.progress.diceNight.v.who === ADA.id, 'your hand Ada went off to Blackwater with the winners (crew life: absent)' );
	ok( /Ada Kell/.test( r.s.stepText( 'diceNight' ) ) && r.toasts.some( ( t ) => /Ada Kell went off to the Rum Hole/.test( t ) ), `the step names her: "${ r.s.stepText( 'diceNight' ) }"` );
	const json = JSON.parse( JSON.stringify( r.s.toJSON() ) );
	const r2 = rig( { hands: [ ADA ] } );
	r2.s.fromJSON( json );
	ok( r2.s.progress.diceNight.v.who === ADA.id && /Ada Kell/.test( r2.s.stepText( 'diceNight' ) ), 'saved mid-step: who is missing survives' );
	r.f.emit( 'interiorEntered', { id: 'tidemark.tavern', port: 'tidemark' } );
	ok( stepId( r, 'diceNight' ) === 'missing', 'the wrong tavern does not count' );
	r.f.emit( 'interiorEntered', { id: 'blackwater.rumhole', port: 'blackwater' } );
	ok( stepId( r, 'diceNight' ) === 'brawl' && ! ada.absent, 'walked into the Rum Hole: Ada is found and hauled back aboard' );
	r.run( 2 );
	ok( r.melee.practice.starts === 0, 'no brawl until you walk into the Tide & Tankard' );
	r.interiors.inside = { id: 'tidemark.tavern' };
	r.run( 1 );
	ok( r.melee.practice.starts === 1 && r.s._brawlOn( 'diceNight' ) && r.toasts.some( ( t ) => /A chair flies/.test( t ) ), 'inside: the brawl starts (melee\'s fight, nobody dies)' );
	r.melee.practice.active = false;
	r.f.emit( 'practiceEnded', { result: 'lost' } );
	ok( stepId( r, 'diceNight' ) === 'brawl' && ! r.s._brawlOn( 'diceNight' ) && r.toasts.some( ( t ) => /Thrown out/.test( t ) ), 'lost: thrown out, the step stays' );
	r.run( 5 );
	ok( r.melee.practice.starts === 1, 'not straight back in' );
	r.run( 20 );
	ok( r.melee.practice.starts === 2, 'a while later it starts again' );
	r.f.emit( 'practiceEnded', { result: 'won' } );
	ok( stepId( r, 'diceNight' ) === 'storm', 'won: now the casks' );
	r.interiors.inside = null;
	r.moveTo( { x: TM_PIER.x + 200, z: TM_PIER.z }, 'boat' );
	r.run( 1 );
	ok( stepId( r, 'diceNight' ) === 'storm', 'a calm noon is not a stormy night' );
	r.app.settings.timeOfDay = 23;
	r.weather.kind = 'storm';
	r.run( 1 );
	ok( stepId( r, 'diceNight' ) === 'run', 'out from Tidemark on a stormy night: the run to Pons' );
	r.f.emit( 'navyBoarded', { ship: 'Swift', fine: 0, paid: true } );
	ok( stepId( r, 'diceNight' ) === 'storm' && r.toasts.some( ( t ) => /poured Brine's casks/.test( t ) ), 'a navy boarding: the casks go over the side, back to the next stormy night' );
	r.run( 1 );
	r.f.emit( 'portVisited', { port: 'pons' } );
	ok( stepId( r, 'diceNight' ) === 'talk', 'past the cutters and landed at Pons' );
	const m0 = r.st.money;
	ok( r.s.turnIn( 'diceNight', 'brine' ).done && r.st.money - m0 === 320 && r.s.items.includes( 'tankardTab' ), 'Brine pays $320 and opens a tab' );
	ok( r.s.canAccept( 'stormRun' ) && storyPostings( 'tidemark', r.s, 0 ).some( ( p ) => p.id === 'story:stormRun' ), 'the board posts the follow-up: another stormy night' );
	// nobody to send: Brine's pot boy, found by walking up to the black market
	const q = rig();
	q.st.discover( 'tidemark' );
	q.s.accept( 'diceNight', 'brine' );
	ok( q.s.progress.diceNight.v.whoName === POT_BOY && /Dov/.test( q.s.stepText( 'diceNight' ) ), 'no hands of your own: Brine\'s pot boy is the one missing' );
	q.moveTo( rumSpot(), 'walk' );
	q.run( 1 );
	ok( stepId( q, 'diceNight' ) === 'brawl', 'found him by the black market on foot' );

}

// ---------------------------------------------------------------- 4. Wren's past: the sailor with a past
{

	const r = rig();
	r.st.discover( 'tidemark' );
	r.s.update( 0.1 );
	const it = r.f.nearestInteractable( { x: NPCS.wren.spot().x, y: 1, z: NPCS.wren.spot().z } );
	ok( it && it.id === 'story:wren' && /Wren Calloway/.test( it.prompt() ), `E on the porch: "${ it && it.prompt() }"` );
	ok( r.s.offers( 'wren' ).includes( 'wrensPast' ) && r.s.accept( 'wrensPast', 'wren' ), 'Wren\'s past accepted' );
	ok( r.crew.sailors.has( WREN.id ) && stepId( r, 'wrensPast' ) === 'wreck', 'she signs on free and the wreck is next' );
	ok( skillCap( r.crew.member( WREN.id ), 'sailing' ) === 60, 'seasick: her sailing is capped at 60' );
	r.s.update( 0.1 );
	const gone = r.f.nearestInteractable( { x: NPCS.wren.spot().x, y: 1, z: NPCS.wren.spot().z } );
	ok( ! gone || gone.id !== 'story:wren', 'aboard with you: she is no longer on the porch' );
	r.moveTo( WRECK, 'walk' );
	r.run( 1 );
	ok( stepId( r, 'wrensPast' ) === 'wreck', 'the wreck from a boat, not swimming' );
	r.crew.member( WREN.id ).absent = { port: 'tidemark' };
	r.moveTo( WRECK, 'boat' );
	r.run( 1 );
	ok( stepId( r, 'wrensPast' ) === 'wreck', 'and with Wren aboard, not asleep in a tavern' );
	r.crew.member( WREN.id ).absent = null;
	r.run( 1 );
	ok( stepId( r, 'wrensPast' ) === 'storm', 'over the Merlin\'s wreck: now the storm' );
	r.weather.kind = 'storm';
	r.run( 15 );
	ok( stepId( r, 'wrensPast' ) === 'storm', 'half a minute in the weather, not fifteen seconds' );
	const json = JSON.parse( JSON.stringify( r.s.toJSON() ) ), cjson = JSON.parse( JSON.stringify( r.crew.toJSON() ) );
	r.run( 16 );
	ok( stepId( r, 'wrensPast' ) === 'home', 'rode it out: back into port' );
	r.f.emit( 'portVisited', { port: 'tidemark' } );
	const w = r.crew.member( WREN.id );
	ok( r.s.isDone( 'wrensPast' ) && ! w.traits.includes( 'seasick' ) && w.traits.includes( 'brave' ) && skillCap( w, 'sailing' ) === 100 && w.skills.sailing >= 50, 'done: Wren is brave, no longer seasick, her sailing cap 100 and +15 sailing' );
	ok( r.toasts.some( ( t ) => /Wren Calloway: I did not heave once/.test( t ) ), 'her thanks come as a note (finished away from her)' );
	const c2 = new Crew();
	c2.fromJSON( JSON.parse( JSON.stringify( r.crew.toJSON() ) ) );
	ok( ! c2.member( WREN.id ).traits.includes( 'seasick' ) && c2.member( WREN.id ).traits.includes( 'brave' ), 'the crew\'s save keeps her new traits' );
	// mid-quest save, and losing her
	const r2 = rig();
	r2.crew.fromJSON( cjson );
	r2.s.fromJSON( json );
	ok( stepId( r2, 'wrensPast' ) === 'storm' && r2.crew.sailors.has( WREN.id ), 'saved in the storm step: still there, Wren still aboard' );
	r2.f.emit( 'crewQuit', { id: WREN.id, name: WREN.name, port: 'tidemark' } );
	ok( ! r2.s.isActive( 'wrensPast' ) && r2.count( 'questFailed', ( e ) => e.id === 'wrensPast' ) === 1, 'she quits (morale): the line fails' );

}

// ---------------------------------------------------------------- 5. Chasing the line: the storm chaser
{

	const r = rig();
	r.st.discover( 'tidemark' );
	ok( r.s.offers( 'oldPepe' ).includes( 'chasingTheLine' ) && r.s.accept( 'chasingTheLine', 'oldPepe' ), 'Old Pepe\'s Chasing the line accepted' );
	r.f.emit( 'frontArrived', { id: 3, from: 'south-west' } );
	ok( stepId( r, 'chasingTheLine' ) === 'meet', 'a front reaching you ashore does not count' );
	r.moveTo( { x: 300, z: 900 }, 'boat' );
	r.f.emit( 'frontArrived', { id: 3, from: 'south-west' } );
	ok( stepId( r, 'chasingTheLine' ) === 'squall', 'met at sea: ride its squall' );
	r.weather.local.squall = 0.6;
	r.run( 10 );
	r.weather.local.squall = 0;
	r.run( 1 );
	r.weather.local.squall = 0.6;
	r.run( 25 );
	ok( stepId( r, 'chasingTheLine' ) === 'squall', 'thrown out of the squall: the half minute starts again' );
	r.run( 6 );
	ok( stepId( r, 'chasingTheLine' ) === 'strike', 'half a minute in the squall: the lightning' );
	r.f.emit( 'lightningStrike', { x: 300, z: 1000, distanceKm: 0.3, delay: 0.9 } );
	ok( stepId( r, 'chasingTheLine' ) === 'strike', 'from a boat it does not count' );
	r.player.mode = 'plane';
	r.f.emit( 'lightningStrike', { x: 300, z: 1300, distanceKm: 0.9, delay: 2.6 } );
	ok( stepId( r, 'chasingTheLine' ) === 'strike', 'flying, but 900 m off: too far' );
	r.f.emit( 'lightningStrike', { x: 300, z: 1200, distanceKm: 0.35, delay: 1 } );
	ok( stepId( r, 'chasingTheLine' ) === 'talk', 'flying, 350 m from a strike: tell Old Pepe' );
	ok( r.s.turnIn( 'chasingTheLine', 'oldPepe' ).done && r.s.items.includes( 'stormGlass' ) && r.s.perk( 'weatherCalm' ) >= 0.05, 'done: Old Pepe\'s storm glass' );
	ok( r.s.canAccept( 'frontLine' ), 'and he will want to hear of the next line (a repeating follow-up)' );
	// the waterspout instead of the strike
	const q = rig();
	q.st.discover( 'tidemark' );
	q.s.accept( 'chasingTheLine', 'oldPepe' );
	q.s.progress.chasingTheLine.step = 2;
	q.moveTo( { x: 500, z: 900 }, 'boat' );
	q.weather.spout = { x: 800, z: 900, r: 20, life: 0.4 };
	q.run( 4 );
	ok( stepId( q, 'chasingTheLine' ) === 'talk', 'or a waterspout seen from 300 m for a few seconds' );

}

// ---------------------------------------------------------------- 6. rumours, boards, the sandbox
{

	const r = rig();
	r.st.discover( 'tidemark' );
	const rum = r.s.rumours( 'tidemark' );
	ok( MAIN.every( ( id ) => rum.some( ( x ) => x.id === 'quest:' + id && x.kind === 'quest' && x.text.length > 20 && Number.isFinite( x.x ) ) ), 'the tavern can tell of all four lines (story.rumours: harbour Tavern.pool patch)' );
	r.f.emit( 'rumourHeard', { kind: 'quest', id: 'quest:diceNight', text: W20_RUMOURS.diceNight.text } );
	ok( r.count( 'questPin', ( e ) => e.id === 'rumour:diceNight' && e.label === 'Brine' ) === 1 && ! r.s.flags.includes( 'blackwaterRumour' ), 'a rumour pins its giver on the map (and is not the Blackwater rumour)' );
	r.s.accept( 'diceNight', 'brine' );
	ok( r.count( 'questPinClear', ( e ) => e.id === 'rumour:diceNight' ) === 1 && ! r.s.rumours( 'tidemark' ).some( ( x ) => x.id === 'quest:diceNight' ), 'taken: the rumour pin goes, the tavern stops telling it' );
	const posts = storyPostings( 'tidemark', r.s, 0 ).map( ( p ) => p.id );
	ok( [ 'kingsWater', 'wrensPast' ].every( ( id ) => posts.includes( 'story:' + id ) ) && ! posts.includes( 'story:diceNight' ) && ! posts.includes( 'story:convoyDuty' ), 'Tidemark\'s board: the lines you can take, not the one running, not the follow-ups yet' );
	ok( storyPostings( 'home', r.s, 0 ).some( ( p ) => p.id === 'story:chasingTheLine' && p.reward.money === 260 ), 'home\'s board posts Old Pepe\'s line with its reward' );
	const sb = rig( { mode: 'sandbox' } );
	ok( MAIN.every( ( id ) => sb.s.canAccept( id ) ), 'the sandbox plays every line at once (only the feature gates hold)' );
	const bare = new Features( { game: { state: new GameState( memStorage() ) }, settings: { timeOfDay: 12 }, mode: 'sandbox' } );
	const s2 = bare.add( 'story', story );
	ok( ! s2.canAccept( 'kingsWater' ) && ! s2.canAccept( 'wrensPast' ) && ! s2.canAccept( 'chasingTheLine' ) && s2.canAccept( 'diceNight' ), 'without the navy, the crew or the weather those lines stay closed; Brine\'s needs none of them' );
	ok( HALE_SPOT.y > 1 && Math.abs( HALE_SPOT.z - 141.2 ) < 2, 'Hale stands on the naval jetty\'s deck' );

}

console.log( `\n${ passes } passed, ${ fails } failed` );
if ( fails ) process.exit( 1 );

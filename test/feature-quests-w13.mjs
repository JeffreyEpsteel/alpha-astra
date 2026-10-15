// Plain-node tests of the wave 13 quest lines (src/features/story StoryData.W13_CHAINS): the seven chains on the real Features
// registry, a real GameState and stub features (seaplane, stronghold, trade, naval, destruction, firearms, pirates). Each
// chain's steps advance on the exact events, rewards apply once, the raid is armed through naval.spawn and lost or won,
// saves round-trip mid-quest, the boards carry the quest notices in the right ports, and the map pins come and go.
//   node test/feature-quests-w13.mjs
import { Features } from '../src/features/Features.js';
import * as story from '../src/features/story/index.js';
import * as notices from '../src/features/notices/index.js';
import { CHAINS, NPCS, ITEMS, KEEPERS, W13_CHAINS, RAID_ID, RAID_PROPS, fenceSpot } from '../src/features/story/StoryData.js';
import { gate, matches, amount, sandboxGate } from '../src/features/story/Rules.js';
import { buildModel } from '../src/features/story/Dialogue.js';
import { journalHTML } from '../src/features/story/DialogueUI.js';
import { QUEST_NOTICES, storyPostings, TYPE_LABEL } from '../src/features/notices/NoticeData.js';
import { GameState } from '../src/game/GameState.js';
import { WORLD } from '../src/world/WorldLayout.js';
import { TRAINING_POST } from '../src/features/melee/MeleeData.js';
import { POUCH } from '../src/features/firearms/FirearmsData.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};
const memStorage = ( m = new Map() ) => ( { getItem: ( k ) => m.get( k ) ?? null, setItem: ( k, v ) => m.set( k, v ) } );
const TM = WORLD.tidemark;
const TM_STAND = WORLD.ports.find( ( p ) => p.id === 'tidemark' ).stand;
const HOME = WORLD.ports.find( ( p ) => p.id === 'home' ).stand;
const HOME_ISLAND = WORLD.islands.find( ( i ) => i.id === 'home' );
const stub = ( obj ) => ( { install: () => obj } );

function rig( { mode = 'campaign', at = HOME, withNotices = false } = {} ) {

	const st = new GameState( memStorage() );
	st.money = 100;
	const toasts = [];
	const player = { position: { x: at.x, y: 1, z: at.z }, mode: 'walk' };
	const app = { game: { state: st, toast: ( t ) => toasts.push( t ) }, settings: { timeOfDay: 12, timeSpeed: 0.01 }, mode, player };
	const f = new Features( app );
	// stubs of the features the quests read (only what the story touches)
	const sp = { owned: false, lost: false, af: 'jade', piloted: false, upgrades: { radio: 0, livery: 0 }, fleet: {}, saved: 0, _mark: null,
		marker() { return this._mark; }, _respec() {}, _save() { this.saved ++; } };
	const sh = { discovered: false, alarm: { state: 'calm' }, batteries: { list: [ { id: 'seaward', silenced: false }, { id: 'channel', silenced: false } ] }, holder: 'pirates', blackFlag: false, market: { sold: 0 } };
	const hold = { powder: 0 };
	const adjusted = [];
	const trade = { contraband: () => ( hold.powder > 0 ? [ { good: 'powder', qty: hold.powder, crates: hold.powder, value: hold.powder * 70 } ] : [] ), credit: { adjust: ( n, why ) => adjusted.push( [ n, why ] ) } };
	const spawned = [], launched = [];
	const naval = {
		ships: [],
		spawn( kind, o ) { const s = { kind, id: o.id, x: o.x, z: o.z, alive: true, state: 'patrol', route: o.route, setState( v ) { this.state = v; } }; this.ships.push( s ); spawned.push( { kind, ...o } ); return s; },
		launchFrom( x, y, z, dir, o ) { launched.push( { x, y, z, dir, o } ); return {}; },
	};
	const pier = TM.dock.position;
	const props = [ 0, 1, 2, 3, 4, 5, 6, 7 ].map( ( i ) => ( { id: `tidemark.prop.${ i }`, port: 'tidemark', state: 'intact', center: { x: pier.x - 10 - i * 3, y: 3, z: pier.z - 5 } } ) );
	props.push( { id: 'home.crate.0', port: 'home', state: 'broken', center: { x: 0, y: 0, z: 0 } } );
	const respawned = [];
	const destruction = { props, respawn( id ) { const p = props.find( ( q ) => q.id === id ); if ( p ) p.state = 'intact'; respawned.push( id ); return true; } };
	const firearms = { shots: 0 };
	const pirates = { _s: 0, standing() { return this._s; } };
	f.add( 'seaplane', stub( sp ) );
	f.add( 'stronghold', stub( sh ) );
	f.add( 'trade', stub( trade ) );
	f.add( 'naval', stub( naval ) );
	f.add( 'destruction', stub( destruction ) );
	f.add( 'firearms', stub( firearms ) );
	f.add( 'pirates', stub( pirates ) );
	const nb = withNotices ? f.add( 'notices', notices ) : null;
	const s = f.add( 'story', story );
	const ev = [];
	for ( const name of [ 'questAccepted', 'questStep', 'questCompleted', 'questFailed', 'questPin', 'questPinClear', 'seaplaneUpgraded' ] ) f.on( name, ( e ) => ev.push( { name, ...e } ) );
	const count = ( n, fn = () => true ) => ev.filter( ( e ) => e.name === n && fn( e ) ).length;
	const moveTo = ( q, mode = 'walk' ) => { player.position.x = q.x; player.position.z = q.z; player.mode = mode; };
	return { st, app, f, s, nb, sp, sh, hold, trade, adjusted, naval, spawned, launched, props, respawned, firearms, pirates, ev, count, toasts, player, moveTo };

}

// ---------------------------------------------------------------- the data
{

	const ids = Object.keys( W13_CHAINS );
	ok( ids.length === 7 && ids.every( ( id ) => CHAINS[ id ] === W13_CHAINS[ id ] ), 'seven wave 13 chains, all in CHAINS' );
	const givers = { ferryToTidemark: 'joe', wings: 'roid', longWayRound: 'brine', blackwaterRumours: 'brine', blackFlag: 'fence', holdTheLine: 'osric', learnToFight: 'ethena' };
	ok( ids.every( ( id ) => W13_CHAINS[ id ].giver === givers[ id ] && NPCS[ givers[ id ] ] ), 'givers: PoorGoat, Captain Roid, Brine (x2), the fence, Osric, Ethena Prosper' );
	ok( ids.every( ( id ) => [ 'offer', 'accept', 'accepted', 'remind', 'thanks' ].every( ( k ) => typeof W13_CHAINS[ id ][ k ] === 'string' && W13_CHAINS[ id ][ k ].length > 8 ) ), 'every chain has its giver\'s lines' );
	ok( ids.every( ( id ) => typeof W13_CHAINS[ id ].reward.journal === 'string' ), 'every chain leaves a journal line' );
	ok( ids.every( ( id ) => W13_CHAINS[ id ].steps.every( ( st ) => !! ( st.on || st.talk || st.reach || st.check || st.deliver ) ) ), 'every step has a way to finish' );
	ok( ids.every( ( id ) => { const r = W13_CHAINS[ id ].reward; return ! r.item || ITEMS[ r.item ]; } ), 'reward items exist' );
	ok( KEEPERS.tidemark === 'osric' && NPCS.osric.port === 'tidemark' && NPCS.brine.port === 'tidemark', 'Tidemark\'s board keeper is Osric; Brine keeps the tavern' );
	const fs = fenceSpot();
	ok( Number.isFinite( fs.x ) && Number.isFinite( fs.z ) && Math.hypot( fs.x - WORLD.islands.find( ( i ) => i.id === 'blackwater' ).center.x, fs.z - WORLD.islands.find( ( i ) => i.id === 'blackwater' ).center.z ) < 300, 'the fence stands on Blackwater' );
	ok( QUEST_NOTICES.every( ( q ) => W13_CHAINS[ q.chain ] && q.ports.length ) && TYPE_LABEL.story === 'Quest', 'quest notices name real chains' );

}

// ---------------------------------------------------------------- the new rules
{

	ok( matches( { is: { result: 'won' } }, { result: 'won' } ) && ! matches( { is: { result: 'won' } }, { result: 'lost' } ), 'is: payload equality' );
	ok( matches( { is: { kind: [ 'a', 'b' ] } }, { kind: 'b' } ) && ! matches( { is: { kind: [ 'a' ] } }, { kind: 'c' } ), 'is: a list of values' );
	ok( matches( { test: ( e ) => e.n > 2 }, { n: 3 } ) && ! matches( { test: ( e ) => e.n > 2 }, { n: 1 } ) && ! matches( { test: () => { throw new Error( 'x' ); } }, {} ), 'test: a predicate (a throw is a no)' );
	ok( amount( { count: 'count' }, { count: 4 } ) === 4, 'count: the payload count' );
	const r = rig();
	ok( ! gate( { corsair: 10 }, r.s.ctx( 'fence' ) ), 'corsair gate closed at standing 0' );
	r.pirates._s = 12;
	ok( gate( { corsair: 10 }, r.s.ctx( 'fence' ) ), 'corsair gate opens at 12' );
	ok( sandboxGate( { chain: 'x', feature: 'seaplane' } )[ 0 ].feature === 'seaplane' && sandboxGate( { chain: 'x' } ) === null, 'the sandbox keeps only feature gates' );

}

// ---------------------------------------------------------------- 1. A ferry to Tidemark (PoorGoat)
{

	const r = rig();
	ok( r.s.offers( 'joe' )[ 0 ] === 'ferryToTidemark', 'PoorGoat pitches the ferry first' );
	ok( r.s.accept( 'ferryToTidemark', 'joe' ) && r.count( 'questPin', ( e ) => e.id === 'quest:ferryToTidemark' ) === 1, 'accepted; the map pin for Tidemark' );
	r.f.emit( 'portVisited', { port: 'pons' } );
	ok( r.s.progress.ferryToTidemark.step === 0, 'another port does not count' );
	r.f.emit( 'portVisited', { port: 'tidemark' } );
	ok( r.s.progress.ferryToTidemark.step === 1, 'ashore at Tidemark: step two' );
	r.moveTo( HOME );
	r.f.emit( 'fishSold', { count: 5, total: 60, port: 'home' } );
	ok( r.s.progress.ferryToTidemark.n === 0, 'a sale at home does not count' );
	r.moveTo( TM_STAND );
	r.f.emit( 'fishSold', { count: 3, total: 40, port: 'home' } );
	r.f.emit( 'fishSold', { count: 2, total: 30, port: 'tidemark' } );
	ok( r.s.progress.ferryToTidemark.step === 2 && r.s.pendingAt( 'brine' ).length === 1, 'five fish sold at Hana\'s hall (by count, wherever the sale port says): Brine is waiting' );
	const before = r.st.money;
	ok( r.s.talkTo( 'brine' ) === true, 'Brine has business' );
	const m = r.s.choose( 'brine', 'turnin:ferryToTidemark' );
	ok( r.s.isDone( 'ferryToTidemark' ) && /PoorGoat sent you/.test( m.said ), 'told: done, and Brine answers in his voice' );
	ok( r.st.money - before === 120 && r.s.items.includes( 'tidemarkFavour' ) && r.s.discount( 'chandler:tidemark' ) === 0.1 && r.s.opens( 'haul:tidemark' ), 'reward: $120, the chandler 10 % off, the market cell open for contracts' );
	ok( r.s.entries[ 0 ] && r.s.entries[ 0 ].id === 'ferryToTidemark' && /Tidemark/.test( journalHTML( r.s.journal() ) ), 'the journal keeps its line' );
	ok( r.count( 'questPinClear', ( e ) => e.id === 'quest:ferryToTidemark' ) === 1, 'the pin is cleared' );
	const money = r.st.money;
	r.f.emit( 'fishSold', { count: 9, total: 90, port: 'tidemark' } );
	ok( r.st.money === money && ! r.s.accept( 'ferryToTidemark' ) && r.s.lastError === 'Already done' && r.count( 'questCompleted' ) === 1, 'rewards apply once' );
	ok( ! r.s.opens( 'engine:strip' ) && r.s.discount( 'kestrel' ) === 0, 'the hangar doors stay shut until Wings' );

}

// ---------------------------------------------------------------- 2. Wings (Captain Roid) and 3. The long way round (Brine)
{

	const r = rig();
	ok( ! r.s.canAccept( 'wings' ), 'Wings waits for the ferry (campaign)' );
	r.s.progress.ferryToTidemark = { s: 'done', at: 0, end: 0 };
	ok( r.s.offers( 'roid' ).includes( 'wings' ), 'then Roid offers it' );
	r.sp.owned = true;
	r.s.accept( 'wings', 'roid' );
	ok( r.s.progress.wings.step === 1, 'a plane already out: the first step holds at once' );
	r.f.emit( 'planeLanded', { onWater: true, x: 0, z: 0 } );
	ok( r.s.progress.wings.step === 1, 'a landing at home does not count' );
	r.f.emit( 'planeLanded', { onWater: true, x: TM.bay.x + 30, z: TM.bay.z } );
	ok( r.s.progress.wings.step === 2, 'down in Tidemark\'s bay' );
	r.sp.piloted = true;
	r.sp._mark = { x: TM.dock.position.x + 100, z: TM.dock.position.z, heading: 0 };
	r.s._poll();
	ok( r.s.isActive( 'wings' ), 'not at the pier yet' );
	r.sp._mark = { x: TM.dock.position.x + 10, z: TM.dock.position.z, heading: 0 };
	r.s._poll();
	ok( r.s.isDone( 'wings' ) && r.s.discount( 'kestrel' ) === 0.2 && r.s.opens( 'engine:strip' ), 'taxied to the pier: the Kestrel 20 % off, the engine upgrade listed' );
	ok( r.toasts.some( ( t ) => /^Captain Roid: /.test( t ) ), 'Roid\'s word comes as a note (finished away from him)' );

	// the long way round: crash -> start again; the grants wait for the Kestrel
	ok( r.s.canAccept( 'longWayRound' ) && r.s.accept( 'longWayRound', 'brine' ), 'Brine\'s bet, after Wings' );
	const strip = TM.airstrip;
	r.sp.af = 'jade';
	r.f.emit( 'planeTookOff', { x: strip.x, z: strip.z } );
	ok( r.s.progress.longWayRound.step === 0, 'not in the Kestrel: no' );
	r.sp.af = 'kestrel';
	r.f.emit( 'planeTookOff', { x: strip.x + 20, z: strip.z } );
	ok( r.s.progress.longWayRound.step === 1, 'off the strip in the Kestrel' );
	r.moveTo( { x: HOME_ISLAND.center.x, z: HOME_ISLAND.center.z }, 'walk' );
	r.s._poll();
	ok( r.s.progress.longWayRound.step === 1, 'walking on the home island is not flying over it' );
	r.player.mode = 'plane';
	r.s._poll();
	ok( r.s.progress.longWayRound.step === 2, 'over the home island in the plane' );
	r.f.emit( 'planeCrashed', { cause: 'rough', x: 0, z: 0 } );
	ok( r.s.progress.longWayRound.step === 0 && r.s.isActive( 'longWayRound' ) && r.toasts.some( ( t ) => /starts again/.test( t ) ), 'a crash: the bet starts again from the airstrip' );
	r.f.emit( 'planeTookOff', { x: strip.x, z: strip.z } );
	r.s._poll();
	r.f.emit( 'planeLanded', { onWater: true, x: strip.x, z: strip.z } );
	ok( r.s.progress.longWayRound.step === 2, 'a water landing is not the strip' );
	r.f.emit( 'planeLanded', { onWater: false, x: strip.x + 40, z: strip.z } );
	ok( r.s.progress.longWayRound.step === 3, 'back down on the strip' );
	r.sp.owned = false; // the Kestrel is not his yet: the paint and the radio wait
	r.s.turnIn( 'longWayRound', 'brine' );
	ok( r.s.isDone( 'longWayRound' ) && r.s.grants.length === 2 && r.sp.upgrades.radio === 0, 'done; the grants wait for an owned Kestrel' );
	r.sp.owned = true;
	r.s._poll();
	ok( r.sp.upgrades.radio === 1 && r.sp.upgrades.livery === 2 && r.s.grants.length === 0 && r.count( 'seaplaneUpgraded' ) === 2, 'then the radio and the livery are fitted free' );
	r.s._poll();
	ok( r.count( 'seaplaneUpgraded' ) === 2, 'and only once' );

}

// ---------------------------------------------------------------- 4. Rumours from Blackwater
{

	const r = rig();
	ok( ! r.s.canAccept( 'blackwaterRumours' ), 'no rumour, no ferry: not yet' );
	r.f.emit( 'rumourHeard', { kind: 'fish', text: '...' } );
	ok( r.s.canAccept( 'blackwaterRumours' ), 'a tavern rumour puts it on the board' );
	r.s.accept( 'blackwaterRumours' );
	const m0 = r.st.money;
	r.sh.discovered = true;
	r.f.emit( 'strongholdDiscovered', {} );
	ok( r.s.progress.blackwaterRumours.step === 1 && r.st.money === m0 && r.s.progress.blackwaterRumours.watch, 'scouted: the fee waits two minutes' );
	r.s._tick( 60 );
	ok( r.st.money === m0, 'one minute: still waiting' );
	r.s._tick( 61 );
	ok( r.st.money === m0 + 150 && ! r.s.progress.blackwaterRumours.watch, 'no bell in two minutes: +$150' );
	r.f.emit( 'batterySilenced', { id: 'seaward' } );
	ok( r.st.money === m0 + 400 && r.s.progress.blackwaterRumours.step === 2, 'a battery silenced: +$250' );
	r.sh.holder = 'player';
	r.f.emit( 'strongholdClaimed', { coins: 2000, by: 'player' } );
	ok( r.s.isDone( 'blackwaterRumours' ) && r.st.money === m0 + 800, 'claimed: +$400, three payouts in all' );

	// the alarm inside the window: no scouting fee, the quest goes on
	const q = rig();
	q.s.flags.push( 'blackwaterRumour' );
	q.s.accept( 'blackwaterRumours' );
	const m1 = q.st.money;
	q.f.emit( 'strongholdDiscovered', {} );
	q.s._tick( 30 );
	q.f.emit( 'strongholdAlarm', { state: 'calm' } );
	ok( !! q.s.progress.blackwaterRumours.watch, 'a calm report does not spoil it' );
	q.f.emit( 'strongholdAlarm', { state: 'alarm', why: 'sighted' } );
	q.s._tick( 200 );
	ok( q.st.money === m1 && q.s.isActive( 'blackwaterRumours' ) && q.s.progress.blackwaterRumours.step === 1, 'the bell inside two minutes: no fee, the work goes on' );
	// already discovered (and the bell ringing) when the quest is taken
	const z = rig();
	z.s.flags.push( 'blackwaterRumour' );
	z.sh.discovered = true;
	z.sh.alarm.state = 'alarm';
	const m2 = z.st.money;
	z.s.accept( 'blackwaterRumours' );
	z.s._tick( 200 );
	ok( z.s.progress.blackwaterRumours.step === 1 && z.st.money === m2, 'already known with the bell ringing: the step passes, no fee' );

}

// ---------------------------------------------------------------- 5. The black flag (the fence)
{

	const r = rig();
	ok( ! r.s.canAccept( 'blackFlag' ), 'the fence wants corsair standing' );
	r.pirates._s = 15;
	ok( r.s.offers( 'fence' ).includes( 'blackFlag' ), 'standing 15: he offers' );
	r.s.accept( 'blackFlag', 'fence' );
	r.sh.blackFlag = true;
	r.f.emit( 'blackFlagBought', { price: 800 } );
	ok( r.s.progress.blackFlag.step === 1, 'the flag bought' );
	r.f.emit( 'contrabandSold', { good: 'powder', qty: 2, total: 200, port: 'blackwater' } );
	r.f.emit( 'contrabandSold', { good: 'relics', qty: 1, total: 150, port: 'elsewhere' } );
	ok( r.s.progress.blackFlag.n === 2, 'two crates at the black market (elsewhere does not count)' );
	r.f.emit( 'contrabandSold', { good: 'powder', qty: 1, total: 100, port: 'blackwater' } );
	ok( r.s.progress.blackFlag.step === 2, 'three crates sold' );
	r.f.emit( 'customsInspected', { port: 'home', found: false, fine: 0, seized: [] } );
	ok( r.s.progress.blackFlag.step === 2, 'a clean inspection with nothing aboard is no smuggling' );
	r.hold.powder = 2;
	r.f.emit( 'customsInspected', { port: 'home', found: true, fine: 50, seized: [ { good: 'powder', qty: 2 } ] } );
	r.f.emit( 'customsInspected', { port: 'home', found: false, dumped: true, seized: [] } );
	r.f.emit( 'customsInspected', { port: 'pons', found: false, seized: [] } );
	ok( r.s.progress.blackFlag.step === 2, 'seized, dumped or at another port: no' );
	r.f.emit( 'customsInspected', { port: 'home', found: false, fine: 0, seized: [] } );
	ok( r.s.isDone( 'blackFlag' ), 'past the home launch with powder still in the hold' );
	ok( r.s.discount( 'powder:blackwater' ) === 0.25 && r.adjusted.length === 1 && r.adjusted[ 0 ][ 0 ] === - 10 && r.s.entries.some( ( e ) => e.id === 'blackFlag' ), 'reward: cheaper powder, merchant standing -10, a journal entry' );

	// ashore at home with contraband (no launch came out) counts too; the fence's sale noticed without its event
	const q = rig();
	q.pirates._s = 30;
	q.sh.blackFlag = true;
	q.s.accept( 'blackFlag' );
	ok( q.s.progress.blackFlag.step === 1, 'flag already flown: the first step holds' );
	q.hold.powder = 5;
	q.s._poll();
	q.sh.market.sold += 300;
	q.hold.powder = 2;
	q.s._poll();
	ok( q.s.progress.blackFlag.step === 2, 'no contrabandSold event: the fence\'s till and the hold show three sold' );
	q.f.emit( 'portVisited', { port: 'home' } );
	ok( q.s.isDone( 'blackFlag' ), 'ashore at home with powder aboard: smuggled' );

}

// ---------------------------------------------------------------- 6. Hold the line (Osric): the raid
{

	const r = rig();
	ok( ! r.s.canAccept( 'holdTheLine' ), 'Osric waits until Tidemark is known' );
	r.st.discover( 'tidemark' );
	ok( r.s.offers( 'osric' ).includes( 'holdTheLine' ), 'then he offers it' );
	r.s.accept( 'holdTheLine', 'osric' );
	ok( r.spawned.length === 0, 'nothing spawns until the player is in the bay' );
	r.moveTo( { x: TM.bay.x - 100, z: TM.bay.z }, 'boat' );
	r.s._poll();
	const sp0 = r.spawned[ 0 ];
	ok( r.s.progress.holdTheLine.step === 1 && sp0 && sp0.id === RAID_ID && sp0.kind === 'sloop' && Math.hypot( sp0.x - TM.bay.x, sp0.z - TM.bay.z ) < 600 && sp0.route.length === 4, 'in the bay: the raid is armed (naval.spawn of a sloop off the bay, on a loop)' );
	const ship = r.naval.ships[ 0 ];
	ship.x = TM.dock.position.x + 120;
	ship.z = TM.dock.position.z;
	r.s._tick( 8 );
	const shot = r.launched[ 0 ];
	ok( shot && shot.o.owner === RAID_ID && shot.dir && Math.abs( Math.hypot( shot.dir.x, shot.dir.y, shot.dir.z ) - 1 ) < 1e-6 && shot.dir.x < 0, 'her guns work the town: naval.launchFrom toward the pier props' );
	ship.x += 1000;
	const n0 = r.launched.length;
	r.s._tick( 8 );
	ok( r.launched.length === n0, 'out of reach: she holds fire' );
	for ( let i = 0; i < RAID_PROPS - 1; i ++ ) { r.props[ i ].state = 'broken'; r.f.emit( 'propDestroyed', { id: r.props[ i ].id, port: 'tidemark', by: 'pirate', x: 0, z: 0 } ); }
	r.f.emit( 'propDestroyed', { id: 'home.crate.0', port: 'home', by: 'pirate' } );
	ok( r.s.isActive( 'holdTheLine' ) && r.s.progress.holdTheLine.f === RAID_PROPS - 1, 'five broken in Tidemark (home does not count): still on' );
	r.f.emit( 'shipSunk', { id: 'other', faction: 'pirate', byPlayer: true } );
	ok( r.s.progress.holdTheLine.step === 1, 'another pirate sunk is not her' );
	r.f.emit( 'shipCrippled', { id: RAID_ID, name: 'Red Gull' } );
	ok( r.s.progress.holdTheLine.step === 2, 'crippled: report to Osric' );
	const m0 = r.st.money;
	r.s.turnIn( 'holdTheLine', 'osric' );
	ok( r.s.isDone( 'holdTheLine' ) && r.st.money - m0 === 300 && r.s.perk( 'gunnerFee' ) === 1, 'reward: $300, the gunners\' post fee waived' );
	ok( r.props.filter( ( p ) => p.port === 'tidemark' ).every( ( p ) => p.state === 'intact' ) && r.respawned.length === RAID_PROPS - 1 && ! r.respawned.includes( 'home.crate.0' ), 'the town repairs itself at once (only Tidemark)' );
	// it recurs from the board a day later
	ok( ! r.s.canAccept( 'holdTheLine' ), 'not again the same day' );
	r.s._ownDay += 1;
	ok( r.s.canAccept( 'holdTheLine' ) && storyPostings( 'tidemark', r.s, 30 ).some( ( p ) => p.id === 'story:holdTheLine' ), 'a day later the board posts it again' );
	ok( r.s.acceptPosting( 'story:holdTheLine' ) && r.s.isActive( 'holdTheLine' ), 'taken again from the board' );
	r.s._poll();
	ok( r.spawned.length === 1, 'she is still afloat: not spawned twice' );
	r.naval.ships.length = 0;
	r.s._failChain( 'holdTheLine', 'test' ); // (reset helper: fail and retake to spawn afresh)
	r.s.acceptPosting( 'story:holdTheLine' );
	r.s._poll();
	ok( r.spawned.length === 2, 'retaken with no raider afloat: a new one' );
	const raider = r.naval.ships[ 0 ];
	const done0 = r.count( 'questFailed' );
	for ( let i = 0; i < RAID_PROPS; i ++ ) r.f.emit( 'propDestroyed', { id: 'tidemark.x' + i, port: 'tidemark', by: 'pirate' } );
	ok( ! r.s.isActive( 'holdTheLine' ) && r.count( 'questFailed' ) === done0 + 1 && raider.state === 'flee' && r.s.items.filter( ( i ) => i === 'gunnerWaiver' ).length === 1, 'six props broken: lost, she sails off (the waiver is not given twice)' );
	ok( r.s.canAccept( 'holdTheLine' ), 'a lost raid can be taken again' );
	r.s.accept( 'holdTheLine' );
	r.s._poll();
	r.s._tick( 950 );
	ok( ! r.s.isActive( 'holdTheLine' ) && r.s.log[ 0 ].outcome === 'failed', 'and it is timed: out of time, failed' );

}

// ---------------------------------------------------------------- 7. Learn to fight (Ethena)
{

	const r = rig();
	ok( r.s.offers( 'ethena' ).includes( 'learnToFight' ), 'Ethena offers it' );
	r.s.accept( 'learnToFight', 'ethena' );
	const pin = r.ev.filter( ( e ) => e.name === 'questPin' && e.chain === 'learnToFight' ).pop();
	ok( pin && Math.hypot( pin.x - TRAINING_POST.x, pin.z - TRAINING_POST.z ) < 1, 'the pin sits on the training post' );
	r.f.emit( 'practiceEnded', { result: 'lost' } );
	r.f.emit( 'practiceEnded', { result: 'left' } );
	ok( r.s.progress.learnToFight.step === 0, 'a lost or left fight does not count' );
	r.f.emit( 'practiceEnded', { result: 'won' } );
	ok( r.s.progress.learnToFight.step === 1, 'practice won' );
	r.f.emit( 'gunHit', { weapon: 'musket', kind: 'raider', target: 'training-post' } );
	r.f.emit( 'gunHit', { weapon: 'pistol', kind: 'raider', target: 'raider-3' } );
	ok( r.s.progress.learnToFight.step === 1, 'a musket, or a pistol at someone else: no' );
	r.f.emit( 'gunHit', { weapon: 'pistol', kind: 'raider', target: 'training-post', x: TRAINING_POST.x, z: TRAINING_POST.z } );
	ok( r.s.progress.learnToFight.step === 2 && r.ev.filter( ( e ) => e.name === 'questPin' && e.chain === 'learnToFight' ).pop().label === 'Ethena Prosper', 'the pistol hit: back to Ethena (pinned at her stall)' );
	r.s.turnIn( 'learnToFight', 'ethena' );
	ok( r.s.isDone( 'learnToFight' ) && r.firearms.shots === POUCH.count && r.s.entries.some( ( e ) => e.id === 'learnToFight' && /parry/i.test( e.text ) ), 'a pouch of cartridges and the parry tip in the journal' );
	const m = buildModel( r.s, 'ethena', 'root' );
	ok( m.choices.some( ( c ) => c.id === 'topic:parry' ), 'Ethena keeps a parry topic' );

}

// ---------------------------------------------------------------- saves mid-quest
{

	const r = rig();
	r.s.flags.push( 'blackwaterRumour' );
	r.s.accept( 'blackwaterRumours' );
	r.f.emit( 'strongholdDiscovered', {} );
	r.s._tick( 50 ); // the fee window is half run
	r.st.discover( 'tidemark' );
	r.s.accept( 'holdTheLine' );
	r.moveTo( { x: TM.bay.x, z: TM.bay.z }, 'boat' );
	r.s._poll();
	r.f.emit( 'propDestroyed', { id: 'a', port: 'tidemark' } );
	r.f.emit( 'propDestroyed', { id: 'b', port: 'tidemark' } );
	r.s._tick( 30 );
	r.s.accept( 'learnToFight' );
	r.f.emit( 'practiceEnded', { result: 'won' } );
	const saved = JSON.parse( JSON.stringify( r.s.toJSON() ) );
	ok( saved.progress.blackwaterRumours.watch && saved.progress.holdTheLine.f === 2 && saved.progress.holdTheLine.t >= 30 && saved.progress.learnToFight.step === 1, 'the save holds the window, the fail count, the timer and the step' );
	const q = rig();
	q.s.fromJSON( saved );
	ok( JSON.stringify( q.s.toJSON() ) === JSON.stringify( saved ), 'save round trip' );
	q.s.update( 0.016 );
	ok( q.spawned.length === 1 && q.spawned[ 0 ].id === RAID_ID, 'loaded mid-raid: the raider is out again' );
	ok( [ 'blackwaterRumours', 'holdTheLine', 'learnToFight' ].every( ( id ) => q.count( 'questPin', ( e ) => e.chain === id ) >= 1 ), 'loaded: the current steps are pinned again' );
	const m0 = q.st.money;
	q.s._tick( 80 );
	ok( q.st.money === m0 + 150, 'the scouting fee window runs on after the load' );
	for ( let i = 0; i < RAID_PROPS - 2; i ++ ) q.f.emit( 'propDestroyed', { id: 'c' + i, port: 'tidemark' } );
	ok( ! q.s.isActive( 'holdTheLine' ), 'the fail count carried over (2 + 4 = 6)' );
	q.f.emit( 'gunHit', { weapon: 'pistol', target: 'training-post' } );
	ok( q.s.progress.learnToFight.step === 2, 'and the practice step carried over' );
	q.s.reset();
	ok( q.count( 'questPinClear' ) >= 2 && Object.keys( q.s.progress ).length === 0 && q.s.entries.length === 0, 'a new game clears the pins and the notes' );

}

// ---------------------------------------------------------------- the boards
{

	const r = rig( { withNotices: true } );
	const home = storyPostings( 'home', r.s, 10 ), tm = storyPostings( 'tidemark', r.s, 10 ), pons = storyPostings( 'pons', r.s, 10 );
	ok( home.some( ( p ) => p.chain === 'ferryToTidemark' ) && home.some( ( p ) => p.chain === 'learnToFight' ) && ! home.some( ( p ) => p.chain === 'holdTheLine' ), 'Hyptile\'s board: the ferry and the practice fight' );
	ok( ! tm.some( ( p ) => p.chain === 'ferryToTidemark' ) && ! tm.some( ( p ) => p.chain === 'holdTheLine' ) && pons.length === 0, 'Tidemark posts nothing it cannot give yet; Pons none' );
	ok( home.every( ( p ) => p.kind === 'quest' && p.type === 'story' && p.id.startsWith( 'story:' ) && p.expires > 10 && p.reward && Number.isFinite( p.reward.money ) ), 'postings are board cards (kind, type, expiry, reward)' );
	r.st.discover( 'tidemark' );
	r.f.emit( 'rumourHeard', { kind: 'port', text: '...' } );
	const tm2 = storyPostings( 'tidemark', r.s, 10 );
	ok( tm2.some( ( p ) => p.chain === 'holdTheLine' ) && tm2.some( ( p ) => p.chain === 'blackwaterRumours' ) && storyPostings( 'home', r.s, 10 ).some( ( p ) => p.chain === 'blackwaterRumours' ), 'then Tidemark posts Hold the line, and both boards the Blackwater rumour' );
	ok( storyPostings( 'tidemark', r.s, 10 ).find( ( p ) => p.chain === 'blackwaterRumours' ).reward.money === 800, 'the rumour\'s card shows its three payouts' );
	r.s.acceptPosting( 'story:ferryToTidemark' );
	ok( r.s.isActive( 'ferryToTidemark' ) && ! storyPostings( 'home', r.s, 10 ).some( ( p ) => p.chain === 'ferryToTidemark' ), 'taken from the board: it comes down' );
	const model = r.nb.model( 'tidemark' );
	ok( model.talk && model.talk.npc === 'osric' && /Quests ·/.test( model.storyHTML ), 'the Tidemark board offers Osric\'s conversation' );

}

// ---------------------------------------------------------------- the sandbox plays everything
{

	const r = rig( { mode: 'sandbox' } );
	ok( Object.keys( W13_CHAINS ).every( ( id ) => r.s.canAccept( id ) ), 'sandbox: every wave 13 chain can be taken at once' );
	r.s.accept( 'holdTheLine' );
	r.moveTo( { x: TM.bay.x, z: TM.bay.z }, 'boat' );
	r.s._poll();
	r.f.emit( 'shipSunk', { id: RAID_ID, faction: 'pirate', byPlayer: true } );
	r.s.turnIn( 'holdTheLine', 'osric' );
	ok( r.s.isDone( 'holdTheLine' ) && r.s.canAccept( 'holdTheLine' ), 'sandbox: the raid can be replayed at once' );
	ok( r.s.opens( 'haul:tidemark' ) && r.s.opens( 'engine:strip' ), 'sandbox: every door open' );

}

console.log( fails ? `\n${ fails } FAILED` : '\nall wave 13 quest tests passed' );
process.exit( fails ? 1 : 0 );

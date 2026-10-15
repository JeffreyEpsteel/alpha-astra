// Plain-node tests of the wave 16 quest lines (src/features/story StoryData.W16_CHAINS): Mayday, Letters of marque and The
// salt road on the real Features registry, a real GameState, the real notices feature and stub rescue / hijack / trade
// features. Each chain's steps advance on the exact events (flaresBought, flareFired, rescueDelivered, castawayRescued;
// vesselTaken, stolenSold / vesselLaundered, captainKilled / bountyClaimed; routeRun, licenceBought, warehouseStored),
// rewards apply once (the free launch for a week, the letter of marque, the guild seal), the castaway survives a save, the
// journal keeps a line per chain and the boards post the quests in the right ports.
//   node test/feature-quests-w16.mjs
import { Features } from '../src/features/Features.js';
import * as story from '../src/features/story/index.js';
import * as notices from '../src/features/notices/index.js';
import { CHAINS, NPCS, ITEMS, W16_CHAINS, CASTAWAY, BULK_LOT, ROUTE_TOP, castawaySpot } from '../src/features/story/StoryData.js';
import { journalHTML } from '../src/features/story/DialogueUI.js';
import { QUEST_NOTICES, W16_NOTICES, storyPostings } from '../src/features/notices/NoticeData.js';
import { GameState } from '../src/game/GameState.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { WORLD } from '../src/world/WorldLayout.js';

let fails = 0, passes = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else { passes ++; console.log( 'ok  ', msg ); }

};
const memStorage = ( m = new Map() ) => ( { getItem: ( k ) => m.get( k ) ?? null, setItem: ( k, v ) => m.set( k, v ) } );
const HOME = WORLD.ports.find( ( p ) => p.id === 'home' ).stand;
const stub = ( obj ) => ( { install: () => obj } );

function rig( { mode = 'campaign', withNotices = false, money = 1000 } = {} ) {

	const st = new GameState( memStorage() );
	st.setMode( mode );
	st.money = money;
	const toasts = [];
	const player = { position: { x: HOME.x, y: 1, z: HOME.z }, mode: 'walk' };
	const app = { game: { state: st, toast: ( t ) => toasts.push( t ) }, settings: { timeOfDay: 12, timeSpeed: 0.01 }, mode, player };
	const f = new Features( app );
	const launched = [];
	const rescue = { flares: 0, firstFree: true, fx: { launch: ( x, y, z, o ) => launched.push( { x, y, z, o } ) } };
	const hijack = { vessel: null };
	const adjusted = [];
	const boardRows = { home: [ { good: 'salt', to: 'pons' }, { good: 'rope', to: 'gull' }, { good: 'rum', to: 'pons' }, { good: 'ice', to: 'key' } ], pons: [ { good: 'timber', to: 'home' } ] };
	const trade = {
		haul: { licence: 0 }, dues: { paid: 0 }, credit: { adjust: ( n, why ) => adjusted.push( [ n, why ] ) },
		board: ( port, n ) => ( boardRows[ port ] || [] ).slice( 0, n ),
	};
	f.add( 'rescue', stub( rescue ) );
	f.add( 'hijack', stub( hijack ) );
	f.add( 'trade', stub( trade ) );
	const nb = withNotices ? f.add( 'notices', notices ) : null;
	const s = f.add( 'story', story );
	const ev = [];
	for ( const name of [ 'questAccepted', 'questStep', 'questCompleted', 'questFailed', 'questPin', 'questPinClear', 'castawayRescued', 'routeRun' ] ) f.on( name, ( e ) => ev.push( { name, ...e } ) );
	const count = ( n, fn = () => true ) => ev.filter( ( e ) => e.name === n && fn( e ) ).length;
	const moveTo = ( q, m = 'walk' ) => { player.position.x = q.x; player.position.z = q.z; player.mode = m; };
	return { st, app, f, s, nb, rescue, hijack, trade, adjusted, launched, ev, count, toasts, player, moveTo };

}

const stepOf = ( r, id ) => ( r.s.progress[ id ] ? r.s.progress[ id ].step : - 1 );

// ---------------------------------------------------------------- the data
{

	const ids = Object.keys( W16_CHAINS );
	ok( ids.length === 3 && ids.every( ( id ) => CHAINS[ id ] === W16_CHAINS[ id ] ), 'three wave 16 chains, all in CHAINS' );
	const givers = { mayday: 'osric', lettersOfMarque: 'osric', saltRoad: 'ethena' };
	ok( ids.every( ( id ) => W16_CHAINS[ id ].giver === givers[ id ] && NPCS[ givers[ id ] ] ), 'givers: Harbourmaster Osric (x2), Ethena Prosper for the guild' );
	ok( ids.every( ( id ) => [ 'offer', 'accept', 'accepted', 'remind', 'thanks' ].every( ( k ) => typeof W16_CHAINS[ id ][ k ] === 'string' && W16_CHAINS[ id ][ k ].length > 8 ) ), 'every chain has its giver\'s lines' );
	ok( ids.every( ( id ) => typeof W16_CHAINS[ id ].reward.journal === 'string' && W16_CHAINS[ id ].steps.every( ( x ) => !! ( x.on || x.talk || x.reach || x.check || x.deliver ) ) ), 'every chain leaves a journal line; every step has a way to finish' );
	ok( ITEMS.letterOfMarque.perk.marque === 1 && ITEMS.guildSeal.perk[ 'off:dues' ] === 0.5 && NPCS.wenna && NPCS.wenna.port === 'tidemark', 'the letter of marque, the guild seal and Wenna (the castaway) exist' );
	ok( W16_CHAINS.lettersOfMarque.requires.chain === 'blackwaterRumours' && W16_CHAINS.mayday.requires.discovered === 'tidemark', 'Letters of marque come after Rumours from Blackwater; Mayday once Tidemark is found' );
	const q = castawaySpot(), T = new TerrainData();
	ok( Number.isFinite( q.x ) && T.heightAt( q.x, q.z ) < - 10 && Math.hypot( q.x - WORLD.tidemark.bay.x, q.z - WORLD.tidemark.bay.z ) > 400, `the castaway is in deep water off Tidemark (${ q.x }, ${ q.z }: ${ T.heightAt( q.x, q.z ).toFixed( 0 ) } m)` );
	ok( W16_NOTICES.every( ( n ) => W16_CHAINS[ n.chain ] && n.ports.length ) && QUEST_NOTICES.every( ( n ) => ! W16_CHAINS[ n.chain ] ), 'the wave 16 notices name the new chains (the wave 13 list is untouched)' );

}

// ---------------------------------------------------------------- 1. Mayday (Osric)
{

	const r = rig();
	ok( ! r.s.canAccept( 'mayday' ), 'Mayday waits for Tidemark (campaign)' );
	r.st.discover( 'tidemark' );
	ok( r.s.offers( 'osric' ).includes( 'mayday' ) && r.s.accept( 'mayday', 'osric' ), 'then Osric offers it; accepted' );
	ok( stepOf( r, 'mayday' ) === 0, 'no flares aboard: the first step waits' );
	r.f.emit( 'flaresBought', { count: 3, price: 45 } );
	ok( stepOf( r, 'mayday' ) === 1, 'flaresBought: step two' );
	r.f.emit( 'flareFired', { x: 0, z: 300, by: 'remote' } );
	ok( stepOf( r, 'mayday' ) === 1, 'another player\'s flare does not count' );
	r.f.emit( 'flareFired', { x: 0, z: 300, by: 'player' } );
	ok( stepOf( r, 'mayday' ) === 2, 'your own flare, fired adrift: step three' );
	r.f.emit( 'rescueDelivered', { by: 'launch', port: 'home', fee: 0, dest: 'boat', tow: false } );
	ok( stepOf( r, 'mayday' ) === 2, 'set aboard your own boat is not the ride in' );
	r.f.emit( 'rescueDelivered', { by: 'launch', port: 'home', fee: 0, dest: 'dock', tow: false } );
	const q = castawaySpot();
	ok( stepOf( r, 'mayday' ) === 3 && r.s.castaway && r.s.castaway.x === q.x && r.s.castaway.z === q.z, 'the ride to the dock: step four, the castaway is in the water' );
	ok( r.launched.length === 1 && r.launched[ 0 ].o.remote && r.toasts.some( ( t ) => /red flare off Tidemark/.test( t ) ), 'her flare goes up (rescue.fx, like another captain\'s) with a toast' );
	ok( r.count( 'questPin', ( e ) => e.id === 'quest:mayday' && Math.abs( e.x - q.x ) < 1 && e.label === 'Red flare' ) === 1, 'the map pins the flare' );
	// the castaway survives a save mid-step
	const json = JSON.parse( JSON.stringify( r.s.toJSON() ) );
	const r2 = rig();
	r2.s.fromJSON( json );
	r2.s.update( 0.1 );
	ok( stepOf( r2, 'mayday' ) === 3 && r2.s.castaway && r2.s.castaway.x === q.x && r2.launched.length === 1, 'saved and loaded: she is still in the water, her flare goes up again' );
	r2.s.update( CASTAWAY.flareEvery + 1 );
	ok( r2.launched.length === 2, `another flare every ${ CASTAWAY.flareEvery } s while you are far` );
	// E beside her, from a boat
	r.moveTo( { x: q.x + 3, z: q.z + 2 }, 'boat' );
	r.s.update( 0.1 );
	const it = r.f.nearestInteractable( { x: q.x + 3, y: 1.2, z: q.z + 2 } );
	ok( it && it.id === 'story:castaway' && /Pull Wenna/.test( it.prompt() ), `E alongside: "${ it && it.prompt() }"` );
	it.onInteract();
	ok( r.count( 'castawayRescued', ( e ) => e.id === 'wenna' && e.by === 'player' && e.x === q.x ) === 1 && ! r.s.castaway && stepOf( r, 'mayday' ) === 4, 'castawayRescued { id: wenna }: she is aboard, the last step is Osric' );
	ok( r.s.pullCastaway() === false && r.count( 'castawayRescued' ) === 1, 'once' );
	const before = r.st.money;
	ok( r.s.turnIn( 'mayday', 'osric' ).done && r.s.isDone( 'mayday' ), 'told Osric: done' );
	ok( r.st.money - before === 180 && r.s.launchFree() && r.s.launchUntil === r.s.day + 7 && r.s.memoryOf( 'wenna' ).rescues === 1, 'reward: $180, the launch free for seven days, Wenna remembers the rescue' );
	ok( r.s.entries.some( ( e ) => e.id === 'mayday' ) && /Mayday/.test( journalHTML( r.s.journal() ) ), 'the journal keeps its line' );
	// the free launch: a fee charged this week comes back
	const m0 = r.st.money;
	r.f.emit( 'rescueDelivered', { by: 'launch', port: 'tidemark', fee: 40, dest: 'dock', tow: false } );
	ok( r.st.money === m0 + 40 && r.toasts.some( ( t ) => /launch is free this week/.test( t ) ), 'a $40 ride this week: refunded' );
	r.s._ownDay += 8;
	r.f.emit( 'rescueDelivered', { by: 'launch', port: 'tidemark', fee: 40, dest: 'dock', tow: false } );
	ok( r.st.money === m0 + 40 && ! r.s.launchFree(), 'a week later the launch charges again' );
	ok( r.count( 'questCompleted', ( e ) => e.id === 'mayday' ) === 1 && ! r.s.accept( 'mayday' ), 'rewards apply once; not offered again' );
	const saved = r.s.toJSON();
	const r3 = rig();
	r3.s.fromJSON( JSON.parse( JSON.stringify( saved ) ) );
	ok( r3.s.launchUntil === r.s.launchUntil && JSON.stringify( r3.s.toJSON() ) === JSON.stringify( saved ), 'the free week survives a save (fromJSON( toJSON() ) round-trips)' );

}

// ---------------------------------------------------------------- 2. Letters of marque (Osric, after Rumours from Blackwater)
{

	const r = rig();
	r.st.discover( 'tidemark' );
	ok( ! r.s.canAccept( 'lettersOfMarque' ), 'not before Rumours from Blackwater' );
	r.s.progress.blackwaterRumours = { s: 'done', at: 0, end: 0 };
	ok( r.s.accept( 'lettersOfMarque', 'osric' ), 'then Osric gives it' );
	r.f.emit( 'vesselTaken', { id: 'm1', faction: 'merchant', by: 'player', hull: 'trawler' } );
	ok( stepOf( r, 'lettersOfMarque' ) === 0, 'a merchant taken does not count' );
	r.f.emit( 'vesselTaken', { id: 'p1', faction: 'pirate', by: 'player', hull: 'sloop', name: 'Red Gull' } );
	ok( stepOf( r, 'lettersOfMarque' ) === 1 && r.count( 'questPin', ( e ) => e.id === 'quest:lettersOfMarque' && e.label === 'The fence' ) === 1, 'a pirate hull taken: step two, the fence pinned' );
	r.f.emit( 'stolenSold', { hull: 'sloop', name: 'Red Gull', price: 12600 } );
	ok( stepOf( r, 'lettersOfMarque' ) === 2, 'sold to the fence: step three' );
	r.f.emit( 'captainKilled', { id: 'c1', captain: 'Skerry Wrack', by: 'other', how: 'sunk' } );
	r.f.emit( 'bountyClaimed', { id: 'b1', target: 'x', reward: 50 } );
	ok( stepOf( r, 'lettersOfMarque' ) === 2, 'another crew\'s kill and a plain board bounty do not count' );
	r.f.emit( 'captainKilled', { id: 'c1', captain: 'Skerry Wrack', by: 'player', how: 'captured' } );
	ok( stepOf( r, 'lettersOfMarque' ) === 3, 'a named captain brought to book: report to Osric' );
	const before = r.st.money;
	r.s.turnIn( 'lettersOfMarque', 'osric' );
	ok( r.s.isDone( 'lettersOfMarque' ) && r.st.money - before === 350 && r.s.items.includes( 'letterOfMarque' ) && r.s.marque(), 'reward: $350 and the letter of marque' );
	// the letter: a pirate hull is a lawful prize
	r.hijack.vessel = { hull: 'sloop', name: 'Black Tern', faction: 'pirate', stolen: true, wanted: true, laundered: false };
	r.f.emit( 'vesselTaken', { id: 'p2', faction: 'pirate', by: 'player', hull: 'sloop', name: 'Black Tern' } );
	ok( r.hijack.vessel.wanted === false && r.hijack.vessel.laundered && r.hijack.vessel.stolen && r.toasts.some( ( t ) => /lawful prize/.test( t ) ), 'then a pirate hull you take is no wanted vessel (the fence still buys her)' );
	r.hijack.vessel = { hull: 'trawler', name: 'Patient Mary', faction: 'merchant', stolen: true, wanted: true, laundered: false };
	r.f.emit( 'vesselTaken', { id: 'm2', faction: 'merchant', by: 'player', hull: 'trawler' } );
	ok( r.hijack.vessel.wanted === true, 'a merchant still is' );
	ok( r.count( 'questCompleted', ( e ) => e.id === 'lettersOfMarque' ) === 1, 'rewards once' );
	// the other ways through: the yard's repaint, a pirates' high bounty
	const r2 = rig();
	r2.st.discover( 'tidemark' );
	r2.s.progress.blackwaterRumours = { s: 'done', at: 0, end: 0 };
	r2.s.accept( 'lettersOfMarque' );
	r2.f.emit( 'vesselTaken', { id: 'p1', faction: 'pirate', by: 'player' } );
	r2.f.emit( 'vesselLaundered', { name: 'Red Gull', hull: 'sloop' } );
	r2.f.emit( 'bountyClaimed', { id: 'hb', target: 'Mad Meg', reward: 900, tier: 3, source: 'pirates' } );
	ok( stepOf( r2, 'lettersOfMarque' ) === 3, 'or repainted at the yard, and a high bounty of the pirates\' board claimed' );

}

// ---------------------------------------------------------------- 3. The salt road (Ethena, the trade guild)
{

	const r = rig();
	r.st.discover( 'tidemark' );
	ok( r.s.offers( 'ethena' ).includes( 'saltRoad' ) && r.s.accept( 'saltRoad', 'ethena' ), 'Ethena offers the salt road; accepted' );
	r.f.emit( 'cargoBought', { good: 'ice', qty: 4, price: 8, port: 'home', total: 32 } );
	ok( ! r.s.runs.some( ( x ) => x.good === 'ice' ), `a load outside the board's top ${ ROUTE_TOP } opens no run` );
	r.f.emit( 'cargoBought', { good: 'salt', qty: 6, price: 9, port: 'home', total: 54 } );
	ok( r.s.runs.length === 1 && r.s.runs[ 0 ].good === 'salt' && r.s.runs[ 0 ].from === 'home' && r.s.runs[ 0 ].to === 'pons', 'salt bought at home (the board\'s best): a run to Pons' );
	r.f.emit( 'cargoSold', { good: 'salt', qty: 6, price: 8, port: 'gull', profit: 10, total: 48 } );
	ok( r.s.progress.saltRoad.n === 0 && r.s.runs.length === 1, 'sold somewhere else: not the route' );
	r.f.emit( 'cargoSold', { good: 'salt', qty: 6, price: 7, port: 'pons', profit: - 4, total: 42 } );
	ok( r.s.progress.saltRoad.n === 0 && r.s.runs.length === 0, 'sold at Pons at a loss: the run is spent, no count' );
	for ( let i = 0; i < 3; i ++ ) {

		r.f.emit( 'cargoBought', { good: 'rope', qty: 5, price: 20, port: 'home', total: 100 } );
		r.f.emit( 'cargoSold', { good: 'rope', qty: 5, price: 30, port: 'gull', profit: 50, total: 150 } );

	}

	ok( r.count( 'routeRun', ( e ) => e.good === 'rope' && e.from === 'home' && e.to === 'gull' && e.profit === 50 ) === 3 && stepOf( r, 'saltRoad' ) === 1, 'three profitable runs (routeRun x3): step two' );
	r.f.emit( 'licenceBought', { level: 1, price: 350 } );
	ok( stepOf( r, 'saltRoad' ) === 2 && r.count( 'questPin', ( e ) => e.id === 'quest:saltRoad' && e.label === 'Tidemark warehouse' ) === 1, 'the licence: step three, the warehouse pinned' );
	r.f.emit( 'warehouseStored', { good: 'salt', qty: BULK_LOT - 1 } );
	ok( stepOf( r, 'saltRoad' ) === 2, `${ BULK_LOT - 1 } units is no bulk lot` );
	r.f.emit( 'warehouseStored', { good: 'salt', qty: BULK_LOT + 2 } );
	ok( stepOf( r, 'saltRoad' ) === 3, `${ BULK_LOT + 2 } units: tell Ethena` );
	const before = r.st.money;
	r.s.turnIn( 'saltRoad', 'ethena' );
	ok( r.s.isDone( 'saltRoad' ) && r.st.money - before === 200 && r.s.items.includes( 'guildSeal' ) && r.s.discount( 'dues' ) === 0.5 && r.adjusted.some( ( a ) => a[ 0 ] === 5 && a[ 1 ] === 'story' ), 'reward: $200, the guild seal (half the dues), merchant standing +5' );
	// the seal: half of a paid fee back; nothing for a fee that became a debt, nothing when Dues applied it
	const m0 = r.st.money;
	r.trade.dues.paid += 20;
	r.f.emit( 'harbourDues', { port: 'pons', fee: 20, waived: null } );
	ok( r.st.money === m0 + 10, 'a $20 docking: $10 back' );
	r.f.emit( 'harbourDues', { port: 'gull', fee: 16, waived: null } );
	ok( r.st.money === m0 + 10, 'dues the purse could not pay (a debt): nothing back' );
	r.trade.dues.paid += 10;
	r.f.emit( 'harbourDues', { port: 'key', fee: 10, waived: null, discount: 0.5 } );
	ok( r.st.money === m0 + 10, 'Dues.js applied the seal itself (discount in the payload): nothing back' );
	r.f.emit( 'routeRun', { good: 'rope', from: 'home', to: 'gull', profit: 50 } );
	ok( r.count( 'questCompleted', ( e ) => e.id === 'saltRoad' ) === 1 && ! r.s.canAccept( 'saltRoad' ), 'rewards once' );
	// a run open across a save
	const r2 = rig();
	r2.st.discover( 'tidemark' );
	r2.s.accept( 'saltRoad' );
	r2.f.emit( 'cargoBought', { good: 'salt', qty: 6, price: 9, port: 'home', total: 54 } );
	const r3 = rig();
	r3.s.fromJSON( JSON.parse( JSON.stringify( r2.s.toJSON() ) ) );
	r3.f.emit( 'cargoSold', { good: 'salt', qty: 6, price: 14, port: 'pons', profit: 30, total: 84 } );
	ok( r3.s.progress.saltRoad.n === 1, 'a run bought before a save counts when it is sold after the load' );

}

// ---------------------------------------------------------------- the boards
{

	const r = rig( { withNotices: true } );
	const has = ( port, chain ) => storyPostings( port, r.s, 10 ).some( ( p ) => p.chain === chain );
	ok( ! has( 'home', 'mayday' ) && ! has( 'home', 'saltRoad' ) && ! has( 'tidemark', 'lettersOfMarque' ), 'nothing posted before Tidemark is found' );
	r.st.discover( 'tidemark' );
	ok( has( 'tidemark', 'mayday' ) && has( 'home', 'mayday' ) && has( 'home', 'saltRoad' ) && has( 'tidemark', 'saltRoad' ) && ! has( 'pons', 'mayday' ), 'Mayday and the salt road on the Hyptile and Tidemark boards, not at Pons' );
	ok( ! has( 'tidemark', 'lettersOfMarque' ), 'the letters wait for the Blackwater rumours' );
	r.s.progress.blackwaterRumours = { s: 'done', at: 0, end: 0 };
	ok( has( 'tidemark', 'lettersOfMarque' ) && ! has( 'home', 'lettersOfMarque' ), 'then Tidemark posts Letters of marque (Tidemark only)' );
	const card = storyPostings( 'tidemark', r.s, 10 ).find( ( p ) => p.chain === 'mayday' );
	ok( card && card.id === 'story:mayday' && card.reward.money === 180 && card.kind === 'quest' && card.slot >= 100 + QUEST_NOTICES.length, 'the Mayday card: id, reward, after the wave 13 cards' );
	const ids = r.nb.board( 'tidemark' ).map( ( n ) => n.id );
	ok( ids.includes( 'story:mayday' ) && ids.includes( 'story:lettersOfMarque' ), 'the Tidemark board feature lists them' );
	r.nb.accept( 'story:mayday' );
	ok( r.s.isActive( 'mayday' ) && ! has( 'tidemark', 'mayday' ), 'taken from the board: running, the card comes down' );

}

// ---------------------------------------------------------------- the sandbox plays everything
{

	const r = rig( { mode: 'sandbox' } );
	ok( Object.keys( W16_CHAINS ).every( ( id ) => r.s.canAccept( id ) ), 'sandbox: every wave 16 chain can be taken at once' );

}

console.log( `\n${ passes } passed, ${ fails } failed` );
process.exit( fails ? 1 : 0 );

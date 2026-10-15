// Plain-node tests of the notice boards and bounty contracts (src/features/notices): the real Features registry and a
// real GameState on a stub app (no DOM, no GPU). Covers deterministic postings, accepting and progress through emitted
// events, expiry, bounty claims, standing, the boards' memory, the save round trip, the HUD html, a fake-DOM run of the
// panel and the physical board's geometry.
//   node test/feature-notices.mjs
import { Features } from '../src/features/Features.js';
import * as notices from '../src/features/notices/index.js';
import {
	generateDay, PORT_INFO, PORT_IDS, MAX_ACTIVE, CANDIDATES, SCRIPTS, QUEST_TYPES, UNLOCK_CHARACTERS, BOARD_SIZE, TIER_NAMES, MEMORY_DROP,
	standingLevel, compassWord, fmtLeft, fmtDistance, openWater, eventDelta, targetMatches, hash32, rng, regionText,
} from '../src/features/notices/NoticeData.js';
import { BOARD_SITES, STALLS } from '../src/features/notices/Sites.js';
import { boardHTML, journalHTML, trackerHTML, whereText, NoticeUI } from '../src/features/notices/NoticeUI.js';
import { NoticeBoard3D, buildFrameGeometry, drawBoardPixels, TEX_W, TEX_H, FACE } from '../src/features/notices/NoticeBoard3D.js';
import { STALL_SITES } from '../src/features/trade/stall.js';
import { GameState } from '../src/game/GameState.js';
import { CHARACTERS } from '../src/game/Characters.js';
import { FISH } from '../src/game/FishTable.js';
import { WORLD } from '../src/world/WorldLayout.js';
import { PATHS, ponsWorld } from '../src/world/terrain/IslandShape.js';
import { TerrainData } from '../src/world/TerrainData.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};
const near = ( a, b, eps = 1e-6 ) => Math.abs( a - b ) <= eps;
const J = ( o ) => JSON.stringify( o );

const memStorage = ( m = new Map() ) => ( { getItem: ( k ) => m.get( k ) ?? null, setItem: ( k, v ) => m.set( k, v ), mem: m } );

// a game: stub app + real GameState + real Features + the notices module, with every notice event recorded
function rig( { seed = null, tod = 9.5, speed = 0.01 } = {} ) {

	const st = new GameState( memStorage() );
	if ( seed !== null ) st.quests.seed = seed;
	const toasts = [];
	const app = { game: { state: st, toast: ( t ) => toasts.push( t ) }, settings: { timeOfDay: tod, timeSpeed: speed }, mode: 'campaign' };
	const f = new Features( app );
	const n = f.add( 'notices', notices );
	const ev = [];
	for ( const name of [ 'bountyAccepted', 'bountyCancelled', 'bountyClaimed', 'noticeAccepted', 'noticeCompleted', 'noticeFailed', 'rewardUnlock', 'noticesRefreshed' ] ) f.on( name, ( e ) => ev.push( { name, ...e } ) );
	return { st, app, f, n, ev, toasts, count: ( name ) => ev.filter( ( e ) => e.name === name ).length, last: ( name ) => [ ...ev ].reverse().find( ( e ) => e.name === name ) };

}

// a valid accepted-notice record to load through fromJSON
function mk( o ) {

	const n = {
		id: o.id || 'home:0:0', port: o.port || 'home', day: 0, slot: 0, kind: o.kind || 'quest', type: o.type, title: o.title || o.type, client: 'Test', text: 'Test notice',
		params: o.params || {}, goal: o.goal ?? 1, reward: { money: o.money ?? 100, rep: o.rep ?? 3, unlock: o.unlock ?? null }, issued: 0, expires: o.expires ?? 60, progress: 0, acceptedAt: 9.5,
	};
	if ( n.kind === 'bounty' ) Object.assign( n, { type: 'bounty', tier: o.tier || 1, target: o.target || 'Gully Marrow, the Tide Rat', captain: o.captain || 'Gully Marrow', epithet: 'the Tide Rat', ship: 'Rusty Gull', craft: 'a patched skiff', region: { x: 100, z: 900, compass: 'south', distance: 870 } } );
	return n;

}
const give = ( r, ...list ) => r.n.fromJSON( { ...r.n.toJSON(), active: list.map( mk ) } );

// ---------------------------------------------------------------- the data
{

	const lines = Object.values( SCRIPTS ).reduce( ( a, l ) => a + l.length, 0 );
	ok( lines >= 30, `${ lines } hand-written errand scripts (30+)` );
	ok( QUEST_TYPES.length === 8 && QUEST_TYPES.every( ( t ) => SCRIPTS[ t ] ), 'every quest type has scripts' );
	ok( QUEST_TYPES.every( ( t ) => PORT_IDS.every( ( p ) => SCRIPTS[ t ].some( ( s ) => s.port === p || s.port === null ) ) ), 'every type has a script for each port' );
	ok( UNLOCK_CHARACTERS.every( ( c ) => CHARACTERS[ c ] && CHARACTERS[ c ].unlock.kind === 'buy' ), 'unlock rewards are real, buyable characters' );
	ok( standingLevel( 0 ) === 0 && standingLevel( 12 ) === 1 && standingLevel( 55 ) === 3 && standingLevel( 100 ) === 4, 'standing levels' );
	ok( compassWord( 0, - 1 ) === 'north' && compassWord( 1, 0 ) === 'east' && compassWord( 0, 1 ) === 'south' && compassWord( - 1, 1 ) === 'south-west', 'compass words (north is -z)' );
	ok( fmtLeft( 0.5 ) === '30 min' && fmtLeft( 14.2 ) === '14 h' && fmtLeft( - 1 ) === 'lapsed' && fmtDistance( 870 ) === '850 m' && fmtDistance( 1400 ) === '1.4 km', 'time and distance formats' );
	ok( ! openWater( 0, - 300 ) && ! openWater( 620, 560 ) && openWater( 100, 900 ), 'open water excludes the islands' );

}

// ---------------------------------------------------------------- generation is deterministic
{

	const a = generateDay( 77, 'home', 3, 2 ), b = generateDay( 77, 'home', 3, 2 );
	ok( J( a ) === J( b ) && a.length === CANDIDATES, `generateDay is a pure function of (seed, port, day, level) (${ a.length } postings)` );
	ok( J( a ) !== J( generateDay( 78, 'home', 3, 2 ) ) && J( a ) !== J( generateDay( 77, 'pons', 3, 2 ) ) && J( a ) !== J( generateDay( 77, 'home', 4, 2 ) ), 'another seed, port or day gives another board' );
	ok( new Set( a.map( ( p ) => p.id ) ).size === a.length && a.every( ( p, i ) => p.id === `home:3:${ i }` ), 'ids are port:day:slot' );
	ok( a.every( ( p ) => p.title && p.text && p.client && p.goal > 0 && p.reward.money >= 25 && p.reward.rep >= 2 && p.expires - p.issued >= 18 && p.issued === 72 && p.roll >= 0 && p.roll < 1 ), 'every posting is complete' );
	ok( a.every( ( p ) => ( p.kind === 'bounty' ) === ( p.type === 'bounty' ) ), 'kinds match types' );

	// across many days: bounties and tiers grow with standing, combat errands are off the board for newcomers
	const stat = ( level ) => {

		let bounties = 0, tiers = 0, first4 = 0, combat = 0, total = 0;
		for ( let d = 0; d < 300; d ++ ) {

			const list = generateDay( 5, d % 2 ? 'home' : 'pons', d, level );
			for ( const p of list ) {

				total ++;
				if ( p.kind === 'bounty' ) { bounties ++; tiers += p.tier; }
				if ( p.type === 'sinkPirate' || p.type === 'shoreRaider' ) combat ++;

			}

			first4 += list.slice( 0, 4 ).filter( ( p ) => p.kind === 'bounty' ).length;

		}

		return { bounties: bounties / 300, tier: bounties ? tiers / bounties : 0, first4: first4 / 300, combat };

	};
	const S = [ 0, 1, 2, 3, 4 ].map( stat );
	ok( S.every( ( x, i ) => i === 0 || x.bounties > S[ i - 1 ].bounties - 0.001 ) && S[ 4 ].bounties > S[ 0 ].bounties + 1, `more bounties as standing rises (${ S.map( ( x ) => x.bounties.toFixed( 2 ) ).join( ' < ' ) } a day)` );
	ok( S.every( ( x, i ) => i < 2 || x.tier > S[ i - 1 ].tier ) && S[ 0 ].tier === 1 && S[ 4 ].tier > 2, `higher tiers as standing rises (mean tier ${ S.map( ( x ) => x.tier.toFixed( 2 ) ).join( ', ' ) })` );
	ok( S[ 0 ].combat === 0 && S[ 2 ].combat > 0, 'no combat errands at standing 0' );
	ok( S[ 0 ].first4 > 0.4 && S[ 0 ].first4 < 0.8, 'a new player sees a bounty on a good share of boards' );

	// bounty postings: named captain with an epithet, a region in open water at the tier's distance, a payout and an expiry
	const all = [];
	for ( let d = 0; d < 120; d ++ ) for ( const port of PORT_IDS ) for ( const p of generateDay( 9, port, d, 4 ) ) if ( p.kind === 'bounty' ) all.push( p );
	const names = new Set( all.map( ( p ) => p.target ) );
	ok( all.length > 200 && names.size > all.length * 0.9, `${ all.length } bounties, ${ names.size } distinct captains` );
	ok( all.every( ( p ) => /^[A-Z][a-z]+ [A-Z][A-Za-z]+, (the |[A-Z])[\w' -]+$/.test( p.target ) && p.target === `${ p.captain }, ${ p.epithet }` ), 'names read like "Gully Marrow, the Tide Rat"' );
	const ranges = [ null, [ 250, 650 ], [ 650, 1300 ], [ 1300, 2200 ] ];
	ok( all.every( ( p ) => {

		const a = PORT_INFO[ p.port ].anchor, dx = p.region.x - a.x, dz = p.region.z - a.z, d = Math.hypot( dx, dz );
		return openWater( p.region.x, p.region.z ) && d >= ranges[ p.tier ][ 0 ] - 15 && d <= ranges[ p.tier ][ 1 ] + 15 && p.region.compass === compassWord( dx, dz ) && Math.abs( p.region.distance - d ) <= 6;

	} ), 'regions: open water, tier distance from the harbour, a matching compass word' );
	ok( all.every( ( p ) => p.text.includes( p.captain ) && p.text.includes( p.craft ) && regionText( p ) === `${ fmtDistance( p.region.distance ) } ${ p.region.compass } of ${ PORT_INFO[ p.port ].name }` ), 'the bounty text names the captain and the craft; its region reads "850 m south-east of Hyptile Harbour"' );
	const pay = [ 0, 1, 2, 3 ].map( ( t ) => { const l = all.filter( ( p ) => p.tier === t ).map( ( p ) => p.reward.money ); return l.length ? [ Math.min( ...l ), Math.max( ...l ) ] : null; } );
	ok( pay[ 1 ][ 1 ] < pay[ 2 ][ 0 ] * 1.2 && pay[ 2 ][ 1 ] < pay[ 3 ][ 0 ] * 1.2 && pay[ 3 ][ 0 ] > 1500, `payouts rise with tier (${ pay.slice( 1 ).map( ( p ) => p.join( '-' ) ).join( ' / ' ) })` );
	ok( all.filter( ( p ) => p.tier === 3 ).every( ( p ) => p.reward.unlock === 'clown' ) && all.some( ( p ) => p.reward.unlock === 'bonk' ), 'tier 3 bounties offer The Clown, some tier 2 offer BONK' );

	// quest types: every type shows up, with sane parameters
	const seen = new Set(), quests = [];
	for ( let d = 0; d < 80; d ++ ) for ( const p of generateDay( 3, 'home', d, 3 ) ) { seen.add( p.type ); if ( p.kind === 'quest' ) quests.push( p ); }
	ok( QUEST_TYPES.every( ( t ) => seen.has( t ) ) && seen.has( 'bounty' ), 'all nine posting types are generated' );
	ok( quests.filter( ( p ) => p.type === 'catchSpecies' ).every( ( p ) => FISH[ p.params.species ] && p.title.startsWith( `Catch ${ p.goal } ` ) ), 'catch errands name a real species' );
	ok( quests.filter( ( p ) => p.type === 'deliverCargo' ).every( ( p ) => p.params.port !== p.port ), 'cargo goes to the other port' );
	ok( quests.filter( ( p ) => p.type === 'visitPort' ).every( ( p ) => p.params.port === PORT_INFO[ p.port ].other ), 'errands send you to the other port' );
	ok( quests.filter( ( p ) => p.type === 'sellFish' ).every( ( p ) => p.params.port === p.port && p.title.includes( '$' + p.goal ) ), 'market days sell at the issuing port' );
	ok( quests.every( ( p ) => ! /\{\w+\}/.test( p.text ) && ! /undefined|NaN/.test( p.text + p.title ) ), 'no unfilled tokens in any text' );
	ok( generateDay( 3, 'home', 1, 0 ).every( ( p ) => p.type !== 'catchSpecies' || ! [ 'tuna', 'mahi', 'redSnapper' ].includes( p.params.species ) ), 'newcomers get no deep-water-only species' );

}

// ---------------------------------------------------------------- the board of a game
{

	const r = rig( { seed: 42 } ), r2 = rig( { seed: 42 } ), r3 = rig( { seed: 43 } );
	const hb = r.n.board( 'home' ), pb = r.n.board( 'pons' );
	ok( hb.length === 4 && pb.length === 4, 'a new game: four postings at each port' );
	ok( J( hb ) === J( r2.n.board( 'home' ) ) && J( pb ) === J( r2.n.board( 'pons' ) ), 'the same save shows the same boards' );
	ok( J( hb ) !== J( r3.n.board( 'home' ) ), 'another save shows another board' );
	ok( hb.every( ( p, i ) => i === 0 || hb[ i - 1 ].expires <= p.expires ) && hb.every( ( p ) => p.left >= 2 && near( p.left, p.expires - r.n.hours ) ), 'sorted by expiry, each with its time left, none about to lapse' );
	ok( hb.every( ( p ) => p.port === 'home' ) && pb.every( ( p ) => p.port === 'pons' ), 'each port lists its own postings' );
	for ( let lv = 0; lv <= 4; lv ++ ) {

		const q = rig( { seed: 42 } );
		q.n.rep.home = [ 0, 12, 30, 55, 80 ][ lv ];
		ok( q.n.board( 'home' ).length === BOARD_SIZE[ lv ], `standing level ${ lv }: ${ BOARD_SIZE[ lv ] } postings listed` );

	}

	ok( BOARD_SIZE.every( ( s ) => s >= 4 && s <= 6 ), 'boards list 4 to 6 postings' );

	// postings persist while valid; new ones fill in as old ones lapse
	const ids0 = new Set( hb.map( ( p ) => p.id ) );
	r.n.advance( 6 );
	const ids1 = r.n.board( 'home' );
	ok( ids1.length === 4 && ids1.filter( ( p ) => ids0.has( p.id ) ).length >= 2, 'six hours on: the board is mostly the same' );
	r.n.advance( 24 );
	const day1 = r.n.board( 'home' );
	ok( r.n.day === 1 && day1.length === 4 && day1.every( ( p ) => p.left >= 2 ), 'a day later: a full board of valid postings' );
	ok( day1.some( ( p ) => p.day === 1 ), 'new postings of the new day have arrived' );
	ok( r.count( 'noticesRefreshed' ) === 1, 'noticesRefreshed on the new day' );
	r.n.advance( 100 );
	ok( r.n.board( 'home' ).length === 4 && r.n.board( 'home' ).every( ( p ) => p.day === r.n.day ), 'after days of neglect only today\'s postings are up' );

}

// ---------------------------------------------------------------- accepting, the active limit, the tracker data
{

	const r = rig( { seed: 42 } );
	const [ a, b, c, d ] = r.n.board( 'home' );
	const got = r.n.accept( a.id );
	ok( got && got.id === a.id && got.progress === 0 && got.acceptedAt === r.n.hours && r.n.active.length === 1, 'accept returns the active notice' );
	ok( ! r.n.board( 'home' ).some( ( p ) => p.id === a.id ) && r.n.board( 'home' ).length === 4, 'an accepted notice leaves the board (another is pinned up)' );
	ok( r.count( 'noticeAccepted' ) === 1 && r.last( 'noticeAccepted' ).id === a.id, 'noticeAccepted emitted' );
	ok( r.n.accept( a.id ) === null && /already/.test( r.n.lastError ), 'the same notice twice is refused' );
	ok( r.n.accept( 'nowhere:0:0' ) === null && r.n.accept( 'home:99:3' ) === null && r.n.accept( 7 ) === null, 'unknown notices are refused' );
	ok( r.n.accept( b.id ) && r.n.accept( c.id ) && r.n.active.length === MAX_ACTIVE, `${ MAX_ACTIVE } notices at a time` );
	ok( r.n.accept( d.id ) === null && /three/i.test( r.n.lastError ) && r.n.active.length === MAX_ACTIVE, 'a fourth is refused with a reason' );
	ok( r.n.accept( r.n.board( 'pons' )[ 0 ].id ) === null, 'still full: another port\'s board does not help' );
	const act = r.n.active;
	act[ 0 ].progress = 99;
	ok( r.n.active[ 0 ].progress === 0, 'active returns copies' );
	ok( r.toasts.some( ( t ) => t.includes( a.title ) || t.includes( 'Contract' ) ), 'the HUD is told (toast)' );

}

// ---------------------------------------------------------------- progress through events, completion and rewards
{

	const run = ( spec, feed, expect ) => {

		const r = rig();
		give( r, spec );
		const before = { money: r.st.money, rep: r.n.rep.home };
		const steps = [];
		for ( const [ name, e ] of feed ) {

			r.f.emit( name, e );
			steps.push( r.n.active.length ? r.n.active[ 0 ].progress : 'done' );

		}

		return { r, steps, before };

	};

	// catchSpecies: only the species counts
	{

		const { r, steps, before } = run( { type: 'catchSpecies', params: { species: 'mullet' }, goal: 2, money: 80, rep: 4 }, [
			[ 'fishCaught', { species: 'grunt', kg: 1 } ], [ 'fishCaught', { species: 'mullet', kg: 1 } ], [ 'fishSold', { total: 50, port: 'home' } ], [ 'fishCaught', { species: 'mullet', kg: 1.2 } ] ] );
		ok( J( steps ) === J( [ 0, 1, 1, 'done' ] ), `catchSpecies: counts mullet only (${ J( steps ) })` );
		ok( r.st.money === before.money + 80 && near( r.n.rep.home, before.rep + 4 ) && r.count( 'noticeCompleted' ) === 1, 'completion pays money and standing and emits noticeCompleted' );
		ok( r.last( 'noticeCompleted' ).reward.money === 80 && r.last( 'noticeCompleted' ).port === 'home' && r.n.stats.completed === 1, 'the completion event carries the reward' );
		ok( r.st.career.earned >= 80 && r.st.xp >= 20, 'earn() and xp (money / 4) were credited' );
		ok( r.toasts.some( ( t ) => t.includes( '$80' ) ), 'the payout is announced' );
		r.f.emit( 'fishCaught', { species: 'mullet', kg: 1 } );
		ok( r.st.money === before.money + 80, 'a finished notice does not pay twice' );

	}

	// catchWeight: over X kg (species optional)
	{

		const { steps } = run( { type: 'catchWeight', params: { kg: 5 }, goal: 1 }, [ [ 'fishCaught', { species: 'jack', kg: 4.9 } ], [ 'fishCaught', { species: 'jack', kg: 5.2 } ] ] );
		ok( J( steps ) === J( [ 0, 'done' ] ), 'catchWeight: any fish over the weight' );
		const s2 = run( { type: 'catchWeight', params: { kg: 5, species: 'tuna' }, goal: 1 }, [ [ 'fishCaught', { species: 'jack', kg: 8 } ], [ 'fishCaught', { species: 'tuna', kg: 6 } ] ] );
		ok( J( s2.steps ) === J( [ 0, 'done' ] ), 'catchWeight: a named species must match' );

	}

	// catchHabitat
	{

		const { steps } = run( { type: 'catchHabitat', params: { habitat: 'reef' }, goal: 2 }, [ [ 'fishCaught', { species: 'tang', kg: 0.3, habitat: 'pier' } ], [ 'fishCaught', { species: 'tang', kg: 0.3, habitat: 'reef' } ], [ 'fishCaught', { species: 'tang', kg: 0.3, habitat: 'reef', aboard: true } ] ] );
		ok( J( steps ) === J( [ 0, 1, 'done' ] ), 'catchHabitat: counts the habitat' );

	}

	// deliverCargo: units sold at the other port
	{

		const { steps } = run( { type: 'deliverCargo', params: { port: 'pons' }, goal: 8 }, [
			[ 'cargoSold', { good: 'rope', qty: 5, price: 10, port: 'home', profit: 5 } ], [ 'cargoSold', { good: 'rope', qty: 5, price: 10, port: 'pons', profit: 5 } ],
			[ 'cargoBought', { good: 'rope', qty: 9, price: 1, port: 'pons' } ], [ 'cargoSold', { good: 'salt', qty: 3, price: 10, port: 'pons', profit: 1 } ] ] );
		ok( J( steps ) === J( [ 0, 5, 5, 'done' ] ), `deliverCargo: units sold at Pons only (${ J( steps ) })` );

	}

	// sellFish: dollars at the issuing port
	{

		const { steps } = run( { type: 'sellFish', params: { port: 'home' }, goal: 100 }, [ [ 'fishSold', { count: 3, total: 40, port: 'pons' } ], [ 'fishSold', { count: 3, total: 60, port: 'home' } ], [ 'fishSold', { count: 9, total: 60, port: 'home' } ] ] );
		ok( J( steps ) === J( [ 0, 60, 'done' ] ), 'sellFish: dollars of sales at that port' );

	}

	// visitPort
	{

		const { steps } = run( { type: 'visitPort', params: { port: 'pons' }, goal: 1 }, [ [ 'portVisited', { port: 'home' } ], [ 'portVisited', { port: 'pons' } ] ] );
		ok( J( steps ) === J( [ 0, 'done' ] ), 'visitPort: reaching the other port' );

	}

	// sinkPirate
	{

		const { steps } = run( { type: 'sinkPirate', goal: 2 }, [
			[ 'shipSunk', { id: 1, name: 'A', faction: 'merchant', byPlayer: true } ], [ 'shipSunk', { id: 2, name: 'B', faction: 'pirate', byPlayer: false } ],
			[ 'shipSunk', { id: 3, name: 'C', faction: 'pirate', byPlayer: true } ], [ 'shipSunk', { id: 4, name: 'D', faction: 'pirate', byPlayer: true } ] ] );
		ok( J( steps ) === J( [ 0, 0, 1, 'done' ] ), 'sinkPirate: only pirates you sank' );

	}

	// shoreRaider
	{

		const { steps } = run( { type: 'shoreRaider', goal: 2 }, [ [ 'enemyDefeated', { id: 1, name: 'gull', kind: 'animal' } ], [ 'enemyDefeated', { id: 2, name: 'Raider', kind: 'raider' } ], [ 'enemyDefeated', { id: 3, name: 'Raider 2' } ] ] );
		ok( J( steps ) === J( [ 0, 1, 'done' ] ), 'shoreRaider: raiders defeated' );

	}

	// events with an odd payload never throw
	{

		const r = rig();
		give( r, { type: 'catchSpecies', params: { species: 'mullet' }, goal: 2 } );
		let threw = false;
		try { r.f.emit( 'fishCaught' ); r.f.emit( 'fishCaught', null ); r.f.emit( 'fishSold', { total: 'a lot' } ); r.f.emit( 'shipSunk', 5 ); } catch ( e ) { threw = true; }
		ok( ! threw && r.n.active[ 0 ].progress === 0, 'odd payloads are ignored' );

	}

	// two notices progress from one event; unlock rewards
	{

		const r = rig();
		give( r, { id: 'home:0:0', type: 'catchSpecies', params: { species: 'mullet' }, goal: 1, money: 50 }, { id: 'home:0:1', type: 'catchWeight', params: { kg: 1 }, goal: 1, money: 70, unlock: 'bonk' } );
		r.f.emit( 'fishCaught', { species: 'mullet', kg: 1.5 } );
		ok( r.n.active.length === 0 && r.st.money === 120 && r.count( 'noticeCompleted' ) === 2, 'one catch can finish two notices' );
		ok( r.count( 'rewardUnlock' ) === 1 && r.last( 'rewardUnlock' ).character === 'bonk' && r.n.awarded.includes( 'bonk' ), 'rewardUnlock { character } is emitted for a unique reward' );
		ok( ! r.st.isUnlocked( 'bonk' ), 'the module does not unlock it itself (the integrator maps the event)' );

	}

}

// ---------------------------------------------------------------- bounties
{

	const r = rig( { seed: 5 } );
	r.n.rep.home = 80;
	r.n.advance( 24 );
	const bounty = r.n.board( 'home' ).find( ( p ) => p.kind === 'bounty' );
	ok( !! bounty, 'a bounty is on the board' );
	const got = r.n.accept( bounty.id );
	const acc = r.last( 'bountyAccepted' );
	ok( got && acc && acc.id === bounty.id && acc.target === bounty.target && acc.tier === bounty.tier && Number.isFinite( acc.region.x ) && Number.isFinite( acc.region.z ), 'accepting a bounty emits bountyAccepted { id, target, tier, region: { x, z } }' );
	ok( acc.region.x === bounty.region.x && acc.region.z === bounty.region.z && acc.captain === bounty.captain && acc.ship === bounty.ship && acc.port === 'home', 'with the captain, ship and port' );
	ok( r.n.accept( r.n.board( 'home' ).find( ( p ) => p.kind === 'bounty' && p.target === bounty.target )?.id ?? 'x' ) === null, 'the same captain cannot be hunted twice' );

	const money0 = r.st.money, rep0 = r.n.rep.home;
	r.f.emit( 'shipSunk', { id: 11, name: 'Some Other Pirate, the Unrelated', faction: 'pirate', x: 0, z: 0, byPlayer: true } );
	r.f.emit( 'shipSunk', { id: 12, name: 'Wrecked Merchant', faction: 'merchant', byPlayer: true, target: 'Nobody' } );
	ok( r.n.active.length === 1 && r.count( 'bountyClaimed' ) === 0 && r.st.money === money0, 'a pirate of another name does not claim the bounty' );
	r.f.emit( 'shipSunk', { id: 13, name: bounty.ship, faction: 'pirate', byPlayer: true } );
	ok( r.n.active.length === 1, 'the ship name alone does not claim it either' );
	r.f.emit( 'shipSunk', { id: 14, name: bounty.ship, faction: 'pirate', target: bounty.target, byPlayer: true } );
	ok( r.n.active.length === 0 && r.count( 'bountyClaimed' ) === 1, 'shipSunk with the matching target claims it' );
	ok( r.st.money === money0 + bounty.reward.money && near( r.n.rep.home, Math.min( 100, rep0 + bounty.reward.rep ) ) && r.n.stats.bounties === 1, 'payout and standing' );
	const claimed = r.last( 'bountyClaimed' );
	ok( claimed.id === bounty.id && claimed.target === bounty.target && claimed.reward.money === bounty.reward.money, 'bountyClaimed { id, target, reward }' );
	ok( r.last( 'noticeCompleted' ).id === bounty.id, 'and noticeCompleted' );

	// the name, the captain or the bounty id alone also match
	for ( const [ label, e ] of [ [ 'name', { name: 'Gully Marrow, the Tide Rat' } ], [ 'captain', { captain: 'gully marrow' } ], [ 'bountyId', { bountyId: 'home:0:0' } ] ] ) {

		const q = rig();
		give( q, { kind: 'bounty', money: 300 } );
		q.f.emit( 'shipSunk', { id: 1, faction: 'pirate', byPlayer: true, ...e } );
		ok( q.n.active.length === 0 && q.count( 'bountyClaimed' ) === 1, `a shipSunk naming the ${ label } claims it` );

	}

	ok( targetMatches( { id: 'a', target: 'X Y, the Z', captain: 'X Y' }, { target: 'x y, the z' } ) && ! targetMatches( { id: 'a', target: 'X Y, the Z', captain: 'X Y' }, { name: 'X' } ), 'targetMatches is exact and case-insensitive' );

	// sunk by someone else: the bounty is lost without a penalty
	{

		const q = rig();
		q.n.rep.home = 20;
		give( q, { kind: 'bounty', money: 300 } );
		q.f.emit( 'shipSunk', { id: 1, faction: 'pirate', target: 'Gully Marrow, the Tide Rat', byPlayer: false } );
		ok( q.n.active.length === 0 && q.count( 'noticeFailed' ) === 1 && q.last( 'noticeFailed' ).reason === 'beaten' && q.count( 'bountyClaimed' ) === 0 && q.st.money === 0, 'a rival\'s kill fails the bounty (beaten), no payout' );
		ok( q.n.rep.home === 20 && q.count( 'bountyCancelled' ) === 1 && q.last( 'bountyCancelled' ).reason === 'beaten', 'no standing lost; the naval feature is told' );
		ok( ! q.n.memory.home.bounty, 'and the board holds no grudge' );

	}

	// abandon and expiry release the target
	{

		const q = rig();
		q.n.rep.home = 20;
		give( q, { kind: 'bounty' } );
		ok( q.n.abandon( 'home:0:0' ) === true && q.n.abandon( 'home:0:0' ) === false, 'abandon works once' );
		ok( q.last( 'bountyCancelled' ).reason === 'abandoned' && q.last( 'bountyCancelled' ).target === 'Gully Marrow, the Tide Rat' && q.last( 'noticeFailed' ).reason === 'abandoned', 'abandoning a bounty emits bountyCancelled { id, target, reason }' );
		ok( q.n.rep.home === 18, 'an abandoned bounty costs 2 standing' );
		give( q, { kind: 'bounty', expires: 12 } );
		q.n.advance( 3 );
		ok( q.n.active.length === 0 && q.last( 'bountyCancelled' ).reason === 'expired' && q.n.rep.home === 14, 'an expired bounty: the target escapes (bountyCancelled expired), 4 standing lost' );

	}

}

// ---------------------------------------------------------------- expiry, failure, memory
{

	const r = rig();
	r.n.rep.home = 10;
	give( r, { id: 'home:0:0', type: 'catchSpecies', params: { species: 'mullet' }, goal: 3, expires: 20 }, { id: 'home:0:1', type: 'sellFish', params: { port: 'home' }, goal: 100, expires: 40 } );
	r.n.advance( 5 );
	ok( r.n.active.length === 2 && r.n.active[ 0 ].left > 5 && r.n.active[ 0 ].left < 6, 'time left counts down in game hours' );
	r.n.advance( 6 );
	ok( r.n.active.length === 1 && r.n.active[ 0 ].id === 'home:0:1', 'the first notice lapses at its expiry' );
	ok( r.last( 'noticeFailed' ).reason === 'expired' && r.n.rep.home === 8 && r.n.stats.failed === 1, 'expiry: noticeFailed, 2 standing lost' );
	ok( r.toasts.some( ( t ) => /lapsed/.test( t ) ), 'the lapse is announced' );
	ok( r.n.abandon( 'home:0:1' ) && r.n.rep.home === 7, 'abandon costs 1 standing' );
	r.n.rep.home = 0;
	give( r, { id: 'home:0:2', type: 'sellFish', params: { port: 'home' }, goal: 100 } );
	r.n.abandon( 'home:0:2' );
	ok( r.n.rep.home === 0, 'standing never goes below 0' );

	// the board remembers: fewer of the failed type for a day
	const q = rig( { seed: 42 } );
	const types = ( list ) => list.map( ( p ) => p.kind === 'bounty' ? 'bounty' : p.type );
	let T = null, victim = null;
	for ( const p of q.n.board( 'home' ) ) {

		const k = p.kind === 'bounty' ? 'bounty' : p.type;
		// a type that has a posting with a low roll (it will be dropped) on the board
		if ( p.roll < MEMORY_DROP[ 1 ] ) { T = k; victim = p; break; }

	}

	ok( !! victim, `a posting with a low roll exists to test the memory (${ victim && victim.id })` );
	ok( q.n.greeting( 'home' ).note === '', 'no grudge at first' );
	const tk = q.n.accept( victim.id );
	q.n.abandon( victim.id );
	const after = q.n.board( 'home' );
	ok( ! after.some( ( p ) => ( p.kind === 'bounty' ? 'bounty' : p.type ) === T && p.roll < MEMORY_DROP[ 1 ] ), 'after abandoning a type the board drops postings of it (deterministically, by their roll)' );
	ok( after.length === 4, 'and pins up others instead' );
	ok( /not forgotten/.test( q.n.greeting( 'home' ).note ) && q.n.greeting( 'pons' ).note === '', 'the keeper says so, at that port only' );
	ok( q.n.memory.home[ T ].n === 1, 'one failure counted' );
	// a second failure: more dropped
	const second = q.n.board( 'home' ).find( ( p ) => ( p.kind === 'bounty' ? 'bounty' : p.type ) === T );
	if ( second ) { q.n.accept( second.id ); q.n.abandon( second.id ); }
	else { give( q, { type: T === 'bounty' ? 'catchSpecies' : T, params: { species: 'mullet' }, goal: 1, kind: T === 'bounty' ? 'bounty' : 'quest' } ); q.n.abandon( 'home:0:0' ); }
	ok( q.n.memory.home[ T ].n === 2, 'repeated failures stack' );
	ok( ! q.n.board( 'home' ).some( ( p ) => ( p.kind === 'bounty' ? 'bounty' : p.type ) === T && p.roll < MEMORY_DROP[ 2 ] ), 'and drop more of that type' );
	q.n.advance( 25 );
	ok( q.n.greeting( 'home' ).note === '', 'a day later it is forgiven' );
	ok( MEMORY_DROP[ 1 ] < MEMORY_DROP[ 2 ] && MEMORY_DROP[ 2 ] < MEMORY_DROP[ 3 ] && types( q.n.board( 'home' ) ).length === 4, 'the drop chance grows with the failures' );

}

// ---------------------------------------------------------------- standing effects
{

	const r = rig( { seed: 42 } );
	ok( r.n.standing( 'home' ).name === 'Newcomer' && r.n.standing( 'pons' ).level === 0, 'everyone starts a Newcomer' );
	give( r, { type: 'sellFish', params: { port: 'home' }, goal: 10, money: 400, rep: 14 } );
	r.f.emit( 'fishSold', { total: 10, port: 'home' } );
	const s = r.n.standing( 'home' );
	ok( s.level === 1 && s.name === 'Known' && r.n.standing( 'pons' ).value === 0, 'finishing a notice raises the standing at that port only' );
	ok( r.toasts.some( ( t ) => /Known/.test( t ) ), 'a new standing is announced' );

	// standing is used for the day's postings at the start of the day (a snapshot), so the board does not reshuffle mid-day
	const q = rig( { seed: 42 } );
	const before = q.n.board( 'home' ).map( ( p ) => p.id ).join();
	q.n.rep.home = 5;
	ok( q.n.board( 'home' ).map( ( p ) => p.id ).join() === before, 'standing gained within level 0 changes nothing' );
	q.n.rep.home = 85;
	ok( q.n.board( 'home' ).length === 6, 'a high standing lists six postings at once' );
	q.n.advance( 24 );
	ok( q.n.snap.home[ 1 ] === 4 && q.n.snap.pons[ 1 ] === 0, 'the next day\'s postings are generated at the standing the day began with' );
	const tiers = [];
	for ( let d = 1; d <= 20; d ++ ) {

		q.n.advance( 24 );
		for ( const p of q.n.board( 'home' ) ) if ( p.kind === 'bounty' ) tiers.push( p.tier );

	}

	ok( tiers.length > 15 && tiers.filter( ( t ) => t >= 2 ).length > tiers.length / 2, `a high standing sees high-tier bounties (${ tiers.length } seen)` );
	ok( q.n.standing( 'pons' ).level === 0 && q.n.board( 'pons' ).every( ( p ) => p.type !== 'sinkPirate' ), 'the other port still treats a stranger as one' );
	// unlock rewards are not offered twice
	const u = rig( { seed: 5 } );
	u.n.rep.home = 90;
	u.n.advance( 24 );
	const withClown = [];
	for ( let d = 0; d < 30; d ++ ) { u.n.advance( 24 ); for ( const p of u.n.board( 'home' ) ) if ( p.reward.unlock === 'clown' ) withClown.push( p ); }
	ok( withClown.length > 0, 'The Clown is offered on tier 3 bounties' );
	u.n.awarded.push( 'clown' );
	let still = 0;
	for ( let d = 0; d < 10; d ++ ) { u.n.advance( 24 ); for ( const p of u.n.board( 'home' ) ) if ( p.reward.unlock === 'clown' ) still ++; }
	ok( still === 0, 'once awarded (or unlocked) it is not offered again' );
	u.st.unlockCharacter( 'bonk', { free: true } );
	ok( ! u.n.board( 'home' ).concat( u.n.board( 'pons' ) ).some( ( p ) => p.reward.unlock === 'bonk' ), 'an unlocked character is never offered' );

}

// ---------------------------------------------------------------- the clock follows the island's
{

	const r = rig( { tod: 9.5, speed: 0.01 } );
	r.n.update( 0.016 );
	const h0 = r.n.hours;
	r.app.settings.timeOfDay += 0.5;
	r.n.update( 50 );
	ok( near( r.n.hours - h0, 0.5, 1e-9 ), 'in-game hours advance with the island clock' );
	r.app.settings.timeOfDay = 4; // a slider / load jump
	r.n.update( 0.016 );
	ok( r.n.hours - h0 < 0.51, 'a jump of the clock is not time passing' );
	r.app.settings.timeOfDay = 23.9;
	r.n.update( 0.016 );
	r.app.settings.timeOfDay = 0.1;
	r.n.update( 20 );
	ok( near( r.n.hours - h0, 0.5 + 0.2, 0.02 ) || r.n.hours - h0 < 1, 'it wraps across midnight' );
	const p = rig( { speed: 0 } );
	p.n.update( 1 ); p.n.update( 100 );
	ok( p.n.hours === 9.5, 'paused time: the notices wait' );
	const bare = rig();
	delete bare.app.settings;
	bare.n.update( 100 );
	ok( near( bare.n.hours, 9.5 + 1, 1e-9 ), 'without settings it falls back to the default day speed' );
	// accepted notices expire as update() moves the clock
	const e = rig();
	give( e, { type: 'sellFish', params: { port: 'home' }, goal: 100, expires: 10 } );
	e.n.update( 0.016 );
	for ( let i = 0; i < 60; i ++ ) { e.app.settings.timeOfDay += 0.01 * 10; e.n.update( 10 ); }
	ok( e.n.active.length === 0 && e.last( 'noticeFailed' ).reason === 'expired', 'update() expires notices as game time passes' );

}

// ---------------------------------------------------------------- save round trip
{

	const r = rig( { seed: 9 } );
	r.n.rep.home = 33; r.n.rep.pons = 12.5;
	r.n.advance( 30 );
	const [ a, b ] = r.n.board( 'home' );
	r.n.accept( a.id );
	r.n.accept( b.id );
	give( r, ...r.n.active.map( ( n ) => n ), { id: 'pons:1:2', port: 'pons', kind: 'bounty', money: 900, tier: 2, rep: 11 } );
	r.f.emit( 'fishCaught', { species: 'mullet', kg: 1 } );
	r.n.abandon( 'pons:1:2' );
	give( r, ...r.n.active.map( ( n ) => n ), { id: 'pons:1:3', port: 'pons', kind: 'bounty', money: 900, tier: 2, rep: 11, target: 'Orrin Wrack, Red Anchor', captain: 'Orrin Wrack' } );
	r.n.awarded.push( 'pepe' );
	r.n.stats.completed = 4;
	const json = r.n.toJSON();
	const text = JSON.stringify( json );
	const copy = JSON.parse( text );
	const r2 = rig( { seed: 9 } );
	r2.n.fromJSON( copy );
	ok( J( r2.n.toJSON() ) === text, 'toJSON -> fromJSON -> toJSON is identical' );
	ok( J( r2.n.board( 'home' ) ) === J( r.n.board( 'home' ) ) && J( r2.n.board( 'pons' ) ) === J( r.n.board( 'pons' ) ), 'the boards are identical after a load' );
	ok( J( r2.n.active ) === J( r.n.active ) && r2.n.active.length === 3 && r2.n.rep.home === r.n.rep.home && r2.n.rep.pons === r.n.rep.pons && r2.n.rep.pons < 12.5 && r2.n.hours === r.n.hours, 'active notices, standing and the clock survive' );
	ok( J( r2.n.memory ) === J( r.n.memory ) && r2.n.awarded.includes( 'pepe' ) && r2.n.stats.completed === 4, 'the memory, awards and stats survive' );
	ok( r2.n.accept( a.id ) === null, 'a notice taken before the save stays taken' );
	// through the registry: Features.toJSON / fromJSON at add() time
	const reg = r.f.toJSON();
	ok( reg.notices && reg.notices.v === 1, 'Features.toJSON carries the module\'s part' );
	const st = new GameState( memStorage() );
	const app = { game: { state: st, toast() {} }, settings: { timeOfDay: 12, timeSpeed: 0.01 } };
	const f3 = new Features( app );
	f3.fromJSON( reg );
	const n3 = f3.add( 'notices', notices );
	ok( J( n3.toJSON() ) === text, 'a module added after the save was read restores it' );
	// bounties are re-announced after a load so the naval feature can respawn them
	const ev3 = [];
	f3.on( 'bountyAccepted', ( e ) => ev3.push( e ) );
	n3.update( 0.016 );
	n3.update( 0.016 );
	const bounties = n3.active.filter( ( n ) => n.kind === 'bounty' );
	ok( bounties.length >= 1 && ev3.length === bounties.length && ev3.every( ( e ) => e.resumed === true ), `after a load each active bounty is announced once (resumed) (${ ev3.length })` );

	// hostile data
	const bad = rig();
	let threw = false;
	for ( const junk of [ null, 5, 'x', [], { active: 'no' }, { active: [ null, 3, { id: 1 }, { id: 'home:0:0', port: 'moon', kind: 'quest', type: 'catchSpecies', goal: 1, expires: 5 } ] }, { rep: { home: 'lots', pons: - 5 }, hours: 'late', taken: [ 1, {} ], memory: { home: { nope: { n: 99, until: 1 } } }, snap: { home: { x: 3 } }, awarded: [ 'hacker' ] } ] ) {

		try { bad.n.fromJSON( junk ); } catch ( e ) { threw = true; console.log( e ); }

	}

	ok( ! threw && bad.n.active.length === 0 && bad.n.rep.pons === 0 && Number.isFinite( bad.n.hours ) && ! bad.n.awarded.includes( 'hacker' ), 'junk save data is ignored safely' );
	const cap = rig();
	cap.n.fromJSON( { active: [ 1, 2, 3, 4, 5 ].map( ( i ) => mk( { id: `home:0:${ i }`, type: 'visitPort', params: { port: 'pons' } } ) ) } );
	ok( cap.n.active.length === MAX_ACTIVE, 'a save cannot hold more than the limit' );
	const clamp = rig();
	clamp.n.fromJSON( { active: [ { ...mk( { type: 'visitPort', params: { port: 'pons' } } ), progress: 99, reward: { money: - 5, rep: 'x', unlock: 'root' } } ] } );
	const c0 = clamp.n.active[ 0 ];
	ok( c0.progress === 1 && c0.reward.money === 0 && c0.reward.unlock === null, 'progress and rewards are clamped on load' );

	// reset (a new game)
	const q = rig();
	give( q, { kind: 'bounty' } );
	q.n.rep.home = 40;
	q.n.reset();
	ok( q.n.active.length === 0 && q.n.rep.home === 0 && q.n.taken.size === 0 && q.last( 'bountyCancelled' ).reason === 'reset', 'reset: a clean slate, running bounties released' );
	ok( q.n.board( 'home' ).length === 4, 'and a fresh board' );

}

// ---------------------------------------------------------------- the registry: events, interactables, keys, update
{

	const r = rig();
	const home = BOARD_SITES.home, pons = BOARD_SITES.pons;
	const near1 = r.f.nearestInteractable( { x: home.x + 1, y: 2, z: home.z + 1 } );
	ok( near1 && near1.id === 'notices:home' && near1.prompt() === 'Read the Hyptile notice board', 'an interactable at the Hyptile board' );
	const near2 = r.f.nearestInteractable( { x: pons.x, y: 2, z: pons.z + 1 } );
	ok( near2 && near2.id === 'notices:pons' && /Pons/.test( near2.prompt() ), 'and at the Pons board' );
	ok( r.f.nearestInteractable( { x: home.x + 40, y: 2, z: home.z } ) === null, 'only within reach' );
	ok( ( near1.onInteract(), r.n.open === false ), 'interacting headless does nothing and does not throw' );
	const warn = console.warn;
	console.warn = () => {};
	const refused = ! r.f.claimKey( 'KeyJ', 'other' );
	console.warn = warn;
	ok( refused && r.f.claimKey( 'KeyJ', 'notices' ), 'the module holds KeyJ (the journal)' );
	r.f.update( 0.016 );
	r.f.dispose();
	ok( r.f.nearestInteractable( { x: home.x, y: 2, z: home.z } ) === null, 'dispose removes the interactables' );
	// an installed module does not break a stub without game state
	const bare = new Features( {} );
	const n = bare.add( 'notices', notices );
	bare.update( 1 );
	bare.emit( 'fishCaught', { species: 'mullet', kg: 1 } );
	ok( n && n.board( 'home' ).length === 4 && n.accept( n.board( 'home' )[ 0 ].id ), 'it also runs on an empty app (no state, no settings)' );
	const event = new Features( {} );
	event.add( 'notices', notices );
	const nn = event.get( 'notices' );
	nn.accept( nn.board( 'pons' )[ 0 ].id );
	let money = null;
	ok( ( () => { give( { n: nn }, { type: 'visitPort', params: { port: 'home' }, goal: 1, port: 'pons', id: 'pons:0:9', money: 10 } ); event.emit( 'portVisited', { port: 'home' } ); return nn.active.length === 0; } )(), 'completion without a game state still works (no money)' );

}

// ---------------------------------------------------------------- html
{

	const r = rig( { seed: 42 } );
	r.n.rep.home = 30;
	r.n.advance( 24 );
	const m = r.n.model( 'home' );
	const html = boardHTML( m );
	ok( /notice board/.test( html ) && m.postings.every( ( p ) => html.includes( `data-accept="${ p.id }"` ) && html.includes( p.kind === 'bounty' ? p.target : p.title ) ), 'the board lists every posting with its accept button' );
	ok( /Harbourmaster Orla/.test( html ) && /Regular/.test( html ) && /Hyptile/.test( html ) && /Pons/.test( html ), 'with the keeper, and the standing at both ports' );
	ok( m.postings.some( ( p ) => p.kind === 'bounty' ) ? /last known \d[\d.]* (m|km) [a-z-]+ of Hyptile Harbour/.test( html ) && /★/.test( html ) && /Harbour nuisance|Open-sea corsair|Notorious captain/.test( html ) : true, 'bounty cards show tier and last known region' );
	ok( /\d+ h left/.test( html ) && /data-exp="/.test( html ), 'expiry timers in in-game hours' );
	ok( ! /disabled/.test( html.replace( /data-close/g, '' ) ), 'accept is enabled with room' );
	for ( const p of r.n.board( 'home' ).slice( 0, 3 ) ) r.n.accept( p.id );
	const full = boardHTML( r.n.model( 'home' ) );
	ok( /Your notices · 3 of 3/.test( full ) && ( full.match( /data-accept="[^"]+" disabled/g ) || [] ).length === r.n.board( 'home' ).length && /data-abandon=/.test( full ), 'with three taken: accept is disabled, drop buttons appear' );
	const tr = trackerHTML( r.n.active, r.n.hours, 3 );
	ok( ( tr.match( /nb-t-item/g ) || [] ).length === 3 && /3 \/ 3/.test( tr ) && /nb-bar/.test( tr ), 'the tracker shows three notices with bars' );
	ok( trackerHTML( [], 0, 3 ) === '', 'and nothing when there are none' );
	const jr = journalHTML( r.n.model( 'home' ), r.n.notes, r.n.stats );
	ok( /Journal/.test( jr ) && /Your notices/.test( jr ), 'the journal' );
	const evil = rig();
	give( evil, { type: 'visitPort', title: '<img src=x onerror=alert(1)>', params: { port: 'pons' } } );
	ok( ! /<img/.test( trackerHTML( evil.n.active, evil.n.hours, 3 ) ) && ! /<img/.test( boardHTML( evil.n.model( 'home' ) ) ), 'text is escaped' );
	const bq = rig();
	give( bq, { kind: 'bounty' } );
	const bn = bq.n.active[ 0 ];
	ok( whereText( bn ) === 'south 850 m' && whereText( bn, { x: 100, z: - 100 } ) === 'south 1.0 km' && whereText( bn, { x: 100, z: 850 } ) === 'search here' && whereText( bn, { x: - 1000, z: 900 } ) === 'east 1.1 km', 'bounty bearing: from the harbour, or live from the player' );
	ok( /search here/.test( trackerHTML( bq.n.active, bq.n.hours, 3, { x: 100, z: 850 } ) ) && /south 850 m/.test( trackerHTML( bq.n.active, bq.n.hours, 3 ) ), 'shown in the tracker' );
	ok( NoticeUI.create( r.n ) === null, 'no panel without a DOM' );

}

// ---------------------------------------------------------------- the panel and the tracker in a fake DOM
{

	class El {

		constructor( tag ) {

			this.tag = tag; this.children = []; this.className = ''; this.innerHTML = ''; this.dataset = {}; this._l = {}; this.parent = null; this.id = '';
			const set = new Set();
			this.classes = set;
			this.classList = { add: ( c ) => set.add( c ), remove: ( c ) => set.delete( c ), contains: ( c ) => set.has( c ), toggle: ( c, on ) => ( on === undefined ? ( set.has( c ) ? set.delete( c ) : set.add( c ) ) : on ? set.add( c ) : set.delete( c ) ) };

		}

		append( ...k ) { for ( const x of k ) { this.children.push( x ); x.parent = this; } }
		remove() { if ( this.parent ) this.parent.children = this.parent.children.filter( ( c ) => c !== this ); }
		addEventListener( t, fn ) { ( this._l[ t ] = this._l[ t ] || [] ).push( fn ); }
		removeEventListener( t, fn ) { this._l[ t ] = ( this._l[ t ] || [] ).filter( ( f ) => f !== fn ); }
		querySelectorAll() { return []; }

	}

	const winHandlers = [];
	globalThis.document = { createElement: ( t ) => new El( t ), getElementById: () => null, head: new El( 'head' ), pointerLockElement: null };
	globalThis.window = { addEventListener: ( t, fn, cap ) => winHandlers.push( { t, fn, cap } ), removeEventListener: ( t, fn ) => { const i = winHandlers.findIndex( ( h ) => h.fn === fn ); if ( i >= 0 ) winHandlers.splice( i, 1 ); } };
	const r = rig( { seed: 42 } );
	const root = new El( 'root' ), hud = new El( 'hud' );
	r.app.game.hud = { ui: { root, hud } };
	const near = BOARD_SITES.home;
	const entry = r.f.nearestInteractable( { x: near.x, y: 2, z: near.z + 1 } );
	entry.onInteract();
	const ui = r.n.ui;
	ok( r.n.open === true && ui.panel.classes.has( 'is-open' ) && /notice board/.test( ui.panel.innerHTML ), 'E at the board opens the panel' );
	ok( root.children.includes( ui.panel ) && hud.children.includes( ui.tracker ) && ui.tracker.classes.has( 'is-empty' ), 'the panel is on the HUD root, the (empty) tracker beside the purse' );
	ok( r.f.nearestInteractable( { x: near.x, y: 2, z: near.z + 1 } ) === null, 'the prompt hides while the panel is open' );
	const first = r.n.board( 'home' )[ 0 ];
	const click = ( attrs ) => ui._onClick( { target: { closest: () => ( { hasAttribute: ( k ) => k in attrs && attrs[ k ] === true, dataset: attrs } ) } } );
	click( { accept: first.id } );
	ok( r.n.active.length === 1 && r.n.active[ 0 ].id === first.id, 'the Accept button takes the notice' );
	ok( ! ui.tracker.classes.has( 'is-empty' ) && /nb-t-item/.test( ui.tracker.innerHTML ) && /data-abandon/.test( ui.panel.innerHTML ), 'the tracker and the panel update' );
	click( { abandon: first.id } );
	ok( r.n.active.length === 0 && ui.tracker.classes.has( 'is-empty' ), 'the Drop button abandons it' );
	for ( const p of r.n.board( 'home' ).slice( 0, 4 ) ) click( { accept: p.id } );
	ok( r.n.active.length === 3 && r.toasts.some( ( t ) => /three notices/.test( t ) ), 'the fourth click is refused with a message' );
	const keydown = winHandlers.find( ( h ) => h.t === 'keydown' );
	let swallowed = 0;
	keydown.fn( { code: 'Escape', repeat: false, preventDefault() {}, stopPropagation() { swallowed ++; } } );
	ok( ! r.n.open && ! ui.panel.classes.has( 'is-open' ) && swallowed === 1, 'Escape closes it (and is swallowed)' );
	keydown.fn( { code: 'Escape', repeat: false, preventDefault() {}, stopPropagation() { swallowed ++; } } );
	ok( swallowed === 1, 'a closed panel lets keys through' );
	r.app.input = { hit: ( c ) => c === 'KeyJ' };
	r.n.update( 0.016 );
	ok( r.n.open && ui.view === 'journal' && /Journal/.test( ui.panel.innerHTML ), 'J opens the journal from anywhere' );
	r.app.input = { hit: () => false };
	keydown.fn( { code: 'KeyJ', repeat: false, preventDefault() {}, stopPropagation() {} } );
	ok( ! r.n.open, 'J closes it' );
	r.n.openBoard( 'pons' );
	r.app.player = { position: { x: BOARD_SITES.pons.x + 40, z: BOARD_SITES.pons.z } };
	r.n.update( 0.016 );
	ok( ! r.n.open, 'walking away closes the board' );
	r.n.openBoard( 'home' );
	ok( r.n.isOpen === true && r.f.panelOpen() === true, 'an open board is a panel open for the registry (blocks fishing input)' );
	r.f.closePanels();
	ok( r.n.isOpen === false && r.f.panelOpen() === false, 'the registry closes it on Escape through close()' );
	r.n.update( 2 );
	r.f.dispose();
	ok( winHandlers.length === 0 && root.children.length === 0 && hud.children.length === 0, 'dispose removes the DOM and the key handler' );
	delete globalThis.document; delete globalThis.window;

}

// ---------------------------------------------------------------- the physical boards
{

	const frame = buildFrameGeometry();
	frame.computeBoundingBox();
	const bb = frame.boundingBox, tris = frame.index.count / 3;
	ok( tris > 100 && tris < 600, `the frame is one small mesh (${ tris } triangles)` );
	ok( bb.min.y < 0 && bb.max.y > 2.5 && bb.max.y < 3.2 && bb.max.x - bb.min.x > 2.9 && bb.max.x - bb.min.x < 3.5, 'about 3 m wide and 2.8 m tall, posts sunk into the ground' );
	ok( [ 'position', 'normal', 'uv', 'color', 'aux' ].every( ( k ) => frame.attributes[ k ] ), 'in the prop material\'s vertex layout' );

	const scene = { children: [], add( o ) { this.children.push( o ); o.parent = this; }, remove( o ) { this.children = this.children.filter( ( c ) => c !== o ); o.parent = null; } };
	const boxes = [];
	const colliders = { addBox: ( c, h, ry, o ) => boxes.push( { c, h, ry, o } ) };
	const terrain = { heightAt: () => 2.4 };
	const board = new NoticeBoard3D( { scene, terrain, colliders, site: BOARD_SITES.home, port: 'home' } );
	ok( board.meshes.length === 2 && scene.children.length === 1 && board.group.children.length === 2, 'a board is two meshes: the frame and the face (two draw calls)' );
	ok( near( board.group.position.x, BOARD_SITES.home.x ) && near( board.group.position.y, 2.4 ) && near( board.group.rotation.y, BOARD_SITES.home.yaw ), 'it stands on the terrain at its site, facing like the stall' );
	ok( boxes.length === 1 && boxes[ 0 ].o.tag === 'noticeBoard' && near( boxes[ 0 ].c.y, 3.8 ), 'it is solid (one collider)' );
	const r = rig( { seed: 42 } );
	r.n.rep.home = 85;
	const list = r.n.board( 'home' );
	ok( board.refresh( list ) === true && board.refresh( list ) === false, 'refresh redraws only when the postings change' );
	ok( board.tex.width === TEX_W && board.tex.height === TEX_H && board.tex.pendingData && board.tex.pendingData.length === TEX_W * TEX_H * 4, 'the face texture holds the picture' );
	const px = drawBoardPixels( list, 'home' ), blank = drawBoardPixels( [], 'home' );
	let diff = 0;
	for ( let i = 0; i < px.data.length; i += 97 ) if ( px.data[ i ] !== blank.data[ i ] ) diff ++;
	ok( diff > 500 && px.data.every( ( v, i ) => i % 4 !== 3 || v === 255 ), 'the pinned notes are drawn, and the face is opaque' );
	ok( FACE.w / FACE.h > 1.7 && near( TEX_W / TEX_H, FACE.w / FACE.h, 0.05 ), 'the texture keeps the face\'s proportions' );
	board.dispose();
	ok( scene.children.length === 0, 'dispose takes it off the scene' );

	// through the module: boards are built lazily once the app has a scene and terrain
	const lazy = rig( { seed: 42 } );
	const sc2 = { children: [], add( o ) { this.children.push( o ); } };
	lazy.n.update( 0.016 );
	ok( lazy.n.world === null, 'no scene: no boards' );
	lazy.app.scene = sc2; lazy.app.terrainData = terrain; lazy.app.colliders = colliders;
	lazy.n.update( 0.016 );
	ok( lazy.n.world && lazy.n.world.home && lazy.n.world.pons && lazy.n.world.tidemark && sc2.children.length === PORT_IDS.length, 'with a scene and terrain, every board (Hyptile, Pons, Tidemark) is built on the first update' );
	const sig = lazy.n.world.home.sig;
	lazy.n.accept( lazy.n.board( 'home' )[ 0 ].id );
	lazy.n.update( 2 );
	ok( lazy.n.world.home.sig !== sig, 'and the home board is redrawn when a notice is taken' );

}

// ---------------------------------------------------------------- where the boards stand
{

	const terrain = new TerrainData();
	const sites = BOARD_SITES;
	// the stall-side boards (Tidemark's stands on its market square: test/feature-town.mjs checks it)
	for ( const port of [ 'home', 'pons' ] ) {

		const s = sites[ port ], stall = STALLS[ port ];
		const hs = [ [ 0, 0 ], [ 1.5, 0 ], [ - 1.5, 0 ], [ 0, 0.3 ], [ 0, - 0.3 ] ].map( ( [ dx, dz ] ) => terrain.heightAt( s.x + dx, s.z + dz ) );
		ok( hs.every( ( h ) => h > 1.2 && h < 4 ) && Math.max( ...hs ) - Math.min( ...hs ) < 0.5, `${ port }: on dry land (${ Math.min( ...hs ).toFixed( 2 ) }..${ Math.max( ...hs ).toFixed( 2 ) } m) and not on a steep slope` );
		// in the stall's frame the board is an axis-aligned box: half 1.5 x 0.22
		const c = Math.cos( stall.yaw ), sn = Math.sin( stall.yaw ), dx = s.x - stall.x, dz = s.z - stall.z;
		const lx = dx * c - dz * sn, lz = dx * sn + dz * c;
		const solids = port === 'home'
			? [ [ 0, 0, 1.45, 0.95 ], [ - 1.85, 0.25, 0.45, 0.25 ], [ 1.8, - 0.2, 0.3, 0.6 ], [ 1.55, 1.05, 0.2, 0.2 ], [ 1.95, 1.45, 0.35, 0.25 ] ]
			: [ [ 0, 0, 1.05, 0.4 ], [ - 1.5, 0.2, 0.4, 0.3 ], [ 1.55, 0.1, 0.35, 0.3 ], [ 0, - 1.4, 1.0, 0.2 ] ];
		const gaps = solids.map( ( [ ax, az, hx, hz ] ) => Math.max( Math.abs( lx - ax ) - ( 1.5 + hx ), Math.abs( lz - az ) - ( 0.22 + hz ) ) );
		ok( gaps.every( ( g ) => g > 0.8 ), `${ port }: clear of the stall and its crates by ${ Math.min( ...gaps ).toFixed( 1 ) } m` );
		ok( Math.hypot( dx, dz ) > 3.5 && Math.hypot( dx, dz ) < 8, `${ port }: ${ Math.hypot( dx, dz ).toFixed( 1 ) } m from the stall (near, not on it)` );
		ok( s.yaw === stall.yaw, `${ port }: faces the way the stall does` );
		const ts = STALL_SITES[ port ];
		ok( Math.hypot( s.x - ts.x, s.z - ts.z ) > 6, `${ port }: ${ Math.hypot( s.x - ts.x, s.z - ts.z ).toFixed( 1 ) } m from the trade stall (not overlapping)` );

	}

	// Hyptile: off the boardwalk up from the pier foot; Pons: off the footpath and the dock
	const seg = ( px, pz, a, b ) => { const x = b[ 0 ] - a[ 0 ], z = b[ 1 ] - a[ 1 ]; const t = Math.max( 0, Math.min( 1, ( ( px - a[ 0 ] ) * x + ( pz - a[ 1 ] ) * z ) / ( x * x + z * z ) ) ); return Math.hypot( px - a[ 0 ] - t * x, pz - a[ 1 ] - t * z ); };
	const h = sites.home, boardwalk = [ [ 55, - 64 ], [ 54.6, - 72 ], [ 52.4, - 82 ], [ 48.4, - 92 ] ];
	const dWalk = Math.min( ...boardwalk.slice( 1 ).map( ( p, i ) => seg( h.x, h.z, boardwalk[ i ], p ) ) );
	ok( dWalk > 2.5, `Hyptile: ${ dWalk.toFixed( 1 ) } m from the boardwalk (1.8 m wide)` );
	ok( Math.abs( h.x - WORLD.pier.x ) > 3 || h.z < WORLD.pier.zStart - 3, 'and off the pier' );
	const p = sites.pons, path = PATHS[ PATHS.length - 1 ].pts, dock = WORLD.pons.dock;
	const dPath = Math.min( ...path.slice( 1 ).map( ( q, i ) => seg( p.x, p.z, path[ i ], q ) ) );
	const dDock = seg( p.x, p.z, [ dock.start.x, dock.start.z ], [ dock.end.x, dock.end.z ] );
	ok( dPath > 2.5 && dDock > 4, `Pons: ${ dPath.toFixed( 1 ) } m from the footpath, ${ dDock.toFixed( 1 ) } m from the dock` );
	const huts = [ [ - 72, - 12 ], [ - 63, 24 ] ].map( ( [ u, v ] ) => ponsWorld( u, v ) );
	ok( huts.every( ( q ) => Math.hypot( q[ 0 ] - p.x, q[ 1 ] - p.z ) > 8 ), 'and clear of the huts' );

}

// ---------------------------------------------------------------- misc
ok( hash32( 'a', 1 ) === hash32( 'a', 1 ) && hash32( 'a', 1 ) !== hash32( 'a', 2 ) && rng( 5 )() === rng( 5 )(), 'seeded helpers are stable' );
ok( eventDelta( { type: 'nothing', params: {} }, 'fishCaught', {} ) === 0, 'unknown types never progress' );
ok( TIER_NAMES.length === 4 && PORT_IDS.length === 3 && PORT_IDS.every( ( p ) => BOARD_SITES[ p ] && PORT_INFO[ p ] ), 'tiers and ports (home, Pons, Tidemark), each with a board site' );

console.log( fails ? `\n${ fails } FAILED` : '\nall ok' );
process.exit( fails ? 1 : 0 );

// Plain-node tests of the progression (XP, levels, ranks, reputation) and the save slots.
import { GameState, SAVE_KEY, SLOTS } from '../src/game/GameState.js';
import { levelFor, xpToLevel, xpFor, repFor, rankTitle, progress, LEVEL_XP, RANKS, REP_MAX } from '../src/game/Progression.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};
const store = ( m = new Map() ) => ( { getItem: ( k ) => m.has( k ) ? m.get( k ) : null, setItem: ( k, v ) => m.set( k, v ), removeItem: ( k ) => m.delete( k ), map: m } );

// ---- levels
{

	ok( levelFor( 0 ) === 1 && levelFor( 99 ) === 1 && levelFor( 100 ) === 2 && levelFor( 250 ) === 3 && levelFor( 500 ) === 4 && levelFor( 900 ) === 5 && levelFor( 1400 ) === 6 && levelFor( 2000 ) === 7, 'thresholds 100, 250, 500, 900, 1400, 2000' );
	ok( xpToLevel( 8 ) === 2800 && xpToLevel( 9 ) === 3600 && levelFor( 2799 ) === 7 && levelFor( 2800 ) === 8, '+800 a level after' );
	let mono = true, last = 1;
	for ( let xp = 0; xp < 20000; xp += 7 ) {

		const l = levelFor( xp );
		if ( l < last ) mono = false;
		last = l;

	}

	ok( mono && last > 20, `levels never go down with xp (level ${ last } at 20k)` );
	let up = true;
	for ( let l = 1; l < 30; l ++ ) if ( ! ( xpToLevel( l + 1 ) > xpToLevel( l ) ) ) up = false;
	ok( up && LEVEL_XP.length === 6, 'xpToLevel is strictly increasing' );
	ok( levelFor( - 5 ) === 1 && levelFor( NaN ) === 1, 'bad xp is level 1' );

}

// ---- xp rules
{

	ok( xpFor( 'catch', { kg: 2.4 } ) === 7 && xpFor( 'catch', { kg: 2.4, record: true } ) === 22 && xpFor( 'catch', { kg: 1, newSpecies: true } ) === 26, 'catch: 5 + kg, +15 record, +20 new species' );
	ok( xpFor( 'quest', { money: 400 } ) === 100 && xpFor( 'sale', { total: 125 } ) === 13 && xpFor( 'discovery' ) === 50 && xpFor( 'nothing' ) === 0, 'quest money / 4, sale / 10, discovery 50' );
	ok( repFor( 'sale', { total: 100 } ) === 4 && repFor( 'quest', { money: 100 } ) === 7, 'reputation: sale / 25, quest 5 + money / 50' );

}

// ---- ranks
{

	ok( rankTitle( 1 ) === 'Deckhand' && rankTitle( 2 ) === 'Line hand' && rankTitle( 4 ) === 'Reef hand' && rankTitle( 6 ) === 'Bay captain' && rankTitle( 8 ) === 'Deep-water captain' && rankTitle( 10 ) === 'Island legend' && rankTitle( 40 ) === 'Island legend', 'rank titles climb and cap' );
	ok( RANKS.length === 6, 'six ranks' );

}

// ---- xp accrues through the state
{

	const s = new GameState( store() );
	ok( s.xp === 0 && s.level === 1 && s.progress.title === 'Deckhand' && s.progress.nextXp === 100, 'a fresh islander: level 1, 100 xp to go' );
	s.addFish( 'grunt', 0.5 ); // new species: 5 + 0.5 + 20 = 26 (rounded)
	ok( s.xp === 26 && s.lastCatch.xp === 26, 'the first grunt gives catch + new-species xp' );
	s.addFish( 'grunt', 1.5 ); // record: 5 + 1.5 + 15 = 22
	ok( s.xp === 48 && s.lastCatch.xp === 22 && ! s.lastCatch.levelUp, 'a record adds its bonus' );
	s.addFish( 'tarpon', 40 ); // too big for the cooler, still logged: 5 + 40 + 20 = 65
	ok( s.xp === 113 && s.level === 2 && s.lastCatch.levelUp === 2 && s.lastLevelUp === 2, 'a released fish still earns xp; level 2 reached' );
	const held = s.holdValue;
	const r = s.sell();
	ok( r.xp === Math.round( held / 10 ) && s.xp === 113 + r.xp, `a sale pays xp (total $${ held }: ${ r.xp } xp)` );
	ok( Math.abs( s.rep.home - held / 25 ) < 1e-6 && s.rep.pons === 0, 'and reputation at the home port' );
	const a = s.addXp( 1000 );
	ok( a.gained === 1000 && a.levelUp === s.level && s.level === levelFor( s.xp ), 'addXp reports the level reached' );
	ok( s.addXp( 0.4 ).gained === 0 && s.addXp( - 9 ).gained === 0, 'no negative or fractional xp' );
	const p = progress( s );
	ok( p.level === s.level && p.prevXp <= p.xp && p.xp < p.nextXp && p.frac >= 0 && p.frac < 1, 'progress() frames xp between the level thresholds' );

}

// ---- reputation clamps
{

	const s = new GameState( store() );
	ok( s.addRep( 'pons', 30 ) === 30 && s.addRep( 'pons', 90 ) === REP_MAX && s.rep.pons === REP_MAX, 'reputation caps at 100' );
	ok( s.addRep( 'pons', - 500 ) === 0, 'and floors at 0' );
	ok( s.addRep( 'home', NaN ) === 0, 'bad amounts are ignored' );
	s.sell( null, 'pons' );
	ok( s.rep.pons === 0, 'an empty sale earns nothing' );

}

// ---- discovery once
{

	const s = new GameState( store() );
	ok( s.discover( 'pons' ) === true && s.xp === 50 && s.discovered.includes( 'pons' ), 'the first visit to Pons: 50 xp' );
	ok( s.discover( 'pons' ) === false && s.xp === 50, 'the second: nothing' );
	ok( s.discover( '' ) === false && s.discover( null ) === false, 'no port, no discovery' );

}

// ---- the save carries the new fields; a v2 save without them loads with defaults
{

	const st = store();
	const s = new GameState( st );
	s.addFish( 'jack', 3 );
	s.addRep( 'home', 12 );
	s.discover( 'pons' );
	const t = new GameState( st );
	ok( t.load() && t.xp === s.xp && t.rep.home === 12 && t.discovered.includes( 'pons' ), 'xp, rep and discoveries survive a save round trip' );
	ok( JSON.parse( st.map.get( SAVE_KEY ) ).savedAt > 0, 'the save stamps savedAt' );
	const old = { v: 2, money: 77, inventory: [], log: {}, upgrades: {}, fuel: null, nextId: 1, character: 'hyptile', unlocked: [ 'hyptile' ], boat: null, quests: {}, career: { caught: 3 }, name: 'Old' };
	const u = new GameState( store( new Map( [ [ SAVE_KEY, JSON.stringify( old ) ] ] ) ) );
	ok( u.load() && u.money === 77 && u.xp === 0 && u.level === 1 && u.rep.home === 0 && u.rep.pons === 0 && u.discovered.length === 0, 'an older v2 save loads at level 1 with no reputation' );
	const v1 = new GameState( store( new Map( [ [ 'alpha-astra.save.v1', JSON.stringify( { v: 1, money: 5, inventory: [], log: {}, upgrades: {}, fuel: null, nextId: 1 } ) ] ] ) ) );
	ok( v1.load() && v1.xp === 0 && v1.boat === 'lobster', 'a Tidewater v1 save too' );
	ok( new GameState( store( new Map( [ [ SAVE_KEY, JSON.stringify( { ...old, xp: 'lots', rep: { home: 900, pons: - 3 }, discovered: 'pons' } ) ] ] ) ) ).load(), 'bad progression fields are tolerated' );

}

// ---- save slots
{

	const st = store();
	ok( GameState.slotKey( 0 ) === SAVE_KEY && GameState.slotKey( 2 ) === `${ SAVE_KEY }.slot2` && SLOTS === 4, 'slot 0 keeps the original key, the others are suffixed' );
	const a = new GameState( st );
	a.earn( 100 );
	a.name = 'Ada';
	a.save();
	const b = new GameState( st );
	ok( b.useSlot( 1 ) === false && b.money === 0 && b.slot === 1, 'slot 1 starts empty' );
	b.earn( 250 );
	b.name = 'Bo';
	b.save();
	ok( st.map.has( SAVE_KEY ) && st.map.has( `${ SAVE_KEY }.slot1` ), 'two keys in storage' );
	const c = new GameState( st );
	ok( c.load() && c.money === 100 && c.name === 'Ada', 'slot 0 still holds Ada' );
	ok( c.useSlot( 1 ) === true && c.money === 250 && c.name === 'Bo', 'and slot 1 Bo' );
	c.earn( 5 );
	ok( JSON.parse( st.map.get( SAVE_KEY ) ).money === 100 && JSON.parse( st.map.get( `${ SAVE_KEY }.slot1` ) ).money === 255, 'a change in slot 1 leaves slot 0 alone' );
	ok( c.useSlot( 0 ) === true && c.money === 100, 'back to slot 0' );
	ok( c.useSlot( 9 ) === false && c.slot === SLOTS - 1, 'slots are clamped' );

	const list = GameState.listSlots( st );
	ok( list.length === SLOTS && list[ 0 ].exists && list[ 0 ].name === 'Ada' && list[ 0 ].money === 100 && list[ 0 ].level === 1 && list[ 0 ].boat === null && list[ 0 ].character === 'hyptile', 'listSlots: slot 0 summary' );
	ok( list[ 1 ].exists && list[ 1 ].name === 'Bo' && list[ 1 ].money === 255 && list[ 1 ].savedAt > 0 && typeof list[ 1 ].playSeconds === 'number', 'slot 1 summary' );
	ok( ! list[ 2 ].exists && ! list[ 3 ].exists && list[ 2 ].slot === 2 && list[ 3 ].name === '', 'empty slots are listed as empty' );
	ok( GameState.listSlots( null ).every( ( r ) => ! r.exists ), 'no storage: all empty' );
	ok( GameState.listSlots( { getItem: () => { throw new Error( 'blocked' ); } } ).length === SLOTS, 'blocked storage does not throw' );

	c.useSlot( 1 );
	c.deleteSlot( 1 );
	ok( ! st.map.has( `${ SAVE_KEY }.slot1` ) && c.money === 0 && c.slot === 1, 'deleteSlot clears the key and the current slot in memory' );
	ok( ! GameState.listSlots( st )[ 1 ].exists && GameState.listSlots( st )[ 0 ].exists, 'the list agrees' );
	c.deleteSlot( 0 );
	ok( ! st.map.has( SAVE_KEY ) && c.slot === 1, 'deleting another slot leaves the current one alone' );

	// the legacy Tidewater key is only read for slot 0
	const st2 = store( new Map( [ [ 'alpha-astra.save.v1', JSON.stringify( { v: 1, money: 9, inventory: [], log: {}, upgrades: {}, fuel: null, nextId: 1 } ) ] ] ) );
	const d = new GameState( st2 );
	ok( d.useSlot( 2 ) === false && d.money === 0, 'slot 2 does not see the Tidewater save' );
	ok( d.useSlot( 0 ) === true && d.money === 9 && GameState.listSlots( st2 )[ 0 ].exists && GameState.listSlots( st2 )[ 0 ].boat === 'lobster', 'slot 0 does' );

	// reset keeps the name, drops the run
	const e = new GameState( store() );
	e.name = 'Eve';
	e.addXp( 300 );
	e.reset();
	ok( e.name === 'Eve' && e.xp === 0 && e.level === 1, 'reset: a fresh run, same name' );

}

console.log( fails ? `\n${ fails } failing` : '\nall green' );
process.exit( fails ? 1 : 0 );

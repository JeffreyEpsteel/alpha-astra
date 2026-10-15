// Plain-node tests of the Hyptile Island save (GameState v2): the crew, the boats, the career stats
// and the Tidewater v1 carry-over.
import { GameState } from '../src/game/GameState.js';
import { CHARACTERS, CHARACTER_IDS, unlockCost } from '../src/game/Characters.js';
import { BOATS, BOAT_IDS, upgradePrice, tradeInValue } from '../src/game/Boats.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};
const store = () => {

	const m = new Map();
	return { getItem: ( k ) => m.has( k ) ? m.get( k ) : null, setItem: ( k, v ) => m.set( k, v ), map: m };

};

// ---- a fresh islander: on foot, Hyptile only
{

	const s = new GameState( store() );
	ok( s.boat === null && s.character === 'hyptile' && s.unlocked.length === 1, 'fresh save: on foot, Hyptile only' );
	ok( s.stats.holdKg === 30 && s.stats.fuelL === 40, 'cooler and the base tank without a boat' );
	ok( ! s.buyBoat( 'skiff' ), 'cannot buy a skiff with no money' );
	s.earn( 10000 );
	ok( s.buyBoat( 'skiff' ) && s.boat === 'skiff' && s.money === 10000 - BOATS.skiff.price, 'buys the skiff at list price' );
	ok( s.stats.holdKg === Math.round( 30 * BOATS.skiff.holdMul ) && s.stats.maxThrust === BOATS.skiff.maxThrust, 'the skiff sets the hold and the engine' );
	const up = upgradePrice( 'skiff', 'launch' );
	ok( up === BOATS.launch.price - tradeInValue( 'skiff' ), 'trading up credits the skiff' );
	const before = s.money;
	ok( s.buyBoat( 'launch' ) && s.money === before - up && s.boat === 'launch', 'trades up to the launch' );
	ok( ! s.buyBoat( 'launch' ), 'cannot buy the boat you own' );
	ok( s.career.boats === 2, 'career counts the boats' );

}

// ---- the crew
{

	const s = new GameState( store() );
	for ( const id of CHARACTER_IDS ) ok( CHARACTERS[ id ].unlock.kind === 'start' || CHARACTERS[ id ].unlock.kind === 'buy' || CHARACTERS[ id ].unlock.kind === 'quest', `${ id } has an unlock rule` );
	ok( ! s.setCharacter( 'pepe' ), 'cannot play a locked character' );
	ok( ! s.unlockCharacter( 'pepe' ), 'cannot hire Pepe broke' );
	s.earn( unlockCost( 'pepe' ) );
	ok( s.unlockCharacter( 'pepe' ) && s.money === 0 && s.isUnlocked( 'pepe' ), 'hires Pepe for the listed price' );
	ok( ! s.unlockCharacter( 'doge' ), 'quest characters cannot be bought' );
	ok( s.unlockCharacter( 'doge', { free: true } ) && s.isUnlocked( 'doge' ), 'a quest reward unlocks for free' );
	ok( s.setCharacter( 'doge' ) && s.character === 'doge', 'plays as Doge' );
	const raw = JSON.stringify( s.toJSON() );
	const t = new GameState( store() );
	ok( t.fromJSON( JSON.parse( raw ) ) && t.character === 'doge' && t.unlocked.includes( 'pepe' ), 'crew survives a save round trip' );

}

// ---- catches, where and when (quest inputs)
{

	const s = new GameState( store() );
	s.addFish( 'grunt', 0.5, 22, { habitat: 'pier', aboard: false } );
	s.addFish( 'grunt', 0.9, 12, { habitat: 'reef', aboard: true } );
	s.addFish( 'grunt', 0.7, 12, { habitat: 'deep', aboard: true } );
	ok( s.career.caught === 3 && s.career.night === 1 && s.career.reef === 1 && s.career.deep === 1 && s.career.aboard === 2 && s.career.records === 1, 'career stats follow the catches' );
	ok( s.lastCatch.where.habitat === 'deep', 'the last catch remembers where' );
	const taken = s.takeFish( [ s.inventory[ 0 ].id ] );
	ok( taken.length === 1 && s.inventory.length === 2 && s.money === 0, 'takeFish removes without paying' );

}

// ---- a Tidewater save comes over with its lobster boat
{

	const st = store();
	st.setItem( 'alpha-astra.save.v1', JSON.stringify( { v: 1, money: 123, inventory: [], log: {}, upgrades: { hold: 1 }, fuel: null, nextId: 4 } ) );
	const s = new GameState( st );
	ok( s.load() && s.money === 123 && s.boat === 'lobster' && s.upgrades.hold === 1, 'v1 save: purse, gear and the lobster boat' );
	s.save();
	ok( st.map.has( 'alpha-astra.save.v2' ), 'saved under the candidate key' );

}

ok( BOAT_IDS.length >= 5, 'at least the five boats in the yard' );
console.log( fails ? `${ fails } failed` : 'all passed' );
process.exit( fails ? 1 : 0 );

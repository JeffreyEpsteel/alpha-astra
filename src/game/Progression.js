// XP, levels, rank titles and port reputation (the Unreal game's progression, ported).
//
//   levelFor( xp ) -> level (1..)          thresholds: 100, 250, 500, 900, 1400, 2000, then +800 a level
//   xpToLevel( level ) -> xp needed to reach that level (level 1: 0)
//   xpFor( event, payload ) -> xp          catch: 5 + kg (+15 record, +20 new species); quest: money / 4;
//                                          sale: total / 10; discovery: 50
//   repFor( event, payload ) -> rep        sale: total / 25; quest: 5 + money / 50 (per port, 0..REP_MAX)
//   rankTitle( level ) -> 'Deckhand' | 'Line hand' | 'Reef hand' | 'Bay captain' | 'Deep-water captain' | 'Island legend'
//   progress( state ) -> { xp, level, nextXp, prevXp, frac, title, rep }
//
// GameState keeps the numbers (state.xp, state.rep, state.discovered) and calls xpFor / repFor from
// addFish, sell and discover; quest deliveries go through state.addXp / addRep from the game.

export const LEVEL_XP = [ 100, 250, 500, 900, 1400, 2000 ]; // xp to reach level 2, 3, ... 7
export const LEVEL_STEP = 800; // each level after
export const RANKS = [ 'Deckhand', 'Line hand', 'Reef hand', 'Bay captain', 'Deep-water captain', 'Island legend' ];
export const PORTS = [ 'home', 'pons' ]; // the home port and Pons, the neighbouring island's port
export const REP_MAX = 100;

const num = ( v, d = 0 ) => ( typeof v === 'number' && Number.isFinite( v ) ? v : d );

// xp needed to reach `level` (level 1 = 0)
export function xpToLevel( level ) {

	const l = Math.max( 1, level | 0 );
	if ( l === 1 ) return 0;
	const i = l - 2;
	if ( i < LEVEL_XP.length ) return LEVEL_XP[ i ];
	return LEVEL_XP[ LEVEL_XP.length - 1 ] + ( i - LEVEL_XP.length + 1 ) * LEVEL_STEP;

}

export function levelFor( xp ) {

	const x = Math.max( 0, num( xp ) );
	let level = 1;
	while ( x >= xpToLevel( level + 1 ) ) level ++;
	return level;

}

// xp for a game event (always a non-negative integer)
export function xpFor( event, payload = {} ) {

	const p = payload || {};
	switch ( event ) {

		case 'catch': return Math.round( 5 + num( p.kg ) + ( p.record ? 15 : 0 ) + ( p.newSpecies ? 20 : 0 ) );
		case 'quest': return Math.max( 0, Math.round( num( p.money ) / 4 ) );
		case 'sale': return Math.max( 0, Math.round( num( p.total ) / 10 ) );
		case 'discovery': return 50;
		default: return 0;

	}

}

// reputation gained at a port for a sale or a quest there
export function repFor( event, payload = {} ) {

	const p = payload || {};
	switch ( event ) {

		case 'sale': return Math.max( 0, num( p.total ) / 25 );
		case 'quest': return Math.max( 0, 5 + num( p.money ) / 50 );
		default: return 0;

	}

}

export function rankTitle( level ) {

	const l = Math.max( 1, level | 0 );
	return RANKS[ Math.min( RANKS.length - 1, Math.floor( l / 2 ) ) ];

}

// reputation tier for the HUD: 'Stranger' .. 'Legend'
export function repTitle( rep ) {

	const r = num( rep );
	return r >= 90 ? 'Legend' : r >= 65 ? 'Respected' : r >= 40 ? 'Regular' : r >= 15 ? 'Known' : 'Stranger';

}

// a summary from a GameState (or any { xp, rep })
export function progress( state ) {

	const xp = Math.max( 0, num( state && state.xp ) );
	const level = levelFor( xp );
	const prevXp = xpToLevel( level ), nextXp = xpToLevel( level + 1 );
	const rep = {};
	const src = state && state.rep && typeof state.rep === 'object' ? state.rep : {};
	for ( const port of PORTS ) rep[ port ] = Math.max( 0, Math.min( REP_MAX, num( src[ port ] ) ) );
	for ( const k in src ) if ( ! ( k in rep ) ) rep[ k ] = Math.max( 0, Math.min( REP_MAX, num( src[ k ] ) ) );
	return { xp, level, prevXp, nextXp, frac: ( xp - prevXp ) / Math.max( 1, nextXp - prevXp ), title: rankTitle( level ), rep };

}

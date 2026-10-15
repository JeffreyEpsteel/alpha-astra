import { effectiveMatch, portAt } from './StoryData.js';

// The story's rules (pure): gates on chains and dialogue lines, event matching for quest steps, fish matching for
// hand-ins. Story.js builds the context; the tests call these directly.
//
//   gate( req, ctx ) -> bool          req: an object (every key must hold), an array (every entry), null (always)
//     { boat: true }                  owns a boat                 { rep: [ port, op, n ] }   story.rep( port ) op n
//     { chain: id } / { chains: [] }  those chains are done       { active: id }             that chain is running
//     { discovered: port }            landed there ('home' is)    { feature: name }          that feature is installed
//     { career: [ key, op, n ] }      state.career                { level: n }               player level >= n
//     { mem: [ key, op, n ] }         the speaker's memory        { note: [ key, op, n ] }   the speaker's notes
//     { disposition: [ op, n ] }      the speaker's disposition   { flag: name }             a story flag is set
//     { item: id } / { unlocked: id } owns / may buy an item      { money: n }               money >= n
//     { night: bool }                 after dark now              { hostile: bool }          the speaker's port is hostile
//     { any: [ req ] }  { not: req }  { met: bool }               { debt: true }             the speaker is owed money
//     { corsair: n }                  pirates.standing() >= n (wave 13: the black-market dealer's work)
//     { path: [ chain, option ] }     that chain is done and its choice step took that option (wave 20: the court-martial)
//   ctx: { story, state, npc, mem, night, features }
//   sandboxGate( req ) -> req         the gates the sandbox keeps (only { feature }: the sandbox plays everything else)
//
//   matches( m, e, ctx ) -> bool      a step's match against an event payload (StoryData header lists the keys)
//   amount( step, e ) -> n            how far an event moves a step (count: 'qty' | 'total' | 'kg' | 'value' | 'count', else 1)
//   (wave 13) match keys is { key: value | [ values ] } (plain payload equality: { result: 'won' }, { id: 'tidemark-raider' })
//   and test( e, ctx ) -> bool (ctx.event is the event's name, ctx.features the registry)
//   fishFits( rule, f ) -> bool       a fish in the hold against a deliver rule

const num = ( v, d = 0 ) => ( typeof v === 'number' && Number.isFinite( v ) ? v : d );
const list = ( v ) => ( Array.isArray( v ) ? v : v === undefined || v === null ? [] : [ v ] );

export function compare( a, op, b ) {

	a = num( a );
	b = num( b );
	switch ( op ) {

		case '>=': return a >= b;
		case '>': return a > b;
		case '<=': return a <= b;
		case '<': return a < b;
		case '==': case '=': return a === b;
		case '!=': return a !== b;
		default: return false;

	}

}

export const isNight = ( tod ) => num( tod, 12 ) < 6 || num( tod, 12 ) >= 19.5;
export const isDawnDusk = ( tod ) => { const t = num( tod, 12 ); return ( t >= 5 && t < 7.5 ) || ( t >= 17.5 && t < 20 ); };

export function gate( req, ctx = {} ) {

	if ( ! req ) return true;
	if ( Array.isArray( req ) ) return req.every( ( r ) => gate( r, ctx ) );
	if ( typeof req === 'function' ) {

		try { return !! req( ctx ); } catch ( e ) { return false; }

	}

	const st = ctx.state || null, story = ctx.story || null, mem = ctx.mem || null;
	for ( const [ k, v ] of Object.entries( req ) ) {

		let pass = true;
		switch ( k ) {

			case 'boat': pass = !! ( st && st.boat ) === !! v; break;
			case 'rep': pass = compare( story ? story.rep( v[ 0 ] ) : 0, v[ 1 ], v[ 2 ] ); break;
			case 'chain': pass = !! ( story && story.isDone( v ) ); break;
			case 'chains': pass = list( v ).every( ( id ) => story && story.isDone( id ) ); break;
			case 'active': pass = !! ( story && story.isActive( v ) ); break;
			case 'path': pass = !! ( story && story.isDone( v[ 0 ] ) && typeof story.pathOf === 'function' && story.pathOf( v[ 0 ] ) === v[ 1 ] ); break;
			case 'discovered': pass = v === 'home' || !! ( st && Array.isArray( st.discovered ) && st.discovered.includes( v ) ); break;
			case 'feature': pass = !! ( ctx.features && ctx.features.get && ctx.features.get( v ) ); break;
			case 'career': pass = compare( st && st.career ? st.career[ v[ 0 ] ] : 0, v[ 1 ], v[ 2 ] ); break;
			case 'level': pass = num( st && st.level, 1 ) >= v; break;
			case 'mem': pass = compare( mem ? mem[ v[ 0 ] ] : 0, v[ 1 ], v[ 2 ] ); break;
			case 'note': pass = compare( mem && mem.notes ? mem.notes[ v[ 0 ] ] : 0, v[ 1 ], v[ 2 ] ); break;
			case 'disposition': pass = compare( mem ? mem.disposition : 0, v[ 0 ], v[ 1 ] ); break;
			case 'flag': pass = !! ( story && story.flags.includes( v ) ); break;
			case 'item': pass = !! ( story && story.items.includes( v ) ); break;
			case 'unlocked': pass = !! ( story && story.unlocks.includes( v ) ); break;
			case 'money': pass = num( st && st.money ) >= v || !! ( st && st.free ); break;
			case 'night': pass = !! ctx.night === !! v; break;
			case 'hostile': pass = !! ( story && ctx.npc && story.hostileTo( ctx.npc ) ) === !! v; break;
			case 'met': pass = !! ( mem && mem.met ) === !! v; break;
			case 'debt': pass = ( num( mem && mem.debt ) > 0 ) === !! v; break;
			case 'corsair': {

				const p = ctx.features && ctx.features.get ? ctx.features.get( 'pirates' ) : null;
				let s = 0;
				try { s = p && typeof p.standing === 'function' ? num( p.standing() ) : 0; } catch ( e ) { s = 0; }
				pass = s >= v;
				break;

			}
			case 'any': pass = list( v ).some( ( r ) => gate( r, ctx ) ); break;
			case 'not': pass = ! gate( v, ctx ); break;
			default: pass = true; // unknown keys never lock content away

		}

		if ( ! pass ) return false;

	}

	return true;

}

// the sandbox plays every chain: only the gates that need a feature to exist stay
export function sandboxGate( req ) {

	if ( ! req || typeof req !== 'object' ) return null;
	const out = [];
	for ( const r of [].concat( req ) ) if ( r && typeof r === 'object' && r.feature ) out.push( { feature: r.feature } );
	return out.length ? out : null;

}

// does an event payload fit a step's match (ctx: { night, dawnDusk, weather, player: { x, z } })
export function matches( raw, e, ctx = {} ) {

	const m = effectiveMatch( raw );
	e = e && typeof e === 'object' ? e : {};
	if ( m.species && ! m.species.includes( e.species ) ) return false;
	if ( m.habitat !== undefined && ! list( m.habitat ).includes( e.habitat ) ) return false;
	if ( m.minKg !== undefined && ! ( num( e.kg ) >= m.minKg ) ) return false;
	if ( m.aboard !== undefined && !! e.aboard !== !! m.aboard ) return false;
	if ( m.night && ! ( e.night ?? ctx.night ) ) return false;
	if ( m.dawnDusk && ! ( e.dawnDusk ?? ctx.dawnDusk ) ) return false;
	if ( m.port !== undefined && ! list( m.port ).includes( e.port ) ) return false;
	if ( m.faction !== undefined && ! list( m.faction ).includes( e.faction ) ) return false;
	if ( m.byPlayer !== undefined && ( e.byPlayer !== false ) !== !! m.byPlayer ) return false;
	if ( m.good !== undefined && ! list( m.good ).includes( e.good ) ) return false;
	if ( m.kind !== undefined && ! list( m.kind ).includes( e.kind ) ) return false;
	if ( m.onWater !== undefined && !! e.onWater !== !! m.onWater ) return false;
	if ( m.weather !== undefined && ! list( m.weather ).includes( e.weather ?? ctx.weather ) ) return false;
	const at = Number.isFinite( e.x ) && Number.isFinite( e.z ) ? { x: e.x, z: e.z } : ctx.player || null;
	if ( m.near ) {

		if ( ! at || Math.hypot( at.x - m.near.x, at.z - m.near.z ) > m.near.r ) return false;

	}

	if ( m.notInPort && ( ! at || portAt( at.x, at.z ) !== null ) ) return false;
	if ( m.is && typeof m.is === 'object' ) {

		for ( const [ k, v ] of Object.entries( m.is ) ) if ( ! list( v ).includes( e[ k ] ) ) return false;

	}

	if ( typeof m.test === 'function' ) {

		try { if ( ! m.test( e, ctx ) ) return false; } catch ( err ) { return false; }

	}

	return true;

}

export function amount( step, e ) {

	switch ( step.count ) {

		case 'qty': return Math.max( 0, num( e && e.qty ) );
		case 'total': return Math.max( 0, num( e && e.total ) );
		case 'kg': return Math.max( 0, num( e && e.kg ) );
		case 'value': return Math.max( 0, num( e && e.value ) );
		case 'count': return Math.max( 0, num( e && e.count ) );
		default: return 1;

	}

}

// a fish in the hold ({ species, kg, caughtAt }) against a deliver rule ({ species, alt, fallback, any, minKg, night })
export function fishFits( rule, f ) {

	if ( ! rule || ! f ) return false;
	const m = effectiveMatch( rule );
	if ( m.species && ! m.species.includes( f.species ) ) return false;
	if ( m.minKg !== undefined && ! ( num( f.kg ) >= m.minKg ) ) return false;
	if ( m.night && ! isNight( f.caughtAt ) ) return false;
	return true;

}

// the ids of the fish a deliver step takes (cheapest first: nobody hands over their best catch by accident)
export function pickFish( rule, inventory, goal ) {

	return ( inventory || [] ).filter( ( f ) => fishFits( rule, f ) ).sort( ( a, b ) => num( a.value ) - num( b.value ) ).slice( 0, goal ).map( ( f ) => f.id );

}

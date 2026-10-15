import { SCHEDULES } from '../harbour/Roles.js';
import { hashId } from '../harbour/Schedules.js';
import { FOLK_NAMES, FOLK_CHARACTERS, ROLE_LINES, yawToward } from '../../world/residents/ResidentData.js';

// The townsfolk of townlife: each citizen has a home (a door: indoors at night), a job and a day plan (Roles.js
// schedules plus the town roles below), and walks the town's NavGrid routes between the places of its plan (Towns.js).
// A TownSim runs one town: the activities by the island clock, the goals they give (a stall to keep, nets to mend,
// crates to carry, a seat to eat on, a patio slot at the tavern, a gathering of two or three facing each other, a
// beat to walk with a lantern, the lamps at dusk, tag on the beach), simple avoidance, and the town's reactions: run
// indoors under cannon fire or a raid, cheer a big catch, queue at the fish hall when the catch comes in.
//
// Plain logic (no engine): the feature (index.js) binds avatars to the citizens near the player and draws the rest.
//   const sim = new TownSim( plan, { grid, rand, count: scale, ground } );
//   sim.update( dt, hour, viewer )      viewer { x, z } | null; near citizens step every frame, the rest at 2 Hz
//   sim.alarm( x, z, seconds ) / sim.cheer( x, z ) / sim.callQueue() / sim.crowd() / sim.byId( id )
//   citizen: { id, name, role, act, x, z, y, yaw, moving, hidden, clip(): { name, loop, speed }, lines }

export const TOWN_SCHEDULES = {
	fisher: SCHEDULES.fisher,
	dockworker: SCHEDULES.dockworker,
	carter: SCHEDULES.dockworker,
	carpenter: SCHEDULES.dockworker,
	child: SCHEDULES.child,
	sweeper: [ [ 0, 6, 'sleep' ], [ 6, 11, 'work' ], [ 11, 12, 'eat' ], [ 12, 16, 'work' ], [ 16, 20, 'stroll' ], [ 20, 24, 'sleep' ] ],
	vendor: [ [ 0, 6, 'sleep' ], [ 6, 7, 'wake' ], [ 7, 12.5, 'work' ], [ 12.5, 13.5, 'eat' ], [ 13.5, 18.5, 'work' ], [ 18.5, 21, 'stroll' ], [ 21, 24, 'sleep' ] ],
	folk: [ [ 0, 7, 'sleep' ], [ 7, 8, 'wake' ], [ 8, 12, 'stroll' ], [ 12, 13, 'eat' ], [ 13, 17.5, 'stroll' ], [ 17.5, 21, 'tavern' ], [ 21, 24, 'sleep' ] ],
	regular: [ [ 0, 0.6, 'drunk' ], [ 0.6, 10, 'sleep' ], [ 10, 12, 'stroll' ], [ 12, 13, 'eat' ], [ 13, 17, 'stroll' ], [ 17, 23.4, 'tavern' ], [ 23.4, 24, 'drunk' ] ],
	watchman: [ [ 0, 6, 'watch' ], [ 6, 14, 'sleep' ], [ 14, 18, 'stroll' ], [ 18, 20, 'tavern' ], [ 20, 24, 'watch' ] ],
	lamplighter: [ [ 0, 7, 'sleep' ], [ 7, 12, 'stroll' ], [ 12, 13, 'eat' ], [ 13, 17.6, 'stroll' ], [ 17.6, 19.3, 'lamps' ], [ 19.3, 22, 'tavern' ], [ 22, 24, 'sleep' ] ],
	pirate: [ [ 0, 3.5, 'tavern' ], [ 3.5, 4.5, 'drunk' ], [ 4.5, 11, 'sleep' ], [ 11, 12, 'wake' ], [ 12, 17, 'stroll' ], [ 17, 24, 'tavern' ] ],
	pirateHand: [ [ 0, 2, 'tavern' ], [ 2, 10, 'sleep' ], [ 10, 12, 'eat' ], [ 12, 18, 'work' ], [ 18, 24, 'tavern' ] ],
	fence: [ [ 0, 3, 'work' ], [ 3, 11, 'sleep' ], [ 11, 12, 'wake' ], [ 12, 24, 'work' ] ],
	pirateWatch: [ [ 0, 8, 'watch' ], [ 8, 16, 'sleep' ], [ 16, 20, 'tavern' ], [ 20, 24, 'watch' ] ],
};
export const ACTIVITIES = new Set( [ 'sleep', 'wake', 'work', 'eat', 'tavern', 'play', 'stroll', 'watch', 'lamps', 'drunk' ] );

export function validTownSchedule( s ) {

	if ( ! Array.isArray( s ) || ! s.length || s[ 0 ][ 0 ] !== 0 || s[ s.length - 1 ][ 1 ] !== 24 ) return false;
	for ( let i = 0; i < s.length; i ++ ) {

		const [ a, b, act ] = s[ i ];
		if ( ! ( b > a ) || ! ACTIVITIES.has( act ) || ( i > 0 && s[ i - 1 ][ 1 ] !== a ) ) return false;

	}

	return true;

}

export function townActivity( role, hour ) {

	const s = TOWN_SCHEDULES[ role ] || TOWN_SCHEDULES.folk;
	const h = ( ( hour % 24 ) + 24 ) % 24;
	for ( let i = 0; i < s.length; i ++ ) if ( h >= s[ i ][ 0 ] && h < s[ i ][ 1 ] ) return s[ i ][ 2 ];
	return s[ s.length - 1 ][ 2 ];

}

// which job a role works at, and the role a line comes from (ResidentData ROLE_LINES)
const JOB = { vendor: 'stall', fence: 'stall', fisher: 'nets', dockworker: 'carry', pirateHand: 'carry', carter: 'barrow', carpenter: 'hammer', sweeper: 'sweep' };
const LINE_ROLE = { vendor: 'merchant', fence: 'smuggler', carter: 'dockworker', carpenter: 'dockworker', sweeper: 'dockworker', pirateHand: 'dockworker', regular: 'tavern', folk: 'tavern', lamplighter: 'guard', watchman: 'guard', pirateWatch: 'guard', pirate: 'smuggler' };
const EXTRA_LINES = {
	vendor: [ 'Best prices on the island. Today only. Every day.', 'Take a look, no charge for looking.' ],
	folk: [ 'Fine day for it.', 'Have you tried the stew at the tavern?', 'The boats came in heavy this morning.' ],
	regular: [ 'One more and then home. Probably.', 'You look like you could use a drink.' ],
	lamplighter: [ 'Every lamp in town, every dusk. Forty years.', 'Mind the oil, friend.' ],
	watchman: [ 'Late to be out. All is well, mind.', 'Keep to the lamps after dark.' ],
	pirate: [ 'Arr. What are you looking at?', 'Rum first. Questions never.', 'Mind your purse round here, mate.', 'The Rum Hole pours till the sun is up.' ],
	pirateHand: [ 'Plunder does not stack itself.', 'Heave, ho, and so on.' ],
	fence: [ 'No names, no trouble.' ],
	pirateWatch: [ 'The fort sees every sail.', 'Move along, landlubber.' ],
	child: [ 'Tag! You are it!', 'Catch me if you can!' ],
};
const TIME_HELLO = ( hour ) => hour < 11 ? 'Morning!' : hour < 17 ? 'Afternoon!' : hour < 22 ? 'Evening!' : 'Late one, eh?';

// the clip names a body plays (the feature resolves each through its fallback chain)
const LOOK = {
	stall: { base: 'Idle_Breathe', gestures: [ 'Point_Out', 'Talk', 'Wave', 'Shrug' ] },
	nets: { base: 'Fish_Net', gestures: [ 'Inspect_Catch', 'Look_Around' ] },
	fish: { base: 'Fishing_Hold', gestures: [ 'Fishing_Reel', 'Inspect_Catch' ] },
	hammer: { base: 'Hammer', gestures: [ 'Inspect_Catch', 'Kneel_Work' ] },
	carryEnd: { base: 'Kneel_Work', gestures: [] },
	sweep: { base: 'Sweep', gestures: [ 'Look_Around' ] },
	wake: { base: 'Idle_Breathe', gestures: [ 'Look_Around', 'Shrug', 'Friendly_Wave' ] },
	gather: { base: 'Talk_Group', gestures: [ 'Laugh', 'Point', 'Shrug', 'Chat_Gesture' ] },
	alone: { base: 'Idle_Breathe', gestures: [ 'Look_Around', 'Lean_Wall' ] },
	browse: { base: 'Idle_Breathe', gestures: [ 'Point', 'Inspect_Catch', 'Shrug' ] },
	// (seated: no standing gestures; Sit_Chair on the way down, Stand_From_Chair on the way up: wave 18E's clips)
	seatEat: { base: 'Sit_Chair_Idle', gestures: [], sit: true },
	seat: { base: 'Sit_Chair_Idle', gestures: [], sit: true },
	standEat: { base: 'Eat', gestures: [ 'Chat_Gesture', 'Laugh' ] },
	patio: { base: 'Drink', gestures: [ 'Talk_Group', 'Laugh', 'Cheer_Clap', 'Point' ] },
	patrol: { base: 'Idle_Breathe', gestures: [ 'Look_Around' ] },
	lamp: { base: 'Lamp_Light', gestures: [] },
	queue: { base: 'Idle_Breathe', gestures: [ 'Look_Around', 'Shrug' ] },
	play: { base: 'Idle_Breathe', gestures: [ 'Cheer_Clap', 'Dance' ] },
	cheer: { base: 'Clap', gestures: [] },
};

const SPEED = { walk: 1.05, run: 3.1, drunk: 0.6, sweep: 0.4, barrow: 0.85, carry: 0.9, patrol: 0.85, chase: 2.6, flee: 2.2 };
const FAR_TICK = 0.5; // s: citizens away from the player step at 2 Hz
const NEAR_R = 75; // m: within this they step every frame
const DORMANT_R = 450; // m beyond the town's radius: activities jump (no walking)
const SEP = 0.85; // m: personal space

const wrap = ( a ) => Math.atan2( Math.sin( a ), Math.cos( a ) );

class Slots {

	constructor() { this.held = new Map(); }

	claim( key, n, id, pick = null ) {

		if ( ! n ) return - 1;
		let m = this.held.get( key );
		if ( ! m ) this.held.set( key, m = new Map() );
		for ( const i of m.keys() ) if ( m.get( i ) === id ) return i; // (keys: no [ i, who ] pair a step; wave 20A)
		const start = pick !== null ? pick : hashId( id ) % n;
		for ( let k = 0; k < n; k ++ ) {

			const i = ( start + k ) % n;
			if ( ! m.has( i ) ) { m.set( i, id ); return i; }

		}

		return - 1;

	}

	count( key ) {

		const m = this.held.get( key );
		return m ? m.size : 0;

	}

	release( id ) {

		for ( const m of this.held.values() ) for ( const i of m.keys() ) if ( m.get( i ) === id ) m.delete( i );

	}

}

export class Citizen {

	constructor( sim, d ) {

		this.sim = sim;
		// every field declared here, in one order: one hidden class for all (a megamorphic load of a double boxes it)
		this.id = d.id; this.role = d.role; this.town = d.town; this.port = d.port; this.name = d.name;
		this.character = d.character; this.scale = d.scale; this.home = d.home;
		this.stall = null; this.loop = null; this.gather = null; this.leaveVia = null; this.light = null;
		this.greetAt = - 1e9; this.callAt = - 1e9; this.fleeT = 0.5; this.speedNow = 0.5; this._tagT = 0.5;
		this.fleeT = 0; this.speedNow = 0; this._tagT = 0;
		this.standT = 0; // s left of getting up from a seat
		this.seatH = 0.45; // the seat last sat on (m over the ground)
		this.job = JOB[ this.role ] || null;
		const h = hashId( this.id );
		this.hourOff = ( ( h >>> 3 ) % 70 ) / 100 - 0.35; // not everyone leaves on the stroke of the hour
		this.walkSpeed = SPEED.walk * ( 0.9 + ( ( h >>> 11 ) % 20 ) / 100 );
		this.drunkard = this.role === 'pirate' ? ( h % 3 ) === 0 : this.role === 'regular' ? ( h % 2 ) === 0 : false;
		const pool = [ ...( ROLE_LINES[ LINE_ROLE[ this.role ] || this.role ] || ROLE_LINES.tavern ), ...( EXTRA_LINES[ this.role ] || [] ) ];
		this.lines = pool;
		this.lineIdx = h % pool.length;
		this.x = this.home.x; this.z = this.home.z; this.y = 0;
		this.yaw = this.home.yaw || 0;
		this.act = null;
		this.goal = null; // { x, z, yaw, look, indoors, sit, h, dwell, kind }
		this.path = null;
		this.moving = false;
		this.mode = 'walk'; // walk | run | drunk | sweep | barrow | carry | patrol | chase | flee
		this.hidden = false;
		this.indoorFloor = null; // (wave 19E) seated in an interior (src/world/interiors): its floor's height
		this.indoorDoor = null;
		this.waitT = 0; // s at the goal
		this.gesture = null;
		this.gestureT = 4 + ( h % 7 );
		this.gestureLeft = 0;
		this.react = null; // { clip, t, yaw }
		this.fleeing = false;
		this.loaded = false; // carrying a crate
		this.stage = 0; // index in a loop (carry ends, barrow points, patrol nodes, lamps)
		this.acc = 0;
		this.near = false;
		this.body = null;
		this.greetT = 0;
		this.talkT = 0;
		this.sway = 0;
		this.queueSlot = - 1;
		this.tagIt = false;
		this.tagFreeze = 0;
		this.pending = null; // a route request waiting its turn
		this.lantern = this.role === 'watchman' || this.role === 'pirateWatch';

	}

	line( hour = 12 ) {

		const l = this.lines[ this.lineIdx % this.lines.length ];
		this.lineIdx ++;
		return this.lineIdx % 3 === 1 ? `${ TIME_HELLO( hour ) } ${ l }` : l;

	}

	// the clip the body should play now: { name, loop, speed }
	clip( out = { name: 'Idle_Breathe', loop: true, speed: 1 } ) {

		out.loop = true; out.speed = 1;
		if ( this.react ) { out.name = this.react.clip; out.loop = true; return out; }
		if ( this.standT > 0 ) { out.name = 'Stand_From_Chair'; out.loop = false; return out; }
		if ( this.talkT > 0 ) { out.name = 'Talk'; return out; }
		if ( this.moving ) {

			const m = this.mode;
			if ( m === 'run' || m === 'chase' || m === 'flee' ) { out.name = 'Run_InPlace'; out.speed = Math.max( 0.7, Math.min( 1.6, this.speedNow / 2.0 ) ); return out; }
			out.name = m === 'drunk' ? 'Drunk_Walk' : m === 'carry' && this.loaded ? 'Carry_Box' : m === 'sweep' ? 'Sweep' : 'Walk_InPlace';
			out.speed = Math.max( 0.5, Math.min( 2, this.speedNow / 1.1 ) );
			return out;

		}

		if ( this.gesture ) { out.name = this.gesture; out.loop = false; return out; }
		out.name = ( this.goal && this.goal.look && this.goal.look.base ) || 'Idle_Breathe';
		return out;

	}

	get sitting() {

		return ! this.moving && ! this.react && !! ( this.goal && this.goal.look && this.goal.look.sit && this.arrived );

	}

	get arrived() {

		return ! this.moving && ! this.path && ! this.pending;

	}

}

export class TownSim {

	constructor( plan, { grid = null, rand = Math.random, scale = 1, ground = null, roster = null } = {} ) {

		this.plan = plan;
		this.grid = grid;
		this.rand = rand;
		this.ground = ground; // ( x, z ) -> y (exact; the grid's is per cell)
		this.slots = new Slots();
		this.list = [];
		this.time = 0;
		this.hour = 12;
		this.alarmT = 0;
		this.queueT = 0;
		this.queueServeT = 0;
		this.routesPerFrame = 2;
		this._routeQ = [];
		this.dormant = true;
		this.seats = plan.seats.slice();
		this._clipScratch = { name: '', loop: true, speed: 1 };
		this._populate( roster || plan, scale );

	}

	setSeats( extra ) {

		// another worker's benches (18C) come first: they are real seats
		if ( extra && extra.length ) this.seats = [ ...extra, ...this.plan.seats ];

	}

	_populate( roster, scale ) {

		const plan = this.plan;
		const pop = ( roster.population || roster ).roles || {};
		const homes = [ ...plan.homes, ...plan.outskirts ];
		let n = 0;
		for ( const [ role, count ] of Object.entries( pop ) ) {

			const want = Math.max( role === 'watchman' || role === 'vendor' || role === 'lamplighter' || role === 'fence' ? Math.min( 1, count ) : 0, Math.round( count * scale ) );
			for ( let k = 0; k < want; k ++, n ++ ) {

				const id = `${ plan.id }.${ role }${ k }`;
				const h = hashId( id );
				const pirate = role.startsWith( 'pirate' ) || role === 'fence';
				const child = role === 'child';
				const home = homes[ ( h >>> 4 ) % homes.length ];
				this.list.push( new Citizen( this, {
					id, role, town: plan.id, port: plan.port,
					name: FOLK_NAMES[ ( h >>> 7 ) % FOLK_NAMES.length ] + ( pirate ? [ ' the Red', ' One-Eye', ' Saltjaw', ' the Rat', ' Longshanks', '' ][ h % 6 ] : '' ),
					character: pirate ? [ 'bonk', 'clown', 'doge', 'pepe', 'bravile', 'heptyle' ][ ( h >>> 9 ) % 6 ] : FOLK_CHARACTERS[ ( h >>> 9 ) % FOLK_CHARACTERS.length ],
					scale: child ? 0.6 + ( ( h >>> 13 ) % 12 ) / 100 : 0.92 + ( ( h >>> 13 ) % 14 ) / 100,
					home,
				} ) );

			}

		}

	}

	byId( id ) {

		return this.list.find( ( c ) => c.id === id ) || null;

	}

	// ------------------------------------------------------------------ reactions

	// cannon fire, a raid, an explosion: everyone within `radius` of (x, z) (everyone: x null) runs home and stays in
	alarm( x = null, z = null, seconds = 75, radius = 150 ) {

		let n = 0;
		for ( const c of this.list ) {

			if ( c.hidden && c.fleeing ) { c.fleeT = Math.max( c.fleeT, seconds ); continue; }
			if ( x !== null && Math.hypot( c.x - x, c.z - z ) > radius ) continue;
			if ( c.role === 'pirateWatch' ) continue; // the fort's men stand to
			c.fleeing = true;
			c.fleeT = seconds;
			c.react = null;
			this.slots.release( c.id );
			const home = c.home;
			this._goal( c, { x: home.x, z: home.z, yaw: home.yaw, indoors: true, kind: 'flee' }, 'run' );
			n ++;

		}

		if ( n ) this.alarmT = Math.max( this.alarmT, seconds );
		return n;

	}

	// a big catch landed near (x, z): those around turn and clap
	cheer( x, z, radius = 24 ) {

		let n = 0;
		for ( const c of this.list ) {

			if ( c.hidden || c.fleeing || c.moving && c.mode !== 'walk' ) continue;
			if ( Math.hypot( c.x - x, c.z - z ) > radius ) continue;
			c.react = { clip: n % 2 ? 'Cheer_Clap' : 'Clap', t: 3.2 + ( n % 3 ) * 0.4, yaw: yawToward( c.x, c.z, x, z ) };
			n ++;

		}

		return n;

	}

	// the catch comes in: a few go and queue at the fish hall
	callQueue( seconds = 90 ) {

		const H = this.plan.hall;
		if ( ! H || this.queueT > 0 ) return 0;
		this.queueT = seconds;
		this.queueServeT = 14;
		const cand = this.list.filter( ( c ) => ! c.hidden && ! c.fleeing && ( c.act === 'stroll' || c.act === 'wake' || c.act === 'eat' ) && c.role !== 'child' )
			.sort( ( a, b ) => Math.hypot( a.x - H.x, a.z - H.z ) - Math.hypot( b.x - H.x, b.z - H.z ) );
		let n = 0;
		for ( const c of cand.slice( 0, H.queue.length ) ) {

			this.slots.release( c.id );
			c.queueSlot = n;
			const q = H.queue[ n ];
			this._goal( c, { x: q.x, z: q.z, yaw: q.yaw, look: LOOK.queue, kind: 'queue', dwell: Infinity } );
			n ++;

		}

		return n;

	}

	_serveQueue() {

		const H = this.plan.hall;
		const inQ = this.list.filter( ( c ) => c.queueSlot >= 0 ).sort( ( a, b ) => a.queueSlot - b.queueSlot );
		if ( ! inQ.length ) return;
		const first = inQ[ 0 ];
		first.queueSlot = - 1;
		first.act = null; // back to the day plan
		for ( const c of inQ.slice( 1 ) ) {

			c.queueSlot --;
			const q = H.queue[ c.queueSlot ];
			this._goal( c, { x: q.x, z: q.z, yaw: q.yaw, look: LOOK.queue, kind: 'queue', dwell: Infinity } );

		}

	}

	// how many are at the tavern (on the patio, or inside)
	crowd() {

		let n = 0;
		for ( const c of this.list ) if ( c.act === 'tavern' && ( c.arrived || c.hidden ) ) n ++;
		return n;

	}

	// ------------------------------------------------------------------ goals

	_goal( c, goal, mode = 'walk' ) {

		// (wave 19E) out of an interior: back at its door first
		if ( c.indoorFloor !== null ) { c.x = c.indoorDoor.x; c.z = c.indoorDoor.z; c.indoorFloor = null; c.indoorDoor = null; }
		// up from a seat first (the near ones play it; out of sight they just go)
		if ( c.sitting && ! this.dormant && c.near ) c.standT = 1.1;
		c.goal = goal;
		c.mode = mode;
		c.waitT = 0;
		c.gesture = null;
		c.path = null;
		c.moving = false;
		if ( c.hidden && ! goal.indoors ) c.hidden = false;
		if ( this.dormant || ! this.grid || ! this.grid.ready ) {

			this._teleport( c, goal );
			return;

		}

		if ( Math.hypot( goal.x - c.x, goal.z - c.z ) < 0.3 ) { this._arrive( c ); return; }
		c.pending = goal;
		if ( ! this._routeQ.includes( c ) ) this._routeQ.push( c );

	}

	_teleport( c, goal ) {

		c.pending = null;
		c.path = null;
		c.x = goal.x; c.z = goal.z;
		this._arrive( c );

	}

	_arrive( c ) {

		const g = c.goal;
		c.moving = false;
		c.path = null;
		c.pending = null;
		c.waitT = 0;
		if ( ! g ) return;
		if ( Number.isFinite( g.yaw ) ) c.yaw = g.yaw;
		if ( g.indoors && g.seat ) {

			// (wave 19E) through the tavern's door to a seat in its interior: seated there, drawn on its floor
			c.indoorDoor = { x: g.x, z: g.z };
			c.x = g.seat.x; c.z = g.seat.z; c.yaw = g.seat.yaw + Math.PI;
			c.indoorFloor = g.seat.floor;
			c.hidden = false;

		} else if ( g.indoors ) c.hidden = true;
		if ( g.look && g.look.sit ) {

			c.seatH = Number.isFinite( g.h ) ? g.h : 0.45;
			c.gesture = 'Sit_Chair'; // down onto the seat, then the seated loop
			c.gestureLeft = 1.5;

		}
		c.leaveVia = g.look && g.look.sit && Number.isFinite( g.yaw ) ? { x: g.x - Math.sin( g.yaw ) * 0.75, z: g.z - Math.cos( g.yaw ) * 0.75 } : null;
		if ( g.kind === 'carry' ) c.loaded = ! c.loaded;

	}

	_routeNext() {

		for ( let k = 0; k < this.routesPerFrame && this._routeQ.length; k ++ ) {

			const c = this._routeQ.shift();
			const g = c.pending;
			if ( ! g ) continue;
			c.pending = null;
			// a seat is reached from in front of it (not over the bench)
			const via = g.look && g.look.sit && Number.isFinite( g.yaw ) ? { x: g.x - Math.sin( g.yaw ) * 0.75, z: g.z - Math.cos( g.yaw ) * 0.75 } : null;
			// getting up from a seat: out to its front first
			const out = c.leaveVia;
			c.leaveVia = null;
			const sx = out ? out.x : c.x, sz = out ? out.z : c.z;
			const path = via ? this.grid.route( sx, sz, via.x, via.z ) : this.grid.route( sx, sz, g.x, g.z );
			if ( path && via ) path.push( { x: g.x, z: g.z } );
			if ( path && out ) path.unshift( out );
			if ( ! path || ! path.length ) {

				// unreachable: out of sight it simply gets there; in sight it gives up and thinks again
				if ( ! c.near ) this._teleport( c, g );
				else { c.goal = null; c.act = null; }
				continue;

			}

			c.path = path;
			c.moving = true;

		}

	}

	// what an activity asks of a citizen now (sets the goal)
	_plan( c, act ) {

		const P = this.plan, S = this.slots, R = this.rand;
		this.slots.release( c.id );
		c.react = null;
		c.queueSlot = - 1;
		c.stage = 0;
		const home = c.home;
		switch ( act ) {

			case 'sleep':
				return this._goal( c, { x: home.x, z: home.z, yaw: home.yaw, indoors: true, kind: 'home' } );
			case 'drunk':
				return this._goal( c, { x: home.x, z: home.z, yaw: home.yaw, indoors: true, kind: 'home' }, c.drunkard ? 'drunk' : 'walk' );
			case 'wake': {

				const yaw = home.yaw; // (a door's yaw faces out of the house)
				const x = home.x - Math.sin( yaw ) * 1.6, z = home.z - Math.cos( yaw ) * 1.6;
				return this._goal( c, { x, z, yaw, look: LOOK.wake, kind: 'wake' } );

			}

			case 'work':
				return this._work( c );
			case 'watch':
				return this._patrol( c );
			case 'lamps':
				return this._lamp( c );
			case 'eat': {

				const k = S.claim( 'seat', this.seats.length, c.id );
				if ( k >= 0 ) { const s = this.seats[ k ]; return this._goal( c, { x: s.x, z: s.z, yaw: s.yaw, h: s.h, look: LOOK.seatEat, kind: 'seat', dwell: Infinity } ); }
				const pk = S.claim( 'patio', P.tavern ? P.tavern.patio.length : 0, c.id );
				if ( pk >= 0 ) { const s = P.tavern.patio[ pk ]; return this._goal( c, { ...s, look: LOOK.standEat, kind: 'patio', dwell: Infinity } ); }
				return this._stroll( c );

			}

			case 'tavern': {

				const T = P.tavern;
				if ( ! T ) return this._stroll( c );
				const k = S.claim( 'patio', T.patio.length, c.id );
				if ( k >= 0 ) { const s = T.patio[ k ]; return this._goal( c, { ...s, look: LOOK.patio, kind: 'patio', dwell: Infinity } ); }
				const sk = S.claim( 'seat', this.seats.length, c.id );
				if ( sk >= 0 && Math.hypot( this.seats[ sk ].x - T.door.x, this.seats[ sk ].z - T.door.z ) < 25 ) { const s = this.seats[ sk ]; return this._goal( c, { x: s.x, z: s.z, yaw: s.yaw, h: s.h, look: LOOK.seat, kind: 'seat', dwell: Infinity } ); }
				S.release( c.id );
				// the patio is full: inside, where it is loud (wave 19E: on a free seat of the tavern's interior when it has one)
				const In = this.interiorSeats ? this.interiorSeats() : null;
				const ik = In && In.length ? S.claim( 'inside', In.length, c.id ) : - 1;
				if ( ik >= 0 ) { const s = In[ ik ]; return this._goal( c, { x: T.door.x, z: T.door.z, yaw: T.door.yaw, indoors: true, kind: 'tavernIn', look: LOOK.seat, h: s.h, seat: s, dwell: Infinity } ); }
				return this._goal( c, { x: T.door.x, z: T.door.z, yaw: T.door.yaw, indoors: true, kind: 'tavernIn' } );

			}

			case 'play':
				if ( P.play ) {

					const a = R() * Math.PI * 2, r = R() * P.play.r * 0.8;
					c.stage = 0;
					return this._goal( c, { x: P.play.x + Math.cos( a ) * r, z: P.play.z + Math.sin( a ) * r, look: LOOK.play, kind: 'play', dwell: 2 + R() * 4 } );

				}

				return this._stroll( c );
			default:
				return this._stroll( c );

		}

	}

	_work( c ) {

		const W = this.plan.work, S = this.slots;
		const at = ( list, key, look ) => {

			const k = S.claim( key, list ? list.length : 0, c.id );
			if ( k < 0 ) return false;
			const s = list[ k ];
			this._goal( c, { x: s.x, z: s.z, yaw: s.yaw, look, kind: key, dwell: Infinity } );
			return true;

		};

		switch ( c.job ) {

			case 'stall': {

				const k = S.claim( 'stall', this.plan.stalls.length, c.id );
				if ( k >= 0 ) { const s = this.plan.stalls[ k ]; c.stall = s; return this._goal( c, { ...s.vendor, look: LOOK.stall, kind: 'stall', dwell: Infinity } ); }
				break;

			}

			case 'nets':
				if ( at( W.nets, 'nets', LOOK.nets ) || at( W.fish, 'fish', LOOK.fish ) ) return;
				break;
			case 'hammer':
				if ( at( W.hammer, 'hammer', LOOK.hammer ) ) return;
				break;
			case 'carry': {

				const k = S.claim( 'carry', W.carry.length * 2, c.id );
				if ( k >= 0 ) { c.loop = W.carry[ k % W.carry.length ]; c.loaded = false; c.stage = 0; return this._goal( c, { ...c.loop[ 0 ], look: LOOK.carryEnd, kind: 'carry', dwell: 2.5 }, 'carry' ); }
				break;

			}

			case 'barrow': {

				const k = S.claim( 'barrow', W.barrow.length, c.id );
				if ( k >= 0 ) { c.loop = W.barrow[ k ]; c.stage = 0; return this._goal( c, { ...c.loop[ 0 ], look: LOOK.wake, kind: 'barrow', dwell: 4 }, 'barrow' ); }
				break;

			}

			case 'sweep': {

				const k = S.claim( 'sweep', W.sweep.length, c.id );
				if ( k >= 0 ) { c.loop = W.sweep[ k ]; c.stage = 0; return this._goal( c, { ...c.loop[ 0 ], look: LOOK.sweep, kind: 'sweepAt', dwell: 12 }, 'sweep' ); }
				break;

			}

			default:
				break;

		}

		// nothing free at the job: the fish on the pier, else a stroll
		if ( c.job === 'nets' || c.job === 'carry' ) if ( at( W.fish, 'fish', LOOK.fish ) ) return;
		return this._stroll( c );

	}

	_patrol( c ) {

		const P = this.plan.patrol;
		if ( ! P || ! P.length ) return this._stroll( c );
		c.loop = P;
		c.stage = hashId( c.id ) % P.length;
		const q = P[ c.stage ];
		this._goal( c, { x: q.x, z: q.z, look: LOOK.patrol, kind: 'patrol', dwell: 4 }, 'patrol' );

	}

	_lamp( c ) {

		const L = this.plan.lamps;
		if ( ! L || ! L.length ) return this._stroll( c );
		c.loop = L;
		const q = L[ c.stage % L.length ];
		this._goal( c, { x: q.x, z: q.z, yaw: q.yaw, look: LOOK.lamp, kind: 'lamp', dwell: 3.5 } );

	}

	// a stroll: a gathering, a stall to browse, a seat, or somewhere along the streets
	_stroll( c ) {

		const P = this.plan, S = this.slots, R = this.rand;
		S.release( c.id );
		c.gather = null;
		const roll = R();
		if ( roll < 0.45 && P.gathers.length ) {

			// prefer a gathering someone already waits at
			const order = P.gathers.map( ( g, i ) => [ S.count( g.id ) % 3 ? 0 : 1, R(), i ] ).sort( ( a, b ) => a[ 0 ] - b[ 0 ] || a[ 1 ] - b[ 1 ] );
			for ( const [ , , i ] of order ) {

				const g = P.gathers[ i ];
				const k = S.claim( g.id, g.slots.length, c.id );
				if ( k < 0 ) continue;
				c.gather = g;
				const s = g.slots[ k ];
				return this._goal( c, { ...s, look: LOOK.gather, kind: 'gather', dwell: 30 + R() * 50 } );

			}

		}

		if ( roll < 0.7 && P.stalls.length ) {

			const s = P.stalls[ Math.floor( R() * P.stalls.length ) ];
			const k = S.claim( 'front:' + s.id, s.front.length, c.id );
			if ( k >= 0 ) return this._goal( c, { ...s.front[ k ], look: LOOK.browse, kind: 'browse', dwell: 15 + R() * 25 } );

		}

		if ( roll < 0.82 && this.seats.length ) {

			const k = S.claim( 'seat', this.seats.length, c.id, Math.floor( R() * this.seats.length ) );
			if ( k >= 0 ) { const s = this.seats[ k ]; return this._goal( c, { x: s.x, z: s.z, yaw: s.yaw, h: s.h, look: LOOK.seat, kind: 'seat', dwell: 40 + R() * 60 } ); }

		}

		// along a street
		const st = P.streets[ Math.floor( R() * P.streets.length ) ];
		if ( st && st.pts.length >= 2 ) {

			const i = Math.floor( R() * ( st.pts.length - 1 ) ), t = R();
			const a = st.pts[ i ], b = st.pts[ i + 1 ];
			let x = a[ 0 ] + ( b[ 0 ] - a[ 0 ] ) * t, z = a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * t;
			let q = { x, z };
			if ( this.grid && this.grid.ready ) q = this.grid.nearestFree( x, z, 4 );
			if ( q ) return this._goal( c, { x: q.x, z: q.z, look: LOOK.alone, kind: 'wander', dwell: 6 + R() * 14 } );

		}

		return this._goal( c, { x: c.home.x, z: c.home.z, yaw: c.home.yaw, look: LOOK.wake, kind: 'wake', dwell: 30 } );

	}

	// the next leg of a loop (carry, barrow, sweep, patrol, lamps) or the next stroll
	_next( c ) {

		const g = c.goal;
		if ( ! g ) return;
		const R = this.rand;
		switch ( g.kind ) {

			case 'carry': {

				c.stage = 1 - c.stage;
				const q = c.loop[ c.stage ];
				return this._goal( c, { ...q, look: LOOK.carryEnd, kind: 'carry', dwell: 2.5 }, 'carry' );

			}

			case 'barrow':
			case 'sweepAt':
			case 'patrol': {

				c.stage = ( c.stage + 1 ) % c.loop.length;
				const q = c.loop[ c.stage ];
				const mode = g.kind === 'barrow' ? 'barrow' : g.kind === 'patrol' ? 'patrol' : 'sweep';
				return this._goal( c, { x: q.x, z: q.z, yaw: q.yaw, look: g.look, kind: g.kind, dwell: g.kind === 'sweepAt' ? 12 : g.kind === 'barrow' ? 4 : 4 + R() * 3 }, mode );

			}

			case 'lamp':
				c.stage ++;
				if ( c.stage >= c.loop.length ) { c.stage = 0; return this._goal( c, { x: c.home.x, z: c.home.z, yaw: c.home.yaw, look: LOOK.wake, kind: 'wake', dwell: Infinity } ); }
				return this._lamp( c );
			case 'play': {

				const P = this.plan.play;
				const a = R() * Math.PI * 2, r = R() * P.r * 0.85;
				return this._goal( c, { x: P.x + Math.cos( a ) * r, z: P.z + Math.sin( a ) * r, look: LOOK.play, kind: 'play', dwell: 2 + R() * 4 }, 'chase' );

			}

			default:
				if ( c.act === 'stroll' || g.kind === 'wander' || g.kind === 'gather' || g.kind === 'browse' || g.kind === 'seat' ) return this._stroll( c );

		}

	}

	// ------------------------------------------------------------------ frame

	update( dt, hour, viewer = null ) {

		dt = Math.min( Math.max( dt || 0, 0 ), 0.25 );
		this.time += dt;
		this.hour = hour;
		const P = this.plan;
		const vd = viewer ? Math.hypot( viewer.x - P.center.x, viewer.z - P.center.z ) : Infinity;
		this.dormant = vd > P.radius + DORMANT_R || ! this.grid || ! this.grid.ready;
		if ( this.alarmT > 0 ) this.alarmT -= dt;
		if ( this.queueT > 0 ) {

			this.queueT -= dt;
			this.queueServeT -= dt;
			if ( this.queueServeT <= 0 ) { this.queueServeT = 14; this._serveQueue(); }
			if ( this.queueT <= 0 ) for ( const c of this.list ) if ( c.queueSlot >= 0 ) { c.queueSlot = - 1; c.act = null; }

		}

		if ( ! this.dormant ) this._routeNext();
		const list = this.list;
		for ( let i = 0; i < list.length; i ++ ) {

			const c = list[ i ];
			const d2 = viewer ? ( c.x - viewer.x ) ** 2 + ( c.z - viewer.z ) ** 2 : Infinity;
			c.near = d2 < NEAR_R * NEAR_R && ! this.dormant;
			c.acc += dt;
			if ( ! c.near ) {

				if ( c.acc < ( this.dormant ? FAR_TICK * 4 : FAR_TICK ) ) continue;

			}

			const step = c.acc;
			c.acc = 0;
			this._think( c, step );
			this._move( c, step, viewer );

		}

		if ( ! this.dormant ) this._tag( dt );

	}

	_think( c, dt ) {

		// running indoors under fire: stay in until the alarm is over
		if ( c.fleeing ) {

			c.fleeT -= dt;
			if ( c.fleeT > 0 ) return;
			c.fleeing = false;
			c.act = null;

		}

		if ( c.react ) {

			c.react.t -= dt;
			if ( c.react.t <= 0 ) c.react = null;
			return;

		}

		if ( c.talkT > 0 ) { c.talkT -= dt; return; }
		if ( c.queueSlot >= 0 ) return;
		const act = townActivity( c.role, this.hour + c.hourOff );
		if ( act !== c.act ) {

			c.act = act;
			this._plan( c, act );
			return;

		}

		if ( ! c.arrived || ! c.goal ) {

			if ( ! c.goal && ! c.pending && ! c.moving ) this._plan( c, act );
			return;

		}

		c.waitT += dt;
		// a gathering of one does not last
		const g = c.goal;
		if ( g.kind === 'gather' && c.gather ) {

			const company = this.slots.count( c.gather.id ) > 1;
			g.look = company ? LOOK.gather : LOOK.alone;
			if ( ! company && c.waitT > 25 ) return this._stroll( c );

		}

		if ( c.waitT >= ( g.dwell ?? Infinity ) ) return this._next( c );
		// idle gestures (bodies only care; the far ones skip them)
		if ( c.gesture ) {

			c.gestureLeft -= dt;
			if ( c.gestureLeft <= 0 ) c.gesture = null;

		} else if ( c.near && g.look && g.look.gestures && g.look.gestures.length ) {

			c.gestureT -= dt;
			if ( c.gestureT <= 0 ) {

				c.gestureT = 6 + this.rand() * 9;
				c.gesture = g.look.gestures[ Math.floor( this.rand() * g.look.gestures.length ) ];
				c.gestureLeft = 3.2;

			}

		}

	}

	_move( c, dt, viewer ) {

		c.speedNow = 0;
		if ( c.standT > 0 ) { c.standT -= dt; return; }
		if ( c.react ) {

			c.yaw += wrap( c.react.yaw - c.yaw ) * Math.min( 1, dt * 6 );
			return;

		}

		if ( c.talkT > 0 && viewer ) {

			c.yaw += wrap( yawToward( c.x, c.z, viewer.x, viewer.z ) - c.yaw ) * Math.min( 1, dt * 5 );
			return;

		}

		if ( ! c.moving || ! c.path ) return;
		const sp = c.mode === 'run' ? SPEED.run : c.mode === 'drunk' ? SPEED.drunk : c.mode === 'walk' ? c.walkSpeed : SPEED[ c.mode ] || c.walkSpeed;
		let left = sp * dt;
		c.speedNow = sp;
		let guard = 0;
		while ( left > 1e-4 && c.path.length && guard ++ < 32 ) {

			const n = c.path[ 0 ];
			const dx = n.x - c.x, dz = n.z - c.z, d = Math.hypot( dx, dz );
			if ( d <= left ) {

				c.x = n.x; c.z = n.z;
				left -= d;
				c.path.shift();
				continue;

			}

			c.x += dx / d * left;
			c.z += dz / d * left;
			const want = yawToward( 0, 0, dx, dz );
			c.yaw += wrap( want - c.yaw ) * Math.min( 1, dt * 7 );
			left = 0;

		}

		if ( ! c.path.length ) {

			this._arrive( c );
			return;

		}

		// personal space and the player: a small sidestep that stays on free ground (near citizens only)
		if ( c.near ) this._avoid( c, dt, viewer );
		if ( c.mode === 'drunk' ) c.sway += dt * 1.7;

	}

	_avoid( c, dt, viewer ) {

		let px = 0, pz = 0;
		const all = this.list;
		for ( let i = 0; i < all.length; i ++ ) {

			const o = all[ i ];
			if ( o === c || o.hidden || ! o.near ) continue;
			const dx = c.x - o.x, dz = c.z - o.z;
			if ( Math.abs( dx ) > SEP || Math.abs( dz ) > SEP ) continue;
			const d = Math.hypot( dx, dz );
			if ( d < 1e-3 || d > SEP ) continue;
			const k = ( SEP - d ) / SEP;
			px += dx / d * k; pz += dz / d * k;

		}

		if ( viewer ) {

			const dx = c.x - viewer.x, dz = c.z - viewer.z, d = Math.hypot( dx, dz );
			if ( d > 1e-3 && d < 1.3 ) { const k = ( 1.3 - d ) / 1.3 * 1.5; px += dx / d * k; pz += dz / d * k; }

		}

		if ( ! px && ! pz ) return;
		const m = Math.min( 1, dt * 2.2 );
		const nx = c.x + px * m, nz = c.z + pz * m;
		// half a metre on in the push's direction must be free too (the cells are 1 m: a post sits inside a free one's edge)
		const L = Math.hypot( px, pz ) || 1;
		if ( ! this.grid || this.grid.clear( c.x, c.z, nx + px / L * 0.5, nz + pz / L * 0.5 ) ) { c.x = nx; c.z = nz; }

	}

	// the children's tag: the one who is "it" chases the nearest, the rest keep away inside the play area
	_tag( dt ) {

		const P = this.plan.play;
		if ( ! P ) return;
		const kids = this._kids || ( this._kids = [] );
		kids.length = 0;
		for ( const c of this.list ) if ( c.act === 'play' && c.near && ! c.hidden && c.goal && c.goal.kind === 'play' ) kids.push( c );
		if ( kids.length < 2 ) return;
		let it = kids.find( ( k ) => k.tagIt );
		if ( ! it ) { it = kids[ 0 ]; it.tagIt = true; it.tagFreeze = 1.5; }
		for ( const k of kids ) {

			if ( k.tagFreeze > 0 ) { k.tagFreeze -= dt; k.moving = false; k.path = null; continue; }
			let tx, tz, sp;
			if ( k === it ) {

				let best = null, bd = Infinity;
				for ( const o of kids ) if ( o !== k ) { const d = Math.hypot( o.x - k.x, o.z - k.z ); if ( d < bd ) { bd = d; best = o; } }
				if ( ! best ) continue;
				if ( bd < 0.7 ) {

					// tagged: the other one is it now and counts to three
					k.tagIt = false; best.tagIt = true; best.tagFreeze = 1.8; k.tagFreeze = 0.4;
					best.react = { clip: 'Cheer_Clap', t: 1.2, yaw: best.yaw };
					continue;

				}

				tx = best.x; tz = best.z; sp = SPEED.chase;

			} else {

				const d = Math.hypot( k.x - it.x, k.z - it.z );
				if ( d > 6 ) continue; // the wander goal moves it
				tx = k.x + ( k.x - it.x ) / ( d || 1 ) * 3; tz = k.z + ( k.z - it.z ) / ( d || 1 ) * 3; sp = SPEED.flee;

			}

			// stay inside the play area
			const ox = tx - P.x, oz = tz - P.z, od = Math.hypot( ox, oz );
			if ( od > P.r ) { tx = P.x + ox / od * P.r; tz = P.z + oz / od * P.r; }
			const dx = tx - k.x, dz = tz - k.z, d = Math.hypot( dx, dz );
			if ( d < 0.05 ) continue;
			const s = Math.min( d, sp * dt );
			const nx = k.x + dx / d * s, nz = k.z + dz / d * s;
			if ( this.grid && ! this.grid.free( nx, nz ) ) continue;
			k.x = nx; k.z = nz;
			k.path = null;
			k.moving = true;
			k.mode = 'chase';
			k.speedNow = sp;
			k.yaw = yawToward( 0, 0, dx, dz );
			k.waitT = 0;
			k._tagT = 0.25; // seen moving this frame

		}

		for ( const k of kids ) {

			if ( k._tagT > 0 ) { k._tagT -= dt; if ( k._tagT <= 0 ) k.moving = false; }

		}

	}

}

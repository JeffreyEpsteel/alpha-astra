// Plain-node tests of the island residents (no GPU, no GLBs): the cast data (residents/ResidentData.js)
// and the Residents state machine with a fake avatar that records what it plays.
//   node test/residents.mjs
import { Quaternion, Vector3 } from '../src/engine/index.js';
import { CHARACTERS, CLIP_SPEED } from '../src/game/Characters.js';
import { WORLD } from '../src/world/WorldLayout.js';
import { Residents } from '../src/world/Residents.js';
import {
	RESIDENTS, GESTURE_FALLBACK, LOOK_CLAMP, PRANK_WINDOW, TALK_S, PATROL_SPEED, yawToward,
} from '../src/world/residents/ResidentData.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};
const near = ( a, b, eps = 1e-3 ) => Math.abs( a - b ) <= eps;
const wrap = ( a ) => Math.atan2( Math.sin( a ), Math.cos( a ) );

// ---------------------------------------------------------------- the cast
{

	const half = WORLD.terrainSize / 2;
	const ids = new Set();
	// cottage / shed / stall / boathouse centres from Village._layout: no spot or node inside 4.5 m
	const buildings = [
		[ 13.5, - 106.5 ], [ 26.5, - 112 ], [ 62.5, - 106 ], [ 79, - 110.5 ], [ 96, - 115.5 ], [ - 3, - 125 ], [ 16.5, - 130 ],
		[ 57.5, - 128.5 ], [ 75.5, - 132.5 ], [ 96.5, - 135 ], [ 3.5, - 151 ], [ 30.5, - 149 ], [ 55, - 152.5 ], [ 78.5, - 156 ],
		[ 67.8, - 64.6 ], [ 79.8, - 70.4 ], [ 37.2, - 72.4 ], [ 21.5, - 119.5 ], [ 68, - 124 ], [ 89, - 146 ], [ 43.5, - 155.5 ],
		[ 92.5, - 57.5 ], [ 40.2, - 113.2 ], [ 49.9, - 74.6 ], [ 85.5, - 60.5 ],
	];
	const P = WORLD.pier;
	const onLand = ( pt, deck ) => {

		if ( Math.abs( pt.x ) >= half || Math.abs( pt.z ) >= half ) return false;
		if ( deck ) return pt.x > P.x - P.headWidth / 2 && pt.x < P.x + P.headWidth / 2 && pt.z > P.zEnd - P.headDepth && pt.z < P.zEnd;
		return pt.z < 0;

	};
	const clear = ( pt ) => buildings.every( ( [ bx, bz ] ) => Math.hypot( pt.x - bx, pt.z - bz ) >= 4.5 );
	ok( RESIDENTS.length >= 10, `${ RESIDENTS.length } residents` );
	for ( const r of RESIDENTS ) {

		ok( ! ids.has( r.id ), `${ r.id }: unique id` );
		ids.add( r.id );
		ok( !! CHARACTERS[ r.character ], `${ r.id }: roster character ${ r.character }` );
		ok( typeof r.name === 'string' && r.name.length > 0, `${ r.id }: name` );
		ok( !! r.spot !== !! r.patrol, `${ r.id }: a spot or a patrol, not both` );
		if ( r.spot ) {

			ok( onLand( r.spot, r.spot.deck ), `${ r.id }: spot on the island${ r.spot.deck ? ' (pier head)' : '' }` );
			ok( Number.isFinite( r.spot.yaw ), `${ r.id }: spot yaw` );
			if ( ! r.spot.deck ) ok( clear( r.spot ), `${ r.id }: spot clear of buildings` );

		}

		if ( r.patrol ) {

			ok( r.patrol.length >= 2, `${ r.id }: patrol has ${ r.patrol.length } nodes` );
			ok( r.patrol.every( ( n ) => onLand( n, false ) ), `${ r.id }: patrol nodes on the island` );
			ok( r.patrol.every( clear ), `${ r.id }: patrol nodes clear of buildings` );
			ok( r.patrol.every( ( n, i ) => i === 0 || Math.hypot( n.x - r.patrol[ i - 1 ].x, n.z - r.patrol[ i - 1 ].z ) > 1 ), `${ r.id }: nodes apart` );

		}

		ok( Array.isArray( r.lines ) && r.lines.length >= 3 && r.lines.every( ( l ) => l.length < 90 ), `${ r.id }: 3+ short lines` );
		ok( Array.isArray( r.gestures ) && r.gestures.length >= 1, `${ r.id }: gestures` );
		if ( r.face ) ok( RESIDENTS.some( ( o ) => o.id === r.face && o.spot ), `${ r.id }: faces ${ r.face }` );
		if ( r.prank ) ok( r.launch && Math.hypot( r.launch.x, r.launch.z ) > 0, `${ r.id}: prank has a launch direction` );

	}

	ok( RESIDENTS.filter( ( r ) => r.prank ).length === 1 && RESIDENTS.find( ( r ) => r.prank ).character === 'clown', 'one prank: the clown' );
	ok( new Set( RESIDENTS.map( ( r ) => r.character ) ).size >= 7, 'the roster is varied' );
	// the yaw helper: faces -Z at 0, +X at -PI/2
	ok( near( yawToward( 0, 0, 0, - 5 ), 0 ) && near( yawToward( 0, 0, 5, 0 ), - Math.PI / 2 ), 'yawToward convention' );
	ok( Object.values( GESTURE_FALLBACK ).every( ( v ) => typeof v === 'string' ), 'gesture fallbacks are clip names' );

}

// ---------------------------------------------------------------- fake avatars
const EXTRA = [ 'Chat_Gesture', 'Sweep_Work', 'Beckon', 'Prank_Laugh', 'Laugh', 'Point', 'Shrug', 'Swagger_Idle', 'Friendly_Wave', 'Inspect_Catch' ];
const BASE = [ 'Idle_Breathe', 'Walk_InPlace', 'Run_InPlace', 'Jump', 'Wave', 'Fishing_Hold', 'Fishing_Reel', 'Talk', 'Dance', 'Look_Around', 'Cheer_Clap' ];

class FakeModel {

	constructor( clips ) {

		this.clips = new Set( clips );
		this.calls = [];
		this.updates = 0;
		this.holds = 0;
		this.current = null;
		this.loop = true;
		this.t = 0;
		this.ended = false;
		this.onClipEnd = null;

	}

	play( name, { fade = 0.4, loop = true, speed = 1 } = {} ) {

		if ( ! this.clips.has( name ) ) throw new Error( 'no clip ' + name );
		if ( name === this.current ) return;
		this.calls.push( { name, fade, loop, speed } );
		this.current = name; this.loop = loop; this.t = 0; this.ended = false;

	}

	update( dt ) {

		this.updates ++;
		this.t += dt;
		if ( ! this.loop && ! this.ended && this.t >= 1.0 ) { this.ended = true; if ( this.onClipEnd ) this.onClipEnd( this.current ); }

	}

	hold() { this.holds ++; }

}

const made = [];
const fakeFactory = ( extra ) => ( { scene, character, lite } ) => {

	const model = new FakeModel( [ ...BASE, ...( extra ? EXTRA : [] ) ] );
	const a = {
		character, lite, scene, model, disposed: false,
		group: { position: new Vector3(), quaternion: new Quaternion(), scale: new Vector3( 1, 1, 1 ), visible: true, updateMatrixWorld() {} },
		ready: Promise.resolve( model ),
		dispose() { this.disposed = true; },
	};
	made.push( a );
	return a;

};
const scene = { add() {}, remove() {} };
const terrain = { heightAt: () => 2 };
const colliders = { groundHeightAt: ( x, z, maxY ) => ( maxY > 30 && z > 0 ? 2.3 : - Infinity ) }; // the pier deck only
const player = ( x, z, y = 2 ) => ( { position: new Vector3( x, y, z ), mode: 'walk' } );
const run = ( R, p, seconds, dt = 0.05 ) => { for ( let t = 0; t < seconds - 1e-9; t += dt ) R.update( dt, p ); };

// ---------------------------------------------------------------- construction
const R = new Residents( { scene, terrain, colliders, village: null, avatarFactory: fakeFactory( true ) } );
await R.ready;
ok( R.list.length === RESIDENTS.length && made.length === RESIDENTS.length, 'one avatar per resident' );
ok( R.list.every( ( r, i ) => r.avatar.character === RESIDENTS[ i ].character && r.avatar.lite === true ), 'lite avatars with the roster characters' );
ok( R.list.every( ( r ) => r.model === r.avatar.model ), 'models attached' );
{

	const doge = R.byId( 'dogePier' ), pepe = R.byId( 'pepeSweeper' ), kid = R.byId( 'kidHyp' );
	ok( near( doge.y, 2.3 ), `doge stands on the pier deck (y ${ doge.y })` );
	ok( near( pepe.y, 2 ), 'pepe stands on the terrain' );
	ok( near( kid.avatar.group.scale.x, 0.72 ), 'the kid is scaled down' );
	const b = R.byId( 'bravileChat' ), h = R.byId( 'heptyleChat' );
	ok( near( b.yaw, yawToward( b.x, b.z, h.x, h.z ) ) && near( h.yaw, yawToward( h.x, h.z, b.x, b.z ) ), 'the cousins face each other' );
	ok( near( wrap( b.yaw - h.yaw + Math.PI ), 0, 1e-6 ), 'their yaws are opposite' );
	ok( b.base === 'Chat_Gesture', 'chat loop as the base clip' );
	const d = doge.avatar.group;
	ok( near( d.position.x, 50 ) && near( d.position.y, 2.3 ) && near( d.position.z, 36.8 ), 'avatar group placed at the spot' );

}

// ---------------------------------------------------------------- culling
{

	const pepe = R.byId( 'pepeSweeper' ), m = pepe.model;
	R.update( 0.05, player( 500, 500 ) );
	ok( m.updates === 0 && m.holds === 0, 'beyond 120 m: nothing updated' );
	R.update( 0.05, player( pepe.x + 80, pepe.z ) );
	ok( m.updates === 0 && m.holds === 1, '60-120 m: the pose holds' );
	R.update( 0.05, player( pepe.x + 30, pepe.z ) );
	ok( m.updates === 1, 'within 60 m: animating' );
	R.update( 0.05, null );
	ok( m.updates === 1, 'no player: nothing updated' );

}

// ---------------------------------------------------------------- patrol
{

	const pepe = R.byId( 'pepeSweeper' ), m = pepe.model, P = pepe.patrol;
	const p = player( P[ 0 ].x + 20, P[ 0 ].z + 20 ); // close enough to animate, too far to look at
	ok( pepe.state === 'pause' && near( pepe.x, P[ 0 ].x ) && near( pepe.z, P[ 0 ].z ), 'starts at node 0' );
	run( R, p, 0.6 );
	ok( pepe.state === 'walk', 'leaves after the first pause' );
	const x0 = pepe.x, z0 = pepe.z;
	run( R, p, 1.0 );
	const moved = Math.hypot( pepe.x - x0, pepe.z - z0 );
	ok( near( moved, PATROL_SPEED, 0.03 ), `walks at ${ moved.toFixed( 2 ) } m/s` );
	const w = m.calls.find( ( c ) => c.name === 'Walk_InPlace' );
	// (Residents.walkClipSpeed clamps the rate to 0.6..2.4 so a slow patrol never crawls)
	ok( w && w.loop && near( w.speed, Math.max( 0.6, Math.min( 2.4, PATROL_SPEED / CLIP_SPEED.walk ) ), 0.01 ), 'walk clip loops at the patrol rate (clamped)' );
	const d1 = Math.hypot( P[ 1 ].x - P[ 0 ].x, P[ 1 ].z - P[ 0 ].z );
	const dir = yawToward( P[ 0 ].x, P[ 0 ].z, P[ 1 ].x, P[ 1 ].z );
	run( R, p, 1.0 );
	ok( near( wrap( pepe.yaw - dir ), 0, 0.02 ), 'faces the way it walks' );
	// step until a condition holds; the time it took
	const until = ( cond, max ) => { let t = 0; while ( ! cond() && t < max ) { R.update( 0.05, p ); t += 0.05; } return t; };
	const t1 = until( () => pepe.state === 'pause', 30 );
	ok( pepe.node === 1 && near( pepe.x, P[ 1 ].x ) && near( pepe.z, P[ 1 ].z ), 'reaches node 1 and pauses' );
	ok( near( t1 + 2.0, d1 / PATROL_SPEED, 0.15 ), `node 1 after ${ ( t1 + 2 ).toFixed( 2 ) } s (${ ( d1 / PATROL_SPEED ).toFixed( 2 ) } expected)` );
	ok( pepe.gesture !== null && m.current === pepe.gesture && pepe.gestures.includes( m.current ), `a gesture at the node (${ m.current })` );
	const tp = until( () => pepe.state === 'walk', 10 );
	ok( tp >= 2.4 && tp <= 4.6, `walks on after a ${ tp.toFixed( 1 ) } s pause` );
	const d2 = Math.hypot( P[ 2 ].x - P[ 1 ].x, P[ 2 ].z - P[ 1 ].z );
	const t2 = until( () => pepe.state === 'pause', 30 );
	ok( pepe.node === 2 && near( t2, d2 / PATROL_SPEED, 0.15 ), `node 2 after ${ t2.toFixed( 2 ) } s` );
	// around the loop and back to node 0
	for ( let i = 3; i <= P.length; i ++ ) { until( () => pepe.state === 'walk', 10 ); until( () => pepe.state === 'pause', 40 ); }
	ok( pepe.node === 0 && near( pepe.x, P[ 0 ].x ) && near( pepe.z, P[ 0 ].z ), 'the patrol loops back to node 0' );
	ok( m.calls.filter( ( c ) => c.name === 'Walk_InPlace' ).length === P.length, `one walk clip per leg (${ m.calls.filter( ( c ) => c.name === 'Walk_InPlace' ).length })` );

}

// ---------------------------------------------------------------- look-at
{

	const kid = R.byId( 'kidHyp2' ); // spot yaw PI: faces +Z
	const home = kid.homeYaw;
	// 30° to the right of where it faces, 4 m away: turn there
	const a = home - Math.PI / 6;
	let p = player( kid.x - Math.sin( a ) * 4, kid.z - Math.cos( a ) * 4 );
	run( R, p, 4 );
	ok( near( wrap( kid.yaw - a ), 0, 0.02 ), `turns toward the player (${ ( wrap( kid.yaw - home ) * 180 / Math.PI ).toFixed( 1 ) }°)` );
	// 150° around: clamped to 60°
	const b = home + Math.PI * 150 / 180;
	p = player( kid.x - Math.sin( b ) * 4, kid.z - Math.cos( b ) * 4 );
	run( R, p, 4 );
	ok( near( wrap( kid.yaw - home ), LOOK_CLAMP, 0.02 ), `look-at clamped at ${ ( wrap( kid.yaw - home ) * 180 / Math.PI ).toFixed( 1 ) }°` );
	// 12 m away: back to the spot yaw
	p = player( kid.x - Math.sin( b ) * 12, kid.z - Math.cos( b ) * 12 );
	run( R, p, 4 );
	ok( near( wrap( kid.yaw - home ), 0, 0.02 ), 'faces the spot yaw again when the player leaves' );
	ok( near( kid.x, 24 ) && near( kid.z, - 143 ), 'a spot resident does not move' );

}

// ---------------------------------------------------------------- nearest and talk
{

	const old = R.byId( 'oldPepe' ), m = old.model;
	ok( R.nearest( new Vector3( old.x + 5, 2, old.z ) ) === null, 'nearest: nobody within 2.8 m' );
	ok( R.nearest( new Vector3( old.x + 2, 2, old.z ) ) === old, 'nearest: Old Pepe' );
	ok( R.nearest( new Vector3( old.x + 2, 9, old.z ) ) === null, 'nearest: not from 7 m above' );
	ok( R.nearest( new Vector3( old.x + 4, 2, old.z ), 5 ) === old, 'nearest: wider radius' );
	const doge = R.byId( 'dogePier' );
	ok( R.nearest( new Vector3( doge.x + 1, 2.3, doge.z ) ) === doge, 'nearest: doge on the deck' );
	const p = player( old.x + 2, old.z );
	run( R, p, 1 );
	const r1 = R.interact( old, p, null );
	ok( r1 && typeof r1.line === 'string' && r1.line === old.lines[ 0 ] && ! r1.prank, 'first E: the first line' );
	ok( old.state === 'talk', 'talk state' );
	R.update( 0.05, p );
	ok( m.current === 'Chat_Gesture', 'the talk loop plays' );
	run( R, p, TALK_S - 0.5 );
	ok( old.state === 'talk' && m.current === 'Chat_Gesture', 'still talking before 4 s' );
	run( R, p, 1 );
	ok( old.state === 'idle' && m.current === 'Idle_Breathe', 'back to idle after 4 s' );
	const r2 = R.interact( old, p, null );
	ok( r2.line === old.lines[ 1 ], 'second E: the next line' );
	for ( let i = 0; i < old.lines.length; i ++ ) R.interact( old, p, null );
	ok( R.interact( old, p, null ).line === old.lines[ ( old.lines.length + 2 ) % old.lines.length ], 'lines cycle' );
	run( R, p, 5 );
	// idle gestures: every 6-14 s one plays, then the base loop again
	m.calls.length = 0;
	run( R, p, 30 );
	const g = m.calls.filter( ( c ) => c.name !== 'Idle_Breathe' );
	ok( g.length >= 2 && g.length <= 5, `${ g.length } idle gestures in 30 s` );
	ok( g.every( ( c ) => old.gestures.includes( c.name ) || Object.values( GESTURE_FALLBACK ).includes( c.name ) ), 'gestures from the pool' );
	ok( m.current === 'Idle_Breathe' || old.gesture === m.current, 'base loop between gestures' );
	// a patrolling resident stops to talk, then walks on
	const pengu = R.byId( 'penguBeach' );
	const pp = player( pengu.x + 1, pengu.z + 1 );
	run( R, pp, 2 );
	const walking = pengu.state === 'walk';
	R.interact( pengu, pp, null );
	ok( pengu.state === 'talk', `a walker stops to talk (was ${ walking ? 'walking' : pengu.state })` );
	const sx = pengu.x, sz = pengu.z;
	run( R, pp, TALK_S - 0.1 );
	ok( near( pengu.x, sx ) && near( pengu.z, sz ), 'stands still while talking' );
	run( R, pp, 6 );
	ok( pengu.state === 'walk' || pengu.state === 'pause', 'resumes the patrol' );

}

// ---------------------------------------------------------------- the prank
{

	const clown = R.byId( 'clownCabin' ), m = clown.model;
	const p = player( clown.x + 1.5, clown.z );
	run( R, p, 1 );
	const a = R.interact( clown, p, null );
	ok( a.prank === true && a.line === 'Hey, come closer, I have something for you.', 'first E: beckon' );
	R.update( 0.05, p );
	ok( m.current === 'Beckon', 'the beckon plays' );
	run( R, p, 3 );
	const b = R.interact( clown, p, null );
	ok( b.prank === 'launch' && b.line === 'HAH!', 'second E within 10 s: the shove' );
	ok( b.dir && near( Math.hypot( b.dir.x, b.dir.z ), 1 ) && b.dir.z > 0.9, 'launch direction: unit, toward the sea (+z)' );
	R.update( 0.05, p );
	ok( m.current === 'Prank_Laugh', 'he laughs' );
	ok( clown.pranks === 1, 'counted' );
	run( R, p, 2 );
	const c = R.interact( clown, p, null );
	ok( c.prank === true, 'after a shove the next E arms again' );
	run( R, p, PRANK_WINDOW + 0.5 );
	const d = R.interact( clown, p, null );
	ok( d.prank === true && d.prank !== 'launch', 'E after the window: arms, no shove' );
	run( R, p, 1 );
	ok( R.interact( clown, p, null ).prank === 'launch', 'and the next one shoves' );
	ok( clown.pranks === 2, 'two pranks' );

}

// ---------------------------------------------------------------- missing clips
{

	const made0 = made.length;
	const R2 = new Residents( { scene, terrain, colliders: null, avatarFactory: fakeFactory( false ) } );
	await R2.ready;
	ok( made.length === made0 + RESIDENTS.length, 'second set built' );
	const b = R2.byId( 'bravileChat' ), clown = R2.byId( 'clownCabin' ), pepe = R2.byId( 'pepeSweeper' );
	ok( b.base === 'Talk', 'Chat_Gesture falls back to Talk' );
	ok( near( pepe.y, 2 ), 'no colliders: terrain height' );
	const p = player( clown.x + 1.5, clown.z );
	run( R2, p, 1 );
	R2.interact( clown, p, null );
	R2.update( 0.05, p );
	ok( clown.model.current === 'Wave', 'Beckon falls back to Wave' );
	run( R2, p, 2 );
	R2.interact( clown, p, null );
	R2.update( 0.05, p );
	ok( clown.model.current === 'Cheer_Clap', 'Prank_Laugh falls back to Cheer_Clap' );
	const pp = player( pepe.x + 20, pepe.z );
	run( R2, pp, 40 );
	ok( pepe.model.calls.every( ( c ) => c.name === 'Walk_InPlace' || c.name === 'Idle_Breathe' || c.name === 'Talk' || c.name === 'Wave' ), 'the sweeper plays only what the GLB has' );
	let threw = false;
	try { run( R2, pp, 60 ); } catch ( e ) { threw = true; console.log( e ); }
	ok( ! threw, 'a minute of life with the old clip set' );
	R2.dispose();
	ok( made.slice( made0 ).every( ( a ) => a.disposed ) && R2.list.length === 0, 'dispose' );

}

R.dispose();
ok( made.slice( 0, RESIDENTS.length ).every( ( a ) => a.disposed ), 'dispose releases every avatar' );

console.log( fails ? `\n${ fails } FAILED` : '\nall green' );
process.exit( fails ? 1 : 0 );

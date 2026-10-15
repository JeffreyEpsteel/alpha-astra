// The wave 18E animation library: every new clip name (Characters.js CLIPS) is in all eight roster GLBs with a length; every
// AnimDef state, blend space and montage resolves on each of them (a GLB clip or a derived pose clip); the new ctx flags pick
// the crouch / carry / tired / turn states and nothing else changes without them; the emote row's montages exist; the
// in-place walk takes' measured stride speeds match CLIP_SPEED (the residents' playback scaling). Pure CPU.
//   node test/feature-anim-library.mjs
import './headless.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGLB } from '../src/engine/loaders/GLTF.js';
import { CLIPS, CLIP_SPEED, CHARACTER_IDS } from '../src/game/Characters.js';
import DEF from '../src/player/anim/AnimDef.js';
import { AnimGraph } from '../src/player/anim/AnimGraph.js';
import { makeRig, strideSpeed } from '../src/player/anim/ClipTools.js';
import { bindLike } from '../src/player/ik/ProcPose.js';
import { EMOTES } from '../src/features/emotes/Emotes.js';

const ROOT = fileURLToPath( new URL( '..', import.meta.url ) );
const ROSTER = join( ROOT, 'public', 'models', 'roster' );
let failures = 0;
const ok = ( c, msg ) => { if ( ! c ) { failures ++; console.error( 'FAIL ' + msg ); } else console.log( 'ok   ' + msg ); };

const NEW = [ 'sitChair', 'sitChairIdle', 'standFromChair', 'leanWall', 'drink', 'eat', 'carryBox', 'kneelWork', 'crouch', 'talkGroup', 'clap', 'pointOut',
	'hammer', 'fishNet', 'drunkWalk', 'lampLight', 'crouchWalk', 'walkTired', 'turnLeft', 'turnRight', 'dance2', 'sitGround' ];
// the names worker 18B's residents ask for (through a fallback): they must be exactly these
const TOWN = [ 'Sit_Chair', 'Sit_Chair_Idle', 'Stand_From_Chair', 'Lean_Wall', 'Drink', 'Eat', 'Carry_Box', 'Kneel_Work', 'Crouch', 'Talk_Group', 'Clap',
	'Point_Out', 'Hammer', 'Fish_Net', 'Drunk_Walk', 'Lamp_Light' ];
ok( NEW.every( ( k ) => CLIPS[ k ] ), 'Characters.js CLIPS names every wave 18E clip' );
ok( TOWN.every( ( n ) => Object.values( CLIPS ).includes( n ) ), 'the town-life names are exactly the ones 18B uses' );

const ids = readdirSync( ROSTER ).filter( ( f ) => f.endsWith( '.glb' ) ).map( ( f ) => basename( f, '.glb' ) ).sort();
ok( CHARACTER_IDS.every( ( id ) => ids.includes( id ) ), 'a GLB for every character' );
let hyptile = null;
for ( const id of ids ) {

	const b = readFileSync( join( ROSTER, id + '.glb' ) );
	const gltf = parseGLB( b.buffer.slice( b.byteOffset, b.byteOffset + b.byteLength ) );
	const model = { gltf, clips: new Map( gltf.animations.map( ( a ) => [ a.name, a ] ) ), setOverlay() { return { speed: 0 }; } };
	const rest = { rest: gltf.nodes.map( ( n ) => ( { t: n.t, r: n.r, s: n.s } ) ) };
	const names = NEW.map( ( k ) => CLIPS[ k ] );
	const missing = names.filter( ( n ) => ! model.clips.has( n ) );
	ok( missing.length === 0, `${ id }: all ${ names.length } library clips in the GLB${ missing.length ? ' (missing ' + missing.join( ', ' ) + ')' : '' }` );
	const bind = names.filter( ( n ) => model.clips.has( n ) && bindLike( model.clips.get( n ), rest ) );
	ok( bind.length === 0, `${ id }: none of them is the bind pose${ bind.length ? ' (' + bind.join( ', ' ) + ')' : '' }` );
	ok( names.every( ( n ) => ! model.clips.has( n ) || model.clips.get( n ).duration > 0.5 ), `${ id }: every one has a length` );
	// the graph's derived clips (AnimDef.clips) built on this GLB, then every state / space / montage clip resolves
	const g = new AnimGraph( model, { def: DEF } );
	g.dispose();
	const want = new Set();
	for ( const s of Object.values( DEF.states ) ) if ( s.clip ) want.add( s.clip );
	for ( const sp of Object.values( DEF.spaces ) ) {

		if ( sp.idle ) want.add( sp.idle );
		for ( const c of sp.columns || [ { samples: sp.samples } ] ) for ( const [ clip ] of c.samples ) want.add( clip );

	}

	for ( const m of Object.values( DEF.montages ) ) want.add( m.clip );
	const unresolved = [ ...want ].filter( ( c ) => ! model.clips.has( c ) );
	ok( unresolved.length === 0, `${ id }: every AnimDef state, space and montage clip resolves (${ want.size })${ unresolved.length ? ' missing ' + unresolved.join( ', ' ) : '' }` );
	if ( id === 'hyptile' ) hyptile = { model, rig: makeRig( gltf ), rest };

}

// ---- the rules: the new flags pick the new states; without them the old answers stand
const pick = ( ctx, cur = { name: 'locomotion', time: 1, done: false } ) => {

	const c = { mode: 'walk', speed: 0, forward: 0, strafe: 0, turn: 0, grounded: true, vy: 0, airTime: 0, lastAir: 0, rod: false, seat: null, loopClip: null, diving: false, ...ctx };
	for ( const [ name, rule ] of DEF.rules ) if ( rule( c, cur ) ) return name;
	return null;

};
ok( pick( {} ) === 'locomotion' && pick( { speed: 1.2 } ) === 'locomotion', 'no flags: locomotion as before' );
ok( pick( { crouch: true } ) === 'crouch' && pick( { crouch: true, speed: 1 } ) === 'crouch', 'crouch: the crouch space, standing or moving' );
ok( pick( { crouch: true, mode: 'swim' } ) === 'swim', 'crouching in the water: still swimming' );
ok( pick( { carry: true, speed: 1 } ) === 'carry' && pick( { carry: true } ) === 'carry', 'carry: the carry space (crate held standing, the carry walk moving)' );
ok( pick( { tired: true, speed: 1.2 } ) === 'tired' && pick( { tired: true } ) === 'locomotion' && pick( { tired: true, speed: 2.7 } ) === 'locomotion' && pick( { tired: true, speed: 1.0 } ) === 'tired', 'tired: the worn-out walk at walking speeds only' );
ok( pick( { turn: 1.6 } ) === 'turnL' && pick( { turn: - 1.6 } ) === 'turnR' && pick( { turn: 0.6 } ) === 'locomotion', 'standing and turning fast: the turn on the spot (slow turns stay idle)' );
ok( pick( { turn: 0.6 }, { name: 'turnL', time: 1, done: false } ) === 'turnL' && pick( { turn: 0.1 }, { name: 'turnL', time: 1, done: false } ) === 'locomotion', 'a started turn holds down to 0.4 rad/s, then ends' );
ok( pick( { turn: 1.6, speed: 1 } ) === 'locomotion' && pick( { turn: 1.6, rod: true } ) === 'fishing', 'walking or with the rod out: no turn clip' );

// ---- the emote row
ok( EMOTES.every( ( e ) => DEF.montages[ e.montage ] ), 'every emote has its AnimDef montage (' + EMOTES.map( ( e ) => e.montage ).join( ' ' ) + ')' );

// ---- stride speeds of the in-place walks (the foot's ground speed over one cycle) against CLIP_SPEED
if ( hyptile ) {

	for ( const [ k, n ] of [ [ 'walkTired', 'Walk_Tired' ], [ 'drunkWalk', 'Drunk_Walk' ], [ 'carry', 'Carry_Box' ], [ 'crouchWalk', 'Crouch_Walk' ] ] ) {

		const v = strideSpeed( hyptile.rig, hyptile.model.clips.get( n ) );
		ok( v > 0.3 && Math.abs( v - CLIP_SPEED[ k ] ) / CLIP_SPEED[ k ] < 0.25, `${ n } walks at ${ v.toFixed( 2 ) } m/s (CLIP_SPEED.${ k } ${ CLIP_SPEED[ k ] })` );

	}

}

console.log( failures ? failures + ' failure(s)' : 'all animation library checks passed' );
process.exit( failures ? 1 : 0 );

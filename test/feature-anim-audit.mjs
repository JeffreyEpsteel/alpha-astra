// No A-pose anywhere (wave 17B): every clip the game can pose a roster character with resolves to a clip of the roster GLB
// (Characters.js CLIPS, AnimDef's derived clips, the pose clips the features build), and none of them shows the bind (A) pose
// on hyptile.glb: no sampled frame of the range that plays with both arms within BIND_DEG of their rest rotation, and no clip
// whose every key stays within BIND_DEG of rest. Clips root is replacing (the Kimodo batch) are listed by name as KNOWN so the
// test passes while they are in flight and stays a guard after; a KNOWN clip that is now fine is reported so the list shrinks.
// Pure CPU (no GPU): the GLB is parsed, the graph builds its derived clips into a plain clip table.
//   node test/feature-anim-audit.mjs [roster id]     (default hyptile; the presence check also runs on every roster GLB)
import './headless.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGLB } from '../src/engine/loaders/GLTF.js';
import { CLIPS } from '../src/game/Characters.js';
import DEF from '../src/player/anim/AnimDef.js';
import { AnimGraph } from '../src/player/anim/AnimGraph.js';
import { makeRig, localsAt } from '../src/player/anim/ClipTools.js';
import { ONE_SHOT, LOOPS, ROD } from '../src/player/Avatar.js';
import { gunPoses, GUN_CLIPS, GUN_RECIPES } from '../src/features/firearms/GunPose.js';
import { gunnerClips, GUNNER_CLIPS, CrewDeck } from '../src/features/crew/Deck.js';
import { Firearms } from '../src/features/firearms/Firearms.js';
import { Coxswain } from '../src/features/rescue/Coxswain.js';
import { EMOTES } from '../src/features/emotes/Emotes.js';
import { proceduralWave, WAVE_CLIP } from '../src/features/emotes/Procedural.js';

const ROOT = fileURLToPath( new URL( '..', import.meta.url ) );
const ROSTER = join( ROOT, 'public', 'models', 'roster' );
const ID = process.argv[ 2 ] || 'hyptile';
const BIND_DEG = 10;
const ARMS = [ 'upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r' ];
// the Kimodo batch root was replacing (docs/briefs/w17-anim-audit.md): emptied once the audit reported them all fine
const KNOWN = new Set( [] ); // wave 18E: every clip of that batch (and the Sit_Down / Stand_Up replaced by Rocketbox takes) now passes
// found by this audit, not in that batch: the rowing / paddling loops start and end on the bind pose (an A flash every stroke).
// The AnimDef patch in the wave 17B report swaps them for pose clips (Row_Stroke ...); listed until it lands
const KNOWN_17B = new Set( [ 'Row_Forward', 'Row_Backward', 'Paddle_Left', 'Paddle_Right' ] );
// names a module only plays when a roster build has them (crew/Deck.js RAM_CLIPS)
const OPTIONAL = new Set( [ 'Cannon_Ram', 'Ram_Loop' ] );
// the source files that pick clips by name (quoted 'Xxx_Yyy' strings and the roster's one-word clip names)
const SOURCES = [ 'src/features/melee/Raider.js', 'src/game/CaptainRoid.js', 'src/game/Vendor.js', 'src/game/PonsPort.js', 'src/features/harbour/index.js',
	'src/features/harbour/Roles.js', 'src/world/residents/ResidentData.js', 'src/world/Residents.js', 'src/world/islands/town/Folk.js',
	'src/features/crew/Deck.js', 'src/features/rescue/Coxswain.js', 'src/features/boarding/Boarding.js', 'src/player/ik/ProcPose.js',
	...readdirSync( join( ROOT, 'src/game/ports' ) ).map( ( f ) => 'src/game/ports/' + f ) ];

let failures = 0;
const ok = ( c, msg ) => { if ( ! c ) { failures ++; console.error( 'FAIL ' + msg ); } else console.log( 'ok   ' + msg ); };
const note = ( msg ) => console.log( 'note ' + msg );

function load( id ) {

	const b = readFileSync( join( ROSTER, id + '.glb' ) );
	const gltf = parseGLB( b.buffer.slice( b.byteOffset, b.byteOffset + b.byteLength ) );
	// a plain stand-in for SkinnedModel: what AnimGraph's clip building, GunPose and the crew deck read
	const model = { gltf, clips: new Map( gltf.animations.map( ( a ) => [ a.name, a ] ) ), setOverlay() { return { speed: 0 }; } };
	const glbClips = new Set( model.clips.keys() );
	const graph = new AnimGraph( model, { def: DEF } );
	graph.dispose();
	gunPoses( { model } );
	gunnerClips( model );
	proceduralWave( { model } );
	return { gltf, model, glbClips };

}

// ---- what the game plays: [ clip, from, to, where ]
function played( model ) {

	const P = [];
	const add = ( clip, where, from = 0, to = null ) => { if ( clip ) P.push( { clip, from, to, where } ); };
	for ( const [ n, s ] of Object.entries( DEF.states ) ) if ( s.clip ) add( s.clip, 'state ' + n, s.from || 0, s.to ?? null );
	for ( const [ n, sp ] of Object.entries( DEF.spaces ) ) {

		if ( sp.idle ) add( sp.idle, 'space ' + n );
		for ( const c of sp.columns || [ { samples: sp.samples } ] ) for ( const [ clip ] of c.samples ) add( clip, 'space ' + n );

	}

	for ( const [ n, m ] of Object.entries( DEF.montages ) ) add( m.clip, 'montage ' + n, m.from || 0, m.to ?? null );
	// the pose actions (Avatar): one-shots play the montage of that name (or the clip), loops the clip, rod actions the overlay
	for ( const [ a, k ] of Object.entries( ONE_SHOT ) ) add( DEF.montages[ a ] ? DEF.montages[ a ].clip : CLIPS[ k ], 'one-shot ' + a, DEF.montages[ a ] ? DEF.montages[ a ].from || 0 : 0, DEF.montages[ a ] ? DEF.montages[ a ].to ?? null : null );
	for ( const [ a, k ] of Object.entries( LOOPS ) ) add( CLIPS[ k ], 'loop ' + a );
	for ( const [ a, k ] of Object.entries( ROD ) ) add( CLIPS[ k ], 'rod ' + a );
	for ( const e of EMOTES ) for ( const n of [ e.montage, ...e.fallbacks ] ) add( DEF.montages[ n ] ? DEF.montages[ n ].clip : n, 'emote ' + e.id, DEF.montages[ n ] ? DEF.montages[ n ].from || 0 : 0, DEF.montages[ n ] ? DEF.montages[ n ].to ?? null : null );
	add( WAVE_CLIP, 'emote procedural wave' );
	for ( const n of Object.keys( GUN_RECIPES ) ) add( n, 'firearms' );
	for ( const n of Object.values( GUNNER_CLIPS ) ) add( n, 'crew gunner' );
	// the features' clip names, read from their source
	const names = new Set( [ ...model.clips.keys() ] );
	for ( const f of SOURCES ) {

		const src = readFileSync( join( ROOT, f ), 'utf8' );
		for ( const m of src.matchAll( /'([A-Z][A-Za-z]*(?:_[A-Za-z0-9]+)+|[A-Z][a-z]+)'/g ) ) {

			const n = m[ 1 ];
			if ( n.includes( '_' ) || names.has( n ) ) add( n, basename( f ) );

		}

	}

	return P;

}

// ---- the bind test: max arm deviation from rest at a time, and the whole clip's max deviation
const ang = ( a, b ) => 2 * Math.acos( Math.min( 1, Math.abs( a[ 0 ] * b[ 0 ] + a[ 1 ] * b[ 1 ] + a[ 2 ] * b[ 2 ] + a[ 3 ] * b[ 3 ] ) ) ) * 180 / Math.PI;
function armDev( rig, clip, t ) {

	const loc = localsAt( rig, clip, t );
	let mx = 0;
	for ( const b of ARMS ) { const i = rig.index[ b ]; if ( i !== undefined ) mx = Math.max( mx, ang( loc[ i ].r, rig.rest[ i ].r ) ); }
	return mx;

}

function clipDev( rig, clip ) {

	let mx = 0;
	for ( const c of clip.channels ) {

		if ( c.path !== 'rotation' || ! rig.rest[ c.node ] ) continue;
		const r = rig.rest[ c.node ].r, v = c.values;
		for ( let i = 0; i + 3 < v.length; i += 4 ) mx = Math.max( mx, ang( r, [ v[ i ], v[ i + 1 ], v[ i + 2 ], v[ i + 3 ] ] ) );

	}

	return mx;

}

// ============================================================================ 1. presence on every roster GLB
console.log( '-- 1. every clip the game plays resolves on the roster GLBs' );
const ids = readdirSync( ROSTER ).filter( ( f ) => f.endsWith( '.glb' ) ).map( ( f ) => basename( f, '.glb' ) ).sort();
for ( const id of ids ) {

	const { model } = load( id );
	const P = played( model );
	const missing = [ ...new Set( P.filter( ( p ) => ! model.clips.has( p.clip ) && ! OPTIONAL.has( p.clip ) ).map( ( p ) => p.clip ) ) ];
	const pending = missing.filter( ( n ) => KNOWN.has( n ) );
	const bad = missing.filter( ( n ) => ! KNOWN.has( n ) );
	if ( pending.length ) note( `${ id }: pending in root's batch: ${ pending.join( ', ' ) }` );
	ok( bad.length === 0, `${ id }: ${ new Set( P.map( ( p ) => p.clip ) ).size } clips resolve (GLB + AnimDef + feature pose clips)` + ( bad.length ? ' MISSING ' + bad.map( ( n ) => `${ n } (${ P.find( ( p ) => p.clip === n ).where })` ).join( ', ' ) : '' ) );

}

// ============================================================================ 2. no bind (A) pose on the main character
console.log( `-- 2. no bind (A) pose in what plays, on ${ ID }.glb` );
{

	const { gltf, model } = load( ID );
	const rig = makeRig( gltf );
	const P = played( model ).filter( ( p ) => model.clips.has( p.clip ) );
	const seen = new Map(); // clip -> { worst, at, where }
	for ( const p of P ) {

		const clip = model.clips.get( p.clip );
		const a = Math.max( 0, p.from ), b = Math.min( clip.duration, p.to ?? clip.duration );
		let worst = Infinity, at = a;
		for ( let k = 0; k <= 24; k ++ ) {

			const t = a + ( b - a ) * k / 24, d = armDev( rig, clip, t );
			if ( d < worst ) { worst = d; at = t; }

		}

		const whole = clipDev( rig, clip );
		const prev = seen.get( p.clip );
		if ( ! prev || worst < prev.worst ) seen.set( p.clip, { worst, at, whole, where: p.where } );

	}

	const bad = [], known = [], fine = [];
	for ( const [ clip, s ] of seen ) {

		const isBind = s.worst < BIND_DEG || s.whole < BIND_DEG;
		if ( KNOWN.has( clip ) || KNOWN_17B.has( clip ) ) ( isBind ? known : fine ).push( clip + ( isBind ? ` (arms ${ s.worst.toFixed( 0 ) } deg at ${ s.at.toFixed( 2 ) } s)` : '' ) );
		else if ( isBind ) bad.push( `${ clip } (${ s.where }: arms ${ s.worst.toFixed( 1 ) } deg from rest at ${ s.at.toFixed( 2 ) } s, clip max ${ s.whole.toFixed( 0 ) })` );

	}

	if ( known.length ) note( 'bind-like, known (root replacing / 17B patch): ' + known.join( ', ' ) );
	if ( fine.length ) note( 'listed as known but no longer bind-like (drop from KNOWN): ' + fine.join( ', ' ) );
	ok( bad.length === 0, `${ seen.size } played clips: none bind-like outside the known list` + ( bad.length ? ': ' + bad.join( '; ' ) : '' ) );
	// the feature pose clips are real poses (well away from the rest pose)
	for ( const n of [ ...Object.keys( GUN_RECIPES ), ...Object.values( GUNNER_CLIPS ) ] ) {

		const s = seen.get( n );
		ok( s && s.worst > 25, `${ n }: arms ${ s ? s.worst.toFixed( 0 ) : '?' } deg off the rest pose at worst` );

	}

	// the gun in the aim: GunPose's hold puts the barrel along the model's forward (the socket inverse at the aim pose)
	const gp = gunPoses( { model } );
	ok( !! gp && gp.aim.pistol === GUN_CLIPS.aim.pistol && gp.hold.pistol.length === 4 && gp.hold.musket.length === 4, 'GunPose: aim clips and holds for both guns' );

}

// ============================================================================ 3. the features play them
console.log( '-- 3. firearms / crew / coxswain pick the pose clips' );
{

	const { model } = load( ID );
	const calls = [];
	const avatar = { model, graph: { upperBusy: false }, playMontage( name, o ) { const h = { name, playing: true, stop() { this.playing = false; calls.push( [ 'stop', name ] ); } }; calls.push( [ name, o.slot, !! o.loop ] ); return h; }, stopMontage() {} };
	const fa = new Firearms( { avatar, player: { mode: 'walk' } }, null, { mesh: false, hud: false, audio: { click() {}, report() {} } } );
	fa.sel = 'pistol'; fa.phase = 'ready';
	fa._aimPose();
	ok( calls.length === 1 && calls[ 0 ][ 0 ] === 'Gun_Aim_Pistol' && calls[ 0 ][ 1 ] === 'upper' && calls[ 0 ][ 2 ], 'firearms: the pistol drawn plays Gun_Aim_Pistol as an upper-body loop' );
	fa._aimPose();
	ok( calls.length === 1, 'and keeps it (no restart while it plays)' );
	fa.sel = 'musket';
	fa._aimPose();
	ok( calls.some( ( c ) => c[ 0 ] === 'stop' && c[ 1 ] === 'Gun_Aim_Pistol' ) && calls[ calls.length - 1 ][ 0 ] === 'Gun_Aim_Musket', 'the musket: the pistol aim out, Gun_Aim_Musket in' );
	fa.phase = 'holstered';
	fa._aimPose();
	ok( calls[ calls.length - 1 ][ 0 ] === 'stop' && ! fa._aimH, 'holstered: the aim montage stops' );
	const noModel = new Firearms( { avatar: { playMontage() { return { playing: true }; } }, player: { mode: 'walk' } }, null, { mesh: false, hud: false, audio: { click() {}, report() {} } } );
	noModel.sel = 'pistol'; noModel.phase = 'ready';
	noModel._aimPose();
	ok( ! noModel._aimH && noModel.playerAction === 'hold', 'no rig to build on: no aim montage, the rod-hold overlay (playerAction hold) as before' );
	// crew: a gunner crouches at the gun, rams while the side reloads
	const deck = new CrewDeck( { scene: null } );
	const f = { post: 'gunner', model };
	ok( deck._base( f, false ) === GUNNER_CLIPS.ready && deck._base( f, true ) === GUNNER_CLIPS.ram, `crew: a gunner plays ${ GUNNER_CLIPS.ready }, ${ GUNNER_CLIPS.ram } while reloading` );
	ok( deck._base( { post: 'angler', model }, false ) === CLIPS.hold, 'an angler keeps the rod hold' );
	// the coxswain at the wheel: the helm stance, the idle when turned to you
	const cox = new Coxswain( { scene: null, avatarFactory: () => ( { group: null, ready: null } ) } );
	const played2 = [];
	cox.model = { clips: new Set( [ 'Idle_Breathe', 'Talk', 'Wave', 'Helm_Idle' ] ), current: null, play( c ) { this.current = c; played2.push( c ); }, update() {}, hold() {} };
	cox.avatar = { group: { position: { set() {} }, rotation: { set() {} }, parent: null, visible: true } };
	const ship = { cls: { helm: { x: 0, z: - 2 }, deck: 1, length: 8 }, x: 0, z: 0, yaw: 0, pose: { y: 0 } };
	cox.update( 0.1, { ship, player: { x: 0, z: 200 } } );
	ok( cox.model.current === 'Helm_Idle', 'coxswain: Helm_Idle at the wheel' );
	cox.talk( 2 );
	cox.update( 0.1, { ship, player: { x: 0, z: 200 } } );
	ok( cox.model.current === 'Talk', 'and Talk while he speaks' );

}

console.log( failures ? `${ failures } failure(s)` : 'all ok' );
process.exit( failures ? 1 : 0 );

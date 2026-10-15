// Plain-node test of the emotes (src/features/emotes): the key claim, the row, the four emotes through the avatar's montage
// API (arms only while walking, the whole body standing), the clip fallbacks down to the procedural arm wave, the 2 s rate
// limit (sent and received), the world event, the remote players' avatars, residents answering a wave, and the real roster
// clips on the real Hyptile avatar. No browser.
// usage: node test/feature-emotes.mjs
import './headless.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GPU } from '../src/engine/gpu/GPU.js';
import * as E from '../src/engine/index.js';

const ROOT = fileURLToPath( new URL( '..', import.meta.url ) );
const GREY = new Uint8Array( 16 ).fill( 150 );
for ( let i = 3; i < 16; i += 4 ) GREY[ i ] = 255;
globalThis.__assetImage = async () => ( { data: GREY.slice(), width: 2, height: 2 } );
globalThis.__assetFile = async ( url ) => { const b = readFileSync( join( ROOT, 'public', url.replace( /^\//, '' ) ) ); return b.buffer.slice( b.byteOffset, b.byteOffset + b.byteLength ); };
await GPU.init( { headless: true } );

const { Features } = await import( '../src/features/Features.js' );
const emotes = await import( '../src/features/emotes/index.js' );
const { Emotes, EMOTES, RATE_LIMIT, KEY_CANDIDATES, PICK_KEYS, proceduralWave, WAVE_CLIP } = emotes;
const { Avatar } = await import( '../src/player/Avatar.js' );
const { makeRig, localsAt, fk } = await import( '../src/player/anim/ClipTools.js' );
const { parseGLB } = await import( '../src/engine/loaders/GLTF.js' );

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};

// ---- a stand-in world
const mkAvatar = ( known ) => {

	const a = {
		log: [],
		playMontage( name, opts = {} ) {

			a.log.push( { name, slot: opts.slot, loop: opts.loop } );
			if ( ! known.includes( name ) ) return { name, playing: false, stop() {} };
			const h = { name, slot: opts.slot, playing: true, stopped: 0, stop() { h.playing = false; h.stopped ++; } };
			a.last = h;
			return h;

		},
	};
	return a;

};
const ALL = [ 'wave', 'dance', 'point', 'cheer', 'friendlyWave', 'celebrate', 'beckon', 'laugh', 'bow', 'salute', 'flex', 'facepalm', 'thumbsUp', 'sitGround', 'dance2' ];

const mkWorld = ( { known = ALL, claimed = [] } = {} ) => {

	const hits = new Set();
	const sent = [];
	const app = {
		paused: false, menuOpen: false, freeCam: false,
		input: { enabled: true, hit: ( c ) => hits.has( c ) },
		player: { mode: 'walk', velocity: { x: 0, z: 0 }, position: { x: 0, y: 0, z: 0 } },
		avatar: mkAvatar( known ),
		game: { rod: { state: 'idle' }, fight: null },
		netsync: { sendWorldEvent: ( kind, data ) => { sent.push( [ kind, data ] ); return true; } },
		residents: { list: [] },
		remotePlayers: { peers: new Map() },
	};
	const features = new Features( app );
	for ( const k of claimed ) features.claimKey( k, 'other' );
	const events = [];
	features.on( 'emote', ( e ) => events.push( e ) );
	const em = features.add( 'emotes', emotes );
	const step = ( s, dt = 0.1 ) => { for ( let k = 0; k < Math.round( s / dt ); k ++ ) { em.update( dt ); hits.clear(); } };
	const press = ( code ) => { hits.add( code ); em.update( 0.016 ); hits.clear(); };
	return { app, features, em, hits, sent, events, step, press };

};

// ---- the key: a free one through claimKey (every letter is in use), not X
{

	const w = mkWorld();
	ok( w.em.key === KEY_CANDIDATES[ 0 ] && /^Digit/.test( w.em.key ), `the key is a free one claimed through features.claimKey (${ w.em.key })` );
	ok( ! w.features.claimKey( w.em.key, 'rival' ), 'and no other feature can take it' );
	const w2 = mkWorld( { claimed: [ KEY_CANDIDATES[ 0 ], KEY_CANDIDATES[ 1 ] ] } );
	ok( w2.em.key === KEY_CANDIDATES[ 2 ], 'a taken key: the next free candidate' );
	const w3 = mkWorld( { claimed: KEY_CANDIDATES } );
	ok( w3.em.key === null, 'none free: no key (the touch button still works through play())' );
	ok( ! KEY_CANDIDATES.includes( 'KeyX' ) && EMOTES.map( ( e ) => e.id ).join() === 'wave,dance,point,cheer,laugh,bow,salute,flex,facepalm,thumbsUp,sit,dance2', 'twelve emotes: wave, dance, point, cheer first, then laugh, bow, salute, flex, facepalm, thumbs up, sit, dance 2 (wave 18E)' );
	ok( w.em.pickKeys.length >= EMOTES.length && ! w.em.pickKeys.includes( w.em.key ) && w.em.pickKeys.slice( 0, 4 ).join() === 'Digit1,Digit2,Digit3,Digit4', `a pick key per emote, never the row's own key (${ w.em.pickKeys.slice( 0, EMOTES.length ).join( ' ' ) })` );

}

// ---- the row and the four emotes
{

	const w = mkWorld();
	w.press( w.em.key );
	ok( w.em.rowOpen, 'the key opens the row' );
	w.press( w.em.key );
	ok( ! w.em.rowOpen, 'the key again closes it' );
	w.press( w.em.key );
	w.step( 4.2 );
	ok( ! w.em.rowOpen, 'the row closes by itself after a few seconds' );
	w.press( w.em.key );
	w.press( 'Digit2' );
	ok( ! w.em.rowOpen && w.em.last && w.em.last.id === 'dance', 'key, then 2: the dance' );
	ok( w.em.last.slot === 'full' && w.app.avatar.last.slot === 'full', 'standing still: a full-body montage' );
	ok( w.sent.length === 1 && w.sent[ 0 ][ 0 ] === 'emote' && w.sent[ 0 ][ 1 ].id === 'dance', 'sent as the world event emote { id }' );
	ok( w.events.length === 1 && w.events[ 0 ].id === 'dance' && w.events[ 0 ].local, 'and as the feature event emote' );
	// the rate limit
	ok( ! w.em.play( 'cheer' ) && w.sent.length === 1, `a second emote inside ${ RATE_LIMIT } s is refused and not sent` );
	w.step( RATE_LIMIT + 0.1 );
	ok( w.em.play( 'cheer' ) && w.sent.length === 2, `after ${ RATE_LIMIT } s it plays` );
	ok( ! w.app.avatar.log.some( ( l ) => l.name === 'point' ), 'only the asked clips were tried' );
	w.step( RATE_LIMIT + 0.1 );
	ok( w.em.play( 'point' ) && w.em.last.clip === 'point', 'point plays its own montage' );
	w.step( RATE_LIMIT + 0.1 );
	ok( w.em.play( 'wave' ) && w.em.last.clip === 'wave', 'wave plays its own montage' );
	ok( ! w.em.play( 'moonwalk' ), 'an unknown emote is refused' );
	// wave 18E: the last emote through the row's last pick key, and the bow through its montage
	w.step( RATE_LIMIT + 0.1 );
	w.press( w.em.key ); w.press( w.em.pickKeys[ EMOTES.length - 1 ] );
	ok( w.em.last.id === 'dance2' && w.em.last.clip === 'dance2' && ! w.em.rowOpen, `the 12th key (${ w.em.pickKeys[ EMOTES.length - 1 ] }) plays dance 2 and closes the row` );
	w.step( RATE_LIMIT + 0.1 );
	ok( w.em.play( 'bow' ) && w.em.last.clip === 'bow', 'bow plays its own montage' );

}

// ---- upper body while walking or with the rod out; the full body ends when you walk off; the dance runs its seconds
{

	const w = mkWorld();
	w.app.player.velocity.x = 2;
	ok( w.em.play( 'wave' ) && w.em.last.slot === 'upper', 'walking: the arms only (the upper-body montage over the legs)' );
	w.step( 2.2 );
	w.app.player.velocity.x = 0;
	w.app.game.rod.state = 'floating';
	ok( w.em.play( 'cheer' ) && w.em.last.slot === 'upper', 'with the line out: the arms only (the rod pose stays under)' );
	w.app.game.rod.state = 'idle';
	w.step( 2.2 );
	ok( w.em.play( 'dance' ) && w.em.last.slot === 'full', 'then standing: the whole body' );
	const h = w.app.avatar.last;
	w.step( 1 );
	w.app.player.velocity.x = 3;
	w.step( 0.2 );
	ok( ! h.playing, 'a full-body emote ends when you walk away' );
	w.app.player.velocity.x = 0;
	w.step( 2.2 );
	w.em.play( 'dance' );
	const d = w.app.avatar.last;
	w.step( 4.5 );
	ok( d.playing, 'the dance is still going at 4.5 s' );
	w.step( 1 );
	ok( ! d.playing, 'and stops after its five seconds' );
	// wave 18E: sitting on the ground is whole-body only and lasts until you move
	w.step( RATE_LIMIT + 0.1 );
	w.app.player.velocity.x = 2;
	ok( ! w.em.play( 'sit' ), 'sit while walking: refused (no sitting with the legs walking)' );
	w.app.player.velocity.x = 0;
	ok( w.em.play( 'sit' ) && w.em.last.clip === 'sitGround' && w.em.last.slot === 'full', 'standing: sit plays the Sit_Ground montage on the whole body' );
	const sit = w.app.avatar.last;
	w.step( 8 );
	ok( sit.playing, 'still sitting after 8 s (held, not timed like the dance)' );
	w.app.player.velocity.x = 3;
	w.step( 0.2 );
	ok( ! sit.playing, 'and up again when you walk' );
	w.app.player.velocity.x = 0;

}

// ---- gates
{

	const w = mkWorld();
	w.app.player.mode = 'swim';
	ok( ! w.em.play( 'wave' ) && ! w.em.open(), 'swimming: no emote' );
	w.app.player.mode = 'boat';
	ok( ! w.em.play( 'wave' ), 'at the helm: no emote (the starboard guns are X there)' );
	w.app.player.mode = 'walk';
	w.app.game.fight = { state: 'fighting' };
	ok( ! w.em.play( 'wave' ), 'while fighting a fish: no emote' );
	w.app.game.fight = null;
	w.app.paused = true;
	ok( ! w.em.play( 'wave' ), 'paused: no emote' );
	w.app.paused = false;
	w.app.avatar.ragdolling = true;
	ok( ! w.em.play( 'wave' ), 'knocked down: no emote' );
	w.app.avatar.ragdolling = false;
	w.features.add( 'panel', { install: () => ( { isOpen: () => true } ) } );
	ok( ! w.em.play( 'wave' ), 'a panel open: no emote' );

}

// ---- clip fallbacks
{

	const w = mkWorld( { known: [ 'friendlyWave', 'celebrate', 'beckon' ] } );
	ok( w.em.play( 'wave' ) && w.em.last.clip === 'friendlyWave' && ! w.em.last.procedural, 'no Wave montage: Friendly_Wave' );
	w.step( 2.2 );
	ok( w.em.play( 'dance' ) && w.em.last.clip === 'celebrate', 'no Dance: the celebrate' );
	w.step( 2.2 );
	ok( w.em.play( 'point' ) && w.em.last.clip === 'beckon', 'no Point: the beckon' );
	const none = mkWorld( { known: [] } );
	ok( ! none.em.play( 'wave' ) && none.sent.length === 0, 'a rig with no usable clip and no bones to build one: nothing played, nothing sent' );
	const noav = mkWorld();
	noav.app.avatar = null;
	ok( ! noav.em.play( 'wave' ), 'no avatar yet: quietly refused' );

}

// ---- the world event from other players
{

	const w = mkWorld();
	const peerA = { avatar: mkAvatar( ALL ), pose: { speed: 0 } };
	const peerB = { avatar: mkAvatar( ALL ), pose: { speed: 2 } };
	w.app.remotePlayers.peers.set( 'a', peerA );
	w.app.remotePlayers.peers.set( 'b', peerB );
	w.features.emit( 'remoteWorldEvent', { kind: 'emote', data: { id: 'cheer' }, from: 'a', at: 1, replay: false } );
	ok( peerA.avatar.last && peerA.avatar.last.name === 'cheer' && peerA.avatar.last.slot === 'full', 'a remote emote plays on that player\'s avatar (full body standing)' );
	w.features.emit( 'remoteWorldEvent', { kind: 'emote', data: { id: 'wave' }, from: 'b', at: 1, replay: false } );
	ok( peerB.avatar.last && peerB.avatar.last.slot === 'upper', 'a moving player waves with the arms only' );
	const n = peerA.avatar.log.length;
	w.features.emit( 'remoteWorldEvent', { kind: 'emote', data: { id: 'wave' }, from: 'a', at: 2, replay: false } );
	ok( peerA.avatar.log.length === n, 'a flooding sender is limited too (one per 2 s each)' );
	w.step( 2.2 );
	w.features.emit( 'remoteWorldEvent', { kind: 'emote', data: { id: 'wave' }, from: 'a', at: 3, replay: false } );
	ok( peerA.avatar.log.length > n, 'and plays again after the limit' );
	const m = peerB.avatar.log.length;
	w.step( 2.2 );
	for ( const e of [ { kind: 'emote', data: { id: 'wave' }, from: 'b', replay: true }, { kind: 'emote', data: { id: 'nope' }, from: 'b' }, { kind: 'emote', data: { id: 'wave' }, from: 'server' }, { kind: 'emote', data: { id: 'wave' }, from: 'ghost' }, { kind: 'emote', from: 'b' }, { kind: 'cannonFired', data: { id: 'wave' }, from: 'b' } ] ) w.features.emit( 'remoteWorldEvent', e );
	ok( peerB.avatar.log.length === m, 'replays, unknown ids, the server, unknown peers and other kinds are ignored' );
	w.features.emit( 'remoteWorldEvent', { kind: 'emote', data: { id: 'dance' }, from: 'b', at: 4, replay: false } );
	const dh = peerB.avatar.last;
	w.step( 5.2 );
	ok( dh.name === 'dance' && ! dh.playing, 'a remote dance stops by itself too' );
	ok( w.em.stats().received === 4, 'received count' );

}

// ---- residents answer a wave
{

	const w = mkWorld();
	const gestures = [];
	const mkRes = ( x, state = 'idle' ) => ( { x, z: 0, state, gesture: null, _gesture: ( c ) => gestures.push( [ x, c ] ) } );
	w.app.residents.list = [ mkRes( 4 ), mkRes( 6 ), mkRes( 8 ), mkRes( 40 ), mkRes( 3, 'talk' ) ];
	w.em.play( 'dance' );
	w.step( 3 );
	ok( gestures.length === 0, 'a dance does not get a wave back' );
	w.step( 3 );
	w.em.play( 'wave' );
	w.step( 0.5 );
	ok( gestures.length === 0, 'they answer a beat later, not at once' );
	w.step( 1.5 );
	ok( gestures.length === 2 && gestures[ 0 ][ 0 ] === 4 && gestures[ 1 ][ 0 ] === 6 && gestures.every( ( g ) => g[ 1 ] === 'Wave' ), 'the two nearest idle residents within 10 m wave back (not the far one, not the one talking)' );
	// a resident with the public hook uses it
	const w2 = mkWorld();
	const got = [];
	w2.app.residents.list = [ { x: 2, z: 0, state: 'pause', gesture: null, respond: ( c ) => got.push( c ), _gesture: () => got.push( 'private' ) } ];
	w2.em.play( 'wave' ); w2.step( 2 );
	ok( got.join() === 'Wave', 'Resident.respond( clip ) is used when the residents have it' );

}

// ---- the real roster avatar
{

	const scene = new E.Scene();
	const av = new Avatar( { scene, character: 'hyptile' } );
	await av.ready;
	const m = av.model;
	for ( const c of [ 'Wave', 'Dance', 'Point', 'Cheer_Clap', 'Laugh', 'Dance_2', 'Sit_Ground' ] ) ok( m.clips.has( c ), `the roster GLB has ${ c }` );
	const world = mkWorld();
	world.app.avatar = av;
	const pose = { position: new E.Vector3( 0, 0, 0 ), yaw: 0, mode: 'walk', speed: 0, vy: 0, grounded: true, diving: false, frame: null, action: null };
	const tick = ( s ) => { for ( let t = 0; t < s - 1e-9; t += 1 / 30 ) { av.update( 1 / 30, pose ); world.em.update( 1 / 30 ); } };
	tick( 0.5 );
	const playing = ( slot ) => { const q = av.graph._montages.find( ( x ) => x.slot === slot && x.target === 1 && ! x.ended ); return q ? q.clip.name : null; };
	const clipOf = { wave: 'Wave', dance: 'Dance', point: 'Point', cheer: 'Cheer_Clap', laugh: 'Laugh', bow: 'Emote_Bow', salute: 'Emote_Salute', flex: 'Emote_Flex',
		facepalm: 'Emote_Facepalm', thumbsUp: 'Emote_ThumbsUp', sit: 'Sit_Ground', dance2: 'Dance_2' };
	for ( const e of EMOTES ) {

		tick( RATE_LIMIT + 0.2 );
		const played = world.em.play( e.id );
		tick( 0.4 );
		const cn = playing( 'full' );
		ok( played && ! world.em.last.procedural && cn === clipOf[ e.id ], `${ e.id }: the ${ clipOf[ e.id ] } montage plays on the full body (${ cn })` );

	}

	tick( RATE_LIMIT + 0.2 );
	world.app.player.velocity.x = 2;
	pose.speed = 2;
	world.em.play( 'wave' );
	tick( 0.4 );
	ok( playing( 'upper' ) === 'Wave' && ! playing( 'full' ), 'walking: Wave on the upper-body slot' );
	world.app.player.velocity.x = 0;
	pose.speed = 0;
	tick( 3 );

	// the procedural wave: remove both wave clips and ask again
	m.clips.delete( 'Wave' ); m.clips.delete( 'Friendly_Wave' );
	tick( RATE_LIMIT + 0.2 );
	ok( world.em.play( 'wave' ) && world.em.last.procedural && world.em.last.clip === WAVE_CLIP, 'no wave clips on the rig: the procedural arm wave plays' );
	tick( 0.3 );
	ok( playing( 'full' ) === WAVE_CLIP, 'through the montage API like any clip' );
	const buf = readFileSync( join( ROOT, 'public/models/roster/hyptile.glb' ) );
	const rig = makeRig( parseGLB( buf.buffer.slice( buf.byteOffset, buf.byteOffset + buf.byteLength ) ) );
	const clip = m.clips.get( WAVE_CLIP );
	const at = ( t ) => fk( rig, localsAt( rig, clip, t ) ).P;
	const P0 = at( 0 ), P1 = at( 0.9 ), P2 = at( 1.15 );
	const head = P1[ rig.index.head ], hand = P1[ rig.index.hand_r ];
	ok( hand[ 1 ] > head[ 1 ] && P0[ rig.index.hand_r ][ 1 ] < head[ 1 ] - 0.3, `the right hand rises above the head (${ P0[ rig.index.hand_r ][ 1 ].toFixed( 2 ) } -> ${ hand[ 1 ].toFixed( 2 ) } m) and ends back down` );
	ok( Math.abs( P2[ rig.index.hand_r ][ 0 ] - hand[ 0 ] ) > 0.08, 'the forearm swings side to side (the wave)' );
	ok( at( clip.duration )[ rig.index.hand_r ][ 1 ] < head[ 1 ] - 0.3, 'the arm comes back down at the end' );
	ok( proceduralWave( av ) === WAVE_CLIP, 'built once per model' );
	ok( proceduralWave( { model: { clips: new Map(), gltf: {} } } ) === null && proceduralWave( null ) === null, 'a model with no idle or no bones gets none' );

}

console.log( fails ? `\n${ fails } emote check(s) FAILED` : '\nall emote checks passed' );
process.exit( fails ? 1 : 0 );

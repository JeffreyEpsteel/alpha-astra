// Plain-node test of the roster GLBs' clips (wave 11C): every clip the animation graph names (Characters.js CLIPS) is in
// each of the eight characters and none of them is the bind pose (ProcPose.bindLike: every key within 8 deg of the rest).
// Helm_Idle, Steer_Left / Right, Seated_Idle and Fall_Loop used to be: their authored FBXs carry the clip's first frame as the
// skeleton rest, and tools/roster/convert-character.py now rebases them (`|rebase` in build.ps1). The seated clips must
// also carry the pelvis drop of sitting (the authored 0.29 m) and the first frame of each must already be posed.
//   node test/roster-clips.mjs [id ...]
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, basename } from 'node:path';
import { parseGLB } from '../src/engine/loaders/GLTF.js';
import { bindLike, clipRestDeviation } from '../src/player/ik/ProcPose.js';
import { CLIPS, CHARACTER_IDS } from '../src/game/Characters.js';
import { makeRig, localsAt, fk } from '../src/player/anim/ClipTools.js';

const ROOT = fileURLToPath( new URL( '..', import.meta.url ) );
const ROSTER = join( ROOT, 'public', 'models', 'roster' );
const REBASED = [ 'Helm_Idle', 'Steer_Left', 'Steer_Right', 'Seated_Idle', 'Fall_Loop' ];
const SEATED = [ 'Seated_Idle', 'Steer_Left', 'Steer_Right' ];

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};

const only = process.argv.slice( 2 );
const ids = readdirSync( ROSTER ).filter( ( f ) => f.endsWith( '.glb' ) ).map( ( f ) => basename( f, '.glb' ) ).sort()
	.filter( ( id ) => only.length === 0 || only.includes( id ) );
if ( only.length === 0 ) ok( CHARACTER_IDS.every( ( id ) => ids.includes( id ) ), `a GLB for every character (${ ids.join( ', ' ) })` );

// the rest-pose view bindLike / clipRestDeviation need (SkinnedModel.rest: the glTF nodes' TRS)
const restOf = ( gltf ) => gltf.nodes.map( ( n ) => ( { t: n.t, r: n.r, s: n.s } ) );
// the first key of a clip only (the old fault: every authored clip started in the bind pose)
const firstKeys = ( clip ) => ( { ...clip, channels: clip.channels.map( ( c ) => ( { ...c, values: c.values.slice( 0, c.path === 'rotation' ? 4 : 3 ) } ) ) } );

for ( const id of ids ) {

	const buf = readFileSync( join( ROSTER, id + '.glb' ) );
	const gltf = parseGLB( buf.buffer.slice( buf.byteOffset, buf.byteOffset + buf.byteLength ) );
	const model = { rest: restOf( gltf ) };
	const clips = new Map( gltf.animations.map( ( a ) => [ a.name, a ] ) );
	const names = [ ...new Set( Object.values( CLIPS ) ) ];
	const missing = names.filter( ( n ) => ! clips.has( n ) );
	ok( missing.length === 0, `${ id }: all ${ names.length } graph clips present${ missing.length ? ' (missing ' + missing.join( ', ' ) + ')' : '' }` );
	const bind = names.filter( ( n ) => clips.has( n ) && bindLike( clips.get( n ), model ) );
	ok( bind.length === 0, `${ id }: no graph clip is the bind pose${ bind.length ? ' (' + bind.map( ( n ) => n + ' ' + clipRestDeviation( clips.get( n ), model.rest ).toFixed( 1 ) + ' deg' ).join( ', ' ) + ')' : '' }` );
	ok( names.every( ( n ) => ! clips.has( n ) || clips.get( n ).duration > 0.1 ), `${ id }: every graph clip has a length` );
	const posed0 = REBASED.filter( ( n ) => clips.has( n ) && ! bindLike( firstKeys( clips.get( n ) ), model ) );
	ok( posed0.length === REBASED.length, `${ id }: the rebased clips are posed from their first frame (${ posed0.length } / ${ REBASED.length })` );
	// sitting: the pelvis key sits lower than the rest by the authored seat drop (pelvis local Y is the rig's up after the export)
	const pi = gltf.nodes.findIndex( ( n ) => n.name === 'pelvis' );
	for ( const n of SEATED ) {

		const c = clips.get( n );
		const ch = c && c.channels.find( ( k ) => k.node === pi && k.path === 'translation' );
		const r = gltf.nodes[ pi ].t;
		const drop = ch ? Math.hypot( ch.values[ 0 ] - r[ 0 ], ch.values[ 1 ] - r[ 1 ], ch.values[ 2 ] - r[ 2 ] ) : 0;
		ok( drop > 0.2 && drop < 0.4, `${ id }: ${ n } lowers the pelvis into the seat (${ drop.toFixed( 3 ) } m)` );

	}

	// wave 18E seats: the chain clips meet frame for frame, the pelvis stays over the root (the seats line up), the feet stay on
	// the floor, and the chair clips sit on a 0.45 m seat (pelvis about 0.1 m above the seat surface)
	const rig = makeRig( gltf );
	const at = ( n, t ) => localsAt( rig, clips.get( n ), t === 'end' ? clips.get( n ).duration : t );
	const maxDeg = ( A, B ) => { let m = 0; for ( let i = 0; i < A.length; i ++ ) { const d = Math.abs( A[ i ].r[ 0 ] * B[ i ].r[ 0 ] + A[ i ].r[ 1 ] * B[ i ].r[ 1 ] + A[ i ].r[ 2 ] * B[ i ].r[ 2 ] + A[ i ].r[ 3 ] * B[ i ].r[ 3 ] ); m = Math.max( m, 2 * Math.acos( Math.min( 1, d ) ) * 180 / Math.PI ); } return m; };
	const t0 = ( n ) => clips.get( n ).channels[ 0 ].times[ 0 ];
	for ( const [ a, ta, b ] of [ [ 'Sit_Down', 'end', 'Seated_Idle' ], [ 'Stand_Up', 0, 'Seated_Idle' ], [ 'Sit_Chair', 'end', 'Sit_Chair_Idle' ], [ 'Stand_From_Chair', 0, 'Sit_Chair_Idle' ] ] ) {

		if ( ! clips.has( a ) || ! clips.has( b ) ) { ok( false, `${ id }: ${ a } and ${ b } present` ); continue; }
		const d = maxDeg( at( a, ta === 'end' ? 'end' : t0( a ) ), at( b, t0( b ) ) );
		ok( d < 1.5, `${ id }: ${ a } ${ ta === 'end' ? 'ends' : 'starts' } on ${ b }'s first frame (${ d.toFixed( 2 ) } deg)` );

	}

	const restP = fk( rig, rig.rest.map( ( r ) => ( { t: r.t.slice(), r: r.r.slice() } ) ) ).P;
	const floor = Math.min( restP[ rig.index.foot_l ][ 1 ], restP[ rig.index.foot_r ][ 1 ] );
	for ( const n of [ 'Sit_Down', 'Stand_Up', 'Sit_Chair', 'Stand_From_Chair', 'Sit_Chair_Idle' ] ) {

		const c = clips.get( n );
		if ( ! c ) continue;
		let drift = 0, sink = 0, pelY = Infinity;
		for ( let t = 0; t <= c.duration + 1e-6; t += 1 / 15 ) {

			const P = fk( rig, localsAt( rig, c, t ) ).P, pp = P[ rig.index.pelvis ], rp = restP[ rig.index.pelvis ];
			drift = Math.max( drift, Math.hypot( pp[ 0 ] - rp[ 0 ], pp[ 2 ] - rp[ 2 ] ) );
			sink = Math.max( sink, floor - Math.min( P[ rig.index.foot_l ][ 1 ], P[ rig.index.foot_r ][ 1 ] ) );
			pelY = Math.min( pelY, pp[ 1 ] );

		}

		ok( drift < 0.12 && sink < 0.02, `${ id }: ${ n } stays over its seat and on the floor (pelvis drift ${ drift.toFixed( 3 ) } m, foot sink ${ sink.toFixed( 3 ) } m)` );
		if ( n === 'Sit_Chair_Idle' ) ok( pelY > 0.5 && pelY < 0.62, `${ id }: Sit_Chair_Idle sits on the 0.45 m seat (pelvis ${ pelY.toFixed( 3 ) } m)` );

	}

}

console.log( fails ? `${ fails } failed` : 'all passed' );
process.exit( fails ? 1 : 0 );

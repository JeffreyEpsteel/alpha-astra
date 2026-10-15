// Wave 19D: the Kimodo combat takes. Every combat clip (Characters.js COMBAT_CLIPS) is in all eight roster GLBs with a length and
// none is the bind pose; every combat montage of AnimDef resolves; each blow's 'contact' ('release') notify lands on
// the weapon's timing (WeaponsData MELEE[ id ].contact, WeaponPose THROW_RELEASE) and the attack clip lasts through the weapon's
// recovery; WeaponPose slices the takes into the attack clips each weapon plays (ATTACK_OF, the cutlass chain), the right wrist
// is in the fast part of the blow at the contact, and a GLB without the takes keeps the 18D pose clips. Pure CPU.
//   node test/feature-anim-combat.mjs
import './headless.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGLB } from '../src/engine/loaders/GLTF.js';
import { CLIPS, COMBAT_CLIPS, CHARACTER_IDS } from '../src/game/Characters.js';
import DEF from '../src/player/anim/AnimDef.js';
import { makeRig, localsAt, fk, FPS } from '../src/player/anim/ClipTools.js';
import { bindLike } from '../src/player/ik/ProcPose.js';
import { MELEE } from '../src/features/weapons/WeaponsData.js';
import { weaponPoses, ATTACK_OF, MOTION_OF, EXTRA_CLIPS, WEAPON_RECIPES, THROW_RELEASE, attackClip } from '../src/features/weapons/WeaponPose.js';

const ROOT = fileURLToPath( new URL( '..', import.meta.url ) );
const ROSTER = join( ROOT, 'public', 'models', 'roster' );
let failures = 0;
const ok = ( c, msg ) => { if ( ! c ) { failures ++; console.error( 'FAIL ' + msg ); } else console.log( 'ok   ' + msg ); };

// the montage of each attack clip, its weapon and the time its notify must land after the press
const TIMING = {
	cutlassSlashR: [ 'cutlass', MELEE.cutlass.contact ], cutlassSlashL: [ 'cutlass', MELEE.cutlass.contact ], cutlassThrust: [ 'cutlass', MELEE.cutlass.contact ],
	axeChop: [ 'axe', MELEE.axe.contact ], pinClub: [ 'pin', MELEE.pin.contact ], harpoonThrust: [ 'harpoon', MELEE.harpoon.contact ],
	harpoonThrow: [ null, THROW_RELEASE ], bombThrow: [ null, THROW_RELEASE ],
};
const COMBAT_MONTAGES = [ ...Object.keys( TIMING ), 'dodgeRoll', 'taunt' ];

// ---- the data
ok( COMBAT_CLIPS.length >= 9 && COMBAT_CLIPS.every( ( n ) => Object.values( CLIPS ).includes( n ) ), `Characters.js CLIPS names the ${ COMBAT_CLIPS.length } combat takes` );
ok( COMBAT_MONTAGES.every( ( k ) => DEF.montages[ k ] && COMBAT_CLIPS.includes( DEF.montages[ k ].clip ) ), 'every combat montage plays one of the takes' );
for ( const [ k, [ w, at ] ] of Object.entries( TIMING ) ) {

	const m = DEF.montages[ k ], hit = m.notifies.find( ( n ) => n[ 1 ] === 'contact' || n[ 1 ] === 'release' );
	const after = hit ? ( hit[ 0 ] - m.from ) / m.rate : NaN, span = ( m.to - m.from ) / m.rate;
	ok( m.slot === 'upper' && hit && Math.abs( after - at ) < 1e-6, `${ k }: the ${ hit && hit[ 1 ] } lands ${ after.toFixed( 3 ) } s after the press (${ w || 'throw' } ${ at })` );
	ok( m.rate > 0.5 && m.rate < 3, `${ k }: plays at ${ m.rate.toFixed( 2 ) }x (the take neither crawls nor blurs)` );
	// the follow-through: past the blow by 0.25 s or to the end of the recovery (the hold pose takes the arms back after it)
	if ( w ) ok( span >= Math.min( MELEE[ w ].total, at + 0.25 ) - 1e-6, `${ k }: the clip (${ span.toFixed( 2 ) } s) follows through past the blow (the ${ w }'s recovery ends at ${ MELEE[ w ].total } s)` );

}

ok( [ ATTACK_OF.cutlass, ATTACK_OF.axe, ATTACK_OF.pin ].every( ( c ) => MOTION_OF[ c ] ) && ! MOTION_OF[ ATTACK_OF.harpoon ] && Object.keys( MOTION_OF ).every( ( c ) => DEF.montages[ MOTION_OF[ c ] ] ), 'the cutlass, axe and pin blows and both throws have their Kimodo montage (MOTION_OF); the harpoon thrust keeps its pose' );
ok( [ 0, 1, 2, 3 ].map( ( n ) => attackClip( 'cutlass', n ) ).join() === 'Wpn_Slash,Wpn_Slash_L,Wpn_Lunge,Wpn_Slash' && attackClip( 'axe', 5 ) === ATTACK_OF.axe, 'the cutlass chain: cut, backhand, lunge; other weapons keep one blow' );
ok( Object.keys( WEAPON_RECIPES ).length === 8 && Object.values( EXTRA_CLIPS ).every( ( c ) => WEAPON_RECIPES[ c ] ), 'the 18D pose recipes stay (eight) and each new clip falls back to one' );

// ---- the GLBs
const ids = readdirSync( ROSTER ).filter( ( f ) => f.endsWith( '.glb' ) ).map( ( f ) => basename( f, '.glb' ) ).sort();
ok( CHARACTER_IDS.every( ( id ) => ids.includes( id ) ), 'a GLB for every character' );
const speedAt = ( rig, clip, t ) => {

	const a = fk( rig, localsAt( rig, clip, Math.max( 0, t - 0.5 / FPS ) ) ).P[ rig.index.hand_r ], b = fk( rig, localsAt( rig, clip, Math.min( clip.duration, t + 0.5 / FPS ) ) ).P[ rig.index.hand_r ];
	return Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ], b[ 2 ] - a[ 2 ] ) * FPS;

};
for ( const id of ids ) {

	const b = readFileSync( join( ROSTER, id + '.glb' ) );
	const gltf = parseGLB( b.buffer.slice( b.byteOffset, b.byteOffset + b.byteLength ) );
	const clips = new Map( gltf.animations.map( ( a ) => [ a.name, a ] ) );
	const rest = { rest: gltf.nodes.map( ( n ) => ( { t: n.t, r: n.r, s: n.s } ) ) };
	const missing = COMBAT_CLIPS.filter( ( n ) => ! clips.has( n ) );
	ok( missing.length === 0, `${ id }: all ${ COMBAT_CLIPS.length } combat takes in the GLB${ missing.length ? ' (missing ' + missing.join( ', ' ) + ')' : '' }` );
	const bind = COMBAT_CLIPS.filter( ( n ) => clips.has( n ) && bindLike( clips.get( n ), rest ) );
	ok( bind.length === 0, `${ id }: none is the bind pose${ bind.length ? ' (' + bind.join( ', ' ) + ')' : '' }` );
	ok( COMBAT_CLIPS.every( ( n ) => ! clips.has( n ) || ( clips.get( n ).duration > 0.9 && clips.get( n ).duration < 2.6 ) ), `${ id }: every take is 1-2.5 s long` );
	ok( COMBAT_MONTAGES.every( ( k ) => { const m = DEF.montages[ k ], c = clips.get( m.clip ); return c && ( m.from || 0 ) >= 0 && ( m.to === undefined || m.to <= c.duration + 0.05 ); } ), `${ id }: every combat montage's stretch lies inside its take` );

	// the weapon attacks through WeaponPose: the takes sliced into the attack clips
	const model = { gltf, clips: new Map( clips ) };
	const wp = weaponPoses( { model } );
	ok( wp && Object.keys( MOTION_OF ).every( ( c ) => wp.motion.includes( c ) ), `${ id }: WeaponPose plays the takes for ${ wp ? wp.motion.length : 0 } attack clips` );
	if ( ! wp || wp.motion.length < Object.keys( MOTION_OF ).length ) continue;
	const rig = makeRig( gltf );
	const slow = [];
	for ( const [ c, k ] of Object.entries( MOTION_OF ) ) {

		const m = DEF.montages[ k ], clip = model.clips.get( c ), hit = m.notifies[ 0 ][ 0 ];
		const at = ( hit - m.from ) / m.rate;
		if ( Math.abs( clip.duration - ( Math.min( m.to, clips.get( m.clip ).duration ) - m.from ) / m.rate ) > 0.04 ) slow.push( c + ' length ' + clip.duration.toFixed( 2 ) );
		const wrist = ( t ) => fk( rig, localsAt( rig, clip, Math.min( clip.duration, Math.max( 0, t ) ) ) ).P[ rig.index.hand_r ];
		if ( c.startsWith( 'Wpn_Throw' ) ) {

			// a release: the hand up by the head and moving ahead
			const p = wrist( at ), q = wrist( at + 1 / FPS );
			if ( ! ( p[ 1 ] > 0.95 && q[ 2 ] > p[ 2 ] ) ) slow.push( `${ c } wrist at ${ p.map( ( x ) => x.toFixed( 2 ) ).join( ' ' ) }` );

		} else if ( c === 'Wpn_Lunge' ) {

			// a thrust: the wrist most of the way to its furthest reach
			let z0 = wrist( 0 )[ 2 ], zMax = z0;
			for ( let t = 0; t <= clip.duration; t += 1 / FPS ) zMax = Math.max( zMax, wrist( t )[ 2 ] );
			const z = wrist( at )[ 2 ];
			if ( ! ( z >= z0 + 0.6 * ( zMax - z0 ) ) ) slow.push( `${ c } reach ${ ( z - z0 ).toFixed( 2 ) } of ${ ( zMax - z0 ).toFixed( 2 ) } m` );

		} else {

			// a cut, a chop, a club's blow: the wrist in its fast stretch, at least half its fastest speed
			let peak = 0;
			for ( let t = 0; t <= clip.duration; t += 1 / FPS ) peak = Math.max( peak, speedAt( rig, clip, t ) );
			const v = speedAt( rig, clip, at );
			if ( ! ( v >= 0.5 * peak && v > 1.2 ) ) slow.push( `${ c } ${ v.toFixed( 1 ) } of ${ peak.toFixed( 1 ) } m/s at ${ at.toFixed( 2 ) } s` );

		}

	}

	ok( slow.length === 0, `${ id }: at each attack's contact / release the right wrist is in its fast stretch${ slow.length ? ' (' + slow.join( '; ' ) + ')' : '' }` );

}

// ---- the fallback: a GLB without the takes keeps 18D's pose clips (and the new names get poses too)
{

	const b = readFileSync( join( ROSTER, 'hyptile.glb' ) );
	const gltf = parseGLB( b.buffer.slice( b.byteOffset, b.byteOffset + b.byteLength ) );
	const clips = new Map( gltf.animations.filter( ( a ) => ! COMBAT_CLIPS.includes( a.name ) ).map( ( a ) => [ a.name, a ] ) );
	const wp = weaponPoses( { model: { gltf, clips } } );
	ok( wp && wp.motion.length === 0 && [ ...Object.keys( WEAPON_RECIPES ), ...Object.keys( EXTRA_CLIPS ) ].every( ( c ) => clips.has( c ) ), 'without the takes every attack clip is the 18D pose clip' );
	ok( wp && Math.abs( clips.get( 'Wpn_Slash' ).duration - WEAPON_RECIPES.Wpn_Slash.keys.at( - 1 ).t ) < 1e-6, 'the fallback Wpn_Slash is the 18D recipe' );

}

console.log( failures ? failures + ' failure(s)' : 'all combat animation checks passed' );
process.exit( failures ? 1 : 0 );

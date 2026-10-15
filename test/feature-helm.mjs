// The helmsman and the wheel (wave 10B) and the swimmer: every hull's wheel turns with the steering (the lobster boat's
// procedural wheel, the fleet hulls' pedestal wheel, the ships' baked wheel carved out of the GLB), wheelGrips() follow it,
// the contact IK puts both hands on the rim, the helm state never shows the bind (A) pose (the roster's Helm_Idle /
// Steer_* / Seated_Idle clips are bind poses: a standing idle replaces them), the lean follows the steering, a rig without
// the IK bones gets a plain arms-forward pose, and in the water: treading when still, the crawl when moving, nose-down
// while diving, never the bind pose.
//   node test/feature-helm.mjs [outDir]   (outDir: also renders previews of the helmsman on the launch and the sloop)
import './headless.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { worldHarness, done } from './world-harness.mjs';
import { Material } from '../src/engine/render/Material.js';
import { BoatModel, HAND_TURN } from '../src/world/BoatModel.js';
import { FleetBoatModel } from '../src/world/boat/FleetBoatModel.js';
import { ShipBoatModel } from '../src/world/boat/ShipBoatModel.js';
import { createBoatModel } from '../src/world/boat/BoatFactory.js';
import { contactTargets } from '../src/player/ik/Grips.js';
import { ProcPose, bindLike, clipRestDeviation } from '../src/player/ik/ProcPose.js';
import { Avatar, footWeight } from '../src/player/Avatar.js';

const ROOT = fileURLToPath( new URL( '..', import.meta.url ) );
const OUT = process.argv[ 2 ] || null;
globalThis.__assetFile = async ( url ) => { const b = readFileSync( join( ROOT, 'public', url.replace( /^\//, '' ) ) ); return b.buffer.slice( b.byteOffset, b.byteOffset + b.byteLength ); };
const GREY = new Uint8Array( 16 ).fill( 160 );
for ( let i = 3; i < 16; i += 4 ) GREY[ i ] = 255;
globalThis.__assetImage = async () => ( { data: GREY.slice(), width: 2, height: 2 } );

const H = await worldHarness( { width: 960, height: 720 } );
const { E, scene } = H;
let failures = 0;
const ok = ( c, msg ) => { if ( ! c ) { failures ++; console.error( 'FAIL ' + msg ); } else console.log( 'ok   ' + msg ); };
const f2 = ( x ) => x.toFixed( 2 );
const DT = 1 / 30;
const ang = ( a, b ) => 2 * Math.acos( Math.min( 1, Math.abs( a[ 0 ] * b[ 0 ] + a[ 1 ] * b[ 1 ] + a[ 2 ] * b[ 2 ] + a[ 3 ] * b[ 3 ] ) ) ) * 180 / Math.PI;

// a boat controller stand-in: the model's group is the boat
const ctlFor = ( model ) => ( { model, steer: 0, toWorld: ( l, o ) => o.copy( l ).applyMatrix4( model.group.matrixWorld ) } );
const firstMesh = ( o ) => { let m = null; o.traverse( ( x ) => { if ( ! m && x.isMesh ) m = x; } ); return m; };
// a wheel vertex in the boat frame (the wheel node's first mesh, vertex k)
const wheelVertex = ( model, k = 0 ) => {

	const m = firstMesh( model.wheelMesh );
	model.group.updateMatrixWorld( true );
	const p = m.geometry.attributes.position;
	return new E.Vector3( p.array[ k * 3 ], p.array[ k * 3 + 1 ], p.array[ k * 3 + 2 ] ).applyMatrix4( m.matrixWorld );

};

// ---- the wheel on every hull class
const HULLS = [ 'lobster', 'skiff', 'canoe', 'cutter', 'launch', 'trawler', 'sloop', 'brigantine' ];
const models = {};
for ( const id of HULLS ) {

	const model = createBoatModel( id );
	models[ id ] = model;
	ok( model.wheelPivot && model.wheelMesh && model.wheelRadius > 0.1 && typeof model.wheelGrips === 'function', `${ id }: a wheel (pivot, node, radius ${ f2( model.wheelRadius || 0 ) }) and wheelGrips() before the GLB is in` );
	model.setSteering( 0 );
	const r0 = model.wheelMesh.rotation.z;
	model.setSteering( 0.5 );
	const r1 = model.wheelMesh.rotation.z;
	model.setSteering( - 0.5 );
	const r2 = model.wheelMesh.rotation.z;
	ok( Math.abs( r0 ) < 1e-9 && r1 < - 1 && Math.abs( r1 + r2 ) < 1e-9 && model.steering === - 0.5, `${ id }: setSteering turns the wheel (half helm to port ${ f2( r1 ) } rad, counter-clockwise from the helm)` );
	model.setSteering( 0 );

}

for ( const id of HULLS ) await models[ id ].ready;
const _L = new E.Vector3(), _R = new E.Vector3(), _L2 = new E.Vector3(), _R2 = new E.Vector3();
for ( const id of HULLS ) {

	const model = models[ id ];
	model.group.updateMatrixWorld( true );
	const piv = model.wheelPivot;
	// the pivot sits in the boat frame wherever the GLB moved the wheel node
	const pw = new E.Vector3().setFromMatrixPosition( piv.matrixWorld );
	ok( pw.distanceTo( piv.position ) < 1e-5, `${ id }: the wheel pivot is in the boat frame after the load (${ pw.toArray().map( f2 ).join( ', ' ) })` );
	// grips: on the rim, the left hand to port (+X), both above the deck, the helmsman standing behind the wheel
	model.setSteering( 0 );
	model.wheelGrips( _L, _R );
	const dl = _L.distanceTo( piv.position ), dr = _R.distanceTo( piv.position );
	ok( Math.abs( dl - model.wheelRadius ) < 1e-6 && Math.abs( dr - model.wheelRadius ) < 1e-6 && _L.x > _R.x + model.wheelRadius && Math.abs( _L.y - _R.y ) < 1e-6, `${ id }: grips on the rim, left to port (L ${ _L.toArray().map( f2 ).join( ', ' ) })` );
	const stand = model.helmStand;
	ok( stand && stand.z < piv.position.z - 0.3 && Math.abs( stand.x - piv.position.x ) < 1e-6 && piv.position.y - stand.y > 0.8 && piv.position.y - stand.y < 1.2, `${ id }: helmStand ${ f2( piv.position.z - stand.z ) } m behind the wheel, hub ${ f2( piv.position.y - stand.y ) } m over the feet` );
	// the grips turn with the wheel: a turn to port takes the left hand down, the right hand up, both stay on the rim
	model.setSteering( 0.15 );
	model.wheelGrips( _L2, _R2 );
	const turn = model.wheelMesh.rotation.z;
	const a0 = Math.atan2( _L.y - piv.position.y, _L.x - piv.position.x ), a1 = Math.atan2( _L2.y - piv.position.y, _L2.x - piv.position.x );
	ok( _L2.y < _L.y && _R2.y > _R.y && Math.abs( _L2.distanceTo( piv.position ) - model.wheelRadius ) < 1e-6, `${ id }: wheelGrips rotate with the wheel (left hand ${ f2( _L.y ) } -> ${ f2( _L2.y ) })` );
	if ( Math.abs( piv.quaternion.x ) < 1e-6 ) ok( Math.abs( ( a1 - a0 ) - HAND_TURN * Math.tanh( turn / HAND_TURN ) ) < 1e-6, `${ id }: the hands follow the wheel angle (soft limit ${ HAND_TURN } rad)` );
	model.setSteering( 1 );
	model.wheelGrips( _L2, _R2 );
	ok( Math.abs( _L2.distanceTo( piv.position ) - model.wheelRadius ) < 1e-6 && _L2.y > piv.position.y - model.wheelRadius, `${ id }: hard over the hands slide on the rim instead of wrapping round it` );
	// the wheel's own geometry turns about the axle
	model.setSteering( 0 );
	const v0 = wheelVertex( model, 5 );
	model.setSteering( 0.2 );
	const v1 = wheelVertex( model, 5 );
	const axle = new E.Vector3( 0, 0, 1 ).applyQuaternion( piv.quaternion );
	const rad0 = v0.clone().sub( piv.position ), rad1 = v1.clone().sub( piv.position );
	ok( v0.distanceTo( v1 ) > 0.01 && Math.abs( rad0.length() - rad1.length() ) < 1e-4 && Math.abs( rad0.dot( axle ) - rad1.dot( axle ) ) < 1e-4, `${ id }: the wheel mesh turns about its axle (a vertex moves ${ f2( v0.distanceTo( v1 ) ) } m)` );
	model.setSteering( 0 );
	// contact targets: both hands on the wheel at the helm, the steering handed on for the lean
	const ctl = ctlFor( model );
	model.setSteering( 0.4 );
	const req = contactTargets( {}, { player: { mode: 'boat' }, rod: null, boat: ctl, action: 'steerLeft' } );
	model.wheelGrips( _L, _R );
	ok( req.leftHand.weight === 1 && req.rightHand.weight === 1 && req.leftHand.position.distanceTo( _L ) < 1e-6 && req.rightHand.position.distanceTo( _R ) < 1e-6 && req.steer === 0.4, `${ id }: contactTargets holds the rim at the wheel's grips, steer ${ req.steer }` );
	model.setSteering( 0 );

}

// the ships' baked wheel: the same parts on all three (rim + 8 spokes in the spar timber, 8 ferrules + the hub in brass), cut
// out of the hull (the hull keeps the binnacle), the centre where the fork's builder put it
for ( const id of [ 'trawler', 'sloop', 'brigantine' ] ) {

	const m = models[ id ];
	const mats = m.wheelMesh.children.map( ( c ) => c.material.name ).sort().join( ' ' );
	const spec = m.spec;
	ok( m.wheelTriangles > 500 && mats === 'boat-M_NavalAgedBrass boat-M_NavalSparTimber' && Math.abs( m.wheelRadius - 0.44 ) < 0.02, `${ id }: ${ m.wheelTriangles } wheel triangles carved out of the GLB (${ mats }), radius ${ f2( m.wheelRadius ) }` );
	ok( Math.abs( m.wheelPivot.position.z - ( spec.helm.z + 0.55 ) ) < 0.05 && Math.abs( m.wheelPivot.position.y - ( spec.helmDeckY + 1.05 ) ) < 0.03, `${ id }: the wheel centre at helm + 0.55 m, ${ f2( m.wheelPivot.position.y - spec.helmDeckY ) } m over the platform` );
	// no wheel triangle is left in the hull: no hull triangle has all three corners inside the rim's disc near the hub plane
	let left = 0;
	const c = m.wheelPivot.position;
	const hull = m.group.children.find( ( x ) => x.name === 'boat-hull' );
	hull.updateMatrixWorld( true );
	hull.traverse( ( o ) => {

		if ( ! o.isMesh ) return;
		const P = o.geometry.attributes.position.array, I = o.geometry.index.array, v = new E.Vector3();
		for ( let t = 0; t < I.length; t += 3 ) {

			let inRim = 0;
			for ( let j = 0; j < 3; j ++ ) {

				v.fromArray( P, I[ t + j ] * 3 ).applyMatrix4( o.matrixWorld );
				const dz = v.z - c.z, rr = Math.hypot( v.x - c.x, v.y - c.y );
				if ( Math.abs( dz ) < 0.01 && rr > 0.42 && rr < 0.47 ) inRim ++;

			}

			if ( inRim === 3 ) left ++;

		}

	} );
	ok( left === 0, `${ id }: the hull keeps no rim triangles (${ left })` );

}

// ---- the helmsman (the real Hyptile rig through the Avatar)
const av = new Avatar( { scene, character: 'hyptile' } );
await av.ready;
const m = av.model;
const I = ( n ) => m.gltf.nodes.findIndex( ( x ) => x.name === n );
const restDev = ( n ) => ang( m.local[ I( n ) ].r, m.rest[ I( n ) ].r );
const worldOf = ( n, out = new E.Vector3() ) => { m.nodeWorld( n, out ); return out.applyMatrix4( av.group.matrixWorld ); };
const modelOf = ( n, out = new E.Vector3() ) => { m.nodeWorld( n, out ); return out; };

ok( [ 'Helm_Idle', 'Steer_Left', 'Steer_Right', 'Seated_Idle', 'Fall_Loop' ].every( ( c ) => clipRestDeviation( m.gltf.animations.find( ( a ) => a.name === c ), m.rest ) > 30 ), 'the roster GLB\'s Helm_Idle / Steer_* / Seated_Idle / Fall_Loop are real poses (wave 11C rebase), not the bind A' );
ok( av.helmBase === 'clip' && ! bindLike( m.clips.get( 'Helm_Idle' ), m ), `the helm state plays the rig's own Helm_Idle (${ av.helmBase })` );
ok( ! bindLike( m.clips.get( 'Idle_Breathe' ), m ) && ! bindLike( m.clips.get( 'Swim_Forward' ), m ), 'the idle and the swim stroke are real clips' );

const helmAt = ( model, { action = 'helm', steer = 0, frame = null, seconds = 1.2, ik = true, at = model.helmStand } = {} ) => {

	const ctl = ctlFor( model );
	model.group.updateMatrixWorld( true );
	const pose = { position: at.clone().applyMatrix4( model.group.matrixWorld ), yaw: Math.PI, mode: 'boat', speed: 0, vy: 0, grounded: true, frame, action };
	const req = {};
	let n = Math.round( seconds / DT );
	while ( n -- > 0 ) {

		model.setSteering( steer );
		av.setIKTargets( ik ? contactTargets( req, { player: { mode: 'boat' }, rod: null, boat: ctl, action } ) : null );
		av.update( DT, pose );

	}

	return req;

};

for ( const id of [ 'lobster', 'launch', 'sloop' ] ) {

	const model = models[ id ];
	scene.add( model.group );
	const req = helmAt( model );
	ok( av.state === 'helm' && m.current === 'Helm_Idle' && m.layers.length > 0, `${ id }: at the helm the helm state plays its base (${ av.state }, ${ m.current })` );
	const arms = Math.min( restDev( 'upperarm_l' ), restDev( 'upperarm_r' ) );
	ok( arms > 15, `${ id }: no A pose: the upper arms ${ f2( arms ) } deg off the bind pose` );
	const dl = worldOf( 'weapon_l' ).distanceTo( req.leftHand.position ), dr = worldOf( 'weapon_r' ).distanceTo( req.rightHand.position );
	ok( dl < 0.06 && dr < 0.06, `${ id }: both palms on the rim (${ f2( dl ) } / ${ f2( dr ) } m from the grips)` );
	// the hands follow the turning wheel
	const r2 = helmAt( model, { action: 'steerLeft', steer: 0.6, seconds: 0.8 } );
	const dl2 = worldOf( 'weapon_l' ).distanceTo( r2.leftHand.position );
	ok( av.state === 'helm' && m.current === 'Helm_Idle' && dl2 < 0.06, `${ id }: steering (steerLeft) keeps the helm base and the left palm on the turned rim (${ f2( dl2 ) } m)` );
	// standing where Player.pose puts the helmsman today (the helm point, behind helmStand): the IK still reaches the rim
	const hp = model.helmPoint || { x: - 0.55, z: 0.22 };
	const r3 = helmAt( model, { at: new E.Vector3( hp.x, model.helmStand.y, hp.z ) } );
	const dl3 = worldOf( 'weapon_l' ).distanceTo( r3.leftHand.position ), dr3 = worldOf( 'weapon_r' ).distanceTo( r3.rightHand.position );
	ok( dl3 < 0.08 && dr3 < 0.08, `${ id }: from the helm point (${ f2( model.wheelPivot.position.z - hp.z ) } m behind the wheel) the palms still reach the rim (${ f2( dl3 ) } / ${ f2( dr3 ) } m)` );
	scene.remove( model.group );

}

// the lean: the head goes into the turn (model +X is the helmsman's left = port)
{

	const model = models.launch;
	scene.add( model.group );
	helmAt( model, { action: 'steerLeft', steer: 1, seconds: 1.5 } );
	const hl = modelOf( 'head' ).x;
	helmAt( model, { action: 'steerRight', steer: - 1, seconds: 1.5 } );
	const hr = modelOf( 'head' ).x;
	helmAt( model, { steer: 0, seconds: 1.5 } );
	const h0 = modelOf( 'head' ).x;
	ok( hl > h0 + 0.02 && hr < h0 - 0.02, `the helmsman leans with the steering (head x ${ f2( hr ) } / ${ f2( h0 ) } / ${ f2( hl ) } for hard to starboard / centred / port)` );
	// hull roll: the upper body keeps part of the way back to the world's up
	const roll = new E.Quaternion().setFromAxisAngle( new E.Vector3( 0, 0, 1 ), 0.25 );
	helmAt( model, { frame: roll, seconds: 2 } );
	const head = worldOf( 'head' ), pel = worldOf( 'pelvis' );
	const tilt = Math.atan2( head.x - pel.x, head.y - pel.y ); // the body line against the world vertical
	const deck = Math.atan2( new E.Vector3( 0, 1, 0 ).applyQuaternion( roll ).x, new E.Vector3( 0, 1, 0 ).applyQuaternion( roll ).y );
	ok( Math.abs( tilt ) < Math.abs( deck ) - 0.05, `on a rolled deck (${ f2( deck ) } rad) the body stands straighter (${ f2( tilt ) } rad)` );
	// an idle skiff (the 'seated' action at the helm): the real Seated_Idle since wave 11C, knees bent, not the A
	helmAt( models.skiff, { action: 'seated', seconds: 0.8, ik: false } );
	ok( m.current === 'Seated_Idle' && restDev( 'thigh_l' ) > 45 && restDev( 'upperarm_l' ) > 15, `an idle skiff at the helm: seated, no bind pose (${ av.state } / ${ m.current }, thigh ${ f2( restDev( 'thigh_l' ) ) } deg)` );
	// rowing keeps its real clip
	helmAt( models.skiff, { action: 'rowForward', seconds: 0.8, ik: false } );
	ok( av.state === 'action' && m.current === 'Row_Forward', `rowing plays the row clip (${ m.current })` );
	// a rig without the IK (no hand targets possible): the plain upper-body pose, hands forward at wheel height
	const saved = av.ik;
	av.ik = null;
	helmAt( model, { seconds: 1, ik: false } );
	const hl2 = modelOf( 'hand_l' ), hr2 = modelOf( 'hand_r' );
	ok( hl2.z > 0.2 && hr2.z > 0.2 && hl2.y > 0.8 && hl2.y < 1.15 && hr2.y > 0.8 && hr2.y < 1.15, `no IK rig: the hands forward at wheel height (L ${ hl2.toArray().map( f2 ).join( ', ' ) })` );
	av.ik = saved;
	ok( ProcPose.create( { gltf: { nodes: [ { name: 'Bip01 L UpperArm' }, { name: 'Bip01 L Forearm' }, { name: 'Bip01 L Hand' }, { name: 'Bip01 R UpperArm' }, { name: 'Bip01 R Forearm' }, { name: 'Bip01 R Hand' } ] } } )?.hasArms === true, 'the procedural pose finds the arms of a Rocketbox-named rig too' );
	scene.remove( model.group );

}

if ( OUT ) {

	mkdirSync( OUT, { recursive: true } );
	const ground = new E.Mesh( new E.PlaneGeometry( 200, 200 ).rotateX( - Math.PI / 2 ), new Material( { name: 'ground', color: 0x6f8aa0, roughness: 0.9 } ) );
	ground.position.y = - 0.3;
	scene.add( ground );
	for ( const [ id, steer, cam ] of [ [ 'launch', 0.35, [ 1.6, 0.7, - 1.6 ] ], [ 'sloop', 0.35, [ 1.4, 0.9, - 2.4 ] ], [ 'sloop', - 0.35, [ - 0.6, 0.5, 1.6 ] ] ] ) {

		const model = models[ id ];
		scene.add( model.group );
		helmAt( model, { action: steer > 0 ? 'steerLeft' : 'steerRight', steer, seconds: 1.5 } );
		const t = model.wheelPivot.position;
		const pos = [ t.x + cam[ 0 ], t.y + cam[ 1 ], t.z + cam[ 2 ] ];
		await H.shot( join( OUT, `helm-${ id }-${ cam[ 2 ] > 0 ? 'front' : 'back' }.png` ), { pos, target: [ t.x, t.y - 0.1, t.z - 0.3 ], fov: 50 } );
		scene.remove( model.group );

	}

	scene.remove( ground );

}

// ---- the water
{

	const pose = { position: new E.Vector3( 0, 0, 0 ), yaw: 0, mode: 'swim', speed: 0, vy: 0, grounded: false, diving: false, frame: null, action: null };
	const pitchOf = () => Math.acos( Math.max( - 1, Math.min( 1, new E.Vector3( 0, 1, 0 ).applyQuaternion( av.group.quaternion ).y ) ) );
	let minArm = 1e9, minThigh = 1e9, minHandZ = 1e9;
	av.setIKTargets( null );
	for ( let i = 0; i < 30; i ++ ) av.update( DT, pose );
	for ( let i = 0; i < 90; i ++ ) {

		av.update( DT, pose );
		minArm = Math.min( minArm, restDev( 'upperarm_l' ), restDev( 'upperarm_r' ) );
		minThigh = Math.min( minThigh, restDev( 'thigh_l' ), restDev( 'thigh_r' ) );
		minHandZ = Math.min( minHandZ, modelOf( 'hand_l' ).z, modelOf( 'hand_r' ).z );

	}

	ok( av.state === 'swim' && pitchOf() < 0.2, `still in the water: upright treading (state ${ av.state }, pitch ${ f2( pitchOf() ) } rad)` );
	ok( minArm > 15 && minThigh > 10 && minHandZ > 0.05, `treading never passes the bind pose: arms >= ${ f2( minArm ) } deg, thighs >= ${ f2( minThigh ) } deg off it, hands in front (z >= ${ f2( minHandZ ) })` );
	// sculling: the hands move
	const a = modelOf( 'hand_l' ).clone();
	for ( let i = 0; i < 10; i ++ ) av.update( DT, pose );
	ok( modelOf( 'hand_l' ).distanceTo( a ) > 0.04, 'the treading arms scull' );
	// start swimming: the pitch eases in, then the crawl
	pose.speed = 1.2;
	const p0 = pitchOf();
	av.update( DT, pose );
	ok( pitchOf() - p0 < 0.3, `the body tips forward gradually (${ f2( pitchOf() - p0 ) } rad in a frame)` );
	for ( let i = 0; i < 45; i ++ ) av.update( DT, pose );
	let minDev = 1e9, kick = [ 1e9, - 1e9 ];
	const sw = m.layers.find( ( l ) => l.target === 1 );
	for ( let i = 0; i < 75; i ++ ) {

		av.update( DT, pose );
		// the clip's own loop seam is the bind pose: the arms never get back to it
		minDev = Math.min( minDev, Math.max( restDev( 'upperarm_l' ), restDev( 'upperarm_r' ) ) );
		const fz = modelOf( 'foot_l' ).z;
		kick = [ Math.min( kick[ 0 ], fz ), Math.max( kick[ 1 ], fz ) ];

	}

	ok( av.state === 'swim' && /Swim_/.test( m.current ) && Math.abs( pitchOf() - 1.2 ) < 0.1, `moving: the crawl stroke clip (${ m.current }), prone at ${ f2( pitchOf() ) } rad` );
	ok( minDev > 12, `the crawl never shows the bind pose (arms >= ${ f2( minDev ) } deg off it, also at the clip's loop seam)` );
	ok( kick[ 1 ] - kick[ 0 ] > 0.08, `the legs flutter (foot travel ${ f2( kick[ 1 ] - kick[ 0 ] ) } m)` );
	// diving down: nose-down past prone; coming up: head first
	pose.diving = true; pose.vy = - 1.2;
	for ( let i = 0; i < 60; i ++ ) av.update( DT, pose );
	const dn = pitchOf();
	ok( dn > Math.PI / 2 + 0.3 && worldOf( 'head' ).y < worldOf( 'pelvis' ).y, `diving down: pitched nose-down (${ f2( dn ) } rad, the head below the hips)` );
	pose.vy = 1.2;
	for ( let i = 0; i < 60; i ++ ) av.update( DT, pose );
	ok( pitchOf() < Math.PI / 2 - 0.3, `coming up: head-up (${ f2( pitchOf() ) } rad)` );
	pose.speed = 0; pose.vy = 0;
	for ( let i = 0; i < 60; i ++ ) av.update( DT, pose );
	ok( pitchOf() < 0.7 && restDev( 'upperarm_l' ) > 15, `hovering under water: upright-ish (${ f2( pitchOf() ) } rad) and treading` );
	// no foot IK and no rod overlay in the water
	pose.diving = false; pose.action = 'hold';
	for ( let i = 0; i < 20; i ++ ) av.update( DT, pose );
	ok( footWeight( pose ) === 0 && ! m.overlay && av.ik.fw === 0, 'in the water: no foot IK, no rod overlay' );
	// out of the water the procedural water pose lets go quickly
	pose.mode = 'walk'; pose.grounded = true; pose.action = null;
	for ( let i = 0; i < 15; i ++ ) av.update( DT, pose );
	ok( av._proc.swim.tread < 0.05 && av._proc.swim.crawl < 0.05, `on land the water pose is gone in half a second (tread ${ f2( av._proc.swim.tread ) })` );
	void sw;

}

console.log( failures ? `${ failures } helm / swim check(s) FAILED` : 'all helm / swim checks passed' );
if ( failures ) process.exit( 1 );
await done();

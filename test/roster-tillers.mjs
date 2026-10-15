// Headless test of the steering gear that moves (wave 11C): the fleet hulls' tillers (and rudder blades) carved out of their
// GLBs swing with FleetBoatModel.setSteering, the player's ships keep their wheel and get no tiller, and the AI ships' wheels
// (features/naval/Models.js ShipVisual) turn with Ship.yawRate or a brain's steer, on every hull / ship class.
//   node test/roster-tillers.mjs
import './headless.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { worldHarness } from './world-harness.mjs';
import { FleetBoatModel, TILLER_MAX } from '../src/world/boat/FleetBoatModel.js';
import { createBoatModel } from '../src/world/boat/BoatFactory.js';
import { BOATS } from '../src/game/Boats.js';
import { ModelSet } from '../src/features/naval/Models.js';
import { Ship } from '../src/features/naval/Ship.js';
import { SHIP_KINDS } from '../src/features/naval/ShipClasses.js';

const ROOT = fileURLToPath( new URL( '..', import.meta.url ) );
globalThis.__assetFile = async ( url ) => { const b = readFileSync( join( ROOT, 'public', url.replace( /^\//, '' ) ) ); return b.buffer.slice( b.byteOffset, b.byteOffset + b.byteLength ); };
const GREY = new Uint8Array( 16 ).fill( 160 );
for ( let i = 3; i < 16; i += 4 ) GREY[ i ] = 255;
globalThis.__assetImage = async () => ( { data: GREY.slice(), width: 2, height: 2 } );

const H = await worldHarness( { width: 320, height: 240 } );
const { E, scene } = H;
let fails = 0;
const ok = ( c, msg ) => { if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg ); };
const f2 = ( x ) => x.toFixed( 2 );

// the far end of a part (the vertex furthest from its pivot), in the boat frame
const tip = ( model, part ) => {

	model.group.updateMatrixWorld( true );
	let best = null, bd = - 1;
	part.traverse( ( o ) => {

		if ( ! o.isMesh ) return;
		const p = o.geometry.attributes.position.array;
		for ( let i = 0; i < p.length; i += 3 ) {

			const d = p[ i ] * p[ i ] + p[ i + 1 ] * p[ i + 1 ] + p[ i + 2 ] * p[ i + 2 ];
			if ( d > bd ) { bd = d; best = [ o, i ]; }

		}

	} );
	const [ o, i ] = best, p = o.geometry.attributes.position.array;
	const inv = new E.Matrix4().copy( model.group.matrixWorld ).invert();
	return new E.Vector3( p[ i ], p[ i + 1 ], p[ i + 2 ] ).applyMatrix4( o.matrixWorld ).applyMatrix4( inv );

};
const tris = ( part ) => { let n = 0; part.traverse( ( o ) => { if ( o.isMesh ) n += ( o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count ) / 3; } ); return n; };

// ---- the fleet hulls: a tiller over the stern turns with the steering
for ( const id of Object.keys( BOATS ).filter( ( k ) => BOATS[ k ].kind === 'fleet' ) ) {

	const model = createBoatModel( id );
	ok( model instanceof FleetBoatModel, `${ id }: a fleet hull` );
	model.setSteering( 0.4 ); // before the GLB: remembered, applied when the tiller is in
	await model.ready;
	scene.add( model.group );
	ok( !! model.tillerPivot && !! model.tillerMesh, `${ id }: a tiller (${ model.tillerSource }, ${ model.tillerMesh ? tris( model.tillerMesh ) : 0 } triangles)` );
	ok( model.tillerSource === 'carved' && tris( model.tillerMesh ) >= 20, `${ id }: the GLB's own tiller was lifted out of the hull` );
	ok( Math.abs( model.tillerAngle + 0.4 * TILLER_MAX ) < 1e-6, `${ id }: the steering set before the GLB arrived is applied (${ f2( model.tillerAngle ) } rad)` );
	ok( !! model.rudderPivot, `${ id }: the rudder blade turns with it` );
	const pv = model.tillerPivot.position;
	ok( Math.abs( pv.x ) < 0.05 && pv.z < model.lines.zAft * 0.6 && pv.y > model.lines.deckY - 0.1, `${ id }: the stock on the centreline at the stern (${ f2( pv.x ) }, ${ f2( pv.y ) }, ${ f2( pv.z ) })` );
	model.setSteering( 0 );
	const t0 = tip( model, model.tillerMesh ), r0 = model.rudderPivot ? tip( model, model.rudderPivot ) : null;
	ok( t0.z > pv.z + 0.3 && Math.abs( t0.x ) < 0.06, `${ id }: centred, the tiller points forward (tip z ${ f2( t0.z ) })` );
	model.setSteering( 1 );
	const tp = tip( model, model.tillerMesh ), rp = model.rudderPivot ? tip( model, model.rudderPivot ) : null;
	model.setSteering( - 1 );
	const ts = tip( model, model.tillerMesh );
	ok( tp.x < - 0.2 && ts.x > 0.2, `${ id }: hard to port puts the tiller to starboard (tip x ${ f2( tp.x ) }), hard to starboard to port (${ f2( ts.x ) })` );
	ok( Math.abs( model.tillerAngle - TILLER_MAX ) < 1e-6, `${ id }: hard over is TILLER_MAX (${ f2( model.tillerAngle ) } rad)` );
	if ( rp ) ok( rp.x > r0.x + 0.05, `${ id }: the blade's trailing edge swings to port for a turn to port (x ${ f2( r0.x ) } -> ${ f2( rp.x ) })` );
	ok( model.wheelMesh && model.wheelMesh.rotation.z !== 0, `${ id }: the pedestal wheel still turns too` );
	model.setSteering( 0 );
	scene.remove( model.group );

}

// ---- the player's ships: the wheel turns, no tiller is made from a GLB in another frame
for ( const id of Object.keys( BOATS ).filter( ( k ) => BOATS[ k ].kind === 'ship' ) ) {

	const model = createBoatModel( id );
	await model.ready;
	model.setSteering( 0.5 );
	ok( model.tillerPivot === null && model.tillerAngle === 0 && model.wheelMesh.rotation.z !== 0, `${ id } (player ship): the wheel turns, no tiller` );
	model.setSteering( 0 );

}

// ---- the AI ships: the wheel carved from the template turns with the ship's turn
const models = new ModelSet( { scene, baseUrl: '/' } );
for ( const kind of SHIP_KINDS ) {

	await models.ready( kind );
	const v = models.create( kind );
	const ship = new Ship( kind, { x: 0, z: 0, yaw: 0 } );
	ok( !! v.wheel && v.wheel.children.length > 0, `${ kind } (AI): a wheel carved out of the ship (${ v.wheel ? tris( v.wheel ) : 0 } triangles)` );
	if ( ! v.wheel ) continue;
	v.apply( ship, ship.finalPose( {} ) );
	ok( Math.abs( v.wheel.rotation.z ) < 1e-9, `${ kind } (AI): steady on her heading, the wheel is centred` );
	ship.yawRate = ship.cls.turn * 0.5;
	v.apply( ship, ship.finalPose( {} ) );
	const port = v.wheel.rotation.z;
	ok( Math.abs( port + 0.5 * v.wheelTurns * Math.PI * 2 ) < 1e-6, `${ kind } (AI): turning to port at half rate spins it counter-clockwise from the helm (${ f2( port ) } rad)` );
	ship.yawRate = - ship.cls.turn * 2;
	v.apply( ship, ship.finalPose( {} ) );
	ok( Math.abs( v.wheel.rotation.z - v.wheelTurns * Math.PI * 2 ) < 1e-6, `${ kind } (AI): a hard turn to starboard puts it hard over the other way (${ f2( v.wheel.rotation.z ) } rad)` );
	ship.yawRate = 0;
	ship.steer = 0.25;
	v.apply( ship, ship.finalPose( {} ) );
	ok( Math.abs( v.wheel.rotation.z + 0.25 * v.wheelTurns * Math.PI * 2 ) < 1e-6, `${ kind } (AI): a brain's steer drives it when set (${ f2( v.wheel.rotation.z ) } rad)` );
	// the wheel sits at the helm, aft of amidships, above the deck, on the centreline
	const wp = v.wheel.parent.position;
	ok( wp.z < 0 && wp.y > ship.cls.deck && Math.abs( wp.x ) < 0.3, `${ kind } (AI): the wheel at the helm (${ f2( wp.x ) }, ${ f2( wp.y ) }, ${ f2( wp.z ) })` );
	v.dispose();

}

models.dispose();
console.log( fails ? `${ fails } failed` : 'all passed' );
process.exit( fails ? 1 : 0 );

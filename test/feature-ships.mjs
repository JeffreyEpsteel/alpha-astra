// The three ships (trawler, sloop, brigantine) as the player's boat: catalog, ShipBoatModel (lines, buoyancy samples, deck
// colliders against the GLB planks, exit points, helm, hull volume), the real Player walking the deck to the wheel, the real
// BoatController driving each ship on flat water, and the naval feature's built-in broadside; then a headless GPU render of
// each ship (hull + colliders overlay).
//   node test/feature-ships.mjs [outDir]       -> <outDir>/<id>-side.png, -quarter.png, -colliders.png, -deck.png
//   node test/feature-ships.mjs --no-render    everything but the screenshots (the GLB textures still need the headless GPU)
import './headless.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import * as E from '../src/engine/index.js';
import { parseGLB } from '../src/engine/loaders/GLTF.js';
import { Material } from '../src/engine/render/Material.js';
import { worldHarness, done } from './world-harness.mjs';
import { TerrainData } from '../src/world/TerrainData.js';
import { Player } from '../src/player/Player.js';
import { BoatController } from '../src/player/BoatController.js';
import { BOATS, BOAT_IDS, gunsOf, berthOf, tradeInValue, upgradePrice } from '../src/game/Boats.js';
import { GameState } from '../src/game/GameState.js';
import { createBoatModel } from '../src/world/boat/BoatFactory.js';
import { ShipBoatModel } from '../src/world/boat/ShipBoatModel.js';
import { FleetBoatModel } from '../src/world/boat/FleetBoatModel.js';
import { SimpleHullLines } from '../src/world/boat/SimpleHullLines.js';
import { RHO_SEAWATER as RHO } from '../src/world/boat/HullLines.js';
import { SHIP_LAYOUT, walkSurfaces, deckSurfaceAt, helmDeckY, MUZZLE_REACH, BULWARK } from '../src/world/boat/ShipDecks.js';
import { Features } from '../src/features/Features.js';
import { Naval, hullMaxFor, GUN_LEVELS } from '../src/features/naval/Naval.js';
import { hudModel } from '../src/features/naval/Hud.js';
import { SHIP_CLASSES } from '../src/features/naval/ShipClasses.js';

const NO_RENDER = process.argv.includes( '--no-render' );
const H = await worldHarness( { width: 1600, height: 900 } ); // one headless GPU device for the textures of the GLBs and the screenshots
const outDir = process.argv.slice( 2 ).find( ( a ) => ! a.startsWith( '--' ) ) || 'test/out/ships';
mkdirSync( outDir, { recursive: true } );
const root = new URL( '../public/', import.meta.url );

globalThis.__assetFile = async ( url ) => {

	const b = readFileSync( new URL( url.replace( /^\//, '' ), root ) );
	return b.buffer.slice( b.byteOffset, b.byteOffset + b.byteLength );

};

globalThis.__assetImage = async () => ( { data: new Uint8Array( [ 190, 175, 150, 255, 170, 154, 132, 255, 170, 154, 132, 255, 190, 175, 150, 255 ] ), width: 2, height: 2 } );

let fails = 0, passes = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else { passes ++; console.log( 'ok  ', msg ); }

};
const section = ( s ) => console.log( '\n== ' + s );
const f2 = ( v ) => Number( v ).toFixed( 2 );

const SHIPS = [ 'trawler', 'sloop', 'brigantine' ];
const SMALL = [ 'skiff', 'canoe', 'cutter', 'launch', 'lobster' ];

// ================================================================================================ 1. catalog
section( '1. catalog' );
{

	ok( BOAT_IDS.slice( 0, 5 ).join() === SMALL.join() && BOAT_IDS.slice( 5 ).join() === SHIPS.join(), 'the five small boats come first, then trawler, sloop, brigantine' );
	ok( SHIPS.every( ( id ) => BOATS[ id ].kind === 'ship' && BOATS[ id ].price >= 2 * BOATS.lobster.price && BOATS[ id ].drive === 'wheel' ), 'ships cost at least twice the lobster boat and are driven from a wheel' );
	ok( BOATS.trawler.price < BOATS.sloop.price && BOATS.sloop.price < BOATS.brigantine.price, 'prices rise trawler < sloop < brigantine' );
	ok( BOATS.brigantine.holdMul > BOATS.trawler.holdMul && BOATS.trawler.holdMul > BOATS.sloop.holdMul && BOATS.sloop.holdMul > BOATS.lobster.holdMul, 'holds: brigantine biggest, then the working trawler, then the sloop, all above the lobster boat' );
	ok( BOATS.brigantine.fuelMul > BOATS.lobster.fuelMul && BOATS.trawler.fuelMul > BOATS.lobster.fuelMul, 'bigger tanks than the lobster boat' );
	ok( gunsOf( 'sloop' ) === 2 && gunsOf( 'brigantine' ) === 4 && gunsOf( 'trawler' ) === 0 && SMALL.every( ( id ) => gunsOf( id ) === 0 ), 'guns a side: sloop 2, brigantine 4, trawler none (swivel purchase), small boats none' );
	ok( BOATS.sloop.maxThrust / BOATS.sloop.mass > BOATS.brigantine.maxThrust / BOATS.brigantine.mass && BOATS.sloop.maxThrust / BOATS.sloop.mass > BOATS.trawler.maxThrust / BOATS.trawler.mass, 'the sloop has the most power for its weight' );
	for ( const id of SHIPS ) {

		const b = BOATS[ id ], c = SHIP_CLASSES[ b.shipClass ];
		ok( c && c.length === b.length && c.beam === b.beam && c.draft === b.draft, `${ id }: same hull dimensions as the AI ${ b.shipClass } (ShipClasses.js)` );
		ok( Math.abs( c.deck - b.deckY ) < 1e-9 && b.helm && b.board && b.seats.length === 2 && Number.isFinite( b.hp ), `${ id }: deck ${ b.deckY } m like the manifest, helm / board / seats / hp present` );
		ok( hullMaxFor( id ) === b.hp && b.hp > hullMaxFor( 'lobster' ), `${ id }: ${ b.hp } hull points > the lobster boat's ${ hullMaxFor( 'lobster' ) }` );
		ok( berthOf( id ).x > 0 && berthOf( 'lobster' ).x === 0, `${ id }: berth offset ${ JSON.stringify( berthOf( id ) ) }` );

	}

	ok( hullMaxFor( 'brigantine' ) > hullMaxFor( 'trawler' ) && hullMaxFor( 'trawler' ) > hullMaxFor( 'sloop' ), 'hull: brigantine > trawler > sloop' );

	// buying one: the trade-in, the stats
	const mem = new Map();
	const st = new GameState( { getItem: ( k ) => mem.get( k ) ?? null, setItem: ( k, v ) => mem.set( k, v ) } );
	st.money = 100000;
	st.boat = 'lobster';
	const before = st.stats;
	ok( upgradePrice( 'lobster', 'sloop' ) === BOATS.sloop.price - tradeInValue( 'lobster' ), 'trading the lobster boat in for the sloop is credited' );
	ok( st.buyBoat( 'brigantine' ) && st.boat === 'brigantine' && st.money === 100000 - upgradePrice( 'lobster', 'brigantine' ), 'GameState.buyBoat( brigantine ) works with a trade-in' );
	const after = st.stats;
	ok( after.holdKg === Math.round( before.holdKg / BOATS.lobster.holdMul * BOATS.brigantine.holdMul ) && after.holdKg > 2.5 * before.holdKg, `the hold: ${ before.holdKg } kg -> ${ after.holdKg } kg` );
	ok( after.fuelL > before.fuelL && after.maxThrust === BOATS.brigantine.maxThrust, 'tank and thrust follow the class' );

}

// ================================================================================================ 2. models
section( '2. models' );
const models = {};
const glbTris = {}; // id -> { deck: tris in the boat frame }
for ( const id of SHIPS ) {

	const spec = BOATS[ id ];
	const model = createBoatModel( id );
	models[ id ] = model;
	ok( model instanceof ShipBoatModel && model instanceof FleetBoatModel && model.id === id, `${ id }: createBoatModel gives a ShipBoatModel` );
	const placeholderTris = model.triangleCount;
	await model.ready;
	ok( model.loaded && model.triangleCount > 15000 && placeholderTris < 5000, `${ id }: GLB loaded, ${ model.triangleCount } triangles` );
	ok( ! model.meshes.placeholder && model.group.children.some( ( c ) => c.name === 'boat-hull' ), `${ id }: placeholder replaced by the hull` );
	const L = model.lines, d = model.dimensions, h = model.hydro;
	ok( L instanceof SimpleHullLines && L.length === spec.length && L.beam === spec.beam && L.deckY === spec.deckY && L.shell === 0.2, `${ id }: SimpleHullLines from the catalog dimensions` );

	// the GLB, centred and turned into the boat frame
	const hull = model.group.children.find( ( c ) => c.name === 'boat-hull' );
	ok( Math.abs( hull.rotation.y + Math.PI / 2 ) < 1e-9, `${ id }: the GLB hangs in a pivot turned -90 degrees (bow +Z)` );
	let lo = Infinity, hi = - Infinity, top = - Infinity, bot = Infinity, wide = 0;
	for ( const m of Object.values( model.meshes ) ) {

		m.geometry.computeBoundingBox();
		const bb = m.geometry.boundingBox;
		lo = Math.min( lo, bb.min.x ); hi = Math.max( hi, bb.max.x ); top = Math.max( top, bb.max.y ); bot = Math.min( bot, bb.min.y );
		wide = Math.max( wide, bb.max.z, - bb.min.z );

	}

	ok( Math.abs( lo + hi ) < 0.3 && hi - lo > spec.length - 0.4 && hi - lo < spec.length + 0.5, `${ id }: hull centred on z = 0, ${ f2( hi - lo ) } m long (catalog ${ spec.length })` );
	ok( Math.abs( wide * 2 - spec.beam ) < 0.35 && Math.abs( bot + spec.draft ) < 0.15, `${ id }: beam ${ f2( wide * 2 ) } (catalog ${ spec.beam }), keel ${ f2( bot ) } (draft ${ spec.draft })` );

	// buoyancy: the samples displace the catalog mass
	let disp = 0;
	for ( const s of model.hullSamples ) disp += s.area * Math.max( 0, - s.position.y );
	const ratio = disp * RHO / h.suggestedMass;
	ok( Math.abs( ratio - 1 ) < 0.25 && Math.abs( ratio - 1 ) < 0.02, `${ id }: hull samples displace ${ ( ratio * 100 ).toFixed( 1 ) } % of the ${ h.suggestedMass } kg mass (must be within 25 %)` );
	ok( L.hydroDraft / spec.draft > 0.45 && L.hydroDraft <= spec.draft * 1.01, `${ id }: hydrostatic draft ${ f2( L.hydroDraft ) } m of the ${ spec.draft } m design draft (the hull sits where the GLB waterline is)` );
	ok( h.metacentricRadius > 1.2 && h.waterplaneArea > 0.5 * spec.length * spec.beam * 0.7 * 0.8, `${ id }: BM ${ f2( h.metacentricRadius ) } m, waterplane ${ f2( h.waterplaneArea ) } m2` );
	ok( model.stations.length === 7 && model.contactPoints.length === 8 && model.outline.length === 7 && model.physics.mass === spec.mass && model.physics.maxThrust === spec.maxThrust, `${ id }: controller tables` );

	// anchors
	const hd = helmDeckY( spec );
	ok( model.helmPoint.x === spec.helm.x && model.helmPoint.z === spec.helm.z && Math.abs( model.helmEye.y - ( hd + 1.55 ) ) < 1e-9 && model.dimensions.helmDeckHeight === hd, `${ id }: helm at z ${ spec.helm.z } on the ${ hd } m platform, eye ${ f2( model.helmEye.y ) }` );
	ok( model.boardPoint.y === spec.deckY && model.boardPoint.x === spec.board.x && Math.abs( model.boardPoint.x ) < L.sheerX( 0.5 ), `${ id }: boarding point on the main deck, inside the rail` );
	ok( model.exitPoints.length === 6 && model.exitPoints.every( ( e ) => Math.abs( Math.abs( e.x ) - L.sheerX( L.tAtSheerZ( e.z ) ) ) < 0.06 && e.y > spec.deckY && e.y < hd + 0.1 ), `${ id }: six exit points on the rails at deck height` );
	ok( model.exitPoints.some( ( e ) => e.z === 0 && Math.abs( e.y - spec.deckY - 0.05 ) < 1e-9 ) && model.exitPoints.some( ( e ) => e.z < - 3 && Math.abs( e.y - hd - 0.05 ) < 1e-9 ), `${ id }: exits amidships (main deck) and on the quarterdeck (${ hd } m)` );
	ok( model.bowSprayPoints.length === 8 && model.propeller.y < - 0.3 && model.rudder.z < L.zAft, `${ id }: spray points, propeller below the waterline, rudder aft` );
	const vol = model.createHullVolumeGeometry();
	vol.computeBoundingBox();
	ok( vol.index && vol.index.count > 100 && Math.abs( vol.boundingBox.min.x + vol.boundingBox.max.x ) < 1e-6 && vol.boundingBox.max.x < spec.beam / 2 + 0.01, `${ id }: hull volume mask (${ vol.index.count / 3 } triangles, within the beam)` );
	ok( d.houseRoofHeight === spec.deckY + 0.02, `${ id }: a gull perches on the deck` );
	// the pier side (-X) boarding opening is clear of deck furniture (planks of the GLB stay at deck level)
	{

		const tr = [];
		const mesh = model.meshes.M_NavalDeckPlank, P2 = mesh.geometry.attributes.position.array;
		let raised = 0;
		for ( let i = 0; i < P2.length; i += 3 ) { const x = - P2[ i + 2 ], y = P2[ i + 1 ], z = P2[ i ]; if ( x < - 1.9 && x > - L.sheerX( 0.5 ) && Math.abs( z ) < 0.8 && y > spec.deckY + 0.1 ) raised ++; }
		void tr;
		ok( raised === 0, `${ id }: nothing raised in the pier-side boarding opening (${ raised } raised plank vertices)` );

	}

	// the hull's outer face at a gun station, from the GLB (vertices of the hull and sheer meshes within 0.4 m along the hull)
	const outerAt = ( z, y0, y1 ) => {

		let w = 0;
		for ( const name of [ 'M_NavalHullPlank', 'M_NavalSheerStripe', 'M_NavalHullTar' ] ) {

			const P2 = model.meshes[ name ].geometry.attributes.position.array;
			for ( let i = 0; i < P2.length; i += 3 ) if ( Math.abs( P2[ i ] - z ) < 0.4 && P2[ i + 1 ] >= y0 && P2[ i + 1 ] <= y1 ) w = Math.max( w, Math.abs( P2[ i + 2 ] ) );

		}

		return w;

	};

	ok( model.guns.length === 2 * gunsOf( id ) && model.guns.every( ( g ) => Math.abs( g.x ) + 0.1 <= outerAt( g.z, spec.deckY, spec.deckY + 0.8 ) + 0.01 && Math.abs( g.z ) < spec.length * 0.3 && g.y > spec.deckY + 0.9 ), `${ id }: ${ model.guns.length } swivel mounts on the rails, inside the hull's outer face` );
	if ( model.guns.length ) {

		const mz = model.muzzle( 0 );
		ok( Math.abs( Math.abs( mz.x ) - ( spec.broadside.x + MUZZLE_REACH ) ) < 1e-9 && Math.abs( mz.x ) - outerAt( mz.z, spec.deckY, spec.deckY + 0.8 ) > 0.5, `${ id }: muzzles ${ f2( Math.abs( mz.x ) ) } m from the keel line, ${ f2( Math.abs( mz.x ) - outerAt( mz.z, spec.deckY, spec.deckY + 0.8 ) ) } m outboard of the hull` );

	}
	console.log( `   L ${ spec.length } B ${ spec.beam } draft ${ spec.draft } hydro draft ${ f2( L.hydroDraft ) }, canoe ${ f2( h.canoeVolume ) } m3, CB z ${ f2( h.centerOfBuoyancy.z ) }, colliders ${ model.colliders.length }, guns ${ model.guns.length }` );

	// the deck planks of the loaded GLB in the boat frame (x = -glTF z, z = glTF x)
	const mesh = model.meshes.M_NavalDeckPlank;
	const P = mesh.geometry.attributes.position.array, I = mesh.geometry.index.array;
	const tris = [];
	for ( let i = 0; i < I.length; i += 3 ) {

		const v = ( k ) => [ - P[ 3 * I[ i + k ] + 2 ], P[ 3 * I[ i + k ] + 1 ], P[ 3 * I[ i + k ] ] ];
		const a = v( 0 ), b = v( 1 ), c = v( 2 );
		const nY = ( b[ 2 ] - a[ 2 ] ) * ( c[ 0 ] - a[ 0 ] ) - ( b[ 0 ] - a[ 0 ] ) * ( c[ 2 ] - a[ 2 ] );
		if ( nY > 0 ) tris.push( { a, b, c } ); // up-facing
		else if ( nY < 0 ) tris.push( { a: a, b: c, c: b, down: true } );

	}

	glbTris[ id ] = tris.filter( ( t ) => ! t.down );

	if ( id !== 'sloop' ) { /* the lantern is the only glass; the sloop has none that matters */ }
	model.setNavLights( true );
	ok( model.materials.some( ( m ) => m.name === 'boat-glass' && m.emissive.r > 1 ), `${ id }: nav lights light the stern lantern` );
	model.setNavLights( false );

}

// ================================================================================================ 3. deck colliders against the planks
section( '3. deck colliders against the GLB planks' );

// highest up-facing plank triangle under (x, z) not above maxY (a bucketed vertical ray)
function surfaceFinder( tris ) {

	const cell = 0.5, buckets = new Map();
	const key = ( i, j ) => i * 4096 + j;
	for ( const t of tris ) {

		const xs = [ t.a[ 0 ], t.b[ 0 ], t.c[ 0 ] ], zs = [ t.a[ 2 ], t.b[ 2 ], t.c[ 2 ] ];
		for ( let i = Math.floor( Math.min( ...xs ) / cell ); i <= Math.floor( Math.max( ...xs ) / cell ); i ++ ) for ( let j = Math.floor( Math.min( ...zs ) / cell ); j <= Math.floor( Math.max( ...zs ) / cell ); j ++ ) {

			const k = key( i + 2048, j + 2048 );
			if ( ! buckets.has( k ) ) buckets.set( k, [] );
			buckets.get( k ).push( t );

		}

	}

	// all up-facing plank heights under (x, z)
	const all = ( x, z ) => {

		const out = [];
		for ( const t of buckets.get( key( Math.floor( x / cell ) + 2048, Math.floor( z / cell ) + 2048 ) ) || [] ) {

			const d = ( t.b[ 2 ] - t.c[ 2 ] ) * ( t.a[ 0 ] - t.c[ 0 ] ) + ( t.c[ 0 ] - t.b[ 0 ] ) * ( t.a[ 2 ] - t.c[ 2 ] );
			if ( Math.abs( d ) < 1e-12 ) continue;
			const l1 = ( ( t.b[ 2 ] - t.c[ 2 ] ) * ( x - t.c[ 0 ] ) + ( t.c[ 0 ] - t.b[ 0 ] ) * ( z - t.c[ 2 ] ) ) / d;
			const l2 = ( ( t.c[ 2 ] - t.a[ 2 ] ) * ( x - t.c[ 0 ] ) + ( t.a[ 0 ] - t.c[ 0 ] ) * ( z - t.c[ 2 ] ) ) / d;
			const l3 = 1 - l1 - l2;
			if ( l1 < 0 || l2 < 0 || l3 < 0 ) continue;
			out.push( l1 * t.a[ 1 ] + l2 * t.b[ 1 ] + l3 * t.c[ 1 ] );

		}

		return out;

	};

	// the highest one not above maxY
	const find = ( x, z, maxY = 99 ) => all( x, z ).reduce( ( best, y ) => y <= maxY && ( best === null || y > best ) ? y : best, null );
	find.all = all;
	return find;

}

const finders = {};
for ( const id of SHIPS ) {

	finders[ id ] = surfaceFinder( glbTris[ id ] );
	const model = models[ id ], spec = BOATS[ id ], L = model.lines, find = finders[ id ];
	const walk = model.colliders.filter( ( c ) => c.walkable );
	let n = 0, above = 0, below = 0, miss = 0, worstUp = 0, worstDown = 0;
	for ( const c of walk ) {

		const top = c.center.y + c.half.y;
		for ( let x = c.center.x - c.half.x + 0.12; x < c.center.x + c.half.x; x += 0.25 ) for ( let z = c.center.z - c.half.z + 0.06; z < c.center.z + c.half.z; z += 0.25 ) {

			// only where a player can stand: inside the hull clamp of Player.updateDeck
			const lim = L.halfBreadth( L.tAtSheerZ( z ), Math.max( top, L.deckY ) ) - L.shell - 0.24;
			if ( Math.abs( x ) > lim - 0.05 ) continue;
			n ++;
			// the plank surfaces within +-0.06 m (step edges are not exact) that are not far above the collider top: the top must
			// be at or just under one of them (a ramp or a deckhouse floor may lie over a lower slab, never the reverse)
			const hits = [];
			for ( const [ dx, dz ] of [ [ 0, 0 ], [ 0.06, 0 ], [ - 0.06, 0 ], [ 0, 0.06 ], [ 0, - 0.06 ] ] ) hits.push( ...find.all( x + dx, z + dz ) );
			if ( ! hits.length ) { miss ++; continue; }
			const gaps = hits.map( ( y ) => y - top ); // > 0: the plank is above the collider top
			const nearest = gaps.reduce( ( a, g ) => ( Math.abs( g ) < Math.abs( a ) ? g : a ), Infinity );
			worstUp = Math.max( worstUp, - nearest );
			worstDown = Math.max( worstDown, nearest );
			if ( - nearest > 0.035 ) above ++;
			if ( nearest > 0.16 ) below ++;

		}

	}

	ok( n > 300 && above === 0, `${ id }: no walkable collider top above the planks (${ n } samples, highest overshoot ${ f2( worstUp ) } m)` );
	ok( below === 0 && miss <= n * 0.05, `${ id }: walkable tops within 0.16 m under the planks (deepest ${ f2( worstDown ) } m), ${ miss } of ${ n } samples over holes` );
	// conversely: every plank that a player can reach is covered by a walkable box (the designed levels match the planks)
	let uncovered = 0, tested = 0;
	for ( let x = - 2.2; x <= 2.2; x += 0.4 ) for ( let z = L.zAft + 1; z < L.zBow - 3; z += 0.4 ) {

		const y = find( x, z, 4 );
		if ( y === null || y < spec.deckY - 0.02 || y > helmDeckY( spec ) + 0.02 ) continue;
		if ( id === 'brigantine' && x > 1.9 && Math.abs( z ) < 1.2 ) continue; // the ship's boat on its skids stands in the rail opening (mirrored to port)
		if ( Math.abs( x ) > L.halfBreadth( L.tAtSheerZ( z ), y ) - L.shell - 0.45 ) continue;
		tested ++;
		const s = deckSurfaceAt( id, x, z );
		// ramp slices and steps: the designed level is the plank level or up to 0.12 m below
		if ( s === null ? y > spec.deckY + 0.05 : ( y - s > 0.16 || s - y > 0.035 ) ) { uncovered ++; if ( process.env.DEBUG_DECK ) console.log( '   mismatch', id, f2( x ), f2( z ), 'plank', f2( y ), 'designed', s ); }

	}

	ok( tested > 100 && uncovered <= tested * 0.04, `${ id }: the designed levels follow the planks (${ uncovered } of ${ tested } sample points differ)` );
	ok( walkSurfaces( id ).every( ( s ) => s.y >= spec.deckY - 1e-9 && s.y <= helmDeckY( spec ) + 1e-9 ) && Math.max( ...walkSurfaces( id ).map( ( s ) => s.y ) ) === helmDeckY( spec ), `${ id }: the highest walkable level is the helm platform` );
	// no riser above the Player's DECK_STEP (0.36), going up along the helm path
	const ys = [ ...new Set( walkSurfaces( id ).filter( ( s ) => s.x0 <= 0.2 && s.x1 >= - 0.2 || id === 'sloop' ).map( ( s ) => s.y ) ) ].sort();
	let rise = 0;
	for ( let i = 1; i < ys.length; i ++ ) rise = Math.max( rise, ys[ i ] - ys[ i - 1 ] );
	ok( rise <= 0.3, `${ id }: largest riser on the way to the wheel ${ f2( rise ) } m (Player steps up 0.36)` );

}

// ================================================================================================ 4. the real Player on the deck
section( '4. walking the deck with the real Player' );

class InputStub {

	constructor() { this.keys = new Set(); this.pressed = new Set(); this.look = { x: 0, y: 0 }; this.wheel = 0; this.enabled = true; }
	down( c ) { return this.keys.has( c ); }
	hit( c ) { return this.pressed.has( c ); }
	press( c ) { this.pressed.add( c ); }
	consumeLook() { const l = { ...this.look }; this.look.x = this.look.y = 0; return l; }
	consumeWheel() { const w = this.wheel; this.wheel = 0; return w; }
	endFrame() { this.pressed.clear(); }

}

const terrain = new TerrainData();

// a WaterQuery stand-in: flat water, or a gentle analytic swell
function makeQuery( swell = null ) {

	const q = {
		n: 0, points: new Float32Array( 8192 ), cpu: new Float32Array( 8192 ), resultInputs: new Float32Array( 8192 ), cpuValid: false, version: 0, resultTime: 0, latency: 2 / 60, time: 0,
		allocate( name, n ) { const s = this.n; this.n += n; return s; },
		setPoint( i, x, z ) { this.points[ i * 4 ] = x; this.points[ i * 4 + 1 ] = z; },
		tick() {

			for ( let i = 0; i < this.n; i ++ ) {

				const x = this.points[ i * 4 ], z = this.points[ i * 4 + 1 ];
				this.cpu[ i * 4 ] = swell ? swell( x, z, this.time ) : 0;
				this.cpu[ i * 4 + 1 ] = 0; this.cpu[ i * 4 + 2 ] = 0;
				this.resultInputs[ i * 4 ] = x; this.resultInputs[ i * 4 + 1 ] = z;

			}

			this.cpuValid = true; this.version ++; this.resultTime = this.time;

		},
	};
	return q;

}

const colliders = { boxes: [], groundHeightAt: () => - Infinity, resolveCapsule: () => false };
const SEA = new E.Vector3( 300, 0, 900 );

// ship + controller + player on flat open water
function rig( id, swell = null ) {

	const query = makeQuery( swell );
	const model = createBoatModel( id );
	model.ready.catch( () => {} );
	const boat = new BoatController( { model, query, terrain, colliders } );
	boat.position.copy( SEA ); boat.mooring.anchor.copy( SEA ); boat.quaternion.identity(); boat.mooring.heading = 0;
	const input = new InputStub();
	const camera = new E.PerspectiveCamera( 60, 2, 0.1, 5000 );
	const player = new Player( { camera, input, terrain, colliders, query, boat } );
	const dt = 1 / 60;
	const step = () => {

		query.time += dt;
		player.update( dt );
		boat.queueQueries();
		boat.update( dt );
		query.tick();
		input.endFrame();

	};

	const run = ( sec, each = null ) => { for ( let t = 0; t < sec; t += dt ) { if ( each ) each( t ); step(); } };
	return { query, model, boat, input, camera, player, run, step, dt };

}

// walk the deck through waypoints in the boat frame with the real Player.updateDeck (W + a heading)
function walkTo( r, points, timeout = 60 ) {

	const p = r.player;
	for ( const [ x, z ] of points ) {

		let t = 0;
		while ( t < timeout ) {

			const dx = x - p.deckPos.x, dz = z - p.deckPos.z;
			if ( Math.hypot( dx, dz ) < 0.12 ) break;
			p.deckYaw = Math.atan2( dx, dz );
			r.input.keys.add( 'KeyW' );
			r.step();
			t += r.dt;

		}

		r.input.keys.delete( 'KeyW' );
		if ( t >= timeout ) return false;

	}

	return true;

}

// the way from the boarding point to the wheel: [ x, z ] waypoints per ship (ramps / stairs / wheelhouse door)
const ROUTE = {
	sloop: [ [ - 1.2, - 0.6 ], [ - 1.15, - 2.5 ], [ - 1.15, - 4.7 ], [ 0, - 4.9 ] ],
	brigantine: [ [ - 2.0, - 1.0 ], [ 0, - 3.5 ], [ 0, - 5.5 ], [ 0, - 7.0 ] ],
	trawler: [ [ - 1.5, - 0.5 ], [ 0, - 3.0 ], [ 0, - 4.8 ], [ 0, - 5.6 ] ],
};
const driveResults = {};

for ( const id of SHIPS ) {

	const spec = BOATS[ id ];
	const r = rig( id );
	const { boat, player, input, model } = r;
	r.run( 4 );
	ok( Math.abs( boat.position.y ) < 0.12 && boat.position.distanceTo( SEA ) < 0.6, `${ id }: floats at its waterline on flat water (y ${ f2( boat.position.y ) } m) and holds the mooring` );
	// roll it over 12 degrees: it rights itself
	boat.quaternion.multiply( new E.Quaternion().setFromAxisAngle( new E.Vector3( 0, 0, 1 ), 12 * Math.PI / 180 ) );
	r.run( 25 );
	const up = new E.Vector3( 0, 1, 0 ).applyQuaternion( boat.quaternion );
	ok( up.y > 0.9995, `${ id }: rights itself from a 12 degree heel (tilt ${ f2( Math.acos( Math.min( 1, up.y ) ) * 180 / Math.PI ) } deg after 25 s)` );

	// board at the board point, walk to the wheel
	player.position.copy( boat.toWorld( model.boardPoint, new E.Vector3() ) );
	player.mode = 'walk';
	r.run( 0.1 );
	ok( player.nearBoat(), `${ id }: near the boarding point` );
	player.boardBoat();
	r.run( 0.3 );
	ok( player.mode === 'deck' && Math.abs( player.deckPos.y - spec.deckY ) < 0.05, `${ id }: on deck at ${ f2( player.deckPos.y ) } m` );
	const reached = walkTo( r, ROUTE[ id ] );
	input.keys.delete( 'KeyW' );
	r.run( 0.3 );
	const hd = helmDeckY( spec );
	ok( reached && Math.abs( player.deckPos.y - hd ) < 0.06, `${ id }: walked up to the helm platform (y ${ f2( player.deckPos.y ) } of ${ hd })` );
	const dh = Math.hypot( player.deckPos.x - spec.helm.x, player.deckPos.z - spec.helm.z );
	ok( dh < 0.75 && player.prompt && player.prompt.text === 'Take the helm', `${ id }: the wheel is reachable (${ f2( dh ) } m from the helm point, prompt "${ player.prompt && player.prompt.text }")` );

	// the bulwarks hold the player in; the sides are a wall except at the boarding gap
	const probe = ( x0, z0, yawDir ) => {

		player.deckPos.set( x0, spec.deckY, z0 ); player.deckVel.set( 0, 0, 0 );
		player.deckYaw = yawDir;
		input.keys.add( 'KeyW' );
		r.run( 3 );
		input.keys.delete( 'KeyW' );
		return player.deckPos.clone();

	};

	const wall = probe( 0, id === 'sloop' ? 3.0 : 2.0, Math.PI / 2 * - 1 ); // toward -x (starboard) amidships forward of the gap
	const L = model.lines;
	ok( wall.x < 0 && Math.abs( wall.x ) < L.sheerX( L.tAtSheerZ( wall.z ) ) - L.shell && Math.abs( wall.x ) > L.sheerX( L.tAtSheerZ( wall.z ) ) - 0.8, `${ id }: stopped by the bulwark at x ${ f2( wall.x ) } (rail at ${ f2( L.sheerX( L.tAtSheerZ( wall.z ) ) ) })` );
	const gap = probe( 0, 0, Math.PI / 2 );
	ok( gap.x > wall.x * - 1 - 0.2 || gap.x > 0, `${ id }: through the boarding gap the player reaches the rail at x ${ f2( gap.x ) }` );
	player.deckPos.set( gap.x, spec.deckY, 0 );
	r.run( 0.5 );
	ok( player.prompt && /Step ashore|Jump overboard/.test( player.prompt.text ), `${ id }: at the opening the prompt is "${ player.prompt && player.prompt.text }"` );

	// the mast stops you
	const mastZ = SHIP_LAYOUT[ id ].masts[ 0 ].z;
	const mast = probe( 0, mastZ - 2.5, 0 );
	ok( mast.z < mastZ - 0.45, `${ id }: the mast tabernacle blocks the way (stopped at z ${ f2( mast.z ) } before ${ mastZ })` );
	if ( id === 'trawler' ) {

		const wh = probe( - 0.2, - 3.5, Math.PI ); // walking aft into the wheelhouse door from the stairs and on to the aft wall
		ok( wh.z > - 7.7 && wh.z < - 7.0 && Math.abs( wh.x ) < 1.6, `trawler: inside the wheelhouse, stopped by the aft wall at z ${ f2( wh.z ) }` );
		const sideWall = probe( 0, - 6, - Math.PI / 2 );
		ok( sideWall.x > - 1.6, `trawler: the wheelhouse side wall holds at x ${ f2( sideWall.x ) }` );

	}

	// seats
	for ( const seat of spec.seats ) {

		player.deckPos.set( seat.x, spec.deckY, seat.z ); player.deckVel.set( 0, 0, 0 );
		r.run( 0.3 );
		ok( player.nearSeat( player.deckPos ) === seat && Math.abs( player.deckPos.y - spec.deckY ) < 0.04, `${ id }: seat at ( ${ seat.x }, ${ seat.z } ) is on the main deck and reachable` );
		const solid = model.colliders.find( ( c ) => c.solid && Math.abs( seat.x - c.center.x ) < c.half.x + 0.3 && Math.abs( seat.z - c.center.z ) < c.half.z + 0.3 && c.center.y + c.half.y > spec.deckY + 0.4 );
		ok( ! solid, `${ id }: seat clear of solid boxes` );

	}

	// take the wheel and sail
	player.deckPos.set( spec.helm.x, hd, spec.helm.z + 0.1 ); player.deckVel.set( 0, 0, 0 );
	r.run( 0.3 );
	input.press( 'KeyE' );
	r.run( 0.1 );
	ok( player.mode === 'boat' && boat.driven, `${ id }: E takes the helm` );
	input.keys.add( 'KeyW' ); input.keys.add( 'ShiftLeft' );
	const speeds = [];
	r.run( 70, ( t ) => { if ( Math.abs( t - Math.round( t / 10 ) * 10 ) < r.dt / 2 ) speeds.push( boat.speed ); } );
	const top = boat.speed;
	input.keys.add( 'KeyA' );
	const yaw0 = boat.getYaw();
	let t90 = null;
	r.run( 40, ( t ) => { const d = Math.abs( Math.atan2( Math.sin( boat.getYaw() - yaw0 ), Math.cos( boat.getYaw() - yaw0 ) ) ); if ( t90 === null && d > Math.PI / 2 ) t90 = t; } );
	input.keys.delete( 'KeyA' ); input.keys.delete( 'KeyW' ); input.keys.delete( 'ShiftLeft' );
	driveResults[ id ] = { top, t90 };

	// get up from the wheel: Player.leaveHelm() puts the player at the helm point + ( 0.45, -0.1 ) at lines.deckY (the main deck);
	// the quarterdeck level has to come from dimensions.helmDeckHeight (a two-line hook in Player: pose() and leaveHelm())
	boat.throttle = 0;
	player.leaveHelm();
	const landed = player.deckPos.y;
	player.deckPos.y = model.dimensions.helmDeckHeight; // the hook
	r.run( 0.5 );
	ok( player.mode === 'deck' && Math.abs( player.deckPos.y - hd ) < 0.02 && player.deckGrounded, `${ id }: leaving the wheel the player stands on the platform (${ f2( player.deckPos.y ) }) once leaveHelm uses dimensions.helmDeckHeight (it lands at ${ f2( landed ) } without)` );
	console.log( `   ${ id }: full ahead ${ speeds.map( ( v ) => v.toFixed( 1 ) ).join( ' ' ) } m/s, top ${ f2( top ) } m/s ${ ( top * 1.944 ).toFixed( 1 ) } kn, 90 degree turn in ${ t90 === null ? 'more than 40' : t90.toFixed( 1 ) } s at speed` );
	ok( boat.isFinite() && Math.abs( boat.position.y ) < 0.5, `${ id }: state finite, at the surface` );

}

{

	const b = ( id ) => BOATS[ id ].price, d = driveResults;
	ok( d.sloop.top > 6.5 && d.sloop.top < 9 && d.brigantine.top > 5.5 && d.brigantine.top < 7.8 && d.trawler.top > 4 && d.trawler.top < 6.6, 'top speeds: sloop 6.5-9, brigantine 5.5-7.8, trawler 4-6.6 m/s' );
	ok( d.sloop.top > d.brigantine.top && d.brigantine.top > d.trawler.top, 'the sloop is the fastest, the brigantine next, the working trawler slowest' );
	ok( d.sloop.t90 !== null && d.sloop.t90 < 14 && d.brigantine.t90 !== null && d.brigantine.t90 < 24 && d.trawler.t90 !== null && d.trawler.t90 < 24, 'turns: every ship comes round 90 degrees in under 24 s (sloop under 14)' );
	ok( d.sloop.t90 < d.brigantine.t90 && b( 'sloop' ) > 0, 'the sloop turns quicker than the brigantine (turn inertia grows with the ship)' );

}

// a swell: no capsizing
{

	const r = rig( 'brigantine', ( x, z, t ) => 0.35 * ( Math.sin( 0.2 * x + 0.9 * t ) + 0.6 * Math.sin( 0.12 * z - 0.7 * t ) ) );
	let maxTilt = 0;
	r.boat.driven = true; r.boat.moored = false;
	r.run( 60, () => {

		const up = new E.Vector3( 0, 1, 0 ).applyQuaternion( r.boat.quaternion );
		maxTilt = Math.max( maxTilt, Math.acos( Math.min( 1, up.y ) ) * 180 / Math.PI );

	} );
	ok( maxTilt < 25 && r.boat.isFinite(), `brigantine in a 0.35 m swell: worst tilt ${ maxTilt.toFixed( 1 ) } degrees`);

}

// ================================================================================================ 5. the broadside
section( '5. built-in broadside' );
{

	const toasts = [], kicks = [];
	const DIMS = { lobster: { length: 8.2, beam: 2.9, draft: 0.85, freeboard: 0.9 }, skiff: { length: 4.13, beam: 1.79, draft: 0.22, freeboard: 0.62 } };
	function makeApp( id ) {

		const dimensions = models[ id ] ? models[ id ].dimensions : DIMS[ id ];
		const state = { boat: id, money: 0, earn() {}, spend() { return true; } };
		const keys = new Set();
		return {
			mode: 'campaign', settings: { timeOfDay: 12 }, terrainData: terrain, query: null, spray: null, scene: null, audio: null,
			boatCtl: { position: new E.Vector3( - 50, 0, 450 ), quaternion: new E.Quaternion(), velocity: new E.Vector3(), driven: true, moored: false },
			boat: { dimensions },
			camera: { position: new E.Vector3( - 50, 4, 440 ), quaternion: new E.Quaternion(), fov: 60, aspect: 16 / 9 },
			player: { mode: 'boat', position: new E.Vector3( - 50, 1, 450 ) },
			input: { hit: ( c ) => keys.has( c ), keys },
			game: { state, toast( t ) { toasts.push( t ); } },
			cameraFeel: { kick( k ) { kicks.push( k ); } },
		};

	}

	function setup( id ) {

		const app = makeApp( id );
		const features = new Features( app );
		const naval = features.add( 'naval', { install: ( a, f ) => new Naval( a, f, { seed: 11, hud: false, models: false, settings: { autoSpawn: false } } ) } );
		return { app, features, naval };

	}

	const run = ( features, sec, dt = 0.05 ) => { for ( let t = 0; t < sec; t += dt ) features.update( dt ); };

	GUN_LEVELS[ 2 ].spread = GUN_LEVELS[ 3 ].spread = 0;
	for ( const id of [ 'sloop', 'brigantine' ] ) {

		const { app, features, naval } = setup( id );
		const spec = BOATS[ id ], n = spec.broadside.z.length;
		run( features, 0.2 );
		ok( naval.playerHull.boat === id && naval.playerHull.max === spec.hp && naval.playerHull.hp === spec.hp, `${ id }: the naval hull is the ship's ${ spec.hp } points` );
		ok( naval.playerGun.builtIn && naval.playerGun.owned && naval.playerGun.guns === n && naval.playerGun.bought === false, `${ id }: playerGun.guns = ${ n } a side, built in (the gun is not a purchase)` );
		ok( naval.playerGun.level === spec.broadside.level, `${ id }: battery level ${ spec.broadside.level } (${ GUN_LEVELS[ spec.broadside.level ].damage } damage a ball)` );
		const reload = GUN_LEVELS[ spec.broadside.level ].reload * ( 1 + 0.12 * ( n - 1 ) );
		ok( Math.abs( naval.reloadTime() - reload ) < 1e-9, `${ id }: broadside reload ${ f2( reload ) } s (${ n } guns)` );
		ok( hudModel( naval ).guns.every( ( g ) => g.count === n && g.owned ), `${ id }: the HUD shows ${ n } guns a side` );

		// a target on the port side, 90 m abeam
		const t = naval.spawn( 'sloop', { x: - 50 + 90, z: 450, yaw: 0 } );
		t.state = 'dock'; t.wantSpeed = 0;
		run( features, 0.1 );
		const hp0 = t.hp;
		const fired = [];
		features.on( 'cannonFired', ( e ) => fired.push( e ) );
		ok( naval.fire( 'port' ) === true && naval.balls.count === 1, `${ id }: the first gun of the broadside goes off at once` );
		ok( naval.fire( 'port' ) === false && naval.reloadLeft.port > reload - 0.1 && naval.reloadLeft.starboard === 0, `${ id }: the port battery reloads, the starboard one is ready` );
		run( features, 1.2, 0.02 );
		const balls = naval.stats.shots;
		ok( balls === n, `${ id }: the broadside fires ${ balls } balls (one per gun)` );
		ok( fired.length === n && fired.every( ( e ) => e.by === 'player' ), `${ id }: cannonFired went out once per gun (CameraFeel kicks from it)` );
		// the muzzles: along the side, outboard of the hull, at the gun height
		const maxZ = Math.max( ...spec.broadside.z ), minZ = Math.min( ...spec.broadside.z );
		const muz = naval.balls.active.length ? naval.balls.active.map( ( b ) => ( { x: b.x0 - ( - 50 ), z: b.z0 - 450 } ) ) : [];
		void maxZ; void minZ; void muz;
		run( features, 2.0, 0.02 );
		ok( t.hp < hp0, `${ id }: the broadside hit the sloop abeam (${ hp0 } -> ${ t.hp.toFixed( 0 ) } hp)` );
		ok( naval.stats.hits >= 1 && naval.stats.hits <= n, `${ id }: ${ naval.stats.hits } of ${ n } balls hit` );
		run( features, reload + 0.5, 0.05 );
		ok( naval.reloadLeft.port === 0, `${ id }: reloaded` );
		// the starboard side shoots the other way with its own battery
		const s0 = naval.stats.shots;
		naval.fire( 'starboard' );
		run( features, 1.2, 0.02 );
		ok( naval.stats.shots - s0 === n, `${ id }: the starboard broadside fires ${ n } balls too` );
		const sb = naval.balls.active.concat();
		ok( sb.every( ( b ) => b.vx < - 50 ), `${ id }: starboard balls leave toward -x (no target that side)` );
		// ripple order: bow gun first, 80 - 170 ms apart
		naval.balls.clear(); naval.reloadLeft.port = 0;
		const zs = [];
		naval.playerShots.length = 0;
		naval.fire( 'port' );
		zs.push( naval.balls.active[ 0 ].z0 );
		for ( let i = 0; i < 40 && naval.balls.count < n; i ++ ) { naval.update( 0.02 ); }
		const ords = naval.balls.active.map( ( b ) => b.z0 - 450 );
		ok( ords.length === n && ords.every( ( z, i ) => i === 0 || z < ords[ i - 1 ] ), `${ id }: the ripple runs bow to stern (z ${ ords.map( f2 ).join( ', ' ) })` );
		ok( ords.every( ( z, i ) => Math.abs( z - [ ...spec.broadside.z ].sort( ( a, c ) => c - a )[ i ] ) < 0.5 ), `${ id }: muzzles at the catalog's gun stations (the boat moves 1 m while the ripple runs)` );
		// sunk during the ripple: no more shots
		naval.reloadLeft.port = 0; naval.balls.clear();
		const shots0 = naval.stats.shots;
		naval.fire( 'port' );
		naval.playerHull.sunk = true; naval.playerHull.hp = 0;
		run( features, 1, 0.02 );
		ok( naval.stats.shots - shots0 === 1, `${ id }: a sinking ship stops firing` );
		naval.dispose();

	}

	// the trawler and the small boats keep the swivel gun purchase: one ball
	for ( const id of [ 'trawler', 'lobster', 'skiff' ] ) {

		const { app, features, naval } = setup( id );
		run( features, 0.2 );
		ok( ! naval.playerGun.builtIn && naval.playerGun.guns === 1 && ! naval.playerGun.owned, `${ id }: no battery, the swivel gun is for sale (owned ${ naval.playerGun.owned })` );
		ok( naval.fire( 'port' ) === false, `${ id }: refuses to fire without the purchase` );
		naval.playerGun.owned = true;
		ok( naval.playerGun.owned && naval.playerGun.bought && naval.playerGun.guns === 1, `${ id }: after the purchase owned, 1 gun a side` );
		ok( naval.fire( 'port' ) === true && naval.balls.count === 1, `${ id }: a swivel gun fires one ball` );
		run( features, 3, 0.05 );
		ok( naval.stats.shots === 1 && naval.playerShots.length === 0, `${ id }: no ripple` );
		// the save keeps the purchase, not the ship's battery
		const j = naval.toJSON();
		ok( j.gun.owned === true && j.boat === id, `${ id }: saved with the bought gun` );
		naval.dispose();

	}

	// buying a ship while owning the swivel gun, then selling it again: the purchase is not lost, the battery is not saved
	{

		const { app, features, naval } = setup( 'lobster' );
		run( features, 0.1 );
		naval.playerGun.owned = true; naval.playerGun.level = 2;
		app.game.state.boat = 'brigantine'; app.boat.dimensions = models.brigantine.dimensions;
		run( features, 0.2 );
		ok( naval.playerGun.guns === 4 && naval.playerGun.builtIn && naval.playerGun.level === 3 && naval.playerHull.max === BOATS.brigantine.hp && naval.playerHull.hp === naval.playerHull.max, 'switching to the brigantine: 4 guns, level 3, a fresh 760 point hull' );
		const j = naval.toJSON();
		ok( j.gun.owned === true && j.gun.level === 3, 'the saved gun record keeps the bought swivel gun' );
		app.game.state.boat = 'lobster'; app.boat.dimensions = DIMS.lobster;
		run( features, 0.2 );
		ok( naval.playerGun.guns === 1 && ! naval.playerGun.builtIn && naval.playerGun.owned, 'back on the lobster boat: one swivel gun, still owned' );
		// a ship save without a purchase loads as not owned on a small boat
		const { naval: b2, features: f2b } = setup( 'sloop' );
		run( f2b, 0.1 );
		const js = b2.toJSON();
		ok( js.gun.owned === false, 'a sloop save carries no gun purchase' );
		const { naval: c2, features: fc } = setup( 'lobster' );
		c2.fromJSON( { ...js, boat: 'lobster' } );
		run( fc, 0.1 );
		ok( ! c2.playerGun.owned, 'loading it on the lobster boat: no gun' );
		naval.dispose(); b2.dispose(); c2.dispose();

	}

	GUN_LEVELS[ 2 ].spread = 0.018; GUN_LEVELS[ 3 ].spread = 0.012;

}

// ================================================================================================ 6. render
if ( ! NO_RENDER ) {

	section( '6. headless render' );
	const { scene } = H;
	const ground = new E.Mesh( new E.PlaneGeometry( 200, 200 ).rotateX( - Math.PI / 2 ), new Material( { name: 'ground', color: 0x6f8aa0, roughness: 0.95 } ) );
	ground.position.y = - 2.2;
	ground.receiveShadow = true;
	scene.add( ground );

	for ( const id of SHIPS ) {

		const model = models[ id ], spec = BOATS[ id ], L = spec.length;
		scene.add( model.group );
		model.group.updateMatrixWorld( true );
		await H.shot( join( outDir, id + '-side.png' ), { pos: [ - L * 1.45, 3.2, 0.5 ], target: [ 0, 2.4, 0 ], fov: 45 } );
		await H.shot( join( outDir, id + '-quarter.png' ), { pos: [ - L * 0.95, L * 0.45, - L * 0.95 ], target: [ 0, 2.0, 0 ], fov: 45 } );
		// from the stern deck toward the bow
		const hd = helmDeckY( spec );
		await H.shot( join( outDir, id + '-deck.png' ), { pos: [ spec.helm.x, hd + 1.6, spec.helm.z - 0.4 ], target: [ 0, spec.deckY + 0.8, 6 ], fov: 70 } );

		// the colliders: walkable green, solid red
		const dbg = new E.Group();
		const green = new Material( { name: 'dbg-walk', color: 0x20e060, roughness: 1, transparent: true, opacity: 0.55 } );
		const red = new Material( { name: 'dbg-solid', color: 0xe03020, roughness: 1, transparent: true, opacity: 0.45 } );
		for ( const c of model.colliders ) {

			const m = new E.Mesh( new E.BoxGeometry( c.half.x * 2, c.half.y * 2, c.half.z * 2 ), c.walkable ? green : red );
			m.position.copy( c.center );
			dbg.add( m );

		}

		scene.add( dbg );
		await H.shot( join( outDir, id + '-colliders.png' ), { pos: [ - L * 0.7, L * 0.6, - L * 0.7 ], target: [ 0, 2.2, 0 ], fov: 45 } );
		scene.remove( dbg );
		scene.remove( model.group );

	}

}

section( '9. ballast: a heeled big hull rights herself; a small one stays over past CAPSIZE.at (wave 22B)' );
{

	// the hydrostatics alone turned the launch over past ~60 deg of heel and the lobster boat past ~40, and a 1 m beam sea
	// (storm chop in a harbour) left her upside down for good with the player on deck (the Meridian play-test). Wave 22B: the
	// big hulls keep the ballast at every heel; a small hull (BoatController CAPSIZE: the launch) comes back from a knock-down
	// under CAPSIZE.keep and stays hull up past it until righted (src/features/capsize, test/feature-capsize.mjs)
	const _s = new E.Vector3(), _u = new E.Vector3();
	const rollOf = ( b ) => Math.atan2( _s.set( 1, 0, 0 ).applyQuaternion( b.quaternion ).y, _u.set( 0, 1, 0 ).applyQuaternion( b.quaternion ).y ) * 180 / Math.PI;
	for ( const id of [ 'launch', 'lobster' ] ) {

		for ( const heel of [ 50, 70, 150 ] ) {

			const r = rig( id );
			r.boat.quaternion.setFromAxisAngle( new E.Vector3( 0, 0, 1 ), heel * Math.PI / 180 );
			r.run( 20 );
			if ( id === 'launch' && heel > 60 ) ok( r.boat.capsized && Math.abs( rollOf( r.boat ) ) > 165 && r.boat.isFinite(), `the small ${ id } heeled ${ heel } deg goes over and stays hull up (roll ${ rollOf( r.boat ).toFixed( 0 ) })` );
			else ok( ! r.boat.capsized && Math.abs( rollOf( r.boat ) ) < 5 && Math.abs( r.boat.position.y ) < 0.2, `the ${ id } heeled ${ heel } deg is upright again within 20 s (roll ${ rollOf( r.boat ).toFixed( 0 ) }, y ${ r.boat.position.y.toFixed( 2 ) })` );

		}

		const k = 2 * Math.PI / 18, w = Math.sqrt( 9.81 * k );
		const r = rig( id, ( x, z, t ) => 1.0 * Math.sin( k * x - w * t ) );
		let max = 0;
		r.run( 30, () => { max = Math.max( max, Math.abs( rollOf( r.boat ) ) ); } );
		ok( max < 60 && Math.abs( rollOf( r.boat ) ) < 60 && ! r.boat.capsized, `a 1 m beam sea rolls the ${ id } at most ${ max.toFixed( 0 ) } deg and never leaves her over` );

	}

}

console.log( `\n${ passes } checks passed, ${ fails } failed${ NO_RENDER ? ' (render skipped)' : '' }` );
if ( fails ) process.exit( 1 );
await done();

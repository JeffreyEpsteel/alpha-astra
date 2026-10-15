// Test of the start feature ( src/world/start ): the new spawn and its layout fields, Jade Landing against the real
// heightmap and colliders (deck under the start, the walk from the deck down the steps and along the boardwalk to the
// boathouse path, props standing on the ground, terrain untouched), the Tidewater dress-over at the pier, the intro's
// rules and camera glide, and the feature module through the registry.
//   node test/feature-start.mjs
import './headless.mjs';
import { GPU } from '../src/engine/gpu/GPU.js';
import { Vector3, Quaternion } from '../src/engine/index.js';
import { Features } from '../src/features/Features.js';
import * as startModule from '../src/world/start/index.js';
import { Landing, landingFrame } from '../src/world/start/Landing.js';
import { Dressover } from '../src/world/start/Dressover.js';
import { Intro, introAllowed, introKey, introPose, DURATION } from '../src/world/start/Intro.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { Colliders } from '../src/world/Colliders.js';
import { Village } from '../src/world/Village.js';
import { WORLD } from '../src/world/WorldLayout.js';
import { PATHS } from '../src/world/terrain/IslandShape.js';
import { STAND } from '../src/game/FishStand.js';
import { YARD } from '../src/game/BoatYard.js';

let fails = 0, passes = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else { passes ++; console.log( 'ok  ', msg ); }

};
const section = ( s ) => console.log( '\n== ' + s );
const store = () => {

	const m = new Map();
	return { getItem: ( k ) => m.has( k ) ? m.get( k ) : null, setItem: ( k, v ) => m.set( k, String( v ) ), removeItem: ( k ) => m.delete( k ), map: m };

};

// ---------------------------------------------------------------- layout
section( 'layout' );
const S = WORLD.start, L = WORLD.landing;
ok( Math.hypot( S.position.x - 53.6, S.position.z + 77 ) > 60, `the start moved away from Tidewater's pier foot (${ S.position.x }, ${ S.position.z })` );
ok( Math.abs( ( ( S.yaw - ( L.yaw + Math.PI ) + 3 * Math.PI ) % ( 2 * Math.PI ) ) - Math.PI ) < 0.5, 'the start faces out over the bay, away from the pavilion' );
ok( WORLD.boatDock.position.x === 64.5 && WORLD.boatDock.position.z === 36.5 && WORLD.boatDock.heading === 0, 'the boat dock did not move' );
ok( WORLD.pier.x === 55 && WORLD.pier.zStart === - 64 && WORLD.pier.zEnd === 40, 'the pier did not move' );
ok( WORLD.spawn.position.x === 18 && WORLD.spawn.position.z === - 60, 'WORLD.spawn (the rocks / plants / debris keep-out) is unchanged' );
ok( STAND.x === 49.9 && STAND.z === - 74.6 && YARD.x === 90 && YARD.z === - 26, "PoorGoat's stand and Roid's yard did not move" );
const east = PATHS.find( ( p ) => p.pts[ 0 ][ 0 ] === 88 && p.pts[ 0 ][ 1 ] === - 62 );
const bwEnd = L.boardwalk[ L.boardwalk.length - 1 ];
ok( east && Math.hypot( bwEnd[ 0 ] - 88, bwEnd[ 1 ] + 62 ) < 4, 'the boardwalk ends at the boathouse footpath' );
let gap = 0;
for ( let i = 1; i < L.boardwalk.length; i ++ ) gap = Math.max( gap, Math.hypot( L.boardwalk[ i ][ 0 ] - L.boardwalk[ i - 1 ][ 0 ], L.boardwalk[ i ][ 1 ] - L.boardwalk[ i - 1 ][ 1 ] ) );
ok( gap < 16, `boardwalk waypoints are close (${ gap.toFixed( 1 ) } m max)` );
for ( const w of WORLD.ports || [] ) ok( Math.hypot( w.stand.x - L.center.x, w.stand.z - L.center.z ) > 40, `the landing keeps clear of the ${ w.id } port stand` );

// ---------------------------------------------------------------- the landing on the real terrain
section( 'Jade Landing' );
await GPU.init( { headless: true } ); // the Village builds GPU buffers
const T = new TerrainData();
const colliders = new Colliders();
const village = new Village( { scene: { add() {} }, terrain: T, colliders } );
const nBox0 = colliders.boxes.length, nCyl0 = colliders.cylinders.length;
// the heights around the landing, before
const probe = [];
for ( let x = 85; x <= 195; x += 1.7 ) for ( let z = - 90; z <= - 45; z += 1.3 ) probe.push( [ x, z ] );
const before = probe.map( ( [ x, z ] ) => T.heightAt( x, z ) );
const landing = new Landing( { terrain: T, colliders } );
const dress = new Dressover( { terrain: T, colliders, village } );
const after = probe.map( ( [ x, z ] ) => T.heightAt( x, z ) );
ok( before.every( ( h, i ) => Object.is( h, after[ i ] ) ), 'terrain heights are bit-identical after building the landing and the dress-over' );
const st = landing.stats();
console.log( '    ', st, dress.stats() );
ok( st.lights === 3 && landing.lights.every( ( l ) => l.position && l.kind === 'lantern' && l.range > 0 ), 'three lantern lights' );
ok( st.triangles < 70000, `the landing stays under 70k triangles (${ st.triangles })` );
ok( landing.group.children.length === 2, 'two draws (rigid + cloth)' );
ok( st.colliders > 60 && colliders.boxes.length + colliders.cylinders.length - nBox0 - nCyl0 === st.colliders + dress.stats().colliders, 'colliders registered' );

const top = landing.plan.deckTop;
const gS = colliders.groundHeightAt( S.position.x, S.position.z, 50 );
const startY = Math.max( gS, T.heightAt( S.position.x, S.position.z ) );
ok( gS > T.heightAt( S.position.x, S.position.z ), `the start stands on the boardwalk (${ gS.toFixed( 2 ) })` );
ok( ! colliders.resolveCapsule( new Vector3( S.position.x, startY, S.position.z ), 0.3, 1.75 ), 'the start is clear of posts and props' );
// the third-person camera at the start (Player ARM: 4.2 m back, 0.35 right, ~1.66 up) is out from under the roof
const camStart = ( () => {

	const fy = S.yaw, fwd = [ - Math.sin( fy ), - Math.cos( fy ) ], right = [ Math.cos( fy ), - Math.sin( fy ) ];
	return new Vector3( S.position.x - fwd[ 0 ] * 4.2 + right[ 0 ] * 0.35, startY + 1.66, S.position.z - fwd[ 1 ] * 4.2 + right[ 1 ] * 0.35 );

} )();
{

	const [ lx, lz ] = landingFrame().local( camStart.x, camStart.z );
	ok( Math.abs( lx ) > 4.55 + 0.5 || Math.abs( lz ) > 3.95 + 0.5, `the start camera is clear of the roof (local ${ lx.toFixed( 1 ) }, ${ lz.toFixed( 1 ) })` );
	const tt0 = landing.plan.totem, fy = S.yaw;
	const bearing = Math.atan2( - ( tt0.x - S.position.x ), - ( tt0.z - S.position.z ) );
	const off = Math.abs( ( ( bearing - fy ) + 3 * Math.PI ) % ( 2 * Math.PI ) - Math.PI );
	ok( off < 0.6, `the totem is in the first view (${ ( off * 180 / Math.PI ).toFixed( 0 ) } deg off centre)` );

}

// walk: from the start to the front of the deck, down the steps, then along the boardwalk to its end
const F = landingFrame();
const route = [ F.w( 0.6, 2.0 ), F.w( 0, 2.6 ), F.w( 0, 3.6 ), F.w( 0, 4.4 ), landing.plan.stepFoot, ...L.boardwalk ];
const pts = [];
for ( let i = 0; i < route.length - 1; i ++ ) {

	const [ ax, az ] = route[ i ], [ bx, bz ] = route[ i + 1 ];
	const n = Math.max( 1, Math.ceil( Math.hypot( bx - ax, bz - az ) / 0.25 ) );
	for ( let k = 0; k < n; k ++ ) pts.push( [ ax + ( bx - ax ) * k / n, az + ( bz - az ) * k / n ] );

}

let y = top, maxStep = 0, blocked = 0, maxDrop = 0;
for ( const [ x, z ] of pts ) {

	const ground = Math.max( T.heightAt( x, z ), colliders.groundHeightAt( x, z, y + 0.35 ) );
	maxStep = Math.max( maxStep, ground - y );
	maxDrop = Math.max( maxDrop, y - ground );
	y = ground;
	if ( colliders.resolveCapsule( new Vector3( x, y, z ), 0.3, 1.75 ) ) blocked ++;

}

ok( blocked === 0, `the walk from the deck to the boathouse path is never blocked (${ pts.length } samples)` );
ok( maxStep <= 0.35, `no step up on the way is higher than the controller's step (${ maxStep.toFixed( 2 ) } m)` );
ok( maxDrop < 0.35, `no drop on the way (steps and boardwalk ends are gentle: ${ maxDrop.toFixed( 2 ) } m)` );
const bw = landing.plan.boardwalk;
let onPlanks = 0;
for ( const [ x, z ] of L.boardwalk ) if ( colliders.groundHeightAt( x, z, 50 ) > T.heightAt( x, z ) ) onPlanks ++;
ok( onPlanks === L.boardwalk.length && bw.planks > 250, `the boardwalk is walkable along its length (${ bw.planks } planks)` );

// props stand on the ground (nothing floats, nothing is buried deeper than its footing)
const tt = landing.plan.totem;
ok( tt.base <= T.heightAt( tt.x, tt.z ) && tt.base > T.heightAt( tt.x, tt.z ) - 0.6, 'the totem plinth sits on the sand' );
ok( tt.top - tt.base > 6 && landing.plan.pearl.y > tt.top, `the totem is a landmark (${ ( tt.top - tt.base ).toFixed( 1 ) } m, the pearl on top)` );
const hm = landing.plan.hammocks.flat();
ok( hm.every( ( p ) => Math.abs( p.y - 1.72 - T.heightAt( p.x, p.z ) ) < 1e-6 ), 'hammock posts stand on the terrain' );
// clear of the harbour: PoorGoat, the pier foot, Roid's yard
ok( Math.hypot( L.center.x - STAND.x, L.center.z - STAND.z ) > 100 && Math.hypot( L.center.x - YARD.x, L.center.z - YARD.z ) > 60, 'the landing is away from the stand and the yard' );

// ---------------------------------------------------------------- dress-over
section( 'dress-over' );
const ds = dress.stats();
ok( dress.parts.includes( 'arch' ), 'the pier arch has its jade roof cap' );
ok( dress.parts.filter( ( p ) => p === 'banner' ).length === 2, 'two nobori banners by the pier steps' );
ok( dress.parts.filter( ( p ) => p === 'pennant' ).length === 3, 'pennants on the three stilt huts' );
ok( ds.triangles < 15000, `dress-over is light (${ ds.triangles } triangles)` );
const foot = village.pierInfo.stepFoot;
ok( ! colliders.resolveCapsule( new Vector3( foot.x, foot.y, foot.z - 0.4 ), 0.3, 1.75 ), 'the pier steps stay free' );
ok( ! colliders.resolveCapsule( new Vector3( 54.6, T.heightAt( 54.6, - 72 ) + 0.3, - 72 ), 0.3, 1.75 ), 'the boardwalk to the plaza stays free' );

// ---------------------------------------------------------------- intro rules and pose
section( 'intro' );
const s1 = store();
ok( introAllowed( { mode: 'campaign', slot: 0, storage: s1 } ), 'plays on a campaign start' );
ok( ! introAllowed( { mode: 'sandbox', storage: s1 } ) && ! introAllowed( { mode: 'multiplayer', storage: s1 } ), 'never in the sandbox or multiplayer' );
for ( const q of [ '?bench', '?bg', '?nomenu', '?mode=campaign&bg', '?nomenu&x=1' ] ) ok( ! introAllowed( { mode: 'campaign', search: q, storage: s1 } ), `never under ${ q }` );
ok( introAllowed( { mode: 'campaign', search: '?bgm=1', storage: s1 } ), '?bgm is not ?bg' );
s1.setItem( introKey( 'campaign', 2 ), '1' );
ok( ! introAllowed( { mode: 'campaign', slot: 2, storage: s1 } ) && introAllowed( { mode: 'campaign', slot: 1, storage: s1 } ), 'once per save slot' );
const endPos = new Vector3( 176, 3.6, - 74 ), endQuat = new Quaternion().setFromAxisAngle( new Vector3( 0, 1, 0 ), 0.4 );
const p0 = new Vector3(), q0 = new Quaternion();
introPose( 0, L.intro, endPos, endQuat, p0, q0 );
ok( p0.distanceTo( L.intro.path[ 0 ] ) < 1e-6, 'the glide starts out in the bay' );
ok( T.heightAt( L.intro.path[ 0 ].x, L.intro.path[ 0 ].z ) < - 0.3, 'the starting point is over the water' );
introPose( 1, L.intro, endPos, endQuat, p0, q0 );
ok( p0.distanceTo( endPos ) < 1e-6 && Math.abs( q0.dot( endQuat ) ) > 0.99999, "the glide ends on the player's camera" );
let minClear = Infinity;
for ( let u = 0; u <= 1; u += 0.02 ) { introPose( u, L.intro, endPos, endQuat, p0, q0 ); minClear = Math.min( minClear, p0.y - T.heightAt( p0.x, p0.z ) ); }
ok( minClear > 1, `the glide stays above the ground and the sea (${ minClear.toFixed( 1 ) } m clearance)` );

// the real glide: ends on the third-person camera at the start (Player ARM: 4.2 m back, 0.35 right, 1.66 up) and
// keeps clear of the totem and of every lantern / bunting string and what hangs from it
{

	const fy = S.yaw, fwd = [ - Math.sin( fy ), - Math.cos( fy ) ], right = [ Math.cos( fy ), - Math.sin( fy ) ];
	const camEnd = new Vector3( S.position.x - fwd[ 0 ] * 4.2 + right[ 0 ] * 0.35, startY + 1.66, S.position.z - fwd[ 1 ] * 4.2 + right[ 1 ] * 0.35 );
	const hits = [];
	const sagAt = ( st, t ) => new Vector3().lerpVectors( st.a, st.b, t ).setY( st.a.y + ( st.b.y - st.a.y ) * t - st.depth * 4 * t * ( 1 - t ) );
	for ( let u = 0; u <= 1; u += 0.005 ) {

		introPose( u, L.intro, camEnd, endQuat, p0, q0 );
		if ( Math.hypot( p0.x - tt.x, p0.z - tt.z ) < 1.6 && p0.y < landing.plan.pearl.y + 0.6 ) hits.push( `totem at ${ u.toFixed( 3 ) }` );
		if ( Math.hypot( p0.x - landing.plan.pole.x, p0.z - landing.plan.pole.z ) < 0.9 && p0.y < 5.5 ) hits.push( `lantern pole at ${ u.toFixed( 3 ) }` );
		for ( const [ i, st ] of landing.plan.strings.entries() ) {

			for ( let k = 0; k <= 40; k ++ ) {

				const c = sagAt( st, k / 40 );
				if ( Math.hypot( p0.x - c.x, p0.z - c.z ) < 0.7 && p0.y < c.y + 0.35 && p0.y > c.y - st.hang - 0.35 ) { hits.push( `string ${ i } at ${ u.toFixed( 3 ) }` ); break; }

			}

		}

	}

	// and of the pavilion: never inside a post, rail, wall or the roof
	for ( let u = 0; u <= 1; u += 0.005 ) {

		introPose( u, L.intro, camEnd, endQuat, p0, q0 );
		if ( colliders.resolveCapsule( p0.clone().add( new Vector3( 0, - 0.2, 0 ) ), 0.15, 0.4 ) ) hits.push( `a collider at ${ u.toFixed( 3 ) }` );
		const [ lx, lz ] = F.local( p0.x, p0.z );
		if ( Math.abs( lx ) < 4.6 && Math.abs( lz ) < 4.0 && p0.y > top + 2.75 - 0.25 ) hits.push( `the roof at ${ u.toFixed( 3 ) }` );

	}

	ok( hits.length === 0, `the glide passes clear of the totem, the strings and the pavilion${ hits.length ? ': ' + [ ...new Set( hits ) ].slice( 0, 6 ).join( ', ' ) : '' }` );
	let clear = Infinity;
	for ( let u = 0; u <= 0.97; u += 0.01 ) { introPose( u, L.intro, camEnd, endQuat, p0, q0 ); clear = Math.min( clear, p0.y - Math.max( T.heightAt( p0.x, p0.z ), colliders.groundHeightAt( p0.x, p0.z, p0.y ) ) ); }
	ok( clear > 1.2, `the real glide stays above the sand and the boardwalk (${ clear.toFixed( 2 ) } m)` );

}

// the controller with a stub app: holds the sea view behind the start overlay, glides, then gives the camera back
{

	globalThis.localStorage = store();
	const cam = { position: new Vector3( 1, 2, 3 ), quaternion: new Quaternion(), updateMatrixWorld() {} };
	const ui = { _start: true };
	const app = { camera: cam, input: { enabled: true, keys: new Set( [ 'KeyW' ] ) }, ui: { ui }, menuOpen: false, mode: 'campaign' };
	const intro = new Intro( app );
	ok( intro.request( { mode: 'campaign', slot: 0 } ) && intro.pending, 'requested on a first campaign start' );
	ok( ! intro.request( { mode: 'campaign', slot: 0 } ), 'not twice for the same slot' );
	const player = () => { cam.position.copy( endPos ); cam.quaternion.copy( endQuat ); }; // what Player.update does each frame
	player(); intro.update( 1 / 60 );
	ok( cam.position.distanceTo( L.intro.path[ 0 ] ) < 1e-6 && intro.pending, 'holds the sea view while the start overlay is up' );
	ui._start = false;
	player(); intro.update( 1 / 60 );
	ok( intro.active && ! app.input.enabled && app.input.keys.size === 0, 'plays once the overlay is gone; input is off' );
	let frames = 0;
	while ( intro.active && frames < 1000 ) { player(); intro.update( 1 / 60 ); frames ++; }
	ok( ! intro.active && Math.abs( frames / 60 - DURATION ) < 0.1, `lasts ${ ( frames / 60 ).toFixed( 2 ) } s` );
	player();
	ok( app.input.enabled && cam.position.distanceTo( endPos ) < 1e-6, 'input and the camera are handed back' );
	// skipping
	const intro2 = new Intro( app );
	intro2.request( { mode: 'campaign', slot: 3 } );
	player(); intro2.update( 1 / 60 ); player(); intro2.update( 1 / 60 );
	intro2.skip();
	ok( ! intro2.active && app.input.enabled, 'any key skips it' );

}

// ---------------------------------------------------------------- the module through the registry
section( 'module' );
{

	globalThis.localStorage = store();
	const added = [];
	const cam = { position: S.position.clone().add( new Vector3( 3, 3.6, - 1.5 ) ), quaternion: new Quaternion(), updateMatrixWorld() {} };
	const app = {
		qs: new URLSearchParams( '' ), scene: { add() {}, remove() {} }, terrainData: T, colliders: new Colliders(), village,
		localLights: { add: ( l ) => added.push( l ), remove: ( l ) => added.splice( added.indexOf( l ), 1 ) },
		camera: cam, input: { enabled: true, keys: new Set() }, ui: { ui: { _start: false } }, menuOpen: false,
		mode: 'campaign', session: false, game: { state: { slot: 1 } },
	};
	const features = new Features( app );
	const inst = features.add( 'start', startModule );
	for ( const l of inst.lights ) app.localLights.add( l ); // what installFeatures does
	ok( inst && inst.landing && inst.dressover && added.length === 3, 'installs with its lights' );
	features.update( 1 / 60 );
	ok( ! inst.intro.pending && ! inst.intro.active, 'no intro before a session starts' );
	app.session = true;
	features.update( 1 / 60 );
	ok( inst.intro.active || inst.intro.pending, 'a campaign session start arms the intro by itself' );
	ok( localStorage.getItem( introKey( 'campaign', 1 ) ), 'and marks the slot' );
	inst.intro.skip();
	ok( inst.playIntro( { mode: 'campaign', slot: 1, fresh: true } ), 'a New game on the slot plays it again (root hook, fresh)' );
	inst.intro.skip();
	app.mode = 'sandbox';
	ok( ! inst.playIntro( { mode: 'sandbox', slot: 0 } ), 'the root hook refuses the sandbox' );
	// a slot restored far from the landing gets no glide
	cam.position.set( 40, 3, - 80 );
	inst.intro.request( { mode: 'campaign', slot: 2 } );
	features.update( 1 / 60 );
	ok( ! inst.intro.pending && ! inst.intro.active && cam.position.x === 40, 'no glide for a save restored far from the landing' );
	const nb = app.colliders.boxes.length + app.colliders.cylinders.length;
	features.dispose();
	ok( app.colliders.boxes.length + app.colliders.cylinders.length === 0 && nb > 0 && added.length === 0, 'dispose removes its colliders and lights' );
	const off = new Features( { ...app, qs: new URLSearchParams( '?noStart' ) } ).add( 'start', startModule );
	ok( off === null, '?noStart turns it off' );

}

console.log( `\n${ passes } passed, ${ fails } failed` );
await new Promise( ( r ) => setTimeout( r, 100 ) );
process.exit( fails ? 1 : 0 );

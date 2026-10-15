// The harbour launch (wave 16A): naval's 'launch' class (features/naval/ShipClasses.js) built procedurally with GeoKit, on the
// lobster boat's recipe (a lines plan's stations -> gridSurface bands, one GeoKit bucket merged per material) as an open boat:
// a blue hull with a white boot stripe, red antifouling and a white gunwale, a teak sole and side benches, an engine box aft,
// a helm console with a turning wheel, a short mast with a lamp, fenders, a lifebuoy and "HARBOUR" on both bows. The geometry
// is built ONCE (launchParts()) and every visual shares it and the body material. No Blender, no GLB (a GLB can replace it
// later: give the class a `glb` and drop `model`).
//
//   const v = new LaunchVisual( set )      set: naval's ModelSet (scene, visuals, night) or just { scene }
//   v.apply( ship, pose ) / v.setNear( b ) / v.setVisible( b ) / v.steerWheel( ship ) / v.setLamp( k ) / v.dispose()
//       the ShipVisual surface (features/naval/Models.js), so naval draws her like a GLB ship
//   v.group                 boat frame: +Z bow, +X port, y = 0 the waterline (rotation order YXZ: yaw, pitch, roll)
//   v.wheel / v.wheelTurns  the helm wheel (spins about its axle, +Z)    v.lamp / v.lampMaterial   the mast lamp's glass
//   drawProcedural( models )   naval's ModelSet.create( kind ) hands out a LaunchVisual for a class with model 'launch'
//   launchMaterial()           the shared body material (vertex colours: GeoKit's layout), also for sideText geometry
//   launchLines() / launchParts() -> { body, wheel, glass, lines, triangles }
//   sideText( text, { side, zFore, yBase, height, depth, color, halfWidth( z, y ) } ) -> prepared geometry: block letters
//       standing off a curved side (the launch's bows, the mail Petrel's fuselage). A painted name reads from the bow aft on
//       the port side (+X) and from aft forward on the starboard side, both left to right for someone looking at it.

import { Group, Mesh, Vector3 } from '../../engine/index.js';
import { Material } from '../../engine/render/Material.js';
import { GeoKit, box, cylinder, rod, sphere, torus, gridSurface, orientTowards, prepare, mergePrepared, mat4, triangleCount } from './GeoKit.js';
import { SimpleHullLines } from './SimpleHullLines.js';
import { createPropMaterial, PAT } from '../../game/GameMaterials.js';
import { SHIP_CLASSES } from '../../features/naval/ShipClasses.js';

export const LAUNCH = SHIP_CLASSES.launch;

// paint (sRGB; GeoKit converts) and the hull's shape options (SimpleHullLines)
export const LAUNCH_PAINT = {
	hull: 0x1d4f8c, boot: 0xf2efe6, bottom: 0x7a1d15, gunwale: 0xf4f1ea, lining: 0xe6e3da, deck: 0xe2ddcf,
	teak: 0x8d6a45, engine: 0xd9d5c9, console: 0xeeebe2, dash: 0x26292c, metal: 0xc9ccd0, dark: 0x2a2c2e,
	wheel: 0x6b3f1f, fender: 0xf2f0ea, buoy: 0xe8561c, letters: 0xf4f1ea,
};
const SHAPE = { freeboard: 1.0, wlBeam: 0.84, flare: 0.62, sheerRise: 0.3, shell: 0.06 };
const T_FORE = 0.78; // the foredeck (decked over) from here to the stem; the open cockpit aft of it
const STATIONS = 44;

const V = ( x, y, z ) => new Vector3( x, y, z );
const lerp = ( a, b, t ) => a + ( b - a ) * t;

export function launchLines() {

	return new SimpleHullLines( { length: LAUNCH.length, beam: LAUNCH.beam, draft: LAUNCH.draft, deckY: LAUNCH.deck, ...SHAPE } );

}

// ------------------------------------------------------------------ block letters

// 5 x 7 capitals (rows top to bottom); anything else is a space
const FONT = {
	A: [ '.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#' ],
	B: [ '####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.' ],
	C: [ '.####', '#....', '#....', '#....', '#....', '#....', '.####' ],
	E: [ '#####', '#....', '#....', '####.', '#....', '#....', '#####' ],
	H: [ '#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#' ],
	I: [ '.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.' ],
	L: [ '#....', '#....', '#....', '#....', '#....', '#....', '#####' ],
	M: [ '#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#' ],
	N: [ '#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#' ],
	O: [ '.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.' ],
	P: [ '####.', '#...#', '#...#', '####.', '#....', '#....', '#....' ],
	R: [ '####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#' ],
	S: [ '.####', '#....', '#....', '.###.', '....#', '....#', '####.' ],
	T: [ '#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..' ],
	U: [ '#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.' ],
};

// the lit runs of a text: [ { col, n, row } ] (col from the text's start, row 0 at the top) and its width in columns
export function textRuns( text ) {

	const runs = [];
	const chars = String( text || '' ).toUpperCase().split( '' );
	chars.forEach( ( ch, i ) => {

		const g = FONT[ ch ];
		if ( ! g ) return;
		g.forEach( ( line, row ) => {

			for ( let c = 0; c < 5; ) {

				if ( line[ c ] !== '#' ) { c ++; continue; }
				let n = 1;
				while ( c + n < 5 && line[ c + n ] === '#' ) n ++;
				runs.push( { col: i * 6 + c, n, row } );
				c += n;

			}

		} );

	} );
	return { runs, cols: Math.max( 0, chars.length * 6 - 1 ) };

}

// block letters along one side: side +1 port (+X), -1 starboard; the text spans z from zFore aft; halfWidth( z, y ) is the
// side's distance from the centreline there (the letters stand `depth` off it, turned with its plan curve)
export function sideText( text, { side = 1, zFore = 0, yBase = 0, height = 0.25, depth = 0.012, color = LAUNCH_PAINT.letters, rough = 0.45, halfWidth = () => 0 } = {} ) {

	const { runs, cols } = textRuns( text );
	if ( ! runs.length ) return null;
	const p = height / 7, W = cols * p, list = [];
	for ( const r of runs ) {

		const u = ( r.col + r.n / 2 ) * p, y = yBase + ( 6 - r.row + 0.5 ) * p;
		const z = side > 0 ? zFore - u : zFore - W + u;
		const x0 = halfWidth( z, y );
		const k = ( halfWidth( z + 0.05, y ) - halfWidth( z - 0.05, y ) ) / 0.1;
		const yaw = side > 0 ? Math.PI / 2 + Math.atan( k ) : - Math.PI / 2 - Math.atan( k );
		list.push( prepare( box( r.n * p + 0.002, p + 0.002, depth ), { color, rough, matrix: mat4( side * ( x0 + depth / 2 + 0.004 ), y, z, 0, yaw, 0 ) } ) );

	}

	return mergePrepared( list );

}

// ------------------------------------------------------------------ the hull

// a band of the outer shell between y0( t ) and y1( t ), `n` rows, port side (x >= 0) or mirrored
function shellBand( L, ts, y0, y1, n, starboard ) {

	const rows = ts.map( ( t ) => {

		const z = L.sheerZ( t ), a = y0( t ), b = y1( t ), row = [];
		for ( let j = 0; j <= n; j ++ ) {

			const y = lerp( a, b, j / n );
			row.push( V( ( starboard ? - 1 : 1 ) * L.halfBreadth( t, y ), y, z ) );

		}

		return row;

	} );
	return orientTowards( gridSurface( rows ), V( starboard ? - 1 : 1, 0, 0 ) );

}

// a flat panel across the boat at z between the two sides: rows of [ port, starboard ] at each height
function across( levels, z, xAt, facing ) {

	const rows = levels.map( ( y ) => [ V( xAt( y ), y, z ), V( - xAt( y ), y, z ) ] );
	return orientTowards( gridSurface( rows ), facing );

}

// a strip along the sheer (both sides): two points per station from f( t ) -> [ [ x, y ], [ x, y ] ], facing out / up
function sheerStrip( L, ts, f, facing, starboard ) {

	const sg = starboard ? - 1 : 1;
	const rows = ts.map( ( t ) => f( t ).map( ( [ x, y ] ) => V( sg * x, y, L.sheerZ( t ) ) ) );
	return orientTowards( gridSurface( rows ), V( sg * facing.x, facing.y, facing.z ) );

}

let PARTS = null;

// the launch's geometry, built once: body (everything that does not move, merged), wheel (about its hub), glass (the lamp)
export function launchParts() {

	if ( PARTS ) return PARTS;
	const C = LAUNCH, P = LAUNCH_PAINT, L = launchLines(), kit = new GeoKit();
	const sh = SHAPE.shell, deck = C.deck;
	const ts = [];
	for ( let i = 0; i < STATIONS; i ++ ) ts.push( i / ( STATIONS - 1 ) );
	const add = ( g, color, o = {} ) => kit.add( 'body', g, { color, rough: 0.45, ...o } );
	const BOOT = 0.12;

	// outer shell: antifouling to the waterline, the white boot stripe, the blue topsides (both sides)
	for ( const sb of [ false, true ] ) {

		add( shellBand( L, ts, ( t ) => - L.draftAt( L.sheerZ( t ) ), () => 0, 4, sb ), P.bottom, { rough: 0.7 } );
		add( shellBand( L, ts, () => 0, () => BOOT, 1, sb ), P.boot, { rough: 0.3 } );
		add( shellBand( L, ts, () => BOOT, ( t ) => L.sheerY( t ), 5, sb ), P.hull, { rough: 0.32 } );

	}

	// the transom (outside), its inner face and the cap across it
	const z0 = L.zAft, sy0 = L.sheerY( 0 );
	const bandLevels = ( a, b, n ) => Array.from( { length: n + 1 }, ( _, j ) => lerp( a, b, j / n ) );
	add( across( bandLevels( 0, BOOT, 1 ), z0, ( y ) => L.halfBreadth( 0, y ), V( 0, 0, - 1 ) ), P.boot );
	add( across( bandLevels( BOOT, sy0, 4 ), z0, ( y ) => L.halfBreadth( 0, y ), V( 0, 0, - 1 ) ), P.hull, { rough: 0.32 } );
	add( across( bandLevels( deck, sy0, 3 ), z0 + sh, ( y ) => Math.max( 0.02, L.halfBreadth( 0, y ) - sh ), V( 0, 0, 1 ) ), P.lining );
	add( box( L.sheerX( 0 ) * 2 + 0.07, 0.1, 0.14 ), P.gunwale, { matrix: mat4( 0, sy0 + 0.01, z0 + 0.05 ) } );

	// the gunwale: a white cap and rubbing strake along the sheer; the lining inside the open cockpit
	const capOut = 0.035, capIn = 0.1;
	const tsOpen = ts.filter( ( t ) => t <= T_FORE ).concat( [ T_FORE ] );
	for ( const sb of [ false, true ] ) {

		add( sheerStrip( L, ts, ( t ) => [ [ L.sheerX( t ) + capOut, L.sheerY( t ) + 0.06 ], [ Math.max( 0, L.sheerX( t ) - capIn ), L.sheerY( t ) + 0.06 ] ], V( 0, 1, 0 ), sb ), P.gunwale, { rough: 0.3 } );
		add( sheerStrip( L, ts, ( t ) => [ [ L.sheerX( t ) + capOut, L.sheerY( t ) - 0.12 ], [ L.sheerX( t ) + capOut, L.sheerY( t ) + 0.06 ] ], V( 1, 0, 0 ), sb ), P.gunwale, { rough: 0.3 } );
		add( sheerStrip( L, ts, ( t ) => [ [ L.sheerX( t ), L.sheerY( t ) - 0.12 ], [ L.sheerX( t ) + capOut, L.sheerY( t ) - 0.12 ] ], V( 0, - 1, 0 ), sb ), P.gunwale );
		add( sheerStrip( L, tsOpen, ( t ) => [ [ Math.max( 0, L.sheerX( t ) - capIn ), L.sheerY( t ) - 0.05 ], [ Math.max( 0, L.sheerX( t ) - capIn ), L.sheerY( t ) + 0.06 ] ], V( - 1, 0, 0 ), sb ), P.gunwale );
		// the lining, sole to sheer
		const rows = tsOpen.map( ( t ) => bandLevels( deck, L.sheerY( t ) - 0.05, 3 ).map( ( y ) => V( ( sb ? - 1 : 1 ) * Math.max( 0.02, L.halfBreadth( t, y ) - sh ), y, L.sheerZ( t ) ) ) );
		add( orientTowards( gridSurface( rows ), V( sb ? 1 : - 1, 0, 0 ) ), P.lining );

	}

	// the sole (teak, planks fore and aft), the foredeck and the bulkhead under its edge
	const tSole = tsOpen.filter( ( t ) => L.sheerZ( t ) >= z0 + sh );
	add( orientTowards( gridSurface( tSole.map( ( t ) => { const x = Math.max( 0.02, L.halfBreadth( t, deck ) - sh ); return [ V( x, deck, L.sheerZ( t ) ), V( - x, deck, L.sheerZ( t ) ) ]; } ) ), V( 0, 1, 0 ) ), P.teak, { rough: 0.72, pattern: PAT.woodZ } );
	const tsFore = ts.filter( ( t ) => t >= T_FORE );
	if ( tsFore[ 0 ] !== T_FORE ) tsFore.unshift( T_FORE );
	add( orientTowards( gridSurface( tsFore.map( ( t ) => { const x = Math.max( 0, L.sheerX( t ) - sh ), y = L.sheerY( t ) - 0.04; return [ V( x, y, L.sheerZ( t ) ), V( - x, y, L.sheerZ( t ) ) ]; } ) ), V( 0, 1, 0 ) ), P.deck, { rough: 0.6 } );
	const zf = L.sheerZ( T_FORE );
	add( across( bandLevels( deck, L.sheerY( T_FORE ) - 0.04, 2 ), zf, ( y ) => Math.max( 0.02, L.halfBreadth( T_FORE, y ) - sh ), V( 0, 0, - 1 ) ), P.lining );

	// side benches (teak tops on white risers), a stern seat, the engine box
	const benchZ = [ - 0.9, 1.3 ], benchY = deck + 0.42;
	// (inboard of the lining where the hull is narrowest along the bench, so its forward end stays inside)
	const bx = Math.min( ...[ 0, 0.5, 1 ].map( ( f ) => L.halfBreadth( L.tAtSheerZ( lerp( benchZ[ 0 ], benchZ[ 1 ], f ) ), benchY ) ) ) - sh - 0.2;
	for ( const sg of [ 1, - 1 ] ) {

		add( box( 0.38, 0.05, benchZ[ 1 ] - benchZ[ 0 ] ), P.teak, { rough: 0.7, pattern: PAT.woodZ, matrix: mat4( sg * bx, benchY, ( benchZ[ 0 ] + benchZ[ 1 ] ) / 2 ) } );
		add( box( 0.03, 0.4, benchZ[ 1 ] - benchZ[ 0 ] - 0.1 ), P.lining, { matrix: mat4( sg * ( bx - 0.17 ), deck + 0.2, ( benchZ[ 0 ] + benchZ[ 1 ] ) / 2 ) } );

	}

	const sx = L.halfBreadth( 0.04, benchY ) - sh;
	add( box( sx * 2 - 0.04, 0.05, 0.38 ), P.teak, { rough: 0.7, pattern: PAT.woodX, matrix: mat4( 0, benchY, z0 + sh + 0.2 ) } );
	add( box( 0.9, 0.56, 0.9 ), P.engine, { rough: 0.5, matrix: mat4( 0, deck + 0.28, - 3.3 ) } );
	add( box( 0.5, 0.04, 0.3 ), P.dark, { rough: 0.6, matrix: mat4( 0, deck + 0.58, - 3.3 ) } ); // (the hatch's grille)

	// the helm console, its dash, the compass; the wheel's axle; the coxswain's footrest
	const W = C.wheel;
	add( box( 0.62, 0.95, 0.42 ), P.console, { rough: 0.4, matrix: mat4( 0, deck + 0.475, W.z + 0.3 ) } );
	add( box( 0.64, 0.05, 0.44 ), P.dash, { rough: 0.55, matrix: mat4( 0, deck + 0.97, W.z + 0.3 ) } );
	add( cylinder( 0.07, 0.08, 0.1, 12 ), P.dark, { rough: 0.3, metal: 0.4, matrix: mat4( 0, deck + 1.04, W.z + 0.38 ) } );
	add( rod( V( 0, W.y, W.z + 0.09 ), V( 0, W.y, W.z - 0.02 ), 0.018, 8 ), P.metal, { rough: 0.25, metal: 0.9 } );
	add( box( 0.5, 0.06, 0.1 ), P.teak, { pattern: PAT.woodX, matrix: mat4( 0, deck + 0.04, C.helm.z + 0.3 ) } );

	// the short mast and its lamp (housing, cap; the glass is its own mesh)
	const M = C.lamp;
	add( rod( V( 0, deck, M.z ), V( 0, M.y - 0.12, M.z ), 0.042, 10, 0.03 ), P.gunwale, { rough: 0.35 } );
	add( cylinder( 0.075, 0.075, 0.05, 12 ), P.dark, { rough: 0.4, metal: 0.5, matrix: mat4( 0, M.y - 0.105, M.z ) } );
	add( cylinder( 0.015, 0.095, 0.08, 12 ), P.dark, { rough: 0.4, metal: 0.5, matrix: mat4( 0, M.y + 0.12, M.z ) } );
	for ( let i = 0; i < 3; i ++ ) {

		const a = i / 3 * Math.PI * 2;
		add( rod( V( Math.cos( a ) * 0.07, M.y - 0.08, M.z + Math.sin( a ) * 0.07 ), V( Math.cos( a ) * 0.07, M.y + 0.09, M.z + Math.sin( a ) * 0.07 ), 0.008, 5 ), P.dark, { metal: 0.5 } );

	}

	// fenders over both sides, a lifebuoy on the console's port side
	for ( const sg of [ 1, - 1 ] ) for ( const fz of [ 0.4, - 1.1 ] ) {

		const t = L.tAtSheerZ( fz );
		add( cylinder( 0.09, 0.09, 0.42, 10 ), P.fender, { rough: 0.5, matrix: mat4( sg * ( L.sheerX( t ) + capOut + 0.1 ), L.sheerY( t ) - 0.38, fz ) } );

	}

	add( torus( 0.2, 0.045, 8, 20 ), P.buoy, { rough: 0.6, matrix: mat4( 0.33, deck + 0.55, W.z + 0.3, 0, Math.PI / 2, 0 ) } );

	// "HARBOUR" on both bows, white on the blue, above the flare
	const half = ( z, y ) => L.halfBreadth( L.tAtSheerZ( z ), y );
	for ( const side of [ 1, - 1 ] ) {

		const g = sideText( C.lettering || 'HARBOUR', { side, zFore: L.zBow - 0.8, yBase: 0.78, height: 0.22, halfWidth: half, depth: 0.012 } );
		if ( g ) kit.buckets.get( 'body' ).push( g );

	}

	const body = kit.merged( 'body' );

	// the wheel about its hub (axle along +Z): rim, six spokes with handles, the hub
	const wp = [], R = 0.27;
	wp.push( prepare( torus( R, 0.022, 6, 28 ), { color: P.wheel, rough: 0.55, pattern: PAT.wood } ) );
	for ( let i = 0; i < 6; i ++ ) {

		const a = i / 6 * Math.PI * 2, c = Math.cos( a ), s = Math.sin( a );
		wp.push( prepare( rod( V( c * 0.04, s * 0.04, 0 ), V( c * R, s * R, 0 ), 0.012, 5 ), { color: P.wheel, rough: 0.55, pattern: PAT.wood } ) );
		wp.push( prepare( rod( V( c * R, s * R, 0 ), V( c * ( R + 0.08 ), s * ( R + 0.08 ), 0 ), 0.016, 6, 0.012 ), { color: P.wheel, rough: 0.55, pattern: PAT.wood } ) );

	}

	wp.push( prepare( cylinder( 0.05, 0.05, 0.08, 12 ), { color: P.metal, rough: 0.25, metal: 0.9, matrix: mat4( 0, 0, 0, Math.PI / 2, 0, 0 ) } ) );
	const wheel = mergePrepared( wp );
	const glass = prepare( sphere( 0.085, 14, 10 ), { color: 0xfff1c4, rough: 0.15 } );
	glass.computeBoundingSphere();
	PARTS = { body, wheel, glass, lines: L, triangles: triangleCount( body ) + triangleCount( wheel ) + triangleCount( glass ) };
	return PARTS;

}

// ------------------------------------------------------------------ the visual

// the body's material (GameMaterials' prop material: vertex colour + aux), shared by every launch and the painted letters
let BODY_MAT = null;
export function launchMaterial() {

	if ( ! BODY_MAT ) {

		BODY_MAT = createPropMaterial( 'launchBody' );
		BODY_MAT.underwaterLighting = 'lite';

	}

	return BODY_MAT;

}

const LAMP_ON = [ 4.2, 3.3, 1.5 ];

export class LaunchVisual {

	constructor( set = {} ) {

		const P = launchParts(), C = LAUNCH;
		this.set = set || {};
		this.kind = 'launch';
		this.group = new Group();
		this.group.name = 'ship-launch';
		this.group.rotation.order = 'YXZ';
		const mat = launchMaterial();
		this.body = new Mesh( P.body, mat );
		this.body.name = 'launch-body';
		this.body.castShadow = true;
		this.body.receiveShadow = true;
		this.lampMaterial = new Material( { name: 'launch-lamp', color: 0xfff1c4, roughness: 0.15, emissive: [ 0, 0, 0 ], underwaterLighting: 'lite' } );
		this.lamp = new Mesh( P.glass, this.lampMaterial );
		this.lamp.name = 'launch-lamp';
		this.lamp.position.set( C.lamp.x, C.lamp.y, C.lamp.z );
		this.lamp.castShadow = false;
		const pivot = new Group();
		pivot.name = 'ship-wheel-pivot';
		pivot.position.set( C.wheel.x, C.wheel.y, C.wheel.z );
		this.wheel = new Group();
		this.wheel.name = 'ship-wheel';
		const wm = new Mesh( P.wheel, mat );
		wm.name = 'launch-wheel';
		wm.receiveShadow = true;
		this.wheel.add( wm );
		pivot.add( this.wheel );
		this.wheelTurns = 1.25;
		this.group.add( this.body, this.lamp, pivot );
		this.meshes = [ this.body, this.lamp, wm ];
		this.loaded = true;
		this.near = true;
		this.glow = - 1;
		this.group.visible = false;
		this.setLamp( 0.25 );
		if ( this.set.scene ) this.set.scene.add( this.group );

	}

	// as ShipVisual.steerWheel: a brain's steer when set, else the yaw rate over the class's turn rate (+ = port)
	steerWheel( ship ) {

		if ( ! ship ) return 0;
		const brain = Number.isFinite( ship.steer ) ? ship.steer : ship.brain && Number.isFinite( ship.brain.steer ) ? ship.brain.steer : null;
		const turn = ship.cls && ship.cls.turn > 0 ? ship.cls.turn : LAUNCH.turn;
		const s = Math.max( - 1, Math.min( 1, brain !== null ? brain : ( ship.yawRate || 0 ) / turn ) );
		this.wheel.rotation.z = - s * this.wheelTurns * Math.PI * 2;
		return s;

	}

	// the lamp's glass: 0 dark .. 1 full (by day a working lamp still shows)
	setLamp( k ) {

		k = Math.round( Math.max( 0, Math.min( 1, k ) ) * 20 ) / 20;
		if ( k === this.glow ) return;
		this.glow = k;
		this.lampMaterial.emissive = LAMP_ON.map( ( v ) => v * k );

	}

	apply( ship, pose ) {

		const g = this.group;
		g.position.set( ship.x, pose.y, ship.z );
		g.rotation.set( - ( pose.pitch || 0 ), ship.yaw, pose.roll || 0 );
		this.steerWheel( ship );
		const night = Number.isFinite( this.set.night ) ? this.set.night : 0;
		this.setLamp( Math.max( 0.25, night ) );

	}

	setNear( near ) {

		if ( near === this.near ) return;
		this.near = near;
		this.body.castShadow = near;

	}

	setVisible( v ) {

		this.group.visible = !! v;

	}

	dispose() {

		if ( this.group.parent ) this.group.parent.remove( this.group );
		else if ( this.set.scene && this.set.scene.remove ) this.set.scene.remove( this.group );
		if ( this.set.visuals && this.set.visuals.delete ) this.set.visuals.delete( this );
		this.meshes.length = 0;

	}

}

// naval's ModelSet: create( kind ) of a procedural class (cls.model 'launch', no GLB) gives a LaunchVisual (an instance patch,
// once; the GLB classes go on as before). Returns true when it patched.
export function drawProcedural( models ) {

	if ( ! models || typeof models.create !== 'function' || models.__procedural ) return false;
	const create = models.create;
	models.create = function ( kind ) {

		const cls = SHIP_CLASSES[ kind ];
		if ( cls && ! cls.glb && cls.model === 'launch' ) {

			const v = new LaunchVisual( this );
			if ( this.visuals && this.visuals.add ) this.visuals.add( v );
			return v;

		}

		return create.call( this, kind );

	};
	models.__procedural = true;
	return true;

}

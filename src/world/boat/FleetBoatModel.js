import { Box3, BoxGeometry, BufferAttribute, BufferGeometry, CylinderGeometry, Group, MathUtils, Mesh, Object3D, Vector3 } from '../../engine/index.js';
import { Material } from '../../engine/render/Material.js';
import { BOATS, boatUrl } from '../../game/Boats.js';
import { RHO_SEAWATER } from './HullLines.js';
import { SimpleHullLines } from './SimpleHullLines.js';
import { buildHullVolume } from './HullBuilder.js';
import { loadStaticGLB } from './StaticGLB.js';
import { triangleCount } from './GeoKit.js';
import { wheelGeometry } from './Wheelhouse.js';
import { WHEEL_TURNS, steerWheel, wheelGripPoints, helmStandFor } from '../BoatModel.js';

// A fleet hull (Boats.js kind 'fleet'): the GLB visual under a SimpleHullLines body, with the
// same public interface as the procedural BoatModel so BoatController / Player / BoatSpray /
// WakeSim / LocalLights / Birds can drive it unchanged:
//
//   const model = new FleetBoatModel( 'skiff' );   // synchronous: group, lines, hydro, anchors
//   await model.ready;                              // the GLB has replaced the placeholder box
//   model.group, lines, dimensions, hydro, helmEye, helmPoint, boardPoint, exitPoints, propeller,
//   rudder, bowSprayPoints, hullSamples, colliders, stations, contactPoints, outline, physics,
//   meshes (by material name once loaded), materials, setSteering / setThrottle / setPropellerRPM /
//   setNavLights, update( dt ), createHullVolumeGeometry(), triangleCount, dispose(),
//   the helm wheel as on BoatModel: wheelPivot / wheelMesh / wheelRadius / wheelGripAngle / wheelTurns, helmStand, steering,
//   wheelGrips( outL, outR ) (the hands' targets on the rim, boat frame, turning with the wheel)
//
// The fleet GLBs are single merged meshes with no wheel / tiller node, so every fleet hull gets the lobster boat's procedural
// wheel (Wheelhouse.wheelGeometry) on a pedestal HELM_WHEEL.ahead in front of the helm point; it exists from the constructor
// (setSteering turns it before the GLB is in) and moves into the hull node when the GLB arrives.
// The tiller (wave 11C): every fleet hull also has a tiller over the stern (build_fleet.py: a teak beam from the rudder head
// forward and up, the stern rudder below it), baked into the merged mesh. When the GLB is in, _mountTiller() takes a node named
// like /tiller/ if the GLB has one, else lifts the baked tiller and rudder out of the hull's triangles (every connected piece
// lying wholly inside their regions, as ShipBoatModel carves its wheel), else builds a procedural tiller; tillerPivot then
// turns about the rudder stock with setSteering (the tiller to starboard and the blade to port for a turn to port, TILLER_MAX
// at hard over). tillerPivot / tillerMesh / rudderPivot / tillerSource ('node' | 'carved' | 'procedural'), tillerAngle.
//
// Boat frame as BoatModel: +Z forward, +Y up, +X port, y = 0 the design waterline. The hull GLBs
// are authored in this frame (keel at y ~ -0.22, deck floor ~ 0.31, gunwale ~ 0.62-0.7).
//
// ShipBoatModel (the big ships, Boats.js kind 'ship') extends this class through four hooks: KINDS (the catalog
// kinds it accepts), _makeLines( spec ), _adoptGLB( glb ) (what is added to the group) and _buildColliders().

// lobster-boat (8.2 m x 2.9 m, draft 0.85) reference tables scaled to each hull
const LOBSTER = { length: 8.2, beam: 2.9, draft: 0.85 };
const STATIONS = [ [ - 3.4, 0.73 ], [ - 2.3, 0.78 ], [ - 1.2, 0.8 ], [ - 0.1, 0.77 ], [ 1.0, 0.62 ], [ 2.1, 0.33 ], [ 3.2, 0.14 ] ];
const CONTACTS = [
	[ 0, - 0.7, 3.2 ], [ 0, - 0.75, 0 ], [ 0, - 0.72, - 3.4 ],
	[ 1.1, - 0.4, 1.5 ], [ - 1.1, - 0.4, 1.5 ], [ 1.2, - 0.35, - 2.5 ], [ - 1.2, - 0.35, - 2.5 ],
	[ 0, 0.2, 4.2 ],
];
const OUTLINE = [ [ 0, 0.3, 4.1 ], [ 1.2, 0.3, 2.0 ], [ - 1.2, 0.3, 2.0 ], [ 1.4, 0.3, - 1.0 ], [ - 1.4, 0.3, - 1.0 ], [ 1.2, 0.3, - 3.8 ], [ - 1.2, 0.3, - 3.8 ] ];

// per-hull extras: solid wheelhouse box of the launch (GLB extents)
const WHEELHOUSE = { launch: { x: 0.63, y0: 0.31, y1: 1.68, z0: 1.2, z1: 1.8 } };
// the pedestal wheel of the fleet hulls: centre ahead of the helm point and above the deck (m), the face tilted back (rad)
const HELM_WHEEL = { ahead: 0.42, height: 0.92, tilt: 0.42, radius: 0.2 };
// the tiller: its swing at hard over (rad); where the baked one lies (boat frame: on the centreline over the aft 30 % of the
// hull, between the deck planks' top and 0.72 m; reach: the half width of the region), the rudder in the 0.6 m behind it
export const TILLER_MAX = 0.55;
const TILLER_REGION = { reach: 0.06, y0: 0.29, y1: 0.72, aft: 0.3, rudderY0: - 0.35, rudderY1: 0.42, rudderAft: 0.6 };
// The GLBs already have the bow at +Z: the rudder blade hangs at -Z (checked with test/world-fleet.mjs).

// Lift every connected piece of the meshes' triangles that lies wholly inside `inside( x, y, z )` (positions in the meshes'
// own frame, welded by position: flat-shaded parts split their corners) into new geometries; the meshes keep the rest in a new
// index (the parsed one is shared by every load of the file). -> { tris, parts: [ { geometry, material } ], box }
export function carvePieces( meshes, inside ) {

	const parts = [];
	const box = new Box3();
	let total = 0;
	for ( const mesh of meshes ) {

		const g = mesh.geometry, P = g.attributes.position.array, idx = g.index ? g.index.array : null;
		if ( ! idx ) continue;
		const nV = P.length / 3;
		const inV = new Uint8Array( nV );
		let any = false;
		for ( let v = 0; v < nV; v ++ ) if ( inside( P[ v * 3 ], P[ v * 3 + 1 ], P[ v * 3 + 2 ] ) ) { inV[ v ] = 1; any = true; }
		if ( ! any ) continue;
		const key = new Int32Array( nV ).fill( - 1 ), byPos = new Map();
		for ( let v = 0; v < nV; v ++ ) {

			if ( ! inV[ v ] ) continue;
			const k = Math.round( P[ v * 3 ] * 1e4 ) + ',' + Math.round( P[ v * 3 + 1 ] * 1e4 ) + ',' + Math.round( P[ v * 3 + 2 ] * 1e4 );
			let id = byPos.get( k );
			if ( id === undefined ) byPos.set( k, id = byPos.size );
			key[ v ] = id;

		}

		const up = new Int32Array( byPos.size ).map( ( _, i ) => i ), taint = new Uint8Array( byPos.size );
		const find = ( a ) => {

			while ( up[ a ] !== a ) { up[ a ] = up[ up[ a ] ]; a = up[ a ]; }
			return a;

		};
		const nT = idx.length / 3;
		for ( let t = 0; t < nT; t ++ ) {

			const a = idx[ t * 3 ], b = idx[ t * 3 + 1 ], c = idx[ t * 3 + 2 ];
			const n = inV[ a ] + inV[ b ] + inV[ c ];
			if ( n === 3 ) { up[ find( key[ b ] ) ] = find( key[ a ] ); up[ find( key[ c ] ) ] = find( key[ a ] ); } else if ( n ) {

				// a piece reaching out of the region (the hull, a plank, a thwart): not ours
				if ( inV[ a ] ) taint[ key[ a ] ] = 1;
				if ( inV[ b ] ) taint[ key[ b ] ] = 1;
				if ( inV[ c ] ) taint[ key[ c ] ] = 1;

			}

		}

		for ( let k = 0; k < taint.length; k ++ ) if ( taint[ k ] ) taint[ find( k ) ] = 1;
		const tris = [];
		for ( let t = 0; t < nT; t ++ ) {

			const a = idx[ t * 3 ];
			if ( inV[ a ] && inV[ idx[ t * 3 + 1 ] ] && inV[ idx[ t * 3 + 2 ] ] && ! taint[ find( key[ a ] ) ] ) tris.push( t );

		}

		if ( ! tris.length ) continue;
		const A = g.attributes, N = A.normal ? A.normal.array : null, U = A.uv ? A.uv.array : null;
		const n = tris.length * 3;
		const pos = new Float32Array( n * 3 ), nor = N ? new Float32Array( n * 3 ) : null, uv = U ? new Float32Array( n * 2 ) : null;
		let o = 0;
		for ( const t of tris ) for ( let j = 0; j < 3; j ++, o ++ ) {

			const v = idx[ t * 3 + j ];
			for ( let c = 0; c < 3; c ++ ) pos[ o * 3 + c ] = P[ v * 3 + c ];
			if ( nor ) for ( let c = 0; c < 3; c ++ ) nor[ o * 3 + c ] = N[ v * 3 + c ];
			if ( uv ) { uv[ o * 2 ] = U[ v * 2 ]; uv[ o * 2 + 1 ] = U[ v * 2 + 1 ]; }
			box.expandByPoint( new Vector3( P[ v * 3 ], P[ v * 3 + 1 ], P[ v * 3 + 2 ] ) );

		}

		const geo = new BufferGeometry();
		geo.setAttribute( 'position', new BufferAttribute( pos, 3 ) );
		if ( nor ) geo.setAttribute( 'normal', new BufferAttribute( nor, 3 ) );
		if ( uv ) geo.setAttribute( 'uv', new BufferAttribute( uv, 2 ) );
		const seq = n > 65535 ? new Uint32Array( n ) : new Uint16Array( n );
		for ( let i = 0; i < n; i ++ ) seq[ i ] = i;
		geo.setIndex( new BufferAttribute( seq, 1 ) );
		if ( ! nor ) geo.computeVertexNormals();
		parts.push( { geometry: geo, material: mesh.material } );
		const drop = new Uint8Array( nT );
		for ( const t of tris ) drop[ t ] = 1;
		const keep = new idx.constructor( idx.length - n );
		let k = 0;
		for ( let t = 0; t < nT; t ++ ) {

			if ( drop[ t ] ) continue;
			keep[ k ++ ] = idx[ t * 3 ]; keep[ k ++ ] = idx[ t * 3 + 1 ]; keep[ k ++ ] = idx[ t * 3 + 2 ];

		}

		g.setIndex( new BufferAttribute( keep, 1 ) );
		total += tris.length;

	}

	return { tris: total, parts, box };

}

export class FleetBoatModel {

	static KINDS = [ 'fleet' ];

	constructor( boatId ) {

		const spec = BOATS[ boatId ];
		if ( ! spec || ! new.target.KINDS.includes( spec.kind ) ) throw new Error( `${ new.target.name }: not a ${ new.target.KINDS.join( '/' ) } boat: ${ boatId }` );
		this.id = boatId;
		this.spec = spec;

		const lines = this.lines = this._makeLines( spec );
		const L = spec.length, B = spec.beam;

		this.group = new Group();
		this.group.name = 'FleetBoat:' + boatId;
		this.meshes = {};
		this.materials = [];
		this.loaded = false;

		// placeholder hull until the GLB arrives
		const ph = new Mesh( new BoxGeometry( B * 0.9, spec.freeboard + spec.draft, L * 0.92 ), new Material( { name: 'boat-placeholder', color: 0x2a2a2e, roughness: 0.9, underwaterLighting: 'lite' } ) );
		ph.name = 'boat-placeholder';
		ph.position.y = ( spec.freeboard - spec.draft ) / 2;
		ph.castShadow = ph.receiveShadow = true;
		this.group.add( ph );
		this._placeholder = ph;

		// the helm wheel (before the GLB: setSteering works from the start)
		this._helmParts = null;
		this.tillerPivot = null; // the tiller (and rudder) once the GLB is in: _mountTiller
		this.tillerMesh = null;
		this.rudderPivot = null;
		this.tillerSource = null;
		this._tillerParts = null;
		this.wheelGripAngle = Math.PI / 6;
		this.wheelTurns = WHEEL_TURNS;
		this._buildHelm( spec, lines );

		this.ready = loadStaticGLB( boatUrl( spec ) ).then( ( glb ) => {

			this._glb = glb;
			for ( const m of glb.materials ) m.underwaterLighting = 'lite';
			for ( const m of glb.meshes ) this.meshes[ m.name.replace( /^boat-/, '' ) ] = m;
			this.materials = glb.materials;
			this.group.remove( ph );
			ph.geometry.dispose && ph.geometry.dispose();
			ph.material.dispose && ph.material.dispose(); // (its own material: drawn until the GLB came, it holds a uniform buffer)
			this._placeholder = null;
			const hull = this._adoptGLB( glb );
			this.group.add( hull );
			this._mountHelm( hull );
			this._mountTiller( glb, hull );
			this.loaded = true;
			return this;

		} );

		// ---- dimensions and hydrostatics

		this.dimensions = {
			length: L,
			beam: B,
			draft: spec.draft, // design draft: keel below the waterline (GLB)
			freeboard: lines.sheerY( 0 ),
			freeboardBow: lines.sheerY( 1 ),
			deckHeight: lines.deckY,
			hullDepth: lines.draftAt( lines.centerOfFlotationZ ),
			waterlineLength: lines.wlEnd - lines.wlStart,
			waterlineBeam: 2 * lines.halfBeamAt( lines.centerOfFlotationZ ),
			houseRoofHeight: WHEELHOUSE[ boatId ] ? WHEELHOUSE[ boatId ].y1 : lines.sheerY( 0.5 ) + 0.05,
		};

		const mass = spec.mass;
		this.hydro = {
			waterplaneArea: lines.waterplaneArea,
			canoeVolume: lines.canoeVolume, // what hullSamples integrate (draft solved for the mass)
			keelVolume: 0,
			displacedVolume: lines.canoeVolume,
			suggestedMass: mass,
			massWithKeel: mass,
			centerOfBuoyancy: lines.centerOfBuoyancy.clone(),
			centerOfFlotationZ: lines.centerOfFlotationZ,
			waterlineStart: lines.wlStart,
			waterlineEnd: lines.wlEnd,
			seawaterDensity: RHO_SEAWATER,
			centerOfMass: new Vector3( 0, 0.15, lines.centerOfBuoyancy.z ),
			metacentricRadius: lines.transverseInertia / lines.canoeVolume,
		};
		const kRoll = 0.36 * B, kPitch = 0.26 * L, kYaw = 0.27 * L;
		this.hydro.inertia = new Vector3( mass * kPitch * kPitch, mass * kYaw * kYaw, mass * kRoll * kRoll );

		// ---- anchor points (boat frame)

		this.helmEye = new Vector3( spec.helm.x, 1.55, spec.helm.z ); // standing at the tiller
		this.helmPoint = { x: spec.helm.x, z: spec.helm.z };
		this.helmStand = helmStandFor( this.wheelPivot, lines.deckY ); // the feet at the wheel (Player's boat pose may use it)
		this.boardPoint = new Vector3( spec.board.x, lines.deckY, spec.board.z );

		this.exitPoints = [];
		for ( const z of [ lines.zAft + 0.6, 0, lines.zFore - 0.6 ] ) {

			const t = lines.tAtSheerZ( z );
			for ( const s of [ 1, - 1 ] ) this.exitPoints.push( new Vector3( s * ( lines.sheerX( t ) - 0.035 ), lines.sheerY( t ) + 0.05, z ) );

		}

		this.propeller = new Vector3( 0, - 0.15, lines.zAft + 0.1 );
		this.rudder = { z: lines.zAft + 0.05 };

		this.bowSprayPoints = [];
		for ( const f of [ 0.45, 0.6, 0.75, 0.9 ] ) {

			const z = lines.zBow * f;
			const hb = lines.halfBeamAt( z );
			for ( const s of [ 1, - 1 ] ) this.bowSprayPoints.push( new Vector3( s * ( hb + 0.01 ), 0.05, z ) );

		}

		this.hullSamples = lines.buildHullSamples( 8 );
		this.colliders = this._buildColliders();

		// BoatController tables, scaled from the lobster boat
		const sz = L / LOBSTER.length, sx = B / LOBSTER.beam, sy = spec.draft / LOBSTER.draft;
		this.stations = STATIONS.map( ( [ z, a ] ) => [ z * sz, a * sx * sz ] );
		this.contactPoints = CONTACTS.map( ( [ x, y, z ] ) => new Vector3( x * sx, y < 0 ? y * sy : y * 0.5, z * sz ) );
		this.outline = OUTLINE.map( ( [ x, y, z ] ) => new Vector3( x * sx, y, z * sz ) );
		this.physics = { maxThrust: spec.maxThrust, pitchSpeed: spec.pitchSpeed, reverseFactor: 0.4, mass };

		// ---- state

		this._steer = 0;
		this._throttle = 0;
		this._rpm = 0;
		this._navLights = false;
		this._time = 0;

	}

	// the lines plan of the catalog entry (SimpleHullLines; ships pass the measured shape options)
	_makeLines( spec ) {

		return new SimpleHullLines( spec );

	}

	// the node that goes into the group for a loaded GLB (ships turn it into the boat frame first)
	_adoptGLB( glb ) {

		glb.group.name = 'boat-hull';
		return glb.group;

	}

	// Closed low-poly hull volume (parabolic sections lofted along the plan, transom and lid at the
	// sheer) in the boat frame; a water-exclusion mask, not added to the group.
	createHullVolumeGeometry() {

		return buildHullVolume( this.lines );

	}

	halfBeamAt( z ) {

		return this.lines.halfBeamAt( z );

	}

	draftAt( z ) {

		return this.lines.draftAt( z );

	}

	// -1..1, positive turns to port (the wheel turns counter-clockwise as seen from the helm)
	setSteering( a ) {

		this._steer = MathUtils.clamp( a, - 1, 1 );
		steerWheel( this.wheelMesh, this._steer, this.wheelTurns );
		this._steerTiller();

	}

	// the tiller's swing about the rudder stock (rad, + = the tiller toward port): - steer * TILLER_MAX
	get tillerAngle() {

		return this.tillerPivot ? this.tillerPivot.rotation.y : 0;

	}

	_steerTiller() {

		// a turn to port (+steer) puts the tiller over to starboard (-X) and the blade's trailing edge to port: one rotation
		const r = - ( this._steer || 0 ) * TILLER_MAX;
		if ( this.tillerPivot ) this.tillerPivot.rotation.y = r;
		if ( this.rudderPivot ) this.rudderPivot.rotation.y = r;

	}

	// The GLB is in (boat frame: the fleet hulls; a subclass whose GLB hangs in its own frame has hull !== glb.group and no
	// tiller here): a node named like a tiller, else the baked tiller and rudder carved out of the hull, else a procedural one.
	_mountTiller( glb, hull ) {

		if ( hull !== glb.group ) return;
		this._tillerParts = { geos: [], mats: [] };
		let node = null;
		glb.group.traverse( ( o ) => { if ( ! node && o !== glb.group && /tiller/i.test( o.name || '' ) ) node = o; } );
		if ( node ) {

			node.updateMatrixWorld( true );
			const box = new Box3().setFromObject( node );
			// the stock at the tiller's aft end, on the centreline
			const pivot = this._tillerPivotAt( hull, ( box.min.x + box.max.x ) / 2, box.min.y, box.min.z );
			pivot.attach( node );
			this.tillerMesh = node;
			this.tillerSource = 'node';

		} else if ( this._carveTiller( glb, hull ) ) {

			this.tillerSource = 'carved';

		} else {

			this._proceduralTiller( hull );
			this.tillerSource = 'procedural';

		}

		this._steerTiller();

	}

	_tillerPivotAt( parent, x, y, z, name = 'boat-tiller-pivot' ) {

		const p = new Object3D();
		p.name = name;
		p.position.set( x, y, z );
		parent.add( p );
		if ( name === 'boat-tiller-pivot' ) this.tillerPivot = p; else this.rudderPivot = p;
		return p;

	}

	// lift the baked tiller (and the rudder blade behind it) out of the hull meshes; returns the triangles moved (0: none)
	_carveTiller( glb, hull ) {

		const T = TILLER_REGION, L = this.lines;
		const zFwd = L.zAft * T.aft; // the tiller lies aft of this (zAft < 0)
		const tiller = carvePieces( glb.meshes, ( x, y, z ) => Math.abs( x ) <= T.reach && y >= T.y0 && y <= T.y1 && z <= zFwd && z >= L.zAft - 0.3 );
		if ( ! tiller.tris ) return 0;
		const b = tiller.box;
		// a beam rising forward from the rudder head: long, thin and on the centreline
		if ( b.max.z - b.min.z < 0.3 || b.max.x - b.min.x > 2 * T.reach || b.max.y - b.min.y < 0.1 ) return 0;
		const zStock = b.min.z;
		const pivot = this._tillerPivotAt( hull, 0, b.min.y, zStock );
		this.tillerMesh = this._partsUnder( pivot, tiller.parts, 'boat-tiller' );
		// the rudder: wholly inside a thin slab on the centreline behind the tiller's head
		const rudder = carvePieces( glb.meshes, ( x, y, z ) => Math.abs( x ) <= T.reach && y >= T.rudderY0 && y <= T.rudderY1 && z < zStock - 0.02 && z >= zStock - T.rudderAft );
		if ( rudder.tris ) {

			const rp = this._tillerPivotAt( hull, 0, rudder.box.min.y, rudder.box.max.z, 'boat-rudder-pivot' );
			this._partsUnder( rp, rudder.parts, 'boat-rudder' );

		}

		return tiller.tris + rudder.tris;

	}

	// carved parts (boat-frame positions) -> meshes under pivot, positions relative to it
	_partsUnder( pivot, parts, name ) {

		const g = new Group();
		g.name = name;
		for ( const { geometry, material } of parts ) {

			geometry.translate( - pivot.position.x, - pivot.position.y, - pivot.position.z );
			geometry.computeBoundingBox();
			geometry.computeBoundingSphere();
			const m = new Mesh( geometry, material );
			m.name = name;
			m.castShadow = m.receiveShadow = true;
			g.add( m );
			this._tillerParts.geos.push( geometry );

		}

		pivot.add( g );
		return g;

	}

	// no tiller in the GLB: a teak stick from the transom forward and up (the length of the fleet's baked ones)
	_proceduralTiller( hull ) {

		const L = this.lines, deck = L.deckY;
		const pivot = this._tillerPivotAt( hull, 0, deck + 0.03, L.zAft + 0.25 );
		const len = 0.8, rise = 0.31;
		const geo = new CylinderGeometry( 0.025, 0.03, Math.hypot( len, rise ), 8 );
		const mat = new Material( { name: 'boat-tiller-wood', color: 0x8a5a36, roughness: 0.6, underwaterLighting: 'lite' } );
		const m = new Mesh( geo, mat );
		m.name = 'boat-tiller';
		m.rotation.x = Math.atan2( len, rise ); // the cylinder's +Y along the stick, forward and up
		m.position.set( 0, rise / 2, len / 2 );
		m.castShadow = m.receiveShadow = true;
		const g = new Group();
		g.name = 'boat-tiller';
		g.add( m );
		pivot.add( g );
		this.tillerMesh = g;
		this._tillerParts.geos.push( geo );
		this._tillerParts.mats.push( mat );

	}

	get steering() {

		return this._steer;

	}

	// the helmsman's hand targets on the wheel rim (boat frame), turning with the wheel
	wheelGrips( outL, outR ) {

		return wheelGripPoints( this.wheelPivot, this.wheelMesh, this.wheelRadius, this.wheelGripAngle, outL, outR );

	}

	// the procedural wheel on a pedestal in front of the helm point (a teak wheel, a brass binnacle cap)
	_buildHelm( spec, lines ) {

		const deck = lines.deckY, W = HELM_WHEEL;
		const stand = new Group();
		stand.name = 'boat-helm';
		const wood = new Material( { name: 'boat-helm-wood', color: 0x8a5a36, roughness: 0.6, underwaterLighting: 'lite' } );
		const brass = new Material( { name: 'boat-helm-brass', color: 0xb8913f, roughness: 0.35, metalness: 0.85, underwaterLighting: 'lite' } );
		const pivot = this.wheelPivot = new Object3D();
		pivot.name = 'boat-wheel-pivot';
		pivot.position.set( spec.helm.x, deck + W.height, spec.helm.z + W.ahead );
		pivot.rotation.x = W.tilt; // the axle runs forward and down into the pedestal
		const wheelGeo = wheelGeometry();
		const wheel = this.wheelMesh = new Mesh( wheelGeo, wood );
		wheel.name = 'boat-wheel';
		pivot.add( wheel );
		stand.add( pivot );
		// the pedestal from the deck up to the shaft, just ahead of the wheel
		const h = W.height - 0.07;
		const postGeo = new CylinderGeometry( 0.045, 0.065, h, 12 );
		const post = new Mesh( postGeo, wood );
		post.position.set( pivot.position.x, deck + h / 2, pivot.position.z + 0.09 );
		const capGeo = new BoxGeometry( 0.13, 0.11, 0.15 );
		const cap = new Mesh( capGeo, brass );
		cap.position.set( pivot.position.x, deck + h + 0.02, pivot.position.z + 0.08 );
		cap.rotation.x = W.tilt;
		for ( const m of [ wheel, post, cap ] ) { m.castShadow = true; m.receiveShadow = true; }
		stand.add( post, cap );
		this.group.add( stand );
		this.wheelRadius = W.radius;
		this._helm = stand;
		this._helmParts = { geos: [ wheelGeo, postGeo, capGeo ], mats: [ wood, brass ] };

	}

	// the GLB is in: the helm goes into the hull node (the fleet GLBs are in the boat frame)
	_mountHelm( hull ) {

		if ( this._helm && hull !== this.group ) hull.add( this._helm );

	}

	setThrottle( t ) {

		this._throttle = MathUtils.clamp( t, - 1, 1 );

	}

	setPropellerRPM( rpm ) {

		this._rpm = rpm;

	}

	setNavLights( on ) {

		this._navLights = !! on;

	}

	update( dt ) {

		if ( ! ( dt > 0 ) ) return;
		this._time += dt;

	}

	dispose() {

		if ( this._placeholder ) {

			this._placeholder.geometry.dispose && this._placeholder.geometry.dispose();
			this._placeholder.material.dispose && this._placeholder.material.dispose();

		}

		if ( this._glb ) this._glb.dispose();
		for ( const parts of [ this._helmParts, this._tillerParts ] ) {

			if ( ! parts ) continue;
			for ( const g of parts.geos ) g.dispose && g.dispose();
			for ( const m of parts.mats ) m.dispose && m.dispose();

		}

	}

	get triangleCount() {

		let n = 0;
		this.group.traverse( ( o ) => {

			if ( o.isMesh && o.geometry ) n += triangleCount( o.geometry );

		} );
		return n;

	}

	// Boat-frame colliders (axis-aligned boxes: { tag, center, half, walkable, solid }) for the
	// character controller: the open deck, low solid gunwales, the transom, a thwart to stand on and,
	// on the launch, the wheelhouse.
	_buildColliders() {

		const L = this.lines;
		const boxes = [];
		const V = ( x, y, z ) => new Vector3( x, y, z );
		const add = ( tag, min, max, walkable = false, solid = true ) => {

			const center = new Vector3().addVectors( min, max ).multiplyScalar( 0.5 );
			const half = new Vector3().subVectors( max, min ).multiplyScalar( 0.5 );
			boxes.push( { tag, center, half, walkable, solid } );

		};

		const inner = ( z ) => Math.max( 0.15, L.halfBreadth( L.tAtSheerZ( z ), L.deckY ) - L.shell );
		const zMid = ( L.zAft + L.zFore ) / 2;
		add( 'deck', V( - inner( zMid ), L.deckY - 0.1, L.zAft + L.shell ), V( inner( zMid ), L.deckY, L.zFore ), true, false );

		// gunwales in four segments following the sheer
		const n = 4;
		for ( let i = 0; i < n; i ++ ) {

			const z0 = L.zAft + ( L.zBow - L.zAft ) * i / n, z1 = L.zAft + ( L.zBow - L.zAft ) * ( i + 1 ) / n;
			const t0 = L.tAtSheerZ( z0 ), t1 = L.tAtSheerZ( z1 );
			const top = Math.max( L.sheerY( t0 ), L.sheerY( t1 ) ) + 0.045;
			const xo = Math.max( L.sheerX( t0 ), L.sheerX( t1 ) );
			const xi = Math.max( 0.1, Math.min( inner( z0 ), inner( z1 ) ) );
			for ( const s of [ 1, - 1 ] ) add( 'bulwark', V( Math.min( s * xi, s * xo ), L.deckY, z0 ), V( Math.max( s * xi, s * xo ), top, z1 ) );

		}

		add( 'transom', V( - L.sheerX( 0 ), L.deckY, L.zAft ), V( L.sheerX( 0 ), L.sheerY( 0 ) + 0.045, L.zAft + L.shell ) );
		// stem: a solid wedge box in front of the walkable deck
		add( 'stem', V( - inner( L.zFore ), L.deckY, L.zFore ), V( inner( L.zFore ), L.sheerY( 1 ) + 0.045, L.zBow ) );
		// a thwart (seat) across the hull, walkable
		const zt = 0.35, wt = inner( zt );
		add( 'thwart', V( - wt, L.deckY, zt - 0.12 ), V( wt, L.deckY + 0.22, zt + 0.12 ), true );

		const wh = WHEELHOUSE[ this.id ];
		if ( wh ) add( 'wheelhouse', V( - wh.x, wh.y0, wh.z0 ), V( wh.x, wh.y1, wh.z1 ) );

		return boxes;

	}

}

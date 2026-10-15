import { BoxGeometry, BufferAttribute, BufferGeometry, CylinderGeometry, Group, Mesh, Object3D, Vector3 } from '../../engine/index.js';
import { Material } from '../../engine/render/Material.js';
import { FleetBoatModel } from './FleetBoatModel.js';
import { SimpleHullLines } from './SimpleHullLines.js';
import { MODEL_YAW, centreOnHull, mirrorHull } from './ShipFrame.js';
import { shipColliders, shipExitPoints, gunMounts, helmDeckY, MUZZLE_REACH } from './ShipDecks.js';
import { wheelGeometry } from './Wheelhouse.js';
import { helmStandFor } from '../BoatModel.js';

// The player's ship (Boats.js kind 'ship': trawler, sloop, brigantine): the fork's ship GLB under a SimpleHullLines body
// (measured shape options in the catalog entry), with the same public interface as FleetBoatModel / BoatModel so
// BoatController, Player, BoatSpray, WakeSim, Birds... drive it unchanged:
//
//   const model = new ShipBoatModel( 'sloop' );     // synchronous: group, lines, hydro, anchors, colliders, guns
//   await model.ready;                               // the GLB (turned into the boat frame, centred on the hull) is in
//
// Differences from the fleet hulls:
// - the GLB is +X forward, so it hangs in a pivot turned by MODEL_YAW and shifted by centreOnHull() (ShipFrame.js); the
//   brigantine (catalog `mirror`) is mirrored so its tender is not in the pier-side boarding opening;
// - the walking surfaces, bulwarks, mast tabernacles and the trawler's wheelhouse come from ShipDecks.js
//   (main deck at spec.deckY, the quarterdeck / helm platform at spec.helmDeckY, stepped ramps and stairs);
// - helmEye stands at the platform (helmDeckY + 1.55); `dimensions.helmDeckHeight` is the same height. The deck walker
//   (Player.pose / leaveHelm) should use it instead of `lines.deckY` for the avatar at the wheel;
// - exitPoints are the rail openings (amidships), the quarterdeck and the foredeck, at the local deck height;
// - `guns`: the swivel mounts of the built-in battery ( [ { side, x, y, z } ], boat frame, none for the trawler ) with a
//   mesh each (pintle post + barrel on the rail); a muzzle sits MUZZLE_REACH outboard of the mount;
// - setNavLights( true ) lights the stern lantern (the glass material glows).
// - the wheel: the fork's ships have a spoked wheel baked into their single merged mesh (build_naval_ships.py helm_wheel:
//   rim radius 0.44 m, 8 spokes with brass ferrules, a brass hub, the centre 0.55 m forward of the helm and 1.05 m above the
//   stern deck, the axle fore and aft). _carveWheel() lifts those parts out of the hull's triangles (every connected piece
//   lying wholly inside the wheel's disc: the binnacle, its post and the chart shelf reach out of it and stay) into
//   wheelMesh, which turns about the axle; when nothing is found the procedural wheel stands in at that size.

const HANDLING = { rudderAft: 0.125, lateral: 0.5, kYaw: 0.2 };
// the baked wheel (fork manifest helm: 0.55 m forward of the helm, 1.05 m over the stern deck, radius 0.44, rim tube 0.045);
// slab / reach: the half thickness along the axle and the radius of the region a wheel piece must lie in wholly
const SHIP_WHEEL = { ahead: 0.55, height: 1.05, radius: 0.44, tube: 0.045, slab: 0.17, reach: 0.53, turns: 1.25 };

export class ShipBoatModel extends FleetBoatModel {

	static KINDS = [ 'ship' ];

	constructor( boatId ) {

		super( boatId );
		const spec = this.spec, lines = this.lines;
		const hd = helmDeckY( spec );

		this.helmEye.set( spec.helm.x, hd + 1.55, spec.helm.z );
		this.helmStand = helmStandFor( this.wheelPivot, hd );
		this.dimensions.helmDeckHeight = hd;
		this.dimensions.houseRoofHeight = spec.deckY + 0.02; // where a gull perches (Birds.js)
		this.exitPoints = shipExitPoints( spec, lines );

		// deep keel: the screw sits well under the waterline
		this.propeller.set( 0, - 0.5, lines.zAft + 0.3 );
		// Handling. BoatController's rudder is a fixed 0.12 m2 blade and its lateral stations scale with the hull, so a
		// ship scaled up from the lobster boat would barely turn (a 14 m sloop: 90 deg in 13 s). A slender hull's
		// radius of gyration is ~0.2 L (the fleet formula 0.27 L is for beamy boats), half the lateral area lets the
		// stern swing, and the blade sits a bit aft of the transom for leverage: sloop 90 deg in ~9 s at full helm and
		// speed, brigantine ~13 s (test/feature-ships.mjs bounds them).
		const L = lines.length;
		this.rudder = { z: lines.zAft - HANDLING.rudderAft * L };
		this.stations = this.stations.map( ( [ z, a ] ) => [ z, a * HANDLING.lateral ] );
		this.hydro.inertia.y = spec.mass * ( HANDLING.kYaw * L ) ** 2;
		// rigging and a loaded deck raise the centre of mass above the fleet hulls'
		this.hydro.centerOfMass.y = 0.45;

		this.guns = gunMounts( spec, lines );
		this.gunMeshes = [];
		this._glass = null;
		this._gunParts = this.guns.length ? this._buildGuns() : null;

	}

	// the wheel's pivot where the fork's builder put the wheel; its parts arrive with the GLB (_carveWheel)
	_buildHelm( spec ) {

		const W = SHIP_WHEEL;
		const pivot = this.wheelPivot = new Object3D();
		pivot.name = 'boat-wheel-pivot';
		pivot.position.set( spec.helm.x, helmDeckY( spec ) + W.height, spec.helm.z + W.ahead ); // the axle along +Z: no turn
		const wheel = this.wheelMesh = new Group();
		wheel.name = 'boat-wheel';
		pivot.add( wheel );
		this.group.add( pivot );
		this.wheelRadius = W.radius;
		this.wheelGripAngle = 0; // the spoke handles level with the hub: shoulder height for a standing helmsman
		this.wheelTurns = W.turns;
		this._helm = null;
		this._helmParts = { geos: [], mats: [] };

	}

	_mountHelm() {}

	// Lift the baked wheel out of the hull meshes (GLB frame, after mirror / centring) into wheelMesh. Returns the number of
	// triangles moved (0: nothing that is the wheel was found, the hull is untouched).
	_carveWheel( glb ) {

		const W = SHIP_WHEEL, piv = this.wheelPivot;
		// the expected centre in the GLB frame (MODEL_YAW: boat x = -glb z, boat z = glb x)
		const gx0 = piv.position.z, gy0 = piv.position.y, gz0 = - piv.position.x;
		const R2 = W.reach * W.reach;
		const found = [];
		const lo = [ Infinity, Infinity, Infinity ], hi = [ - Infinity, - Infinity, - Infinity ];
		for ( const mesh of glb.meshes ) {

			const g = mesh.geometry, P = g.attributes.position.array, idx = g.index ? g.index.array : null;
			if ( ! idx ) continue;
			const nV = P.length / 3;
			const inside = new Uint8Array( nV );
			let any = false;
			for ( let v = 0; v < nV; v ++ ) {

				const dx = P[ v * 3 ] - gx0, dy = P[ v * 3 + 1 ] - gy0, dz = P[ v * 3 + 2 ] - gz0;
				if ( Math.abs( dx ) <= W.slab && dy * dy + dz * dz <= R2 ) { inside[ v ] = 1; any = true; }

			}

			if ( ! any ) continue;
			// weld the inside vertices by position (flat-shaded parts split their corners), then join them through triangles
			const key = new Int32Array( nV ).fill( - 1 ), byPos = new Map();
			for ( let v = 0; v < nV; v ++ ) {

				if ( ! inside[ v ] ) continue;
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
				const n = inside[ a ] + inside[ b ] + inside[ c ];
				if ( n === 3 ) {

					up[ find( key[ b ] ) ] = find( key[ a ] );
					up[ find( key[ c ] ) ] = find( key[ a ] );

				} else if ( n ) {

					// a piece reaching out of the disc (the binnacle, a rail): not the wheel
					if ( inside[ a ] ) taint[ key[ a ] ] = 1;
					if ( inside[ b ] ) taint[ key[ b ] ] = 1;
					if ( inside[ c ] ) taint[ key[ c ] ] = 1;

				}

			}

			for ( let k = 0; k < taint.length; k ++ ) if ( taint[ k ] ) taint[ find( k ) ] = 1;
			const tris = [];
			for ( let t = 0; t < nT; t ++ ) {

				const a = idx[ t * 3 ];
				if ( inside[ a ] && inside[ idx[ t * 3 + 1 ] ] && inside[ idx[ t * 3 + 2 ] ] && ! taint[ find( key[ a ] ) ] ) tris.push( t );

			}

			if ( ! tris.length ) continue;
			for ( const t of tris ) for ( let j = 0; j < 3; j ++ ) {

				const v = idx[ t * 3 + j ];
				for ( let c = 0; c < 3; c ++ ) {

					lo[ c ] = Math.min( lo[ c ], P[ v * 3 + c ] );
					hi[ c ] = Math.max( hi[ c ], P[ v * 3 + c ] );

				}

			}

			found.push( { mesh, tris } );

		}

		if ( ! found.length ) return 0;
		// the wheel as found: the centre of its bounds, the rim radius from the disc's extent less the rim tube
		const c = [ ( lo[ 0 ] + hi[ 0 ] ) / 2, ( lo[ 1 ] + hi[ 1 ] ) / 2, ( lo[ 2 ] + hi[ 2 ] ) / 2 ];
		const radius = Math.max( hi[ 1 ] - lo[ 1 ], hi[ 2 ] - lo[ 2 ] ) / 2 - W.tube;
		if ( ! ( radius > 0.25 && radius < 0.6 ) || Math.hypot( c[ 0 ] - gx0, c[ 1 ] - gy0, c[ 2 ] - gz0 ) > 0.15 ) return 0;
		piv.position.set( - c[ 2 ], c[ 1 ], c[ 0 ] );
		let moved = 0;
		for ( const { mesh, tris } of found ) {

			const g = mesh.geometry, idx = g.index.array, A = g.attributes;
			const P = A.position.array, N = A.normal ? A.normal.array : null, U = A.uv ? A.uv.array : null;
			const n = tris.length * 3;
			const pos = new Float32Array( n * 3 ), nor = N ? new Float32Array( n * 3 ) : null, uv = U ? new Float32Array( n * 2 ) : null;
			let o = 0;
			for ( const t of tris ) for ( let j = 0; j < 3; j ++, o ++ ) {

				const v = idx[ t * 3 + j ];
				// the GLB frame about the centre -> the pivot frame (the boat frame's axes): ( -z, y, x )
				pos[ o * 3 ] = c[ 2 ] - P[ v * 3 + 2 ]; pos[ o * 3 + 1 ] = P[ v * 3 + 1 ] - c[ 1 ]; pos[ o * 3 + 2 ] = P[ v * 3 ] - c[ 0 ];
				if ( nor ) { nor[ o * 3 ] = - N[ v * 3 + 2 ]; nor[ o * 3 + 1 ] = N[ v * 3 + 1 ]; nor[ o * 3 + 2 ] = N[ v * 3 ]; }
				if ( uv ) { uv[ o * 2 ] = U[ v * 2 ]; uv[ o * 2 + 1 ] = U[ v * 2 + 1 ]; }

			}

			const geo = new BufferGeometry();
			geo.setAttribute( 'position', new BufferAttribute( pos, 3 ) );
			if ( nor ) geo.setAttribute( 'normal', new BufferAttribute( nor, 3 ) );
			if ( uv ) geo.setAttribute( 'uv', new BufferAttribute( uv, 2 ) );
			const seq = n > 65535 ? new Uint32Array( n ) : new Uint16Array( n );
			for ( let i = 0; i < n; i ++ ) seq[ i ] = i;
			geo.setIndex( new BufferAttribute( seq, 1 ) );
			if ( ! nor ) geo.computeVertexNormals();
			geo.computeBoundingBox();
			geo.computeBoundingSphere();
			const part = new Mesh( geo, mesh.material );
			part.name = 'boat-wheel';
			part.castShadow = true;
			part.receiveShadow = true;
			this.wheelMesh.add( part );
			this._helmParts.geos.push( geo );
			// the hull keeps the rest, in a new index (the parsed one is shared by every load of the file)
			const drop = new Uint8Array( idx.length / 3 );
			for ( const t of tris ) drop[ t ] = 1;
			const keep = new idx.constructor( idx.length - n );
			let k = 0;
			for ( let t = 0; t < drop.length; t ++ ) {

				if ( drop[ t ] ) continue;
				keep[ k ++ ] = idx[ t * 3 ]; keep[ k ++ ] = idx[ t * 3 + 1 ]; keep[ k ++ ] = idx[ t * 3 + 2 ];

			}

			g.setIndex( new BufferAttribute( keep, 1 ) );
			moved += tris.length;

		}

		this.wheelRadius = radius;
		if ( this.helmStand ) helmStandFor( piv, helmDeckY( this.spec ), this.helmStand );
		return moved;

	}

	// no baked wheel found: the lobster boat's wheel scaled up to the ship's size
	_standInWheel() {

		const geo = wheelGeometry();
		const mat = new Material( { name: 'boat-helm-wood', color: 0x6b4428, roughness: 0.7, underwaterLighting: 'lite' } );
		const m = new Mesh( geo, mat );
		m.name = 'boat-wheel';
		m.scale.setScalar( SHIP_WHEEL.radius / 0.2 );
		m.castShadow = m.receiveShadow = true;
		this.wheelMesh.add( m );
		this._helmParts.geos.push( geo );
		this._helmParts.mats.push( mat );

	}

	_makeLines( spec ) {

		return new SimpleHullLines( { ...spec, ...spec.hull } );

	}

	// the GLB turned into the boat frame (+Z forward), centred on the hull
	_adoptGLB( glb ) {

		if ( this.spec.mirror ) mirrorHull( glb );
		centreOnHull( glb );
		this.wheelTriangles = this._carveWheel( glb );
		if ( ! this.wheelTriangles ) this._standInWheel();
		const pivot = new Group();
		pivot.name = 'boat-hull';
		pivot.rotation.y = MODEL_YAW;
		pivot.add( glb.group );
		this._glass = glb.materials.find( ( m ) => m.name === 'boat-glass' ) || null;
		this._applyLantern();
		return pivot;

	}

	_buildColliders() {

		return shipColliders( this.spec, this.lines );

	}

	setNavLights( on ) {

		super.setNavLights( on );
		this._applyLantern();

	}

	_applyLantern() {

		if ( this._glass ) this._glass.emissive = this._navLights ? [ 4, 2.6, 0.9 ] : [ 0, 0, 0 ];

	}

	// swivel guns on the rails: an iron barrel on a timber pintle post, muzzle outboard
	_buildGuns() {

		const iron = new Material( { name: 'ship-gun-iron', color: 0x2b2c2f, roughness: 0.5, metalness: 0.65, underwaterLighting: 'lite' } );
		const wood = new Material( { name: 'ship-gun-wood', color: 0x5b3e27, roughness: 0.85, underwaterLighting: 'lite' } );
		const barrels = { port: new CylinderGeometry( 0.11, 0.17, 1.45, 12 ).rotateZ( - Math.PI / 2 ), starboard: new CylinderGeometry( 0.11, 0.17, 1.45, 12 ).rotateZ( Math.PI / 2 ) }; // thin end = the muzzle, outboard
		const post = new BoxGeometry( 0.2, 1, 0.2 );
		const block = new BoxGeometry( 0.7, 0.14, 0.5 );
		const deckY = this.spec.deckY;
		const group = new Group();
		group.name = 'ship-guns';
		for ( const g of this.guns ) {

			const sg = g.side === 'port' ? 1 : - 1;
			const root = new Group();
			root.position.set( g.x, 0, g.z );
			const b = new Mesh( barrels[ g.side ], iron );
			b.position.set( sg * 0.225, g.y, 0 ); // pintle 0.5 m from the breech, muzzle MUZZLE_REACH out
			const h = g.y - deckY - 0.1;
			const p = new Mesh( post, wood );
			p.scale.y = h;
			p.position.set( 0, deckY + h / 2, 0 );
			const k = new Mesh( block, wood );
			k.position.set( 0, g.y - 0.19, 0 );
			for ( const m of [ b, p, k ] ) { m.castShadow = true; m.receiveShadow = true; root.add( m ); }
			b.name = 'boat-gun-barrel';
			group.add( root );
			this.gunMeshes.push( root );

		}

		this.group.add( group );
		return { geos: [ barrels.port, barrels.starboard, post, block ], mats: [ iron, wood ], group };

	}

	// muzzle position of gun `index` in the boat frame
	muzzle( index ) {

		const g = this.guns[ index ];
		return g ? new Vector3( g.x + ( g.side === 'port' ? 1 : - 1 ) * MUZZLE_REACH, g.y, g.z ) : null;

	}

	dispose() {

		super.dispose();
		if ( this._gunParts ) {

			for ( const g of this._gunParts.geos ) g.dispose && g.dispose();
			for ( const m of this._gunParts.mats ) m.dispose && m.dispose();

		}

	}

}

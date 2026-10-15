import { BufferAttribute, BufferGeometry, Matrix3, Matrix4, Quaternion, Vector3 } from '../../engine/index.js';
import { prepare, mergePrepared, cylinder, box, torus, sphere, mat4, triangleCount } from '../../world/boat/GeoKit.js';
import { PAT } from '../../game/GameMaterials.js';

// The weapons' meshes (wave 18D). Every weapon has two sources of geometry in the game's prop layout (GeoKit: position, normal,
// uv, colour, aux = roughness / metalness / pattern, drawn with GameMaterials.createPropMaterial: one draw a weapon, no
// texture memory):
//   1. a procedural stand-in from GeoKit primitives (buildGeometry( id )): always there, headless too, and what shows until
//   2. the Blender model (public/models/weapons/<id>.glb, tools/weapons/build_weapons.py, <= 2.5k triangles) loads; its
//      primitives are converted by material name (MATS: Wood, DarkWood, Steel, Bright, Brass, Iron, Rope, Leather, Glass,
//      Cloth, Clay, Wick, Black) into the same layout (glbGeometry( gltf )).
//
// Frames (the GLBs are exported in the same frame): guns: origin at the grip, +Z the muzzle, +Y up (the lock on top); melee:
// origin where the hand closes, +Z along the blade / shaft to the tip, +Y the back of the blade (the edge faces -Y); throwables:
// origin at the centre. In the hand they hang off the avatar's weapon_r socket like the rod (WeaponMesh / HandProps).
//
//   const bank = new ModelBank( { base } );   bank.geometry( id ) -> BufferGeometry (procedural now; the GLB when loaded)
//   bank.load( id, onReady( geometry ) )      fetch the GLB once (null on a failure: the stand-in stays)
//   buildGeometry( id )  glbGeometry( gltf )  MATS  IDS  modelTriangles( id )

export const MATS = {
	Wood: { color: 0x5b3920, rough: 0.55, metal: 0, pattern: PAT.woodZ },
	DarkWood: { color: 0x40271a, rough: 0.6, metal: 0, pattern: PAT.woodZ },
	Steel: { color: 0x2d3034, rough: 0.34, metal: 0.85, pattern: PAT.machined },
	Bright: { color: 0x9a9fa5, rough: 0.22, metal: 1, pattern: PAT.machined },
	Brass: { color: 0xa8803a, rough: 0.3, metal: 1, pattern: PAT.machined },
	Iron: { color: 0x26262a, rough: 0.6, metal: 0.7, pattern: PAT.rusty },
	Rope: { color: 0x9c8460, rough: 0.9, metal: 0, pattern: PAT.braid },
	Leather: { color: 0x3a2416, rough: 0.7, metal: 0, pattern: PAT.cloth },
	Glass: { color: 0x3f6b4a, rough: 0.12, metal: 0, pattern: PAT.plain },
	Cloth: { color: 0xc9b48a, rough: 0.85, metal: 0, pattern: PAT.cloth },
	Clay: { color: 0x8a5634, rough: 0.8, metal: 0, pattern: PAT.plain },
	Wick: { color: 0xd8c39a, rough: 0.9, metal: 0, pattern: PAT.thread },
	Black: { color: 0x141414, rough: 0.5, metal: 0.4, pattern: PAT.plain },
};

// every weapon with a model (the guns of FirearmsData, the melee weapons, the throwables, the harpoon gun's bolt)
export const IDS = [ 'pistol', 'duelling', 'musket', 'rifle', 'blunderbuss', 'harpoongun', 'paddle', 'cutlass', 'axe', 'pin', 'harpoon', 'bomb', 'firebottle', 'smoke', 'bolt' ];
export const MUZZLES = {
	pistol: [ 0, 0.035, 0.245 ], duelling: [ 0, 0.03, 0.29 ], musket: [ 0, 0.035, 1.02 ], rifle: [ 0, 0.035, 1.16 ],
	blunderbuss: [ 0, 0.04, 0.7 ], harpoongun: [ 0, 0.04, 0.92 ],
};
// the throwables' / bolt's resting radius (m, the projectile sim's bounce)
export const RADIUS = { bomb: 0.075, firebottle: 0.05, smoke: 0.07, harpoon: 0.03, bolt: 0.02 };

const HALF_PI = Math.PI / 2;
const M = MATS;

// ---- the procedural stand-ins (each well under 600 triangles)

export function buildGeometry( id ) {

	const parts = [];
	const add = ( g, o, m ) => parts.push( prepare( g, { ...o, matrix: m } ) );
	switch ( id ) {

		case 'musket':
			add( cylinder( 0.0105, 0.0125, 1.0, 10, 1 ), M.Steel, mat4( 0, 0.035, 0.52, HALF_PI ) );
			add( cylinder( 0.0135, 0.0135, 0.02, 10, 1 ), M.Bright, mat4( 0, 0.035, 1.01, HALF_PI ) );
			add( cylinder( 0.02, 0.02, 0.016, 10, 1 ), M.Brass, mat4( 0, 0.028, 0.45, HALF_PI ) );
			add( cylinder( 0.02, 0.02, 0.016, 10, 1 ), M.Brass, mat4( 0, 0.028, 0.78, HALF_PI ) );
			add( box( 0.004, 0.01, 0.012 ), M.Brass, mat4( 0, 0.05, 0.98 ) );
			add( box( 0.036, 0.03, 0.82 ), M.Wood, mat4( 0, 0.016, 0.42 ) );
			add( box( 0.034, 0.045, 0.16 ), M.Wood, mat4( 0, 0.008, 0.0, - 0.12 ) );
			add( box( 0.04, 0.12, 0.34 ), M.DarkWood, mat4( 0, - 0.045, - 0.24, - 0.16 ) );
			add( box( 0.044, 0.13, 0.012 ), M.Brass, mat4( 0, - 0.072, - 0.41, - 0.16 ) );
			add( box( 0.006, 0.03, 0.09 ), M.Steel, mat4( 0.02, 0.03, 0.07 ) );
			add( box( 0.006, 0.035, 0.014 ), M.Steel, mat4( 0.022, 0.058, 0.04, 0.45 ) );
			add( box( 0.006, 0.026, 0.012 ), M.Bright, mat4( 0.022, 0.052, 0.09 ) );
			add( box( 0.004, 0.022, 0.005 ), M.Steel, mat4( 0, - 0.012, 0.05 ) );
			add( torus( 0.022, 0.0028, 4, 8, Math.PI ), M.Brass, mat4( 0, 0, 0.05, 0, HALF_PI, Math.PI ) );
			add( cylinder( 0.0035, 0.0035, 0.8, 6, 1 ), M.DarkWood, mat4( 0, 0.0, 0.55, HALF_PI ) );
			break;

		case 'rifle':
			// the musket's frame, longer and slimmer, an octagonal barrel and a long sight
			add( cylinder( 0.0115, 0.0115, 1.12, 8, 1 ), M.Steel, mat4( 0, 0.035, 0.6, HALF_PI ) );
			add( box( 0.004, 0.012, 0.01 ), M.Brass, mat4( 0, 0.052, 1.12 ) );
			add( box( 0.012, 0.016, 0.02 ), M.Steel, mat4( 0, 0.054, 0.12 ) );
			add( box( 0.032, 0.026, 0.95 ), M.Wood, mat4( 0, 0.018, 0.48 ) );
			add( box( 0.032, 0.045, 0.16 ), M.Wood, mat4( 0, 0.006, 0.0, - 0.12 ) );
			add( box( 0.038, 0.11, 0.34 ), M.Wood, mat4( 0, - 0.045, - 0.24, - 0.14 ) );
			add( box( 0.042, 0.12, 0.012 ), M.Brass, mat4( 0, - 0.07, - 0.41, - 0.14 ) );
			add( box( 0.006, 0.03, 0.09 ), M.Steel, mat4( 0.019, 0.03, 0.07 ) );
			add( box( 0.006, 0.035, 0.014 ), M.Steel, mat4( 0.021, 0.058, 0.04, 0.45 ) );
			add( torus( 0.02, 0.0026, 4, 8, Math.PI ), M.Brass, mat4( 0, 0, 0.05, 0, HALF_PI, Math.PI ) );
			break;

		case 'blunderbuss':
			// a short barrel flaring to a bell mouth, a heavy stock
			add( cylinder( 0.03, 0.016, 0.5, 12, 1, true ), M.Brass, mat4( 0, 0.04, 0.42, HALF_PI ) );
			add( cylinder( 0.034, 0.034, 0.02, 12, 1 ), M.Brass, mat4( 0, 0.04, 0.68, HALF_PI ) );
			add( box( 0.04, 0.034, 0.46 ), M.Wood, mat4( 0, 0.016, 0.22 ) );
			add( box( 0.038, 0.05, 0.16 ), M.Wood, mat4( 0, 0.006, 0.0, - 0.14 ) );
			add( box( 0.046, 0.13, 0.3 ), M.DarkWood, mat4( 0, - 0.048, - 0.22, - 0.2 ) );
			add( box( 0.05, 0.14, 0.012 ), M.Brass, mat4( 0, - 0.08, - 0.37, - 0.2 ) );
			add( box( 0.006, 0.034, 0.09 ), M.Steel, mat4( 0.022, 0.032, 0.06 ) );
			add( box( 0.006, 0.04, 0.016 ), M.Steel, mat4( 0.024, 0.062, 0.03, 0.45 ) );
			add( torus( 0.024, 0.003, 4, 8, Math.PI ), M.Brass, mat4( 0, 0, 0.05, 0, HALF_PI, Math.PI ) );
			break;

		case 'harpoongun':
			// a stocked tube with a harpoon in it, the line coiled on a drum under the barrel
			add( cylinder( 0.022, 0.022, 0.7, 10, 1 ), M.Iron, mat4( 0, 0.04, 0.42, HALF_PI ) );
			add( cylinder( 0.006, 0.006, 0.5, 6, 1 ), M.Steel, mat4( 0, 0.04, 0.8, HALF_PI ) );
			add( cylinder( 0.016, 0.0, 0.07, 6, 1 ), M.Bright, mat4( 0, 0.04, 1.08, HALF_PI ) );
			add( cylinder( 0.035, 0.035, 0.07, 10, 1 ), M.Rope, mat4( 0, - 0.02, 0.3, 0, 0, HALF_PI ) );
			add( box( 0.04, 0.034, 0.5 ), M.Wood, mat4( 0, 0.01, 0.22 ) );
			add( box( 0.04, 0.12, 0.3 ), M.DarkWood, mat4( 0, - 0.045, - 0.2, - 0.18 ) );
			add( box( 0.004, 0.022, 0.005 ), M.Steel, mat4( 0, - 0.012, 0.05 ) );
			add( torus( 0.022, 0.003, 4, 8, Math.PI ), M.Iron, mat4( 0, 0, 0.05, 0, HALF_PI, Math.PI ) );
			break;

		case 'duelling':
			// a slimmer, longer pistol with a fluted brass-capped grip
			add( cylinder( 0.0095, 0.011, 0.27, 8, 1 ), M.Steel, mat4( 0, 0.032, 0.13, HALF_PI ) );
			add( box( 0.003, 0.007, 0.008 ), M.Brass, mat4( 0, 0.044, 0.27 ) );
			add( box( 0.026, 0.022, 0.22 ), M.DarkWood, mat4( 0, 0.016, 0.08 ) );
			add( box( 0.026, 0.11, 0.045 ), M.DarkWood, mat4( 0, - 0.03, - 0.03, - 0.35 ) );
			add( box( 0.03, 0.028, 0.05 ), M.Brass, mat4( 0, - 0.082, - 0.055, - 0.35 ) );
			add( box( 0.005, 0.024, 0.06 ), M.Bright, mat4( 0.015, 0.03, 0.0 ) );
			add( box( 0.005, 0.03, 0.012 ), M.Steel, mat4( 0.016, 0.052, - 0.022, 0.45 ) );
			add( torus( 0.017, 0.0024, 4, 8, Math.PI ), M.Brass, mat4( 0, 0.006, 0.012, 0, HALF_PI, Math.PI ) );
			break;

		case 'paddle':
			add( cylinder( 0.016, 0.016, 0.95, 8, 1 ), M.Wood, mat4( 0, 0, 0.32, HALF_PI ) );
			add( box( 0.016, 0.13, 0.42 ), M.Wood, mat4( 0, 0, 0.98 ) );
			add( box( 0.05, 0.035, 0.035 ), M.DarkWood, mat4( 0, 0, - 0.15 ) );
			break;

		case 'cutlass':
			// a broad slightly curved blade, a brass hand guard, a leather grip
			add( box( 0.004, 0.034, 0.36 ), M.Bright, mat4( 0, 0, 0.25, 0.03 ) );
			add( box( 0.004, 0.03, 0.22 ), M.Bright, mat4( 0, - 0.008, 0.53, 0.09 ) );
			add( box( 0.06, 0.012, 0.012 ), M.Brass, mat4( 0, 0, 0.06 ) );
			add( torus( 0.045, 0.004, 4, 10, Math.PI ), M.Brass, mat4( 0, - 0.03, 0.0, 0, HALF_PI, - HALF_PI ) );
			add( cylinder( 0.013, 0.015, 0.11, 8, 1 ), M.Leather, mat4( 0, 0, 0.0, HALF_PI ) );
			add( sphere( 0.016, 6, 4 ), M.Brass, mat4( 0, 0, - 0.065 ) );
			break;

		case 'axe':
			add( cylinder( 0.015, 0.017, 0.62, 8, 1 ), M.Wood, mat4( 0, 0, 0.22, HALF_PI ) );
			add( box( 0.018, 0.14, 0.09 ), M.Iron, mat4( 0, - 0.06, 0.48 ) );
			add( box( 0.012, 0.03, 0.12 ), M.Bright, mat4( 0, - 0.14, 0.48 ) );
			add( box( 0.014, 0.08, 0.03 ), M.Iron, mat4( 0, 0.06, 0.48, 0.5 ) );
			add( cylinder( 0.017, 0.017, 0.1, 8, 1 ), M.Leather, mat4( 0, 0, - 0.02, HALF_PI ) );
			break;

		case 'pin':
			add( cylinder( 0.017, 0.026, 0.26, 8, 1 ), M.Wood, mat4( 0, 0, 0.2, HALF_PI ) );
			add( cylinder( 0.026, 0.026, 0.03, 8, 1 ), M.DarkWood, mat4( 0, 0, 0.06, HALF_PI ) );
			add( cylinder( 0.014, 0.014, 0.16, 8, 1 ), M.Wood, mat4( 0, 0, - 0.03, HALF_PI ) );
			break;

		case 'harpoon':
			add( cylinder( 0.016, 0.016, 1.9, 8, 1 ), M.Wood, mat4( 0, 0, 0.35, HALF_PI ) );
			add( cylinder( 0.006, 0.006, 0.3, 6, 1 ), M.Iron, mat4( 0, 0, 1.43, HALF_PI ) );
			add( cylinder( 0.0, 0.035, 0.12, 4, 1 ), M.Bright, mat4( 0, 0, 1.62, HALF_PI ) );
			add( box( 0.004, 0.06, 0.03 ), M.Bright, mat4( 0, - 0.03, 1.55, - 0.6 ) );
			add( torus( 0.02, 0.004, 4, 8 ), M.Rope, mat4( 0, 0, - 0.5 ) );
			break;

		case 'bolt':
			add( cylinder( 0.006, 0.006, 0.5, 6, 1 ), M.Steel, mat4( 0, 0, 0, HALF_PI ) );
			add( cylinder( 0.0, 0.018, 0.08, 4, 1 ), M.Bright, mat4( 0, 0, 0.29, HALF_PI ) );
			break;

		case 'bomb':
			add( sphere( 0.075, 10, 7 ), M.Black, null );
			add( cylinder( 0.022, 0.022, 0.03, 8, 1 ), M.Iron, mat4( 0, 0.08, 0 ) );
			add( cylinder( 0.004, 0.004, 0.07, 4, 1 ), M.Wick, mat4( 0.01, 0.12, 0, 0, 0, - 0.3 ) );
			break;

		case 'firebottle':
			add( cylinder( 0.04, 0.045, 0.13, 10, 1 ), M.Glass, mat4( 0, 0, 0 ) );
			add( cylinder( 0.014, 0.03, 0.06, 8, 1 ), M.Glass, mat4( 0, 0.095, 0 ) );
			add( cylinder( 0.012, 0.012, 0.06, 6, 1 ), M.Cloth, mat4( 0, 0.15, 0 ) );
			break;

		case 'smoke':
			add( cylinder( 0.06, 0.05, 0.11, 10, 1 ), M.Clay, mat4( 0, 0, 0 ) );
			add( cylinder( 0.045, 0.06, 0.02, 10, 1 ), M.Clay, mat4( 0, 0.065, 0 ) );
			add( cylinder( 0.004, 0.004, 0.05, 4, 1 ), M.Wick, mat4( 0, 0.1, 0 ) );
			break;

		default: // the pistol
			add( cylinder( 0.011, 0.0125, 0.25, 10, 1 ), M.Steel, mat4( 0, 0.035, 0.115, HALF_PI ) );
			add( cylinder( 0.0145, 0.0145, 0.02, 10, 1 ), M.Brass, mat4( 0, 0.035, 0.235, HALF_PI ) );
			add( box( 0.003, 0.008, 0.008 ), M.Brass, mat4( 0, 0.049, 0.225 ) );
			add( box( 0.03, 0.025, 0.2 ), M.Wood, mat4( 0, 0.018, 0.07 ) );
			add( box( 0.028, 0.11, 0.045 ), M.Wood, mat4( 0, - 0.03, - 0.03, - 0.4 ) );
			add( box( 0.034, 0.03, 0.055 ), M.Brass, mat4( 0, - 0.083, - 0.058, - 0.4 ) );
			add( box( 0.006, 0.025, 0.06 ), M.Steel, mat4( 0.016, 0.03, 0.0 ) );
			add( box( 0.006, 0.03, 0.012 ), M.Steel, mat4( 0.017, 0.054, - 0.022, 0.45 ) );
			add( box( 0.006, 0.022, 0.01 ), M.Bright, mat4( 0.017, 0.048, 0.02 ) );
			add( box( 0.004, 0.018, 0.004 ), M.Steel, mat4( 0, - 0.005, 0.012 ) );
			add( torus( 0.018, 0.0025, 4, 8, Math.PI ), M.Brass, mat4( 0, 0.006, 0.012, 0, HALF_PI, Math.PI ) );
			add( cylinder( 0.003, 0.003, 0.2, 6, 1 ), M.DarkWood, mat4( 0, 0.012, 0.11, HALF_PI ) );

	}

	return mergePrepared( parts );

}

export function modelTriangles( id ) {

	return triangleCount( buildGeometry( id ) );

}

// ---- the Blender models

// accessor -> Float32Array (normalized integers scaled)
function toFloat( a ) {

	if ( a.array instanceof Float32Array ) return a.array;
	const arr = a.array;
	const k = a.normalized ? 1 / ( arr instanceof Uint8Array ? 255 : arr instanceof Int8Array ? 127 : arr instanceof Uint16Array ? 65535 : arr instanceof Int16Array ? 32767 : 1 ) : 1;
	return Float32Array.from( arr, ( x ) => Math.max( - 1, x * k ) );

}

const _nm = new Matrix3();
const nodeMatrix = ( n ) => new Matrix4().compose( new Vector3( ...( n.t || [ 0, 0, 0 ] ) ), new Quaternion( ...( n.r || [ 0, 0, 0, 1 ] ) ), new Vector3( ...( n.s || [ 1, 1, 1 ] ) ) );

// a parsed GLB (engine/loaders/GLTF.parseGLB) -> one prepared geometry (node transforms baked; each primitive's material by
// name: the MATS entry whose key starts the material name, e.g. 'Steel.001' -> Steel; unknown names keep their base colour)
export function glbGeometry( gltf ) {

	const parts = [];
	const visit = ( ni, parent ) => {

		const node = gltf.nodes[ ni ];
		const world = new Matrix4().multiplyMatrices( parent, nodeMatrix( node ) );
		if ( node.mesh !== undefined ) {

			_nm.getNormalMatrix( world );
			for ( const p of gltf.meshes[ node.mesh ] ) {

				if ( p.mode !== undefined && p.mode !== 4 ) continue;
				const A = p.attributes;
				if ( ! A.POSITION ) continue;
				const geo = new BufferGeometry();
				geo.setAttribute( 'position', new BufferAttribute( toFloat( A.POSITION ).slice(), 3 ) );
				if ( A.NORMAL ) geo.setAttribute( 'normal', new BufferAttribute( toFloat( A.NORMAL ).slice(), 3 ) );
				if ( p.indices ) geo.setIndex( new BufferAttribute( geo.attributes.position.count < 65535 ? Uint16Array.from( p.indices ) : Uint32Array.from( p.indices ), 1 ) );
				const gm = ( gltf.materials && gltf.materials[ p.material ?? 0 ] ) || {};
				const name = String( gm.name || '' );
				const key = Object.keys( MATS ).sort( ( a, b ) => b.length - a.length ).find( ( k ) => name.startsWith( k ) );
				let o = key ? MATS[ key ] : null;
				if ( ! o ) {

					const f = ( gm.pbrMetallicRoughness && gm.pbrMetallicRoughness.baseColorFactor ) || [ 0.6, 0.6, 0.6, 1 ];
					o = { color: ( Math.round( Math.pow( f[ 0 ], 1 / 2.2 ) * 255 ) << 16 ) | ( Math.round( Math.pow( f[ 1 ], 1 / 2.2 ) * 255 ) << 8 ) | Math.round( Math.pow( f[ 2 ], 1 / 2.2 ) * 255 ), rough: 0.6, metal: 0, pattern: PAT.plain };

				}

				// the export's own vertex colours (Blender's colour attribute) tint the material colour
				const g = prepare( geo, o );
				if ( A.COLOR_0 ) {

					const c = toFloat( A.COLOR_0 ), w = A.COLOR_0.itemSize || ( c.length / geo.attributes.position.count );
					const col = g.attributes.color;
					for ( let i = 0; i < col.count; i ++ ) col.setXYZ( i, col.getX( i ) * c[ i * w ], col.getY( i ) * c[ i * w + 1 ], col.getZ( i ) * c[ i * w + 2 ] );

				}

				g.applyMatrix4( world );
				parts.push( g );

			}

		}

		for ( const c of node.children || [] ) visit( c, world );

	};

	for ( const ni of gltf.roots || [] ) visit( ni, new Matrix4() );
	if ( ! parts.length ) return null;
	return mergePrepared( parts );

}

// the geometry of each weapon: the stand-in at once, the GLB swapped in when it has loaded (callers re-read geometry( id ) or
// pass onReady). load() never throws: a missing file keeps the stand-in (headless runs never fetch)
export class ModelBank {

	constructor( { base = null, loader = null } = {} ) {

		this.base = base ?? ( ( typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL ) || '/' );
		this.loader = loader; // async ( url ) -> gltf (engine/loaders/GLTF.loadGLB); null: no GLBs
		this.geos = new Map();
		this.loaded = new Map(); // id -> Promise<geometry | null>

	}

	geometry( id ) {

		if ( ! this.geos.has( id ) ) this.geos.set( id, buildGeometry( id ) );
		return this.geos.get( id );

	}

	url( id ) {

		return this.base + 'models/weapons/' + id + '.glb';

	}

	load( id, onReady = null ) {

		if ( ! this.loader ) return Promise.resolve( null );
		if ( ! this.loaded.has( id ) ) {

			this.loaded.set( id, Promise.resolve().then( () => this.loader( this.url( id ) ) ).then( ( gltf ) => {

				const g = gltf ? glbGeometry( gltf ) : null;
				if ( g ) this.geos.set( id, g );
				return g;

			} ).catch( () => null ) );

		}

		const p = this.loaded.get( id );
		if ( onReady ) p.then( ( g ) => { if ( g ) onReady( g ); } );
		return p;

	}

	dispose() {

		for ( const g of this.geos.values() ) try { g.dispose(); } catch ( e ) { /* gone */ }
		this.geos.clear();

	}

}

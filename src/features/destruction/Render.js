// Drawing the destructible props through the engine: one instanced mesh per piece type (wood boxes for every plank,
// post, beam and fish; barrel cylinders; rock icosahedra), each instance a unit shape scaled to the piece, tinted by its
// instance colour. Three draws (plus their shadow passes) for every prop, whole or in pieces.
//
//   const r = new PropRender( scene );  r.begin();  r.push( 'box', pos, quat, size, color, scale );  r.end();  r.dispose();

import { Group, InstancedMesh, BoxGeometry, CylinderGeometry, IcosahedronGeometry, Color } from '../../engine/index.js';
import { Material } from '../../engine/render/Material.js';

const WOOD_SURFACE = /* wgsl */`
	// planks: grain streaks along the long uv axis, a per-board brightness step, weathered edges a little paler
	let g = in.uv;
	let streak = 0.5 + 0.5 * sin( g.y * 70.0 + sin( g.x * 9.0 ) * 2.5 );
	let board = fract( sin( dot( floor( g * vec2f( 2.0, 1.0 ) ), vec2f( 12.9898, 78.233 ) ) ) * 43758.5453 );
	let edge = smoothstep( 0.42, 0.5, max( abs( g.x - 0.5 ), abs( g.y - 0.5 ) ) );
	var c = in.color.rgb * ( 0.84 + 0.16 * streak ) * ( 0.92 + 0.16 * board );
	c = mix( c, c * 1.18 + vec3f( 0.02 ), edge * 0.5 );
	s.albedo = c;
	s.roughness = 0.84;
`;

const STONE_SURFACE = /* wgsl */`
	let g = in.uv;
	let n = fract( sin( dot( floor( g * 9.0 ), vec2f( 39.3468, 11.135 ) ) ) * 24634.6345 );
	let up = smoothstep( 0.55, 1.0, in.N.y );
	var c = in.color.rgb * ( 0.85 + 0.25 * n );
	c = mix( c, c * 1.12, up * 0.5 );
	s.albedo = c;
	s.roughness = 0.9;
`;

export const CAPACITY = { box: 3072, barrel: 256, rock: 256 };

export class PropRender {

	constructor( scene, capacity = CAPACITY ) {

		this.scene = scene;
		this.group = new Group();
		this.group.name = 'destructible-props';
		this.wood = new Material( { name: 'destructible-wood', roughness: 0.84, underwaterLighting: 'lite', surface: WOOD_SURFACE } );
		this.stone = new Material( { name: 'destructible-stone', roughness: 0.9, underwaterLighting: 'lite', surface: STONE_SURFACE } );
		this.meshes = {
			box: this._mesh( new BoxGeometry( 1, 1, 1 ), this.wood, capacity.box, 'destructible-boxes' ),
			barrel: this._mesh( new CylinderGeometry( 0.5, 0.5, 1, 16, 1 ), this.wood, capacity.barrel, 'destructible-barrels' ),
			rock: this._mesh( new IcosahedronGeometry( 0.5, 0 ), this.stone, capacity.rock, 'destructible-rocks' ),
		};
		this.n = { box: 0, barrel: 0, rock: 0 };
		scene.add( this.group );

	}

	_mesh( geo, mat, cap, name ) {

		const im = new InstancedMesh( geo, mat, cap );
		im.name = name;
		im.frustumCulled = false;
		im.castShadow = true;
		im.receiveShadow = true;
		im.count = 0;
		im.setColorAt( 0, new Color( 1, 1, 1 ) ); // allocates the colour buffer
		this.group.add( im );
		return im;

	}

	begin() {

		this.n.box = 0; this.n.barrel = 0; this.n.rock = 0;

	}

	// T * R * S straight into the instance buffer
	push( type, p, q, size, color, scale = 1 ) {

		const im = this.meshes[ type ];
		const i = this.n[ type ];
		if ( ! im || i >= im.instanceMatrix.count ) return;
		this.n[ type ] = i + 1;
		const e = im.instanceMatrix.array, o = i * 16;
		const sx = size[ 0 ] * scale, sy = size[ 1 ] * scale, sz = size[ 2 ] * scale;
		const { x, y, z, w } = q;
		const x2 = x + x, y2 = y + y, z2 = z + z, xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
		const wx = w * x2, wy = w * y2, wz = w * z2;
		e[ o ] = ( 1 - ( yy + zz ) ) * sx; e[ o + 1 ] = ( xy + wz ) * sx; e[ o + 2 ] = ( xz - wy ) * sx; e[ o + 3 ] = 0;
		e[ o + 4 ] = ( xy - wz ) * sy; e[ o + 5 ] = ( 1 - ( xx + zz ) ) * sy; e[ o + 6 ] = ( yz + wx ) * sy; e[ o + 7 ] = 0;
		e[ o + 8 ] = ( xz + wy ) * sz; e[ o + 9 ] = ( yz - wx ) * sz; e[ o + 10 ] = ( 1 - ( xx + yy ) ) * sz; e[ o + 11 ] = 0;
		e[ o + 12 ] = p.x; e[ o + 13 ] = p.y; e[ o + 14 ] = p.z; e[ o + 15 ] = 1;
		const c = im.instanceColor.array;
		c[ i * 3 ] = color[ 0 ]; c[ i * 3 + 1 ] = color[ 1 ]; c[ i * 3 + 2 ] = color[ 2 ];

	}

	end() {

		for ( const k in this.meshes ) {

			const im = this.meshes[ k ];
			im.count = this.n[ k ];
			im.visible = im.count > 0;
			im.instanceMatrix.needsUpdate = true;
			im.instanceColor.needsUpdate = true;

		}

	}

	dispose() {

		this.scene.remove( this.group );
		for ( const k in this.meshes ) this.meshes[ k ].geometry.dispose();
		this.wood.dispose();
		this.stone.dispose();

	}

}

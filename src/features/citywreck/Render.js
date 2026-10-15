// Drawing the city's damage through the engine: one instanced unit box for everything (scorch marks, broken windows,
// breaches, soot, rubble heaps, the falling chunks, scaffolding, tarps), each instance scaled, turned and tinted. One draw
// (plus its shadow passes) for the whole city's damage; the capacity is the budget (fewer on phones).
//
//   const r = new WreckRender( scene, capacity );  r.begin();  r.push( item );  r.end();  r.dispose();

import { Group, InstancedMesh, BoxGeometry, Color } from '../../engine/index.js';
import { Material } from '../../engine/render/Material.js';

const SURFACE = /* wgsl */`
	// broken concrete and brick: a blotchy grain by world position, the faces that look up a little paler (dust)
	let w = in.P * 1.7;
	let n = fract( sin( dot( floor( w.xz + w.y ), vec2f( 12.9898, 78.233 ) ) ) * 43758.5453 );
	let up = smoothstep( 0.6, 1.0, in.N.y );
	var c = in.color.rgb * ( 0.86 + 0.22 * n );
	c = mix( c, c * 1.15 + vec3f( 0.02 ), up * 0.45 );
	s.albedo = c;
	s.roughness = 0.93;
`;

export class WreckRender {

	constructor( scene, capacity = 4096 ) {

		this.scene = scene;
		this.group = new Group();
		this.group.name = 'citywreck';
		this.material = new Material( { name: 'citywreck-rubble', roughness: 0.93, underwaterLighting: 'lite', surface: SURFACE } );
		const im = new InstancedMesh( new BoxGeometry( 1, 1, 1 ), this.material, capacity );
		im.name = 'citywreck-boxes';
		im.frustumCulled = false;
		im.castShadow = true;
		im.receiveShadow = true;
		im.count = 0;
		im.setColorAt( 0, new Color( 1, 1, 1 ) ); // allocates the colour buffer
		this.mesh = im;
		this.capacity = capacity;
		this.n = 0;
		this.dropped = 0;
		this.group.add( im );
		scene.add( this.group );

	}

	begin() {

		this.n = 0;
		this.dropped = 0;

	}

	// T * R * S of one item straight into the instance buffer
	push( it ) {

		const im = this.mesh, i = this.n;
		if ( i >= this.capacity ) { this.dropped ++; return false; }
		this.n = i + 1;
		const e = im.instanceMatrix.array, o = i * 16;
		const [ sx, sy, sz ] = it.s, [ x, y, z, w ] = it.q, p = it.p;
		const x2 = x + x, y2 = y + y, z2 = z + z, xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
		const wx = w * x2, wy = w * y2, wz = w * z2;
		e[ o ] = ( 1 - ( yy + zz ) ) * sx; e[ o + 1 ] = ( xy + wz ) * sx; e[ o + 2 ] = ( xz - wy ) * sx; e[ o + 3 ] = 0;
		e[ o + 4 ] = ( xy - wz ) * sy; e[ o + 5 ] = ( 1 - ( xx + zz ) ) * sy; e[ o + 6 ] = ( yz + wx ) * sy; e[ o + 7 ] = 0;
		e[ o + 8 ] = ( xz + wy ) * sz; e[ o + 9 ] = ( yz - wx ) * sz; e[ o + 10 ] = ( 1 - ( xx + yy ) ) * sz; e[ o + 11 ] = 0;
		e[ o + 12 ] = p[ 0 ]; e[ o + 13 ] = p[ 1 ]; e[ o + 14 ] = p[ 2 ]; e[ o + 15 ] = 1;
		const c = im.instanceColor.array;
		// (the palette is written in display sRGB: squared, near enough linear)
		c[ i * 3 ] = it.c[ 0 ] * it.c[ 0 ]; c[ i * 3 + 1 ] = it.c[ 1 ] * it.c[ 1 ]; c[ i * 3 + 2 ] = it.c[ 2 ] * it.c[ 2 ];
		return true;

	}

	end() {

		const im = this.mesh;
		im.count = this.n;
		im.visible = this.n > 0;
		im.instanceMatrix.needsUpdate = true;
		im.instanceColor.needsUpdate = true;

	}

	dispose() {

		this.scene.remove( this.group );
		this.mesh.geometry.dispose();
		this.material.dispose();

	}

}

import { BufferAttribute, BufferGeometry, Color, Group, Matrix3, Matrix4, Mesh, Quaternion, Vector3 } from '../../engine/index.js';
import { Material } from '../../engine/render/Material.js';
import { Texture, capImage } from '../../engine/gpu/Texture.js';
import { generateMipmaps } from '../../engine/gpu/Mipmaps.js';
import { loadGLB, decodeImage } from '../../engine/loaders/GLTF.js';

// Static (unskinned, unanimated) GLB -> engine meshes with lit PBR materials. Used for the fleet
// hulls (public/models/fleet/*.glb): one Mesh per primitive, the node's world transform baked into
// positions / normals (as world/debris/GLB.js does), one Material per glTF material:
//
//   const { group, meshes, materials, dispose } = await loadStaticGLB( url, { materials, shadows, prefix } );
//
// - baseColorFactor -> material.color, baseColorTexture -> sRGB Texture with mips (one per image
//   index), multiplied into s.albedo; roughnessFactor / metallicFactor; doubleSided -> side 'double'.
// - a material whose name contains 'Glass' becomes transparent (opacity 0.45, roughness 0.15) and
//   its mesh is named `${ prefix }glass`, which App's late-pass rule ('boat-glass') picks up.
// - other meshes are named `${ prefix }${ materialName }` (e.g. 'boat-WeatheredTeak').
// - `materials( info ) -> extra Material options` lets the caller override per glTF material
//   (info: { name, gltfMaterial, albedo }).
// Texture images are decoded with GLTF.decodeImage (globalThis.__assetImage in headless runs).

const SURFACE_ALBEDO = /* wgsl */`
	let ca = textureSample( chAlbedo, smpAnisoRepeat, in.uv );
	s.albedo *= ca.rgb;
`;

// A lit PBR material: flat colour, optionally multiplied by an sRGB albedo texture (sampled with
// the repeating anisotropic sampler), roughness / metalness factors.
export function texturedMaterial( { name = 'textured', color = null, albedo = null, roughness = 1, metalness = 0, doubleSided = false, transparent = false, opacity = 1, surface = '', ...rest } = {} ) {

	const textures = {};
	if ( albedo ) textures.chAlbedo = albedo;
	return new Material( {
		name,
		textures,
		color: color || undefined,
		roughness,
		metalness,
		opacity,
		transparent,
		side: doubleSided ? 'double' : 'front',
		surface: ( albedo ? SURFACE_ALBEDO : '' ) + surface,
		...rest,
	} );

}

export async function loadStaticGLB( url, { materials = null, shadows = true, prefix = 'boat-' } = {} ) {

	const gltf = await loadGLB( url );
	const group = new Group();
	group.name = 'StaticGLB';
	const meshes = [];
	const mats = [];

	// textures by image index (several materials share the same image)
	const texCache = gltf.__texCache || ( gltf.__texCache = new Map() ); // shared by every load of this file
	const albedoOf = async ( info ) => {

		if ( ! info ) return null;
		const tx = gltf.textures[ info.index ];
		if ( ! tx || tx.source === undefined ) return null;
		const src = tx.source;
		if ( ! texCache.has( src ) ) {

			const im = gltf.images[ src ];
			if ( ! im || ! im.bytes ) return null;
			let px = await decodeImage( im.bytes, im.mimeType );
			im.bytes = null; // decoded once (texCache keeps the texture): free the file's image data
			const pb = globalThis.__phoneBudget; // phones: 256 px prop maps
			if ( pb && pb.propTexture ) px = capImage( px, pb.propTexture );
			const t = new Texture( { label: 'glb' + src, width: px.width, height: px.height, format: 'rgba8unorm-srgb', data: px.data, mips: true, usage: [ 'sample', 'copyDst' ], sampler: 'anisoRepeat' } );
			t.getGPU();
			generateMipmaps( t );
			texCache.set( src, t );

		}

		return texCache.get( src );

	};

	const matCache = new Map();
	const materialFor = async ( index ) => {

		if ( matCache.has( index ) ) return matCache.get( index );
		const gm = gltf.materials[ index ] || {};
		const pbr = gm.pbrMetallicRoughness || {};
		const name = gm.name || 'material' + index;
		const glass = /glass/i.test( name );
		const f = pbr.baseColorFactor || [ 1, 1, 1, 1 ];
		const albedo = await albedoOf( pbr.baseColorTexture );
		const extra = materials ? materials( { name, gltfMaterial: gm, albedo } ) || {} : {};
		const mat = texturedMaterial( {
			name: prefix + ( glass ? 'glass' : name ),
			color: new Color( f[ 0 ], f[ 1 ], f[ 2 ] ),
			albedo,
			roughness: glass ? 0.15 : ( pbr.roughnessFactor ?? 1 ),
			metalness: pbr.metallicFactor ?? 0,
			doubleSided: !! gm.doubleSided,
			transparent: glass,
			opacity: glass ? 0.45 : 1,
			...extra,
		} );
		const entry = { material: mat, glass, name };
		matCache.set( index, entry );
		mats.push( mat );
		return entry;

	};

	const nodeMatrix = ( n ) => new Matrix4().compose( new Vector3( ...n.t ), new Quaternion( ...n.r ), new Vector3( ...n.s ) );
	const visit = async ( ni, parent ) => {

		const node = gltf.nodes[ ni ];
		const world = new Matrix4().multiplyMatrices( parent, nodeMatrix( node ) );
		if ( node.mesh !== undefined ) {

			const nm = new Matrix3().getNormalMatrix( world );
			for ( const p of gltf.meshes[ node.mesh ] ) {

				if ( p.mode !== 4 ) continue; // triangles only
				const A = p.attributes;
				if ( ! A.POSITION ) continue;
				const geo = new BufferGeometry();
				geo.setAttribute( 'position', new BufferAttribute( toFloat( A.POSITION ).slice(), 3 ).applyMatrix4( world ) ); // (a copy: the gltf is shared)
				if ( A.NORMAL ) geo.setAttribute( 'normal', new BufferAttribute( toFloat( A.NORMAL ).slice(), 3 ).applyNormalMatrix( nm ) );
				if ( A.TEXCOORD_0 ) geo.setAttribute( 'uv', new BufferAttribute( toFloat( A.TEXCOORD_0 ), 2 ) );
				if ( p.indices ) geo.setIndex( new BufferAttribute( p.indices instanceof Uint8Array ? Uint16Array.from( p.indices ) : p.indices, 1 ) );
				if ( ! A.NORMAL ) geo.computeVertexNormals();
				geo.computeBoundingBox();
				geo.computeBoundingSphere();

				const { material, glass, name } = await materialFor( p.material ?? 0 );
				const mesh = new Mesh( geo, material );
				mesh.name = prefix + ( glass ? 'glass' : name );
				mesh.castShadow = shadows && ! glass;
				mesh.receiveShadow = shadows;
				if ( glass ) mesh.renderOrder = 1;
				group.add( mesh );
				meshes.push( mesh );

			}

		}

		for ( const c of node.children ) await visit( c, world );

	};

	for ( const ni of gltf.roots ) await visit( ni, new Matrix4() );

	return {
		group,
		meshes,
		materials: mats,
		textures: [ ...texCache.values() ],
		dispose() {

			for ( const m of meshes ) m.geometry.dispose && m.geometry.dispose();
			for ( const m of mats ) m.dispose && m.dispose();
			for ( const t of texCache.values() ) t.destroy && t.destroy();

		},
	};

}

// accessor -> Float32Array (normalized integers scaled to 0..1 / -1..1)
function toFloat( a ) {

	if ( a.array instanceof Float32Array ) return a.array;
	const k = a.normalized ? 1 / ( a.array instanceof Uint8Array || a.array instanceof Int8Array ? ( a.array instanceof Uint8Array ? 255 : 127 ) : a.array instanceof Uint16Array ? 65535 : a.array instanceof Int16Array ? 32767 : 1 ) : 1;
	return Float32Array.from( a.array, ( x ) => Math.max( - 1, x * k ) );

}

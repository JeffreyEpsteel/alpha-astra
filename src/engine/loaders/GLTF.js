// Binary glTF (.glb) reader for skinned, animated characters (engine side of loaders; the debris
// scans use the smaller world/debris/GLB.js). Returns plain data, no GPU objects:
//
//   const gltf = await loadGLB( url )            // or parseGLB( arrayBuffer )
//   gltf.nodes[ i ]  = { name, children: [ ... ], t: [ x, y, z ], r: [ x, y, z, w ], s: [ x, y, z ], mesh, skin }
//   gltf.roots       = scene root node indices
//   gltf.meshes[ i ] = [ { attributes: { POSITION: { array, itemSize, normalized }, ... }, indices, material,
//                          targets: [ { POSITION: Float32Array( 3 * vertices ) } ] (morph deltas; [] when none), targetNames: [ 'Blink_L', ... ] } ]
//   gltf.skins[ i ]  = { joints: [ node indices ], inverseBindMatrices: Float32Array( 16 * n ) }
//   gltf.animations  = [ { name, duration, channels: [ { node, path: 'translation' | 'rotation' | 'scale', times, values } ] } ]
//   gltf.materials   = the glTF material objects (name, pbrMetallicRoughness, normalTexture, alphaMode, ...)
//   gltf.images[ i ] = { bytes: Uint8Array, mimeType }  (decode with decodeImage)
//
// Handled: embedded buffer, interleaved / packed accessors of every component type (normalized
// or not), node TRS or matrix, LINEAR / STEP samplers (CUBICSPLINE keeps the values, drops the
// tangents), morph targets (POSITION deltas of each target and the target names Blender writes into mesh.extras.targetNames;
// sparse accessors are expanded). Not handled: external buffers, Draco / meshopt, morph normals / tangents, weight animation.
//
// Asset hooks for headless runs (no fetch of relative URLs / no image decoding in Node):
//   globalThis.__assetFile( url ) -> ArrayBuffer, globalThis.__assetImage( bytes, mimeType ) -> { data, width, height }

import { Matrix4, Quaternion, Vector3 } from '../math/index.js';

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const ARRAYS = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NORM = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

const _loads = new Map(); // url -> Promise<gltf>: every avatar / prop of one file shares the parsed data (and its textures / geometry caches)
export function loadGLB( url ) {

	let p = _loads.get( url );
	if ( ! p ) {

		p = loadGLBFresh( url );
		_loads.set( url, p );
		p.catch( () => _loads.delete( url ) );

	}

	return p;

}

export async function loadGLBFresh( url ) {

	let buffer;
	if ( globalThis.__assetFile ) buffer = await globalThis.__assetFile( url );
	else {

		const res = await fetch( url );
		if ( ! res.ok ) throw new Error( 'GLB: ' + url + ' ' + res.status );
		buffer = await res.arrayBuffer();

	}

	return parseGLB( buffer );

}

export function parseGLB( buffer ) {

	const dv = new DataView( buffer );
	if ( dv.getUint32( 0, true ) !== 0x46546C67 ) throw new Error( 'GLB: bad magic' );
	const length = dv.getUint32( 8, true );
	let json = null, bin = null;
	for ( let o = 12; o < length; ) {

		const len = dv.getUint32( o, true ), type = dv.getUint32( o + 4, true );
		if ( type === 0x4E4F534A ) json = JSON.parse( new TextDecoder().decode( new Uint8Array( buffer, o + 8, len ) ) );
		else if ( type === 0x004E4942 ) bin = new Uint8Array( buffer, o + 8, len );
		o += 8 + len;

	}

	if ( ! json ) throw new Error( 'GLB: no JSON chunk' );
	if ( json.extensionsRequired && json.extensionsRequired.length ) throw new Error( 'GLB: unsupported extensions ' + json.extensionsRequired.join( ', ' ) );

	const viewBytes = ( i ) => {

		const bv = json.bufferViews[ i ];
		if ( bv.buffer !== 0 || ! bin ) throw new Error( 'GLB: external buffers are not supported' );
		return new Uint8Array( bin.buffer, bin.byteOffset + ( bv.byteOffset || 0 ), bv.byteLength );

	};

	// accessor -> tightly packed typed array
	const read = ( i ) => {

		const a = typeof i === 'number' ? json.accessors[ i ] : i;
		const n = COMPONENTS[ a.type ];
		const Arr = ARRAYS[ a.componentType ];
		const out = new Arr( a.count * n );
		if ( a.bufferView !== undefined ) {

			const bv = json.bufferViews[ a.bufferView ];
			const bytes = viewBytes( a.bufferView );
			const base = bytes.byteOffset + ( a.byteOffset || 0 );
			const size = Arr.BYTES_PER_ELEMENT;
			const stride = bv.byteStride || n * size;
			if ( stride === n * size && base % size === 0 ) out.set( new Arr( bytes.buffer, base, a.count * n ) );
			else {

				const src = new DataView( bytes.buffer );
				const get = {
					5120: ( o ) => src.getInt8( o ), 5121: ( o ) => src.getUint8( o ), 5122: ( o ) => src.getInt16( o, true ),
					5123: ( o ) => src.getUint16( o, true ), 5125: ( o ) => src.getUint32( o, true ), 5126: ( o ) => src.getFloat32( o, true ),
				}[ a.componentType ];
				for ( let k = 0; k < a.count; k ++ ) for ( let c = 0; c < n; c ++ ) out[ k * n + c ] = get( base + k * stride + c * size );

			}

		}

		if ( a.sparse ) {

			// sparse: the listed elements replace the base (zeros when there is no buffer view)
			const sp = a.sparse;
			const idx = read( { count: sp.count, type: 'SCALAR', componentType: sp.indices.componentType, bufferView: sp.indices.bufferView, byteOffset: sp.indices.byteOffset } ).array;
			const val = read( { count: sp.count, type: a.type, componentType: a.componentType, bufferView: sp.values.bufferView, byteOffset: sp.values.byteOffset } ).array;
			for ( let k = 0; k < sp.count; k ++ ) for ( let c = 0; c < n; c ++ ) out[ idx[ k ] * n + c ] = val[ k * n + c ];

		}

		return { array: out, itemSize: n, normalized: !! a.normalized, componentType: a.componentType };

	};

	// normalized integers -> floats
	const readFloat = ( i ) => {

		const r = read( i );
		if ( r.array instanceof Float32Array ) return r.array;
		const f = new Float32Array( r.array.length );
		const k = r.normalized ? 1 / NORM[ r.componentType ] : 1;
		for ( let j = 0; j < f.length; j ++ ) f[ j ] = Math.max( r.array[ j ] * k, - 1 );
		return f;

	};

	const m = new Matrix4(), t = new Vector3(), q = new Quaternion(), s = new Vector3();
	const nodes = ( json.nodes || [] ).map( ( n ) => {

		let T = n.translation || [ 0, 0, 0 ], R = n.rotation || [ 0, 0, 0, 1 ], S = n.scale || [ 1, 1, 1 ];
		if ( n.matrix ) {

			m.fromArray( n.matrix ).decompose( t, q, s );
			T = [ t.x, t.y, t.z ]; R = [ q.x, q.y, q.z, q.w ]; S = [ s.x, s.y, s.z ];

		}

		return { name: n.name || '', children: n.children || [], t: T.slice(), r: R.slice(), s: S.slice(), mesh: n.mesh, skin: n.skin };

	} );

	const meshes = ( json.meshes || [] ).map( ( me ) => me.primitives.map( ( p ) => {

		const attributes = {};
		for ( const k in p.attributes ) attributes[ k ] = read( p.attributes[ k ] );
		// morph targets: POSITION deltas as floats (normalized integer deltas are scaled back)
		const targets = ( p.targets || [] ).map( ( t ) => ( { POSITION: t.POSITION !== undefined ? readFloat( t.POSITION ) : null } ) );
		const names = ( p.extras && p.extras.targetNames ) || ( me.extras && me.extras.targetNames ) || targets.map( ( _, k ) => 'target' + k );
		return { attributes, indices: p.indices !== undefined ? read( p.indices ).array : null, material: p.material, mode: p.mode ?? 4, targets, targetNames: names };

	} ) );

	const skins = ( json.skins || [] ).map( ( sk ) => ( {
		name: sk.name || '',
		joints: sk.joints,
		skeleton: sk.skeleton,
		inverseBindMatrices: sk.inverseBindMatrices !== undefined ? readFloat( sk.inverseBindMatrices ) : identities( sk.joints.length ),
	} ) );

	const animations = ( json.animations || [] ).map( ( an ) => {

		let duration = 0;
		const channels = [];
		for ( const ch of an.channels ) {

			if ( ch.target.node === undefined || ch.target.path === 'weights' ) continue;
			const smp = an.samplers[ ch.sampler ];
			const times = readFloat( smp.input );
			let values = readFloat( smp.output );
			const w = ch.target.path === 'rotation' ? 4 : 3;
			if ( smp.interpolation === 'CUBICSPLINE' ) {

				// keep the value of each (in-tangent, value, out-tangent) triple
				const v = new Float32Array( times.length * w );
				for ( let k = 0; k < times.length; k ++ ) for ( let c = 0; c < w; c ++ ) v[ k * w + c ] = values[ ( k * 3 + 1 ) * w + c ];
				values = v;

			}

			duration = Math.max( duration, times[ times.length - 1 ] );
			channels.push( { node: ch.target.node, path: ch.target.path, times, values, step: smp.interpolation === 'STEP' } );

		}

		// clips exported from a frame range start at t0 > 0: shift to 0
		let t0 = Infinity;
		for ( const c of channels ) t0 = Math.min( t0, c.times[ 0 ] );
		if ( t0 > 0 && t0 < Infinity ) {

			for ( const c of channels ) for ( let k = 0; k < c.times.length; k ++ ) c.times[ k ] -= t0;
			duration -= t0;

		}

		return { name: an.name || 'clip', duration, channels };

	} );

	// image bytes get their own buffers (slice): a view would keep the whole GLB file alive after the textures are decoded
	// and the meshes uploaded (the roster's 10 MB files pinned ~200 MB on a phone); the decoders null `bytes` when done
	const images = ( json.images || [] ).map( ( im ) => ( { bytes: im.bufferView !== undefined ? viewBytes( im.bufferView ).slice() : null, mimeType: im.mimeType, uri: im.uri } ) );
	const scene = json.scenes ? json.scenes[ json.scene || 0 ] : null;
	const roots = scene ? scene.nodes : nodes.map( ( _, i ) => i ).filter( ( i ) => ! nodes.some( ( n ) => n.children.includes( i ) ) );

	return { json, nodes, roots, meshes, skins, animations, materials: json.materials || [], textures: json.textures || [], images };

}

function identities( n ) {

	const a = new Float32Array( n * 16 );
	for ( let i = 0; i < n; i ++ ) a[ i * 16 ] = a[ i * 16 + 5 ] = a[ i * 16 + 10 ] = a[ i * 16 + 15 ] = 1;
	return a;

}

// Phones (globalThis.__assetImageCap, core/Quality.js): at most two images decode at once. A character GLB holds 2048 px
// maps; several vendors loading together decoded a dozen at once (an ImageBitmap of 16 MB each, plus canvases), a
// memory spike right as the game starts that iOS answers by ending the tab.
let _decoding = 0;
const _decodeQueue = [];
async function decodeSlot( fn ) {

	const max = globalThis.__assetImageCap ? 2 : Infinity;
	if ( _decoding >= max ) await new Promise( ( r ) => _decodeQueue.push( r ) );
	_decoding ++;
	try { return await fn(); } finally {

		_decoding --;
		const next = _decodeQueue.shift();
		if ( next ) next();

	}

}

// Decoded RGBA8 pixels (top row first) of an embedded image.
export function decodeImage( bytes, mimeType ) {

	return decodeSlot( () => decodeImageNow( bytes, mimeType ) );

}

async function decodeImageNow( bytes, mimeType ) {

	if ( globalThis.__assetImage ) return globalThis.__assetImage( bytes, mimeType );
	const bmp = await createImageBitmap( new Blob( [ bytes ], { type: mimeType } ), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' } );
	const cv = new OffscreenCanvas( bmp.width, bmp.height );
	const ctx = cv.getContext( '2d', { willReadFrequently: true } );
	ctx.drawImage( bmp, 0, 0 );
	const width = bmp.width, height = bmp.height;
	const d = ctx.getImageData( 0, 0, width, height ).data;
	// (read the size first: a closed ImageBitmap reports 0 x 0)
	bmp.close && bmp.close();
	return { data: new Uint8Array( d.buffer, d.byteOffset, d.byteLength ), width, height };

}

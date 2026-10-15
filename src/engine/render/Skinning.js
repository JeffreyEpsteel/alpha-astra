import { Group } from '../scene/Group.js';
import { Mesh } from '../scene/Mesh.js';
import { BufferGeometry } from '../geometry/BufferGeometry.js';
import { BufferAttribute } from '../geometry/BufferAttribute.js';
import { Texture, StorageBuffer, capImage } from '../gpu/Texture.js';
import { generateMipmaps } from '../gpu/Mipmaps.js';
import { Material } from './Material.js';
import { decodeImage } from '../loaders/GLTF.js';

// Skinned, animated models (glTF skins) on the GPU.
//
//   const gltf = await loadGLB( url );                       // engine/loaders/GLTF.js
//   const model = await SkinnedModel.create( gltf, { materials: ( info ) => ( { ... } ) } );
//   scene.add( model.group );                                // meshes are children of model.group
//   model.play( 'idle_neutral_01', { fade: 0.5, loop: true, speed: 1 } );
//   model.update( dt );                                      // before rendering: animation + joint upload
//   model.hold();                                            // when it stops updating (keeps motion vectors at 0)
//
// Pose: every node's local TRS starts from the glTF rest pose; each playing clip samples its
// channels (linear / step, quaternions nlerped) and the layers are blended by weight (crossfades:
// the incoming layer's weight rises while the others fall, their sum stays 1). World matrices of
// the node hierarchy -> joint matrices = jointWorld * inverseBind (glTF: the skinned mesh node's
// own transform is ignored), so skinned vertices come out in the model's space and the mesh
// objects' model matrix (model.group's world matrix) places them in the world.
//
// Overlay layer (an upper-body slot, like a layered blend per bone): a second clip sampled over the base layers for
// the masked nodes only, so a character can walk with its legs while its arms hold a rod.
//
//   model.setOverlay( 'Fishing_Hold', { mask: { spine_01: 0.5, spine_02: 0.8, clavicle_l: 1, clavicle_r: 1, neck_01: 1 }, fade: 0.25 } );
//   model.setOverlay( 'Fishing_Cast', { mask, loop: false, fade: 0.05, restart: true } );   // a one-shot, holds its last pose
//   model.onOverlayEnd = ( clipName ) => { ... };                                           // a one-shot reached its end
//   model.setOverlay( null, { fade: 0.2 } );                                                // fade the overlay out
//   model.overlay                                                                           // the clip now overlaid, or null
//
// mask: null (every node), an array of node names (each with everything under it, weight 1) or { name: weight }:
// the weight goes to that node and its descendants until a deeper named node gives its own, so
// { spine_01: 0.5, spine_02: 0.8, neck_01: 1 } ramps the blend up the spine. After the base layers are blended, every
// masked node's local rotation is nlerped (and its translation lerped) toward the overlay clip by mask weight x overlay
// amount (the amount fades in and out; asking for a different overlay crossfades between the two clips), before the
// world matrices are built, so the children follow whatever the base layers do to their parents. Unmasked nodes (the
// pelvis bob of a walk) keep the base layers' pose. play() and the base layers are unchanged.
//
// Morph targets (glTF primitive targets, POSITION deltas): a primitive whose targets move something gets its own material and a
// storage buffer of the deltas (target k of vertex v at v * K + k, K = the targets that move). The model keeps up to eight
// weights by name (the names of the file, in the order they are first met):
//
//   model.morphNames                 // [ 'Blink_L', 'Blink_R', 'Gaze_Left', ... ]
//   model.setMorph( 'Blink_L', 1 )   // 0..1 (returns false when the file has no such target); applied by the next update()
//   model.getMorph( name )
//
// The deltas are added in the vertex hook before skinning (so they follow the head bone), and last frame's weights are kept for
// the motion vectors.
//
// Pose override: model.poseOverride = ( model ) => { ... } runs after the base layers and the overlay and before the world
// matrices are built; it may rewrite model.local[ i ].r / .t (a ragdoll or any procedural bone driver; src/player/Avatar.js).
//
// GPU: one storage buffer per model with 2 x joints mat4 (this frame, then the previous frame), then one more mat4 that holds
// the morph weights (columns 0 and 1: this frame's eight, columns 2 and 3: last frame's).
// The material vertex hook skins position and normal with 4 weights and writes the world position,
// the normal and last frame's world position (useWorld), so motion vectors (TAA, motion blur)
// include the animation, and the shadow / depth passes skin the same way (same hook).
//
// Geometry attributes: skinIndex (vec4u, Uint32Array) and skinWeight (vec4f).
// Materials: materials( { gltfMaterial, name, textures: { albedo, normal, orm }, alphaMode } )
// may return Material options to override / extend the default glTF PBR material (see skinnedMaterial).

// slots: the model's morph weight slot of each target of this primitive's skinMorph buffer ( [] = no morphs )
const SKIN_VERTEX = ( J, slots = [] ) => /* wgsl */`
	let sj = v.skinIndex;
	let sw = v.skinWeight;
	let sk = skinJoints[ sj.x ] * sw.x + skinJoints[ sj.y ] * sw.y + skinJoints[ sj.z ] * sw.z + skinJoints[ sj.w ] * sw.w;
	let skp = skinJoints[ sj.x + ${ J }u ] * sw.x + skinJoints[ sj.y + ${ J }u ] * sw.y + skinJoints[ sj.z + ${ J }u ] * sw.z + skinJoints[ sj.w + ${ J }u ] * sw.w;
	var mp = v.position;
	var mpp = v.position;
${ slots.length ? `	let mw = skinJoints[ ${ 2 * J }u ];
	let mb = v.vertex * ${ slots.length }u;
${ slots.map( ( s, k ) => `	{ let d = skinMorph[ mb + ${ k }u ].xyz; mp += d * mw[ ${ s >> 2 } ][ ${ s & 3 } ]; mpp += d * mw[ ${ ( s >> 2 ) + 2 } ][ ${ s & 3 } ]; }` ).join( '\n' ) }` : '' }
	let lp = vec4f( mp, 1.0 );
	let lpp = vec4f( mpp, 1.0 );
	let lm = v.model * sk;
	v.useWorld = true;
	v.worldPos = ( lm * lp ).xyz;
	v.worldNormal = cofactor3( lm ) * v.normal;
	v.prevWorldPos = ( v.prevModel * skp * lpp ).xyz;
`;

// Default glTF-style PBR surface: base colour (sRGB, alpha), ORM (G roughness, B metalness), tangent-space
// normal map through a derivative TBN. Extra surface code (e.g. skin / cloth tweaks) runs after it.
// morph: null or { buffer: StorageBuffer of vec4f deltas, slots: [ weight slot of each target ] }
export function skinnedMaterial( { name, joints, jointBuffer, morph = null, textures = {}, alphaMode = 'OPAQUE', alphaCutoff = 0.5, doubleSided = false, surface = '', uniforms = {}, color = null, roughness = 1, metalness = 1, defines = {}, modules = [] } ) {

	const T = {};
	if ( textures.albedo ) T.chAlbedo = textures.albedo;
	if ( textures.normal ) T.chNormal = textures.normal;
	if ( textures.orm ) T.chOrm = textures.orm;
	const code = /* wgsl */`
#if HAS_ALBEDO
	let ca = textureSample( chAlbedo, smpAnisoRepeat, in.uv );
	s.albedo *= ca.rgb;
	s.alpha *= ca.a;
#endif
#if HAS_ORM
	let orm = textureSample( chOrm, smpAnisoRepeat, in.uv );
	s.roughness *= orm.g;
	s.metalness *= orm.b;
#endif
#if HAS_NORMAL
	let nm = textureSample( chNormal, smpAnisoRepeat, in.uv ).xyz * 2.0 - 1.0;
	s.normal = perturbNormalByMap( in.P, in.N, in.uv, nm );
#endif
${ surface }
`;
	return new Material( {
		name,
		modules,
		attributes: { skinIndex: 'vec4u', skinWeight: 'vec4f' },
		storage: morph ? { skinJoints: { storage: jointBuffer, access: 'read' }, skinMorph: { storage: morph.buffer, access: 'read' } } : { skinJoints: { storage: jointBuffer, access: 'read' } },
		textures: T,
		uniforms,
		color: color || undefined,
		roughness,
		metalness,
		vertex: SKIN_VERTEX( joints, morph ? morph.slots : [] ),
		surface: code,
		side: doubleSided ? 'double' : 'front',
		alphaTest: alphaMode === 'MASK' || alphaMode === 'BLEND' ? alphaCutoff : 0,
		// CHARACTER_RIM: the golden hour rim light of render/wgsl/lighting.js (wave 18F; a caller may pass 0)
		defines: { HAS_ALBEDO: T.chAlbedo ? 1 : 0, HAS_ORM: T.chOrm ? 1 : 0, HAS_NORMAL: T.chNormal ? 1 : 0, CHARACTER_RIM: 1, ...defines },
	} );

}

// ---- pose math on flat arrays (column-major 4x4)

function composeTRS( out, o, t, r, s ) {

	const x = r[ 0 ], y = r[ 1 ], z = r[ 2 ], w = r[ 3 ];
	const x2 = x + x, y2 = y + y, z2 = z + z;
	const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
	const sx = s[ 0 ], sy = s[ 1 ], sz = s[ 2 ];
	out[ o ] = ( 1 - ( yy + zz ) ) * sx; out[ o + 1 ] = ( xy + wz ) * sx; out[ o + 2 ] = ( xz - wy ) * sx; out[ o + 3 ] = 0;
	out[ o + 4 ] = ( xy - wz ) * sy; out[ o + 5 ] = ( 1 - ( xx + zz ) ) * sy; out[ o + 6 ] = ( yz + wx ) * sy; out[ o + 7 ] = 0;
	out[ o + 8 ] = ( xz + wy ) * sz; out[ o + 9 ] = ( yz - wx ) * sz; out[ o + 10 ] = ( 1 - ( xx + yy ) ) * sz; out[ o + 11 ] = 0;
	out[ o + 12 ] = t[ 0 ]; out[ o + 13 ] = t[ 1 ]; out[ o + 14 ] = t[ 2 ]; out[ o + 15 ] = 1;

}

function mul4( out, o, a, ao, b, bo ) {

	for ( let c = 0; c < 4; c ++ ) {

		const b0 = b[ bo + c * 4 ], b1 = b[ bo + c * 4 + 1 ], b2 = b[ bo + c * 4 + 2 ], b3 = b[ bo + c * 4 + 3 ];
		for ( let r = 0; r < 4; r ++ ) out[ o + c * 4 + r ] = a[ ao + r ] * b0 + a[ ao + 4 + r ] * b1 + a[ ao + 8 + r ] * b2 + a[ ao + 12 + r ] * b3;

	}

}

// sample one channel at time t into out (w components), cached segment index
function sampleChannel( ch, t, out ) {

	const T = ch.times, V = ch.values, w = ch.path === 'rotation' ? 4 : 3, n = T.length;
	if ( n === 1 || t <= T[ 0 ] ) {

		for ( let c = 0; c < w; c ++ ) out[ c ] = V[ c ];
		return;

	}

	if ( t >= T[ n - 1 ] ) {

		for ( let c = 0; c < w; c ++ ) out[ c ] = V[ ( n - 1 ) * w + c ];
		return;

	}

	let k = ch._k || 0;
	if ( T[ k ] > t ) k = 0;
	while ( k < n - 2 && T[ k + 1 ] <= t ) k ++;
	ch._k = k;
	const f = ch.step ? 0 : ( t - T[ k ] ) / ( T[ k + 1 ] - T[ k ] );
	const a = k * w, b = ( k + 1 ) * w;
	if ( w === 4 ) {

		// nlerp along the shorter arc
		const d = V[ a ] * V[ b ] + V[ a + 1 ] * V[ b + 1 ] + V[ a + 2 ] * V[ b + 2 ] + V[ a + 3 ] * V[ b + 3 ];
		const sb = d < 0 ? - f : f;
		let x = V[ a ] * ( 1 - f ) + V[ b ] * sb, y = V[ a + 1 ] * ( 1 - f ) + V[ b + 1 ] * sb, z = V[ a + 2 ] * ( 1 - f ) + V[ b + 2 ] * sb, q = V[ a + 3 ] * ( 1 - f ) + V[ b + 3 ] * sb;
		const l = 1 / Math.hypot( x, y, z, q );
		out[ 0 ] = x * l; out[ 1 ] = y * l; out[ 2 ] = z * l; out[ 3 ] = q * l;

	} else for ( let c = 0; c < 3; c ++ ) out[ c ] = V[ a + c ] + ( V[ b + c ] - V[ a + c ] ) * f;

}

export class SkinnedModel {

	// gltf: result of loadGLB / parseGLB. Uses the first skin.
	static async create( gltf, { materials = null, textureSize = null } = {} ) {

		const m = new SkinnedModel( gltf );
		await m._buildMeshes( materials );
		return m;

	}

	constructor( gltf ) {

		this.gltf = gltf;
		const skin = gltf.skins[ 0 ];
		if ( ! skin ) throw new Error( 'SkinnedModel: no skin' );
		this.skin = skin;
		const N = gltf.nodes.length;
		this.nodeCount = N;
		this.joints = skin.joints.length;
		// rest pose, current local TRS and world matrices per node
		this.rest = gltf.nodes.map( ( n ) => ( { t: Float32Array.from( n.t ), r: Float32Array.from( n.r ), s: Float32Array.from( n.s ) } ) );
		this.local = gltf.nodes.map( ( n ) => ( { t: Float32Array.from( n.t ), r: Float32Array.from( n.r ), s: Float32Array.from( n.s ) } ) );
		this.world = new Float32Array( N * 16 );
		this._localM = new Float32Array( 16 );
		// parent-first traversal order
		this.order = [];
		this.parent = new Int32Array( N ).fill( - 1 );
		const visit = ( i ) => {

			this.order.push( i );
			for ( const c of gltf.nodes[ i ].children ) {

				this.parent[ c ] = i;
				visit( c );

			}

		};

		for ( const r of gltf.roots ) visit( r );
		this.jointData = new Float32Array( this.joints * 32 + 16 ); // + the morph weights mat4 (this frame's eight, last frame's eight)
		this.jointBuffer = new StorageBuffer( { label: 'skinJoints', count: this.joints * 2 + 1, type: 'mat4x4f' } );
		this.morphNames = []; // the weight slots by name (filled while the meshes are built)
		this.morphWeights = new Float32Array( 8 );
		this._first = true;
		// clips by name
		this.clips = new Map();
		for ( const a of gltf.animations ) this.clips.set( a.name, a );
		this.layers = []; // { clip, time, weight, target, fadeRate, loop, speed }
		// blend accumulators
		this._acc = gltf.nodes.map( () => ( { t: new Float32Array( 3 ), r: new Float32Array( 4 ), s: new Float32Array( 3 ), wt: 0, wr: 0, ws: 0 } ) );
		this._tmp = new Float32Array( 4 );
		this.group = new Group();
		this.group.name = 'SkinnedModel';
		this.meshes = [];
		this.materials = [];
		this.onClipEnd = null;
		// overlay layers (see the header): clips sampled over the masked nodes, an overall amount that fades in and out
		this.overlays = []; // { clip, time, weight, target, fade, loop, speed, ended, w: mask weight per node, ch: rotation channels of masked nodes, chT: translation channels }
		this.onOverlayEnd = null;
		this.poseOverride = null; // fn( model ) called after the base layers and the overlay, before the world matrices
		this._ovAmt = 0;
		this._ovTarget = 0;
		this._ovFade = 0.25;
		this._ovMasks = new Map();
		this._ovR = new Float32Array( N * 4 );
		this._ovT = new Float32Array( N * 3 );
		this._ovW = new Float32Array( N );
		this._ovWT = new Float32Array( N );
		this._ovNodes = new Int32Array( N * 2 );
		this._pose();

	}

	async _buildMeshes( materialOptions ) {

		const g = this.gltf;
		// textures (shared between materials that use the same image, and between every model built from this gltf)
		const texCache = g.__texCache || ( g.__texCache = new Map() );
		const tex = async ( info, srgb ) => {

			if ( ! info ) return null;
			const src = g.textures[ info.index ].source;
			const key = src + ( srgb ? 's' : 'l' );
			if ( ! texCache.has( key ) ) {

				const im = g.images[ src ];
				let px = await decodeImage( im.bytes, im.mimeType );
				im.bytes = null; // decoded once (texCache keeps the texture): free the file's image data
				const pb = globalThis.__phoneBudget; // phones: 256 px character maps (56 maps: 75 MB -> 19 MB)
				if ( pb && pb.charTexture ) px = capImage( px, pb.charTexture );
				const t = new Texture( { label: 'char' + src, width: px.width, height: px.height, format: srgb ? 'rgba8unorm-srgb' : 'rgba8unorm', data: px.data, mips: true, usage: [ 'sample', 'copyDst' ], sampler: 'anisoRepeat' } );
				t.getGPU();
				generateMipmaps( t );
				texCache.set( key, t );

			}

			return texCache.get( key );

		};

		// every skinned mesh node (a character may be split into body and hair / crest meshes on one skin)
		const prims = [];
		this.morphBuffers = [];
		for ( const n of g.nodes ) if ( n.mesh !== undefined && n.skin !== undefined ) prims.push( ...g.meshes[ n.mesh ] );
		const matCache = new Map();
		for ( const p of prims ) {

			// the geometry is built once per primitive and shared by every model of this gltf (the renderer then shares
			// the GPU buffers too); nothing per model is written into it (skinning and morphs run on the GPU)
			let geo = p.__geo;
			if ( ! geo ) {

				geo = p.__geo = new BufferGeometry();
				const A = p.attributes;
				geo.setAttribute( 'position', new BufferAttribute( A.POSITION.array, 3 ) );
				if ( A.NORMAL ) geo.setAttribute( 'normal', new BufferAttribute( A.NORMAL.array, 3 ) );
				if ( A.TEXCOORD_0 ) geo.setAttribute( 'uv', new BufferAttribute( toFloat( A.TEXCOORD_0 ), 2 ) );
				geo.setAttribute( 'skinIndex', new BufferAttribute( Uint32Array.from( A.JOINTS_0.array ), 4 ) );
				geo.setAttribute( 'skinWeight', new BufferAttribute( normalizeWeights( toFloat( A.WEIGHTS_0 ) ), 4 ) );
				if ( p.indices ) geo.setIndex( new BufferAttribute( p.indices instanceof Uint32Array || p.indices instanceof Uint16Array ? p.indices : Uint32Array.from( p.indices ), 1 ) );
				geo.computeBoundingSphere();
				geo.__shared = true;

			}

			// morph targets that move something: a delta buffer and a material of its own (the buffer is bound to the material)
			const morph = this._morphFor( p );
			const key = morph ? 'morph' + this.morphBuffers.length + ':' + p.material : p.material;
			if ( morph ) this.morphBuffers.push( morph.buffer );
			let mat = matCache.get( key );
			if ( ! mat ) {

				const gm = g.materials[ p.material ] || {};
				const pbr = gm.pbrMetallicRoughness || {};
				const info = {
					gltfMaterial: gm,
					name: gm.name || 'material',
					textures: {
						albedo: await tex( pbr.baseColorTexture, true ),
						orm: await tex( pbr.metallicRoughnessTexture, false ),
						normal: await tex( gm.normalTexture, false ),
					},
					alphaMode: gm.alphaMode || 'OPAQUE',
				};
				const extra = materialOptions ? materialOptions( info ) || {} : {};
				mat = skinnedMaterial( {
					name: 'skinned-' + info.name,
					joints: this.joints,
					jointBuffer: this.jointBuffer,
					morph,
					textures: info.textures,
					alphaMode: info.alphaMode,
					alphaCutoff: gm.alphaCutoff ?? 0.5,
					doubleSided: !! gm.doubleSided,
					color: pbr.baseColorFactor ? pbr.baseColorFactor.slice( 0, 3 ) : null, // the factor multiplies the texture (the eyes, pupils and lids have no texture, only the factor)
					roughness: pbr.roughnessFactor ?? 1,
					metalness: pbr.metallicFactor ?? 1,
					...extra,
				} );
				matCache.set( key, mat );
				this.materials.push( mat );

			}

			const mesh = new Mesh( geo, mat );
			mesh.name = 'skinned:' + ( g.materials[ p.material ]?.name || '' );
			// skinned: the bind-pose bounds don't follow the animation; _pose() fits a sphere round the joints every
			// update (this.bounds), and until the first pose the mesh is never culled
			mesh.frustumCulled = false;
			mesh.castShadow = true;
			if ( /_(Pupil|Rim|Lid)_[lr]$/.test( mesh.name ) ) Object.defineProperty( mesh, 'castShadow', { get: () => false, set() {}, configurable: true } ); // wave 20A: eyes cast no shadow
			mesh.receiveShadow = true;
			this.group.add( mesh );
			this.meshes.push( mesh );

		}

	}

	// the delta buffer of a primitive's morph targets (the ones that move at least one vertex) and their weight slots; null if none
	_morphFor( p ) {

		const used = [];
		( p.targets || [] ).forEach( ( t, k ) => {

			const D = t.POSITION;
			if ( ! D ) return;
			let big = false;
			for ( let i = 0; i < D.length && ! big; i ++ ) big = Math.abs( D[ i ] ) > 1e-4;
			if ( ! big ) return;
			const name = p.targetNames[ k ];
			let slot = this.morphNames.indexOf( name );
			if ( slot < 0 && this.morphNames.length < 8 ) slot = this.morphNames.push( name ) - 1;
			if ( slot >= 0 ) used.push( { slot, D } );

		} );
		if ( ! used.length ) return null;
		const n = p.attributes.POSITION.array.length / 3, K = used.length;
		const data = new Float32Array( n * K * 4 );
		used.forEach( ( u, k ) => {

			for ( let i = 0; i < n; i ++ ) {

				const o = ( i * K + k ) * 4;
				data[ o ] = u.D[ i * 3 ]; data[ o + 1 ] = u.D[ i * 3 + 1 ]; data[ o + 2 ] = u.D[ i * 3 + 2 ];

			}

		} );
		return { buffer: new StorageBuffer( { label: 'skinMorph', count: n * K, type: 'vec4f', data } ), slots: used.map( ( u ) => u.slot ) };

	}

	clipNames() {

		return [ ...this.clips.keys() ];

	}

	clipDuration( name ) {

		const c = this.clips.get( name );
		return c ? c.duration : 0;

	}

	// Crossfade to a clip. { fade: seconds, loop, speed, from: start time }
	play( name, { fade = 0.4, loop = true, speed = 1, from = 0 } = {} ) {

		const clip = this.clips.get( name );
		if ( ! clip ) throw new Error( 'SkinnedModel: no clip ' + name );
		const cur = this.layers.find( ( l ) => l.clip === clip && l.target === 1 );
		if ( cur ) return cur;
		const layer = { clip, time: from, weight: this.layers.length ? 0 : 1, target: 1, fade: Math.max( fade, 1e-3 ), loop, speed, ended: false };
		for ( const l of this.layers ) {

			l.target = 0;
			l.fade = layer.fade;

		}

		this.layers.push( layer );
		return layer;

	}

	get current() {

		const l = this.layers.find( ( x ) => x.target === 1 );
		return l ? l.clip.name : null;

	}

	// Overlay a clip on the masked nodes (see the header). { mask, fade, loop, speed, from, restart }. Returns the layer
	// (its `speed` can be changed per frame); null fades the overlay out. Asking again for the clip already overlaid keeps
	// it playing (speed / loop updated) unless restart is set.
	setOverlay( name, { mask = null, fade = 0.25, loop = true, speed = 1, from = 0, restart = false } = {} ) {

		fade = Math.max( fade, 1e-3 );
		if ( name === null || name === undefined ) {

			this._ovTarget = 0;
			this._ovFade = fade;
			return null;

		}

		const clip = this.clips.get( name );
		if ( ! clip ) throw new Error( 'SkinnedModel: no clip ' + name );
		const key = mask ? JSON.stringify( mask ) : '*';
		let w = this._ovMasks.get( key );
		if ( ! w ) {

			w = this._maskWeights( mask );
			this._ovMasks.set( key, w );

		}

		const cur = this.overlays.find( ( l ) => l.clip === clip && l.w === w && l.target === 1 );
		if ( cur ) {

			cur.speed = speed;
			cur.loop = loop;
			if ( restart ) {

				cur.time = from;
				cur.ended = false;

			}

			if ( this._ovTarget !== 1 ) this._ovFade = fade;
			this._ovTarget = 1;
			return cur;

		}

		const layer = {
			clip, time: from, weight: 1, target: 1, fade, loop, speed, ended: false, w,
			ch: clip.channels.filter( ( c ) => c.path === 'rotation' && w[ c.node ] > 0 ),
			chT: clip.channels.filter( ( c ) => c.path === 'translation' && w[ c.node ] > 0 ),
		};
		if ( this._ovAmt < 1e-3 ) this.overlays.length = 0; // nothing visible yet: the clip is the whole overlay, the amount fades up
		else {

			// crossfade from what is overlaid now
			layer.weight = 0;
			for ( const l of this.overlays ) {

				l.target = 0;
				l.fade = fade;

			}

		}

		this.overlays.push( layer );
		this._ovTarget = 1;
		this._ovFade = fade;
		return layer;

	}

	// the overlaid clip's name, or null
	get overlay() {

		if ( this._ovTarget !== 1 ) return null;
		const l = this.overlays.find( ( x ) => x.target === 1 );
		return l ? l.clip.name : null;

	}

	// per-node mask weights from a mask spec (null, names, { name: weight }): a named node's weight goes to its descendants
	_maskWeights( mask ) {

		const N = this.nodeCount, w = new Float32Array( N );
		if ( ! mask ) return w.fill( 1 );
		const ex = new Float32Array( N ).fill( - 1 );
		const entries = Array.isArray( mask ) ? mask.map( ( n ) => [ n, 1 ] ) : Object.entries( mask );
		for ( const [ n, v ] of entries ) {

			const i = this.gltf.nodes.findIndex( ( x ) => x.name === n );
			if ( i >= 0 ) ex[ i ] = v;

		}

		for ( const i of this.order ) {

			const p = this.parent[ i ];
			w[ i ] = ex[ i ] >= 0 ? ex[ i ] : p >= 0 ? w[ p ] : 0;

		}

		return w;

	}

	// Hold the current pose: last frame's joints = this frame's (no motion vectors). Call it when
	// the model stops being updated (off screen, far away): otherwise the last step would stay in
	// the joint buffer and the model would read as moving forever (TAA / motion-blur smear).
	hold() {

		if ( this._held ) return;
		const J = this.joints, D = this.jointData;
		D.copyWithin( J * 16, 0, J * 16 );
		D.copyWithin( J * 32 + 8, J * 32, J * 32 + 8 );
		this.jointBuffer.write( D );
		this._held = true;

	}

	// dt = 0: evaluate without motion (a new clip / teleport: no motion vectors)
	update( dt ) {

		if ( dt === 0 ) this._first = true;
		this._held = false;

		// advance and fade layers
		for ( const l of this.layers ) {

			l.time += dt * l.speed;
			const d = l.clip.duration;
			if ( l.time >= d ) {

				if ( l.loop && d > 0 ) l.time %= d;
				else {

					l.time = d;
					if ( ! l.ended ) {

						l.ended = true;
						if ( l.target === 1 && this.onClipEnd ) this.onClipEnd( l.clip.name );

					}

				}

			}

			const step = dt / l.fade;
			l.weight = l.target > l.weight ? Math.min( l.target, l.weight + step ) : Math.max( l.target, l.weight - step );

		}

		this.layers = this.layers.filter( ( l ) => l.target > 0 || l.weight > 1e-4 );
		// renormalise (fades in and out at the same rate keep the sum ~1)
		let W = 0;
		for ( const l of this.layers ) W += l.weight;
		if ( W > 1e-4 ) for ( const l of this.layers ) l.weight /= W;
		if ( this.overlays.length ) this._advanceOverlays( dt );
		this._pose();

	}

	_advanceOverlays( dt ) {

		for ( const l of this.overlays ) {

			l.time += dt * l.speed;
			const d = l.clip.duration;
			if ( l.time >= d ) {

				if ( l.loop && d > 0 ) l.time %= d;
				else {

					l.time = d;
					if ( ! l.ended ) {

						l.ended = true;
						if ( l.target === 1 && this.onOverlayEnd ) this.onOverlayEnd( l.clip.name );

					}

				}

			}

			const step = dt / l.fade;
			l.weight = l.target > l.weight ? Math.min( l.target, l.weight + step ) : Math.max( l.target, l.weight - step );

		}

		const a = dt / this._ovFade;
		this._ovAmt = this._ovTarget > this._ovAmt ? Math.min( this._ovTarget, this._ovAmt + a ) : Math.max( this._ovTarget, this._ovAmt - a );
		if ( this._ovTarget === 0 && this._ovAmt <= 1e-4 ) {

			this.overlays.length = 0;
			this._ovAmt = 0;
			return;

		}

		this.overlays = this.overlays.filter( ( l ) => l.target > 0 || l.weight > 1e-4 );
		let W = 0;
		for ( const l of this.overlays ) W += l.weight;
		if ( W > 1e-4 ) for ( const l of this.overlays ) l.weight /= W;

	}

	// nlerp the masked nodes' local rotations toward the overlay clips (after the base blend, before the world matrices)
	_applyOverlay() {

		const R = this._ovR, Ws = this._ovW, nodes = this._ovNodes, tmp = this._tmp;
		let n = 0;
		for ( const l of this.overlays ) {

			if ( l.weight <= 0 ) continue;
			const w = l.w;
			for ( const ch of l.ch ) {

				const i = ch.node, om = l.weight * w[ i ];
				if ( om <= 0 ) continue;
				sampleChannel( ch, l.time, tmp );
				const o = i * 4;
				if ( Ws[ i ] === 0 ) {

					nodes[ n ++ ] = i;
					R[ o ] = R[ o + 1 ] = R[ o + 2 ] = R[ o + 3 ] = 0;

				}

				const d = R[ o ] * tmp[ 0 ] + R[ o + 1 ] * tmp[ 1 ] + R[ o + 2 ] * tmp[ 2 ] + R[ o + 3 ] * tmp[ 3 ];
				const s = d < 0 ? - om : om;
				R[ o ] += tmp[ 0 ] * s; R[ o + 1 ] += tmp[ 1 ] * s; R[ o + 2 ] += tmp[ 2 ] * s; R[ o + 3 ] += tmp[ 3 ] * s;
				Ws[ i ] += om;

			}

		}

		// translations (a prop socket the clip moves, e.g. the palm point of the rod): lerped by the same weights
		const T = this._ovT, Wt = this._ovWT;
		let nt = 0;
		for ( const l of this.overlays ) {

			if ( l.weight <= 0 ) continue;
			for ( const ch of l.chT ) {

				const i = ch.node, om = l.weight * l.w[ i ];
				if ( om <= 0 ) continue;
				sampleChannel( ch, l.time, tmp );
				const o = i * 3;
				if ( Wt[ i ] === 0 ) {

					nodes[ n + nt ++ ] = i;
					T[ o ] = T[ o + 1 ] = T[ o + 2 ] = 0;

				}

				T[ o ] += tmp[ 0 ] * om; T[ o + 1 ] += tmp[ 1 ] * om; T[ o + 2 ] += tmp[ 2 ] * om;
				Wt[ i ] += om;

			}

		}

		for ( let k = 0; k < nt; k ++ ) {

			const i = nodes[ n + k ], o = i * 3, Lt = this.local[ i ].t;
			const alpha = Math.min( 1, this._ovAmt * Wt[ i ] ), inv = alpha / Wt[ i ];
			Wt[ i ] = 0;
			Lt[ 0 ] += ( T[ o ] * inv - Lt[ 0 ] * alpha ); Lt[ 1 ] += ( T[ o + 1 ] * inv - Lt[ 1 ] * alpha ); Lt[ 2 ] += ( T[ o + 2 ] * inv - Lt[ 2 ] * alpha );

		}

		for ( let k = 0; k < n; k ++ ) {

			const i = nodes[ k ], o = i * 4, L = this.local[ i ].r;
			const alpha = Math.min( 1, this._ovAmt * Ws[ i ] );
			Ws[ i ] = 0;
			let x = R[ o ], y = R[ o + 1 ], z = R[ o + 2 ], w = R[ o + 3 ];
			const m = Math.hypot( x, y, z, w );
			if ( m < 1e-9 || alpha <= 0 ) continue;
			x /= m; y /= m; z /= m; w /= m;
			const d = L[ 0 ] * x + L[ 1 ] * y + L[ 2 ] * z + L[ 3 ] * w;
			const sb = d < 0 ? - alpha : alpha;
			const qx = L[ 0 ] * ( 1 - alpha ) + x * sb, qy = L[ 1 ] * ( 1 - alpha ) + y * sb, qz = L[ 2 ] * ( 1 - alpha ) + z * sb, qw = L[ 3 ] * ( 1 - alpha ) + w * sb;
			const l = 1 / Math.hypot( qx, qy, qz, qw );
			L[ 0 ] = qx * l; L[ 1 ] = qy * l; L[ 2 ] = qz * l; L[ 3 ] = qw * l;

		}

	}

	// evaluate the blended pose, world matrices and joint matrices; upload
	_pose() {

		const N = this.nodeCount, acc = this._acc, tmp = this._tmp;
		for ( let i = 0; i < N; i ++ ) {

			const a = acc[ i ];
			a.wt = a.wr = a.ws = 0;
			a.t.fill( 0 ); a.r.fill( 0 ); a.s.fill( 0 );

		}

		for ( const l of this.layers ) {

			if ( l.weight <= 0 ) continue;
			for ( const ch of l.clip.channels ) {

				const a = acc[ ch.node ];
				sampleChannel( ch, l.time, tmp );
				if ( ch.path === 'rotation' ) {

					// align hemispheres with what is accumulated
					const d = a.r[ 0 ] * tmp[ 0 ] + a.r[ 1 ] * tmp[ 1 ] + a.r[ 2 ] * tmp[ 2 ] + a.r[ 3 ] * tmp[ 3 ];
					const w = d < 0 ? - l.weight : l.weight;
					for ( let c = 0; c < 4; c ++ ) a.r[ c ] += tmp[ c ] * w;
					a.wr += l.weight;

				} else if ( ch.path === 'translation' ) {

					for ( let c = 0; c < 3; c ++ ) a.t[ c ] += tmp[ c ] * l.weight;
					a.wt += l.weight;

				} else {

					for ( let c = 0; c < 3; c ++ ) a.s[ c ] += tmp[ c ] * l.weight;
					a.ws += l.weight;

				}

			}

		}

		for ( let i = 0; i < N; i ++ ) {

			const a = acc[ i ], L = this.local[ i ], R = this.rest[ i ];
			for ( let c = 0; c < 3; c ++ ) {

				L.t[ c ] = a.t[ c ] + R.t[ c ] * ( 1 - Math.min( a.wt, 1 ) );
				L.s[ c ] = a.s[ c ] + R.s[ c ] * ( 1 - Math.min( a.ws, 1 ) );

			}

			if ( a.wr > 0 ) {

				const rw = 1 - Math.min( a.wr, 1 );
				const d = a.r[ 0 ] * R.r[ 0 ] + a.r[ 1 ] * R.r[ 1 ] + a.r[ 2 ] * R.r[ 2 ] + a.r[ 3 ] * R.r[ 3 ];
				const sr = d < 0 ? - rw : rw;
				let x = a.r[ 0 ] + R.r[ 0 ] * sr, y = a.r[ 1 ] + R.r[ 1 ] * sr, z = a.r[ 2 ] + R.r[ 2 ] * sr, w = a.r[ 3 ] + R.r[ 3 ] * sr;
				const l = 1 / Math.hypot( x, y, z, w );
				L.r[ 0 ] = x * l; L.r[ 1 ] = y * l; L.r[ 2 ] = z * l; L.r[ 3 ] = w * l;

			} else L.r.set( R.r );

		}

		if ( this._ovAmt > 1e-4 && this.overlays.length ) this._applyOverlay();
		if ( this.poseOverride ) this.poseOverride( this ); // e.g. a ragdoll: may rewrite this.local[ i ].r / .t before the world matrices
		const W = this.world, M = this._localM;
		for ( const i of this.order ) {

			const L = this.local[ i ];
			composeTRS( M, 0, L.t, L.r, L.s );
			const p = this.parent[ i ];
			if ( p < 0 ) W.set( M, i * 16 );
			else mul4( W, i * 16, W, p * 16, M, 0 );

		}

		// previous frame's joints -> second half, then this frame's
		const J = this.joints, D = this.jointData, ibm = this.skin.inverseBindMatrices;
		if ( ! this._first ) D.copyWithin( J * 16, 0, J * 16 );
		for ( let j = 0; j < J; j ++ ) mul4( D, j * 16, W, this.skin.joints[ j ] * 16, ibm, j * 16 );
		// morph weights: this frame's at 32 J, last frame's behind them
		const mo = J * 32;
		if ( ! this._first ) D.copyWithin( mo + 8, mo, mo + 8 );
		for ( let k = 0; k < 8; k ++ ) D[ mo + k ] = this.morphWeights[ k ];
		if ( this._first ) {

			D.copyWithin( J * 16, 0, J * 16 );
			D.copyWithin( mo + 8, mo, mo + 8 );
			this._first = false;

		}

		this.jointBuffer.write( D );
		this._fitBounds();

	}

	// The culling sphere of every skinned mesh: round this pose's joints (model space, where the skinned vertices come
	// out) plus a margin for the flesh around the bones. Skinned meshes used to be drawn in every pass wherever they were
	// (frustumCulled false): each resident cost its draws in all three shadow cascades and the main pass, on screen or not.
	_fitBounds() {

		if ( this.cullBounds === false || globalThis.__perfBaseline === true || ! this.meshes || ! this.meshes.length ) return;
		const W = this.world, js = this.skin.joints;
		let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = - Infinity, y1 = - Infinity, z1 = - Infinity;
		for ( let j = 0; j < js.length; j ++ ) {

			const o = js[ j ] * 16;
			const x = W[ o + 12 ], y = W[ o + 13 ], z = W[ o + 14 ];
			if ( x < x0 ) x0 = x; if ( x > x1 ) x1 = x;
			if ( y < y0 ) y0 = y; if ( y > y1 ) y1 = y;
			if ( z < z0 ) z0 = z; if ( z > z1 ) z1 = z;

		}

		if ( ! Number.isFinite( x0 + x1 + y0 + y1 + z0 + z1 ) ) return;
		const half = 0.5 * Math.hypot( x1 - x0, y1 - y0, z1 - z0 );
		const r = half * 1.35 + 0.45; // (hands and the head reach past their joints; hair, hats, a dog's ears)
		for ( const m of this.meshes ) {

			const g = m.geometry;
			if ( ! g.boundingSphere ) g.computeBoundingSphere();
			const s = g.boundingSphere;
			s.center.set( ( x0 + x1 ) / 2, ( y0 + y1 ) / 2, ( z0 + z1 ) / 2 );
			s.radius = r;
			if ( m.__ws ) m.__ws.frame = - 1; // (the renderer's per-frame world sphere)
			m.frustumCulled = true;

		}

	}

	// morph targets by name (see the header): w in 0..1 takes effect at the next update()
	setMorph( name, w ) {

		const k = this.morphNames.indexOf( name );
		if ( k < 0 ) return false;
		this.morphWeights[ k ] = w;
		return true;

	}

	getMorph( name ) {

		const k = this.morphNames.indexOf( name );
		return k < 0 ? 0 : this.morphWeights[ k ];

	}

	hasMorph( name ) {

		return this.morphNames.includes( name );

	}

	// the skinning matrix of a joint (by name): jointWorld * inverseBind, i.e. how far the joint has moved from its bind pose
	// (rotation part = the joint's rotation relative to the bind pose, for look-at in the head's own frame)
	skinMatrix( name, out ) {

		const j = this.skin.joints.findIndex( ( n ) => this.gltf.nodes[ n ].name === name );
		if ( j < 0 ) return null;
		return out.fromArray( this.jointData, j * 16 );

	}

	// model-space matrix of a node (by name), e.g. a hand bone to attach a prop to: out = Matrix4
	nodeMatrix( name, out ) {

		const i = this.gltf.nodes.findIndex( ( n ) => n.name === name );
		if ( i < 0 ) return null;
		return out.fromArray( this.world, i * 16 );

	}

	// world-space position of a node (by name) in model space, e.g. the head for look-at
	nodeWorld( name, out ) {

		const i = this.gltf.nodes.findIndex( ( n ) => n.name === name );
		if ( i < 0 ) return null;
		const W = this.world;
		return out.set( W[ i * 16 + 12 ], W[ i * 16 + 13 ], W[ i * 16 + 14 ] );

	}

	dispose() {

		this.jointBuffer.destroy();
		for ( const b of this.morphBuffers || [] ) b.destroy();
		for ( const m of this.meshes ) if ( ! m.geometry.__shared && m.geometry.dispose ) m.geometry.dispose(); // (shared geometry belongs to the gltf cache)

	}

}

function toFloat( a ) {

	if ( a.array instanceof Float32Array ) return a.array;
	const k = a.normalized ? 1 / ( a.array instanceof Uint8Array ? 255 : a.array instanceof Uint16Array ? 65535 : 1 ) : 1;
	return Float32Array.from( a.array, ( x ) => x * k );

}

function normalizeWeights( w ) {

	for ( let i = 0; i < w.length; i += 4 ) {

		const s = w[ i ] + w[ i + 1 ] + w[ i + 2 ] + w[ i + 3 ];
		if ( s > 0 ) for ( let c = 0; c < 4; c ++ ) w[ i + c ] /= s;
		else w[ i ] = 1;

	}

	return w;

}

import { BufferAttribute, BufferGeometry, Color, Matrix4, Mesh } from '../../engine/index.js';
import { G } from '../../engine/render/Frame.js';
import { loadGLB } from '../../engine/loaders/GLTF.js';
import { prepare, mergePrepared, sphere, mat4 } from '../boat/GeoKit.js';
import { createPropMaterial, PAT } from '../../game/GameMaterials.js';
import { cameraPosition } from '../islands/IslandKit.js';

// The towns' dressing kit (wave 18C): public/models/town/kit.glb, modelled in Blender by tools/town/kit.py (signboards
// with their lettering, street lamps, wall lanterns, benches, window boxes, planters, the fountain, awnings, net racks,
// Blackwater's rum barrels and skull pole, chimney pots). The GLB carries no textures: one glTF material per colour, its
// name the prop material's pattern (wood_*, paint_*, cloth_*, stone_*, iron, rust_*, gold, leaf_* / flower_*, water,
// bone, glow_* = lamp glass that lights up at night). Placements are recorded while a town builds (synchronously); the
// GLB loads once and every placement of a town merges into one prop mesh and one glow mesh (two draws a town), added
// under an anchor mesh the town already owns.
//
//   const kit = new TownKit( { name: 'tidemark' } )
//   kit.place( 'bench', matrix4 )                    (world matrix: the piece's local +z is its front, +y up)
//   kit.glow( geometry, { color, lit, matrix } )     procedural glow geometry (lit windows: lit 0..1 = the night mask)
//   kit.attach( anchor, { cullDistance, phoneCull } ) -> Promise<{ meshes, triangles } | null>  (once the GLB is in)
//   kit.glowMaterial / kit.material; TownKit.night() (0 day .. 1 night, what the glow follows)
//   kit.plants = 'simple' (phones: PHONE_BUDGET.kitPlants): the flower boxes' and planters' leaves and most flowers (1.2 - 1.6k
//   vertices a piece, the kit's heaviest) become one low green dome with one colour of blooms kept on it (370 - 410); wave 20A
//
// NearRelease (wave 20A, phones): a far town lets go of its near meshes' GPU buffers and takes them back on approach, spread
// over frames (the colliders and the CPU-side geometry stay: the rebuild is a re-upload). Tidemark.js / Blackwater.js.
//
// The glow material: the prop material whose emissive (a uniform set per frame from the night) is scaled per vertex by
// aux.w (lit) and tinted warm, so one draw holds lamps that always burn at night and windows some of which stay dark.

export const KIT_URL = 'models/town/kit.glb';

const base = () => {

	try {

		return ( import.meta.env && import.meta.env.BASE_URL ) || '/';

	} catch ( e ) {

		return '/';

	}

};

// material name -> prop-material channels
export function channelsOf( name ) {

	const n = ( name || '' ).toLowerCase();
	if ( n.startsWith( 'glow' ) ) return { rough: 0.3, metal: 0, pattern: 0, glow: true };
	if ( n.startsWith( 'wood' ) ) return { rough: 0.88, metal: 0, pattern: PAT.wood };
	if ( n.startsWith( 'cloth' ) ) return { rough: 0.92, metal: 0, pattern: PAT.cloth };
	if ( n.startsWith( 'rust' ) ) return { rough: 0.7, metal: 0.4, pattern: PAT.rusty };
	if ( n === 'iron' ) return { rough: 0.5, metal: 0.7, pattern: 0 };
	if ( n === 'gold' ) return { rough: 0.35, metal: 0.9, pattern: 0 };
	if ( n === 'water' ) return { rough: 0.04, metal: 0.1, pattern: 0 };
	if ( n.startsWith( 'paint' ) ) return { rough: 0.55, metal: 0, pattern: 0 };
	if ( n.startsWith( 'leaf' ) || n.startsWith( 'flower' ) ) return { rough: 0.75, metal: 0, pattern: 0 };
	return { rough: 0.93, metal: 0, pattern: 0 }; // stone, brick, terracotta, soil, bone
}

// the night factor every glow follows (the frame's night uniform; 0 when the engine has not set it)
export function night() {

	const v = G.night ? G.night.value : 0;
	return Math.max( 0, Math.min( 1, ( v - 0.1 ) / 0.6 ) );

}

export function createGlowMaterial( name = 'townGlow' ) {

	const m = createPropMaterial( name );
	m.surface += /* wgsl */`
	s.emissive = s.emissive * vec3f( 1.0, 0.8, 0.52 ) * in.vs.vAux.w;
`;
	m.side = 'double';
	return m;

}

// the parsed kit: piece name -> [ { position, normal, index, channels, color } ] (shared by every town)
let _kit = null;
export function loadKit( url = base() + KIT_URL ) {

	if ( ! _kit ) _kit = loadGLB( url ).then( parseKit ).catch( ( e ) => {

		_kit = null;
		if ( typeof console !== 'undefined' && ! globalThis.__quietKit ) console.warn( 'town kit: could not load ' + url, e && e.message ? e.message : e );
		return null;

	} );
	return _kit;

}

export function parseKit( gltf ) {

	const pieces = {};
	const f32 = ( a ) => ( a.array instanceof Float32Array ? a.array : Float32Array.from( a.array ) );
	for ( const ni of gltf.roots ) {

		const node = gltf.nodes[ ni ];
		if ( node.mesh === undefined ) continue;
		const prims = [];
		for ( const p of gltf.meshes[ node.mesh ] ) {

			if ( p.mode !== undefined && p.mode !== 4 ) continue;
			if ( ! p.attributes.POSITION ) continue;
			const gm = gltf.materials[ p.material ?? 0 ] || {};
			const f = ( gm.pbrMetallicRoughness && gm.pbrMetallicRoughness.baseColorFactor ) || [ 1, 1, 1, 1 ];
			prims.push( {
				name: gm.name || '',
				position: f32( p.attributes.POSITION ),
				normal: p.attributes.NORMAL ? f32( p.attributes.NORMAL ) : null,
				index: p.indices ? Uint32Array.from( p.indices ) : null,
				color: [ f[ 0 ], f[ 1 ], f[ 2 ] ], // linear (glTF base colour factors are linear)
				...channelsOf( gm.name ),
			} );

		}

		pieces[ node.name ] = prims;

	}

	return pieces;

}

export function pieceTriangles( prims ) {

	let n = 0;
	for ( const p of prims || [] ) n += ( p.index ? p.index.length : p.position.length / 3 ) / 3;
	return n;

}

function geometryOf( p ) {

	const g = new BufferGeometry();
	g.setAttribute( 'position', new BufferAttribute( p.position.slice(), 3 ) );
	if ( p.normal ) g.setAttribute( 'normal', new BufferAttribute( p.normal.slice(), 3 ) );
	if ( p.index ) g.setIndex( new BufferAttribute( p.index.slice(), 1 ) );
	return g;

}

// a linear [ r, g, b ] as the GeoKit colour (a Color is taken as is; numbers would be read as sRGB hex)
const linColor = ( c ) => new Color( c[ 0 ], c[ 1 ], c[ 2 ] );

export class TownKit {

	constructor( { name = 'town', material = null, glowMaterial = null, plants = undefined } = {} ) {

		this.name = name;
		// (phones: the plant pieces simplified; 'full' keeps them)
		this.plants = plants ?? ( globalThis.__phoneBudget && globalThis.__phoneBudget.kitPlants ) ?? 'full';
		this.placements = [];
		this.glowParts = [];
		this.material = material;
		this.glowMaterial = glowMaterial;
		this.meshes = [];

	}

	place( piece, matrix ) {

		this.placements.push( { piece, matrix: matrix.clone ? matrix.clone() : new Matrix4().copy( matrix ) } );

	}

	// procedural glow geometry (a window pane, a lamp glass) for the glow mesh: lit 0..1
	glow( geometry, { color = 0x2a3036, lit = 1, matrix = null } = {} ) {

		const g = prepare( geometry, { color, rough: 0.15, metal: 0, pattern: 0, anim: lit, matrix } );
		this.glowParts.push( g );

	}

	count( piece ) {

		return this.placements.filter( ( p ) => p.piece === piece ).length;

	}

	// the merged meshes once the kit is in; relative to the anchor's position (the anchor's geometry was re-centred)
	async attach( anchor, { cullDistance = 0, cullRadius = 0, url = undefined } = {} ) {

		const pieces = await loadKit( url );
		return this.build( pieces, anchor, { cullDistance, cullRadius } );

	}

	build( pieces, anchor = null, { cullDistance = 0, cullRadius = 0 } = {} ) {

		const P = [], L = [ ...this.glowParts ];
		const missing = new Set();
		const rel = new Matrix4();
		if ( anchor ) {

			if ( anchor.updateMatrixWorld ) anchor.updateMatrixWorld( true );
			rel.copy( anchor.matrixWorld ).invert();

		}

		const m = new Matrix4();
		if ( pieces ) for ( const pl of this.placements ) {

			const prims = pieces[ pl.piece ];
			if ( ! prims ) {

				missing.add( pl.piece );
				continue;

			}

			m.multiplyMatrices( rel, pl.matrix );
			const simple = this.plants === 'simple' && PLANT_PIECES.has( pl.piece ) ? simplePlants( prims ) : null;
			if ( simple ) P.push( prepare( sphere( 1, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2 ), { color: linColor( simple.color ), rough: 0.78, metal: 0, pattern: 0, matrix: _sm.multiplyMatrices( m, simple.matrix ) } ) );
			for ( const p of simple ? simple.keep : prims ) {

				const g = prepare( geometryOf( p ), { color: linColor( p.color ), rough: p.rough, metal: p.metal, pattern: p.pattern, anim: p.glow ? 1 : 0, matrix: m } );
				( p.glow ? L : P ).push( g );

			}

		}

		// the procedural glow parts are in world space: into the anchor's frame
		if ( anchor ) for ( const g of this.glowParts ) g.applyMatrix4( rel );
		this.glowParts = [];
		const out = [];
		const mk = ( list, mat, suffix, shadow ) => {

			if ( ! list.length || ! mat ) return;
			const mesh = new Mesh( mergePrepared( list ), mat );
			mesh.name = this.name + suffix;
			mesh.castShadow = shadow;
			mesh.receiveShadow = true;
			if ( cullDistance ) {

				mesh.cullDistance = cullDistance;
				mesh.cullRadius = cullRadius;

			}

			if ( mat === this.glowMaterial ) mesh.onBeforeRender = () => updateGlow( mat );
			if ( anchor ) anchor.add( mesh );
			out.push( mesh );

		};
		mk( P, this.material, 'Kit', true );
		mk( L, this.glowMaterial, 'Glow', false );
		this.meshes.push( ...out );
		const triangles = out.reduce( ( s, q ) => s + ( q.geometry.index ? q.geometry.index.count / 3 : 0 ), 0 );
		return { meshes: out, triangles, missing: [ ...missing ] };

	}

}

// ---- wave 20A: the plant pieces on phones (their leaves and flowers are 1,100 - 1,500 of the piece's 1,200 - 1,600 vertices)

export const PLANT_PIECES = new Set( [ 'flowerbox_a', 'flowerbox_b', 'planter' ] );
const _sm = new Matrix4();
const _simple = new WeakMap(); // prims -> { keep, matrix, color } | null

// a piece's prims without the leaves and all but one colour of flowers, and the dome that stands in for them: their bounds
// (from the lowest leaf to 85 % of the highest: the shape of a full box seen from the street) in the leaves' vertex-weighted
// colour, the one kept bloom colour on it. null: nothing to drop
export function simplePlants( prims ) {

	if ( _simple.has( prims ) ) return _simple.get( prims );
	const keep = [], drop = [];
	// (one colour of blooms stays as it is - 180 - 240 vertices - so the box still flowers; the leaves and the other blooms go)
	let bloom = null;
	for ( const p of prims ) {

		if ( ! bloom && /^flower/i.test( p.name ) ) bloom = p;
		else ( /^(leaf|flower)/i.test( p.name ) ? drop : keep ).push( p );

	}

	if ( bloom ) keep.push( bloom );
	let out = null;
	if ( drop.length ) {

		const lo = [ Infinity, Infinity, Infinity ], hi = [ - Infinity, - Infinity, - Infinity ];
		const leaf = [ 0, 0, 0, 0 ], flower = [ 0, 0, 0, 0 ]; // vertex-weighted colour sums, count
		let n = 0;
		for ( const p of drop ) {

			const P = p.position, k = P.length / 3;
			for ( let i = 0; i < P.length; i += 3 ) for ( let a = 0; a < 3; a ++ ) {

				if ( P[ i + a ] < lo[ a ] ) lo[ a ] = P[ i + a ];
				if ( P[ i + a ] > hi[ a ] ) hi[ a ] = P[ i + a ];

			}

			const acc = /^flower/i.test( p.name ) ? flower : leaf;
			for ( let a = 0; a < 3; a ++ ) acc[ a ] += p.color[ a ] * k;
			acc[ 3 ] += k;
			n += k;

		}

		// the leaves' green (the kept blooms sit on it; a mix with the dropped ones' colours reads as bare soil)
		const mean = ( acc, a ) => ( acc[ 3 ] ? acc[ a ] / acc[ 3 ] : 0 );
		const wf = leaf[ 3 ] ? 0 : 1;
		const h = Math.max( 0.02, ( hi[ 1 ] - lo[ 1 ] ) * 0.85 );
		out = {
			keep, color: [ 0, 1, 2 ].map( ( a ) => mean( leaf, a ) * ( 1 - wf ) + mean( flower, a ) * wf ),
			matrix: mat4( ( lo[ 0 ] + hi[ 0 ] ) / 2, lo[ 1 ], ( lo[ 2 ] + hi[ 2 ] ) / 2, 0, 0, 0, Math.max( 0.01, ( hi[ 0 ] - lo[ 0 ] ) / 2 ), h, Math.max( 0.01, ( hi[ 2 ] - lo[ 2 ] ) / 2 ) ),
			vertices: { dropped: n, dome: 36 },
		};

	}

	_simple.set( prims, out );
	return out;

}

// ---- wave 20A: NearRelease (phones) - a far town's near meshes give their GPU buffers back

export const NEAR_RELEASE = {
	release: 1500, // m from the town's centre: beyond this the near meshes' buffers are freed
	rebuild: 1300, // m: within this they are uploaded again (the towns show from ~1,200 m: done before they are seen)
	perFrame: 2 * 1048576, // bytes uploaded a frame while rebuilding (a ~13 MB town: ~7 frames)
	snap: 900, // m: arriving closer than this (a teleport, a respawn) uploads everything at once
};

// the same arrays under new attribute objects (the renderer caches GPU buffers by geometry and by attribute object: a disposed
// geometry's cache entries must never be met again), so freeing copies nothing and the rebuild needs no generator
export function rewrapGeometry( g ) {

	const out = new BufferGeometry();
	const wrap = ( a ) => {

		const b = new BufferAttribute( a.array, a.itemSize, a.normalized );
		b.name = a.name;
		b.usage = a.usage;
		b.gpuType = a.gpuType;
		return b;

	};
	out.name = g.name;
	for ( const k in g.attributes ) out.setAttribute( k, wrap( g.attributes[ k ] ) );
	if ( g.index ) out.setIndex( wrap( g.index ) );
	for ( const gr of g.groups ) out.addGroup( gr.start, gr.count, gr.materialIndex );
	out.drawRange.start = g.drawRange.start;
	out.drawRange.count = g.drawRange.count;
	if ( g.boundingBox ) out.boundingBox = g.boundingBox.clone();
	if ( g.boundingSphere ) out.boundingSphere = g.boundingSphere.clone();
	out.userData = g.userData;
	if ( g.__label !== undefined ) out.__label = g.__label;
	return out;

}

const releasable = ( g ) => !! ( g && g.attributes && g.attributes.position && ! g.indirect && ! Object.values( g.attributes ).some( ( a ) => a.isInterleavedBufferAttribute || a.gpuBuffer ) );

export function geometryBytes( g ) {

	let n = g && g.index ? g.index.array.byteLength : 0;
	if ( g ) for ( const k in g.attributes ) n += g.attributes[ k ].array.byteLength;
	return n;

}

// one mesh's buffers now (the renderer's own upload path, as its first draw would take it); false when it cannot (no
// renderer: the first draw uploads it instead)
export function uploadMesh( mr, mesh ) {

	if ( ! mr || typeof mr._cachedLayout !== 'function' || typeof mr._indexBuffer !== 'function' ) return false;
	const geo = mesh.geometry;
	const mats = Array.isArray( mesh.material ) ? mesh.material : [ mesh.material ];
	try {

		if ( geo.__label === undefined ) geo.__label = geo.name || mesh.name || ( mesh.parent && mesh.parent.name ) || '';
		for ( const mat of new Set( mats ) ) {

			if ( ! mat ) continue;
			const vl = mr._cachedLayout( mesh, geo, mat );
			for ( const vb of vl.buffers ) {

				if ( vb.packed ) mr._packedBuffer( geo, vb );
				else if ( vb.attr ) mr._attributeBuffer( geo, vb.attr );

			}

		}

		mr._indexBuffer( geo );
		return true;

	} catch ( e ) {

		return false;

	}

}

//   const rel = new NearRelease( { roots: [ meshA, groupB ] } )   roots: what the island hides while released (their subtrees' meshes go)
//   rel.update( d ) -> 'live' | 'released' | 'rebuilding'         d: camera distance to the town; call after the island set its own
//                                                                 visibility for the frame (the roots stay hidden until 'live')
//   rel.stats { releases, rebuilds, freed (bytes, the last release), frames (the last rebuild) }; rel.enabled (PHONE_BUDGET.nearRelease)
export class NearRelease {

	constructor( { roots = [], enabled = !! ( globalThis.__phoneBudget && globalThis.__phoneBudget.nearRelease ), release = NEAR_RELEASE.release, rebuild = NEAR_RELEASE.rebuild, perFrame = NEAR_RELEASE.perFrame, snap = NEAR_RELEASE.snap, renderer = null } = {} ) {

		this.roots = roots.filter( Boolean );
		this.enabled = enabled;
		this.release = release;
		this.rebuild = rebuild;
		this.perFrame = perFrame;
		this.snap = snap;
		this.renderer = renderer;
		this.state = 'live';
		this._queue = null;
		this.stats = { releases: 0, rebuilds: 0, freed: 0, frames: 0 };

	}

	meshes() {

		const out = [];
		for ( const r of this.roots ) {

			if ( r.traverse ) r.traverse( ( o ) => { if ( o.isMesh && o.geometry ) out.push( o ); } );
			else if ( r.isMesh && r.geometry ) out.push( r );

		}

		return out;

	}

	update( d ) {

		if ( ! this.enabled ) {

			if ( this.state !== 'live' ) this._step( Infinity ); // switched off while released: back at once
			return this.state;

		}

		if ( ! Number.isFinite( d ) ) d = 0; // (no camera yet: as if there)
		if ( this.state === 'live' ) {

			if ( d > this.release ) this._free();

		} else if ( this.state === 'rebuilding' && d > this.release ) {

			this._free(); // turned away again before it was done

		} else if ( this.state === 'rebuilding' || d < this.rebuild ) {

			this._step( d < this.snap ? Infinity : this.perFrame );

		}

		if ( this.state !== 'live' ) for ( const r of this.roots ) if ( r.visible ) r.visible = false;
		return this.state;

	}

	_free() {

		let bytes = 0;
		for ( const m of this.meshes() ) {

			const g = m.geometry;
			if ( ! releasable( g ) ) continue;
			bytes += geometryBytes( g );
			m.geometry = rewrapGeometry( g );
			g.dispose(); // (the renderer destroys its buffers; the arrays live on in the new geometry)

		}

		this.state = 'released';
		this._queue = null;
		this.stats.releases ++;
		this.stats.freed = bytes;
		return bytes;

	}

	// one frame of the rebuild: up to `budget` bytes uploaded (at least one mesh); live once the queue is empty
	_step( budget ) {

		if ( this.state === 'live' ) return;
		if ( ! this._queue ) {

			this._queue = this.meshes();
			this.state = 'rebuilding';
			this.stats.frames = 0;

		}

		const mr = this.renderer || ( globalThis.__app && globalThis.__app.engine && globalThis.__app.engine.meshRenderer ) || null;
		let spent = 0;
		this.stats.frames ++;
		while ( this._queue.length && ( spent === 0 || spent < budget ) ) {

			const m = this._queue.shift();
			uploadMesh( mr, m );
			spent += geometryBytes( m.geometry ) || 1;

		}

		if ( ! this._queue.length ) {

			this._queue = null;
			this.state = 'live';
			this.stats.rebuilds ++;

		}

	}

}

// near / far switching for meshes a town re-shows every frame (Tidemark.update sets its shells visible): onBeforeRender
// hides the one that should not draw at this camera distance from the block's centre (the renderer asks it before it
// queues the mesh, per pass). near: drawn within `dist`, far: beyond.
export function lodSwitch( mesh, { x, z, dist, near = true } ) {

	const prev = mesh.onBeforeRender;
	mesh.userData = mesh.userData || {};
	mesh.userData.lod = { x, z, dist, near };
	mesh.onBeforeRender = function ( ...a ) {

		const c = cameraPosition();
		const d = c ? Math.hypot( c.x - x, c.z - z ) : 0;
		this.visible = near ? d < dist : d >= dist;
		if ( prev ) prev.apply( this, a );

	};
	return mesh;

}

// the glow material's emissive for the night (call per frame, or from an onBeforeRender)
export function updateGlow( material, k = night() ) {

	const e = 0.04 + 3.4 * k;
	material.emissive = [ e, e, e ];

}

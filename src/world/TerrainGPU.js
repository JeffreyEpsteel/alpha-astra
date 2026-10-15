import { Vector3 } from '../engine/math/index.js';
import { Texture } from '../engine/gpu/Texture.js';
import { generateMipmaps } from '../engine/gpu/Mipmaps.js';
import { ShaderModule, UniformBlock } from '../engine/gpu/Shader.js';
import { ComputeKernel } from '../engine/gpu/Compute.js';
import { commonModule } from '../engine/render/wgsl/common.js';
import { G } from '../engine/render/Frame.js';
import { bakeTerrainMaps, buildShadowHeights } from './terrain/TerrainBake.js';
import { getDetailTexture } from './terrain/DetailTextures.js';
import { detailBinding } from './terrain/TerrainShading.js';
import { heightAtlasLayout, buildHeightStrip, tileHeightWGSL, computeTileShoreFields, packShoreAtlas, shoreAtlasSample, tileShoreWGSL } from './terrain/TerrainTiles.js';
import { WORLD } from './WorldLayout.js';

// GPU-side terrain data shared by every shader that needs ground height:
// ocean (depth attenuation / hiding under land), shore waves, terrain mesh,
// particles, water queries.
//
// Textures (all over the terrain domain unless noted):
//   heightTexture  R32F   exact heights, bilinear filtering done manually (heightAt); R16F on phones (wave 19A below)
//   normalTexture  RGBA8  macro normal xz (encoded), rock mask, baked ambient occlusion (mipmapped)
//   splatTexture   RGBA8  loose sand, worn ground / paths, gullies (land) or seagrass (seabed),
//                         seabed rubble / the eroded beach scarp face on land (mipmapped)
//   detailTexture  RGBA8  512^2 tileable detail heights (rock, soil, sand, fbm), see DetailTextures
//   shadowHeightTexture R16F 512^2 (4 m) heights with max-mips (input of the sun shadow bake)
//   sunShadowTexture    RGBA16F storage 512^2: 'shadow top' height and occluder distance toward the
//                       key light, re-baked on the GPU when G.sunDir moves (updateSunShadow)
//
// WGSL module (`terrainGPU.module`, prefix `terrain`), usable from any stage unless noted:
//   terrainUvOf( xz: vec2f ) -> vec2f                   domain uv (0..1) of a world xz
//   terrainHeightAt( xz: vec2f ) -> f32                 exact bilinear height (-90 outside the domain)
//   terrainNormalRock( xz: vec2f ) -> vec4f             macro normal xz (-1..1), rock mask, AO — fragment only
//                                                       (implicit derivatives); terrainNormalRockLevel( xz, level )
//   terrainNormalAt( xz: vec2f ) -> vec3f               unit macro normal (mip 0, any stage)
//   terrainSplat( xz: vec2f ) -> vec4f                  sand, paths, gullies / seagrass, rubble — fragment only;
//                                                       terrainSplatLevel( xz, level )
//   terrainShoreSample( xz: vec2f ) -> vec4f            shore field (T, dirX, dirZ, exposure), bilinear
//   terrainSunShadowAt( P: vec3f ) -> f32               heightfield sun shadow: 0 in the hills' shadow .. 1 lit
// The extra terrain tiles beyond the domain (TerrainTiles.js; Tidemark): terrainHeightAt, terrainNormalRock*, terrainSplat*
// and terrainShoreSample answer from them outside the domain (heights and shore fields in rows under the domain's
// texels of the same textures; normal / rock / sand from the tile heights): no binding or uniform of their own.
// Bindings: terrainParams (TerrainParams: origin, size, res, shoreRes, sunBake, sunBaked), terrainHeightTex,
// terrainNormalTex, terrainSplatTex, terrainDetailTex (tileable: sample with smpLinearRepeat / smpAnisoRepeat),
// terrainShoreTex, terrainSunShadowTex.
const SUN_N_DESKTOP = 512; // cells of 4 m; phones: PHONE_BUDGET.sunShadow (256: 8 m cells, 2 -> 0.5 MB; the penumbra is metres wide)
const SUN_T0 = 24; // m: nearer occluders are left to the shadow map / N.L
const SUN_DT0 = 6;
const SUN_GROWTH = 1.22;
const SUN_STEPS = 24; // reaches ~3 km

// Phones (PHONE_BUDGET.halfTerrain, wave 19A): the height atlas and the shore field as half floats (18.6 -> 9.3 MB and
// 6.5 -> 3.3 MB). Rounded to nearest: <= 1.6 cm below 64 m (the shore, the towns, the meadows), 6 cm on the hills, 12 cm on
// the 300 m peak; read with textureLoad like the float32 data (no WGSL change; r16float binds as unfilterable-float too).
const halfTerrain = () => !! ( globalThis.__phoneBudget && globalThis.__phoneBudget.halfTerrain );
const _hf = new Float32Array( 1 ), _hu = new Uint32Array( _hf.buffer );
export function toHalfArray( src ) {

	if ( typeof Float16Array === 'function' ) return new Uint16Array( new Float16Array( src ).buffer ); // (Safari 18.2+, Firefox 129+)
	const out = new Uint16Array( src.length );
	for ( let i = 0; i < src.length; i ++ ) {

		_hf[ 0 ] = src[ i ];
		const x = _hu[ 0 ], sign = ( x >>> 16 ) & 0x8000, e = ( ( x >>> 23 ) & 0xff ) - 112;
		let m = x & 0x7fffff;
		if ( e >= 31 ) { out[ i ] = sign | 0x7c00; continue; } // (beyond 65504: none in these fields)
		if ( e <= 0 ) {

			if ( e < - 10 ) { out[ i ] = sign; continue; }
			m |= 0x800000;
			const k = 14 - e;
			out[ i ] = sign | ( ( m >>> k ) + ( ( m >>> ( k - 1 ) ) & 1 ) );
			continue;

		}

		out[ i ] = sign | ( ( ( e << 10 ) | ( m >>> 13 ) ) + ( ( m >>> 12 ) & 1 ) ); // (a carry into the exponent is right)

	}

	return out;

}

// The terrain's height texture is shared with the grass field (same data, same format): one 16 MB r32float, not two.
// Given the TerrainData it is the height atlas: the domain's res x res texels, then the extra tiles' nodes in rows
// under them (texture.userData.tiles: the layout, TerrainTiles.heightAtlasLayout; +1.75 MB for Tidemark).
//   sharedHeightTexture( terrain )  or  sharedHeightTexture( heights, res )  (the domain only, as before)
//   texture.uploadDomain()   re-uploads the domain's texels (after terrain.flatten()); the strip never changes
const _heightTex = new WeakMap();
export function sharedHeightTexture( terrain, res ) {

	const T = terrain && ! ArrayBuffer.isView( terrain ) && terrain.heights ? terrain : null;
	const heights = T ? T.heights : terrain;
	let t = _heightTex.get( heights );
	if ( t ) return t;
	res = T ? T.res : res;
	const layout = T ? heightAtlasLayout( T ) : { width: res, mainRows: res, stripRows: 0, texels: 0, tiles: [] };
	const half = halfTerrain(), fmt = half ? 'r16float' : 'r32float', enc = ( a ) => ( half ? toHalfArray( a ) : a );
	if ( ! layout.stripRows ) {

		t = dataTexture( enc( heights ), res, res, fmt, 'terrainHeights' );

	} else {

		t = new Texture( { label: 'terrainHeights', width: res, height: res + layout.stripRows, format: fmt, usage: [ 'sample', 'copyDst' ] } );
		t.getGPU();
		t.upload( enc( heights ), { width: res, height: res } );
		t.upload( enc( buildHeightStrip( layout ) ), { width: res, height: layout.stripRows, y: res } );

	}

	t.userData = t.userData || {};
	t.userData.tiles = layout;
	t.uploadDomain = () => t.upload( enc( heights ), { width: res, height: res } );
	_heightTex.set( heights, t );
	return t;

}

// rgba8 maps halved (box filter) until they fit `max` px: the phone budget's terrain maps
function shrinkRGBA( data, res, max ) {

	while ( res > max ) {

		const r = res >> 1, out = new Uint8Array( r * r * 4 );
		for ( let y = 0; y < r; y ++ ) for ( let x = 0; x < r; x ++ ) for ( let c = 0; c < 4; c ++ ) {

			const i = ( ( 2 * y ) * res + 2 * x ) * 4 + c;
			out[ ( y * r + x ) * 4 + c ] = ( data[ i ] + data[ i + 4 ] + data[ i + res * 4 ] + data[ i + res * 4 + 4 ] + 2 ) >> 2;

		}

		data = out; res = r;

	}

	return [ data, res ];

}

function dataTexture( data, width, height, format, label, mips = false ) {

	const tex = new Texture( { label, width, height, format, mips, usage: [ 'sample', 'copyDst' ], data } );
	tex.getGPU();
	if ( mips === true ) generateMipmaps( tex );
	return tex;

}

export class TerrainGPU {

	constructor( terrain, shoreField ) {

		this.terrain = terrain;
		const res = terrain.res;
		const t0 = performance.now();

		// heights: R32F, loaded with manual bilinear filtering (no sampler / float filtering needed); the extra tiles'
		// nodes in rows under the domain's (TerrainTiles.js)
		this.heightTexture = sharedHeightTexture( terrain );
		this.tiles = this.heightTexture.userData.tiles;
		this.shoreTiles = null;

		const maps = bakeTerrainMaps( terrain );
		// trilinear, clamp to edge (smpLinearClamp), linear data (no colour space)
		// phones: the normal / splat maps at the budget's size (1024: 21 MB -> 5 MB each; sampled by uv, so the res is free)
		const tmax = ( globalThis.__phoneBudget && globalThis.__phoneBudget.terrainTexture ) || res;
		const [ nData, nRes ] = shrinkRGBA( maps.normal, res, tmax ), [ sData, sRes ] = shrinkRGBA( maps.splat, res, tmax );
		this.normalTexture = dataTexture( nData, nRes, nRes, 'rgba8unorm', 'terrainNormalRockAO', true );
		this.splatTexture = dataTexture( sData, sRes, sRes, 'rgba8unorm', 'terrainSplat', true );
		this.detailTexture = getDetailTexture();

		// coarse heights for the sun shadow march (half float is filterable everywhere)
		const sh = buildShadowHeights( terrain, ( globalThis.__phoneBudget && globalThis.__phoneBudget.sunShadow ) ? 8 : 4 ); // (phones: 8 m like their sun cells)
		const st = new Texture( { label: 'terrainShadowHeights', width: sh.levels[ 0 ].width, height: sh.levels[ 0 ].height, format: 'r16float', mips: sh.levels.length, usage: [ 'sample', 'copyDst' ] } );
		st.getGPU();
		sh.levels.forEach( ( l, i ) => st.upload( l.data, { mip: i, width: l.width, height: l.height } ) );
		this.shadowHeightTexture = st;
		this.shadowTexel = sh.texel;
		this.maxHeight = sh.maxHeight;

		this.size = terrain.size;
		this.origin = terrain.origin;
		this.res = res;

		this.uniforms = new UniformBlock( 'TerrainParams', {
			origin: [ 'f32', terrain.origin ],
			size: [ 'f32', terrain.size ],
			res: [ 'f32', res ],
			shoreRes: [ 'f32', 1 ],
			sunBake: [ 'vec3f', new Vector3( 0, 1, 0 ) ],
			sunBaked: [ 'f32', 0 ], // 0 until the first bake: everything lit
		}, { label: 'terrainParams' } );
		// three-style handles (terOrigin / terSize / terSunBake / terSunBaked)
		this.uOrigin = this.uniforms.fields.origin;
		this.uSize = this.uniforms.fields.size;

		// placeholder until the shore field is set (1 texel, no waves)
		this.shoreTexture = dataTexture( new Float32Array( [ 1e4, 0, 0, 0 ] ), 1, 1, 'rgba32float', 'terrainShoreField' );
		if ( shoreField ) this.setShoreField( shoreField );
		this._initSunShadow();

		this.module = new ShaderModule( {
			name: 'terrain',
			deps: [ commonModule ],
			uniforms: this.uniforms,
			bindings: {
				terrainHeightTex: { texture: this.heightTexture, sampleType: 'unfilterable-float' },
				terrainNormalTex: { texture: this.normalTexture },
				terrainSplatTex: { texture: this.splatTexture },
				terrainDetailTex: detailBinding(),
				terrainShoreTex: { texture: () => this.shoreTexture, sampleType: 'unfilterable-float' },
				terrainSunShadowTex: { texture: this.sunShadowTexture },
			},
			code: terrainWGSL( this.tiles ),
		} );

		// the former TerrainLightingModel: multiplies the key light by the heightfield sun shadow.
		// Materials add it to `modules` and set the define MATERIAL_SUN_MODULATION: 1.
		this.sunModulationModule = new ShaderModule( {
			name: 'terrainSunModulation',
			deps: [ this.module ],
			code: 'fn materialSunModulation( P: vec3f, N: vec3f ) -> vec3f { return vec3f( terrainSunShadowAt( P ) ); }',
		} );

		this.timings = { ...maps.ms, detail: this.detailTexture.userData.ms, tileShore: this._tileShoreMs || 0, total: performance.now() - t0 };

	}

	// ------------------------------------------------------------ heightfield sun shadow

	// World-space shadow map of the terrain for the key light: for every 4 m cell the lowest height
	// that still sees the light past the terrain (max over the march of h(q) - t * tan(elevation))
	// and the distance to that occluder (penumbra width). One texture fetch gives soft, long hill
	// shadows for any point - terrain, rocks, buildings, plants - far beyond the shadow map range.
	_initSunShadow() {

		// nearest + textureLoad (manual bilinear in terrainSunShadowAt): no sampler needed, every lit
		// material includes this lookup
		const SUN_N = this.sunN = ( globalThis.__phoneBudget && globalThis.__phoneBudget.sunShadow ) || SUN_N_DESKTOP;
		this.sunShadowTexture = new Texture( { label: 'terrainSunShadow', width: SUN_N, height: SUN_N, format: 'rgba16float', usage: [ 'sample', 'storage' ] } );
		this.uSunBake = this.uniforms.fields.sunBake;
		this.uSunBaked = this.uniforms.fields.sunBaked;
		this._sunBaked = false;

		const invTexel = 1 / this.shadowTexel;
		this.sunShadowKernel = new ComputeKernel( {
			label: 'Terrain Sun Shadow',
			modules: [ commonModule ],
			bindings: {
				terrainParams: { uniform: this.uniforms },
				terrainShadowHeights: { texture: this.shadowHeightTexture },
				terrainSunShadowOut: { storageTexture: this.sunShadowTexture, access: 'write' },
			},
			workgroupSize: [ 8, 8, 1 ],
			code: /* wgsl */`
@compute @workgroup_size( WG_X, WG_Y, WG_Z )
fn main( @builtin( global_invocation_id ) gid: vec3u ) {
	if ( gid.x >= ${ SUN_N }u || gid.y >= ${ SUN_N }u ) { return; }
	let ij = vec2f( gid.xy );
	let xz = ( ij + 0.5 ) / ${ SUN_N }.0 * terrainParams.size + terrainParams.origin;
	let L = terrainParams.sunBake;
	let lxz = max( length( L.xz ), 1e-4 );
	let dir = L.xz / lxz;
	let tanEl = L.y / lxz;
	var top = -1e4;
	var occ = 0.0;
	var t = f32( ${ SUN_T0 } );
	var dt = f32( ${ SUN_DT0 } );
	for ( var i = 0; i < ${ SUN_STEPS }; i++ ) {
		let q = xz + dir * t;
		let uv = ( q - terrainParams.origin ) / terrainParams.size;
		let hq = textureSampleLevel( terrainShadowHeights, smpLinearClamp, uv, log2( max( dt * ${ invTexel.toFixed( 8 ) }, 1.0 ) ) ).x;
		let v = hq - t * tanEl;
		if ( v > top ) {
			top = v;
			occ = t;
		}
		dt *= ${ SUN_GROWTH };
		t += dt;
	}
	textureStore( terrainSunShadowOut, vec2u( gid.xy ), vec4f( top, occ, 0.0, 1.0 ) );
}
`,
		} );

	}

	// Re-bake the sun shadow map when the key light moved (cheap: ~6 M texture fetches).
	// `renderer` is unused (kept for the call sites); the dispatch records into the frame encoder.
	updateSunShadow( renderer, force = false ) {

		const L = G.sunDir.value;
		if ( ! force && this._sunBaked && L.angleTo( this.uSunBake.value ) < 0.0015 ) return false;
		this.uSunBake.value.copy( L );
		this.sunShadowKernel.dispatch( [ Math.ceil( this.sunN / 8 ), Math.ceil( this.sunN / 8 ), 1 ] );
		this._sunBaked = true;
		this.uSunBaked.value = 1;
		return true;

	}

	// The domain's shore field (ShoreField.js) with the tiles' own (computed here once: 4 m cells, the same swell) in rows
	// under it. this.shoreTiles keeps the packed data on the CPU (shoreSampleAt, ShoreWaves.buildDirTexture).
	setShoreField( f, { swellDir = [ WORLD.swellDir.x, WORLD.swellDir.y ] } = {} ) {

		this.shoreRes = f.res;
		const layout = this.tiles.shore || [];
		if ( layout.length && ! this._tileShore ) {

			const t0 = performance.now();
			this._tileShore = computeTileShoreFields( this.terrain, { swellDir } );
			this._tileShoreMs = performance.now() - t0;

		}

		const atlas = layout.length ? packShoreAtlas( f, layout, this._tileShore ) : { data: f.data, width: f.res, height: f.res, mainRes: f.res, tiles: [] };
		// (phones: half floats; T up to the 1e4 m 'no shore' value fits, the near-shore distances and directions keep 3 digits)
		const half = halfTerrain(), fmt = half ? 'rgba16float' : 'rgba32float', data = half ? toHalfArray( atlas.data ) : atlas.data;
		if ( this.shoreTexture.width !== atlas.width || this.shoreTexture.height !== atlas.height || this.shoreTexture.format !== fmt ) {

			this.shoreTexture.destroy();
			this.shoreTexture = dataTexture( data, atlas.width, atlas.height, fmt, 'terrainShoreField' );

		} else {

			this.shoreTexture.upload( data );

		}

		// the CPU keeps the strip only (1.7 MB for Tidemark; the domain's field is the caller's)
		const base = atlas.mainRes * atlas.mainRes * 4;
		this.shoreTiles = atlas.tiles.length ? { ...atlas, data: atlas.data.slice( base ), base } : null;

		this.uniforms.fields.shoreRes.value = f.res;

	}

	// a tile's shore field at world xz on the CPU: [ T, dirX * exposure, dirZ * exposure, shore T ], null off the tiles
	shoreSampleAt( x, z ) {

		return this.shoreTiles ? shoreAtlasSample( this.shoreTiles, x, z ) : null;

	}

}

// The module's WGSL. With extra terrain tiles (TerrainTiles.js) the lookups outside the domain answer from them, each
// behind one branch (the domain's own path is unchanged); without tiles it is the one-domain code.
export function terrainWGSL( layout ) {

	const tiles = !! layout && layout.tiles.length > 0;
	const onTile = ( ret ) => ( tiles ? `	if ( terrainOnTile( xz ) ) { return ${ ret }; }\n` : '' );
	return ( tiles ? tileHeightWGSL( layout, { fn: 'terrainTile', tex: 'terrainHeightTex' } ) + tileShoreWGSL( layout.shore || [], { fn: 'terrainTile', tex: 'terrainShoreTex', res: 'terrainParams.shoreRes' } ) : '' ) + /* wgsl */`
fn terrainUvOf( xz: vec2f ) -> vec2f {
	return ( xz - terrainParams.origin ) / terrainParams.size;
}

// outside the domain, inside one of the terrain tiles
fn terrainOnTile( xz: vec2f ) -> bool {
${ tiles ? `	let uv = terrainUvOf( xz );
	return ( uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0 ) && terrainTileHit( xz );` : '	return false;' }
}

// exact bilinear height at world xz (matches TerrainData.heightAt)
fn terrainHeightAt( xz: vec2f ) -> f32 {
	let res = terrainParams.res;
	let f = ( xz - terrainParams.origin ) / terrainParams.size * res - 0.5;
	let fc = clamp( f, vec2f( 0.0 ), vec2f( res - 1.001 ) );
	let i = floor( fc );
	let t = fract( fc );
	let ii = vec2i( i );
	let a = textureLoad( terrainHeightTex, ii, 0 ).x;
	let b = textureLoad( terrainHeightTex, ii + vec2i( 1, 0 ), 0 ).x;
	let c = textureLoad( terrainHeightTex, ii + vec2i( 0, 1 ), 0 ).x;
	let d = textureLoad( terrainHeightTex, ii + vec2i( 1, 1 ), 0 ).x;
	let h = mix( mix( a, b, t.x ), mix( c, d, t.x ), t.y );
	// outside the domain: deep ocean floor${ tiles ? ' (or the terrain tile there)' : '' }
	let outside = f.x < 0.0 || f.y < 0.0 || f.x > res - 1.0 || f.y > res - 1.0;
${ tiles ? '	if ( outside ) { return terrainTileHeight( xz ); }\n' : '' }	return select( h, -90.0, outside );
}

// filtered normal (xz components), rock mask, ambient occlusion
fn terrainNormalRock( xz: vec2f ) -> vec4f {
	let s = textureSample( terrainNormalTex, smpLinearClamp, terrainUvOf( xz ) );
${ onTile( 'terrainTileNormalRock( xz )' ) }	return vec4f( s.xy * 2.0 - 1.0, s.z, s.w );
}
// explicit mip (e.g. in the vertex stage)
fn terrainNormalRockLevel( xz: vec2f, level: f32 ) -> vec4f {
	let s = textureSampleLevel( terrainNormalTex, smpLinearClamp, terrainUvOf( xz ), level );
${ onTile( 'terrainTileNormalRock( xz )' ) }	return vec4f( s.xy * 2.0 - 1.0, s.z, s.w );
}
fn terrainNormalAt( xz: vec2f ) -> vec3f {
	let nr = terrainNormalRockLevel( xz, 0.0 );
	return normalize( vec3f( nr.x, sqrt( max( 1.0 - nr.x * nr.x - nr.y * nr.y, 0.0025 ) ), nr.y ) );
}

// loose sand, worn ground / paths, gullies (land) or seagrass (seabed), seabed rubble (the
// eroded beach scarp face on land)
fn terrainSplat( xz: vec2f ) -> vec4f {
	let s = textureSample( terrainSplatTex, smpLinearClamp, terrainUvOf( xz ) );
${ onTile( 'terrainTileSplat( xz )' ) }	return s;
}
fn terrainSplatLevel( xz: vec2f, level: f32 ) -> vec4f {
	let s = textureSampleLevel( terrainSplatTex, smpLinearClamp, terrainUvOf( xz ), level );
${ onTile( 'terrainTileSplat( xz )' ) }	return s;
}

// shore field: (T, dirX, dirZ, exposure), bilinear via loads (float32 data)${ tiles ? '; the tiles\' own fields in the rows under it' : '' }
fn terrainShoreSample( xz: vec2f ) -> vec4f {
${ tiles ? '	if ( terrainParams.shoreRes > 1.5 && terrainOnTile( xz ) ) { return terrainTileShore( xz ); }\n' : '' }	let res = terrainParams.shoreRes;
	let f = ( xz - terrainParams.origin ) / terrainParams.size * res - 0.5;
	let fc = clamp( f, vec2f( 0.0 ), vec2f( max( res - 1.001, 0.0 ) ) );
	let i = floor( fc );
	let t = fract( fc );
	let ii = vec2i( i );
	let mx = vec2i( max( i32( res ) - 1, 0 ) );
	let a = textureLoad( terrainShoreTex, ii, 0 );
	let b = textureLoad( terrainShoreTex, min( ii + vec2i( 1, 0 ), mx ), 0 );
	let c = textureLoad( terrainShoreTex, min( ii + vec2i( 0, 1 ), mx ), 0 );
	let d = textureLoad( terrainShoreTex, min( ii + vec2i( 1, 1 ), mx ), 0 );
	return mix( mix( a, b, t.x ), mix( c, d, t.x ), t.y );
}

// 0 (in the terrain's shadow) .. 1 (lit) for a world position, soft penumbra that widens with the
// occluder distance
fn terrainSunShadowAt( P: vec3f ) -> f32 {
	let N = f32( textureDimensions( terrainSunShadowTex ).x );
	let st = clamp( terrainUvOf( P.xz ) * N - 0.5, vec2f( 0.0 ), vec2f( N - 1.001 ) );
	let i = vec2i( floor( st ) );
	let t = fract( st );
	let s = mix(
		mix( textureLoad( terrainSunShadowTex, i, 0 ), textureLoad( terrainSunShadowTex, i + vec2i( 1, 0 ), 0 ), t.x ),
		mix( textureLoad( terrainSunShadowTex, i + vec2i( 0, 1 ), 0 ), textureLoad( terrainSunShadowTex, i + vec2i( 1, 1 ), 0 ), t.x ),
		t.y
	);
	let w = s.y * 0.012 + 0.35;
	return mix( 1.0, smoothstep( -w, w, P.y - s.x ), terrainParams.sunBaked );
}
`;

}

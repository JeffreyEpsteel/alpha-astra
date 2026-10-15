import { ComputeKernel, GPU } from '../engine/webgpu.js';

// Box-filtered mip chain of a square power-of-two 2d / 2d-array / cube texture in a few compute
// dispatches, instead of a render pass per level and layer (generateMipmaps). Each stage reads one
// level and writes the next n through workgroup memory:
//   T x T threads per 2T x 2T tile of the source level (T = 16, less for the small tail levels)
//   n <= log2( 2T ) levels a tile can make, and n <= the device's maxStorageTexturesPerShaderStage
//   (the spec default 4 on iOS: 32..512 px textures then take 2..3 stages instead of 2)
// The texture needs 'storage' usage and a storage-capable float format (e.g. rgba16float).
//
//   const mips = new ComputeMips( tex, 'label' );
//   GPU.computePass( 'x', ( pass ) => mips.dispatch( pass ) );   // or mips.dispatch() (own pass)
export class ComputeMips {

	constructor( tex, label = tex.label, { maxOutputs = null } = {} ) {

		const res = tex.width;
		if ( tex.height !== res || res & ( res - 1 ) || res < 32 || res > 512 ) throw new Error( 'ComputeMips: square power-of-two 32..512 only' );
		this.res = res;
		this.layers = tex.dimension === '3d' ? 1 : tex.depth;
		const levels = tex.mipLevelCount;
		const lim = ( GPU.limits && GPU.limits.maxStorageTexturesPerShaderStage ) || 4;
		const maxOut = Math.max( 1, Math.min( 5, maxOutputs || lim ) );
		this.stages = [];
		let base = 0, size = res, k = 0;
		while ( base < levels - 1 && size > 1 ) {

			const T = Math.min( 16, size >> 1 );
			const n = Math.min( Math.log2( 2 * T ), maxOut, levels - 1 - base );
			const kernel = this._stage( tex, label + ' mips ' + String.fromCharCode( 65 + k ), base, n, T );
			this.stages.push( { kernel, groups: [ size / ( 2 * T ), size / ( 2 * T ), this.layers ] } );
			base += n;
			size >>= n;
			k ++;

		}

		// (the first two stages, as before: labels 'mips A' / 'mips B')
		this.kernelA = this.stages[ 0 ] ? this.stages[ 0 ].kernel : null;
		this.kernelB = this.stages[ 1 ] ? this.stages[ 1 ].kernel : null;

	}

	// level base -> levels base + 1 .. base + n, T x T threads per 2T x 2T source tile
	_stage( tex, label, base, n, T ) {

		const out = ( l ) => ( { storageTexture: tex, access: 'write', view: { dimension: '2d-array', baseMipLevel: l, mipLevelCount: 1 } } );
		// threads (lx, ly) < width reduce 2x2 of `from` (row 2 * width) into output k (and `to`)
		const reduce = ( from, to, width, k ) => /* wgsl */`
	if ( lx < ${ width }u && ly < ${ width }u ) {
		let i = ly * ${ 4 * width }u + lx * 2u;
		let v = ( ${ from }[ i ] + ${ from }[ i + 1u ] + ${ from }[ i + ${ 2 * width }u ] + ${ from }[ i + ${ 2 * width + 1 }u ] ) * 0.25;
		textureStore( out${ k }, vec2u( gx * ${ width }u + lx, gy * ${ width }u + ly ), layer, v );
		${ to ? `${ to }[ ly * ${ width }u + lx ] = v;` : '' }
	}
	workgroupBarrier();`;
		const bindings = { src0: { texture: tex, view: { dimension: '2d-array', baseMipLevel: base, mipLevelCount: 1 } } };
		let decl = '', code = '';
		for ( let k = 1; k <= n; k ++ ) bindings[ 'out' + k ] = out( base + k );
		for ( let k = 1; k < n; k ++ ) decl += `var<workgroup> s${ k }: array<vec4f, ${ ( T >> ( k - 1 ) ) ** 2 }>;\n`;
		for ( let k = 2; k <= n; k ++ ) code += reduce( 's' + ( k - 1 ), k < n ? 's' + k : null, T >> ( k - 1 ), k );
		return new ComputeKernel( {
			label,
			bindings,
			workgroupSize: [ T, T, 1 ],
			code: /* wgsl */`
${ decl }
@compute @workgroup_size( WG_X, WG_Y, WG_Z )
fn main( @builtin( local_invocation_id ) lid: vec3u, @builtin( workgroup_id ) wid: vec3u ) {
	let lx = lid.x; let ly = lid.y;
	let gx = wid.x; let gy = wid.y; let layer = wid.z;
	let x1 = gx * ${ T }u + lx; let y1 = gy * ${ T }u + ly;
	let p = vec2u( x1, y1 ) * 2u;
	let v1 = ( textureLoad( src0, p, layer, 0 ) + textureLoad( src0, p + vec2u( 1u, 0u ), layer, 0 ) + textureLoad( src0, p + vec2u( 0u, 1u ), layer, 0 ) + textureLoad( src0, p + vec2u( 1u, 1u ), layer, 0 ) ) * 0.25;
	textureStore( out1, vec2u( x1, y1 ), layer, v1 );
	${ n > 1 ? `s1[ ly * ${ T }u + lx ] = v1;\n\tworkgroupBarrier();` : '' }
${ code }
}`,
		} );

	}

	dispatch( pass = null ) {

		const o = pass ? { pass } : undefined;
		for ( const s of this.stages ) s.kernel.dispatch( s.groups, o );

	}

}

import { Material } from '../engine/render/Material.js';
import { Color } from '../engine/math/index.js';

// All world objects use these material classes so they share underwater lighting
// (caustics, water-column attenuation, tinted ambient) and wetness handling: in the engine every
// lit Material goes through the scene lighting (render/wgsl/lighting.js) and its hooks, so these
// are thin wrappers over the engine's Material that keep the three.js-style option names working
// (color, roughness, metalness, emissive, emissiveIntensity, opacity, transparent, side (THREE
// numeric FrontSide / BackSide / DoubleSide or 'front' / 'back' / 'double'), alphaTest,
// depthWrite, vertexColors, envMapIntensity, and for physical(): clearcoat, clearcoatRoughness,
// specularIntensity, sheen, sheenColor, sheenRoughness, ior).
//
// The TSL node slots (colorNode, roughnessNode, normalNode, positionNode, ...) are WGSL snippets
// now: `vertex`, `surface`, `output` (see engine/render/Material.js). They can be passed in the
// params or assigned afterwards (then set `needsUpdate = true` if the material was drawn already).
// The physical parameters seed the Surface before the material's own `surface` snippet runs.

const SIDES = { 0: 'front', 1: 'back', 2: 'double', front: 'front', back: 'back', double: 'double' };

// Shared surface detail after every scene material's own snippet (wave 18F; MATERIAL_DETAIL, off on phones):
//  - a touch of roughness / specular variation on rough dielectrics (wood, cloth, stone, paint): two octaves of
//    world-space noise, +-12 % roughness and +-20 % specular, so a lit plank wall or a stone quay no longer reads
//    as one flat sheen
//  - the splash zone: surfaces in the last half metre above the sea (piles, hull sides, quay stones, rocks)
//    darker and glossier, with a ragged upper edge, fading out under water (the water's own absorption takes
//    over there)
const SURFACE_DETAIL = /* wgsl */`
#if MATERIAL_DETAIL
	{
		let dn = perlin3( in.P * 2.7 ) * 0.6 + perlin3( in.P * 9.1 + vec3f( 3.1, 7.3, 1.7 ) ) * 0.4;
		if ( s.metalness < 0.5 && s.roughness > 0.35 ) {
			s.roughness = clamp( s.roughness * ( 1.0 + dn * 0.12 ), 0.05, 1.0 );
			s.specularIntensity *= 1.0 + dn * 0.2;
		}
		let hw = in.P.y - frame.seaLevel;
		let wet = smoothstep( 0.55, 0.12, hw + dn * 0.12 ) * smoothstep( -0.7, -0.15, hw ) * ( 1.0 - s.metalness );
		s.albedo *= 1.0 - 0.32 * wet;
		s.roughness = mix( s.roughness, s.roughness * 0.45, wet );
	}
#endif
`;

function engineParams( params ) {

	const o = { ...params };
	if ( o.side !== undefined ) o.side = SIDES[ o.side ] || 'front';
	return o;

}

export class SceneMaterial extends Material {

	constructor( params = {}, physicalFields = null ) {

		const o = engineParams( params );
		const uniforms = { ...( o.uniforms || {} ) };
		uniforms.envMapIntensity = [ 'f32', o.envMapIntensity ?? 1 ];
		uniforms.emissiveIntensity = [ 'f32', o.emissiveIntensity ?? 1 ];
		if ( physicalFields ) Object.assign( uniforms, physicalFields );
		super( { ...o, uniforms } );
		this.isSceneMaterial = true;
		this.isMeshStandardMaterial = true;
		// the shared surface detail below (wave 18F): not on phones; a material may pass detail: false
		if ( this.defines.MATERIAL_DETAIL === undefined ) this.defines.MATERIAL_DETAIL = globalThis.__phoneBudget || o.detail === false ? 0 : 1;

	}

	// numeric (three) or string sides
	get side() { return this._side; }
	set side( v ) {

		const s = SIDES[ v ] || 'front';
		if ( s !== this._side && this._side !== undefined ) this.version ++;
		this._side = s;

	}

	get emissiveIntensity() { return this.uniforms.emissiveIntensity.value; }
	set emissiveIntensity( v ) { this.uniforms.emissiveIntensity.value = v; }
	get envMapIntensity() { return this.uniforms.envMapIntensity.value; }
	set envMapIntensity( v ) { this.uniforms.envMapIntensity.value = v; }

	// the material's own surface snippet runs after the parameter seeding
	get surface() {

		return this._prelude() + ( this._surface || '' ) + SURFACE_DETAIL;

	}

	set surface( v ) {

		this._surface = v;

	}

	_prelude() {

		return '\ts.emissive = s.emissive * mat.emissiveIntensity;\n\ts.envIntensity = mat.envMapIntensity;\n';

	}

}

export class ScenePhysicalMaterial extends SceneMaterial {

	constructor( params = {} ) {

		const clearcoat = params.clearcoat ?? 0;
		const sheen = params.sheen ?? 0;
		super( params, {
			clearcoat: [ 'f32', clearcoat ],
			clearcoatRoughness: [ 'f32', params.clearcoatRoughness ?? 0 ],
			specularIntensity: [ 'f32', params.specularIntensity ?? 1 ],
			sheen: [ 'f32', sheen ],
			sheenColor: [ 'vec3f', null ],
			sheenRoughness: [ 'f32', params.sheenRoughness ?? 1 ],
			ior: [ 'f32', params.ior ?? 1.5 ],
		} );
		this.isMeshPhysicalMaterial = true;
		if ( params.sheenColor !== undefined ) this.uniforms.sheenColor.value = toColor( params.sheenColor );
		else this.uniforms.sheenColor.value = toColor( 0x000000 );
		// three switches the lobes on when the parameter is > 0 at build time
		if ( clearcoat > 0 ) this.defines.CLEARCOAT = 1;
		if ( sheen > 0 ) this.defines.SHEEN = 1;

	}

	get clearcoat() { return this.uniforms.clearcoat.value; }
	set clearcoat( v ) {

		if ( ( v > 0 ) !== !! this.defines.CLEARCOAT ) this.setDefine( 'CLEARCOAT', v > 0 ? 1 : 0 );
		this.uniforms.clearcoat.value = v;

	}

	get clearcoatRoughness() { return this.uniforms.clearcoatRoughness.value; }
	set clearcoatRoughness( v ) { this.uniforms.clearcoatRoughness.value = v; }
	get specularIntensity() { return this.uniforms.specularIntensity.value; }
	set specularIntensity( v ) { this.uniforms.specularIntensity.value = v; }
	get sheen() { return this.uniforms.sheen.value; }
	set sheen( v ) {

		if ( ( v > 0 ) !== !! this.defines.SHEEN ) this.setDefine( 'SHEEN', v > 0 ? 1 : 0 );
		this.uniforms.sheen.value = v;

	}

	get sheenColor() { return this.uniforms.sheenColor.value; }
	get sheenRoughness() { return this.uniforms.sheenRoughness.value; }
	set sheenRoughness( v ) { this.uniforms.sheenRoughness.value = v; }
	get ior() { return this.uniforms.ior.value; }
	set ior( v ) { this.uniforms.ior.value = v; }

	_prelude() {

		return super._prelude() + `\ts.clearcoat = mat.clearcoat;
	s.clearcoatRoughness = mat.clearcoatRoughness;
	s.specularIntensity = mat.specularIntensity;
	s.sheenColor = mat.sheenColor * mat.sheen;
	s.sheenRoughness = mat.sheenRoughness;
	s.ior = mat.ior;
`;

	}

}

function toColor( v ) {

	return v && v.isColor ? v.clone() : new Color().set( v );

}

export const standard = ( params = {} ) => new SceneMaterial( params );
export const physical = ( params = {} ) => new ScenePhysicalMaterial( params );

import { Group, Mesh, Vector3, Color, PlaneGeometry } from '../../engine/index.js';
import { Texture } from '../../engine/gpu/Texture.js';
import { GPU } from '../../engine/gpu/GPU.js';
import { generateMipmaps } from '../../engine/gpu/Mipmaps.js';
import { prepare, mergePrepared, box, cylinder, sphere, rod, mat4 } from '../../world/boat/GeoKit.js';
import { PAT } from '../../game/GameMaterials.js';
import { standard } from '../../materials/Materials.js';

// The harbour agent's lectern (Roid & Co.'s desk on every port's jetty): a weathered post and slanted desk with an open
// ledger, an iron lantern on a crook over it and a painted placard on the front, "ROID & CO. · boats and recoveries".
// Local frame: +z is the front (the placard, toward the customer), the desk slopes down toward -z (the agent's side).
//
//   buildLecternGeometry()        one merged GeoKit geometry (createPropMaterial: vertex colours + aux)
//   LANTERN                       { x, y, z } the lantern's glass in the local frame (the light sits there)
//   PLACARD                       { w, h, y, z } the placard face (a quad with the shared texture)
//   placardMaterial()             one material for every placard (canvas text; a plain painted board in node)
//   makeLectern( material )       the group: the desk mesh and the placard quad

export const LANTERN = { x: - 0.2, y: 1.62, z: - 0.16 };
export const PLACARD = { w: 0.62, h: 0.24, y: 0.78, z: 0.095 };
const TEX_W = 512, TEX_H = 200;

const WOOD = ( c ) => ( { color: c, rough: 0.9, pattern: PAT.wood } );
const WOODX = ( c ) => ( { color: c, rough: 0.9, pattern: PAT.woodX } );
const IRON = { color: 0x2b2a28, rough: 0.55, metal: 0.6 };

export function buildLecternGeometry() {

	const P = [];
	const add = ( g, o ) => P.push( prepare( g, o ) );
	const V = ( x, y, z ) => new Vector3( x, y, z );
	// a foot of two crossed planks, the post, the board the placard hangs on (Roid & Co. blue)
	add( box( 0.5, 0.06, 0.12 ), { ...WOODX( 0x5f5243 ), matrix: mat4( 0, 0.03, 0 ) } );
	add( box( 0.12, 0.06, 0.44 ), { ...WOOD( 0x5a4d3f ), matrix: mat4( 0, 0.03, 0 ) } );
	add( box( 0.11, 1.0, 0.11 ), { ...WOOD( 0x6e5f4c ), matrix: mat4( 0, 0.53, 0 ) } );
	add( box( PLACARD.w + 0.06, PLACARD.h + 0.06, 0.03 ), { ...WOODX( 0x3b4a5c ), matrix: mat4( 0, PLACARD.y, PLACARD.z - 0.02 ) } );
	add( box( 0.5, 0.05, 0.05 ), { ...WOODX( 0x5c4e3f ), matrix: mat4( 0, 0.99, 0.02 ) } );
	// the desk: a slanted top on a little box, a lip that holds the ledger
	add( box( 0.5, 0.1, 0.34 ), { ...WOODX( 0x7a6a55 ), matrix: mat4( 0, 1.06, 0 ) } );
	add( box( 0.56, 0.035, 0.42 ), { ...WOODX( 0x8a7a64 ), matrix: mat4( 0, 1.14, - 0.01, - 0.32, 0, 0 ) } );
	add( box( 0.5, 0.04, 0.025 ), { ...WOOD( 0x5c4e3f ), matrix: mat4( 0, 1.11, - 0.2, - 0.32, 0, 0 ) } );
	// the open ledger: dark red covers, cream pages in two leaves, a ribbon
	for ( const s of [ - 1, 1 ] ) {

		add( box( 0.2, 0.012, 0.27 ), { color: 0x5a1f1c, rough: 0.7, matrix: mat4( s * 0.1, 1.165, - 0.02, - 0.32, 0, s * - 0.05 ) } );
		add( box( 0.185, 0.02, 0.25 ), { color: 0xe6dcc0, rough: 0.85, matrix: mat4( s * 0.098, 1.18, - 0.02, - 0.32, 0, s * - 0.07 ) } );

	}

	add( box( 0.012, 0.004, 0.2 ), { color: 0x8c2a24, rough: 0.6, matrix: mat4( 0.02, 1.193, - 0.04, - 0.32, 0, 0 ) } );
	// the lantern on an iron crook at the desk's back corner
	add( rod( V( - 0.2, 1.08, - 0.13 ), V( - 0.2, 1.86, - 0.13 ), 0.016, 6 ), IRON );
	add( rod( V( - 0.2, 1.86, - 0.13 ), V( - 0.2, 1.84, - 0.16 ), 0.012, 6 ), IRON );
	add( cylinder( 0.06, 0.06, 0.18, 8 ), { color: 0xffd9a0, rough: 0.2, matrix: mat4( LANTERN.x, LANTERN.y, LANTERN.z ) } );
	add( cylinder( 0.025, 0.075, 0.05, 8 ), { ...IRON, matrix: mat4( LANTERN.x, LANTERN.y + 0.115, LANTERN.z ) } );
	add( cylinder( 0.075, 0.06, 0.03, 8 ), { ...IRON, matrix: mat4( LANTERN.x, LANTERN.y - 0.1, LANTERN.z ) } );
	add( sphere( 0.018, 6, 4 ), { ...IRON, matrix: mat4( LANTERN.x, LANTERN.y + 0.16, LANTERN.z ) } );
	// an inkpot and a quill on the desk's flat end
	add( cylinder( 0.025, 0.03, 0.04, 8 ), { color: 0x1d1d22, rough: 0.3, matrix: mat4( 0.21, 1.2, 0.1 ) } );
	add( rod( V( 0.21, 1.21, 0.1 ), V( 0.17, 1.38, 0.05 ), 0.006, 4, 0.002 ), { color: 0xe8e2d0, rough: 0.8 } );
	return mergePrepared( P );

}

// ---- the placard's face: canvas text in the browser, a painted board of the same colours in node

function makeCanvas( w, h ) {

	if ( typeof OffscreenCanvas !== 'undefined' ) return new OffscreenCanvas( w, h );
	if ( typeof document !== 'undefined' ) return Object.assign( document.createElement( 'canvas' ), { width: w, height: h } );
	return null;

}

export function placardPixels() {

	const cv = makeCanvas( TEX_W, TEX_H );
	const ctx = cv && cv.getContext ? cv.getContext( '2d' ) : null;
	if ( ctx ) {

		ctx.fillStyle = '#2f4256';
		ctx.fillRect( 0, 0, TEX_W, TEX_H );
		ctx.strokeStyle = '#d8b24a';
		ctx.lineWidth = 6;
		ctx.strokeRect( 10, 10, TEX_W - 20, TEX_H - 20 );
		ctx.fillStyle = '#efe4c8';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.font = 'bold 74px Georgia, serif';
		ctx.fillText( 'ROID & CO.', TEX_W / 2, 78 );
		ctx.fillStyle = '#d8b24a';
		ctx.font = 'italic 36px Georgia, serif';
		ctx.fillText( 'boats and recoveries', TEX_W / 2, 146 );
		const img = ctx.getImageData( 0, 0, TEX_W, TEX_H );
		return { width: TEX_W, height: TEX_H, data: new Uint8Array( img.data.buffer, img.data.byteOffset, img.data.byteLength ), canvas: true };

	}

	// node: the blue board with its gold border and two cream bands where the words go
	const data = new Uint8Array( TEX_W * TEX_H * 4 );
	for ( let y = 0; y < TEX_H; y ++ ) for ( let x = 0; x < TEX_W; x ++ ) {

		const i = ( y * TEX_W + x ) * 4;
		const inner = x >= 16 && x < TEX_W - 16 && y >= 16 && y < TEX_H - 16, outer = x >= 10 && x < TEX_W - 10 && y >= 10 && y < TEX_H - 10;
		const words = ( y > 52 && y < 104 && x > 90 && x < TEX_W - 90 ) || ( y > 132 && y < 160 && x > 120 && x < TEX_W - 120 );
		const c = outer && ! inner ? [ 216, 178, 74 ] : words ? [ 239, 228, 200 ] : [ 47, 66, 86 ];
		data[ i ] = c[ 0 ];
		data[ i + 1 ] = c[ 1 ];
		data[ i + 2 ] = c[ 2 ];
		data[ i + 3 ] = 255;

	}

	return { width: TEX_W, height: TEX_H, data, canvas: false };

}

let shared = null;

export function placardMaterial() {

	if ( shared ) return shared;
	const px = placardPixels();
	const tex = new Texture( { label: 'agentPlacard', width: TEX_W, height: TEX_H, format: 'rgba8unorm-srgb', mips: true, usage: [ 'sample', 'copyDst' ], data: px.data } );
	if ( GPU.device ) {

		tex.getGPU();
		generateMipmaps( tex );

	}

	const m = standard( {
		name: 'agentPlacard',
		textures: { agPlacard: tex },
		surface: /* wgsl */`
	let t = textureSample( agPlacard, smpAnisoRepeat, vec2f( in.uv.x, 1.0 - in.uv.y ) );
	s.albedo = t.rgb;
	s.roughness = 0.7;
	s.metalness = 0.0;
`,
	} );
	shared = { material: m, texture: tex, canvas: px.canvas };
	return shared;

}

// the lectern as a group in its local frame (merged desk + the placard quad); `material` is the agents' prop material
export function makeLectern( material ) {

	const g = new Group();
	g.name = 'AgentLectern';
	const desk = new Mesh( buildLecternGeometry(), material );
	desk.name = 'AgentDesk';
	desk.castShadow = true;
	g.add( desk );
	try {

		const pl = placardMaterial();
		const face = new Mesh( new PlaneGeometry( PLACARD.w, PLACARD.h ), pl.material );
		face.name = 'AgentPlacard';
		face.position.set( 0, PLACARD.y, PLACARD.z );
		g.add( face );

	} catch ( e ) { /* the board without its words */ }

	return g;

}

export function lanternLight( x, y, z ) {

	return { position: new Vector3( x, y, z ), color: new Color( 1.0, 0.72, 0.42 ), intensity: 4.5, range: 9, kind: 'lantern', flicker: 0.08 };

}

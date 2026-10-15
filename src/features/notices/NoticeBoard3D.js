import { Group, Mesh, Vector3, PlaneGeometry } from '../../engine/index.js';
import { Texture, capImage } from '../../engine/gpu/Texture.js';
import { GPU } from '../../engine/gpu/GPU.js';
import { generateMipmaps } from '../../engine/gpu/Mipmaps.js';
import { prepare, mergePrepared, box, mat4 } from '../../world/boat/GeoKit.js';
import { createPropMaterial, PAT } from '../../game/GameMaterials.js';
import { standard } from '../../materials/Materials.js';
import { PORT_INFO, TYPE_LABEL, TIER_NAMES } from './NoticeData.js';

// The physical notice board: a weathered plank board on two posts under a small tin roof, with the port's
// postings pinned to it as paper notes. Two draw calls per board:
//   frame  posts, backing planks, frame, roof and ledge, merged into one mesh (createPropMaterial wood / rusty tin)
//   face   one quad carrying a canvas-drawn texture of the planks and the pinned notes (redrawn when the postings
//          change; without a canvas, as in node, a plain software picture of notes of the same layout)
// Built from engine geometry only; the board stands on the terrain at its site (Sites.js) and is solid (a collider).
//
//   const b = new NoticeBoard3D( { scene, terrain, colliders, site: { x, z, yaw }, port } );
//   b.refresh( postings );   // from Notices.board( port ); a no-op when nothing changed
//   b.group, b.meshes (the two meshes), b.dispose()

export const FACE = { w: 2.5, h: 1.4, y: 1.65 }; // metres, centre height above the ground
export const TEX_W = 1024, TEX_H = 572; // about 410 px per metre

// ---------------------------------------------------------------- the frame

export function buildFrameGeometry() {

	const P = [];
	const add = ( g, o ) => P.push( prepare( g, o ) );
	const WOOD = ( c ) => ( { color: c, rough: 0.9, pattern: PAT.wood } );
	const WOODX = ( c ) => ( { color: c, rough: 0.9, pattern: PAT.woodX } );
	const TIN = { color: 0x8c9296, rough: 0.55, metal: 0.7, pattern: PAT.rusty };
	let seed = 11;
	const jit = ( a ) => ( ( ( seed = ( seed * 16807 ) % 2147483647 ) / 2147483647 ) - 0.5 ) * a;

	// two posts, a little out of true, sunk into the ground
	for ( const sx of [ - 1, 1 ] ) add( box( 0.15, 2.9, 0.15 ), { ...WOOD( 0x6f5f4c ), matrix: mat4( sx * 1.43, 1.1, - 0.05, jit( 0.02 ), 0, jit( 0.03 ) ) } );
	// backing planks of uneven tone behind the face
	for ( let i = 0; i < 4; i ++ ) add( box( 2.64, 0.378, 0.06 ), { ...WOODX( [ 0x7a6b58, 0x6a5c4a, 0x84735f, 0x706250 ][ i ] ), matrix: mat4( jit( 0.02 ), 0.89 + 0.19 + i * 0.38, - 0.03, 0, 0, jit( 0.01 ) ) } );
	// the frame round the face
	for ( const sy of [ - 1, 1 ] ) add( box( 2.72, 0.09, 0.07 ), { ...WOODX( 0x5c4e3f ), matrix: mat4( 0, FACE.y + sy * ( FACE.h / 2 + 0.045 ), 0.03 ) } );
	for ( const sx of [ - 1, 1 ] ) add( box( 0.09, FACE.h + 0.18, 0.07 ), { ...WOOD( 0x5c4e3f ), matrix: mat4( sx * ( FACE.w / 2 + 0.045 ), FACE.y, 0.03 ) } );
	// cross bar behind, a ledge in front with its brackets
	add( box( 2.95, 0.1, 0.08 ), { ...WOODX( 0x66574a ), matrix: mat4( 0, 0.55, - 0.12 ) } );
	add( box( 2.7, 0.05, 0.3 ), { ...WOODX( 0x7d6c58 ), matrix: mat4( 0, 0.82, 0.14 ) } );
	for ( const sx of [ - 1, 1 ] ) add( box( 0.05, 0.16, 0.24 ), { ...WOOD( 0x5c4e3f ), matrix: mat4( sx * 1.1, 0.72, 0.1 ) } );
	// the roof: rusty tin sloping forward, over the posts
	add( box( 3.15, 0.05, 0.85 ), { ...TIN, matrix: mat4( 0, 2.62, 0.12, 0.16, 0, 0.0 ) } );
	add( box( 3.15, 0.07, 0.07 ), { ...WOODX( 0x5c4e3f ), matrix: mat4( 0, 2.7, - 0.28, 0.16 ) } );
	return mergePrepared( P );

}

// ---------------------------------------------------------------- the face texture

const NOTE_W = 292, NOTE_H = 214;
const CELL_W = TEX_W / 3, HEADER = 82, CELL_H = ( TEX_H - HEADER ) / 2;
const TYPE_TINT = {
	catchSpecies: '#3f8f93', catchWeight: '#3f8f93', catchHabitat: '#3f8f93', sellFish: '#b0843a', deliverCargo: '#4a6fa5',
	visitPort: '#6a8f4f', sinkPirate: '#9a3b34', shoreRaider: '#9a3b34', bounty: '#8b1f1a',
};

// a tiny deterministic noise so the board looks the same every time it is drawn
function prng( seed ) {

	let a = seed >>> 0;
	return () => {

		a = ( a * 1664525 + 1013904223 ) >>> 0;
		return a / 4294967296;

	};

}

function makeCanvas( w, h ) {

	if ( typeof OffscreenCanvas !== 'undefined' ) return new OffscreenCanvas( w, h );
	if ( typeof document !== 'undefined' ) return Object.assign( document.createElement( 'canvas' ), { width: w, height: h } );
	return null;

}

// where note i sits: a 3 x 2 grid with a little jitter and tilt
export function noteSlot( i, port ) {

	const r = prng( i * 7919 + ( port === 'pons' ? 101 : 17 ) );
	const col = i % 3, row = Math.floor( i / 3 );
	return {
		x: col * CELL_W + ( CELL_W - NOTE_W ) / 2 + ( r() - 0.5 ) * 16,
		y: HEADER + row * CELL_H + ( CELL_H - NOTE_H ) / 2 + ( r() - 0.5 ) * 12,
		rot: ( r() - 0.5 ) * 0.1,
	};

}

// RGBA pixels of the face for the given postings: { width, height, data: Uint8Array }
// phones draw the boards at half size (3.1 -> 0.8 MB of GPU memory a board, wave 19A's headroom list)
const boardPixels = ( postings, port ) => {

	const px = drawBoardPixels( postings, port );
	if ( ! globalThis.__phoneBudget ) return px;
	const half = capImage( px, TEX_W / 2 );
	return { ...half, canvas: px.canvas };

};

export function drawBoardPixels( postings, port = 'home' ) {

	const cv = makeCanvas( TEX_W, TEX_H );
	const ctx = cv && cv.getContext ? cv.getContext( '2d' ) : null;
	if ( ctx ) {

		drawCanvas( ctx, postings, port );
		const img = ctx.getImageData( 0, 0, TEX_W, TEX_H );
		return { width: TEX_W, height: TEX_H, data: new Uint8Array( img.data.buffer, img.data.byteOffset, img.data.byteLength ), canvas: true };

	}

	return { width: TEX_W, height: TEX_H, data: drawSoftware( postings, port ), canvas: false };

}

function drawCanvas( ctx, postings, port ) {

	const rnd = prng( 4242 );
	// planks, each a slightly different weathered brown, with grain and a dark seam between
	const rows = 9, ph = TEX_H / rows;
	for ( let i = 0; i < rows; i ++ ) {

		const t = 0.8 + rnd() * 0.35;
		ctx.fillStyle = `rgb(${ Math.round( 112 * t ) },${ Math.round( 94 * t ) },${ Math.round( 74 * t ) })`;
		ctx.fillRect( 0, i * ph, TEX_W, ph + 1 );
		ctx.strokeStyle = 'rgba(40,30,22,0.28)';
		ctx.lineWidth = 1;
		for ( let k = 0; k < 14; k ++ ) {

			const y = i * ph + 4 + rnd() * ( ph - 8 );
			ctx.beginPath();
			ctx.moveTo( rnd() * TEX_W, y );
			ctx.lineTo( rnd() * TEX_W, y + ( rnd() - 0.5 ) * 3 );
			ctx.stroke();

		}

		ctx.fillStyle = 'rgba(25,18,12,0.7)';
		ctx.fillRect( 0, i * ph, TEX_W, 2 );

	}

	// the painted header
	ctx.fillStyle = 'rgba(30,24,18,0.55)';
	ctx.fillRect( 0, 0, TEX_W, HEADER - 14 );
	ctx.fillStyle = '#e8dfc8';
	ctx.font = 'bold 40px Georgia, serif';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText( `${ PORT_INFO[ port ].name.toUpperCase() } · NOTICES`, TEX_W / 2, ( HEADER - 14 ) / 2 + 2 );
	ctx.textAlign = 'left';

	for ( let i = 0; i < 6; i ++ ) {

		const s = noteSlot( i, port ), p = postings[ i ];
		ctx.save();
		ctx.translate( s.x + NOTE_W / 2, s.y + NOTE_H / 2 );
		ctx.rotate( s.rot );
		if ( p ) drawNote( ctx, p ); else drawScrap( ctx, rnd );
		ctx.restore();

	}

}

function wrap( ctx, text, maxW, maxLines ) {

	const words = String( text ).split( ' ' ), lines = [];
	let line = '';
	for ( const w of words ) {

		const t = line ? `${ line } ${ w }` : w;
		if ( ctx.measureText( t ).width > maxW && line ) {

			lines.push( line );
			line = w;

		} else line = t;

	}

	if ( line ) lines.push( line );
	if ( lines.length > maxLines ) {

		lines.length = maxLines;
		lines[ maxLines - 1 ] = lines[ maxLines - 1 ].replace( /.{0,2}$/, '...' );

	}

	return lines;

}

function drawNote( ctx, p ) {

	const w = NOTE_W, h = NOTE_H, x = - w / 2, y = - h / 2, bounty = p.kind === 'bounty';
	ctx.fillStyle = 'rgba(0,0,0,0.38)';
	ctx.fillRect( x + 6, y + 8, w, h );
	const g = ctx.createLinearGradient( x, y, x + w, y + h );
	g.addColorStop( 0, bounty ? '#ecdcae' : '#f1e9d3' );
	g.addColorStop( 1, bounty ? '#d9c389' : '#e0d6bb' );
	ctx.fillStyle = g;
	ctx.fillRect( x, y, w, h );
	// header band
	ctx.fillStyle = TYPE_TINT[ p.type ] || '#555';
	ctx.fillRect( x, y, w, 40 );
	ctx.fillStyle = '#f6efdc';
	ctx.textBaseline = 'middle';
	ctx.textAlign = 'center';
	ctx.font = `bold ${ bounty ? 30 : 22 }px Georgia, serif`;
	ctx.fillText( bounty ? 'WANTED' : ( TYPE_LABEL[ p.type ] || 'NOTICE' ).toUpperCase(), 0, y + 21 );
	// the title
	ctx.fillStyle = '#2c241a';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'alphabetic';
	ctx.font = 'bold 21px Georgia, serif';
	const title = bounty ? p.captain : p.title;
	const lines = wrap( ctx, title, w - 28, bounty ? 1 : 3 );
	lines.forEach( ( l, i ) => ctx.fillText( l, 0, y + 74 + i * 25 ) );
	if ( bounty ) {

		ctx.font = 'italic 17px Georgia, serif';
		ctx.fillText( p.epithet, 0, y + 100 );
		ctx.font = '17px Georgia, serif';
		ctx.fillStyle = '#7a5b2a';
		ctx.fillText( `${ '★'.repeat( p.tier ) }${ '☆'.repeat( 3 - p.tier ) } ${ TIER_NAMES[ p.tier ] }`, 0, y + 124 );

	}

	// payout
	ctx.fillStyle = bounty ? '#8b1f1a' : '#3b3326';
	ctx.font = 'bold 30px Georgia, serif';
	ctx.fillText( `$${ p.reward.money.toLocaleString( 'en-US' ) }`, 0, y + h - 38 );
	ctx.fillStyle = '#6c5f48';
	ctx.font = '15px Georgia, serif';
	ctx.fillText( p.client, 0, y + h - 14 );
	// a little ink wear, and the pin
	ctx.strokeStyle = 'rgba(70,55,35,0.12)';
	ctx.lineWidth = 1;
	ctx.strokeRect( x + 3, y + 3, w - 6, h - 6 );
	pin( ctx, 0, y + 6 );

}

// a torn remnant under a pin where a notice was taken
function drawScrap( ctx, rnd ) {

	ctx.fillStyle = 'rgba(0,0,0,0.28)';
	ctx.fillRect( - 32, - NOTE_H / 2 + 18, 64, 46 );
	ctx.fillStyle = '#d8ceb2';
	ctx.beginPath();
	ctx.moveTo( - 30, - NOTE_H / 2 + 10 );
	ctx.lineTo( 30, - NOTE_H / 2 + 10 );
	ctx.lineTo( 28 + rnd() * 6, - NOTE_H / 2 + 40 );
	ctx.lineTo( 10, - NOTE_H / 2 + 52 );
	ctx.lineTo( - 6, - NOTE_H / 2 + 38 );
	ctx.lineTo( - 30, - NOTE_H / 2 + 48 );
	ctx.closePath();
	ctx.fill();
	pin( ctx, 0, - NOTE_H / 2 + 16 );

}

function pin( ctx, x, y ) {

	ctx.fillStyle = 'rgba(0,0,0,0.4)';
	ctx.beginPath(); ctx.arc( x + 2, y + 3, 7, 0, Math.PI * 2 ); ctx.fill();
	ctx.fillStyle = '#a02a22';
	ctx.beginPath(); ctx.arc( x, y, 7, 0, Math.PI * 2 ); ctx.fill();
	ctx.fillStyle = 'rgba(255,255,255,0.45)';
	ctx.beginPath(); ctx.arc( x - 2, y - 2, 2.4, 0, Math.PI * 2 ); ctx.fill();

}

// no canvas (node): planks and plain rectangles in the notes' places, so the layout and the material can still run
function drawSoftware( postings, port ) {

	const data = new Uint8Array( TEX_W * TEX_H * 4 );
	const rows = 9, ph = TEX_H / rows, rnd = prng( 4242 );
	const tone = [];
	for ( let i = 0; i < rows; i ++ ) tone.push( 0.8 + rnd() * 0.35 );
	for ( let y = 0; y < TEX_H; y ++ ) {

		const t = tone[ Math.min( rows - 1, Math.floor( y / ph ) ) ], seam = y % Math.round( ph ) < 2 ? 0.4 : 1;
		for ( let x = 0; x < TEX_W; x ++ ) {

			const k = ( y * TEX_W + x ) * 4;
			data[ k ] = 112 * t * seam; data[ k + 1 ] = 94 * t * seam; data[ k + 2 ] = 74 * t * seam; data[ k + 3 ] = 255;

		}

	}

	const rect = ( x0, y0, w, h, r, g, b ) => {

		for ( let y = Math.max( 0, Math.floor( y0 ) ); y < Math.min( TEX_H, y0 + h ); y ++ ) for ( let x = Math.max( 0, Math.floor( x0 ) ); x < Math.min( TEX_W, x0 + w ); x ++ ) {

			const k = ( y * TEX_W + x ) * 4;
			data[ k ] = r; data[ k + 1 ] = g; data[ k + 2 ] = b;

		}

	};

	rect( 0, 0, TEX_W, HEADER - 14, 46, 38, 30 );
	postings.slice( 0, 6 ).forEach( ( p, i ) => {

		const s = noteSlot( i, port ), bounty = p.kind === 'bounty';
		rect( s.x + 6, s.y + 8, NOTE_W, NOTE_H, 30, 22, 16 );
		rect( s.x, s.y, NOTE_W, NOTE_H, bounty ? 226 : 236, bounty ? 208 : 228, bounty ? 160 : 205 );
		rect( s.x, s.y, NOTE_W, 40, bounty ? 139 : 63, bounty ? 31 : 143, bounty ? 26 : 147 );
		rect( s.x + NOTE_W / 2 - 7, s.y + 2, 14, 14, 160, 42, 34 );

	} );
	return data;

}

// ---------------------------------------------------------------- the board

export class NoticeBoard3D {

	constructor( { scene, terrain, colliders = null, site, port } ) {

		this.port = port;
		this.site = site;
		this.sig = '';
		this.tex = null;
		const y = terrain.heightAt( site.x, site.z );
		this.group = new Group();
		this.group.name = `NoticeBoard_${ port }`;
		this.group.position.set( site.x, y, site.z );
		this.group.rotation.y = site.yaw;

		this.frameMaterial = createPropMaterial( 'noticeBoard' );
		const frame = new Mesh( buildFrameGeometry(), this.frameMaterial );
		frame.name = 'NoticeBoardFrame';
		frame.castShadow = true;

		// the face texture exists from the start (the planks, no notes) so the material is complete
		const first = boardPixels( [], port );
		this.tex = new Texture( { label: `noticeBoard.${ port }`, width: first.width, height: first.height, format: 'rgba8unorm-srgb', mips: true, usage: [ 'sample', 'copyDst' ], data: first.data } );
		this.faceMaterial = standard( {
			name: 'noticeBoardFace',
			textures: { nbNotes: this.tex },
			surface: /* wgsl */`
	let t = textureSample( nbNotes, smpAnisoRepeat, vec2f( in.uv.x, 1.0 - in.uv.y ) );
	s.albedo = t.rgb;
	s.roughness = 0.88;
	s.metalness = 0.0;
`,
		} );
		const face = new Mesh( new PlaneGeometry( FACE.w, FACE.h ), this.faceMaterial );
		face.name = 'NoticeBoardFace';
		face.position.set( 0, FACE.y, 0.014 );
		this.meshes = [ frame, face ];
		this.group.add( frame, face );
		scene.add( this.group );
		this._gpu();

		// solid: the posts and the board
		if ( colliders && typeof colliders.addBox === 'function' ) {

			colliders.addBox( new Vector3( site.x, y + 1.4, site.z ), new Vector3( 1.5, 1.4, 0.22 ), site.yaw, { tag: 'noticeBoard' } );

		}

	}

	// make the GPU texture and its mips when a device exists (the app; not node)
	_gpu() {

		if ( ! GPU.device || ! this.tex ) return;
		this.tex.getGPU();
		generateMipmaps( this.tex );

	}

	// redraw the face when the postings changed
	refresh( postings ) {

		const sig = this.port + '|' + postings.map( ( p ) => `${ p.id }:${ p.expires }:${ p.reward.money }` ).join( ',' );
		if ( sig === this.sig ) return false;
		this.sig = sig;
		const px = boardPixels( postings, this.port );
		this.canvas = px.canvas;
		if ( GPU.device && this.tex.gpu ) {

			this.tex.upload( px.data );
			generateMipmaps( this.tex );

		} else {

			this.tex.pendingData = px.data;
			this._gpu();

		}

		return true;

	}

	dispose() {

		if ( this.group.parent ) this.group.parent.remove( this.group );
		for ( const m of this.meshes ) if ( m.geometry && m.geometry.dispose ) m.geometry.dispose();
		if ( this.tex ) this.tex.destroy();
		this.meshes = [];

	}

}

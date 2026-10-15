import { Group, Mesh, Vector3, Color, Matrix4 } from '../../engine/index.js';
import { mat4, box, cylinder, sphere, torus, rod } from '../boat/GeoKit.js';
import { createPropMaterial, PAT } from '../../game/GameMaterials.js';
import { WORLD } from '../WorldLayout.js';
import { Kit, PALETTE as P, GLOW, basis, addFish, addRoof, addLantern, addLanternString, addBunting, addHammock, addCord, sag } from './Shapes.js';

// Jade Landing: the player's first view of Hyptile Island. A jade-roofed fisher's pavilion on a timber deck
// in the east corner of the bay under the headland, a carved jade-fish totem on the sand in front of it,
// paper lanterns and bunting strung between them, fish drying racks on the north side, two striped hammocks
// on the sea side and a plank boardwalk west along the back of the beach to the boathouse footpath (Roid's
// yard, Ethena, PoorGoat and the pier). Layout: WORLD.landing (WorldLayout.js); the player starts on the deck
// (WORLD.start).
//
//   const landing = new Landing( { scene, terrain, colliders } );
//   landing.group, landing.lights (3 lanterns for LocalLights), landing.plan (deckTop, totem, boardwalk y, ...),
//   landing.stats() -> { triangles, colliders, lights }, landing.dispose()
//
// Two draws: everything rigid in one merged mesh, the cloth (bunting, hammocks, tassels) in a double-sided one
// that sways with the wind in the vertex shader. Paper lanterns glow after dusk (aux.w >= 2, Shapes.js GLOW).
// Nothing changes the terrain: every part reads terrain.heightAt and stands on it.

const L = WORLD.landing;
const DECK = { hx: 3.6, hz: 3.0, lift: 0.55 }; // deck half extents (local x across, z front-back), height above the highest ground
const EAVE = 2.75; // eave height above the deck
const BW = { width: 1.7, plank: 0.22, pitch: 0.27, lift: 0.16, chunk: 2.0 }; // boardwalk

// the wind sway of the cloth (aux.w = weight 0..1; >= 2 marks the glowing parts, which do not sway)
const SWAY = /* wgsl */`
	{
		let a = select( v.aux.w, 0.0, v.aux.w >= 1.5 );
		if ( a > 0.001 ) {
			let ph = frame.time * 2.6 + v.position.x * 0.9 + v.position.z * 0.7;
			let k = a * ( 0.04 + 0.014 * frame.windSpeed );
			let g = 0.6 + 0.4 * sin( ph ) + 0.15 * sin( ph * 2.3 + 1.7 );
			v.position += vec3f( frame.windDir.x * g, 0.12 * sin( ph * 1.7 ), frame.windDir.y * g ) * k;
		}
	}
`;
const GLOW_SURFACE = /* wgsl */`
	if ( in.vs.vAux.w > 1.5 ) {
		// paper lanterns: the paper's colour lit warm from inside, on at dusk (like the village's lanterns), a faint flicker
		let fl = 0.92 + 0.08 * sin( frame.time * 7.0 + in.P.x * 3.1 ) * sin( frame.time * 4.3 + in.P.z * 2.3 );
		s.emissive = mix( in.color.rgb, vec3f( 1.0, 0.62, 0.3 ), 0.45 ) * ( 0.05 + 3.4 * smoothstep( 0.15, 0.75, frame.night ) ) * fl;
	}
`;

export function landingMaterial( name, double = false ) {

	const m = createPropMaterial( name, { vertex: SWAY } );
	m.surface = m._surface + GLOW_SURFACE;
	if ( double ) m.side = 'double';
	return m;

}

// the landing frame: local (lx, lz) -> world [ x, z ]; matrices with the landing's yaw
export function landingFrame( layout = L ) {

	const c = Math.cos( layout.yaw ), s = Math.sin( layout.yaw ), o = layout.center;
	const w = ( lx, lz ) => [ o.x + lx * c + lz * s, o.z - lx * s + lz * c ];
	const local = ( x, z ) => { const dx = x - o.x, dz = z - o.z; return [ dx * c - dz * s, dx * s + dz * c ]; };
	const M = ( lx, y, lz, ry = 0, rx = 0, rz = 0, sx = 1, sy = sx, sz = sx ) => {

		const [ x, z ] = w( lx, lz );
		return mat4( x, y, z, rx, layout.yaw + ry, rz, sx, sy, sz );

	};

	return { w, local, M, yaw: layout.yaw };

}

export class Landing {

	constructor( { scene = null, terrain, colliders = null } ) {

		this.terrain = terrain;
		this.colliders = colliders;
		this.group = new Group();
		this.group.name = 'JadeLanding';
		this.lights = [];
		this._boxes = [];
		this._cyls = [];
		this.plan = {};
		const kit = this.kit = new Kit();
		const F = this.F = landingFrame();
		this.g = ( x, z ) => terrain.heightAt( x, z );

		this._pavilion( kit, F );
		this._totem( kit );
		this._racks( kit, F );
		this._hammocks( kit, F );
		this._boardwalk( kit );
		this._strings( kit, F );
		this._plantings( kit, F );

		this.material = landingMaterial( 'jadeLanding' );
		this.clothMaterial = landingMaterial( 'jadeLandingCloth', true );
		for ( const [ bucket, mat ] of [ [ 'solid', this.material ], [ 'cloth', this.clothMaterial ] ] ) {

			const geo = kit.merged( bucket );
			if ( ! geo ) continue;
			const mesh = new Mesh( geo, mat );
			mesh.name = 'JadeLanding_' + bucket;
			mesh.castShadow = true;
			this.group.add( mesh );

		}

		this.triangles = kit.triangles;
		this.kit = null; // the parts are merged: let the lists go
		if ( scene ) scene.add( this.group );

	}

	// ---- colliders (kept so dispose() can take them out again)

	_box( cx, cy, cz, hx, hy, hz, yaw, opts ) {

		if ( ! this.colliders ) return;
		this._boxes.push( this.colliders.addBox( new Vector3( cx, cy, cz ), new Vector3( hx, hy, hz ), yaw, opts ) );

	}

	_cyl( x, z, r, y0, y1, tag ) {

		if ( ! this.colliders ) return;
		this._cyls.push( this.colliders.addCylinder( x, z, r, y0, y1, { tag } ) );

	}

	// ---------------------------------------------------------------- the pavilion

	_pavilion( kit, F ) {

		const { hx, hz } = DECK;
		let gMax = - Infinity, gMin = Infinity;
		for ( let i = 0; i <= 6; i ++ ) for ( let j = 0; j <= 6; j ++ ) {

			const [ x, z ] = F.w( ( i / 6 - 0.5 ) * 2 * hx, ( j / 6 - 0.5 ) * 2 * hz );
			const h = this.g( x, z );
			gMax = Math.max( gMax, h ); gMin = Math.min( gMin, h );

		}

		const top = gMax + DECK.lift;
		this.plan.deckTop = top;
		this.plan.deck = { hx, hz, top };
		const wood = ( c, o = {} ) => ( { color: c, rough: 0.85, pattern: PAT.woodX, ...o } );

		// deck boards across (local x), hairline gaps, a little varied
		const tones = [ 0x9a7b58, 0x8d6f4f, 0xa48562, 0x86684a ];
		for ( let k = 0, n = Math.floor( 2 * hz / 0.24 ); k < n; k ++ ) {

			kit.add( 'solid', box( 2 * hx, 0.07, 0.225 ), { ...wood( tones[ k % 4 ] ), matrix: F.M( 0, top - 0.035, - hz + 0.12 + k * 0.24 ) } );

		}

		// skirt beams and stilts down into the sand
		for ( const s of [ - 1, 1 ] ) {

			kit.add( 'solid', box( 2 * hx + 0.1, 0.24, 0.14 ), { ...wood( P.coralDeep, { rough: 0.6 } ), matrix: F.M( 0, top - 0.19, s * ( hz + 0.02 ) ) } );
			kit.add( 'solid', box( 0.14, 0.24, 2 * hz + 0.1 ), { ...wood( P.coralDeep, { rough: 0.6 } ), matrix: F.M( s * ( hx + 0.02 ), top - 0.19, 0 ) } );

		}

		for ( const lx of [ - hx + 0.3, 0, hx - 0.3 ] ) for ( const lz of [ - hz + 0.3, 0, hz - 0.3 ] ) {

			const [ x, z ] = F.w( lx, lz );
			const g0 = this.g( x, z ) - 0.35, len = top - 0.3 - g0;
			kit.add( 'solid', cylinder( 0.11, 0.13, len, 8 ), { ...wood( P.timberDark, { pattern: PAT.wood } ), matrix: mat4( x, g0 + len / 2, z ) } );

		}

		// lacquered posts on stone bases, the lintel ring and a fret panel under the front beam
		const posts = [];
		for ( const lx of [ - hx + 0.25, hx - 0.25 ] ) for ( const lz of [ - hz + 0.25, 0.1, hz - 0.25 ] ) posts.push( [ lx, lz ] );
		for ( const [ lx, lz ] of posts ) {

			const [ x, z ] = F.w( lx, lz );
			kit.add( 'solid', cylinder( 0.2, 0.23, 0.18, 8 ), { color: P.stone, rough: 0.8, matrix: mat4( x, top + 0.09, z ) } );
			kit.add( 'solid', cylinder( 0.12, 0.13, EAVE, 12 ), { color: P.lacquer, rough: 0.45, matrix: mat4( x, top + EAVE / 2, z ) } );
			kit.add( 'solid', cylinder( 0.15, 0.15, 0.08, 12 ), { color: P.gold, rough: 0.35, metal: 0.6, matrix: mat4( x, top + EAVE - 0.3, z ) } );
			this._cyl( x, z, 0.16, top, top + EAVE, 'landingPost' );

		}

		for ( const s of [ - 1, 1 ] ) {

			kit.add( 'solid', box( 2 * hx, 0.26, 0.2 ), { color: P.coralDeep, rough: 0.55, matrix: F.M( 0, top + EAVE - 0.1, s * ( hz - 0.25 ) ) } );
			kit.add( 'solid', box( 0.2, 0.26, 2 * hz ), { color: P.coralDeep, rough: 0.55, matrix: F.M( s * ( hx - 0.25 ), top + EAVE - 0.1, 0 ) } );

		}

		for ( let k = 0; k < 13; k ++ ) {

			const lx = - hx + 0.6 + k * ( 2 * hx - 1.2 ) / 12;
			kit.add( 'solid', box( 0.04, 0.2 + ( k % 2 ) * 0.1, 0.04 ), { color: P.cream, rough: 0.6, matrix: F.M( lx, top + EAVE - 0.33 - ( k % 2 ) * 0.05, hz - 0.25 ) } );

		}

		// the back wall: cream plaster, a jade-framed moon window, a bench and the day's gear
		const wz = - hz + 0.18;
		kit.add( 'solid', box( 2 * hx - 0.5, 2.3, 0.16 ), { color: P.cream, rough: 0.9, matrix: F.M( 0, top + 1.15, wz ) } );
		kit.add( 'solid', cylinder( 0.62, 0.62, 0.17, 24 ), { color: 0x2a3a3a, rough: 0.3, matrix: F.M( 0, top + 1.45, wz, 0, Math.PI / 2 ) } );
		kit.add( 'solid', torus( 0.66, 0.07, 8, 28 ), { color: P.jade, rough: 0.3, matrix: F.M( 0, top + 1.45, wz + 0.1 ) } );
		for ( const a of [ 0, Math.PI / 4, - Math.PI / 4 ] ) kit.add( 'solid', box( 0.035, 1.24, 0.03 ), { color: P.jadeDeep, rough: 0.4, matrix: F.M( 0, top + 1.45, wz + 0.1, 0, 0, a ) } );
		this._boxL( 0, wz, top + 1.15, hx - 0.25, 1.15, 0.12, { tag: 'landingWall' } );
		// bench
		kit.add( 'solid', box( 2.6, 0.07, 0.42 ), { ...wood( 0x7a5a3c ), matrix: F.M( - 1.6, top + 0.46, wz + 0.38 ) } );
		for ( const s of [ - 1, 1 ] ) kit.add( 'solid', box( 0.07, 0.44, 0.36 ), { ...wood( 0x6a4e34 ), matrix: F.M( - 1.6 + s * 1.15, top + 0.22, wz + 0.38 ) } );
		this._boxL( - 1.6, wz + 0.38, top + 0.25, 1.3, 0.25, 0.22, { tag: 'landingBench' } );
		// a coil of rope, a creel basket and a bait bucket by the bench
		kit.add( 'solid', torus( 0.22, 0.05, 6, 16 ), { color: P.rope, rough: 0.9, pattern: PAT.cloth, matrix: F.M( 1.4, top + 0.05, wz + 0.5, 0, Math.PI / 2 ) } );
		kit.add( 'solid', torus( 0.17, 0.05, 6, 16 ), { color: P.rope, rough: 0.9, pattern: PAT.cloth, matrix: F.M( 1.4, top + 0.13, wz + 0.5, 0, Math.PI / 2 ) } );
		kit.add( 'solid', cylinder( 0.26, 0.2, 0.42, 10 ), { color: 0xb08a55, rough: 0.9, pattern: PAT.cloth, matrix: F.M( 2.2, top + 0.21, wz + 0.45 ) } );
		kit.add( 'solid', cylinder( 0.17, 0.15, 0.3, 10 ), { color: P.coral, rough: 0.5, matrix: F.M( 2.75, top + 0.15, wz + 0.5 ) } );
		// an oar leaning on the wall
		{

			const [ ax, az ] = F.w( 2.95, wz + 0.12 ), [ bx, bz ] = F.w( 2.55, wz + 0.55 );
			kit.add( 'solid', rod( new Vector3( ax, top + 2.0, az ), new Vector3( bx, top + 0.02, bz ), 0.03, 6 ), { ...wood( 0xb89064, { pattern: PAT.wood } ) } );
			kit.add( 'solid', box( 0.16, 0.5, 0.02 ), { color: P.coral, rough: 0.6, matrix: new Matrix4().multiplyMatrices( mat4( bx, top + 0.3, bz ), mat4( 0, 0, 0, 0, F.yaw + 0.4, 0.2 ) ) } );

		}

		// side rails (cream) between the posts, open at the front (the steps) and the back (the wall)
		for ( const s of [ - 1, 1 ] ) {

			const lx = s * ( hx - 0.25 );
			kit.add( 'solid', box( 0.08, 0.06, 2 * hz - 0.5 ), { color: P.cream, rough: 0.6, matrix: F.M( lx, top + 0.92, 0 ) } );
			kit.add( 'solid', box( 0.06, 0.05, 2 * hz - 0.5 ), { color: P.cream, rough: 0.6, matrix: F.M( lx, top + 0.3, 0 ) } );
			for ( let k = 0; k < 11; k ++ ) kit.add( 'solid', box( 0.035, 0.6, 0.035 ), { color: P.cream, rough: 0.6, matrix: F.M( lx, top + 0.61, - hz + 0.5 + k * ( 2 * hz - 1 ) / 10 ) } );
			this._boxL( lx, 0, top + 0.5, 0.06, 0.5, hz - 0.25, { tag: 'landingRail' } );

		}

		// the deck: walkable, solid below its top
		const bottom = gMin - 0.3;
		this._boxL( 0, 0, ( top + bottom ) / 2, hx, ( top - bottom ) / 2, hz, { walkable: true, tag: 'landingDeck' } );

		// steps down the front toward the bay (local +z)
		{

			const [ fx, fz ] = F.w( 0, hz + 1.2 );
			const gs = this.g( fx, fz );
			const rise = top - gs, nR = Math.max( 2, Math.ceil( rise / 0.2 ) ), rh = rise / nR, tread = 0.32;
			for ( let k = 1; k < nR; k ++ ) {

				const t = top - k * rh, lz = hz + ( k - 0.5 ) * tread;
				kit.add( 'solid', box( 2.2, 0.06, tread - 0.02 ), { ...wood( tones[ k % 4 ] ), matrix: F.M( 0, t - 0.03, lz ) } );
				const [ x, z ] = F.w( 0, lz );
				const gb = this.g( x, z ) - 0.3;
				this._box( x, ( t + gb ) / 2, z, 1.1, ( t - gb ) / 2, tread / 2 + 0.005, F.yaw, { walkable: true, tag: 'landingStep' } );

			}

			const run = ( nR - 1 ) * tread;
			for ( const s of [ - 1, 1 ] ) {

				const [ ax, az ] = F.w( s * 1.12, hz ), [ bx, bz ] = F.w( s * 1.12, hz + run + 0.1 );
				kit.add( 'solid', rod( new Vector3( ax, top - 0.08, az ), new Vector3( bx, this.g( bx, bz ) - 0.02, bz ), 0.06, 4 ), { color: P.coralDeep, rough: 0.6 } );
				// newel posts with jade knobs
				kit.add( 'solid', cylinder( 0.07, 0.07, 1.0, 8 ), { color: P.lacquer, rough: 0.45, matrix: mat4( bx, this.g( bx, bz ) + 0.5, bz ) } );
				kit.add( 'solid', sphere( 0.1, 10, 8 ), { color: P.jade, rough: 0.3, matrix: mat4( bx, this.g( bx, bz ) + 1.05, bz ) } );
				this._cyl( bx, bz, 0.09, this.g( bx, bz ), this.g( bx, bz ) + 1.1, 'landingNewel' );

			}

			this.plan.stepFoot = F.w( 0, hz + run + 0.35 );

		}

		// the jade roof with lifted corners
		const roof = addRoof( kit, F.M( 0, 0, 0 ), { hx: hx + 0.95, hz: hz + 0.95, y0: top + EAVE, h: 2.1, ridge: 0.42, lift: 0.5 } );
		this.plan.eaves = roof.eaveCorners; // front-left (+x, +z), front-right ... in Shapes order
		this.plan.roofTop = top + EAVE + 2.1;

		// a big paper lantern under the ridge, two small ones at the front beam
		const lc = addLantern( kit, new Vector3( ...this._xyz( 0, top + EAVE + 1.55, 0.2 ) ), 0.34, 0 );
		kit.add( 'solid', rod( new Vector3( lc.x, top + EAVE + 1.55, lc.z ), new Vector3( lc.x, top + EAVE + 1.95, lc.z ), 0.008, 3 ), { color: P.ink } );
		this.lights.push( { position: lc.clone(), color: new Color( 1.0, 0.7, 0.45 ), intensity: 6, range: 12, kind: 'lantern', flicker: 0.06 } );
		for ( const s of [ - 1, 1 ] ) addLantern( kit, new Vector3( ...this._xyz( s * 2.3, top + EAVE - 0.24, hz - 0.25 ) ), 0.2, s > 0 ? 2 : 1 );

		// a long coral banner with a jade fish down the wall to each side of the window
		for ( const s of [ - 1, 1 ] ) {

			kit.add( 'cloth', box( 0.5, 1.6, 0.012 ), { color: P.coral, rough: 0.9, pattern: PAT.cloth, anim: 0.05, matrix: F.M( s * 1.35, top + 1.35, wz + 0.1 ) } );
			addFish( kit, new Matrix4().multiplyMatrices( F.M( s * 1.35, top + 1.05, wz + 0.12 ), mat4( 0, 0, 0, 0, Math.PI / 2, 0 ) ), 0.5, 0.11, { bend: 0.5, plane: 'x', color: P.jadeDeep, fin: P.jade, width: 0.3 } );

		}

	}

	// a box collider in the landing frame (local centre lx, lz; yaw of the landing)
	_boxL( lx, lz, cy, hx, hy, hz, opts ) {

		const [ x, z ] = this.F.w( lx, lz );
		this._box( x, cy, z, hx, hy, hz, this.F.yaw, opts );

	}

	_xyz( lx, y, lz ) {

		const [ x, z ] = this.F.w( lx, lz );
		return [ x, y, z ];

	}

	// ---------------------------------------------------------------- the jade-fish totem

	_totem( kit ) {

		const t = L.totem, x = t.x, z = t.z;
		let g = Infinity;
		for ( const [ ox, oz ] of [ [ 0, 0 ], [ 0.9, 0 ], [ - 0.9, 0 ], [ 0, 0.9 ], [ 0, - 0.9 ] ] ) g = Math.min( g, this.g( x + ox, z + oz ) );
		const base = g - 0.15;
		const top = base + 0.75 + 5.6;
		this.plan.totem = { x, z, base, top };
		// octagonal stone plinth with a jade band
		kit.add( 'solid', cylinder( 0.95, 1.08, 0.75, 8 ), { color: P.stone, rough: 0.85, matrix: mat4( x, base + 0.375, z, 0, Math.PI / 8, 0 ) } );
		kit.add( 'solid', cylinder( 0.99, 0.99, 0.1, 8 ), { color: P.jadeDeep, rough: 0.4, matrix: mat4( x, base + 0.6, z, 0, Math.PI / 8, 0 ) } );
		// the lacquered pole with cream bands
		const y0 = base + 0.75;
		kit.add( 'solid', cylinder( 0.24, 0.3, 5.6, 14 ), { color: P.lacquer, rough: 0.45, matrix: mat4( x, y0 + 2.8, z ) } );
		for ( const h of [ 0.25, 1.45, 2.75, 4.05, 5.35 ] ) kit.add( 'solid', cylinder( 0.3 - h * 0.009, 0.31 - h * 0.009, 0.1, 14 ), { color: P.cream, rough: 0.6, matrix: mat4( x, y0 + h, z ) } );
		// three jade fish swimming round it, each a third of a turn on: the fish frame (Shapes.fishParts: +y nose,
		// +z back, bent sideways about local (-Rb, L/2)) is laid with x outward from the pole, y along the tangent
		// and z up, the bend centre on the pole's axis
		const fishL = 1.45, fishR = 0.24, ring = new Matrix4().makeBasis( new Vector3( 1, 0, 0 ), new Vector3( 0, 0, - 1 ), new Vector3( 0, 1, 0 ) );
		for ( let k = 0; k < 3; k ++ ) {

			const h = y0 + 0.8 + k * 1.3, a = k * 2.1 + 0.4;
			const Rb = 0.3 - ( h - y0 ) * 0.011 + fishR * 0.62; // the (tapering) pole radius plus the fish's half width
			const m = mat4( x, h, z, 0, a, 0 ).multiply( ring ).multiply( new Matrix4().makeTranslation( Rb, - fishL / 2, 0 ) );
			addFish( kit, m, fishL, fishR, { bend: fishL / Rb, plane: 'x', color: k === 1 ? P.jadeLight : P.jade, fin: k === 1 ? P.jade : P.jadeLight } );

		}

		// the crossarm with two paper lanterns and a coral pennant
		const ya = y0 + 4.95;
		kit.add( 'solid', box( 2.3, 0.14, 0.14 ), { color: P.coralDeep, rough: 0.55, matrix: mat4( x, ya, z, 0, 0.6, 0 ) } );
		const ca = Math.cos( 0.6 ), sa = Math.sin( 0.6 );
		for ( const s of [ - 1, 1 ] ) {

			const px = x + s * 1.05 * ca, pz = z - s * 1.05 * sa;
			kit.add( 'solid', sphere( 0.08, 8, 6 ), { color: P.gold, rough: 0.35, metal: 0.6, matrix: mat4( x + s * 1.18 * ca, ya, z - s * 1.18 * sa ) } );
			addLantern( kit, new Vector3( px, ya - 0.07, pz ), 0.21, s > 0 ? 0 : 2 );

		}

		// the crown: a jade carp leaping off the top of the pole, chasing a glowing pearl
		const crownL = 1.7;
		const leap = basis( new Vector3( x, top - 0.1, z ), new Vector3( 0.45, 1, - 0.25 ), new Vector3( - 1, 0.3, 0 ) );
		const bend = 1.3, Rb = crownL / bend, f = bend / 2;
		addFish( kit, leap, crownL, 0.32, { bend, plane: 'z', color: P.jadeLight, fin: P.jade, width: 0.58 } );
		const nose = new Vector3( 0, crownL / 2 + ( Rb + 0.08 ) * Math.sin( f ) + 0.24 * Math.cos( f ), - Rb + ( Rb + 0.08 ) * Math.cos( f ) - 0.24 * Math.sin( f ) ).applyMatrix4( leap );
		const pearl = sphere( 0.17, 14, 10 );
		pearl.applyMatrix4( mat4( nose.x, nose.y, nose.z ) );
		kit.add( 'solid', pearl, { color: 0xfff1d6, rough: 0.15, anim: GLOW } );
		this.plan.pearl = nose.clone();
		this.lights.push( { position: new Vector3( x, ya - 0.45, z ), color: new Color( 1.0, 0.72, 0.5 ), intensity: 5, range: 10, kind: 'lantern', flicker: 0.07 } );
		// offerings: small bowls on the plinth step
		for ( let k = 0; k < 4; k ++ ) {

			const a = k * Math.PI / 2 + 0.3;
			kit.add( 'solid', cylinder( 0.12, 0.07, 0.07, 10 ), { color: k % 2 ? P.jade : P.cream, rough: 0.35, matrix: mat4( x + Math.cos( a ) * 0.62, base + 0.785, z + Math.sin( a ) * 0.62 ) } );

		}

		this._cyl( x, z, 1.06, base, base + 0.75, 'totemPlinth' );
		this._cyl( x, z, 0.36, base, top + 0.5, 'totem' );

	}

	// ---------------------------------------------------------------- fish drying racks (north side)

	_racks( kit, F ) {

		const fishTones = [ 0xb48a52, 0xc9a26a, 0xa9b8bd, 0x9c7a4c, 0xd2b07a ];
		let seed = 11;
		const rnd = () => ( ( seed = ( seed * 16807 ) % 2147483647 ) / 2147483647 );
		this.plan.racks = [];
		for ( const [ lx, lz ] of [ [ - 6.6, 1.6 ], [ - 6.9, - 2.1 ] ] ) {

			const len = 2.9;
			const [ x, z ] = F.w( lx, lz );
			const g = this.g( x, z );
			this.plan.racks.push( { x, z } );
			// A-frame legs at each end, two poles
			for ( const e of [ - 1, 1 ] ) {

				for ( const s of [ - 1, 1 ] ) {

					const [ ax, az ] = F.w( lx + s * 0.45, lz + e * len / 2 ), [ bx, bz ] = F.w( lx, lz + e * len / 2 );
					kit.add( 'solid', rod( new Vector3( ax, this.g( ax, az ) - 0.15, az ), new Vector3( bx, g + 2.05, bz ), 0.045, 6 ), { color: P.timber, rough: 0.9, pattern: PAT.wood } );

				}

				const [ ex, ez ] = F.w( lx, lz + e * len / 2 );
				this._cyl( ex, ez, 0.35, g - 0.2, g + 2.0, 'dryingRack' );

			}

			for ( const [ ly, ox ] of [ [ 1.95, 0 ], [ 1.45, 0.2 ] ] ) {

				const [ ax, az ] = F.w( lx + ox, lz - len / 2 - 0.1 ), [ bx, bz ] = F.w( lx + ox, lz + len / 2 + 0.1 );
				const pa = new Vector3( ax, g + ly, az ), pb = new Vector3( bx, g + ly, bz );
				kit.add( 'solid', rod( pa, pb, 0.035, 6 ), { color: P.timberDark, rough: 0.9, pattern: PAT.wood } );
				// fish hung by the tail on short cords, head down
				for ( let k = 0; k < 9; k ++ ) {

					const t = ( k + 0.5 ) / 9;
					const p = new Vector3().lerpVectors( pa, pb, t );
					const fl = 0.34 + rnd() * 0.14;
					const hang = 0.06 + rnd() * 0.05;
					addCord( kit, [ p, p.clone().add( new Vector3( 0, - hang, 0 ) ) ], 0.006 );
					const m = basis( p.clone().add( new Vector3( 0, - hang, 0 ) ), new Vector3( 0, - 1, 0 ), new Vector3( Math.sin( F.yaw + rnd() ), 0, Math.cos( F.yaw + rnd() ) ) );
					const c = fishTones[ Math.floor( rnd() * fishTones.length ) ];
					addFish( kit, m, fl, fl * 0.2, { color: c, fin: c, rough: 0.5, metal: c === 0xa9b8bd ? 0.25 : 0, segs: 7, lite: true } );

				}

			}

			// a basket of salt under each rack
			const [ bx, bz ] = F.w( lx + 0.75, lz );
			kit.add( 'solid', cylinder( 0.3, 0.24, 0.32, 10 ), { color: 0xb08a55, rough: 0.9, pattern: PAT.cloth, matrix: mat4( bx, this.g( bx, bz ) + 0.16, bz ) } );
			kit.add( 'solid', cylinder( 0.27, 0.27, 0.04, 10 ), { color: 0xf3efe6, rough: 0.95, matrix: mat4( bx, this.g( bx, bz ) + 0.3, bz ) } );
			this._cyl( bx, bz, 0.3, this.g( bx, bz ), this.g( bx, bz ) + 0.34, 'saltBasket' );

		}

	}

	// ---------------------------------------------------------------- hammocks (sea side)

	_hammocks( kit, F ) {

		this.plan.hammocks = [];
		for ( const [ a, b ] of [ [ [ 5.0, - 2.7 ], [ 7.7, 0.1 ] ], [ [ 8.7, 2.1 ], [ 6.4, 4.9 ] ] ] ) {

			const tops = [];
			for ( const [ lx, lz ] of [ a, b ] ) {

				const [ x, z ] = F.w( lx, lz );
				const g = this.g( x, z );
				kit.add( 'solid', cylinder( 0.09, 0.11, 2.3, 8 ), { color: P.timber, rough: 0.9, pattern: PAT.wood, matrix: mat4( x, g + 0.95, z ) } );
				kit.add( 'solid', sphere( 0.11, 8, 6 ), { color: P.jade, rough: 0.35, matrix: mat4( x, g + 2.12, z ) } );
				kit.add( 'solid', torus( 0.11, 0.02, 4, 10 ), { color: P.rope, rough: 0.9, matrix: mat4( x, g + 1.72, z, Math.PI / 2 ) } );
				this._cyl( x, z, 0.13, g - 0.2, g + 2.2, 'hammockPost' );
				tops.push( new Vector3( x, g + 1.72, z ) );

			}

			addHammock( kit, tops[ 0 ], tops[ 1 ], { width: 0.95, sagDepth: 0.85 } );
			this.plan.hammocks.push( tops );

		}

	}

	// ---------------------------------------------------------------- the boardwalk to the boathouse path

	_boardwalk( kit ) {

		const pts = L.boardwalk.map( ( [ x, z ] ) => new Vector3( x, 0, z ) );
		const tones = [ 0x9a7f5e, 0x8f7454, 0xa68b68, 0x87694b, 0x947a59 ];
		const hw = BW.width / 2;
		let k = 0, seed = 5;
		const rnd = () => ( ( seed = ( seed * 16807 ) % 2147483647 ) / 2147483647 );
		const planks = [];
		for ( let i = 0; i < pts.length - 1; i ++ ) {

			const a = pts[ i ], b = pts[ i + 1 ];
			const d = new Vector3().subVectors( b, a );
			const len = d.length();
			d.normalize();
			const yaw = Math.atan2( d.x, d.z );
			const side = new Vector3( d.z, 0, - d.x );
			const last = i === pts.length - 2;
			for ( let s = i === 0 ? 0 : BW.pitch / 2; s < len + ( last ? BW.pitch * 0.6 : 0 ); s += BW.pitch ) {

				const p = a.clone().addScaledVector( d, s );
				let gy = this.g( p.x, p.z );
				for ( const o of [ - hw, hw ] ) gy = Math.max( gy, this.g( p.x + side.x * o, p.z + side.z * o ) );
				const y = gy + BW.lift;
				planks.push( { x: p.x, y, z: p.z, yaw, s: k * BW.pitch } );
				kit.add( 'solid', box( BW.width + ( rnd() - 0.5 ) * 0.08, 0.05, BW.plank ), { color: tones[ k % 5 ], rough: 0.9, pattern: PAT.woodX, matrix: mat4( p.x, y - 0.025, p.z, 0, yaw + ( rnd() - 0.5 ) * 0.03, 0 ) } );
				k ++;

			}

		}

		// two stringers under the planks, a chunk at a time, and the walkable colliders
		const per = Math.round( BW.chunk / BW.pitch );
		for ( let c = 0; c < planks.length - 1; c += per ) {

			// (overlapping by a plank; the last chunk runs to the last plank)
			const run = planks.slice( c, Math.min( planks.length, c + per + 1 ) );
			const p0 = run[ 0 ], p1 = run[ run.length - 1 ];
			const topY = Math.max( ...run.map( ( p ) => p.y ) );
			const mx = ( p0.x + p1.x ) / 2, mz = ( p0.z + p1.z ) / 2, my = ( p0.y + p1.y ) / 2;
			const len = Math.hypot( p1.x - p0.x, p1.z - p0.z ) + BW.plank;
			const yaw = Math.atan2( p1.x - p0.x, p1.z - p0.z );
			for ( const o of [ - 0.55, 0.55 ] ) {

				kit.add( 'solid', box( 0.1, 0.12, len ), { color: P.timberDark, rough: 0.95, pattern: PAT.woodZ, matrix: new Matrix4().multiplyMatrices( mat4( mx, my - 0.11, mz, 0, yaw, 0 ), mat4( o, 0, 0 ) ) } );

			}

			const gLow = Math.min( ...run.map( ( p ) => this.g( p.x, p.z ) ) ) - 0.3;
			this._box( mx, ( topY + gLow ) / 2, mz, BW.width / 2, ( topY - gLow ) / 2, len / 2, yaw, { walkable: true, tag: 'landingBoardwalk' } );

		}

		// low marker posts with little jade caps every ~12 m, alternating sides; one tall lantern pole a third of
		// the way along (the light at the dark middle of the walk)
		const total = planks.length;
		for ( let i = 20; i < total - 4; i += 44 ) {

			const p = planks[ i ], sgn = ( i / 44 ) % 2 < 1 ? 1 : - 1;
			const x = p.x + Math.cos( p.yaw ) * sgn * ( BW.width / 2 + 0.2 ), z = p.z - Math.sin( p.yaw ) * sgn * ( BW.width / 2 + 0.2 );
			const g = this.g( x, z );
			kit.add( 'solid', box( 0.14, 0.9, 0.14 ), { color: P.timber, rough: 0.9, pattern: PAT.wood, matrix: mat4( x, g + 0.4, z, 0, p.yaw, 0 ) } );
			kit.add( 'solid', cylinder( 0.0, 0.14, 0.16, 4 ), { color: P.jade, rough: 0.35, matrix: mat4( x, g + 0.93, z, 0, p.yaw + Math.PI / 4, 0 ) } );
			kit.add( 'solid', box( 0.1, 0.08, 0.1 ), { color: 0xffe2b0, rough: 0.6, anim: GLOW, matrix: mat4( x, g + 0.8, z, 0, p.yaw, 0 ) } );
			this._cyl( x, z, 0.12, g, g + 1.0, 'boardwalkPost' );

		}

		this.plan.boardwalk = { planks: planks.length, start: pts[ 0 ], end: pts[ pts.length - 1 ], heightAt: ( x, z ) => {

			// nearest plank's top (tests, other modules)
			let best = null, bd = Infinity;
			for ( const p of planks ) { const d = ( p.x - x ) ** 2 + ( p.z - z ) ** 2; if ( d < bd ) { bd = d; best = p; } }
			return best && bd < 4 ? best.y : null;

		} };
		this._planks = planks;

	}

	// ---------------------------------------------------------------- lantern strings and bunting

	_strings( kit, F ) {

		const top = this.plan.deckTop;
		const [ eFL, eFR ] = [ this.plan.eaves[ 0 ], this.plan.eaves[ 1 ] ]; // ( -x, +z ), ( +x, +z ) of the roof frame
		// a tall lantern pole where the boardwalk leaves the steps (north side of it)
		const p0 = this._planks[ 26 ];
		const px = p0.x - Math.cos( p0.yaw ) * 1.35, pz = p0.z + Math.sin( p0.yaw ) * 1.35;
		const pg = this.g( px, pz );
		kit.add( 'solid', cylinder( 0.08, 0.11, 4.4, 8 ), { color: P.lacquer, rough: 0.45, matrix: mat4( px, pg + 2.0, pz ) } );
		kit.add( 'solid', sphere( 0.12, 10, 8 ), { color: P.gold, rough: 0.35, metal: 0.6, matrix: mat4( px, pg + 4.25, pz ) } );
		kit.add( 'solid', box( 0.9, 0.08, 0.08 ), { color: P.coralDeep, rough: 0.55, matrix: mat4( px, pg + 3.6, pz, 0, p0.yaw + Math.PI / 2, 0 ) } );
		const lp = addLantern( kit, new Vector3( px + Math.sin( p0.yaw + Math.PI / 2 ) * 0.4, pg + 3.55, pz + Math.cos( p0.yaw + Math.PI / 2 ) * 0.4 ), 0.24, 0 );
		this.lights.push( { position: lp.clone(), color: new Color( 1.0, 0.72, 0.45 ), intensity: 5, range: 11, kind: 'lantern', flicker: 0.08 } );
		this._cyl( px, pz, 0.12, pg, pg + 4.3, 'lanternPole' );
		const poleTop = new Vector3( px, pg + 4.1, pz );
		this.plan.pole = { x: px, z: pz };

		const T = this.plan.totem;
		const totemTop = new Vector3( T.x, T.base + 0.75 + 5.25, T.z );
		// eave to totem: paper lanterns; eave to the pole: bunting; totem to the pole: lanterns; pole to the first hammock post
		const eaveA = eFL.clone().add( new Vector3( 0, - 0.35, 0 ) ), eaveB = eFR.clone().add( new Vector3( 0, - 0.35, 0 ) );
		const dA = eaveA.distanceTo( totemTop ), dB = eaveB.distanceTo( totemTop );
		const toTotem = dA < dB ? eaveA : eaveB, toPole = dA < dB ? eaveB : eaveA;
		// every strung line (the intro's camera path keeps clear of them): a, b, sag depth, how far its things hang below
		const strings = this.plan.strings = [];
		const string = ( a, b, depth, hang ) => strings.push( { a: a.clone(), b: b.clone(), depth, hang } );
		addLanternString( kit, toTotem, totemTop, { depth: 0.9, n: 6, size: 0.17 } );
		string( toTotem, totemTop, 0.9, 0.5 );
		addBunting( kit, toPole, poleTop, { depth: 0.6 } );
		string( toPole, poleTop, 0.6, 0.32 );
		const tA = totemTop.clone().add( new Vector3( 0, - 0.25, 0 ) ), pB = poleTop.clone().add( new Vector3( 0, - 0.3, 0 ) );
		addLanternString( kit, tA, pB, { depth: 1.0, n: 7, size: 0.16, offset: 1 } );
		string( tA, pB, 1.0, 0.5 );
		// pairs of poles across the boardwalk with bunting between them, a third and two thirds of the way along
		for ( const f of [ 0.36, 0.68 ] ) {

			const q = this._planks[ Math.round( this._planks.length * f ) ];
			const tops = [];
			for ( const sgn of [ - 1, 1 ] ) {

				const x = q.x + Math.cos( q.yaw ) * sgn * 1.25, z = q.z - Math.sin( q.yaw ) * sgn * 1.25;
				const gy = this.g( x, z );
				kit.add( 'solid', cylinder( 0.06, 0.08, 3.9, 8 ), { color: P.lacquer, rough: 0.45, matrix: mat4( x, gy + 1.75, z ) } );
				kit.add( 'solid', sphere( 0.09, 8, 6 ), { color: P.jade, rough: 0.35, matrix: mat4( x, gy + 3.75, z ) } );
				this._cyl( x, z, 0.1, gy, gy + 3.8, 'buntingPole' );
				tops.push( new Vector3( x, gy + 3.5, z ) );

			}

			addBunting( kit, tops[ 0 ], tops[ 1 ], { depth: 0.25, spacing: 0.36, size: 0.28, offset: f > 0.5 ? 1 : 3 } );
			string( tops[ 0 ], tops[ 1 ], 0.25, 0.6 );
			addLantern( kit, new Vector3().lerpVectors( tops[ 0 ], tops[ 1 ], 0.5 ).add( new Vector3( 0, - 0.27, 0 ) ), 0.2, f > 0.5 ? 2 : 0 );

		}

		// (the sea side stays open: the intro's camera swings in there)
		void top;

	}

	// ---------------------------------------------------------------- plantings by the steps

	_plantings( kit, F ) {

		const hz = DECK.hz;
		for ( const [ lx, lz, c ] of [ [ - 1.9, hz + 0.9, P.jade ], [ 1.9, hz + 0.9, P.cream ], [ - 4.4, hz + 0.4, P.coral ] ] ) {

			const [ x, z ] = F.w( lx, lz );
			const g = this.g( x, z );
			kit.add( 'solid', cylinder( 0.34, 0.24, 0.55, 12 ), { color: c, rough: 0.4, matrix: mat4( x, g + 0.27, z ) } );
			kit.add( 'solid', cylinder( 0.36, 0.36, 0.06, 12 ), { color: P.gold, rough: 0.4, metal: 0.4, matrix: mat4( x, g + 0.56, z ) } );
			// broad leaves fanning out of the pot (ti / banana)
			for ( let k = 0; k < 7; k ++ ) {

				const a = k * 2.4 + lx, tilt = 0.35 + ( k % 3 ) * 0.22;
				const leaf = sphere( 1, 8, 5 );
				leaf.applyMatrix4( new Matrix4().multiplyMatrices( mat4( x, g + 0.55, z, 0, a, 0 ), new Matrix4().multiplyMatrices( mat4( 0, 0, 0, tilt, 0, 0 ), mat4( 0, 0.55, 0, 0, 0, 0, 0.13, 0.55, 0.02 ) ) ) );
				kit.add( 'cloth', leaf, { color: k % 2 ? 0x3f7a3a : 0x5a9443, rough: 0.6, anim: 0.15 } );

			}

			this._cyl( x, z, 0.36, g, g + 0.9, 'planter' );

		}

	}

	stats() {

		return { triangles: this.triangles, colliders: this._boxes.length + this._cyls.length, lights: this.lights.length };

	}

	dispose() {

		if ( this.group.parent ) this.group.parent.remove( this.group );
		if ( this.colliders ) {

			this.colliders.boxes = this.colliders.boxes.filter( ( b ) => ! this._boxes.includes( b ) );
			this.colliders.cylinders = this.colliders.cylinders.filter( ( c ) => ! this._cyls.includes( c ) );

		}

		for ( const m of this.group.children ) if ( m.geometry && m.geometry.dispose ) m.geometry.dispose();
		this._boxes = [];
		this._cyls = [];

	}

}

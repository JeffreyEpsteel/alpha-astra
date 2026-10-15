// The navy's looks. Wave 19F: the navy sails its own ships, public/models/navy/frigate.glb and revenue.glb (tools/navy/
// build_navy_ships.py, Blender headless, in the brigantine_v2's conventions: +X forward, origin at the waterline centre, the
// brigantine's materials and textures plus the navy's blue / white paint, blue canvas and the helm wheel). drawNavy( models )
// teaches naval's ModelSet (Models.js) to load, for a class with model 'navy' and a navyGlb (ShipClasses: the frigate, the
// revenue cutter), that GLB as the class's own template (the same StaticGLB load, hull centring, lantern glass and night glow
// as naval's ships; ModelSet.create / ready / setNight / dispose work unchanged). The wheel is its own mesh in these GLBs
// (M_NavyHelmWheel): liftWheel() takes it out of the hull and hands ShipVisual the turning wheel naval carves out of the others.
// MastFall's spars / sails / rigging match by material as on the pirates' ships, so the masts fall the same way.
//
// If a navy GLB fails to load, the visual falls back to wave 19B's look: the base class's GLB (brigantine / sloop) at cls.scale
// in navy dress (dressGeometry: a white strake with a second tier of gun ports and barrels, pennants and the blue ensign; one
// merged mesh per class, vertex colours, the prop material).
//
// The naval jetty at Tidemark (Routes.NAVY_JETTY): a plank deck on piles out to 4.7 m of water, a wider platform at its foot with
// the navy office hut (bounties, the chandler, the forecast), a flagstaff at its head; walkable boxes for the deck and the
// platform, a solid one for the hut. buildJetty( { scene, colliders, terrain } ) -> { group, boxes, dispose() }.
//
// Measured on the base GLBs (the dress; model frame, before the class's scale): the brigantine's sides stand at 3.40 m out
// between 1.8 and 3 m over |z| < 6; the sloop's at 2.60 m over |z| < 4.

import { Group, Mesh, Vector3 } from '../../engine/index.js';
import { box, cylinder, prepare, mergePrepared, mat4 } from '../../world/boat/GeoKit.js';
import { launchMaterial } from '../../world/boat/Launch.js';
import { PAT } from '../../game/GameMaterials.js';
import { SHIP_CLASSES } from '../naval/ShipClasses.js';
import { NAVY_JETTY } from '../naval/Routes.js';
import { centreOnHull } from '../naval/Models.js';

export const NAVY_PAINT = { blue: 0x1b3672, white: 0xeeeae0, port: 0x141518, iron: 0x26282c, gold: 0xc9a23c, plank: 0x8a6a48, pile: 0x4e3b2a, roof: 0x31455f, wall: 0xd9d2c0 };

// per base class: the strake (half-width out, y band, z span), gun ports along it, the masts (z, top) and the stern (z, y)
const DRESS = {
	brigantine: { side: 3.43, y0: 1.92, y1: 2.42, z: 6.4, ports: [ - 4.15, 0, 4.15 ], portY: 2.16, masts: [ [ 4.4, 13.5 ], [ - 2.4, 14.65 ] ], stern: [ - 9.4, 4.4 ], flag: [ 1.6, 1.05 ] },
	sloop: { side: 2.63, y0: 1.86, y1: 2.18, z: 3.7, ports: [], portY: 0, masts: [ [ 1.44, 11.8 ] ], stern: [ - 6.75, 3.7 ], flag: [ 1.25, 0.8 ] },
};

const _dress = new Map();

// the dress geometry of a navy class (base model units: the visual's group carries the scale), or null
export function dressGeometry( kind ) {

	if ( _dress.has( kind ) ) return _dress.get( kind );
	const cls = SHIP_CLASSES[ kind ], D = cls && DRESS[ cls.base ];
	if ( ! D ) { _dress.set( kind, null ); return null; }
	const parts = [];
	const add = ( g, color, m, rough = 0.6, pattern = PAT.plain, metal = 0 ) => parts.push( prepare( g, { color, rough, metal, pattern, matrix: m } ) );
	for ( const sx of [ 1, - 1 ] ) {

		// the strake: a white band standing 2 cm off the side
		add( box( 0.04, D.y1 - D.y0, D.z * 2 ), NAVY_PAINT.white, mat4( sx * D.side, ( D.y0 + D.y1 ) / 2, 0 ), 0.55, PAT.wood );
		for ( const z of D.ports ) {

			add( box( 0.06, 0.34, 0.42 ), NAVY_PAINT.port, mat4( sx * ( D.side + 0.01 ), D.portY, z ), 0.8 );
			// the barrel out of the port (its axis across the ship)
			add( cylinder( 0.1, 0.12, 0.75, 10 ), NAVY_PAINT.iron, mat4( sx * ( D.side + 0.36 ), D.portY, z, 0, 0, Math.PI / 2 ), 0.45, PAT.plain, 0.6 );

		}

	}

	// pennants: long and narrow, streaming aft from each masthead (blue, the inner third white)
	for ( const [ z, top ] of D.masts ) {

		add( box( 0.03, 0.34, 1.3 ), NAVY_PAINT.white, mat4( 0, top, z - 0.65 ), 0.8, PAT.cloth );
		add( box( 0.03, 0.26, 2.6 ), NAVY_PAINT.blue, mat4( 0, top - 0.02, z - 2.6, 0.04, 0, 0 ), 0.8, PAT.cloth );

	}

	// the stern ensign on its staff: blue with a white cross
	const [ sz, sy ] = D.stern, [ fw, fh ] = D.flag;
	add( cylinder( 0.05, 0.06, fh + 1.6, 6 ), NAVY_PAINT.pile, mat4( 0, sy + ( fh + 1.6 ) / 2 - 1.0, sz ), 0.7, PAT.wood );
	const fz = sz - fw / 2 - 0.05, fy = sy + fh + 0.6 - fh / 2 - 0.05; // (the flag at the head of its staff, flying aft)
	add( box( 0.03, fh, fw ), NAVY_PAINT.blue, mat4( 0, fy, fz ), 0.85, PAT.cloth );
	add( box( 0.045, fh, fw * 0.14 ), NAVY_PAINT.white, mat4( 0, fy, fz + fw * 0.12 ), 0.85, PAT.cloth );
	add( box( 0.045, fh * 0.2, fw ), NAVY_PAINT.white, mat4( 0, fy, fz ), 0.85, PAT.cloth );
	const g = mergePrepared( parts );
	_dress.set( kind, g );
	return g;

}

// the mesh of the turning wheel in a navy GLB (StaticGLB names each mesh 'ship-' + its material)
export const WHEEL_MESH = 'ship-M_NavyHelmWheel';

// Take the wheel out of a loaded navy template (after centreOnHull): its geometry turned from the GLB frame (+X forward, Z the
// beam) into the boat frame (+Z forward, +X port) about its hub, so ShipVisual._fillWheel spins it about the axle (+Z).
// -> { position (boat frame), parts: [ { geometry, material } ], turns, radius, triangles } or null (no wheel mesh)
export function liftWheel( glb, turns = 1.25 ) {

	const m = glb && glb.meshes ? glb.meshes.find( ( x ) => x.name === WHEEL_MESH ) : null;
	if ( ! m ) return null;
	const g = m.geometry;
	if ( ! g.boundingBox ) g.computeBoundingBox();
	const b = g.boundingBox;
	// the hub: the middle of the wheel's box (the rim, the spokes and the boss are symmetric about it)
	const cx = ( b.min.x + b.max.x ) / 2, cy = ( b.min.y + b.max.y ) / 2, cz = ( b.min.z + b.max.z ) / 2;
	const radius = ( b.max.y - b.min.y ) / 2;
	const hub = new Vector3( - cz, cy, cx );
	const P = g.attributes.position, N = g.attributes.normal;
	const p = P.array, n = N ? N.array : null;
	for ( let k = 0; k < p.length; k += 3 ) {

		const x = p[ k ], y = p[ k + 1 ], z = p[ k + 2 ];
		p[ k ] = - z - hub.x;
		p[ k + 1 ] = y - hub.y;
		p[ k + 2 ] = x - hub.z;
		if ( n ) {

			const nx = n[ k ], nz = n[ k + 2 ];
			n[ k ] = - nz;
			n[ k + 2 ] = nx;

		}

	}

	P.needsUpdate = true;
	if ( N ) N.needsUpdate = true;
	g.computeBoundingBox();
	g.computeBoundingSphere();
	// (a new array: StaticGLB's dispose still holds the mesh and frees its geometry)
	glb.meshes = glb.meshes.filter( ( x ) => x !== m );
	const triangles = ( g.index ? g.index.count : P.count ) / 3;
	return { position: hub, parts: [ { geometry: g, material: m.material } ], turns, radius, triangles };

}

// the template of a navy class in ModelSet `set` (its own GLB), in the shape of ModelSet._template's
function navyTemplate( set, kind, cls ) {

	let t = set.templates.get( kind );
	if ( t && t.navy ) return t;
	t = { glb: null, failed: false, promise: null, navy: true };
	set.templates.set( kind, t );
	t.promise = ( async () => {

		const load = set.loader || ( await import( '../../world/boat/StaticGLB.js' ) ).loadStaticGLB;
		const glb = await load( set.baseUrl + cls.navyGlb, { shadows: true, prefix: 'ship-', materials: () => ( { underwaterLighting: 'lite' } ) } );
		if ( set.disposed ) {

			glb.dispose();
			return null;

		}

		centreOnHull( glb );
		glb.wheel = liftWheel( glb );
		t.glb = glb;
		for ( const m of glb.materials ) m.underwaterLighting = 'lite';
		if ( typeof set._lantern === 'function' ) set._lantern( glb );
		for ( const v of set.visuals ) if ( v.kind === kind ) v.fill( glb );
		return glb;

	} )().catch( ( e ) => {

		t.failed = true;
		console.warn( `navy: ship model ${ kind } failed to load: the ${ cls.base } in navy dress`, e );
		for ( const v of set.visuals ) if ( v.kind === kind ) dressUp( set, v, kind, cls );
		return null;

	} );
	return t;

}

// the dress mesh on a visual (base model units: the visual's group carries the scale)
function addDress( v, kind ) {

	try {

		const d = dressGeometry( kind );
		if ( ! d ) return;
		const m = new Mesh( d, launchMaterial() );
		m.name = 'navy-dress';
		m.castShadow = false;
		m.receiveShadow = true;
		v.group.add( m );
		v.dress = m;

	} catch ( e ) { /* the dress is decoration */ }

}

// the fallback look on a visual of the navy class: the base class's template at cls.scale in dress (once it has loaded)
function dressUp( set, v, kind, cls ) {

	if ( v.loaded || v.dressing || ! cls.base || ! SHIP_CLASSES[ cls.base ] ) return;
	v.dressing = true;
	const s = cls.scale || 1;
	const wear = ( glb ) => {

		if ( ! glb || v.loaded || ! set.visuals.has( v ) ) return;
		v.group.scale.set( s, s, s );
		v.fill( glb );
		addDress( v, kind );

	};
	const bt = set._template( cls.base );
	if ( bt.glb ) wear( bt.glb ); else bt.promise.then( wear );

}

// wrap naval's ModelSet once (chained after any other wrapper, e.g. the rescue's launch): the navy classes load their own GLB
export function drawNavy( models ) {

	if ( ! models || typeof models.create !== 'function' || models.__navy ) return false;
	const create = models.create, template = typeof models._template === 'function' ? models._template : null;
	if ( template ) {

		models._template = function ( kind ) {

			const cls = SHIP_CLASSES[ kind ];
			if ( cls && cls.model === 'navy' && cls.navyGlb ) return navyTemplate( this, kind, cls );
			return template.call( this, kind );

		};

	}

	models.create = function ( kind ) {

		const cls = SHIP_CLASSES[ kind ];
		if ( cls && cls.model === 'navy' ) {

			if ( template && cls.navyGlb ) {

				const v = create.call( this, kind );
				v.navyKind = kind;
				const t = this.templates.get( kind );
				if ( t && t.failed ) dressUp( this, v, kind, cls );
				return v;

			}

			// (a set without templates of its own, or a class without a GLB: the base class's visual, scaled, in navy dress)
			if ( cls.base && SHIP_CLASSES[ cls.base ] ) {

				const v = create.call( this, cls.base );
				v.navyKind = kind;
				v.group.name = 'ship-' + kind;
				v.group.scale.set( cls.scale || 1, cls.scale || 1, cls.scale || 1 );
				addDress( v, kind );
				return v;

			}

		}

		return create.call( this, kind );

	};
	models.__navy = true;
	return true;

}

// ------------------------------------------------------------------ the naval jetty

export function jettyGeometry() {

	const J = NAVY_JETTY, parts = [];
	const add = ( g, color, m, rough = 0.8, pattern = PAT.plain ) => parts.push( prepare( g, { color, rough, pattern, matrix: m } ) );
	const len = J.x1 - J.x0, cx = ( J.x0 + J.x1 ) / 2, top = J.deck;
	// the deck and its stringers
	add( box( len, 0.22, J.width ), NAVY_PAINT.plank, mat4( cx, top - 0.11, J.z ), 0.85, PAT.woodX );
	for ( const s of [ - 1, 1 ] ) add( box( len, 0.3, 0.22 ), NAVY_PAINT.pile, mat4( cx, top - 0.37, J.z + s * ( J.width / 2 - 0.15 ) ), 0.9, PAT.woodX );
	// piles every 7 m, both sides, down into the sea bed
	for ( let x = J.x0 + 6; x <= J.x1 + 0.1; x += 7 ) for ( const s of [ - 1, 1 ] ) add( cylinder( 0.2, 0.22, 8.5, 8 ), NAVY_PAINT.pile, mat4( x, top - 4.4, J.z + s * ( J.width / 2 + 0.05 ) ), 0.95, PAT.wood );
	// bollards and a rail along the head
	for ( let x = J.x1 - 18; x <= J.x1; x += 9 ) for ( const s of [ - 1, 1 ] ) add( cylinder( 0.16, 0.2, 0.55, 10 ), NAVY_PAINT.iron, mat4( x, top + 0.27, J.z + s * ( J.width / 2 - 0.3 ) ), 0.5 );
	// the platform at its foot and the office hut on it (door to the south, toward the walkway)
	const px = J.office.x + 2, pz = J.z + 2;
	add( box( 14, 0.22, 12 ), NAVY_PAINT.plank, mat4( px, top - 0.11, pz ), 0.85, PAT.woodZ );
	const hx = px + 1, hz = pz + 3;
	add( box( 6, 2.8, 4 ), NAVY_PAINT.wall, mat4( hx, top + 1.4, hz ), 0.85, PAT.wood );
	add( box( 6.6, 0.25, 4.8 ), NAVY_PAINT.roof, mat4( hx, top + 2.95, hz ), 0.7 );
	add( box( 1.1, 2.0, 0.06 ), NAVY_PAINT.blue, mat4( hx - 1.2, top + 1.0, hz - 2.02 ), 0.6 );
	add( box( 2.2, 0.5, 0.06 ), NAVY_PAINT.blue, mat4( hx + 1.2, top + 2.2, hz - 2.03 ), 0.6 );
	add( box( 1.9, 0.12, 0.07 ), NAVY_PAINT.gold, mat4( hx + 1.2, top + 2.2, hz - 2.06 ), 0.4 );
	// the flagstaff at the head with the ensign
	const fx = J.x1 - 1.2, fz = J.z - J.width / 2 + 0.4;
	add( cylinder( 0.07, 0.1, 9, 8 ), NAVY_PAINT.white, mat4( fx, top + 4.5, fz ), 0.6 );
	add( box( 2.6, 1.6, 0.03 ), NAVY_PAINT.blue, mat4( fx + 1.35, top + 8.1, fz ), 0.85, PAT.cloth );
	add( box( 0.36, 1.6, 0.045 ), NAVY_PAINT.white, mat4( fx + 1.0, top + 8.1, fz ), 0.85, PAT.cloth );
	add( box( 2.6, 0.3, 0.045 ), NAVY_PAINT.white, mat4( fx + 1.35, top + 8.1, fz ), 0.85, PAT.cloth );
	return mergePrepared( parts );

}

// the jetty in the scene and its colliders (deck and platform walkable, the hut solid)
export function buildJetty( { scene = null, colliders = null } = {} ) {

	const J = NAVY_JETTY, out = { group: null, boxes: [], dispose() {} };
	if ( scene && typeof scene.add === 'function' ) {

		const g = new Group();
		g.name = 'navy-jetty';
		const m = new Mesh( jettyGeometry(), launchMaterial() );
		m.name = 'navy-jetty';
		m.castShadow = true;
		m.receiveShadow = true;
		g.add( m );
		scene.add( g );
		out.group = g;

	}

	if ( colliders && typeof colliders.addBox === 'function' ) {

		const len = J.x1 - J.x0, px = J.office.x + 2, pz = J.z + 2;
		out.boxes.push( colliders.addBox( new Vector3( ( J.x0 + J.x1 ) / 2, J.deck - 0.15, J.z ), new Vector3( len / 2, 0.15, J.width / 2 ), 0, { walkable: true, solid: false, tag: 'navyJetty' } ) );
		out.boxes.push( colliders.addBox( new Vector3( px, J.deck - 0.15, pz ), new Vector3( 7, 0.15, 6 ), 0, { walkable: true, solid: false, tag: 'navyJetty' } ) );
		out.boxes.push( colliders.addBox( new Vector3( px + 1, J.deck + 1.4, pz + 3 ), new Vector3( 3, 1.4, 2 ), 0, { solid: true, tag: 'navyOffice' } ) );

	}

	out.dispose = () => {

		if ( out.group && out.group.parent ) out.group.parent.remove( out.group );
		if ( colliders && Array.isArray( colliders.boxes ) ) for ( const b of out.boxes ) {

			const i = colliders.boxes.indexOf( b );
			if ( i >= 0 ) colliders.boxes.splice( i, 1 );

		}

		out.boxes.length = 0;

	};
	return out;

}

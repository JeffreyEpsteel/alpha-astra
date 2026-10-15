// Ship GLBs for the scene. One template per class is loaded with world/boat/StaticGLB.js (lit PBR materials,
// underwaterLighting 'lite') and every ship gets its own Group of meshes sharing the template's geometry and
// materials, so six ships cost six sets of draw calls but one set of textures.
//
//   const models = new ModelSet( { scene, baseUrl: '/' } );
//   const v = models.create( 'sloop' );           // a ShipVisual (empty until the template has loaded)
//   v.apply( ship, pose );                         // position / yaw / pitch / roll from a Ship + finalPose()
//   v.setNear( bool )                              // shadows only for close ships; v.group.visible hides far ones
//   models.setNight( 0..1 )                        // the stern lantern glows
//   models.ready( kind ) -> Promise                // resolves when that class has loaded
//   v.wheel / v.steerWheel( ship )                 // the helm wheel turns with the ship's turn (apply() calls it)
//
// Orientation: the GLBs are +X forward (the fork's Blender export; the stern lantern is at -X, the bowsprit at
// +X); the Group inside the ship's group is turned by -PI/2 about Y so the bow points along +Z, the boat frame.
// Rotation order of the outer group is YXZ: yaw, then pitch (bow up = negative rotation about X), then roll.

import { Group, Mesh } from '../../engine/index.js';
import { LAYERS } from '../../core/SceneRenderer.js';
import { SHIP_CLASSES } from './ShipClasses.js';
import { MODEL_YAW, centreOnHull } from '../../world/boat/ShipFrame.js';

export { MODEL_YAW, centreOnHull };

function defaultBase() {

	try {

		return ( import.meta.env && import.meta.env.BASE_URL ) || '/';

	} catch ( e ) {

		return '/';

	}

}

// The template's baked spoked wheel lifted out of the hull's triangles (once per class; every visual shares the parts) with
// the player's ship's own carve (world/boat/ShipBoatModel _buildHelm / _carveWheel, run on a stand-in: the wheel's place
// comes from the Boats.js entry of the same class). -> { position (boat frame), parts: [ { geometry, material } ], turns,
// radius, triangles } or null (no wheel found, e.g. inside a wheelhouse: nothing turns).
export async function carveShipWheel( kind, glb ) {

	try {

		const [ { ShipBoatModel }, { BOATS } ] = await Promise.all( [ import( '../../world/boat/ShipBoatModel.js' ), import( '../../game/Boats.js' ) ] );
		const spec = Object.values( BOATS ).find( ( b ) => b.kind === 'ship' && ( b.shipClass || '' ) === kind );
		if ( ! spec || ! glb.meshes || ! glb.meshes.length ) return null;
		const ctx = { group: new Group(), spec, helmStand: null };
		ShipBoatModel.prototype._buildHelm.call( ctx, spec );
		const triangles = ShipBoatModel.prototype._carveWheel.call( ctx, glb );
		if ( ! triangles ) return null;
		const parts = ctx.wheelMesh.children.map( ( m ) => ( { geometry: m.geometry, material: m.material } ) );
		return { position: ctx.wheelPivot.position.clone(), parts, turns: ctx.wheelTurns, radius: ctx.wheelRadius, triangles };

	} catch ( e ) {

		console.warn( `naval: no turning wheel for ${ kind }`, e );
		return null;

	}

}

export class ShipVisual {

	constructor( set, kind ) {

		this.set = set;
		this.kind = kind;
		this.group = new Group();
		this.group.name = 'ship-' + kind;
		this.group.rotation.order = 'YXZ';
		this.pivot = new Group();
		this.pivot.rotation.y = MODEL_YAW;
		this.group.add( this.pivot );
		this.meshes = [];
		this.loaded = false;
		this.near = true;
		this.group.visible = false;
		if ( set.scene ) set.scene.add( this.group );

	}

	// copy the template's meshes (shared geometry + materials)
	fill( glb ) {

		if ( this.loaded ) return;
		this.loaded = true;
		for ( const m of glb.meshes ) {

			const c = new Mesh( m.geometry, m.material );
			c.name = m.name;
			c.castShadow = m.castShadow && this.near;
			c.receiveShadow = m.receiveShadow;
			c.renderOrder = m.renderOrder;
			if ( m.name === 'ship-glass' ) c.layers.set( LAYERS.TRANSPARENT );
			this.pivot.add( c );
			this.meshes.push( c );

		}

		this._fillWheel( glb.wheel );

	}

	// ---- the helm wheel (wave 11C): copies of the template's carved wheel (carveShipWheel) under a pivot in the boat frame
	_fillWheel( w ) {

		if ( ! w || this.wheel ) return;
		const pivot = new Group();
		pivot.name = 'ship-wheel-pivot';
		pivot.position.copy( w.position ); // the axle along +Z (forward), as ShipBoatModel's wheelPivot
		const spin = new Group();
		spin.name = 'ship-wheel';
		for ( const p of w.parts ) {

			const m = new Mesh( p.geometry, p.material );
			m.name = 'ship-wheel';
			m.receiveShadow = true;
			spin.add( m );

		}

		pivot.add( spin );
		this.group.add( pivot );
		this.wheel = spin;
		this.wheelTurns = w.turns;

	}

	// the wheel's spin from the ship's turn: a brain's steer (-1..1, + = port) when it sets one, else Ship.yawRate over the
	// class's turn rate (+ yaw rate = turning to port); counter-clockwise from the helm for port, as BoatModel.steerWheel
	steerWheel( ship ) {

		if ( ! this.wheel || ! ship ) return 0;
		const brain = Number.isFinite( ship.steer ) ? ship.steer : ship.brain && Number.isFinite( ship.brain.steer ) ? ship.brain.steer : null;
		const turn = ship.cls && ship.cls.turn > 0 ? ship.cls.turn : 0.3;
		const s = Math.max( - 1, Math.min( 1, brain !== null ? brain : ( ship.yawRate || 0 ) / turn ) );
		this.wheel.rotation.z = - s * ( this.wheelTurns || 1 ) * Math.PI * 2;
		return s;

	}

	apply( ship, pose ) {

		const g = this.group;
		g.position.set( ship.x, pose.y, ship.z );
		g.rotation.set( - pose.pitch, ship.yaw, pose.roll );
		this.steerWheel( ship );

	}

	setNear( near ) {

		if ( near === this.near ) return;
		this.near = near;
		for ( const m of this.meshes ) m.castShadow = near && m.name !== 'ship-glass';

	}

	setVisible( v ) {

		this.group.visible = v && this.loaded;

	}

	dispose() {

		if ( this.set.scene ) this.set.scene.remove( this.group );
		this.set.visuals.delete( this );
		this.meshes.length = 0;

	}

}

export class ModelSet {

	constructor( { scene = null, baseUrl = defaultBase(), loader = null } = {} ) {

		this.scene = scene;
		this.baseUrl = baseUrl;
		this.loader = loader; // ( url, options ) -> Promise<{ group, meshes, materials, dispose }>, default loadStaticGLB
		this.templates = new Map();
		this.visuals = new Set();
		this.night = 0;
		this.disposed = false;

	}

	_template( kind ) {

		let t = this.templates.get( kind );
		if ( t ) return t;
		t = { glb: null, failed: false, promise: null };
		this.templates.set( kind, t );
		t.promise = ( async () => {

			const load = this.loader || ( await import( '../../world/boat/StaticGLB.js' ) ).loadStaticGLB;
			const glb = await load( this.baseUrl + SHIP_CLASSES[ kind ].glb, { shadows: true, prefix: 'ship-', materials: () => ( { underwaterLighting: 'lite' } ) } );
			if ( this.disposed ) {

				glb.dispose();
				return null;

			}

			centreOnHull( glb );
			glb.wheel = await carveShipWheel( kind, glb );
			t.glb = glb;
			for ( const m of glb.materials ) m.underwaterLighting = 'lite';
			this._lantern( glb );
			for ( const v of this.visuals ) if ( v.kind === kind ) v.fill( glb );
			return glb;

		} )().catch( ( e ) => {

			t.failed = true;
			console.warn( `naval: ship model ${ kind } failed to load`, e );
			return null;

		} );
		return t;

	}

	ready( kind ) {

		return this._template( kind ).promise;

	}

	create( kind ) {

		const v = new ShipVisual( this, kind );
		this.visuals.add( v );
		const t = this._template( kind );
		if ( t.glb ) v.fill( t.glb );
		return v;

	}

	// the lantern glass is the only transparent material of the ships
	_lantern( glb ) {

		glb.lantern = glb.materials.find( ( m ) => m.name === 'ship-glass' ) || null;
		this._applyNight( glb );

	}

	_applyNight( glb ) {

		if ( glb.lantern ) glb.lantern.emissive = [ 4 * this.night, 2.6 * this.night, 0.9 * this.night ];

	}

	setNight( n ) {

		n = Math.round( n * 20 ) / 20;
		if ( n === this.night ) return;
		this.night = n;
		for ( const t of this.templates.values() ) if ( t.glb ) this._applyNight( t.glb );

	}

	dispose() {

		this.disposed = true;
		for ( const v of [ ...this.visuals ] ) v.dispose();
		for ( const t of this.templates.values() ) if ( t.glb ) t.glb.dispose();
		this.templates.clear();

	}

}

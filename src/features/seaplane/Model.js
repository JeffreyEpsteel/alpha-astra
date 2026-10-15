// The seaplane's look: public/models/seaplane/Seaplane.glb (tools/seaplane/build_seaplane.py) through
// world/boat/StaticGLB.js, loaded once and shared by the local plane and the other players' planes. The propeller
// meshes (materials SeaplaneProp / SeaplanePropTip) move into a pivot at GEOM.prop and spin about +Z in code; the
// glass goes to the late (transparent) pass, nearly clear with a slight sea-green tint, a Fresnel edge and a faint
// diagonal reflection streak (wave 8: the pilot must see out). Until the GLB arrives (or if it fails to load) a
// small procedural stand-in from GeoKit boxes is shown, so the plane is never invisible.
//
//   const models = new PlaneModels( { scene } );
//   const v = models.create();          v.setPose( position, quaternion );  v.spin( dt, rpm01 );  v.setVisible( b );  v.dispose()
// Wave 10 (crashes): the GLB's nodes are parts (NODE_PART: WingL / WingR / Tail / FloatL / FloatR / Propeller, the rest the
// fuselage); each part draws in its own group, so a wreck can tear it off:
//   v.detach( name ) -> Group | null   (once: out of the plane into the scene; Wreck.pose() places it)
//   v.setPart( name, position, quaternion ), v.partVisible( name, bool ), v.reassemble() (the recovered plane), v.detached
// Wave 12 (airframes): models.create( airframe = 'jade', livery = 0 ): each airframe has its GLB (Airframes.js model:
// Seaplane.glb is the Jade, Petrel.glb, Albatross.glb, Kestrel.glb), loaded once per file; a twin's second propeller
// is the node Propeller2 (its own pivot, parts.prop2). v.setLivery( n ) repaints the main / trim materials
// (SeaplaneJade / SeaplaneCream) in one of Airframes.js LIVERIES (material colours only: shared clones per scheme).

import { Group, Mesh } from '../../engine/index.js';
import { LAYERS } from '../../core/SceneRenderer.js';
import { loadStaticGLB } from '../../world/boat/StaticGLB.js';
import { loadGLB } from '../../engine/loaders/GLTF.js';
import { prepare, mergePrepared, box, cylinder, mat4 } from '../../world/boat/GeoKit.js';
import { createPropMaterial, PAT } from '../../game/GameMaterials.js';
import { GEOM } from './Flight.js';
import { AIRFRAMES, LIVERIES, spec as airframeSpec } from './Airframes.js';

export const MODEL_URL = 'models/seaplane/Seaplane.glb';
const PREFIX = 'seaplane-';
const PROP_SPIN = 38; // rad/s shown at full power: the real 2200 rpm would strobe at the frame rate

// the cabin glass: mostly clear, more reflective at grazing angles, one soft streak across each pane (the GLB's
// planar UV: u along the length / height, v up)
export const GLASS = {
	opacity: 0.1,
	surface: /* wgsl */`
	let fres = pow( max( 1.0 - abs( dot( in.N, in.V ) ), 0.0 ), 4.0 ); // (max: a negative base is NaN in WGSL and poisons the TAA history)
	let band = fract( ( in.uv.x + in.uv.y * 0.8 ) * 1.3 );
	let streak = smoothstep( 0.0, 0.05, band ) * ( 1.0 - smoothstep( 0.05, 0.16, band ) );
	s.alpha = clamp( s.alpha + fres * 0.4 + streak * 0.07, 0.0, 0.7 );
	s.albedo = mix( s.albedo, vec3f( 1.0 ), streak * 0.35 );
	s.roughness = 0.04;
`,
};

// the GLB's node names -> wreck parts (Wreck.js PARTS); any other node is the fuselage
export const NODE_PART = { WingL: 'wingL', WingR: 'wingR', Tail: 'tail', FloatL: 'floatL', FloatR: 'floatR', Propeller: 'prop', Propeller2: 'prop2' };
// an airframe's propeller hubs (model frame)
export function propHubs( af = 'jade' ) {

	const A = AIRFRAMES[ af ] ? af : 'jade';
	const g = airframeSpec( A ).geom;
	return ( g.props || [ g.prop || GEOM.prop ] ).map( ( p ) => p.slice() );

}

const srgbToLinear = ( c ) => ( c <= 0.04045 ? c / 12.92 : Math.pow( ( c + 0.055 ) / 1.055, 2.4 ) );
export const BODY_PARTS = [ 'fuselage', 'wingL', 'wingR', 'tail', 'floatL', 'floatR' ];

// the part of every mesh loadStaticGLB makes from this glTF, in its order (it walks the roots depth first, one mesh per
// triangle primitive with positions); a node without a part name inherits its parent's
export function meshParts( gltf ) {

	const out = [];
	const visit = ( ni, inherited ) => {

		const node = gltf.nodes[ ni ];
		if ( ! node ) return;
		const part = NODE_PART[ node.name ] || inherited;
		if ( node.mesh !== undefined ) for ( const p of gltf.meshes[ node.mesh ] || [] ) if ( p.mode === 4 && p.attributes && p.attributes.POSITION ) out.push( part );
		for ( const c of node.children || [] ) visit( c, part );

	};

	for ( const ni of gltf.roots || [] ) visit( ni, 'fuselage' );
	return out;

}

function defaultBase() {

	try {

		return ( import.meta.env && import.meta.env.BASE_URL ) || '/';

	} catch ( e ) {

		return '/';

	}

}

// the stand-in: fuselage, wing, tail and floats as boxes in the plane's colours (about 200 triangles)
export function buildStandIn() {

	const P = [];
	const add = ( g, o ) => P.push( prepare( g, o ) );
	const JADE = { color: 0x0f8f70, rough: 0.5, pattern: PAT.plain }, CREAM = { color: 0xf2e6c2, rough: 0.5, pattern: PAT.plain };
	add( box( 1.4, 1.7, 6.4 ), { ...JADE, matrix: mat4( 0, 2.22, 0.6 ) } );
	add( box( 0.7, 0.6, 3.6 ), { ...JADE, matrix: mat4( 0, 2.55, - 4.4 ) } );
	add( box( GEOM.span, 0.18, 1.6 ), { ...CREAM, matrix: mat4( 0, 3.24, 0.6 ) } );
	add( box( 4.8, 0.1, 1.0 ), { ...CREAM, matrix: mat4( 0, 2.6, - 5.3 ) } );
	add( box( 0.12, 1.4, 1.1 ), { ...JADE, matrix: mat4( 0, 3.3, - 5.6 ) } );
	for ( const s of [ - 1, 1 ] ) {

		add( box( 0.8, 0.6, 7.4 ), { ...CREAM, matrix: mat4( s * GEOM.floatX, 0.3, - 0.2 ) } );
		add( cylinder( 0.04, 0.04, 1.1, 6 ), { color: 0x555a5d, rough: 0.4, metal: 1, matrix: mat4( s * 0.9, 1.0, 1.6, 0, 0, s * 0.85 ) } );
		add( cylinder( 0.04, 0.04, 1.1, 6 ), { color: 0x555a5d, rough: 0.4, metal: 1, matrix: mat4( s * 0.9, 1.0, - 0.5, 0, 0, s * 0.85 ) } );

	}

	return mergePrepared( P );

}

function buildStandInProp() {

	const P = [ prepare( box( 0.16, GEOM.propRadius * 2, 0.06 ), { color: 0x1b1c1e, rough: 0.5, matrix: mat4( 0, 0, 0 ) } ), prepare( cylinder( 0.05, 0.22, 0.4, 10 ), { color: 0x1b1c1e, rough: 0.5, matrix: mat4( 0, 0, 0.1, Math.PI / 2 ) } ) ];
	return mergePrepared( P );

}

export class PlaneModels {

	constructor( { scene = null, baseUrl = defaultBase(), load = loadStaticGLB } = {} ) {

		this.scene = scene;
		this.baseUrl = baseUrl.endsWith( '/' ) ? baseUrl : baseUrl + '/';
		this.templates = new Map(); // airframe -> { body: [ Mesh ], prop: [ [ Mesh ] per hub ], parts } once loaded
		this.loads = new Map(); // airframe -> promise
		this.visuals = new Set();
		this.failed = false;
		this.standIn = null;
		this._load = load;
		this.ready = null;
		this._livery = new Map(); // material id | scheme -> the repainted clone

	}

	// (the Jade's template: the older callers' name)
	get template() {

		return this.templates.get( 'jade' ) || null;

	}

	_ensureLoad( af = 'jade' ) {

		if ( this.loads.has( af ) ) return this.loads.get( af );
		const url = this.baseUrl + ( AIRFRAMES[ af ] ? AIRFRAMES[ af ].model : MODEL_URL );
		const hubs = propHubs( af );
		const materials = ( info ) => ( /Glass/.test( info && info.name ) ? { underwaterLighting: 'lite', opacity: GLASS.opacity, surface: GLASS.surface } : { underwaterLighting: 'lite' } );
		const ready = Promise.resolve( this._load( url, { shadows: true, prefix: PREFIX, materials } ) ).then( async ( glb ) => {

			if ( ! glb || ! glb.meshes ) throw new Error( 'empty seaplane GLB' );
			// the parts by node (the glTF parse is cached by url, so this costs no second fetch)
			let parts = glb.parts || null;
			if ( ! parts && this._load === loadStaticGLB ) try { parts = meshParts( await loadGLB( url ) ); } catch ( e ) { parts = null; }
			if ( ! parts || parts.length !== glb.meshes.length ) parts = null;
			const body = [], prop = hubs.map( () => [] ), bodyParts = [];
			for ( let i = 0; i < glb.meshes.length; i ++ ) {

				const m = glb.meshes[ i ];
				if ( /SeaplaneProp/.test( m.name ) ) {

					// baked at the hub's model position: move it to the pivot's origin once
					const k = parts && parts[ i ] === 'prop2' && hubs.length > 1 ? 1 : 0, hub = hubs[ k ];
					m.geometry.translate( - hub[ 0 ], - hub[ 1 ], - hub[ 2 ] );
					m.geometry.computeBoundingBox();
					m.geometry.computeBoundingSphere();
					prop[ k ].push( m );

				} else {

					body.push( m );
					bodyParts.push( parts && BODY_PARTS.includes( parts[ i ] ) ? parts[ i ] : 'fuselage' );

				}

			}

			const tpl = { body, prop, parts: bodyParts };
			this.templates.set( af, tpl );
			for ( const v of this.visuals ) if ( v.af === af ) v._fill( tpl );
			return tpl;

		} ).catch( ( e ) => {

			this.failed = true;
			console.warn( `seaplane: model ${ af } not loaded, using the stand-in`, e && e.message ? e.message : e );
			return null;

		} );
		this.loads.set( af, ready );
		this.ready = ready;
		return ready;

	}

	// a repainted clone of a main / trim material (one per material and scheme, shared by the visuals)
	_painted( material, scheme, role ) {

		const L = LIVERIES[ scheme ];
		const rgb = L && L[ role ];
		if ( ! rgb || ! material || ! material.clone ) return material;
		const key = material.id + '|' + scheme;
		let m = this._livery.get( key );
		if ( ! m ) {

			m = material.clone();
			m.color = rgb.map( srgbToLinear ); // (the glTF factors are linear)
			this._livery.set( key, m );

		}

		return m;

	}

	_standIn() {

		if ( ! this.standIn ) {

			const material = createPropMaterial( 'seaplaneStandIn' );
			this.standIn = { body: buildStandIn(), prop: buildStandInProp(), material };

		}

		return this.standIn;

	}

	create( af = 'jade', livery = 0 ) {

		if ( ! AIRFRAMES[ af ] ) af = 'jade';
		const v = new PlaneVisual( this, af );
		v.livery = livery | 0;
		this.visuals.add( v );
		if ( this.scene ) this.scene.add( v.group );
		const tpl = this.templates.get( af );
		if ( tpl ) v._fill( tpl );
		else {

			v._fillStandIn( this._standIn() );
			this._ensureLoad( af );

		}

		return v;

	}

	release( v ) {

		this.visuals.delete( v );
		if ( this.scene && this.scene.remove ) this.scene.remove( v.group );

	}

	dispose() {

		for ( const v of [ ...this.visuals ] ) v.dispose();
		for ( const m of this._livery.values() ) if ( m.dispose ) m.dispose();
		this._livery.clear();
		if ( this.standIn ) {

			this.standIn.body.dispose();
			this.standIn.prop.dispose();
			if ( this.standIn.material.dispose ) this.standIn.material.dispose();

		}

	}

}

export class PlaneVisual {

	constructor( owner, af = 'jade' ) {

		this.owner = owner;
		this.af = af;
		this.livery = 0;
		this.hubs = propHubs( af );
		this.group = new Group();
		this.group.name = 'Seaplane';
		this.body = new Group();
		// one pivot per propeller hub (a twin has two), each spun about its own +Z
		this.pivots = this.hubs.map( ( h ) => {

			const g = new Group();
			g.position.set( h[ 0 ], h[ 1 ], h[ 2 ] );
			return g;

		} );
		this.pivot = this.pivots[ 0 ];
		this.group.add( this.body, ...this.pivots );
		// one group per part (model frame), so a wreck can carry them off; the propeller's is the pivot
		this.parts = { prop: this.pivot };
		if ( this.pivots[ 1 ] ) this.parts.prop2 = this.pivots[ 1 ];
		for ( const n of BODY_PARTS ) {

			const g = new Group();
			g.name = 'seaplane-' + n;
			this.body.add( g );
			this.parts[ n ] = g;

		}

		this.detached = new Set();
		this.angle = 0;
		this.loaded = false;
		this.meshes = [];

	}

	_clear() {

		for ( const m of this.meshes ) m.removeFromParent();
		this.meshes = [];

	}

	_add( parent, geometry, material, name, src = null ) {

		const c = new Mesh( geometry, material );
		c.name = name;
		c.castShadow = src ? src.castShadow : true;
		c.receiveShadow = src ? src.receiveShadow : true;
		if ( src ) c.renderOrder = src.renderOrder;
		if ( /glass/.test( name ) ) {

			c.layers.set( LAYERS.TRANSPARENT );
			c.castShadow = false;

		}

		parent.add( c );
		this.meshes.push( c );
		return c;

	}

	_fill( t ) {

		this._clear();
		t.body.forEach( ( m, i ) => this._add( this.parts[ ( t.parts && t.parts[ i ] ) || 'fuselage' ], m.geometry, m.material, m.name, m ) );
		const props = Array.isArray( t.prop[ 0 ] ) ? t.prop : [ t.prop ];
		props.forEach( ( list, k ) => {

			for ( const m of list ) this._add( this.pivots[ k ] || this.pivot, m.geometry, m.material, m.name, m );

		} );
		this.loaded = true;
		this.setLivery( this.livery );

	}

	// the paint scheme (Airframes.js LIVERIES): the main and trim materials swapped for repainted clones
	setLivery( n = 0 ) {

		this.livery = n | 0;
		if ( ! this.loaded ) return;
		for ( const c of this.meshes ) {

			if ( c._base === undefined ) c._base = c.material;
			const nm = c._base && c._base.name || '';
			const role = /SeaplaneJade$/.test( nm ) ? 'main' : /SeaplaneCream$/.test( nm ) ? 'trim' : null;
			c.material = role && this.livery ? this.owner._painted( c._base, this.livery, role ) : c._base;

		}

	}

	_fillStandIn( s ) {

		this._clear();
		this._add( this.parts.fuselage, s.body, s.material, 'seaplane-standin' );
		this._add( this.pivot, s.prop, s.material, 'seaplane-standin-prop' );

	}

	setPose( p, q ) {

		this.group.position.copy( p );
		this.group.quaternion.copy( q );

	}

	// a wreck tears a part off (once): out of the plane into the scene (its pose: setPart, from Wreck.pose)
	detach( name ) {

		const g = this.parts[ name ];
		if ( ! g || this.detached.has( name ) ) return null;
		this.detached.add( name );
		g.removeFromParent();
		const scene = this.owner && this.owner.scene;
		if ( scene ) scene.add( g );
		return g;

	}

	setPart( name, p, q ) {

		const g = this.parts[ name ];
		if ( ! g ) return;
		g.position.copy( p );
		g.quaternion.copy( q );

	}

	partVisible( name, v ) {

		const g = this.parts[ name ];
		if ( g ) g.visible = v;

	}

	// the recovered plane: every part back in place
	reassemble() {

		for ( const n of this.detached ) {

			const g = this.parts[ n ];
			g.removeFromParent();
			g.quaternion.identity();
			if ( n === 'prop' || n === 'prop2' ) {

				const h = this.hubs[ n === 'prop' ? 0 : 1 ] || GEOM.prop;
				g.position.set( h[ 0 ], h[ 1 ], h[ 2 ] );
				this.group.add( g );

			} else {

				g.position.set( 0, 0, 0 );
				this.body.add( g );

			}

		}

		this.detached.clear();
		for ( const g of Object.values( this.parts ) ) g.visible = true;

	}

	// rpm01: 0..1 of full power (a stylised rate: the motion is what reads)
	spin( dt, rpm01 ) {

		this.angle = ( this.angle + dt * rpm01 * PROP_SPIN ) % ( Math.PI * 2 );
		// (a twin's propellers turn opposite ways, a stopped engine's stays still)
		this.pivots.forEach( ( p, k ) => {

			if ( this.stopped && this.stopped[ k ] ) return;
			p.rotation.set( 0, 0, k ? - this.angle : this.angle );

		} );

	}

	setVisible( v ) {

		this.group.visible = v;

	}

	dispose() {

		this.reassemble();
		this._clear();
		this.owner.release( this );

	}

}

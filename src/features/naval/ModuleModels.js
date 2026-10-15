// The fitted ship modules as meshes on the player's hull: one template per kit mesh (public/models/modules/*.glb,
// loaded once with world/boat/StaticGLB.js) and a Group 'nv-modules' under the boat model's group holding a copy of
// each fitted module where Modules.moduleMounts puts it (boat frame: +Z forward, +X port, y = 0 the waterline).
//
//   const mm = new ModuleMeshes( { baseUrl: '/' } );
//   mm.sync( fitting, boatModel, night )    every frame; rebuilds only when the fit, the hull model or a template changed
//   mm.dispose()
//
// The lantern rig's glass ('nvmod-glass') glows at night like the ships' stern lanterns (Models.js).

import { Group, Mesh } from '../../engine/index.js';
import { LAYERS } from '../../core/SceneRenderer.js';
import { fitMounts, moduleMeshUrl } from './Modules.js';

function defaultBase() {

	try {

		return ( import.meta.env && import.meta.env.BASE_URL ) || '/';

	} catch ( e ) {

		return '/';

	}

}

export class ModuleMeshes {

	constructor( { baseUrl = defaultBase(), loader = null } = {} ) {

		this.baseUrl = baseUrl;
		this.loader = loader; // ( url, options ) -> Promise<{ meshes, materials, dispose }>, default loadStaticGLB
		this.templates = new Map(); // mesh name -> { glb, failed, promise }
		this.group = null;
		this.model = null;
		this.key = '';
		this.loads = 0; // bumped when a template arrives (forces a rebuild)
		this.night = - 1;
		this.disposed = false;

	}

	_template( mesh ) {

		let t = this.templates.get( mesh );
		if ( t ) return t;
		t = { glb: null, failed: false, promise: null };
		this.templates.set( mesh, t );
		t.promise = ( async () => {

			const load = this.loader || ( await import( '../../world/boat/StaticGLB.js' ) ).loadStaticGLB;
			const glb = await load( moduleMeshUrl( mesh, this.baseUrl ), { shadows: true, prefix: 'nvmod-', materials: () => ( { underwaterLighting: 'lite' } ) } );
			if ( this.disposed ) {

				glb.dispose();
				return null;

			}

			glb.glass = glb.materials.find( ( m ) => m.name === 'nvmod-glass' ) || null;
			t.glb = glb;
			this._glow( glb );
			this.loads ++;
			return glb;

		} )().catch( ( e ) => {

			t.failed = true;
			console.warn( `naval: module mesh ${ mesh } failed to load`, e );
			return null;

		} );
		return t;

	}

	_glow( glb ) {

		const n = Math.max( 0, this.night );
		if ( glb.glass ) glb.glass.emissive = [ 4 * n, 2.6 * n, 0.9 * n ];

	}

	setNight( n ) {

		n = Math.round( n * 20 ) / 20;
		if ( n === this.night ) return;
		this.night = n;
		for ( const t of this.templates.values() ) if ( t.glb ) this._glow( t.glb );

	}

	// the model's catalog id (the first lobster BoatModel of App has none)
	static modelId( model, fallback = 'lobster' ) {

		return ( model && model.id ) || fallback;

	}

	sync( fitting, model, night = 0 ) {

		if ( this.disposed ) return;
		this.setNight( night ? 1 : 0 );
		const on = !! ( model && model.group && fitting && fitting.boat && ModuleMeshes.modelId( model ) === fitting.boat );
		const key = on ? `${ fitting.boat }|${ fitting.version }|${ this.loads }` : '';
		if ( model === this.model && key === this.key ) return;
		this._clear();
		this.model = model;
		this.key = key;
		if ( ! on ) return;
		const g = new Group();
		g.name = 'nv-modules';
		for ( const m of fitMounts( fitting ) ) {

			const t = this._template( m.mesh );
			if ( ! t.glb ) continue; // it rebuilds when the template arrives
			const pivot = new Group();
			pivot.rotation.order = 'YZX'; // yaw about up, then roll about the (turned) forward axis
			pivot.position.set( m.x, m.y, m.z );
			pivot.rotation.set( 0, m.yaw, m.roll );
			pivot.scale.set( m.scale, m.scale, m.scale );
			for ( const src of t.glb.meshes ) {

				const c = new Mesh( src.geometry, src.material );
				c.name = src.name;
				c.castShadow = src.castShadow;
				c.receiveShadow = src.receiveShadow;
				c.renderOrder = src.renderOrder;
				if ( src.name === 'nvmod-glass' ) c.layers.set( LAYERS.TRANSPARENT );
				pivot.add( c );

			}

			g.add( pivot );

		}

		model.group.add( g );
		this.group = g;

	}

	_clear() {

		if ( this.group && this.group.parent ) this.group.parent.remove( this.group );
		this.group = null;

	}

	dispose() {

		this.disposed = true;
		this._clear();
		for ( const t of this.templates.values() ) if ( t.glb ) t.glb.dispose();
		this.templates.clear();

	}

}

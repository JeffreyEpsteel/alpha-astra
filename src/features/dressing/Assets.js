// GLB loading for the dressing: public/models/marine/*.glb and public/models/harbour/*.glb ( built by
// tools/dressing/build.ps1 ) through world/boat/StaticGLB.js, cached by path.
//
//   const a = new Assets( { baseUrl: '/' } );
//   const glb = await a.load( 'marine/Dolphin_LOD0.glb', { materials: ( info ) => ( { roughness: 0.3 } ) } );
//   glb.meshes -> [ Mesh ] ( geometry with the node transform baked in, one lit PBR material per glTF material )
//
// Every material is underwaterLighting 'lite' ( water-column attenuation only ) unless the caller says otherwise.

import { loadStaticGLB } from '../../world/boat/StaticGLB.js';

export function defaultBase() {

	try {

		return ( import.meta.env && import.meta.env.BASE_URL ) || '/';

	} catch ( e ) {

		return '/';

	}

}

export class Assets {

	constructor( { baseUrl = defaultBase() } = {} ) {

		this.baseUrl = baseUrl.endsWith( '/' ) ? baseUrl : baseUrl + '/';
		this.cache = new Map();

	}

	// resolves to the loaded set ( or null when the file is missing: the feature then simply skips that piece )
	load( rel, { materials = null, prefix = 'dress-', shadows = false } = {} ) {

		if ( this.cache.has( rel ) ) return this.cache.get( rel );
		const p = loadStaticGLB( this.baseUrl + 'models/' + rel, {
			prefix,
			shadows,
			materials: ( info ) => ( { underwaterLighting: 'lite', ...( materials ? materials( info ) : {} ) } ),
		} ).catch( ( e ) => {

			console.warn( 'dressing: could not load ' + rel, e && e.message ? e.message : e );
			return null;

		} );
		this.cache.set( rel, p );
		return p;

	}

	dispose() {

		for ( const p of this.cache.values() ) p.then( ( g ) => g && g.dispose && g.dispose() );
		this.cache.clear();

	}

}

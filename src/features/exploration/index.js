// Exploration feature (docs/UNREAL_PARITY.md W13, W15, W16, V16 ribbon): treasure caches, the spyglass and the
// heading ribbon.
//
//   features.add( 'exploration', exploration );   // import * as exploration from './features/exploration/index.js'
//   const ex = features.get( 'exploration' );
//   ex.treasure (Treasure.js: sites, found, claimed, claim( id ), markers())  ex.spyglass (Spyglass.js: toggle(), zoom)
//   ex.ribbon (HeadingRibbon.js)  ex.markers() (the world map's: known caches)  ex.close() (Escape lowers the glass)
//
// Keys: G raises / zooms / lowers the spyglass (claimed on the registry as 'exploration'). E claims a cache (registry
// interactables). Saved: { treasure: { found, claimed, trinkets } }. Events: 'treasureFound', 'treasureClaimed'.
// Hooks the root needs: the MODULES entry, placed after 'inverted' (the fallen cache under the landmark) and after
// 'naval' (ship labels); features.update runs after CameraFeel in App._frame, so no camera hook is required.

import { Treasure } from './Treasure.js';
import { Spyglass } from './Spyglass.js';
import { HeadingRibbon } from './HeadingRibbon.js';

export class Exploration {

	constructor( app, features, opts = {} ) {

		this.app = app;
		this.features = features || null;
		this.treasure = new Treasure( app, features, opts );
		this.spyglass = new Spyglass( app, features, { treasure: this.treasure, key: opts.key || 'KeyG' } );
		this.ribbon = new HeadingRibbon( app, features );

	}

	update( dt ) {

		this.treasure.update( dt );
		this.spyglass.update( dt );
		this.ribbon.update( dt );

	}

	markers() {

		return this.treasure.markers();

	}

	// Escape (Features.closePanels) lowers the spyglass
	close() {

		this.spyglass.close();

	}

	toJSON() {

		return { treasure: this.treasure.toJSON() };

	}

	fromJSON( d ) {

		if ( d && typeof d === 'object' ) this.treasure.fromJSON( d.treasure );

	}

	reset() {

		this.treasure.reset();
		this.spyglass.close();

	}

	dispose() {

		this.treasure.dispose();
		this.spyglass.dispose();
		this.ribbon.dispose();

	}

}

export function install( app, features, opts = {} ) {

	return new Exploration( app, features, opts );

}

export { Treasure, cacheSites, LOOT } from './Treasure.js';
export { Spyglass, spyTargets, project, ZOOMS } from './Spyglass.js';
export { HeadingRibbon, headingOf, wrapDelta, ribbonMarks } from './HeadingRibbon.js';

export default { install };

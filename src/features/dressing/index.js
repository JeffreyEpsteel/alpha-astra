// Dressing feature: a living sea and dressed harbours.
//
//   Marine life ( the naval fork's MarineLife pack ): kelp beds on the shallow seabed round the reef and Pons ( instanced, swaying
//   in the vertex shader ), baitfish schools over them, and dolphin pods that come up to the player's boat in open water and
//   porpoise alongside it with a splash ( app.spray ) each time they break the surface.
//   Harbour ( the fork's port props ): rope coils, a net-mending still life, bait bowls, coin trays, hanging nets and bunting
//   strung between posts, on the home pier / boardwalk and at Pons's dock and huts, kept clear of walkways, stalls and vendors.
//   Pons Cove: instanced coconut palms ( Vegetation's own geometry and wind material ) and rocks.
//
//   features.add( 'dressing', dressing );        // import * as dressing from './features/dressing/index.js'
//   const d = features.get( 'dressing' );
//   d.stats()  d.plan ( harbour items + poles )  d.sites ( kelp / schools / palms / rocks )  d.parts  d.update( dt )  d.dispose()
//
// Options ( install( app, features, opts ) ): { kelp, fish, dolphins, harbour, island: true | false, baseUrl }. `?noDressing` in the
// page URL turns it all off. Assets: public/models/marine, public/models/harbour ( tools/dressing/build.ps1 ).
//
// Hooks the root needs: none beyond adding the module to MODULES in src/features/install.js. ( Nothing is saved. )

import { Dressing } from './Dressing.js';

export function install( app, features, opts = {} ) {

	// phones: no dolphin pods or bait schools (the memory budget)
	if ( globalThis.__phoneBudget && globalThis.__phoneBudget.marine === false ) opts = { ...opts, dolphins: false, fish: false };

	return new Dressing( app, features, opts );

}

export { Dressing } from './Dressing.js';
export { kelpSites, palmSites, rockSites, ponsKeepOut } from './Sites.js';
export { planHarbour, planHome, planPons, MODELS } from './Harbour.js';

export default { install };

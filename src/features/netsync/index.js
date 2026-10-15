// Multiplayer extras as a feature module (install( app, features ), see ../Features.js): crew codes and the Crew panel,
// passengers on another player's boat, and naval combat shared through the room's host.
//
//   features.add( 'netsync', netsync );               // import * as netsync from './netsync/index.js' in features/install.js
//   openCrewPanel( app )                              // the Online tab's "Crew" button
//   app.features.get( 'netsync' ).riding / ridePose( out ) / decorateState( state ) / stepOff()   see NetSync.js
//
// It does nothing while the game is offline (app.net null), apart from keeping the naval feature in its normal solo mode.

import { NetSync } from './NetSync.js';

export function install( app, features, opts = {} ) {

	return new NetSync( app, features, opts );

}

// toggles the Crew panel; returns the panel (or null when the feature is not installed)
export function openCrewPanel( app ) {

	const ns = app && app.features && app.features.get ? app.features.get( 'netsync' ) : null;
	if ( ! ns ) return null;
	ns.togglePanel();
	return ns.panel;

}

export { NetSync } from './NetSync.js';
export { NavalLink } from './NavalLink.js';
export { CrewPanel } from './CrewPanel.js';

export default { install };

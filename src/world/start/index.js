// Start feature: Hyptile Island's own opening (see README.md here for what changed from Tidewater).
//
//   Jade Landing (Landing.js): the jade-roofed fisher's pavilion in the east corner of the bay where the player
//   starts (WORLD.start, WORLD.landing), the carved jade-fish totem, lanterns, bunting, drying racks, hammocks and the
//   boardwalk west to the boathouse path. Dressover.js: a jade roof cap and nobori banners at the pier's entrance arch,
//   pennants on the stilt huts. Intro.js: the first-campaign-start camera glide from the bay with the title card.
//
//   features.add( 'start', start );            // import * as start from '../world/start/index.js' (install.js MODULES)
//   const s = features.get( 'start' );
//   s.playIntro( { mode, slot, fresh } )       // App.startSession (optional: the module also notices a new session itself)
//   s.intro.active / s.intro.pending, s.landing.plan, s.stats(), s.lights (3 lanterns, installFeatures adds them)
//
// `?noStart` turns the whole module off (the old Tidewater opening comes back, apart from WORLD.start).
// Nothing is saved (the intro's once-per-slot flag lives in localStorage, Intro.js INTRO_KEY).
import { Landing } from './Landing.js';
import { Dressover } from './Dressover.js';
import { Intro, introKey } from './Intro.js';

export function install( app, features ) {

	const qs = app.qs || new URLSearchParams( typeof location !== 'undefined' ? location.search : '' );
	if ( qs.has( 'noStart' ) ) return null;
	const scene = app.scene, terrain = app.terrainData, colliders = app.colliders;
	const landing = new Landing( { scene, terrain, colliders } );
	const dressover = app.village ? new Dressover( { scene, terrain, colliders, village: app.village } ) : null;
	const intro = new Intro( app );
	let wasSession = !! app.session, asked = false;

	const inst = {
		landing, dressover, intro,
		lights: landing.lights,

		// App.startSession (root hook): arm the intro for the slot just loaded. fresh: a New game on the slot
		// (its once-only flag is cleared so the new islander sees it too)
		playIntro( { mode = app.mode, slot = features.state ? features.state.slot : 0, fresh = false, force = false } = {} ) {

			asked = true;
			if ( fresh ) try { localStorage.removeItem( introKey( mode, slot ) ); } catch ( e ) { /* no storage */ }
			return intro.request( { mode, slot, force } );

		},

		update( dt ) {

			// fallback trigger: a session just started (menu -> play, or a slot loaded from the pause menu) and the
			// root did not ask itself. ?nomenu / ?bench sessions never set app.session, so they never get here.
			const on = !! app.session;
			if ( on && ! wasSession && ! asked ) inst.playIntro();
			if ( ! on ) asked = false;
			wasSession = on;
			intro.update( dt );

		},

		stats() {

			return { landing: landing.stats(), dressover: dressover ? dressover.stats() : null };

		},

		dispose() {

			intro.dispose();
			landing.dispose();
			if ( dressover ) dressover.dispose();
			if ( app.localLights ) for ( const l of landing.lights ) app.localLights.remove( l );

		},
	};
	return inst;

}

export { Landing, landingFrame } from './Landing.js';
export { Dressover } from './Dressover.js';
export { Intro, introAllowed, introKey, introPose, INTRO_KEY, DURATION } from './Intro.js';

export default { install };

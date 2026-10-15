// Emotes feature (docs/UNREAL_PARITY.md C8): twelve emotes (wave, dance, point, cheer, laugh, bow, salute, flex, facepalm,
// thumbs up, sit, dance 2) on a key, synced to the other players.
//   features.add( 'emotes', emotes );              // import * as emotes from './emotes/index.js'
//   const em = features.get( 'emotes' );           // em.key (claimed through features.claimKey), em.play( id ), em.open()
// Details in Emotes.js. Nothing is saved. `?noEmotes` in the URL turns it off. Hooks the root needs: the MODULES entry
// (after 'netsync' and 'harbour'), the touch tray button (core/Touch.js: 'emote' sends this feature's key), the help row.

import { Emotes } from './Emotes.js';

export function install( app, features ) {

	try {

		if ( typeof location !== 'undefined' && /(^|[?&])noEmotes\b/.test( location.search || '' ) ) return null;

	} catch ( e ) { /* no location */ }

	return new Emotes( app, features );

}

export { Emotes, EMOTES, EMOTE_IDS, RATE_LIMIT, KEY_CANDIDATES, PICK_KEYS, HOLD_SECONDS } from './Emotes.js';
export { proceduralWave, WAVE_CLIP, WAVE_KEYS } from './Procedural.js';

export default { install };

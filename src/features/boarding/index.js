// Boarding feature: take a crippled pirate ship (below 25 % hull, struck her colours), cross to her deck, beat 2-3 crew in melee, then take
// the captain prisoner (ransom at the harbour, a bounty target pays x1.5) or plunder her. Interface and flow: Boarding.js.
//
//   features.add( 'boarding', boarding );        // import * as boarding from './features/boarding/index.js'; add it AFTER 'melee' and 'naval'
//   const b = features.get( 'boarding' );
//   b.phase  b.offer  b.prisoners  b.stats  b.board( ship )  b.choose( 0 | 1 )  b.retreat()  b.handOver( port )  b.view()
//   b.update( dt )  b.toJSON() / fromJSON( d )  b.reset()  b.dispose()
//
// Key B is claimed on the registry ('boarding'); the surrender uses 1 / 2. Needs: features.get( 'naval' ) (ships), features.get( 'melee' )
// (the crew fight through its raiders; without it the crew surrender at once), optionally 'trade' (plunder cargo) and 'notices' (bounty x1.5).
// b.hostile (Hostile.js): pirates boarding the player's boat (grapple, then 1 repel / 2 ransom); install opts { hostile: false } turns it off.

import { Boarding } from './Boarding.js';

export function install( app, features, opts = {} ) {

	return new Boarding( app, features, { ...( app && app.boardingOptions ), ...opts } );

}

export { Boarding, RULES } from './Boarding.js';
export { CREW_TWEAK, deckFor, tierOf, ransomFor, plunderFor, hullGap } from './BoardingData.js';
export { Prisoner } from './Prisoner.js';
export { Hostile, HOSTILE } from './Hostile.js';

export default { install };

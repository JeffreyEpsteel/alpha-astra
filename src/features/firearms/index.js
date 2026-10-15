// Firearms feature (wave 9B): the flintlock pistol and the musket; wave 18D: duelling pistols, the long rifle, the blunderbuss and
// the harpoon gun. See Firearms.js for the interface.
//
//   features.add( 'firearms', firearms );    // import * as firearms from './features/firearms/index.js'; after melee, naval,
//                                            // boarding, destruction and vfx (it reads them at the shot, so the order only
//                                            // matters for update: after melee keeps melee's LMB edge first)
//   const fa = features.get( 'firearms' );   fa.drawn  fa.weapon  fa.shots  fa.buy( id )  fa.shopRows()  fa.playerAction
//   fa.drawSlot( 'side' | 'long' )  fa.marketRows( trade ) / fa.marketAction( 'gun:<id>' ) (Blackwater's fence)
//
// options (install( app, features, opts ), or app.firearmsOptions): enabled, seed, rand, audio (a GunAudio stub), mesh: false.

import { Firearms } from './Firearms.js';

export function install( app, features, options = {} ) {

	return new Firearms( app, features, { ...( app && app.firearmsOptions ), ...options } );

}

export { Firearms, AIM } from './Firearms.js';
export { WEAPONS, ORDER, POUCH, HEADSHOT, MAX_RANGE, MAGNET, BLOOM, SLOT_OF, POSE_OF, LINE, damageAt, spreadRad, spreadDir, angleBetween, forwardOf, maxRange, barrelsOf, cartridgesFor } from './FirearmsData.js';
export { GunHud, coneToPx } from './GunHud.js';
export { resolveShot, hitHumanoid, hitShip, hitGround, deckBox, BODY, POST, DECK } from './Hitscan.js';
export { GunAudio, REPORTS, CLICKS } from './GunAudio.js';
export { WeaponMesh, buildWeaponGeometry, weaponTriangles, HOLD, FP, MUZZLE } from './WeaponMesh.js';

export default { install };

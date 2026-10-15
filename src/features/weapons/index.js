// The arsenal (wave 18D): melee weapons beyond the paddle (cutlass, boarding axe, belaying pin, harpoon), throwables (powder
// bombs, fire bottles, smoke pots), the swivel gun manned from the deck, chain and grape shot, the quick slots 1-4 that tie
// them to the firearms feature, and the raiders' arms. See Weapons.js for the interface, WeaponsData.js for the numbers.
//
//   features.add( 'weapons', weapons );    // import * as weapons from './features/weapons/index.js'; after melee, firearms,
//                                          // naval, destruction and vfx (it reads them when it acts)
//   const w = features.get( 'weapons' );   w.meleeStats()  w.slot( kind )  w.cycle()  w.hand  w.hidden( x, z )  w.shopRows()
//
// options (install( app, features, opts ), or app.weaponsOptions): enabled, seed, rand, audio (a WeaponAudio stub), mesh: false,
// glb: false (the procedural stand-ins only).

import { Weapons } from './Weapons.js';

export function install( app, features, options = {} ) {

	return new Weapons( app, features, { ...( app && app.weaponsOptions ), ...options } );

}

export { Weapons } from './Weapons.js';
export * from './WeaponsData.js';
export { ModelBank, buildGeometry, glbGeometry, modelTriangles, MATS, IDS, MUZZLES, RADIUS } from './WeaponModels.js';
export { weaponPoses, socketAt, WEAPON_CLIPS, WEAPON_RECIPES, ATTACK_OF, HOLD_OF, HOLD_AIM, THROW_RELEASE } from './WeaponPose.js';
export { WeaponAudio } from './WeaponAudio.js';
export { Props, ArcPreview } from './WeaponVisuals.js';

export default { install };

// Naval combat feature: AI merchant trawlers (home harbour <-> Pons Cove), pirate sloops and brigantines
// patrolling the deep water south of the island (more at night and in storms), cannon combat with ballistic
// shot, hull damage, sinking and floating loot, the player's swivel gun and hull, and the naval HUD.
//
//   features.add( 'naval', naval );                      // import * as naval from './features/naval/index.js'
//   const n = features.get( 'naval' );
//   n.ships  n.playerHull { hp, max, sunk, boat }  n.playerGun { owned, level, guns, builtIn }  n.speedFactor  n.fire( side )
//   n.repairCost() / n.repair() / n.rescue()  n.damagePlayer( amount, cause )  n.spawn( kind, opts )
//   n.update( dt )  n.toJSON() / n.fromJSON( d )  n.reset()  n.dispose()
//   ship modules: n.moduleRows() / moduleSlots() / buyModule( id ) / fitModule( id, slot ) / removeModule( id ), n.holdBonus(),
//   n.fishHoldBonus(), n.biteBonus(), n.sightRange(); n.spawn( classId, opts ) is public for the pirates package (Naval.js header)
//
// Keys at the helm: Z fires the port broadside, X the starboard one (claimed on the registry as 'naval').
// See Naval.js for the full interface and the hooks the integrator needs to wire (the speed factor, the gun purchase,
// the sunk handling); README-style notes live in the top comments of Naval.js, Ship.js, Brains.js and Routes.js.

import { Naval } from './Naval.js';

export function install( app, features, opts = {} ) {

	return new Naval( app, features, opts );

}

export { Naval, hullMaxFor, GUN_LEVELS, REPAIR_PER_HP, BALL_MASS } from './Naval.js';
export { MODULES, MODULE_IDS, SLOT_KINDS, SLOT_LABELS, Fitting, moduleMounts, fitMounts, moduleLabel } from './Modules.js';
export { Ship, SINK_TIME } from './Ship.js';
export { SHIP_CLASSES, SHIP_KINDS } from './ShipClasses.js';
export { MERCHANT_ROUTE, PATROLS, SAFE_ZONES, HARBOUR_ANCHORAGE, PONS_ROADS } from './Routes.js';
export { solveElevation, leadAim, MUZZLE_SPEED, GRAVITY } from './Ballistics.js';

export default { install };

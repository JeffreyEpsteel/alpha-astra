// Seaplane feature: a floatplane bought at the hangar on the beach west of the pier ($18,000 in a campaign, free in
// the sandbox), boarded from its jetty, flown with a rigid-body flight model (Flight.js) that takes off from and lands
// on the water. See Seaplane.js for the interface, the events and the keys.
//
//   features.add( 'seaplane', seaplane );        // import * as seaplane from './features/seaplane/index.js'
//   const sp = features.get( 'seaplane' );  sp.marker()  sp.decorateState( out )  sp.updateRemote( states )

import { Seaplane } from './Seaplane.js';

export function install( app, features, opts = {} ) {

	return new Seaplane( app, features, opts );

}

export { Seaplane, PRICE, REPAIR_PER_HP } from './Seaplane.js';
export { Flight, GEOM, SPEC, STRIKE, SPRUNG, liftCoefficient, waterResistance } from './Flight.js';
export { Pilot, judge, PILOT, TOUCH, MAX_HP } from './Pilot.js';
export { SITE, jettyPoint, distToBerth } from './Site.js';
export { Systems, FUEL, refuelCost, START_TIME, STALL_WARN, SEARCH } from './Systems.js';
export { Cockpit, CONTROLS, TEX, FACE, rayPanel, hitControl, panelSnapshot, drawPanel } from './Cockpit.js';
export { AUTOPILOT } from './Pilot.js';
export { CRASH, SEVERITY, assess, throwPoint, wreckParts, hullOffset } from './Crash.js';
export { Wreck, PARTS, PART_NAMES, partsFor } from './Wreck.js';
export { NODE_PART, BODY_PARTS, meshParts, propHubs } from './Model.js';
// wave 12C: airframes, upgrades, the parachute, the airstrip
export { AIRFRAMES, AIRFRAME_IDS, UPGRADES, UPGRADE_IDS, LIVERIES, RADIO_RANGE, spec, upgradePrice, upgradeFits, capacity, cargoMass, defaultUpgrades, cleanUpgrades } from './Airframes.js';
export { Chute, CHUTE, buildCanopy } from './Chute.js';
export { findAirstrip, stripPad, stripOffice, onStrip } from './Site.js';
// wave 14B: parked airframes (one look for the local fleet and netsync's remote 'parked' entries), bay moorings
export { ParkedPlane, RemotePlanes } from './Remote.js';
export { MOOR_RADIUS, STRIP_TIP_RANGE } from './Seaplane.js';

export default { install };

// Rescue feature (wave 15D): climb onto anything afloat (the providers on Player's one climb rule) and distress flares that
// bring an ally vessel to take you ashore. See Rescue.js for the interface, the events and the flow.
//
//   features.add( 'rescue', rescue );        // import * as rescue from './features/rescue/index.js' (after naval, agents)
//   const r = features.get( 'rescue' );  r.flares  r.buy()  r.fire()  r.job  r.shopRows()  r.agentRow( port )  r.wantsKey( code )

import { Rescue } from './Rescue.js';

export function install( app, features, opts = {} ) {

	return new Rescue( app, features, opts );

}

export { Rescue, shipHull } from './Rescue.js';
export { FLARE, RESCUE, LAUNCH, COXSWAINS, rescueFee, nearestPort, planResponse } from './RescueData.js';
export { Flares } from './Flares.js';
export { Floaters, NEAR } from './Floaters.js';

export default { install };

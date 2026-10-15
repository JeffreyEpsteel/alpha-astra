// Free rescue rotorcraft at the home helipad (18,-68), with its own persistent
// position, real cockpit and animated rotors. Player's generic vehicle contract
// provides boarding, chase/first-person cameras and E to leave after landing.
import { Helicopter } from './Helicopter.js';
export function install( app, features, opts = {} ) { return new Helicopter( app, features, opts ); }
export { Helicopter, HOME, CONTROLS, COCKPIT_KEYS } from './Helicopter.js';
export { RotorFlight, FLIGHT } from './Flight.js';
export { HelicopterVisual } from './Model.js';
export { RotorSystems } from './Systems.js';
export { HelicopterCockpit } from './Cockpit.js';
export default { install };

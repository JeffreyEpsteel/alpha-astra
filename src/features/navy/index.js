// The navy feature (wave 19B): see Navy.js. Install after naval, pirates, hijack, customs, weapons and rescue (it reads them).
//   features.add( 'navy', navy );     import * as navy from './navy/index.js'
import { Navy } from './Navy.js';

export { Navy } from './Navy.js';
export { SeaEvents } from './SeaEvents.js';
export { drawNavy, buildJetty, dressGeometry, jettyGeometry } from './NavyModels.js';
export * from './NavyData.js';

export function install( app, features, opts = {} ) {

	return new Navy( app, features, opts );

}

export default { install };

import { Notices } from './Notices.js';

// Notice boards and bounty contracts (feature module). Register it on the Features registry:
//
//   import * as notices from './features/notices/index.js';
//   features.add( 'notices', notices );
//
// install( app, features ) -> the instance: { update( dt ), dispose(), toJSON(), fromJSON(), reset(), board( port ),
//   active, accept( id ), abandon( id ), standing( port ), greeting( port ), advance( hours ), rep, hours, day, isOpen, close() }.
// Everything is documented at the top of Notices.js (events listened to and emitted); the data and the posting
// generator are in NoticeData.js; the boards' sites in Sites.js. Runs headless: the HUD panel and the 3D boards are
// built lazily and only when there is a DOM / a scene.
export function install( app, features ) {

	return new Notices( app, features );

}

export { Notices };
export { generateDay, PORT_INFO, MAX_ACTIVE } from './NoticeData.js';
export { BOARD_SITES } from './Sites.js';

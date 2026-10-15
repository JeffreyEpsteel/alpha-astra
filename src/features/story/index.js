import { Story } from './Story.js';

// Quest chains, conversations, NPC memory and consequences (feature module). Register it on the Features registry:
//
//   import * as story from './features/story/index.js';
//   features.add( 'story', story );
//
// install( app, features ) -> the Story instance (Story.js documents its API and events). Runs headless: the
// conversation panel is built lazily, only when a HUD exists.
export function install( app, features ) {

	return new Story( app, features );

}

export { Story };
export { CHAINS, NPCS, ITEMS, errandChains } from './StoryData.js';

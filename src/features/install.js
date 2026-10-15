// The v2 feature modules installed into the game (see Features.js and docs/PLAN.md "v2").
// Add a module here once it is integrated; each lives in its own folder under src/features/.
import { Features } from './Features.js';
import { WORLD } from '../world/WorldLayout.js';
import * as trade from './trade/index.js';
import * as weather from './weather/index.js';
import * as notices from './notices/index.js';
import * as melee from './melee/index.js';
import * as naval from './naval/index.js';
import * as sfx from './sfx/index.js';
import * as boarding from './boarding/index.js';
import * as netsync from './netsync/index.js';
import * as dressing from './dressing/index.js';
import * as worldmap from './worldmap/index.js';
import * as vfx from './vfx/index.js';
import * as night from './night/index.js';
import * as story from './story/index.js';
import * as debugPanel from '../ui/DebugPanel.js';
import * as saveManager from '../ui/SaveManager.js';
import * as destruction from './destruction/index.js';
import * as pirates from './pirates/index.js';
import * as stronghold from './pirates/Stronghold.js';
import * as harbour from './harbour/index.js';
import * as agents from './agents/index.js';
import * as crafting from './crafting/index.js';
import * as inverted from './inverted/index.js';
import * as life from './life/index.js';
import * as exploration from './exploration/index.js';
import * as seaplane from './seaplane/index.js';
import * as helicopter from './helicopter/index.js';
import * as hijack from './hijack/index.js';
import * as customs from './customs/index.js';
import * as death from './death/index.js';
import * as rescue from './rescue/index.js';
import * as tips from '../game/Tips.js';
import * as firearms from './firearms/index.js';
import * as weapons from './weapons/index.js';
import * as crew from './crew/index.js';
import * as emotes from './emotes/index.js';
import * as start from '../world/start/index.js';
import * as townlife from './townlife/index.js';
import * as navy from './navy/index.js';
import * as interiors from '../world/interiors/index.js';
import * as cars from './cars/index.js';
import * as citywreck from './citywreck/index.js';

export const MODULES = [
	[ 'start', start ], // Jade Landing + intro (first: later modules see its colliders)
	[ 'weather', weather ],
	[ 'trade', trade ],
	[ 'customs', customs ], // inspections on arrival; after trade
	[ 'notices', notices ],
	[ 'story', story ], // quest chains, conversations, NPC memory (after notices: it lists on their boards)
	[ 'harbour', harbour ], // after trade / notices / story; needs app.residents
	[ 'agents', agents ], // wave 14C: Roid & Co. harbour agents at every dock (after harbour: the ports' vendors)
	[ 'crafting', crafting ], // after harbour
	[ 'melee', melee ],
	[ 'destruction', destruction ], // breakable props (Rapier physics): before naval so its raycast is ready for the balls
	[ 'naval', naval ],
	[ 'sfx', sfx ],
	[ 'boarding', boarding ],
	[ 'pirates', pirates ], // named captains, dens, notoriety (spawns through naval)
	[ 'stronghold', stronghold ], // Blackwater: the fort's batteries, alarm, guards, claim and black market
	[ 'townlife', townlife ], // wave 18B: townsfolk, animals, skiffs (after harbour, stronghold)
	[ 'interiors', interiors ], // wave 19E: walk into the taverns, the chandleries and the harbourmaster's office
	[ 'crew', crew ], // hired characters posted aboard: gunners and anglers
	[ 'emotes', emotes ], // 5 opens the emote row (12 emotes), synced as a world event
	[ 'netsync', netsync ],
	[ 'dressing', dressing ],
	[ 'worldmap', worldmap ],
	[ 'vfx', vfx ], // after naval: ship state is current when the fires update
	[ 'night', night ],
	[ 'seaplane', seaplane ], // the floatplane and its hangar west of the pier
	[ 'helicopter', helicopter ], // coastal rescue rotorcraft and landable city roofs
	[ 'hijack', hijack ], // wave 15C: take any vessel (after boarding, naval, seaplane)
	[ 'death', death ], // respawn at Jade Landing, the sea chest, wreck / death markers
	[ 'rescue', rescue ], // wave 15D: distress flares and the harbour launch that answers them
	[ 'firearms', firearms ], // flintlock pistol and musket (G draws, LMB fires, RMB aims, R reloads; cartridges at the chandlery)
	[ 'weapons', weapons ], // wave 18D: cutlass, axe, pin, harpoon, bombs, fire bottles, smoke pots, the swivel gun, quick slots 1-4 / 0
	[ 'navy', navy ], // wave 19B: Tidemark's frigate and cutters, hails, navy bounties and standing, sea events
	[ 'cars', cars ], // wave 21B: Meridian's traffic, parked cars, police; every car drivable (E at a door)
	[ 'citywreck', citywreck ], // wave 21C: Meridian's destructible buildings (finds app.meridian / app.ports.meridian itself)
	[ 'inverted', inverted ], // the upside-down sky layer (off until ?inverted or the Inverted Isles)
	[ 'life', life ],
	[ 'exploration', exploration ], // after inverted and naval (the spyglass labels their things)
	[ 'tips', tips ], // wave 16B: one-time contextual tips, saved per save
	[ 'debug', debugPanel ], // sandbox only: the ` key
	[ 'saves', saveManager ],
];

// builds the registry, installs every module and hands their lights to the scene's local lights
export function installFeatures( app ) {

	const features = new Features( app );
	for ( const [ name, module ] of MODULES ) {

		const inst = features.add( name, module );
		if ( inst && inst.lights && app.localLights ) for ( const l of inst.lights ) app.localLights.add( l );

	}

	app.netsync = features.get( 'netsync' );
	// the fish well module widens the fish hold (GameState.stats reads it when a boat is set)
	if ( app.game && app.game.state ) app.game.state.holdKgBonus = () => features.get( 'naval' )?.fishHoldBonus?.() ?? 1;
	// a notice's unique reward: an islander joins the crew for free
	features.on( 'rewardUnlock', ( e ) => {

		const st = app.game && app.game.state;
		if ( st && e && e.character && st.unlockCharacter( e.character, { free: true } ) && app.game.toast ) app.game.toast( `A new crew member joined (K)`, 3200 );

	} );
	// (a sunk boat: naval sinks her and leaves a wreck; the death feature respawns the player: src/features/death)
	return features;

}

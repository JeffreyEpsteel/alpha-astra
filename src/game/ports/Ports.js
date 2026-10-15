import { Vector3 } from '../../engine/index.js';
import { WORLD } from '../../world/WorldLayout.js';
import { GullRock } from '../../world/islands/GullRock.js';
import { SaltmarshKey } from '../../world/islands/SaltmarshKey.js';
import { KeyPort, KEY_STAND, KEY_PREMIUM } from './KeyPort.js';
import { WestHaven } from '../../world/islands/WestHaven.js';
import { TheShrine } from '../../world/islands/TheShrine.js';
import { QuietShoal } from '../../world/islands/QuietShoal.js';
import { InvertedIsles } from '../../world/islands/InvertedIsles.js';
import { HavenPort, HAVEN_STAND, HAVEN_PREMIUM } from './HavenPort.js';
import { ShrinePort, SHRINE_STAND, SHRINE_PREMIUM } from './ShrinePort.js';
import { Tidemark } from '../../world/islands/Tidemark.js';
import { TidemarkPort, TIDEMARK_STAND, TIDEMARK_PREMIUM, TIDEMARK_BOARD, TIDEMARK_TAVERN } from './TidemarkPort.js';
import { registerTidemarkFolk } from '../../world/islands/town/Folk.js';
import { PORT_FOLK } from '../../world/residents/ResidentData.js';
import { Meridian } from '../../world/islands/meridian/Meridian.js';
import { MeridianPort, MERIDIAN_STAND } from '../../world/islands/meridian/MeridianPort.js';

// The extra ports of the archipelago beyond the harbour and Pons Cove: Gull Rock (a lighthouse and a
// jetty on a rocky islet to the west-south-west) and Saltmarsh Key (a low sandy key to the east
// with a fisherman's hut and a buyer who pays a premium for flats fish). WORLD.ports lists all four
// ports (home, pons, gull, key) with their docks, stands, islands and sailing approaches.
//
// Islands 5-8 (the Unreal game's West Haven, The Shrine, Quiet Shoal and the Inverted Isles; WORLD.ports
// haven, shrine, shoal, inverted): West Haven is the trading harbour town (a ship chandler of kind 'shop' and a
// fish market paying a deep-water premium), The Shrine a basalt sea-stack cluster with a hermit fisher (a
// premium on the strange fish), Quiet Shoal the mangrove island with the Hanging Roots, and the Inverted Isles
// the suspended upside-down islands over an atoll lagoon a seaplane can land in. Each island culls its props
// by camera distance in update() (the landmarks, such as the sky isles, stay on the horizon).
//
//   const ports = new Ports( { scene, terrain, colliders } );
//   ports.vendors                       push into Game.vendors (Pengu at Saltmarsh Key, kind 'buyer')
//   ports.lights                        add each to localLights (lighthouse lamp, lanterns, hut windows)
//   ports.update( dt, playerPos )       per frame (Player, or a Vector3; the vendor looks at it on foot)
//   ports.near( p )                     'gull' | 'key' | null: within 25 m of that port's jetty or stand
//                                       (the discovery: state.discover( id ) on the first time on foot)
//   ports.markers                       [ { id, name, x, z, icon } ] for the minimap
//   ports.premiumBonus( vendor, fish )  extra $ a premium vendor pays over the normal value
//   ports.priceFor( vendor, fish )      the price one fish fetches from that vendor
//   ports.gull / ports.key / ports.keyPort   the parts (GullRock, SaltmarshKey, KeyPort)
//   ports.haven / ports.shrine / ports.shoal / ports.inverted / ports.havenPort / ports.shrinePort   islands 5-8
//   ports.lagoon                        { x, z, radius } the Inverted Isles' lagoon (seaplane water)
//   ports.info( id )                    the WORLD.ports entry
//
// Tidemark (wave 12A; WORLD.ports tidemark): the big town island east of the archipelago on its own terrain tile (built
// here, attached to the terrain's queries), its fish hall (a reef-fish premium) and chandler, the airstrip (map marker
// 'tidemark:airstrip'), its named residents added to the harbour feature's PORT_FOLK.
//   ports.tidemark / ports.tidemarkPort   the island (Tidemark: damage, airstrip, tile) and its traders

export { KEY_STAND, KEY_PREMIUM, HAVEN_STAND, HAVEN_PREMIUM, SHRINE_STAND, SHRINE_PREMIUM, TIDEMARK_STAND, TIDEMARK_PREMIUM, TIDEMARK_BOARD, TIDEMARK_TAVERN };
export const PORT_IDS = [ 'gull', 'key', 'haven', 'shrine', 'shoal', 'inverted', 'tidemark', 'meridian' ];
const NEAR = 25;

export class Ports {

	constructor( { scene, terrain, colliders = null, birds = true, village = null } ) {

		this.terrain = terrain;
		this.gull = new GullRock( { scene, terrain, colliders, birds } );
		this.key = new SaltmarshKey( { scene, terrain, colliders } );
		this.keyPort = new KeyPort( { scene, terrain, colliders } );
		this.haven = new WestHaven( { scene, terrain, colliders } );
		this.havenPort = new HavenPort( { scene, terrain, colliders } );
		this.shrine = new TheShrine( { scene, terrain, colliders } );
		this.shrinePort = new ShrinePort( { scene, terrain, colliders } );
		this.shoal = new QuietShoal( { scene, terrain, colliders } );
		this.inverted = new InvertedIsles( { scene, terrain, colliders } );
		this.lagoon = this.inverted.lagoon;
		// Tidemark first builds its terrain tile and attaches it to `terrain`, so its traders stand on the town's ground
		this.tidemark = new Tidemark( { scene, terrain, colliders, village } );
		this.tidemarkPort = new TidemarkPort( { scene, terrain, colliders } );
		registerTidemarkFolk( PORT_FOLK );
		// Meridian (wave 21A): the city island west of home (its tile, the city, the handle the cars and citywreck use: app.meridian)
		this.meridian = new Meridian( { scene, terrain, colliders } );
		this.meridianPort = new MeridianPort( { scene, terrain, colliders } );
		this.vendors = [ this.keyPort.vendor, ...this.havenPort.vendors, this.shrinePort.vendor, ...this.tidemarkPort.vendors, ...this.meridianPort.vendors ];
		this.lights = [ ...this.gull.lights, ...this.key.lights, ...this.keyPort.lights, ...this.haven.lights, ...this.havenPort.lights,
			...this.shrine.lights, ...this.shrinePort.lights, ...this.shoal.lights, ...this.inverted.lights, ...this.tidemark.lights, ...this.tidemarkPort.lights, ...this.meridian.lights, ...this.meridianPort.lights ];
		this.list = WORLD.ports.filter( ( p ) => PORT_IDS.includes( p.id ) );

		const gd = WORLD.gull.dock, G = this.gull.lighthouse;
		this._spots = {
			gull: [ gd.start, new Vector3().lerpVectors( gd.start, gd.end, 0.5 ), gd.end, new Vector3( G.door.x, 0, G.door.z ) ],
			key: [],
		};
		const kd = WORLD.key.dock;
		this._spots.key = [ kd.start, new Vector3().lerpVectors( kd.start, kd.end, 0.5 ), kd.end, new Vector3( KEY_STAND.x, 0, KEY_STAND.z ) ];
		// islands 5-8: the jetty (foot, middle, head) and the stand / point of interest
		for ( const id of [ 'haven', 'shrine', 'shoal', 'inverted', 'tidemark', 'meridian' ] ) {

			const p = this.info( id ), d = p.dock;
			this._spots[ id ] = [ d.start, new Vector3().lerpVectors( d.start, d.end, 0.5 ), d.end, new Vector3( p.stand.x, 0, p.stand.z ) ];

		}

		// the minimap: the lighthouse for Gull Rock, the buyer's stall for Saltmarsh Key
		this.markers = [
			{ id: 'gull', name: 'Gull Rock', x: G.x, z: G.z, icon: 'anchor' },
			{ id: 'key', name: 'Saltmarsh Key', x: KEY_STAND.x, z: KEY_STAND.z, icon: 'fish' },
			{ id: 'haven', name: 'West Haven', x: HAVEN_STAND.x, z: HAVEN_STAND.z, icon: 'anchor' },
			{ id: 'shrine', name: 'The Shrine', x: SHRINE_STAND.x, z: SHRINE_STAND.z, icon: 'fish' },
			{ id: 'shoal', name: 'Quiet Shoal', x: this.shoal.fig.x, z: this.shoal.fig.z, icon: 'anchor' },
			{ id: 'inverted', name: 'The Inverted Isles', x: this.info( 'inverted' ).stand.x, z: this.info( 'inverted' ).stand.z, icon: 'anchor' },
			{ id: 'tidemark', name: 'Tidemark', x: TIDEMARK_STAND.x, z: TIDEMARK_STAND.z, icon: 'anchor' },
			{ id: 'tidemark:airstrip', name: 'Airstrip', x: this.tidemark.airstrip.x, z: this.tidemark.airstrip.z, icon: 'plane', port: 'tidemark' },
			{ id: 'meridian', name: 'Meridian', x: MERIDIAN_STAND.x, z: MERIDIAN_STAND.z, icon: 'anchor' },
			{ id: 'meridian:airstrip', name: 'Meridian Airport', x: WORLD.meridian.airstrip.x, z: WORLD.meridian.airstrip.z, icon: 'plane', port: 'meridian' },
		];
		// Tidemark's other landing spots: the airstrip's apron (a pilot who lands there has landed on Tidemark)
		const ap = this.tidemark.airstrip.pad;
		this._spots.tidemark.push( new Vector3( ap.x, 0, ap.z ), new Vector3( this.tidemark.airstrip.x, 0, this.tidemark.airstrip.z ) );
		// Meridian: the airport's apron and runway, the Twins' plaza, the ferry slip
		const M = WORLD.meridian;
		this._spots.meridian.push( new Vector3( M.airstrip.pad.x, 0, M.airstrip.pad.z ), new Vector3( M.airstrip.x, 0, M.airstrip.z ), new Vector3( M.town.x, 0, M.town.z ) );

	}

	info( id ) {

		return WORLD.ports.find( ( p ) => p.id === id ) || null;

	}

	near( p ) {

		const q = p && p.position ? p.position : p;
		if ( ! q ) return null;
		for ( const id of PORT_IDS ) for ( const d of this._spots[ id ] ) if ( Math.hypot( q.x - d.x, q.z - d.z ) < NEAR ) return id;
		return null;

	}

	update( dt, player ) {

		this.gull.update( dt );
		this.key.update( dt );
		this.keyPort.update( dt, player );
		// islands 5-8: distance culling (camera), and the traders' characters load once the camera comes close
		this.haven.update( dt );
		this.havenPort.update( dt, this.haven.distance );
		this.shrine.update( dt );
		this.shrinePort.update( dt, this.shrine.distance );
		this.shoal.update( dt );
		this.inverted.update( dt );
		this.tidemark.update( dt );
		this.tidemarkPort.update( dt, this.tidemark.distance );
		this.meridian.update( dt );
		this.meridianPort.update( dt );

	}

	priceFor( vendor, fish ) {

		return vendor && vendor.priceFor ? vendor.priceFor( fish ) : fish.value;

	}

	premiumBonus( vendor, fishList ) {

		return vendor && vendor.premiumBonus ? vendor.premiumBonus( fishList ) : 0;

	}

}

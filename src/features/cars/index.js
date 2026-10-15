// Cars feature (wave 21B): Meridian's streets come alive and every car can be driven.
//
//   features.add( 'cars', cars );     // after destruction, townlife, vfx, navy, pirates (it reads them lazily)
//   const c = features.get( 'cars' );
//   c.driving / c.drive (the record you drive) / c.enter( rec ) / c.exit()   E at a car's door (an interactable) gets in:
//       your own, any parked or idle car, or a stopped traffic car (its driver thrown out: wanted). Player.js's vehicle mode
//       ('plane': enterVehicle / exitVehicle) seats you and gives the chase camera (V: the driver's eye)
//   keys while driving: W / S throttle, brake and reverse, A / D steer, Space handbrake, H horn, E get out; phones: the
//       touch cluster writes c.touch = { active, steer, throttle, brake, handbrake, horn } (TouchControls patch); a pad:
//       left stick, triggers
//   Cockpit: V driver's eye, 3 accessible dashboard (Escape closes); look at physical switches and click.
//       c.cockpitAct('engine'|'lights'|'park'|'horn'|'siren') drives actual controls. Engine switches only below 0.8m/s.
//       Every kind has a local detailed cabin; traffic remains instanced. RPM/automatic gear derive from wheel speed,
//       feed engine audio, and engine off removes drive/reverse force (service brakes still work). No fuel system.
//   c.traffic (Traffic.js: AI cars on the plan's road graph: lanes, limits, lights, give way, honks, reroutes, buses)
//   c.graph (RoadGraph.js)   c.records (parked, idle, own, wrecks, pursuers)   c.heat 0..100 / c.level 0..5 (the city's
//       wanted level: the police chase; bust() fines you)   c.damage( rec, hp )   c.blast( x, y, z, r, energy )
//   c.buy( kind ) / repair( id ) / sell( id ) / ship( id, to ) / dealerView() (Meridian Motors, DealerPanel.js)
//   c.decorateState( out ) / c.updateRemote( states )   (netsync: the other players' cars)   c.toggleLights()   c.toggleSiren()
//   multiplayer (wave 22A, netsync/CarLink.js): c.setNetRole( 'solo' | 'host' | 'puppet' ); the host runs the traffic and the
//       police for every player in the city (c.netViewers, c.netTargets: the wanted guests) and c.netSnapshot() feeds the
//       guests; a guest draws c.mirror (CarNet.js) from c.applySnapshot( snap, age ); another player's car is locked (enter
//       refuses it: carRefused { id, owner })
//   c.lights (the driven car's two headlamps: LocalLights sources)   update( dt ) / toJSON() / fromJSON() / reset() / dispose()
// Damage by stages: 0 whole, 1 dented, 2 smoking, 3 burning (it burns down), 4 a wreck that explodes like a powder keg.
// Events emitted: carEntered { id, kind, own, how }, carExited, carJacked { id, kind, x, z }, carDamaged { id, kind, stage,
//   previous, cause }, carWrecked, carExploded { id, kind, x, z }, explosion { x, y, z, radius, energy, by: 'car' },
//   pedestrianHit { id, name, x, z, speed }, playerKnockedDown { by: 'car' | 'carExplosion' }, carWanted { level, previous,
//   heat, why } (the cars' own heat), cityBusted { level, fine }, carBought { id, kind, price }, carSold. World events
//   (netsync): carTaken { id }, carExploded { x, y, z }, carWanted { level }. The explosion event is emitted only on the
//   client that simulates the car (citywreck damages the buildings round it).
// Listens: roadBlocked / roadCleared { id, edges } (21C: traffic reroutes), cityWanted { level } (21C: the buildings' wanted
//   level; c.policeLevel() = the higher of the two, none for 60 s after a bust), cityDebris { x, y, z, radius, energy }
//   (falling rubble dents cars), explosion, cannonballImpact, remoteWorldEvent.
// Headless: install( app, features, { render: false, plan, colliders, terrain, roadHeight, rand, seed, scale, traffic,
//   citizens: () => sims, input: () => input, meridian, alwaysActive } ).
// Save: { v, heat, owned: [ { id, kind, color, x, y, z, yaw, hp, island, engineOn?, parkBrake? } ] }.
// Your cars and engine/parking-brake switches stay where you left them; older saves default to engine on, brake off.

import { Cars } from './Cars.js';

export function install( app, features, opts = {} ) {

	return new Cars( app, features, opts );

}

export { Cars };
export { KINDS, KIND_IDS, SALE_KINDS, DAMAGE, WANTED, TRAFFIC, DEALER, stageOf, impactDamage, wantedLevel } from './CarData.js';
export { CarBody, quatYPR } from './CarPhysics.js';
export { CarWorld, carCircles } from './CarCollide.js';
export { RoadGraph } from './RoadGraph.js';
export { Traffic } from './Traffic.js';

export default { install };

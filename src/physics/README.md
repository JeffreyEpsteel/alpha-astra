# src/physics: rigid bodies for destructible props

`World.js` is the facade the game uses (bodies, breakable joints, terrain heightfield, buoyancy, sleeping, fixed 1/60 step,
raycasts, blasts). `rapier/RapierBackend.js` is the only file that touches the engine underneath. `JointLoad.js` and
`Buoyancy.js` are plain math shared by any backend.

## Why Rapier and not three-avbd

three-avbd 0.3.0 (MIT, installed) was read first (`node_modules/three-avbd/build`, README, docs). Its public `World` is a
WebGPU compute solver: `World.create( { renderer } )` needs a three.js `WebGPURenderer` (or a raw `GPUDevice`), bodies live
in GPU buffers, poses and broken joints only come back through an async `await world.read()`, and drawing is meant to go
through its `BodyMesh` (three.js node materials). This game draws with its own WebGPU engine (no three renderer, no second
canvas) and needs synchronous answers on the CPU every frame: colliders for the character controller, `raycastSegment` for
cannonballs, which joints broke, debris resting on the terrain heightfield and floating in the sea. three-avbd has no
heightfield or buoyancy either. The CPU code it ships (`build/avbd3d/ref`) is a test oracle, not exported by the package,
boxes only, an O(n^2) broadphase, z-up gravity and no sleeping. Wrapping it would mean forking a solver.

Rapier (`@dimforge/rapier3d-compat` 0.21, Apache-2.0, WASM inlined) runs synchronously on the CPU, has heightfields,
convex hulls, cylinders, fixed joints, sleeping, CCD and ray casts, and needs one `await RAPIER.init()` (about 40-60 ms).
Measured in node (test/feature-destruction.mjs): 100 awake bodies falling onto a heightfield cost about 0.3-0.5 ms per step.
`World.js` is loaded with a dynamic `import()`, so the 4 MB module is its own chunk and only fetched when physics starts.

## What the facade adds on top of Rapier

- **Break forces.** Rapier does not report impulse-joint forces, so `JointLoad.js` estimates them every step from Newton's
  second law on each jointed body (velocity change, gravity, known forces and game impulses), solved over the joint graph
  with bodies that touch the outside world as anchors. It captures hanging weight, a piece dragged by a blast on its
  neighbour and impact shock; it ignores torques (bending) - see the header of `JointLoad.js`.
- **Terrain.** 16 m heightfield tiles (1 m cells) are made on demand under awake bodies from `heightAt( x, z )` (the game
  passes `app.terrainData.heightAt`, the same query Player.js uses) and dropped after 30 s unused. `statics( x0, z0, x1, z1 )`
  mirrors nearby static world colliders (decks, walls, piles from src/world/Colliders.js) when a tile appears.
- **Water.** `oceanHeight( x, z, t )` drives buoyancy (submerged fraction of the body's vertical extent) and linear drag,
  plus extra damping in water, so wood floats and rock sinks.
- **Budget.** `maxBodies` (300) dynamic bodies; `addBody` returns null past it (the destruction feature retires old debris).

A different backend only has to implement the `RapierBackend` method set (createBody, createJoint, createHeightfield,
createStatic, step, readPose, castRay, touching, ...).

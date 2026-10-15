import { Vector3, Euler, Color, MathUtils, Mesh } from './engine/index.js';
import { installFeatures } from './features/install.js';
import { GPU } from './engine/gpu/GPU.js';
import { SunShadows } from './engine/render/Shadows.js';
import { FrameUniforms } from './engine/render/Frame.js';

import { Engine } from './core/Engine.js';
import { Input } from './core/Input.js';
import { GamepadInput } from './core/Gamepad.js';
import { CDLOD } from './core/CDLOD.js';
import { G } from './core/Globals.js';
import { Profiler } from './core/Profiler.js';
import { SceneRenderer, LAYERS } from './core/SceneRenderer.js';
import { DEPTH_FORMAT } from './engine/render/SceneRenderer.js';
import { installDebugViews } from './core/DebugViews.js';

import { Atmosphere, SUN_ILLUMINANCE } from './sky/Atmosphere.js';
import { Sky, sunDirectionFromTime } from './sky/Sky.js';
import { Clouds } from './sky/Clouds.js';
import { SkyProClouds } from './sky/SkyProClouds.js';
import { Environment } from './sky/Environment.js';

import { TerrainData } from './world/TerrainData.js';
import { TerrainGPU } from './world/TerrainGPU.js';
import { Terrain } from './world/Terrain.js';
import { computeShoreField } from './world/ShoreField.js';
import { WORLD } from './world/WorldLayout.js';
import { Colliders } from './world/Colliders.js';
import { Village } from './world/Village.js';
import { Reef } from './world/Reef.js';
import { BoatModel } from './world/BoatModel.js';
import { Rocks } from './world/Rocks.js';
import { Debris } from './world/Debris.js';
import { Wildlife } from './world/wildlife/Wildlife.js';
import { Whale } from './world/marine/Whale.js';

import { OceanFFT } from './ocean/OceanFFT.js';
import { WaterSurface } from './ocean/WaterSurface.js';
import { WaterMaterial } from './ocean/WaterMaterial.js';
import { createFoamTexture } from './ocean/FoamTexture.js';
import { ShoreWaves } from './ocean/ShoreWaves.js';
import { ShoreSim } from './ocean/ShoreSim.js';
import { Caustics } from './ocean/Caustics.js';
import { installUnderwaterLighting } from './ocean/UnderwaterLighting.js';
import { RefractionPass } from './ocean/RefractionPass.js';
import { installGroundBounce } from './materials/GroundBounce.js';
import { LocalLights, addVillageLights, addBoatLights } from './materials/LocalLights.js';
import { WaterQuery } from './ocean/WaterQuery.js';
import { Breakers } from './ocean/Breakers.js';
import { SurfFoam } from './ocean/SurfFoam.js';
import { Spray } from './fx/Spray.js';
import { SeaDetail } from './ocean/SeaDetail.js';
import { MarineSnow } from './fx/MarineSnow.js';
import { AirMotes } from './fx/AirMotes.js';

import { Underwater, LENS_REACH } from './post/Underwater.js';
import { PostFX } from './post/PostFX.js';
import { AirHaze } from './post/AirHaze.js';
import { FlyCamera } from './player/FlyCamera.js';
import { Player } from './player/Player.js';
import { Game } from './game/Game.js';
import { CameraFeel } from './game/CameraFeel.js';
import { STAND } from './game/FishStand.js';
import { CHANDLERY } from './game/Chandlery.js';
import { BoatController } from './player/BoatController.js';
import { BoatSpray } from './player/BoatSpray.js';
import { Avatar } from './player/Avatar.js';
import { playerGroundProbe } from './player/ik/Ground.js';
import { attachVault } from './game/SaveVault.js';
import { attachGlyphs } from './ui/Glyphs.js';
import { contactTargets } from './player/ik/Grips.js';
import { createBoatModel } from './world/boat/BoatFactory.js';
import { BoatYard } from './game/BoatYard.js';
import { PonsCove } from './world/PonsCove.js';
import { PonsPort } from './game/PonsPort.js';
import { Ports } from './game/ports/Ports.js';
import { Residents } from './world/Residents.js';
import { CaptainRoid } from './game/CaptainRoid.js';
import { Clicks } from './audio/Clicks.js';
import { BOATS } from './game/Boats.js';
import { DEFAULT_MODE, DAY_SPEED, SANDBOX_ONLY, isMode, isOnlineSession, rules as modeRules } from './game/GameMode.js';
import { NetClient, defaultServerUrl } from './net/NetClient.js';
import { RemotePlayers } from './net/RemotePlayers.js';
import { ChatInput } from './net/ChatInput.js';
import { clockTimeOfDay } from './net/Protocol.js';
import { WakeSim } from './ocean/WakeSim.js';
import { Vegetation } from './world/Vegetation.js';
import { SoundScape } from './audio/SoundScape.js';
import { updateCameraVelocity, useStaticVelocity } from './post/CameraVelocity.js';

const _up = new Vector3( 0, 1, 0 );
const AUTOSAVE_MS = 60000; // the single-player autosave

export class App {

	constructor() {

		this.settings = {
			timeOfDay: 9.5,
			sunAzimuth: 0, // degrees: turns the sun's daily path about the vertical
			timeSpeed: DAY_SPEED, // hours per real second: a 40-minute day (T pauses it in the sandbox; a server's clock overrides it)
			exposure: 0.55,
			renderScale: 1, // internal resolution (the temporal upscaler reconstructs the output), Performance tab
		};
		this.qs = new URLSearchParams( location.search );
		// the game mode (sandbox / campaign / multiplayer, game/GameMode.js) and what it allows; startSession() sets it
		this.mode = DEFAULT_MODE;
		this.rules = modeRules( DEFAULT_MODE );
		this.session = false; // a slot is loaded and being played: the world snapshot and the autosave are on
		this.menuOpen = false; // the pause or main menu is up
		this.paused = false; // single player with the menu up: the game logic holds still

	}

	async init( onProgress = () => {} ) {

		const qs = this.qs;
		// report a stage, then let the page paint it before the (synchronous) stage work starts
		const progress = async ( p, text, until ) => {

			onProgress( p, text, until );
			if ( typeof requestAnimationFrame === 'function' ) await new Promise( ( r ) => requestAnimationFrame( () => setTimeout( r, 0 ) ) );

		};
		await progress( 0.02, 'Starting WebGPU…' );
		const engine = this.engine = new Engine( document.getElementById( 'app' ) );
		await engine.init();
		// systems take `renderer` first as in the three.js version: it is the Engine now (GPU access is global)
		const renderer = engine;
		const { scene, camera } = engine;
		// the near clip plane is the lens: it slices the water surface at the waterline (see Underwater)
		camera.near = 0.1;
		camera.updateProjectionMatrix();
		this.renderer = renderer;
		this.scene = scene;
		this.camera = camera;

		this.input = new Input( engine.domElement );
		this.gamepad = new GamepadInput( this.input );
		attachGlyphs( this ); // prompts show keyboard or pad glyphs after the last device used
		this.fly = new FlyCamera( camera, engine.domElement, this.input );
		this.fly.setPose( new Vector3( 20, 6, - 20 ), Math.PI * 0.9, - 0.12 );

		// ---------------------------------------------------------------- sky
		await progress( 0.04, 'Building the atmosphere…' );
		this.atmosphere = new Atmosphere( renderer );
		this.sky = new Sky( this.atmosphere );
		if ( ! qs.has( 'noClouds' ) ) {

			// sky-pro-webgpu's clouds ("Partly cloudy"); ?oldClouds: the previous ones
			this.clouds = qs.has( 'oldClouds' ) ? new Clouds( renderer, this.atmosphere ) : new SkyProClouds( renderer, this.atmosphere );
			if ( this.clouds.ready ) await this.clouds.ready;
			this.sky.clouds = this.clouds;

		}

		// 3 cascades: 0-10 m (~1 cm texels, fine contact detail), 10-60 m, 60-400 m (rough far shadows);
		// contact-hardening filter sized by the sun's disc on the near cascade. Each cascade's depth range
		// is its light margin (200 m) + its extent, which keeps the depth bias small in metres.
		// Shadows come from the opaque and the late (transparent-pass) layers.
		this.csm = this.shadows = new SunShadows( { size: 2048, splits: [ 10, 60, 400 ], lightMargin: 200, normalBias: [ 0.015, 0.06, 0.3 ], bias: 0.00002 } );
		this.shadows.layerMask = ( 1 << LAYERS.OPAQUE ) | ( 1 << LAYERS.TRANSPARENT );

		this.environment = new Environment( renderer, scene, this.sky );

		// ---------------------------------------------------------------- island
		await progress( 0.06, 'Shaping the island…' );
		this.terrainData = new TerrainData();
		this.colliders = new Colliders();
		// the village flattens building pads into the heightmap: build it before any terrain
		// data is derived (shore field, GPU textures, meshes)
		await progress( 0.12, 'Building the village…' );
		this.village = new Village( { scene, terrain: this.terrainData, colliders: this.colliders } );
		if ( ! qs.has( 'noVeg' ) ) {

			await progress( 0.14, 'Planting the island…' );
			this.vegetation = new Vegetation( { scene, terrain: this.terrainData, village: this.village } );
			useStaticVelocity( this.vegetation.group );

		}

		await progress( 0.19, 'Rolling in the swell…' );
		this.shoreField = computeShoreField( this.terrainData, { res: 512, swellDir: [ WORLD.swellDir.x, WORLD.swellDir.y ] } );
		this.terrainGPU = new TerrainGPU( this.terrainData, this.shoreField );
		// terrain and rocks apply the heightfield sun shadow (long hill shadows) in their own lighting
		this.terrain = new Terrain( { scene, terrainData: this.terrainData, terrainGPU: this.terrainGPU, renderer } );
		this.rocks = new Rocks( { scene, terrain: this.terrain, village: this.village, colliders: this.colliders } );
		// driftwood (CC0 photoscans), wrack, pebbles and village clutter
		this.debris = new Debris( { scene, terrain: this.terrain, village: this.village, vegetation: this.vegetation, rocks: this.rocks, colliders: this.colliders } );
		// these apply the heightfield sun shadow in their own lighting model (see UnderwaterLighting)
		this.terrain.mesh.material.appliesHillShadow = true;
		this.rocks.material.appliesHillShadow = true;

		await progress( 0.23, 'Growing the reef…' );
		this.reef = new Reef( { scene, terrain: this.terrainData, shoreField: this.shoreField } );

		// the player's boat: the lobster boat model stands in until the game loads the save and
		// setBoat() swaps in the owned hull (or hides it: you start on foot)
		this.boat = new BoatModel();
		this.boat.id = 'lobster';
		this.boatId = 'lobster';
		scene.add( this.boat.group );
		this.boat.group.position.copy( WORLD.boatDock.position );
		this.boat.group.rotation.y = WORLD.boatDock.heading;
		// the boat yard: the fleet on display by the boathouse
		this.boatYard = new BoatYard( { scene, terrain: this.terrainData } );
		// Captain Roid sells the boats at the yard (his recorded clicks play through the soundscape's context)
		this.roid = new CaptainRoid( { scene, terrain: this.terrainData, colliders: this.colliders, clicks: new Clicks( { getContext: () => this.audio && this.audio.ctx } ) } );
		// the islanders (roster characters with the island-life gestures, patrols and the clown's prank)
		this.residents = qs.has( 'noResidents' ) ? null : new Residents( { scene, terrain: this.terrainData, colliders: this.colliders, village: this.village } );

		// Pons Cove: the dock, huts and fish market on the second island (the dock does not touch the terrain)
		this.ponsCove = new PonsCove( { scene, terrain: this.terrainData, colliders: this.colliders } );
		this.pons = new PonsPort( { scene, terrain: this.terrainData, colliders: this.colliders } );
		// Gull Rock (lighthouse) and Saltmarsh Key (a fish buyer paying a premium): more islands with ports
		this.ports = new Ports( { scene, terrain: this.terrainData, colliders: this.colliders, village: this.village } );
		this.meridian = this.ports.meridian; // wave 21A: Meridian's handle (plan, building( id ), roadHeight, onStage, signalState)

		// ---------------------------------------------------------------- ocean
		await progress( 0.3, 'Simulating the ocean…' );
		this.fft = new OceanFFT( renderer );
		if ( this.reef.setOcean ) this.reef.setOcean( this.fft ); // coral / sea fan sway follows the simulated swell
		this.foamTexture = createFoamTexture( renderer );
		this.oceanLOD = new CDLOD( { gridSize: Number( qs.get( 'G' ) || 32 ), leafSize: 8, levels: 12, minY: - 25, maxY: 25 } );
		this.surface = new WaterSurface( { fft: this.fft, cdlod: this.oceanLOD, foamTexture: this.foamTexture } );
		this.surface.terrain = this.terrainGPU;
		this.seaDetail = new SeaDetail();
		this.surface.detail = this.seaDetail;
		this.shore = new ShoreWaves( this.terrainGPU );
		this.surface.shore = this.shore;
		this.caustics = qs.has( 'noCaustics' ) ? null : new Caustics( renderer, this.fft );
		if ( this.caustics ) this.caustics.detail = this.seaDetail;

		if ( ! qs.has( 'noSim' ) ) {

			this.shoreSim = new ShoreSim( renderer, { terrainGPU: this.terrainGPU, shore: this.shore } );
			this.surface.shoreSim = this.shoreSim;
			// WGSL: fn terrainWetness( xz: vec2f, h: f32 ) -> vec2f (x = wetness, y = sand foam)
			this.terrain.wetness = {
				modules: [ this.shoreSim.module ],
				code: /* wgsl */`
fn terrainWetness( xz: vec2f, h: f32 ) -> vec2f {
	let s = shoreSimSample( xz );
	let inside = shoreSimInside( shoreSimUvOf( xz ) );
	// outside the simulated region fall back to a static damp band
	let band = smoothstep( 0.45, 0.0, h );
	// foam left on the sand: the lace the water carried, stranded and popping (ShoreSim.sandFoam)
	return vec2f( max( s.y, band * ( 1.0 - inside ) ), shoreSimSandFoam( xz, s, h ) );
}`,
			};
			this.terrain.finalizeMaterial();
			// surf-zone foam look (whitewater, lace) used by the water shader
			this.surfFoam = new SurfFoam( { shoreSim: this.shoreSim } );
			this.surface.foamShading = ( args ) => this.surfFoam.shading( args );

		}

		// how much of the underwater lighting each group needs (sampler budget, see UnderwaterLighting)
		const underwaterMode = ( root, m ) => root && root.traverse( ( o ) => {

			if ( o.material ) for ( const mat of Array.isArray( o.material ) ? o.material : [ o.material ] ) mat.underwaterLighting = m;

		} );
		underwaterMode( this.village.group, 'lite' );
		underwaterMode( this.boat.group, 'lite' );
		if ( this.vegetation ) underwaterMode( this.vegetation.group, 'none' );

		this.underwaterLighting = installUnderwaterLighting( {
			fft: this.fft, caustics: this.caustics, clouds: this.clouds, terrain: this.terrainGPU,
			shore: this.shore, surface: this.surface, shoreSim: this.shoreSim,
		} );

		// sunlight bounced off the ground (one diffuse bounce, re-baked with the terrain sun shadow)
		installGroundBounce( { terrain: this.terrainGPU, clouds: this.clouds } );
		this.sceneRenderer = new SceneRenderer( engine.meshRenderer, scene, camera );
		// the water's refraction source: the scene below the water only, half resolution
		this.refraction = new RefractionPass( { meshRenderer: engine.meshRenderer, scene, camera, sceneRenderer: this.sceneRenderer, scale: 0.5 } );
		this.sceneRenderer.onBeforeWater = () => this.refraction.render( G.seaLevel.value );
		if ( this.sky.background ) this.sceneRenderer.background = this.sky.background;
		// lanterns, lamp posts, path lights, lit windows, the boat's cabin / navigation lights and the
		// flashlight (L): nearest few packed into one small uniform array each frame
		this.localLights = new LocalLights();
		addVillageLights( this.localLights, this.village );
		for ( const l of this.roid.lights || [] ) this.localLights.add( l );
		for ( const l of [ ...this.ponsCove.lights, ...this.pons.lights, ...( this.ports.lights || [] ) ] ) this.localLights.add( l );
		this.boatLights = addBoatLights( this.localLights, this.boat );
		this.boatLightsOn = true;
		// rough, large or heavily overdrawn surfaces (ground, rocks, debris, foliage) take the local
		// lights as Lambert only; the village, pier and boat get the full BRDF (glints on wet wood, metal)
		for ( const root of [ this.terrain.mesh, this.rocks.group, this.debris && this.debris.group, this.vegetation && this.vegetation.group ] ) if ( root ) root.traverse( ( o ) => {

			if ( o.material ) for ( const m of Array.isArray( o.material ) ? o.material : [ o.material ] ) m.localLightsCheap = true;

		} );
		// the sea is not drawn inside the boat (its hull volume masks the surface)
		this.hullMask = this.sceneRenderer.addHullMask( this.boat.createHullVolumeGeometry(), this.boat.group );
		this.waterMaterial = new WaterMaterial( {
			surface: this.surface, sky: this.sky, sceneCopy: this.sceneRenderer.opaqueCopy, sceneDepthHalf: this.sceneRenderer.opaqueDepthHalf.texture, refraction: this.refraction,
			hullMask: this.sceneRenderer.hullMaskRT.texture, hullMaskActive: this.sceneRenderer.hullMaskActive,
		} );
		this.waterMaterial.clouds = this.clouds;
		this.ocean = new Mesh( this.oceanLOD.geometry, this.waterMaterial );
		this.ocean.frustumCulled = false;
		this.ocean.receiveShadow = true;
		this.ocean.layers.set( LAYERS.WATER );
		// Thin alpha-tested meshes (nets, cloth, wire traps) are drawn in the late pass: the screen-space
		// AO and the refraction copy only see the opaque pass, so they neither smear dark AO halos over
		// what is behind them nor receive the noisy AO of their own strands. The boat's window glass is
		// blended: in the late pass it goes over the water seen through it (drawn earlier it would be
		// painted over by the water).
		this.scene.traverse( ( o ) => {

			if ( o.isMesh && ( o.name === 'village_fabric' || o.name === 'village_nets' || o.name === 'boat-trap' || o.name === 'boat-glass' ) ) o.layers.set( LAYERS.TRANSPARENT );

		} );
		// Terrain and water place their vertices in the vertex shader (CDLOD), so three's default motion
		// vectors (previous frame = raw grid position) are garbage there. Both are still in the world or
		// nearly so: camera-only reprojection of the real world position is what the temporal resolve needs.
		// ( the water material writes its own velocity + waterline mask outputs )
		useStaticVelocity( this.terrain.mesh );
		useStaticVelocity( this.rocks.group );
		scene.add( this.ocean );

		this.query = new WaterQuery( renderer, this.surface );

		this.marineSnow = new MarineSnow( { fft: this.fft, query: this.query } );
		scene.add( this.marineSnow.mesh );

		// ---- surf: plunging lips along the beach + spray particles (the breakers emit on the GPU;
		// spray.emit() / emitAlongPoints() for boat bow spray and splashes)
		this.spray = new Spray( renderer, { query: this.query, terrain: this.terrainGPU, sceneCopy: this.sceneRenderer.opaqueCopy, clouds: this.clouds } );
		scene.add( this.spray.mesh );
		if ( this.reef.setSpray ) this.reef.setSpray( this.spray ); // splashes of leaping fish
		this.breakers = new Breakers( renderer, {
			surface: this.surface, shore: this.shore, terrainData: this.terrainData, sky: this.sky,
			spray: this.spray, clouds: this.clouds,
		} );
		scene.add( this.breakers.mesh );
		// dust, pollen, salt aerosol, seed fluff and gnats drifting around the camera
		this.airMotes = new AirMotes( { terrain: this.terrainGPU, clouds: this.clouds, csm: this.csm, reversedDepth: true } );
		scene.add( this.airMotes.mesh );
		this.boatCtl = new BoatController( { model: this.boat, query: this.query, terrain: this.terrainData, colliders: this.colliders } );
		this.boatSpray = new BoatSpray( { boat: this.boatCtl, spray: this.spray } );
		// humpback cruising the deep water around the island (model fetched from public/models/whale)
		// (phones skip the whale: its model and maps against the memory budget)
		this.whale = globalThis.__phoneBudget && globalThis.__phoneBudget.marine === false ? null : new Whale( { scene, terrain: this.terrainData, query: this.query, spray: this.spray } );
		try {

			await this.whale?.load();
			if ( this.whale && this.reef && this.reef.setWhale ) this.reef.setWhale( this.whale ); // escort fish, foam and slick

		} catch ( e ) {

			console.warn( 'whale model failed to load', e );
			this.whale = null;

		}

		// interactive wake around the boat (Kelvin pattern, bow/stern waves, prop wash foam)
		this.wake = new WakeSim( renderer, { terrainGPU: this.terrainGPU, boat: this.boatCtl, colliders: this.colliders } );
		this.surface.wake = this.wake;
		this.player = new Player( { camera, input: this.input, terrain: this.terrainData, colliders: this.colliders, query: this.query, boat: this.boatCtl, reef: this.reef } );
		// the player's character in the world (third person; see player/Avatar.js), the roster id comes from the save
		this.avatar = new Avatar( { scene, character: qs.get( 'char' ) || 'hyptile' } );
		this.avatar.setGroundProbe( playerGroundProbe( this.player ) ); // feet plant on terrain and decks (player/ik)
		// birds, beach crabs, sanderlings (after spray / query / boat, which they use)
		this.wildlife = new Wildlife( {
			scene, renderer, terrain: this.terrainData, terrainGPU: this.terrainGPU, shore: this.shore,
			village: this.village, colliders: this.colliders, vegetation: this.vegetation, boat: this.boatCtl, boatModel: this.boat,
			query: this.query, spray: this.spray, csm: this.csm,
		} );
		this.freeCam = qs.has( 'fly' );

		// ---------------------------------------------------------------- post
		await progress( 0.34, 'Preparing the shaders…' );
		this.underwater = new Underwater( {
			depthTexture: this.sceneRenderer.sceneRT.depthTexture, maskTexture: this.sceneRenderer.waterMaskTexture,
			query: this.query, caustics: this.caustics, fft: this.fft,
		} );
		// the camera's height above the water in the same frame (GPU query): decides the side the surface
		// is seen from where the triangle facing can't be trusted
		this.waterMaterial.cameraWaterHeightNode = this.query.cameraState().x;
		// aerial perspective, marine haze and volumetric sun shafts (post)
		this.haze = qs.has( 'noHaze' ) ? null : new AirHaze( {
			depthTexture: this.sceneRenderer.sceneRT.depthTexture, underwater: this.underwater, atmosphere: this.atmosphere,
			sky: this.sky, clouds: this.clouds, terrain: this.terrainGPU, csm: this.csm,
		} );
		this.post = new PostFX( renderer, { sceneRenderer: this.sceneRenderer, camera, underwater: this.underwater, clouds: this.clouds, sunDir: this.atmosphere.sunDir, haze: this.haze } );
		G.exposure.value = this.settings.exposure;
		if ( qs.has( 'scale' ) ) this.settings.renderScale = Number( qs.get( 'scale' ) ) || 1;
		this.setRenderScale( this.settings.renderScale );

		// ---------------------------------------------------------------- audio
		// recorded field recordings (public/audio, credits in public/audio/CREDITS.md); ?noAudio turns it off
		this.audio = qs.has( 'noAudio' ) ? null : new SoundScape();
		this.player.audio = this.audio;
		// the fishing game (rod, bites, catch, cooler, fish stand, quests, the yard and the crew)
		this.game = new Game( this );
		this.game.state.beforeSave = () => this.captureWorld(); // where you are goes into every save
		// every load is checked first and falls back to the last good backup (SaveVault; docs/SAVE_FORMAT.md)
		attachVault( this.game.state, { onReport: ( r ) => this.game.toast?.( r.source === 'backup' ? 'Save damaged: loaded the last good backup' : 'Save damaged: repaired what could be read', 4200 ) } );
		this.cameraFeel = new CameraFeel( this );
		// the v2 systems (src/features): trade, weather, naval, notices, melee; their data rides in the save
		// the destructible props' physics (Rapier WASM) initialises before the features place them
		try { const { initPhysics } = await import( './physics/World.js' ); await initPhysics(); } catch ( e ) { console.warn( 'physics unavailable', e ); }
		this.features = installFeatures( this );
		// wave 18D: a fish landed with the harpoon gun goes into the cooler like a rod catch
		this.features.on( 'fishHarpooned', ( e ) => { try { const f = this.game.state.addFish( e.species, e.kg, this.game.hour ?? 12, { habitat: 'harpoon', aboard: this.player.mode !== 'walk' && this.player.mode !== 'swim' } ); if ( f ) this.game.toast?.( `Harpooned: ${ e.kg.toFixed( 1 ) } kg`, 2600 ); } catch ( err ) { console.warn( 'harpooned fish', err ); } } );
		// Tidemark's buildings crack / smoke under cannonballs, explosions and plane crashes
		this.ports?.tidemark?.connect( this.features );
		import( './core/Quality.js' ).then( ( q ) => q.farCull( this.scene ) ); // wave 20A: far props skip their draws
		this.game.state.featuresProvider = () => this.features.toJSON();
		this.features.fromJSON( this.game.state.featuresData );
		// the owned boat (or none) and the character from the save
		this.setBoat( this.game.state.boat );
		this.avatar.setCharacter( this.game.state.character );
		// multiplayer: ?server=ws://host:8765/island (or ?mp for the default server on this host)
		this.net = null;
		this.remotePlayers = null;
		// (connected from main.js once the HUD exists: the name tags and the chat live in it)
		this.pendingServer = qs.has( 'server' ) || qs.has( 'mp' ) ? defaultServerUrl() : null;
		// the lanterns at PoorGoat's fish stand and Ethena's chandlery (lit from dusk like the village lamps);
		// positions are in each stall's frame (x right, z toward the customer), turned by its yaw
		for ( const [ s, lx, ly, lz ] of [ [ STAND, - 0.9, 1.85, 0.1 ], [ CHANDLERY, - 0.75, 1.58, - 1.45 ] ] ) {

			const c = Math.cos( s.yaw ), sn = Math.sin( s.yaw );
			const x = s.x + lx * c + lz * sn, z = s.z - lx * sn + lz * c;
			this.localLights.add( { position: new Vector3( x, this.terrainData.heightAt( s.x, s.z ) + ly, z ), color: new Color( 1.0, 0.72, 0.42 ), intensity: 5 * 1.5, range: 11, kind: 'lantern', flicker: 0.08 } );

		}

		this.boatCtl.onSlam = ( s ) => this.audio && this.audio.hullSlap( s );
		engine.domElement.addEventListener( 'click', () => {

			if ( window.__ui && window.__ui.isPointerOverUI ) return;
			this.input.requestLock();
			if ( this.audio ) this.audio.resume();

		} );

		this.profiler = new Profiler( renderer );
		this.profiler.track( 'fft rows', this.fft.rowKernel );
		this.profiler.track( 'fft columns', this.fft.columnKernel );
		this.profiler.track( 'sky view', this.atmosphere.skyViewKernel );

		this.updateSun();
		installDebugViews( this );
		window.__app = this;
		this.gpu = GPU; // console / test access

		// ---- compile pipelines asynchronously (keeps the page responsive), then prime a few
		// frames behind the loading screen so any remaining first-use stalls happen there
		// stage weights: in the browser the pipeline compile below takes far longer than everything before it
		await progress( 0.36, 'Compiling shaders…', 0.95 );
		await this.precompile();
		await progress( 0.96, 'Warming up…' );
		for ( let i = 0; i < 2; i ++ ) {

			this.frame( 1 / 60 );
			await GPU.queue.onSubmittedWorkDone();

		}

	}

	// Build every pipeline up front, then wait for the GPU (keeps first-use compiles behind the loading
	// screen). The precompile frame visits every mesh of every pass, hidden or out of view, and the
	// pipelines compile in parallel in the background (GPU.renderPipeline); the refraction pass and
	// the hull mask are forced on so their variants are built too.
	async precompile() {

		const mr = this.engine.meshRenderer;
		const refr = this.refraction.enabled;
		// compute / post pipelines were requested while the systems were built: let them finish first
		// (the frame below would otherwise compile each one again, synchronously); the post chain
		// builds its passes on first use, so build it now
		if ( ! this.post._built ) {

			this.post._build();
			this.post._outW = 0; // as PostFX.beginFrame: size the new targets

		}

		await GPU.pipelinesReady();
		mr.precompiling = true;
		this.refraction.enabled = true;
		const sr = this.sceneRenderer, hm = sr.hullMaskRT;
		if ( sr.hullMasks.length ) mr.render( sr.hullMaskScene, {
			label: 'hull mask', kind: 'color', camera: this.camera, colorViews: [ hm.texture.view() ], colorFormats: hm.formats,
			clearColors: [ [ 0, 0, 0, 0 ] ], depthView: hm.depthTexture.view(), depthFormat: DEPTH_FORMAT, clearDepth: 0, cull: false,
		} );
		try {

			// both water variants: with the hull-mask discard (a hull on screen) and without
			for ( const hull of [ 0, 1 ] ) {

				this.waterMaterial.hullOverride = hull;
				this.frame( 1 / 60 );

			}

		} catch ( e ) {

			console.warn( 'precompile failed', e );

		}

		this.waterMaterial.hullOverride = null;
		mr.precompiling = false;
		this.refraction.enabled = refr;
		await GPU.pipelinesReady();
		await GPU.queue.onSubmittedWorkDone();

	}

	// ---------------------------------------------------------------- the boat you own

	// Put the boat of the catalog at the dock (or none: hidden, unboardable). The controller keeps
	// its slots; the spray body, the hull mask, the lights, the floodlights and the gulls' perch follow
	// the new hull.
	setBoat( id, { dock = null } = {} ) {

		const scene = this.scene;
		if ( id && ! BOATS[ id ] ) id = null;
		if ( id && id !== this.boatId ) {

			const old = this.boat;
			scene.remove( old.group );
			if ( old.dispose ) old.dispose();
			const model = createBoatModel( id );
			this.boat = model;
			this.boatId = id;
			scene.add( model.group );
			model.group.position.copy( WORLD.boatDock.position ); // (the controller's reset below moves it to this boat's berth)
			model.group.rotation.y = WORLD.boatDock.heading;
			this.boatCtl.setModel( model );
			this.boatCtl.reset();
			const lite = ( root ) => root.traverse( ( o ) => {

				if ( o.material ) for ( const mat of Array.isArray( o.material ) ? o.material : [ o.material ] ) mat.underwaterLighting = 'lite';
				if ( o.isMesh && ( o.name === 'boat-trap' || o.name === 'boat-glass' ) ) o.layers.set( LAYERS.TRANSPARENT );

			} );
			lite( model.group );
			if ( model.ready ) model.ready.then( () => lite( model.group ) ).catch( () => {} );
			// the water is not drawn inside the hull
			if ( this.hullMask ) this.sceneRenderer.removeHullMask( this.hullMask );
			this.hullMask = this.sceneRenderer.addHullMask( model.createHullVolumeGeometry(), model.group );
			// bow spray contacts and the spray collision body
			this.boatSpray = new BoatSpray( { boat: this.boatCtl, spray: this.spray } );
			// the wake was baked for the lobster hull: scale it with the boat
			if ( this.wake ) this.wake.amplitude.value = ( this._wakeBase ?? ( this._wakeBase = this.wake.amplitude.value ) ) * Math.min( 1, this.boatCtl.sizeK * 1.2 );
			// lights: nav lights and the cabin dome on the lobster boat only
			for ( const l of this.boatLights || [] ) this.localLights.remove( l );
			this.boatLights = addBoatLights( this.localLights, model ); // every hull: nav lights, a stern lantern and work lights
			if ( this.game ) this.game.onBoatChanged( model, id );
			if ( this.wildlife && this.wildlife.birds ) this.wildlife.birds.boatModel = model;

		}

		this.boat.group.visible = !! id;
		this.boatCtl.enabled = !! id;
		this.player.setBoat( id ? this.boatCtl : null );
		this.setBoatLights( this.boatLightsOn );
		// wave 14C: bought or recovered at a harbour agent: moored at that port's dock
		if ( id && dock && dock.position ) this._placeBoat( { x: dock.position.x, z: dock.position.z, heading: dock.heading, moored: true } );

	}

	// the boat's lights (user option, L at the helm / on deck, a touch button): the lantern / nav glow on every hull and
	// the lobster boat's local lights; off = dark even at night (the local lights otherwise fade in with the night)
	setBoatLights( on ) {

		this.boatLightsOn = on = on !== false;
		if ( this.boat && this.boat.setNavLights ) this.boat.setNavLights( on );
		for ( const l of this.boatLights || [] ) l.enabled = on;

	}

	toggleBoatLights() {

		this.setBoatLights( ! this.boatLightsOn );
		if ( this.ui && this.ui.ui ) this.ui.ui.toast( this.boatLightsOn ? 'Boat lights on' : 'Boat lights off' );
		return this.boatLightsOn;

	}

	// ---------------------------------------------------------------- game mode, sessions and saves

	// Sets the game mode (game/GameMode.js): the rules, the island clock and what the settings panel lets you change.
	// The save's own mode follows (GameState.setMode); startSession() loads the slot of that mode.
	setMode( mode ) {

		if ( ! isMode( mode ) ) mode = DEFAULT_MODE;
		const r = modeRules( mode );
		this.mode = mode;
		this.rules = r;
		if ( this.game ) this.game.state.setMode( mode );
		if ( ! r.timeControl ) {

			// the day runs on its own (a server's clock replaces this one)
			this.settings.timeSpeed = DAY_SPEED;
			this._timeSpeed = DAY_SPEED;

		}

		if ( ! r.worldControls ) this.settings.sunAzimuth = 0;
		if ( ! r.freeCam && this.freeCam ) this.setFreeCam( false );
		if ( ! r.online && this.net ) this.disconnect();
		if ( this.ui && this.ui.applyMode ) this.ui.applyMode( r );

	}

	// The pause / main menu is up: the game takes no input and, in the single-player modes, its logic holds
	// still (fish, fuel, play time, the clock). Multiplayer keeps running.
	setMenuOpen( open ) {

		this.menuOpen = !! open;
		this.paused = this.menuOpen && ! isOnlineSession( this );
		this.input.enabled = ! this.menuOpen;
		if ( this.menuOpen ) this.input.keys.clear();

	}

	// "Free camera: sandbox only"
	lockedToast( what ) {

		if ( this.ui && this.ui.ui ) this.ui.ui.toast( `${ what }: ${ SANDBOX_ONLY.toLowerCase() }`, 1800 );

	}

	// Starts (or restarts) play. choice = { mode, slot, name, server, newGame } from the main menu, or null to play the
	// slot that is already loaded (opts.mode: in that mode's slot 0). Sets the mode, loads the slot, then puts the boat,
	// the character, the quests and the player where the save left them, connects (multiplayer) and starts the autosave.
	// opts.restore false: start at the default spot; opts.session false: no world snapshots, no autosave (automation).
	startSession( choice = null, { mode = null, restore = true, session = true } = {} ) {

		const game = this.game, st = game.state;
		this.session = false;
		clearInterval( this._autosaveTimer );
		if ( this._played ) this.resetSession();
		const prev = st.mode;
		mode = choice && isMode( choice.mode ) ? choice.mode : isMode( mode ) ? mode : this.mode;
		this.setMode( mode );
		if ( choice ) {

			// a universe session (server-side save) ends when another mode or slot is chosen outside the menu
			if ( ! choice.universe && this.universe && typeof this.universe.detach === 'function' ) this.universe.detach();

			// wave 16D: the features still hold the previous game until they are reloaded below: do not write them into this slot
			const provider = st.featuresProvider;
			st.featuresProvider = null;
			try {

				st.useSlot( choice.slot | 0, mode );
				if ( choice.newGame ) st.reset();
				if ( typeof choice.name === 'string' ) st.name = choice.name.trim().slice( 0, 24 ); // (no name given: the slot's own stays)
				if ( typeof choice.server === 'string' && choice.server.trim() ) this.serverOverride = choice.server.trim();
				st.save(); // (no world snapshot yet: the stored one is read below)

			} finally { st.featuresProvider = provider; }

		} else if ( prev !== mode ) st.useSlot( st.slot, mode );

		game.contracts.init(); // the board of the loaded slot
		this.setBoat( st.boat );
		this.avatar.setCharacter( st.character );
		this.applyWorld( restore ? st.world : null );
		if ( this.features ) {

			// the loaded slot's features (a new game: fresh markets, boards, hulls)
			this.features.reset();
			this.features.fromJSON( st.featuresData );

		}
		if ( mode === 'multiplayer' ) this.connect( ( choice && typeof choice.server === 'string' && choice.server.trim() ) || this.serverUrl() );
		else if ( this.net ) this.disconnect();
		this._played = true;
		this.session = !! session;
		// the opening glide and title card (src/world/start Intro): campaign only, once per slot, replayed by a New game
		if ( this.features && this.session ) this.features.get( 'start' )?.playIntro?.( { mode, slot: st.slot, fresh: !! ( choice && choice.newGame ) } );
		if ( this.session ) this._startAutosave();
		if ( game.hud ) game.hud.refresh();
		return true;

	}

	// what the last session was doing is let go: the line, the panels, the card
	resetSession() {

		const g = this.game, hud = g.hud;
		g.endLanding();
		g.cancelLine( true );
		g.rod.equip( false );
		if ( hud ) {

			hud.toggleInventory( false );
			hud.closeStand();
			if ( hud.toggleRoster ) hud.toggleRoster( false );
			if ( hud.catchOpen ) hud.hideCatch();

		}

	}

	// Pause menu > Load: the slot list of the main menu for this mode. The game is saved first; a chosen slot loads in place.
	async openLoadMenu() {

		if ( isOnlineSession( this ) ) { this.game?.toast?.( 'Leave multiplayer before loading a local save.', 2400 ); return false; }
		if ( ! this.menu || this._loadOpen ) return;
		this._loadOpen = true;
		this.saveNow();
		this.session = false;
		this.setMenuOpen( true );
		let choice = null;
		try {

			choice = await this.menu.show( { mode: this.mode, step: 'slots', back: true } );

		} catch ( e ) {

			console.error( e );

		}

		if ( choice ) this.startSession( choice );
		else this.session = true;
		this.setMenuOpen( false );
		this._loadOpen = false;
		if ( choice ) this.input.requestLock();

	}

	// Writes the current slot now (with where you are); true when the browser took it. auto: the timer / page-hide
	// saves, which only run for a session in a mode that autosaves.
	saveNow( auto = false ) {

		if ( ! this.game ) return false;
		// Universe profiles use their server storage adapter. Crew rooms must not
		// overwrite a local slot with a shared world's live state.
		if ( isOnlineSession( this ) && ! this.game.state.storage?.universe ) return false;
		if ( auto && ( ! this.session || ! this.rules.autosave ) ) return false;
		return this.game.state.save();

	}

	_startAutosave() {

		clearInterval( this._autosaveTimer );
		if ( this.rules.autosave ) this._autosaveTimer = setInterval( () => this.saveNow( true ), AUTOSAVE_MS );
		if ( this._pageBound ) return;
		this._pageBound = true;
		document.addEventListener( 'visibilitychange', () => { if ( document.visibilityState === 'hidden' ) this.saveNow( true ); } );
		window.addEventListener( 'pagehide', () => this.saveNow( true ) );

	}

	// where you are, for the save (GameState.world): the player, the boat and the clock. Only while a session runs.
	captureWorld() {

		if ( ! this.session || ! this.player ) return null;
		const p = this.player, b = this.boatCtl, r = ( v, k = 100 ) => Math.round( v * k ) / k;
		const w = { player: { x: r( p.position.x ), y: r( p.position.y ), z: r( p.position.z ), yaw: r( p.yaw, 1000 ), mode: p.mode }, boat: null, timeOfDay: null };
		if ( this.game.state.boat && b && b.enabled !== false ) w.boat = { x: r( b.position.x ), z: r( b.position.z ), heading: r( b.getYaw(), 1000 ), moored: !! b.moored };
		if ( this.rules.saveTime ) w.timeOfDay = r( this.settings.timeOfDay, 1000 );
		return w;

	}

	// Puts the player, the boat and the clock back where the save left them. world: GameState.world (see parseWorld), or null
	// for a new game: on foot at the start, the boat at its berth. Walking and swimming come back on foot (the walker
	// starts swimming by itself if it is deep); aboard comes back on the deck of the boat.
	applyWorld( world ) {

		const st = this.game.state, p = this.player, b = this.boatCtl;
		const start = WORLD.start || WORLD.spawn;
		b.reset();
		b.driven = false;
		const sy = Math.max( this.terrainData.heightAt( start.position.x, start.position.z ), this.colliders.groundHeightAt( start.position.x, start.position.z, 50 ) );
		this._placePlayer( start.position.x, sy, start.position.z, start.yaw );
		if ( ! world ) return false;
		const hasBoat = !! st.boat && b.enabled !== false;
		if ( world.boat && hasBoat ) this._placeBoat( world.boat );
		const pw = world.player;
		if ( pw ) {

			this._placePlayer( pw.x, pw.y, pw.z, pw.yaw );
			if ( hasBoat && ( pw.mode === 'deck' || pw.mode === 'boat' || pw.mode === 'seat' ) ) p.boardBoat();

		}

		if ( this.rules.saveTime && Number.isFinite( world.timeOfDay ) ) this.settings.timeOfDay = world.timeOfDay;
		return true;

	}

	_placeBoat( bw ) {

		const b = this.boatCtl;
		b.position.set( bw.x, 0, bw.z ); // (it settles on the water within a second)
		b.quaternion.setFromAxisAngle( _up, bw.heading );
		b.velocity.set( 0, 0, 0 );
		b.angular.set( 0, 0, 0 );
		b.throttle = 0;
		b.steer = 0;
		b.rpm = 0;
		b.driven = false;
		b.moored = !! bw.moored;
		b.mooring.anchor.set( bw.x, 0, bw.z );
		b.mooring.heading = bw.heading;
		b.hasWater = false; // read the water under the hull again, no velocity from the jump
		b.apply();

	}

	_placePlayer( x, y, z, yaw ) {

		const p = this.player;
		if ( p.mode === 'boat' && this.audio && this.audio.engineStop ) this.audio.engineStop();
		p.mode = 'walk';
		p.position.set( x, y, z );
		p.position.y = Math.max( y, p.groundAt( x, z, y + 1 ) );
		p.velocity.set( 0, 0, 0 );
		p.yaw = yaw;
		p.pitch = - 0.05;
		p.grounded = false;
		p.launched = 0;
		p.action = null;
		p.busy = false;
		p.stamina = 1;
		p.waterMean = null;
		p.floating = true;
		p.camOff = 0;
		p.camOffV = 0;
		p._camY = null;
		p.armInit = false;
		p.camInit = false;

	}

	// ---------------------------------------------------------------- multiplayer

	serverUrl() {

		return this.serverOverride || this.pendingServer || defaultServerUrl();

	}

	connect( url ) {

		if ( ! url || ! String( url ).trim() ) {
			this.game?.toast?.( 'Set an Alpha Astra server address in Online settings before connecting.', 4000 );
			return false;
		}

		// Settings can connect from solo play too. Load the separate multiplayer
		// profile through the normal session path before creating a connection.
		if ( this.mode !== 'multiplayer' ) {

			if ( this.session ) this.saveNow();
			return this.startSession( { mode: 'multiplayer', slot: 0, server: url } );

		}

		if ( this.net ) this.net.disconnect();
		const st = this.game.state;
		const hud = this.ui ? ( this.ui.ui.hud || this.ui.ui.root ) : null;
		if ( ! this.remotePlayers ) this.remotePlayers = new RemotePlayers( { scene: this.scene, camera: this.camera, hud, terrain: this.terrainData, colliders: this.colliders } );
		if ( ! this.chat && hud ) this.chat = new ChatInput( { hud, input: this.input } );
		const toast = ( t, ms ) => this.game.toast( t, ms );
		this.net = new NetClient( {
			url, name: st.name || this.qs.get( 'name' ) || '', character: st.character, boat: st.boat,
			onPeerJoin: ( peer ) => {

				this.remotePlayers.addPeer( peer );
				toast( `${ peer.name || 'Someone' } came ashore`, 2200 );

			},
			onPeerLeave: ( id ) => this.remotePlayers.removePeer( id ),
			onStates: ( list, at ) => { this.remotePlayers.applyStates( list, at ); this.features?.get( 'seaplane' )?.updateRemote?.( list ); this.features?.get( 'helicopter' )?.updateRemote?.( list ); },
			onChat: ( msg ) => this.remotePlayers.pushChat( msg ),
			onClock: ( c ) => {

				// the island shares one clock: the server's day (the sandbox keeps its own, which the player sets)
				if ( this.rules.timeControl && ! this.rules.serverClock ) return;
				this.settings.timeOfDay = clockTimeOfDay( c );
				this.settings.timeSpeed = c.timeSpeed;

			},
			onStatus: ( status, detail ) => {

				if ( status === 'online' ) toast( 'Online · ' + url, 2600 );
				else if ( status === 'error' ) toast( 'Multiplayer: ' + ( detail || 'connection failed' ), 3200 );

			},
		} );
		this.net.connect();
		this.netUrl = url;

	}

	disconnect() {

		if ( this.net ) this.net.disconnect();
		this.net = null;
		if ( this.remotePlayers ) this.remotePlayers.dispose();
		this.remotePlayers = null;

	}

	// the local state sent to the others (see net/Protocol.js)
	netState() {

		const p = this.player, b = this.boatCtl, st = this.game.state;
		const pose = p.pose( this._netPose || ( this._netPose = {} ) );
		const out = {
			p: [ pose.position.x, pose.position.y, pose.position.z ], yaw: p.mode === 'aboard' ? p.yaw : pose.yaw, mode: p.mode === 'aboard' ? 'walk' : p.mode, speed: pose.speed, vy: pose.vy,
			grounded: !! pose.grounded, diving: !! pose.diving, action: p.action || null, character: st.character,
			boat: st.boat ? { id: st.boat, p: [ b.position.x, b.position.y, b.position.z ], q: [ b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w ], throttle: b.throttle, steer: b.steer, rpm: b.rpm * 2400, driven: b.driven } : null,
		};
		this.features?.get( 'seaplane' )?.decorateState?.( out ); // out.plane while flying
		this.features?.get( 'helicopter' )?.decorateState?.( out );
		return this.netsync && this.netsync.decorateState ? this.netsync.decorateState( out ) : out;

	}

	// ---------------------------------------------------------------- sun / sky

	updateSun() {

		const s = this.settings;
		const dir = sunDirectionFromTime( s.timeOfDay ).applyAxisAngle( _up, MathUtils.degToRad( s.sunAzimuth || 0 ) );
		// the sky is always scattered sunlight, even with the sun below the horizon (twilight)
		this.atmosphere.sunDir.value.copy( dir );
		// below the horizon the moon takes over as the key light
		const night = MathUtils.smoothstep( - dir.y, 0.02, 0.18 );
		G.night.value = night;
		this.sky.starIntensity.value = night;
		const moon = new Vector3( - dir.x, Math.abs( dir.y ) * 0.8 + 0.25, - dir.z ).normalize();
		this.sky.moonDir.value.copy( moon );

		// key light: the sun until it is well below the horizon (it gives no direct light in
		// twilight anyway), then the moon
		const light = dir.y > - 0.07 ? dir : moon;
		G.sunDir.value.copy( light );

	}

	applyAtmosphereReadback() {

		const a = this.atmosphere;
		if ( ! a.sunTransmittance ) return;
		const sunTrue = a.sunDir.value;
		const sunUp = sunTrue.y > - 0.07; // same switch as updateSun()
		const T = a.sunTransmittance;
		const horizonFade = MathUtils.smoothstep( sunTrue.y, - 0.03, 0.02 );
		let c;
		if ( sunUp ) c = new Color( T[ 0 ], T[ 1 ], T[ 2 ] ).multiplyScalar( SUN_ILLUMINANCE * horizonFade );
		else c = new Color( 0.6, 0.7, 1.0 ).multiplyScalar( 0.12 * G.night.value );
		G.sunColor.value.copy( c );
		const irr = a.skyIrradiance;
		const nightAmb = 0.012 * G.night.value;
		G.skyIrradiance.value.setRGB( irr[ 0 ] + nightAmb * 0.6, irr[ 1 ] + nightAmb * 0.7, irr[ 2 ] + nightAmb );
		G.horizonColor.value.setRGB( a.horizon[ 0 ], a.horizon[ 1 ], a.horizon[ 2 ] );

	}

	// T: let the day run or stop it (sandbox only: the other modes keep the island's clock)
	toggleTime() {

		if ( ! this.rules.timeControl || isOnlineSession( this ) ) {

			this.lockedToast( 'Pausing time' );
			return;

		}

		const s = this.settings;
		if ( s.timeSpeed !== 0 ) {

			this._timeSpeed = s.timeSpeed;
			s.timeSpeed = 0;

		} else {

			s.timeSpeed = this._timeSpeed || DAY_SPEED;

		}

		if ( this.ui ) {

			this.ui.s.advance = s.timeSpeed !== 0;
			this.ui.ui.refresh();
			this.ui.ui.toast( s.timeSpeed !== 0 ? 'Time running' : 'Time paused' );

		}

	}

	// Free (debug) camera on F (sandbox only); the walker / boat resumes where it was left.
	setFreeCam( on ) {

		if ( on === this.freeCam ) return;
		if ( on && ( ! this.rules.freeCam || isOnlineSession( this ) ) ) {

			this.lockedToast( 'Free camera' );
			return;

		}

		this.freeCam = on;
		if ( on ) {

			const e = new Euler().setFromQuaternion( this.camera.quaternion, 'YXZ' );
			this.fly.setPose( this.camera.position.clone(), e.y, e.x );
			this.fly.velocity.set( 0, 0, 0 );

		} else if ( this.player.mode !== 'boat' && this.player.mode !== 'deck' ) {

			this.dropPlayerAtCamera();

		}

	}

	// Leaving the free camera: the player continues from where the camera is, facing the same way,
	// and falls from there (swimming at once if the camera is under water).
	dropPlayerAtCamera() {

		const p = this.player, c = this.camera.position;
		const e = new Euler().setFromQuaternion( this.camera.quaternion, 'YXZ' );
		p.yaw = e.y;
		p.pitch = MathUtils.clamp( e.x, - 1.5, 1.5 );
		p.velocity.set( 0, 0, 0 );
		const ground = Math.max( this.terrainData.heightAt( c.x, c.z ), this.colliders.groundHeightAt( c.x, c.z, c.y ) );
		const water = this.cameraWaterHeight ?? 0;
		if ( c.y < water ) {

			p.mode = 'swim';
			p.position.set( c.x, Math.max( c.y - 0.16, ground + 0.3 ), c.z );

		} else {

			// drop from where the camera is: gravity brings you down onto the ground or a deck, or into
			// the sea (the walker starts swimming once it is out of its depth)
			p.mode = 'walk';
			p.position.set( c.x, Math.max( c.y - 1.62, ground ), c.z );
			p.grounded = false;

		}

		p.waterH = water;
		p.waterMean = water;

	}

	// ---------------------------------------------------------------- loop

	start() {

		this.engine.start( ( dt, t ) => this.frame( dt, t ) );

	}

	updateFPS( dt ) {

		const f = this._fps || ( this._fps = { el: document.getElementById( 'fps' ), acc: 0, n: 0, worst: 0 } );
		f.acc += dt;
		f.n ++;
		f.worst = Math.max( f.worst, dt );
		if ( f.acc >= 0.5 ) {

			const fps = f.n / f.acc;
			let text = `${ fps.toFixed( 0 ) } fps · ${ ( 1000 * f.acc / f.n ).toFixed( 1 ) } ms · max ${ ( f.worst * 1000 ).toFixed( 1 ) } ms`;
			if ( this.profiler && this.profiler.enabled ) {

				const p = this.profiler.result;
				text += ` · GPU c ${ p.compute.toFixed( 2 ) } r ${ p.render.toFixed( 2 ) }`;

			}

			if ( f.el ) f.el.textContent = text;
			this.fps = fps;
			f.acc = 0;
			f.n = 0;
			f.worst = 0;

		}

	}

	frame( dt ) {

		const t0 = performance.now();
		this._frame( dt );
		const ms = performance.now() - t0;
		this.cpuMs = this.cpuMs === undefined ? ms : this.cpuMs * 0.95 + ms * 0.05;

	}

	_frame( dt ) {

		GPU.beginFrame();
		FrameUniforms.fields.frameIndex.value = GPU.frame;
		const s = this.settings;
		this.updateFPS( dt );
		G.dt.value = dt;
		G.time.value += dt;
		if ( s.timeSpeed !== 0 && ! this.paused ) s.timeOfDay = ( s.timeOfDay + dt * s.timeSpeed + 24 ) % 24;

		// ---- player / boat (boat physics first so the cameras follow this frame's pose)
		this.gamepad.update();
		if ( this.input.hit( 'KeyF' ) && ! this.features?.get( 'rescue' )?.wantsKey?.( 'KeyF' ) ) this.setFreeCam( ! this.freeCam ); // (F fires a flare when one makes sense)
		if ( this.input.hit( 'KeyT' ) ) this.toggleTime();
		if ( this.input.hit( 'KeyL' ) ) {

			// at the helm L works the boat's lights (a touch button too); on foot and on deck it is the flashlight
			if ( this.player && this.player.mode === 'boat' ) this.toggleBoatLights();
			else if ( this.features?.get?.( 'cars' )?.driving ) {

				const on = this.features.get( 'cars' ).toggleLights();
				if ( this.ui ) this.ui.ui.toast( on === null ? 'Headlights: automatic' : on ? 'Headlights on' : 'Headlights off' );

			}
			else {

				const on = this.localLights.toggleFlashlight();
				if ( this.ui ) this.ui.ui.toast( on ? 'Flashlight on' : 'Flashlight off' );

			}

		}

		// Shift+M mutes (M alone opens the world map: src/features/worldmap)
		if ( this.input.hit( 'KeyM' ) && this.audio && ( this.input.down( 'ShiftLeft' ) || this.input.down( 'ShiftRight' ) ) ) {

			this.audio.setMuted( ! this.audio.muted );
			if ( this.ui ) this.ui.ui.toast( this.audio.muted ? 'Sound off' : 'Sound on' );

		}
		if ( this.boatCtl.enabled !== false ) {

			this.boatCtl.update( dt );
			this.boatSpray.update( dt );

		}

		this.wake.update( dt );
		// a guest riding another player's boat (multiplayer): the player sits on the host boat's seat
		const ride = this.netsync && this.netsync.riding ? this.netsync.ridePose() : null;
		if ( ride && ride.valid !== false ) this.player.ride = ride;
		else if ( this.player.mode === 'ride' ) { this.player.ride = null; this.player.mode = 'walk'; }
		else this.player.ride = null;
		if ( this.freeCam ) this.fly.update( dt );
		else this.player.update( dt );
		this.player.reduceMotion = !! this.settings.reduceMotion;
		if ( this.cameraFeel ) this.cameraFeel.update( dt );
		if ( ! this.paused ) this.game.update( dt ); // (the menu is up in single player: the fish, the fuel and the play time wait)
		if ( ! this.paused && this.features ) this.features.update( dt );
		// the character: shown in third person (and from the free camera), hidden behind the first-person eye
		const p = this.player;
		this.avatar.visible = this.freeCam || ( ! this.features?.get?.( 'cars' )?.hidesDriver?.() && ( p.mode === 'boat' ? p.camMode === 'third' : p.view === 'third' ) );
		const pose = p.pose( this._pose || ( this._pose = {} ) );
		// hands on the helm / rod, feet on the ground: contact IK targets for this frame
		this.avatar.setIKTargets( contactTargets( this._ikTargets || ( this._ikTargets = {} ), { player: p, rod: this.game && this.game.rod, boat: this.boatCtl, action: pose.action } ) );
		this.avatar.update( dt * ( this.features && this.features.get && this.features.get( 'melee' ) && this.features.get( 'melee' ).timeScale != null ? this.features.get( 'melee' ).timeScale : 1 ), pose ); // (hitstop and the parry's slow-motion reach the player's own avatar)
		if ( this.remotePlayers ) this.remotePlayers.update( dt );
		if ( this.net ) this.net.send( this.netState() );
		this.boatYard.update( dt, this.camera );
		this.updateSun();

		this.atmosphere.update( dt, this.camera.position.y );
		this.applyAtmosphereReadback();

		// ---- water simulation
		this.fft.update( dt );
		this.seaDetail.update( dt );
		this.query.setCamera( this.camera.position.x, this.camera.position.z );
		this.boatCtl.queueQueries();
		this.query.update();
		if ( this.query.cpuValid ) {

			const h0 = this.query.cpu[ 0 ];
			const h = Number.isFinite( h0 ) ? h0 : ( this.cameraWaterHeight ?? 0 );
			G.cameraUnderwater.value = this.camera.position.y < h - LENS_REACH ? 1 : 0;
			G.cameraWaterHeight.value = h;
			this.cameraWaterHeight = h;

		}

		if ( this.caustics ) this.caustics.update();
		// drawn while any part of the view can be under water (the specks above the surface are dropped)
		this.marineSnow.update( this.camera, this.camera.position.y < ( this.cameraWaterHeight ?? 0 ) + LENS_REACH );
		this.airMotes.update( dt, this.camera, this.cameraWaterHeight ?? 0 );
		if ( this.shoreSim ) this.shoreSim.update();
		this.underwaterLighting.update( this.camera );
		this.breakers.update( this.camera );
		this.spray.update();
		if ( this.clouds ) this.clouds.update( dt, this.camera );
		this.environment.update( dt );

		// ---- world
		this.oceanLOD.update( this.camera );
		this.terrain.update( this.camera );
		this.rocks.update( this.camera );
		this.debris.update( this.camera );
		this.reef.update( dt, this.camera.position );
		this.village.update( dt );
		if ( this.residents ) this.residents.update( dt, this.freeCam ? this.camera.position : this.player );
		if ( this.vegetation ) this.vegetation.update( dt, this.camera );
		if ( this.whale ) this.whale?.update( dt, this.camera );
		this.boat.update( dt );
		this.wildlife.update( dt, this.camera, this.freeCam ? null : this.player );
		this.localLights.update( this.camera, dt );

		// ---- render
		G.exposure.value = s.exposure;
		updateCameraVelocity( this.camera );
		this.post.lens.update( dt, this.camera.position.y < ( this.cameraWaterHeight ?? 0 ) );
		if ( this.post.flare ) {

			this.post.flare.setDepthHeight( this.sceneRenderer.sceneRT.height );
			this.post.flare.update( this.camera, dt, { aboveWater: this.camera.position.y > ( this.cameraWaterHeight ?? 0 ) - 0.02 } );

		}

		// the post chain sets the TAAU jitter + internal size and writes the camera into the frame
		// uniforms (setFrameCamera); shadows then render with this frame's sun and camera
		this.post.beginFrame();
		this.underwater.updateCamera( this.camera );
		this.shadows.render( this.scene, this.engine.meshRenderer, this.shadows.update( this.camera, G.sunDir.value ) );
		this.sceneRenderer.render();
		if ( this.post.flare ) this.post.flare.kernel.dispatch( 1 );
		this.post.render();
		this.post.endFrame();
		GPU.submit();
		this.profiler.update( dt );

		this.updateAudio( dt );
		if ( this.ui ) this.ui.update( dt );
		this.input.endFrame();

	}

	// Internal render resolution relative to the output (0.5..1), set by hand: changing it re-creates
	// the scene / post / cloud targets, so nothing adjusts it automatically.
	setRenderScale( v ) {

		const scale = MathUtils.clamp( Math.round( v * 20 ) / 20, 0.5, 1 );
		this.settings.renderScale = scale;
		this.post.setScale( scale );
		// the cloud history keeps the canvas' own resolution: following the render scale made Low's clouds a blocky,
		// smeared lattice (the march is 1 of 16 history pixels a frame: full size costs little)
		if ( this.clouds ) this.clouds.resolutionScale = 1;

	}

	updateAudio( dt ) {

		if ( ! this.audio || ! this.audio.enabled ) return;
		const cam = this.camera;
		const p = cam.position;
		const f = this._af || ( this._af = { fwd: new Vector3(), up: new Vector3() } );
		cam.getWorldDirection( f.fwd );
		f.up.set( 0, 1, 0 ).applyQuaternion( cam.quaternion );
		const h = this.cameraWaterHeight ?? 0;
		const coast = this.terrainData.coastDistance( p.x, p.z ).d;
		this.audio.update( dt, {
			listener: { position: p, forward: f.fwd, up: f.up },
			underwater: p.y < h ? 1 : 0,
			depthBelowSurface: Math.max( 0, h - p.y ),
			surfIntensity: Math.min( 1, this.shore.amplitude.value / 0.6 ),
			distanceToShore: Math.abs( coast ),
			coastDistance: coast,
			waveHeight: this.shore.amplitude.value * 2,
			windSpeed: G.windSpeed.value,
			windDir: G.windDir.value,
			daylight: 1 - G.night.value,
			nearPier: Math.abs( p.x - WORLD.pier.x ) < 12 && p.z > WORLD.pier.zStart - 5 && p.z < WORLD.pier.zEnd + 8,
			boat: {
				active: this.boatCtl.driven && this.boatCtl.enabled !== false, rpm: this.boatCtl.rpm, throttle: this.boatCtl.throttle, speed: this.boatCtl.velocity.length(),
				position: this.boat.group.position, listenerInside: this.player.mode === 'boat' && this.player.camMode === 'first',
			},
		} );

	}

}

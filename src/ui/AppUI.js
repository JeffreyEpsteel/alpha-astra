import * as THREE from '../engine/index.js';
import { openCrewPanel } from '../features/netsync/index.js';
import { UI } from './UI.js';
import { G } from '../core/Globals.js';
import { GroundBounce } from '../materials/GroundBounce.js';
import { SANDBOX_ONLY, modeLabel } from '../game/GameMode.js';
import { t, tx, observeDom } from '../i18n/index.js';
import { Accessibility } from './Accessibility.js';
import { Quality, TIERS } from '../core/Quality.js';
import { TouchControls } from './TouchControls.js';

// Binds the Tidewater UI (panel + HUD) to the running app.
const SEA = {
	Calm: { wind: 3.5, fetch: 40, chop: 0.75, swell: 0.28, surf: 0.18, period: 11, whitecaps: 0.2 },
	Breezy: { wind: 7, fetch: 120, chop: 0.9, swell: 0.48, surf: 0.34, period: 9, whitecaps: 0.5 },
	Choppy: { wind: 12, fetch: 300, chop: 1.05, swell: 0.68, surf: 0.56, period: 8.5, whitecaps: 0.75 },
	Storm: { wind: 20, fetch: 900, chop: 1.2, swell: 1.0, surf: 0.9, period: 12, whitecaps: 1 },
};

// weather: a sea state plus the hour, clouds, cirrus and haze (Sky tab)
const WEATHER = {
	'Calm morning': { sea: 'Calm', icon: 'sun', time: 7.5, clouds: 0.25, cirrus: 0.4, haze: 0.8, tooltip: 'First light, glassy water, a few fair-weather clouds.' },
	'Trade wind': { sea: 'Breezy', icon: 'wind', time: 11, clouds: 0.45, cirrus: 0.5, haze: 1, tooltip: 'The usual day: a steady breeze, broken cloud.' },
	'Squall': { sea: 'Storm', icon: 'storm', time: 15, clouds: 0.95, cirrus: 0.2, haze: 2.2, tooltip: 'A dark afternoon squall: big seas, low cloud, thick haze.' },
	'Golden hour': { sea: 'Breezy', icon: 'sunset', time: 17.8, clouds: 0.4, cirrus: 0.7, haze: 1.4, tooltip: 'Low sun, long light, high cirrus.' },
	'Moonlit night': { sea: 'Calm', icon: 'moon', time: 23, clouds: 0.15, cirrus: 0.3, haze: 0.6, tooltip: 'A clear night under the moon.' },
};

// graphics quality presets: the tiers of core/Quality.js (render scale, shadows, post, budgets, draw distances)
const QUALITY = {
	Low: { tier: 'low', icon: 'bolt', tooltip: 'Half to 70% resolution, small shadow map reaching 150 m, no AO, sun shafts, motion blur or water reflections, fewer particles and lamps, shorter draw distances.' },
	Medium: { tier: 'medium', icon: 'gauge', tooltip: '60-85% resolution, 1024 shadow map reaching 250 m, fewer particles, six lamps, 75% draw distances.' },
	High: { tier: 'high', icon: 'layers', tooltip: 'The full look: 70-100% resolution, 2048 shadow map to 400 m, every effect.' },
	Ultra: { tier: 'ultra', icon: 'sparkles', tooltip: 'Full resolution, 8 TAA phases, longer draw distances and resident radii.' },
};

export class AppUI {

	constructor( app, ui = new UI() ) {

		this.app = app;
		this.ui = ui;
		const fft = app.fft;
		const shore = app.shore;
		// accessibility options, key bindings and captions (ui/Accessibility.js); its saved choices apply here, before the panel is built
		const a11y = this.a11y = app.accessibility = new Accessibility( { app, ui } );

		// ---- plain values the controls bind to; onChange pushes them into the simulation
		const s = this.s = {
			wind: fft.local.windSpeed,
			windDir: fft.local.windDirection,
			fetch: fft.local.fetch,
			chop: fft.choppiness.value,
			swell: fft.swell.scale,
			whitecaps: 0.5,
			clarity: 1,
			surf: shore.amplitude.value,
			period: shore.period.value,
			gamma: shore.gamma.value,
			curl: shore.curl.value,
			caustics: app.caustics ? app.caustics.strength.value : 1,
			time: app.settings.timeOfDay,
			advance: app.settings.timeSpeed !== 0,
			timeSpeed: app.settings.timeSpeed || 0.05,
			clouds: app.clouds ? app.clouds.coverage.value : 0.45,
			cirrus: app.clouds && app.clouds.cirrus ? app.clouds.cirrus.value : 0.5,
			exposure: 0,
			fov: app.camera.fov,
			camMode: 'third',
			ao: app.post.params.aoStrength.value,
			bloom: app.post.params.bloom.value,
			flare: app.post.flare ? app.post.flare.strength.value : 1,
			vignette: app.post.params.vignette.value,
			saturation: app.post.params.saturation.value,
			contrast: app.post.params.contrast.value,
			grain: app.post.params.grain.value,
			renderScale: app.settings.renderScale,
			shadows: true,
		};

		const spectrum = () => {

			fft.local.windSpeed = s.wind;
			fft.local.windDirection = s.windDir;
			fft.local.fetch = s.fetch;
			fft.swell.scale = s.swell;
			fft.updateSpectrumUniforms();
			const a = THREE.MathUtils.degToRad( s.windDir );
			G.windDir.value.set( Math.cos( a ), Math.sin( a ) );
			G.windSpeed.value = s.wind;

		};

		const whitecaps = () => {

			// more whitecaps: foam starts at less compression (and more of it in fresh wind), lasts longer.
			// Only crests near breaking (strong compression) foam: a laxer threshold paints every crest line
			// with a white streak, which real open water at these wind speeds doesn't have.
			fft.foamBias.value = 0.5 + 0.16 * s.whitecaps + 0.01 * THREE.MathUtils.clamp( s.wind - 7, - 5, 12 );
			fft.foamDecay.value = 0.6 - 0.35 * s.whitecaps;

		};

		const clarity = () => {

			// scale absorption/scattering around the tropical defaults
			const k = 1 / Math.max( 0.2, s.clarity );
			G.waterAbsorption.value.set( 0.42, 0.075, 0.035 ).multiplyScalar( 0.6 + 0.4 * k );
			G.waterScattering.value.set( 0.012, 0.018, 0.024 ).multiplyScalar( k * k );

		};

		// ---------------------------------------------------------------- Ocean
		const ocean = ui.addTab( 'ocean', t( 'tab.ocean', 'Ocean' ), 'ocean' );
		const sea = ocean.addFolder( t( 'fld.sea_state', 'Sea state' ), { icon: 'wind' } );
		const applySea = ( k ) => {

			const p = SEA[ k ];
			if ( ! p ) return;
			Object.assign( s, p );
			spectrum();
			whitecaps();
			fft.choppiness.value = s.chop;
			shore.amplitude.value = s.surf;
			shore.period.value = s.period;

		};

		const seaPresets = sea.addPresets( {
			label: t( 'set.conditions', 'Conditions' ), active: 'Breezy',
			presets: Object.keys( SEA ).map( ( k ) => ( { label: k, icon: k.toLowerCase(), apply: () => applySea( k ) } ) ),
		} );
		sea.addSlider( { label: t( 'set.wind_speed', 'Wind speed' ), object: s, key: 'wind', min: 0.5, max: 30, step: 0.1, unit: 'm/s', tooltip: t( 'set.wind_speed.tip', 'Wind 10 m above the sea. Drives the local wind waves, whitecaps and spray.' ), onChange: () => {

			spectrum();
			whitecaps();

		} } );
		sea.addSlider( { label: t( 'set.wind_direction', 'Wind direction' ), object: s, key: 'windDir', min: 0, max: 360, step: 1, unit: '°', onChange: spectrum } );
		sea.addSlider( { label: t( 'set.fetch', 'Fetch' ), object: s, key: 'fetch', min: 5, max: 2000, log: true, unit: 'km', tooltip: t( 'set.fetch.tip', 'Distance the wind has blown over open water: longer fetch, longer and higher waves.' ), onChange: spectrum } );
		sea.addSlider( { label: t( 'set.choppiness', 'Choppiness' ), object: s, key: 'chop', min: 0, max: 1.6, step: 0.01, tooltip: t( 'set.choppiness.tip', 'Horizontal displacement: sharp crests, wide troughs.' ), onChange: ( v ) => { fft.choppiness.value = v; } } );
		sea.addSlider( { label: t( 'set.ocean_swell', 'Ocean swell' ), object: s, key: 'swell', min: 0, max: 2, step: 0.01, onChange: spectrum } );
		sea.addSlider( { label: t( 'set.whitecaps', 'Whitecaps' ), object: s, key: 'whitecaps', min: 0, max: 1, step: 0.01, onChange: whitecaps } );
		const water = ocean.addFolder( t( 'fld.water', 'Water' ), { icon: 'droplet' } );
		water.addSlider( { label: t( 'set.clarity', 'Clarity' ), object: s, key: 'clarity', min: 0.3, max: 2, step: 0.01, tooltip: t( 'set.clarity.tip', 'Lower = more suspended sediment and plankton (greener, murkier).' ), onChange: clarity } );

		// ---------------------------------------------------------------- Shore
		const shoreTab = ui.addTab( 'shore', t( 'tab.shore', 'Shore' ), 'shore' );
		const surf = shoreTab.addFolder( t( 'fld.surf', 'Surf' ), { icon: 'wave' } );
		const waveHeight = surf.addSlider( { label: t( 'set.wave_height', 'Wave height' ), object: s, key: 'surf', min: 0, max: 1.4, step: 0.01, unit: 'm', format: ( v ) => `${ ( v * 2 ).toFixed( 2 ) } m`, onChange: ( v ) => { shore.amplitude.value = v; } } );
		const wavePeriod = surf.addSlider( { label: t( 'set.wave_period', 'Wave period' ), object: s, key: 'period', min: 5, max: 16, step: 0.1, unit: 's', onChange: ( v ) => { shore.period.value = v; } } );
		surf.addSlider( { label: t( 'set.breaking_depth_ratio', 'Breaking depth ratio' ), object: s, key: 'gamma', min: 0.5, max: 1.1, step: 0.01, tooltip: t( 'set.breaking_depth_ratio.tip', 'Waves break when height exceeds this fraction of the depth.' ), onChange: ( v ) => { shore.gamma.value = v; } } );
		surf.addSlider( { label: t( 'set.curl', 'Curl' ), object: s, key: 'curl', min: 0, max: 1.5, step: 0.01, onChange: ( v ) => { shore.curl.value = v; } } );
		if ( app.breakers ) {

			s.spray = app.breakers.params.spray.value;
			s.lip = app.breakers.params.sheet.value;
			surf.addSlider( { label: t( 'set.spray', 'Spray' ), object: s, key: 'spray', min: 0, max: 2, step: 0.01, tooltip: t( 'set.spray.tip', 'Droplets and mist thrown off breaking crests.' ), onChange: ( v ) => { app.breakers.params.spray.value = v; } } );
			surf.addSlider( { label: t( 'set.lip_sheet', 'Lip sheet' ), object: s, key: 'lip', min: 0, max: 1.5, step: 0.01, tooltip: t( 'set.lip_sheet.tip', 'The thin sheet of water thrown forward by plunging breakers.' ), onChange: ( v ) => { app.breakers.params.sheet.value = v; } } );

		}

		if ( app.wake ) {

			const boat = shoreTab.addFolder( t( 'fld.boat_wake', 'Boat wake' ), { icon: 'wave', open: false } );
			s.wakeHeight = app.wake.amplitude.value;
			s.wakeFoam = app.wake.foamGain.value;
			boat.addSlider( { label: t( 'set.wake_height', 'Wake height' ), object: s, key: 'wakeHeight', min: 0, max: 2, step: 0.01, onChange: ( v ) => { app.wake.amplitude.value = v; } } );
			boat.addSlider( { label: t( 'set.wake_foam', 'Wake foam' ), object: s, key: 'wakeFoam', min: 0, max: 1.5, step: 0.01, onChange: ( v ) => { app.wake.foamGain.value = v; } } );

		}
		if ( app.caustics ) {

			const light = shoreTab.addFolder( t( 'fld.caustics', 'Caustics' ), { icon: 'sun', open: false } );
			light.addSlider( { label: t( 'set.intensity', 'Intensity' ), object: s, key: 'caustics', min: 0, max: 2, step: 0.01, onChange: ( v ) => { app.caustics.strength.value = v; } } );

		}

		// ---------------------------------------------------------------- Sky
		const worldCtl = []; // the sliders a mode can lock (clouds, cirrus, haze)
		const sky = ui.addTab( 'sky', t( 'tab.sky', 'Sky' ), 'sky' );
		const weather = sky.addFolder( t( 'fld.weather', 'Weather' ), { icon: 'cloud' } );
		weather.addPresets( {
			label: t( 'set.presets', 'Presets' ),
			presets: Object.entries( WEATHER ).map( ( [ label, w ] ) => ( {
				label, icon: w.icon, tooltip: w.tooltip,
				apply: () => {

					applySea( w.sea );
					seaPresets.setActive( w.sea );
					app.settings.timeOfDay = w.time;
					if ( app.clouds ) app.clouds.coverage.value = s.clouds = w.clouds;
					if ( app.clouds && app.clouds.cirrus ) app.clouds.cirrus.value = s.cirrus = w.cirrus;
					if ( app.haze ) app.haze.density.value = s.haze = w.haze;

				},
			} ) ),
		} );
		const sun = sky.addFolder( t( 'fld.sun', 'Sun' ), { icon: 'clock' } );
		sun.addTimeOfDay( { object: app.settings, key: 'timeOfDay' } );
		sun.addSlider( { label: t( 'set.sun_azimuth', 'Sun azimuth' ), object: app.settings, key: 'sunAzimuth', min: - 180, max: 180, step: 1, format: ( v ) => `${ Math.round( v ) }°`, tooltip: t( 'set.sun_azimuth.tip', 'Turns the sun\'s path around the island (0 = the real path: rises in the east, sets in the west).' ) } );
		let speed = null;
		sun.addToggle( { label: t( 'set.advance_time', 'Advance time' ), object: s, key: 'advance', onChange: ( v ) => {

			app.settings.timeSpeed = v ? s.timeSpeed : 0;
			speed.setVisible( v );

		} } );
		speed = sun.addSlider( { label: t( 'set.time_speed', 'Time speed' ), object: s, key: 'timeSpeed', min: 0.002, max: 1, log: true, unit: 'h/s', onChange: ( v ) => { if ( s.advance ) app.settings.timeSpeed = v; } } ).setVisible( s.advance );
		const atmo = sky.addFolder( t( 'fld.atmosphere', 'Atmosphere' ), { icon: 'cloud' } );
		if ( app.clouds ) worldCtl.push( atmo.addSlider( { label: t( 'set.cloud_cover', 'Cloud cover' ), object: s, key: 'clouds', min: 0, max: 1, step: 0.01, format: ( v ) => `${ Math.round( v * 100 ) }%`, onChange: ( v ) => { app.clouds.coverage.value = v; } } ) );
		if ( app.clouds && app.clouds.cirrus ) worldCtl.push( atmo.addSlider( { label: t( 'set.cirrus', 'Cirrus' ), object: s, key: 'cirrus', min: 0, max: 1, step: 0.01, format: ( v ) => `${ Math.round( v * 100 ) }%`, onChange: ( v ) => { app.clouds.cirrus.value = v; } } ) );
		if ( app.haze ) {

			s.haze = app.haze.density.value;
			s.shafts = app.haze.shafts.value;
			worldCtl.push( atmo.addSlider( { label: t( 'set.haze', 'Haze' ), object: s, key: 'haze', min: 0, max: 4, step: 0.05, tooltip: t( 'set.haze.tip', 'Aerial perspective and marine haze density (1 = about 20 km visibility at sea level, 0 = clear air).' ), onChange: ( v ) => { app.haze.density.value = v; } } ) );
			atmo.addSlider( { label: t( 'set.sun_shafts', 'Sun shafts' ), object: s, key: 'shafts', min: 0, max: 3, step: 0.05, tooltip: t( 'set.sun_shafts.tip', 'Volumetric light shafts and crepuscular rays in the haze (shadows of palms, the pier, hills and clouds). 0 turns them off.' ), onChange: ( v ) => { app.haze.shafts.value = v; } } );

		}
		if ( app.airMotes ) {

			s.air = app.airMotes.intensity.value;
			atmo.addSlider( { label: t( 'set.air_particles', 'Air particles' ), object: s, key: 'air', min: 0, max: 2, step: 0.01, tooltip: t( 'set.air_particles.tip', 'Dust, pollen, salt haze, seed fluff and the odd gnat drifting in the air: they catch the light when backlit by the sun. 0 turns them off.' ), onChange: ( v ) => { app.airMotes.intensity.value = v; } } );

		}

		atmo.addSlider( { label: t( 'set.exposure', 'Exposure' ), object: s, key: 'exposure', min: - 3, max: 3, step: 0.1, unit: 'EV', onChange: ( v ) => { app.settings.exposure = 0.55 * Math.pow( 2, v ); } } );

		// ---------------------------------------------------------------- Camera
		const cam = ui.addTab( 'camera', t( 'tab.camera', 'Camera' ), 'camera' );
		const view = cam.addFolder( t( 'fld.view', 'View' ), { icon: 'camera' } );
		// one view for everything (on foot, on deck, at the helm); remembered between sessions
		s.view = app.player.view;
		view.addSelect( { label: t( 'set.view_v', 'View (V)' ), object: s, key: 'view', tooltip: t( 'set.view_v.tip', 'Third person (your character in view) or first person (through their eyes), on foot and at the helm. Kept for next time.' ), options: [ { label: '3rd person', value: 'third' }, { label: '1st person', value: 'first' } ], onChange: ( v ) => app.player.setView( v ) } );
		view.addSlider( { label: t( 'set.field_of_view', 'Field of view' ), object: s, key: 'fov', min: 35, max: 100, step: 1, unit: '°', onChange: ( v ) => {

			app.camera.fov = v;
			app.camera.updateProjectionMatrix();

		} } );
		const freeCamBtn = view.addButton( { label: t( 'set.free_camera_f', 'Free camera (F)' ), icon: 'camera', onClick: () => app.setFreeCam( ! app.freeCam ) } );
		// reduce boat motion: the boat cameras stabilise more and the camera-feel shakes are off
		s.reduceMotion = !! app.settings.reduceMotion;
		// (the Access tab has the same switch: both go through the accessibility model, which saves it)
		s.reduceMotion = a11y.get( 'reduceMotion' );
		view.addToggle( { label: t( 'set.reduce_boat_motion', 'Reduce boat motion' ), object: s, key: 'reduceMotion', tooltip: t( 'set.reduce_boat_motion.tip', 'Steadier boat cameras (less roll and pitch at the helm) and no camera shake on strikes.' ), onChange: ( v ) => a11y.set( 'reduceMotion', v ) } );

		// ---------------------------------------------------------------- Effects
		const fx = ui.addTab( 'effects', t( 'tab.effects', 'Effects' ), 'effects' );
		const post = fx.addFolder( t( 'fld.post_processing', 'Post-processing' ), { icon: 'sparkles' } );
		const P = app.post.params;
		post.addSlider( { label: t( 'set.ambient_occlusion', 'Ambient occlusion' ), object: s, key: 'ao', min: 0, max: 1.5, step: 0.01, onChange: ( v ) => { P.aoStrength.value = v; } } );
		s.bounce = GroundBounce.strength.value;
		post.addSlider( { label: t( 'set.bounce_light', 'Bounce light' ), object: s, key: 'bounce', min: 0, max: 2, step: 0.01, tooltip: t( 'set.bounce_light.tip', 'Sunlight reflected off the ground (bright sand) onto undersides and shaded faces: pier, eaves, hulls, trunks. 0 = off.' ), onChange: ( v ) => { GroundBounce.strength.value = v; } } );
		s.sharpen = P.sharpen.value;
		post.addSlider( { label: t( 'set.sharpen', 'Sharpen' ), object: s, key: 'sharpen', min: 0, max: 1, step: 0.01, tooltip: t( 'set.sharpen.tip', 'Contrast-adaptive sharpening after the temporal anti-aliasing.' ), onChange: ( v ) => { P.sharpen.value = v; } } );
		if ( app.post.motionBlur ) {

			const mb = app.post.motionBlur.shutter;
			s.motionBlur = mb.value;
			post.addSlider( { label: t( 'set.motion_blur', 'Motion blur' ), object: s, key: 'motionBlur', min: 0, max: 1, step: 0.05, format: ( v ) => v > 0 ? `${ Math.round( v * 360 ) }°` : 'Off', tooltip: t( 'set.motion_blur.tip', 'Camera and object motion blur, as a shutter angle (180° = film look). 0 turns it off.' ), onChange: ( v ) => { mb.value = v; } } );

		}

		post.addSlider( { label: t( 'set.bloom', 'Bloom' ), object: s, key: 'bloom', min: 0, max: 0.3, step: 0.005, onChange: ( v ) => { P.bloom.value = v; } } );
		if ( app.post.flare ) post.addSlider( { label: t( 'set.lens_flare', 'Lens flare' ), object: s, key: 'flare', min: 0, max: 2, step: 0.05, onChange: ( v ) => { app.post.flare.strength.value = v; } } );
		post.addSlider( { label: t( 'set.saturation', 'Saturation' ), object: s, key: 'saturation', min: 0.5, max: 1.5, step: 0.01, onChange: ( v ) => { P.saturation.value = v; } } );
		post.addSlider( { label: t( 'set.contrast', 'Contrast' ), object: s, key: 'contrast', min: 0.8, max: 1.3, step: 0.01, onChange: ( v ) => { P.contrast.value = v; } } );
		post.addSlider( { label: t( 'set.vignette', 'Vignette' ), object: s, key: 'vignette', min: 0, max: 1, step: 0.01, onChange: ( v ) => { P.vignette.value = v; } } );
		post.addSlider( { label: t( 'set.film_grain', 'Film grain' ), object: s, key: 'grain', min: 0, max: 0.06, step: 0.001, onChange: ( v ) => { P.grain.value = v; } } );
		if ( P.grade ) { s.grade = P.grade.value; post.addSlider( { label: t( 'set.grade', 'Time of day grade' ), object: s, key: 'grade', min: 0, max: 1, step: 0.05, onChange: ( v ) => { P.grade.value = v; } } ); } // wave 18A

		// ---------------------------------------------------------------- Game (audio, the menu)
		const game = ui.addTab( 'game', t( 'tab.game', 'Game' ), 'sound' );
		const audioF = game.addFolder( t( 'fld.audio', 'Audio' ), { icon: 'volume' } );
		const au = app.audio;
		if ( au && au.setVolume ) {

			s.muted = au.muted;
			s.volMaster = au.getVolume( 'master' );
			s.volMusic = au.getVolume( 'music' );
			s.volSfx = au.getVolume( 'sfx' );
			s.volAmbience = au.getVolume( 'ambience' );
			const pct = ( v ) => `${ Math.round( v * 100 ) }%`;
			audioF.addToggle( { label: t( 'set.mute_m', 'Mute (M)' ), object: s, key: 'muted', onChange: ( v ) => au.setMuted( v ) } );
			audioF.addSlider( { label: t( 'set.master', 'Master' ), object: s, key: 'volMaster', min: 0, max: 1, step: 0.01, format: pct, onChange: ( v ) => au.setVolume( 'master', v ) } );
			audioF.addSlider( { label: t( 'set.music', 'Music' ), object: s, key: 'volMusic', min: 0, max: 1, step: 0.01, format: pct, tooltip: t( 'set.music.tip', 'Reserved: the island has no music yet.' ), onChange: ( v ) => au.setVolume( 'music', v ) } );
			audioF.addSlider( { label: t( 'set.effects', 'Effects' ), object: s, key: 'volSfx', min: 0, max: 1, step: 0.01, format: pct, tooltip: t( 'set.effects.tip', 'Engine, hull, footsteps, splashes, rod, reel and the coins.' ), onChange: ( v ) => au.setVolume( 'sfx', v ) } );
			audioF.addSlider( { label: t( 'set.ambience', 'Ambience' ), object: s, key: 'volAmbience', min: 0, max: 1, step: 0.01, format: pct, tooltip: t( 'set.ambience.tip', 'Surf, wind, trees, crickets, birds, the reef and the whale.' ), onChange: ( v ) => au.setVolume( 'ambience', v ) } );

		} else audioF.addInfo( { label: t( 'set.sound', 'Sound' ), get: () => 'Off (?noAudio)' } );

		const session = game.addFolder( t( 'fld.session', 'Session' ), { icon: 'settings' } );
		session.addInfo( { label: t( 'set.mode', 'Mode' ), get: () => tx( modeLabel( app.mode ) ) } );
		session.addInfo( { label: t( 'set.slot', 'Slot' ), get: () => app.game && app.game.state ? `${ app.game.state.slot + 1 } · ${ app.game.state.name || 'Islander' }` : '—' } );
		session.addInfo( { label: t( 'set.rank', 'Rank' ), get: () => app.game && app.game.state ? `Lv ${ app.game.state.level } · ${ app.game.state.progress.title }` : '—' } );
		const localSave = session.addButton( { label: t( 'set.save_game', 'Save game' ), icon: 'check', tooltip: t( 'set.save_game.tip', 'Write the current slot now (the game also saves itself every minute).' ), onClick: () => ui.toast( app.saveNow() ? t( 'pause.saved', 'Saved' ) : t( 'pause.save_failed_long', 'Could not save: the browser blocked its storage' ), 1800 ) } );
		session.addButton( { label: t( 'set.pause_menu_esc', 'Pause menu (Esc)' ), icon: 'pause', tooltip: t( 'set.pause_menu_esc.tip', 'Resume, save, load, settings, controls or back to the main menu.' ), onClick: () => {

			ui.togglePanel( false );
			if ( app.pauseMenu ) app.pauseMenu.open();
			else ui.toast( t( 'set.no_menu', 'No menu yet' ) );

		} } );

		// ---------------------------------------------------------------- Touch and mobile (ui/TouchControls.js)
		// the stick, the drag-to-look and the action buttons for phones and tablets; hidden on a desktop until a finger
		// is used (a touch laptop), hidden again by a hardware key or a gamepad (plain English: no i18n keys yet)
		const touch = this.touch = new TouchControls( { app, ui } );
		const ts = touch.settings;
		s.touchMode = ts.mode;
		s.touchSens = ts.sensitivity;
		s.touchInvert = !! ts.invert;
		s.touchSize = ts.size;
		s.touchHaptics = !! ts.haptics;
		const dev = touch.device;
		const mobileF = game.addFolder( 'Touch and mobile', { icon: 'move', open: !! dev.touch } );
		mobileF.addSelect( { label: 'Touch controls', object: s, key: 'touchMode', tooltip: 'Auto: on a phone or tablet, and on a touch laptop once you touch the screen (a key or a gamepad hides them again).', options: [ { label: 'Auto', value: 'auto' }, { label: 'On', value: 'on' }, { label: 'Off', value: 'off' } ], onChange: ( v ) => touch.set( 'mode', v ) } );
		mobileF.addSlider( { label: 'Look sensitivity', object: s, key: 'touchSens', min: 0.3, max: 3, step: 0.05, format: ( v ) => `${ v.toFixed( 2 ) }x`, onChange: ( v ) => touch.set( 'sensitivity', v ) } );
		mobileF.addToggle( { label: 'Invert look (up / down)', object: s, key: 'touchInvert', onChange: ( v ) => touch.set( 'invert', v ) } );
		mobileF.addSlider( { label: 'Button size', object: s, key: 'touchSize', min: 0.8, max: 1.3, step: 0.05, format: ( v ) => `${ Math.round( v * 100 ) }%`, onChange: ( v ) => touch.set( 'size', v ) } );
		if ( typeof navigator !== 'undefined' && navigator.vibrate ) mobileF.addToggle( { label: 'Vibrate on press', object: s, key: 'touchHaptics', onChange: ( v ) => touch.set( 'haptics', v ) } );
		mobileF.addInfo( { label: 'Device', get: () => ( dev.phone ? 'Phone' : dev.tablet ? ( dev.appleSilicon ? 'Tablet (M-series)' : 'Tablet' ) : dev.touch ? 'Touch screen' : 'Desktop' ) + ( dev.webgpu ? '' : ' · no WebGPU' ) } );

		// ---------------------------------------------------------------- Controls (key remapping) and Access (options, language)
		a11y.buildSettings( ui );

		// ---------------------------------------------------------------- Online
		const online = ui.addTab( 'online', t( 'tab.online', 'Online' ), 'performance' );
		const mp = online.addFolder( t( 'fld.multiplayer', 'Multiplayer' ), { icon: 'gauge' } );
		mp.addInfo( { label: t( 'set.status', 'Status' ), get: () => app.net ? ( app.net.online ? t( 'net.online', 'Online' ) : t( 'net.connecting', 'Connecting…' ) ) : t( 'net.offline', 'Offline' ) } );
		mp.addInfo( { label: t( 'set.players', 'Players' ), get: () => app.net && app.remotePlayers ? `${ app.remotePlayers.peerCount + 1 }` : '1' } );
		mp.addInfo( { label: t( 'set.server', 'Server' ), get: () => app.netUrl || app.serverUrl() } );
		mp.addInfo( { label: t( 'set.ping', 'Ping' ), get: () => app.net && app.net.rtt ? `${ app.net.rtt.toFixed( 0 ) } ms` : '—' } );
		mp.addButton( { label: t( 'set.connect', 'Connect' ), icon: 'gauge', onClick: () => app.connect( app.serverUrl() ) } );
		// crew codes: share yours, join a friend's (src/features/netsync)
		mp.addButton( { label: t( 'set.crew_codes', 'Crew (codes)' ), icon: 'gauge', onClick: () => openCrewPanel( app ) } );
		mp.addButton( { label: t( 'set.disconnect', 'Disconnect' ), icon: 'gauge', onClick: () => app.disconnect() } );
		mp.addButton( { label: t( 'set.set_name_server', 'Set name / server' ), icon: 'gauge', onClick: () => {

			const st = app.game.state;
			const name = window.prompt( t( 'set.name_prompt', 'Your name on the island' ), st.name || '' );
			if ( name !== null ) { st.name = name.slice( 0, 24 ); st.save(); }
			const url = window.prompt( t( 'set.server_prompt', 'Server (ws://host:8765/island)' ), app.serverUrl() );
			if ( url ) app.serverOverride = url;

		} } );

		// ---------------------------------------------------------------- Performance
		const perf = ui.addTab( 'performance', t( 'tab.performance', 'Performance' ), 'performance' );
		const live = perf.addFolder( t( 'fld.live', 'Live' ), { icon: 'gauge' } );
		live.addInfo( { label: t( 'set.frame_rate', 'Frame rate' ), get: () => `${ ( app.fps || 0 ).toFixed( 0 ) } fps` } );
		live.addInfo( { label: t( 'set.cpu_per_frame', 'CPU per frame' ), get: () => `${ ( app.cpuMs || 0 ).toFixed( 2 ) } ms` } );
		live.addInfo( { label: t( 'set.render_size', 'Render size' ), get: () => `${ app.sceneRenderer.width } × ${ app.sceneRenderer.height }` } );
		const quality = perf.addFolder( t( 'fld.quality', 'Quality' ), { icon: 'layers' } );
		const applyAA = ( n ) => {

			app.post.aaMode = n > 0 ? 'taa' : 'none';
			if ( n > 0 ) app.post.taau.jitterPhaseOverride = n;

		};

		const applySSR = ( v ) => { if ( app.waterMaterial ) app.waterMaterial.params.ssr.value = v ? 1 : 0; };
		s.ssr = true;
		// app.quality (core/Quality.js): App may create it; otherwise the panel does and ticks it from update()
		const q = this.quality = app.quality || ( app.quality = new Quality( app ) );
		const syncQ = () => {

			const tq = TIERS[ q.tier ];
			s.renderScale = app.settings.renderScale;
			s.aa = app.post.aaMode === 'none' ? 0 : app.post.taau.jitterPhaseOverride;
			s.ssr = tq.ssr;
			s.qAuto = q.auto;
			s.qTarget = q.target;
			if ( presets && presets.setActive ) presets.setActive( Object.keys( QUALITY ).find( ( k ) => QUALITY[ k ].tier === q.tier ) );

		};
		s.qAuto = q.auto;
		s.qTarget = q.target;
		quality.addInfo( { label: 'Now', get: () => q.describe() } );
		quality.addToggle( { label: 'Auto quality', object: s, key: 'qAuto', tooltip: 'Lowers the render scale, then the preset, when the frame rate drops under the target, and raises them again when there is headroom (never above the preset you picked).', onChange: ( v ) => q.setAuto( v ) } );
		quality.addSelect( { label: 'Target', object: s, key: 'qTarget', options: [ { label: '60 fps', value: 60 }, { label: '30 fps', value: 30 } ], onChange: ( v ) => q.setTarget( Number( v ) ) } );
		const presets = quality.addPresets( {
			label: t( 'set.preset', 'Preset' ),
			presets: Object.entries( QUALITY ).map( ( [ label, p ] ) => ( {
				label, icon: p.icon, tooltip: p.tooltip,
				apply: () => {

					q.setTier( p.tier );
					syncQ();
					ui.refresh();

				},
			} ) ),
		} );
		q.onChange( () => { syncQ(); if ( ui.refresh ) ui.refresh(); } );
		syncQ();
		quality.addSlider( { label: t( 'set.render_scale', 'Render scale' ), object: s, key: 'renderScale', min: 0.5, max: 1, step: 0.05, format: ( v ) => `${ Math.round( v * 100 ) }%`, tooltip: t( 'set.render_scale.tip', 'Internal resolution; the temporal upscaler reconstructs the full output resolution.' ), onChange: ( v ) => { app.setRenderScale( v ); q.loop.scale = app.settings.renderScale; } } );
		// anti-aliasing: the TAA with 2..16 jitter positions averaged per pixel, or none
		s.aa = app.post.aaMode === 'none' ? 0 : app.post.taau.jitterPhaseOverride;
		quality.addSelect( { label: t( 'set.anti_aliasing', 'Anti-aliasing' ), object: s, key: 'aa', tooltip: t( 'set.anti_aliasing.tip', 'Temporal anti-aliasing: each pixel averages this many sub-pixel sample positions over successive frames (it also smooths dithered fades and shadow noise). More samples cost nothing per frame but take a few more frames to settle.' ), options: [ { label: 'Off', value: 0 }, { label: '2x', value: 2 }, { label: '4x', value: 4 }, { label: '8x', value: 8 }, { label: '16x', value: 16 } ], onChange: ( v ) => applyAA( Number( v ) ) } );
		quality.addToggle( { label: t( 'set.shadows', 'Shadows' ), object: s, key: 'shadows', onChange: ( v ) => { app.shadows.enabled = v; app.settings.shadowsOff = ! v; } } );
		quality.addToggle( { label: t( 'set.water_reflections', 'Water reflections' ), object: s, key: 'ssr', tooltip: t( 'set.water_reflections.tip', 'Screen-space reflections of the pier, boats and hills on the water.' ), onChange: applySSR } );

		// ---------------------------------------------------------------- game modes (game/GameMode.js): what each one locks
		// Campaign and Multiplayer fix the world (time, sun, sea, weather, clouds, haze, the free camera): those controls are
		// dimmed, marked "Sandbox only", and their values go back to the island's own. Graphics, audio, effects, the view and
		// the online settings are open in every mode.
		if ( ! document.getElementById( 'aw-style' ) ) {

			const style = document.createElement( 'style' );
			style.id = 'aw-style';
			style.textContent = LOCK_CSS;
			document.head.append( style );

		}

		const def = { wind: s.wind, windDir: s.windDir, fetch: s.fetch, chop: s.chop, swell: s.swell, whitecaps: s.whitecaps, surf: s.surf, period: s.period, gamma: s.gamma, curl: s.curl, clouds: s.clouds, cirrus: s.cirrus, haze: s.haze };
		const defWater = { foamBias: fft.foamBias.value, foamDecay: fft.foamDecay.value, windSpeed: G.windSpeed.value, wx: G.windDir.value.x, wy: G.windDir.value.y };
		const resetWorld = () => {

			Object.assign( s, def );
			spectrum();
			fft.foamBias.value = defWater.foamBias;
			fft.foamDecay.value = defWater.foamDecay;
			G.windSpeed.value = defWater.windSpeed;
			G.windDir.value.set( defWater.wx, defWater.wy );
			fft.choppiness.value = s.chop;
			shore.amplitude.value = s.surf;
			shore.period.value = s.period;
			shore.gamma.value = s.gamma;
			shore.curl.value = s.curl;
			if ( app.clouds ) app.clouds.coverage.value = s.clouds;
			if ( app.clouds && app.clouds.cirrus ) app.clouds.cirrus.value = s.cirrus;
			if ( app.haze && def.haze !== undefined ) app.haze.density.value = s.haze;
			seaPresets.setActive( 'Breezy' );
			app.settings.sunAzimuth = 0;

		};

		const locks = [
			{ target: sea, folder: true, when: ( r ) => ! r.worldControls },
			{ target: water, folder: true, when: ( r ) => ! r.worldControls },
			{ target: surf, folder: true, when: ( r ) => ! r.worldControls },
			{ target: weather, folder: true, when: ( r ) => ! r.worldControls },
			{ target: sun, folder: true, when: ( r ) => ! r.worldControls || ! r.timeControl },
			...worldCtl.map( ( c ) => ( { target: c, when: ( r ) => ! r.worldControls } ) ),
			{ target: waveHeight, when: ( r ) => ! r.worldControls },
			{ target: wavePeriod, when: ( r ) => ! r.worldControls },
			{ target: freeCamBtn, when: ( r ) => ! r.freeCam },
		];
		// rules: GameMode.rules( mode ), called by App.setMode
		this.applyMode = ( r ) => {

			for ( const l of locks ) {

				const on = !! l.when( r );
				if ( l.folder ) lockFolder( l.target, on );
				else lockControl( l.target, on );
				l.target.el?.classList.toggle( 'aw-online-hidden', r.online && on );

			}

			if ( ! r.worldControls ) resetWorld();
			localSave.enabled = ! r.online;
			localSave.el?.classList.toggle( 'aw-online-hidden', r.online );
			// the clock controls follow the clock the mode left (the day runs by itself outside the sandbox)
			s.advance = app.settings.timeSpeed !== 0;
			if ( app.settings.timeSpeed ) s.timeSpeed = app.settings.timeSpeed;
			speed.setVisible( s.advance );
			ui.refresh();

		};

		// the controls sheet: say which keys are sandbox only, and what Escape does now
		for ( const row of ui.helpEl.querySelectorAll( '.tw-help-row' ) ) {

			const cell = row.querySelector( '.tw-help-text' );
			if ( ! cell ) continue;
			const txt = cell.textContent.trim();
			if ( txt.startsWith( 'Free camera' ) || txt.startsWith( 'Pause time' ) ) cell.insertAdjacentHTML( 'beforeend', `<small>${ SANDBOX_ONLY }</small>` );
			else if ( txt.startsWith( 'Release the mouse' ) ) cell.innerHTML = 'Menu<small>Pause, save, load, settings. Also lets go of the mouse</small>';

		}

		const startKeys = ui.startEl && ui.startEl.querySelector( '.tw-start-keys' );
		if ( startKeys ) startKeys.insertAdjacentHTML( 'beforeend', '<span><kbd>Esc</kbd>Menu</span>' );

		this.applyMode( app.rules );

		// the key caps of the controls sheet and the start overlay follow the bindings; the panel, the sheet and the start
		// overlay are translated (and kept translated while they are rebuilt) when the language is not English
		a11y.bindHelp( ui.helpEl, ui.startEl );
		for ( const el of [ ui.panel, ui.rail, ui.helpEl, ui.startEl ] ) if ( el ) observeDom( el );
		a11y.onChange( ( what ) => { if ( what === 'lang' ) ui.refresh(); } );

		this._t = 0;

	}

	// per-frame HUD
	update( dt ) {

		const app = this.app;
		const ui = this.ui;
		ui.setStats( { fps: app.fps, frameMs: dt * 1000 } );
		if ( app.quality ) app.quality.update( dt ); // (ignored when App already ticked it this frame)
		this.s.renderScale = app.post.scale;
		// the M key toggles the mute outside the panel: keep its switch honest
		if ( app.audio && this.s.muted !== undefined && this.s.muted !== app.audio.muted ) {

			this.s.muted = app.audio.muted;
			ui.refresh();

		}

		const p = app.player;
		if ( app.freeCam ) {

			ui.setMode( `${ tx( modeLabel( app.mode ) ) } · ${ t( 'hud.freecam', 'Free camera' ) }` );
			ui.setPrompt( 'F', t( 'prompt.walk', 'Walk' ) );
			ui.setBoatGauges( { visible: false } );
			ui.setDepth( { visible: false } );
			if ( this.touch ) this.touch.update( dt, { prompt: { key: 'F', text: t( 'prompt.walk', 'Walk' ) } } );
			return;

		}

		this.s.view = p.view;
		const mode = p.mode === 'boat' ? t( p.camMode === 'first' ? 'hud.boat1' : 'hud.boat3', p.camMode === 'first' ? 'Boat · 1st person' : 'Boat · 3rd person' )
			: p.mode === 'deck' ? t( 'hud.deck', 'On deck' )
			: p.mode === 'plane' && p.vehicle && p.vehicle.kind === 'chute' ? t( 'hud.chute', 'Parachute' )
			: p.mode === 'plane' && p.vehicle && p.vehicle.kind === 'car' ? ( p.view === 'first' ? 'Driving · driver\'s eye' : 'Driving · chase view' ) // (wave 21B: a car is a vehicle too)
			: p.mode === 'plane' && p.vehicle?.kind === 'helicopter' ? ( p.view === 'first' ? 'Helicopter · cockpit' : 'Helicopter · chase view' )
			: p.mode === 'plane' ? t( p.view === 'first' ? 'hud.plane1' : 'hud.plane3', p.view === 'first' ? 'Seaplane · cockpit' : 'Seaplane · chase view' )
				+ ( ( h ) => ( h ? ' · ' + h : '' ) )( app.features?.get?.( 'seaplane' )?.bailHint?.() ) // wave 14B: how to bail out, while high enough
			: p.mode === 'swim' ? ( app.camera.position.y < ( app.cameraWaterHeight ?? 0 ) - 0.3 ? t( 'hud.dive', 'Diving' ) : t( 'hud.swim', 'Swimming' ) ) : t( 'hud.walk', 'Walking' );
		ui.setMode( `${ tx( modeLabel( app.mode ) ) } · ${ mode }` );
		// the prompt's keys follow the bindings, its text the language and the reel mode
		let promptText = '';
		if ( p.prompt ) {

			const pr = this.a11y.prompt( p.prompt, tx );
			ui.setPrompt( pr.key, pr.text );
			promptText = pr.text;

		} else ui.setPrompt( null );

		// the touch controls: the prompt becomes the wide button, the rest follow the game's state
		if ( this.touch ) this.touch.update( dt, { prompt: p.prompt, promptText } );

		const b = app.boatCtl;
		if ( p.mode === 'boat' ) {

			const f = b.forward( new THREE.Vector3() );
			ui.setBoatGauges( {
				visible: true,
				throttle: b.throttle,
				rpm: b.rpm,
				speedKnots: b.speed * 1.94384,
				heading: ( THREE.MathUtils.radToDeg( Math.atan2( f.x, - f.z ) ) + 360 ) % 360,
			} );

		} else ui.setBoatGauges( { visible: false } );

		const depth = ( app.cameraWaterHeight ?? 0 ) - app.camera.position.y;
		ui.setDepth( { visible: p.mode === 'swim' && depth > 0.3, meters: depth } );

	}

}

// ---- locked controls (game modes): dimmed, not interactive, "Sandbox only" on hover and on the row / folder head

const LOCK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

const LOCK_CSS = /* css */`
.aw-online-hidden { display: none !important; }
.aw-locked { cursor: not-allowed; }
.aw-locked > :not(.aw-lockrow) { opacity: 0.36; }
.aw-lockrow { display: flex; align-items: center; gap: 5px; margin: 0 0 2px; font: 600 10px var(--tw-font); letter-spacing: 0.08em; text-transform: uppercase; color: var(--tw-sun); }
.aw-lockrow svg { width: 11px; height: 11px; flex: none; }
.tw-folder.aw-folder-locked > .tw-folder-head { cursor: pointer; }
.tw-folder.aw-folder-locked > .tw-folder-head::after { content: attr(data-lock); order: 2; padding: 1px 7px; border-radius: 999px; font: 600 10px var(--tw-font); letter-spacing: 0.06em; text-transform: uppercase;
	color: var(--tw-sun); background: rgba(var(--tw-sun-rgb), 0.12); box-shadow: inset 0 0 0 1px rgba(var(--tw-sun-rgb), 0.35); }
.tw-folder.aw-folder-locked > .tw-folder-head .tw-folder-chev { order: 3; }
`;

// dim a control and make it inert (hover still shows why); `row`: a "Sandbox only" line above it
function lockControl( c, on, { row = true } = {} ) {

	const el = c && c.el;
	if ( ! el ) return;
	el.classList.toggle( 'aw-locked', on );
	let r = el.querySelector( ':scope > .aw-lockrow' );
	if ( on && row && ! r ) {

		r = document.createElement( 'div' );
		r.className = 'aw-lockrow';
		r.innerHTML = LOCK_ICON + `<span>${ SANDBOX_ONLY }</span>`;
		el.prepend( r );

	} else if ( ( ! on || ! row ) && r ) r.remove();

	if ( on ) el.dataset.tip = SANDBOX_ONLY;
	else delete el.dataset.tip;
	for ( const k of el.children ) k.inert = on;
	c.enabled = ! on; // a programmatic click / preset is refused too

}

// a folder: its head says so and every control inside is locked (the head still opens and closes it)
function lockFolder( f, on ) {

	f.el.classList.toggle( 'aw-folder-locked', on );
	if ( on ) {

		f.head.dataset.lock = SANDBOX_ONLY;
		f.head.dataset.tip = SANDBOX_ONLY;

	} else {

		delete f.head.dataset.lock;
		delete f.head.dataset.tip;

	}

	for ( const c of f.controls() ) lockControl( c, on, { row: false } );

}

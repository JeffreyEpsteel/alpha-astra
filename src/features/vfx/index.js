import { VfxSystem, BUDGET, DEDUP_T, DEDUP_R } from './VfxSystem.js';
import { VfxPool, motionAt, LOOK, ORIENT, FLOOR, STRIDE } from './VfxPool.js';
import { G } from '../../core/Globals.js';

// The VFX set (v3): muzzle flashes and gun smoke, splash columns with foam rings, splinters, dust and debris, burning
// ships, sinking bubbles, seaplane spray and the catch splash. Recipes in VfxSystem.js fill a fixed particle pool
// (VfxPool.js); src/fx/VfxParticles.js draws it in one instanced draw (storage buffer + procedural atlas,
// src/fx/VfxAtlas.js). Without a scene / GPU (node tests, ?noVfx) the recipes still run and nothing is drawn.
//
//   const vfx = features.get( 'vfx' );
//   vfx.splash( x, y, z, strength )                  y = the water there; strength 1 = a cannonball
//   vfx.spray( x, y, z, strength, dirX?, dirZ? )     a rooster tail thrown back from something skimming (every frame)
//   vfx.smoke( x, y, z, strength, dirX?, dirY?, dirZ? )   vfx.flash( x, y, z, strength, dirX?, dirY?, dirZ? )
//   vfx.splinters( x, y, z, strength )               vfx.debris( x, y, z, strength, kind = 'wood' | 'stone' | 'dirt' | 'metal' | 'straw' )
//   vfx.dust( x, y, z, strength )                    vfx.explosion( x, y, z, strength, kind? )   vfx.muzzle( x, y, z, dx, dy, dz, strength )
//   vfx.fire( id, x, y, z, strength, vx?, vz? ) / vfx.stopFire( id )   a persistent fire (call again to move it)
//   vfx.bubbles( x, y, z, strength )                 vfx.sinking( id, x, z, size )
//   vfx.lights                                       flash and fire point lights (installFeatures hands them to LocalLights)
//
// A direct call and the matching event at the same spot within 0.1 s show once (VfxSystem de-duplication).
// Events: cannonFired -> muzzle flash + smoke; cannonballImpact -> splash (water) / splinters (ship) / dust + debris
// (land, prop); explosion -> flash + smoke + debris; propDestroyed -> dust + debris; shipSunk -> bubbles + foam;
// planeTookOff / planeLanded -> spray; fishCaught -> a small splash at the bobber; remoteWorldEvent of those kinds
// (not replays). Naval ships (features.get( 'naval' ).ships) burn under 35 % hull and bubble as they sink.
// Quality: the low budget (BUDGET.low) with ?lowFx or a render scale of 0.5 or less (the Low preset).

export { VfxSystem, VfxPool, motionAt, LOOK, ORIENT, FLOOR, STRIDE, BUDGET, DEDUP_T, DEDUP_R };

const E_REF = 20000; // J: a 6-pounder ball near the muzzle; impact strength = sqrt( energy / E_REF )
const API = [ 'splash', 'spray', 'smoke', 'splinters', 'flash', 'debris', 'dust', 'bubbles', 'explosion', 'muzzle', 'fire', 'stopFire', 'sinking' ];
const num = ( v, d = 0 ) => ( Number.isFinite( v ) ? v : d );
const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );

export class Vfx {

	constructor( app, features, { renderer = true } = {} ) {

		this.app = app || null;
		this.features = features || null;
		const self = this;
		const cam = { x: 0, y: 0, z: 0 };
		this.env = {
			seaLevel: () => num( G.seaLevel && G.seaLevel.value, 0 ),
			groundAt: ( x, z ) => {

				const td = self.app && self.app.terrainData;
				if ( ! td || ! td.heightAt ) return - Infinity;
				try { return td.heightAt( x, z ); } catch ( e ) { return - Infinity; }

			},
			// smoke drifts with the wind at ~60 % of its 10 m speed
			wind: ( out ) => {

				const sp = num( G.windSpeed && G.windSpeed.value, 0 ) * 0.6;
				const d = G.windDir && G.windDir.value;
				out.x = d ? d.x * sp : 0;
				out.z = d ? d.y * sp : 0;
				return out;

			},
			camera: () => {

				const c = self.app && self.app.camera;
				if ( ! c || ! c.position ) return null;
				cam.x = c.position.x; cam.y = c.position.y; cam.z = c.position.z;
				return cam;

			},
			spray: ( app && app.spray && app.spray.emit ) ? app.spray : null,
		};
		this.sys = new VfxSystem( { env: this.env, quality: this._wantQuality() } );
		this.lights = this.sys.lights;
		this.particles = null;
		this._qT = 0;
		this.off = [];
		if ( renderer ) this._buildRenderer();
		for ( const k of API ) if ( ! this[ k ] ) this[ k ] = ( ...a ) => this.sys[ k ]( ...a );
		if ( features && features.on ) this._listen( features );

	}

	_buildRenderer() {

		const app = this.app, qs = app && app.qs;
		if ( ! app || ! app.scene || typeof app.scene.add !== 'function' ) return;
		if ( qs && typeof qs.has === 'function' && qs.has( 'noVfx' ) ) return;
		import( '../../fx/VfxParticles.js' ).then( ( { VfxParticles } ) => {

			if ( this._disposed ) return;
			try {

				const sc = app.sceneRenderer && app.sceneRenderer.opaqueCopy;
				this.particles = new VfxParticles( { pool: this.sys.pool, query: app.query || null, sceneCopy: sc || null } );
				app.scene.add( this.particles.mesh );

			} catch ( e ) {

				console.warn( 'vfx: particles unavailable', e );
				this.particles = null;

			}

		} ).catch( ( e ) => console.warn( 'vfx: particles unavailable', e ) );

	}

	_wantQuality() {

		const app = this.app, qs = app && app.qs;
		if ( qs && typeof qs.has === 'function' && qs.has( 'lowFx' ) ) return 'low';
		const rs = app && app.settings && app.settings.renderScale;
		return Number.isFinite( rs ) && rs <= 0.5 ? 'low' : 'high';

	}

	// ---- events

	_listen( f ) {

		const on = ( name, fn ) => this.off.push( f.on( name, ( e ) => { if ( e ) fn( e ); } ) );
		on( 'cannonFired', ( e ) => this._cannonFired( e ) );
		on( 'cannonballImpact', ( e ) => this._impact( e ) );
		on( 'explosion', ( e ) => this._explosion( e ) );
		on( 'propDestroyed', ( e ) => this._propDestroyed( e ) );
		on( 'shipSunk', ( e ) => this._shipSunk( e ) );
		on( 'planeTookOff', ( e ) => this._plane( e, 1.6 ) );
		on( 'planeLanded', ( e ) => { if ( e.onWater !== false ) this._plane( e, 1.2 ); } );
		on( 'fishCaught', ( e ) => this._fishCaught( e ) );
		// another player's world events (never replays of old ones: no fireworks for history)
		on( 'remoteWorldEvent', ( e ) => {

			if ( e.replay || ! e.data ) return;
			const fn = { cannonFired: '_cannonFired', cannonballImpact: '_impact', explosion: '_explosion', propDestroyed: '_propDestroyed' }[ e.kind ];
			if ( fn ) this[ fn ]( e.data );

		} );

	}

	_pos( e ) {

		return Number.isFinite( e.x ) && Number.isFinite( e.z );

	}

	_cannonFired( e ) {

		if ( ! this._pos( e ) ) return;
		const d = e.dir || {};
		const s = clamp( num( e.strength, e.big ? 1.5 : 1 ), 0.2, 4 );
		this.sys.muzzle( e.x, num( e.y, this.env.seaLevel() + 2 ), e.z, num( d.x ), num( d.y ), num( d.z ), s );

	}

	_impact( e ) {

		if ( ! this._pos( e ) ) return;
		const en = num( e.energy, 0 );
		// energies are joules; small values are taken as an already normalised strength
		const s = clamp( en > 50 ? Math.sqrt( en / E_REF ) : en > 0 ? en : 1, 0.3, 3 );
		const sea = this.env.seaLevel();
		const y = num( e.y, sea );
		switch ( e.hit ) {

			case 'water': this.sys.splash( e.x, sea, e.z, s ); break;
			case 'ship': this.sys.splinters( e.x, y, e.z, s ); break;
			case 'prop': this.sys.debris( e.x, y, e.z, 0.8 * s, e.kind || e.material || 'wood' ); break;
			default: {

				// land (or unknown): earth thrown up and a dust cloud; a ball that lands in the shallows splashes
				if ( y <= sea + 0.3 && ! this.sys._onLand( e.x, e.z ) ) this.sys.splash( e.x, sea, e.z, s );
				else this.sys.debris( e.x, y, e.z, 0.8 * s, e.kind || 'dirt' );

			}

		}

	}

	_explosion( e ) {

		if ( ! this._pos( e ) ) return;
		const r = num( e.radius, 0 ), en = num( e.energy, 0 );
		const s = clamp( r > 0 ? r / 3 : en > 50 ? Math.sqrt( en / ( E_REF * 4 ) ) : 1.5, 0.4, 5 );
		this.sys.explosion( e.x, num( e.y, this.env.seaLevel() ), e.z, s, e.kind || 'wood' );

	}

	_propDestroyed( e ) {

		if ( ! this._pos( e ) ) return;
		const y = num( e.y, this.env.groundAt( e.x, e.z ) );
		const kind = String( e.kind || '' ).toLowerCase();
		const mat = /rock|stone|wall|statue/.test( kind ) ? 'stone' : /hay|straw/.test( kind ) ? 'straw' : /metal|anchor|cannon/.test( kind ) ? 'metal' : 'wood';
		this.sys.dust( e.x, num( y, 0 ), e.z, 1 );
		this.sys.debris( e.x, num( y, 0 ) + 0.5, e.z, 0.7, mat );

	}

	_shipSunk( e ) {

		if ( ! this._pos( e ) ) return;
		this.sys.sinking( 'ship:' + ( e.id ?? `${ Math.round( e.x ) },${ Math.round( e.z ) }` ), e.x, e.z, clamp( num( e.size, 2.4 ), 1, 4 ) );

	}

	_plane( e, s ) {

		let x = e.x, z = e.z, h = e.heading;
		if ( ! Number.isFinite( x ) || ! Number.isFinite( z ) ) {

			const m = this.features && this.features.get && this.features.get( 'seaplane' );
			const mk = m && m.marker ? m.marker() : null;
			if ( ! mk ) return;
			x = mk.x; z = mk.z; h = mk.heading;

		}

		if ( this.sys._onLand( x, z ) ) return;
		// heading: radians, 0 = +z (the convention of the boat and the map markers)
		const hd = num( h, 0 );
		this.sys.spray( x, this.env.seaLevel(), z, s, Math.sin( hd ), Math.cos( hd ) );

	}

	_fishCaught( e ) {

		const app = this.app;
		const b = ( Number.isFinite( e.x ) && e ) || ( app && app.game && app.game.rod && app.game.rod.bobber );
		if ( ! b || ! Number.isFinite( b.x ) || ! Number.isFinite( b.z ) ) return;
		if ( this.sys._onLand( b.x, b.z ) ) return;
		const s = clamp( 0.18 + 0.05 * Math.sqrt( Math.max( 0, num( e.kg, 1 ) ) ), 0.15, 0.5 );
		this.sys.splash( b.x, this.env.seaLevel(), b.z, s );

	}

	// ---- frame

	update( dt ) {

		dt = clamp( num( dt, 0 ), 0, 0.25 );
		this._qT -= dt;
		if ( this._qT <= 0 ) {

			this._qT = 1;
			this.sys.setQuality( this._wantQuality() );

		}

		const nv = this.features && this.features.get && this.features.get( 'naval' );
		if ( nv && Array.isArray( nv.ships ) ) this.sys.trackShips( nv.ships );
		this.sys.update( dt );
		if ( this.particles ) this.particles.sync();

	}

	get live() {

		return this.sys.live;

	}

	get counts() {

		return this.sys.counts;

	}

	setQuality( q ) {

		this.sys.setQuality( q );

	}

	reset() {

		this.sys.reset();

	}

	dispose() {

		this._disposed = true;
		for ( const off of this.off ) try { off(); } catch ( e ) { /* gone */ }
		this.off.length = 0;
		this.sys.reset();
		if ( this.particles ) this.particles.dispose();
		this.particles = null;

	}

}

export function install( app, features, opts = {} ) {

	return new Vfx( app, features, opts );

}

export default { install };

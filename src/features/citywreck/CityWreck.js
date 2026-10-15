// The destructible city (wave 21C): Meridian's buildings take hits, scar, gut, burn and (the low and midrises) fall; fires
// spread in dry weather and the crews put them out; the city mends over in-game days under scaffolding. See index.js for
// the contract; the state is Model.js, the looks Looks.js, the drawing Render.js.

import { CityModel } from './Model.js';
import { looks, Collapse } from './Looks.js';
import { COLLAPSE, RENDER, NET, FIRE, WANTED, wantedLevel } from './CityWreckData.js';
import { t } from '../../i18n/index.js';

const CLOCK_FALLBACK = 24 / 2400; // h per real second when the island clock is stopped (as destruction)
const BALL_MASS = 2.7; // kg (a 6-pounder; destruction uses the same when an impact names no energy)
const HEAT_MEMORY = 20; // s: a stage change this soon after the player's hit is the player's doing
const FORWARD = new Set( [ 'player', 'car', 'vehicle' ] ); // the explosions a guest sends to the host (others are the host's own)
const LOOK_EVERY = 0.25; // s between checks of the static looks

function hoursForward( a, b ) {

	let d = b - a;
	if ( d < - 12 ) d += 24;
	return d > 0 ? d : 0;

}

export class CityWreck {

	constructor( app, features, opts = {} ) {

		this.app = app || {};
		this.features = features || null;
		this.opts = opts;
		this.phone = opts.phone ?? !! globalThis.__phoneBudget;
		this.city = null;
		this.model = null;
		this.render = null;
		this.pending = null;
		this.time = 0;
		this._lastHour = null;
		this.heat = 0;
		this.level = 0;
		this._touched = new Map(); // building id -> time the local player last hit it
		this.queue = []; // collapses waiting for an animation slot
		this.anims = [];
		this._looks = new Map(); // id -> { key, items }
		this._lookT = 0;
		this._redraw = true;
		this._camAt = null;
		this._vfxT = 0;
		this._fireShown = new Set();
		this._netDirty = new Set();
		this._netT = 0;
		this._fireStep = new Map();
		this._snapAsked = false;
		this._seenPools = new Set();
		this._poolT = 0;
		this._findT = 0;
		this.stats = { forwarded: 0, remoteHits: 0, streamed: 0, applied: 0, collapsesShown: 0, dropped: 0 };
		this.disposed = false;

		const on = ( n, fn ) => ( features && features.on ? features.on( n, fn ) : () => {} );
		this._off = [
			on( 'cannonballImpact', ( e ) => this._onCannon( e ) ),
			on( 'explosion', ( e ) => this._onExplosion( e ) ),
			on( 'planeCrashed', ( e ) => this._onCrash( e ) ),
			on( 'firePool', ( e ) => this._onFirePool( e ) ),
			on( 'remoteWorldEvent', ( e ) => this._onRemote( e ) ),
			on( 'hostRequest', ( e ) => this._onHostRequest( e ) ),
		];
		if ( opts.city ) this.attach( opts.city );

	}

	// ------------------------------------------------------------------ the city

	// the Meridian handle: 21A's builder (app.meridian / app.ports.meridian) or a stand-in (tests: opts.city)
	_findCity() {

		const a = this.app;
		return a.meridian || ( a.ports && a.ports.meridian ) || ( a.world && a.world.meridian ) || null;

	}

	attach( city ) {

		if ( ! city || this.city === city ) return this;
		const plan = this.opts.plan || city.plan || ( typeof city.cityPlan === 'function' ? city.cityPlan() : null );
		if ( ! plan || ! Array.isArray( plan.buildings ) ) return this;
		this.city = city;
		const T = this.app.terrainData;
		const ground = typeof city.roadHeight === 'function' ? ( x, z ) => city.roadHeight( x, z ) : T && T.heightAt ? ( x, z ) => T.heightAt( x, z ) : () => 0;
		const baseOf = ( p ) => {

			const h = city.building ? city.building( p.id ) : null;
			const m = h && h.bounds && ( h.bounds.min || h.bounds );
			return m && Number.isFinite( m.y ) ? m.y : null;

		};
		this.model = new CityModel( plan, {
			ground, baseOf, seed: this.opts.seed ?? 21, puppet: ! this._host(),
			emit: ( n, p ) => this._modelEvent( n, p ),
			onStage: ( b, s, prev, info ) => this._onStage( b, s, prev, info ),
		} );
		// 21A's setStage calls this: what stages 1-3 look like is ours (the scarring, the breach, the rubble)
		this._prevHook = city.onStage;
		city.onStage = ( id, stage ) => {

			if ( typeof this._prevHook === 'function' ) try { this._prevHook( id, stage ); } catch ( e ) { /* theirs */ }
			this._dress( id );

		};
		if ( this.pending ) { this.fromJSON( this.pending ); this.pending = null; }
		if ( this.app.scene && this.opts.render !== false && ! this.render ) {

			import( './Render.js' ).then( ( m ) => {

				if ( this.disposed ) return;
				try { this.render = new m.WreckRender( this.app.scene, this.phone ? RENDER.capacity.phone : RENDER.capacity.desktop ); this._redraw = true; } catch ( e ) { console.warn( 'citywreck: cannot draw', e ); }

			} );

		}

		return this;

	}

	_host() {

		const ns = this.app.netsync;
		return ! ns || ! ns.online || !! ns.isHost;

	}

	_get( name ) {

		return this.features && this.features.get ? this.features.get( name ) : null;

	}

	_emit( name, payload ) {

		if ( this.features && this.features.emit ) this.features.emit( name, payload );

	}

	_toast( key, text, vars, ms = 3200 ) {

		const g = this.app.game;
		if ( g && typeof g.toast === 'function' ) try { g.toast( t( key, text, vars ), ms ); } catch ( e ) { /* the HUD is optional */ }

	}

	// ------------------------------------------------------------------ hits in

	_onCannon( e ) {

		if ( ! e || ! Number.isFinite( e.x ) || ! this.model ) return;
		const v2 = ( e.vx || 0 ) ** 2 + ( e.vy || 0 ) ** 2 + ( e.vz || 0 ) ** 2;
		const kJ = ( e.energy > 0 ? e.energy : v2 > 0 ? 0.5 * BALL_MASS * v2 : 16000 ) / 1000;
		const mine = e.owner === 'player' || e.by === 'player';
		const by = mine ? 'player' : e.owner || e.by || 'cannon';
		const target = e.hit === 'prop' && typeof e.target === 'string' && this.model.byId.has( e.target ) ? e.target : null;
		// (a guest's own balls are flown on the host too: only the host applies them)
		if ( this._host() ) this.model.cannon( e.x, e.y, e.z, kJ, by, target );
		if ( mine ) this._heatAt( target ? [ target ] : this.model.near( e.x, e.y, e.z, 2 ) );

	}

	_onExplosion( e ) {

		if ( ! e || ! Number.isFinite( e.x ) || ! this.model ) return;
		const r = e.radius > 0 ? e.radius : 4.5, kJ = ( e.energy > 0 ? e.energy : 60000 ) / 1000;
		const by = e.by || 'explosion';
		if ( this._host() ) this.model.blast( e.x, e.y ?? 1, e.z, r, kJ, by );
		else if ( FORWARD.has( by ) ) this._forward( { k: 'blast', x: e.x, y: e.y ?? 1, z: e.z, r, e: kJ, by } );
		if ( by === 'player' ) this._heatAt( this.model.near( e.x, e.y ?? 1, e.z, r * 1.6 ) );

	}

	_onCrash( e ) {

		if ( ! e || ! Number.isFinite( e.x ) || ! this.model || e.water ) return;
		const v = Number.isFinite( e.speed ) ? e.speed : 25, m = e.mass > 0 ? e.mass : 900;
		const kJ = 0.5 * m * v * v / 1000;
		// aircraft: low and midrise only (Model.crash); the towers and highrises take nothing
		if ( this._host() ) this.model.crash( e.x, e.y ?? 2, e.z, kJ, 'aircraft' );
		else this._forward( { k: 'crash', x: e.x, y: e.y ?? 2, z: e.z, e: kJ, by: 'aircraft' } );

	}

	_onFirePool( e ) {

		if ( ! e || ! Number.isFinite( e.x ) || ! this.model ) return;
		if ( e.id ) { if ( this._seenPools.has( e.id ) ) return; this._seenPools.add( e.id ); }
		const by = e.by || 'player';
		if ( this._host() ) this.model.firePool( e.x, e.y ?? 0, e.z, by );
		else this._forward( { k: 'fire', x: e.x, y: e.y ?? 0, z: e.z, by } );
		if ( by === 'player' ) this._heatAt( this.model.near( e.x, e.y ?? 0, e.z, FIRE.bottleReach ) );

	}

	// the weapons' fire pools without its firePool event (Weapons.fires: { id, x, y, z })
	_pollPools() {

		const w = this._get( 'weapons' );
		const list = w && Array.isArray( w.fires ) ? w.fires : null;
		if ( ! list ) return;
		for ( const f of list ) if ( f && f.id && ! this._seenPools.has( f.id ) ) this._onFirePool( { id: f.id, x: f.x, y: f.y, z: f.z, by: 'player' } );
		if ( this._seenPools.size > 200 ) this._seenPools = new Set( list.map( ( f ) => f.id ) );

	}

	_forward( d ) {

		const ns = this.app.netsync;
		if ( ! ns || typeof ns.askHost !== 'function' || ! this.model.near( d.x, d.y, d.z, ( d.r || 4 ) * 2 + 10 ).length && ! this.model._nearCity( d.x, d.z, 20 ) ) return;
		const r2 = ( v ) => Math.round( v * 100 ) / 100;
		if ( ns.askHost( 'cityHit', { k: d.k, x: r2( d.x ), y: r2( d.y ), z: r2( d.z ), r: d.r ? r2( d.r ) : undefined, e: d.e ? Math.round( d.e ) : undefined } ) ) this.stats.forwarded ++;

	}

	// a guest's hit, run on the host (by 'remote': the host's own heat is not raised)
	_onHostRequest( ev ) {

		if ( ! ev || ! this.model || ! this._host() ) return;
		const d = ev.data || {};
		if ( ev.kind === 'citySnap' ) { if ( ! ev.local ) this._sendStages( this.model.snapshot( false ), true ); return; }
		if ( ev.kind !== 'cityHit' || ev.local || ! Number.isFinite( d.x ) || ! Number.isFinite( d.z ) ) return;
		const x = d.x, y = Number.isFinite( d.y ) ? d.y : 1, z = d.z;
		const e = Math.min( Math.max( 0, Number( d.e ) || 0 ), 4000 ); // (a guest cannot level a block in one message)
		this.stats.remoteHits ++;
		if ( d.k === 'blast' ) this.model.blast( x, y, z, Math.min( 12, Math.max( 0.5, Number( d.r ) || 4.5 ) ), e, 'remote' );
		else if ( d.k === 'crash' ) this.model.crash( x, y, z, e, 'aircraft' );
		else if ( d.k === 'fire' ) this.model.firePool( x, y, z, 'remote' );

	}

	// ------------------------------------------------------------------ the model's word

	_modelEvent( name, p ) {

		this._emit( name, p );
		if ( p && typeof p.id === 'string' && ( name === 'buildingDamaged' || name === 'cityFire' || name === 'cityRepair' || name === 'buildingRepaired' || name === 'towerMarked' ) ) {

			this._netDirty.add( p.id );
			this._looks.delete( p.id );
			this._redraw = true;

		}

		if ( name === 'cityMood' && p.mood === 'panic' && p.previous !== 'panic' ) this._toast( 'citywreck.panic', 'Meridian is in a panic: the shops are shutting' );
		if ( name === 'cityDebris' && ! this.render ) this._debrisImpulse( p );

	}

	_onStage( b, stage, prev, info ) {

		// Physics follows authoritative damage immediately, even while visual collapse awaits a budget slot.
		const handle = this.city && this.city.building ? this.city.building( b.id ) : null;
		if ( handle && handle.setCollisionStage ) handle.setCollisionStage( stage );

		// the player's doing: heat for the stages their hits brought
		if ( stage > prev ) {

			const at = this._touched.get( b.id );
			if ( info.by === 'player' || ( at !== undefined && this.time - at < HEAT_MEMORY && ! info.silent ) ) this._addHeat( WANTED.perStage * ( stage - prev ) + ( stage === 3 ? WANTED.perCollapse : 0 ) );

		}

		if ( stage === 3 && prev < 3 && ! info.silent && this.render ) {

			// the handle's stage waits for an animation slot (at most COLLAPSE.animating fall at once)
			if ( ! this.queue.includes( b ) ) this.queue.push( b );
			return;

		}

		this.queue = this.queue.filter( ( q ) => q !== b );
		this.anims = this.anims.filter( ( a ) => a.b !== b || stage === 3 );
		this._setHandle( b, stage );

	}

	_setHandle( b, stage ) {

		const h = this.city && this.city.building ? this.city.building( b.id ) : null;
		if ( h && typeof h.setStage === 'function' && h.stage !== stage ) try { h.setStage( stage ); } catch ( e ) { console.warn( 'citywreck: setStage failed', b.id, e ); }
		this._dress( b.id );

	}

	_dress( id ) {

		this._looks.delete( id );
		this._redraw = true;

	}

	// ------------------------------------------------------------------ heat (the city's wanted level for the local player)

	_heatAt( ids ) {

		if ( ! ids || ! ids.length ) return;
		for ( const id of ids.slice( 0, 3 ) ) this._touched.set( id, this.time );
		this._addHeat( WANTED.perHit * Math.min( 3, ids.length ) );

	}

	_addHeat( v ) {

		this.heat = Math.min( WANTED.max, Math.max( 0, this.heat + v ) );
		this._setLevel();

	}

	_setLevel() {

		const level = wantedLevel( this.heat );
		if ( level === this.level ) return;
		const previous = this.level;
		this.level = level;
		this._emit( 'cityWanted', { level, previous, heat: Math.round( this.heat * 10 ) / 10 } );
		if ( level > previous ) {

			this._toast( 'citywreck.wanted', 'Meridian\'s police want you: wanted level {n}', { n: level } );
			const navy = this._get( 'navy' );
			if ( navy && typeof navy.addStanding === 'function' && level >= 2 ) try { navy.addStanding( - 2 * ( level - previous ), 'meridian' ); } catch ( e ) { /* optional */ }

		}

	}

	wanted() {

		return this.level;

	}

	// ------------------------------------------------------------------ per frame

	update( dt ) {

		if ( this.disposed || ! ( dt > 0 ) ) return;
		dt = Math.min( dt, 0.1 );
		this.time += dt;
		if ( ! this.model ) {

			if ( ( this._findT -= dt ) <= 0 ) { this._findT = 1; const c = this._findCity(); if ( c ) this.attach( c ); }
			if ( ! this.model ) return;

		}

		const hours = this._tickClock( dt );
		const host = this._host();
		this.model.puppet = ! host;
		const w = this._get( 'weather' );
		const rain = w ? Number( w.rain ?? ( w.current && w.current.rain ) ) || 0 : 0;
		this.model.update( dt, { rain, hours } );
		if ( hours > 0 && this.heat > 0 ) { this.heat = Math.max( 0, this.heat - WANTED.decayPerHour * hours ); this._setLevel(); }
		if ( ( this._poolT += dt ) > 0.5 ) { this._poolT = 0; this._pollPools(); }
		this._net( dt, host );
		this._animate( dt );
		this._vfx( dt );
		if ( this.render ) this._draw( dt );

	}

	_tickClock( dt ) {

		const st = this.app.settings;
		const h = st && typeof st.timeOfDay === 'number' && Number.isFinite( st.timeOfDay ) ? ( ( st.timeOfDay % 24 ) + 24 ) % 24 : null;
		let adv = 0;
		if ( h !== null ) {

			if ( this._lastHour !== null ) {

				adv = hoursForward( this._lastHour, h );
				if ( adv > 0.5 + dt * 0.1 ) adv = 0; // the clock was set, not run
				if ( adv === 0 && st.timeSpeed === 0 ) adv = dt * CLOCK_FALLBACK;

			}

			this._lastHour = h;

		} else adv = dt * CLOCK_FALLBACK;

		return adv;

	}

	// ------------------------------------------------------------------ multiplayer: the host's stage stream

	_net( dt, host ) {

		const ns = this.app.netsync;
		const online = !! ( ns && ns.online );
		if ( ! online ) { this._snapAsked = false; this._netDirty.clear(); return; }
		if ( ! host ) {

			// a guest asks once per connection for the city as the host has it
			if ( ! this._snapAsked && typeof ns.askHost === 'function' ) this._snapAsked = !! ns.askHost( 'citySnap', {} );
			this._netDirty.clear();
			return;

		}

		// fire changes worth sending (steps of NET.fireStep)
		for ( const b of this.model.list ) {

			if ( ! b.fire && ! this._fireStep.has( b.id ) ) continue;
			const s = Math.round( b.fire / NET.fireStep );
			if ( this._fireStep.get( b.id ) !== s ) { this._fireStep.set( b.id, s ); this._netDirty.add( b.id ); }
			if ( s === 0 ) this._fireStep.delete( b.id );

		}

		if ( ( this._netT += dt ) < NET.flush || ! this._netDirty.size ) return;
		this._netT = 0;
		const list = [];
		for ( const id of this._netDirty ) { const b = this.model.byId.get( id ); if ( b ) list.push( this.model.entry( b ) ); }
		this._netDirty.clear();
		this._sendStages( list, false );

	}

	_sendStages( list, snap ) {

		const ns = this.app.netsync;
		if ( ! ns || typeof ns.sendWorldEvent !== 'function' ) return;
		if ( ! list.length && snap ) { ns.sendWorldEvent( 'cityStages', { s: [], snap: 1 } ); return; }
		for ( let i = 0; i < list.length; i += NET.batch ) {

			const part = list.slice( i, i + NET.batch );
			if ( ns.sendWorldEvent( 'cityStages', snap ? { s: part, snap: 1 } : { s: part } ) ) this.stats.streamed += part.length;

		}

	}

	_onRemote( e ) {

		if ( ! e || e.kind !== 'cityStages' || ! e.data || ! this.model || this._host() ) return;
		const s = Array.isArray( e.data.s ) ? e.data.s : [];
		// (an old replayed batch is the same news again: apply is idempotent; a replay shows no collapse, only the heap)
		this.stats.applied += this.model.apply( s.slice( 0, 400 ), { remote: true, silent: !! e.replay } );

	}

	// ------------------------------------------------------------------ the collapses

	_animate( dt ) {

		if ( ! this.render ) {

			// (no drawing: the stage goes to the handle at once)
			while ( this.queue.length ) this._setHandle( this.queue.shift(), 3 );
			return;

		}

		while ( this.anims.length < COLLAPSE.animating && this.queue.length ) {

			const b = this.queue.shift();
			if ( b.stage !== 3 ) continue;
			this._setHandle( b, 3 );
			const heapN = this.phone ? COLLAPSE.heap.phone : COLLAPSE.heap.desktop;
			this.anims.push( { b, c: new Collapse( b, this.phone ? COLLAPSE.chunks.phone : COLLAPSE.chunks.desktop, { heapN } ), t: 0, landed: false } );
			this.stats.collapsesShown ++;
			this._dust( b, 0 );

		}

		for ( const a of this.anims ) {

			a.t += dt;
			if ( ! a.landed && a.t >= a.c.landedAt ) { a.landed = true; this._dust( a.b, 1 ); this._debrisImpulse( { x: a.b.x, y: a.b.y0, z: a.b.z, radius: a.b.radius + this.model.spillOf( a.b ), energy: a.b.hw * a.b.hd * a.b.top * 40 } ); }

		}

		const before = this.anims.length;
		this.anims = this.anims.filter( ( a ) => {

			if ( a.t < a.c.duration ) return true;
			this._dress( a.b.id );
			this._dust( a.b, 2 );
			return false;

		} );
		if ( this.anims.length || before ) this._redraw = true;

	}

	// dust: 0 as it starts to go, 1 as it lands, 2 settling (phones: a puff or two)
	_dust( b, phase ) {

		const vfx = this._get( 'vfx' );
		if ( ! vfx ) return;
		const n = this.phone ? 2 : phase === 1 ? 8 : 4;
		const r = b.radius + ( phase ? this.model.spillOf( b ) * 0.6 : 0 );
		try {

			for ( let i = 0; i < n; i ++ ) {

				const a = i / n * Math.PI * 2 + phase;
				vfx.dust && vfx.dust( b.x + Math.cos( a ) * r, b.y0 + 1 + ( phase === 0 ? b.top * 0.3 : 0 ), b.z + Math.sin( a ) * r, phase === 1 ? 1.6 : 1 );

			}

			if ( phase === 1 && ! this.phone ) {

				vfx.debris && vfx.debris( b.x, b.y0 + 2, b.z, 1.4, 'stone' );
				vfx.smoke && vfx.smoke( b.x, b.y0 + 3, b.z, 1.6, 0, 1, 0 );

			}

		} catch ( e ) { /* cosmetic */ }

		const cf = this.app.cameraFeel, p = this.app.player && this.app.player.position;
		if ( phase === 1 && cf && cf.kick && p && Math.hypot( p.x - b.x, p.z - b.z ) < 120 ) try { cf.kick( 'meleeHeavy', { scale: 0.6 } ); } catch ( e ) { /* optional */ }

	}

	// the falling debris on the props round it (destruction's impulse: crates, stalls, lamps)
	_debrisImpulse( p ) {

		const d = this._get( 'destruction' );
		if ( d && typeof d.impulse === 'function' && p && Number.isFinite( p.x ) ) try { d.impulse( p.x, ( p.y || 0 ) + 1, p.z, p.radius || 10, Math.min( p.energy || 2e5, 4e5 ) ); } catch ( e ) { /* optional */ }

	}

	// ------------------------------------------------------------------ fire and smoke

	_camera() {

		const c = this.app.camera;
		return c && c.position ? c.position : this.app.player && this.app.player.position ? this.app.player.position : null;

	}

	_vfx( dt ) {

		if ( ( this._vfxT += dt ) < 0.5 ) return;
		this._vfxT = 0;
		const vfx = this._get( 'vfx' );
		if ( ! vfx ) return;
		const cam = this._camera();
		const dist = ( b ) => ( cam ? Math.hypot( b.x - cam.x, b.z - cam.z ) : 0 );
		const hot = this.model.list.filter( ( b ) => b.fire > 0 || b.stage === 2 ).map( ( b ) => [ b, dist( b ) ] ).filter( ( [ , d ] ) => d < 2000 ).sort( ( a, c ) => a[ 1 ] - c[ 1 ] );
		const shown = new Set();
		const max = this.phone ? 2 : FIRE.shownMax;
		let smokes = this.phone ? 3 : 6;
		try {

			for ( const [ b, d ] of hot ) {

				const h = this.city && this.city.building ? this.city.building( b.id ) : null;
				const anchors = h && Array.isArray( h.fireAnchors ) && h.fireAnchors.length ? h.fireAnchors : this._anchors( b );
				const size = Math.min( 1.8, Math.max( 0.8, Math.sqrt( b.hw * b.hd ) / 6 ) );
				if ( b.fire > 0 && shown.size < max * 3 && vfx.fire ) {

					for ( let i = 0; i < Math.min( 3, anchors.length ) && shown.size < max * 3; i ++ ) {

						const a = anchors[ i ], id = 'cw:' + b.id + ':' + i;
						vfx.fire( id, a.x, a.y, a.z, Math.min( 4, ( 0.6 + b.fire * 1.6 ) * size ) );
						shown.add( id );

					}

				}

				// a smoke column from the roof while it burns or stands gutted
				if ( smokes > 0 && vfx.smoke && d < 1600 ) {

					smokes --;
					vfx.smoke( b.x, b.y0 + b.top + 1, b.z, Math.min( 6, ( b.fire > 0 ? 0.8 + b.fire * 2.2 : 0.45 ) * size * ( b.top > 40 ? 1.4 : 1 ) ), 0, 1, 0 );

				}

				// the crews' hoses: steam where the water meets the fire
				if ( b.dousing && d < 300 && vfx.smoke ) vfx.smoke( anchors[ 0 ].x, anchors[ 0 ].y, anchors[ 0 ].z, 0.35, 0, 1, 0 );

			}

			for ( const id of this._fireShown ) if ( ! shown.has( id ) && vfx.stopFire ) vfx.stopFire( id );

		} catch ( e ) { /* cosmetic */ }

		this._fireShown = shown;

	}

	// where a building burns when its handle names no fire anchors: the roof and two windows on opposite faces
	_anchors( b ) {

		if ( b._anchors ) return b._anchors;
		const at = ( lx, ly, lz ) => ( { x: b.x + lx * b.cos + lz * b.sin, y: b.y0 + ly, z: b.z - lx * b.sin + lz * b.cos } );
		b._anchors = [ at( 0, b.top * 0.9, 0 ), at( b.hw * 0.5, Math.min( b.top * 0.5, 12 ), b.hd + 0.3 ), at( - b.hw * 0.4, Math.min( b.top * 0.35, 8 ), - b.hd - 0.3 ) ];
		return b._anchors;

	}

	// ------------------------------------------------------------------ drawing

	_draw( dt ) {

		const cam = this._camera();
		if ( cam && ( ! this._camAt || Math.hypot( cam.x - this._camAt.x, cam.z - this._camAt.z ) > 60 ) ) { this._camAt = { x: cam.x, z: cam.z }; this._redraw = true; }
		if ( ( this._lookT += dt ) >= LOOK_EVERY ) {

			this._lookT = 0;
			// repair progress moves the scaffolding / the heap: a new look every 5 %
			for ( const b of this.model.list ) {

				if ( ! b.repair ) continue;
				const L = this._looks.get( b.id );
				if ( L && L.q !== Math.floor( this.model.repairProgress( b ) * 20 ) ) { this._looks.delete( b.id ); this._redraw = true; }

			}

		}

		if ( ! this._redraw ) return;
		this._redraw = this.anims.length > 0;
		const R = this.render, far = RENDER.drawWithin;
		const animating = new Set( this.anims.map( ( a ) => a.b ) );
		const list = [];
		for ( const b of this.model.list ) {

			if ( ! ( b.stage || b.marks || b.repair ) || animating.has( b ) || this.queue.includes( b ) && b.stage === 3 ) continue;
			const d = cam ? Math.hypot( b.x - cam.x, b.z - cam.z ) : 0;
			if ( d - b.radius > far ) continue;
			list.push( [ b, d ] );

		}

		list.sort( ( a, c ) => a[ 1 ] - c[ 1 ] );
		R.begin();
		// the falling chunks first (they are the nearest thing that matters)
		for ( const a of this.anims ) for ( const it of a.c.at( a.t ) ) R.push( it );
		const heapN = this.phone ? COLLAPSE.heap.phone : COLLAPSE.heap.desktop;
		for ( const [ b ] of list ) {

			let L = this._looks.get( b.id );
			if ( ! L ) {

				const progress = this.model.repairProgress( b );
				L = { q: Math.floor( progress * 20 ), items: looks( b, { progress, heapN, phone: this.phone } ) };
				this._looks.set( b.id, L );

			}

			for ( const it of L.items ) if ( ! R.push( it ) ) break;

		}

		R.end();
		this.stats.dropped = R.dropped;

	}

	// ------------------------------------------------------------------ queries (cross-worker API)

	raycastSegment( ax, ay, az, bx, by, bz ) {

		return this.model ? this.model.raycast( ax, ay, az, bx, by, bz ) : null;

	}

	stage( id ) {

		const b = this.model && this.model.byId.get( id );
		return b ? b.stage : 0;

	}

	// a building's shop is open (not gutted, no panic). Not `isOpen`: Features.panelOpen() reads every feature's isOpen() as
	// "a panel of mine is up" and would block the cars' and the plane's controls, the rod and the chat for good
	shopOpen( id ) {

		return this.model ? this.model.isOpen( id ) : true;

	}

	// a townlife / interiors seat or spot: open unless its building is shut ({ building } or { id } naming one)
	seatOpen( seat ) {

		if ( ! seat || ! this.model ) return true;
		const id = seat.building || seat.buildingId || seat.id;
		if ( typeof id === 'string' && this.model.byId.has( id ) ) return this.model.isOpen( id );
		// a room's seat (interiors: seat.interior is the room id the plan's building names)
		if ( typeof seat.interior === 'string' ) for ( const b of this.model.list ) if ( b.p.interior === seat.interior ) return this.model.isOpen( b.id );
		return true;

	}

	blockedEdges() {

		return this.model ? this.model.blockedEdges() : new Set();

	}

	get mood() {

		return this.model ? this.model.mood : 'calm';

	}

	// lines for a notice board (the repair works, the damages claimed); port: only Meridian's board lists the works
	bulletin( port = 'meridian' ) {

		if ( ! this.model ) return [];
		return this.model.bulletin( { owedOnly: port !== 'meridian' } ).map( ( l ) => t( l.key, l.key === 'citywreck.board.owed' ? 'The city claims ${cost} in damages from the captain who did it.' : 'City works: {n} buildings under repair, ${cost} charged to the insurers.', { n: l.vars.n, cost: Number( l.vars.cost ).toLocaleString( 'en-US' ) } ) );

	}

	// the player settles the city's claim (a board's button / the police); returns what was paid
	payDamages() {

		const L = this.model && this.model.ledger;
		const st = this.features && this.features.state;
		if ( ! L || ! st ) return 0;
		const due = Math.max( 0, L.owed - L.paid );
		if ( ! due || typeof st.spend !== 'function' ) return 0;
		if ( st.spend( due ) === false ) return 0;
		L.paid += due;
		this.heat = Math.max( 0, this.heat - WANTED.at[ 1 ] );
		this._setLevel();
		return due;

	}

	info() {

		const m = this.model;
		if ( ! m ) return { attached: false };
		const by = [ 0, 0, 0, 0 ];
		for ( const b of m.list ) by[ b.stage ] ++;
		return { attached: true, buildings: m.list.length, stages: by, burning: m.list.filter( ( b ) => b.fire > 0 ).length, blocked: m.blockedEdges().size, mood: m.mood, wanted: this.level, heat: Math.round( this.heat * 10 ) / 10, animating: this.anims.length, queued: this.queue.length, instances: this.render ? this.render.n : 0, ...this.stats, model: m.stats };

	}

	// ------------------------------------------------------------------ save

	toJSON() {

		if ( ! this.model ) return this.pending;
		return { ...this.model.toJSON(), heat: Math.round( this.heat * 10 ) / 10 };

	}

	fromJSON( d ) {

		if ( ! d || typeof d !== 'object' ) return;
		if ( ! this.model ) { this.pending = d; return; }
		this.queue = [];
		this.anims = [];
		this.model.fromJSON( d );
		this.heat = Number.isFinite( d.heat ) ? Math.max( 0, d.heat ) : 0;
		this._setLevel();
		this._looks.clear();
		this._redraw = true;

	}

	reset() {

		this.pending = null;
		this.queue = [];
		this.anims = [];
		if ( this.model ) this.model.reset();
		this.heat = 0;
		this._setLevel();
		this._touched.clear();
		this._looks.clear();
		this._redraw = true;

	}

	dispose() {

		this.disposed = true;
		for ( const off of this._off ) try { off(); } catch ( e ) { /* gone */ }
		const vfx = this._get( 'vfx' );
		if ( vfx && vfx.stopFire ) for ( const id of this._fireShown ) try { vfx.stopFire( id ); } catch ( e ) { /* gone */ }
		if ( this.city ) this.city.onStage = this._prevHook || null;
		if ( this.render ) this.render.dispose();
		this.render = null;

	}

}


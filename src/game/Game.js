import { Vector3, Color, Matrix4 } from '../engine/index.js';
import { Contracts } from './Contracts.js';
import { tx } from '../i18n/index.js';
import { CHARACTERS } from './Characters.js';
import { BOATS } from './Boats.js';
import { WORLD } from '../world/WorldLayout.js';
import { FISH } from './FishTable.js';
import { habitatAt, pickSpecies, rollWeight, biteDelay, strikeWindow } from './Bites.js';
import { CatchMinigame } from './CatchMinigame.js';
import { GameState } from './GameState.js';
import { FishingRod } from './FishingRod.js';
import { FishStand } from './FishStand.js';
import { Chandlery } from './Chandlery.js';
import { CatchDisplay } from './CatchDisplay.js';
import { UPGRADES, fuelBurn } from './Gear.js';
import { GameHUD } from './GameHUD.js';
import { xpFor, repFor } from './Progression.js';
import { Minimap } from './Minimap.js';
import { Guide } from './Guide.js';

const panelOpenNow = ( hud ) => !! ( hud && ( hud.invOpen || hud.standOpen || hud.rosterOpen ) );

// how long the catch card stays up unless dismissed (ms)
const CATCH_CARD_MS = 9000;

// The fishing game on top of the world:
//   R          take out / put away the rod (on foot, on the pier, on the boat's deck)
//   hold LMB   wind up, release to cast (hold longer = farther)
//   LMB        strike when a fish takes the bobber ("!"); then hold LMB to reel, let go to ease off
//   RMB        reel an empty line back in
//   I / Tab    cooler / hold contents and the fish log
//   E          at the fish stand: sell your catch, take PoorGoat's quests; at the chandlery: gear, crew; at the yard: Captain Roid's boats
//   K          the crew: pick the character you play
//   Enter      chat (multiplayer)
//   Esc        closes the open panel / card; with none open the pause menu (ui/PauseMenu.js, opened by the App)
// The game mode (sandbox / campaign / multiplayer, game/GameMode.js) is the App's: state.mode decides what the yard,
// Ethena and the crew charge (state.free), and state.world / App.captureWorld keep where you are in the save.
export class Game {

	constructor( app ) {

		this.app = app;
		this.state = new GameState();
		this.state.load();
		this.contracts = new Contracts( this.state );
		this._handM = new Matrix4();
		this.rod = new FishingRod( { scene: app.scene, camera: app.camera, query: app.query, terrain: app.terrainData, audio: app.audio } );
		this.rod.onLand = ( where ) => this.onBobberLanded( where );
		this.stand = new FishStand( { scene: app.scene, terrain: app.terrainData, colliders: app.colliders } );
		this.display = new CatchDisplay( { scene: app.scene, stall: this.stand.iceFish() } );
		this.landing = null; // { species, kg } while the caught fish swings in view
		this.chandlery = new Chandlery( { scene: app.scene, terrain: app.terrainData, colliders: app.colliders, material: this.stand.material } );
		this.roid = app.roid || null;
		// first meeting (FirstEncounter) is remembered in the save; read through this.state so a loaded save counts
		if ( this.roid ) this.roid.hooks = {
			isMet: () => !! this.state.career.metRoid,
			setMet: () => { this.state.career.metRoid = true; },
			// subtitles for his clicks, one line every three seconds
			// captions go through the accessibility layer (size, background, off); the toast is the fallback
			subtitle: ( lines ) => lines.forEach( ( l, i ) => setTimeout( () => {

				const ax = this.app.accessibility;
				if ( ! ax || typeof ax.subtitle !== 'function' ) this.toast( `Captain Roid: *click click* ${ l }`, 2900 );
				else ax.subtitle( l, 2900, { speaker: tx( 'Captain Roid' ), cue: '*click click*' } );

			}, i * 3000 ) ),
		};
		this.vendors = [ this.stand.vendor, this.chandlery.vendor ];
		if ( this.roid ) this.vendors.push( this.roid.vendor );
		this.pons = app.pons || null; // Pons Cove's fish market (second island)
		if ( this.pons ) this.vendors.push( this.pons.vendor );
		this.ports = app.ports || null; // Gull Rock and Saltmarsh Key
		if ( this.ports ) this.vendors.push( ...this.ports.vendors );
		// boat upgrades: engine (thrust / top speed) and deck floodlights for night fishing
		this.floods = [];
		if ( app.localLights ) this.addFloodlights( app.localLights, app.boat );
		this._fuelOut = false;
		this._sonarT = 0;
		this._sonar = null;
		this.hud = null;
		this.fight = null; // CatchMinigame while a fish is on
		this.bite = null; // { phase: 'wait' | 'nibble' | 'take', t, nibbles, species, kg }
		this._lmb = false;
		this._rmb = false;
		this._hookedSpecies = null;
		this._pier = WORLD.pier;
		this._tmp = new Vector3();
		this.applyGear();
		this.state.onChange( () => this.applyGear() );

	}

	applyGear() {

		const g = this.state.stats;
		this.rod.setGear( { castM: g.castM, reelSpeed: g.reelSpeed } );
		const b = this.app.boatCtl;
		if ( b && this.state.boat ) {

			// the boat's engine (Boats.js) with the engine upgrade on top
			b.maxThrust = g.maxThrust;
			b.pitchSpeed = g.pitchSpeed;

		}

		for ( const f of this.floods || [] ) f.scale = g.deckLights ? 1 : 0;

	}

	// two floodlights under the back of the wheelhouse roof, lighting the cockpit and the water
	// astern (night only, like every local light; switched by the lights upgrade)
	addFloodlights( lights, boat ) {

		for ( const f of this.floods ) lights.remove( f );
		this.floods = [];
		if ( ! boat || ! boat.lines || ! boat.lines.houseFront ) return; // the fleet hulls have no wheelhouse roof
		const obj = boat.group;
		for ( const x of [ - 0.8, 0.8 ] ) {

			const local = new Vector3( x, 2.25, - 1.0 );
			const localDir = new Vector3( x * 0.25, - 0.75, - 0.62 ).normalize();
			const src = {
				position: new Vector3(), color: new Color( 1.0, 0.93, 0.8 ), intensity: 3.2, range: 14, kind: 'boatFlood',
				dir: new Vector3(), cosInner: 0.8, cosOuter: 0.45, scale: 0,
				update() {

					obj.updateWorldMatrix( true, false );
					this.position.copy( local ).applyMatrix4( obj.matrixWorld );
					this.dir.copy( localDir ).transformDirection( obj.matrixWorld );

				},
			};
			src.update();
			this.floods.push( src );
			lights.add( src );

		}

	}

	// wave 13: the story's chandler discount at this port ("A ferry to Tidemark": 10 % at Marlow's)
	chandlerDiscount() {

		const story = this.app.features?.get?.( 'story' );
		return story && story.discount ? story.discount( `chandler:${ this._salePort() }` ) || 0 : 0;

	}

	buy( key ) {

		const r = this.state.buy( key, this.app.features?.get( 'trade' )?.credit?.standing ?? null, this.chandlerDiscount() );
		if ( r ) this.toast( `${ UPGRADES[ key ].name }: ${ r.label }` );
		return r;

	}

	// ---- the yard, the crew and PoorGoat's quests

	buyBoat( id ) {

		const b = BOATS[ id ];
		if ( ! b ) return false;
		const price = this.state.boatPrice( id );
		if ( ! this.state.buyBoat( id ) ) {

			this.toast( price > this.state.money ? `The ${ b.name } costs $${ price } · you have $${ this.state.money }` : 'That one is already yours', 2600 );
			return false;

		}

		this.app.setBoat( id );
		this.toast( `${ b.name } · yours. It is moored at the pier head.`, 3600 );
		if ( this.app.audio && this.app.audio.coin ) this.app.audio.coin();
		return true;

	}

	// called by App.setBoat once the model is in the scene
	onBoatChanged( model, id ) {

		if ( this.app.localLights ) this.addFloodlights( this.app.localLights, model );
		this._fuelOut = false;
		this.applyGear();
		if ( this.app.net ) this.app.net.setProfile( { boat: id } );

	}

	unlockCharacter( id ) {

		const c = CHARACTERS[ id ];
		if ( ! c ) return false;
		if ( ! this.state.unlockCharacter( id ) ) {

			if ( c.unlock.kind === 'buy' ) this.toast( `${ c.name } asks $${ c.unlock.cost } to join · you have $${ this.state.money }`, 2600 );
			return false;

		}

		this.toast( `${ c.name } joined the crew`, 2600 );
		if ( this.app.audio && this.app.audio.coin ) this.app.audio.coin();
		return true;

	}

	setCharacter( id ) {

		if ( ! this.state.setCharacter( id ) ) return false;
		if ( this.app.avatar ) this.app.avatar.setCharacter( id );
		if ( this.app.net ) this.app.net.setProfile( { character: id } );
		this.toast( `Now playing as ${ CHARACTERS[ id ].name }`, 2200 );
		return true;

	}

	deliverContract( id ) {

		const r = this.contracts.deliver( id );
		if ( ! r ) return null;
		// progression: quest xp and home-port reputation
		const money = r.money || 0;
		const gain = this.state.addXp( xpFor( 'quest', { money } ) );
		this.state.addRep( 'home', repFor( 'quest', { money } ) );
		let text = r.money ? `PoorGoat pays $${ r.money }` : 'Done';
		if ( r.unlock && CHARACTERS[ r.unlock ] ) text += ` · ${ CHARACTERS[ r.unlock ].name } joins the crew (K)`;
		if ( gain && gain.levelUp ) text += ` · Level ${ gain.levelUp }`;
		this.toast( text, 3600 );
		if ( this.app.audio && this.app.audio.coin ) this.app.audio.coin();
		return r;

	}

	// at the helm: oars on the skiff, a paddle on the canoe, the tiller / wheel on the rest
	helmAction() {

		const b = this.app.boatCtl, spec = BOATS[ this.state.boat ];
		if ( ! spec ) return 'helm';
		const ahead = b.throttle > 0.05, astern = b.throttle < - 0.05, steer = b.steer;
		if ( spec.drive === 'row' ) return ahead ? 'rowForward' : astern ? 'rowBackward' : 'seated';
		if ( spec.drive === 'paddle' ) {

			if ( ! ahead && ! astern ) return 'seated';
			// alternate sides every two seconds, biased by the steering
			const side = steer > 0.2 ? 1 : steer < - 0.2 ? - 1 : ( Math.floor( this.app.renderer && this.app.renderer.time ? this.app.renderer.time / 2 : performance.now() / 2000 ) % 2 ? 1 : - 1 );
			return side > 0 ? 'paddleLeft' : 'paddleRight';

		}

		if ( steer > 0.3 ) return 'steerLeft';
		if ( steer < - 0.3 ) return 'steerRight';
		return 'helm';

	}

	// the avatar's action from the fishing state (player/Avatar.js clips)
	avatarAction() {

		const rod = this.rod, p = this.app.player;
		// a fight on foot (src/features/melee): swing, hit reaction, knockdown, getting up
		const melee = this.app.features && this.app.features.get( 'melee' );
		const act = melee && melee.playerAction;
		// knocked down: the body falls as a ragdoll (Avatar.ragdoll), then gets up where it landed
		const av = this.app.avatar;
		if ( act === 'knockdown' && av && av.ragdoll && ! av.ragdolling && ! this._ragdolled ) {

			this._ragdolled = true;
			const y = p.yaw;
			try {

				av.onRagdollEnd = ( feet, yaw ) => {

					if ( feet ) p.position.set( feet.x, feet.y, feet.z );
					if ( Number.isFinite( yaw ) ) p.yaw = yaw;
					p.velocity.set( 0, 0, 0 );

				};
				av.ragdoll( { x: Math.sin( y ) * 3, y: 2, z: Math.cos( y ) * 3 }, { ground: ( x, z ) => this.app.terrainData.heightAt( x, z ) } );

			} catch ( e ) { console.warn( 'ragdoll failed', e ); }

		}

		if ( act !== 'knockdown' && ! ( av && av.ragdolling ) ) this._ragdolled = false;
		if ( av && av.ragdolling ) {

			// no control while the body is down
			p.velocity.set( 0, 0, 0 );
			p.launched = Math.max( p.launched || 0, 0.05 );
			return null;

		}

		if ( act ) return act;
		if ( p.launched > 0 ) return 'tumble';
		// the pull-up out of the water (Player's swim climb): AnimDef's climbUp montage, held past the step onto the top
		if ( p._climb > 0 ) this._climbUntil = performance.now() + 800;
		if ( performance.now() < ( this._climbUntil || 0 ) ) return 'climbUp';
		const gun = this.app.features && this.app.features.get( 'firearms' ) ? this.app.features.get( 'firearms' ).playerAction : null;
		if ( gun ) return gun;
		if ( p.mode === 'boat' ) return this.helmAction();
		if ( this.landing ) return this.landing.kg >= 2 ? 'celebrate' : 'inspect';
		if ( p.mode === 'seat' && ! rod.equipped ) return p.action === 'sitDown' ? 'sitDown' : 'seated';
		if ( ! rod.equipped ) return this.hud && this.hud.standOpen ? 'talk' : null;
		// the avatar's fishing clips are procedural (tools/roster/fishing_pose.py) and play on the avatar's UPPER-BODY overlay
		// over its locomotion (walking or running with the rod out steps with the legs and holds with the arms; swimming and
		// the helm have no rod): charge swings the rod back over the shoulder while the button is down, cast whips forward so
		// the rod passes the release angle 0.09 s after rod.release() (when the bobber leaves the tip) and follows through
		// toward the water, then it rests in the ready stance; reel and fight turn at the real crank rate
		// (av: the avatar, above)
		if ( av ) av.actionRate = rod.state === 'fighting' ? 0.7 + 0.4 * Math.min( 1, Math.abs( ( this.fight && this.fight.surge ) || 0 ) ) : Math.max( 0.5, Math.min( 1.8, rod.crankRate || 1 ) );
		switch ( rod.state ) {

			case 'windup': return 'charge';
			case 'flick': case 'flying': return 'cast';
			case 'floating': return this.bite && this.bite.phase === 'take' ? 'strike' : 'hold';
			case 'fighting': return 'fight';
			case 'retrieving': return 'reel';
			default: return 'hold';

		}

	}

	refuel() {

		const l = this.state.refuel();
		if ( l > 0 ) {

			this._fuelOut = false;
			this.toast( `Filled up · ${ l.toFixed( 0 ) } L` );

		}

		return l;

	}

	// Pons Cove found (once per save): a toast, $100, and the progression discovery if the state has it
	// the weather speeds bites up (overcast, light rain) or slows them (storm): src/features/weather
	weatherBiteDelay( t ) {

		const F = this.app.features, w = F && F.get( 'weather' ), nv = F && F.get( 'naval' );
		const tr = F && F.get( 'trade' );
		if ( tr && tr.operating && Number.isFinite( t ) ) t *= tr.operating.useBait(); // a bait per cast; slower bites without any
		if ( ! Number.isFinite( t ) ) return t;
		let m = 1;
		try { m = w ? w.biteModifier() || 1 : 1; } catch ( e ) { m = 1; }
		try { m *= nv && nv.biteBonus ? nv.biteBonus() || 1 : 1; } catch ( e ) { /* keep the weather's */ } // the lantern rig
		let hc = 1;
		for ( const n of [ 'harbour', 'crafting' ] ) { const f = F && F.get( n ); try { hc *= f && f.biteModifier ? f.biteModifier() || 1 : 1; } catch ( e ) { /* ignore */ } }
		m *= Math.min( 1.8, hc ); // tavern buffs, bait and lures
		return t / Math.max( 0.3, m );

	}

	// which port a sale happens at: Pons' market when the player is near it, else home
	_salePort() {

		const pons = this.app.pons, p = this.app.player.position;
		const ports = this.app.ports, at = ports && ports.near ? ports.near( p ) : null;
		if ( at ) return at; // wave 13: Tidemark's fish hall and chandler say 'tidemark'
		return pons && pons.near && pons.near( p ) ? 'pons' : 'home';

	}

	discoverPort( id ) {

		const st = this.state;
		if ( typeof st.discover !== 'function' || ! st.discover( id ) ) return;
		const port = ( WORLD.ports || [] ).find( ( x ) => x.id === id );
		st.earn( 100 );
		this.toast( `Discovered ${ port ? port.name : id }`, 3600 );

	}

	// a buyer's premium on some species (Saltmarsh Key): paid on top of the sale
	_portPremium( sold ) {

		const P = this.ports, v = this.hud && this.hud.vendor;
		if ( ! P || ! v || ! P.premiumBonus || ! sold.length ) return 0;
		let bonus = 0;
		try { bonus = Math.round( P.premiumBonus( v, sold ) || 0 ); } catch ( e ) { bonus = 0; }
		if ( bonus > 0 ) this.state.earn( bonus );
		return bonus;

	}

	discoverPons() {

		const st = this.state;
		const first = typeof st.discover === 'function' ? st.discover( 'pons' ) : ! st.career.ponsFound;
		if ( ! first ) return;
		if ( typeof st.discover !== 'function' ) st.career.ponsFound = true;
		st.earn( 100 );
		this.toast( 'Discovered Pons Cove', 3600 );

	}

	toast( text, ms = 2600 ) {

		if ( this.hud ) this.hud.toast( text, ms );
		else console.log( '[game]', text );

	}

	get canFish() {

		const app = this.app, p = app.player;
		if ( this.state && this.state.rodBroken ) return false;
		// at the helm of a boat that is (nearly) stopped the rod comes out too: fishing from inside the boat
		const helmStill = p.mode === 'boat' && app.boatCtl && app.boatCtl.speed < 0.8;
		return ! app.freeCam && ( p.mode === 'walk' || p.mode === 'deck' || p.mode === 'seat' || helmStill ) && ! ( app.ui && app.ui.ui && app.ui.ui._photo );

	}

	// ---- per frame (after the player / camera update)
	update( dt ) {

		const app = this.app, p = app.player, inp = app.input, rod = this.rod;
		this._cardDismissed = false;
		if ( ! this.hud && app.ui && app.ui.ui && typeof document !== 'undefined' && document.head ) {

			const ui = app.ui.ui;
			this.hud = new GameHUD( ui, this );
			// the minimap (lower right) and the first-play guide (intro, one-time tips; replay from F1)
			this.minimap = new Minimap( ui.hud || ui.root, this );
			this.guide = new Guide( ui, this, this.minimap );
			ui.onReplayGuide = () => this.guide.replay();

		}

		const can = this.canFish;
		this._dt = dt;
		const gunDrawn = !! ( app.features && app.features.get( 'firearms' ) && app.features.get( 'firearms' ).drawn ); // (R reloads the gun then)
		if ( inp.hit( 'KeyR' ) && ! gunDrawn && this.state.rodBroken && ! this.fight ) this.toast( 'Your rod is broken: Ethena Prosper repairs rods at the chandlery', 2600 );
		if ( inp.hit( 'KeyR' ) && ! gunDrawn && can && ! this.fight ) {

			this._rodUsed = true;
			rod.equip( ! rod.equipped );
			if ( ! rod.equipped ) this.cancelLine();
			this.toast( rod.equipped ? 'Rod out · hold left mouse to cast' : 'Rod away', 1600 );

		}

		if ( ! can && rod.equipped ) {

			// swimming, driving, free camera: the line comes in and the rod goes away
			this.cancelLine( true );
			rod.equip( false );

		}

		const navalAiming = !! ( app.features && app.features.get( 'naval' ) && app.features.get( 'naval' ).aiming ); // (Tab cycles the aim section then)
		if ( this.hud && ( inp.hit( 'KeyI' ) || ( inp.hit( 'Tab' ) && ! navalAiming ) ) ) this.hud.toggleInventory();
		if ( this.hud && inp.hit( 'KeyK' ) && this.hud.toggleRoster ) this.hud.toggleRoster();
		if ( this.hud && inp.hit( 'Escape' ) ) {

			if ( app.features ) app.features.closePanels();
			this.hud.toggleInventory( false );
			this.hud.closeStand();
			if ( this.hud.toggleRoster ) this.hud.toggleRoster( false );

		}

		// chat (multiplayer): Enter opens the line, the remote players' panel owns it
		if ( app.chat && app.net && inp.hit( 'Enter' ) && ! panelOpenNow( this.hud ) ) app.chat.open( ( text ) => app.net && app.net.chat( text ) );

		// mouse edges (the left button also looks around while the pointer isn't captured)
		const lmb = inp.mouseDown && inp.enabled, rmb = inp.rightDown && inp.enabled;
		const lDown = lmb && ! this._lmb, lUp = ! lmb && this._lmb, rDown = rmb && ! this._rmb;
		this._lmb = lmb;
		this._rmb = rmb;
		const panelOpen = ( this.hud && ( this.hud.invOpen || this.hud.standOpen || this.hud.rosterOpen ) ) || ( app.features && ( app.features.panelOpen() || app.features.wantsMouse() ) );

		if ( rod.equipped && ! panelOpen ) {

			if ( rod.state === 'idle' && lDown ) rod.startWindup();
			else if ( rod.state === 'windup' && lUp ) {

				rod.release();
				this.app.cameraFeel && this.app.cameraFeel.kick( 'cast' );

			}
			else if ( rod.state === 'floating' ) {

				if ( lDown ) this.strike();
				else if ( rDown ) {

					rod.retrieve();
					this.bite = null;

				}

			} else if ( rod.state === 'flying' && rDown ) rod.retrieve();

		}

		// bites and the fight
		if ( rod.state === 'floating' ) this.updateBite( dt );
		else if ( ! this.fight ) rod.dip = Math.max( 0, rod.dip - dt * 4 );
		if ( this.fight ) this.updateFight( dt, lmb && ! panelOpen );

		// third person: the rod sits in the character's hand; first person: off the camera
		const av = app.avatar;
		rod.anchor = av && av.visible && av.handMatrix( this._handM ) ? this._handM : null;
		p.action = this.avatarAction();
		rod.update( dt, { visible: can, fight: this.fight } );
		// the landed fish hangs on the end of the line, turned to face you, then goes in the cooler. With
		// the HUD the catch card comes up once the fish has swung in, and the fish stays (slowly turning)
		// until the card is dismissed (click, E, Esc) or times out.
		const L = this.landing;
		if ( L && rod.state === 'landing' && can ) {

			const c = app.camera.position, m = rod.bobber;
			let yaw = Math.atan2( c.x - m.x, c.z - m.z );
			if ( L.card ) {

				if ( ! L.shown && rod.t > 0.3 ) {

					L.shown = true;
					this.hud.showCatch( L.card, CATCH_CARD_MS );

				}

				if ( L.shown ) {

					// a slow turn so both flanks show
					L.cardT += dt;
					yaw += Math.sin( L.cardT * 0.7 ) * 0.55;
					if ( lDown || inp.hit( 'KeyE' ) || inp.hit( 'Escape' ) || L.cardT > CATCH_CARD_MS / 1000 ) {

						this._cardDismissed = true; // this frame's E / click belong to the card
						this.endLanding();

					}

				}

			}

			if ( this.landing ) {

				// with the HUD the fish is shown on the full-screen catch card (studio portrait), not on
				// the line; without it (headless) it hangs on the line for a moment
				if ( ! L.card ) this.display.show( L.species, L.kg, m, yaw, dt );
				else if ( this.display.shown ) this.display.hide();
				if ( ! L.card && rod.t > 2.8 ) this.endLanding();

			}

		} else if ( this.landing || this.display.shown ) this.endLanding();

		p.busy = rod.lineInWater || rod.state === 'windup';

		this.updateBoat( dt );

		// the traders, then the islanders (vendor prompts win)
		for ( const v of this.vendors ) v.update( dt, p.mode === 'walk' ? p.position : null );
		if ( this.roid ) this.roid.update( dt, p.mode === 'walk' ? p.position : null );
		if ( this.pons ) {

			this.pons.update( dt, p.mode === 'walk' ? p.position : null );
			// first time on foot at the cove: the discovery bonus
			const atPons = p.mode === 'walk' && this.pons.near( p.position );
			if ( atPons && ! this._atPons && this.app.features ) this.app.features.emit( 'portVisited', { port: 'pons' } );
			this._atPons = atPons;
			if ( atPons ) this.discoverPons();

		}

		if ( this.ports ) {

			this.ports.update( dt, p.mode === 'walk' ? p.position : null );
			// the other ports: arrival events and the first-landing discovery
			const at = p.mode === 'walk' ? this.ports.near( p.position ) : null;
			if ( at && at !== this._atPort && this.app.features ) this.app.features.emit( 'portVisited', { port: at } );
			this._atPort = at;
			if ( at ) this.discoverPort( at );

		}
		this.updateVendors( inp, p );
		this.updateResidents( inp, p );

		// prompts when the player has nothing to say
		if ( ! p.prompt && can ) p.prompt = this.prompt();

		const aboard = p.mode === 'boat' || p.mode === 'deck' || p.mode === 'seat';
		this.state.career.playSeconds += dt;
		// the catch card's live fish portrait (or one queued thumbnail)
		if ( this.hud && this.hud.portrait ) this.hud.portrait.update( dt );
		if ( this.hud ) this.hud.update( {
				fuel: aboard && this.state.boat ? { litres: this.state.fuelL, tank: this.state.stats.fuelL } : null,
			sonar: aboard && this.state.stats.finder ? this._sonar : null,
			fight: this.fight,
			casting: rod.state === 'windup',
			power: rod.power,
			bite: this.bite && this.bite.phase === 'take',
			aiming: rod.equipped,
			stamina: p.stamina,
		} );
		if ( this.minimap ) this.minimap.update( dt );
		if ( this.guide ) this.guide.update( dt );

	}

	prompt() {

		const rod = this.rod, p = this.app.player;
		if ( ! rod.equipped ) {

			// no boat yet: the empty berth at the pier head points to the yard
			if ( ! this.state.boat && p.mode === 'walk' && p.position.distanceTo( WORLD.boatDock.position ) < 9 ) return { key: '$', text: 'Your berth · buy a boat from Captain Roid at the yard east of the pier' };

			// by the water (boat deck, pier, the wet beach, wading): suggest the rod, briefly, and only
			// until the player has cast once (it is a tip, not a standing prompt)
			if ( this.state.career.caught > 0 || this._rodUsed ) return null;
			const byWater = p.mode === 'deck' || p.mode === 'seat' || ( p.mode === 'walk' && [ 'wood', 'wetsand', 'water' ].includes( p.surface ) );
			if ( ! byWater ) {

				this._rodTipT = 0;
				return null;

			}

			this._rodTipT = ( this._rodTipT || 0 ) + ( this._dt || 0 );
			return this._rodTipT < 6 ? { key: 'R', text: 'Take out the rod' } : null;

		}

		const b = this.bite;
		switch ( rod.state ) {

			case 'idle': return { key: 'LMB', text: 'Hold to wind up, release to cast   ·   R  put the rod away' };
			case 'windup': return { key: 'LMB', text: 'Release to cast (hold longer to cast farther)' };
			case 'flying': return null;
			case 'floating':
				if ( b && b.phase === 'take' ) return { key: 'LMB', text: 'Strike now!' };
				if ( b && b.phase === 'nibble' ) return { key: '…', text: 'Something\'s nibbling · wait until the bobber is pulled under' };
				return { key: 'RMB', text: 'Waiting for a bite · right-click to reel the line in' };
			case 'retrieving': return { key: 'RMB', text: 'Reeling in' };
			case 'fighting':
				if ( this.fight && this.fight.kind === 'marker' ) return { key: 'LMB', text: 'Click when the marker is in the zone' };
				return this.fight && this.fight.tension > this.fight.band[ 1 ]
				? { key: 'LMB', text: 'Too much tension · let go!' }
				: { key: 'LMB', text: 'Hold to reel · let go when the tension goes red' };
			case 'landing': return null;
			default: return null;

		}

	}

	// fuel burn at the helm (the engine stops when the tank is dry) and the fish finder
	updateBoat( dt ) {

		const app = this.app, b = app.boatCtl, p = app.player, s = this.state;
		// a holed hull is slower (src/features/naval)
		const nv = app.features && app.features.get( 'naval' );
		if ( s.boat ) {

			const st = s.stats;
			const k = nv && Number.isFinite( nv.speedFactor ) ? nv.speedFactor : 1;
			const op = this.app.features && this.app.features.get( 'trade' ), k2 = op && op.operating ? op.operating.speedFactor() : 1; // unpaid upkeep slows the boat
			const cw = this.app.features && this.app.features.get( 'crew' ), k3 = cw && cw.speedFactor ? cw.speedFactor() : 1; // wave 19C: the crew's best sailor trims her
			if ( Number.isFinite( st.maxThrust ) ) b.maxThrust = st.maxThrust * k * k2 * k3;

		}

		if ( b.driven && s.boat ) {

			const left = s.burn( fuelBurn( b.rpm ) * dt );
			if ( left <= 0 ) {

				b.throttle = 0;
				if ( ! this._fuelOut ) this.toast( 'Out of fuel · buy diesel at the chandlery by the boathouse', 4000 );
				this._fuelOut = true;

			}

		} else if ( this._wasDriven ) s.save();
		this._wasDriven = b.driven;

		if ( ( p.mode === 'boat' || p.mode === 'deck' ) && s.stats.finder ) {

			this._sonarT -= dt;
			if ( this._sonarT <= 0 ) {

				this._sonarT = 0.5;
				const x = b.position.x, z = b.position.z;
				const depth = Math.max( 0, - app.terrainData.heightAt( x, z ) );
				const h = this.habitatAtPoint( x, z, depth );
				let rich = 0;
				for ( const k in h ) rich += h[ k ];
				this._sonar = { depth, fish: Math.min( 1, rich / 1.4 ) };

			}

		}

	}

	updateVendors( inp, p ) {

		const hud = this.hud;
		let near = null;
		if ( p.mode === 'walk' ) for ( const v of this.vendors ) if ( v.inRange( p.position ) ) near = v;
		for ( const v of this.vendors ) v.talking = !! ( hud && hud.standOpen && hud.vendor === v );
		if ( hud && hud.standOpen && ( ! near || near !== hud.vendor ) ) hud.closeStand();
		if ( ! near || this.fight || this._cardDismissed || ( hud && hud.catchOpen ) ) return;
		if ( ! p.prompt ) p.prompt = { key: 'E', text: hud && hud.standOpen ? 'Leave' : `Talk to ${ near.name.split( ' ·' )[ 0 ] }` };
		if ( inp.hit( 'KeyE' ) ) {

			if ( ! hud ) {

				if ( near.kind === 'buyer' ) this.sellAll(); // headless: straight sale

			} else if ( hud.standOpen ) hud.closeStand();
			else hud.openStand( near );

		}

	}

	// the v2 features' E spots (market stalls, notice boards...): when nothing else has the prompt
	updateFeatureInteract( inp, p ) {

		const F = this.app.features;
		if ( ! F || ( p.mode !== 'walk' && p.mode !== 'ride' && p.mode !== 'deck' ) || this.fight || p.prompt || this._cardDismissed ) return;
		if ( this.hud && ( this.hud.standOpen || this.hud.catchOpen || this.hud.invOpen ) ) return;
		const it = F.nearestInteractable( p.position );
		if ( ! it ) return;
		let text = null;
		try { text = it.prompt ? it.prompt() : null; } catch ( e ) { text = null; }
		if ( text ) p.prompt = { key: 'E', text };
		// (the E that just put the player out of a car or a plane is spent: the door beside him is not pressed again)
		if ( inp.hit( 'KeyE' ) && ( p.sinceExit ?? Infinity ) > 0.3 ) {

			try { it.onInteract(); } catch ( e ) { console.warn( 'feature interaction failed', e ); }

		}

	}

	updateResidents( inp, p ) {

		const R = this.app.residents;
		const r = R && p.mode === 'walk' && ! this.fight ? R.nearest( p.position ) : null;
		if ( ! r ) {

			this.updateFeatureInteract( inp, p );
			return;

		}
		if ( ! p.prompt && ! ( this.hud && ( this.hud.standOpen || this.hud.catchOpen ) ) ) p.prompt = { key: 'E', text: `Talk to ${ r.name }` };
		if ( inp.hit( 'KeyE' ) && ! this._cardDismissed && ! ( this.hud && this.hud.standOpen ) ) {

			// a resident with a story (quest giver, memory): the conversation panel takes over the greeting
			const story = this.app.features && this.app.features.get( 'story' );
			if ( story && story.talkTo( r.id, { resident: r } ) ) { if ( r._talk ) r._talk(); return; }
			const res = R.interact( r, p, this );
			if ( res && res.line ) this.toast( `${ r.name }: ${ res.line }`, 3200 );
			if ( res && res.prank === 'launch' ) {

				p.launch( res.dir || { x: 0, z: 1 }, 9 );
				this.state.career.pranks = ( this.state.career.pranks || 0 ) + 1;
				this.state.save();
				if ( this.app.features ) this.app.features.emit( 'residentPrank', { id: r.id } );

			}

		}

	}

	sellAll() {

		const sold = [ ...this.state.inventory ];
		const r = this.state.sell();
		const bonus = r.count ? this._portPremium( sold ) : 0;
		r.total += bonus;
		r.total += r.count ? this.app.features?.get( 'trade' )?.fishSale?.( sold, this._salePort() ) || 0 : 0; // wave 15B: freshness and the port's taste
		if ( r.count && this.app.features ) this.app.features.emit( 'fishSold', { count: r.count, total: r.total, port: this._salePort() } );
		if ( r.count ) this.toast( `Sold ${ r.count } fish for $${ r.total }` );
		if ( this.app.audio && this.app.audio.coin ) this.app.audio.coin();
		return r;

	}

	sell( ids ) {

		const sold = this.state.inventory.filter( ( f ) => ids.includes( f.id ) );
		const r = this.state.sell( ids );
		const bonus = r.count ? this._portPremium( sold ) : 0;
		r.total += bonus;
		r.total += r.count ? this.app.features?.get( 'trade' )?.fishSale?.( sold, this._salePort() ) || 0 : 0; // wave 15B: freshness and the port's taste
		if ( r.count && this.app.features ) this.app.features.emit( 'fishSold', { count: r.count, total: r.total, port: this._salePort() } );
		if ( r.count ) this.toast( `Sold for $${ r.total }` );
		return r;

	}

	// ---- bites
	habitat() {

		return this.habitatAtPoint( this.rod.bobber.x, this.rod.bobber.z, this.rod.depth );

	}

	habitatAtPoint( x, z, depth ) {

		const b = { x, z };
		const reef = WORLD.reef;
		const reefDist = Math.hypot( b.x - reef.center.x, b.z - reef.center.z ) - reef.radius;
		const P = this._pier;
		const rect = ( x0, x1, z0, z1 ) => Math.hypot( Math.max( x0 - b.x, 0, b.x - x1 ), Math.max( z0 - b.z, 0, b.z - z1 ) );
		const walk = rect( P.x - P.width / 2, P.x + P.width / 2, P.zStart, P.zEnd );
		const head = rect( P.x - P.headWidth / 2, P.x + P.headWidth / 2, P.zEnd - P.headDepth, P.zEnd );
		return habitatAt( { depth, reefDist, pierDist: Math.min( walk, head ) } );

	}

	get hour() {

		return this.app.settings.timeOfDay;

	}

	onBobberLanded( where ) {

		if ( where !== 'water' ) {

			this.toast( 'Landed on the sand', 1400 );
			return;

		}

		this.bite = { phase: 'wait', t: this.weatherBiteDelay( biteDelay( this.habitat(), this.hour ) ) };

	}

	updateBite( dt ) {

		const rod = this.rod;
		const b = this.bite;
		if ( ! b ) return;
		b.t -= dt;
		// bobber motion for the cues
		if ( b.phase === 'nibble' ) rod.dip = Math.max( 0, Math.sin( Math.min( 1, ( b.pulse || 0 ) ) * Math.PI ) * 0.45 );
		else if ( b.phase === 'take' ) rod.dip += ( 1.4 - rod.dip ) * ( 1 - Math.exp( - dt * 14 ) );
		else rod.dip = Math.max( 0, rod.dip - dt * 3 );
		if ( b.phase === 'nibble' ) b.pulse = ( b.pulse || 0 ) + dt * 3.2;

		if ( b.t > 0 ) return;
		if ( b.phase === 'wait' ) {

			const h = this.habitat();
			const species = pickSpecies( h, this.hour );
			if ( ! species ) {

				b.t = 8;
				return;

			}

			b.species = species;
			b.kg = rollWeight( species );
			b.phase = 'nibble';
			b.nibbles = 1 + Math.floor( Math.random() * 3 );
			b.t = 0.7 + Math.random() * 0.8;
			b.pulse = 0;

		} else if ( b.phase === 'nibble' ) {

			b.nibbles --;
			b.pulse = 0;
			if ( b.nibbles > 0 ) b.t = 0.6 + Math.random() * 1.0;
			else {

				b.phase = 'take';
				// big, strong fish give a (slightly) shorter window
				b.t = strikeWindow( b.species );
				if ( this.app.audio && this.app.audio.fishSplash ) this.app.audio.fishSplash( rod.bobber, 0.35 );

			}

		} else if ( b.phase === 'take' ) {

			this.toast( 'It took the bait and ran', 1800 );
			this.bite = { phase: 'wait', t: this.weatherBiteDelay( biteDelay( this.habitat(), this.hour ) ) };

		}

	}

	strike() {

		const b = this.bite;
		if ( ! b || b.phase === 'wait' || b.phase === 'nibble' ) {

			// too early: a nibbling fish isn't hooked yet; it keeps nibbling (a hint, no penalty)
			if ( b && b.phase === 'nibble' ) this.toast( 'Not yet · wait for it to pull under', 1500 );
			if ( this.app.features ) this.app.features.emit( 'strikeMissed' );
			return;

		}

		const g = this.state.stats;
		this.fight = new CatchMinigame( { species: b.species, kg: b.kg, lineKg: g.lineKg, reelSpeed: g.reelSpeed, castM: g.castM, distance: Math.max( 3, this.rod.lineOut ) } );
		// the fishing assist (off by default) slows the tension and marks the save
		const ax = this.app.accessibility;
		if ( ax && ax.fishingAssist ) { this.fight.rateMul = ax.tensionRate(); this.state.career.assisted = ( this.state.career.assisted | 0 ) + 1; }
		this.bite = null;
		this.rod.hook();
		this.app.cameraFeel && this.app.cameraFeel.kick( 'strike' );
		this.toast( 'Fish on!', 1200 );

	}

	updateFight( dt, reeling ) {

		const f = this.fight;
		const st = f.update( dt, reeling );
		// the fish thrashes at the surface as each run starts
		const au = this.app.audio;
		if ( f.surge > 0.6 && ! f._splashed && au && au.fishSplash ) au.fishSplash( this.rod.bobber, 0.3 + 0.5 * Math.min( 1, f.kg / 8 ) );
		f._splashed = f.surge > 0.6 ? true : f.surge < 0.3 ? false : f._splashed;
		if ( st === 'fighting' ) return;
		this.fight = null;
		this.rod.dip = 0;
		const name = FISH[ f.species ].name;
		if ( st === 'caught' ) {

			const h = this.habitat();
			let habitat = 'bay', best = 0;
			for ( const k in h ) if ( h[ k ] > best ) { best = h[ k ]; habitat = k; }
			const entry = this.state.addFish( f.species, f.kg, this.hour, { habitat, aboard: this.app.player.mode !== 'walk' && this.app.player.mode !== 'swim' } );
			const info = this.state.lastCatch;
			this.contracts.onCatch( info );
			if ( this.app.features ) this.app.features.emit( 'fishCaught', { species: f.species, kg: f.kg, value: info.value, habitat, aboard: this.app.player.mode !== 'walk' && this.app.player.mode !== 'swim' } );
			if ( au && au.fishSplash ) au.fishSplash( this.rod.bobber, 0.8 );
			if ( au && au.fishFlop ) au.fishFlop();
			// the catch card (with a HUD) while the fish hangs on the line; a toast otherwise
			if ( this.hud ) this.landing = { species: f.species, kg: f.kg, card: info, cardT: 0 };
			else {

				if ( entry ) this.toast( `${ info.record ? 'New record! ' : '' }${ name } · ${ entry.kg.toFixed( 2 ) } kg · $${ entry.value }`, 3600 );
				else this.toast( `${ name } · ${ f.kg.toFixed( 1 ) } kg · no room in the ${ this.state.upgrades.hold > 0 ? 'hold' : 'cooler' }, let it go`, 3600 );
				this.landing = { species: f.species, kg: f.kg };

			}

			this.rod.land();
			this.app.cameraFeel && this.app.cameraFeel.kick( 'catch' );

		} else if ( st === 'snapped' ) {

			this.app.cameraFeel && this.app.cameraFeel.kick( 'snap' );
			this.toast( 'Snap! The line broke. Ease off when it runs: the crank held down piles on strain', 3200 );
			if ( au && au.lineSnap ) au.lineSnap();
			this.rod.setState( 'idle' );

		} else if ( st === 'broken' ) {

			// hauled far past the line's strength: the rod is broken until Ethena Prosper repairs it (free in sandbox)
			this.app.cameraFeel && this.app.cameraFeel.kick( 'snap' );
			if ( au && au.lineSnap ) au.lineSnap();
			this.rod.setState( 'idle' );
			this.state.rodBroken = ! this.state.free;
			this.rod.equip( false );
			this.cancelLine();
			this.toast( this.state.free ? 'Crack! You broke the rod (sandbox: it mends itself). Pump the rod: reel, ease off, reel' : 'Crack! You broke the rod. Ethena Prosper repairs rods at the chandlery', 4200 );
			this.state.save();

		} else {

			this.toast( 'It threw the hook', 2000 );
			this.rod.endFight();

		}

	}

	// the landed fish goes in the cooler: card, fish and line away
	endLanding() {

		this.landing = null;
		this.display.hide();
		if ( this.hud && this.hud.catchOpen ) this.hud.hideCatch();
		if ( this.rod.state === 'landing' ) this.rod.setState( 'idle' );

	}

	// line in at once (mode change)
	cancelLine( silent = false ) {

		if ( this.fight && ! silent ) this.toast( 'Lost it', 1400 );
		this.fight = null;
		this.bite = null;
		if ( this.rod.state !== 'stowed' ) this.rod.setState( this.rod.equipped ? 'idle' : 'stowed' );

	}

}

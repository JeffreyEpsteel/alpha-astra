// Plain-node test of the pirates feature (src/features/pirates): the sixteen named captains and their traits, the roster at sea
// through naval.spawn, the persistent ledger (a dead captain stays dead), notoriety and the corsair standing, dens on every island
// but home (and on islands added later), den raids with and without melee guards, the moored keeper's ship, retaliation raids at
// sea and on the harbour, tier 4-5 bounties with search zones, informants, proof and failure, multiplayer world events, regroup,
// the save and a fake-DOM run of the notoriety chip.
// Real: Features, Naval (no models, no HUD, no auto spawn), Melee and Boarding (stub avatars), GameState, TerrainData.
//   node test/feature-pirates.mjs
import { Vector3, Quaternion, Group, PerspectiveCamera } from '../src/engine/index.js';
import { Features } from '../src/features/Features.js';
import { Naval } from '../src/features/naval/Naval.js';
import * as meleeModule from '../src/features/melee/index.js';
import * as boardingModule from '../src/features/boarding/index.js';
import * as piratesModule from '../src/features/pirates/index.js';
import {
	CAPTAINS, CAPTAIN_BY_ID, TRAITS, factionFor, captainByName, Ledger, Notoriety, LEVELS, levelOf, HEAT, DEN_RULES, denSite,
	RAID_RULES, HB_RULES, CAPTURE_MULT,
} from '../src/features/pirates/index.js';
import { GameState } from '../src/game/GameState.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { ensureBlackwater } from '../src/world/islands/BlackwaterTerrain.js';
import { Colliders } from '../src/world/Colliders.js';
import { WORLD } from '../src/world/WorldLayout.js';
import { inSafeZone } from '../src/features/naval/Routes.js';
import { BOARD_SITES } from '../src/features/notices/Sites.js';

let fails = 0, passes = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else { passes ++; console.log( 'ok  ', msg ); }

};
const section = ( s ) => console.log( '\n== ' + s );
const DT = 1 / 20;
const terrain = new TerrainData();
ensureBlackwater( terrain ); // wave 14D: the pirates' island on its own tile (TerrainData does this itself once root applies the patch; idempotent)

// ---------------------------------------------------------------- stubs

class FakeModel {

	constructor() {

		this.clips = new Set( [ 'Idle_Breathe', 'Walk_InPlace', 'Run_InPlace', 'Melee_Paddle', 'Hit_Reaction', 'Knockdown', 'GetUp_Front', 'Stumble', 'Laugh', 'Look_Around', 'Swagger_Idle' ] );
		this.cur = null;
		this.layer = null;
		this.materials = [];

	}

	get current() { return this.cur; }

	play( name, { loop = true, speed = 1 } = {} ) {

		this.cur = name;
		this.layer = { name, time: 0, speed, ended: false, loop };
		return this.layer;

	}

	update( dt ) { if ( this.layer ) this.layer.time += dt * this.layer.speed; }

	hold() {}

}

function avatarFactory( o ) {

	const model = new FakeModel();
	return { group: new Group(), model, character: o.character, lite: o.lite, ready: Promise.resolve( model ), update() {}, dispose() { this.disposed = true; } };

}

class FakeInput {

	constructor() { this.keys = new Set(); this.pressed = new Set(); this.mouseDown = false; this.rightDown = false; this.enabled = true; }
	down( c ) { return this.keys.has( c ); }
	hit( c ) { return this.pressed.has( c ); }
	endFrame() { this.pressed.clear(); }

}

function makeWorld( o = {} ) {

	const events = [], toasts = [], shared = [];
	const state = new GameState( { getItem: () => null, setItem: () => {} } );
	state.boat = 'lobster';
	state.money = o.money ?? 5000;
	const start = WORLD.start.position;
	const player = {
		mode: 'walk', position: new Vector3( start.x, 2, start.z ), velocity: new Vector3(), yaw: 0, pitch: 0, stamina: 1, grounded: true, prompt: null, busy: false,
		seat: null, action: null, launched: 0,
		leaveHelm() { this.mode = 'deck'; }, groundAt: ( x, z ) => terrain.heightAt( x, z ),
	};
	const boat = {
		position: new Vector3( WORLD.boatDock.position.x, 0, WORLD.boatDock.position.z ), quaternion: new Quaternion(), velocity: new Vector3(), speed: 0, driven: false, moored: true,
		getYaw() { return 0; }, toWorld( l, out ) { return out.copy( l ).add( this.position ); }, reset() { this.moored = true; },
	};
	const app = {
		player, input: new FakeInput(), boatCtl: boat, camera: new PerspectiveCamera( 60, 16 / 9, 0.1, 2000 ), scene: { add() {}, remove() {} },
		game: { state, rod: { equipped: false, equip() {} }, toast: ( t ) => toasts.push( t ), cancelLine() {} },
		terrainData: terrain, colliders: new Colliders(), settings: { timeOfDay: 12, timeSpeed: 0 }, mode: o.mode || 'campaign', paused: false,
		avatar: { character: 'hyptile' }, ui: null, cameraFeel: { kick() {} },
		netsync: { sendWorldEvent: ( kind, data ) => shared.push( { kind, data } ) },
	};
	const features = new Features( app );
	for ( const n of [ 'denRaided', 'captainKilled', 'notorietyChanged', 'retaliationRaid', 'bountyClaimed', 'highBountyAccepted', 'highBountyFailed', 'shipSunk' ] ) features.on( n, ( e ) => events.push( [ n, e ] ) );
	const cargo = [];
	features.add( 'trade', { install: () => ( { cargo: {}, addCargo( good, qty ) { cargo.push( { good, qty } ); return qty; }, takeCargo() { return { qty: 0 }; } } ) } );
	const melee = o.melee ? features.add( 'melee', { install: ( a, f ) => meleeModule.install( a, f, { avatarFactory, hud: false, fx: false, seed: 5, captain: false, audio: { play() { return true; }, lead: () => 0.1, preload() {} } } ) } ) : null;
	const naval = features.add( 'naval', { install: ( a, f ) => new Naval( a, f, { seed: 7, hud: false, models: false, settings: { autoSpawn: false } } ) } );
	const boarding = features.add( 'boarding', { install: ( a, f ) => boardingModule.install( a, f, { avatarFactory, hud: false, seed: 11 } ) } );
	const pirates = features.add( 'pirates', { install: ( a, f ) => piratesModule.install( a, f, { seed: o.seed ?? 3, hud: false, avatarFactory } ) } );
	return { app, features, player, boat, state, melee, naval, boarding, pirates, events, toasts, shared, cargo };

}

const evs = ( w, name ) => w.events.filter( ( e ) => e[ 0 ] === name ).map( ( e ) => e[ 1 ] );
const run = ( w, seconds ) => { for ( let i = 0, n = Math.round( seconds / DT ); i < n; i ++ ) { w.features.update( DT ); w.app.input.endFrame(); } };
const sail = ( w, x, z ) => { w.player.mode = 'boat'; w.boat.moored = false; w.boat.position.set( x, 0, z ); w.player.position.set( x, 1, z ); };
const walk = ( w, x, z ) => { w.player.mode = 'walk'; w.boat.moored = true; w.player.position.set( x, terrain.heightAt( x, z ) + 0.1, z ); };
const sinkEvent = ( w, s, byPlayer = true, extra = {} ) => {

	s.startSinking ? s.startSinking() : ( s.state = 'sinking' );
	w.features.emit( 'shipSunk', { id: s.id, name: s.name, faction: s.faction, x: s.x, z: s.z, byPlayer, kind: s.kind, loot: 0, ...extra } );

};

// ---------------------------------------------------------------- data

section( 'the sixteen named captains' );
{

	ok( CAPTAINS.length === 16, '16 identities from the Unreal world catalog' );
	ok( new Set( CAPTAINS.map( ( c ) => c.captain ) ).size === 16 && new Set( CAPTAINS.map( ( c ) => c.ship ) ).size === 16, 'captain and ship names are unique' );
	ok( CAPTAINS.every( ( c ) => [ 'sloop', 'brigantine', 'trawler' ].includes( c.hull ) ), 'every hull is a naval ship class' );
	ok( CAPTAINS.every( ( c ) => c.traits.length && c.traits.every( ( t ) => TRAITS[ t ] ) ), 'every trait is a known trait' );
	ok( CAPTAINS.filter( ( c ) => c.hostile && c.tier >= 4 ).length >= 4, 'at least four tier 4-5 targets' );
	ok( CAPTAIN_BY_ID.BlackLantern.captain === 'Captain Black Lantern' && captainByName( 'Midnight Lantern' ) === CAPTAIN_BY_ID.BlackLantern, 'lookup by id, captain or ship' );
	ok( factionFor( CAPTAIN_BY_ID.HarbourWard ) === 'navy' && factionFor( CAPTAIN_BY_ID.HarbourWard, { notoriety: 4 } ) === 'pirate', 'the navy turns on a notoriety 4 skipper' );
	ok( factionFor( CAPTAIN_BY_ID.FlintFin ) === 'merchant' && factionFor( CAPTAIN_BY_ID.FlintFin, { notoriety: 3 } ) === 'pirate', 'hunters shoot at notoriety 3' );
	ok( factionFor( CAPTAIN_BY_ID.Redwake ) === 'pirate' && factionFor( CAPTAIN_BY_ID.ReedJack, { standing: 70 } ) === 'merchant', 'a corsair who likes you lets you pass' );

}

section( 'ledger' );
{

	const l = new Ledger();
	ok( l.isFree( 'Redwake' ) && l.status( 'Redwake' ) === 'free', 'everyone starts free' );
	ok( l.kill( 'Redwake', { day: 2 } ) && ! l.isFree( 'Redwake' ) && ! l.kill( 'Redwake' ), 'killed once, stays dead' );
	ok( l.capture( 'Mossbeard' ) && l.status( 'Mossbeard' ) === 'captured' && ! l.capture( 'Mossbeard' ), 'captured once' );
	ok( ! l.kill( 'Nobody' ), 'unknown captains are refused' );
	l.record( 'sunk', { id: 'Redwake', name: 'Mara Redwake', day: 2 } );
	for ( let i = 0; i < 80; i ++ ) l.record( 'crew', { name: 'x' } );
	ok( l.counts.sunk === 1 && l.counts.crew === 80 && l.entries.length === 60, 'counts kept, entries capped' );
	ok( l.namedTaken === 2, 'two named captains taken by the player' );
	const l2 = new Ledger();
	l2.fromJSON( JSON.parse( JSON.stringify( l.toJSON() ) ) );
	ok( l2.status( 'Redwake' ) === 'dead' && l2.status( 'Mossbeard' ) === 'captured' && l2.counts.crew === 80, 'save round trip' );
	l2.fromJSON( { captains: { Redwake: { state: 'zombie' }, Fake: { state: 'dead' } }, counts: { sunk: - 4 }, entries: 'x' } );
	ok( l2.isFree( 'Redwake' ) && l2.counts.sunk === 0 && l2.entries.length === 0, 'bad save data ignored' );

}

section( 'notoriety' );
{

	ok( levelOf( 0 ) === 0 && levelOf( LEVELS[ 3 ] ) === 3 && levelOf( 100 ) === 5, 'levels from heat' );
	const n = new Notoriety( { doc: { createElement: null } } );
	let r = n.add( 30, - 10 );
	ok( r.changed && r.level === 2 && n.standing === - 10, 'heat 30 is level 2' );
	r = n.cool( 10 );
	ok( n.heat < 30 && n.standing > - 10, 'it cools with in-game hours' );
	n.add( 500, 500 );
	ok( n.heat === 100 && n.standing === 100, 'clamped' );
	// fake DOM: the chip shows only above level 0
	const made = [];
	const el = () => {

		const e = { children: [], className: '', style: {}, classList: { set: new Set(), toggle( c, on ) { if ( on ) this.set.add( c ); else this.set.delete( c ); }, remove( c ) { this.set.delete( c ); } }, appendChild( c ) { this.children.push( c ); c.parentNode = this; }, removeChild( c ) { this.children.splice( this.children.indexOf( c ), 1 ); } };
		made.push( e );
		return e;

	};
	const doc = { createElement: el, head: el(), body: el() };
	const chip = new Notoriety( { doc } );
	chip.updateHud( 0.1 );
	ok( chip.el && ! chip.el.classList.set.has( 'is-on' ), 'chip hidden at level 0' );
	chip.add( 45, 0 );
	chip.updateHud( 0.1 );
	ok( chip.el.classList.set.has( 'is-on' ) && chip.pips.filter( ( p ) => p.className === 'on' ).length === 3, 'level 3: three pips lit' );
	chip.dispose();
	ok( doc.body.children.length === 0, 'disposed' );

}

// ---------------------------------------------------------------- the feature in a world

section( 'install and the roster at sea' );
{

	const w = makeWorld();
	const p = w.pirates;
	ok( p && w.features.get( 'pirates' ) === p, 'installed on the registry' );
	ok( p.dens.list.length === WORLD.islands.filter( ( i ) => i.id !== 'home' && i.den !== false ).length && ! p.dens.list.some( ( d ) => d.island === 'blackwater' ), `a den on every island but home and the stronghold (${ p.dens.list.length })` );
	// spawn by hand
	const s = p.roster.spawn( 'Brinehook', { x: 0, z: 600, yaw: 0 } );
	ok( s && w.naval.ships.includes( s ) && s.name === 'Salt and Splinters' && s.captain === 'Brinehook Bill' && s.kind === 'brigantine', 'naval.spawn puts the named ship to sea' );
	ok( s.traits.includes( 'boarder' ) && s.faction === 'pirate' && s.maxHp > 260, 'traits applied (tough hull, boarder)' );
	ok( p.roster.spawn( 'Brinehook', { x: 0, z: 600 } ) === null, 'one ship per captain' );
	const t = p.roster.spawn( 'PearlNell', { x: 100, z: 600 } );
	ok( t && t.kind === 'trawler' && t.faction === 'merchant' && t.traits.includes( 'informant' ), 'a smuggler trawler sails as a trader' );
	// ambient: the player ashore at the harbour, every 24 s one more while under the wanted count
	w.naval.ships.length = 0;
	p.roster.live.clear();
	run( w, 30 );
	const amb = [ ...p.roster.live.values() ];
	ok( amb.length === 1 && amb[ 0 ].alive, 'an ambient named captain puts to sea' );
	const pl = p.playerPos();
	ok( Math.hypot( amb[ 0 ].x - pl.x, amb[ 0 ].z - pl.z ) >= 340 && ! inSafeZone( amb[ 0 ].x, amb[ 0 ].z ), 'far from the player, out of the harbours' );
	ok( ! CAPTAIN_BY_ID[ amb[ 0 ].pirateId ].traits.includes( 'night' ), 'no night captain by day' );
	// naval drops her (surplus): the roster forgets her, she stays free
	amb[ 0 ].state = 'gone';
	run( w, 0.2 );
	ok( p.roster.live.size === 0 && p.ledger.isFree( amb[ 0 ].pirateId ), 'a ship naval let go is forgotten, the captain still free' );

}

section( 'a named captain killed stays dead' );
{

	const w = makeWorld();
	const p = w.pirates;
	const s = p.roster.spawn( 'TinShark', { x: 0, z: 600 } );
	const heat0 = p.wanted.heat;
	sinkEvent( w, s );
	ok( p.ledger.status( 'TinShark' ) === 'dead' && p.ledger.counts.sunk === 1, 'the ledger books the kill' );
	const k = evs( w, 'captainKilled' );
	ok( k.length === 1 && k[ 0 ].id === 'TinShark' && k[ 0 ].by === 'player', 'captainKilled emitted' );
	ok( w.shared.some( ( e ) => e.kind === 'captainKilled' && e.data.id === 'TinShark' ), 'shared with the other players (sendWorldEvent)' );
	ok( p.wanted.heat > heat0 && p.wanted.standing < 0, 'notoriety up, corsair standing down' );
	ok( evs( w, 'notorietyChanged' ).length >= 1, 'notorietyChanged emitted' );
	ok( p.notoriety() === p.wanted.heat && p.notorietyLevel() === p.wanted.level && p.standing() === p.wanted.standing, 'notoriety() 0..100 for other features (customs), notorietyLevel(), standing()' );
	ok( p.roster.spawn( 'TinShark', { x: 0, z: 600 } ) === null, 'she never sails again' );
	const p2 = makeWorld().pirates;
	p2.fromJSON( JSON.parse( JSON.stringify( p.toJSON() ) ) );
	ok( p2.ledger.status( 'TinShark' ) === 'dead' && p2.roster.spawn( 'TinShark', { x: 0, z: 600 } ) === null, 'still dead after a save and load' );
	// someone else got one
	const s2 = p.roster.spawn( 'Barnacle', { x: 0, z: 700 } );
	sinkEvent( w, s2, false );
	ok( p.ledger.status( 'Barnacle' ) === 'dead' && evs( w, 'captainKilled' ).pop().by === 'other' && p.ledger.counts.sunk === 1, 'killed by another: dead, not on the player\'s tally' );
	// anonymous merchants and pirates
	w.features.emit( 'shipSunk', { id: 'trawler-9', name: 'Pons Packet', faction: 'merchant', byPlayer: true } );
	ok( p.ledger.counts.merchants === 1 && p.wanted.standing > - 20, 'sinking a merchant: heat, and the corsairs like it' );

}

section( 'capture through boarding books the captain' );
{

	const w = makeWorld();
	const p = w.pirates;
	const s = p.roster.spawn( 'Redwake', { x: 0, z: 600 } );
	w.features.emit( 'prisonerTaken', { id: s.id, name: s.captain, ship: s.name, tier: 1, value: 200, bounty: false } );
	ok( p.ledger.status( 'Redwake' ) === 'captured' && p.ledger.counts.captured === 1, 'prisonerTaken -> captured' );
	sinkEvent( w, s, true, { boarded: true, how: 'captured' } );
	ok( p.ledger.status( 'Redwake' ) === 'captured' && p.ledger.counts.sunk === 0, 'the founder that follows does not turn it into a kill' );
	ok( evs( w, 'captainKilled' ).length === 1 && evs( w, 'captainKilled' )[ 0 ].how === 'captured', 'one captainKilled (how: captured)' );

}

section( 'dens' );
{

	const w = makeWorld();
	const p = w.pirates;
	for ( const d of p.dens.list ) {

		ok( terrain.heightAt( d.x, d.z ) > 0.3 && terrain.heightAt( d.mx, d.mz ) < - 3, `${ d.id }: camp on dry land (${ terrain.heightAt( d.x, d.z ).toFixed( 1 ) } m), mooring in deep water (${ terrain.heightAt( d.mx, d.mz ).toFixed( 1 ) } m)` );

	}

	ok( p.dens.list.every( ( d ) => CAPTAIN_BY_ID[ d.keeper ].hostile ), 'every den is kept by a hostile captain' );
	// a new island lands: it gets a den
	WORLD.islands.push( { id: 'testrock', center: new Vector3( - 300, 0, 900 ), radius: 60 } );
	run( w, 0.1 );
	ok( p.dens.byId( 'den-testrock' ) !== null, 'an island added later gets a den (WORLD.islands read dynamically)' );
	WORLD.islands.pop();
	run( w, 0.1 );
	ok( p.dens.byId( 'den-testrock' ) === null, 'and loses it when it goes' );
	// raid without melee: the guards run when you walk in
	const d = p.dens.list[ 1 ];
	walk( w, d.x + 30, d.z );
	run( w, 0.2 );
	ok( p.dens.found.has( d.id ) && d.awake, 'found and the guards are out' );
	ok( ! w.features.nearestInteractable( w.player.position ) || w.features.nearestInteractable( w.player.position ).id !== `pirates:${ d.id }`, 'no loot prompt while guarded' );
	walk( w, d.x + 2, d.z );
	run( w, 0.2 );
	ok( d.guardsLeft === 0, 'no melee: the guards give up the camp' );
	const it = w.features.nearestInteractable( w.player.position );
	ok( it && it.id === `pirates:${ d.id }` && /Loot/.test( it.prompt() ), 'E: Loot the den' );
	const money0 = w.state.money;
	it.onInteract();
	const raided = evs( w, 'denRaided' );
	ok( raided.length === 1 && raided[ 0 ].id === d.id && raided[ 0 ].coins > 0 && w.state.money === money0 + raided[ 0 ].coins, `raided: +$${ raided[ 0 ] && raided[ 0 ].coins }` );
	ok( w.cargo.length >= 1, 'cargo crates through trade.addCargo' );
	ok( w.shared.some( ( e ) => e.kind === 'denRaided' && e.data.id === d.id ), 'shared with the other players' );
	ok( ! p.dens.held( d ) && p.ledger.counts.raids === 1, 'the den is empty, the raid booked' );
	ok( ! w.features.nearestInteractable( w.player.position ) || w.features.nearestInteractable( w.player.position ).id !== `pirates:${ d.id }`, 'nothing left to loot' );
	p.advance( DEN_RULES.restock + 1 );
	ok( p.dens.held( d ), 'restocked after the restock hours' );
	ok( p.searchZones().some( ( z ) => z.kind === 'den' && z.id === d.id ), 'found dens are on the world map list' );
	// remote raid
	const d2 = p.dens.list[ 2 ];
	w.features.emit( 'remoteWorldEvent', { kind: 'denRaided', data: { id: d2.id }, from: 'peer-1' } );
	ok( ! p.dens.held( d2 ) && evs( w, 'denRaided' ).pop().by === 'remote', 'a raid by another player empties the den here too' );

}

section( 'den guards are melee raiders; the keeper\'s ship at the mooring' );
{

	const w = makeWorld( { melee: true } );
	const p = w.pirates;
	const d = p.dens.list[ 0 ];
	walk( w, d.x + 20, d.z );
	run( w, 0.2 );
	ok( d.guards.length === d.guardsMax && d.guards.every( ( r ) => r.active && w.melee.raiders.includes( r ) ), `${ d.guardsMax } guards on melee's raider list` );
	ok( d.guards.every( ( r ) => r.cfg.flees === 0 ), 'den guards fight like boarding crews' );
	for ( const r of d.guards ) p.dens.host.onDefeated( r );
	ok( d.guardsLeft === 0 && p.ledger.counts.crew === d.guardsMax, 'each defeated guard is booked; the camp is open' );
	// at sea near the mooring
	p.dens.reset();
	sail( w, d.mx + 400, d.mz );
	run( w, 0.3 );
	const s = d.ship;
	ok( s && s.state === 'moored' && s.pirateId === d.keeper && s.denGuard === d.id, 'the keeper\'s ship lies moored while you are near' );
	run( w, 1 );
	ok( Math.hypot( s.x - d.mx, s.z - d.mz ) < 3, 'moored: she does not drift off (the brains leave the state alone)' );
	sail( w, d.mx + 120, d.mz );
	run( w, 0.2 );
	ok( [ 'patrol', 'chase', 'broadside' ].includes( s.state ) && s.alertT > 0, `she slips her mooring when you come close (${ s.state })` );

}

section( 'retaliation' );
{

	const w = makeWorld();
	const p = w.pirates;
	const q = p.retaliation.trigger( 'Mossbeard', 'raid', { force: true } );
	ok( q && q.avenger === 'Mossbeard', 'the hurt captain herself comes when she is free' );
	sail( w, 0, 520 );
	q.t = 0.1;
	run( w, 0.5 );
	const raid = evs( w, 'retaliationRaid' );
	const s = p.roster.shipOf( 'Mossbeard' );
	ok( raid.length === 1 && raid[ 0 ].at === 'sea' && s && s.raid && s.state === 'chase' && s.faction === 'pirate', 'at sea: her ship appears and hunts you' );
	ok( Math.abs( Math.hypot( raid[ 0 ].x - 0, raid[ 0 ].z - 520 ) - RAID_RULES.distance ) < 2, `about ${ RAID_RULES.distance } m off` );
	ok( p.searchZones().some( ( z ) => z.kind === 'raid' ), 'the raid shows on the world map list' );
	// harbour raid while ashore
	const w2 = makeWorld( { money: 2000 } );
	const q2 = w2.pirates.retaliation.trigger( 'BlackLantern', 'sunk', { force: true } );
	q2.t = 0;
	q2.wait = RAID_RULES.ashoreGrace;
	run( w2, 0.2 );
	// wave 4: the home island is peaceful: a due raid waits there, it never hits Hyptile Harbour
	ok( w2.state.money === 2000 && evs( w2, 'retaliationRaid' ).length === 0 && w2.pirates.retaliation.pending.length === 1, 'ashore on the home island: the raid waits (peaceful home waters)' );
	const pons = WORLD.ports.find( ( q ) => q.id === 'pons' );
	w2.app.player.position.set( pons.stand.x, 2, pons.stand.z );
	run( w2, 0.2 );
	ok( w2.state.money < 2000 && evs( w2, 'retaliationRaid' )[ 0 ].at === 'harbour', `ashore at an outer port: they ransack the harbour (-$${ 2000 - w2.state.money })` );
	// a dead avenger never comes
	const q3 = w2.pirates.retaliation.trigger( 'StormIris', 'sunk', { force: true } );
	w2.pirates.ledger.kill( q3.avenger );
	run( w2, 0.2 );
	ok( w2.pirates.retaliation.pending.length === 0, 'a raid whose captain died first is dropped' );
	// sandbox: no raids
	const w3 = makeWorld( { mode: 'sandbox' } );
	ok( w3.pirates.retaliation.trigger( 'Mossbeard', 'raid' ) === null, 'no retaliation in the sandbox' );

}

section( 'tier 4-5 bounties with search zones' );
{

	const w = makeWorld( { seed: 9 } );
	const p = w.pirates;
	run( w, 0.1 );
	p.advance( 1.01 );
	run( w, 0.1 );
	const posted = p.zones.contracts.filter( ( c ) => c.state === 'posted' );
	ok( posted.length === Object.keys( BOARD_SITES ).length && posted.every( ( c ) => c.tier >= 4 && CAPTAIN_BY_ID[ c.captain ].hostile ), 'one tier 4-5 contract posted at each board (' + posted.length + ')' );
	const k = posted[ 0 ];
	ok( p.zones.accept( k.id ) === null && /named captain/.test( p.zones.lastError ), 'a newcomer cannot take one' );
	p.ledger.kill( 'Redwake', { by: 'player' } );
	p.ledger.kill( 'ReedJack', { by: 'player' } );
	const a = p.zones.accept( k.id );
	ok( a && a.state === 'active' && evs( w, 'highBountyAccepted' ).length === 1, 'accepted after two named captains' );
	ok( Math.hypot( a.truth.x - a.zone.x, a.truth.z - a.zone.z ) <= a.zone.r * 0.55 + 1e-6, 'the captain is inside the search zone' );
	ok( terrain.heightAt( a.truth.x, a.truth.z ) < - 5 && ! inSafeZone( a.truth.x, a.truth.z ), 'in deep open water' );
	const z = p.searchZones().find( ( q ) => q.kind === 'bounty' );
	ok( z && z.id === a.id && z.r === Math.round( a.zone.r ) && z.tier === a.tier, 'searchZones() lists it for the world map' );
	const r0 = a.zone.r;
	w.features.emit( 'portVisited', { port: 'pons' } );
	ok( a.zone.r < r0 && Math.hypot( a.truth.x - a.zone.x, a.truth.z - a.zone.z ) <= a.zone.r * 0.55 + 1e-6, 'harbour talk narrows the zone, the truth stays inside' );
	const r1 = a.zone.r;
	w.features.emit( 'portVisited', { port: 'pons' } );
	ok( a.zone.r === r1, 'one tip per port' );
	// sail into reach: she is put to sea
	sail( w, a.truth.x + 200, a.truth.z );
	run( w, 0.2 );
	ok( a.ship && a.ship.pirateId === a.captain && a.ship.highBounty === a.id && a.ship.faction === 'pirate', 'within reach she is put to sea' );
	if ( a.tier >= 5 ) ok( w.naval.ships.some( ( s ) => s.consortOf === a.ship.id ), 'tier 5 brings a consort' );
	const money0 = w.state.money;
	sinkEvent( w, a.ship );
	const claim = evs( w, 'bountyClaimed' );
	ok( claim.length === 1 && claim[ 0 ].reward === HB_RULES.reward[ a.tier ] && claim[ 0 ].proof === 'sunk' && w.state.money === money0 + claim[ 0 ].reward, `sunk: bounty paid $${ claim[ 0 ] && claim[ 0 ].reward }` );
	ok( p.zones.active() === null && p.ledger.counts.bounties === 1, 'contract closed and booked' );
	// capture proof
	p.advance( 1.01 );
	run( w, 0.1 );
	const k2 = p.zones.contracts.find( ( c ) => c.state === 'posted' );
	const a2 = p.zones.accept( k2.id );
	sail( w, a2.truth.x + 100, a2.truth.z );
	run( w, 0.2 );
	const m1 = w.state.money;
	w.features.emit( 'prisonerTaken', { id: a2.ship.id, name: a2.ship.captain, ship: a2.ship.name, tier: 2, value: 500 } );
	ok( evs( w, 'bountyClaimed' ).pop().proof === 'captured' && w.state.money === m1 + Math.round( HB_RULES.reward[ a2.tier ] * CAPTURE_MULT ), `taken alive pays x${ CAPTURE_MULT }` );
	// failure: expiry
	p.advance( 1.01 );
	run( w, 0.1 );
	const k3 = p.zones.contracts.find( ( c ) => c.state === 'posted' );
	if ( k3 ) {

		const a3 = p.zones.accept( k3.id );
		walk( w, WORLD.start.position.x, WORLD.start.position.z );
		const rv = HB_RULES.rivalPerHour;
		HB_RULES.rivalPerHour = 0;
		p.advance( HB_RULES.life[ a3.tier ] + 2 );
		run( w, 0.1 );
		HB_RULES.rivalPerHour = rv;
		const f = evs( w, 'highBountyFailed' ).find( ( e ) => e.id === a3.id );
		ok( f && f.reason === 'expired' && p.ledger.isFree( a3.captain ), 'an unfinished contract expires; the captain still sails' );

	} else ok( true, '(no captain left to post for the expiry check)' );
	// failure: a rival hunter gets her
	p.advance( 1.01 );
	run( w, 0.1 );
	const k4 = p.zones.contracts.find( ( c ) => c.state === 'posted' );
	if ( k4 ) {

		const a4 = p.zones.accept( k4.id );
		const rv = HB_RULES.rivalPerHour;
		HB_RULES.rivalPerHour = 10;
		p.advance( 1.01 );
		run( w, 0.1 );
		HB_RULES.rivalPerHour = rv;
		const f = evs( w, 'highBountyFailed' ).find( ( e ) => e.id === a4.id );
		ok( f && f.reason === 'beaten' && /Fin|Hester/.test( f.by ) && p.ledger.status( a4.captain ) === 'dead', `a rival brings her in first (${ f && f.by })` );

	} else ok( true, '(no captain left to post for the rival check)' );

}

section( 'informants, multiplayer kills, faction refresh, regroup' );
{

	const w = makeWorld( { seed: 21 } );
	const p = w.pirates;
	p.ledger.kill( 'Redwake', { by: 'player' } );
	p.ledger.kill( 'ReedJack', { by: 'player' } );
	run( w, 0.1 );
	p.advance( 1.01 );
	run( w, 0.1 );
	const a = p.zones.accept( p.zones.contracts[ 0 ].id );
	const nell = p.roster.spawn( 'PearlNell', { x: 0, z: 600 } );
	sail( w, 50, 600 );
	const r0 = a.zone.r;
	run( w, 0.1 );
	ok( a.zone.r < r0 && a.tips >= 1, 'a smuggler informant met at sea narrows the zone' );
	// a remote player killed the target
	w.features.emit( 'remoteWorldEvent', { kind: 'captainKilled', data: { id: a.captain, how: 'sunk' }, from: 'peer-2' } );
	ok( p.ledger.status( a.captain ) === 'dead' && evs( w, 'highBountyFailed' ).pop().reason === 'beaten', 'a captain killed in another player\'s world is dead here; the contract is lost' );
	ok( evs( w, 'captainKilled' ).pop().by === 'remote', 'captainKilled (by remote)' );
	// faction refresh: notoriety 4 turns the navy on you
	const navy = p.roster.spawn( 'HarbourWard', { x: 300, z: 600 } );
	ok( navy.faction === 'navy', 'the navy patrol starts neutral' );
	p._heat( 70, 0 );
	run( w, 5.2 );
	ok( p.wanted.level >= 4 && navy.faction === 'pirate', 'at notoriety 4 the patrol hunts you' );
	ok( nell.faction === 'merchant', 'the smuggler stays a trader' );
	// regroup (V7)
	const s = p.roster.spawn( 'Mossbeard', { x: - 200, z: 600 } );
	s.hp = s.maxHp * 0.5;
	s.state = 'regroup';
	run( w, 0.2 );
	ok( s.regroupTo && s.wantSpeed === 1, 'regroup: she runs for her den / a far lane' );
	s.x = s.regroupTo.x;
	s.z = s.regroupTo.z;
	run( w, 0.2 );
	ok( s.state === 'patrol' && s.hp > s.maxHp * 0.5, 'patched up, back on patrol' );

}

section( 'save, reset, multiplayer mode' );
{

	const w = makeWorld();
	const p = w.pirates;
	p.ledger.kill( 'Mossbeard', { by: 'player' } );
	p._heat( 30, - 12 );
	p.dens.found.add( p.dens.list[ 0 ].id );
	p.retaliation.trigger( 'Brinehook', 'sunk', { force: true } );
	const data = JSON.parse( JSON.stringify( w.features.toJSON() ) );
	ok( data.pirates && data.pirates.v === 1, 'saved under features.toJSON().pirates' );
	const w2 = makeWorld();
	w2.features.fromJSON( data );
	const q = w2.pirates;
	ok( q.ledger.status( 'Mossbeard' ) === 'dead' && Math.round( q.wanted.heat ) === 30 && q.dens.found.size === 1 && q.retaliation.pending.length === 1, 'loaded: ledger, notoriety, found dens, pending raid' );
	q.fromJSON( { v: 1, hours: 'x', ledger: 5, notoriety: { heat: 'a' }, dens: { found: [ 1, 2 ] }, raids: { pending: [ { avenger: 'Nope' } ] }, bounties: { contracts: [ { captain: 'Brinehook', port: 'mars', state: 'active' } ] } } );
	ok( q.ledger.isFree( 'Mossbeard' ) && q.wanted.heat === 0 && q.dens.found.size === 0 && q.retaliation.pending.length === 0 && q.zones.contracts.length === 0, 'garbage loads as a clean slate' );
	p.reset();
	ok( p.ledger.isFree( 'Mossbeard' ) && p.wanted.level === 0 && p.retaliation.pending.length === 0, 'reset: a new game' );
	// multiplayer: naval is off; no roster ships, the ledger still listens
	const w3 = makeWorld( { mode: 'multiplayer' } );
	run( w3, 30 );
	ok( w3.pirates.roster.live.size === 0, 'multiplayer: no local ships (naval inactive)' );
	w3.features.emit( 'remoteWorldEvent', { kind: 'captainKilled', data: { id: 'Barnacle' } } );
	ok( w3.pirates.ledger.status( 'Barnacle' ) === 'dead', 'multiplayer: captain deaths arrive' );
	w.features.dispose();
	ok( true, 'disposed' );

}

section( 'the Blackwater stronghold with the pirates feature (wave 12B)' );
{

	const { install: installStronghold } = await import( '../src/features/pirates/Stronghold.js' );
	const w = makeWorld( { melee: true } );
	const p = w.pirates;
	const s = w.features.add( 'stronghold', { install: ( a, f ) => installStronghold( a, f, { build: false, seed: 5, avatarFactory } ) } );
	const bw = WORLD.islands.find( ( i ) => i.id === 'blackwater' );
	ok( bw && bw.den === false, 'Blackwater is on WORLD.islands with den: false (the stronghold replaces a den camp)' );
	const den = p.dens.list.find( ( d ) => d.island === 'blackwater' );
	console.log( den ? 'note: Dens.sync still gives Blackwater a den camp (the report carries the one-line Dens.js patch)' : 'note: Dens honours den: false' );
	ok( ! s.friendly(), 'a stranger is not let in' );
	p._heat( 0, 30 );
	ok( s.friendly() && p.standing() >= 25, 'corsair standing from the pirates feature opens the stronghold (standing ' + p.standing() + ')' );
	const raids = p.ledger.counts.raids, st = p.standing();
	for ( const b of s.batteries.list ) s.batteries.silence( b.id );
	for ( const sl of s.ships ) sl.down = true;
	while ( s.claimable().guards > 0 ) s.defeatGuard();
	const r = s.claim();
	ok( r && p.ledger.counts.raids === raids + 1 && p.standing() < st, 'claiming it is a raid in the ledger and costs corsair standing' );
	p.advance( 80 );
	run( w, 0.2 );
	ok( s.holder === 'pirates' && p.retaliation.pending.some( ( q ) => q.reason === 'stronghold' ), 'the pirates clock retakes it and the retaliation queue gets a raid' );
	w.features.dispose();

}

console.log( `\n${ passes } passed, ${ fails } failed` );
process.exit( fails ? 1 : 0 );

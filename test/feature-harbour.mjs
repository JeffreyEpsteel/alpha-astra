// Plain-node tests of harbour life (src/features/harbour) and crafting (src/features/crafting): the seven roles
// and their schedules, the places on real terrain, population by port size, residents keeping a day (indoors at
// night, work loops that fill the shelf, the tavern in the evening), routes off the pier and around buildings,
// memory lines, the tavern (buffs, rumours, the no-wager dice), services for the story dialogue, the recipes over
// fish and trade goods, bait / lures / patch kits, and the save round trips. No DOM, no GPU.
//   node test/feature-harbour.mjs
import { Quaternion, Vector3 } from '../src/engine/index.js';
import { WORLD } from '../src/world/WorldLayout.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { Residents } from '../src/world/Residents.js';
import { RESIDENTS, HOMES, PLACES, TAVERN_HOME, HARBOUR_FOLK, PORT_FOLK, ROLE_LINES, doorOf } from '../src/world/residents/ResidentData.js';
import { Features } from '../src/features/Features.js';
import { GameState } from '../src/game/GameState.js';
import { CHARACTERS } from '../src/game/Characters.js';
import { GOODS } from '../src/features/trade/goods.js';
import * as harbourModule from '../src/features/harbour/index.js';
import * as craftingModule from '../src/features/crafting/index.js';
import * as tradeModule from '../src/features/trade/index.js';
import { ROLES, ROLE_IDS, SCHEDULES, activityAt, scheduleOf, validSchedule, nextChange } from '../src/features/harbour/Roles.js';
import { Director, findLandSpot, populationFor, portSize, generatedRole } from '../src/features/harbour/Schedules.js';
import { Dice, rollDie, outcomeOf, COOLDOWN_S } from '../src/features/harbour/Dice.js';
import { Tavern, MENU, fishRumours, portRumours, bountyRumours, isNightish } from '../src/features/harbour/Tavern.js';
import { TavernAudio, tavernLevel, HEAR_M } from '../src/features/harbour/TavernAudio.js';
import { PIPS, dieHTML } from '../src/features/harbour/PanelKit.js';
import { RECIPES, ITEMS, validRecipes, pickFish, BAIT_BITE } from '../src/features/crafting/Recipes.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};
const near = ( a, b, eps = 1e-3 ) => Math.abs( a - b ) <= eps;
const store = () => {

	const m = new Map();
	return { getItem: ( k ) => m.has( k ) ? m.get( k ) : null, setItem: ( k, v ) => m.set( k, v ) };

};
const seq = ( vals ) => {

	let i = 0;
	return () => vals[ i ++ % vals.length ];

};

const terrain = new TerrainData();

// ---------------------------------------------------------------- roles and schedules
{

	ok( ROLE_IDS.length === 7 && ROLE_IDS.every( ( r ) => ROLES[ r ] ), 'the seven harbour roles' );
	for ( const [ id, s ] of Object.entries( SCHEDULES ) ) ok( validSchedule( s ), `schedule ${ id } covers the day` );
	ok( ROLE_IDS.every( ( r ) => SCHEDULES[ ROLES[ r ].schedule ] ), 'every role has a schedule' );
	ok( activityAt( SCHEDULES.fisher, 2 ) === 'sleep' && activityAt( SCHEDULES.fisher, 6 ) === 'work' && activityAt( SCHEDULES.fisher, 12 ) === 'eat' && activityAt( SCHEDULES.fisher, 19 ) === 'tavern', 'fisher: sleep, work, eat, tavern' );
	ok( activityAt( SCHEDULES.nightFisher, 1 ) === 'work' && activityAt( SCHEDULES.nightFisher, 8 ) === 'sleep', 'the night fisher works the dark' );
	ok( activityAt( SCHEDULES.child, 21 ) === 'sleep' && activityAt( SCHEDULES.child, 10 ) === 'play', 'children play by day, home by dark' );
	ok( activityAt( SCHEDULES.smuggler, 23 ) === 'watch' && activityAt( SCHEDULES.smuggler, 14 ) === 'loiter', 'smugglers watch at night' );
	ok( activityAt( SCHEDULES.prankster, 9.5 ) === 'loiter' && activityAt( SCHEDULES.prankster, 15 ) === 'loiter', 'the clown is at his prank spot from the morning start' );
	ok( activityAt( SCHEDULES.innkeeper, 22 ) === 'work' && activityAt( SCHEDULES.innkeeper, 5 ) === 'sleep', 'the innkeeper works late' );
	ok( activityAt( SCHEDULES.fisher, 24.5 ) === activityAt( SCHEDULES.fisher, 0.5 ) && activityAt( SCHEDULES.fisher, - 1 ) === 'sleep', 'hours wrap' );
	ok( nextChange( SCHEDULES.innkeeper, 4, 'work' ) === 9.5, 'the inn opens at 09:30' );
	ok( scheduleOf( { role: 'fisher', schedule: 'nightFisher' } ) === SCHEDULES.nightFisher && scheduleOf( { role: 'guard' } ) === SCHEDULES.guard && scheduleOf( {} ) === null, 'named schedules override the role' );

}

// ---------------------------------------------------------------- the places, on the real island
{

	const buildings = [
		[ 13.5, - 106.5 ], [ 26.5, - 112 ], [ 62.5, - 106 ], [ 79, - 110.5 ], [ 96, - 115.5 ], [ - 3, - 125 ], [ 16.5, - 130 ],
		[ 57.5, - 128.5 ], [ 75.5, - 132.5 ], [ 96.5, - 135 ], [ 3.5, - 151 ], [ 30.5, - 149 ], [ 55, - 152.5 ], [ 78.5, - 156 ],
		[ 67.8, - 64.6 ], [ 79.8, - 70.4 ], [ 37.2, - 72.4 ], [ 21.5, - 119.5 ], [ 68, - 124 ], [ 89, - 146 ], [ 43.5, - 155.5 ],
		[ 92.5, - 57.5 ], [ 40.2, - 113.2 ], [ 49.9, - 74.6 ], [ 85.5, - 60.5 ],
	];
	const clear = ( p, own = null ) => buildings.every( ( [ x, z ] ) => ( own && near( x, own.x ) && near( z, own.z ) ) || Math.hypot( p.x - x, p.z - z ) >= 4.4 );
	const land = ( p ) => terrain.heightAt( p.x, p.z ) > 0.25;
	const R0 = new Residents( { scene: { add() {} }, terrain, avatarFactory: fake().factory, data: [] } );
	ok( Object.keys( HOMES ).length === 14, '14 cottages to live in' );
	for ( const h of Object.values( HOMES ) ) ok( land( h.door ) && clear( h.door, h ), `cottage ${ h.id } door on land, clear of the other buildings` );
	ok( Math.hypot( HOMES.C.door.x - 62.5, HOMES.C.door.z + 106 ) > 5 && HOMES.C.door.z > - 106, 'doors are on the seaward (+z) face' );
	const d0 = doorOf( 0, 0, 0, 4, 1 );
	ok( near( d0.x, 0 ) && near( d0.z, 3.8 ) && near( d0.yaw, Math.PI ), 'door maths: front face +z, facing out' );
	ok( TAVERN_HOME.building === 'C' && Math.hypot( TAVERN_HOME.x - WORLD.pier.x, TAVERN_HOME.z - WORLD.pier.zStart ) < 50, 'the tavern is near the home harbour' );
	for ( const k of [ 'patio', 'plaza', 'mouth' ] ) ok( PLACES[ k ].every( ( p ) => land( p ) && clear( p ) ), `${ k } spots on land and clear` );
	ok( land( PLACES.workshop ), 'the workbench is on land' );
	const ids = new Set( RESIDENTS.map( ( r ) => r.id ) );
	for ( const r of RESIDENTS ) ok( ROLES[ r.role ] && HOMES[ r.home ], `${ r.id }: role ${ r.role }, home ${ r.home }` );
	for ( const f of HARBOUR_FOLK ) {

		ok( ! ids.has( f.id ) && CHARACTERS[ f.character ] && ROLES[ f.role ] && HOMES[ f.home ], `${ f.id }: a new ${ f.role } with a home` );
		ids.add( f.id );
		ok( f.lines.length >= 3 && f.lines.every( ( l ) => l.length < 90 ), `${ f.id }: short lines` );
		for ( const s of f.work ) ok( R0.isDeck( s.x, s.z ) || ( land( s ) && clear( s ) ), `${ f.id }: station ${ s.x }, ${ s.z } on ${ R0.isDeck( s.x, s.z ) ? 'the pier' : 'land' }` );

	}

	const roles = new Set( [ ...RESIDENTS, ...HARBOUR_FOLK ].map( ( r ) => r.role ) );
	ok( ROLE_IDS.every( ( r ) => roles.has( r ) ), 'all seven roles live at the home harbour' );
	ok( HARBOUR_FOLK.some( ( f ) => f.service === 'tavern' && f.dice ) && HARBOUR_FOLK.some( ( f ) => f.service === 'crafting' ), 'an innkeeper with dice and a craftsman' );
	ok( PORT_FOLK.some( ( f ) => f.port === 'pons' && f.dice ), 'Pons has a dice-playing innkeeper (Tavi)' );
	ok( Object.values( ROLE_LINES ).every( ( l ) => l.length >= 3 ) && ROLE_IDS.every( ( r ) => ROLE_LINES[ r ] ), 'lines for generated people of every role' );

}

// ---------------------------------------------------------------- population by port size
{

	ok( portSize( { id: 'home' } ) > portSize( { id: 'pons' } ) && portSize( { id: 'x', radius: 80 } ) < portSize( { id: 'y', radius: 200 } ), 'size: trade ports, else island radius' );
	ok( populationFor( { id: 'home' } ) > populationFor( { id: 'gull', radius: 120 } ) && populationFor( { id: 'tiny', radius: 10 } ) >= 2, 'bigger ports, more people (two at least)' );
	ok( new Set( Array.from( { length: 8 }, ( _, i ) => generatedRole( i ) ) ).size >= 6, 'generated roles vary' );
	const ground = { height: ( x, z ) => terrain.heightAt( x, z ) };
	let r = 1;
	const rand = () => ( r = ( r * 16807 ) % 2147483647 ) / 2147483647;
	const s = findLandSpot( ground, WORLD.ports[ 1 ].stand.x, WORLD.ports[ 1 ].stand.z, 4, 12, rand, [] );
	ok( s && terrain.heightAt( s.x, s.z ) > 0.35, 'a land spot near Pons stand' );
	ok( findLandSpot( { height: () => - 5 }, 0, 0, 1, 5, rand ) === null, 'no spot at sea' );

}

// ---------------------------------------------------------------- fake avatars
function fake() {

	const made = [];
	const BASE = [ 'Idle_Breathe', 'Walk_InPlace', 'Talk', 'Wave', 'Look_Around', 'Cheer_Clap', 'Dance', 'Fishing_Hold', 'Fishing_Reel', 'Chat_Gesture', 'Sweep_Work', 'Inspect_Catch', 'Shrug', 'Point', 'Laugh', 'Beckon', 'Prank_Laugh', 'Swagger_Idle', 'Friendly_Wave' ];
	const factory = ( { character, lite } ) => {

		const model = { clips: new Set( BASE ), current: null, updates: 0, play( n ) { this.current = n; }, update() { this.updates ++; }, hold() {} };
		const a = { character, lite, model, visible: true, group: { position: new Vector3(), quaternion: new Quaternion(), scale: new Vector3( 1, 1, 1 ), visible: true, updateMatrixWorld() {} }, ready: Promise.resolve( model ), dispose() { this.disposed = true; } };
		made.push( a );
		return a;

	};

	return { made, factory };

}

function world( { hour = 9, money = 500, mode = null, player = { x: 53.6, z: - 77 }, crafting = true, trade = true, residents = true } = {} ) {

	const F = fake();
	const state = new GameState( store() );
	if ( mode ) state.setMode( mode );
	state.money = money;
	state.boat = 'lobster'; // a hold of 20 crates (on foot it is 2)
	const R = residents ? new Residents( { scene: { add() {} }, terrain, avatarFactory: F.factory } ) : null;
	const app = {
		settings: { timeOfDay: hour }, terrainData: terrain, residents: R, mode: mode || 'campaign',
		game: { state, toasts: [], toast( t ) { this.toasts.push( t ); } },
		player: { mode: 'walk', position: new Vector3( player.x, terrain.heightAt( player.x, player.z ), player.z ) },
	};
	const features = new Features( app );
	const add = ( name, mod, opts ) => {

		const inst = mod.install( app, features, opts );
		features.list.set( name, { module: mod, instance: inst } );
		return inst;

	};

	const tr = trade ? add( 'trade', tradeModule, { noise: 0, events: false, toasts: false, stalls: false } ) : null;
	const hb = add( 'harbour', harbourModule, { rng: seq( [ 0.1, 0.7, 0.4, 0.9, 0.25 ] ), toasts: true, audio: false } );
	const cr = crafting ? add( 'crafting', craftingModule, {} ) : null;
	return { app, features, state, R, hb, cr, tr, F };

}

const tick = ( w, seconds, dt = 0.1, p = w.app.player ) => {

	for ( let t = 0; t < seconds - 1e-9; t += dt ) {

		w.R && w.R.update( dt, p );
		w.features.update( dt );

	}

};

// ---------------------------------------------------------------- residents keep a day
{

	const w = world( { hour: 2, player: { x: 0, z: 400 } } ); // the player out at sea: everyone far
	const { R, hb } = w;
	const ports = WORLD.ports.map( ( p ) => p.id );
	ok( HARBOUR_FOLK.every( ( f ) => R.byId( f.id ) ), 'the home folk joined the residents' );
	for ( const id of ports.filter( ( p ) => p !== 'home' ) ) {

		const n = R.list.filter( ( r ) => r.port === id ).length;
		ok( n >= 2 && n <= populationFor( WORLD.ports.find( ( p ) => p.id === id ) ), `${ id }: ${ n } residents (size ${ portSize( WORLD.ports.find( ( p ) => p.id === id ) ).toFixed( 2 ) })` );

	}

	ok( R.byId( 'tavi' ) && R.byId( 'iona' ) && R.byId( 'pip' ), 'Pons has Tavi, Iona and Pip' );
	ok( R.list.filter( ( r ) => r.port !== 'home' ).every( ( r ) => ! r.avatar ), 'far ports build no avatars yet (lazy)' );
	ok( hb.sites.tavern.some( ( s ) => s.port === 'pons' && s.keeper === 'tavi' ), 'a tavern at Pons' );
	ok( R.list.filter( ( r ) => r.port !== 'home' ).every( ( r ) => terrain.heightAt( r.x, r.z ) > 0.3 ), 'generated people stand on land' );
	tick( w, 1.2 );
	const managed = R.list.filter( ( r ) => r.role );
	ok( managed.length === R.list.length, 'everyone has a role' );
	const asleep = R.list.filter( ( r ) => hb.activityOf( r.id ) === 'sleep' );
	ok( asleep.length > R.list.length / 2 && asleep.every( ( r ) => r.hidden ), `02:00: ${ asleep.length } asleep indoors (hidden)` );
	ok( R.byId( 'penguBeach' ) && hb.activityOf( 'penguBeach' ) === 'work' && ! R.byId( 'penguBeach' ).hidden, 'PENGU is out night fishing' );
	ok( hb.activityOf( 'silt' ) === 'watch' && Math.hypot( R.byId( 'silt' ).x - 106, R.byId( 'silt' ).z + 63 ) < 5, 'Silt watches the harbour mouth' );
	ok( R.nearest( { x: HOMES.H.door.x, y: R.byId( 'fin' ).y, z: HOMES.H.door.z }, 3 ) === null, 'nobody to talk to at a sleeping door' );
	const d = R.byId( 'dogePier' );
	ok( d.hidden && near( d.x, HOMES.D.door.x, 0.01 ), 'Doge went home from the pier' );
	// midday: eat at the plaza
	w.app.settings.timeOfDay = 12.2;
	tick( w, 1.2 );
	const eating = R.list.filter( ( r ) => r.port === 'home' && hb.activityOf( r.id ) === 'eat' );
	ok( eating.length >= 4 && eating.filter( ( r ) => PLACES.plaza.some( ( p ) => near( p.x, r.x, 0.01 ) && near( p.z, r.z, 0.01 ) ) ).length === Math.min( eating.length, PLACES.plaza.length ), `12:12: ${ eating.length } eat, plaza spots used once each` );
	ok( eating.every( ( r ) => ! r.hidden ), 'out of doors at lunch' );
	// evening: the tavern
	w.app.settings.timeOfDay = 19.5;
	tick( w, 1.2 );
	const tav = R.list.filter( ( r ) => r.port === 'home' && hb.activityOf( r.id ) === 'tavern' );
	const onPatio = tav.filter( ( r ) => ! r.hidden ), inside = tav.filter( ( r ) => r.hidden );
	const patio = R.list.filter( ( r ) => ! r.hidden && PLACES.patio.some( ( p ) => near( p.x, r.x, 0.01 ) && near( p.z, r.z, 0.01 ) ) );
	ok( tav.length >= 5 && patio.length === PLACES.patio.length && inside.length >= tav.length - PLACES.patio.length && onPatio.length + inside.length === tav.length, `19:30: ${ onPatio.length } drinking on the patio (${ patio.length } seats taken), ${ inside.length } inside` );
	ok( hb.crowd( 'home' ) > 0.5, `the tavern is busy (crowd ${ hb.crowd( 'home' ).toFixed( 2 ) })` );
	ok( hb.activityOf( 'nell' ) === 'work' && ! R.byId( 'nell' ).hidden, 'Nell is behind the bar' );
	ok( hb.siteOpen( hb.sites.tavern[ 0 ] ), 'the Upturned Keel is open' );
	// morning: work loops make things
	w.app.settings.timeOfDay = 9;
	tick( w, 1.2 );
	const shelf0 = { ...hb.shelf.home };
	ok( hb.activityOf( 'fin' ) === 'work' && hb.activityOf( 'bran' ) === 'work', 'Fin and Bran at work' );
	ok( R.byId( 'kidHyp' ).task === null || R.byId( 'kidHyp' ).task.native, 'the kids are back at their own play' );
	tick( w, 260, 0.5 );
	ok( hb.shelf.home.bait > shelf0.bait && hb.shelf.home.rope > shelf0.rope, `craft loops filled the shelf (bait ${ hb.shelf.home.bait }, rope ${ hb.shelf.home.rope })` );
	ok( hb.shelf.home.coin > 0, 'the merchant counted coin' );
	// at 03:00 the inn is closed (campaign)
	w.app.settings.timeOfDay = 3;
	tick( w, 1.2 );
	ok( ! hb.siteOpen( hb.sites.tavern[ 0 ] ) && hb.opensAt( hb.sites.tavern[ 0 ] ) === 9.5, 'closed at night, opens 09:30' );
	w.features.list.get( 'harbour' ).instance._toggleTavern( hb.sites.tavern[ 0 ] );
	ok( ! hb.isOpen && w.app.game.toasts.some( ( t ) => /closed \(opens 09:30\)/.test( t ) ), 'a closed tavern says when it opens' );
	hb.dispose();
	ok( ! R.byId( 'fin' ) && R.onTalk === null, 'dispose removes the folk and the talk hook' );

}

// ---------------------------------------------------------------- walking: near residents walk the route
{

	const w = world( { hour: 9, player: { x: 56, z: - 60 } } );
	const { R } = w;
	await new Promise( ( r ) => setTimeout( r, 0 ) ); // the fake avatars resolve
	tick( w, 0.6 );
	const fin = R.byId( 'fin' );
	ok( fin.task && fin.state === 'go' || fin.arrived, `Fin has a task (${ fin.task && fin.task.id }, ${ fin.state })` );
	// a route from the pier head to cottage D goes along the deck and off at the foot
	const rt = R.route( 50, 36.8, HOMES.D.door.x, HOMES.D.door.z );
	ok( near( rt[ 0 ].x, WORLD.pier.x ) && near( rt[ 1 ].x, WORLD.pier.x ) && rt[ 1 ].z < WORLD.pier.zStart, 'off the pier along its deck' );
	const back = R.route( HOMES.D.door.x, HOMES.D.door.z, 56.0, - 14 );
	ok( near( back[ back.length - 1 ].x, 56 ) && near( back[ back.length - 2 ].x, WORLD.pier.x ) && back.some( ( p ) => p.z < WORLD.pier.zStart ), 'onto the pier at its foot' );
	R.village = { footprints: [ { x: 0, z: 0, r: 4, kind: 'building' } ] };
	const around = R.route( - 10, 0.5, 10, 0.5 );
	ok( around.length === 2 && Math.abs( around[ 0 ].z ) > 4, 'around a building, not through it' );
	R.village = null;
	// someone walking at commute speed arrives
	const rook = R.byId( 'rook' );
	rook.setTask( { id: 'test', x: rook.x + 5, z: rook.z } );
	const x0 = rook.x;
	for ( let i = 0; i < 20; i ++ ) R.update( 0.1, w.app.player );
	ok( rook.state === 'go' && near( rook.x - x0, 2.1, 0.15 ), `walks at ${ ( ( rook.x - x0 ) / 2 ).toFixed( 2 ) } m/s` );
	ok( rook.model.current === 'Walk_InPlace', 'with the walk clip' );
	for ( let i = 0; i < 40; i ++ ) R.update( 0.1, w.app.player );
	ok( rook.arrived && rook.state === 'idle', 'arrives and idles' );
	rook.setTask( { id: 'in', x: rook.x, z: rook.z, indoors: true } );
	R.update( 0.1, w.app.player );
	ok( rook.hidden && rook.avatar.group.visible === false, 'indoors: hidden' );
	rook.setTask( { id: 'out', x: rook.x + 1, z: rook.z } );
	R.update( 0.1, w.app.player );
	ok( ! rook.hidden && rook.avatar.group.visible === true, 'out of the door: shown' );
	// a far port's lazy avatar is built when the player comes near
	const tavi = R.byId( 'tavi' );
	ok( ! tavi.avatar, 'Tavi has no avatar at home harbour' );
	R.update( 0.1, { x: tavi.x + 30, y: tavi.y, z: tavi.z } );
	ok( !! tavi.avatar, 'sailing to Pons builds it' );

}

// ---------------------------------------------------------------- talking: memory and services
{

	const w = world( { hour: 15 } );
	const { R, hb, features } = w;
	const talked = [];
	features.on( 'residentTalked', ( e ) => talked.push( e ) );
	const nell = R.byId( 'nell' );
	tick( w, 0.6 );
	const res = R.interact( nell, w.app.player, null );
	ok( res && typeof res.line === 'string' && hb.isOpen && hb.openSite.port === 'home', 'talking to Nell opens the tavern' );
	ok( talked.length === 1 && talked[ 0 ].id === 'nell' && talked[ 0 ].role === 'tavern', 'residentTalked event' );
	R.interact( nell, w.app.player, null );
	ok( ! hb.isOpen, 'talking again closes it' );
	for ( let i = 0; i < 2; i ++ ) R.interact( nell, w.app.player, null );
	const fifth = R.interact( nell, w.app.player, null );
	ok( hb.memoryOf( 'nell' ).talks === 5 && /familiar face/.test( fifth.line ), 'the fifth talk: she remembers you' );
	hb.close();
	// a generated islander introduces itself
	const gen = R.list.find( ( r ) => r.data.generated );
	const first = R.interact( gen, w.app.player, null );
	ok( first.line.startsWith( `I am ${ gen.name }.` ), `a stranger introduces itself ("${ first.line }")` );
	// story memory: a hostile disposition
	features.list.set( 'story', { instance: { memory: { get: ( id ) => ( id === 'fin' ? { disposition: - 30, talks: 4 } : null ) } } } );
	const fin = R.byId( 'fin' );
	const lines = [ 0, 1, 2 ].map( () => R.interact( fin, w.app.player, null ).line );
	ok( lines.some( ( l ) => /again|remember|go\./.test( l ) ) && hb.memoryOf( 'fin' ).disposition === - 30, 'story memory: Fin is wary of you' );
	// days away
	const mm = hb.memory.bonkBoathouse = { talks: 2, firstDay: 0, lastDay: 0 };
	hb.day = 3;
	ok( /3 days/.test( R.interact( R.byId( 'bonkBoathouse' ), w.app.player, null ).line ), 'missed you for days' );
	// the clown prank is untouched
	const clown = R.byId( 'clownCabin' );
	ok( R.interact( clown, w.app.player, null ).prank === true && R.interact( clown, w.app.player, null ).prank === 'launch', 'the prank still works' );
	// Bran opens the bench, Mara the market
	R.interact( R.byId( 'bran' ), w.app.player, null );
	ok( w.cr.isOpen && w.cr.port === 'home', 'talking to Bran opens the workbench' );
	w.cr.close();
	R.interact( R.byId( 'mara' ), w.app.player, null );
	ok( w.tr.isOpen, 'talking to Mara opens the market' );
	w.tr.close();
	// services for the story's dialogue
	const sv = hb.services().map( ( s ) => s.id );
	ok( [ 'tavern', 'dice', 'rumours', 'crafting' ].every( ( s ) => sv.includes( s ) ), `services: ${ sv.join( ', ' ) }` );
	ok( hb.openService( 'dice', { npc: 'tavi' } ) && hb.openSite.port === 'pons' && hb.panel.tab === 'dice', 'openService( dice, tavi ) -> Pons dice' );
	hb.close();
	ok( hb.openService( 'crafting' ) && w.cr.isOpen, 'openService( crafting )' );
	w.cr.close();
	ok( ! hb.openService( 'nonsense' ), 'unknown service: false' );
	void mm;

}

// ---------------------------------------------------------------- the tavern
{

	const w = world( { hour: 14, money: 100, residents: false } );
	const { hb, state, features } = w;
	const ev = [];
	features.on( 'harbourBuff', ( e ) => ev.push( e ) );
	ok( hb.sites.tavern.length >= 2, 'taverns without residents too (home and Pons)' );
	const r = hb.order( 'stew', 'home' );
	ok( r.ok && state.money === 86 && near( hb.biteModifier(), 1.15 ) && ev.length === 1, 'stew: $14, bites 15% sooner' );
	hb.order( 'coffee', 'home' );
	ok( near( hb.biteModifier(), 1.15 ), 'coffee does nothing at 14:00' );
	w.app.settings.timeOfDay = 20;
	tick( w, 0.2 );
	ok( isNightish( 20 ) && near( hb.biteModifier(), 1.15 * 1.2 ), 'coffee works after dusk' );
	ok( hb.biteModifier() <= 1.4, 'capped' );
	for ( let h = 20; h < 23.5; h += 0.5 ) { w.app.settings.timeOfDay = h; tick( w, 0.1 ); }
	ok( ! hb.tavern.buffs.some( ( b ) => b.id === 'fed' ) && hb.tavern.buffs.some( ( b ) => b.id === 'coffee' ), 'the stew wore off after 3 h, the coffee lasts' );
	state.money = 3;
	ok( ! hb.order( 'stew' ).ok && state.money === 3, 'no money, no stew' );
	state.money = 100;
	// rumours: fish, ports, bounties
	ok( fishRumours().length >= 5 && fishRumours().every( ( f ) => Number.isFinite( f.x ) && f.text.length < 140 ), `${ fishRumours().length } fish rumours with map points` );
	ok( portRumours().length === WORLD.ports.length - 1, 'a rumour per other port' );
	const notices = { active: [], board: ( p ) => ( p === 'home' ? [ { id: 'b1', kind: 'bounty', captain: 'Red Mag', region: { x: 100, z: 300, compass: 'south', distance: 380 } }, { id: 'q1', kind: 'quest' } ] : [] ) };
	const br = bountyRumours( notices );
	ok( br.length === 1 && /Red Mag was seen 380 m south/.test( br[ 0 ].text ) && br[ 0 ].x === 100, 'a bounty rumour with the region' );
	features.list.set( 'notices', { instance: notices } );
	const heard = [];
	features.on( 'rumourHeard', ( e ) => heard.push( e ) );
	const a1 = hb.askRumour( 'home' );
	ok( a1.ok && a1.rumour && state.money === 96 && heard.length === 1, 'ask around: $4, a rumour' );
	const rum = hb.order( 'rum', 'home' );
	ok( rum.ok && rum.rumour && rum.rumour.id !== a1.rumour.id, 'rum comes with a fresh rumour' );
	for ( let i = 0; i < 8; i ++ ) hb.askRumour();
	ok( hb.tavern.heard.length === 6, 'the last six are kept' );
	// dice: no wager
	const m0 = state.money;
	const dice = [];
	features.on( 'diceRolled', ( e ) => dice.push( e ) );
	const d1 = hb.rollDice( 'home' );
	ok( d1.ok && d1.player >= 1 && d1.player <= 6 && /No wager or reward\.$/.test( d1.text ) && state.money === m0, `a round: ${ d1.text }` );
	ok( ! hb.rollDice( 'home' ).ok, 'a 2 s pause between rounds' );
	tick( w, COOLDOWN_S + 0.1 );
	ok( hb.rollDice( 'home' ).ok && hb.tavern.dice.tally.rounds === 2 && dice.length === 2 && state.money === m0, 'another round later; still nothing changes hands' );
	const D = new Dice( { rng: seq( [ 0.99, 0.0, 0.5, 0.5, 0.0, 0.99 ] ) } );
	const w1 = D.roll( 10, 'Nell' ), w2 = D.roll( 20, 'Nell' ), w3 = D.roll( 30, 'Nell' );
	ok( w1.outcome === 'win' && w1.player === 6 && w2.outcome === 'draw' && w3.outcome === 'lose' && /Nell wins/.test( w3.text ), 'win, draw, lose' );
	ok( D.tally.wins === 1 && D.tally.draws === 1 && D.tally.losses === 1, 'the tally' );
	ok( rollDie( () => 0 ) === 1 && rollDie( () => 0.9999 ) === 6 && outcomeOf( 3, 3 ) === 'draw', 'die faces 1-6' );
	ok( Object.keys( PIPS ).length === 6 && ( dieHTML( 5 ).match( /class="on"/g ) || [] ).length === 5, 'die faces draw their pips' );
	// save
	const saved = JSON.parse( JSON.stringify( features.toJSON().harbour ) );
	const w2b = world( { residents: false } );
	w2b.hb.fromJSON( saved );
	ok( w2b.hb.tavern.dice.tally.rounds === 2 && w2b.hb.tavern.heard.length === 6 && w2b.hb.tavern.buffs.length === hb.tavern.buffs.length, 'tavern save round trip' );
	w2b.hb.fromJSON( { tavern: { buffs: [ { id: 'hack', bite: 9, until: 1e9 } ], hours: 0 } } );
	ok( w2b.hb.tavern.buffs.length === 0 && w2b.hb.biteModifier() === 1, 'unknown buffs are dropped' );
	hb.reset();
	ok( hb.tavern.buffs.length === 0 && hb.tavern.dice.tally.rounds === 0, 'reset' );
	// sound
	ok( tavernLevel( 2, 1 ) > tavernLevel( 20, 1 ) && tavernLevel( HEAR_M + 1, 1 ) === 0 && tavernLevel( 10, 0 ) > 0 && tavernLevel( Infinity, 1, true ) > 0.5, 'tavern level by distance and crowd' );
	const ta = new TavernAudio( { audio: null } );
	ta.update( 0.1, { distance: 3, crowd: 1 } );
	ok( ta.level > 0 && ! ta.n, 'no audio context: silent, no throw' );

}

// ---------------------------------------------------------------- crafting
{

	ok( validRecipes( RECIPES, GOODS ), 'recipes are valid over the trade goods' );
	ok( [ 'bait', 'lure', 'pearlLure', 'repairKit' ].every( ( k ) => RECIPES.some( ( r ) => r.out.item === k ) ) && RECIPES.some( ( r ) => r.out.good === 'rope' ), 'bait, lures, patch kits and rope' );
	ok( pickFish( [ { id: 1, kg: 2, value: 9 }, { id: 2, kg: 0.5, value: 3 }, { id: 3, kg: 1.2, value: 5 } ], { count: 2, minKg: 1 } ).map( ( f ) => f.id ).join() === '3,1', 'the cheapest fish that qualify' );
	ok( pickFish( [ { id: 1, kg: 0.5 } ], { count: 1, minKg: 1 } ) === null, 'not enough fish' );
	const w = world( { hour: 10, money: 300, player: { x: PLACES.workshop.x, z: PLACES.workshop.z } } );
	const { cr, state, tr, features, R } = w;
	tick( w, 0.6 );
	ok( cr.benchOpen( cr.site( 'home' ) ), 'Bran\'s bench is open at 10:00' );
	ok( ! cr.check( 'cutBait' ).ok && /1 fish/.test( cr.check( 'cutBait' ).missing[ 0 ] ), 'no fish: cut bait waits' );
	state.addFish( 'grunt', 0.6, 10 );
	state.addFish( 'jack', 3.2, 10 );
	state.addFish( 'mullet', 1.4, 10 );
	const made = [];
	features.on( 'itemCrafted', ( e ) => made.push( e ) );
	const c1 = cr.craft( 'cutBait', 'home' );
	ok( c1.ok && cr.stock.bait === 4 && state.inventory.length === 2 && ! state.inventory.some( ( f ) => f.species === 'grunt' ) && made.length === 1, 'cut bait from the cheapest fish' );
	ok( near( cr.biteModifier(), BAIT_BITE ), 'baited: bites come sooner' );
	tr.addCargo( 'salt', 2, { port: 'home' } );
	tr.addCargo( 'timber', 1, { port: 'home' } );
	tr.addCargo( 'rope', 2, { port: 'home' } );
	tr.addCargo( 'coconuts', 2, { port: 'home' } );
	tr.addCargo( 'pearls', 1, { port: 'home' } );
	const c2 = cr.craft( 'saltBait' );
	ok( c2.ok && cr.stock.bait === 12 && tr.cargo.salt.qty === 1, 'salted bait: a fish and a sack of salt' );
	const m0 = state.money;
	ok( cr.craft( 'patchKit' ).ok && cr.stock.repairKit === 1 && state.money === m0 - 15 && ! tr.cargo.timber && tr.cargo.rope.qty === 1, 'patch kit: timber, rope and $15' );
	ok( cr.craft( 'featherJig' ).ok && cr.tied && cr.tied.item === 'lure' && cr.tied.uses === 8, 'a feather jig, tied on at once' );
	ok( cr.craft( 'pearlSpoon' ).ok && cr.stock.pearlLure === 1, 'a pearl spoon in the box' );
	ok( cr.craft( 'coirRope' ).ok && tr.cargo.rope && tr.cargo.rope.qty === 1 && ! tr.cargo.coconuts, 'coir rope goes into the hold' );
	ok( ! cr.craft( 'oilPatch' ).ok, 'the oil patch needs two fish of 1 kg+ (one left)' );
	ok( near( cr.biteModifier(), BAIT_BITE * ITEMS.lure.bite ), 'bait and jig together' );
	// use: catches wear the lure, strikes lost take bait
	const b0 = cr.stock.bait;
	features.emit( 'fishCaught', { species: 'grunt', kg: 0.5 } );
	features.emit( 'strikeMissed', {} );
	ok( cr.stock.bait === b0 - 2 && cr.tied.uses === 7, 'a catch and a miss: two bait, one lure use' );
	for ( let i = 0; i < 7; i ++ ) features.emit( 'fishCaught', {} );
	ok( ! cr.tied && w.app.game.toasts.some( ( t ) => /worn out/.test( t ) ), 'the jig wears out' );
	ok( cr.tie( 'pearlLure' ).ok && cr.tied.item === 'pearlLure' && cr.stock.pearlLure === 0, 'tie on the pearl spoon' );
	cr.useBait = false;
	ok( near( cr.biteModifier(), ITEMS.pearlLure.bite ), 'bait off: only the lure' );
	// patch kit at sea
	const hull = { hp: 20, max: 100, sunk: false };
	features.list.set( 'naval', { instance: { playerHull: hull } } );
	ok( cr.useRepairKit().ok && hull.hp === 55 && cr.stock.repairKit === 0, 'a patch kit restores 35% of the hull' );
	ok( ! cr.useRepairKit().ok, 'no kits left' );
	// the residents' shelf
	w.hb.shelf.home.bait = 7;
	w.hb.shelf.home.rope = 1;
	const sb = cr.buyShelf( 'bait', 5, 'home' );
	ok( sb.ok && w.hb.shelf.home.bait === 2 && cr.stock.bait === b0 - 9 + 5, 'buy the fishers\' bait from the shelf' );
	const before = tr.cargo.rope ? tr.cargo.rope.qty : 0;
	ok( cr.buyShelf( 'rope', 1, 'home' ).ok && tr.cargo.rope.qty === before + 1 && w.hb.shelf.home.rope === 0, 'and the dockworkers\' rope' );
	// the bench by hours: closed at night in the campaign
	w.app.settings.timeOfDay = 23;
	tick( w, 1.2 );
	ok( ! cr.benchOpen( cr.site( 'home' ) ) && ! cr.open( 'home' ) && w.app.game.toasts.some( ( t ) => /not at the bench \(back at 06:00\)/.test( t ) ), 'Bran is home at 23:00 (back at 06:00)' );
	ok( cr.sites.length >= 2 && cr.sites.some( ( s ) => s.port !== 'home' ), 'other ports have a bench too' );
	// interactable
	w.app.settings.timeOfDay = 10;
	tick( w, 1.2 );
	const it = features.nearestInteractable( w.app.player.position );
	ok( it && /crafting|tavern/.test( it.id ) && /Craft at/.test( it.prompt() ), `E at the bench: "${ it && it.prompt() }"` );
	it.onInteract();
	ok( cr.isOpen && features.panelOpen(), 'the bench window counts as an open panel' );
	w.app.player.position.set( PLACES.workshop.x + 20, 1, PLACES.workshop.z );
	tick( w, 0.6 );
	ok( ! cr.isOpen, 'walking away closes it' );
	// save
	const saved = JSON.parse( JSON.stringify( features.toJSON().crafting ) );
	const w2 = world( { residents: false } );
	w2.cr.fromJSON( saved );
	ok( w2.cr.stock.bait === cr.stock.bait && w2.cr.tied && w2.cr.tied.item === 'pearlLure' && w2.cr.useBait === false && w2.cr.made.cutBait === 1, 'crafting save round trip' );
	w2.cr.fromJSON( { stock: { bait: 1e9, repairKit: - 3 }, tied: { item: 'rocket', uses: 5 } } );
	ok( w2.cr.stock.bait === 60 && w2.cr.stock.repairKit === 0 && w2.cr.tied === null, 'bad save data is clamped' );
	// sandbox: the bench never closes
	const ws = world( { hour: 23, mode: 'sandbox', residents: true } );
	tick( ws, 1.2 );
	ok( ws.cr.benchOpen( ws.cr.site( 'home' ) ) && ws.hb.siteOpen( ws.hb.sites.tavern[ 0 ] ), 'sandbox: open at any hour' );
	void R;

}

if ( fails ) {

	console.log( `\n${ fails } FAILED` );
	process.exit( 1 );

}

console.log( '\nall green' );

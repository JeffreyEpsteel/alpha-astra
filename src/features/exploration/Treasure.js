// Treasure caches (docs/UNREAL_PARITY.md W13): a finite set of caches round the islands and on the seabed, each with
// fixed loot that can be claimed once. Found by coming close (a glint on the shore, a strongbox in a wreck), by
// spotting them through the spyglass, or from the scrap of chart inside the previous cache.
//
//   cacheSites( WORLD, terrain, { landmark } ) -> [ { id, kind, x, y, z, money, trinket, label } ]   (pure, deterministic)
//     kind 'shore'   a sea chest half buried above the tideline of every island (WORLD.islands, read at call time)
//          'wreck'   a strongbox in 4 - 9 m of water by the reef and off Gull Rock (dive for it)
//          'fallen'  under the inverted layer's landmark, dropped from the hanging isle (when a landmark is given)
//   const tr = new Treasure( app, features, { sites } );  tr.update( dt )  tr.discover( id, how )  tr.claim( id )
//   tr.markers() -> discovered caches for the world map  tr.found / tr.claimed (Sets)  tr.trinkets  tr.remaining()
//   tr.toJSON() / fromJSON() { found, claimed, trinkets }
// Events: 'treasureFound' { id, kind, how: 'near' | 'spyglass' | 'chart' }, 'treasureClaimed' { id, kind, money, trinket }.
// Loot is per player (each crew member has their own caches in multiplayer). In the Sandbox the money is still paid.

import { Group } from '../../engine/scene/Group.js';
import { Mesh } from '../../engine/scene/Mesh.js';
import { Material } from '../../engine/render/Material.js';
import { Soup } from '../inverted/Islets.js';
import { t } from '../../i18n/index.js';
import { WORLD } from '../../world/WorldLayout.js';

const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );

export const LOOT = {
	shore: { money: 320, trinkets: [ 'Brass compass', 'Pearl string', 'Carved whale tooth', 'Old coin purse' ] },
	wreck: { money: 750, trinkets: [ 'Ship\'s bell', 'Silver spoon set', 'Captain\'s log' ] },
	fallen: { money: 1200, trinkets: [ 'Upside-down hourglass' ] },
};
export const NEAR = { walk: 14, swim: 6, boat: 30 }; // m: how close you come before you notice it

function hash( s ) {

	let h = 2166136261;
	for ( let i = 0; i < s.length; i ++ ) h = Math.imul( h ^ s.charCodeAt( i ), 16777619 );
	return ( h >>> 0 ) / 4294967296;

}

// march out from an island's centre along an angle: over land (it may start in a lagoon), to the first point near the
// water, then back to dry sand
function shoreSpot( T, cx, cz, radius, ang ) {

	const dx = Math.cos( ang ), dz = Math.sin( ang );
	let land = false;
	for ( let d = 0; d < radius * 1.6; d += 1.5 ) {

		const x = cx + dx * d, z = cz + dz * d, h = T.heightAt( x, z );
		if ( h > 1.2 ) { land = true; continue; }
		if ( ! land || h >= 0.6 ) continue;
		// back up inland to 1.2 - 3 m above the sea
		for ( let b = 0; b < 30; b += 0.75 ) {

			const bx = x - dx * b, bz = z - dz * b, bh = T.heightAt( bx, bz );
			if ( bh > 1.2 && bh < 3 ) return { x: bx, y: bh, z: bz };
			if ( bh >= 3 ) break;

		}

		return null;

	}

	return null;

}

// a point in 4 - 9 m of water on a ring round ( cx, cz )
function seabedSpot( T, cx, cz, r0, r1, a0 ) {

	for ( let r = r0; r <= r1; r += 4 ) {

		for ( let k = 0; k < 24; k ++ ) {

			const a = a0 + k / 24 * Math.PI * 2;
			const x = cx + Math.cos( a ) * r, z = cz + Math.sin( a ) * r, h = T.heightAt( x, z );
			if ( h < - 4 && h > - 9 ) return { x, y: h, z };

		}

	}

	return null;

}

export function cacheSites( WORLD, T, { landmark = null } = {} ) {

	const out = [];
	if ( ! T ) return out;
	let ti = { shore: 0, wreck: 0 };
	const trinket = ( kind ) => LOOT[ kind ].trinkets[ ti[ kind ] ++ % LOOT[ kind ].trinkets.length ];
	for ( const isl of WORLD.islands || [] ) {

		const c = isl.center;
		let spot = null;
		for ( let k = 0; k < 24 && ! spot; k ++ ) spot = shoreSpot( T, c.x, c.z, isl.radius, ( hash( isl.id ) + k * 0.37 ) * Math.PI * 2 );
		if ( ! spot ) continue;
		out.push( { id: 'shore-' + isl.id, kind: 'shore', ...spot, money: LOOT.shore.money + Math.round( hash( isl.id + 'm' ) * 200 ), trinket: trinket( 'shore' ), label: t( 'treasure.shore', 'Sea chest' ) } );

	}

	const reef = WORLD.reef ? WORLD.reef.center : null;
	const wrecks = [];
	if ( reef ) wrecks.push( [ 'wreck-reef', reef.x, reef.z, 20, 90, 0.6 ] );
	const gull = ( WORLD.islands || [] ).find( ( i ) => i.id === 'gull' );
	if ( gull ) wrecks.push( [ 'wreck-gull', gull.center.x, gull.center.z, gull.radius * 0.8, gull.radius * 2, 2.2 ] );
	for ( const [ id, x, z, r0, r1, a0 ] of wrecks ) {

		const s = seabedSpot( T, x, z, r0, r1, a0 );
		if ( s ) out.push( { id, kind: 'wreck', ...s, money: LOOT.wreck.money + Math.round( hash( id ) * 300 ), trinket: trinket( 'wreck' ), label: t( 'treasure.wreck', 'Wreck strongbox' ) } );

	}

	if ( landmark ) out.push( { id: 'fallen-spire', kind: 'fallen', x: landmark.x + 6, y: T.heightAt( landmark.x + 6, landmark.z ), z: landmark.z, money: LOOT.fallen.money, trinket: LOOT.fallen.trinkets[ 0 ], label: t( 'treasure.fallen', 'Fallen chest' ) } );
	return out;

}

// a small chest (open or shut) with gold corners; glint marks the bands that sparkle
function chestSoup( open, buried ) {

	const S = new Soup();
	const WOOD = [ 0.36, 0.22, 0.11 ], BAND = [ 0.75, 0.56, 0.2 ], DARK = [ 0.08, 0.06, 0.05 ];
	const box = ( x0, y0, z0, x1, y1, z1, col, glow = 0 ) => {

		const p = ( x, y, z ) => [ x, y, z ];
		S.quad( p( x0, y0, z1 ), p( x1, y0, z1 ), p( x1, y1, z1 ), p( x0, y1, z1 ), col, null, glow );
		S.quad( p( x1, y0, z0 ), p( x0, y0, z0 ), p( x0, y1, z0 ), p( x1, y1, z0 ), col, null, glow );
		S.quad( p( x0, y0, z0 ), p( x0, y0, z1 ), p( x0, y1, z1 ), p( x0, y1, z0 ), col, null, glow );
		S.quad( p( x1, y0, z1 ), p( x1, y0, z0 ), p( x1, y1, z0 ), p( x1, y1, z1 ), col, null, glow );
		S.quad( p( x0, y1, z1 ), p( x1, y1, z1 ), p( x1, y1, z0 ), p( x0, y1, z0 ), col, null, glow );

	};

	const sink = buried ? - 0.22 : 0;
	box( - 0.45, sink, - 0.3, 0.45, 0.42 + sink, 0.3, WOOD );
	box( - 0.47, 0.3 + sink, - 0.32, - 0.4, 0.44 + sink, 0.32, BAND, 1 );
	box( 0.4, 0.3 + sink, - 0.32, 0.47, 0.44 + sink, 0.32, BAND, 1 );
	if ( open ) {

		box( - 0.43, 0.38 + sink, - 0.28, 0.43, 0.4 + sink, 0.28, DARK ); // the empty inside
		box( - 0.45, 0.42 + sink, - 0.36, 0.45, 0.95 + sink, - 0.3, WOOD ); // the lid thrown back

	} else box( - 0.45, 0.42 + sink, - 0.3, 0.45, 0.6 + sink, 0.3, WOOD );
	if ( buried ) {

		// two crossed driftwood sticks: the X on the sand
		const stick = ( a ) => {

			const c = Math.cos( a ), s = Math.sin( a ), L = 0.9, w = 0.05;
			const P = ( u, v, y ) => [ 1.0 + u * c - v * s, y, 0.2 + u * s + v * c ];
			S.quad( P( - L, - w, 0.03 ), P( L, - w, 0.03 ), P( L, w, 0.03 ), P( - L, w, 0.03 ), [ 0.55, 0.47, 0.36 ] );

		};

		stick( 0.7 ); stick( - 0.7 );

	}

	return S;

}

export class Treasure {

	constructor( app, features, { sites = null, world = WORLD } = {} ) {

		this.app = app;
		this.world = world;
		this.features = features || null;
		this.sites = sites;
		this.found = new Set();
		this.claimed = new Set();
		this.trinkets = [];
		this.group = null;
		this._meshes = new Map();
		this._removers = [];
		this._acc = 0;
		this.time = 0;

	}

	_toast( text, ms = 3200 ) {

		const g = this.app && this.app.game;
		if ( g && g.toast ) g.toast( text, ms );

	}

	_emit( name, e ) {

		if ( this.features && this.features.emit ) this.features.emit( name, e );

	}

	// the sites need the heightmap (and the inverted landmark when that feature is there): made on the first update
	_ensureSites() {

		if ( this.sites ) return;
		const app = this.app || {};
		if ( ! app.terrainData ) return;
		const inv = this.features && this.features.get ? this.features.get( 'inverted' ) : null;
		const lm = inv && inv.layout ? inv.layout.find( ( s ) => s.landmark ) : null;
		this.sites = cacheSites( this.world, app.terrainData, { landmark: lm } );

	}

	_build() {

		const app = this.app || {};
		if ( this.group || ! app.scene || ! this.sites ) return;
		this.group = new Group();
		this.group.name = 'TreasureCaches';
		const mat = new Material( {
			name: 'TreasureChest',
			vertexColors: true,
			roughness: 0.7,
			attributes: { aSway: 'vec3f', aGlow: 'f32' },
			varyings: { vGlint: 'f32' },
			uniforms: { glint: [ 'f32', 1 ] },
			vertex: 'o.vGlint = v.aGlow;',
			surface: /* wgsl */`
	// the gold bands catch the light now and then: a slow sparkle while the chest is still shut
	let tw = pow( max( sin( frame.time * 2.1 + in.P.x * 3.0 + in.P.z * 2.0 ), 0.0 ), 24.0 );
	s.metalness = in.vs.vGlint * 0.9;
	s.roughness = mix( 0.75, 0.3, in.vs.vGlint );
	s.emissive = vec3f( 1.0, 0.8, 0.4 ) * in.vs.vGlint * tw * 3.0 * mat.glint;
`,
		} );
		const openMat = new Material( { name: 'TreasureChestOpen', vertexColors: true, roughness: 0.75 } );
		const geos = { shutB: chestSoup( false, true ).geometry(), shut: chestSoup( false, false ).geometry(), openB: chestSoup( true, true ).geometry(), open: chestSoup( true, false ).geometry() };
		for ( const s of this.sites ) {

			const buried = s.kind === 'shore';
			const shut = new Mesh( buried ? geos.shutB : geos.shut, mat ), open = new Mesh( buried ? geos.openB : geos.open, openMat );
			for ( const m of [ shut, open ] ) {

				m.position.set( s.x, s.y, s.z );
				m.rotation.y = hash( s.id + 'yaw' ) * Math.PI * 2;
				m.castShadow = true;
				this.group.add( m );

			}

			this._meshes.set( s.id, { shut, open } );
			this._show( s.id );
			const f = this.features;
			if ( f && f.interactable ) {

				this._removers.push( f.interactable( {
					id: 'treasure-' + s.id, position: { x: s.x, y: s.y + 0.4, z: s.z }, radius: 2.2,
					prompt: () => ( this.claimed.has( s.id ) ? null : s.kind === 'shore' ? t( 'treasure.prompt.dig', 'E · Dig up the chest' ) : s.kind === 'wreck' ? t( 'treasure.prompt.pry', 'E · Pry open the strongbox' ) : t( 'treasure.prompt.open', 'E · Open the chest' ) ),
					onInteract: () => this.claim( s.id ),
					when: () => ! this.claimed.has( s.id ),
				} ) );

			}

		}

		app.scene.add( this.group );

	}

	_show( id ) {

		const m = this._meshes.get( id );
		if ( ! m ) return;
		const c = this.claimed.has( id );
		m.shut.visible = ! c;
		m.open.visible = c;

	}

	site( id ) {

		return this.sites ? this.sites.find( ( s ) => s.id === id ) || null : null;

	}

	discover( id, how = 'near' ) {

		const s = this.site( id );
		if ( ! s || this.found.has( id ) ) return false;
		this.found.add( id );
		this._emit( 'treasureFound', { id, kind: s.kind, how } );
		if ( how === 'near' ) this._toast( s.kind === 'wreck' ? t( 'treasure.found.wreck', 'A strongbox lies in the wreck below' ) : t( 'treasure.found.near', 'Something glints nearby' ), 2600 );
		else if ( how === 'spyglass' ) this._toast( t( 'treasure.found.spyglass', 'Spotted a cache: marked on your chart' ), 2600 );
		return true;

	}

	claim( id ) {

		const s = this.site( id );
		if ( ! s || this.claimed.has( id ) ) return null;
		this.found.add( id );
		this.claimed.add( id );
		const st = this.features && this.features.state;
		if ( st && st.earn ) st.earn( s.money );
		if ( s.trinket ) this.trinkets.push( s.trinket );
		this._show( id );
		const loot = { id, kind: s.kind, money: s.money, trinket: s.trinket };
		this._emit( 'treasureClaimed', loot );
		// a scrap of chart inside points at the next cache nobody has found yet
		const next = this.sites.find( ( q ) => ! this.found.has( q.id ) );
		if ( next ) this.discover( next.id, 'chart' );
		const what = `${ s.trinket ? s.trinket + ' and ' : '' }$${ s.money }`;
		this._toast( next ? `${ what } · ${ t( 'treasure.chart', 'a scrap of chart marks another cache' ) }` : what, 4200 );

		return loot;

	}

	remaining() {

		return this.sites ? this.sites.filter( ( s ) => ! this.claimed.has( s.id ) ).length : 0;

	}

	// the caches the player knows about, for the world map (it draws them; this only exposes them)
	markers() {

		if ( ! this.sites ) return [];
		return this.sites.filter( ( s ) => this.found.has( s.id ) ).map( ( s ) => ( { id: 'treasure-' + s.id, kind: 'treasure', x: s.x, z: s.z, claimed: this.claimed.has( s.id ), label: s.label } ) );

	}

	update( dt ) {

		this.time += dt;
		this._ensureSites();
		if ( ! this.sites ) return;
		if ( ! this.group ) this._build();
		this._acc += dt;
		if ( this._acc < 0.25 ) return;
		this._acc = 0;
		const p = this.app && this.app.player;
		if ( ! p || ! p.position ) return;
		const mode = p.mode === 'swim' ? 'swim' : p.mode === 'walk' ? 'walk' : 'boat';
		const near = NEAR[ mode ];
		for ( const s of this.sites ) {

			if ( this.found.has( s.id ) ) continue;
			// wrecks show from the surface only when diving close or right over them in a boat
			const r = s.kind === 'wreck' && mode === 'walk' ? 0 : s.kind === 'wreck' ? near * 0.6 : near;
			if ( Math.hypot( s.x - p.position.x, s.z - p.position.z ) < r ) this.discover( s.id, 'near' );

		}

	}

	toJSON() {

		return { found: [ ...this.found ], claimed: [ ...this.claimed ], trinkets: [ ...this.trinkets ] };

	}

	fromJSON( d ) {

		if ( ! d || typeof d !== 'object' ) return;
		this.found = new Set( Array.isArray( d.found ) ? d.found.filter( ( x ) => typeof x === 'string' ) : [] );
		this.claimed = new Set( Array.isArray( d.claimed ) ? d.claimed.filter( ( x ) => typeof x === 'string' ) : [] );
		for ( const c of this.claimed ) this.found.add( c );
		this.trinkets = Array.isArray( d.trinkets ) ? d.trinkets.filter( ( x ) => typeof x === 'string' ).slice( 0, 64 ) : [];
		for ( const id of this._meshes.keys() ) this._show( id );

	}

	reset() {

		this.found.clear();
		this.claimed.clear();
		this.trinkets.length = 0;
		for ( const id of this._meshes.keys() ) this._show( id );

	}

	dispose() {

		for ( const r of this._removers ) try { r(); } catch ( e ) { /* gone */ }
		this._removers.length = 0;
		if ( this.group && this.group.parent ) this.group.parent.remove( this.group );
		this.group = null;

	}

}

export { clamp };

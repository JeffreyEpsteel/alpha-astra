import { Vector3 } from '../../engine/index.js';
import { WORLD } from '../../world/WorldLayout.js';
import { BOATS } from '../../game/Boats.js';
import { Vendor } from '../../game/Vendor.js';
import { createPropMaterial } from '../../game/GameMaterials.js';
import { AIRFRAMES } from '../seaplane/Airframes.js';
import { agentPorts, portInfo, agentSpot, berthPoint, planeSpot, ferryBase, AGENT_FEE, HOME_RANGE } from './Spots.js';
import { makeLectern, lanternLight, LANTERN } from './Lectern.js';
import { renderAgentYard } from './Panel.js';

// Roid & Co.'s harbour agents (wave 14C): a replacement boat or plane at every port. Each port of WORLD.ports but home
// (Captain Roid himself keeps the home yard) gets an agent on its jetty head: a lectern with a ledger, a lantern and the
// placard "Roid & Co. · boats and recoveries" (Lectern.js, GeoKit) and a Vendor of kind 'yard' (vendor.port = the port id)
// pushed into app.game.vendors, so E opens the yard window; HudPanels sets hud.yardPort = vendor.port and hands the
// window to agents.renderYard( hud ) (Panel.js). What an agent does, delivered to THAT port:
//   boats       buy / trade / take one: moored at this dock (app.setBoat( id, { dock } ), then moored here)
//   salvage     your sunk boat raised (naval.salvage) and moored at this dock
//   ferry       your boat, afloat elsewhere, sailed round to this dock (ferryBase by distance)
//   seaplane    the wreck recovered to this port's water (sp.recall( { at } ): Tidemark's bay, else 40 m off the dock
//               head); a lost Kestrel (land plane) is the airstrip's business; an owned plane flown round on request
// Prices: the yard's price x story.priceMod( port ) x 1.15 (the agent's fee); the sandbox is free. Local state only
// (multiplayer syncs the boat change as before).
// On foot (or swimming) with no boat and no plane, more than HOME_RANGE from the home dock, the nearest agent (or Roid's
// yard) is pinned on the maps (questPin { id: 'agent' }, questPinClear when that ends) with one toast a session; after a
// respawn without a boat a toast names the agents.
//
//   features.add( 'agents', agents );   const ag = features.get( 'agents' );
//   ag.list                     [ { port, name, dock, spot, vendor } ]        ag.agentOf( port )
//   ag.price( base, port )      what the agent charges for a yard price      ag.priceMod( port ) / ag.fee / ag.free()
//   ag.rows( port )             the window's rows [ { key, label, note, price, action, have, disabled, trade, owned } ]
//   ag.act( key, port )         'boat:<id>' | 'salvage' | 'ferry' | 'plane' | 'planeFerry'
//   ag.buyBoat( id, port ) / salvage( port ) / ferryBoat( port ) / recoverPlane( port ) / ferryPlane( port )
//   ag.moor( port, boatId )     the owned boat moored at that port's dock (berthPoint)
//   ag.nearest( x, z )          { port, x, z, d, label } the nearest agent or Roid's yard
//   ag.renderYard( hud )        the agent's window (HudPanels hands it over when hud.yardPort is set)
//   ag.update( dt ) / reset() / dispose(); ag.lights (the lectern lanterns)
// Events: agentDelivery { kind: 'boat' | 'salvage' | 'ferry' | 'plane' | 'planeFerry', port, price, boat?, airframe? }.

const ON_FOOT = [ 'walk', 'swim' ];
const PIN_ID = 'agent';
const FERRY_MIN = 60; // m: a boat closer than this to the berth is already here
const PLANE_FERRY_MIN = 120;
const _up = new Vector3( 0, 1, 0 );

const LOOKS = [
	{ skin: 0x9a6a4a, hair: 0x2a221c }, { skin: 0xb98660, hair: 0x6b5a48 }, { skin: 0x7a5038, hair: 0x1c1a18 },
	{ skin: 0xc49a78, hair: 0xb8b2a6 }, { skin: 0x8c5e40, hair: 0x3a2e24 },
];

function hash( s ) {

	let h = 7;
	for ( let i = 0; i < s.length; i ++ ) h = ( h * 31 + s.charCodeAt( i ) ) >>> 0;
	return h;

}

export class Agents {

	constructor( app, features, opts = {} ) {

		this.app = app;
		this.features = features;
		this.fee = AGENT_FEE;
		this.list = [];
		this.lights = [];
		this.scene = opts.scene !== undefined ? opts.scene : ( app && app.scene ) || null;
		const terrain = app && app.terrainData, colliders = app && app.colliders;
		this.material = opts.material || ( this.scene ? createPropMaterial( 'harbourAgent' ) : null );
		this._groups = [];
		for ( const port of agentPorts() ) {

			const spot = agentSpot( port );
			const look = LOOKS[ hash( port.id ) % LOOKS.length ];
			const vendor = new Vendor( {
				name: `Roid & Co. · ${ port.name }`,
				kind: 'yard',
				position: new Vector3( spot.x, spot.y, spot.z ),
				yaw: spot.yaw,
				radius: 2.4,
				greeting: 'Boats bought, sold and raised. Captain Roid\'s prices, a little on top for the trip',
				idle: 'Lost your boat? Roid & Co. raises her and brings her round.',
				material: this.material,
				look: { shirt: 0x2f4256, trousers: 0x2b2b30, apron: 0x3b4a5c, hat: 0x1f2a36, ...look },
			} );
			vendor.port = port.id;
			vendor.agent = true;
			const agent = { port: port.id, name: port.name, dock: port.dock, spot, vendor };
			this.list.push( agent );
			if ( this.scene ) {

				this.scene.add( vendor.group );
				const L = makeLectern( this.material );
				L.position.set( spot.lectern.x, spot.lectern.y, spot.lectern.z );
				L.rotation.y = spot.lectern.yaw;
				this.scene.add( L );
				this._groups.push( vendor.group, L );

			}

			const c = Math.cos( spot.yaw ), s = Math.sin( spot.yaw );
			const lw = ( lx, lz ) => [ spot.lectern.x + lx * c + lz * s, spot.lectern.z - lx * s + lz * c ];
			const [ lx, lz ] = lw( LANTERN.x, LANTERN.z );
			this.lights.push( lanternLight( lx, spot.y + LANTERN.y, lz ) );
			if ( colliders && colliders.addBox && ! opts.noColliders ) colliders.addBox( new Vector3( spot.lectern.x, spot.y + 0.6, spot.lectern.z ), new Vector3( 0.28, 0.6, 0.22 ), spot.lectern.yaw, { tag: 'agentLectern' } );
			if ( terrain ) agent.planeAt = planeSpot( port, terrain );

		}

		// the agents trade like the stalls: Game updates them and gives them the E prompt
		const vendors = app && app.game && app.game.vendors;
		if ( Array.isArray( vendors ) ) for ( const a of this.list ) if ( ! vendors.includes( a.vendor ) ) vendors.push( a.vendor );

		this._t = 0;
		this._next = 0;
		this._pin = undefined; // unknown at start: the first check clears a pin a loaded save may still carry
		this._toldPin = false;
		this._hintAt = null;
		this.off = [];
		if ( features && features.on ) this.off.push( features.on( 'playerRespawned', () => {

			if ( ! this.hasBoat() ) this._hintAt = this._t + 1.6; // after the cut's fade

		} ) );

	}

	// ---- lookups

	get state() {

		return this.features && this.features.state ? this.features.state : this.app && this.app.game ? this.app.game.state : null;

	}

	_f( name ) {

		return this.features && this.features.get ? this.features.get( name ) : null;

	}

	agentOf( port ) {

		return this.list.find( ( a ) => a.port === port ) || null;

	}

	free() {

		const st = this.state;
		return !! ( ( st && st.free ) || ( this.features && this.features.sandbox ) );

	}

	priceMod( port ) {

		const m = this._f( 'story' )?.priceMod?.( port );
		return Number.isFinite( m ) && m > 0 ? m : 1;

	}

	price( base, port ) {

		if ( this.free() ) return 0;
		if ( ! Number.isFinite( base ) ) return Infinity;
		if ( ! port || port === 'home' ) return Math.round( base );
		return Math.round( base * this.priceMod( port ) * ( 1 + this.fee ) );

	}

	heading( port ) {

		const A = this.agentOf( port );
		return `Roid & Co. · ${ A ? A.name : ( portInfo( port )?.name || port ) }`;

	}

	toast( text, ms = 3200 ) {

		const g = this.app && this.app.game;
		if ( g && g.toast ) g.toast( text, ms );

	}

	_coin() {

		const a = this.app && this.app.audio;
		if ( a && a.coin ) try { a.coin(); } catch ( e ) { /* audio is optional */ }

	}

	_emit( kind, data ) {

		if ( this.features && this.features.emit ) this.features.emit( 'agentDelivery', { kind, ...data } );

	}

	// charge what the agent asks over what the yard's own call already took (both checked against the purse first)
	_extra( price, base ) {

		const st = this.state, extra = Math.round( price - base );
		if ( ! this.free() && extra > 0 && st && st.spend ) st.spend( extra );

	}

	_canPay( price ) {

		const st = this.state;
		return this.free() || ( st && Number.isFinite( price ) && price <= st.money );

	}

	hasBoat() {

		const st = this.state, nv = this._f( 'naval' );
		return !! ( st && st.boat ) && ! ( nv && ( nv.wreck || nv.sinking ) );

	}

	hasPlane() {

		const sp = this._f( 'seaplane' );
		return !! ( sp && sp.owned && ! sp.lost );

	}

	_plane() {

		const sp = this._f( 'seaplane' );
		if ( ! sp || ! sp.owned ) return null;
		const A = AIRFRAMES[ sp.af ] || null;
		return { sp, af: sp.af, name: A ? A.name : 'seaplane', land: !! ( A && A.land ), lost: !! sp.lost, piloted: !! sp.piloted };

	}

	_planeAt( A ) {

		return A.planeAt || ( A.planeAt = planeSpot( portInfo( A.port ), this.app && this.app.terrainData ) );

	}

	// ---- the boat moored at a port's dock

	moor( port, boatId ) {

		const A = this.agentOf( port ), b = this.app && this.app.boatCtl;
		if ( ! A || ! b ) return false;
		const p = berthPoint( A.dock, boatId || ( this.state && this.state.boat ) );
		const bw = { x: p.x, z: p.z, heading: p.heading, moored: true };
		if ( typeof this.app._placeBoat === 'function' ) this.app._placeBoat( bw );
		else {

			if ( b.position ) b.position.set( bw.x, 0, bw.z );
			if ( b.quaternion && b.quaternion.setFromAxisAngle ) b.quaternion.setFromAxisAngle( _up, bw.heading );
			if ( b.velocity ) b.velocity.set( 0, 0, 0 );
			if ( b.angular ) b.angular.set( 0, 0, 0 );
			b.throttle = 0;
			b.driven = false;
			b.moored = true;
			if ( b.mooring ) {

				b.mooring.anchor.set( bw.x, 0, bw.z );
				b.mooring.heading = bw.heading;

			}

			if ( b.apply ) try { b.apply(); } catch ( e ) { /* the next frame places her */ }

		}

		return true;

	}

	// ---- what the window offers

	ferryQuote( port ) {

		const A = this.agentOf( port ), st = this.state, b = this.app && this.app.boatCtl, p = this.app && this.app.player;
		if ( ! A || ! this.hasBoat() || ! b || b.enabled === false || b.driven || ! b.position ) return null;
		if ( p && [ 'boat', 'deck', 'seat' ].includes( p.mode ) ) return null;
		const at = berthPoint( A.dock, st.boat );
		const dist = Math.hypot( b.position.x - at.x, b.position.z - at.z );
		if ( dist < FERRY_MIN ) return null;
		const base = ferryBase( dist );
		return { dist, base, price: this.price( base, port ) };

	}

	planeFerryQuote( port ) {

		const A = this.agentOf( port ), ps = this._plane();
		if ( ! A || ! ps || ps.lost || ps.piloted || ps.land || ps.sp.chute ) return null;
		const m = ps.sp.marker ? ps.sp.marker() : null;
		if ( ! m ) return null;
		const at = this._planeAt( A );
		const dist = Math.hypot( m.x - at.x, m.z - at.z );
		if ( dist < PLANE_FERRY_MIN ) return null;
		const base = Math.round( ferryBase( dist ) * 1.5 / 10 ) * 10;
		return { dist, base, price: this.price( base, port ), at };

	}

	rows( port ) {

		const A = this.agentOf( port ), st = this.state;
		if ( ! A || ! st ) return [];
		const free = this.free(), out = [];
		for ( const [ id, b ] of Object.entries( BOATS ) ) {

			const owned = st.boat === id, price = this.price( st.boatPrice( id ), port );
			out.push( {
				key: 'boat:' + id, label: b.name, note: b.description || '', price, owned,
				have: owned ? 'Yours' : null, action: free ? 'Take' : st.boat ? 'Trade' : 'Buy', trade: ! free && !! st.boat && ! owned,
				disabled: ! free && price > st.money,
			} );

		}

		const nv = this._f( 'naval' ), w = nv && nv.wreck;
		if ( w && nv.salvageCost ) {

			const price = this.price( nv.salvageCost(), port );
			out.push( { key: 'salvage', label: `Salvage the ${ BOATS[ w.boat ] ? BOATS[ w.boat ].name : 'boat' }`, note: `She lies on the sea floor · raised and moored here at ${ A.name }`, price, action: 'Salvage', disabled: ! free && price > st.money } );

		}

		const fq = this.ferryQuote( port );
		if ( fq ) out.push( { key: 'ferry', label: `Have your ${ BOATS[ st.boat ].name } sailed here`, note: `She lies ${ Math.round( fq.dist ) } m away · moored at this dock`, price: fq.price, action: 'Send for her', disabled: ! free && fq.price > st.money } );

		const ps = this._plane();
		let kestrel = false;
		if ( ps && ps.lost ) {

			if ( ps.land ) {

				kestrel = true;
				out.push( { key: 'kestrel', label: `The ${ ps.name }: ask at the airstrip`, note: 'A land plane: the airstrip hangar on Tidemark recovers her', have: 'Airstrip' } );

			} else {

				const sp = ps.sp, price = this.price( sp.recoveryCost ? sp.recoveryCost() : 600, port );
				out.push( {
					key: 'plane', label: port === 'tidemark' ? 'Recover the seaplane to the bay' : 'Recover the seaplane wreck',
					note: port === 'tidemark' ? 'Raised and towed to the bay anchorage · repair her at a hangar' : `Raised and towed to the water off ${ A.name }'s dock · repair her at a hangar`,
					price, action: 'Recover', disabled: ! free && price > st.money,
				} );

			}

		// wave 15C: the boats you left behind when you took another vessel
		const hj = this.features?.get?.( 'hijack' );
		if ( hj && Array.isArray( hj.left ) ) for ( const e of hj.left ) {

			const d = Math.hypot( e.x - A.dock.position.x, e.z - A.dock.position.z );
			const price = free ? 0 : this.price( 40 + Math.round( d * 0.06 ), port );
			out.push( { key: `left:${ e.id }`, label: `Have your ${ e.name || ( BOATS[ e.boat ] ? BOATS[ e.boat ].name : 'boat' ) } sailed here`, note: `Left ${ Math.round( d ) } m away when you took another vessel · moored at this dock`, price, action: 'Send for her', disabled: ! free && price > st.money } );

		}
		// wave 15D: distress flares, sold here too
		const rescue = this.features?.get?.( 'rescue' );
		if ( rescue && rescue.agentRow ) out.push( rescue.agentRow( port ) );

		}

		if ( port === 'tidemark' && ! kestrel ) out.push( { key: 'kestrel', label: 'The Kestrel: ask at the airstrip', note: 'The land plane is sold, kept and recovered at the airstrip hangar behind the town', have: 'Airstrip' } );
		const pq = this.planeFerryQuote( port );
		if ( pq ) out.push( { key: 'planeFerry', label: `Fly your ${ ps.name } here`, note: `She is ${ Math.round( pq.dist ) } m away · left on the water off the dock`, price: pq.price, action: 'Send for her', disabled: ! free && pq.price > st.money } );
		return out;

	}

	act( key, port ) {

		if ( typeof key !== 'string' ) return false;
		if ( key.startsWith( 'boat:' ) ) return this.buyBoat( key.slice( 5 ), port );
		if ( key === 'salvage' ) return this.salvage( port );
		if ( key === 'ferry' ) return this.ferryBoat( port );
		if ( key === 'plane' ) return !! this.recoverPlane( port )?.ok;
		if ( key === 'planeFerry' ) return !! this.ferryPlane( port )?.ok;
		if ( key === 'flares' ) return !! this.features?.get?.( 'rescue' )?.buy?.( { port } ); // wave 15D
		if ( key.startsWith( 'left:' ) ) { const A = this.list.find( ( a ) => a.port === port ); return !! this.features?.get?.( 'hijack' )?.recover?.( key.slice( 5 ), { dock: A ? A.dock : null } ); } // wave 15C
		return false;

	}

	// ---- the deals

	buyBoat( id, port ) {

		const A = this.agentOf( port ), st = this.state, b = BOATS[ id ];
		if ( ! A || ! st || ! b ) return false;
		if ( st.boat === id ) {

			this.toast( 'That one is already yours', 2600 );
			return false;

		}

		const base = st.boatPrice( id ), price = this.price( base, port );
		if ( ! this._canPay( price ) || ! st.buyBoat( id ) ) {

			this.toast( `The ${ b.name } costs $${ price.toLocaleString( 'en-US' ) } here · you have $${ st.money.toLocaleString( 'en-US' ) }`, 2600 );
			return false;

		}

		this._extra( price, base );
		if ( this.app && typeof this.app.setBoat === 'function' ) this.app.setBoat( id, { dock: A.dock } );
		this.moor( port, id );
		this.toast( `${ b.name } · yours. She is moored at ${ A.name }'s dock.`, 3600 );
		this._coin();
		this._emit( 'boat', { port, price, boat: id } );
		return true;

	}

	salvage( port ) {

		const A = this.agentOf( port ), st = this.state, nv = this._f( 'naval' ), w = nv && nv.wreck;
		if ( ! A || ! st || ! w || ! nv.salvage ) return false;
		const base = nv.salvageCost ? nv.salvageCost() : 0, price = this.price( base, port );
		if ( ! this._canPay( price ) ) {

			this.toast( `Raising her costs $${ price.toLocaleString( 'en-US' ) } here · you have $${ st.money.toLocaleString( 'en-US' ) }`, 2600 );
			return false;

		}

		if ( ! nv.salvage( { free: this.free() } ) ) return false;
		this._extra( price, base );
		this.moor( port, w.boat );
		this.toast( `The ${ BOATS[ w.boat ] ? BOATS[ w.boat ].name : 'boat' } is raised and moored at ${ A.name }'s dock`, 3600 );
		this._coin();
		if ( st.save ) st.save();
		this._emit( 'salvage', { port, price, boat: w.boat } );
		return true;

	}

	ferryBoat( port ) {

		const A = this.agentOf( port ), st = this.state, q = this.ferryQuote( port );
		if ( ! A || ! q ) return false;
		if ( ! this._canPay( q.price ) || ( ! this.free() && ! st.spend( q.price ) ) ) {

			this.toast( `Sailing her round costs $${ q.price.toLocaleString( 'en-US' ) } · you have $${ st.money.toLocaleString( 'en-US' ) }`, 2600 );
			return false;

		}

		this.moor( port, st.boat );
		this.toast( `Your ${ BOATS[ st.boat ].name } was sailed round to ${ A.name }'s dock`, 3600 );
		this._coin();
		if ( st.save ) st.save();
		this._emit( 'ferry', { port, price: q.price, boat: st.boat } );
		return true;

	}

	_delivered( sp, at ) {

		const m = sp && sp.marker ? sp.marker() : null;
		return !! ( m && Math.hypot( m.x - at.x, m.z - at.z ) < 30 );

	}

	recoverPlane( port ) {

		const A = this.agentOf( port ), st = this.state, ps = this._plane();
		if ( ! A || ! st || ! ps || ! ps.lost ) return { ok: false, text: '' };
		if ( ps.land ) {

			const r = { ok: false, text: `The ${ ps.name }: ask at the airstrip on Tidemark` };
			this.toast( r.text, 3000 );
			return r;

		}

		const sp = ps.sp, base = sp.recoveryCost ? sp.recoveryCost() : 600, price = this.price( base, port );
		if ( ! this._canPay( price ) ) {

			const r = { ok: false, text: `Recovering her costs $${ price.toLocaleString( 'en-US' ) } here · you have $${ st.money.toLocaleString( 'en-US' ) }` };
			this.toast( r.text, 2600 );
			return r;

		}

		const at = this._planeAt( A );
		const r = sp.recall?.( { at: { x: at.x, z: at.z, heading: at.heading, water: true } } ) || { ok: false, text: '' };
		if ( r.ok ) {

			const here = this._delivered( sp, at );
			if ( here ) this._extra( price, base ); // (an older seaplane tows her to its ramp: the yard's price only)
			r.text = here ? `Roid & Co. raised the wreck and towed her to ${ port === 'tidemark' ? 'the bay' : `the water off ${ A.name }'s dock` } · repair her at a hangar` : r.text;
			this._coin();
			this._emit( 'plane', { port, price: here ? price : base, airframe: ps.af } );

		}

		if ( r.text ) this.toast( r.text, 3400 );
		return r;

	}

	ferryPlane( port ) {

		const A = this.agentOf( port ), st = this.state, q = this.planeFerryQuote( port ), ps = this._plane();
		if ( ! A || ! q || ! ps ) return { ok: false, text: '' };
		if ( ! this._canPay( q.price ) ) {

			const r = { ok: false, text: `Flying her round costs $${ q.price.toLocaleString( 'en-US' ) } · you have $${ st.money.toLocaleString( 'en-US' ) }` };
			this.toast( r.text, 2600 );
			return r;

		}

		const r = ps.sp.recall?.( { at: { x: q.at.x, z: q.at.z, heading: q.at.heading, water: true } } ) || { ok: false, text: '' };
		if ( r.ok && this._delivered( ps.sp, q.at ) ) {

			if ( ! this.free() ) st.spend( q.price ); // charged once she is here
			r.text = `Your ${ ps.name } was flown round to ${ A.name } · she rides off the dock`;
			this._coin();
			this._emit( 'planeFerry', { port, price: q.price, airframe: ps.af } );

		}

		if ( r.text ) this.toast( r.text, 3400 );
		return r;

	}

	// ---- the maps: the nearest agent while you are stranded

	nearest( x, z ) {

		let best = null;
		const consider = ( port, px, pz, label ) => {

			const d = Math.hypot( px - x, pz - z );
			if ( ! best || d < best.d ) best = { port, x: Math.round( px * 10 ) / 10, z: Math.round( pz * 10 ) / 10, d, label };

		};
		for ( const a of this.list ) consider( a.port, a.spot.x, a.spot.z, 'Harbour agent' );
		const g = this.app && this.app.game, rv = g && g.roid && g.roid.vendor;
		const home = rv && rv.position ? rv.position : WORLD.boatDock.position;
		consider( 'home', home.x, home.z, 'Captain Roid\'s yard' );
		return best;

	}

	_pinWanted() {

		const p = this.app && this.app.player;
		if ( ! p || ! p.position || ! ON_FOOT.includes( p.mode ) ) return null;
		if ( this.hasBoat() || this.hasPlane() ) return null;
		const h = WORLD.boatDock.position;
		if ( Math.hypot( p.position.x - h.x, p.position.z - h.z ) <= HOME_RANGE ) return null;
		return this.nearest( p.position.x, p.position.z );

	}

	update( dt ) {

		this._t += dt;
		if ( this._hintAt !== null && this._t >= this._hintAt ) {

			this._hintAt = null;
			this.toast( 'No boat? Captain Roid\'s yard, or Roid & Co. at any port\'s dock, sells and raises them', 4200 );

		}

		if ( this._t < this._next ) return;
		this._next = this._t + 0.5;
		const want = this._pinWanted();
		const F = this.features;
		if ( want ) {

			if ( ! this._pin || this._pin.port !== want.port ) {

				F?.emit?.( 'questPin', { id: PIN_ID, x: want.x, z: want.z, label: want.label } );
				this._pin = want;
				if ( ! this._toldPin ) {

					this._toldPin = true;
					this.toast( 'No boat? Roid\'s agent at the dock sells and recovers', 3600 );

				}

			}

		} else if ( this._pin !== null ) {

			F?.emit?.( 'questPinClear', { id: PIN_ID } );
			this._pin = null;

		}

	}

	renderYard( hud ) {

		return renderAgentYard( hud, this );

	}

	reset() {

		if ( this._pin ) this.features?.emit?.( 'questPinClear', { id: PIN_ID } );
		this._pin = undefined;
		this._hintAt = null;

	}

	dispose() {

		for ( const off of this.off ) if ( typeof off === 'function' ) off();
		this.off = [];
		const vendors = this.app && this.app.game && this.app.game.vendors;
		if ( Array.isArray( vendors ) ) for ( const a of this.list ) {

			const i = vendors.indexOf( a.vendor );
			if ( i >= 0 ) vendors.splice( i, 1 );

		}

		for ( const g of this._groups ) if ( g.parent ) g.parent.remove( g );
		this._groups = [];

	}

}

export function install( app, features, opts = {} ) {

	return new Agents( app, features, opts );

}

export { AGENT_FEE, HOME_RANGE, agentSpot, berthPoint, planeSpot, ferryBase, agentPorts };
export default { install };

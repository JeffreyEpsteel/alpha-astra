import { GOODS } from '../trade/goods.js';
import { PLACES } from '../../world/residents/ResidentData.js';
import { ITEMS, ITEM_IDS, LURES, RECIPES, STOCK_CAP, SHELF_PRICE, BAIT_BITE, recipe, pickFish } from './Recipes.js';
import { CraftPanel } from './CraftPanel.js';
import { clockText } from '../harbour/PanelKit.js';

// The crafting service (Unreal WorldCraftingServiceComponent, docs/UNREAL_PARITY.md Q11): recipes at a craft
// NPC's workbench turn fish (the cooler) and trade goods (the hold) into bait, lures, hull patch kits and rope.
// The home bench is Bran's by the boathouse; every other port whose population has a dockworker gets one
// (harbour.sites.crafting). The bench also sells what the harbour's residents made on their work loops.
//
//   features.add( 'crafting', craftingModule );     // after trade and harbour
//   const c = features.get( 'crafting' );
//   c.check( recipeId ) -> { ok, missing: [ text ] }    c.craft( recipeId, port ) -> { ok, out?, reason?, message? }
//   c.stock { bait, lure, pearlLure, repairKit }      c.tied { item, uses } | null     c.useBait (bool)
//   c.tie( item ) / c.untie() / c.useRepairKit() -> { ok, message }     c.buyShelf( what, n, port )
//   c.biteModifier()   1 .. ~1.6: a baited hook and the tied lure (Game.weatherBiteDelay divides the delay by it)
//   c.open( port ) / close() / isOpen / sites / update( dt ) / toJSON() / fromJSON() / reset() / dispose()
//
// Bait goes one per catch (fishCaught) and one per lost strike (strikeMissed); a lure wears out after its uses.
// Fishing stays losable: these only shorten the wait for a bite. Money through features.state.spend (free in the
// sandbox). Events emitted: itemCrafted { recipe, item?, good?, qty, port }, lureWorn { item }.

export { ITEMS, RECIPES, BAIT_BITE };

const SAVE_V = 1;
const CLOSE_M = 7;
const HOME_SITE = { port: 'home', name: 'Boathouse workbench', x: PLACES.workshop.x, z: PLACES.workshop.z, keeper: 'bran' };
const num = ( v, max = 999 ) => ( Number.isFinite( v ) ? Math.max( 0, Math.min( max, Math.floor( v ) ) ) : 0 );

export class Crafting {

	constructor( app, features, opts = {} ) {

		this.app = app;
		this.features = features;
		this.opts = opts;
		this.stock = { bait: 0, lure: 0, pearlLure: 0, repairKit: 0 };
		this.tied = null;
		this.useBait = true;
		this.made = {};
		this.port = null; // the bench open
		this.panel = new CraftPanel( this );
		this._removers = [];
		this._registered = new Set();
		this._siteT = 0;
		this._refreshT = 0;
		this._off = [];
		if ( features && features.on ) {

			this._off.push( features.on( 'fishCaught', ( e ) => { if ( ! ( e && e.crew ) ) this._used( true ); } ) ); // (a crew angler's catch wears the crew's own gear, not the player's lure)
			this._off.push( features.on( 'strikeMissed', () => this._used( false ) ) );

		}

		this._registerSites();

	}

	get state() {

		return this.features ? this.features.state : null;

	}

	get harbour() {

		return this.features && this.features.get ? this.features.get( 'harbour' ) : null;

	}

	get trade() {

		return this.features && this.features.get ? this.features.get( 'trade' ) : null;

	}

	get sites() {

		const h = this.harbour;
		return h && h.sites && h.sites.crafting && h.sites.crafting.length ? h.sites.crafting : [ HOME_SITE ];

	}

	get isOpen() {

		return this.panel.isOpen;

	}

	site( port ) {

		return this.sites.find( ( s ) => s.port === port ) || null;

	}

	_toast( text, ms = 2800 ) {

		if ( this.opts.toasts === false ) return;
		const g = this.app && this.app.game;
		if ( g && g.toast ) g.toast( text, ms );

	}

	// ------------------------------------------------------------------ the bench (E)

	_registerSites() {

		if ( ! this.features || ! this.features.interactable ) return;
		for ( const s of this.sites ) {

			const key = s.port + ':' + s.keeper;
			if ( this._registered.has( key ) ) continue;
			this._registered.add( key );
			this._removers.push( this.features.interactable( {
				id: 'crafting:' + s.port, radius: 2.4,
				position: () => {

					const t = this.app && this.app.terrainData, p = this.app && this.app.player && this.app.player.position;
					return { x: s.x, y: t && t.heightAt ? t.heightAt( s.x, s.z ) : p ? p.y : 0, z: s.z };

				},
				prompt: () => ( this.isOpen && this.port === s.port ? `Leave ${ s.name }` : this.benchOpen( s ) ? `Craft at ${ s.name }` : `${ s.name } (closed)` ),
				onInteract: () => this.toggle( s.port ),
				when: () => ! this.app || ! this.app.player || this.app.player.mode === 'walk',
			} ) );

		}

	}

	keeperName( s ) {

		const h = this.harbour;
		return ( h && s && s.keeper && h.residentName( s.keeper ) ) || null;

	}

	benchOpen( s ) {

		const h = this.harbour;
		if ( ! s || ! h || ! s.keeper ) return true;
		return h.siteOpen ? h.siteOpen( s ) : true;

	}

	open( port = 'home' ) {

		const s = this.site( port ) || this.sites[ 0 ];
		if ( ! this.benchOpen( s ) ) {

			const h = this.harbour, at = h && h.opensAt ? h.opensAt( s ) : null;
			this._toast( `${ this.keeperName( s ) || 'The keeper' } is not at the bench${ at !== null ? ` (back at ${ clockText( at ) })` : '' }.` );
			return false;

		}

		this.port = s.port;
		return this.panel.show( s );

	}

	close() {

		this.panel.close();
		this.port = null;

	}

	toggle( port ) {

		if ( this.isOpen && this.port === port ) {

			this.close();
			return false;

		}

		return this.open( port );

	}

	// ------------------------------------------------------------------ recipes

	_cargo( good ) {

		const t = this.trade;
		try {

			const c = t && t.cargo;
			return c && c[ good ] ? c[ good ].qty || 0 : 0;

		} catch ( e ) { return 0; }

	}

	check( id, port = this.port || 'home' ) {

		const r = recipe( id );
		if ( ! r ) return { ok: false, missing: [ 'unknown recipe' ] };
		const missing = [];
		const st = this.state;
		if ( r.ports && ! r.ports.includes( port ) ) missing.push( 'not made at this bench' );
		if ( r.fish && ! pickFish( st ? st.inventory : [], r.fish ) ) missing.push( `${ r.fish.count } fish${ r.fish.minKg ? ` of ${ r.fish.minKg } kg+` : '' }` );
		for ( const [ g, q ] of Object.entries( r.goods || {} ) ) if ( this._cargo( g ) < q ) missing.push( `${ q } ${ GOODS[ g ] ? GOODS[ g ].name.toLowerCase() : g }` );
		if ( r.coins > 0 && st && ! st.free && st.money < r.coins ) missing.push( `$${ r.coins }` );
		if ( r.out.item && this.stock[ r.out.item ] + r.out.qty > ( STOCK_CAP[ r.out.item ] || 99 ) ) missing.push( 'no room in your kit' );
		if ( r.out.good ) {

			const t = this.trade;
			const freed = Object.entries( r.goods || {} ).reduce( ( s, [ g, q ] ) => s + q * ( GOODS[ g ] ? GOODS[ g ].crates : 1 ), 0 );
			const need = r.out.qty * ( GOODS[ r.out.good ] ? GOODS[ r.out.good ].crates : 1 );
			if ( ! t || ! t.free || t.free() + freed < need ) missing.push( 'room in the hold' );

		}

		return { ok: ! missing.length, missing };

	}

	craft( id, port = this.port || 'home' ) {

		const r = recipe( id );
		const chk = this.check( id, port );
		if ( ! r || ! chk.ok ) return { ok: false, reason: 'missing', message: `You need ${ chk.missing.join( ', ' ) }.` };
		const st = this.state;
		if ( r.coins > 0 && st && st.spend && ! st.spend( r.coins ) ) return { ok: false, reason: 'money', message: 'Not enough money.' };
		if ( r.fish && st ) {

			const fish = pickFish( st.inventory, r.fish );
			st.takeFish( fish.map( ( f ) => f.id ) );

		}

		const t = this.trade;
		for ( const [ g, q ] of Object.entries( r.goods || {} ) ) if ( t ) t.takeCargo( g, q );
		const out = { ...r.out };
		if ( out.item ) {

			this.stock[ out.item ] += out.qty;
			if ( LURES.includes( out.item ) && ! this.tied ) this.tie( out.item );

		} else if ( out.good && t ) t.addCargo( out.good, out.qty, { port } );
		this.made[ id ] = ( this.made[ id ] || 0 ) + 1;
		if ( this.features && this.features.emit ) this.features.emit( 'itemCrafted', { recipe: id, item: out.item, good: out.good, qty: out.qty, port } );
		return { ok: true, out, message: `Made ${ out.qty > 1 ? out.qty + ' x ' : '' }${ out.item ? ITEMS[ out.item ].name : GOODS[ out.good ].name }.` };

	}

	// ------------------------------------------------------------------ kit

	tie( item ) {

		if ( ! LURES.includes( item ) || this.stock[ item ] < 1 ) return { ok: false, message: 'You have none of those.' };
		if ( this.tied && this.tied.item === item ) return { ok: true, message: `${ ITEMS[ item ].name } is already on.` };
		this.untie( true );
		this.stock[ item ] --;
		this.tied = { item, uses: ITEMS[ item ].uses };
		return { ok: true, message: `${ ITEMS[ item ].name } tied on.` };

	}

	// a part-used lure goes back in the box only when it is still fresh; otherwise it is thrown away
	untie( swap = false ) {

		const t = this.tied;
		if ( ! t ) return { ok: false, message: 'No lure on the line.' };
		if ( t.uses >= ITEMS[ t.item ].uses ) this.stock[ t.item ] ++;
		this.tied = null;
		return { ok: true, message: swap ? '' : `${ ITEMS[ t.item ].name } taken off.` };

	}

	useRepairKit() {

		if ( this.stock.repairKit < 1 ) return { ok: false, message: 'No patch kits left.' };
		const n = this.features && this.features.get ? this.features.get( 'naval' ) : null;
		const h = n && n.playerHull;
		if ( ! h || ! ( h.max > 0 ) ) return { ok: false, message: 'No boat to patch.' };
		if ( h.sunk ) return { ok: false, message: 'She is on the bottom: Captain Roid has to raise her first.' };
		if ( h.hp >= h.max - 0.5 ) return { ok: false, message: 'The hull is sound.' };
		this.stock.repairKit --;
		h.hp = Math.min( h.max, h.hp + h.max * ITEMS.repairKit.patch );
		return { ok: true, message: `Hull patched: ${ Math.round( h.hp / h.max * 100 ) }%.` };

	}

	// the residents' produce on this port's shelf (harbour.shelf)
	shelf( port = this.port || 'home' ) {

		const h = this.harbour;
		return ( h && h.shelf && h.shelf[ port ] ) || { bait: 0, rope: 0 };

	}

	buyShelf( what, n = 1, port = this.port || 'home' ) {

		const sh = this.shelf( port );
		const price = SHELF_PRICE[ what ];
		if ( ! price ) return { ok: false, message: 'Not for sale.' };
		const q = Math.min( n, sh[ what ] || 0, what === 'bait' ? STOCK_CAP.bait - this.stock.bait : 99 );
		if ( q < 1 ) return { ok: false, message: what === 'bait' ? 'No bait on the shelf (or your bait box is full).' : 'Nothing on the shelf.' };
		if ( what === 'rope' ) {

			const t = this.trade;
			if ( ! t || ! t.free || t.free() < q ) return { ok: false, message: 'No room in the hold.' };

		}

		const st = this.state;
		if ( st && st.spend && ! st.spend( price * q ) ) return { ok: false, message: 'Not enough money.' };
		sh[ what ] -= q;
		if ( what === 'bait' ) this.stock.bait += q;
		else this.trade.addCargo( 'rope', q, { port, paid: price * q } );
		return { ok: true, qty: q, message: `Bought ${ q } ${ what === 'bait' ? 'bait' : 'coil' + ( q > 1 ? 's of rope' : ' of rope' ) }.` };

	}

	biteModifier() {

		let m = 1;
		if ( this.useBait && this.stock.bait > 0 ) m *= BAIT_BITE;
		if ( this.tied ) m *= ITEMS[ this.tied.item ].bite || 1;
		return m;

	}

	_used( caught ) {

		if ( this.useBait && this.stock.bait > 0 ) this.stock.bait --;
		if ( caught && this.tied ) {

			this.tied.uses --;
			if ( this.tied.uses <= 0 ) {

				const item = this.tied.item;
				this.tied = null;
				this._toast( `Your ${ ITEMS[ item ].name.toLowerCase() } is worn out.` );
				if ( this.features && this.features.emit ) this.features.emit( 'lureWorn', { item } );
				// the next one from the box goes on by itself
				if ( this.stock[ item ] > 0 ) this.tie( item );

			}

		}

	}

	// ------------------------------------------------------------------ frame and save

	update( dt ) {

		dt = Math.min( Math.max( Number.isFinite( dt ) ? dt : 0, 0 ), 0.25 );
		this._siteT -= dt;
		if ( this._siteT <= 0 ) {

			this._siteT = 5;
			this._registerSites();

		}

		const s = this.port && this.site( this.port );
		const p = this.app && this.app.player && this.app.player.position;
		if ( this.isOpen && s && p && Math.hypot( p.x - s.x, p.z - s.z ) > CLOSE_M ) this.close();
		this._refreshT -= dt;
		if ( this.isOpen && this._refreshT <= 0 ) {

			this._refreshT = 0.5;
			this.panel.refresh();

		}

	}

	toJSON() {

		return { v: SAVE_V, stock: { ...this.stock }, tied: this.tied ? { ...this.tied } : null, useBait: this.useBait, made: { ...this.made } };

	}

	fromJSON( d ) {

		if ( ! d || typeof d !== 'object' ) return;
		for ( const k of ITEM_IDS ) this.stock[ k ] = num( d.stock && d.stock[ k ], STOCK_CAP[ k ] || 99 );
		const t = d.tied;
		this.tied = t && LURES.includes( t.item ) && t.uses > 0 ? { item: t.item, uses: Math.min( ITEMS[ t.item ].uses, Math.floor( t.uses ) ) } : null;
		this.useBait = d.useBait !== false;
		this.made = {};
		if ( d.made && typeof d.made === 'object' ) for ( const r of RECIPES ) if ( d.made[ r.id ] ) this.made[ r.id ] = num( d.made[ r.id ], 1e6 );

	}

	reset() {

		this.close();
		for ( const k of ITEM_IDS ) this.stock[ k ] = 0;
		this.tied = null;
		this.useBait = true;
		this.made = {};

	}

	dispose() {

		this.close();
		for ( const r of this._removers ) r();
		for ( const o of this._off ) o();
		this._removers.length = 0;
		this._off.length = 0;
		this.panel.dispose();

	}

}

export function install( app, features, opts = {} ) {

	return new Crafting( app, features, opts );

}

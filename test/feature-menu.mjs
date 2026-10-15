// Plain-node test of the illustrated main menu's art and of the inventory's hold grid view (stub DOM, no GPU):
// the art files and their sizes, which one the menu picks, the grid sized by the hold, fish and trade crate blocks,
// the layout rules (no overlap, saved places, overflow), drag and drop on the stub, and the GameHUD panel on a fake `this`.
import { statSync, readFileSync } from 'node:fs';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};

// ---- a tiny stub DOM
class El {

	constructor( tag ) {

		this.tagName = String( tag ).toUpperCase();
		this.children = [];
		this.dataset = {};
		this.listeners = {};
		this.hidden = false;
		this._cls = new Set();
		this._html = '';
		this.rect = { left: 0, top: 0, width: 300, height: 100 };
		const props = {};
		this.style = { props, setProperty: ( k, v ) => { props[ k ] = v; } };
		this.classList = { add: ( c ) => this._cls.add( c ), remove: ( c ) => this._cls.delete( c ), contains: ( c ) => this._cls.has( c ), toggle: ( c, f ) => ( f ?? ! this._cls.has( c ) ) ? this._cls.add( c ) : this._cls.delete( c ) };

	}

	get className() {

		return [ ...this._cls ].join( ' ' );

	}

	set className( v ) {

		this._cls = new Set( String( v ).split( /\s+/ ).filter( Boolean ) );

	}

	get innerHTML() {

		return this._html;

	}

	set innerHTML( v ) {

		this._html = v;
		this.children = [];

	}

	appendChild( c ) {

		this.children.push( c );
		return c;

	}

	append( ...c ) {

		for ( const x of c ) this.children.push( x );

	}

	addEventListener( t, fn ) {

		( this.listeners[ t ] || ( this.listeners[ t ] = [] ) ).push( fn );

	}

	fire( t, ev = {} ) {

		for ( const fn of this.listeners[ t ] || [] ) fn( { preventDefault() {}, dataTransfer: null, ...ev } );

	}

	getBoundingClientRect() {

		return this.rect;

	}

}

const store = () => {

	const m = new Map();
	return { getItem: ( k ) => m.has( k ) ? m.get( k ) : null, setItem: ( k, v ) => m.set( k, String( v ) ), removeItem: ( k ) => m.delete( k ), map: m };

};

globalThis.document = { createElement: ( t ) => new El( t ), getElementById: () => null, head: new El( 'head' ), pointerLockElement: null };
globalThis.location = globalThis.location || { search: '' };
const ls = globalThis.localStorage = store();

const { holdCellKg, fishCells, cellShape, valueTier, holdCells, holdItems, layoutHold, canMoveTo, buildHoldGrid, GameHUD, HOLD_COLS } = await import( '../src/game/GameHUD.js' );
const { artPath } = await import( '../src/ui/MainMenu.js' );
const { GameState } = await import( '../src/game/GameState.js' );
const { FISH } = await import( '../src/game/FishTable.js' );

// ---- the menu art
{

	const a2560 = statSync( new URL( '../public/ui/menu/hyptile-menu-2560.jpg', import.meta.url ) ), a1280 = statSync( new URL( '../public/ui/menu/hyptile-menu-1280.jpg', import.meta.url ) );
	ok( a2560.size > 50e3 && a2560.size <= 600e3, `the 2560 art is a web-sized JPEG (${ Math.round( a2560.size / 1024 ) } KB)` );
	ok( a1280.size > 20e3 && a1280.size < a2560.size, `the 1280 art is smaller (${ Math.round( a1280.size / 1024 ) } KB)` );
	const head = readFileSync( new URL( '../public/ui/menu/hyptile-menu-2560.jpg', import.meta.url ) ).subarray( 0, 3 );
	ok( head[ 0 ] === 0xff && head[ 1 ] === 0xd8, 'it is a JPEG' );
	ok( artPath( 1920, 1 ).endsWith( '2560.jpg' ) && artPath( 1280, 1 ).endsWith( '1280.jpg' ) && artPath( 1000, 2 ).endsWith( '2560.jpg' ) && artPath( 800, 1 ).endsWith( '1280.jpg' ), 'a big or dense screen gets the 2560 art, a small one the 1280' );
	const src = readFileSync( new URL( '../src/ui/MainMenu.js', import.meta.url ), 'utf8' );
	ok( src.includes( 'mm-art' ) && src.includes( 'artPath()' ) && src.split( '<div class="mm-art"' ).length === 3, 'both steps (modes, slots) draw the art' );

}

// ---- the grid rules
{

	ok( holdCellKg( 30 ) === 1.25 && holdCellKg( 70 ) > 2.9 && holdCellKg( 70 ) < 3 && holdCellKg( 160 ) === 5 && holdCellKg( 400 ) === 5, 'one cell is 5 kg on a big hold, less on the small cooler' );
	ok( holdCells( 30, 0 ) === 24 && holdCells( 160, 0 ) === 32 && holdCells( 30, 6 ) === 30, 'cells follow the hold (30 kg is a 6 x 4 grid), plus the crate capacity' );
	ok( fishCells( 0.05 ) === 1 && fishCells( 5 ) === 1 && fishCells( 5.1 ) === 2 && fishCells( 12 ) === 3 && fishCells( 20 ) === 4 && fishCells( 90 ) === 4, 'a fish is 1 to 4 cells by its weight' );
	ok( JSON.stringify( cellShape( 1 ) ) === '{"w":1,"h":1}' && JSON.stringify( cellShape( 3 ) ) === '{"w":3,"h":1}' && JSON.stringify( cellShape( 4 ) ) === '{"w":2,"h":2}', 'shapes: 1, 2, 3 in a row, 4 as 2 x 2' );
	ok( [ 1, 10, 30, 100, 300 ].map( valueTier ).join() === '0,1,2,3,4', 'five value tiers' );

	const mk = ( key, w, h = 1 ) => ( { key, w, h } );
	const items = [ mk( 'a', 3 ), mk( 'b', 3 ), mk( 'c', 2, 2 ), mk( 'd', 1 ), mk( 'e', 1 ), mk( 'f', 2 ) ];
	const L = layoutHold( items, { cols: 6, cells: 24 } );
	const overlap = ( A ) => A.some( ( p, i ) => A.some( ( q, j ) => i < j && p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h ) );
	ok( L.blocks.length === 6 && ! overlap( L.blocks ) && L.blocks.every( ( b ) => b.x >= 0 && b.x + b.w <= 6 && b.y >= 0 ), 'every block is placed, inside the columns, none overlapping' );
	ok( L.blocks[ 0 ].x === 0 && L.blocks[ 0 ].y === 0 && L.blocks[ 1 ].x === 3 && L.blocks[ 1 ].y === 0 && L.rows === 4 && ! L.over, 'first fit fills row by row; 24 cells make 4 rows' );
	const P = layoutHold( items, { cols: 6, cells: 24, pos: { c: [ 4, 2 ], d: [ 4, 2 ], zz: [ 0, 0 ], a: [ 9, 9 ] } } );
	const at = ( l, k ) => l.blocks.find( ( b ) => b.item.key === k );
	ok( at( P, 'c' ).x === 4 && at( P, 'c' ).y === 2, 'a saved place is honoured when it fits' );
	ok( ! overlap( P.blocks ) && P.blocks.length === 6, 'a saved place that is taken or outside the grid falls back to the first free spot, nothing overlaps' );
	ok( at( P, 'a' ).y < 4, 'a place outside the grid is ignored' );
	const many = Array.from( { length: 30 }, ( _, i ) => mk( 'm' + i, 1 ) );
	const O = layoutHold( many, { cols: 6, cells: 24 } );
	ok( O.blocks.length === 30 && O.rows === 5 && O.over && ! overlap( O.blocks ), 'more blocks than cells: an overflow row, none lost' );
	ok( canMoveTo( L, 'd', 5, 3 ) === true && canMoveTo( L, 'd', 0, 0 ) === false && canMoveTo( L, 'c', 5, 0 ) === false && canMoveTo( L, 'd', - 1, 0 ) === false && canMoveTo( L, 'f', 5, 0 ) === false, 'canMoveTo: free spots yes; taken, out of the grid and too wide no' );

}

// ---- the items of a real save, with trade crates
const state = new GameState( store() );
state.name = 'Test';
const fish = [ [ 'mullet', 1.2 ], [ 'grouper', 8.5 ], [ 'tuna', 12 ], [ 'silverside', 0.05 ], [ 'tarpon', 30 ] ];
state.upgrades.hold = 2; // 160 kg hold
let id = 1;
for ( const [ sp, kg ] of fish ) state.inventory.push( { id: id ++, species: sp, kg, cm: 40, value: Math.round( kg * FISH[ sp ].price ), caughtAt: 0 } );
const cargo = { ice: { qty: 2, cond: 0.9, paid: 30, crates: 2, kg: 80 }, timber: { qty: 1, cond: 1, paid: 40, crates: 2, kg: 90 } };
const trade = { cargo, capacity: () => 8 };
{

	const items = holdItems( state, trade );
	ok( items.filter( ( i ) => i.kind === 'fish' ).length === 5 && items.filter( ( i ) => i.kind === 'crate' ).length === 3, 'a block per fish and one per unit of cargo' );
	const by = ( k ) => items.find( ( i ) => i.key === k );
	ok( by( 'f:4' ).cells === 1 && by( 'f:5' ).cells === 4 && by( 'f:5' ).w === 2 && by( 'f:5' ).h === 2, 'a tiny fish is one cell, a big one 2 x 2' );
	ok( by( 'c:timber:0' ).w === 2 && by( 'c:ice:0' ).w === 1 && by( 'c:ice:1' ).kind === 'crate' && by( 'c:ice:0' ).color === '#9fd8ee', 'bulky timber takes two cells; crates carry the good\'s colour' );
	ok( items.filter( ( i ) => i.kind === 'fish' ).every( ( i ) => i.tier >= 0 && i.tier <= 4 ) && by( 'c:ice:0' ).tier === - 1, 'fish have value tiers, crates none' );
	ok( holdItems( state, null ).length === 5, 'without the trade feature only the fish show' );
	const total = holdCells( state.stats.holdKg, trade.capacity() );
	ok( total === Math.ceil( 160 / 5 ) + 8, `the grid has ${ total } cells (160 kg at 5 kg a cell + 8 crates)` );
	const layout = layoutHold( items, { cols: HOLD_COLS, cells: total } );

	// build into a stub box and drag
	const box = new El( 'div' );
	box.rect = { left: 0, top: 0, width: 600, height: layout.rows * 100 }; // 100 px cells
	let moved = null, dragging = [];
	buildHoldGrid( box, layout, { total, onMove: ( k, x, y ) => { moved = [ k, x, y ]; }, onDrag: ( on ) => dragging.push( on ) } );
	const cells = box.children.filter( ( c ) => c.className.includes( 'gm-cell' ) ), blocks = box.children.filter( ( c ) => c.className.includes( 'gm-block' ) );
	ok( cells.length === layout.rows * HOLD_COLS && box.style.props[ '--gm-cols' ] === '6', `${ cells.length } empty cells (${ layout.rows } rows x 6)` );
	ok( cells.filter( ( c ) => c.className.includes( 'is-locked' ) ).length === layout.rows * HOLD_COLS - total, 'cells past the hold size are marked unavailable' );
	ok( blocks.length === 8 && blocks.filter( ( b ) => b.className.includes( 'is-crate' ) ).length === 3 && blocks.filter( ( b ) => b.className.includes( 'is-fish' ) ).length === 5, 'eight blocks: five fish, three crates' );
	ok( blocks.every( ( b ) => b.draggable && b.style.gridColumn && b.style.gridRow && b.innerHTML.includes( '<b>' ) ), 'each block is draggable, placed on the grid and named' );
	const tuna = blocks.find( ( b ) => b.dataset.key === 'f:3' );
	const tb = layout.blocks.find( ( b ) => b.item.key === 'f:3' );
	ok( tuna.style.gridColumn === `${ tb.x + 1 } / span ${ tb.w }` && tuna.className.includes( 'is-t' ) && ! blocks.find( ( b ) => b.dataset.key === 'c:ice:0' ).className.includes( 'is-t' ), 'a fish block has its tier class, a crate its own look' );
	ok( blocks.find( ( b ) => b.dataset.key === 'c:ice:0' ).style.props[ '--gm-crate' ] === '#9fd8ee' && blocks.find( ( b ) => b.dataset.key === 'c:ice:0' ).style.opacity, 'crates take the good\'s colour and fade a little when the cargo has aged' );

	// drag the 1-cell silverside (f:4) to an empty spot
	const sil = blocks.find( ( b ) => b.dataset.key === 'f:4' );
	const sb = layout.blocks.find( ( b ) => b.item.key === 'f:4' );
	sil.rect = { left: sb.x * 100, top: sb.y * 100, width: 100, height: 100 };
	sil.fire( 'dragstart', { clientX: sb.x * 100 + 20, clientY: sb.y * 100 + 20 } );
	ok( dragging[ 0 ] === true && sil.className.includes( 'is-drag' ), 'dragstart marks the block and tells the panel not to rebuild' );
	const row = layout.rows - 1; // the last row has free cells
	const free = [ ...Array( HOLD_COLS ).keys() ].find( ( x ) => canMoveTo( layout, 'f:4', x, row ) && ! ( x === sb.x && row === sb.y ) );
	box.fire( 'dragover', { clientX: free * 100 + 30, clientY: row * 100 + 30 } );
	const ghost = box.children[ box.children.length - 1 ].className.includes( 'gm-ghost' ) ? box.children[ box.children.length - 1 ] : box.children.find( ( c ) => c.className.includes( 'gm-ghost' ) );
	ok( ! ghost.hidden && ghost.className.includes( 'is-ok' ), 'over a free spot the ghost shows green' );
	box.fire( 'drop', { clientX: free * 100 + 30, clientY: row * 100 + 30 } );
	ok( moved && moved[ 0 ] === 'f:4' && moved[ 1 ] === free && moved[ 2 ] === row && dragging[ dragging.length - 1 ] === false, `dropping moves it to column ${ free }, row ${ row }` );
	// a drop on the big tarpon is refused
	moved = null;
	const tp = layout.blocks.find( ( b ) => b.item.key === 'f:5' );
	sil.fire( 'dragstart', { clientX: sb.x * 100 + 20, clientY: sb.y * 100 + 20 } );
	box.fire( 'dragover', { clientX: tp.x * 100 + 10, clientY: tp.y * 100 + 10 } );
	ok( ghost.className.includes( 'is-bad' ), 'over another block the ghost shows red' );
	box.fire( 'drop', { clientX: tp.x * 100 + 10, clientY: tp.y * 100 + 10 } );
	ok( moved === null, 'a drop on another block is refused' );

	// ---- the panel on a fake `this`: tabs, grid, saved places
	const inv = new El( 'div' );
	const hud = {
		inv, game: { state, app: { features: { get: ( n ) => n === 'trade' ? trade : null } } }, _invView: null, renderStats: () => '',
		toggleInventory() {}, setInvView: GameHUD.prototype.setInvView, renderHold: GameHUD.prototype.renderHold, renderInventory: GameHUD.prototype.renderInventory,
	};
	Object.defineProperty( hud, 'invView', Object.getOwnPropertyDescriptor( GameHUD.prototype, 'invView' ) );
	const holdBox = new El( 'div' ), keyEl = new El( 'div' ), closeBtn = new El( 'button' );
	holdBox.rect = { left: 0, top: 0, width: 600, height: 400 };
	inv.querySelector = ( q ) => q === '[data-hold]' ? holdBox : q === '[data-hold-key]' ? keyEl : q === '[data-close]' ? closeBtn : null;
	inv.querySelectorAll = () => [];
	ok( hud.invView === 'hold', 'the hold grid is the default view' );
	hud.renderInventory();
	ok( inv.innerHTML.includes( 'data-hold' ) && inv.innerHTML.includes( 'data-view="list"' ) && ! inv.innerHTML.includes( 'gm-list' ), 'the panel shows the grid and a List tab' );
	ok( holdBox.children.filter( ( c ) => c.className.includes( 'gm-block' ) ).length === 8 && keyEl.innerHTML.includes( 'trade crates: 3' ), 'the grid is filled with the fish and crates; the key counts the crates' );
	hud.setInvView( 'list' );
	ok( inv.innerHTML.includes( 'gm-list' ) && inv.innerHTML.includes( 'data-release' ) && ! inv.innerHTML.includes( 'data-hold>' ) && ls.getItem( 'alpha-astra.inventory-view' ) === 'list', 'the List view keeps the release buttons and is remembered' );
	hud._invView = null;
	ok( hud.invView === 'list', 'the choice survives a reload' );
	hud.setInvView( 'hold' );
	// drag through the panel and check the save
	const blocks2 = holdBox.children.filter( ( c ) => c.className.includes( 'gm-block' ) );
	const b0 = blocks2.find( ( b ) => b.dataset.key === 'f:4' );
	b0.rect = { left: 0, top: 0, width: 100, height: 100 };
	b0.fire( 'dragstart', { clientX: 10, clientY: 10 } );
	ok( hud._holdDrag === true, 'while a block is dragged the panel does not rebuild' );
	hud.renderInventory();
	holdBox.rect = { left: 0, top: 0, width: 600, height: holdBox.rect.height };
	holdBox.fire( 'drop', { clientX: 5 * 100 + 10, clientY: 3 * 66 } );
	const saved = JSON.parse( ls.getItem( 'alpha-astra.hold.v1' ) || '{}' );
	const slot = saved[ 'campaign.0' ];
	ok( slot && Array.isArray( slot[ 'f:4' ] ) && Object.keys( slot ).length === 8, 'the places are saved per slot for every block' );
	hud.renderInventory();
	const again = holdBox.children.filter( ( c ) => c.className.includes( 'gm-block' ) ).find( ( b ) => b.dataset.key === 'f:4' );
	ok( again && again.style.gridColumn === `${ slot[ 'f:4' ][ 0 ] + 1 } / span 1` && again.style.gridRow === `${ slot[ 'f:4' ][ 1 ] + 1 } / span 1`, 'a rebuilt panel puts the block where it was left' );
	// a fish is sold: its saved place is dropped and the others stay
	state.inventory = state.inventory.filter( ( f ) => f.id !== 4 );
	hud.renderInventory();
	const saved2 = JSON.parse( ls.getItem( 'alpha-astra.hold.v1' ) )[ 'campaign.0' ];
	ok( ! ( 'f:4' in saved2 ) && 'f:5' in saved2, 'places of fish that left the hold are forgotten' );

}

if ( fails ) { console.log( `\n${ fails } FAILED` ); process.exit( 1 ); }
console.log( '\nall menu / hold grid checks passed' );

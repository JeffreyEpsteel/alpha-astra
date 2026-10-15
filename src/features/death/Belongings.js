// What the player carries that a death or a sinking can take: the fish in the cooler / hold (GameState.inventory),
// the cargo crates (the trade feature's hold) and the money above a small keep. Shared by the death feature's sea
// chest and naval's wrecks (src/features/naval/Wrecks.js), so both strip and give back the same way.
//
//   strip( features, { fish, cargo, money, keep } ) -> belongings { fish: [ entry ], cargo: [ { good, qty, paid, cond } ], money }
//   stow( features, belongings ) -> { fish, cargo, money }    gives them back (cargo past the hold's room comes aboard anyway)
//   isEmpty( b ), clean( d ) (a belongings record read from a save), summary( b ) -> '3 fish · 4 crates · $120'
//
// Money is moved on GameState directly (not spend / earn): the sandbox's spend() takes nothing and earn() would count
// a returned purse as money made.

const num = ( v, d = 0 ) => ( Number.isFinite( v ) ? v : d );

export function empty() {

	return { fish: [], cargo: [], money: 0 };

}

function touch( st ) {

	try { if ( st.save ) st.save(); } catch ( e ) { /* headless */ }
	try { if ( st.emit ) st.emit(); } catch ( e ) { /* headless */ }

}

export function strip( features, { fish = true, cargo = true, money = false, keep = 0 } = {} ) {

	const out = empty();
	const st = features && features.state;
	if ( st && fish && Array.isArray( st.inventory ) && st.inventory.length ) {

		out.fish = st.inventory.map( ( f ) => ( { ...f } ) );
		st.inventory = [];

	}

	const tr = cargo && features && features.get ? features.get( 'trade' ) : null;
	if ( tr && tr.cargo && typeof tr.takeCargo === 'function' ) {

		const have = tr.cargo;
		for ( const good of Object.keys( have ) ) {

			const c = have[ good ];
			if ( ! c || ! ( c.qty > 0 ) ) continue;
			const r = tr.takeCargo( good, c.qty );
			if ( r && r.qty > 0 ) out.cargo.push( { good, qty: r.qty, paid: num( r.paid ), cond: Math.max( 0, Math.min( 1, num( c.cond, 1 ) ) ) } );

		}

	}

	if ( st && money && Number.isFinite( st.money ) ) {

		const take = Math.max( 0, Math.floor( st.money - Math.max( 0, keep ) ) );
		if ( take > 0 ) {

			st.money -= take;
			out.money = take;

		}

	}

	if ( st && ( out.fish.length || out.money ) ) touch( st );
	return out;

}

export function stow( features, b ) {

	const got = { fish: 0, cargo: 0, money: 0 };
	if ( ! b ) return got;
	const st = features && features.state;
	if ( st && Array.isArray( st.inventory ) && b.fish.length ) {

		const ids = new Set( st.inventory.map( ( f ) => f.id ) );
		for ( const f of b.fish ) if ( ! ids.has( f.id ) ) {

			st.inventory.push( { ...f } );
			got.fish ++;

		}

	}

	const tr = features && features.get ? features.get( 'trade' ) : null;
	if ( tr && typeof tr.addCargo === 'function' ) for ( const c of b.cargo ) {

		got.cargo += tr.addCargo( c.good, c.qty, { cond: c.cond, paid: c.paid, force: true } ) || 0;

	}

	if ( st && b.money > 0 && Number.isFinite( st.money ) ) {

		st.money += b.money;
		got.money = b.money;

	}

	if ( st && ( got.fish || got.money ) ) touch( st );
	return got;

}

export function isEmpty( b ) {

	return ! b || ( ! b.fish.length && ! b.cargo.length && ! ( b.money > 0 ) );

}

// a belongings record from a save (anything malformed is dropped)
export function clean( d ) {

	const out = empty();
	if ( ! d || typeof d !== 'object' ) return out;
	if ( Array.isArray( d.fish ) ) out.fish = d.fish.filter( ( f ) => f && typeof f === 'object' && typeof f.species === 'string' && Number.isFinite( f.kg ) ).map( ( f ) => ( { ...f } ) );
	if ( Array.isArray( d.cargo ) ) out.cargo = d.cargo.filter( ( c ) => c && typeof c.good === 'string' && c.qty > 0 ).map( ( c ) => ( { good: c.good, qty: Math.floor( c.qty ), paid: Math.max( 0, num( c.paid ) ), cond: Math.max( 0, Math.min( 1, num( c.cond, 1 ) ) ) } ) );
	out.money = Math.max( 0, Math.floor( num( d.money ) ) );
	return out;

}

export function summary( b ) {

	if ( isEmpty( b ) ) return 'nothing';
	const parts = [];
	if ( b.fish.length ) parts.push( `${ b.fish.length } fish` );
	const crates = b.cargo.reduce( ( n, c ) => n + c.qty, 0 );
	if ( crates ) parts.push( `${ crates } crate${ crates === 1 ? '' : 's' }` );
	if ( b.money > 0 ) parts.push( `$${ b.money.toLocaleString( 'en-US' ) }` );
	return parts.join( ' · ' );

}

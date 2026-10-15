// Crafting recipes (Unreal WorldCraftingRecipesDataAsset: RecipeId, DisplayName, PortId, WorkshopNpcId,
// Ingredients [ GoodId, Quantity ], OutputGoodId, OutputQuantity, CoinCost), over this game's fish (the cooler:
// GameState.inventory) and trade goods (the hold: features trade cargo). Plain data, no engine.
//
//   ITEMS[ id ]    the crafted things kept in the crafting stock: bait, lures (tied on, worn out by catches),
//                  repair kits (patch the hull at sea)
//   RECIPES        [ { id, name, text, fish: { count, minKg? } | null, goods: { good: qty }, coins, out: { item | good, qty }, ports } ]
//                  ports: null = every workbench, or a list of port ids
//   SHELF_PRICE    what the bench charges for what the harbour's residents made (fishers' bait, dockworkers' rope)

export const BAIT_BITE = 1.25; // a baited hook: the bite delay divided by this
export const ITEMS = {
	bait: { name: 'Cut bait', text: 'On the hook: bites come sooner. One goes per catch or lost strike.' },
	lure: { name: 'Feather jig', text: 'Tied on: bites a little sooner for 8 catches.', uses: 8, bite: 1.15 },
	pearlLure: { name: 'Pearl spoon', text: 'Flashes deep: bites much sooner for 14 catches.', uses: 14, bite: 1.3 },
	repairKit: { name: 'Hull patch kit', text: 'Patches a third of the hull, anywhere at sea.', patch: 0.35 },
};
export const ITEM_IDS = Object.keys( ITEMS );
export const LURES = [ 'lure', 'pearlLure' ];
export const STOCK_CAP = { bait: 60, lure: 6, pearlLure: 6, repairKit: 5 };

export const RECIPES = [
	{ id: 'cutBait', name: 'Cut bait', text: 'One fish, cut into strips.', fish: { count: 1 }, goods: {}, coins: 0, out: { item: 'bait', qty: 4 }, ports: null },
	{ id: 'saltBait', name: 'Salted bait', text: 'A fish and a sack of salt: twice the bait, and it keeps.', fish: { count: 1 }, goods: { salt: 1 }, coins: 0, out: { item: 'bait', qty: 8 }, ports: null },
	{ id: 'featherJig', name: 'Feather jig', text: 'Gull feathers whipped onto a hook with hemp twine.', fish: null, goods: { rope: 1 }, coins: 12, out: { item: 'lure', qty: 1 }, ports: null },
	{ id: 'pearlSpoon', name: 'Pearl spoon', text: 'A pearl set in a polished spoon. Fish cannot resist it.', fish: null, goods: { pearls: 1 }, coins: 10, out: { item: 'pearlLure', qty: 1 }, ports: null },
	{ id: 'patchKit', name: 'Hull patch kit', text: 'Planks, rope and pitch for a hole below the waterline.', fish: null, goods: { timber: 1, rope: 1 }, coins: 15, out: { item: 'repairKit', qty: 1 }, ports: null },
	{ id: 'oilPatch', name: 'Fish-oil patch kit', text: 'Rendered fish oil and salt: a smellier patch, no timber needed.', fish: { count: 2, minKg: 1 }, goods: { salt: 1 }, coins: 8, out: { item: 'repairKit', qty: 1 }, ports: null },
	{ id: 'coirRope', name: 'Coir rope', text: 'Coconut husk twisted into rope (goes into the hold).', fish: null, goods: { coconuts: 2 }, coins: 4, out: { good: 'rope', qty: 1 }, ports: null },
];

export const SHELF_PRICE = { bait: 1, rope: 14 };

export function recipe( id ) {

	return RECIPES.find( ( r ) => r.id === id ) || null;

}

// the fish a recipe would take from the cooler: the cheapest that qualify, or null when there are too few
export function pickFish( inventory, need ) {

	if ( ! need ) return [];
	const ok = ( inventory || [] ).filter( ( f ) => f && Number.isFinite( f.kg ) && ( ! need.minKg || f.kg >= need.minKg ) );
	if ( ok.length < need.count ) return null;
	return ok.slice().sort( ( a, b ) => ( a.value || 0 ) - ( b.value || 0 ) || a.kg - b.kg ).slice( 0, need.count );

}

export function validRecipes( list = RECIPES, goods = null ) {

	const ids = new Set();
	for ( const r of list ) {

		if ( ! r.id || ids.has( r.id ) ) return false;
		ids.add( r.id );
		if ( ! r.out || ! ( r.out.qty > 0 ) || ( ! r.out.item && ! r.out.good ) ) return false;
		if ( r.out.item && ! ITEMS[ r.out.item ] ) return false;
		if ( goods && r.out.good && ! goods[ r.out.good ] ) return false;
		if ( goods && Object.keys( r.goods || {} ).some( ( g ) => ! goods[ g ] ) ) return false;
		if ( ! r.fish && ! Object.keys( r.goods || {} ).length ) return false; // something goes in
		if ( ! ( r.coins >= 0 ) ) return false;

	}

	return true;

}

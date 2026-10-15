// Firearms data and the pure maths the feature and its test share (no engine, no DOM).
//
//   WEAPONS[ id ]          the flintlock pistol and the musket: price, reload (s), draw (s), range / falloff (m), damage,
//                          spread / aimSpread (deg, the half-angle of the cone the ball leaves in), energy (J on props),
//                          walk (speed factor while drawn), zoom (FOV divisor while aiming), report (the sound)
//   POUCH                  the chandlery's cartridge pouch: `count` cartridges for `price`
//   damageAt( w, d )       damage of weapon w at d m (full to falloff, half at range, nothing past maxRange)
//   spreadRad( w, aiming, move = 0, bloom = 0 )   the cone half-angle in radians (move 0..1: the walking penalty, bloom
//                          0..1: just fired)
//   MAGNET                 the aim magnetism (wave 12E): a shot within MAGNET.deg of a raider's chest at MAGNET.range m or
//                          less snaps onto it (only when the aim itself finds no one: a head shot stays a head shot)
//   spreadDir( dir, half, u, v, out )   a direction inside the cone round dir (u, v uniform 0..1: uniform over the disc)
//   angleBetween( a, b )   radians between two unit vectors
//   barrelsOf( w )         shots a load (the duelling pair 2, else 1)     cartridgesFor( w )   cartridges one reload takes

export const DEG = Math.PI / 180;

export const WEAPONS = {
	pistol: {
		id: 'pistol', name: 'Flintlock pistol', price: 180, reload: 1.4, draw: 0.35, holster: 0.25,
		// wave 12E (the play harness): 52 a ball, so at 10 m two body shots or one head shot (x1.6 = 83) put a tier 1 raider
		// (80 hp) down; usable on the move (moveSpread: a small walking penalty)
		range: 22, falloff: 15, damage: 52, spread: 2.2, aimSpread: 0.8, moveSpread: 1.0, energy: 420,
		walk: 1, zoom: 1.3, report: 'pistol', flash: 0.35, smoke: 0.35, kick: 0.8,
		desc: 'One shot, quick to load. Deadly inside 15 m, weak past 22 m',
	},
	musket: {
		id: 'musket', name: 'Musket', price: 420, reload: 3.2, draw: 0.8, holster: 0.45,
		// wave 12E: 90, one body shot drops a tier 1 raider (and knocks a tougher unarmoured one off his feet); shouldered it
		// slows the walk to x0.7 and walking throws the aim off more
		range: 70, falloff: 45, damage: 90, spread: 1.2, aimSpread: 0.4, moveSpread: 2.4, energy: 1500,
		walk: 0.7, zoom: 1.3, report: 'musket', flash: 0.6, smoke: 0.7, kick: 1.4,
		desc: 'One shot, a slow reload. Reaches 70 m; you walk slower with it shouldered',
	},
	// wave 18D: the rest of the arsenal. slot: the quick slot (2 sidearm, 3 long gun); pose: the aim pose (GunPose: pistol / musket);
	// vendor: 'chandlery' (Ethena Prosper) or 'blackmarket' (Blackwater's fence); pellets: balls a shot (each its own cone draw);
	// barrels: shots before a reload (the duelling pair); knock: m a hit pushes a man back; harpoon: the line (see Firearms)
	duelling: {
		id: 'duelling', name: 'Duelling pistols', price: 380, reload: 2.4, draw: 0.4, holster: 0.3, barrels: 2, between: 0.22,
		// two quick shots (one each hand) then a reload of both; a cartridge a barrel
		range: 20, falloff: 13, damage: 46, spread: 1.8, aimSpread: 0.6, moveSpread: 1.0, energy: 380,
		walk: 1, zoom: 1.3, report: 'pistol', flash: 0.3, smoke: 0.3, kick: 0.7, vendor: 'chandlery',
		desc: 'A matched pair: two quick shots, then both to load',
	},
	// the second pistol of the pair: the same gun, its own name so the universe server's per-weapon gate lets the quick second
	// shot through (hidden: not sold, not in ORDER)
	duelling_l: {
		id: 'duelling_l', hidden: true, name: 'Duelling pistol', price: 0, reload: 0.2, draw: 0.4, holster: 0.3,
		range: 20, falloff: 13, damage: 46, spread: 1.8, aimSpread: 0.6, moveSpread: 1.0, energy: 380,
		walk: 1, zoom: 1.3, report: 'pistol', flash: 0.3, smoke: 0.3, kick: 0.7,
		desc: '',
	},
	rifle: {
		id: 'rifle', name: 'Long rifle', price: 650, reload: 4.2, draw: 0.9, holster: 0.5,
		// slow and dead accurate: a rifled barrel, a long sight line (RMB zooms x3.2), a crawl while shouldered
		range: 140, falloff: 90, damage: 110, spread: 0.9, aimSpread: 0.08, moveSpread: 3.0, energy: 1700,
		walk: 0.6, zoom: 3.2, report: 'rifle', flash: 0.5, smoke: 0.6, kick: 1.5, vendor: 'chandlery', scope: true,
		desc: 'Slow, and true to 140 m · RMB looks down the long sight',
	},
	blunderbuss: {
		id: 'blunderbuss', name: 'Blunderbuss', price: 360, reload: 3.6, draw: 0.6, holster: 0.4,
		// a fistful of shot: nine balls in a wide cone, deadly close, nothing past 18 m; a hit shoves a man back
		range: 12, falloff: 5, damage: 17, pellets: 9, spread: 7, aimSpread: 5.5, moveSpread: 1.5, energy: 600, knock: 2.2,
		walk: 0.85, zoom: 1.15, report: 'blunderbuss', flash: 0.9, smoke: 1.0, kick: 1.8, vendor: 'blackmarket',
		desc: 'A wide spray of shot · knocks men back · useless past 15 m',
	},
	harpoongun: {
		id: 'harpoongun', name: 'Harpoon gun', price: 520, reload: 2.6, draw: 0.7, holster: 0.4,
		// a whaler's swivel-less gun: the harpoon flies on a line; a man is dragged in, a small boat or a big fish hauled
		// closer, a big ship holds it until the line parts. Reloading reels the harpoon home (no cartridge used)
		range: 35, falloff: 25, damage: 55, spread: 0.6, aimSpread: 0.3, moveSpread: 2.0, energy: 1400, harpoon: true, noAmmo: true,
		walk: 0.75, zoom: 1.5, report: 'harpoon', flash: 0.2, smoke: 0.25, kick: 1.1, vendor: 'chandlery',
		desc: 'A harpoon on a line · drags men, small boats and big fish to you',
	},
};

// the shop / G order (sidearms first, then the long guns); duelling_l is the pair's second pistol, never on its own
export const ORDER = [ 'pistol', 'duelling', 'musket', 'rifle', 'blunderbuss', 'harpoongun' ];
// the quick slot of each gun (wave 18D: keys 2 and 3) and the aim pose it borrows (GunPose.js builds pistol and musket poses)
export const SLOT_OF = { pistol: 'side', duelling: 'side', musket: 'long', rifle: 'long', blunderbuss: 'long', harpoongun: 'long' };
export const POSE_OF = { pistol: 'pistol', duelling: 'pistol', duelling_l: 'pistol', musket: 'musket', rifle: 'musket', blunderbuss: 'musket', harpoongun: 'musket' };
// the harpoon gun's line: m it reaches, how fast it hauls (m/s), the biggest hull it drags (m), and fish kg it lands
export const LINE = { reach: 35, haul: 3.2, raiderPull: 3.0, shipMax: 14, shipHaul: 2.4, hold: 6, bigFish: 0.6 };
export const POUCH = { id: 'pouch', name: 'Cartridge pouch', count: 12, price: 30, max: 120 };
// a ball keeps flying past the effective range at half power, fading to nothing at range * MAX_RANGE
export const MAX_RANGE = 1.5;
export const HEADSHOT = 1.6;
export const MAGNET = { deg: 2.5, range: 25, chest: 1.2 }; // chest: m above the feet (x the raider's scale)
export const BLOOM = 1.2; // deg added to the cone right after a shot (fades with the recoil)

export const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );

export function maxRange( w ) {

	return w.range * MAX_RANGE;

}

export function barrelsOf( w ) {

	return w && w.barrels > 1 ? Math.floor( w.barrels ) : 1;

}

// a cartridge a barrel; the harpoon gun reels its harpoon home (none)
export function cartridgesFor( w ) {

	return ! w || w.noAmmo ? 0 : barrelsOf( w );

}

// full damage to the falloff distance, then down to half at the effective range, then to nothing at maxRange
export function damageAt( w, d ) {

	if ( ! w || ! ( d >= 0 ) ) return 0;
	let k;
	if ( d <= w.falloff ) k = 1;
	else if ( d <= w.range ) k = 1 - 0.5 * ( d - w.falloff ) / ( w.range - w.falloff );
	else k = 0.5 * Math.max( 0, 1 - ( d - w.range ) / ( maxRange( w ) - w.range ) );
	return w.damage * k;

}

export function spreadRad( w, aiming, move = 0, bloom = 0 ) {

	return ( ( aiming ? w.aimSpread : w.spread ) + ( w.moveSpread || 0 ) * clamp( move, 0, 1 ) + BLOOM * clamp( bloom, 0, 1 ) ) * DEG;

}

// a unit direction inside the cone of half-angle `half` round the unit vector dir; u, v in 0..1 (uniform over the disc)
export function spreadDir( dir, half, u, v, out = {} ) {

	const a = half * Math.sqrt( clamp( u, 0, 1 ) ), phi = v * Math.PI * 2;
	// a basis perpendicular to dir
	let px, py, pz;
	if ( Math.abs( dir.y ) < 0.9 ) { px = - dir.z; py = 0; pz = dir.x; } else { px = 0; py = dir.z; pz = - dir.y; }
	let l = Math.hypot( px, py, pz ) || 1;
	px /= l; py /= l; pz /= l;
	const qx = dir.y * pz - dir.z * py, qy = dir.z * px - dir.x * pz, qz = dir.x * py - dir.y * px;
	const s = Math.sin( a ), c = Math.cos( a ), cp = Math.cos( phi ), sp = Math.sin( phi );
	out.x = dir.x * c + ( px * cp + qx * sp ) * s;
	out.y = dir.y * c + ( py * cp + qy * sp ) * s;
	out.z = dir.z * c + ( pz * cp + qz * sp ) * s;
	l = Math.hypot( out.x, out.y, out.z ) || 1;
	out.x /= l; out.y /= l; out.z /= l;
	return out;

}

export function angleBetween( a, b ) {

	return Math.acos( clamp( a.x * b.x + a.y * b.y + a.z * b.z, - 1, 1 ) );

}

// the camera's forward ( -Z rotated by its quaternion )
export function forwardOf( q, out = {} ) {

	const x = q.x, y = q.y, z = q.z, w = q.w;
	out.x = - 2 * ( x * z + w * y );
	out.y = - 2 * ( y * z - w * x );
	out.z = - ( 1 - 2 * ( x * x + y * y ) );
	const l = Math.hypot( out.x, out.y, out.z ) || 1;
	out.x /= l; out.y /= l; out.z /= l;
	return out;

}

// ---- ray tests (o, d: plain { x, y, z }; d unit). Return the distance along the ray or -1

export function raySphere( o, d, c, r ) {

	const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
	const b = ox * d.x + oy * d.y + oz * d.z, cc = ox * ox + oy * oy + oz * oz - r * r;
	const disc = b * b - cc;
	if ( disc < 0 ) return - 1;
	const s = Math.sqrt( disc );
	const t = - b - s;
	if ( t >= 0 ) return t;
	return - b + s >= 0 ? 0 : - 1; // inside

}

// a vertical cylinder ( x, z, radius r ) from y0 to y1: the side (and the top cap)
export function rayCylinderY( o, d, x, z, r, y0, y1 ) {

	const ox = o.x - x, oz = o.z - z;
	const a = d.x * d.x + d.z * d.z;
	let best = - 1;
	if ( a > 1e-9 ) {

		const b = ox * d.x + oz * d.z, c = ox * ox + oz * oz - r * r;
		const disc = b * b - a * c;
		if ( disc >= 0 ) {

			const t = ( - b - Math.sqrt( disc ) ) / a;
			if ( t >= 0 ) {

				const y = o.y + d.y * t;
				if ( y >= y0 && y <= y1 ) best = t;

			}

		}

	}

	// from above (a shot down on someone's crown or shoulders)
	if ( Math.abs( d.y ) > 1e-6 ) {

		const t = ( y1 - o.y ) / d.y;
		if ( t >= 0 && ( best < 0 || t < best ) ) {

			const hx = ox + d.x * t, hz = oz + d.z * t;
			if ( hx * hx + hz * hz <= r * r ) best = t;

		}

	}

	return best;

}

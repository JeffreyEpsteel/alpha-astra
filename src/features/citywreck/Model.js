// The destructible city's state, pure logic (node-testable, no GPU): every building of the plan with its damage, stage,
// fire and repair, the fire's spread between neighbours, the fire crews, repairs over in-game hours, the roads a collapse
// blocks, the city's mood and the repair bills. The feature (CityWreck.js) feeds it hits and the clock and draws it.
//
//   const m = new CityModel( plan, { ground( x, z ), emit( name, payload ), onStage( b, stage, prev, info ), seed, puppet } )
//   m.cannon( x, y, z, kJ, by, targetId? )  m.blast( x, y, z, radius, kJ, by )  m.crash( x, y, z, kJ, by )
//   m.firePool( x, y, z, by )  m.ignite( id, amount, by )  m.hit( id, kJ, { by, cause } )
//   m.update( dt, { rain, hours } )   (hours: in-game hours passed this frame)
//   m.raycast( ax, ay, az, bx, by, bz ) -> { t, id, x, y, z } | null
//   m.isOpen( id )  m.blockedEdges()  m.bulletin()  m.snapshot( full ) / m.apply( list, { remote, silent } )
//   m.toJSON() / m.fromJSON( d ) / m.reset()
//
// The twin towers share damage, fire, replication and repair paths, with heavier structure.

import {
	classOf, hpOf, stageFor, repairCost, STAGE_AT, MAX_STAGE, ARMOR, BLAST_REACH, NEAR_BALL, CRASH, TOWER_MARKS, FIRE, CREW,
	REPAIR, COST, MOOD, COLLAPSE,
} from './CityWreckData.js';

export function rng32( seed ) {

	let a = seed >>> 0;
	return () => {

		a = ( a + 0x6D2B79F5 ) >>> 0;
		let t = a;
		t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
		t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}

export function hashStr( s ) {

	let h = 2166136261;
	for ( let i = 0; i < s.length; i ++ ) h = Math.imul( h ^ s.charCodeAt( i ), 16777619 );
	return h >>> 0;

}

function segDist( px, pz, ax, az, bx, bz ) {

	const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
	const t = l2 > 0 ? Math.max( 0, Math.min( 1, ( ( px - ax ) * dx + ( pz - az ) * dz ) / l2 ) ) : 0;
	return Math.hypot( px - ax - dx * t, pz - az - dz * t );

}

// ( x, z ) into a building's frame (inverse yaw, the destruction props' convention)
function local( b, x, z ) {

	const dx = x - b.x, dz = z - b.z;
	return [ dx * b.cos - dz * b.sin, dx * b.sin + dz * b.cos ];

}

// distance in the ground plane from ( x, z ) to a footprint (0 inside)
export function footDist( b, x, z ) {

	const [ lx, lz ] = local( b, x, z );
	return Math.hypot( Math.max( 0, Math.abs( lx ) - b.hw ), Math.max( 0, Math.abs( lz ) - b.hd ) );

}

// distance from a point to a building's box (0 inside)
export function boxDist( b, x, y, z ) {

	const [ lx, lz ] = local( b, x, z );
	const top = b.y0 + b.top;
	const ey = y < b.y0 ? b.y0 - y : y > top ? y - top : 0;
	return Math.hypot( Math.max( 0, Math.abs( lx ) - b.hw ), ey, Math.max( 0, Math.abs( lz ) - b.hd ) );

}

function corners( b ) {

	const out = [];
	for ( const [ sx, sz ] of [ [ 1, 1 ], [ 1, - 1 ], [ - 1, - 1 ], [ - 1, 1 ] ] ) {

		const lx = sx * b.hw, lz = sz * b.hd;
		// inverse of local(): x = lx c + lz s, z = - lx s + lz c
		out.push( [ b.x + lx * b.cos + lz * b.sin, b.z - lx * b.sin + lz * b.cos ] );

	}

	return out;

}

// the gap between two footprints (convex: the nearest points include a corner of one of them); 0 when they overlap
export function footGap( a, b ) {

	let g = Infinity;
	for ( const [ x, z ] of corners( a ) ) g = Math.min( g, footDist( b, x, z ) );
	for ( const [ x, z ] of corners( b ) ) g = Math.min( g, footDist( a, x, z ) );
	return g;

}

export class CityModel {

	constructor( plan, { ground = null, baseOf = null, emit = null, onStage = null, seed = 21, puppet = false } = {} ) {

		this.plan = plan || { buildings: [], roads: { nodes: [], edges: [] } };
		this.ground = ground || ( () => 0 );
		this.baseOf = baseOf; // ( plan entry ) -> the building's base height (its handle's bounds), else the ground
		this.emit = emit || ( () => {} );
		this.onStage = onStage || ( () => {} );
		this.puppet = !! puppet; // a multiplayer guest: the host's stream sets every stage, nothing changes here on its own
		this.seed = seed >>> 0;
		this.rand = rng32( this.seed ^ 0x9e3779b9 );
		this.time = 0;
		this.hours = 0;
		this.list = [];
		this.byId = new Map();
		this.unrest = 0;
		this.mood = 'calm';
		this.ledger = { open: 0, repaired: 0, owed: 0, paid: 0 };
		this._spreadT = 0;
		this.stats = { hits: 0, stageUps: 0, collapses: 0, ignitions: 0, spreads: 0, repaired: 0, refusedTower: 0 };
		this._build();

	}

	_build() {

		let minX = Infinity, maxX = - Infinity, minZ = Infinity, maxZ = - Infinity;
		for ( const p of this.plan.buildings || [] ) {

			if ( ! p || typeof p.id !== 'string' ) continue;
			const yaw = p.yaw || 0;
			const b = {
				id: p.id, p, kind: p.kind, cls: classOf( p ), hp: hpOf( p ),
				x: p.x, z: p.z, hw: ( p.w || 10 ) / 2, hd: ( p.d || 10 ) / 2, top: p.h || 10, yaw, cos: Math.cos( yaw ), sin: Math.sin( yaw ),
				floors: p.floors || Math.max( 1, Math.round( ( p.h || 10 ) / 3.4 ) ),
				y0: 0, radius: 0,
				dmg: 0, stage: 0, fire: 0, crewAt: null, dousing: false, lastHit: - 1e9, by: null,
				repair: null, cleared: true, blocked: [], marks: 0, markMend: null, neighbours: [],
			};
			b.radius = Math.hypot( b.hw, b.hd );
			let y0 = null;
			try { y0 = this.baseOf ? this.baseOf( p ) : null; } catch ( e ) { y0 = null; }
			b.y0 = Number.isFinite( y0 ) ? y0 : Number.isFinite( p.y ) ? p.y : this.ground( b.x, b.z ) || 0; // (the plan's pad height)
			this.list.push( b );
			this.byId.set( b.id, b );
			minX = Math.min( minX, b.x - b.radius ); maxX = Math.max( maxX, b.x + b.radius );
			minZ = Math.min( minZ, b.z - b.radius ); maxZ = Math.max( maxZ, b.z + b.radius );

		}

		this.bounds = this.list.length ? { x: ( minX + maxX ) / 2, z: ( minZ + maxZ ) / 2, r: Math.hypot( maxX - minX, maxZ - minZ ) / 2 + 20, maxTop: Math.max( ...this.list.map( ( b ) => b.y0 + b.top ) ) } : { x: 0, z: 0, r: 0, maxTop: 0 };
		// neighbours for the fire: footprints within FIRE.spreadGap (a coarse grid keeps it near linear)
		const cell = 40, grid = new Map();
		const key = ( i, k ) => i + ',' + k;
		for ( const b of this.list ) {

			const k = key( Math.floor( b.x / cell ), Math.floor( b.z / cell ) );
			if ( ! grid.has( k ) ) grid.set( k, [] );
			grid.get( k ).push( b );

		}

		for ( const b of this.list ) {

			const ci = Math.floor( b.x / cell ), ck = Math.floor( b.z / cell ), reach = Math.ceil( ( b.radius + FIRE.spreadGap + 30 ) / cell );
			for ( let i = ci - reach; i <= ci + reach; i ++ ) for ( let k = ck - reach; k <= ck + reach; k ++ ) {

				for ( const o of grid.get( key( i, k ) ) || [] ) {

					if ( o === b || Math.hypot( o.x - b.x, o.z - b.z ) > b.radius + o.radius + FIRE.spreadGap ) continue;
					if ( footGap( b, o ) <= FIRE.spreadGap ) b.neighbours.push( o );

				}

			}

		}

		// the road graph: segments by edge id
		const nodes = new Map();
		for ( const n of ( this.plan.roads && this.plan.roads.nodes ) || [] ) nodes.set( n.id, n );
		this.edges = [];
		for ( const e of ( this.plan.roads && this.plan.roads.edges ) || [] ) {

			const a = nodes.get( e.a ), c = nodes.get( e.b );
			if ( a && c ) this.edges.push( { id: e.id, ax: a.x, az: a.z, bx: c.x, bz: c.z, width: e.width || 7 } );

		}

	}

	// ------------------------------------------------------------------ hits

	// structural damage to one building (kJ): the class rules, stage steps, collapse
	hit( id, kJ, { by = 'unknown', cause = 'blast', at = null, cap = 1e9 } = {} ) {

		const b = typeof id === 'string' ? this.byId.get( id ) : id;
		if ( ! b || ! ( kJ > 0 ) || this.puppet ) return 0;
		if ( cause === 'crash' && ! CRASH.classes.includes( b.cls ) ) return 0; // aircraft: low and midrise only
		if ( b.stage === 3 ) return 0; // (rubble: nothing more to break until it is rebuilt)
		const frac = kJ * ( ARMOR[ b.cls ] ?? 1 ) / b.hp;
		if ( ! ( frac > 0 ) ) return 0;
		this.stats.hits ++;
		b.dmg = Math.min( Math.max( b.dmg, Math.min( cap, b.dmg + frac ) ), 1.5 );
		b.lastHit = this.hours;
		b.by = by;
		b.repair = null; // shooting stops the scaffolding
		this._unrest( MOOD.perHit );
		this._restage( b, { by, cause } );
		return frac;

	}

	_mark( b ) {

		b.marks = Math.min( TOWER_MARKS.max, b.marks + 1 );
		b.markMend = this.hours + TOWER_MARKS.mendHours;
		this.emit( 'towerMarked', { id: b.id, marks: b.marks } );

	}

	// the stage the damage (and the fire) calls for; only ever up from here (repairs bring it down)
	_restage( b, info ) {

		let want = stageFor( b.dmg, b.cls );
		if ( b.fire >= FIRE.gutAt && want < 2 && ( MAX_STAGE[ b.cls ] ?? 0 ) >= 2 ) want = 2;
		if ( want > b.stage ) this._setStage( b, want, info );

	}

	_setStage( b, stage, info = {} ) {

		stage = Math.max( 0, Math.min( stage | 0, MAX_STAGE[ b.cls ] ?? 0 ) );
		const prev = b.stage;
		if ( stage === prev ) return false;
		b.stage = stage;
		if ( stage > prev ) {

			this.stats.stageUps += stage - prev;
			const delta = repairCost( b.p, stage ) - repairCost( b.p, prev );
			if ( ! info.remote && ! info.silent ) {

				this.ledger.open += delta;
				if ( info.by === 'player' ) this.ledger.owed += Math.round( delta * COST.playerShare );
				this._unrest( MOOD.perStage * ( stage - prev ) + ( stage === 3 ? MOOD.perCollapse : 0 ) );

			}

			if ( stage >= 2 && b.fire < FIRE.ignite && ! info.remote && ! info.silent && FIRE.classes.includes( b.cls ) && info.cause !== 'fire' ) this._ignite( b, FIRE.ignite, info.by, true );

		}

		const pay = { id: b.id, stage, previous: prev, by: info.by || null, x: b.x, z: b.z, kind: b.kind, remote: !! info.remote, replay: !! info.silent };
		this.emit( 'buildingDamaged', pay );
		// the interiors' contract: a destroyed building (gutted or collapsed) shuts its rooms; mended, they come back
		const interior = b.p.interior || null;
		if ( prev < 2 && stage >= 2 ) this.emit( 'buildingDestroyed', { id: b.id, building: interior, port: b.p.port || 'meridian', stage, replay: !! info.silent } );
		if ( prev >= 2 && stage < 2 ) this.emit( 'buildingRespawned', { id: b.id, building: interior, port: b.p.port || 'meridian' } );
		if ( stage === 3 && prev < 3 ) this._collapse( b, info );
		if ( prev === 3 && stage < 3 && b.blocked.length ) this._unblock( b );
		this.onStage( b, stage, prev, info );
		return true;

	}

	// a collapse: rubble on the roads round it, falling debris on what stands near
	_collapse( b, info ) {

		this.stats.collapses ++;
		b.fire = 0;
		b.cleared = false;
		const spill = this.spillOf( b );
		b.blocked = this.edges.filter( ( e ) => edgeGap( b, e ) < spill + e.width / 2 ).map( ( e ) => e.id );
		this.emit( 'buildingCollapsed', { id: b.id, x: b.x, y: b.y0, z: b.z, w: b.hw * 2, d: b.hd * 2, h: b.top, by: info.by || null, remote: !! info.remote, replay: !! info.silent } );
		this.emit( 'cityFire', { id: b.id, x: b.x, z: b.z, on: false } );
		if ( b.blocked.length ) this.emit( 'roadBlocked', { id: b.id, edges: b.blocked.slice(), x: b.x, z: b.z, radius: spill, replay: !! info.silent } );
		if ( info.remote || info.silent || this.puppet ) return;
		// debris: the fallen volume reaches the neighbours inside the spill (never enough alone to bring another down)
		const vol = b.hw * b.hd * 4 * b.top / 1000;
		const E = vol * COLLAPSE.debrisEnergy * 100;
		for ( const o of this.list ) {

			if ( o === b || o.stage === 3 ) continue;
			const d = footGap( b, o );
			if ( d > spill ) continue;
			const k = 1 - d / Math.max( 1, spill );
			this.hit( o, E * k * k, { by: info.by || null, cause: 'debris', cap: STAGE_AT[ 3 ] - 0.02 } );

		}

		this.emit( 'cityDebris', { id: b.id, x: b.x, y: b.y0, z: b.z, radius: b.radius + spill, energy: Math.round( E * 1000 ), by: info.by || null } );

	}

	spillOf( b ) {

		return Math.min( COLLAPSE.spillMax, Math.max( COLLAPSE.spillMin, b.top * COLLAPSE.spill ) );

	}

	_unblock( b ) {

		const edges = b.blocked;
		b.blocked = [];
		this.emit( 'roadCleared', { id: b.id, edges } );

	}

	// a cannonball's end: a direct hit (the building's id from the raycast) or a ball landing next to a facade
	cannon( x, y, z, kJ, by = 'cannon', targetId = null ) {

		if ( ! Number.isFinite( x ) || ! ( kJ > 0 ) || ! this._nearCity( x, z, 30 ) ) return null;
		let b = targetId ? this.byId.get( targetId ) : null;
		if ( ! b ) {

			let bd = NEAR_BALL;
			for ( const o of this.list ) {

				if ( Math.abs( o.x - x ) > o.radius + NEAR_BALL || Math.abs( o.z - z ) > o.radius + NEAR_BALL ) continue;
				const d = boxDist( o, x, y, z );
				if ( d < bd ) { bd = d; b = o; }

			}

		}

		if ( ! b ) return null;
		this.hit( b, kJ, { by, cause: 'cannon', at: { x, y, z } } );
		return b.id;

	}

	// an explosion (bombs, powder, a car going up): every building in reach, by its distance
	blast( x, y, z, radius, kJ, by = 'explosion' ) {

		if ( ! Number.isFinite( x ) || ! ( kJ > 0 ) || ! ( radius > 0 ) ) return 0;
		const reach = radius * BLAST_REACH;
		if ( ! this._nearCity( x, z, reach ) ) return 0;
		let n = 0;
		for ( const b of this.list ) {

			if ( Math.abs( b.x - x ) > b.radius + reach || Math.abs( b.z - z ) > b.radius + reach ) continue;
			const d = boxDist( b, x, y, z );
			if ( d >= reach ) continue;
			const k = 1 - d / reach;
			if ( this.hit( b, kJ * k * k, { by, cause: 'blast', at: { x, y, z } } ) > 0 ) n ++;

		}

		return n;

	}

	// Aircraft impact energy damages the eligible building classes.
	crash( x, y, z, kJ, by = 'aircraft' ) {

		if ( ! Number.isFinite( x ) || ! ( kJ > 0 ) || ! this._nearCity( x, z, CRASH.radius ) ) return 0;
		let n = 0;
		for ( const b of this.list ) {

			if ( ! CRASH.classes.includes( b.cls ) ) continue;
			if ( Math.abs( b.x - x ) > b.radius + CRASH.radius || Math.abs( b.z - z ) > b.radius + CRASH.radius ) continue;
			const d = boxDist( b, x, y, z );
			if ( d >= CRASH.radius ) continue;
			const k = 1 - d / CRASH.radius;
			if ( this.hit( b, kJ * k, { by, cause: 'crash' } ) > 0 ) n ++;

		}

		return n;

	}

	// a fire bottle's pool: the building it splashed (footprint within reach) is alight
	firePool( x, y, z, by = 'player' ) {

		if ( ! Number.isFinite( x ) || ! this._nearCity( x, z, FIRE.bottleReach ) ) return null;
		let best = null, bd = FIRE.bottleReach;
		for ( const b of this.list ) {

			if ( Math.abs( b.x - x ) > b.radius + bd || Math.abs( b.z - z ) > b.radius + bd ) continue;
			const d = footDist( b, x, z );
			if ( d < bd && y < b.y0 + b.top + 1 ) { bd = d; best = b; }

		}

		if ( ! best ) return null;
		return this.ignite( best, FIRE.ignite, by ) ? best.id : null;

	}

	ignite( id, amount = FIRE.ignite, by = 'unknown' ) {

		const b = typeof id === 'string' ? this.byId.get( id ) : id;
		if ( ! b || this.puppet ) return false;
		return this._ignite( b, amount, by, false );

	}

	_ignite( b, amount, by, quietCall ) {

		if ( ! FIRE.classes.includes( b.cls ) || b.stage === 3 ) return false;
		const was = b.fire;
		b.fire = Math.max( b.fire, Math.min( 1, amount ) );
		b.lastHit = this.hours;
		if ( b.repair ) b.repair = null;
		if ( was <= 0 ) {

			this.stats.ignitions ++;
			b.crewAt = this.time + CREW.respond;
			b.by = by || b.by;
			this.emit( 'cityFire', { id: b.id, x: b.x, z: b.z, on: true, by } );
			this.emit( 'cityFireCall', { id: b.id, x: b.x, z: b.z, at: CREW.respond } );
			if ( ! quietCall ) this._unrest( MOOD.perStage );

		}

		return true;

	}

	_nearCity( x, z, pad = 0 ) {

		const B = this.bounds;
		return Math.hypot( x - B.x, z - B.z ) < B.r + pad;

	}

	// ------------------------------------------------------------------ time

	update( dt, { rain = 0, hours = 0 } = {} ) {

		if ( ! ( dt > 0 ) ) dt = 0;
		this.time += dt;
		this.hours += Math.max( 0, hours );
		if ( this.puppet ) { this._decay( hours ); return; }
		this._fires( dt, rain );
		if ( ( this._spreadT += dt ) >= FIRE.spreadEvery ) { this._spreadT = 0; this._spread( rain ); }
		this._repairs();
		this._decay( hours );

	}

	_fires( dt, rain ) {

		const wet = Math.min( 1, Math.max( 0, rain ) );
		// the crews: up to CREW.teams fires at once, those they reached first
		let teams = CREW.teams;
		const burning = this.list.filter( ( b ) => b.fire > 0 ).sort( ( a, c ) => ( a.crewAt ?? 0 ) - ( c.crewAt ?? 0 ) );
		for ( const b of burning ) {

			const crew = teams > 0 && b.crewAt !== null && this.time >= b.crewAt;
			if ( crew ) teams --;
			if ( crew !== b.dousing ) { b.dousing = crew; this.emit( 'cityCrew', { id: b.id, x: b.x, z: b.z, on: crew } ); }
			const grow = FIRE.grow * Math.max( 0, 1 - wet * 3 ) * ( b.fire < 0.999 ? 1 : 0 );
			b.fire += ( grow - FIRE.rainDamp * wet - ( crew ? CREW.douse : 0 ) ) * dt;
			if ( b.fire >= 1 ) b.fire = 1;
			if ( b.fire <= FIRE.out ) {

				b.fire = 0;
				b.crewAt = null;
				b.dousing = false;
				b.lastHit = this.hours;
				this.emit( 'cityFire', { id: b.id, x: b.x, z: b.z, on: false } );
				continue;

			}

			// the fire eats the floors: up to gutted, never a collapse on its own
			const cap = Math.min( FIRE.burnCap, STAGE_AT[ 3 ] - 0.02 );
			if ( b.dmg < cap ) b.dmg = Math.min( cap, b.dmg + FIRE.burn * b.fire * dt );
			this._restage( b, { by: b.by, cause: 'fire' } );

		}

	}

	_spread( rain ) {

		if ( rain >= FIRE.dryBelow ) return; // wet weather: no spread
		const dry = 1 - Math.max( 0, rain ) / FIRE.dryBelow;
		for ( const b of this.list ) {

			if ( b.fire < 0.5 || b.cls !== 'low' ) continue;
			for ( const o of b.neighbours ) {

				if ( o.fire > 0 || o.cls !== 'low' || o.stage >= 2 ) continue; // (a gutted shell has burnt already)
				if ( this.rand() < FIRE.spreadChance * b.fire * dry ) {

					this.stats.spreads ++;
					this._ignite( o, FIRE.ignite * 0.8, b.by, true );
					this.emit( 'cityFireSpread', { from: b.id, to: o.id } );

				}

			}

		}

	}

	_repairs() {

		const H = this.hours;
		for ( const b of this.list ) {

			if ( b.stage === 0 && b.dmg > 0 && b.fire <= 0 && H - b.lastHit >= REPAIR.quiet ) b.dmg = 0; // a few chips: mended
			if ( b.stage === 0 || b.fire > 0 ) continue;
			if ( ! b.repair ) {

				if ( H - b.lastHit < REPAIR.quiet ) continue;
				b.repair = b.stage === 3 && ! b.cleared
					? { phase: 'clear', start: H, due: H + REPAIR.clearRubble }
					: { phase: 'build', start: H, due: H + REPAIR.hours[ b.stage ] };
				this.emit( 'cityRepair', { id: b.id, phase: b.repair.phase, due: b.repair.due } );
				continue;

			}

			if ( H < b.repair.due ) continue;
			if ( b.repair.phase === 'clear' ) {

				b.cleared = true;
				if ( b.blocked.length ) this._unblock( b );
				b.repair = { phase: 'build', start: H, due: H + REPAIR.hours[ 3 ] };
				this.emit( 'cityRepair', { id: b.id, phase: 'build', due: b.repair.due } );
				continue;

			}

			const cost = repairCost( b.p, b.stage );
			b.repair = null;
			b.dmg = 0;
			b.cleared = true;
			this.ledger.repaired += cost;
			this.ledger.open = Math.max( 0, this.ledger.open - cost );
			this.stats.repaired ++;
			this._setStage( b, 0, { cause: 'repair' } );
			this.emit( 'buildingRepaired', { id: b.id, cost } );

		}

	}

	repairProgress( b ) {

		const r = b && b.repair;
		if ( ! r ) return 0;
		return Math.max( 0, Math.min( 1, ( this.hours - r.start ) / Math.max( 1e-6, r.due - r.start ) ) );

	}

	_unrest( v ) {

		this.unrest = Math.min( 40, this.unrest + v );
		this._setMood();

	}

	_decay( hours ) {

		if ( hours > 0 && this.unrest > 0 ) {

			// fires keep the city on edge
			const burning = this.list.some( ( b ) => b.fire > 0 );
			if ( ! burning ) this.unrest = Math.max( 0, this.unrest - MOOD.decayPerHour * hours );
			this._setMood();

		}

	}

	_setMood() {

		const m = this.unrest >= MOOD.panic ? 'panic' : this.unrest >= MOOD.uneasy ? 'uneasy' : 'calm';
		if ( m !== this.mood ) {

			const previous = this.mood;
			this.mood = m;
			this.emit( 'cityMood', { mood: m, previous } );

		}

	}

	// ------------------------------------------------------------------ queries

	// The buildings within reach of a point.
	near( x, y, z, reach ) {

		const out = [];
		if ( ! Number.isFinite( x ) || ! this._nearCity( x, z, reach ) ) return out;
		for ( const b of this.list ) {

			if ( Math.abs( b.x - x ) > b.radius + reach || Math.abs( b.z - z ) > b.radius + reach ) continue;
			if ( boxDist( b, x, y, z ) < reach ) out.push( b.id );

		}

		return out;

	}


	// shops and rooms: shut when gutted / collapsed / under scaffolding after either, and every shop in a panic
	isOpen( id ) {

		const b = this.byId.get( id );
		if ( ! b ) return true;
		if ( b.stage >= 2 || b.fire > 0.3 ) return false;
		if ( b.repair && b.stage >= 2 ) return false;
		if ( this.mood === 'panic' && ( b.kind === 'shop' || b.kind === 'station' ) ) return false;
		return true;

	}

	blockedEdges() {

		const s = new Set();
		for ( const b of this.list ) for ( const e of b.blocked ) s.add( e );
		return s;

	}

	// the first building along a segment (cannonballs): yawed boxes; a collapsed one is its rubble heap
	raycast( ax, ay, az, bx, by, bz ) {

		const dx = bx - ax, dy = by - ay, dz = bz - az;
		const len = Math.hypot( dx, dy, dz );
		if ( ! ( len > 1e-6 ) ) return null;
		const B = this.bounds;
		if ( segDist( B.x, B.z, ax, az, bx, bz ) > B.r || Math.min( ay, by ) > B.maxTop + 2 ) return null;
		let best = null;
		for ( const b of this.list ) {

			if ( segDist( b.x, b.z, ax, az, bx, bz ) > b.radius + 0.5 ) continue;
			const top = b.stage === 3 ? Math.min( COLLAPSE.heapMax, b.top * COLLAPSE.heapHeight ) : b.top;
			const t = slab( b, top, ax, ay, az, dx, dy, dz );
			if ( t !== null && ( ! best || t < best.t ) ) best = { t, id: b.id };

		}

		if ( ! best ) return null;
		return { t: best.t, id: best.id, x: ax + dx * best.t, y: ay + dy * best.t, z: az + dz * best.t, building: true };

	}

	bulletin( { owedOnly = false } = {} ) {

		const L = this.ledger;
		const fixing = this.list.filter( ( b ) => b.stage > 0 );
		const out = [];
		if ( ! owedOnly && fixing.length ) out.push( { key: 'citywreck.board.repairs', text: `City works: ${ fixing.length } building${ fixing.length === 1 ? '' : 's' } under repair, $${ L.open.toLocaleString( 'en-US' ) } charged to the insurers.`, vars: { n: fixing.length, cost: L.open } } );
		if ( L.owed > L.paid ) out.push( { key: 'citywreck.board.owed', text: `The city claims $${ ( L.owed - L.paid ).toLocaleString( 'en-US' ) } in damages from the captain who did it.`, vars: { cost: L.owed - L.paid } } );
		return out;

	}

	// ------------------------------------------------------------------ the stream and the save

	// [ id, stage, fire 0..100, phase 0 / 1 clear / 2 build ] (full: + dmg 0..1000, repair start, due (hours x 100), cleared, marks)
	entry( b, full = false ) {

		const ph = b.repair ? ( b.repair.phase === 'clear' ? 1 : 2 ) : 0;
		const e = [ b.id, b.stage, Math.round( b.fire * 100 ), ph ];
		if ( full ) e.push( Math.round( b.dmg * 1000 ), b.repair ? Math.round( b.repair.start * 100 ) : null, b.repair ? Math.round( b.repair.due * 100 ) : null, b.cleared ? 1 : 0, b.marks | 0 );
		return e;

	}

	snapshot( full = false ) {

		const out = [];
		for ( const b of this.list ) if ( b.stage || b.fire > 0 || b.repair || b.marks || ( full && b.dmg > 0 ) ) out.push( this.entry( b, full ) );
		return out;

	}

	// A host stream or saved state sets each building's stage.
	apply( list, { remote = false, silent = false, full = false } = {} ) {

		if ( ! Array.isArray( list ) ) return 0;
		let n = 0;
		for ( const e of list ) {

			if ( ! Array.isArray( e ) || typeof e[ 0 ] !== 'string' ) continue;
			const b = this.byId.get( e[ 0 ] );
			if ( ! b ) continue;
			const stage = Math.max( 0, Math.min( MAX_STAGE[ b.cls ] ?? 0, Number( e[ 1 ] ) | 0 ) );
			const fire = Math.max( 0, Math.min( 1, ( Number( e[ 2 ] ) || 0 ) / 100 ) );
			const ph = Number( e[ 3 ] ) | 0;
			if ( full ) {

				b.dmg = Math.max( 0, ( Number( e[ 4 ] ) || 0 ) / 1000 );
				b.cleared = stage < 3 || e[ 7 ] === 1;
				b.repair = ph && Number.isFinite( e[ 6 ] ) ? { phase: ph === 1 ? 'clear' : 'build', start: ( Number( e[ 5 ] ) || 0 ) / 100, due: e[ 6 ] / 100 } : null;

			} else {

				b.repair = ph ? { phase: ph === 1 ? 'clear' : 'build', start: this.hours, due: Infinity } : null;
				if ( stage === 3 ) b.cleared = ph === 2;

			}

			if ( b.dmg < STAGE_AT[ stage ] ) b.dmg = STAGE_AT[ stage ];
			const wasFire = b.fire > 0;
			b.fire = stage === 3 ? 0 : fire;
			if ( wasFire !== b.fire > 0 ) this.emit( 'cityFire', { id: b.id, x: b.x, z: b.z, on: b.fire > 0 } );
			if ( stage !== b.stage ) { this._setStage( b, stage, { remote, silent } ); n ++; }
			if ( stage === 3 && b.cleared && b.blocked.length ) this._unblock( b );
			if ( stage === 0 ) { b.dmg = full ? b.dmg : 0; }

		}

		return n;

	}

	toJSON() {

		return { v: 1, hours: Math.round( this.hours * 100 ) / 100, unrest: Math.round( this.unrest * 10 ) / 10, ledger: { ...this.ledger }, b: this.snapshot( true ) };

	}

	// a loaded save replaces the city: everything mended first, then each saved entry silently
	fromJSON( d ) {

		if ( ! d || typeof d !== 'object' ) return;
		this.reset( { quiet: true } );
		if ( Number.isFinite( d.hours ) ) this.hours = d.hours;
		if ( Number.isFinite( d.unrest ) ) this.unrest = Math.max( 0, d.unrest );
		if ( d.ledger && typeof d.ledger === 'object' ) for ( const k of Object.keys( this.ledger ) ) if ( Number.isFinite( d.ledger[ k ] ) ) this.ledger[ k ] = d.ledger[ k ];
		this.apply( d.b, { silent: true, full: true } );
		this._setMood();

	}

	reset( { quiet = false } = {} ) {

		for ( const b of this.list ) {

			if ( b.fire > 0 && ! quiet ) this.emit( 'cityFire', { id: b.id, x: b.x, z: b.z, on: false } );
			b.fire = 0; b.crewAt = null; b.dousing = false; b.repair = null; b.dmg = 0; b.marks = 0; b.markMend = null; b.lastHit = - 1e9;
			if ( b.stage !== 0 ) { b.cleared = true; this._setStage( b, 0, { cause: 'reset', silent: true } ); }
			if ( b.blocked.length ) this._unblock( b );
			b.cleared = true;

		}

		this.unrest = 0;
		this.ledger = { open: 0, repaired: 0, owed: 0, paid: 0 };
		this._setMood();

	}

}

// the nearest a road edge comes to a footprint (samples every ~3 m along it)
export function edgeGap( b, e ) {

	if ( segDist( b.x, b.z, e.ax, e.az, e.bx, e.bz ) > b.radius + 40 ) return Infinity;
	const L = Math.hypot( e.bx - e.ax, e.bz - e.az ), n = Math.max( 1, Math.ceil( L / 3 ) );
	let g = Infinity;
	for ( let i = 0; i <= n; i ++ ) g = Math.min( g, footDist( b, e.ax + ( e.bx - e.ax ) * i / n, e.az + ( e.bz - e.az ) * i / n ) );
	return g;

}

// segment vs a building's yawed box (base y0, height top): entry t in [0, 1] or null
function slab( b, top, ax, ay, az, dx, dy, dz ) {

	const c = b.cos, s = b.sin;
	const ox = ax - b.x, oz = az - b.z, cy = b.y0 + top / 2;
	const o = [ ox * c - oz * s, ay - cy, ox * s + oz * c ], d = [ dx * c - dz * s, dy, dx * s + dz * c ];
	const h = [ b.hw, top / 2, b.hd ];
	let t0 = 0, t1 = 1;
	for ( let i = 0; i < 3; i ++ ) {

		if ( Math.abs( d[ i ] ) < 1e-9 ) { if ( Math.abs( o[ i ] ) > h[ i ] ) return null; continue; }
		let a = ( - h[ i ] - o[ i ] ) / d[ i ], e = ( h[ i ] - o[ i ] ) / d[ i ];
		if ( a > e ) { const t = a; a = e; e = t; }
		t0 = Math.max( t0, a ); t1 = Math.min( t1, e );
		if ( t0 > t1 ) return null;

	}

	return t0;

}

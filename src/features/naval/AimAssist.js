import { leadAim, solveElevation, rotateByQuat, MUZZLE_SPEED, arcPoints, impactTime } from './Ballistics.js';
import { clamp, normaliseSide } from './util.js';
import { pitchToRange } from './AimCamera.js';
import { aimPoint } from './Sections.js';
import { setStyle, setNum, setClass } from './DomWrites.js';

// Naval aim assist (wave 4): at the helm, each loaded battery shows where its broadside would go - a faint line of dots
// along the ball's arc to where it meets the target (or the water), a small lead marker where the target will be, and a
// ranging readout in the gun rows; after a broadside, a short "Hit" / "Short 14 m" / "Long" / "Wide" line says how it went.
// It reads Naval's own gun plan (the same target pick and lead as Naval.fire), so the preview is the shot.
//
//   aimPlan( naval, side ) -> { side, target: { id, name } | null, range, inArc, points: [ { x, y, z } ], impact: { x, y, z },
//                              lead: { x, z } | null, t, ready, left }  | null        (pure: node tests call it)
//   missReport( impact, target, from ) -> { kind: 'short' | 'long' | 'wide', by: m }    (pure)
//   lookAim( look, eye, gunFor, { traverse, maxRange, minRange, speed, pitchMap } ) -> { side, dir, el, az, lookAz, inArc, range, point, from, pitch }
//                              direct aiming (wave 9, right mouse held at the helm): the side whose beam the camera looks
//                              over, the azimuth clamped to the carriage's traverse, the range where the look ray meets the
//                              water (clamped to the gun's reach: looking at or above the horizon is full range) and the
//                              elevation that drops the ball there. gunFor( side ) -> { m: muzzle { x, y, z }, n: beam normal
//                              { x, z } (unit, horizontal) }. While Naval aims, aimPlan draws only that side's arc.
//                              pitchMap (wave 10, the third-person aim camera): the range comes from the look's pitch instead
//                              (AimCamera.pitchToRange: a band from 0.40 rad down to just above the horizon), since the chase
//                              camera's ray meets the water far too close to the hull to range by
//   the aimed plan carries outOfArc: its dots draw dim while the look is past the swing
//   const a = new AimAssist( { doc } );  a.update( model, camera, project, dt );  a.bind( features );  a.dispose()
//   (Hud.js owns one: NavalHud.update feeds it hudModel's model.aim)

export const AIM = { range: 320, dots: 26, others: 150, feedback: 1.6, window: 0.6 };

// the ship Naval.fire would pick from this side (a pirate in the arc, nearest first; others only inside 150 m)
function pickTarget( naval, m, normal, traverse, reach ) {

	let best = null, bs = Infinity;
	const nl = Math.hypot( normal.x, normal.z ) || 1;
	for ( const s of naval.ships || [] ) {

		if ( ! s.alive ) continue;
		const dx = s.x - m.x, dz = s.z - m.z, range = Math.hypot( dx, dz );
		if ( range < 15 || range > reach || ( s.faction !== 'pirate' && range > AIM.others ) ) continue;
		const az = Math.acos( clamp( ( dx * normal.x + dz * normal.z ) / ( range * nl ), - 1, 1 ) );
		if ( az > traverse ) continue;
		const score = range + ( s.faction === 'pirate' ? 0 : 200 );
		if ( score < bs ) { bs = score; best = s; }

	}

	return best;

}

export function lookAim( look, eye, gunFor, { traverse = 0.4, maxRange = 320, minRange = 20, speed = MUZZLE_SPEED, pitchMap = false } = {} ) {

	let lx = look.x, lz = look.z;
	const ll = Math.hypot( lx, lz );
	const port = gunFor( 'port' );
	if ( ll < 1e-4 ) { lx = port.n.x; lz = port.n.z; } else { lx /= ll; lz /= ll; }
	const side = lx * port.n.x + lz * port.n.z >= 0 ? 'port' : 'starboard';
	const g = side === 'port' ? port : gunFor( 'starboard' );
	const nx = g.n.x, nz = g.n.z, m = g.m;
	// the look's azimuth off the beam, then held inside the traverse
	const lookAz = Math.atan2( nx * lz - nz * lx, nx * lx + nz * lz );
	const az = clamp( lookAz, - traverse, traverse );
	const c = Math.cos( az ), s = Math.sin( az );
	const hx = nx * c - nz * s, hz = nx * s + nz * c;
	const pitch = Math.asin( clamp( look.y / ( Math.hypot( look.x, look.y, look.z ) || 1 ), - 1, 1 ) );
	// where the look ray meets the sea (y = 0), measured from the muzzle along the aimed bearing; or (third person) the
	// look's pitch mapped onto the gun's reach
	let range = maxRange;
	if ( pitchMap ) range = pitchToRange( pitch, minRange, maxRange );
	else if ( look.y < - 1e-4 ) {

		const t = - eye.y / look.y;
		const px = eye.x + look.x * t, pz = eye.z + look.z * t;
		range = ( px - m.x ) * hx + ( pz - m.z ) * hz;

	}

	range = clamp( range, minRange, maxRange );
	const el = solveElevation( speed, range, - m.y ) ?? Math.PI / 4;
	const ce = Math.cos( el );
	return {
		side, dir: { x: hx * ce, y: Math.sin( el ), z: hz * ce }, el, az, lookAz, inArc: Math.abs( lookAz ) <= traverse, range,
		point: { x: m.x + hx * range, y: 0, z: m.z + hz * range }, from: { x: m.x, y: m.y, z: m.z }, pitch,
	};

}

// the arc of the side being aimed by hand (Naval.aimInfo): drawn whatever is in front of it
function aimedPlan( naval, sd, b ) {

	const ai = naval.aimInfo;
	if ( ! ai || ai.side !== sd ) return null;
	const bvel = b.velocity ? { x: b.velocity.x, y: b.velocity.y || 0, z: b.velocity.z } : { x: 0, y: 0, z: 0 };
	const m = ai.from;
	const V = { x: ai.dir.x * MUZZLE_SPEED + bvel.x, y: ai.dir.y * MUZZLE_SPEED + bvel.y, z: ai.dir.z * MUZZLE_SPEED + bvel.z };
	const t = impactTime( m, V, 0 ) ?? 1;
	const points = arcPoints( m, V, { maxT: t, max: AIM.dots, floor: 0 } );
	const total = typeof naval.reloadTime === 'function' ? naval.reloadTime( naval.playerGun ? naval.playerGun.level : 1 ) : 1;
	const left = naval.reloadLeft ? Math.max( 0, naval.reloadLeft[ sd ] || 0 ) : 0;
	return {
		side: sd, aimed: true, outOfArc: ! ai.inArc, target: null, range: Math.round( ai.range ), inArc: true, points,
		impact: points[ points.length - 1 ], lead: null, t, ready: left <= 0, left, frac: left <= 0 ? 1 : clamp( 1 - left / total, 0, 1 ),
		from: { x: m.x, z: m.z },
	};

}

export function aimPlan( naval, side ) {

	const sd = normaliseSide( side );
	const app = naval && naval.app, b = app && app.boatCtl;
	if ( ! sd || ! b || ! b.position || ! b.quaternion || typeof naval._gunPlan !== 'function' || typeof naval._muzzleWorld !== 'function' ) return null;
	if ( naval.aiming ) return aimedPlan( naval, sd, b ); // aiming by hand: only that side's arc, no auto-lead
	const plan = naval._gunPlan( sd );
	if ( ! plan || ! plan.mounts || ! plan.mounts.length ) return null;
	const m = naval._muzzleWorld( plan.mounts[ Math.floor( ( plan.mounts.length - 1 ) / 2 ) ], b, { x: 0, y: 0, z: 0 } );
	const normal = rotateByQuat( b.quaternion, { x: plan.sg, y: 0, z: 0 } );
	const nl = Math.hypot( normal.x, normal.z ) || 1;
	const rangeMul = naval.mods && Number.isFinite( naval.mods.range ) ? naval.mods.range : 1;
	const target = pickTarget( naval, m, normal, plan.L.traverse, AIM.range * rangeMul );
	const bvel = b.velocity ? { x: b.velocity.x, y: b.velocity.y || 0, z: b.velocity.z } : { x: 0, y: 0, z: 0 };
	let dir = null, t = null, lead = null, floor = 0;
	if ( target ) {

		// laid on the part the skipper picked (wave 11A: naval.aimPart, Tab while aiming), as Naval._fireMount does
		const tp = target.cls && typeof target.toWorld === 'function' ? aimPoint( target, naval.aimPart || 'hull', {} )
			: { x: target.x, y: ( target.pose ? target.pose.y : 0 ) + 1, z: target.z };
		const ty = tp.y;
		const tv = target.velocity ? target.velocity( {} ) : { x: 0, y: 0, z: 0 };
		const aim = leadAim( m, bvel, tp, tv, MUZZLE_SPEED );
		if ( aim ) {

			const hz = Math.hypot( aim.dir.x, aim.dir.z ) || 1;
			const az = Math.acos( clamp( ( aim.dir.x * normal.x + aim.dir.z * normal.z ) / ( hz * nl ), - 1, 1 ) );
			if ( az <= plan.L.traverse * 1.5 ) {

				dir = aim.dir;
				t = aim.t;
				floor = ty;
				lead = { x: tp.x + tv.x * aim.t, z: tp.z + tv.z * aim.t };

			}

		}

	}

	if ( ! dir ) {

		// no target in the arc: the level shot Naval fires (about 90 m out)
		const el = solveElevation( MUZZLE_SPEED, 90 * rangeMul, - m.y ) ?? 0.03;
		dir = { x: normal.x / nl * Math.cos( el ), y: Math.sin( el ), z: normal.z / nl * Math.cos( el ) };

	}

	const V = { x: dir.x * MUZZLE_SPEED + bvel.x, y: dir.y * MUZZLE_SPEED + bvel.y, z: dir.z * MUZZLE_SPEED + bvel.z };
	if ( t === null ) t = impactTime( m, V, 0 ) ?? 1;
	const points = arcPoints( m, V, { maxT: t, max: AIM.dots, floor } );
	const impact = points[ points.length - 1 ];
	const total = typeof naval.reloadTime === 'function' ? naval.reloadTime( naval.playerGun ? naval.playerGun.level : 1 ) : 1;
	const left = naval.reloadLeft ? Math.max( 0, naval.reloadLeft[ sd ] || 0 ) : 0;
	return {
		side: sd, target: target ? { id: target.id, name: target.captain || ( target.cls && target.cls.label ) || target.name } : null,
		range: target ? Math.round( Math.hypot( target.x - m.x, target.z - m.z ) ) : null, inArc: !! ( target && lead ),
		points, impact, lead, t, ready: left <= 0, left, frac: left <= 0 ? 1 : clamp( 1 - left / total, 0, 1 ),
		from: { x: m.x, z: m.z },
	};

}

// how a ball that came down at `impact` missed `target` fired from `from`: short / long along the line, else wide
export function missReport( impact, target, from ) {

	const dx = target.x - from.x, dz = target.z - from.z, l = Math.hypot( dx, dz ) || 1;
	const ux = dx / l, uz = dz / l;
	const ix = impact.x - from.x, iz = impact.z - from.z;
	const along = ix * ux + iz * uz - l, across = - ix * uz + iz * ux;
	if ( Math.abs( along ) >= Math.abs( across ) ) return { kind: along < 0 ? 'short' : 'long', by: Math.round( Math.abs( along ) ) };
	return { kind: 'wide', by: Math.round( Math.abs( across ) ) };

}

export const AIM_CSS = `
.nv-aim { position: fixed; inset: 0; z-index: 18; pointer-events: none; }
.nv-aim i { position: absolute; width: 5px; height: 5px; margin: -2.5px 0 0 -2.5px; border-radius: 50%; background: rgba(255, 255, 255, 0.55); box-shadow: 0 0 2px rgba(0, 0, 0, 0.6); }
.nv-aim i.is-dim { background: rgba(255, 255, 255, 0.22); }
.nv-aim i.is-reload { background: rgba(255, 190, 90, 0.3); }
.nv-aim b { position: absolute; width: 14px; height: 14px; margin: -7px 0 0 -7px; border: 2px solid rgba(255, 210, 74, 0.8); border-radius: 50%; }
.nv-aimfb { position: fixed; left: 50%; top: 58%; transform: translateX(-50%); z-index: 21; pointer-events: none; font: 700 14px var(--tw-font, system-ui, sans-serif);
	letter-spacing: 0.06em; color: #fff; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8); opacity: 0; transition: opacity 0.25s; }
.nv-aimfb.is-on { opacity: 1; }
.nv-aimfb.is-hit { color: #8fd18c; }
.nv-aimfb.is-miss { color: #ffc8a8; }
`;

let cssDone = false;

export class AimAssist {

	// css: false when the owner's stylesheet already carries AIM_CSS (Hud.js)
	constructor( { doc = null, css = true } = {} ) {

		this.doc = doc;
		this.layer = null;
		this.dots = [];
		this.marks = [];
		this.fbT = 0;
		this._bound = null;
		this._off = null;
		this._shots = null; // impacts of the broadside in flight: { t, hit, best }
		this.last = null; // the last feedback { kind, by, text }
		this.plans = { port: null, starboard: null };
		if ( ! doc || ! doc.createElement || ! doc.body ) return;
		if ( css && ! cssDone ) {

			const st = doc.createElement( 'style' );
			st.textContent = AIM_CSS;
			( doc.head || doc.body ).append( st );
			cssDone = true;

		}

		this.layer = doc.createElement( 'div' );
		this.layer.className = 'nv-aim';
		this.fb = doc.createElement( 'div' );
		this.fb.className = 'nv-aimfb';
		doc.body.append( this.layer, this.fb );

	}

	// follow the player's impacts on the feature registry (once)
	bind( features ) {

		if ( ! features || ! features.on || this._bound === features ) return;
		if ( this._off ) this._off();
		this._bound = features;
		this._off = features.on( 'cannonballImpact', ( e ) => this.onImpact( e ) );

	}

	// a player's ball came down: collect the broadside's impacts for AIM.window s, then report the best of them
	onImpact( e ) {

		if ( ! e || e.owner !== 'player' ) return;
		const sh = this._shots || ( this._shots = { t: AIM.window, hit: false, best: null } );
		if ( e.hit === 'ship' ) { sh.hit = true; return; }
		if ( e.hit !== 'water' ) return;
		// against the target the battery was aimed at
		const plan = [ this.plans.port, this.plans.starboard ].filter( ( p ) => p && p.inArc ).sort( ( a, b ) => Math.hypot( a.impact.x - e.x, a.impact.z - e.z ) - Math.hypot( b.impact.x - e.x, b.impact.z - e.z ) )[ 0 ];
		if ( ! plan || ! plan.lead ) return;
		const r = missReport( e, plan.lead, plan.from );
		if ( ! sh.best || r.by < sh.best.by ) sh.best = r;

	}

	_feedback( text, kind ) {

		this.last = { text, kind };
		this.fbT = AIM.feedback;
		if ( ! this.fb ) return;
		this.fb.textContent = text;
		this.fb.classList.toggle( 'is-hit', kind === 'hit' );
		this.fb.classList.toggle( 'is-miss', kind !== 'hit' );

	}

	_dot( i ) {

		while ( this.dots.length <= i ) {

			const e = this.doc.createElement( 'i' );
			this.layer.append( e );
			this.dots.push( e );

		}

		return this.dots[ i ];

	}

	_mark( i ) {

		while ( this.marks.length <= i ) {

			const e = this.doc.createElement( 'b' );
			this.layer.append( e );
			this.marks.push( e );

		}

		return this.marks[ i ];

	}

	// aim: [ plan, plan ] (hudModel's model.aim) or null; project( camera, point ) -> { visible, x, y } (0..1)
	update( aim, camera, project, dt = 0.016 ) {

		this.plans.port = aim ? aim.find( ( p ) => p && p.side === 'port' ) || null : null;
		this.plans.starboard = aim ? aim.find( ( p ) => p && p.side === 'starboard' ) || null : null;
		const sh = this._shots;
		if ( sh ) {

			sh.t -= dt;
			if ( sh.t <= 0 ) {

				this._shots = null;
				if ( sh.hit ) this._feedback( 'HIT', 'hit' );
				else if ( sh.best ) this._feedback( sh.best.kind === 'wide' ? `WIDE ${ sh.best.by } m` : `${ sh.best.kind.toUpperCase() } ${ sh.best.by } m`, sh.best.kind );

			}

		}

		if ( this.fbT > 0 ) this.fbT -= dt;
		if ( this.fb ) this.fb.classList.toggle( 'is-on', this.fbT > 0 );
		if ( ! this.layer ) return;
		let nd = 0, nm = 0;
		if ( aim && camera && project ) {

			for ( const p of aim ) {

				if ( ! p ) continue;
				// only a battery with something to shoot at draws (the other side stays quiet)
				if ( ! p.inArc ) continue;
				// out of the swing the aimed arc stays (where the guns can still go) but dim
				const cls = p.outOfArc ? 'is-dim' : p.ready ? '' : 'is-reload';
				for ( let i = 1; i < p.points.length; i ++ ) {

					const q = project( camera, p.points[ i ] );
					if ( ! q || ! q.visible ) continue;
					const e = this._dot( nd ++ );
					setStyle( e, 'display', '' );
					setClass( e, i % 2 ? cls : ( cls || 'is-dim' ) );
					setNum( e, 'left', q.x * 100, 2, '', '%' );
					setNum( e, 'top', q.y * 100, 2, '', '%' );

				}

				if ( p.lead ) {

					const q = project( camera, { x: p.lead.x, y: p.impact.y, z: p.lead.z } );
					if ( q && q.visible ) {

						const e = this._mark( nm ++ );
						setStyle( e, 'display', '' );
						setNum( e, 'left', q.x * 100, 2, '', '%' );
						setNum( e, 'top', q.y * 100, 2, '', '%' );

					}

				}

			}

		}

		for ( let i = nd; i < this.dots.length; i ++ ) setStyle( this.dots[ i ], 'display', 'none' );
		for ( let i = nm; i < this.marks.length; i ++ ) setStyle( this.marks[ i ], 'display', 'none' );

	}

	dispose() {

		if ( this._off ) this._off();
		this._off = null;
		this._bound = null;
		if ( this.layer ) this.layer.remove();
		if ( this.fb ) this.fb.remove();
		this.layer = null;
		this.fb = null;

	}

}

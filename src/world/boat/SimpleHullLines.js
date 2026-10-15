import { Vector3 } from '../../engine/index.js';
import { RHO_SEAWATER } from './HullLines.js';

// A simple lines plan for the fleet hulls (world/boat/FleetBoatModel.js), built from a Boats.js
// catalog entry { length, beam, draft, deckY, freeboard, mass? }. Same frame and the same member
// names as HullLines (the lobster boat): +Z forward (bow), +Y up, +X port, y = 0 the design
// waterline, z = 0 the middle of the hull.
//
// Shape (kept deliberately simple):
// - plan view: an ellipse in u = -0.8 .. 1 (u = -0.8 at the transom, so the stern keeps 60 % of the
//   beam; u = 1 at the stem): halfBeam( u ) = hb * sqrt( 1 - u^2 ). The sheer uses the full beam
//   over zAft..zBow, the waterline 90 % of it over wlStart..wlEnd (the topsides flare out).
// - profile: keel depth draftAt( z ) = D * sqrt( 1 - u^2 ) (a rockered canoe body).
// - sections below the waterline are parabolas, bottom( x ) = -d * ( 1 - ( x / hb )^2 ), so the
//   immersed section area is 4/3 * hb * d and its centroid 2/5 d below the waterline; above the
//   waterline the half breadth grows linearly from the waterline to the sheer.
//
// When `mass` is given, the hydrostatic draft D is solved so that the immersed canoe body
// displaces exactly that mass in seawater (the catalog masses are lighter than a full canoe body
// of the design draft would displace); `draft` keeps the design (visual / grounding) value and
// `draftScale` = D / draft reports how much the hydrostatic body was flattened.
//
// Optional shape options for the ship hulls (world/boat/ShipBoatModel.js), defaults = the fleet hulls:
// `wlBeam` waterline beam / sheer beam (0.9), `flare` fraction of the sheer height at which the topsides
// reach the full sheer beam (1 = linear flare all the way up; a ship's sides are near vertical above the
// first metre), `sheerRise` how much higher the sheer is at the stem than at the transom (0.12), `shell`
// thickness of the planking / bulwark at the sheer (0.05).

const clamp01 = ( x ) => Math.min( 1, Math.max( 0, x ) );
const lerp = ( a, b, t ) => a + ( b - a ) * t;
const U0 = - 0.8; // plan-view parameter at the transom (u = 1 at the stem)
const WL_BEAM = 0.9; // waterline beam / sheer beam (default of the wlBeam option)
const NZ = 400; // longitudinal integration steps

export class SimpleHullLines {

	constructor( { length = 4.5, beam = 1.9, draft = 0.25, deckY = 0.31, freeboard = 0.65, mass = 0, wlBeam = WL_BEAM, flare = 1, sheerRise = 0.12, shell = 0.05 } = {} ) {

		this.length = length;
		this.beam = beam;
		this.draft = draft; // design draft (keel below the waterline), used for dimensions / grounding
		this.deckY = deckY;
		this.freeboard = freeboard;
		this.wlBeam = wlBeam;
		this.flare = flare;
		this.sheerRise = sheerRise;
		this.shell = shell; // planking + rubrail thickness at the sheer
		this.houseBack = 0; // no deckhouse in the lines: both 0
		this.houseFront = 0;

		this.zAft = - length / 2;
		this.zBow = length / 2;
		this.zFore = this.zBow - 0.35; // forward limit for deck walking (the stem head is not a floor)
		this.wlStart = this.zAft + 0.1;
		this.wlEnd = this.zBow - 0.1;

		// hydrostatic draft: solve for the catalog mass, otherwise the design draft
		this.hydroDraft = draft;
		if ( mass > 0 ) {

			const perMetre = this._integrate( 1 ).volume; // m^3 of canoe body per metre of draft
			this.hydroDraft = Math.min( draft * 1.5, Math.max( 0.06, mass / ( RHO_SEAWATER * perMetre ) ) );

		}

		this.draftScale = this.hydroDraft / draft;

		const h = this._integrate( this.hydroDraft );
		this.waterplaneArea = h.area;
		this.canoeVolume = h.volume;
		this.centerOfFlotationZ = h.cfz;
		this.centerOfBuoyancy = new Vector3( 0, h.cby, h.cbz );
		this.transverseInertia = h.inertia; // waterplane second moment about the centerline

	}

	// ---------------------------------------------------------------- plan / profile curves

	// plan-view parameter of the sheer at station t (0 transom .. 1 stem)
	_uSheer( t ) {

		return U0 + ( 1 - U0 ) * clamp01( t );

	}

	// plan-view parameter of the waterline at z (outside wlStart..wlEnd: beyond the ends)
	_uWL( z ) {

		return U0 + ( 1 - U0 ) * ( z - this.wlStart ) / ( this.wlEnd - this.wlStart );

	}

	_plan( u ) {

		return Math.sqrt( Math.max( 0, 1 - u * u ) );

	}

	sheerZ( t ) {

		return this.zAft + this.length * t;

	}

	tAtSheerZ( z ) {

		return clamp01( ( z - this.zAft ) / this.length );

	}

	// half beam at the sheer (gunwale)
	sheerX( t ) {

		return 0.5 * this.beam * this._plan( this._uSheer( t ) );

	}

	// sheer height: the freeboard aft, a little higher toward the bow
	sheerY( t ) {

		const s = clamp01( t );
		return this.freeboard * ( 1 + this.sheerRise * s * s );

	}

	// waterline half beam at z (0 outside the waterline length)
	halfBeamAt( z ) {

		if ( z < this.wlStart || z > this.wlEnd ) return 0;
		return 0.5 * this.beam * this.wlBeam * this._plan( this._uWL( z ) );

	}

	// canoe-body depth below the waterline at z (0 outside)
	draftAt( z ) {

		if ( z < this.wlStart || z > this.wlEnd ) return 0;
		return this.hydroDraft * this._plan( this._uWL( z ) );

	}

	keelY( t ) {

		return - this.draftAt( this.sheerZ( t ) );

	}

	// hull bottom height at (x, z); +Infinity outside the immersed footprint
	bottomAt( x, z ) {

		const hb = this.halfBeamAt( z ), d = this.draftAt( z );
		const ax = Math.abs( x );
		if ( ! ( hb > 0 ) || ax > hb ) return Infinity;
		return - d * ( 1 - ( ax / hb ) * ( ax / hb ) );

	}

	// outer half breadth of station t at height y
	halfBreadth( t, y ) {

		const z = this.sheerZ( t );
		const sx = this.sheerX( t ), sy = this.sheerY( t );
		if ( y >= sy ) return sx;
		const hb = this.halfBeamAt( z ), d = this.draftAt( z );
		if ( y >= 0 ) return lerp( hb, sx, clamp01( y / ( sy * this.flare ) ) );
		if ( ! ( d > 0 ) || y <= - d ) return 0;
		return hb * Math.sqrt( 1 + y / d ); // parabola: bottom( x ) = -d ( 1 - ( x / hb )^2 )

	}

	// ---------------------------------------------------------------- stations (for hull volumes)

	stationParams( count ) {

		const ts = [];
		for ( let i = 0; i < count; i ++ ) ts.push( i / ( count - 1 ) );
		return ts;

	}

	// surface points of station t (port side), keel to sheer, as Vector3s
	station( t, density = 1 ) {

		const z = this.sheerZ( t );
		const d = this.draftAt( z ), sy = this.sheerY( t );
		const pts = [];
		const nb = 4 * density, nt = 3 * density;
		for ( let j = 0; j <= nb; j ++ ) {

			const y = - d * ( 1 - j / nb );
			pts.push( new Vector3( this.halfBreadth( t, y ), y, z ) );

		}

		for ( let j = 1; j <= nt; j ++ ) {

			const y = sy * j / nt;
			pts.push( new Vector3( this.halfBreadth( t, y ), y, z ) );

		}

		return pts;

	}

	// ---------------------------------------------------------------- hydrostatics

	// Waterplane and immersed-volume integrals for a given keel draft D (same plan / profile).
	_integrate( D ) {

		const L = this.wlEnd - this.wlStart, dz = L / NZ;
		let area = 0, volume = 0, mz = 0, vz = 0, vy = 0, inertia = 0;
		for ( let i = 0; i < NZ; i ++ ) {

			const z = this.wlStart + ( i + 0.5 ) * dz;
			const p = this._plan( this._uWL( z ) );
			const hb = 0.5 * this.beam * this.wlBeam * p, d = D * p;
			const dA = 2 * hb * dz;
			const dV = ( 4 / 3 ) * hb * d * dz;
			area += dA; mz += dA * z;
			volume += dV; vz += dV * z; vy += dV * ( - 0.4 * d );
			inertia += ( 2 / 3 ) * hb * hb * hb * dz;

		}

		return { area, volume, cfz: mz / area, cbz: vz / volume, cby: vy / volume, inertia };

	}

	// Buoyancy samples: `slices` longitudinal slices x 4 lateral strips (two per side, split at half
	// the local waterline beam), laid out like HullLines.buildHullSamples: each sample carries the
	// waterplane area of its patch, position.y is the patch's mean hull depth (so that
	// sum( area * depth ) = canoeVolume), x sits at the patch's radius of gyration, bottomY is the
	// hull bottom under the sample.
	buildHullSamples( slices = 8 ) {

		const L = this.wlEnd - this.wlStart;
		const nzs = 24, nxs = 24; // sub-steps per slice / strip
		const samples = [];
		for ( let s = 0; s < slices; s ++ ) {

			const z0 = this.wlStart + L * s / slices, dz = L / slices / nzs;
			for ( let strip = 0; strip < 2; strip ++ ) {

				let a = 0, x2 = 0, zc = 0, v = 0;
				for ( let i = 0; i < nzs; i ++ ) {

					const z = z0 + ( i + 0.5 ) * dz;
					const hb = this.halfBeamAt( z ), d = this.draftAt( z );
					if ( ! ( hb > 0 ) ) continue;
					const xa = strip * hb * 0.5, dx = hb * 0.5 / nxs;
					for ( let k = 0; k < nxs; k ++ ) {

						const x = xa + ( k + 0.5 ) * dx;
						const depth = d * ( 1 - ( x / hb ) * ( x / hb ) );
						const dA = dx * dz;
						a += dA; x2 += dA * x * x; zc += dA * z; v += dA * depth;

					}

				}

				if ( a <= 0 ) continue;
				const x = Math.sqrt( x2 / a ), z = zc / a, y = - v / a;
				const b = this.bottomAt( x, z );
				const bottomY = Math.min( 0, b === Infinity ? y : b );
				samples.push( { position: new Vector3( x, y, z ), area: a, depth: - y, bottomY } );
				samples.push( { position: new Vector3( - x, y, z ), area: a, depth: - y, bottomY } );

			}

		}

		return samples;

	}

}

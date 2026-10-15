// Rigid-body flight model of a single-engine floatplane (a stylised Beaver: 1.8 t, 14.6 m span, 23 m^2 wing,
// two 7.4 m floats). Pure logic: no engine objects besides the math, no GPU, so the node test can fly it.
//
//   const f = new Flight();
//   f.place( x, z, heading );                       // afloat at rest (position = model origin, see GEOM)
//   f.controls.throttle = 1; f.controls.pitch = 1;  // pilot inputs: throttle 0..1, pitch / roll / yaw -1..1
//   f.setWater( i, height, verticalSpeed );         // the four float probes (probeWorld( i ) says where)
//   f.groundAt = ( x, z ) => terrainHeight;         // optional
//   f.update( dt );                                 // fixed 120 Hz sub-steps inside
//   f.airspeed, f.alpha, f.stall, f.airborne, f.onWater, f.agl, f.events (drained by the caller)
//   f.flaps = 0 | 1 | 2 (notch asked for; f.flapPos follows at the motor's pace), f.controls.trim (-1..1, nose up +),
//   f.fuel (0..1: ~25 min at full power; empty stops the engine with a { type: 'fuelOut' } event), f.cranking (the
//   starter turns the propeller over), f.stallMargin (rad of wing alpha left before the stall)
//   f.sprung [ port, starboard ] (0..1, wave 10: a float sprung by a rough landing lists the plane and drags); strike
//   events carry { part, surface, speed, sink (the part's downward speed), nose (f.noseFirst()), side (+1 port, -1
//   starboard, 0 centre) } for Crash.js
//
// Frames: the model frame is the boat frame (+Z forward, +Y up, +X port), origin between the float keels at the
// centre of mass' station. Air: every lifting surface (two wing halves with incidence and dihedral, the tailplane,
// the fin) is a flat-ish wing section seeing its own local flow (body velocity + rotation x lever, the tail also in
// the propeller slipstream), so pitch / roll / yaw damping and the static stability come out of the geometry.
// Lift 0.5 rho v^2 S CL(alpha) with a cambered linear slope that stalls past ~15 deg into a flat plate; drag is
// parasitic + induced (CL^2 / pi e AR) + the flat plate past the stall. Thrust falls off with speed towards the
// propeller's pitch speed. Water: float sections take the probe heights (interpolated bow to stern), buoyancy and
// heave damping per section, a resistance that peaks at the hump (~9 m/s) and drops once the floats are on the step
// (planing lift near the step raises them), keel-like side resistance and a water rudder for taxiing. Terrain:
// keel points get a stiff spring with friction (beaching at a walk); other parts touching anything are strikes.
//
// Wave 12 (airframes, Airframes.js): the geometry is per spec (spec.geom, GEOM for the Jade): any number of floats
// ({ x, side: 1 port / -1 starboard / 0 a centre hull, y0, beam, top, step, fore, sections, rudder }), keel points,
// strike points, engines (a twin: f.engineFail[ i ] cuts one, the other's thrust yaws the plane), and for a land
// plane wheels ({ x, y, z, steer, brake }: tricycle gear, nose wheel steering with f.controls.waterRudder,
// f.controls.brake 0..1 on the main wheels, rolling resistance). f.setSpec( spec ) swaps the airframe / its upgrades
// / its load in place (the state is kept). spec.humpDrag scales the hump of the water resistance, spec.flaps.notches
// (2, or 3 with STOL flaps) the flap lever.

import { Vector3, Quaternion, MathUtils } from '../../engine/index.js';

const G = 9.81;
const RHO_AIR = 1.225;
const RHO_W = 1025;
const DEG = Math.PI / 180;
const sstep = MathUtils.smoothstep;
const clamp = MathUtils.clamp;

// shared geometry (model frame, metres): the Blender build (tools/seaplane/build_seaplane.py) uses the same numbers
export const GEOM = {
	floatX: 1.35, floatBow: 3.5, floatStern: - 3.9, floatTop: 0.62, floatBeam: 0.8, step: - 0.3,
	probes: [ [ 1.35, 2.6 ], [ - 1.35, 2.6 ], [ 1.35, - 3.0 ], [ - 1.35, - 3.0 ] ], // [ x, z ]: port bow, starboard bow, port stern, starboard stern
	com: [ 0, 1.75, 0 ],
	seat: [ 0.32, 1.45, 1.15 ], // the pilot's floor under the left seat (avatar feet origin)
	// the pilot's eye, 0.8 m over the seat cushion (top 1.93): over the glare shield (lip 2.5 at z 2.4: ~11 deg down
	// to the water ahead) and the lowered cowling (2.5), under the roof (3.1) and the wing (3.14)
	eye: [ 0.32, 2.74, 1.2 ],
	// the instrument panel's live face (Cockpit.js): centre, width, height, tilt (rad, its top leans towards the nose)
	panel: { c: [ 0, 2.27, 2.4 ], w: 1.22, h: 0.4, tilt: 0.26 },
	door: [ 1.35, 0.62, 1.0 ], // on the port float's deck beside the cabin door
	prop: [ 0, 2.2, 3.85 ], propRadius: 1.3,
	span: 14.6, length: 10.4,
};

export const SPEC = {
	mass: 1800,
	inertia: [ 4200, 6800, 3400 ], // about x (pitch), y (yaw), z (roll), kg m^2
	maxThrust: 8200, // N static at full power
	pitchSpeed: 85, // m/s where the propeller stops pulling
	spoolUp: 0.7, spoolDown: 1.0, // s
	idle: 0.08, // rpm fraction while the engine idles
	thrustPoint: [ 0, 1.95, 3.6 ],
	discArea: Math.PI * 1.3 * 1.3,
	// lifting surfaces: pos (aerodynamic centre), area, aspect ratio, lift slope (/rad), zero-lift camber CL0,
	// incidence (rad, nose up), dihedral (rad, tip up; the sign follows the side), stall angle, parasitic CD0,
	// control: which input moves it and the CL change per radian of deflection
	surfaces: [
		{ name: 'wingL', pos: [ 3.6, 3.25, 0.6 ], area: 11.5, ar: 9.2, slope: 5.1, cl0: 0.32, incidence: 6 * DEG, dihedral: 2 * DEG, side: 1, stall: 15 * DEG, cd0: 0.012, control: 'aileron', dcl: 1.5 },
		{ name: 'wingR', pos: [ - 3.6, 3.25, 0.6 ], area: 11.5, ar: 9.2, slope: 5.1, cl0: 0.32, incidence: 6 * DEG, dihedral: 2 * DEG, side: - 1, stall: 15 * DEG, cd0: 0.012, control: 'aileron', dcl: - 1.5 },
		{ name: 'tail', pos: [ 0, 2.55, - 5.25 ], area: 4.6, ar: 4.5, slope: 4.2, cl0: 0, incidence: 5.5 * DEG, dihedral: 0, side: 0, stall: 18 * DEG, cd0: 0.012, control: 'elevator', dcl: - 2.4, slip: 0.75 },
		{ name: 'fin', pos: [ 0, 3.1, - 5.45 ], area: 2.4, ar: 1.7, slope: 3.0, cl0: 0, incidence: 0, dihedral: 0, side: 0, vertical: true, stall: 20 * DEG, cd0: 0.012, control: 'rudder', dcl: 2.0, slip: 0.6 },
	],
	deflection: { elevator: 22 * DEG, aileron: 16 * DEG, rudder: 25 * DEG },
	controlRate: 4.5, // 1/s: the surfaces follow the stick
	// fuselage + floats + struts: drag area (m^2, includes CD) at a point, and side area for sideslip
	dragArea: 1.45, dragPoint: [ 0, 1.3, 0.3 ], // (floats, struts, wires: a floatplane glides like a brick)
	sideArea: 5.5, sidePoint: [ 0, 1.6, - 1.2 ],
	// water
	buoyK: 0.85, // V-bottom fullness
	heaveDamp: 1800, heaveDamp2: 900, // per m^2 of section
	sideK: 700, sideK2: 260, // keel-like side resistance per m^2
	planing: 0.011, // planing lift coefficient on the forebody near the step
	waterRudder: { area: 0.16, slope: 3.0, max: 30 * DEG, z: - 3.8 }, // (bigger blades: the idle taxi is slower now and must still turn)
	// contact
	groundK: 260000, groundC: 26000, groundMu: 0.45,
	// wave 8: flaps (per full deflection, two notches: 1 = takeoff, 2 = landing), pitch trim, fuel
	flaps: { dcl: 0.62, cd0: 0.045, stallDrop: 3 * DEG, rate: 0.55 }, // rate: notches per second (the motor)
	trim: 0.32, // elevator travel at full trim
	fuelMinutes: 25, // at full power; the burn follows the rpm (idling lasts ~2 h)
	fuelIdle: 0.12, // share of the full-power burn at zero rpm
	crank: 0.06, // rpm while the starter turns the engine over
};

// wave 10: a sprung float (a rough landing) has water in it: less buoyancy (the plane lists to that side) and more drag
export const SPRUNG = { buoyancy: 0.3, drag: 0.08 };

// float sections: [ z, area factor (beam taper), keel rise ]
export const SECTIONS = [ [ 3.1, 0.5, 0.26 ], [ 2.3, 0.85, 0.08 ], [ 1.5, 1, 0 ], [ 0.7, 1, 0 ], [ - 0.1, 1, 0 ], [ - 0.9, 1, 0.07 ], [ - 1.7, 1, 0.16 ], [ - 2.5, 0.85, 0.26 ], [ - 3.3, 0.6, 0.36 ] ];
const SECTION_LEN = 0.8;
// parts that may not touch anything: [ name, x, y, z ] (Seaplane.js also tests them against ships and buildings)
export const STRIKE = [
	[ 'wingtip', 7.25, 3.25, 0.3 ], [ 'wingtip', - 7.25, 3.25, 0.3 ], [ 'propeller', 0, 0.95, 3.85 ], [ 'nose', 0, 2.2, 4.0 ],
	[ 'tail', 0, 1.95, - 6.4 ], [ 'fin', 0, 4.1, - 6.2 ], [ 'tailplane', 2.4, 2.55, - 5.6 ], [ 'tailplane', - 2.4, 2.55, - 5.6 ],
];
// float keel points against the ground
const KEELS = [];
for ( const x of [ GEOM.floatX, - GEOM.floatX ] ) KEELS.push( [ x, 0.3, 3.4 ], [ x, 0, 0.8 ], [ x, 0, - 0.3 ], [ x, 0.22, - 3.7 ] );
// the Jade's geometry in the per-spec form (wave 12: the other airframes carry their own, Airframes.js)
GEOM.floats = [ GEOM.floatX, - GEOM.floatX ].map( ( x ) => ( { x, side: Math.sign( x ), y0: 0, beam: GEOM.floatBeam, top: GEOM.floatTop, step: GEOM.step, fore: 2.0, len: SECTION_LEN, sections: SECTIONS, rudder: true } ) );
GEOM.keels = KEELS;
GEOM.strike = STRIKE;
GEOM.wheels = null;
GEOM.engines = [ SPEC.thrustPoint ];
GEOM.props = [ GEOM.prop ];
SPEC.geom = GEOM;

// hull resistance per newton carried by the water: rises to the hump at ~9 m/s, falls once on the step
export function waterResistance( u, hump = 1 ) {

	const a = Math.abs( u );
	return MathUtils.lerp( 0.02 + 0.2 * hump * sstep( a, 0, 9 ), 0.07, sstep( a, 9, 15 ) );

}

// section lift coefficient with a smooth stall into a flat plate (alpha in radians, any value)
export function liftCoefficient( alpha, s ) {

	const a = Math.atan2( Math.sin( alpha ), Math.cos( alpha ) );
	const lin = s.cl0 + s.slope * a;
	const flat = 1.05 * Math.sin( 2 * a );
	const t = sstep( Math.abs( a ), s.stall, s.stall + 0.12 );
	return lin * ( 1 - t ) + flat * t;

}

// scratch
const _F = new Vector3(), _T = new Vector3(), _com = new Vector3(), _invQ = new Quaternion(), _dq = new Quaternion();
const _vb = new Vector3(), _wb = new Vector3(), _r = new Vector3(), _vl = new Vector3(), _f = new Vector3(), _p = new Vector3();
const _n = new Vector3(), _c = new Vector3(), _a = new Vector3(), _t = new Vector3(), _fw = new Vector3(), _pw = new Vector3();
const _vp = new Vector3(), _up = new Vector3();
const _ws = {}; // a wing half's section with the flaps applied (scratch)
const _ff = new Vector3(), _wd = new Vector3(), _ws2 = new Vector3();

export class Flight {

	constructor( spec = SPEC ) {

		this.com = new Vector3();
		this.inertia = new Vector3();
		this.position = new Vector3(); // model origin, world
		this.quaternion = new Quaternion();
		this.velocity = new Vector3(); // centre of mass, world
		this.angular = new Vector3(); // world
		this.wind = new Vector3();
		this.controls = { throttle: 0, pitch: 0, roll: 0, yaw: 0, waterRudder: 0, trim: 0, brake: 0 };
		this.flaps = 0; // notch asked for (0..2)
		this.flapPos = 0; // where the flaps are (0..2, follows at spec.flaps.rate)
		this.fuel = 1;
		this.cranking = false;
		this.sprung = [ 0, 0 ]; // wave 10: a float sprung by a rough landing (port, starboard; 0..1): it carries less and drags
		this.wingAlpha = 0;
		this.stallMargin = 1;
		this.deflect = { elevator: 0, aileron: 0, rudder: 0 }; // -1..1, lagging the controls
		this.engineOn = true;
		this.rpm = 0;
		this.water = new Float32Array( 4 );
		this.waterV = new Float32Array( 4 );
		this.waterAge = 0;
		this.hasWater = true; // false: the caller has no heights yet (then sea level 0)
		this.groundAt = null;
		this.events = [];
		// outputs
		this.airspeed = 0;
		this.forwardSpeed = 0;
		this.alpha = 0;
		this.beta = 0;
		this.stall = 0;
		this.thrust = 0;
		this.slip = 0;
		this.wet = 0; // fraction of the float sections in the water
		this.onWater = false;
		this.grounded = false;
		this.airborne = false;
		this.airTime = 0;
		this.wetTime = 0;
		this.agl = 0; // height of the keel above the water / ground below
		this.load = 0; // fraction of the weight the water carries
		this._acc = 0;
		this._wasAir = false;
		this._struck = new Set();
		this.setSpec( spec );

	}

	// the airframe, its upgrades and its load (Airframes.js spec()): mass, inertia, surfaces, geometry; the state stays
	setSpec( spec = SPEC ) {

		this.spec = spec;
		this.geom = spec.geom || GEOM;
		this.mass = spec.mass;
		this.com.set( ...this.geom.com );
		this.inertia.set( ...spec.inertia );
		const n = ( this.geom.engines || [ spec.thrustPoint ] ).length;
		if ( ! this.engineFail || this.engineFail.length !== n ) this.engineFail = new Array( n ).fill( false );
		this.surfaces = spec.surfaces.map( ( s ) => this._surface( s ) );
		if ( this.flaps > this.notches ) this.flaps = this.notches;
		return this;

	}

	get notches() {

		return ( this.spec.flaps && this.spec.flaps.notches ) || 2;

	}

	_surface( s ) {

		// normal and chord in the model frame: incidence pitches the chord nose up, dihedral tilts the normal inboard
		const n = new Vector3( 0, 1, 0 ), c = new Vector3( 0, 0, 1 );
		if ( s.vertical ) n.set( 1, 0, 0 );
		else {

			n.set( 0, Math.cos( s.incidence ), - Math.sin( s.incidence ) );
			c.set( 0, Math.sin( s.incidence ), Math.cos( s.incidence ) );
			if ( s.dihedral ) n.applyAxisAngle( _t.set( 0, 0, 1 ), s.side * s.dihedral ).normalize();

		}

		return { ...s, p: new Vector3( ...s.pos ), n, c, alpha: 0, cl: 0 };

	}

	// at rest, afloat at the design draft, heading in the boatDock convention (0 = bow towards +z)
	place( x, z, heading = 0, y = - 0.2 ) {

		this.quaternion.setFromAxisAngle( _t.set( 0, 1, 0 ), heading );
		this.position.set( x, y, z );
		this.velocity.set( 0, 0, 0 );
		this.angular.set( 0, 0, 0 );
		this.rpm = 0;
		this.controls.throttle = 0;
		this.deflect.elevator = this.deflect.aileron = this.deflect.rudder = 0;
		this.events.length = 0;
		this._acc = 0;
		this.airborne = false;
		this._wasAir = false;
		this.airTime = 0;
		this.wetTime = 1;
		this._struck.clear();
		return this;

	}

	toWorld( local, out ) {

		return out.copy( local ).applyQuaternion( this.quaternion ).add( this.position );

	}

	toWorldXYZ( x, y, z, out ) {

		return out.set( x, y, z ).applyQuaternion( this.quaternion ).add( this.position );

	}

	// heading (boatDock convention: atan2 of the forward vector's x and z)
	heading() {

		const f = _t.set( 0, 0, 1 ).applyQuaternion( this.quaternion );
		return Math.atan2( f.x, f.z );

	}

	pitchAngle() {

		const f = _t.set( 0, 0, 1 ).applyQuaternion( this.quaternion );
		return Math.asin( clamp( f.y, - 1, 1 ) );

	}

	// bank: positive with the right (starboard) wing down
	rollAngle() {

		const s = _t.set( 1, 0, 0 ).applyQuaternion( this.quaternion ); // port wing direction
		return Math.asin( clamp( s.y, - 1, 1 ) );

	}

	// world xz of water probe i a little ahead along the velocity (lead: the read-back latency in seconds)
	probeWorld( i, out, lead = 0 ) {

		const [ x, z ] = this.geom.probes[ i ];
		return this.toWorldXYZ( x, 0, z, out ).addScaledVector( this.velocity, lead );

	}

	setWater( i, h, v = 0 ) {

		this.water[ i ] = h;
		this.waterV[ i ] = v;

	}

	resetWaterAge() {

		this.waterAge = 0;

	}

	// sea level under the plane (mean of the probes)
	seaLevel() {

		if ( ! this.hasWater ) return 0;
		const w = this.water, v = this.waterV, a = this.waterAge;
		return ( w[ 0 ] + w[ 1 ] + w[ 2 ] + w[ 3 ] + ( v[ 0 ] + v[ 1 ] + v[ 2 ] + v[ 3 ] ) * a ) * 0.25;

	}

	// water height under a float section: the float's bow and stern probes, linear along the float (side: 1 the port
	// probes, -1 the starboard ones, 0 a centre hull: their mean)
	_waterAtSection( side, z ) {

		if ( ! this.hasWater ) return 0;
		if ( side === 0 ) return ( this._waterAtSection( 1, z ) + this._waterAtSection( - 1, z ) ) * 0.5;
		const port = side === true || side > 0;
		const b = port ? 0 : 1, s = port ? 2 : 3;
		const a = this.waterAge;
		const hb = this.water[ b ] + this.waterV[ b ] * a, hs = this.water[ s ] + this.waterV[ s ] * a;
		const P = this.geom.probes;
		const zb = P[ b ][ 1 ], zs = P[ s ][ 1 ];
		const t = ( z - zs ) / ( zb - zs );
		return hs + ( hb - hs ) * t;

	}

	update( dt ) {

		const sp = this.spec, c = this.controls;
		dt = Math.min( dt, 0.1 );
		// fuel: the burn follows the rpm; an empty tank stops the engine
		if ( this.engineOn && sp.fuelMinutes ) {

			this.fuel = Math.max( 0, this.fuel - dt * ( sp.fuelIdle + ( 1 - sp.fuelIdle ) * this.rpm ) / ( sp.fuelMinutes * 60 ) );
			if ( this.fuel <= 0 ) {

				this.engineOn = false;
				this.events.push( { type: 'fuelOut' } );

			}

		}

		// engine spools after the lever (the starter only turns it over); the control surfaces follow the stick
		const lever = this.engineOn ? Math.max( clamp( c.throttle, 0, 1 ), sp.idle ) : this.cranking ? ( sp.crank || 0.06 ) : 0;
		const tau = lever > this.rpm ? sp.spoolUp : sp.spoolDown;
		this.rpm += ( lever - this.rpm ) * ( 1 - Math.exp( - dt / tau ) );
		// the flap motor runs at a steady pace towards the notch
		const fl = sp.flaps;
		if ( fl ) {

			const want = clamp( Math.round( this.flaps ), 0, fl.notches || 2 );
			this.flaps = want;
			const step = fl.rate * dt;
			this.flapPos += clamp( want - this.flapPos, - step, step );

		}

		const k = 1 - Math.exp( - dt * sp.controlRate );
		const d = this.deflect;
		// the trim offsets the elevator's rest position (positive: nose up)
		d.elevator += ( clamp( c.pitch + clamp( c.trim || 0, - 1, 1 ) * ( sp.trim || 0 ), - 1, 1 ) - d.elevator ) * k;
		d.aileron += ( clamp( c.roll, - 1, 1 ) - d.aileron ) * k;
		d.rudder += ( clamp( c.yaw, - 1, 1 ) - d.rudder ) * k;

		const h = 1 / 120;
		this._acc += dt;
		let n = 0;
		while ( this._acc >= h && n < 14 ) {

			this.step( h );
			this._acc -= h;
			n ++;

		}

		if ( ! this.isFinite() ) {

			this.events.push( { type: 'invalid' } );
			this.velocity.set( 0, 0, 0 );
			this.angular.set( 0, 0, 0 );
			if ( ! Number.isFinite( this.quaternion.w ) ) this.quaternion.identity();

		}

	}

	isFinite() {

		const ok = ( v ) => Number.isFinite( v.x ) && Number.isFinite( v.y ) && Number.isFinite( v.z );
		return ok( this.position ) && ok( this.velocity ) && ok( this.angular ) && Number.isFinite( this.quaternion.w ) && Number.isFinite( this.quaternion.x );

	}

	step( h ) {

		const sp = this.spec, m = this.mass;
		const F = _F.set( 0, - m * G, 0 );
		const T = _T.set( 0, 0, 0 );
		const comW = this.toWorld( this.com, _com );
		const q = this.quaternion;
		const invQ = _invQ.copy( q ).invert();
		this.waterAge = Math.min( this.waterAge + h, 0.15 );

		const addWorld = ( f, pw ) => {

			F.add( f );
			T.add( _r.copy( pw ).sub( comW ).cross( f ) );

		};

		// ---- air: body-frame velocity and rotation
		const vb = _vb.copy( this.velocity ).sub( this.wind ).applyQuaternion( invQ );
		const wb = _wb.copy( this.angular ).applyQuaternion( invQ );
		const V = vb.length();
		this.airspeed = V;
		this.forwardSpeed = vb.z;
		this.alpha = Math.atan2( - vb.y, Math.max( vb.z, 0.1 ) );
		this.beta = V > 0.5 ? Math.asin( clamp( vb.x / V, - 1, 1 ) ) : 0;

		// propeller: thrust from the rpm, falling off with forward speed; its slipstream over the tail
		const u = Math.max( vb.z, 0 );
		// (rpm ^ 1.5: a propeller's thrust grows faster than its speed; at idle it barely pulls, so a closed
		// throttle lets the plane settle on the water and bleeds speed in the air)
		// (a twin: each engine pulls its share at its nacelle; a failed one pulls nothing, so the other yaws the plane)
		const engines = this.geom.engines || [ sp.thrustPoint ];
		const each = sp.maxThrust * Math.pow( this.rpm, 1.5 ) * Math.max( 0.04, 1 - u / sp.pitchSpeed ) / engines.length;
		let thrust = 0;
		for ( let i = 0; i < engines.length; i ++ ) {

			if ( this.engineFail[ i ] ) continue;
			const tp = engines[ i ];
			thrust += each;
			_f.set( 0, 0, each ).applyQuaternion( q );
			addWorld( _f, this.toWorldXYZ( tp[ 0 ], tp[ 1 ], tp[ 2 ], _pw ) );

		}

		this.thrust = thrust;
		this.slip = Math.sqrt( u * u + 2 * thrust / ( RHO_AIR * sp.discArea ) ) - u;

		// lifting surfaces (the flaps add camber and drag to the wing halves and stall them a little earlier)
		const defl = sp.deflection, d = this.deflect;
		const flapK = sp.flaps ? this.flapPos / 2 : 0;
		let wingAlpha = 0;
		for ( const s0 of this.surfaces ) {

			let s = s0;
			if ( s0.side && flapK > 0 ) {

				const fl = sp.flaps;
				s = _ws;
				s.cl0 = s0.cl0 + fl.dcl * flapK;
				s.slope = s0.slope;
				s.stall = s0.stall - fl.stallDrop * flapK;
				s.cd0 = s0.cd0 + fl.cd0 * flapK;
				s.ar = s0.ar;
				s.p = s0.p; s.n = s0.n; s.c = s0.c; s.slip = s0.slip; s.control = s0.control; s.dcl = s0.dcl; s.side = s0.side; s.area = s0.area;

			}


			// local velocity of the surface through the air (body frame)
			_vl.copy( wb ).cross( _r.copy( s.p ).sub( this.com ) ).add( vb );
			if ( s.slip ) _vl.z += s.slip * this.slip;
			const vn = _vl.dot( s.n ), vc = _vl.dot( s.c );
			const v2 = vn * vn + vc * vc;
			if ( v2 < 0.01 ) continue;
			const alpha = Math.atan2( - vn, vc );
			let cl = liftCoefficient( alpha, s );
			// control deflection: a CL change that fades in the stall (flap effect) and with reversed flow
			const delta = s.control === 'elevator' ? d.elevator * defl.elevator : s.control === 'aileron' ? d.aileron * defl.aileron : d.rudder * defl.rudder;
			cl += s.dcl * delta * ( 1 - sstep( Math.abs( alpha ), s.stall + 0.05, s.stall + 0.3 ) ) * ( vc > 0 ? 1 : 0.2 );
			const stalled = sstep( Math.abs( alpha ), s.stall, s.stall + 0.12 );
			const cd = s.cd0 + ( cl * cl / ( Math.PI * 0.78 * s.ar ) ) * ( 1 - stalled ) + 1.2 * Math.sin( alpha ) ** 2 * stalled + Math.abs( delta ) * 0.05;
			s0.alpha = alpha;
			s0.cl = cl;
			if ( s.side ) wingAlpha += alpha * 0.5;
			const vlen = Math.sqrt( v2 );
			const qS = 0.5 * RHO_AIR * v2 * s.area;
			// lift perpendicular to the in-plane flow (towards +n for positive alpha), drag against it
			_a.copy( s.n ).multiplyScalar( vc ).addScaledVector( s.c, - vn ).divideScalar( vlen );
			_f.copy( s.c ).multiplyScalar( - vc ).addScaledVector( s.n, - vn ).divideScalar( vlen );
			// the flaps' extra lift acts over the centre of mass' station: more lift and drag, no pitch-up balloon
			const dclF = s === s0 ? 0 : sp.flaps.dcl * flapK * ( 1 - stalled );
			_f.multiplyScalar( qS * cd ).addScaledVector( _a, qS * ( cl - dclF ) );
			// a stalled wing half drops (asymmetric buffet)
			addWorld( _f.applyQuaternion( q ), this.toWorld( s.p, _pw ) );
			if ( dclF ) addWorld( _ff.copy( _a ).multiplyScalar( qS * dclF ).applyQuaternion( q ), this.toWorldXYZ( s.p.x, s.p.y, this.com.z - 0.05, _pw ) );

		}

		const ws = this.surfaces[ 0 ];
		const wStall = ws.stall - ( sp.flaps ? sp.flaps.stallDrop * flapK : 0 );
		this.stall = V > 6 ? sstep( wingAlpha, wStall - 0.07, wStall + 0.04 ) : 0;
		this.wingAlpha = wingAlpha;
		this.stallMargin = wStall - wingAlpha;
		// fuselage, floats and struts: parasitic drag and side force
		if ( V > 0.05 ) {

			_f.copy( vb ).multiplyScalar( - 0.5 * RHO_AIR * sp.dragArea * V ).applyQuaternion( q );
			addWorld( _f, this.toWorldXYZ( sp.dragPoint[ 0 ], sp.dragPoint[ 1 ], sp.dragPoint[ 2 ], _pw ) );
			_f.set( - 0.5 * RHO_AIR * 0.9 * sp.sideArea * vb.x * Math.abs( vb.x ), 0, 0 ).applyQuaternion( q );
			addWorld( _f, this.toWorldXYZ( sp.sidePoint[ 0 ], sp.sidePoint[ 1 ], sp.sidePoint[ 2 ], _pw ) );

		}

		// ---- water: float sections
		const fwd = _fw.set( 0, 0, 1 ).applyQuaternion( q );
		const side = _up.set( 1, 0, 0 ).applyQuaternion( q );
		const trim = Math.asin( clamp( fwd.y, - 1, 1 ) );
		let wetN = 0, buoySum = 0, lowest = Infinity, totalN = 0;
		const C = waterResistance( this.forwardSpeed, sp.humpDrag ?? 1 );
		// a bad attitude on the step digs in (bow down) or drags the heels (bow high)
		const attitude = sstep( Math.abs( this.forwardSpeed ), 8, 13 ) * ( Math.max( 0, - 1 * DEG - trim ) + Math.max( 0, trim - 9 * DEG ) ) / DEG * 0.025;
		for ( const FL of this.geom.floats ) {

			const x = FL.x, y0 = FL.y0 || 0, sd = FL.side;
			const area0 = FL.beam * ( FL.len || SECTION_LEN );
			totalN += FL.sections.length;
			for ( const [ z, af, rise0 ] of FL.sections ) {

				const rise = rise0 + y0;
				const pw = this.toWorldXYZ( x, rise, z, _pw );
				const hw = this._waterAtSection( sd, z );
				const depth = hw - pw.y;
				lowest = Math.min( lowest, - depth );
				if ( depth <= 0 ) continue;
				const sub = Math.min( depth, FL.top - rise );
				if ( sub <= 0 ) continue;
				const A = area0 * af;
				wetN ++;
				// velocity of the section (world) relative to the water's own heave
				_vp.copy( this.angular ).cross( _r.copy( pw ).sub( comW ) ).add( this.velocity );
				const vy = _vp.y - this.waterV[ sd < 0 ? 1 : 0 ] * 0.5;
				const wetK = Math.min( 1, sub / 0.15 ) * A;
				const leak = sd > 0 ? this.sprung[ 0 ] || 0 : sd < 0 ? this.sprung[ 1 ] || 0 : Math.max( this.sprung[ 0 ], this.sprung[ 1 ] ) * 0.5;
				const fb = RHO_W * G * A * sub * sp.buoyK * ( 1 - SPRUNG.buoyancy * leak );
				buoySum += fb;
				const ul = _vp.dot( fwd ), vs = _vp.dot( side );
				_f.set( 0, fb - ( sp.heaveDamp * vy + sp.heaveDamp2 * vy * Math.abs( vy ) ) * wetK, 0 );
				// planing lift on the forebody ahead of the step (pushes the floats up onto the step)
				if ( z > FL.step && z < ( FL.fore ?? 2.0 ) && ul > 3 ) {

					const pl = RHO_W * ul * ul * A * sp.planing * Math.min( 1, sub / 0.12 );
					_f.y += pl;
					_f.addScaledVector( fwd, - pl * 0.09 );

				}

				// resistance along the float (weight carried x C(u) + attitude), keel-like side resistance
				const R = ( C + attitude + SPRUNG.drag * leak ) * fb + 2.0 * ul * Math.abs( ul ) * A * ( wetK / A );
				_f.addScaledVector( fwd, - R * Math.sign( ul ) * Math.min( 1, Math.abs( ul ) / 0.4 ) );
				_f.addScaledVector( side, - ( sp.sideK * vs + sp.sideK2 * vs * Math.abs( vs ) ) * wetK );
				addWorld( _f, pw );

			}

			// water rudder at the float's heel: steers while taxiing, fades as the floats get up to speed
			if ( ! FL.rudder ) continue;
			const wr = sp.waterRudder;
			const pr = this.toWorldXYZ( x, 0.05 + y0, wr.z, _pw );
			const dw = this._waterAtSection( sd, wr.z ) - pr.y;
			if ( dw > 0 ) {

				_vp.copy( this.angular ).cross( _r.copy( pr ).sub( comW ) ).add( this.velocity );
				const ul = _vp.dot( fwd );
				const eff = 1 - 0.75 * sstep( Math.abs( ul ), 7, 14 );
				const delta = clamp( this.controls.waterRudder, - 1, 1 ) * wr.max;
				const lat = 0.5 * RHO_W * wr.area * ul * Math.abs( ul ) * wr.slope * Math.sin( delta ) * eff * Math.min( 1, dw / 0.15 );
				addWorld( _f.copy( side ).multiplyScalar( lat ), pr );

			}

		}

		this.wet = totalN ? wetN / totalN : 0;
		this.load = buoySum / ( m * G );

		// ---- ground: the float keels slide on sand; strikes of the other parts are reported
		let grounded = false;
		if ( this.groundAt ) {

			// wave 12: a land plane's wheels (tricycle: the nose wheel steers, the mains brake)
			if ( this.geom.wheels ) grounded = this._wheels( comW, addWorld ) || grounded;
			for ( const [ x, y, z ] of this.geom.keels ) {

				const pw = this.toWorldXYZ( x, y, z, _pw );
				const g = this.groundAt( pw.x, pw.z );
				const pen = g - pw.y;
				if ( pen <= 0 ) continue;
				grounded = true;
				_vp.copy( this.angular ).cross( _r.copy( pw ).sub( comW ) ).add( this.velocity );
				const fn = Math.max( 0, pen * sp.groundK - Math.min( _vp.y, 0 ) * sp.groundC );
				const vh = Math.hypot( _vp.x, _vp.z );
				const fr = vh > 1e-3 ? Math.min( sp.groundMu * fn, vh * 4000 ) / vh : 0;
				_f.set( - _vp.x * fr, fn, - _vp.z * fr );
				addWorld( _f, pw );
				const impact = Math.max( - _vp.y, 0 );
				if ( ( vh > 6 || impact > 4 ) && ! this._struck.has( 'keel' ) ) {

					this._struck.add( 'keel' );
					this.events.push( { type: 'strike', part: 'float', surface: 'ground', speed: Math.max( vh, impact ), sink: impact, nose: this.noseFirst(), side: Math.sign( x ) } );

				}

			}

			for ( const [ part, x, y, z ] of this.geom.strike ) {

				const pw = this.toWorldXYZ( x, y, z, _pw );
				const g = this.groundAt( pw.x, pw.z );
				if ( pw.y < g && ! this._struck.has( part ) ) {

					this._struck.add( part );
					this.events.push( { type: 'strike', part, surface: 'ground', speed: this.velocity.length(), sink: this._sinkAt( pw, comW ), nose: this.noseFirst(), side: Math.sign( x ) } );

				}

			}

		}

		// the other parts in the water at speed (a wingtip dug in, the propeller, a nose-in). The water at the part itself
		// (the probes' line through its z: the nose pitching into a trough meets lower water there, not the mean under
		// the floats), with a margin for the probes' sampling (the Petrel's propeller rides 0.4 m over the water at the
		// hump: against the mean of the probes a 15 cm swell "dug it in")
		const sea = this.seaLevel();
		for ( const [ part, x, y, z ] of this.geom.strike ) {

			const pw = this.toWorldXYZ( x, y, z, _pw );
			const there = this._waterAtSection( 0, z );
			if ( pw.y < there - 0.15 && this.velocity.length() > 4 && ! this._struck.has( part + 'W' ) ) {

				this._struck.add( part + 'W' );
				this.events.push( { type: 'strike', part, surface: 'water', speed: this.velocity.length(), sink: this._sinkAt( pw, comW ), nose: this.noseFirst(), side: Math.sign( x ) } );

			}

		}

		this.grounded = grounded;
		this.onWater = wetN > 0;
		this.agl = lowest === Infinity ? 0 : lowest;
		if ( this.groundAt ) {

			const g = this.groundAt( comW.x, comW.z );
			if ( g > sea ) this.agl = Math.min( this.agl, comW.y - this.com.y - g );

		}

		// ---- airborne / touchdown bookkeeping
		const contact = wetN > 0 || grounded;
		if ( contact ) {

			if ( this._wasAir && this.airTime > 0.6 ) {

				this.events.push( { type: 'touch', surface: wetN > 0 ? 'water' : 'ground', sink: Math.max( 0, - this.velocity.y ), speed: this.forwardSpeed, pitch: trim / DEG, roll: this.rollAngle() / DEG } );

			}

			this.airTime = 0;
			this.wetTime += h;
			this._wasAir = false;
			if ( this.airborne && this.wetTime > 0.2 ) this.airborne = false;

		} else {

			this.airTime += h;
			this.wetTime = 0;
			if ( this.airTime > 0.25 ) {

				if ( ! this.airborne ) this.events.push( { type: 'liftoff', speed: this.forwardSpeed } );
				this.airborne = true;
				this._wasAir = true;

			}

		}

		// ---- integrate (semi-implicit Euler); water adds a little mass while the floats are in
		const added = 1 + 0.15 * this.wet;
		this.velocity.addScaledVector( F, h / ( m * added ) );
		const tb = T.applyQuaternion( invQ );
		const I = this.inertia;
		// Euler's equations in the body frame: I dw = tau - w x (I w)
		_c.set( wb.x * I.x, wb.y * I.y, wb.z * I.z );
		_n.copy( wb ).cross( _c );
		tb.sub( _n );
		tb.set( tb.x / ( I.x * added ), tb.y / ( I.y * added ), tb.z / ( I.z * added ) );
		this.angular.addScaledVector( tb.applyQuaternion( q ), h );
		comW.addScaledVector( this.velocity, h );
		const w = this.angular;
		const ang = w.length() * h;
		if ( ang > 1e-9 ) {

			_dq.setFromAxisAngle( _t.copy( w ).normalize(), ang );
			this.quaternion.premultiply( _dq ).normalize();

		}

		this.position.copy( comW ).sub( _t.copy( this.com ).applyQuaternion( this.quaternion ) );

	}

	// the wheels on the ground (a land plane): a stiff damped strut per wheel, rolling resistance along the wheel's
	// heading (the brakes on the mains), side grip across it up to the tyre's friction; true while any wheel touches
	_wheels( comW, addWorld ) {

		const sp = this.spec, c = this.controls, q = this.quaternion;
		const K = sp.gearK || 90000, D = sp.gearC || 9000;
		let any = false;
		for ( const w of this.geom.wheels ) {

			const pw = this.toWorldXYZ( w.x, w.y, w.z, _pw );
			const g = this.groundAt( pw.x, pw.z );
			const pen = g - pw.y;
			if ( pen <= 0 ) continue;
			any = true;
			_vp.copy( this.angular ).cross( _r.copy( pw ).sub( comW ) ).add( this.velocity );
			const fn = Math.max( 0, Math.min( pen, 0.5 ) * K - _vp.y * D );
			// the wheel's rolling direction: the body's forward, the nose wheel turned by the steering (+: to starboard)
			const steer = w.steer ? clamp( c.waterRudder || 0, - 1, 1 ) * - ( sp.noseSteer || 0.45 ) : 0;
			_wd.set( Math.sin( steer ), 0, Math.cos( steer ) ).applyQuaternion( q );
			_wd.y = 0;
			_wd.normalize();
			_ws2.set( _wd.z, 0, - _wd.x );
			const ul = _vp.x * _wd.x + _vp.z * _wd.z, vs = _vp.x * _ws2.x + _vp.z * _ws2.z;
			const roll = ( sp.rollMu || 0.025 ) + ( w.brake ? clamp( c.brake || 0, 0, 1 ) * ( sp.brakeMu || 0.55 ) : 0 );
			const fl = - Math.sign( ul ) * Math.min( 1, Math.abs( ul ) / 0.3 ) * roll * fn;
			const fs = - clamp( vs * 6000, - 0.8 * fn, 0.8 * fn );
			_f.set( _wd.x * fl + _ws2.x * fs, fn, _wd.z * fl + _ws2.z * fs );
			addWorld( _f, pw );

		}

		return any;

	}

	// how much of the motion is along the nose (1: straight ahead, 0: sideways / flat, < 0: backwards): Crash.js's
	// "nose first" for a direct collision
	noseFirst() {

		const v = this.velocity.length();
		if ( v < 0.1 ) return 0;
		return _t.set( 0, 0, 1 ).applyQuaternion( this.quaternion ).dot( this.velocity ) / v;

	}

	// the downward speed of a world point of the body (its closing speed with the water / the ground below)
	_sinkAt( pw, comW ) {

		_vp.copy( this.angular ).cross( _r.copy( pw ).sub( comW ) ).add( this.velocity );
		return Math.max( 0, - _vp.y );

	}

	// clear the per-part strike memory (after the caller dealt with a strike / a reset)
	clearStrikes() {

		this._struck.clear();

	}

	drainEvents() {

		const e = this.events.slice();
		this.events.length = 0;
		return e;

	}

}

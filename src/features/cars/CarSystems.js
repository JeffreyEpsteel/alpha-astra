// Local driver's controls and automatic drivetrain readout. No economy, fuel or remote-car authority is added.
const clamp = ( n, lo, hi ) => Math.max( lo, Math.min( hi, n ) );
export const GEARS = [ 3.2, 2.1, 1.5, 1.14, 0.92, 0.76 ];

export function drivetrain( record, input = record?.body?.input || {} ) {

	if ( ! record ) return { engineOn: false, gear: '—', gearIndex: 0, rpm: 0 };
	const speed = record.body?.speed || 0, spec = record.spec;
	const engineOn = record.engineOn !== false && record.stage < 4 && record.hp > 0;
	const reversing = speed < - 0.2 || speed < 0.4 && input.brake > 0 && ! input.throttle;
	const gearIndex = reversing ? - 1 : Math.min( 6, 1 + Math.floor( Math.abs( speed ) / spec.top * 5.8 ) );
	const ratio = reversing ? 3 : GEARS[ gearIndex - 1 ];
	const wheelRPM = Math.abs( speed ) / ( 2 * Math.PI * spec.r ) * 60;
	const rpm = engineOn ? clamp( 780 + wheelRPM * ratio * 3.4 + ( input.throttle || 0 ) * 450, 780, 6500 ) : 0;
	return { engineOn, gearIndex, gear: record.parkBrake && Math.abs( speed ) < 0.3 ? 'P' : ! engineOn ? 'N' : reversing ? 'R' : 'D' + gearIndex, rpm };

}

export function carPanelSnapshot( cars, hover = null ) {

	const r = cars.drive, b = r?.body, d = drivetrain( r );
	return {
		...d, name: r?.spec.name || 'Car', kind: r?.kind || 'sedan', speed: Math.abs( b?.speed || 0 ) * 3.6,
		top: ( r?.spec.top || 44 ) * 3.6, hp: r ? clamp( r.hp / r.maxHp * 100, 0, 100 ) : 0,
		steer: b?.steer || 0, brake: !! ( b?.input.brake > 0 || b?.input.handbrake ), parkBrake: !! r?.parkBrake,
		throttle: b?.input.throttle || 0, lights: !! r?.lights, lightMode: cars.lightsOn === null ? 'AUTO' : cars.lightsOn ? 'ON' : 'OFF',
		horn: !! cars._horn, siren: r?.kind === 'police' && cars.siren, wanted: cars.policeLevel(),
		grounded: b?.grounded !== false, hover,
	};

}

export function carControl( cars, id ) {

	const r = cars.drive;
	if ( ! r || r.state !== 'player' ) return { ok: false, reason: 'not-driving' };
	const a = cars.app;
	if ( a.paused || a.menuOpen || a.input?.enabled === false || a.game?.guide?.open ) return { ok: false, reason: 'blocked' };
	if ( id === 'engine' ) {

		if ( r.stage >= 4 || r.hp <= 0 ) return { ok: false, reason: 'wreck' };
		if ( Math.abs( r.body?.speed || 0 ) > 0.8 ) return { ok: false, reason: 'Stop before switching the engine' };
		r.engineOn = r.engineOn === false;
		return { ok: true, engineOn: r.engineOn };

	}
	if ( id === 'lights' ) { cars.toggleLights(); return { ok: true }; }
	if ( id === 'park' ) { r.parkBrake = ! r.parkBrake; return { ok: true }; }
	if ( id === 'horn' ) { cars._hornPulse = 0.35; return { ok: true }; }
	if ( id === 'siren' && r.kind === 'police' ) { cars.toggleSiren(); return { ok: true }; }
	return { ok: false, reason: 'unknown' };

}

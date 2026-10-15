// The seven harbour roles of the naval fork (docs/WORLD_TRADE_PIRATES_BRIEF.md A5: fishermen, merchants,
// dockworkers, tavern, children, smuggler, guard) and the daily schedules of the island clock
// (HarbourLifeActor FHarbourScheduleWindow: hour windows, each an activity). Plain data, no engine.
//
//   ROLES[ id ]       { label, schedule, work: { base, gestures } (the default work look), makes (what one
//                       finished craft loop adds to the port's shelf), eat, tavern (goes to the tavern in the evening) }
//   SCHEDULES[ id ]   [ [ fromHour, toHour, activity ], ... ] covering 0-24 without gaps
//   activityAt( schedule, hour ) -> activity
//
// Activities: sleep (home, indoors), wake (outside the home door), work (the resident's own spot / patrol, or
// its work loop stations), eat (the plaza; at another port, near its stand), tavern (the patio, or inside),
// play (children: their own spot / patrol, else the plaza), watch (smugglers: the harbour mouth), loiter
// (smugglers by day: the plaza or the patio).

export const ROLE_IDS = [ 'fisher', 'merchant', 'dockworker', 'tavern', 'child', 'smuggler', 'guard' ];

export const SCHEDULES = {
	fisher: [ [ 0, 4.5, 'sleep' ], [ 4.5, 11.5, 'work' ], [ 11.5, 12.5, 'eat' ], [ 12.5, 17, 'work' ], [ 17, 21, 'tavern' ], [ 21, 24, 'sleep' ] ],
	nightFisher: [ [ 0, 3, 'work' ], [ 3, 11, 'sleep' ], [ 11, 12.5, 'eat' ], [ 12.5, 17.5, 'wake' ], [ 17.5, 24, 'work' ] ],
	merchant: [ [ 0, 7, 'sleep' ], [ 7, 8, 'wake' ], [ 8, 12, 'work' ], [ 12, 13, 'eat' ], [ 13, 18, 'work' ], [ 18, 21.5, 'tavern' ], [ 21.5, 24, 'sleep' ] ],
	dockworker: [ [ 0, 6, 'sleep' ], [ 6, 12, 'work' ], [ 12, 13, 'eat' ], [ 13, 17.5, 'work' ], [ 17.5, 21, 'tavern' ], [ 21, 24, 'sleep' ] ],
	tavern: [ [ 0, 1, 'tavern' ], [ 1, 9, 'sleep' ], [ 9, 12, 'work' ], [ 12, 13, 'eat' ], [ 13, 18, 'work' ], [ 18, 24, 'tavern' ] ],
	innkeeper: [ [ 0, 1.5, 'work' ], [ 1.5, 9.5, 'sleep' ], [ 9.5, 24, 'work' ] ],
	child: [ [ 0, 7.5, 'sleep' ], [ 7.5, 12, 'play' ], [ 12, 13, 'eat' ], [ 13, 19, 'play' ], [ 19, 20, 'wake' ], [ 20, 24, 'sleep' ] ],
	smuggler: [ [ 0, 4, 'watch' ], [ 4, 11, 'sleep' ], [ 11, 12, 'eat' ], [ 12, 20, 'loiter' ], [ 20, 24, 'watch' ] ],
	// the clown keeps his prank spot through the day (a smuggler's night, a late riser's morning)
	prankster: [ [ 0, 2, 'watch' ], [ 2, 8.5, 'sleep' ], [ 8.5, 21, 'loiter' ], [ 21, 24, 'tavern' ] ],
	guard: [ [ 0, 6, 'sleep' ], [ 6, 13, 'work' ], [ 13, 14, 'eat' ], [ 14, 22, 'work' ], [ 22, 24, 'sleep' ] ],
};

export const ROLES = {
	fisher: { label: 'Fisherman', schedule: 'fisher', work: { base: 'Fishing_Hold', gestures: [ 'Fishing_Reel', 'Inspect_Catch', 'Look_Around' ] }, makes: 'bait' },
	merchant: { label: 'Merchant', schedule: 'merchant', work: { base: 'Talk', gestures: [ 'Point', 'Shrug', 'Inspect_Catch' ] }, makes: 'coin' },
	dockworker: { label: 'Dockworker', schedule: 'dockworker', work: { base: 'Idle_Breathe', gestures: [ 'Sweep_Work', 'Inspect_Catch', 'Shrug' ] }, makes: 'rope' },
	tavern: { label: 'Tavern regular', schedule: 'tavern', work: { base: 'Chat_Gesture', gestures: [ 'Laugh', 'Point', 'Shrug' ] }, makes: null },
	child: { label: 'Harbour kid', schedule: 'child', work: { base: 'Idle_Breathe', gestures: [ 'Dance', 'Cheer_Clap', 'Point', 'Friendly_Wave' ] }, makes: null },
	smuggler: { label: 'Smuggler', schedule: 'smuggler', work: { base: 'Idle_Breathe', gestures: [ 'Look_Around', 'Shrug', 'Swagger_Idle' ] }, makes: null },
	guard: { label: 'Harbour watch', schedule: 'guard', work: { base: 'Idle_Breathe', gestures: [ 'Look_Around', 'Point' ] }, makes: null },
};

// activities with these looks when the resident has no station of its own for them
export const ACTIVITY_LOOK = {
	wake: { base: 'Idle_Breathe', gestures: [ 'Look_Around', 'Shrug', 'Friendly_Wave' ] },
	eat: { base: 'Idle_Breathe', gestures: [ 'Chat_Gesture', 'Laugh', 'Shrug' ] },
	tavern: { base: 'Chat_Gesture', gestures: [ 'Laugh', 'Cheer_Clap', 'Chat_Gesture', 'Point' ] },
	loiter: { base: 'Swagger_Idle', gestures: [ 'Look_Around', 'Shrug' ] },
	watch: { base: 'Idle_Breathe', gestures: [ 'Look_Around', 'Point' ] },
	play: { base: 'Idle_Breathe', gestures: [ 'Dance', 'Cheer_Clap', 'Point' ] },
};

export function scheduleOf( data ) {

	const id = ( data && data.schedule ) || ( data && ROLES[ data.role ] && ROLES[ data.role ].schedule ) || null;
	return id && SCHEDULES[ id ] ? SCHEDULES[ id ] : null;

}

export function activityAt( schedule, hour ) {

	if ( ! schedule || ! schedule.length ) return 'work';
	const h = ( ( Number.isFinite( hour ) ? hour : 12 ) % 24 + 24 ) % 24;
	for ( const [ a, b, act ] of schedule ) if ( h >= a && h < b ) return act;
	return schedule[ schedule.length - 1 ][ 2 ];

}

// the hour the current activity started and the next one begins (for "opens at 07:00" style notes)
export function nextChange( schedule, hour, activity ) {

	if ( ! schedule ) return null;
	const h = ( ( hour % 24 ) + 24 ) % 24;
	for ( let k = 0; k < schedule.length * 2; k ++ ) {

		const [ a, , act ] = schedule[ k % schedule.length ];
		const at = a + ( k >= schedule.length ? 24 : 0 );
		if ( at > h && act === activity ) return at % 24;

	}

	return null;

}

// a schedule covers the whole day in order, with known activities
export function validSchedule( s ) {

	const known = new Set( [ 'sleep', 'wake', 'work', 'eat', 'tavern', 'play', 'watch', 'loiter' ] );
	if ( ! Array.isArray( s ) || ! s.length || s[ 0 ][ 0 ] !== 0 || s[ s.length - 1 ][ 1 ] !== 24 ) return false;
	for ( let i = 0; i < s.length; i ++ ) {

		const [ a, b, act ] = s[ i ];
		if ( ! ( b > a ) || ! known.has( act ) ) return false;
		if ( i > 0 && s[ i - 1 ][ 1 ] !== a ) return false;

	}

	return true;

}

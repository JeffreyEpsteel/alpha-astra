// Plain-node test of wave 22A, the phone's driving cluster (src/ui/TouchControls.js carLayout and the car mode), no browser:
//   layout     at 390x844 and 844x390 (and 1280x720), touch sizes 0.75 / 1 / 1.4: every target >= 44 px, on screen, no two
//              overlapping, the pedals under the right thumb, the slider under the left, Exit away from the gas
//   behaviour  on a small stand-in DOM: hidden on foot and at the helm, shown while driving (the stick, the lever and the action
//              buttons stand down); the pedals, the slider (springs back), Handbrake and Horn write cars.touch; Exit sends E;
//              Siren only in a police car; Tilt steers from the phone's attitude (calibrated where it is held); out of the car
//              the cluster goes and cars.touch is let go
//   captures   --shots=<dir> draws the cluster over a game capture (--bg=<png>) at 390x844 and 844x390 (System.Drawing)
//   node test/feature-cars-touch.mjs [--shots=<dir>] [--bg=<png>]
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

let fails = 0, passes = 0;
const ok = ( c, msg, extra = '' ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg, extra ); } else { passes ++; console.log( 'ok  ', msg, extra ); }

};
const section = ( s ) => console.log( '\n== ' + s );
const arg = ( k, d = null ) => {

	const a = process.argv.find( ( x ) => x.startsWith( '--' + k + '=' ) );
	return a ? a.slice( k.length + 3 ) : d;

};

// ---------------------------------------------------------------- a small stand-in DOM (what TouchControls touches)
const keyEvents = [];
class El {

	constructor( tag ) {

		this.tagName = String( tag ).toUpperCase();
		this.className = '';
		this.children = [];
		this.dataset = {};
		this.attrs = {};
		this.hidden = false;
		this._html = '';
		this._q = new Map();
		this.listeners = {};
		this.textContent = '';
		const st = {};
		st.setProperty = ( k, v ) => { st[ k ] = String( v ); };
		st.removeProperty = ( k ) => { delete st[ k ]; };
		this.style = st;
		const cls = new Set();
		this.classList = {
			add: ( ...c ) => c.forEach( ( x ) => cls.add( x ) ), remove: ( ...c ) => c.forEach( ( x ) => cls.delete( x ) ),
			toggle: ( c, on ) => { const v = on === undefined ? ! cls.has( c ) : !! on; if ( v ) cls.add( c ); else cls.delete( c ); return v; },
			contains: ( c ) => cls.has( c ) || this.className.split( /\s+/ ).includes( c ),
		};
		this.rect = { left: 0, top: 0, width: 100, height: 40 };

	}

	set innerHTML( v ) { this._html = v; this._q.clear(); }
	get innerHTML() { return this._html; }
	get firstChild() { return this._q.get( ':first' ) || ( this._q.set( ':first', new El( 'span' ) ), this._q.get( ':first' ) ); }
	append( ...c ) { for ( const x of c ) { x.parentNode = this; this.children.push( x ); } }
	remove() {}
	setAttribute( k, v ) { this.attrs[ k ] = String( v ); }
	getAttribute( k ) { return this.attrs[ k ]; }
	addEventListener( type, fn ) { ( this.listeners[ type ] || ( this.listeners[ type ] = [] ) ).push( fn ); }
	removeEventListener() {}
	dispatchEvent( e ) { if ( e && e.code ) keyEvents.push( { type: e.type, code: e.code } ); return true; }
	querySelector( sel ) { if ( ! this._q.has( sel ) ) this._q.set( sel, new El( 'span' ) ); return this._q.get( sel ); }
	querySelectorAll() { return []; }
	closest( sel ) { const c = sel.split( ',' ).map( ( s ) => s.trim().replace( /^\./, '' ) ); return c.some( ( x ) => this.classList.contains( x ) ) ? this : null; }
	setPointerCapture() {}
	getBoundingClientRect() { const r = this.rect; return { ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top }; }

}

const win = { innerWidth: 844, innerHeight: 390, listeners: {}, addEventListener( t, f ) { ( this.listeners[ t ] || ( this.listeners[ t ] = [] ) ).push( f ); }, removeEventListener( t, f ) { const l = this.listeners[ t ]; if ( l ) l.splice( l.indexOf( f ), 1 ); } };
globalThis.window = win;
globalThis.document = { createElement: ( t ) => new El( t ), body: new El( 'body' ), head: new El( 'head' ), documentElement: new El( 'html' ) };
globalThis.KeyboardEvent = class { constructor( type, o ) { this.type = type; Object.assign( this, o ); } };
globalThis.screen = { orientation: { angle: 90 } };

const { TouchControls, carLayout, wheelSteer, tiltSteer, CAR_IDS } = await import( '../src/ui/TouchControls.js' );

// ---------------------------------------------------------------- layout
section( 'layout: thumb reach, 44 px targets, nothing on top of anything' );
const SIZES = [ [ 390, 844 ], [ 844, 390 ], [ 1280, 720 ] ];
const overlap = ( a, b ) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
for ( const [ W, H ] of SIZES ) for ( const k of [ 0.75, 1, 1.4 ] ) {

	const L = carLayout( W, H, { k } );
	const boxes = CAR_IDS.map( ( id ) => L[ id ].rect );
	const small = CAR_IDS.filter( ( id ) => L[ id ].rect.w < 44 || L[ id ].rect.h < 44 );
	const off = CAR_IDS.filter( ( id ) => { const r = L[ id ].rect; return r.x < 0 || r.y < 0 || r.x + r.w > W || r.y + r.h > H; } );
	let hits = 0;
	for ( let i = 0; i < boxes.length; i ++ ) for ( let j = i + 1; j < boxes.length; j ++ ) if ( overlap( boxes[ i ], boxes[ j ] ) ) hits ++;
	const g = L.gas.rect, w = L.wheel.rect, e = L.exit.rect;
	const thumbs = g.x > W * 0.6 && g.y + g.h > H - 40 && w.x < W * 0.12 && w.y + w.h > H - 40;
	const exitAway = e.y + e.h < g.y && e.y >= 64; // (above the gas, under the top-right row)
	ok( ! small.length && ! off.length && ! hits && thumbs && exitAway, `${ W }x${ H } at size ${ k }`,
		`(smallest ${ Math.round( Math.min( ...boxes.map( ( b ) => Math.min( b.w, b.h ) ) ) ) } px; slider ${ Math.round( w.w ) } px${ small.length ? ' small: ' + small : '' }${ off.length ? ' off: ' + off : '' }${ hits ? ' overlaps ' + hits : '' })` );

}

ok( wheelSteer( - 60, 60 ) === 1 && wheelSteer( 60, 60 ) === - 1 && wheelSteer( 2, 60 ) === 0 && Math.abs( wheelSteer( - 30, 60 ) - 0.5 ) < 1e-9, 'the slider: left is +1 (the A key), right -1, a small dead zone' );
ok( tiltSteer( { beta: - 12 }, 90 ) === 0.5 && tiltSteer( { beta: 12 }, 270 ) === 0.5 && tiltSteer( { beta: - 1 }, 90 ) === 0 && tiltSteer( { beta: - 60 }, 90 ) === 1 && tiltSteer( { beta: - 32 }, 90, 20 ) === 0.5,
	'tilt: the long axis in landscape (either way round), clamped, a dead zone, from where it was held' );

// ---------------------------------------------------------------- behaviour
section( 'behaviour: only while driving; the pedals, the slider, the buttons write cars.touch' );
const cars = { driving: false, drive: null, siren: false, touch: { active: false, steer: 0, throttle: 0, brake: 0, handbrake: false, horn: false }, toggleSiren() { this.siren = ! this.siren; return this.siren; } };
const toasts = [];
const app = {
	player: { mode: 'walk' }, game: { state: {} }, features: { get: ( n ) => ( n === 'cars' ? cars : null ), panelOpen: () => false },
	input: { touchMode: false, setTouchKeys( k ) { this.keys = k; }, addTouchLook() {}, setTouchButton() {}, releaseTouch() {}, physicalFor: ( c ) => c },
};
const tc = new TouchControls( { app, ui: { toast: ( t ) => toasts.push( t ) }, device: { coarse: true, phone: true }, storage: { getItem: () => null, setItem() {} } } );
tc.set( 'mode', 'on' );
const press = ( id, pointerId, x = 0 ) => tc._carDown( { target: tc.carBtns[ id ], pointerId, clientX: x, clientY: 0, preventDefault() {}, stopPropagation() {} } );
const lift = ( pointerId ) => tc._up( { pointerId, type: 'pointerup' } );

tc.update( 1 / 60 );
ok( tc.carEl.hidden === true, 'on foot: no driving cluster' );
app.player.mode = 'boat';
tc.update( 1 / 60 );
ok( tc.carEl.hidden === true && tc.root.dataset.mode === 'boat', 'at the helm: none either' );
app.player.mode = 'plane';
cars.driving = true; cars.drive = { kind: 'sedan' };
tc.update( 1 / 60 );
ok( tc.carEl.hidden === false && tc.root.dataset.mode === 'car', 'driving: the cluster is up (mode car: the stick, the lever and the action buttons stand down)' );
ok( tc.leverEl.hidden === true, 'no throttle lever in a car (the plane\'s)' );
const gs = tc.carBtns.gas.style;
ok( /var\(--tw-safe-r\) \+ 16(\.0)?px/.test( gs.right ) && /var\(--tw-safe-b\) \+ 16(\.0)?px/.test( gs.bottom ) && gs.width === '76.0px', 'each box placed from the safe area by carLayout', `(gas: right ${ gs.right }, ${ gs.width } x ${ gs.height })` );
ok( tc.carBtns.siren.hidden === true, 'no Siren in a sedan' );
press( 'gas', 1 );
tc.update( 1 / 60 );
ok( cars.touch.active && cars.touch.throttle === 1 && cars.touch.brake === 0, 'Gas held: throttle 1' );
press( 'brake', 2 );
lift( 1 );
tc.update( 1 / 60 );
ok( cars.touch.throttle === 0 && cars.touch.brake === 1, 'Brake held (gas let go): brake 1 (reverse once stopped)' );
lift( 2 );
const wr = carLayout( 844, 390 ).wheel.rect;
tc.carBtns.wheel.rect = { left: wr.x, top: wr.y, width: wr.w, height: wr.h };
press( 'wheel', 3, wr.x + wr.w / 2 );
tc._move( { pointerId: 3, clientX: wr.x + 20, clientY: 0, preventDefault() {} } );
tc.update( 1 / 60 );
const left = cars.touch.steer;
tc._move( { pointerId: 3, clientX: wr.x + wr.w - 20, clientY: 0, preventDefault() {} } );
tc.update( 1 / 60 );
const right = cars.touch.steer;
lift( 3 );
tc.update( 1 / 60 );
ok( left > 0.9 && right < - 0.9 && cars.touch.steer === 0, 'the slider steers both ways and springs back to centre', `(${ left.toFixed( 2 ) } / ${ right.toFixed( 2 ) } / ${ cars.touch.steer })` );
press( 'hand', 4 ); press( 'horn', 5 );
tc.update( 1 / 60 );
ok( cars.touch.handbrake === true && cars.touch.horn === true, 'Handbrake and Horn held together' );
lift( 4 ); lift( 5 );
tc.update( 1 / 60 );
ok( ! cars.touch.handbrake && ! cars.touch.horn, 'and let go' );
keyEvents.length = 0;
press( 'exit', 6 ); lift( 6 );
ok( keyEvents.length === 2 && keyEvents[ 0 ].code === 'KeyE' && keyEvents[ 0 ].type === 'keydown' && keyEvents[ 1 ].type === 'keyup', 'Exit presses E (the car says "Slow down" at speed)' );
cars.drive = { kind: 'police' };
tc.update( 1 / 60 );
ok( tc.carBtns.siren.hidden === false, 'a police car: Siren shows' );
press( 'siren', 7 ); lift( 7 );
tc.update( 1 / 60 );
ok( cars.siren === true && tc.carBtns.siren.classList.contains( 'is-on' ), 'and switches the siren (lit while on)' );
// tilt: the first reading is straight ahead, then the phone's roll steers
press( 'tilt', 8 ); lift( 8 );
tc.update( 1 / 60 );
const orient = win.listeners.deviceorientation || [];
ok( tc.settings.tilt === true && orient.length === 1, 'Tilt switches the motion steering on (one listener)' );
orient[ 0 ]( { beta: 4, gamma: 0 } );
tc.update( 1 / 60 );
const t0 = cars.touch.steer;
orient[ 0 ]( { beta: - 8, gamma: 0 } );
tc.update( 1 / 60 );
ok( t0 === 0 && cars.touch.steer > 0.4, 'held as it was switched on: straight; tipped: it steers', `(${ cars.touch.steer.toFixed( 2 ) })` );
press( 'wheel', 9, wr.x + wr.w / 2 + 40 );
tc.update( 1 / 60 );
ok( cars.touch.steer < 0, 'the slider wins over the tilt while held' );
lift( 9 );
press( 'tilt', 10 ); lift( 10 );
tc.update( 1 / 60 );
ok( tc.settings.tilt === false && ( win.listeners.deviceorientation || [] ).length === 0 && cars.touch.steer === 0, 'Tilt off: the listener goes' );
press( 'gas', 11 );
tc.update( 1 / 60 );
cars.driving = false; cars.drive = null; app.player.mode = 'walk';
tc.update( 1 / 60 );
ok( tc.carEl.hidden === true && cars.touch.active === false && cars.touch.throttle === 0, 'out of the car: the cluster goes and cars.touch is let go (a held pedal too)' );
app.ui = null;

// ---------------------------------------------------------------- captures
const shots = arg( 'shots' );
if ( shots ) {

	section( 'captures' );
	const dir = resolve( shots );
	mkdirSync( dir, { recursive: true } );
	const bg = arg( 'bg' );
	const ps = join( dir, '_car_hud.ps1' );
	writeFileSync( ps, ps1Source() );
	for ( const [ W, H ] of [ [ 390, 844 ], [ 844, 390 ] ] ) {

		const L = carLayout( W, H );
		const items = CAR_IDS.map( ( id ) => ( { id, label: id === 'wheel' ? '' : { gas: 'Gas', brake: 'Brake', hand: 'Handbrake', horn: 'Horn', exit: 'Exit', siren: 'Siren', tilt: 'Tilt' }[ id ], ...L[ id ].rect } ) );
		const json = join( dir, `car-hud-${ W }x${ H }.json` ), png = join( dir, `car-hud-${ W }x${ H }.png` );
		writeFileSync( json, JSON.stringify( { W, H, items, label: `driving cluster ${ W }x${ H } (police car: Siren shown)` } ) );
		execFileSync( 'powershell', [ '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps, '-Json', json, '-Out', png, '-Bg', bg && existsSync( bg ) ? resolve( bg ) : '' ], { stdio: 'pipe' } );
		ok( existsSync( png ), 'drawn ' + png );

	}

}

console.log( `\n${ passes } passed, ${ fails } failed` );
process.exit( fails ? 1 : 0 );

// the cluster's look (ui.css .tc-cbtn): translucent dark rounded boxes with a light rim, the gas aqua, the brake red, the slider
// a pill with its knob; the background cropped to cover the screen (as the game's canvas)
function ps1Source() {

	return String.raw`param( [string]$Json, [string]$Out, [string]$Bg )
Add-Type -AssemblyName System.Drawing
$d = Get-Content -Raw $Json | ConvertFrom-Json
$W = [int]$d.W; $H = [int]$d.H
$bmp = New-Object System.Drawing.Bitmap $W, $H
$g = [System.Drawing.Graphics]::FromImage( $bmp )
$g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'
if ( $Bg -and ( Test-Path $Bg ) ) {
	$img = [System.Drawing.Image]::FromFile( $Bg )
	$s = [Math]::Max( $W / $img.Width, $H / $img.Height )
	$iw = $img.Width * $s; $ih = $img.Height * $s
	$g.DrawImage( $img, [single]( ( $W - $iw ) / 2 ), [single]( ( $H - $ih ) / 2 ), [single]$iw, [single]$ih )
} else {
	$br = New-Object System.Drawing.Drawing2D.LinearGradientBrush ( New-Object System.Drawing.Point 0, 0 ), ( New-Object System.Drawing.Point 0, $H ), ( [System.Drawing.Color]::FromArgb( 255, 120, 160, 200 ) ), ( [System.Drawing.Color]::FromArgb( 255, 60, 64, 70 ) )
	$g.FillRectangle( $br, 0, 0, $W, $H )
}
function RR( $x, $y, $w, $h, $r ) {
	$p = New-Object System.Drawing.Drawing2D.GraphicsPath
	$r = [Math]::Min( $r, [Math]::Min( $w, $h ) / 2 )
	$p.AddArc( $x, $y, 2 * $r, 2 * $r, 180, 90 ); $p.AddArc( $x + $w - 2 * $r, $y, 2 * $r, 2 * $r, 270, 90 )
	$p.AddArc( $x + $w - 2 * $r, $y + $h - 2 * $r, 2 * $r, 2 * $r, 0, 90 ); $p.AddArc( $x, $y + $h - 2 * $r, 2 * $r, 2 * $r, 90, 90 )
	$p.CloseFigure(); return $p
}
$font = New-Object System.Drawing.Font 'Segoe UI', 10, ( [System.Drawing.FontStyle]::Bold ), ( [System.Drawing.GraphicsUnit]::Pixel )
$font2 = New-Object System.Drawing.Font 'Segoe UI', 13, ( [System.Drawing.FontStyle]::Bold ), ( [System.Drawing.GraphicsUnit]::Pixel )
$sf = New-Object System.Drawing.StringFormat; $sf.Alignment = 'Center'; $sf.LineAlignment = 'Center'
foreach ( $it in $d.items ) {
	$x = [single]$it.x; $y = [single]$it.y; $w = [single]$it.w; $h = [single]$it.h
	$fill = [System.Drawing.Color]::FromArgb( 107, 8, 14, 22 ); $rim = [System.Drawing.Color]::FromArgb( 82, 255, 255, 255 ); $r = 16
	if ( $it.id -eq 'gas' ) { $fill = [System.Drawing.Color]::FromArgb( 66, 70, 214, 214 ); $rim = [System.Drawing.Color]::FromArgb( 217, 70, 214, 214 ); $r = 20 }
	if ( $it.id -eq 'brake' ) { $fill = [System.Drawing.Color]::FromArgb( 56, 255, 110, 90 ); $rim = [System.Drawing.Color]::FromArgb( 204, 255, 150, 130 ); $r = 20 }
	if ( $it.id -eq 'exit' -or $it.id -eq 'siren' -or $it.id -eq 'tilt' -or $it.id -eq 'wheel' ) { $r = 999 }
	if ( $it.id -eq 'siren' ) { $fill = [System.Drawing.Color]::FromArgb( 128, 255, 196, 80 ); $rim = [System.Drawing.Color]::FromArgb( 242, 255, 196, 80 ) }
	$p = RR $x $y $w $h $r
	$g.FillPath( ( New-Object System.Drawing.SolidBrush $fill ), $p )
	$g.DrawPath( ( New-Object System.Drawing.Pen $rim, 2 ), $p )
	if ( $it.id -eq 'wheel' ) {
		$g.FillRectangle( ( New-Object System.Drawing.SolidBrush ( [System.Drawing.Color]::FromArgb( 90, 255, 255, 255 ) ) ), $x + 26, $y + $h / 2 - 2, $w - 52, 4 )
		$g.FillEllipse( ( New-Object System.Drawing.SolidBrush ( [System.Drawing.Color]::FromArgb( 200, 255, 255, 255 ) ) ), $x + $w / 2 - 26, $y + $h / 2 - 26, 52, 52 )
	} else {
		$f = $font; if ( $it.id -eq 'gas' -or $it.id -eq 'brake' ) { $f = $font2 }
		$g.DrawString( $it.label, $f, ( New-Object System.Drawing.SolidBrush ( [System.Drawing.Color]::FromArgb( 240, 240, 246, 250 ) ) ), ( New-Object System.Drawing.RectangleF $x, $y, $w, $h ), $sf )
	}
}
$g.DrawString( $d.label, $font, ( New-Object System.Drawing.SolidBrush ( [System.Drawing.Color]::FromArgb( 230, 255, 255, 255 ) ) ), 8, 8 )
$bmp.Save( $Out, [System.Drawing.Imaging.ImageFormat]::Png )
`;

}

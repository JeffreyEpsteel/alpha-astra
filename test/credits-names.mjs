// Plain-node tests of the wave-5 renames (Marta -> Ethena Prosper, Joe -> PoorGoat) and the credits
// (CREDITS.md at the root and the in-game panel src/ui/Credits.js).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NPCS, VENDOR_NPC } from '../src/features/story/StoryData.js';
import { CREDIT_SECTIONS, ART_CREDIT, creditsHTML, Credits } from '../src/ui/Credits.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};
const ROOT = fileURLToPath( new URL( '..', import.meta.url ) );
const read = ( f ) => readFileSync( join( ROOT, f ), 'utf8' );

// ---- the old names are gone from everything a player sees (src, the page, the readme); "Tar Joe" is a raider
{

	const files = [];
	const walk = ( d ) => {

		for ( const n of readdirSync( join( ROOT, d ) ) ) {

			const p = `${ d }/${ n }`;
			if ( statSync( join( ROOT, p ) ).isDirectory() ) walk( p );
			else if ( /\.(js|mjs|html|css)$/.test( n ) ) files.push( p );

		}

	};

	walk( 'src' );
	files.push( 'index.html', 'README.md' );
	const left = [];
	for ( const f of files ) {

		read( f ).split( '\n' ).forEach( ( line, i ) => {

			if ( /\bMarta\b/.test( line ) || /(?<!Tar )\bJoe\b/.test( line ) ) left.push( `${ f }:${ i + 1 }` );

		} );

	}

	ok( files.length > 100, `${ files.length } files scanned` );
	ok( left.length === 0, `no Marta / Joe left ${ left.slice( 0, 4 ).join( ' ' ) }` );
	ok( /name: 'Ethena Prosper · Chandlery'/.test( read( 'src/game/Chandlery.js' ) ), 'the chandlery vendor is Ethena Prosper' );
	ok( /name: 'PoorGoat · Fish buyer'/.test( read( 'src/game/FishStand.js' ) ), 'the fish stand vendor is PoorGoat' );
	ok( /Ethena's chandlery/.test( read( 'index.html' ) ) && /PoorGoat buys the fish/.test( read( 'index.html' ) ), 'loader tips use the new names' );
	ok( NPCS.joe.name === 'PoorGoat' && VENDOR_NPC.PoorGoat === 'joe', 'the story person keeps the id joe, shows PoorGoat' );
	ok( /models\/characters\/marta\.glb/.test( read( 'src/game/Chandlery.js' ) ), 'internal ids / file names stay (marta.glb)' );
	ok( /POORGOAT'S FRESH FISH/.test( read( 'tools/props/build.mjs' ) ) && /ETHENA'S CHANDLERY/.test( read( 'tools/props/build.mjs' ) ), 'the stall sign recipe is renamed' );
	const sign = readFileSync( join( ROOT, 'public/models/props/signs.png' ) );
	ok( sign.length > 1000 && sign.readUInt32BE( 16 ) === 2048 && sign.readUInt32BE( 20 ) === 1024 && sign[ 25 ] === 6, 'signs.png is still a 2048 x 1024 RGBA PNG' );

}

// ---- CREDITS.md: every third-party piece, verified entries, licence texts
{

	const md = read( 'CREDITS.md' );
	const pkg = JSON.parse( read( 'package.json' ) );
	for ( const dep of [ ...Object.keys( pkg.dependencies ), ...Object.keys( pkg.devDependencies ) ] ) {

		const name = dep === 'three' ? 'three.js' : dep === 'vite' ? 'Vite' : dep;
		ok( md.includes( name ), `CREDITS.md names ${ dep }` );
		const v = JSON.parse( read( `node_modules/${ dep }/package.json` ) ).version;
		ok( md.includes( v ), `  at its installed version ${ v }` );

	}

	ok( /Copyright 2020 Dimforge EURL/.test( md ) && /Apache License\s+Version 2\.0, January 2004/.test( md ), 'Rapier: copyright line and the Apache-2.0 text' );
	ok( /Permission is hereby granted, free of charge/.test( md ) && /Copyright \(c\) 2020 Microsoft/.test( md ), 'MIT text and the Rocketbox copyright' );
	ok( /evaluated, not shipped/.test( md ) && /sbobyn\/three-avbd/.test( md ), 'three-avbd: evaluated, not shipped' );
	ok( /DRG Software Solutions LLC/.test( md ) && /dgreenheck\/tidewater/.test( md ), 'Tidewater and its copyright holder' );
	ok( md.includes( ART_CREDIT.replace( 'Hyptile Island art: ', '' ) ), 'the owner\'s art credit placeholder' );
	ok( /Upside-Down Fishing/.test( md ) && /Fishing_Naval_20261007/.test( md ) && /Captain Roid/.test( md ), 'the Unreal design source and Captain Roid' );
	for ( const font of [ 'Inter', 'JetBrains Mono', 'Caveat Brush', 'Kalam', 'Permanent Marker', 'Cabin Sketch', 'Oswald' ] ) ok( md.includes( font ), `font ${ font }` );
	ok( /\.claude\/skills\/colyseus/.test( md ), 'the Colyseus agent skill' );
	// the Rocketbox clips: every one in clips.json is listed
	const clips = JSON.parse( read( 'tools/roster/rocketbox/clips.json' ) ).clips;
	ok( clips.every( ( c ) => md.includes( c.name ) && md.includes( c.file ) ), `all ${ clips.length } Rocketbox clips listed` );
	// every section of Tidewater's own credits is carried over
	let tw = null;
	try { tw = readFileSync( 'D:/tidewater-main/tidewater-main/CREDITS.md', 'utf8' ); } catch ( e ) { /* the source is not on this machine */ }
	if ( tw ) for ( const h of tw.match( /^## .+$/gm ) ) ok( md.includes( h.trim() ), `Tidewater section carried: ${ h.trim() }` );
	else console.log( 'skip Tidewater source not found' );

}

// ---- the in-game panel
{

	const all = CREDIT_SECTIONS.flatMap( ( [ , rows ] ) => rows );
	ok( CREDIT_SECTIONS.length >= 4 && all.every( ( r ) => r.length === 3 && r.every( ( s ) => typeof s === 'string' && s ) ), 'sections of [ what, who, licence ] rows' );
	const html = creditsHTML();
	for ( const s of [ 'Tidewater', 'Rapier', 'Apache-2.0', 'Rocketbox', 'Colyseus', 'Vite', 'three-avbd (evaluated, not shipped)', 'Captain Roid', 'Upside-Down Fishing', 'Inter' ] ) ok( html.includes( s ), `panel lists ${ s }` );
	ok( html.includes( 'the owner&#39;s own work' ) && ! /<script/i.test( html ), 'text is escaped' );
	ok( html.includes( 'data-close' ) && html.includes( 'role="dialog"' ), 'a dialog with a close button' );
	const c = new Credits();
	c.open(); // no DOM: does nothing, does not throw
	ok( c.isOpen === false, 'without a DOM the panel stays closed' );
	ok( /import \{ Credits \} from '\.\/Credits\.js'/.test( read( 'src/ui/MainMenu.js' ) ) && ( read( 'src/ui/MainMenu.js' ).match( /data-credits>Credits</g ) || [] ).length === 3, 'the main menu has a Credits link on each step' );
	ok( /this\.credits && this\.credits\.isOpen \) return/.test( read( 'src/ui/MainMenu.js' ) ), 'the menu gives the keyboard to the open panel' );

}

console.log( fails ? `${ fails } failed` : 'all passed' );
process.exit( fails ? 1 : 0 );

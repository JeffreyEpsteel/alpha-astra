import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

// the game's commit (wave 15A: the shared universe refuses a game built from another commit with a readable message)
const buildHash = () => {

	if ( process.env.GITHUB_SHA ) return process.env.GITHUB_SHA.slice( 0, 7 );
	try { return execSync( 'git rev-parse --short=7 HEAD', { stdio: [ 'ignore', 'pipe', 'ignore' ] } ).toString().trim() || 'dev'; } catch ( e ) { return 'dev'; }

};

export default defineConfig( {
	// relative asset paths: the build runs from any sub-path (GitHub Pages serves it under /tidewater/)
	base: './',
	define: { __BUILD_HASH__: JSON.stringify( buildHash() ) },
	build: { target: 'esnext', chunkSizeWarningLimit: 4000 },
	server: { port: 5188, strictPort: true, host: '127.0.0.1', watch: { ignored: [ '**/releases/**', '**/wip/**', '**/test/out/**', '**/tools/roster/**' ] } },
} );

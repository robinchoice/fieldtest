import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
export default {
  compilerOptions: { runes: true },
  kit: {
    adapter: adapter(),
    // SvelteKit adds nonces for its inline scripts. Browser errors go to
    // GlitchTip. New external sources (fonts, maps, APIs) go here.
    csp: {
      mode: 'auto',
      directives: {
        'default-src': ['self'],
        'script-src': ['self'],
        'style-src': ['self'],
        // Style attributes in app.html and in SvelteKit's route announcer
        'style-src-attr': ['unsafe-inline'],
        'img-src': ['self', 'data:'],
        'connect-src': ['self', 'https://glitchtip.pleasance.org'],
        'frame-ancestors': ['none'],
        'base-uri': ['self'],
        'form-action': ['self'],
        'object-src': ['none'],
      },
    },
  },
};

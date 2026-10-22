// The widget without inline styles and inline workers, so the CSP stays strict.
// Only the browser loads this, Altcha.svelte imports it on mount.
import 'altcha/external';
import 'altcha/altcha.css';
import 'altcha/i18n/de';
import 'altcha/i18n/en';
import Pbkdf2Worker from 'altcha/workers/pbkdf2?worker';

$altcha.algorithms.set('PBKDF2/SHA-256', () => new Pbkdf2Worker());

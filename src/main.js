/**
 * Entry point loaded by index.html. It starts the app only inside a
 * browser, so the module can also be imported by the tests.
 */
import { startApp } from './app.js';

if (globalThis.document) startApp(globalThis);

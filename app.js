'use strict';
/**
 * Phusion Passenger startup file for the cPanel Node.js Selector.
 *
 * In cPanel → "Setup Node.js App", set:
 *   Application startup file: app.js
 *
 * This simply loads the compiled NestJS server, which calls
 * app.listen(process.env.PORT) — Passenger injects PORT.
 *
 * Build (locally or on the server) before this can run:
 *   npm ci && npm run build   →  produces dist/main.js
 */
require('./dist/main.js');

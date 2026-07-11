/**
 * Entrypoint. PORT defaults to 8080 — the AgentCore Runtime contract
 * port — which also serves as the local default (core's runtime
 * provider points at http://localhost:8080 unless overridden).
 */

import process from 'node:process';
import { startServer } from './server.js';

startServer(Number(process.env.PORT ?? 8080));

import { z } from 'zod';

/*
 * Without JIT: zod's JIT compiles object schemas with `new Function`, which a Content Security
 * Policy without `unsafe-eval` blocks (it probes for it and falls back, but the probe itself is a
 * violation). Import this module before any schema is used: first in the router and in the start
 * file.
 */
z.config({ jitless: true });

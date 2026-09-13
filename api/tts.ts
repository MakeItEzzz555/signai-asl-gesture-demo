import { createTtsHandler } from '../server/tts/handler';

// Production fails closed until an atomic/shared quota adapter and a trusted,
// platform-derived client identity function are supplied. An in-memory counter
// or an unverified forwarded header cannot protect a scaled paid endpoint.
export default createTtsHandler({ production: process.env.NODE_ENV !== 'development' });

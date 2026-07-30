const rateLimit = require('express-rate-limit');

// Automated tests (e2e-test-eams.js etc.) log in as several different demo
// users dozens of times in a few seconds from the same local IP - that's
// not something a real login limiter should ever have to deal with, so the
// test runner sets DISABLE_RATE_LIMIT=1 to swap both limiters for a no-op
// pass-through. Production (Render) never sets this, so real traffic is
// always actually limited. The dedicated rate-limit test intentionally
// leaves this unset so it can verify the real limiter still trips.
const disabled = process.env.DISABLE_RATE_LIMIT === '1';
const passThrough = (req, res, next) => next();

// Login is the most attractive brute-force target, so it gets its own
// tighter limiter: 20 attempts per IP per 15 minutes, regardless of which
// username is being tried (stops both password-guessing against one
// account and username enumeration). 20 rather than a stricter number
// because a whole office/warehouse of employees signing in from behind the
// same shared WiFi IP during a shift change is normal traffic, not abuse.
const loginLimiter = disabled ? passThrough : rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please wait a few minutes and try again.' }
});

// A much looser general ceiling on the rest of the API, just to blunt
// scripted abuse/scraping - normal interactive use (scanning, dashboard
// refreshes, search-as-you-type) stays well under this.
const generalLimiter = disabled ? passThrough : rateLimit({
  windowMs: 60 * 1000,
  max: 180,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down and try again shortly.' }
});

module.exports = { loginLimiter, generalLimiter };

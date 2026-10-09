const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { User } = require('../models');
const { HttpError, asyncHandler, str } = require('../utils/http');
const { signToken, authenticate } = require('../middleware/auth');
const { audit } = require('../utils/audit');
const { validatePassword } = require('../utils/validators');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many login attempts. Please try again in 15 minutes.' },
});

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

function publicUser(u) {
  return {
    id: String(u._id),
    name: u.name,
    email: u.email,
    role: u.role,
    department: u.department ? { id: String(u.department._id), code: u.department.code, name: u.department.name } : null,
    lastLoginAt: u.lastLoginAt,
  };
}

router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const email = (str(req.body.email, 160) || '').toLowerCase();
    const password = str(req.body.password, 200) || '';
    if (!email || !password) throw new HttpError(400, 'Email and password are required');

    const user = await User.findOne({ email }).select('+passwordHash +failedLogins +lockedUntil').populate('department', 'code name');
    const invalid = new HttpError(401, 'Invalid email or password');
    if (!user || !user.active) throw invalid;
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new HttpError(423, `Account temporarily locked after repeated failed attempts. Try again after ${user.lockedUntil.toLocaleTimeString('en-IN')}.`);
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      user.failedLogins = (user.failedLogins || 0) + 1;
      if (user.failedLogins >= MAX_FAILED) {
        user.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60 * 1000);
        user.failedLogins = 0;
        req.user = user;
        await audit(req, { action: 'LOCKOUT', entity: 'User', entityId: user._id, summary: `Account locked after ${MAX_FAILED} failed logins` });
      }
      await user.save();
      throw invalid;
    }
    user.failedLogins = 0;
    user.lockedUntil = undefined;
    user.lastLoginAt = new Date();
    await user.save();
    req.user = user;
    await audit(req, { action: 'LOGIN', entity: 'User', entityId: user._id, summary: `${user.email} signed in` });
    res.json({ token: signToken(user), user: publicUser(user) });
  })
);

router.get('/me', authenticate, (req, res) => res.json({ user: publicUser(req.user) }));

router.post(
  '/change-password',
  authenticate,
  asyncHandler(async (req, res) => {
    const current = str(req.body.currentPassword, 200) || '';
    const next = str(req.body.newPassword, 200) || '';
    const pwError = validatePassword(next);
    if (pwError) throw new HttpError(400, pwError);
    const user = await User.findById(req.user._id).select('+passwordHash');
    if (!(await bcrypt.compare(current, user.passwordHash))) throw new HttpError(400, 'Current password is incorrect');
    user.passwordHash = await bcrypt.hash(next, 12);
    await user.save();
    await audit(req, { action: 'PASSWORD_CHANGE', entity: 'User', entityId: user._id, summary: 'Password changed' });
    res.json({ message: 'Password updated' });
  })
);

module.exports = { router, publicUser };

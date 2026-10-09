const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { User } = require('../models');
const { HttpError, asyncHandler } = require('../utils/http');

function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET must be set (min 16 chars)');
    return 'dev-only-insecure-secret-change-me';
  }
  return secret;
}

function signToken(user) {
  return jwt.sign({ sub: String(user._id), role: user.role }, jwtSecret(), {
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    issuer: 'bums',
  });
}

const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new HttpError(401, 'Authentication required');
  let payload;
  try {
    payload = jwt.verify(token, jwtSecret(), { issuer: 'bums' });
  } catch {
    throw new HttpError(401, 'Session expired or invalid. Please sign in again.');
  }
  const user = await User.findById(payload.sub).populate('department', 'code name').lean();
  if (!user || !user.active) throw new HttpError(401, 'Account is inactive');
  req.user = user;
  next();
});

const authorize = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return next(new HttpError(403, 'You do not have permission to perform this action'));
  }
  next();
};

const isDeptHead = (user) => user && user.role === 'DEPARTMENT_HEAD';
const userDeptId = (user) => (user.department ? String(user.department._id || user.department) : null);

// Mongo filter restricting records to the user's department for Department Heads.
// Returns an ObjectId so the filter is safe in aggregation pipelines as well as finds.
function departmentScope(user, field = 'department') {
  return isDeptHead(user) ? { [field]: new mongoose.Types.ObjectId(userDeptId(user)) } : {};
}

function assertDepartmentAccess(user, departmentId) {
  if (isDeptHead(user) && String(departmentId && (departmentId._id || departmentId)) !== userDeptId(user)) {
    throw new HttpError(403, 'Access is limited to your own department');
  }
}

module.exports = { signToken, authenticate, authorize, departmentScope, assertDepartmentAccess, isDeptHead, userDeptId };

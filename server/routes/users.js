const express = require('express');
const bcrypt = require('bcryptjs');
const { User, Department, ROLES } = require('../models');
const { HttpError, asyncHandler, str, isObjectId, escapeRegex } = require('../utils/http');
const { authorize } = require('../middleware/auth');
const { audit } = require('../utils/audit');
const { validatePassword, validEmail } = require('../utils/validators');

const router = express.Router();
router.use(authorize('ADMIN'));

const view = (u) => ({
  id: String(u._id),
  name: u.name,
  email: u.email,
  role: u.role,
  department: u.department ? { id: String(u.department._id), code: u.department.code, name: u.department.name } : null,
  active: u.active,
  lastLoginAt: u.lastLoginAt,
  createdAt: u.createdAt,
});

async function resolveDepartment(role, departmentId) {
  if (role !== 'DEPARTMENT_HEAD') return departmentId && isObjectId(departmentId) ? departmentId : null;
  if (!isObjectId(departmentId)) throw new HttpError(400, 'Department Heads must be mapped to a department');
  const dept = await Department.findById(departmentId);
  if (!dept) throw new HttpError(400, 'Department not found');
  return dept._id;
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const filter = {};
    const role = str(req.query.role);
    if (role && ROLES.includes(role)) filter.role = role;
    const q = str(req.query.q, 100);
    if (q) filter.$or = [{ name: new RegExp(escapeRegex(q), 'i') }, { email: new RegExp(escapeRegex(q), 'i') }];
    const users = await User.find(filter).populate('department', 'code name').sort({ role: 1, name: 1 }).lean();
    res.json({ items: users.map(view) });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const name = str(req.body.name, 120);
    const email = (str(req.body.email, 160) || '').toLowerCase();
    const role = str(req.body.role);
    const password = str(req.body.password, 200) || '';
    if (!name) throw new HttpError(400, 'Name is required');
    if (!validEmail(email)) throw new HttpError(400, 'A valid email is required');
    if (!ROLES.includes(role)) throw new HttpError(400, 'Invalid role');
    const pwError = validatePassword(password);
    if (pwError) throw new HttpError(400, pwError);
    const department = await resolveDepartment(role, str(req.body.department));
    const user = await User.create({ name, email, role, department, passwordHash: await bcrypt.hash(password, 12) });
    await user.populate('department', 'code name');
    await audit(req, { action: 'CREATE', entity: 'User', entityId: user._id, summary: `Created user ${email} (${role})`, after: { name, email, role, department: department && String(department) } });
    res.status(201).json(view(user));
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!isObjectId(req.params.id)) throw new HttpError(400, 'Invalid id');
    const user = await User.findById(req.params.id);
    if (!user) throw new HttpError(404, 'User not found');
    const before = user.toObject();
    if (req.body.name !== undefined) user.name = str(req.body.name, 120);
    if (req.body.role !== undefined) {
      const role = str(req.body.role);
      if (!ROLES.includes(role)) throw new HttpError(400, 'Invalid role');
      user.role = role;
    }
    if (req.body.department !== undefined || req.body.role !== undefined) {
      user.department = await resolveDepartment(user.role, str(req.body.department) ?? (user.department && String(user.department)));
    }
    if (req.body.active !== undefined) {
      if (String(user._id) === String(req.user._id) && !req.body.active) throw new HttpError(400, 'You cannot deactivate your own account');
      user.active = Boolean(req.body.active);
    }
    if (String(user._id) === String(req.user._id) && user.role !== 'ADMIN') throw new HttpError(400, 'You cannot remove your own admin role');
    await user.save();
    await user.populate('department', 'code name');
    await audit(req, { action: 'UPDATE', entity: 'User', entityId: user._id, summary: `Updated user ${user.email}`, before, after: user.toObject() });
    res.json(view(user));
  })
);

router.post(
  '/:id/reset-password',
  asyncHandler(async (req, res) => {
    if (!isObjectId(req.params.id)) throw new HttpError(400, 'Invalid id');
    const password = str(req.body.password, 200) || '';
    const pwError = validatePassword(password);
    if (pwError) throw new HttpError(400, pwError);
    const user = await User.findById(req.params.id);
    if (!user) throw new HttpError(404, 'User not found');
    user.passwordHash = await bcrypt.hash(password, 12);
    await user.save();
    await audit(req, { action: 'PASSWORD_RESET', entity: 'User', entityId: user._id, summary: `Password reset for ${user.email}` });
    res.json({ message: 'Password reset' });
  })
);

module.exports = router;

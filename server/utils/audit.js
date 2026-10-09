const { AuditLog } = require('../models');

const IGNORED = new Set(['_id', '__v', 'createdAt', 'updatedAt', 'passwordHash', 'revisions', 'documents', 'notes', 'data']);

function normalise(v) {
  if (v === null || v === undefined) return v;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object' && v._bsontype === 'ObjectId') return String(v);
  if (typeof v === 'object' && typeof v.toHexString === 'function') return v.toHexString();
  if (typeof v === 'object') return JSON.parse(JSON.stringify(v));
  return v;
}

// Field-level diff between two plain objects (shallow, nested objects compared as JSON).
function diff(before = {}, after = {}) {
  const changes = {};
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const k of keys) {
    if (IGNORED.has(k)) continue;
    const a = normalise(before[k]);
    const b = normalise(after[k]);
    if (JSON.stringify(a) !== JSON.stringify(b)) changes[k] = { from: a, to: b };
  }
  return changes;
}

async function audit(req, { action, entity, entityId, summary, before, after, changes }) {
  try {
    const user = req && req.user;
    await AuditLog.create({
      action,
      entity,
      entityId: entityId ? String(entityId) : undefined,
      summary,
      changes: changes || (before || after ? diff(before, after) : undefined),
      user: user ? user._id : undefined,
      userName: user ? user.name : undefined,
      userRole: user ? user.role : undefined,
      ip: req ? req.ip : undefined,
    });
  } catch (err) {
    // Audit failures must never break the business operation, but they should be visible.
    console.error('Audit log write failed:', err.message);
  }
}

module.exports = { audit, diff };

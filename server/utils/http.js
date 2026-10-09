class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Coerce untrusted input to a plain trimmed string (blocks {$gt: ""}-style operator injection).
function str(value, max = 500) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object') throw new HttpError(400, 'Invalid input type');
  return String(value).trim().slice(0, max);
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pagination(query, defLimit = 25, maxLimit = 200) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit, 10) || defLimit));
  return { page, limit, skip: (page - 1) * limit };
}

function isObjectId(id) {
  return typeof id === 'string' && /^[a-f0-9]{24}$/i.test(id);
}

module.exports = { HttpError, asyncHandler, str, escapeRegex, pagination, isObjectId };

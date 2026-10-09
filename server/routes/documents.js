const express = require('express');
const { Document } = require('../models');
const { HttpError, asyncHandler, isObjectId } = require('../utils/http');
const { assertDepartmentAccess } = require('../middleware/auth');

const router = express.Router();

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!isObjectId(req.params.id)) throw new HttpError(400, 'Invalid id');
    const doc = await Document.findById(req.params.id).select('+data');
    if (!doc) throw new HttpError(404, 'Document not found');
    assertDepartmentAccess(req.user, doc.department);
    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Length', doc.size);
    res.setHeader('Content-Disposition', `attachment; filename="${doc.filename.replace(/"/g, '')}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(doc.data);
  })
);

module.exports = router;

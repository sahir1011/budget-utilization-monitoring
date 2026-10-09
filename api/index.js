// Vercel serverless entry point: every /api/* request is rewritten here (see vercel.json).
const { createApp } = require('../server/app');

module.exports = createApp();

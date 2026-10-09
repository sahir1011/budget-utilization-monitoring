const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const { connectDB } = require('./config/db');
const { authenticate } = require('./middleware/auth');
const { HttpError } = require('./utils/http');
const { EXPENSE_CATEGORIES, ALERT_TYPES, ROLES } = require('./models');

function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(compression());
  const origins = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  app.use(cors({ origin: origins.length ? origins : true, exposedHeaders: ['Content-Disposition'] }));
  app.use(express.json({ limit: '1mb' }));
  if (process.env.NODE_ENV !== 'test') app.use(morgan(process.env.NODE_ENV === 'production' ? 'tiny' : 'dev'));

  app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

  // Ensure the (cached) database connection is ready before any data route.
  app.use('/api', async (req, res, next) => {
    try {
      await connectDB();
      next();
    } catch (err) {
      next(err);
    }
  });

  const admin = require('./routes/admin');
  app.use('/api/auth', require('./routes/auth').router);
  app.get('/api/monitoring/cron', admin.cron);

  app.use('/api', authenticate);
  app.get('/api/meta', (req, res) => res.json({ categories: EXPENSE_CATEGORIES, alertTypes: ALERT_TYPES, roles: ROLES }));
  app.use('/api/users', require('./routes/users'));
  app.use('/api/departments', require('./routes/departments'));
  app.use('/api/budgets', require('./routes/budgets'));
  app.use('/api/expenditures', require('./routes/expenditures').router);
  app.use('/api/documents', require('./routes/documents'));
  app.use('/api/alerts', require('./routes/alerts'));
  app.use('/api/dashboard', require('./routes/dashboard'));
  app.use('/api/reports', require('./routes/reports').router);
  app.use('/api/settings', admin.settings);
  app.use('/api/monitoring', admin.monitoring);
  app.use('/api/audit-logs', admin.auditLogs);

  app.use('/api', (req, res, next) => next(new HttpError(404, `Route not found: ${req.method} ${req.originalUrl}`)));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    let status = err.status || 500;
    let message = err.message || 'Internal server error';
    if (err.name === 'ValidationError') {
      status = 400;
      message = Object.values(err.errors).map((e) => e.message).join('; ');
    } else if (err.name === 'CastError') {
      status = 400;
      message = `Invalid value for ${err.path}`;
    } else if (err.code === 11000) {
      status = 409;
      message = `A record with this ${Object.keys(err.keyValue || { value: 1 }).join(', ')} already exists`;
    } else if (err.type === 'entity.parse.failed') {
      status = 400;
      message = 'Malformed JSON body';
    }
    if (status >= 500) {
      console.error(err);
      if (process.env.NODE_ENV === 'production') message = 'Internal server error';
    }
    res.status(status).json({ message, details: err.details });
  });

  return app;
}

module.exports = { createApp };

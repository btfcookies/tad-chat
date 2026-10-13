const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

// Builds the Express app without loading state or listening, so tests can mount
// it on an ephemeral port.
function createApp() {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '20kb' }));
  app.use(cookieParser());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.get('/ping', (req, res) => {
    res.send('pong');
  });

  app.use(require('./routes/auth'));
  app.use(require('./routes/messages'));
  app.use(require('./routes/forums'));
  app.use(require('./routes/users'));
  app.use(require('./routes/admin'));

  return app;
}

module.exports = { createApp };

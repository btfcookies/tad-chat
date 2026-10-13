const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const { loadState } = require('./src/state');

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '20kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/ping', (req, res) => {
  res.send('pong');
});

app.use(require('./src/routes/auth'));
app.use(require('./src/routes/messages'));
app.use(require('./src/routes/forums'));
app.use(require('./src/routes/users'));
app.use(require('./src/routes/admin'));

const PORT = process.env.PORT || 3000;

loadState()
  .then(() => {
    app.listen(PORT, () => console.log('Server running on port ' + PORT));
  })
  .catch((err) => {
    console.error('Failed to load state from Redis:', err);
    process.exit(1);
  });

const express = require('express');
const { messagesKey } = require('../config');
const { redis, state, isForum } = require('../state');
const { truncate, telemetryString, telemetryInt } = require('../lib/text');
const { rememberUser, resolveSender } = require('../lib/accounts');

const router = express.Router();

function toPublicMessage(msg) {
  const { name, text, time } = msg;
  return { name, text, time };
}

router.post('/messages', async (req, res) => {
  if (state.bannedIps.includes(truncate(req.ip, 100))) {
    return res.status(403).json({ ok: false, error: 'Forbidden.' });
  }

  const forum = req.body.forum;
  if (!isForum(forum)) {
    return res.status(400).json({ ok: false, error: 'Unknown forum.' });
  }

  if (typeof req.body.text !== 'string' || req.body.text.length > 2000) {
    return res.status(400).json({ ok: false, error: 'Message is too long.' });
  }
  if (typeof req.body.name !== 'string' || req.body.name.length > 100) {
    return res.status(400).json({ ok: false, error: 'Name is too long.' });
  }

  const sender = resolveSender(req, req.body.name);
  if (!sender.ok) {
    return res.status(sender.status).json({ ok: false, error: sender.error });
  }

  const clientTelemetry = req.body.telemetry && typeof req.body.telemetry === 'object'
    ? req.body.telemetry
    : {};

  const msg = {
    name: sender.name,
    text: req.body.text,
    time: Date.now(),
    ip: truncate(req.ip, 100),
    userAgent: truncate(req.headers['user-agent'], 300) || null,
    telemetry: {
      screen: telemetryString(clientTelemetry.screen, 50),
      timezone: telemetryString(clientTelemetry.timezone, 100),
      language: telemetryString(clientTelemetry.language, 50),
      platform: telemetryString(clientTelemetry.platform, 100),
      composeMs: telemetryInt(clientTelemetry.composeMs, 24 * 60 * 60 * 1000),
      pasted: clientTelemetry.pasted === true,
      tabSwitches: telemetryInt(clientTelemetry.tabSwitches, 1000),
      deviceMemory: telemetryInt(clientTelemetry.deviceMemory, 1024),
      cpuCores: telemetryInt(clientTelemetry.cpuCores, 256),
      connectionType: telemetryString(clientTelemetry.connectionType, 30),
      referrer: telemetryString(clientTelemetry.referrer, 300),
      sessionMessageCount: telemetryInt(clientTelemetry.sessionMessageCount, 100000),
    },
  };

  const next = [...(state.messages[forum] || []), msg];
  try {
    await redis.set(messagesKey(forum), next);
    state.messages[forum] = next;
  } catch (err) {
    console.error('Failed to save message:', err);
    return res.status(500).json({ ok: false, error: 'Could not save message.' });
  }

  try {
    await rememberUser(msg.name);
  } catch (err) {
    console.error('Failed to remember user:', err);
  }
  console.log('new message: ' + JSON.stringify(msg));
  res.json(toPublicMessage(msg));
});

router.get('/messages', (req, res) => {
  const forum = req.query.forum;
  if (!isForum(forum)) {
    return res.status(400).json({ ok: false, error: 'Unknown forum.' });
  }
  res.json((state.messages[forum] || []).map(toPublicMessage));
});

module.exports = router;

const normalize = (value) => (typeof value === 'string' ? value.trim() : '');
const truncate = (value, maxLength) => normalize(value).slice(0, maxLength);

const UNKNOWN_TELEMETRY = 'Could not find value';
const telemetryString = (value, maxLength) => {
  const normalized = normalize(value);
  return normalized ? normalized.slice(0, maxLength) : UNKNOWN_TELEMETRY;
};
const telemetryInt = (value, max) =>
  Number.isFinite(value) ? Math.min(Math.max(Math.trunc(value), 0), max) : UNKNOWN_TELEMETRY;

module.exports = { normalize, truncate, telemetryString, telemetryInt };

export const ACCESS_DURATION_MS = 5 * 60 * 1000;

export function alarmNameForDomain(domain) {
  return `revoke:${domain}`;
}

export function domainFromAlarmName(name) {
  const prefix = 'revoke:';
  return name.startsWith(prefix) ? name.slice(prefix.length) : null;
}

export function formatTimeRemaining(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0:00';
  const totalSec = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

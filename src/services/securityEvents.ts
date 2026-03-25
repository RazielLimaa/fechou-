export type SecuritySeverity = 'info' | 'warning' | 'high' | 'critical';

export function logSecurityEvent(event: {
  eventName: string;
  severity: SecuritySeverity;
  requestId?: string | null;
  actorId?: number | null;
  ip?: string | null;
  route?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const payload = {
    ts: new Date().toISOString(),
    event: event.eventName,
    severity: event.severity,
    requestId: event.requestId ?? null,
    actorId: event.actorId ?? null,
    ip: event.ip ?? null,
    route: event.route ?? null,
    reason: event.reason ?? null,
    metadata: event.metadata ?? {},
  };

  const out = JSON.stringify(payload);
  if (event.severity === 'critical' || event.severity === 'high') {
    console.warn(out);
  } else {
    console.log(out);
  }
}

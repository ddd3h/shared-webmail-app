// Shapes for showing sessions and logins to people (who is logged in, from where, on what).
import { deviceLabel } from '@/lib/device';

const place = (c: { country: string | null; city: string | null }) => [c.country, c.city].filter(Boolean).join(' ') || null;

export const serializeSession = (s: { id: string; ip_address: string; user_agent: string | null; network_type: string; country: string | null; city: string | null; created_at: Date; last_activity_at: Date; expires_at: Date }, currentId?: string) => ({
  id: s.id, ip: s.ip_address, device: deviceLabel(s.user_agent), place: place(s), network_type: s.network_type,
  created_at: s.created_at, last_activity_at: s.last_activity_at, expires_at: s.expires_at, current: s.id === currentId,
});

export const serializeLogin = (l: { id: string; success: boolean; failure_reason: string | null; ip_address: string; user_agent: string | null; network_type: string | null; org_name: string | null; country: string | null; city: string | null; created_at: Date }) => ({
  id: l.id, success: l.success, reason: l.failure_reason, ip: l.ip_address, device: deviceLabel(l.user_agent), place: place(l) ?? l.org_name, network_type: l.network_type, at: l.created_at,
});

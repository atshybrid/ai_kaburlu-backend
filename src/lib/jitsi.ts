import crypto from 'crypto';

export type JitsiJoinInfo = {
  domain: string;
  roomName: string;
  url: string;
  password?: string | null;
  jwt?: string | null;
};

export function generateRoomName(prefix = 'hrci'): string {
  // URL-safe random string
  const rand = crypto.randomBytes(8).toString('base64url');
  return `${prefix}-${Date.now()}-${rand}`;
}

export function buildJoinUrl(domain: string, roomName: string, password?: string | null): string {
  const base = domain.startsWith('http') ? domain : `https://${domain}`;
  // Password can be set via UI in IFrame or passed as a config param; keep simple here
  return `${base}/${encodeURIComponent(roomName)}`;
}

export function createMeetingJoinInfo(domain: string, roomName: string, password?: string | null, jwt?: string | null): JitsiJoinInfo {
  return {
    domain,
    roomName,
    url: buildJoinUrl(domain, roomName, password),
    password: password || null,
    jwt: jwt || null,
  };
}

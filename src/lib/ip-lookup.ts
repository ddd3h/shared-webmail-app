export type NetworkType = 'public' | 'semi_public' | 'hosting' | 'residential';

export interface IpInfo {
  country: string | null;
  city: string | null;
  org: string | null;
  networkType: NetworkType;
}

function isPrivateIp(ip: string): boolean {
  if (!ip || ip === 'unknown' || ip === '::1' || ip === 'localhost') return true;
  return (
    ip.startsWith('127.') ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
  );
}

function classifyNetworkType(org: string, as_: string, hosting: boolean, proxy: boolean): NetworkType {
  if (hosting || proxy) return 'hosting';

  const text = (org + ' ' + as_).toLowerCase();

  const publicKeywords = [
    'airport', '空港', 'hotel', 'ホテル', 'cafe', 'カフェ', 'cafeteria',
    'library', '図書館', 'station', '駅', 'railway', 'shinkansen',
    'wifi', 'wi-fi', 'hotspot', 'free wifi', 'public wifi',
  ];
  if (publicKeywords.some(kw => text.includes(kw))) return 'public';

  const semiPublicKeywords = [
    'university', '大学', 'college', 'school', '学校', 'academic',
    'hospital', '病院', 'clinic', 'medical', 'healthcare',
  ];
  if (semiPublicKeywords.some(kw => text.includes(kw))) return 'semi_public';

  return 'residential';
}

export async function lookupIp(ip: string): Promise<IpInfo | null> {
  if (isPrivateIp(ip)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);

  try {
    const res = await fetch(
      `http://ip-api.com/json/${ip}?fields=status,country,city,org,as,hosting,proxy`,
      { signal: controller.signal }
    );
    if (!res.ok) return null;

    const data = await res.json();
    if (data.status !== 'success') return null;

    const networkType = classifyNetworkType(
      data.org ?? '',
      data.as ?? '',
      data.hosting ?? false,
      data.proxy ?? false
    );

    return {
      country: data.country ?? null,
      city: data.city ?? null,
      org: data.org ?? null,
      networkType,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

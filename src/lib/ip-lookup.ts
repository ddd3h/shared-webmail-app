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

function classifyNetworkType(
  org: string,
  as_: string,
  hosting: boolean,
  proxy: boolean,
  reverse: string,
): NetworkType {
  if (hosting || proxy) return 'hosting';

  const text = (org + ' ' + as_).toLowerCase();
  const host = reverse.toLowerCase();

  // --- hosting: major cloud/CDN PTR patterns ---
  const hostingHostPatterns = [
    /\.amazonaws\.com$/,
    /\.compute\.internal$/,
    /cloudfront\.net$/,
    /\.azure\.com$/,
    /\.azurewebsites\.net$/,
    /\.googleusercontent\.com$/,
    /\.1e100\.net$/,          // Google
    /\.digitalocean\.com$/,
    /\.linode\.com$/,
    /\.vultr\.com$/,
    /\.fastly\.net$/,
    /\.akamai(edge)?\.net$/,
    /\.cloudflare\.com$/,
    /\.heroku\.com$/,
    /\.sakura\.ne\.jp$/,      // さくらインターネット
    /\.idcf\.jp$/,
  ];
  if (hostingHostPatterns.some(re => re.test(host))) return 'hosting';

  // --- public: transit/hospitality keywords in org/as ---
  const publicKeywords = [
    'airport', '空港', 'hotel', 'ホテル', 'cafe', 'カフェ', 'cafeteria',
    'library', '図書館', 'station', '駅', 'railway', 'shinkansen',
    'wifi', 'wi-fi', 'hotspot', 'free wifi', 'public wifi', 'lounge',
    'konbini', 'convenience store',
  ];
  if (publicKeywords.some(kw => text.includes(kw))) return 'public';

  // public: transit/hospitality in PTR
  const publicHostPatterns = [/airport/, /hotel/, /lounge/, /station/, /hotspot/];
  if (publicHostPatterns.some(re => re.test(host))) return 'public';

  // --- semi_public: academic/medical org name ---
  const semiPublicKeywords = [
    'university', '大学', 'college', 'school', '学校', 'academic',
    'hospital', '病院', 'clinic', 'medical', 'healthcare', 'ac.jp',
  ];
  if (semiPublicKeywords.some(kw => text.includes(kw))) return 'semi_public';

  // semi_public: academic TLD in PTR (*.ac.jp, *.edu, *.ac.uk, etc.)
  const academicHostPatterns = [
    /\.ac\.jp$/,
    /\.edu$/,
    /\.ac\.uk$/,
    /\.ac\.kr$/,
    /\.edu\.au$/,
    /univ\./,
    /\.u-[a-z]+\.ac\.jp$/,   // e.g. u-tokyo.ac.jp
  ];
  if (academicHostPatterns.some(re => re.test(host))) return 'semi_public';

  // --- residential: ISP dynamic-IP PTR patterns ---
  // These strongly indicate home/office broadband.
  const residentialHostPatterns = [
    // Japanese ISPs
    /\.bbtec\.net$/,
    /\.mesh\.ad\.jp$/,
    /\.ocn\.ne\.jp$/,
    /\.nifty\.com$/,
    /\.plala\.or\.jp$/,
    /\.biglobe\.ne\.jp$/,
    /\.dti\.ne\.jp$/,
    /\.kddi\.ne\.jp$/,
    /\.au-net\.ne\.jp$/,
    /\.softbank\.ne\.jp$/,
    /\.eonet\.ne\.jp$/,
    /ppp\d/,                  // PPPoE dynamic (e.g. ppp01.isp.ne.jp)
    /\.megaegg\.ne\.jp$/,
    /\.yournet\.ne\.jp$/,
    // Generic ISP patterns
    /cpe[.-]/,                // Customer Premises Equipment
    /dhcp/,
    /dynamic/,
    /dyn\./,
    /\bppp\b/,
    /cable/,
    /fiber/,
    /ftth/,
    /adsl/,
    /broadband/,
    /residential/,
    /home\./,
    // US ISPs
    /\.comcast\.net$/,
    /\.charter\.com$/,
    /\.cox\.net$/,
    /\.verizon\.net$/,
    /lightspeed\./,
  ];
  if (residentialHostPatterns.some(re => re.test(host))) return 'residential';

  return 'residential';
}

export async function lookupIp(ip: string): Promise<IpInfo | null> {
  if (isPrivateIp(ip)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);

  try {
    const res = await fetch(
      `http://ip-api.com/json/${ip}?fields=status,country,city,org,as,hosting,proxy,reverse`,
      { signal: controller.signal }
    );
    if (!res.ok) return null;

    const data = await res.json();
    if (data.status !== 'success') return null;

    const networkType = classifyNetworkType(
      data.org ?? '',
      data.as ?? '',
      data.hosting ?? false,
      data.proxy ?? false,
      data.reverse ?? '',
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

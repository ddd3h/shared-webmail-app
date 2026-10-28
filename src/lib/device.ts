// What kind of browser/device a User-Agent string describes — only as much as a person needs to recognise their own device.
export type Device = { browser: string; os: string };

const BROWSERS: [RegExp, string][] = [
  [/Edg(e|A|iOS)?\//, 'Edge'], [/OPR\/|Opera/, 'Opera'], [/SamsungBrowser\//, 'Samsung Internet'], [/Firefox\/|FxiOS\//, 'Firefox'],
  [/CriOS\/|Chrome\//, 'Chrome'], [/Safari\//, 'Safari'],
];
const SYSTEMS: [RegExp, string][] = [
  [/iPhone|iPad|iPod/, 'iOS'], [/Android/, 'Android'], [/Windows/, 'Windows'], [/Mac OS X|Macintosh/, 'macOS'], [/CrOS/, 'ChromeOS'], [/Linux/, 'Linux'],
];
const BOTS = /bot|crawler|spider|curl|wget|python-requests|python-urllib|httpclient|go-http|java\/|libwww|scrapy|node-fetch|axios|okhttp|headless/i;

export function describeDevice(ua: string | null | undefined): Device {
  const s = ua ?? '';
  return { browser: BROWSERS.find(([re]) => re.test(s))?.[1] ?? '不明なブラウザ', os: SYSTEMS.find(([re]) => re.test(s))?.[1] ?? '不明なOS' };
}
export const deviceLabel = (ua: string | null | undefined) => { const d = describeDevice(ua); return `${d.browser}（${d.os}）`; };

/** Scripts and scanners identify themselves; people use browsers. (Only a hint: a script can lie.) */
export const looksAutomated = (ua: string | null | undefined) => !ua || BOTS.test(ua);

/** Browser + OS without version numbers: stays the same across browser updates, but differs between devices. */
export const deviceFingerprint = (ua: string | null | undefined) => { const d = describeDevice(ua); return `${d.browser}/${d.os}`; };

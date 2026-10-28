// オートフローの設定を app_settings から読み書きする（DB に触るのはここだけ。形と既定値は config.ts）。
import { getSetting, setSetting } from '@/lib/settings';
import { parseConfig, type AutoflowConfig } from './config';

const KEY = 'AUTOFLOW_CONFIG' as const;

export async function loadConfig(): Promise<AutoflowConfig> {
  return parseConfig(await getSetting(KEY).catch(() => null));
}
export async function saveConfig(config: AutoflowConfig, userId: string): Promise<void> {
  await setSetting(KEY, JSON.stringify(config), false, userId);
}

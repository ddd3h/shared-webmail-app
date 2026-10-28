// Mattermost DMs written by an administrator's action: the reset of an account, and a note typed by hand.

export const ADMIN_RESET_TTL_MIN = 60;

export function adminResetMessage(name: string, url: string, ttlMin: number = ADMIN_RESET_TTL_MIN): string {
  return `### 🔑 アカウントがリセットされました\n\n${name} 様、管理者がアカウントのログイン設定をリセットしました。\n` +
    `パスキーと2段階認証は削除され、パスワードも無効になっています。下のリンクから新しいパスワードを決めてください。\n\n` +
    `**有効期限: ${ttlMin}分間（1回だけ使えます）**\n\n[パスワードを決める](${url})\n\nURL: ${url}\n\n` +
    `ログインしたあとは、プロフィールからパスキーや2段階認証を設定し直してください。心当たりがない場合は、管理者に連絡してください。`;
}

/** A note an administrator types in the admin console; this is what the person sees in the DM. */
export const adminNoticeMessage = (text: string): string => `### 📣 管理者からのお知らせ\n\n${text.trim()}`;

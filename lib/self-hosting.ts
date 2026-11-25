// 纯本地单机模式：始终启用自部署/本地账号，跳过登录、激活码与 Supabase 环境变量校验，
// 无需任何环境变量即可直接进入主界面。所有聊天记录与记忆数据保存在本地浏览器存储中。
export function isSelfHostedModeEnabled(): boolean {
  return true;
}

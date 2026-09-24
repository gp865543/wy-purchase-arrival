// 门户目录以完整导航打开本应用，并在地址上带 portal_entry（进来时所在的 PDA 或平板入口，
// 见门户的 applicationUrl）。返回门户沿用它，否则从平板入口进来的人会被送回 PDA。
//
// 入口路径是路由路径（/pda、/tablet），不含部署前缀；应用固定装在 <前缀>/apps/purchase-arrival/，
// 所以前缀从构建配置里取，而不是从 location 上截字符串。
const prefix = import.meta.env.BASE_URL.replace(/\/$/, '').replace(
  /\/apps\/purchase-arrival$/,
  '',
);

function entryTarget() {
  const entry = new URLSearchParams(location.search).get('portal_entry');
  // 只认同源站内绝对路径：'//' 开头会被 URL 解析成另一台主机，等于开放跳转。
  if (!entry || !entry.startsWith('/') || entry.startsWith('//')) return '';
  return prefix + entry;
}

// 直接打开（没有 portal_entry，例如地址被收藏或分享）时没有门户入口可回，退回浏览器上一页。
export function leaveToPortal() {
  const target = entryTarget();
  if (target) location.assign(target);
  else history.back();
}

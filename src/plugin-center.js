'use strict';

const content = document.getElementById('content');
const notice = document.getElementById('notice');
let snapshot = null;
let market = null;
let tab = 'recommended';
let busy = false;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function statusText(status) {
  return ({ available: '可安装', enabled: '已启用', disabled: '已停用', conflict: '名称冲突', external: '外部 Preset' })[status] || status;
}

function actionButtons(plugin) {
  if (plugin.status === 'available') return `<button class="primary" data-action="install" data-id="${plugin.id}">安装</button>`;
  if (plugin.status === 'enabled' && plugin.owned) return `<button data-action="disable" data-id="${plugin.id}">停用</button><button class="danger" data-action="uninstall" data-id="${plugin.id}">卸载</button>`;
  if (plugin.status === 'disabled' && plugin.owned) return `<button class="primary" data-action="enable" data-id="${plugin.id}">启用</button><button class="danger" data-action="uninstall" data-id="${plugin.id}">卸载</button>`;
  return '';
}

function card(plugin) {
  return `<article class="card">
    <div class="title"><div class="icon">${escapeHtml(plugin.name || plugin.id).slice(0, 1)}</div><div><h2>${escapeHtml(plugin.name || plugin.id)}</h2><div class="meta">${escapeHtml(plugin.author || '用户 Preset')} · ${escapeHtml(plugin.version || '')}</div></div></div>
    <p class="desc">${escapeHtml(plugin.description || '此 Preset 不是由插件中心安装，插件中心不会修改或卸载它。')}</p>
    <span class="badge ${plugin.status}">${statusText(plugin.status)}</span>
    ${plugin.permissions?.length ? `<div class="permissions">权限：${plugin.permissions.map(escapeHtml).join('、')}</div>` : ''}
    ${plugin.valid === false ? '<p class="hint">缺少 agent.cordis.yml，可能需要修复。</p>' : ''}
    <div class="actions">${actionButtons(plugin)}</div>
  </article>`;
}

function marketStatusText(status) {
  return ({ available: '可安装', enabled: '已启用', disabled: '已停用', conflict: '冲突' })[status] || status;
}

function marketActions(entry) {
  if (entry.status === 'available') return `<button class="primary" data-market-action="install">安装到共享 DSH_HOME</button>`;
  if (entry.status === 'enabled' && entry.owned) return `<button data-market-action="disable">停用</button><button class="danger" data-market-action="uninstall">卸载</button>`;
  if (entry.status === 'disabled' && entry.owned) return `<button class="primary" data-market-action="enable">启用</button><button class="danger" data-market-action="uninstall">卸载</button>`;
  return '';
}

function renderMarket() {
  if (!market) return;
  const entry = market.entry;
  content.innerHTML = `
  <div class="market">
    <section class="cmdstrip">
      <div class="metric"><span class="k">市场状态</span><span class="v"><span class="badge ${entry.status}">${marketStatusText(entry.status)}</span></span></div>
      <div class="metric"><span class="k">内置版本</span><span class="v">v${escapeHtml(entry.version || '—')}</span></div>
      <div class="metric"><span class="k">挂载目标</span><span class="v">共享 web profile</span></div>
      <div class="metric"><span class="k">补丁文件</span><span class="v">cordis.patch.yml</span></div>
    </section>
    <section class="cmdcard">
      <div class="cmdtag">控制台</div>
      <h3>${escapeHtml(entry.name)}</h3>
      <p class="desc">${escapeHtml(entry.description)}</p>
      ${entry.detail ? `<p class="hint">${escapeHtml(entry.detail)}</p>` : ''}
      <div class="actions">${marketActions(entry)}</div>
    </section>
    <section class="cmdcard">
      <div class="cmdtag">能力</div>
      <ul class="feats">
        <li>浏览 awesome-dsh-plugin.com 社区目录（内置离线快照兜底，含 Star 数）</li>
        <li>安装 / 更新 / 卸载插件到共享的 web profile（FIFO 任务队列 + 试装验证）</li>
        <li>停用 / 启用保留依赖，仅切换挂载层；一键更新全部</li>
      </ul>
    </section>
    <section class="cmdcard risk">
      <div class="cmdtag">第三方风险提示</div>
      <p>市场中的插件由社区作者编写，安装后会在 DSH 进程内以宿主权限运行，可能访问本地文件、网络与命令行。请仅安装你信任的来源。DSH Desktop 内置的是固定版本（MIT 协议）并校验包完整性，但对第三方插件的行为不承担任何责任。</p>
    </section>
    <section class="cmdcard restart">
      <div class="cmdtag">生效方式</div>
      <p>安装、启用、停用或卸载后，需要<strong>重启 DSH</strong>（关闭并重新打开桌面应用，或重启 web 服务）才会在 Web 界面（设置 → 插件 → 插件市场）中生效；当前正在运行的会话不受影响。</p>
    </section>
  </div>`;
  content.querySelectorAll('[data-market-action]').forEach((button) => button.addEventListener('click', () => mutateMarket(button.dataset.marketAction)));
}

function render() {
  if (tab === 'market') { renderMarket(); return; }
  if (!snapshot) return;
  let items = snapshot.recommended;
  if (tab === 'installed') items = snapshot.recommended.filter((plugin) => ['enabled', 'disabled', 'conflict'].includes(plugin.status));
  if (tab === 'external') items = snapshot.external;
  content.innerHTML = items.length ? `<div class="grid">${items.map(card).join('')}</div>` : '<div class="empty">暂无内容</div>';
  content.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => mutate(button.dataset.action, button.dataset.id)));
}

async function refresh() {
  if (tab === 'market') {
    try { market = await window.pluginCenter.webMarket.list(); render(); }
    catch (error) { showError(error); }
    return;
  }
  try { snapshot = await window.pluginCenter.list(); render(); }
  catch (error) { showError(error); }
}

async function mutate(action, id) {
  if (busy) return;
  if (action === 'uninstall' && !confirm('确认卸载此插件？插件中心不会删除非自己安装的 Preset。')) return;
  busy = true;
  try {
    snapshot = await window.pluginCenter[action](id);
    notice.className = 'notice';
    notice.textContent = '操作完成。变更将在新会话中生效。';
    render();
  } catch (error) { showError(error); }
  finally { busy = false; }
}

async function mutateMarket(action) {
  if (busy) return;
  if (action === 'uninstall' && !confirm('确认卸载 Web 市场？将移除内置包与 cordis.patch.yml 中的市场行，重启后市场入口消失。')) return;
  busy = true;
  try {
    market = await window.pluginCenter.webMarket[action]();
    notice.className = 'notice';
    notice.textContent = '操作完成。重启 DSH 后生效；当前会话不受影响。';
    render();
  } catch (error) { showError(error); }
  finally { busy = false; }
}

function showError(error) {
  notice.className = 'notice error';
  notice.textContent = `操作失败：${error?.message || error}`;
}

document.querySelectorAll('.tab').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((item) => item.classList.remove('active'));
  button.classList.add('active'); tab = button.dataset.tab;
  if (tab === 'market') refresh(); else render();
}));
document.getElementById('refresh').addEventListener('click', refresh);
document.getElementById('folder').addEventListener('click', () => window.pluginCenter.openFolder());
refresh();

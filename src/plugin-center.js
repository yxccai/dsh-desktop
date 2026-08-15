'use strict';

const content = document.getElementById('content');
const notice = document.getElementById('notice');
let snapshot = null;
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

function render() {
  if (!snapshot) return;
  let items = snapshot.recommended;
  if (tab === 'installed') items = snapshot.recommended.filter((plugin) => ['enabled', 'disabled', 'conflict'].includes(plugin.status));
  if (tab === 'external') items = snapshot.external;
  content.innerHTML = items.length ? `<div class="grid">${items.map(card).join('')}</div>` : '<div class="empty">暂无内容</div>';
  content.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => mutate(button.dataset.action, button.dataset.id)));
}

async function refresh() {
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

function showError(error) {
  notice.className = 'notice error';
  notice.textContent = `操作失败：${error?.message || error}`;
}

document.querySelectorAll('.tab').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((item) => item.classList.remove('active'));
  button.classList.add('active'); tab = button.dataset.tab; render();
}));
document.getElementById('refresh').addEventListener('click', refresh);
document.getElementById('folder').addEventListener('click', () => window.pluginCenter.openFolder());
refresh();

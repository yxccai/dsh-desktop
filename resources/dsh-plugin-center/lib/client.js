window.__ModuleLoader__.load({
  id: "@yxccai/dsh-desktop-plugin-center",
  factory: (require) => {
    const module = { exports: {} };
    const React = require("react");
    const ReactDOM = require("react-dom");
    const api = window.dshDesktop;
    let projectPanelColumn = null;
    let projectPanelLayout = null;
    let projectPanelCurrentRoot = '';
    const turnFileGroups = new Map();
    const OCEAN_THEME_ID = 'desktop-ocean-theme';
    const CUSTOM_BACKGROUND_ID = 'desktop-custom-background';
    const OCEAN_TOKENS = {
      '--dsw-alias-bg-base': { light: '#e9f7fb', dark: '#06131f' },
      '--dsw-alias-bg-layer-1': { light: '#f5fcfe', dark: '#0b2030' },
      '--dsw-alias-bg-layer-2': { light: '#dff3f8', dark: '#102b3d' },
      '--dsw-alias-bg-overlay': { light: '#ffffff', dark: '#153447' },
      '--dsw-alias-border-l1': { light: '#b9dce5', dark: '#21465b' },
      '--dsw-alias-border-l2': { light: '#8fc7d5', dark: '#2c5d72' },
      '--dsw-alias-brand-primary': { light: '#087f9d', dark: '#48d7ee' },
      '--dsw-alias-label-primary': { light: '#0b2d3b', dark: '#e2f8fc' },
      '--dsw-alias-label-secondary': { light: '#456b77', dark: '#94bac5' },
      '--dsw-specific-sidebar-fill': { light: '#d8eff5', dark: '#081b29' }
    };
    const h = React.createElement;

    function PluginCenterTab() {
      const [state, setState] = React.useState({ loading: true, data: null, error: "" });
      const refresh = async () => { try { setState({ loading: false, data: await api.pluginCenter.list(), error: "" }); } catch (error) { setState({ loading: false, data: null, error: error?.message || String(error) }); } };
      React.useEffect(() => { refresh(); }, []);
      const act = async (action, id) => { try { setState({ loading: false, data: await api.pluginCenter[action](id), error: "" }); window.dispatchEvent(new Event('dsh-desktop-plugin-catalog-change')); } catch (error) { setState((old) => ({ ...old, error: error?.message || String(error) })); } };
      const button = (label, action, id, danger) => h("button", { className: danger ? "dpc-danger" : "", onClick: () => act(action, id) }, label);
      const chooseBackground = async () => { try { await api.pluginCenter.backgroundPick(); window.dispatchEvent(new Event('dsh-desktop-plugin-catalog-change')); } catch (error) { setState((old) => ({ ...old, error: error?.message || String(error) })); } };
      const clearBackground = async () => { try { await api.pluginCenter.backgroundClear(); window.dispatchEvent(new Event('dsh-desktop-plugin-catalog-change')); } catch (error) { setState((old) => ({ ...old, error: error?.message || String(error) })); } };
      const cards = (state.data?.recommended || []).map((plugin) => {
        const actions = [];
        if (plugin.status === "available") actions.push(button("安装", "install", plugin.id));
        if (plugin.status === "enabled" && plugin.owned) actions.push(button("停用", "disable", plugin.id), button("卸载", "uninstall", plugin.id, true));
        if (plugin.status === "disabled" && plugin.owned) actions.push(button("启用", "enable", plugin.id), button("卸载", "uninstall", plugin.id, true));
        const status = ({ available: "可安装", enabled: "已启用", disabled: "已停用", conflict: "名称冲突" })[plugin.status] || plugin.status;
        if (plugin.id === CUSTOM_BACKGROUND_ID && plugin.status === 'enabled') actions.push(h('button', { key: 'pick', onClick: chooseBackground }, '选择背景图片'), h('button', { key: 'clear', onClick: clearBackground }, '清除图片'));
        return h("article", { className: "dpc-card", key: plugin.id }, h("div", { className: "dpc-head" }, h("strong", null, plugin.name), h("span", null, status)), h("p", null, plugin.description), h("div", { className: "dpc-meta" }, `${plugin.author} · ${plugin.version}`), h("div", { className: "dpc-actions" }, ...actions));
      });
      return h("section", { className: "dpc-root" }, h("div", { className: "dpc-title" }, h("div", null, h("h2", null, "插件中心"), h("p", null, "安装和管理 DSH Desktop 推荐的 Agent Preset。")), h("button", { onClick: refresh }, "刷新")), h("div", { className: "dpc-note" }, "变更会在新会话中生效，当前会话不会被中断。"), state.error ? h("div", { className: "dpc-error" }, state.error) : null, state.loading ? h("p", null, "正在加载…") : h("div", { className: "dpc-grid" }, ...cards));
    }

    function workspaceOf(useSessions, useWorkspaces, sessionId) {
      const summary = useSessions((state) => sessionId ? state.byId[sessionId] : undefined);
      const items = useWorkspaces((state) => state.items);
      return items.find((item) => item.sessionIds.includes(sessionId)) || (summary?.cwd ? { path: summary.cwd, title: summary.cwd.split(/[\\/]/).filter(Boolean).pop() } : null);
    }

    function relativeTurnPath(root, value) {
      const normalizedRoot = String(root || '').replaceAll('\\', '/').replace(/\/$/, '');
      const normalized = String(value || '').replaceAll('\\', '/');
      if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith('/')) {
        if (normalized.toLowerCase().startsWith(`${normalizedRoot.toLowerCase()}/`)) return normalized.slice(normalizedRoot.length + 1);
        return null;
      }
      if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) return null;
      return normalized.replace(/^\.\//, '');
    }

    function ConversationFiles({ matched, useSessions, sessionId }) {
      const summary = useSessions((state) => sessionId ? state.byId[sessionId] : undefined);
      const root = summary?.cwd;
      const paths = (matched?.paths || []).map((value) => relativeTurnPath(root, value)).filter(Boolean);
      React.useEffect(() => {
        if (!root || !paths.length) return;
        turnFileGroups.set(`${root}\u0000${matched.turn}`, { root, turn: matched.turn, paths });
        window.dispatchEvent(new CustomEvent('dsh-desktop-turn-files', { detail: { root, turn: matched.turn, paths } }));
        let cancelled = false;
        const frame = requestAnimationFrame(() => requestAnimationFrame(() => { if (!cancelled) window.dispatchEvent(new CustomEvent("dsh-desktop-turn-file", { detail: { root, turn: matched.turn, path: paths[paths.length - 1] } })); }));
        return () => { cancelled = true; cancelAnimationFrame(frame); };
      }, [root, matched?.turn, paths.join('\n')]);
      if (!root || !paths.length) return null;
      return h("div", { className: "dpp-conversation-files" }, h("span", null, `回复 ${matched.turn} 修改：`), ...paths.map((filePath) => h("button", { key: filePath, onClick: () => window.dispatchEvent(new CustomEvent("dsh-desktop-turn-file", { detail: { root, turn: matched.turn, path: filePath } })) }, filePath.split(/[\\/]/).pop())));
    }

    function ProjectPanelToggle({ useSessions, useWorkspaces, useSession, sessionId }) {
      const workspace = workspaceOf(useSessions, useWorkspaces, sessionId);
      const completedTurn = useSession((state) => { let latest = 0; state.turnEnds.forEach((value, key) => { if (key > latest) latest = key; }); return latest; });
      const observedTurns = React.useRef(new Map());
      React.useEffect(() => {
        if (!workspace) return;
        const observed = observedTurns.current.get(sessionId) ?? completedTurn;
        observedTurns.current.set(sessionId, completedTurn);
        if (completedTurn <= observed) return;
        api.projectPanel.snapshot(workspace.path, `回复 ${completedTurn}`, completedTurn).catch((error) => console.error('project snapshot failed', error));
      }, [sessionId, workspace?.path, completedTurn]);
      if (!workspace) return null;
      return h("button", { className: "dpp-toggle", title: "项目面板", onClick: () => window.dispatchEvent(new CustomEvent("dsh-desktop-project-panel-toggle", { detail: { root: workspace.path } })) }, "▱ 项目");
    }

    function TreeNode({ root, item, level, onOpen }) {
      const [open, setOpen] = React.useState(false);
      const [children, setChildren] = React.useState([]);
      const click = async () => {
        if (item.kind !== "directory") return onOpen(item.path);
        if (!open) setChildren((await api.projectPanel.list(root, item.path)).items);
        setOpen(!open);
      };
      return h(React.Fragment, null,
        h("button", { className: "dpp-tree-row", style: { paddingLeft: `${10 + level * 14}px` }, onClick: click }, h("span", null, item.kind === "directory" ? (open ? "▾" : "▸") : "·"), h("span", { className: item.kind === "directory" ? "dpp-folder" : "" }, item.name)),
        open ? children.map((child) => h(TreeNode, { key: child.path, root, item: child, level: level + 1, onOpen })) : null);
    }

    const CODE_KEYWORDS = new Set('alignas alignof and asm auto bool break case catch char class const constexpr continue default delete do double else enum explicit export extern false float for friend goto if inline int long namespace new noexcept nullptr operator override private protected public register reinterpret_cast return short signed sizeof static static_assert struct switch template this throw true try typedef typename union unsigned using virtual void volatile wchar_t while include define import from as async await function let var interface extends implements package yield const'.split(' '));
    const CODE_TYPES = new Set('string vector map set unordered_map unique_ptr shared_ptr optional variant size_t uint8_t uint16_t uint32_t uint64_t int8_t int16_t int32_t int64_t std console number boolean object'.split(' '));
    function highlightLine(line) {
      const parts = []; const regex = /(\/\/.*$|#[ \t]*[A-Za-z_]+|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b)/g; let at = 0; let match;
      while ((match = regex.exec(line))) { if (match.index > at) parts.push(line.slice(at, match.index)); const value = match[0]; let cls = 'dpp-token-name'; if (value.startsWith('//')) cls = 'dpp-token-comment'; else if (value[0] === '"' || value[0] === "'") cls = 'dpp-token-string'; else if (/^\d/.test(value)) cls = 'dpp-token-number'; else if (value.startsWith('#')) cls = 'dpp-token-pre'; else if (CODE_KEYWORDS.has(value)) cls = 'dpp-token-keyword'; else if (CODE_TYPES.has(value) || /^[A-Z]/.test(value)) cls = 'dpp-token-type'; parts.push(h('span', { className: cls, key: `${match.index}-${value}` }, value)); at = regex.lastIndex; }
      if (at < line.length) parts.push(line.slice(at)); return parts;
    }
    function CodeViewer({ content }) { return h('div', { className: 'dpp-code-viewer' }, ...content.split(/\r?\n/).map((line, index) => h('div', { className: 'dpp-code-line', key: index }, h('span', { className: 'dpp-line-number' }, index + 1), h('code', null, ...highlightLine(line))))); }
    function DiffViewer({ content }) { return h('div', { className: 'dpp-diff-viewer' }, ...content.split(/\r?\n/).map((line, index) => { let cls = 'dpp-diff-context'; if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ')) cls = 'dpp-diff-meta'; else if (line.startsWith('@@')) cls = 'dpp-diff-hunk'; else if (line.startsWith('+')) cls = 'dpp-diff-add'; else if (line.startsWith('-')) cls = 'dpp-diff-del'; return h('div', { className: `dpp-diff-line ${cls}`, key: index }, h('span', { className: 'dpp-line-number' }, index + 1), h('code', null, line || ' ')); })); }
    function TextPreview({ file, draft, setDraft, mode }) {
      if (mode === "source") return h(CodeViewer, { content: file.content });
      if (file.kind === "html") return h("iframe", { className: "dpp-frame", sandbox: "", srcDoc: file.content });
      if (file.kind === "csv") { const rows = file.content.split(/\r?\n/).slice(0, 500).map((line) => line.split(file.path.endsWith('.tsv') ? '\t' : ',')); return h("div", { className: "dpp-table-wrap" }, h("table", null, h("tbody", null, ...rows.map((row, i) => h("tr", { key: i }, ...row.map((cell, j) => h(i === 0 ? "th" : "td", { key: j }, cell))))))); }
      if (file.kind === "markdown") return h("div", { className: "dpp-markdown" }, ...file.content.split(/\r?\n/).map((line, i) => line.startsWith("# ") ? h("h1", { key: i }, line.slice(2)) : line.startsWith("## ") ? h("h2", { key: i }, line.slice(3)) : line.startsWith("### ") ? h("h3", { key: i }, line.slice(4)) : h("p", { key: i }, line || " ")));
      if (file.kind === 'diff') return h(DiffViewer, { content: file.content });
      return h(CodeViewer, { content: file.content });
    }

    function Preview({ root, file, onSaved, onDraft }) {
      const [mode, setMode] = React.useState("preview");
      const [split, setSplit] = React.useState(false);
      React.useEffect(() => { setMode("preview"); }, [file?.path, file?.modifiedAt]);
      if (!file) return h("div", { className: "dpp-empty" }, "从文件树或变更列表打开文件");
      const draft = file.draft ?? file.content ?? "";
      const setDraft = (value) => onDraft(file.path, value);
      const save = async () => { const result = await api.projectPanel.save(root, file.path, draft, file.modifiedAt); onSaved({ ...file, content: draft, draft: draft, ...result }); };
      const rich = file.kind === "image" ? h("img", { className: "dpp-image", src: `data:${file.mime};base64,${file.data}` }) : file.kind === "pdf" ? h("iframe", { className: "dpp-frame", src: `data:${file.mime};base64,${file.data}` }) : file.kind === "office" || file.kind === "binary" ? h("div", { className: "dpp-empty" }, h("p", null, `${file.name} 暂不支持内置渲染`), h("button", { onClick: () => api.projectPanel.openExternal(root, file.path) }, "用系统应用打开")) : h(TextPreview, { file: { ...file, content: draft }, draft, setDraft, mode });
      return h("div", { className: "dpp-preview" },
        h("div", { className: "dpp-preview-bar" }, h("strong", null, file.name), h("span", { className: "dpp-spacer" }), file.editable ? h(React.Fragment, null, h("button", { onClick: () => setMode(mode === "source" ? "preview" : "source") }, mode === "source" ? "预览" : "源码"), h("button", { onClick: () => setSplit(!split) }, split ? "单栏" : "分屏"), h("button", { onClick: save, disabled: draft === file.content }, "保存")) : null),
        h("div", { className: `dpp-preview-body ${split ? 'split' : ''}` }, file.editable && (mode === "source" || split) ? h("textarea", { value: draft, onChange: (event) => setDraft(event.target.value), spellCheck: false }) : null, split ? h(TextPreview, { file: { ...file, content: draft }, draft, setDraft, mode: "preview" }) : mode === "source" ? null : rich));
    }

    function Changes({ root, onOpen }) {
      const [status, setStatus] = React.useState({ changes: [], branch: "" });
      const [history, setHistory] = React.useState([]);
      const [turnChanges, setTurnChanges] = React.useState(() => Array.from(turnFileGroups.values()).filter((item) => item.root === root).sort((a, b) => b.turn - a.turn));
      const [error, setError] = React.useState("");
      const [notice, setNotice] = React.useState("");
      const refresh = async () => { try { setStatus(await api.projectPanel.gitStatus(root)); setHistory(await api.projectPanel.history(root)); setError(""); } catch (e) { setError(e.message); } };
      React.useEffect(() => { refresh(); }, [root]);
      React.useEffect(() => { setTurnChanges(Array.from(turnFileGroups.values()).filter((item) => item.root === root).sort((a, b) => b.turn - a.turn).slice(0, 20)); const listener = (event) => { if (event.detail.root === root) setTurnChanges((old) => [{ turn: event.detail.turn, paths: event.detail.paths }, ...old.filter((x) => x.turn !== event.detail.turn)].sort((a, b) => b.turn - a.turn).slice(0, 20)); }; window.addEventListener('dsh-desktop-turn-files', listener); return () => window.removeEventListener('dsh-desktop-turn-files', listener); }, [root]);
      const diff = async (item) => { const data = await api.projectPanel.gitDiff(root, item.path, false); onOpen({ path: item.path, name: item.path.split('/').pop(), kind: 'diff', content: data.content, editable: false }); };
      const discard = async (item) => { if (confirm(`撤销 ${item.path} 的工作区修改？`)) { await api.projectPanel.discard(root, item.path); refresh(); } };
      const snapshot = async () => { try { const next = await api.projectPanel.snapshot(root, `手动快照 ${new Date().toLocaleString()}`, null); setHistory(next); setNotice(`快照已记录：${next[0]?.label || ''}`); setError(''); } catch (e) { setError(e.message); } };
      const turnDiff = async (group, filePath) => { try { const snap = history.find((item) => item.turn === group.turn); let data = snap ? await api.projectPanel.snapshotDiff(root, snap.id, filePath) : { content: '' }; if (!data.content) data = await api.projectPanel.committedFileDiff(root, filePath); if (!data.content) return api.projectPanel.read(root, filePath).then(onOpen); onOpen({ path: `回复 ${group.turn} · ${filePath}`, name: filePath.split('/').pop(), kind: 'diff', content: data.content, editable: false }); } catch (e) { setError(e.message); } };
      const undoTurnFile = async (group, filePath) => { const snap = history.find((item) => item.turn === group.turn); if (!snap) return setError('找不到该回复对应的修改快照'); if (!confirm(`撤销回复 ${group.turn} 对 ${filePath} 的修改？\n这会在当前工作区产生反向变更，不会改写 Git 提交。`)) return; try { await api.projectPanel.revertSnapshotFile(root, snap.id, filePath); await refresh(); setNotice(`已撤销：${filePath}`); window.dispatchEvent(new CustomEvent('dsh-desktop-project-refresh', { detail: { root } })); } catch (e) { setError(e.message); } };
      const revert = async (item) => { if (confirm(`恢复项目工作区到“${item.label}”？\n只影响 ${root}，不会修改 Windows 桌面的副本。`)) { try { await api.projectPanel.revertSnapshot(root, item.id); await refresh(); setNotice(`项目已恢复到：${item.label}`); window.dispatchEvent(new CustomEvent('dsh-desktop-project-refresh', { detail: { root } })); } catch (e) { setError(e.message); } } };
      return h("div", { className: "dpp-changes" }, error ? h("div", { className: "dpp-error" }, error) : null, notice ? h("div", { className: "dpp-notice" }, notice) : null, h("div", { className: "dpp-section-title" }, h("strong", null, "本次对话变更（提交后仍保留）")), ...turnChanges.flatMap((group) => [h("div", { className: "dpp-turn-label", key: `turn-${group.turn}` }, `回复 ${group.turn}`), ...group.paths.map((filePath) => h("div", { className: "dpp-change", key: `${group.turn}-${filePath}` }, h("button", { onClick: () => turnDiff(group, filePath) }, h("span", { className: "dpp-status" }, "M "), filePath), h("button", { className: "dpp-danger", onClick: () => undoTurnFile(group, filePath) }, "撤销")))]), h("div", { className: "dpp-section-title" }, h("strong", null, status.available === false ? "Git 工作区 · 未启用 Git" : `Git 工作区 ${status.branch ? `· ${status.branch}` : ''}`), h("button", { onClick: refresh }, "刷新"), h("button", { onClick: snapshot }, "记录快照")), ...status.changes.map((item) => h("div", { className: "dpp-change", key: item.path }, h("button", { onClick: () => diff(item) }, h("span", { className: "dpp-status" }, `${item.index}${item.worktree}`), item.path), h("button", { className: "dpp-danger", onClick: () => discard(item) }, "撤销"))), h("div", { className: "dpp-section-title" }, h("strong", null, "修改快照")), ...history.map((item) => h("div", { className: "dpp-history", key: item.id }, h("div", null, h("strong", null, item.turn ? `回复 ${item.turn}` : item.label), h("small", null, new Date(item.createdAt).toLocaleString())), h("button", { onClick: () => revert(item) }, "恢复"))));
    }

    function ProjectPanel({ useSessions, useWorkspaces }) {
      const current = useSessions((state) => state.current);
      const workspace = workspaceOf(useSessions, useWorkspaces, current);
      const root = workspace?.path;
      projectPanelCurrentRoot = root || '';
      const [open, setOpen] = React.useState(false);
      const [width, setWidth] = React.useState(520);
      const [tab, setTab] = React.useState("files");
      const [files, setFiles] = React.useState([]);
      const [active, setActive] = React.useState(null);
      const [column, setColumn] = React.useState(projectPanelColumn);
      React.useEffect(() => { const sync = () => setColumn(projectPanelColumn); window.addEventListener('dsh-desktop-project-column', sync); sync(); return () => window.removeEventListener('dsh-desktop-project-column', sync); }, []);
      React.useEffect(() => {
        let live = true;
        setOpen(false); setFiles([]); setActive(null);
        if (!root) return () => { live = false; };
        api.projectPanel.getState(root).then((s) => { if (live) { setWidth(s.width); setOpen(!s.collapsed); setTab(s.activeTab); } }).catch((e) => console.error('project panel state failed', e));
        return () => { live = false; };
      }, [root]);
      const openPath = async (value) => {
        const file = typeof value === 'string' ? await api.projectPanel.read(root, value) : value;
        const opened = { ...file, draft: file.content };
        setFiles((old) => old.some((x) => x.path === opened.path) ? old.map((x) => x.path === opened.path ? { ...opened, draft: x.draft ?? opened.content } : x) : [...old, opened]);
        setActive((old) => old?.path === opened.path ? { ...opened, draft: old.draft ?? opened.content } : opened);
        setTab('files'); setOpen(true);
      };
      React.useEffect(() => {
        const listener = (event) => { if (root && event.detail.root === root) openPath(event.detail.path); };
        const turnListener = async (event) => { if (!root || event.detail.root !== root) return; try { const history = await api.projectPanel.history(root); const snap = history.find((item) => item.turn === event.detail.turn); if (!snap) return openPath(event.detail.path); const data = await api.projectPanel.snapshotDiff(root, snap.id, event.detail.path); openPath({ path: `回复 ${event.detail.turn} · ${event.detail.path}`, name: event.detail.path.split(/[\\/]/).pop(), kind: 'diff', content: data.content || '该文件没有可显示的变更。', editable: false }); } catch (error) { console.error('turn preview failed', error); openPath(event.detail.path); } };
        const refreshListener = (event) => { if (event.detail.root !== root) return; setFiles([]); setActive(null); };
        window.addEventListener('dsh-desktop-project-file', listener); window.addEventListener('dsh-desktop-turn-file', turnListener); window.addEventListener('dsh-desktop-project-refresh', refreshListener); return () => { window.removeEventListener('dsh-desktop-project-file', listener); window.removeEventListener('dsh-desktop-turn-file', turnListener); window.removeEventListener('dsh-desktop-project-refresh', refreshListener); };
      }, [root]);
      React.useEffect(() => {
        const listener = (event) => { if (!root || event.detail.root === root) { const next = !open; setOpen(next); api.projectPanel.setState(root, { width, collapsed: !next, activeTab: tab }); } };
        window.addEventListener('dsh-desktop-project-panel-toggle', listener); return () => window.removeEventListener('dsh-desktop-project-panel-toggle', listener);
      }, [root, open, width, tab]);
      React.useEffect(() => { const listener = (event) => { const next = event.detail.width; setWidth(next); if (event.detail.persist) api.projectPanel.setState(root, { width: next, collapsed: false, activeTab: tab }); }; window.addEventListener('dsh-desktop-project-width', listener); return () => window.removeEventListener('dsh-desktop-project-width', listener); }, [root, tab]);
      React.useLayoutEffect(() => { projectPanelLayout?.setPanel(open ? width : 0); }, [root, open, width]);
      if (!root || !open || !column) return null;
      const updateDraft = (filePath, draft) => { setFiles((old) => old.map((x) => x.path === filePath ? { ...x, draft } : x)); setActive((old) => old?.path === filePath ? { ...old, draft } : old); };
      const closeTab = (event, file) => { event.stopPropagation(); if (file.editable && file.draft !== file.content && !confirm(`放弃 ${file.name} 的未保存修改？`)) return; const next = files.filter((x) => x.path !== file.path); setFiles(next); if (active?.path === file.path) setActive(next.at(-1) || null); };
      const changeTab = (value) => { setTab(value); api.projectPanel.setState(root, { width, collapsed: false, activeTab: value }); };
      const tabs = h("div", { className: "dpp-tabs" }, ...files.map((file) => h("button", { className: active?.path === file.path ? 'active' : '', key: file.path, onClick: () => setActive(file) }, file.name, h("span", { onClick: (e) => closeTab(e, file) }, " ×"))));
      return ReactDOM.createPortal(h("aside", { className: "dpp-panel" }, h("header", null, h("strong", null, workspace.title || root.split(/[\\/]/).pop()), h("button", { onClick: () => { setOpen(false); api.projectPanel.setState(root, { width, collapsed: true, activeTab: tab }); } }, "×")), h("nav", null, h("button", { className: tab === 'files' ? 'active' : '', onClick: () => changeTab('files') }, "预览"), h("button", { className: tab === 'changes' ? 'active' : '', onClick: () => changeTab('changes') }, "变更")), tab === 'files' ? h("main", { className: "dpp-preview-main" }, tabs, h(Preview, { root, file: active, onSaved: openPath, onDraft: updateDraft })) : h(Changes, { root, onOpen: openPath })), column);
    }

    const css = `.dpc-root{width:100%;max-width:820px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:14px}.dpc-title,.dpc-head,.dpp-section-title{display:flex;align-items:center;justify-content:space-between}.dpc-title h2,.dpc-title p,.dpc-card p{margin:0}.dpc-title p,.dpc-meta,.dpc-note{color:var(--dsw-alias-label-secondary);font-size:13px}.dpc-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.dpc-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:10px;padding:16px;display:flex;flex-direction:column;gap:12px}.dpc-actions,.dpp-actions{display:flex;gap:8px}.dpc-root button,.dpp-panel button,.dpp-toggle{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:7px;padding:6px 10px;cursor:pointer}.dpc-danger,.dpp-danger,.dpp-error{color:var(--dsw-alias-state-error-primary)!important}.dpc-note{padding:10px 12px;border-radius:8px;background:var(--dsw-alias-bg-layer-2)}.dpp-toggle{height:30px}.dpp-panel{pointer-events:auto;width:100%;height:100%;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;min-width:0}.dpp-frame-resizer:after{content:"";position:absolute;left:9px;top:0;bottom:0;width:2px;background:transparent;transition:background .15s}.dpp-frame-resizer:hover:after{background:var(--dsw-alias-brand-primary)}.dpp-panel>header{height:48px;display:flex;align-items:center;gap:8px;padding:0 12px;border-bottom:1px solid var(--dsw-alias-border-l2)}.dpp-panel>header strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dpp-panel>header button{margin-left:auto}.dpp-panel>nav{display:flex;padding:8px;gap:6px;border-bottom:1px solid var(--dsw-alias-border-l2)}.dpp-panel>nav button.active,.dpp-tabs button.active{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}.dpp-work{display:grid;grid-template-columns:210px minmax(0,1fr);flex:1;min-height:0}.dpp-tree{border-right:1px solid var(--dsw-alias-border-l2);display:flex;flex-direction:column;min-width:0}.dpp-tree input{margin:8px;padding:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-layer-1);color:inherit}.dpp-tree-list{overflow:auto;flex:1}.dpp-tree-row{width:100%;border:0!important;border-radius:0!important;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:transparent!important;padding-top:5px!important;padding-bottom:5px!important}.dpp-tree-row:hover{background:var(--dsw-alias-bg-layer-2)!important}.dpp-folder{font-weight:600}.dpp-work>main{display:flex;flex-direction:column;min-width:0;min-height:0}.dpp-tabs{display:flex;overflow:auto;border-bottom:1px solid var(--dsw-alias-border-l2);padding:5px;gap:4px}.dpp-tabs button{white-space:nowrap}.dpp-preview{display:flex;flex-direction:column;flex:1;min-height:0}.dpp-preview-bar{height:42px;display:flex;align-items:center;gap:6px;padding:0 10px;border-bottom:1px solid var(--dsw-alias-border-l2)}.dpp-spacer{flex:1}.dpp-preview-body{flex:1;min-height:0;overflow:auto}.dpp-preview-body.split{display:grid;grid-template-columns:1fr 1fr}.dpp-preview-body textarea{resize:none;border:0;border-right:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:inherit;padding:12px;font:13px/1.55 Consolas,monospace;outline:none}.dpp-code{margin:0;padding:14px;white-space:pre-wrap;word-break:break-word;font:13px/1.55 Consolas,monospace}.dpp-code-viewer,.dpp-diff-viewer{height:100%;overflow:auto;padding:8px 0 18px;background:var(--dsw-alias-bg-layer-1);font:13px/1.65 Consolas,'Cascadia Code',monospace}.dpp-code-line,.dpp-diff-line{display:grid;grid-template-columns:48px minmax(max-content,1fr);min-height:22px;white-space:pre}.dpp-code-line:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 7%,transparent)}.dpp-line-number{position:sticky;left:0;text-align:right;padding:0 12px 0 6px;color:var(--dsw-alias-label-secondary);opacity:.55;user-select:none;background:inherit;border-right:1px solid var(--dsw-alias-border-l1)}.dpp-code-line code,.dpp-diff-line code{padding:0 12px}.dpp-token-keyword{color:#c586c0}.dpp-token-type{color:#4ec9b0}.dpp-token-string{color:#ce9178}.dpp-token-comment{color:#6a9955;font-style:italic}.dpp-token-number{color:#b5cea8}.dpp-token-pre{color:#c8c8c8}.dpp-token-name{color:#9cdcfe}.dpp-diff-add{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 16%,transparent);border-left:3px solid var(--dsw-alias-state-success-primary)}.dpp-diff-del{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 16%,transparent);border-left:3px solid var(--dsw-alias-state-error-primary)}.dpp-diff-hunk{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent);color:var(--dsw-alias-brand-primary)}.dpp-diff-meta{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2)}.dpp-diff-context{border-left:3px solid transparent}.dpp-frame{width:100%;height:100%;border:0;background:white}.dpp-image{display:block;max-width:100%;max-height:100%;margin:auto}.dpp-markdown{padding:18px;line-height:1.6}.dpp-markdown p{white-space:pre-wrap}.dpp-table-wrap{overflow:auto;padding:10px}.dpp-table-wrap table{border-collapse:collapse}.dpp-table-wrap th,.dpp-table-wrap td{border:1px solid var(--dsw-alias-border-l2);padding:5px 8px;white-space:nowrap}.dpp-empty{height:100%;display:grid;place-content:center;text-align:center;color:var(--dsw-alias-label-secondary)}.dpp-changes{overflow:auto;padding:10px;flex:1}.dpp-section-title{margin:8px 0;gap:5px}.dpp-section-title button:first-of-type{margin-left:auto}.dpp-change,.dpp-history{display:flex;align-items:center;gap:6px;border-bottom:1px solid var(--dsw-alias-border-l2);padding:7px 0}.dpp-change>button:first-child{flex:1;text-align:left;border:0;background:transparent}.dpp-status{display:inline-block;width:28px;color:var(--dsw-alias-state-warn-primary)}.dpp-notice{padding:7px 9px;margin-bottom:8px;border-radius:6px;color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent)}.dpp-turn-label{margin:8px 0 3px;color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600}.dpp-turn-file{display:block!important;width:100%;text-align:left;margin:3px 0;border:0!important;background:var(--dsw-alias-bg-layer-2)!important;color:var(--dsw-alias-brand-primary)!important;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dpp-history>div{flex:1;display:flex;flex-direction:column}.dpp-history small{color:var(--dsw-alias-label-secondary)}@media(max-width:760px){.dpc-grid{grid-template-columns:1fr}.dpp-work{grid-template-columns:150px minmax(0,1fr)}}`;

    function parseGridTracks(input) {
      const tracks = []; let depth = 0; let current = '';
      for (const char of input) { if (char === '(') depth++; if (char === ')') depth = Math.max(0, depth - 1); if (char === ' ' && depth === 0) { if (current) { tracks.push(current); current = ''; } } else current += char; }
      if (current) tracks.push(current); return tracks;
    }

    function mountProjectColumn() {
      let frame = null; let column = null; let handle = null; let observer = null; let shellTracks = [];
      let panelWidth = 0; let dragStartX = 0; let dragStartWidth = 0;
      const applyGrid = () => { if (frame && shellTracks.length === 3) frame.style.gridTemplateColumns = `${shellTracks[0]} minmax(0, 1fr) ${shellTracks[2]} ${Math.round(panelWidth)}px`; if (column) column.style.visibility = panelWidth > 0 ? 'visible' : 'hidden'; if (handle && frame) { handle.style.display = panelWidth > 0 ? 'block' : 'none'; handle.style.left = `${Math.round(frame.getBoundingClientRect().width - panelWidth)}px`; } };
      const attach = () => {
        if (frame) return;
        const found = document.querySelector('[data-dsh-frame]') || document.querySelector('[class*="sidebarCol"]')?.parentElement;
        if (!found) return;
        frame = found;
        const tracks = parseGridTracks(frame.style.gridTemplateColumns);
        if (tracks.length === 3) shellTracks = tracks;
        column = document.createElement('div'); column.dataset.dppPreviewColumn = ''; column.style.cssText = 'min-width:0;overflow:visible;display:flex;flex-direction:column;border-left:1px solid var(--dsw-alias-border-l2);position:relative;z-index:21'; frame.appendChild(column); projectPanelColumn = column; window.dispatchEvent(new Event('dsh-desktop-project-column'));
        handle = document.createElement('div'); handle.className = 'dpp-frame-resizer'; handle.style.cssText = 'position:absolute;top:0;bottom:0;width:20px;margin-left:-10px;z-index:40;cursor:col-resize;display:none';
        const move = (event) => { event.preventDefault(); const next = Math.max(320, Math.min(1000, dragStartWidth + dragStartX - event.clientX)); panelWidth = next; applyGrid(); window.dispatchEvent(new CustomEvent('dsh-desktop-project-width', { detail: { width: next } })); };
        const up = () => { document.body.style.cursor = ''; document.body.style.userSelect = ''; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
        handle.addEventListener('pointerdown', (event) => { event.preventDefault(); dragStartX = event.clientX; dragStartWidth = panelWidth; document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); });
        handle.addEventListener('dblclick', () => { panelWidth = 520; applyGrid(); window.dispatchEvent(new CustomEvent('dsh-desktop-project-width', { detail: { width: 520, persist: true } })); });
        frame.appendChild(handle);
        const sync = new MutationObserver(() => { const next = parseGridTracks(frame.style.gridTemplateColumns); if (next.length === 3) { shellTracks = next; applyGrid(); } });
        sync.observe(frame, { attributes: true, attributeFilter: ['style'] });
        observer = sync; applyGrid();
      };
      const wait = new MutationObserver(attach); wait.observe(document.body, { childList: true, subtree: true }); attach();
      projectPanelLayout = { setPanel(width) { panelWidth = width; applyGrid(); } };
      return () => { wait.disconnect(); observer?.disconnect(); if (frame && shellTracks.length === 3) frame.style.gridTemplateColumns = shellTracks.join(' '); handle?.remove(); column?.remove(); projectPanelColumn = null; projectPanelLayout = null; };
    }

    function interceptProducedFileClicks() {
      const listener = (event) => {
        const button = event.target?.closest?.('[data-produced-files-row] button[title]');
        if (!button || !projectPanelCurrentRoot) return;
        const filePath = button.getAttribute('title');
        if (!filePath || filePath === '.') return;
        event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
        window.dispatchEvent(new CustomEvent('dsh-desktop-project-file', { detail: { root: projectPanelCurrentRoot, path: filePath } }));
      };
      document.addEventListener('click', listener, true);
      return () => document.removeEventListener('click', listener, true);
    }

    function applyManagedTheme(ctx) {
      const theme = ctx.get('theme');
      if (!theme || !api?.pluginCenter) return () => {};
      let disposeTokens = null; let style = null; let imageStyle = null; let cancelled = false;
      const sync = async () => {
        try {
          const snapshot = await api.pluginCenter.list();
          const item = snapshot.recommended?.find((entry) => entry.id === OCEAN_THEME_ID);
          const enabled = item?.status === 'enabled';
          if (enabled && !disposeTokens) {
            disposeTokens = theme.overrideTokens('dsh-desktop-ocean-theme', OCEAN_TOKENS);
            style = document.createElement('style'); style.dataset.dshDesktopTheme = OCEAN_THEME_ID;
            style.textContent = `body{background:radial-gradient(circle at 78% 8%,rgba(38,190,214,.18),transparent 34%),linear-gradient(145deg,var(--dsw-alias-bg-base),color-mix(in srgb,var(--dsw-alias-bg-base) 82%,#027f9b)) fixed!important}body:before{content:"";position:fixed;inset:0;pointer-events:none;z-index:0;background:linear-gradient(115deg,transparent 35%,rgba(73,215,238,.035) 50%,transparent 65%)}`;
            document.head.appendChild(style);
          } else if (!enabled && disposeTokens) { disposeTokens(); disposeTokens = null; style?.remove(); style = null; }
          const custom = snapshot.recommended?.find((entry) => entry.id === CUSTOM_BACKGROUND_ID)?.status === 'enabled';
          const background = custom ? await api.pluginCenter.backgroundGet() : null;
          imageStyle?.remove(); imageStyle = null;
          if (background?.dataUrl) { imageStyle = document.createElement('style'); imageStyle.dataset.dshDesktopTheme = CUSTOM_BACKGROUND_ID; imageStyle.textContent = `body{background-image:linear-gradient(rgba(4,12,20,.64),rgba(4,12,20,.72)),url(${JSON.stringify(background.dataUrl)})!important;background-position:center!important;background-size:cover!important;background-attachment:fixed!important}body [data-dsh-frame]{background:color-mix(in srgb,var(--dsw-alias-bg-base) 88%,transparent)!important;backdrop-filter:blur(10px)}`; document.head.appendChild(imageStyle); }
        } catch (error) { console.error('managed theme sync failed', error); }
      };
      sync(); const listener = () => { if (!cancelled) sync(); }; window.addEventListener('dsh-desktop-plugin-catalog-change', listener);
      return () => { cancelled = true; window.removeEventListener('dsh-desktop-plugin-catalog-change', listener); disposeTokens?.(); style?.remove(); imageStyle?.remove(); };
    }

    function apply(ctx) {
      const slots = ctx.get("slots");
      if (!slots || !api?.pluginCenter || !api?.projectPanel) return;
      ctx.effect(mountProjectColumn);
      ctx.effect(interceptProducedFileClicks);
      ctx.effect(() => applyManagedTheme(ctx));
      ctx.effect(() => { const style = document.createElement("style"); style.textContent = css + `.dpp-preview-main{display:flex;flex-direction:column;flex:1;min-height:0}.dpp-conversation-files{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-top:8px;color:var(--dsw-alias-label-secondary);font-size:12px}.dpp-conversation-files button{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-brand-primary);border-radius:6px;padding:3px 7px;cursor:pointer}`; document.head.appendChild(style); return () => style.remove(); });

      slots.inject("settings.plugins.tab", () => slots.register({ name: "settings.plugins.tab", id: "desktop-center", order: 20, label: "插件中心" }, PluginCenterTab));
      slots.inject("conversation.session.header.actions", () => slots.register({ name: "conversation.session.header.actions", id: "desktop-project-panel", order: 30, label: "项目" }, ProjectPanelToggle));
      slots.inject("conversation.chat.turnTail", () => slots.register({ name: "conversation.chat.turnTail", priority: -100, select: (owner) => { const data = owner.turn.data.get('deliverables'); if (!data) return null; const paths = []; const seen = new Set(); for (const item of data.produced) { if (item.seq <= owner.seq && !seen.has(item.path)) { seen.add(item.path); paths.push(item.path); } } return paths.length ? { turn: owner.turn.turn, paths } : null; } }, ConversationFiles));
      slots.inject("shell.overlay", () => slots.register({ name: "shell.overlay", id: "desktop-project-panel", order: 20 }, ProjectPanel));
    }

    module.exports.apply = apply;
    module.exports.inject = ["slots"];
    return module.exports;
  }
});

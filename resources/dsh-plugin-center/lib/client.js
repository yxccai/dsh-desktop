window.__ModuleLoader__.load({
  id: "@yxccai/dsh-desktop-plugin-center",
  factory: (require) => {
    const module = { exports: {} };
    const React = require("react");
    const api = window.dshDesktop;
    const h = React.createElement;

    function PluginCenterTab() {
      const [state, setState] = React.useState({ loading: true, data: null, error: "" });
      const refresh = async () => { try { setState({ loading: false, data: await api.pluginCenter.list(), error: "" }); } catch (error) { setState({ loading: false, data: null, error: error?.message || String(error) }); } };
      React.useEffect(() => { refresh(); }, []);
      const act = async (action, id) => { try { setState({ loading: false, data: await api.pluginCenter[action](id), error: "" }); } catch (error) { setState((old) => ({ ...old, error: error?.message || String(error) })); } };
      const button = (label, action, id, danger) => h("button", { className: danger ? "dpc-danger" : "", onClick: () => act(action, id) }, label);
      const cards = (state.data?.recommended || []).map((plugin) => {
        const actions = [];
        if (plugin.status === "available") actions.push(button("安装", "install", plugin.id));
        if (plugin.status === "enabled" && plugin.owned) actions.push(button("停用", "disable", plugin.id), button("卸载", "uninstall", plugin.id, true));
        if (plugin.status === "disabled" && plugin.owned) actions.push(button("启用", "enable", plugin.id), button("卸载", "uninstall", plugin.id, true));
        const status = ({ available: "可安装", enabled: "已启用", disabled: "已停用", conflict: "名称冲突" })[plugin.status] || plugin.status;
        return h("article", { className: "dpc-card", key: plugin.id }, h("div", { className: "dpc-head" }, h("strong", null, plugin.name), h("span", null, status)), h("p", null, plugin.description), h("div", { className: "dpc-meta" }, `${plugin.author} · ${plugin.version}`), h("div", { className: "dpc-actions" }, ...actions));
      });
      return h("section", { className: "dpc-root" }, h("div", { className: "dpc-title" }, h("div", null, h("h2", null, "插件中心"), h("p", null, "安装和管理 DSH Desktop 推荐的 Agent Preset。")), h("button", { onClick: refresh }, "刷新")), h("div", { className: "dpc-note" }, "变更会在新会话中生效，当前会话不会被中断。"), state.error ? h("div", { className: "dpc-error" }, state.error) : null, state.loading ? h("p", null, "正在加载…") : h("div", { className: "dpc-grid" }, ...cards));
    }

    function workspaceOf(useSessions, useWorkspaces, sessionId) {
      const summary = useSessions((state) => sessionId ? state.byId[sessionId] : undefined);
      const items = useWorkspaces((state) => state.items);
      return items.find((item) => item.sessionIds.includes(sessionId)) || (summary?.cwd ? { path: summary.cwd, title: summary.cwd.split(/[\\/]/).filter(Boolean).pop() } : null);
    }

    function ConversationFiles({ matched, useSessions, sessionId }) {
      const summary = useSessions((state) => sessionId ? state.byId[sessionId] : undefined);
      const root = summary?.cwd;
      if (!root || !matched?.length) return null;
      return h("div", { className: "dpp-conversation-files" }, h("span", null, "本次对话涉及文件："), ...matched.map((filePath) => h("button", { key: filePath, onClick: () => window.dispatchEvent(new CustomEvent("dsh-desktop-project-file", { detail: { root, path: filePath } })) }, filePath.split(/[\\/]/).pop())));
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

    function TextPreview({ file, draft, setDraft, mode }) {
      if (mode === "source") return h("pre", { className: "dpp-code" }, file.content);
      if (file.kind === "html") return h("iframe", { className: "dpp-frame", sandbox: "", srcDoc: file.content });
      if (file.kind === "csv") {
        const rows = file.content.split(/\r?\n/).slice(0, 500).map((line) => line.split(file.path.endsWith('.tsv') ? '\t' : ','));
        return h("div", { className: "dpp-table-wrap" }, h("table", null, h("tbody", null, ...rows.map((row, i) => h("tr", { key: i }, ...row.map((cell, j) => h(i === 0 ? "th" : "td", { key: j }, cell)))))));
      }
      if (file.kind === "markdown") return h("div", { className: "dpp-markdown" }, ...file.content.split(/\r?\n/).map((line, i) => line.startsWith("# ") ? h("h1", { key: i }, line.slice(2)) : line.startsWith("## ") ? h("h2", { key: i }, line.slice(3)) : line.startsWith("### ") ? h("h3", { key: i }, line.slice(4)) : h("p", { key: i }, line || " ")));
      return h("pre", { className: `dpp-code ${file.kind === 'diff' ? 'dpp-diff' : ''}` }, file.content);
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
      const [error, setError] = React.useState("");
      const refresh = async () => { try { setStatus(await api.projectPanel.gitStatus(root)); setHistory(await api.projectPanel.history(root)); setError(""); } catch (e) { setError(e.message); } };
      React.useEffect(() => { refresh(); }, [root]);
      const diff = async (item) => { const data = await api.projectPanel.gitDiff(root, item.path, false); onOpen({ path: item.path, name: item.path.split('/').pop(), kind: 'diff', content: data.content, editable: false }); };
      const discard = async (item) => { if (confirm(`撤销 ${item.path} 的工作区修改？`)) { await api.projectPanel.discard(root, item.path); refresh(); } };
      const snapshot = async () => { await api.projectPanel.snapshot(root, `手动快照 ${new Date().toLocaleString()}`, null); refresh(); };
      const revert = async (item) => { if (confirm(`恢复到“${item.label}”？当前状态会先自动备份。`)) { await api.projectPanel.revertSnapshot(root, item.id); refresh(); } };
      return h("div", { className: "dpp-changes" }, error ? h("div", { className: "dpp-error" }, error) : null, h("div", { className: "dpp-section-title" }, h("strong", null, `变更 ${status.branch ? `· ${status.branch}` : ''}`), h("button", { onClick: refresh }, "刷新"), h("button", { onClick: snapshot }, "记录快照")), ...status.changes.map((item) => h("div", { className: "dpp-change", key: item.path }, h("button", { onClick: () => diff(item) }, h("span", { className: "dpp-status" }, `${item.index}${item.worktree}`), item.path), h("button", { className: "dpp-danger", onClick: () => discard(item) }, "撤销"))), h("div", { className: "dpp-section-title" }, h("strong", null, "修改快照")), ...history.map((item) => h("div", { className: "dpp-history", key: item.id }, h("div", null, h("strong", null, item.turn ? `回复 ${item.turn}` : item.label), h("small", null, new Date(item.createdAt).toLocaleString())), h("button", { onClick: () => revert(item) }, "恢复"))));
    }

    function ProjectPanel({ useSessions, useWorkspaces }) {
      const current = useSessions((state) => state.current);
      const workspace = workspaceOf(useSessions, useWorkspaces, current);
      const root = workspace?.path;
      const [open, setOpen] = React.useState(false);
      const [width, setWidth] = React.useState(520);
      const [tab, setTab] = React.useState("files");
      const [files, setFiles] = React.useState([]);
      const [active, setActive] = React.useState(null);
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
        window.addEventListener('dsh-desktop-project-file', listener); return () => window.removeEventListener('dsh-desktop-project-file', listener);
      }, [root]);
      React.useEffect(() => {
        const listener = (event) => { if (!root || event.detail.root === root) { const next = !open; setOpen(next); api.projectPanel.setState(root, { width, collapsed: !next, activeTab: tab }); } };
        window.addEventListener('dsh-desktop-project-panel-toggle', listener); return () => window.removeEventListener('dsh-desktop-project-panel-toggle', listener);
      }, [root, open, width, tab]);
      React.useLayoutEffect(() => {
        const panel = document.querySelector('.dpp-panel');
        const frame = panel?.parentElement?.parentElement;
        if (!panel || !frame) return;
        const parent = frame.parentElement;
        const previous = { frameWidth: frame.style.width, frameMaxWidth: frame.style.maxWidth, parentOverflow: parent?.style.overflow || '' };
        frame.style.width = `calc(100% - ${width}px)`;
        frame.style.maxWidth = `calc(100% - ${width}px)`;
        if (parent) parent.style.overflow = 'hidden';
        return () => { frame.style.width = previous.frameWidth; frame.style.maxWidth = previous.frameMaxWidth; if (parent) parent.style.overflow = previous.parentOverflow; };
      }, [root, open, width]);
      if (!root || !open) return null;
      const updateDraft = (filePath, draft) => { setFiles((old) => old.map((x) => x.path === filePath ? { ...x, draft } : x)); setActive((old) => old?.path === filePath ? { ...old, draft } : old); };
      const closeTab = (event, file) => { event.stopPropagation(); if (file.editable && file.draft !== file.content && !confirm(`放弃 ${file.name} 的未保存修改？`)) return; const next = files.filter((x) => x.path !== file.path); setFiles(next); if (active?.path === file.path) setActive(next.at(-1) || null); };
      const startDrag = (event) => { const startX = event.clientX, startWidth = width; const move = (e) => setWidth(Math.max(320, Math.min(1000, startWidth + startX - e.clientX))); const up = (e) => { const next = Math.max(320, Math.min(1000, startWidth + startX - e.clientX)); setWidth(next); api.projectPanel.setState(root, { width: next, collapsed: false, activeTab: tab }); window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); }; window.addEventListener('mousemove', move); window.addEventListener('mouseup', up); };
      const changeTab = (value) => { setTab(value); api.projectPanel.setState(root, { width, collapsed: false, activeTab: value }); };
      const tabs = h("div", { className: "dpp-tabs" }, ...files.map((file) => h("button", { className: active?.path === file.path ? 'active' : '', key: file.path, onClick: () => setActive(file) }, file.name, h("span", { onClick: (e) => closeTab(e, file) }, " ×"))));
      return h("aside", { className: "dpp-panel", style: { width: `${width}px` } }, h("div", { className: "dpp-resizer", onMouseDown: startDrag, onDoubleClick: () => { setWidth(520); api.projectPanel.setState(root, { width: 520, collapsed: false, activeTab: tab }); } }), h("header", null, h("strong", null, workspace.title || root.split(/[\\/]/).pop()), h("button", { onClick: () => { setOpen(false); api.projectPanel.setState(root, { width, collapsed: true, activeTab: tab }); } }, "×")), h("nav", null, h("button", { className: tab === 'files' ? 'active' : '', onClick: () => changeTab('files') }, "预览"), h("button", { className: tab === 'changes' ? 'active' : '', onClick: () => changeTab('changes') }, "变更")), tab === 'files' ? h("main", { className: "dpp-preview-main" }, tabs, h(Preview, { root, file: active, onSaved: openPath, onDraft: updateDraft })) : h(Changes, { root, onOpen: openPath }));
    }

    const css = `.dpc-root{width:100%;max-width:820px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:14px}.dpc-title,.dpc-head,.dpp-section-title{display:flex;align-items:center;justify-content:space-between}.dpc-title h2,.dpc-title p,.dpc-card p{margin:0}.dpc-title p,.dpc-meta,.dpc-note{color:var(--dsw-alias-label-secondary);font-size:13px}.dpc-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.dpc-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:10px;padding:16px;display:flex;flex-direction:column;gap:12px}.dpc-actions,.dpp-actions{display:flex;gap:8px}.dpc-root button,.dpp-panel button,.dpp-toggle{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:7px;padding:6px 10px;cursor:pointer}.dpc-danger,.dpp-danger,.dpp-error{color:var(--dsw-alias-state-error-primary)!important}.dpc-note{padding:10px 12px;border-radius:8px;background:var(--dsw-alias-bg-layer-2)}.dpp-toggle{height:30px}.dpp-panel{pointer-events:auto;position:fixed;right:0;top:0;bottom:0;z-index:100;background:var(--dsw-alias-bg-base);border-left:1px solid var(--dsw-alias-border-l1);box-shadow:-8px 0 24px #0003;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;min-width:320px;max-width:min(1000px,85vw)}.dpp-resizer{position:absolute;left:-4px;top:0;bottom:0;width:8px;cursor:ew-resize}.dpp-panel>header{height:48px;display:flex;align-items:center;gap:8px;padding:0 12px;border-bottom:1px solid var(--dsw-alias-border-l2)}.dpp-panel>header strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dpp-panel>header button{margin-left:auto}.dpp-panel>nav{display:flex;padding:8px;gap:6px;border-bottom:1px solid var(--dsw-alias-border-l2)}.dpp-panel>nav button.active,.dpp-tabs button.active{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}.dpp-work{display:grid;grid-template-columns:210px minmax(0,1fr);flex:1;min-height:0}.dpp-tree{border-right:1px solid var(--dsw-alias-border-l2);display:flex;flex-direction:column;min-width:0}.dpp-tree input{margin:8px;padding:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-layer-1);color:inherit}.dpp-tree-list{overflow:auto;flex:1}.dpp-tree-row{width:100%;border:0!important;border-radius:0!important;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:transparent!important;padding-top:5px!important;padding-bottom:5px!important}.dpp-tree-row:hover{background:var(--dsw-alias-bg-layer-2)!important}.dpp-folder{font-weight:600}.dpp-work>main{display:flex;flex-direction:column;min-width:0;min-height:0}.dpp-tabs{display:flex;overflow:auto;border-bottom:1px solid var(--dsw-alias-border-l2);padding:5px;gap:4px}.dpp-tabs button{white-space:nowrap}.dpp-preview{display:flex;flex-direction:column;flex:1;min-height:0}.dpp-preview-bar{height:42px;display:flex;align-items:center;gap:6px;padding:0 10px;border-bottom:1px solid var(--dsw-alias-border-l2)}.dpp-spacer{flex:1}.dpp-preview-body{flex:1;min-height:0;overflow:auto}.dpp-preview-body.split{display:grid;grid-template-columns:1fr 1fr}.dpp-preview-body textarea{resize:none;border:0;border-right:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:inherit;padding:12px;font:13px/1.55 Consolas,monospace;outline:none}.dpp-code{margin:0;padding:14px;white-space:pre-wrap;word-break:break-word;font:13px/1.55 Consolas,monospace}.dpp-frame{width:100%;height:100%;border:0;background:white}.dpp-image{display:block;max-width:100%;max-height:100%;margin:auto}.dpp-markdown{padding:18px;line-height:1.6}.dpp-markdown p{white-space:pre-wrap}.dpp-table-wrap{overflow:auto;padding:10px}.dpp-table-wrap table{border-collapse:collapse}.dpp-table-wrap th,.dpp-table-wrap td{border:1px solid var(--dsw-alias-border-l2);padding:5px 8px;white-space:nowrap}.dpp-empty{height:100%;display:grid;place-content:center;text-align:center;color:var(--dsw-alias-label-secondary)}.dpp-changes{overflow:auto;padding:10px;flex:1}.dpp-section-title{margin:8px 0;gap:5px}.dpp-section-title button:first-of-type{margin-left:auto}.dpp-change,.dpp-history{display:flex;align-items:center;gap:6px;border-bottom:1px solid var(--dsw-alias-border-l2);padding:7px 0}.dpp-change>button:first-child{flex:1;text-align:left;border:0;background:transparent}.dpp-status{display:inline-block;width:28px;color:var(--dsw-alias-state-warn-primary)}.dpp-history>div{flex:1;display:flex;flex-direction:column}.dpp-history small{color:var(--dsw-alias-label-secondary)}@media(max-width:760px){.dpc-grid{grid-template-columns:1fr}.dpp-work{grid-template-columns:150px minmax(0,1fr)}}`;

    function apply(ctx) {
      const slots = ctx.get("slots");
      if (!slots || !api?.pluginCenter || !api?.projectPanel) return;
      ctx.effect(() => { const style = document.createElement("style"); style.textContent = css + `.dpp-preview-main{display:flex;flex-direction:column;flex:1;min-height:0}.dpp-conversation-files{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-top:8px;color:var(--dsw-alias-label-secondary);font-size:12px}.dpp-conversation-files button{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-brand-primary);border-radius:6px;padding:3px 7px;cursor:pointer}`; document.head.appendChild(style); return () => style.remove(); });

      slots.inject("settings.plugins.tab", () => slots.register({ name: "settings.plugins.tab", id: "desktop-center", order: 20, label: "插件中心" }, PluginCenterTab));
      slots.inject("conversation.session.header.actions", () => slots.register({ name: "conversation.session.header.actions", id: "desktop-project-panel", order: 30, label: "项目" }, ProjectPanelToggle));
      slots.inject("conversation.chat.turnTail", () => slots.register({ name: "conversation.chat.turnTail", select: (owner) => { const data = owner.turn.data.get('deliverables'); if (!data) return null; const paths = []; const seen = new Set(); for (const item of data.produced) { if (item.seq <= owner.seq && !seen.has(item.path)) { seen.add(item.path); paths.push(item.path); } } return paths.length ? paths : null; } }, ConversationFiles));
      slots.inject("shell.overlay", () => slots.register({ name: "shell.overlay", id: "desktop-project-panel", order: 20 }, ProjectPanel));
    }

    module.exports.apply = apply;
    module.exports.inject = ["slots"];
    return module.exports;
  }
});

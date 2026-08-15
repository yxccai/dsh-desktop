window.__ModuleLoader__.load({
  id: "@yxccai/dsh-desktop-plugin-center",
  factory: (require) => {
    const module = { exports: {} };
    const React = require("react");

    function PluginCenterTab() {
      const [state, setState] = React.useState({ loading: true, data: null, error: "" });
      const refresh = async () => {
        try {
          const data = await window.dshDesktop.pluginCenter.list();
          setState({ loading: false, data, error: "" });
        } catch (error) {
          setState({ loading: false, data: null, error: error?.message || String(error) });
        }
      };
      React.useEffect(() => { refresh(); }, []);
      const act = async (action, id) => {
        try {
          const data = await window.dshDesktop.pluginCenter[action](id);
          setState({ loading: false, data, error: "" });
        } catch (error) {
          setState((old) => ({ ...old, error: error?.message || String(error) }));
        }
      };
      const button = (label, action, id, danger) => React.createElement("button", { className: danger ? "dpc-danger" : "", onClick: () => act(action, id) }, label);
      const cards = (state.data?.recommended || []).map((plugin) => {
        const actions = [];
        if (plugin.status === "available") actions.push(button("安装", "install", plugin.id));
        if (plugin.status === "enabled" && plugin.owned) actions.push(button("停用", "disable", plugin.id), button("卸载", "uninstall", plugin.id, true));
        if (plugin.status === "disabled" && plugin.owned) actions.push(button("启用", "enable", plugin.id), button("卸载", "uninstall", plugin.id, true));
        const status = ({ available: "可安装", enabled: "已启用", disabled: "已停用", conflict: "名称冲突" })[plugin.status] || plugin.status;
        return React.createElement("article", { className: "dpc-card", key: plugin.id },
          React.createElement("div", { className: "dpc-head" }, React.createElement("strong", null, plugin.name), React.createElement("span", null, status)),
          React.createElement("p", null, plugin.description),
          React.createElement("div", { className: "dpc-meta" }, `${plugin.author} · ${plugin.version}`),
          React.createElement("div", { className: "dpc-actions" }, ...actions));
      });
      return React.createElement("section", { className: "dpc-root" },
        React.createElement("div", { className: "dpc-title" }, React.createElement("div", null, React.createElement("h2", null, "插件中心"), React.createElement("p", null, "安装和管理 DSH Desktop 推荐的 Agent Preset。")), React.createElement("button", { onClick: refresh }, "刷新")),
        React.createElement("div", { className: "dpc-note" }, "变更会在新会话中生效，当前会话不会被中断。"),
        state.error ? React.createElement("div", { className: "dpc-error" }, state.error) : null,
        state.loading ? React.createElement("p", null, "正在加载…") : React.createElement("div", { className: "dpc-grid" }, ...cards));
    }

    function apply(ctx) {
      const slots = ctx.get("slots");
      if (!slots || !window.dshDesktop?.pluginCenter) return;
      ctx.effect(() => {
        const style = document.createElement("style");
        style.textContent = `.dpc-root{width:100%;max-width:820px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:14px}.dpc-title{display:flex;align-items:center;justify-content:space-between}.dpc-title h2,.dpc-title p,.dpc-card p{margin:0}.dpc-title p,.dpc-meta,.dpc-note{color:var(--dsw-alias-label-tertiary);font-size:13px}.dpc-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.dpc-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:10px;padding:16px;display:flex;flex-direction:column;gap:12px}.dpc-head{display:flex;justify-content:space-between}.dpc-head span{font-size:12px;color:var(--dsw-alias-label-tertiary)}.dpc-actions{display:flex;gap:8px}.dpc-root button{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:7px;padding:6px 11px;cursor:pointer}.dpc-root button:hover{border-color:var(--dsw-alias-state-business-primary)}.dpc-danger{color:var(--dsw-alias-state-error-primary)!important}.dpc-note{padding:10px 12px;border-radius:8px;background:var(--dsw-alias-bg-layer-2)}.dpc-error{color:var(--dsw-alias-state-error-primary)}@media(max-width:760px){.dpc-grid{grid-template-columns:1fr}}`;
        document.head.appendChild(style);
        return () => style.remove();
      });
      slots.inject("settings.plugins.tab", () => slots.register({ name: "settings.plugins.tab", id: "desktop-center", order: 20, label: "插件中心" }, PluginCenterTab));
    }

    module.exports.apply = apply;
    module.exports.inject = ["slots"];
    return module.exports;
  }
});

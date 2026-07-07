declare global {
  interface Window { LuaPop?: { init(cfg: { agentId: string; position: string }): void } }
}

export function initLuaWidget() {
  const s = document.createElement('script');
  s.src = 'https://lua-ai-global.github.io/lua-pop/lua-pop.umd.js';
  s.onload = () => window.LuaPop?.init({
    agentId: import.meta.env.VITE_LUA_AGENT_ID,
    position: 'bottom-right',
  });
  document.body.appendChild(s);
}

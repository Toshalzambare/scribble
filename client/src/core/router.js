/** Hash-based SPA router */
const routes = {};
let currentView = null;

export function registerRoute(hash, renderFn) {
  routes[hash] = renderFn;
}

export function navigate(hash) {
  window.location.hash = hash;
}

export function initRouter(appEl) {
  function handleRoute() {
    const hash = window.location.hash.slice(1) || 'home';
    if (currentView === hash) return;
    currentView = hash;
    const renderFn = routes[hash] || routes['home'];
    if (renderFn) {
      appEl.innerHTML = '';
      renderFn(appEl);
    }
  }

  window.addEventListener('hashchange', handleRoute);
  handleRoute();
}

export default { registerRoute, navigate, initRouter };

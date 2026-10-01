// Minimal hash router. Routes are module keys; an optional ":param" tail is passed
// to the module render function as ctx.param.
let routes = {};
let onNavigate = null;

export function configure(routeMap, navCb) { routes = routeMap; onNavigate = navCb; }

export function go(key, param) {
  location.hash = "#/" + key + (param ? "/" + encodeURIComponent(param) : "");
}

export function current() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [key, param] = raw.split("/");
  return { key: key || "dashboard", param: param ? decodeURIComponent(param) : null };
}

async function handle() {
  const { key, param } = current();
  const route = routes[key] || routes.dashboard;
  if (onNavigate) await onNavigate(key, route, param);
}

window.addEventListener("hashchange", handle);
export function start() { handle(); }

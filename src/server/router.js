// Declarative route table: exact paths or regular expressions, with a public
// flag for the few endpoints that must work before the token is checked.
export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, matcher, handler, { public: isPublic = false, name = '' } = {}) {
    this.routes.push({
      method: String(method).toUpperCase(),
      matcher,
      handler,
      public: isPublic,
      name: name || String(matcher),
    });
    return this;
  }

  get(matcher, handler, options) {
    return this.add('GET', matcher, handler, options);
  }

  post(matcher, handler, options) {
    return this.add('POST', matcher, handler, options);
  }

  del(matcher, handler, options) {
    return this.add('DELETE', matcher, handler, options);
  }

  matchPath(route, pathname) {
    if (route.matcher instanceof RegExp) {
      const match = route.matcher.exec(pathname);
      return match || null;
    }
    return route.matcher === pathname ? [] : null;
  }

  resolve(method, pathname) {
    const wanted = String(method || 'GET').toUpperCase();
    let pathOnly = null;
    for (const route of this.routes) {
      const match = this.matchPath(route, pathname);
      if (!match) continue;
      if (route.method !== wanted) {
        pathOnly = pathOnly || { route, match };
        continue;
      }
      return { route, match };
    }
    return pathOnly;
  }

  has(pathname) {
    return this.routes.some((route) => this.matchPath(route, pathname));
  }

  list() {
    return this.routes.map((route) => `${route.method} ${route.name}${route.public ? ' [public]' : ''}`);
  }
}

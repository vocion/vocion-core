/** A small synchronous event bus: services tell each other about changes. */
export function createEvents() {
  const handlers = new Map();
  return {
    on(name, fn) {
      handlers.set(name, [...(handlers.get(name) || []), fn]);
    },
    emit(name, payload) {
      for (const fn of handlers.get(name) || []) {
        fn(payload);
      }
    },
  };
}

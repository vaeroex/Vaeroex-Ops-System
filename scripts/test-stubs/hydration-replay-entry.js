// React upstream #35494: a Flight-shaped lazy CHILD suspends after its host
// parent claimed the server node, then resolves before the next render slice.
const React = require('next/dist/compiled/react');
const { hydrateRoot } = require('react-dom/client');
const h = React.createElement;
const container = document.getElementById('fixture');
const serverNodes = ['outer', 'target', 'child'].map(id => document.getElementById(id));
const serverHtml = container.innerHTML;
const trace = { lazyInitializations: 0, fulfilledChunks: 0, beforeRenders: 0, afterRenders: 0, recoverableErrors: [] };
const listeners = [];
const chunk = {
  status: 'pending',
  value: null,
  reason: null,
  then(resolve) {
    if (chunk.status === 'fulfilled') resolve(chunk.value);
    else listeners.push(resolve);
  }
};
const lazyChild = React.lazy(() => {
  trace.lazyInitializations++;
  queueMicrotask(() => {
    chunk.status = 'fulfilled';
    chunk.value = { default: h('section', { id: 'child' }, 'Saved server content') };
    trace.fulfilledChunks++;
    for (const resolve of listeners) resolve(chunk.value);
  });
  return chunk;
});
function Before() {
  trace.beforeRenders++;
  return h('p', null, 'Before');
}
function After() {
  trace.afterRenders++;
  return h('p', null, 'After');
}
function App() {
  React.useEffect(() => {
    window.__HYDRATION_REPLAY_RESULT__ = {
      ...trace,
      sameServerNodes: serverNodes.map(node => document.getElementById(node.id) === node),
      sameServerHtml: container.innerHTML === serverHtml
    };
  }, []);
  return h('main', { id: 'outer' },
    h(Before),
    h('div', { id: 'target' }, lazyChild),
    h(After));
}
React.startTransition(() => {
  hydrateRoot(container, h(App), {
    onRecoverableError(error) { trace.recoverableErrors.push(error.message); }
  });
});

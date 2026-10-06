// Reproduce a synchronous resource wakeup during a deferred render using the
// same bundled React renderer as Next App Router (React upstream #36134).
const React = require('next/dist/compiled/react');
const { createRoot } = require('react-dom/client');
const h = React.createElement;
const resources = new Map();
function resource(key) {
  if (!resources.has(key)) {
    const listeners = [];
    const entry = { ready: false, then(resolve) { if (entry.ready) resolve(); else listeners.push(resolve); }, resolve() { if (entry.ready) return; entry.ready = true; for (const callback of listeners) callback(); } };
    resources.set(key, entry);
  }
  return resources.get(key);
}
resource('initial').resolve();
function Value({ value }) {
  const entry = resource(value);
  if (!entry.ready) throw entry;
  return h('output', { 'data-result': value }, value);
}
function Sibling({ value }) {
  // Resolution during this render must schedule a retry, including when the
  // sibling reaches it before the previous render's suspension is committed.
  if (value !== 'initial') resource(value).resolve();
  return null;
}
function App() {
  const [value, setValue] = React.useState('initial');
  const deferred = React.useDeferredValue(value);
  return h('main', null,
    h('button', { onClick: () => setValue('updated') }, 'Advance'),
    h(React.Suspense, { fallback: h('p', null, 'Loading') },
      h(Value, { value: deferred }), h(Sibling, { value: deferred })));
}
createRoot(document.getElementById('fixture')).render(h(App));

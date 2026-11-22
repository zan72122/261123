// Dev-only stand-in for modules that are not part of a `--dev` build.
// Every property is a no-op function (returning undefined); `isStub` is true.
export function create() {
  const noop = () => undefined;
  return new Proxy({ isStub: true, update: noop }, {
    get(t, k) { return k in t ? t[k] : noop; },
  });
}

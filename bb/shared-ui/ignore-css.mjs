import { registerHooks } from 'node:module';

// Node's test runner has no CSS loader. BB bundles the styles separately.
registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.css')) {
      return { format: 'module', source: '', shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

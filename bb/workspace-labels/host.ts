import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { experimental_defineHostEntry } from '@get-bb/plugin-sdk/host';
import { hostCleanup } from './cleanup/contract';
import { identifyWorktree, inspectWorktree, removeCheckout, removeLocalBranch } from './cleanup/git';

export default experimental_defineHostEntry({
  contract: hostCleanup,
  handlers: {
    identify: (input, { signal }) => identifyWorktree(input, signal),
    async worktreePathsInUse({ path, candidates }) {
      const root = await realpath(path);
      const matches = await Promise.all(candidates.map(async candidate => {
        try {
          const isInside = (directory: string, file: string) => {
            const difference = relative(directory, file);
            return difference !== '..' && !difference.startsWith('..' + sep) && !isAbsolute(difference);
          };
          if (isInside(resolve(path), candidate) || isInside(root, candidate)) return candidate;
          return isInside(root, await realpath(candidate)) ? candidate : null;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
          throw error;
        }
      }));
      return matches.filter(candidate => candidate !== null);
    },
    inspect: (target, { signal }) => inspectWorktree(target, signal),
    removeCheckout: ({ target, inspection, force }, { signal }) => removeCheckout(target, inspection, force, signal),
    removeBranch: ({ inspection, force }, { signal }) => removeLocalBranch(inspection, force, signal),
  },
});

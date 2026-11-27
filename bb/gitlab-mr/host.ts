import { experimental_defineHostEntry } from '@get-bb/plugin-sdk/host';
import { worker } from './contract';
import { details, discover } from './gitlab';

export default experimental_defineHostEntry({
  contract: worker,
  handlers: {
    discover: (input, { signal }) => discover(input, signal),
    details: ({ mr }, { signal }) => details(mr, signal),
  },
});

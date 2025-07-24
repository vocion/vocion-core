import { create, edit, ping } from './todo';

export const router = {
  todo: {
    ping,
    create,
    edit,
  },
};

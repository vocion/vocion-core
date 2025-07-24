import { create, edit, ping, remove } from './todo';

export const router = {
  todo: {
    ping,
    create,
    edit,
    remove,
  },
};

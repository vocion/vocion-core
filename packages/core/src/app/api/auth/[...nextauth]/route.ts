// auth.js route handler. Exposes /api/auth/* — sign-in, callback, session,
// CSRF, etc. The actual config lives in @/libs/Auth.
import { handlers } from '@/libs/Auth';

export const { GET, POST } = handlers;

import { adminRoutes } from './admin.mjs';
import { analyticsRoutes } from './analytics.mjs';
import { documentRoutes } from './documents.mjs';
import { linkRoutes } from './links.mjs';
import { pageRoutes } from './pages.mjs';
import { userRoutes } from './users.mjs';
import { visitorRoutes } from './visitor.mjs';

export const ROUTES = [...documentRoutes, ...linkRoutes, ...visitorRoutes, ...analyticsRoutes, ...adminRoutes, ...pageRoutes, ...userRoutes];

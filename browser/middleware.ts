/**
 * SolidStart middleware
 * Placeholder — better-auth does not require request-level middleware.
 * All auth state is handled via cookies / bearer tokens and the /api/auth/* routes.
 */

import { createMiddleware } from "@solidjs/start/middleware";

export default createMiddleware({
  onRequest: [],
});

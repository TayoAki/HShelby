"use client";

import { stripeClient } from "@better-auth/stripe/client";
import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";

// Same origin: Next proxies /api/auth/* to the API service.
export const authClient = createAuthClient({
  plugins: [organizationClient(), stripeClient({ subscription: true })],
});

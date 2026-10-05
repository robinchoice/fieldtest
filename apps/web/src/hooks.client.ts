import * as Sentry from '@sentry/browser';
import type { HandleClientError } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';

Sentry.init({
  dsn: env.PUBLIC_SENTRY_DSN,
  environment: env.PUBLIC_SENTRY_ENVIRONMENT || 'production',
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
    graphQL: { document: false, variables: false },
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    queues: false,
    stackFrameVariables: false,
    frameContextLines: 0,
  },
  maxBreadcrumbs: 0,
  tracesSampleRate: 0,
  sendClientReports: false,
  integrations: (defaults) =>
    defaults.filter((integration) => !['BrowserSession', 'Breadcrumbs', 'HttpContext'].includes(integration.name)),
  beforeSend(event) {
    delete event.request;
    delete event.user;
    return event;
  },
});

export const handleError: HandleClientError = ({ error }) => {
  Sentry.captureException(error);
};

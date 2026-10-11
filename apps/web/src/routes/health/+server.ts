// Healthcheck of the web role alone. /api/health also covers API and database.
export const GET = () => Response.json({ status: 'ok' });

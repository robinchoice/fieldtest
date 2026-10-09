import { messages } from '@app/shared';
import type { ReportData } from '$lib/components/Report.svelte';
import type { PageServerLoad } from './$types';

// Rendered on the server so shared links get a preview with the round's name.
// Unknown tokens keep the general preview.
export const load: PageServerLoad = async ({ fetch, params, locals }) => {
  const report: ReportData | null = await fetch(`/api/v1/reports/${encodeURIComponent(params.token)}`)
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
  if (!report) return { report: null };
  const t = messages[locals.locale];
  const lead = report.top[0];
  return {
    report,
    meta: {
      title: t.reportTitle(report.product, report.name),
      description: lead
        ? t.reportLede(lead.title.replace(/[.!?]+$/, ''), lead.sessions, report.sessions)
        : t.sharedReport,
    },
  };
};

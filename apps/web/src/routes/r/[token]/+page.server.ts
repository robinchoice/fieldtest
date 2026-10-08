import { messages } from '@app/shared';
import type { ReportData } from '$lib/components/Report.svelte';
import type { PageServerLoad } from './$types';

// Rendered on the server so shared links get a preview with the round's name.
// Unknown tokens keep the general preview.
export const load: PageServerLoad = async ({ fetch, params, locals }) => {
  const res = await fetch(`/api/v1/reports/${params.token}`);
  if (!res.ok) return { report: null };
  const report: ReportData = await res.json();
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

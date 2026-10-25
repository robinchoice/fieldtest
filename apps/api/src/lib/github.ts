import { APP_NAME } from '@app/shared';
import { z } from 'zod';

const issueSchema = z.object({ html_url: z.url() });

// The CI bakes the repo into the image. The token is a fine-grained one that
// may only write issues. Without it, no issue.
export async function createIssue(issue: { title: string; body: string; labels: string[] }) {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.FEEDBACK_GITHUB_TOKEN;
  if (!repo || !token) return null;

  const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'user-agent': APP_NAME,
    },
    body: JSON.stringify(issue),
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}: ${await res.text()}`);
  return issueSchema.parse(await res.json()).html_url;
}

import type { Rewards } from '@app/shared';
import { api } from './api';

export type Round = {
  id: string;
  product: string;
  name: string;
  prototypeUrl: string;
  goals: string[];
  rewards: Rewards;
  plannedSessions: number;
  inviteUrl: string;
  shareToken: string | null;
};

export type RoundDetail = {
  round: Round;
  stats: { sessions: number; testingNow: number; findings: number; paidSats: number; decisions: number };
  runner: {
    online: boolean;
    lastSeenAt: string | null;
    budgetSats: number | null;
    host: string | null;
    version: string | null;
  } | null;
};

// The round the pages under /rounds/[id] show. The layout loads and refreshes it.
export const current = $state({ detail: null as RoundDetail | null });

export async function loadRound(id: string) {
  const detail = await api.get<RoundDetail>(`/rounds/${id}`);
  if (detail.round.id === id) current.detail = detail;
  return detail;
}

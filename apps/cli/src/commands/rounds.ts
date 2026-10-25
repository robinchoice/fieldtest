import { DATE_LOCALE } from '@app/shared';
import { z } from 'zod';
import { type Command, EXIT, Failure } from '../command';

const roundsSchema = z.object({
  rounds: z.array(
    z.object({
      id: z.string(),
      product: z.string(),
      name: z.string(),
      createdAt: z.string(),
      sessions: z.number(),
      findings: z.number(),
    }),
  ),
});

// The rounds of the logged-in owner, as the dashboard lists them
export const rounds: Command = {
  help: (m) => [['rounds', m.cliRoundsHelp]],
  async run({ api, session, m, locale }) {
    if (!session) throw new Failure(m.notLoggedIn, EXIT.loggedOut);
    const data = await api.get('/rounds', roundsSchema);
    const lines = data.rounds.map((round) =>
      [
        `${round.product} · ${round.name}`,
        new Date(round.createdAt).toLocaleDateString(DATE_LOCALE[locale]),
        m.sessionsCount(round.sessions),
        m.findingsCount(round.findings),
        round.id,
      ].join(' · '),
    );
    return { data, text: lines.length ? lines.join('\n') : m.roundsEmpty };
  },
};

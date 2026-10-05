import type { Database } from '@app/db';
import type { User } from '@app/shared';

export type AppEnv = {
  Variables: {
    db: Database;
    user: User;
    // Set by requireRunner for the payout runner's routes
    runner: { id: string; ownerId: string };
  };
};

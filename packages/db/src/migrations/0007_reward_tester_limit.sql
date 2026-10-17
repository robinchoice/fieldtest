-- Existing rounds get twice their limit per claim as the limit per tester and round
UPDATE "rounds" SET "rewards" = "rewards" || jsonb_build_object('autoApproveTester', ("rewards"->>'autoApprove')::int * 2) WHERE NOT "rewards" ? 'autoApproveTester';

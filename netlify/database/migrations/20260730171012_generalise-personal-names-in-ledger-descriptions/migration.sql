-- The ledger is rendered on the PUBLIC dashboard, so a description naming an
-- individual is a privacy leak. Three seeded rows carried personal names
-- straight over from the source workbook.
--
-- Matched on the exact seeded text, so this is a no-op if a committee member
-- has already reworded the row by hand.

UPDATE transactions
   SET description = 'Missed street light charge'
 WHERE description = 'Missed Light - Mr. Sarath';

UPDATE transactions
   SET description = 'Cleaning contractor A'
 WHERE description = 'Aruna - Cleaning';

UPDATE transactions
   SET description = 'Cleaning contractor B'
 WHERE description = 'Anura - Cleaning';

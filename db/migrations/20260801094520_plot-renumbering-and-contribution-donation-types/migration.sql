-- 1. Allow a plot to be renumbered.
--
-- house_no is the primary key and collections.house_no references it. Without
-- ON UPDATE CASCADE, renumbering a plot would be rejected by the foreign key
-- (or, worse, strand its payment history). Recreating the constraint with
-- ON UPDATE CASCADE makes a renumber carry the collections along with it.

ALTER TABLE collections
  DROP CONSTRAINT collections_house_no_plots_house_no_fkey;

ALTER TABLE collections
  ADD CONSTRAINT collections_house_no_plots_house_no_fkey
  FOREIGN KEY (house_no) REFERENCES plots (house_no)
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Rename the inflow type and split donations out of it.
--
-- "Income" is committee-facing wording that never matched how the society
-- actually talks about the money: members make contributions, and dansal money
-- is donated. Both are inflows and both still add to the fund balance, so the
-- arithmetic is unchanged — only the label and the reporting split are new.
--
-- Order matters: reclassify the dansal rows first, then sweep whatever "Income"
-- remains into Contribution.

UPDATE transactions
   SET type = 'Donation'
 WHERE type = 'Income'
   AND category = 'Dansal / Events';

-- Interest income is not a donation and not really a member contribution
-- either. It lands in Contribution as the generic inflow bucket; recategorise
-- it in the editor if the committee would rather account for it differently.
UPDATE transactions
   SET type = 'Contribution'
 WHERE type = 'Income';

-- Standing guidance on a Study drill.
--
-- A drill is generated, so it is wrong at first in the ordinary way generated
-- things are wrong: it weights the wrong thing, or misses what the room actually
-- cares about. Nate's example - "no, that's not the top priority, reference the
-- powerpoint Ed made, forecasting is the number one thing."
--
-- The correction has to PERSIST. If it only steered one regeneration, the next
-- rebuild would quietly drop it and he would have to re-argue the same point
-- forever. So the steer accumulates on the drill itself and is replayed into
-- every later rebuild AND into grading, where it tells the grader what actually
-- matters rather than treating all key points as equal.
--
-- Per-point marks (core / minor / a note on one specific point) do NOT need a
-- column: key_points is already jsonb, and the entries simply grow optional
-- "weight" and "note" fields. Old rows keep working - absent means normal.

alter table public.cp_dives
  add column if not exists guidance text;

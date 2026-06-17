-- Allow a task to belong to a pillar (area) without a project.
-- project_id becomes nullable; area_id lets a task hang off a pillar directly.
-- (No FK on area_id — cp_areas PK is composite (user_id, id); integrity is
--  enforced app-side, same as other cp_* references.)
alter table public.cp_tasks alter column project_id drop not null;
alter table public.cp_tasks add column if not exists area_id text;

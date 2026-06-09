-- One-time import: real Course (course_*, anon-RLS, no user_id) → Course+ (cp_*,
-- per-user RLS). Stamps every row with Nate's auth uid. Run server-side via:
--   supabase db query --linked -f scripts/import_from_course.sql
-- Idempotent: wipes this user's cp_* rows first (only demo seed lives there),
-- then re-imports from course_*. Safe — only READS course_*; never writes it.

begin;

-- Nate's user (course_* is anon/no user_id; cp_* needs the owner)
do $$
declare uid uuid := '24c79501-4011-46c9-a3d3-a716d732d69c';
begin
  -- 1) wipe this user's existing cp_* (demo seed)
  delete from cp_artifacts  where user_id = uid;
  delete from cp_updates    where user_id = uid;
  delete from cp_milestones where user_id = uid;
  delete from cp_tasks      where user_id = uid;
  delete from cp_notes      where user_id = uid;
  delete from cp_inbox      where user_id = uid;
  delete from cp_projects   where user_id = uid;
  delete from cp_areas      where user_id = uid;

  -- 2) project→area mapping (normalize messy pillar/work_area case + merge)
  create temporary table _pm on commit drop as
  select p.*,
    case lower(coalesce(nullif(p.pillar,''), nullif(p.work_area,''), ''))
      when 'arrow'      then 'arrow'
      when 'life'       then 'life'
      when 'sunny'      then 'slow-down-sunny'
      when 'production' then 'slow-down-sunny'
      when 'side'       then 'side'
      else 'unfiled' end as area_id,
    case lower(coalesce(nullif(p.pillar,''), nullif(p.work_area,''), ''))
      when 'arrow'      then 'Arrow'
      when 'life'       then 'Life'
      when 'sunny'      then 'Slow Down Sunny'
      when 'production' then 'Slow Down Sunny'
      when 'side'       then 'Side'
      else 'Unfiled' end as area_name
  from course_projects p;

  -- 3) areas
  insert into cp_areas (id, user_id, name, open_default, sort)
  select area_id, uid, area_name, true,
    case area_id when 'arrow' then 0 when 'slow-down-sunny' then 1 when 'life' then 2
                 when 'side' then 3 else 4 end
  from (select distinct area_id, area_name from _pm) a;

  -- 4) projects
  insert into cp_projects (id, user_id, area_id, name, status, priority, due, blurb, sort)
  select m.id::text, uid, m.area_id, m.name,
    case m.status
      when 'active' then 'active' when 'idea' then 'idea' when 'paused' then 'on-hold'
      when 'done' then 'archived' when 'archived' then 'archived'
      when 'routine' then 'active' when 'under_review' then 'next-up' else 'active' end,
    case m.priority when 'high' then 1 when 'medium' then 2 when 'low' then 3 else null end,
    case when m.due_date is not null then jsonb_build_object(
      'y', extract(year from m.due_date)::int,
      'm', extract(month from m.due_date)::int - 1,
      'd', extract(day from m.due_date)::int) else null end,
    nullif(m.outcome,''),
    coalesce(m.sort_order, 0)
  from _pm m;

  -- 5) tasks (skip dropped)
  insert into cp_tasks (id, user_id, project_id, label, done, next, waiting, due, due_date,
                        work_type, task_status, notes, sort)
  select t.id::text, uid, t.project_id::text, t.title,
    coalesce(t.status = 'done', false), coalesce(t.status = 'next', false),
    nullif(t.person_dependency,''),
    null,
    case when t.do_date is not null then jsonb_build_object(
      'y', extract(year from t.do_date)::int,
      'm', extract(month from t.do_date)::int - 1,
      'd', extract(day from t.do_date)::int) else null end,
    t.work_type,
    case t.status when 'triage' then 'none' when 'next' then 'next' when 'in_progress' then 'in-progress'
      when 'waiting' then 'waiting' when 'done' then 'done' when 'pushed' then 'none' else 'none' end,
    nullif(t.notes,''),
    coalesce(t.day_order, 0)
  from course_tasks t
  where t.project_id is not null
    and (t.status is null or t.status <> 'dropped');

  -- 6) "where it stands" updates ← status notes
  insert into cp_updates (id, user_id, project_id, body, created_at)
  select s.id::text, uid, s.project_id::text, s.body, s.created_at
  from course_status_notes s;

  -- 7) milestones (none today, but future-proof)
  insert into cp_milestones (id, user_id, project_id, label, state, sub, due, sort)
  select ms.id::text, uid, ms.project_id::text, ms.label, ms.marker_state,
    case when ms.target_date is not null then to_char(ms.target_date, 'Mon DD') else null end,
    case when ms.target_date is not null then jsonb_build_object(
      'y', extract(year from ms.target_date)::int,
      'm', extract(month from ms.target_date)::int - 1,
      'd', extract(day from ms.target_date)::int) else null end,
    coalesce(ms.sort_order, 0)
  from course_milestones ms;

  -- 8) pending captures → inbox
  insert into cp_inbox (id, user_id, title, src, src_icon, snippet, suggest, tags)
  select c.id::text, uid,
    coalesce(nullif(c.suggested_task_title,''), left(c.raw_text, 60)),
    'course capture', 'clipboard', c.raw_text,
    case when c.suggested_project_id is not null
      then jsonb_build_object('project', c.suggested_project_id::text, 'confidence', 0.8) else null end,
    '{}'::text[]
  from course_captures c
  where c.status = 'pending';

  -- 9) project scratch notes → project-owned documents (nothing lost)
  insert into cp_notes (id, user_id, kind, title, project, area, date, updated, status, body)
  select 'note-' || m.id::text, uid, 'note', m.name || ' — notes', m.id::text, m.area_id,
    to_char(coalesce(m.updated_at, now()), 'Mon DD, YYYY'), 'imported', 2,
    jsonb_build_array(jsonb_build_object('p', m.notes))
  from _pm m
  where m.notes is not null and btrim(m.notes) <> '';
end $$;

commit;

-- summary
select
  (select count(*) from cp_areas      where user_id='24c79501-4011-46c9-a3d3-a716d732d69c') areas,
  (select count(*) from cp_projects   where user_id='24c79501-4011-46c9-a3d3-a716d732d69c') projects,
  (select count(*) from cp_tasks      where user_id='24c79501-4011-46c9-a3d3-a716d732d69c') tasks,
  (select count(*) from cp_updates    where user_id='24c79501-4011-46c9-a3d3-a716d732d69c') updates,
  (select count(*) from cp_notes      where user_id='24c79501-4011-46c9-a3d3-a716d732d69c') notes,
  (select count(*) from cp_inbox      where user_id='24c79501-4011-46c9-a3d3-a716d732d69c') inbox;

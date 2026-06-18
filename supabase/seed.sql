do $$
<<seed_data>>
declare
  demo_user uuid := '00000000-0000-0000-0000-000000000001';
  workspace_record record;
  workspace_id uuid;
  lead_form_id uuid;
  completion_form_id uuid;
  equipment_form_id uuid;
  start_checklist_id uuid;
  job_checklist_id uuid;
  manager_checklist_id uuid;
  vehicle_asset_id uuid;
  tablet_asset_id uuid;
begin
  insert into public.profiles (id, full_name, email)
  values (demo_user, 'Vaeroex Demo Owner', 'demo@vaeroex.local')
  on conflict (id) do update
    set full_name = excluded.full_name,
        email = excluded.email,
        updated_at = now();

  delete from public.workspaces
  where name in (
    'Pacific Field Services',
    'Harbor Construction Co.',
    'Metro EMS Ops - Non Patient',
    'Elite Auto Detail',
    'Summit Fitness Studio'
  );

  for workspace_record in
    select *
    from (values
      ('Pacific Field Services', 'Field Service Company', '25-50'),
      ('Harbor Construction Co.', 'Construction Company', '50-100'),
      ('Metro EMS Ops - Non Patient', 'EMS Operations - Non Patient', '50-100'),
      ('Elite Auto Detail', 'Automotive Shop', '10-25'),
      ('Summit Fitness Studio', 'Gym/Fitness Studio', '10-25')
    ) as workspaces(name, industry, size)
  loop
    insert into public.workspaces (
      name,
      industry,
      size,
      primary_contact_name,
      primary_contact_email,
      created_by,
      subscription_status,
      plan_slug,
      subscription_required,
      manually_unlocked
    )
    values (
      workspace_record.name,
      workspace_record.industry,
      workspace_record.size,
      'Vaeroex Demo Owner',
      'demo@vaeroex.local',
      demo_user,
      'demo',
      'pro',
      false,
      true
    )
    returning id into workspace_id;

    insert into public.workspace_members (workspace_id, user_id, role, status)
    values (workspace_id, demo_user, 'owner', 'active');

    insert into public.customer_subscriptions (
      user_id,
      workspace_id,
      customer_email,
      customer_name,
      source,
      plan_slug,
      status,
      raw_payload_json,
      manually_activated,
      manually_activated_by,
      notes
    )
    values (
      demo_user,
      workspace_id,
      'demo@vaeroex.local',
      'Vaeroex Demo Owner',
      'demo',
      'pro',
      'demo',
      jsonb_build_object('seeded', true),
      true,
      demo_user,
      'Seeded demo workspace access.'
    );

    insert into public.tasks (workspace_id, title, description, status, priority, category, due_date, created_by)
    values
      (workspace_id, 'Review missed follow-ups', 'Confirm every open customer or internal follow-up has an owner.', 'To Do', 'High', 'Follow-up', current_date + 1, demo_user),
      (workspace_id, 'Assign weekly manager review', 'Set a recurring review for tasks, issues, assets, and checklist misses.', 'In Progress', 'Medium', 'Manager review', current_date + 3, demo_user),
      (workspace_id, 'Draft start-of-day checklist', 'Create a simple checklist for readiness and open items.', 'Backlog', 'Medium', 'Checklist', current_date + 5, demo_user),
      (workspace_id, 'Review SOP drafts', 'Turn the highest-risk process into a first approved operating procedure.', 'To Do', 'High', 'SOP', current_date + 7, demo_user),
      (workspace_id, 'Clean up asset ownership', 'Confirm who owns each vehicle, device, or key operating asset.', 'Waiting', 'Medium', 'Assets', current_date + 10, demo_user);

    insert into public.issues (workspace_id, title, description, issue_type, severity, status, root_cause, recommended_fix, due_date, created_by)
    values
      (workspace_id, 'Missed customer follow-up', 'Follow-up steps are not consistently assigned after work is completed.', 'Missed follow-up', 'High', 'Open', 'No required closeout form.', 'Create a job completion form with required follow-up fields.', current_date + 2, demo_user),
      (workspace_id, 'Checklist completion is inconsistent', 'Managers cannot see who completed readiness checks.', 'Process breakdown', 'Medium', 'Open', 'Checklist runs are not tracked.', 'Create recurring checklist runs and review missed completions weekly.', current_date + 4, demo_user),
      (workspace_id, 'Equipment readiness not visible', 'Assets are marked verbally but not logged in a system.', 'Equipment problem', 'Medium', 'Open', 'No asset check cadence.', 'Use asset checks and escalate repeated missed checks.', current_date + 5, demo_user),
      (workspace_id, 'Unclear task owner', 'Several action items are discussed but not assigned.', 'Communication issue', 'High', 'Open', 'Meeting notes are not converted into tasks.', 'Assign one owner and due date for every follow-up task.', current_date + 6, demo_user),
      (workspace_id, 'Training handoff gap', 'New employees rely on verbal process explanations.', 'Training gap', 'Medium', 'Open', 'Missing SOP library.', 'Create SOP drafts for the top three recurring workflows.', current_date + 8, demo_user);

    insert into public.forms (workspace_id, name, description, form_type, schema_json, is_public, public_slug, created_by)
    values
      (
        workspace_id,
        'Lead Intake Form',
        'Capture new business requests and required follow-up details.',
        'intake',
        jsonb_build_array(
          jsonb_build_object('label', 'Name', 'type', 'text', 'required', true),
          jsonb_build_object('label', 'Company', 'type', 'text', 'required', true),
          jsonb_build_object('label', 'Operational problem', 'type', 'long_text', 'required', true),
          jsonb_build_object('label', 'Priority', 'type', 'priority', 'required', true)
        ),
        true,
        lower(regexp_replace(workspace_record.name || '-lead-intake-form', '[^a-zA-Z0-9]+', '-', 'g')),
        demo_user
      ),
      (
        workspace_id,
        'Job Completion Report',
        'Confirm work completion, unresolved issues, and next follow-up.',
        'completion',
        jsonb_build_array(
          jsonb_build_object('label', 'Job or work order', 'type', 'text', 'required', true),
          jsonb_build_object('label', 'Completed work', 'type', 'long_text', 'required', true),
          jsonb_build_object('label', 'Open issue', 'type', 'checkbox', 'required', false),
          jsonb_build_object('label', 'Follow-up date', 'type', 'date', 'required', false)
        ),
        false,
        null,
        demo_user
      ),
      (
        workspace_id,
        'Equipment Issue Report',
        'Log equipment or asset problems before they become operational blockers.',
        'issue',
        jsonb_build_array(
          jsonb_build_object('label', 'Asset name', 'type', 'text', 'required', true),
          jsonb_build_object('label', 'Issue description', 'type', 'long_text', 'required', true),
          jsonb_build_object('label', 'Severity', 'type', 'dropdown', 'options', jsonb_build_array('Low', 'Medium', 'High', 'Urgent'), 'required', true)
        ),
        false,
        null,
        demo_user
      );

    select id into lead_form_id from public.forms where public.forms.workspace_id = seed_data.workspace_id and name = 'Lead Intake Form' limit 1;
    select id into completion_form_id from public.forms where public.forms.workspace_id = seed_data.workspace_id and name = 'Job Completion Report' limit 1;
    select id into equipment_form_id from public.forms where public.forms.workspace_id = seed_data.workspace_id and name = 'Equipment Issue Report' limit 1;

    insert into public.form_submissions (
      workspace_id,
      form_id,
      submitted_by,
      submitter_name,
      submitter_email,
      data_json,
      ai_summary,
      ai_detected_priority,
      ai_detected_followups_json
    )
    values
      (
        workspace_id,
        lead_form_id,
        demo_user,
        'Jordan Lee',
        'jordan@example.com',
        jsonb_build_object('summary', 'New operational request needs same-day manager review.', 'priority', 'High'),
        'Vaeroex summary draft: new request needs an owner, due date, and follow-up task.',
        'High',
        jsonb_build_array('Assign manager owner', 'Create follow-up task', 'Confirm response deadline')
      ),
      (
        workspace_id,
        completion_form_id,
        demo_user,
        'Taylor Smith',
        'taylor@example.com',
        jsonb_build_object('summary', 'Job completed, but customer follow-up is pending.', 'priority', 'Medium'),
        'Vaeroex summary draft: completion is logged, but follow-up ownership is missing.',
        'Medium',
        jsonb_build_array('Assign follow-up owner', 'Confirm due date')
      ),
      (
        workspace_id,
        equipment_form_id,
        demo_user,
        'Morgan Patel',
        'morgan@example.com',
        jsonb_build_object('summary', 'Operations tablet battery is not holding charge.', 'priority', 'Urgent'),
        'Vaeroex summary draft: asset issue may block daily readiness unless reviewed.',
        'Urgent',
        jsonb_build_array('Inspect tablet', 'Log asset check', 'Confirm replacement plan')
      );

    insert into public.checklists (workspace_id, name, description, category, frequency, items_json, assigned_role, created_by)
    values
      (workspace_id, 'Start-of-Day Checklist', 'Confirm readiness before work begins.', 'Readiness', 'Daily', jsonb_build_array('Review open tasks', 'Check schedule', 'Confirm asset readiness', 'Escalate blockers'), 'Manager', demo_user),
      (workspace_id, 'Job Completion Checklist', 'Confirm each job or workflow is complete before closeout.', 'Completion', 'Per job', jsonb_build_array('Confirm work completed', 'Log customer notes', 'Create follow-up task', 'Mark issue if unresolved'), 'Staff', demo_user),
      (workspace_id, 'Weekly Manager Review', 'Review operational health and unresolved work.', 'Manager review', 'Weekly', jsonb_build_array('Review overdue tasks', 'Review open issues', 'Review assets needing attention', 'Create next actions'), 'Manager', demo_user);

    select id into start_checklist_id from public.checklists where public.checklists.workspace_id = seed_data.workspace_id and name = 'Start-of-Day Checklist' limit 1;
    select id into job_checklist_id from public.checklists where public.checklists.workspace_id = seed_data.workspace_id and name = 'Job Completion Checklist' limit 1;
    select id into manager_checklist_id from public.checklists where public.checklists.workspace_id = seed_data.workspace_id and name = 'Weekly Manager Review' limit 1;

    insert into public.checklist_runs (workspace_id, checklist_id, assigned_to, status, responses_json, notes, completed_at)
    values
      (workspace_id, start_checklist_id, demo_user, 'Complete', jsonb_build_array('Reviewed open tasks', 'Checked schedule', 'Confirmed asset readiness'), 'Morning readiness completed.', now() - interval '1 day'),
      (workspace_id, start_checklist_id, demo_user, 'Needs review', jsonb_build_array('Reviewed open tasks', 'Tablet not charged'), 'Operations tablet needs follow-up.', null),
      (workspace_id, job_checklist_id, demo_user, 'Complete', jsonb_build_array('Work completed', 'Follow-up created'), 'Closeout complete with follow-up task.', now() - interval '2 days'),
      (workspace_id, manager_checklist_id, demo_user, 'In progress', jsonb_build_array('Reviewed overdue tasks', 'Reviewed open issues'), 'Manager review started; asset issues still pending.', null);

    insert into public.sops (workspace_id, title, department, category, body_markdown, status, version, created_by, ai_generated)
    values
      (workspace_id, 'Customer Follow-Up SOP', 'Operations', 'Follow-up', '# Customer Follow-Up SOP\n\nDraft owner, due date, review cadence, and escalation rule.', 'Draft', 1, demo_user, true),
      (workspace_id, 'Equipment Issue Escalation SOP', 'Operations', 'Assets', '# Equipment Issue Escalation SOP\n\nDraft process for reporting, assigning, reviewing, and closing asset issues.', 'Draft', 1, demo_user, true),
      (workspace_id, 'Weekly Manager Review SOP', 'Management', 'Review', '# Weekly Manager Review SOP\n\nDraft agenda for task review, issue review, asset readiness, and next actions.', 'Draft', 1, demo_user, true);

    insert into public.assets (workspace_id, asset_name, asset_type, identifier, location, status, last_checked_at, notes)
    values
      (workspace_id, 'Primary Vehicle 1', 'Vehicle', 'VEH-001', 'Main location', 'Ready', now() - interval '1 day', 'Demo vehicle asset.'),
      (workspace_id, 'Operations Tablet', 'Device', 'DEV-001', 'Manager office', 'Needs review', now() - interval '3 days', 'Needs charging cadence.'),
      (workspace_id, 'Tool Kit A', 'Equipment', 'KIT-001', 'Storage', 'Ready', now() - interval '2 days', 'Assigned to opening checklist.'),
      (workspace_id, 'Backup Radio', 'Device', 'RAD-001', 'Dispatch area', 'Missing', now() - interval '6 days', 'Flagged for manager review.'),
      (workspace_id, 'Supply Bin 1', 'Supply', 'SUP-001', 'Back room', 'Ready', now() - interval '1 day', 'Weekly count required.');

    select id into vehicle_asset_id from public.assets where public.assets.workspace_id = seed_data.workspace_id and asset_name = 'Primary Vehicle 1' limit 1;
    select id into tablet_asset_id from public.assets where public.assets.workspace_id = seed_data.workspace_id and asset_name = 'Operations Tablet' limit 1;

    insert into public.asset_checks (workspace_id, asset_id, checked_by, status, notes, photos_json)
    values
      (workspace_id, vehicle_asset_id, demo_user, 'Ready', 'Vehicle checked and ready for use.', '[]'::jsonb),
      (workspace_id, tablet_asset_id, demo_user, 'Needs attention', 'Battery drains before end of shift. Needs manager review.', '[]'::jsonb);

    insert into public.people (workspace_id, full_name, email, phone, role_title, department, status, start_date, notes)
    values
      (workspace_id, 'Avery Johnson', 'avery@example.com', '555-0101', 'Operations Manager', 'Operations', 'active', current_date - 420, 'Owns weekly manager review.'),
      (workspace_id, 'Riley Chen', 'riley@example.com', '555-0102', 'Shift Lead', 'Field Team', 'active', current_date - 210, 'Primary checklist owner.'),
      (workspace_id, 'Casey Rivera', 'casey@example.com', '555-0103', 'Technician', 'Field Team', 'active', current_date - 90, 'Needs SOP review for closeout process.'),
      (workspace_id, 'Jamie Brooks', 'jamie@example.com', '555-0104', 'Coordinator', 'Customer Follow-Up', 'onboarding', current_date - 14, 'Training on follow-up tasks.'),
      (workspace_id, 'Drew Morgan', 'drew@example.com', '555-0105', 'Asset Owner', 'Operations', 'active', current_date - 160, 'Owns asset readiness checks.');

    insert into public.reports (workspace_id, report_type, title, date_range_start, date_range_end, body_markdown, source_data_json, created_by)
    values (
      workspace_id,
      'Weekly Operations Report',
      'Weekly Operations Report - Generated by Vaeroex',
      current_date - 7,
      current_date,
      '# Weekly Operations Report\n\nGenerated by Vaeroex.\n\n## Executive Summary\nThe workspace has useful starter systems but needs stronger ownership, follow-up tasks, and manager review cadence.\n\n## Recommended Next Actions\n- Assign owners to open follow-ups.\n- Review assets marked needs review or missing.\n- Convert repeated issues into SOP drafts.',
      jsonb_build_object('seeded', true, 'source', 'Vaeroex demo data'),
      demo_user
    );

    insert into public.ai_agent_runs (workspace_id, agent_type, input_json, output_json, status, created_by)
    values (
      workspace_id,
      'operations_audit',
      jsonb_build_object('demo', true, 'workspace', workspace_record.name),
      jsonb_build_object(
        'title', 'Vaeroex Operations Audit',
        'generated_by', 'Vaeroex',
        'summary', 'Vaeroex found follow-up gaps, unclear ownership, and missing review cadence.',
        'recommended_next_actions', jsonb_build_array(
          'Create a weekly manager review dashboard.',
          'Turn missed follow-ups into assigned tasks.',
          'Create SOP drafts for recurring issue categories.'
        )
      ),
      'completed',
      demo_user
    );

    insert into public.ai_agent_runs (workspace_id, agent_type, input_json, output_json, status, created_by)
    values
      (
        workspace_id,
        'weekly_report',
        jsonb_build_object('demo', true, 'workspace', workspace_record.name),
        jsonb_build_object(
          'title', 'Weekly Operations Report - Generated by Vaeroex',
          'summary', 'Open tasks and asset readiness need manager focus this week.',
          'response_markdown', '# Weekly Operations Report\n\nGenerated by Vaeroex.\n\n## Executive Summary\nOpen follow-ups, asset readiness, and checklist consistency are the top focus areas.\n\n## Recommended Next Actions\n- Assign owners to overdue tasks.\n- Resolve tablet readiness issue.\n- Review missed checklist run.',
          'report', jsonb_build_object(
            'title', 'Weekly Operations Report - Generated by Vaeroex',
            'report_type', 'Weekly Operations Report',
            'body_markdown', '# Weekly Operations Report\n\nGenerated by Vaeroex.\n\n## Executive Summary\nOpen follow-ups, asset readiness, and checklist consistency are the top focus areas.'
          ),
          'suggested_tasks', jsonb_build_array(
            jsonb_build_object('title', 'Resolve tablet readiness issue', 'description', 'Confirm whether the tablet needs replacement or a charging process.', 'priority', 'High', 'category', 'Assets')
          )
        ),
        'completed',
        demo_user
      ),
      (
        workspace_id,
        'form_builder',
        jsonb_build_object('demo', true, 'workspace', workspace_record.name),
        jsonb_build_object(
          'title', 'Shift Handoff Form',
          'summary', 'Vaeroex drafted a shift handoff form for manager review.',
          'response_markdown', 'Draft a shift handoff form to capture open tasks, blockers, asset issues, and manager notes.',
          'form', jsonb_build_object(
            'name', 'Shift Handoff Form',
            'description', 'Capture open tasks, blockers, asset issues, and manager notes before shift change.',
            'form_type', 'handoff',
            'fields', jsonb_build_array(
              jsonb_build_object('label', 'Submitted by', 'key', 'submitted-by', 'type', 'text', 'required', true),
              jsonb_build_object('label', 'Open tasks', 'key', 'open-tasks', 'type', 'long_text', 'required', true),
              jsonb_build_object('label', 'Blockers', 'key', 'blockers', 'type', 'long_text', 'required', false),
              jsonb_build_object('label', 'Manager notes', 'key', 'manager-notes', 'type', 'long_text', 'required', false)
            )
          )
        ),
        'completed',
        demo_user
      ),
      (
        workspace_id,
        'checklist_builder',
        jsonb_build_object('demo', true, 'workspace', workspace_record.name),
        jsonb_build_object(
          'title', 'Asset Readiness Checklist',
          'summary', 'Vaeroex drafted a recurring asset readiness checklist.',
          'response_markdown', 'Use this checklist before work starts to confirm assets are ready and exceptions are escalated.',
          'checklist', jsonb_build_object(
            'name', 'Asset Readiness Checklist',
            'description', 'Confirm critical assets are ready before work begins.',
            'category', 'Readiness',
            'frequency', 'Daily',
            'assigned_role', 'Shift Lead',
            'items', jsonb_build_array('Confirm each required asset is present', 'Check battery or fuel level', 'Log exceptions', 'Escalate missing or failed assets')
          )
        ),
        'completed',
        demo_user
      );

    insert into public.support_requests (
      workspace_id,
      user_id,
      name,
      email,
      issue_type,
      message,
      priority,
      status
    )
    values (
      workspace_id,
      demo_user,
      'Vaeroex Demo Owner',
      'demo@vaeroex.local',
      'Workspace setup',
      'Demo support request: confirm workspace setup and subscription access are visible in the internal admin queue.',
      'Medium',
      'open'
    );
  end loop;
end $$;

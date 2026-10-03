create or replace function private.guard_qbo_production_connection_intent_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.provider_key = 'quickbooks_online'
    and new.provider_environment = 'production'
    and new.status = 'pending_authorization'
    and auth.uid() is not null
    and not exists (
      select 1
      from private.integration_qbo_runtime_configurations as configuration
      where configuration.provider_environment = 'production'
        and configuration.deployment_tier = 'production'
        and configuration.configuration_version = new.configuration_version
        and configuration.enabled
    ) then
    raise exception using
      errcode = '42501',
      message = 'qbo_production_customer_connections_disabled';
  end if;

  return new;
end;
$function$;

revoke all on function
  private.guard_qbo_production_connection_intent_v1()
from public, anon, authenticated, service_role,
  external_integrations_authority, deterministic_calculation_authority,
  integration_control_plane_authority,
  integration_qbo_configuration_authority,
  integration_oauth_ingress_authority,
  integration_credential_broker_authority,
  integration_webhook_ingress_authority,
  integration_task_dispatch_authority,
  integration_task_scheduler_authority,
  integration_provider_runtime_authority,
  integration_deterministic_runtime_authority,
  integration_provider_source_authority,
  integration_provider_validation_authority;

create trigger guard_qbo_production_connection_intent_v1
before insert on private.integration_connections
for each row
execute function private.guard_qbo_production_connection_intent_v1();

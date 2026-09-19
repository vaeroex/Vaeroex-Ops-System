-- A database that previously applied the old all-in-one 20260912190000
-- migration can contain a Square-specific runtime overlay. Do not guess at or
-- silently rewrite that authority state. Abort the forward path until a
-- separately reviewed reconciliation migration is available.
begin;

do $legacy_overlay_guard$
declare
  marker_owner oid;
  marker_record record;
  object_name text;
  object_record record;
  role_name text;
  role_record record;
  expected_rpc regprocedure;
  expected_internal_rpc regprocedure;
  square_overlay_present boolean;
  square_internal_runtime_present boolean;
  square_internal_runtime_catalog_valid boolean;
  schema_digest text;
begin
  if to_regprocedure('private.integration_production_foundation_split_marker_v1()') is null then
    raise exception 'integration_production_legacy_foundation_requires_review'
      using errcode = '55000';
  end if;
  select marker_function.proowner,marker_function.provolatile,
      marker_function.proisstrict,marker_function.proparallel,
      marker_function.prosecdef,marker_function.proconfig,marker_function.prosrc,
      marker_function.prokind,marker_function.pronargs,marker_function.prorettype,
      marker_language.lanname
    into strict marker_record
  from pg_catalog.pg_proc marker_function
  join pg_catalog.pg_language marker_language on marker_language.oid=marker_function.prolang
  where marker_function.oid=
    'private.integration_production_foundation_split_marker_v1()'::regprocedure;
  if marker_record.proowner <> current_user::regrole::oid
    or marker_record.provolatile <> 'i'
    or marker_record.proisstrict
    or marker_record.proparallel <> 's'
    or marker_record.prosecdef
    or marker_record.proconfig is distinct from array['search_path=""']
    or marker_record.prokind <> 'f'
    or marker_record.pronargs <> 0
    or marker_record.prorettype <> 'text'::regtype
    or marker_record.lanname <> 'sql'
    or pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(marker_record.prosrc,'UTF8'),'sha256'),
      'hex'
    ) <> 'dfd23104a61cf287a6f4425453ff83008c80fa1214884ac13f0c8bf948723ecf'
    or exists (
      select 1
      from pg_catalog.pg_proc marker_function
      cross join lateral pg_catalog.aclexplode(marker_function.proacl) marker_acl
      where marker_function.oid=
        'private.integration_production_foundation_split_marker_v1()'::regprocedure
        and marker_acl.grantee<>marker_function.proowner
    ) then
    raise exception 'integration_production_legacy_foundation_requires_review'
      using errcode = '55000';
  end if;

  if to_regclass('private.square_production_runtime_binding') is not null
    or to_regprocedure('private.square_production_configuration_fingerprint_v1(text,text,text,name,name,name,text)') is not null
    or exists (
      select 1
      from pg_catalog.pg_attribute
      where attrelid = to_regclass('private.square_account_configuration')
        and attname in (
          'square_production_binding_fingerprint',
          'square_production_authority_fingerprint'
        )
        and not attisdropped
    ) then
    raise exception 'integration_production_legacy_overlay_requires_review'
      using errcode = '55000';
  end if;

  if to_regprocedure('private.integration_production_fingerprint_v1(text[])') is null
    or to_regclass('private.integration_production_platform_bindings') is null
    or to_regclass('private.integration_production_provider_bindings') is null
    or to_regclass('private.integration_production_provider_secrets') is null
    or to_regclass('private.integration_production_provider_capabilities') is null then
    raise exception 'integration_production_foundation_missing'
      using errcode = '55000';
  end if;

  marker_owner := marker_record.proowner;

  foreach object_name in array array[
    'private.integration_production_platform_bindings',
    'private.integration_production_provider_bindings',
    'private.integration_production_provider_secrets',
    'private.integration_production_provider_capabilities'
  ] loop
    select relkind,relpersistence,relowner,relrowsecurity,relforcerowsecurity
      into strict object_record
    from pg_catalog.pg_class
    where oid=object_name::regclass;
    if object_record.relkind <> 'r'
      or object_record.relpersistence <> 'p'
      or object_record.relowner <> marker_owner
      or not object_record.relrowsecurity
      or not object_record.relforcerowsecurity
      or exists (
        select 1
        from pg_catalog.pg_inherits inheritance
        where inheritance.inhrelid=object_name::regclass
          or inheritance.inhparent=object_name::regclass
      )
      or exists (
        select 1
        from pg_catalog.pg_rewrite rewrite_rule
        where rewrite_rule.ev_class=object_name::regclass
      )
      or exists (
        select 1
        from pg_catalog.pg_publication publication
        where publication.puballtables
      )
      or exists (
        select 1
        from pg_catalog.pg_publication_rel publication_relation
        where publication_relation.prrelid=object_name::regclass
      )
      or exists (
        select 1
        from pg_catalog.pg_publication_namespace publication_namespace
        where publication_namespace.pnnspid='private'::regnamespace
      )
      or exists (
        select 1
        from pg_catalog.pg_class relation
        cross join lateral pg_catalog.aclexplode(relation.relacl) relation_acl
        where relation.oid=object_name::regclass
          and relation_acl.grantee<>relation.relowner
      )
      or exists (
        select 1
        from pg_catalog.pg_attribute attribute
        cross join lateral pg_catalog.aclexplode(attribute.attacl) column_acl
        where attribute.attrelid=object_name::regclass
          and not attribute.attisdropped
          and column_acl.grantee<>object_record.relowner
      ) then
      raise exception 'integration_production_foundation_relation_drift'
        using errcode = '55000';
    end if;

    foreach role_name in array array[
      'anon','authenticated','service_role',
      'square_production_oauth_authority','square_production_broker_authority',
      'square_production_scheduler_authority','square_production_webhook_authority',
      'square_production_runtime_authority','square_production_evidence_authority'
    ] loop
      if to_regrole(role_name) is not null and (
        pg_catalog.has_table_privilege(role_name,object_name,
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or exists (
          select 1
          from pg_catalog.pg_attribute attribute
          where attribute.attrelid=object_name::regclass
            and attribute.attnum>0
            and not attribute.attisdropped
            and pg_catalog.has_column_privilege(role_name,object_name,attribute.attname,
              'SELECT,INSERT,UPDATE,REFERENCES')
        )
      ) then
        raise exception 'integration_production_foundation_effective_acl_drift'
          using errcode = '55000';
      end if;
    end loop;
  end loop;

  select pg_catalog.encode(extensions.digest(pg_catalog.convert_to((pg_catalog.jsonb_build_object(
    'columns',coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
        relation.relname,attribute.attnum,attribute.attname,
        pg_catalog.format_type(attribute.atttypid,attribute.atttypmod),
        attribute.attnotnull,attribute.attidentity,attribute.attgenerated,
        pg_catalog.pg_get_expr(default_value.adbin,default_value.adrelid,true)
      ) order by relation.relname,attribute.attnum)
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
      join pg_catalog.pg_attribute attribute on attribute.attrelid=relation.oid
      left join pg_catalog.pg_attrdef default_value
        on default_value.adrelid=relation.oid and default_value.adnum=attribute.attnum
      where namespace.nspname='private'
        and relation.relname=any(array[
          'integration_production_platform_bindings','integration_production_provider_bindings',
          'integration_production_provider_secrets','integration_production_provider_capabilities'
        ]) and attribute.attnum>0 and not attribute.attisdropped
    ),'[]'::jsonb),
    'constraints',coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
        relation.relname,constraint_record.conname,constraint_record.contype,
        constraint_record.condeferrable,constraint_record.condeferred,
        constraint_record.convalidated,
        pg_catalog.pg_get_constraintdef(constraint_record.oid,true)
      ) order by relation.relname,constraint_record.conname)
      from pg_catalog.pg_constraint constraint_record
      join pg_catalog.pg_class relation on relation.oid=constraint_record.conrelid
      join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname='private' and relation.relname=any(array[
        'integration_production_platform_bindings','integration_production_provider_bindings',
        'integration_production_provider_secrets','integration_production_provider_capabilities'
      ])
    ),'[]'::jsonb),
    'indexes',coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
        relation.relname,index_relation.relname,
        pg_catalog.pg_get_indexdef(index_record.indexrelid,0,true)
      ) order by relation.relname,index_relation.relname)
      from pg_catalog.pg_index index_record
      join pg_catalog.pg_class relation on relation.oid=index_record.indrelid
      join pg_catalog.pg_class index_relation on index_relation.oid=index_record.indexrelid
      join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname='private' and relation.relname=any(array[
        'integration_production_platform_bindings','integration_production_provider_bindings',
        'integration_production_provider_secrets','integration_production_provider_capabilities'
      ])
    ),'[]'::jsonb),
    'policy_count',(select count(*) from pg_catalog.pg_policy policy_record
      where policy_record.polrelid=any(array[
        'private.integration_production_platform_bindings'::regclass,
        'private.integration_production_provider_bindings'::regclass,
        'private.integration_production_provider_secrets'::regclass,
        'private.integration_production_provider_capabilities'::regclass
      ])),
    'trigger_count',(select count(*) from pg_catalog.pg_trigger trigger_record
      where not trigger_record.tgisinternal and trigger_record.tgrelid=any(array[
        'private.integration_production_platform_bindings'::regclass,
        'private.integration_production_provider_bindings'::regclass,
        'private.integration_production_provider_secrets'::regclass,
        'private.integration_production_provider_capabilities'::regclass
      ]))
  ))::text,'UTF8'),'sha256'),'hex') into strict schema_digest;
  if schema_digest <> '0fe4e1c2080fed1725db60ddb1643f4cd2d979a1a261c3445aae54c56788897e' then
    raise exception 'integration_production_foundation_schema_drift'
      using errcode='55000';
  end if;

  select proowner,provolatile,proisstrict,proparallel,prosecdef,proconfig,prosrc
    into strict object_record
  from pg_catalog.pg_proc
  where oid='private.integration_production_fingerprint_v1(text[])'::regprocedure;
  if object_record.proowner <> marker_owner
    or object_record.provolatile <> 'i'
    or not object_record.proisstrict
    or object_record.proparallel <> 's'
    or object_record.prosecdef
    or object_record.proconfig is distinct from array['search_path=""']
    or pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(object_record.prosrc,'UTF8'),'sha256'),
      'hex'
    ) <> '98a86fc4d75c479b10ae63900cdf1c03a5083fb59a52d61636cc3a886acfa096'
    or exists (
      select 1
      from pg_catalog.pg_proc function_record
      cross join lateral pg_catalog.aclexplode(function_record.proacl) function_acl
      where function_record.oid='private.integration_production_fingerprint_v1(text[])'::regprocedure
        and function_acl.grantee<>function_record.proowner
    ) then
    raise exception 'integration_production_foundation_function_drift'
      using errcode = '55000';
  end if;
  square_overlay_present :=
    to_regclass('private.square_production_configuration_generations') is not null;
  square_internal_runtime_present :=
    to_regprocedure('public.square_production_internal_oauth_v1(text,jsonb)') is not null
    and to_regprocedure('public.square_production_internal_broker_v1(text,jsonb)') is not null
    and to_regprocedure('public.square_production_internal_runtime_v1(text,jsonb)') is not null
    and to_regprocedure('public.square_production_internal_evidence_v1(text,jsonb)') is not null;

  if not square_internal_runtime_present and (
    to_regprocedure('public.square_production_internal_oauth_v1(text,jsonb)') is not null
    or to_regprocedure('public.square_production_internal_broker_v1(text,jsonb)') is not null
    or to_regprocedure('public.square_production_internal_runtime_v1(text,jsonb)') is not null
    or to_regprocedure('public.square_production_internal_evidence_v1(text,jsonb)') is not null
  ) then
    raise exception 'integration_production_internal_runtime_partial'
      using errcode = '55000';
  end if;

  with expected(signature,language,volatility,security_definer,is_strict,parallel,result,names,default_count,default_expression,source_hash) as (values
    ('private.square_production_internal_reject_immutable_mutation_v1()','plpgsql','v',true,false,'u','trigger',null::text[],0,null::text,'879e64a04de08a3fb906ce6f0a5675627ecace40386769247cf0a44c817dd82e'),
    ('private.square_production_internal_guard_lifecycle_update_v1()','plpgsql','v',true,false,'u','trigger',null::text[],0,null::text,'61cbb7ce05f9bf6c574f44f7642c6bb239815b639fc1fc00fe65fa753f1cd818'),
    ('private.square_production_internal_require_keys_v1(jsonb,text[])','plpgsql','i',false,true,'s','void',array['p_payload','p_required_keys']::text[],0,null::text,'ec3eb20a72acab3d1c18c6d5eb9b2fb1eb4d8c6743af2c4f2e4c80bba0d91d61'),
    ('private.square_production_internal_fingerprint_v1(text[])','sql','i',false,true,'s','text',array['p_parts']::text[],0,null::text,'3f77909a44ff2bbc574f8b3228482aac0e9c55a1dd3356001384efe21db560b4'),
    ('private.square_production_internal_audit_v1(uuid,bigint,text,text,text,text,timestamptz)','plpgsql','v',true,false,'u','text',array['p_permit_id','p_generation','p_event_kind','p_outcome','p_reason_code','p_subject_fingerprint','p_recorded_at']::text[],0,null::text,'4d548e25a8988edc1fdfa8b719bf5d7195e32d9f44bde5b584f8484fc30539cb'),
    ('private.square_production_internal_require_login_v1(text)','plpgsql','s',true,false,'u','void',array['p_capability']::text[],0,null::text,'bef67b686c3168496fcc46e2518e1555b694faef1168f5612caf2921183107df'),
    ('private.square_production_internal_lock_permit_v1(uuid,text,boolean)','plpgsql','v',true,false,'u','private.square_production_internal_permits',array['p_permit_id','p_capability','p_allow_internal_fence']::text[],1,'false','70e8f973ca1942bf69d6e0c0228a145eb44edfc1bc26ed153fae3321de08b920'),
    ('private.square_production_internal_install_permit_v1(jsonb)','plpgsql','v',true,false,'u','jsonb',array['p_payload']::text[],0,null::text,'efa4aa61687f5580ceb24897fb1ad6a83527c765a37804bcc03cbbfa375b1905'),
    ('public.square_production_internal_oauth_v1(text,jsonb)','plpgsql','v',true,false,'u','jsonb',array['p_operation','p_payload']::text[],0,null::text,'6ff215c19aa5c66b607c307d26bcf8f53cc8b3308bd929a50a5f97c5e049d860'),
    ('public.square_production_internal_broker_v1(text,jsonb)','plpgsql','v',true,false,'u','jsonb',array['p_operation','p_payload']::text[],0,null::text,'41f97c64568a973faa25cfdf99bca8301cbb2103ff8d95491d010e90d3e0d6bb'),
    ('public.square_production_internal_runtime_v1(text,jsonb)','plpgsql','v',true,false,'u','jsonb',array['p_operation','p_payload']::text[],0,null::text,'63024be692c785827b982945c220b0268d8e57ee2db4f3d46a8033a5f5fe3301'),
    ('public.square_production_internal_evidence_v1(text,jsonb)','plpgsql','v',true,false,'u','jsonb',array['p_operation','p_payload']::text[],0,null::text,'98e2d0363897ad1020fb4296dd643ccd4798cac10030b8a4883379844d954877')
  ), resolved as (
    select expected.*,pg_catalog.to_regprocedure(expected.signature) oid from expected
  )
  select (select count(*)=12 from resolved where oid is not null)
    and (select count(*)=12 from pg_catalog.pg_proc function_record
      join pg_catalog.pg_namespace namespace on namespace.oid=function_record.pronamespace
      where namespace.nspname in ('private','public')
        and function_record.proname like 'square\_production\_internal\_%' escape '\')
    and not exists (
      select 1 from resolved expected
      left join pg_catalog.pg_proc function_record on function_record.oid=expected.oid
      left join pg_catalog.pg_language function_language on function_language.oid=function_record.prolang
      where function_record.oid is null
        or function_language.lanname<>expected.language
        or function_record.proowner<>marker_owner
        or function_record.provolatile<>expected.volatility::"char"
        or function_record.prosecdef<>expected.security_definer
        or function_record.proisstrict<>expected.is_strict
        or function_record.proparallel<>expected.parallel::"char"
        or function_record.proretset or function_record.prokind<>'f'
        or function_record.prorettype<>pg_catalog.to_regtype(expected.result)
        or function_record.proargnames is distinct from expected.names
        or function_record.proargmodes is not null
        or function_record.pronargdefaults<>expected.default_count
        or pg_catalog.pg_get_expr(function_record.proargdefaults,0) is distinct from expected.default_expression
        or function_record.proconfig is distinct from array['search_path=""']::text[]
        or pg_catalog.encode(extensions.digest(
          pg_catalog.convert_to(function_record.prosrc,'UTF8'),'sha256'
        ),'hex')<>expected.source_hash
    )
    into strict square_internal_runtime_catalog_valid;

  if square_internal_runtime_present and (
    not square_internal_runtime_catalog_valid
    or not exists (
      select 1 from supabase_migrations.schema_migrations
      where version='20260902191325'
    )
    or 8 <> (
      select count(*) from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname='private' and relation.relkind='r'
        and relation.relname like 'square\_production\_internal\_%' escape '\'
        and relation.relname=any(array[
          'square_production_internal_permits','square_production_internal_oauth_states',
          'square_production_internal_credentials','square_production_internal_scans',
          'square_production_internal_page_receipts','square_production_internal_source_versions',
          'square_production_internal_fences','square_production_internal_audit_events'
        ])
    )
  ) then
    raise exception 'integration_production_internal_runtime_drift'
      using errcode = '55000';
  end if;

  if square_internal_runtime_present then
    foreach object_name in array array[
      'private.square_production_internal_permits','private.square_production_internal_oauth_states',
      'private.square_production_internal_credentials','private.square_production_internal_scans',
      'private.square_production_internal_page_receipts','private.square_production_internal_source_versions',
      'private.square_production_internal_fences','private.square_production_internal_audit_events'
    ] loop
      if not exists (
        select 1 from pg_catalog.pg_class relation
        where relation.oid=object_name::regclass and relation.relkind='r'
          and relation.relpersistence='p' and relation.relowner=marker_owner
          and relation.relrowsecurity and relation.relforcerowsecurity
          and not relation.relhassubclass
      ) or exists (
        select 1 from pg_catalog.pg_policy policy where policy.polrelid=object_name::regclass
      ) or exists (
        select 1 from pg_catalog.pg_inherits inheritance
        where inheritance.inhrelid=object_name::regclass or inheritance.inhparent=object_name::regclass
      ) or exists (
        select 1 from pg_catalog.pg_rewrite rule where rule.ev_class=object_name::regclass
      ) or exists (
        select 1 from pg_catalog.pg_class relation
        cross join lateral pg_catalog.aclexplode(relation.relacl) acl
        where relation.oid=object_name::regclass and acl.grantee<>marker_owner
      ) or exists (
        select 1 from pg_catalog.pg_attribute attribute
        cross join lateral pg_catalog.aclexplode(attribute.attacl) acl
        where attribute.attrelid=object_name::regclass and not attribute.attisdropped
          and acl.grantee<>marker_owner
      ) or exists (
        select 1 from pg_catalog.pg_publication publication where publication.puballtables
      ) or exists (
        select 1 from pg_catalog.pg_publication_rel publication_relation
        where publication_relation.prrelid=object_name::regclass
      ) or exists (
        select 1 from pg_catalog.pg_publication_namespace publication_namespace
        where publication_namespace.pnnspid='private'::regnamespace
      ) then
        raise exception 'integration_production_internal_relation_drift' using errcode='55000';
      end if;
    end loop;

    select pg_catalog.encode(extensions.digest(pg_catalog.convert_to((pg_catalog.jsonb_build_object(
      'relations',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
        relation.relname,relation.relreplident,relation.reloptions,relation.reltablespace
      ) order by relation.relname)
        from pg_catalog.pg_class relation join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
        where namespace.nspname='private' and relation.relkind='r'
          and relation.relname like 'square\_production\_internal\_%' escape '\'),'[]'::jsonb),
      'columns',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
        relation.relname,attribute.attnum,attribute.attname,
        pg_catalog.format_type(attribute.atttypid,attribute.atttypmod),attribute.attnotnull,
        attribute.attidentity,attribute.attgenerated,
        pg_catalog.pg_get_expr(default_value.adbin,default_value.adrelid,true),
        case when attribute.attcollation=0 then null else
          pg_catalog.format('%I.%I',collation_namespace.nspname,collation_record.collname) end,
        collation_record.collprovider::text,collation_record.collisdeterministic,collation_record.collversion
      ) order by relation.relname,attribute.attnum)
        from pg_catalog.pg_class relation join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
        join pg_catalog.pg_attribute attribute on attribute.attrelid=relation.oid
        left join pg_catalog.pg_attrdef default_value on default_value.adrelid=relation.oid and default_value.adnum=attribute.attnum
        left join pg_catalog.pg_collation collation_record on collation_record.oid=attribute.attcollation
        left join pg_catalog.pg_namespace collation_namespace on collation_namespace.oid=collation_record.collnamespace
        where namespace.nspname='private' and relation.relkind='r'
          and relation.relname like 'square\_production\_internal\_%' escape '\'
          and attribute.attnum>0 and not attribute.attisdropped),'[]'::jsonb),
      'constraints',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
        relation.relname,constraint_record.conname,constraint_record.contype,
        constraint_record.condeferrable,constraint_record.condeferred,constraint_record.convalidated,
        pg_catalog.pg_get_constraintdef(constraint_record.oid,true)
      ) order by relation.relname,constraint_record.conname)
        from pg_catalog.pg_constraint constraint_record
        join pg_catalog.pg_class relation on relation.oid=constraint_record.conrelid
        join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
        where namespace.nspname='private' and relation.relkind='r'
          and relation.relname like 'square\_production\_internal\_%' escape '\'),'[]'::jsonb),
      'indexes',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
        relation.relname,index_relation.relname,index_relation.reloptions,index_relation.reltablespace,
        index_record.indisunique,index_record.indisprimary,index_record.indisexclusion,
        index_record.indisvalid,index_record.indisready,index_record.indislive,
        index_record.indisreplident,index_record.indnullsnotdistinct,
        pg_catalog.pg_get_indexdef(index_record.indexrelid,0,true)
      ) order by relation.relname,index_relation.relname)
        from pg_catalog.pg_index index_record
        join pg_catalog.pg_class relation on relation.oid=index_record.indrelid
        join pg_catalog.pg_class index_relation on index_relation.oid=index_record.indexrelid
        join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
        where namespace.nspname='private' and relation.relkind='r'
          and relation.relname like 'square\_production\_internal\_%' escape '\'),'[]'::jsonb),
      'triggers',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
        relation.relname,trigger_record.tgname,trigger_record.tgenabled,
        pg_catalog.pg_get_triggerdef(trigger_record.oid,true)
      ) order by relation.relname,trigger_record.tgname)
        from pg_catalog.pg_trigger trigger_record
        join pg_catalog.pg_class relation on relation.oid=trigger_record.tgrelid
        join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
        where namespace.nspname='private' and relation.relkind='r'
          and relation.relname like 'square\_production\_internal\_%' escape '\'
          and not trigger_record.tgisinternal),'[]'::jsonb),
      'internalTriggers',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
        namespace.nspname,relation.relname,declared_namespace.nspname,declared_relation.relname,
        constraint_record.conname,referenced_namespace.nspname,referenced_relation.relname,
        trigger_function_namespace.nspname,
        trigger_function.proname,pg_catalog.pg_get_function_identity_arguments(trigger_function.oid),
        trigger_record.tgtype::integer,trigger_record.tgattr::text,
        pg_catalog.encode(trigger_record.tgargs,'hex'),
        pg_catalog.pg_get_expr(trigger_record.tgqual,trigger_record.tgrelid,true),
        trigger_record.tgenabled::text
      ) order by namespace.nspname,relation.relname,declared_relation.relname,
        constraint_record.conname,trigger_function_namespace.nspname,
        trigger_function.proname,trigger_record.tgtype,trigger_record.tgattr::text)
        from pg_catalog.pg_trigger trigger_record
        join pg_catalog.pg_class relation on relation.oid=trigger_record.tgrelid
        join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
        join pg_catalog.pg_proc trigger_function on trigger_function.oid=trigger_record.tgfoid
        join pg_catalog.pg_namespace trigger_function_namespace on trigger_function_namespace.oid=trigger_function.pronamespace
        left join pg_catalog.pg_constraint constraint_record on constraint_record.oid=trigger_record.tgconstraint
        left join pg_catalog.pg_class declared_relation on declared_relation.oid=constraint_record.conrelid
        left join pg_catalog.pg_namespace declared_namespace on declared_namespace.oid=declared_relation.relnamespace
        left join pg_catalog.pg_class referenced_relation on referenced_relation.oid=constraint_record.confrelid
        left join pg_catalog.pg_namespace referenced_namespace on referenced_namespace.oid=referenced_relation.relnamespace
        where trigger_record.tgisinternal and (
          (namespace.nspname='private' and relation.relkind='r'
            and relation.relname like 'square\_production\_internal\_%' escape '\')
          or (declared_namespace.nspname='private' and declared_relation.relkind='r'
            and declared_relation.relname like 'square\_production\_internal\_%' escape '\'
            and constraint_record.contype='f')
        )),'[]'::jsonb)
    ))::text,'UTF8'),'sha256'),'hex') into strict schema_digest;
    if schema_digest is distinct from '9f8f5bc1b89d2093e58ca6fda32806266b9da2115cd454e84b8ab761cdd19fd6' then
      raise exception 'integration_production_internal_relation_contract_drift' using errcode='55000';
    end if;
  end if;

  foreach role_name in array array[
    'anon','authenticated','service_role',
    'square_production_oauth_authority','square_production_broker_authority',
    'square_production_scheduler_authority','square_production_webhook_authority',
    'square_production_runtime_authority','square_production_evidence_authority'
  ] loop
    if to_regrole(role_name) is not null
      and pg_catalog.has_function_privilege(
        role_name,'private.integration_production_fingerprint_v1(text[])','EXECUTE') then
      raise exception 'integration_production_foundation_function_acl_drift'
        using errcode = '55000';
    end if;
  end loop;

  -- Stored generated values are not recomputed when an immutable helper is
  -- replaced and later restored. Authenticate every retained value against the
  -- reviewed helper before a later provider overlay may rely on these columns.
  -- `row_security=off` never weakens access: PostgreSQL either gives a
  -- BYPASSRLS-capable migration actor the physical rows or raises rather than
  -- silently applying a policy. Thus inability to prove the values aborts.
  perform pg_catalog.set_config('row_security','off',true);
  if exists (
    select 1
    from private.integration_production_platform_bindings platform_binding
    where platform_binding.platform_fingerprint is distinct from
      private.integration_production_fingerprint_v1(array[
        platform_binding.binding_key,platform_binding.project_id,
        platform_binding.project_number,platform_binding.region,
        platform_binding.source_commit
      ])
  ) or exists (
    select 1
    from private.integration_production_provider_bindings provider_binding
    where provider_binding.provider_authority_fingerprint is distinct from
      private.integration_production_fingerprint_v1(array[
        provider_binding.provider_key,provider_binding.environment,
        provider_binding.application_id,provider_binding.callback_uri,
        provider_binding.kms_key_resource
      ])
  ) then
    raise exception 'integration_production_foundation_stored_fingerprint_drift'
      using errcode = '55000';
  end if;

  foreach role_name in array array[
    'square_production_oauth_authority','square_production_broker_authority',
    'square_production_scheduler_authority','square_production_webhook_authority',
    'square_production_runtime_authority','square_production_evidence_authority'
  ] loop
    expected_rpc := case role_name
      when 'square_production_oauth_authority' then pg_catalog.to_regprocedure('public.check_square_production_oauth_authority_v1(text,text,text,bigint,text)')
      when 'square_production_broker_authority' then pg_catalog.to_regprocedure('public.check_square_production_broker_authority_v1(text,text,text,bigint,text)')
      when 'square_production_scheduler_authority' then pg_catalog.to_regprocedure('public.check_square_production_scheduler_authority_v1(text,text,text,bigint,text)')
      when 'square_production_webhook_authority' then pg_catalog.to_regprocedure('public.check_square_production_webhook_authority_v1(text,text,text,bigint,text)')
      when 'square_production_runtime_authority' then pg_catalog.to_regprocedure('public.check_square_production_runtime_authority_v1(text,text,text,bigint,text)')
      when 'square_production_evidence_authority' then pg_catalog.to_regprocedure('public.check_square_production_evidence_authority_v1(text,text,text,bigint,text)')
    end;
    expected_internal_rpc := case role_name
      when 'square_production_oauth_authority' then pg_catalog.to_regprocedure('public.square_production_internal_oauth_v1(text,jsonb)')
      when 'square_production_broker_authority' then pg_catalog.to_regprocedure('public.square_production_internal_broker_v1(text,jsonb)')
      when 'square_production_runtime_authority' then pg_catalog.to_regprocedure('public.square_production_internal_runtime_v1(text,jsonb)')
      when 'square_production_evidence_authority' then pg_catalog.to_regprocedure('public.square_production_internal_evidence_v1(text,jsonb)')
      else null
    end;
    select * into role_record from pg_catalog.pg_roles where rolname=role_name;
    if not found
      or role_record.rolcanlogin or role_record.rolinherit or role_record.rolsuper
      or role_record.rolcreatedb or role_record.rolcreaterole
      or role_record.rolreplication or role_record.rolbypassrls
      or role_record.rolconfig is not null
      or exists (
        select 1
        from pg_catalog.pg_auth_members membership
        left join pg_catalog.pg_roles member_role on member_role.oid=membership.member
        where membership.member=role_record.oid or (
          membership.roleid=role_record.oid and (
            membership.inherit_option or membership.set_option
            or not membership.admin_option
            or not (member_role.rolsuper or member_role.rolcreaterole)
          )
        )
      )
      or exists (
        select 1
        from pg_catalog.pg_shdepend dependency
        where dependency.refclassid='pg_authid'::regclass
          and dependency.refobjid=role_record.oid
          and dependency.deptype in ('a','o')
          and not (
            dependency.deptype='a' and dependency.objsubid=0
            and dependency.dbid=(select oid from pg_catalog.pg_database where datname=current_database())
            and (
              (
                dependency.classid='pg_namespace'::regclass
                and dependency.objid='public'::regnamespace
              ) or (
                square_overlay_present
                and (not square_internal_runtime_present or expected_internal_rpc is null)
                and dependency.classid='pg_proc'::regclass
                and dependency.objid=expected_rpc::oid
              ) or (
                square_internal_runtime_present
                and expected_internal_rpc is not null
                and dependency.classid='pg_proc'::regclass
                and dependency.objid=expected_internal_rpc::oid
              )
            )
          )
      )
      or (
        square_overlay_present
        and (not square_internal_runtime_present or expected_internal_rpc is null)
        and (
          expected_rpc is null
          or 1 <> (
            select count(*)
            from pg_catalog.pg_proc rpc
            cross join lateral pg_catalog.aclexplode(rpc.proacl) rpc_acl
            where rpc.oid=expected_rpc::oid
              and rpc_acl.grantee<>rpc.proowner
          )
          or 1 <> (
            select count(*)
            from pg_catalog.pg_proc rpc
            cross join lateral pg_catalog.aclexplode(rpc.proacl) rpc_acl
            where rpc.oid=expected_rpc::oid
              and rpc_acl.grantee=role_record.oid
              and rpc_acl.grantor=rpc.proowner
              and rpc_acl.privilege_type='EXECUTE'
              and not rpc_acl.is_grantable
          )
        )
      )
      or (
        square_internal_runtime_present and expected_internal_rpc is not null and (
          exists (
            select 1
            from pg_catalog.pg_proc rpc
            cross join lateral pg_catalog.aclexplode(rpc.proacl) rpc_acl
            where rpc.oid=expected_rpc::oid
              and rpc_acl.grantee<>rpc.proowner
          )
          or
          1 <> (
            select count(*)
            from pg_catalog.pg_proc rpc
            cross join lateral pg_catalog.aclexplode(rpc.proacl) rpc_acl
            where rpc.oid=expected_internal_rpc::oid
              and rpc_acl.grantee<>rpc.proowner
          )
          or 1 <> (
            select count(*)
            from pg_catalog.pg_proc rpc
            cross join lateral pg_catalog.aclexplode(rpc.proacl) rpc_acl
            where rpc.oid=expected_internal_rpc::oid
              and rpc_acl.grantee=role_record.oid
              and rpc_acl.grantor=rpc.proowner
              and rpc_acl.privilege_type='EXECUTE'
              and not rpc_acl.is_grantable
          )
        )
      )
      or 1 <> (
        select count(*)
        from pg_catalog.pg_namespace public_schema
        cross join lateral pg_catalog.aclexplode(public_schema.nspacl) schema_acl
        where public_schema.oid='public'::regnamespace
          and schema_acl.grantee=role_record.oid
          and schema_acl.privilege_type='USAGE'
          and not schema_acl.is_grantable
      )
      or pg_catalog.has_schema_privilege(role_name,'public','CREATE')
      or 1 < (select count(*) from pg_catalog.pg_auth_members where roleid=role_record.oid)
    then
      raise exception 'integration_production_foundation_role_drift'
        using errcode = '55000';
    end if;
  end loop;
end
$legacy_overlay_guard$;

commit;

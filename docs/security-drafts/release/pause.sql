-- LOCAL REVIEW DRAFT ONLY. Safe pause, not a destructive schema rollback.
-- Apply only if these exact functions were introduced by the reviewed release.
begin;
revoke execute on function public.preview_legacy_evidence_mapping_v1(uuid,text,uuid),
 public.confirm_legacy_evidence_mapping_v1(uuid,text,uuid,uuid,text),
 public.capture_legacy_evidence_v1(uuid,uuid,date,date),
 public.reopen_legacy_evidence_v1(uuid,uuid),
 public.read_shared_typed_evidence_v1(uuid,jsonb),
 public.seal_shared_evidence_manifest_v1(uuid,text,uuid,integer,uuid,jsonb,uuid[]) from authenticated;
-- Keep owner restrictive policies, source/session fences and saved provenance.
-- Later discovery/preview entry points also stop admitting new contexts.
revoke execute on function public.preview_shared_legacy_evidence_v1(uuid,uuid,date,date),
 public.discover_shared_evidence_v1(uuid,date,date),
 public.discover_shared_evidence_v2(uuid,date,date,text[]),
 public.shared_evidence_dependencies_v1(uuid,uuid) from authenticated;
commit;

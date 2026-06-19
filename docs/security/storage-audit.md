# Storage Security Audit

| Check | Result | Status |
| --- | --- | --- |
| `workspace-files` bucket exists in migrations | Created in `202606180004_files_imports.sql` | SAFE |
| Bucket is private | Migration sets `public = false` | SAFE |
| File metadata includes workspace_id | `file_uploads.workspace_id` is required | SAFE |
| Storage path is workspace-scoped | Upload path starts with `${workspaceId}/...` | SAFE |
| Select policy checks workspace membership | Storage policy uses first path segment and `public.is_workspace_member` | SAFE |
| Insert/update policy checks workspace membership | Storage policy requires first path segment to match a member workspace | SAFE |
| Delete policy requires edit permission | Storage delete policy uses `public.can_edit_operations` | SAFE |
| File action reads are workspace-scoped | `getFileForWorkspace` checks file ID and active `workspace_id` | SAFE |
| Public URLs for private files | App uses private bucket metadata; no public file URL workflow is documented | SAFE |

Manual production check:

1. In Supabase Storage, confirm bucket `workspace-files` is private.
2. Upload a file in Workspace A.
3. Switch to Workspace B and verify the file does not appear.
4. Try direct access to the object path with a Workspace B session; it should fail.
5. Confirm report creation/analyze/import actions fail if the selected file is not in the active workspace.

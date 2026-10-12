export type StorageFileState = "active" | "archived" | "trash" | "historical_trash";

export type StorageUsageGroup = { bytes: number; files: number };

/** Metadata only: this model must never include extracted text or file contents. */
export type StorageUsageFile = {
  id: string;
  displayName: string;
  bytes: number;
  state: StorageFileState;
  deletedAt: string | null;
  purgeAfter: string | null;
  legacyProtected: boolean;
  storageMissing: boolean;
  deletionPending?: boolean;
};

export type SeparateDataUsage = {
  label: string;
  estimatedBytes: number | null;
  records: number | null;
  explanation?: string;
};

/** page is one-based, matching the database RPC and public endpoint. */
export type StorageTrashPage = { files: StorageUsageFile[]; total: number; page: number; pageSize: number };

export type WorkspaceStorageUsage = {
  workspaceId: string;
  includedBytes: number;
  includedFiles: number;
  paidPacks: number;
  allowanceBytes: number;
  allowanceFiles: number;
  usedBytes: number;
  usedFiles: number;
  reservedBytes: number;
  reservedFiles: number;
  availableBytes: number;
  availableFiles: number;
  active: StorageUsageGroup;
  archived: StorageUsageGroup;
  trash: StorageUsageGroup;
  historicalTrash: StorageUsageGroup;
  unlinkedBytes: number;
  missingFiles: number;
  measuredAt: string | null;
  largestFiles: StorageUsageFile[];
  separateData: SeparateDataUsage[];
  /** No enforcement until the initial object reconciliation succeeds. */
  reconciled?: boolean;
};

export type StorageLifecycleAction = "archive" | "restore" | "delete" | "purge";

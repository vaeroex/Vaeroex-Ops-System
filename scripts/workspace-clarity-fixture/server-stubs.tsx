const reject = () => { throw new Error("Synthetic preview: all server actions are blocked"); };
export const approveBusinessNoteAction = reject;
export const bulkManageBusinessNotesAction = reject;
export const cancelBusinessNoteReviewAction = reject;
export const submitBusinessNoteForReviewAction = reject;
export const explainFindingAction = reject;
export const mutateIntelligenceCardLifecycleAction = reject;
export const generateIntelligenceBriefingAction = reject;
export const deleteSavedAnalysesAction = reject;
export const saveAnalysisAction = reject;
export const getSavedAnalysisState = async () => ({ saved: false });
export const changePasswordAction = reject;
export const qboProductionCustomerConnectionsEnabled = () => false;
export const squareDirectEnabled = () => true;
export const readSquareWorkspaceEvidence = async () => null;
export const headers = async () => new Headers();
export const requireWorkspacePage = async () => ({
  context: { profile: { email: "synthetic-owner@example.test" }, membership: { role: "owner" }, activeWorkspace: { name: "Synthetic workspace" } },
  workspaceId: "synthetic-workspace", supabase: { from: reject }
});
export const ConnectionStatusPanel = () => null;
export const SquareEvidenceCard = () => null;

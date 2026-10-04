const snapshots = import.meta.glob('../../../../evidence/*/result.json', { eager: true, import: 'default' })
export function evidenceFor(id: string): any {
  return snapshots[`../../../../evidence/${id}/result.json`]
}
export function hasActionsEvidence(result: any): boolean {
  return result?.status === 'passed' && result?.execution === 'github-actions' && /^[a-f0-9]{40}$/.test(result?.source?.sha || '') && /^[a-f0-9]{40}$/.test(result?.toolSha || '') && Boolean(result?.workflowUrl)
}

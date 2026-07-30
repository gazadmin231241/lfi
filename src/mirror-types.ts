export interface MirrorIssue {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  labels: string[];
}

export interface GithubMirrorAdapter {
  verifyDestination?(): Promise<void>;
  ensureTypeLabels?(): Promise<void>;
  findByLfiId(id: string): Promise<MirrorIssue | undefined>;
  getIssue(number: number): Promise<MirrorIssue | undefined>;
  createIssue(
    issue: Omit<MirrorIssue, "number">,
    closingComment?: string,
  ): Promise<MirrorIssue>;
  updateIssue(issue: MirrorIssue, closingComment?: string): Promise<void>;
  reconcileParent(child: number, parent?: number): Promise<void>;
  reconcileBlockers(
    child: number,
    blockers: readonly number[],
  ): Promise<void>;
}

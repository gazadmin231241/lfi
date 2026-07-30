export interface MirrorIssue {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
}

export interface GithubMirrorAdapter {
  findByLfiId(id: string): Promise<MirrorIssue | undefined>;
  getIssue(number: number): Promise<MirrorIssue | undefined>;
  createIssue(
    title: string,
    body: string,
    state: "open" | "closed",
    closingComment?: string,
  ): Promise<MirrorIssue>;
  updateIssue(issue: MirrorIssue, closingComment?: string): Promise<void>;
  setParent(child: number, parent: number): Promise<void>;
  setBlockers(child: number, blockers: readonly number[]): Promise<void>;
}
